// PANEL -> BETIK CAGRI TABLOSU (SOZLESME 7.4) ve "hepsi" zincirinin adim listesi. Saf fonksiyonlar: test edilebilir.
"use strict";
const path = require("path");
const ortak = require("./ortak");
const { HttpHata } = require("./panel-http");

// ucretli: dis servis kredisi harcar. agir: video/ses isleme (global tek slot).
const ADIM_ETIKET = {
  "baslik-on": "Başlık puanlama", senaryo: "Senaryo yazımı", ceviri: "Altyazı çevirisi", baslik: "Başlık ve etiket analizi",
  gorsel: "Görsel bulma", kartlar: "Formül/prompt kartları", ses: "Seslendirme", video: "Video kurulumu",
};
const AGIRLIK = { "baslik-on": 2, senaryo: 10, ceviri: 3, baslik: 2, gorsel: 18, kartlar: 2, ses: 13, video: 50 };

const sorun = (kod, mesaj, cozum) => ({ kod, seviye: "hata", mesaj, cozum });
// Istek govdesinden gelen deger: yalniz metin/sayi/mantik metne, yalniz metin/sayi sayiya cevrilir. Nesne/dizi icin "" / NaN:
// {"toString":"x"} gibi bir nesne String()/Number()'i TypeError ile patlatip 500 uretmesin (guvenlik saldiri turu, 2026-10-06).
const metin = v => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const sayi = v => (typeof v === "number" || typeof v === "string" ? Number(v) : NaN);
// Betige konum argumani olarak giden metin '-' ile baslamasin: betigin bayrak ayristiricisi onu secenek sanar (arguman enjeksiyonu).
function bayraksiz(alan, deger) {
  if (String(deger).startsWith("-")) throw new HttpHata(400, alan, alan + " '-' ile başlayamaz.");
}
const KONU_MESAJ = "vidIQ anahtarı gerekir (Kaynaklar sekmesinden gir).";

function bayrakli(argv, ...ekler) { return argv.concat(ekler.filter(Boolean)); }

// Tek betik/komut dizisi icin adim kur.
function adim(ad, etiket, komutlar, ek) {
  return Object.assign({ ad, etiket: etiket || ADIM_ETIKET[ad] || ad, komutlar, agir: false, istegeBagli: false, ucretli: false }, ek || {});
}

// Senaryo motoru secimi. {betik, etiket, yedek:{betik,etiket}|null} ya da null (hicbiri kullanilamaz)
// dil: videonun dili. vidIQ script araci DIL PARAMETRESI ALMAZ (Ingilizce'ye egilimli), bu yuzden Ingilizce disi bir
// videoda Claude hata verince vidIQ'ya OTOMATIK dusulmez: Turkce is, onay duragi kapaliyken bile yabanci dilde metinle
// zincire devam etmesin. (vidIQ'yu acikca secen ya da yalniz vidIQ anahtari olan kullanici yine vidIQ'yu kullanir;
// senaryo-yaz.js dil tutmazsa metni -dil-uyumsuz olarak saklayip cikis 4 verir.)
function senaryoMotoru(ayar, anahtarVar, dil) {
  const claude = anahtarVar("ANTHROPIC_API_KEY"), vidiq = anahtarVar("VIDIQ_KEY");
  const C = { betik: "senaryo-claude.js", etiket: "Senaryo yazımı (Claude)" };
  const V = { betik: "senaryo-yaz.js", etiket: "Senaryo yazımı (vidIQ)" };
  const m = (ayar && ayar.senaryoMotoru) || "otomatik";
  if (m === "claude") return claude ? Object.assign({ yedek: null }, C) : null;
  if (m === "vidiq") return vidiq ? Object.assign({ yedek: null }, V) : null;
  if (claude) return Object.assign({ yedek: vidiq && (!dil || dil === "en") ? V : null }, C);
  if (vidiq) return Object.assign({ yedek: null }, V);
  return null;
}

// Isin dili (konu.json > panel-ayar > "en"). Konu okunamazsa "en": senaryo betigi zaten konu hatasini kendisi verir.
function konuDili(is, ctx) {
  try {
    const k = ctx.konuHam && ctx.konuHam(is);
    if (!k) return "en";
    return ortak.konuBirlestir(k, ctx.ayar, is).dil || "en";
  } catch (e) { return "en"; }
}

