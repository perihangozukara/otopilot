// lib/ses-motor-edge.js — Microsoft Edge "sesli oku" motoru (msedge-tts). VARSAYILAN motor.
//
// UYARI: Bu, Microsoft'un sozlesmeli resmi bir API'si DEGIL; Edge tarayicisinin sesli okuma
// ucunu taklit eden bir kutuphane. Ucretsiz ve anahtarsiz ama garantisiz: Microsoft ucu, belirteci
// ya da IP sinirini degistirirse calismayabilir. Ticari kanalda hak durumu belirsizdir. Bu yuzden
// motor soyutlandi (azure resmi REST, piper yerel) ve "otomatik" modda yedege gecilir.
//
// Arayuz (tum motorlar ayni):
//   olustur({ses, hiz, msedge?}) -> { ad, kelimeZamani, ses, sentez(metin,{sinyal}), sifirla(), kapat() }
//   sentez -> Promise<{buf: Buffer(mp3), kelimeler: [{t,d,w}]}>   (t/d ms, parcaya gore goreli)
"use strict";
const { xmlKacis } = require("./ses-metin.js");

const SES_ADI = /^[A-Za-z0-9-]{3,80}$/;

// Iptal edilen (zaman asimi) isteğin SOKETINI hemen kes. msedge-tts, yok edilen akisin kaydini siler;
// sunucu SONRADAN o istege ait kare yollarsa kutuphane onmessage icinde TypeError firlatir ve surec
// olur (gercek kutuphane + yerel sahte sunucuyla dogrulandi: test/ses-edge-gercek-cocuk.js).
// terminate() el sikismasiz keser: baska kare islenmez. t._streams/_ws/_retiredSockets kutuphanenin
// ozel alanlari (msedge-tts 2.0.9); yoksa (sahte motor, baska surum) sessizce atlanir.
function sokettiKes(t, istekNo) {
  if (!t) return;
  const soketler = new Set();
  try {
    const akis = istekNo && t._streams && t._streams[istekNo];
    if (akis && akis.socket) soketler.add(akis.socket);
    if (t._ws) soketler.add(t._ws);
    for (const s of (t._retiredSockets || [])) soketler.add(s);
  } catch (e) { /* ozel alanlar okunamadi: yoksay */ }
  for (const s of soketler) {
    try {
      if (typeof s.terminate === "function") s.terminate();
      else if (typeof s.close === "function") s.close();
    } catch (e) { /* zaten kapali */ }
  }
}

function olustur(ayar) {
  if (!SES_ADI.test(String(ayar.ses || ""))) {
    const e = new Error("Geçersiz ses adı: '" + ayar.ses + "' (örnek: en-US-ChristopherNeural)");
    e.kalici = true;
    throw e;
  }
  // Kutuphane tembel yuklenir: kurulu degilse yalnizca bu motor secilince hata verir.
  let kutuphane = ayar.msedge;
  if (!kutuphane) {
    try { kutuphane = require("msedge-tts"); }
    catch (e) {
      const h = new Error("msedge-tts paketi kurulu değil (proje klasöründe 'npm install' çalıştır)");
      h.kalici = true;
      throw h;
    }
  }
  const { MsEdgeTTS, OUTPUT_FORMAT } = kutuphane;

  let tts = null;
  let nesil = 0;          // sifirla/kapat sonrasi gec kalan baglantilarin sizmamasi icin

  function kapat() {
    nesil++;
    const t = tts; tts = null;
    try { if (t && typeof t.close === "function") t.close(); } catch (e) { /* yoksay */ }
  }

  async function baglan() {
    kapat();
    const benim = nesil;
    const yeni = new MsEdgeTTS();
    await yeni.setMetadata(ayar.ses, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
      sentenceBoundaryEnabled: false,
    });
    if (benim !== nesil) {                 // baglanirken iptal edildi: baglantiyi birak
      try { yeni.close(); } catch (e) { /* yoksay */ }
      throw new Error("bağlantı iptal edildi");
    }
    tts = yeni;
  }

  async function sentez(metin, secenek) {
    const sinyal = secenek && secenek.sinyal;
    const iptalHatasi = () => (sinyal && sinyal.reason) || new Error("iptal edildi");
    if (sinyal && sinyal.aborted) throw iptalHatasi();
    if (!tts) await baglan();
    if (sinyal && sinyal.aborted) throw iptalHatasi();      // baglanirken zaman asimi: istek hic yollanmasin
    const t = tts;
    // toStream bu surumde senkron; ileride Promise donerse de calisir.
    const r = await t.toStream(xmlKacis(metin), { rate: ayar.hiz });
    const audioStream = r && r.audioStream, metadataStream = r && r.metadataStream;
    if (!audioStream) throw new Error("Edge ses akışı açılamadı");
    const istekNo = r.requestId;

    return new Promise((coz, red) => {
      const parcalar = [], kelimeler = [];
      let bitti = false;
      const iptal = () => {
        sokettiKes(t, istekNo);                  // ONCE soketi kes, sonra akislari yok et (gec kare cokertmesin)
        try { audioStream.destroy(); } catch (e) { /* yoksay */ }
        try { if (metadataStream) metadataStream.destroy(); } catch (e) { /* yoksay */ }
        bitir((sinyal && sinyal.reason) || new Error("iptal edildi"));
      };
      function bitir(hata, deger) {
        if (bitti) return;
        bitti = true;
        if (sinyal) sinyal.removeEventListener("abort", iptal);
        if (hata) red(hata); else coz(deger);
      }
      if (sinyal) {
        if (sinyal.aborted) return iptal();
        sinyal.addEventListener("abort", iptal, { once: true });
      }

      if (metadataStream) metadataStream.on("data", d => {
        try {
          // msedge-tts metadatayi Buffer olarak yolluyor (string degil). Buffer cozulmeden
          // JSON.parse atlanirsa kelime zamanlari HIC yakalanmaz (daha once bir kez sessizce oldu).
          const obj = Buffer.isBuffer(d) ? JSON.parse(d.toString("utf8"))
                    : typeof d === "string" ? JSON.parse(d) : d;
          const liste = obj.Metadata || (Array.isArray(obj) ? obj : [obj]);
          for (const m of liste) {
            if (m && m.Type === "WordBoundary" && m.Data) {
              kelimeler.push({
                t: Math.round(m.Data.Offset / 10000),                 // 100ns -> ms
                d: Math.round((m.Data.Duration || 0) / 10000),
                w: (m.Data.text && m.Data.text.Text) || "",
              });
            }
          }
        } catch (e) { /* tek metadata paketi bozuksa yoksay; sayi kontrolu eksigi yakalar */ }
      });
      if (metadataStream) metadataStream.on("error", () => { /* ses akisi hatasi esastir */ });

      audioStream.on("data", c => parcalar.push(c));
      // 'end' normal bitis. Bir tick bekle: son metadata paketleri sesten sonra gelebilir.
      audioStream.on("end", () => setImmediate(() => bitir(null, { buf: Buffer.concat(parcalar), kelimeler })));
      audioStream.on("error", e => bitir(e));
      // 'end' gelmeden kapanirsa (turn.end yok) ses kesiktir.
      audioStream.on("close", () => setImmediate(() =>
        bitir(new Error("Edge bağlantısı ses bitmeden kapandı (ses kesik olabilir)"))));
    });
  }

  return {
    ad: "edge",
    kelimeZamani: true,
    ses: ayar.ses,
    sentez,
    sifirla: async () => { kapat(); },     // bir sonraki sentez YENI baglanti + setMetadata acar
    kapat,
  };
}

module.exports = { olustur };
