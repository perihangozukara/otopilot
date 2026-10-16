// altyazi-cevir.js <is> [--yeniden]
// Senaryo (konusma dili = konu.dil) ile ALTYAZI dili (konu.altyaziDili) farkliysa, senaryoyu Claude ile
// PARAGRAF PARAGRAF ceviri olarak Voice/ALTYAZI-<XX>.txt dosyasina yazar (XX = altyazi dili, buyuk harf;
// Turkce icin eski ad ALTYAZI-TR.txt). Paragraf SAYISI senaryoyla birebir ayni kalir (video-yap altyaziyi
// paragraf numarasiyla eslestirir; sayi kayarsa sessiz kayma olur, bu yuzden uyusmazlik hata sayilir).
//
// - Diller ayniysa: islem yok (@@SONUC {"atlandi":true}).
// - ALTYAZI-XX.txt zaten var ve senaryodan YENI ise (kullanici elle duzeltmis olabilir) dokunulmaz.
//   Senaryo sonradan degistiyse eski dosya Voice/yedek/ klasorune alinip yenisi yazilir.
// - Her cagri kullanim.json'a yazilir; konu.maliyetUstSinirUSD asilirsa baslamadan cikis 7.
//
// Cikis kodlari: 0 tamam/atlandi | 2 girdi (senaryo yok, anahtar yok) | 3 Claude hatasi | 4 paragraf sayisi tutmadi
//                6 kilit | 7 maliyet siniri
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./lib/ortak");
const S = require("./lib/senaryo-ortak");
const K = require("./lib/senaryo-kullanim");
const C = require("./lib/senaryo-claude-istemci");

const { OrtakHata, CIKIS } = ortak;
const BETIK = "altyazi-cevir.js";
const PARTI_KELIME = 900;          // bir istekte cevrilecek en cok kelime

function partilere(paragraflar) {
  const partiler = [];
  let simdiki = [], n = 0;
  paragraflar.forEach((p, i) => {
    const k = S.kelimeSay(p);
    if (simdiki.length && n + k > PARTI_KELIME) { partiler.push(simdiki); simdiki = []; n = 0; }
    simdiki.push({ i, metin: p }); n += k;
  });
  if (simdiki.length) partiler.push(simdiki);
  return partiler;
}

const CEVIRI_SISTEM = (kaynak, hedef) => [
  "You translate narration subtitles from " + kaynak + " into " + hedef + ".",
  "- Translate paragraph by paragraph. NEVER merge, split, add or drop paragraphs: the output must contain exactly as many paragraphs as the input.",
  "- Natural, spoken-style " + hedef + " that reads well as on-screen subtitles. Keep meaning, tone and facts; do not add or explain anything.",
  "- Keep proper names, numbers and units exact. Write the way a native " + hedef + " speaker would.",
  "- Return ONLY a JSON array of strings, one string per input paragraph, in the same order. No markdown fence, no commentary.",
].join("\n");

function ceviriIstegi(parti) {
  return "Translate these " + parti.length + " paragraphs. Return a JSON array with exactly " + parti.length + " strings.\n\n" +
    JSON.stringify(parti.map(x => x.metin), null, 1);
}

