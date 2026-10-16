// VIRAL VIDEO ANALIZI — bu hafta patlayan videolari bulur ve hangi KALIPLARIN ortak oldugunu cikarir.
//
// Kullanim:
//   node viral-analiz.js                       # bu hafta, 10M+, genel, Shorts
//   node viral-analiz.js "animal comparison"   # konuya gore
//   node viral-analiz.js "" tr                 # Turkce basliklar (vidIQ: yalniz UZUN video)
//   node viral-analiz.js "" en 5000000         # esik degistir
//
// Cikti: viral-analiz/<tarih>-<konu>.md + .json  ({surum:1,tur:"viral",tarih,konu,dil,platform,satirlar:[...]})
//
// Rapordaki her hukum VERIYE baglidir (bos liste, tek ornek, dusuk etkilesim durumlarinda yazilmaz).
// Bu arac ANALIZ icindir: baskasinin videosunu izinsiz indirip yeniden yuklemek telif ihlalidir;
// amac kalibi gormek ve o kalipla KENDI videonu yapmaktir.
//
// Cikis kodlari: 0 tamam (bos sonuc dahil) | 2 vidIQ anahtari yok | 3 vidIQ hatasi (anahtar, kredi, ag)
"use strict";
const ortak = require("./lib/ortak");
const R = require("./lib/senaryo-rapor");
const K = require("./lib/senaryo-kullanim");
const { VidiqIstemci } = require("./lib/vidiq");

const { OrtakHata, CIKIS } = ortak;
const BETIK = "viral-analiz.js";
// vidIQ outliers araci bu dilleri destekler; digerinde Ingilizceye dusulur (uyari ile)
const DESTEKLI_DIL = new Set(["en", "es", "ko", "de", "hi", "ar", "th", "pl", "it", "ja", "fr", "tr", "ru", "pt", "uk"]);