// Tek bir isin "hepsi" zinciri: gerekli adimlar sirayla (SOZLESME 6.2).
// ctx: { ayar, anahtarVar(ad), senaryoVar(is), konuHam(is) }
function zincirAdimlari(is, b, ctx) {
  const k = ctx.konuHam(is);          // bozuksa OrtakHata('konu_bozuk') firlatir
  if (k === null) throw new HttpHata(404, "konu_yok", "Bu işin konu.json dosyası yok.", { cozum: "Yeni video oluştur ya da iş klasörünü kontrol et." });
  const etkin = ortak.konuBirlestir(k, ctx.ayar, is);
  const yeniden = !!(b && (b.bastan || b.yeniden));
  const adimlar = [];
  const vidiq = ctx.anahtarVar("VIDIQ_KEY");
  if (vidiq) adimlar.push(adim("baslik-on", null, [{ betik: "baslik-analiz.js", argv: [is, "--on"] }], { istegeBagli: true, ucretli: true }));
  const varMi = k => Array.isArray(k) && k.length > 0;

  let senaryoAdimi = null;
  if (!ctx.senaryoVar(is)) {
    const m = senaryoMotoru(ctx.ayar, ctx.anahtarVar, etkin.dil);
    if (!m) throw new HttpHata(400, "anahtar_yok", "Senaryo yazmak için Claude veya vidIQ anahtarı gerekir; ya da senaryoyu kendin yazıp Senaryo kutusuna yapıştır.",
      { cozum: "Kaynaklar sekmesinden bir anahtar gir." });
    senaryoAdimi = adim("senaryo", m.etiket, [{ betik: m.betik, argv: [is] }], { ucretli: true, yedek: m.yedek, onayDurak: "senaryo" });
    adimlar.push(senaryoAdimi);
  }
  if (etkin.altyaziDili && etkin.altyaziDili !== etkin.dil)
    adimlar.push(adim("ceviri", null, [{ betik: "altyazi-cevir.js", argv: [is] }], { ucretli: true }));
  if (vidiq) adimlar.push(adim("baslik", null, [{ betik: "baslik-analiz.js", argv: [is] }], { istegeBagli: true, ucretli: true }));
  adimlar.push(adim("gorsel", null, [{ betik: "gorsel-bul.js", argv: bayrakli([is], yeniden && "--yeniden") }],
    { onayDurak: etkin.onay && etkin.onay.gorsel ? "gorsel" : undefined }));
  const kart = [];
  if (varMi(k.formuller)) kart.push({ betik: "formul-kart.js", argv: [is] });
  if (varMi(k.promptlar)) kart.push({ betik: "prompt-kart.js", argv: [is] });
  if (kart.length) adimlar.push(adim("kartlar", null, kart));
  adimlar.push(adim("ses", null, [{ betik: "seslendir.js", argv: bayrakli([is], yeniden && "--yeniden") }]));
  adimlar.push(adim("video", null, [{ betik: "video-yap.js", argv: bayrakli([is], yeniden && "--yeniden", b && b.temiz && "--temiz", b && b.tut && "--tut") }], { agir: true }));
  return adimlar;
}