// Model cevabini string dizisine cevirir; sayi tutmazsa null
function ceviriCoz(metin, beklenen) {
  let ham = String(metin || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const ilk = ham.indexOf("["), son = ham.lastIndexOf("]");
  if (ilk < 0 || son <= ilk) return null;
  let j;
  try { j = JSON.parse(ham.slice(ilk, son + 1)); } catch (e) { return null; }
  if (!Array.isArray(j) || j.length !== beklenen) return null;
  const temiz = j.map(x => String(x == null ? "" : x).replace(/\s*\n\s*/g, " ").trim());
  if (temiz.some(x => !x)) return null;
  return temiz;
}

async function ana(argv, secenek) {
  secenek = secenek || {};
  const { konum, bayrak } = ortak.argumanCoz(argv, {});
  const is = konum[0];
  if (!is) throw new OrtakHata("arguman", "Kullanım: node altyazi-cevir.js <is-adi>", { cikis: CIKIS.GIRDI });
  const dizin = ortak.isDizin(is);
  if (!fs.existsSync(dizin)) throw new OrtakHata("is_yok", "İş bulunamadı: " + is, { cikis: CIKIS.GIRDI });
  ortak.kilitAl(is, BETIK);
  try { return await cevir(is, dizin, !!bayrak.yeniden, secenek); } finally { ortak.kilitBirak(is); }
}

async function cevir(is, dizin, yeniden, secenek) {
  const konu = ortak.konuEtkin(is);
  if (!konu) throw new OrtakHata("konu_yok", "konu.json yok: " + is, { cikis: CIKIS.GIRDI });
  const dil = konu.dil, hedefDil = konu.altyaziDili;
  if (hedefDil === dil) {
    console.log("Altyazı dili konuşma diliyle aynı (" + dil + "); çeviri gerekmiyor.");
    ortak.sonuc({ atlandi: true, neden: "altyazı dili = konuşma dili" });
    return { atlandi: true };
  }
  const kaynakDosya = path.join(dizin, "Voice", "SESLENDIRME-TAM-METIN.txt");
  let kaynak = "";
  try { kaynak = fs.readFileSync(kaynakDosya, "utf8"); } catch (e) { /* asagida bos hata */ }
  const paragraflar = ortak.paragraflaraBol(kaynak);
  if (!paragraflar.length) throw new OrtakHata("senaryo_yok", "Çevrilecek senaryo yok (Voice/SESLENDIRME-TAM-METIN.txt boş).",
    { cikis: CIKIS.GIRDI, cozum: "Önce senaryoyu yaz." });

  const hedefDosya = path.join(dizin, "Voice", "ALTYAZI-" + hedefDil.toUpperCase() + ".txt");
  if (!yeniden && fs.existsSync(hedefDosya)) {
    const mevcut = ortak.paragraflaraBol(fs.readFileSync(hedefDosya, "utf8"));
    const yeniMi = fs.statSync(hedefDosya).mtimeMs >= fs.statSync(kaynakDosya).mtimeMs;
    if (mevcut.length === paragraflar.length && yeniMi) {
      console.log("Altyazı çevirisi güncel (" + path.basename(hedefDosya) + "); dokunulmadı. Zorlamak için --yeniden.");
      ortak.sonuc({ atlandi: true, neden: "altyazı çevirisi güncel", dosya: path.basename(hedefDosya) });
      return { atlandi: true };
    }
  }

  const anahtar = C.claudeAnahtari();
  if (!anahtar && !secenek.istemci)
    throw new OrtakHata("anahtar_yok", "ANTHROPIC_API_KEY yok; altyazı çevirisi yapılamadı.", { cikis: CIKIS.GIRDI,
      cozum: "Panel > Kaynaklar sekmesine Claude anahtarını yapıştır ya da ALTYAZI-" + hedefDil.toUpperCase() + ".txt dosyasını elle yaz." });
  const model = K.modelSec();
  const kelime = S.kelimeSay(kaynak);
  K.maliyetKontrol(is, konu, K.usdHesapla(model, kelime * 2 + 1500, kelime * 2));
  const kaynakAd = S.dilAdi(dil), hedefAd = S.dilAdi(hedefDil);
  console.log("çeviri  : " + kaynakAd + " → " + hedefAd + " · " + paragraflar.length + " paragraf · model " + model);

  const sonuc = new Array(paragraflar.length);
  let usd = 0;
  const cevirParti = async (parti, derinlik) => {
    const c = await C.claudeIste({ is, betik: BETIK, istemci: secenek.istemci, anahtar, model, sistem: CEVIRI_SISTEM(kaynakAd, hedefAd),
      istek: ceviriIstegi(parti), effort: "low", maksToken: Math.max(4000, parti.reduce((a, x) => a + S.kelimeSay(x.metin), 0) * 6),
      not: "altyazı çevirisi", zamanAsimiMs: secenek.zamanAsimiMs });
    usd += c.usd;
    const cev = ceviriCoz(c.metin, parti.length);
    if (cev) { parti.forEach((x, k) => { sonuc[x.i] = cev[k]; }); return; }
    // sayi tutmadi: partiyi ikiye bol, tek paragrafa kadar in
    if (parti.length > 1 && derinlik < 4) {
      ortak.uyari("Çeviride paragraf sayısı tutmadı; parti ikiye bölünüp yeniden deneniyor.");
      const m = Math.ceil(parti.length / 2);
      await cevirParti(parti.slice(0, m), derinlik + 1);
      await cevirParti(parti.slice(m), derinlik + 1);
      return;
    }
    throw new OrtakHata("ceviri_sayi", "Çeviri paragraf sayısını korumadı (paragraf " + (parti[0].i + 1) + ").",
      { cikis: CIKIS.YETERSIZ, cozum: "Tekrar dene; sürerse altyazıyı elle yaz." });
  };

  const partiler = partilere(paragraflar);
  for (let k = 0; k < partiler.length; k++) {
    ortak.ilerleme("ceviri", k / partiler.length * 100, { parti: k + 1, toplam: partiler.length });
    await cevirParti(partiler[k], 0);
  }
  if (sonuc.some(x => !x) || sonuc.length !== paragraflar.length)
    throw new OrtakHata("ceviri_sayi", "Çeviri tamamlanamadı: paragraf sayısı tutmuyor.", { cikis: CIKIS.YETERSIZ });

  // eski (senaryodan eski) dosya silinmez: yedeklenir
  if (fs.existsSync(hedefDosya) && fs.readFileSync(hedefDosya, "utf8").trim().length > 50) {
    const yedekDizin = path.join(dizin, "Voice", "yedek");
    fs.mkdirSync(yedekDizin, { recursive: true });
    ortak.atomikYaz(path.join(yedekDizin, "ALTYAZI-" + hedefDil.toUpperCase() + "-" + ortak.damga() + ".txt"), fs.readFileSync(hedefDosya, "utf8"));
  }
  ortak.atomikYaz(hedefDosya, sonuc.join("\n\n") + "\n");
  console.log("✓ altyazı çevirisi yazıldı: Voice/" + path.basename(hedefDosya));
  console.log("  " + sonuc.length + " paragraf · maliyet ~$" + usd.toFixed(3));
  const r = { dosya: path.basename(hedefDosya), paragraf: sonuc.length, dil: hedefDil, usd: Math.round(usd * 1000) / 1000 };
  ortak.sonuc(r);
  return r;
}

module.exports = { ana, partilere, ceviriCoz, ceviriIstegi };

if (require.main === module) ana(process.argv.slice(2)).catch(ortak.bitir);
