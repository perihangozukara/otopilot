// lib/senaryo-kullanim.js — ucretli cagrilarin MALIYET kaydi ve ust sinir denetimi.
//
// uretim/<is>/kullanim.json:
//   {surum:1, kayitlar:[{zaman,betik,saglayici:"anthropic|vidiq",model,giris,cikis,kredi,usd,not}],
//    toplamUSD, toplamKredi}
// Kayit eklemek atomik ve KILITLIDIR (iki betik ayni anda yazsa kayit kaybolmaz).
//
// Model: ANTHROPIC_MODEL (.env/process.env) > panel-ayar claudeModel > "claude-opus-5".
// Fiyat: panel-ayar fiyat[model] > yerlesik tablo > 5/25 (hep "tahmin": fatura degil, tahmindir).
// Ust sinir: konu.maliyetUstSinirUSD > panel-ayar maliyet.isBasinaUSD > MALIYET_UST_SINIR_USD env;
//            asilirsa BASLAMADAN OrtakHata('maliyet_siniri', cikis 7).
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./ortak");

const { OrtakHata, CIKIS } = ortak;

const VARSAYILAN_MODEL = "claude-opus-5";
// USD / milyon token (giris, cikis). Resmi liste fiyatlari (2026-09 tarihli onbellek); sapabilir.
const YERLESIK_FIYAT = {
  "claude-opus-5-5": { giris: 4, cikis: 20 },
  "claude-opus-5": { giris: 5, cikis: 25 },
  "claude-opus-4-8": { giris: 5, cikis: 25 },
  "claude-opus-4-7": { giris: 5, cikis: 25 },
  "claude-opus-4-6": { giris: 5, cikis: 25 },
  "claude-sonnet-5-5": { giris: 2, cikis: 10 },
  "claude-sonnet-5": { giris: 2, cikis: 10 },
  "claude-sonnet-4-6": { giris: 3, cikis: 15 },
  "claude-haiku-4-5": { giris: 1, cikis: 5 },
};

function ayarGuvenli() {
  try { return ortak.ayarOku(); } catch (e) { return ortak.AYAR_VARSAYILAN; }
}

function modelSec(zorla) {
  if (zorla) return String(zorla);
  const env = ortak.envOku("ANTHROPIC_MODEL");
  if (env) return env;
  const ayar = ayarGuvenli();
  return (ayar && ayar.claudeModel) || VARSAYILAN_MODEL;
}

function fiyatBul(model) {
  const ayar = ayarGuvenli();
  const f = ayar && ayar.fiyat && ayar.fiyat[model];
  if (f && f.giris >= 0 && f.cikis >= 0) return { giris: f.giris, cikis: f.cikis, kaynak: "panel-ayar" };
  if (YERLESIK_FIYAT[model]) return Object.assign({ kaynak: "yerlesik tablo (tahmin)" }, YERLESIK_FIYAT[model]);
  return { giris: 5, cikis: 25, kaynak: "tahmin" };
}

// ek: {yazma, okuma} = istem onbellegi tokenleri (yazma 1.25x, okuma 0.1x giris fiyati)
function usdHesapla(model, girisTok, cikisTok, ek) {
  const f = fiyatBul(model);
  const e = ek || {};
  return ((girisTok || 0) / 1e6 * f.giris) + ((e.yazma || 0) / 1e6 * f.giris * 1.25) +
    ((e.okuma || 0) / 1e6 * f.giris * 0.1) + ((cikisTok || 0) / 1e6 * f.cikis);
}

// ---------------------------------------------------------------- kullanim.json
const dosyaYolu = is => path.join(ortak.isDizin(is), "kullanim.json");