// Tek tur -> adim listesi. "hepsi/devam" burada DEGIL (zincirAdimlari).
function tekTur(tur, b, ctx) {
  const is = b.is;
  const gerek = () => { if (!ortak.guvenliAd(is)) throw new HttpHata(400, "gecersiz_is", "Geçersiz iş adı."); };
  const yeniden = !!(b.bastan || b.yeniden);
  switch (tur) {
    case "senaryo": {
      gerek();
      const m = senaryoMotoru(ctx.ayar, ctx.anahtarVar, konuDili(is, ctx));
      if (!m) throw new HttpHata(400, "anahtar_yok", "Senaryo yazmak için Claude veya vidIQ anahtarı gerekir.", { cozum: "Kaynaklar sekmesinden bir anahtar gir." });
      return [adim("senaryo", m.etiket, [{ betik: m.betik, argv: [is] }], { ucretli: true, yedek: m.yedek })];
    }
    case "senaryoV":
      gerek();
      if (!ctx.anahtarVar("VIDIQ_KEY")) throw new HttpHata(400, "anahtar_yok", KONU_MESAJ);
      return [adim("senaryo", "Senaryo yazımı (vidIQ)", [{ betik: "senaryo-yaz.js", argv: [is] }], { ucretli: true })];
    case "baslikOn":
      gerek(); return [adim("baslik-on", null, [{ betik: "baslik-analiz.js", argv: [is, "--on"] }], { ucretli: true })];
    case "baslik":
      gerek(); return [adim("baslik", null, [{ betik: "baslik-analiz.js", argv: [is] }], { ucretli: true })];
    case "ceviri":
      gerek(); return [adim("ceviri", null, [{ betik: "altyazi-cevir.js", argv: [is] }], { ucretli: true })];
    case "gorsel":
      gerek(); return [adim("gorsel", null, [{ betik: "gorsel-bul.js", argv: bayrakli([is], yeniden && "--yeniden") }])];
    case "gorselSahne": {
      gerek();
      const sahne = sayi(b.sahne), ara = metin(b.ara).trim();
      if (!Number.isInteger(sahne) || sahne < 1 || sahne > 9999) throw new HttpHata(400, "sahne", "Sahne numarası geçersiz.");
      if (!ara || ara.length > 200) throw new HttpHata(400, "ara", "Arama ifadesi 1–200 karakter olmalı.");
      bayraksiz("ara", ara);
      return [adim("gorsel", "Sahne " + sahne + " için yeniden ara", [{ betik: "gorsel-bul.js", argv: [is, "--sahne", String(sahne), "--ara", ara] }])];
    }
    case "gorselUret":
      gerek(); return [adim("gorsel", "AI görsel üretimi", [{ betik: "gorsel-uret.js", argv: bayrakli([is], b.hepsi && "--hepsi") }])];
    case "nasa": {
      gerek();
      const adet = sayi(b.adet || 12);
      return [adim("gorsel", "NASA görselleri", [{ betik: "gorsel-cek.js", argv: [is, String(Number.isInteger(adet) && adet > 0 && adet <= 200 ? adet : 12)] }])];
    }
    case "portre":
      gerek(); return [adim("gorsel", "Portre görselleri", [{ betik: "portre-cek.js", argv: [is] }])];
    case "formul":
      gerek(); return [adim("kartlar", "Formül kartları", [{ betik: "formul-kart.js", argv: [is] }])];
    case "prompt":
      gerek(); return [adim("kartlar", "Prompt kartları", [{ betik: "prompt-kart.js", argv: [is] }])];
    case "ses":
      gerek(); return [adim("ses", null, [{ betik: "seslendir.js", argv: bayrakli([is], yeniden && "--yeniden") }])];
    case "video":
      gerek();
      return [adim("video", null, [{ betik: "video-yap.js", argv: bayrakli([is], yeniden && "--yeniden", b.temiz && "--temiz", b.tut && "--tut") }], { agir: true })];
    case "onizleme":
      gerek(); return [adim("video", "Önizleme videosu", [{ betik: "video-yap.js", argv: [is, "--onizleme"] }], { agir: true })];
    case "kapak":
      gerek(); return [adim("kapak", "Kapak resmi", [{ betik: "kapak-yap.js", argv: [is] }])];
    case "yayin":
      gerek(); return [adim("yayin", "Yayın paketi", [{ betik: "yayin-paketi.js", argv: [is] }])];
    case "shortsKes": {
      gerek();
      const kesit = path.join(ctx.uretim, is, "kesitler.json");
      return [adim("shortskes", "Shorts kesitleri", [
        { betik: "kesit-bul.cjs", argv: [is, "--otomatik", kesit, "--adet", String(sayi(b.adet) > 0 ? sayi(b.adet) : 3)] },
        { betik: "shorts-kes.cjs", argv: [is, kesit] },
      ], { agir: true })];
    }
    case "vsKur": gerek(); return [adim("vs", "VS kurulumu", [{ betik: "vs-kur.js", argv: [is] }])];
    case "vsDuzelt": gerek(); return [adim("vs", "VS görsel düzeltme", [{ betik: "vs-gorsel-duzelt.js", argv: [is] }])];
    case "vsYap": gerek(); return [adim("vs", "VS videosu", [{ betik: "vs-yap.js", argv: [is] }], { agir: true })];
    case "vsHepsi":
      gerek();
      return [adim("vs", "VS kurulumu", [{ betik: "vs-kur.js", argv: [is] }]),
              adim("vs", "VS videosu", [{ betik: "vs-yap.js", argv: [is] }], { agir: true })];
    case "markaYap": {
      const ay = ctx.ayar || {};
      const kanal = (metin(b.kanal) || metin(ay.kanal)).trim(), slogan = (b.slogan != null ? metin(b.slogan) : metin(ay.slogan)).trim();
      if (!kanal || kanal.length > 60) throw new HttpHata(400, "kanal", "Kanal adı 1–60 karakter olmalı.");
      if (slogan.length > 120) throw new HttpHata(400, "slogan", "Slogan en çok 120 karakter olabilir.");
      bayraksiz("kanal", kanal); bayraksiz("slogan", slogan);
      return [adim("marka", "Kanal markası", [{ betik: "marka-yap.js", argv: [kanal, slogan, path.join(ctx.uretim, "_marka")] }], { agir: true })];
    }
    case "trend": {
      const konu = metin(b.konu).trim();
      if (konu.length > 200) throw new HttpHata(400, "konu", "Konu en çok 200 karakter olabilir.");
      bayraksiz("konu", konu);
      const platform = metin(b.platform) || "hepsi";
      if (!["hepsi", "yt", "ig", "tt"].includes(platform)) throw new HttpHata(400, "platform", "Platform yt, ig, tt ya da hepsi olmalı.");
      const dil = metin(b.dil) || "en"; if (!/^[a-z]{2}$/.test(dil)) throw new HttpHata(400, "dil", "Dil iki küçük harf olmalı.");
      const min = sayi(b.min || 200000);
      return [adim("trend", "Trend arama", [{ betik: "trend-ara.js", argv: [konu, "--dil", dil, "--min", String(Number.isFinite(min) && min >= 0 ? Math.round(min) : 200000)]
        .concat(platform !== "hepsi" ? ["--platform", platform] : []).concat(b.siki ? ["--siki"] : []) }], { ucretli: true })];
    }
    case "viral": {
      const konu = metin(b.konu).trim();
      if (konu.length > 200) throw new HttpHata(400, "konu", "Konu en çok 200 karakter olabilir.");
      bayraksiz("konu", konu);
      const dil = metin(b.dil) || "en"; if (!/^[a-z]{2}$/.test(dil)) throw new HttpHata(400, "dil", "Dil iki küçük harf olmalı.");
      const min = sayi(b.min || 10000000);
      return [adim("viral", "Viral analiz", [{ betik: "viral-analiz.js", argv: [konu, dil, String(Number.isFinite(min) && min >= 0 ? Math.round(min) : 10000000)] }], { ucretli: true })];
    }
    case "performans":
      if (is) { gerek(); return [adim("performans", "Performans verisi", [{ betik: "performans.js", argv: ["--is", is] }], { ucretli: true })]; }
      return [adim("performans", "Performans verisi", [{ betik: "performans.js", argv: ["--hepsi"] }], { ucretli: true })];
    default:
      throw new HttpHata(400, "gecersiz_islem", "Geçersiz işlem.");
  }
}

const TURLER = ["hepsi", "devam", "senaryo", "senaryoV", "baslikOn", "baslik", "ceviri", "gorsel", "gorselSahne", "gorselUret",
  "nasa", "portre", "formul", "prompt", "ses", "video", "onizleme", "kapak", "yayin", "shortsKes", "vsKur", "vsDuzelt", "vsYap",
  "vsHepsi", "markaYap", "trend", "viral", "performans"];
// Is gerektirmeyen turler
const ISSIZ = new Set(["markaYap", "trend", "viral", "performans"]);
// Diskte yer isteyen turler
const DISK_GEREKLI = new Set(["hepsi", "devam", "gorsel", "gorselUret", "nasa", "portre", "ses", "video", "onizleme", "shortsKes", "vsKur", "vsYap", "vsHepsi"]);
// Bir senaryo yazan turler (mevcut metin varsa 409)
const SENARYO_YAZAN = new Set(["senaryo", "senaryoV"]);

module.exports = { ADIM_ETIKET, AGIRLIK, senaryoMotoru, zincirAdimlari, tekTur, TURLER, ISSIZ, DISK_GEREKLI, SENARYO_YAZAN, adim, sorun };