// Basligin ANLAMLI kelimeleri (3 harften uzun, etiket kelimeleri hariç, ilk 6, tekil). Bos dizi = anlamli kelime yok.
function baslikKelimeleri(v) {
  const kel = (v.videoTitle || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
    .filter(w => w.length > 3 && !/^(shorts?|viral|trending|video|youtube)$/.test(w));
  return [...new Set(kel)].slice(0, 6);
}

// Ayni konsepti kullanan videolar: baslik kelimelerinin buyuk kismi ortak VE en az 2 anlamli kelime ortak.
// Anlamli kelimesi olmayan baslik ("Why do we go", "Is it me?") HICBIR kumeye girmez, kendi basina kalir:
// bos anahtar, hepsini sahte bir "benzer yapi" kumesine toplardi. Tek ortak kelime de benzerlik kaniti sayilmaz.
// NOT: yalniz BASLIK benzerligine bakar; ses/muzik/gorsel olculmez.
function kumeleV(videolar) {
  const kumeler = [];                 // {kelimeler:Set, uyeler:[video]}
  for (const v of videolar) {
    const w = baslikKelimeleri(v);
    let hedef = null;
    if (w.length >= 2) {
      for (const k of kumeler) {
        if (!k.kelimeler.size) continue;
        const ortakSay = w.filter(x => k.kelimeler.has(x)).length;
        if (ortakSay >= 2 && ortakSay / w.length >= 0.5) { hedef = k; break; }
      }
    }
    if (hedef) hedef.uyeler.push(v);
    else kumeler.push({ kelimeler: new Set(w.length >= 2 ? w : []), uyeler: [v] });
  }
  return kumeler.map(k => k.uyeler).sort((a, b) => b.length - a.length);
}

// Kumedeki basliklarin en az yarisinda gecen kelimeler (rapora VERIYE dayali olarak yazilir)
function ortakKelimeler(kume) {
  const sayac = new Map();
  for (const v of kume) for (const w of baslikKelimeleri(v)) sayac.set(w, (sayac.get(w) || 0) + 1);
  return [...sayac].filter(([, n]) => n >= Math.ceil(kume.length / 2)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
}

const enAz = a => (a.length ? Math.min(...a) : null);
const enCok = a => (a.length ? Math.max(...a) : null);
// vidIQ bazen alan gondermez: rapora "undefined" / "undefinedsn" / uydurma "0" yazmak yerine "-" konur
const varMi = n => typeof n === "number" && isFinite(n);
const sayiMetin = n => (varMi(n) ? R.bicim(n) : "-");
const sureMetin = n => (varMi(n) ? n + "sn" : "-");
const metinAlan = s => String(s == null || s === "" ? "-" : s).replace(/\|/g, "/").replace(/\s+/g, " ");

// Rapor govdesi (saf fonksiyon: test edilebilir). format: "short" | "long"
function raporKur(videolar, ayar) {
  const { konu, dil, esik, format } = ayar;
  const sureler = videolar.map(v => v.videoDuration).filter(n => typeof n === "number" && n > 0);
  const aboneler = videolar.map(v => v.subscriberCount).filter(n => typeof n === "number" && n > 0);
  const etkilesim = videolar.map(v => v.engagementRate).filter(n => typeof n === "number" && isFinite(n));
  const kumeler = kumeleV(videolar);
  const enBuyukKume = kumeler[0] || [];
  const satir = [];
  const y = s => satir.push(s);
  const tur = format === "short" ? "Shorts" : "Uzun video";

  y("# Viral " + tur + " Analizi");
  y("");
  y("Eşik: **" + R.bicim(esik) + "+ izlenme** · Dönem: bu hafta · Dil: " + dil + (konu ? " · Konu: " + konu : ""));
  y("Bulunan: " + videolar.length + " video");
  y("");
  y("> Bu rapor ANALİZ içindir. Başkasının videosunu izinsiz indirip yeniden yüklemek telif ihlalidir.");
  y("> Amaç kalıbı görmek, o kalıpla kendi videonu yapmaktır.");
  y("");
  y("## Çıkan kalıplar");
  y("");
  if (sureler.length) {
    y("**Süre.** Ortanca " + R.ortanca(sureler) + " saniye. En kısa " + enAz(sureler) + ", en uzun " + enCok(sureler) + ".");
    const kisa = sureler.filter(s => s <= 15).length;
    if (kisa > 0) {
      y(kisa + "/" + sureler.length + " video 15 saniye ve altında." + (kisa / sureler.length > 0.5 ? " Kısa olan öne çıkıyor." : ""));
    }
    y("");
  }
  if (aboneler.length) {
    const kucuk = videolar.filter(v => v.subscriberCount > 0 && v.subscriberCount < 50000);
    y("**Abone sayısı.** En küçük kanal " + R.bicim(enAz(aboneler)) + " aboneyle listede.");
    if (kucuk.length) {
      const oran = Math.round(kucuk.length / videolar.length * 100);
      y(kucuk.length + " video (%" + oran + ") 50 binden az aboneli kanallardan" +
        (oran >= 30 ? "; abone sayısı tek başına belirleyici görünmüyor." : "; çoğu video büyük kanallardan."));
      const en = kucuk.slice().sort((a, b) => b.viewCount - a.viewCount)[0];
      y("- En çarpıcısı: " + sayiMetin(en.subscriberCount) + " abone → **" + sayiMetin(en.viewCount) + " izlenme** (" + metinAlan(en.channelTitle) + ")");
    } else {
      y("50 binden az aboneli kanal bu listede yok; bu eşikte çoğu video yerleşik kanallardan geliyor.");
    }
    y("");
  } else {
    y("**Abone sayısı.** Bu sonuçlarda abone bilgisi yok; kanal büyüklüğü hakkında bir şey söylenemiyor.");
    y("");
  }
  if (etkilesim.length) {
    const ortE = etkilesim.reduce((a, b) => a + b, 0) / etkilesim.length * 100;
    y("**Etkileşim oranı ortalaması %" + ortE.toFixed(2) + ".** " +
      (ortE < 1 ? "Düşük: bu videolar izlenme alıyor ama beğeni/yorum az. Bu tür izlenme aboneye ve gelire iyi dönüşmeyebilir."
        : "Sağlıklı görünüyor."));
    y("");
  }
  const ortakKel = enBuyukKume.length > 2 ? ortakKelimeler(enBuyukKume) : [];
  if (ortakKel.length) {
    y("**Benzer başlık yapısı " + enBuyukKume.length + " videoda görülüyor.**");
    y("");
    y("Bu videoların başlıklarında ortak geçen kelimeler: " + ortakKel.join(", ") +
      " (yalnızca başlık kelimelerine bakıldı; ses, müzik veya görsel ölçülmedi).");
    y("Bir konunun ya da formatın bu hafta çok tekrarlandığını gösteriyor olabilir; trend penceresi kısa sürebilir.");
    y("");
    for (const v of enBuyukKume.slice(0, 6))
      y("- " + sayiMetin(v.viewCount).padStart(6) + " — " + metinAlan(v.channelTitle) + " (" + sayiMetin(v.subscriberCount) + " abone, " +
        (varMi(v.videoDuration) ? v.videoDuration + " sn" : "-") + ")");
    y("");
  }
  const kategori = {};
  for (const v of videolar) { const k = v.mainCategory || "?"; kategori[k] = (kategori[k] || 0) + 1; }
  y("**Kategoriler:** " + Object.entries(kategori).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + " (" + n + ")").join(" · "));
  y("");
  y("## Videolar");
  y("");
  y("| izlenme | süre | abone | kanal | başlık |");
  y("|---|---|---|---|---|");
  for (const v of videolar) {
    const b = (v.videoTitle || "").replace(/\|/g, "/").slice(0, 60);
    const baslik = v.videoId ? "[" + (b || "-") + "](https://youtube.com/" + (format === "short" ? "shorts/" : "watch?v=") + v.videoId + ")" : (b || "-");
    y("| " + sayiMetin(v.viewCount) + " | " + sureMetin(v.videoDuration) + " | " + sayiMetin(v.subscriberCount) + " | " + metinAlan(v.channelTitle) + " | " + baslik + " |");
  }
  y("");
  y("Başlıklara tıklayıp izle; ilk 2 saniyede ne yaptığına bak. Kalıp orada.");
  return { md: satir.join("\n"), satirlar: videolar.map(v => R.youtubeSatiri(v, format)),
    ozetBas: satir.indexOf("## Çıkan kalıplar"), ozetSon: satir.indexOf("## Videolar"), satirDizisi: satir };
}

async function ana(argv, secenek) {
  secenek = secenek || {};
  const { konum } = ortak.argumanCoz(argv, {});
  const konu = konum[0] || "";
  let dil = konum[1] || "en";
  const esik = Number(konum[2] || 10000000);
  if (!(esik >= 0)) throw new OrtakHata("arguman", "Eşik sayı olmalı: node viral-analiz.js \"konu\" en 5000000", { cikis: CIKIS.GIRDI });

  const anahtar = ortak.envOku("VIDIQ_KEY");
  if (!anahtar && !secenek.vidiq)
    throw new OrtakHata("vidiq_anahtar", "VIDIQ_KEY yok; viral analiz yapılamadı.", { cikis: CIKIS.GIRDI,
      cozum: "Panel > Kaynaklar sekmesine vidIQ anahtarını yapıştır (app.vidiq.com/account/settings/mcp)." });

  if (!DESTEKLI_DIL.has(dil)) { ortak.uyari("vidIQ '" + dil + "' dilini desteklemiyor; İngilizce aranıyor."); dil = "en"; }
  // vidIQ: Ingilizce disindaki dillerde yalniz UZUN video aranabilir (Shorts reddedilir)
  const format = dil === "en" ? "short" : "long";
  if (format === "long") ortak.uyari("vidIQ Ingilizce dışındaki dillerde yalnızca uzun video arayabiliyor; Shorts yerine uzun videolar analiz edilecek.");

  const vidiq = secenek.vidiq || new VidiqIstemci(anahtar, secenek.vidiqSecenek);
  const onceki = await K.vidiqBakiye(vidiq);
  console.log("viral " + (format === "short" ? "Shorts" : "uzun video") + " aranıyor — " + R.bicim(esik) + "+ izlenme, bu hafta" +
    (konu ? ", konu: \"" + konu + "\"" : "") + ", dil: " + dil);

  const arg = { contentType: format, language: dil, publishedWithin: "thisWeek", minViews: Math.round(esik), limit: 25, sort: "viewCount" };
  if (konu) arg.keyword = konu;
  const d = await vidiq.cagir("vidiq_outliers", arg);
  const videolar = (d && Array.isArray(d.videos)) ? d.videos : [];

  if (!videolar.length) {
    console.log("Bu eşikte sonuç yok. Eşiği düşür:  node viral-analiz.js \"\" " + dil + " 1000000");
    ortak.sonuc({ bos: true, satir: 0 });
    return { bos: true };
  }

  const r = raporKur(videolar, { konu, dil, esik, format });
  const dosyalar = R.raporYaz("viral-analiz", konu, r.md, {
    surum: 1, tur: "viral", tarih: new Date().toISOString(), konu, dil, platform: format === "short" ? "youtube-short" : "youtube-long",
    satirlar: r.satirlar,
  });
  const kr = await K.vidiqKullanimKaydet(null, vidiq, onceki, BETIK, 5, "");
  console.log("");
  console.log(r.satirDizisi.slice(r.ozetBas, r.ozetSon).join("\n"));
  console.log("vidIQ kredisi: ~" + kr.kredi + (kr.kalan !== null ? " (kalan " + kr.kalan + ")" : ""));
  console.log("✓ rapor: " + dosyalar.md);
  ortak.sonuc({ satir: videolar.length, rapor: dosyalar.md, json: dosyalar.json, kredi: kr.kredi });
  return { rapor: dosyalar };
}

module.exports = { ana, kumeleV, ortakKelimeler, raporKur };

if (require.main === module) ana(process.argv.slice(2)).catch(ortak.bitir);