// Basit dosya kilidi: wx ile olusturur; 10 sn'den eski kilit bayat sayilir.
function kilitliCalistir(dosya, fn) {
  const kilit = dosya + ".kilit";
  let aldi = false;
  for (let i = 0; i < 100 && !aldi; i++) {
    try { fs.closeSync(fs.openSync(kilit, "wx")); aldi = true; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      try { if (Date.now() - fs.statSync(kilit).mtimeMs > 10000) fs.unlinkSync(kilit); } catch (e2) { /* baska surec sildi */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
  try { return fn(); }
  finally { if (aldi) { try { fs.unlinkSync(kilit); } catch (e) { /* zaten yok */ } } }
}

function kullanimOku(is) {
  let j;
  try { j = ortak.jsonOku(dosyaYolu(is), null); } catch (e) { j = null; }       // bozuksa sifirdan baslar
  if (!j || !Array.isArray(j.kayitlar)) return { surum: 1, kayitlar: [], toplamUSD: 0, toplamKredi: 0 };
  return j;
}

function toplamlariHesapla(j) {
  j.toplamUSD = Math.round(j.kayitlar.reduce((a, k) => a + (Number(k.usd) || 0), 0) * 1e6) / 1e6;
  j.toplamKredi = Math.round(j.kayitlar.reduce((a, k) => a + (Number(k.kredi) || 0), 0) * 100) / 100;
  return j;
}

// kayit: {betik, saglayici, model, giris, cikis, kredi, usd, not}. usd verilmezse tokenlerden hesaplanir.
function kullanimEkle(is, kayit) {
  const k = Object.assign({ zaman: new Date().toISOString(), betik: "", saglayici: "anthropic", model: "",
    giris: 0, cikis: 0, kredi: 0, usd: null, not: "" }, kayit || {});
  if (k.usd === null || k.usd === undefined)
    k.usd = k.saglayici === "anthropic" ? Math.round(usdHesapla(k.model, k.giris, k.cikis) * 1e6) / 1e6 : 0;
  const dosya = dosyaYolu(is);
  return kilitliCalistir(dosya, () => {
    const j = kullanimOku(is);
    j.surum = 1;
    j.kayitlar.push(k);
    toplamlariHesapla(j);
    ortak.atomikJsonYaz(dosya, j);
    return { kayit: k, toplamUSD: j.toplamUSD, toplamKredi: j.toplamKredi };
  });
}

// ---------------------------------------------------------------- ust sinir
function sinirBul(konu) {
  if (konu && typeof konu.maliyetUstSinirUSD === "number") return { deger: konu.maliyetUstSinirUSD, kaynak: "konu.json maliyetUstSinirUSD" };
  const ayar = ayarGuvenli();
  const a = ayar && ayar.maliyet && ayar.maliyet.isBasinaUSD;
  if (typeof a === "number") return { deger: a, kaynak: "panel ayarı (iş başına)" };
  const e = Number(ortak.envOku("MALIYET_UST_SINIR_USD"));
  if (e > 0) return { deger: e, kaynak: "MALIYET_UST_SINIR_USD" };
  return null;
}

// Tum islerin kullanim.json dosyalarindan bugun / bu ay toplami (gunluk-aylik sinir icin).
function genelToplamlar(simdi) {
  const su = simdi || new Date();
  const gun = su.getFullYear() + "-" + su.getMonth() + "-" + su.getDate();
  const ay = su.getFullYear() + "-" + su.getMonth();
  let bugun = 0, buAy = 0;
  let isler = [];
  try { isler = fs.readdirSync(ortak.uretimDizini(), { withFileTypes: true }).filter(d => d.isDirectory()); } catch (e) { return { bugun, buAy }; }
  for (const d of isler) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(ortak.uretimDizini(), d.name, "kullanim.json"), "utf8")); } catch (e) { continue; }
    for (const k of (j && j.kayitlar) || []) {
      const t = new Date(k.zaman);
      if (isNaN(t)) continue;
      const usd = Number(k.usd) || 0;
      if (t.getFullYear() + "-" + t.getMonth() === ay) buAy += usd;
      if (t.getFullYear() + "-" + t.getMonth() + "-" + t.getDate() === gun) bugun += usd;
    }
  }
  return { bugun, buAy };
}

// Baslamadan once cagir. tahminUSD: bu kosunun beklenen harcamasi (0 verilirse yalniz "zaten asildi mi" bakar).
// Asilirsa OrtakHata('maliyet_siniri', cikis 7) firlatir.
function maliyetKontrol(is, konu, tahminUSD) {
  const tahmin = Number(tahminUSD) || 0;
  const m = (x) => "$" + x.toFixed(2);
  const sinir = sinirBul(konu);
  const harcanan = kullanimOku(is).toplamUSD || 0;
  if (sinir && harcanan + tahmin > sinir.deger) {
    throw new OrtakHata("maliyet_siniri",
      "Maliyet sınırı aşılacak: bu iş için " + m(harcanan) + " harcandı, bu adım ~" + m(tahmin) +
      " daha harcar, sınır " + m(sinir.deger) + ".",
      { cikis: CIKIS.MALIYET, cozum: "Sınırı yükselt (" + sinir.kaynak + ") ya da senaryoyu elle yaz.",
        detay: { harcanan, tahmin, sinir: sinir.deger, kaynak: sinir.kaynak } });
  }
  const ayar = ayarGuvenli();
  const gl = ayar && ayar.maliyet && ayar.maliyet.gunlukUSD;
  const ay = ayar && ayar.maliyet && ayar.maliyet.aylikUSD;
  if (typeof gl === "number" || typeof ay === "number") {
    const g = genelToplamlar();
    if (typeof gl === "number" && g.bugun + tahmin > gl)
      throw new OrtakHata("maliyet_siniri", "Günlük maliyet sınırı aşılacak: bugün " + m(g.bugun) + " harcandı, sınır " + m(gl) + ".",
        { cikis: CIKIS.MALIYET, cozum: "Panel ayarlarından günlük sınırı yükselt ya da yarın tekrar dene.", detay: g });
    if (typeof ay === "number" && g.buAy + tahmin > ay)
      throw new OrtakHata("maliyet_siniri", "Aylık maliyet sınırı aşılacak: bu ay " + m(g.buAy) + " harcandı, sınır " + m(ay) + ".",
        { cikis: CIKIS.MALIYET, cozum: "Panel ayarlarından aylık sınırı yükselt.", detay: g });
  }
  return { harcanan, sinir: sinir ? sinir.deger : null };
}

// Ongorulen Claude harcamasi: cikis tokeni ~ kelime x 1.5 (dusunme dahil x2.2), giris ~ istem boyu
function claudeTahminUSD(model, hedefKelime, cagriSayisi, girisTokenCagriBasina) {
  const cikis = Math.round(hedefKelime * 1.5 * 2.2);
  const giris = (cagriSayisi || 1) * (girisTokenCagriBasina || 2500);
  return usdHesapla(model, giris, cikis);
}

// ---------------------------------------------------------------- vidIQ kredisi
// vidiq_balance ucretsizdir: {totalCredits,...}. Okunamazsa null (kredi tahmini kaydedilir).
async function vidiqBakiye(vidiq) {
  try {
    const b = await vidiq.cagir("vidiq_balance", {});
    return b && typeof b.totalCredits === "number" ? b.totalCredits : null;
  } catch (e) { return null; }
}

// Is bitince: bakiye farki (okunabildiyse) yoksa tahmini kredi. is verilirse kullanim.json'a da yazar.
async function vidiqKullanimKaydet(is, vidiq, onceki, betik, tahminKredi, not) {
  const sonra = await vidiqBakiye(vidiq);
  let kredi = tahminKredi || 0;
  if (onceki !== null && onceki !== undefined && sonra !== null && onceki >= sonra) kredi = onceki - sonra;
  if (is) {
    try { kullanimEkle(is, { betik, saglayici: "vidiq", model: "vidiq", giris: 0, cikis: 0, kredi, usd: 0, not: not || "" }); }
    catch (e) { /* kayit yazilamadiysa is yine de tamam */ }
  }
  return { kredi, kalan: sonra };
}

module.exports = { VARSAYILAN_MODEL, YERLESIK_FIYAT, modelSec, fiyatBul, usdHesapla, kullanimOku, kullanimEkle,
  vidiqBakiye, vidiqKullanimKaydet,
  kilitliCalistir, sinirBul, genelToplamlar, maliyetKontrol, claudeTahminUSD, dosyaYolu };
