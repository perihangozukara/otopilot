// lib/senaryo-ortak.js — iki senaryo motorunun (Claude, vidIQ) ORTAK kodu.
//
// Neden ayri dosya: eskiden temizle/shortsKirp/kelimeSay iki dosyada kopyaydi, biri
// digerinden farkli davraniyordu (Claude yolunda Shorts kirpilmiyordu). Burada tek
// kopya var; saf fonksiyonlar `node --test` ile denenir.
//
// Icerik:
//   - hedef hesabi (dil, format, kelime hizi, sure sinirlari)
//   - model ciktisini AYIKLAMA/TEMIZLEME (<anlatim> etiketi, giris cumlesi, JSON, kisa paragraf)
//   - cumle bolme (kisaltma duyarli), Shorts kirpma, tekrar ayiklama, govde kirpma
//   - yedekleme ve yan dosya yazimi (gorsel-aramalari.json, bolumler.json, aciklama-ozet.txt)
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./ortak");

const { OrtakHata, CIKIS } = ortak;

// ============================================================ temel yardimcilar
// Sozcukler arasinda bosluk BIRAKMAYAN yazilar (Japonca, Cince, Tayca...): bosluga gore sayim "1 kelime" verir,
// hedef kelime/cumle bolme/kirpma hep bozulur. Bu yazilarda "kelime" = ~2,5 karakter sayilir (TAHMIN: Japonca
// anlatim dakikada ~350 karakter okunur, kelimeHizi 140 ile uyumlu; asil sure seslendirme sonrasi zamanlama.json'dan olculur).
const BOSLUKSUZ_YAZI = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const BOSLUKSUZ_YAZI_G = new RegExp(BOSLUKSUZ_YAZI.source, "gu");
const BOSLUKSUZ_DILLER = new Set(["ja", "zh", "th", "lo", "km", "my"]);
const KARAKTER_PER_KELIME = 2.5;
const bosluksuzDilMi = dil => BOSLUKSUZ_DILLER.has(String(dil || "").toLowerCase().slice(0, 2));

function kelimeSay(s) {
  const m = String(s == null ? "" : s);
  const bosluksuz = (m.match(BOSLUKSUZ_YAZI_G) || []).length;
  if (!bosluksuz) return m.split(/\s+/).filter(Boolean).length;
  // karma metin: bosluksuz yazi karakter sayisindan, kalan (Latin/rakam) sozcukler bosluga gore; yalniz noktalama olan parca sayilmaz
  const kalan = m.replace(BOSLUKSUZ_YAZI_G, " ").split(/\s+/).filter(t => /[\p{L}\p{N}]/u.test(t)).length;
  return kalan + Math.ceil(bosluksuz / KARAKTER_PER_KELIME);
}

// Turkce harfleri ASCII'ye 1:1 katlar (uzunluk korunur). JS'nin /i bayragi Turkce i/I/İ/ı'yi eslestirmez:
// "İşte", "Giriş", "Kapanış" gibi yonerge/giris kaliplari bu katlama ile taninir.
const TR_KATLA = { "ç": "c", "Ç": "c", "ğ": "g", "Ğ": "g", "ı": "i", "İ": "i", "ö": "o", "Ö": "o", "ş": "s", "Ş": "s", "ü": "u", "Ü": "u" };
const katla = s => String(s).replace(/[çÇğĞıİöÖşŞüÜ]/g, c => TR_KATLA[c]);
// re katlanmis metinde aranir, eslesen aralik ORIJINAL metinden `yerine` ile degistirilir (re global olmali)
function katliDegistir(m, re, yerine) {
  const k = katla(m);
  let cikti = "", son = 0;
  for (const x of k.matchAll(re)) { cikti += m.slice(son, x.index) + yerine; son = x.index + x[0].length; }
  return cikti + m.slice(son);
}

const DIL_ADLARI = { en: "English", tr: "Turkish", es: "Spanish", de: "German", fr: "French", it: "Italian",
  pt: "Portuguese", ru: "Russian", nl: "Dutch", pl: "Polish", ja: "Japanese", ko: "Korean", ar: "Arabic", hi: "Hindi" };
function dilAdi(dil) {
  const k = String(dil || "en").toLowerCase().slice(0, 2);
  if (DIL_ADLARI[k]) return DIL_ADLARI[k];
  try {
    const ad = new Intl.DisplayNames(["en"], { type: "language" }).of(k);
    if (ad && ad !== k) return ad;
  } catch (e) { /* Intl yoksa kodun kendisi */ }
  return k;
}

const PLATFORM_ADI = { short: "YouTube Shorts", reels: "Instagram Reels", tiktok: "TikTok", long: "YouTube" };

// Konu notundan eski onek ("Konu: ...", "Nis: ...") temizlenir.
function konuNotu(konu) {
  return String((konu && konu._not) || "").replace(/^\s*Konu:\s*/i, "").replace(/^\s*Nis:\s*/i, "").trim();
}

// ============================================================ hedefler
// konu = ortak.konuEtkin(is) sonucu. Donus: senaryo motorlarinin ihtiyac duydugu her sayi.
//   kisa      : short/reels/tiktok formati (dikey prompt + shortsKirp)
//   tekAtis   : tek istekte yazilir (kisa formatlar + 4 dakikadan kisa uzun video)
//   kelimeHizi: kelime/dk. 60 sn ve altinda OLCULEN oran uygulanir (en: 137; diger dillerde
//               ortak.kelimeHizi(dil) x 137/151), uzun videoda ortak.kelimeHizi(dil)
function hedefler(konu) {
  const k = konu || {};
  const format = ["long", "short", "reels", "tiktok"].includes(k.format) ? k.format
    : (k.aspect === "9:16" ? "short" : "long");
  const sinir = ortak.formatSiniri(format);
  const kisa = format !== "long";
  const uyarilar = [];
  let hedefSn = Number(k.hedefSaniye) > 0 ? Number(k.hedefSaniye)
    : (Number(k.hedefDakika) > 0 ? Number(k.hedefDakika) * 60 : sinir.oneriSn);
  if (kisa && hedefSn > sinir.teknikMaxSn) {
    uyarilar.push("Hedef " + hedefSn + " sn, " + PLATFORM_ADI[format] + " sınırı " + sinir.teknikMaxSn +
      " sn: senaryo bu sınıra göre kısaltıldı.");
    hedefSn = sinir.teknikMaxSn;
  }
  const dil = (k.dil && /^[a-z]{2}$/.test(k.dil)) ? k.dil : "en";
  const normal = ortak.kelimeHizi(dil);
  const kelimeHizi = hedefSn <= 60 ? Math.round(normal * 137 / 151) : normal;
  return {
    format, kisa, dikey: kisa, dil, dilAdi: dilAdi(dil), bosluksuz: bosluksuzDilMi(dil), hedefSn, hedefDk: hedefSn / 60,
    kelimeHizi, hedefKelime: Math.max(1, Math.round(hedefSn / 60 * kelimeHizi)),
    tekAtis: kisa || hedefSn < 240, teknikMaxSn: sinir.teknikMaxSn, uyarilar,
  };
}

const sureTahmin = (kelime, kelimeHizi) => Math.round(kelime / (kelimeHizi || 151) * 60);
function sureMetni(sn) {
  return sn < 60 ? sn + " sn" : Math.floor(sn / 60) + " dk " + (sn % 60) + " sn";
}

// ============================================================ model ciktisini ayiklama
// <anlatim>...</anlatim>: etiket yoksa tum yanit; kapanis etiketi yoksa (token siniri ya da model kapatmayi unuttu)
// acilistan sonrasi, ama BASKA bir yan blogun (<gorseller>, <ozet>, <bolumler>, <anlatim>) acilisina kadar:
// aksi halde yan bloktaki JSON/ozet metni seslendirme paragrafina girerdi.
function etiketIci(metin, etiket) {
  const ac = new RegExp("<" + etiket + "\\s*>", "i");
  const kapa = new RegExp("</" + etiket + "\\s*>", "i");
  const a = ac.exec(metin);
  if (!a) return null;
  const sonra = metin.slice(a.index + a[0].length);
  const k = kapa.exec(sonra);
  if (k) return { icerik: sonra.slice(0, k.index), kesik: false };
  const diger = new RegExp("<(?!" + etiket + "\\s*>)(?:anlatim|gorseller|ozet|bolumler)\\s*>", "i").exec(sonra);
  return { icerik: diger ? sonra.slice(0, diger.index) : sonra, kesik: true };
}

function anlatimCikar(modelMetni) {
  const ham = String(modelMetni == null ? "" : modelMetni);
  const e = etiketIci(ham, "anlatim");
  if (e) return { metin: e.icerik, etiketVar: true, kesik: e.kesik };
  // Etiket yok: model formati unuttu. Yan bloklari at, kalanini senaryo say (uyari ile).
  const temiz = ham.replace(/<(gorseller|ozet|bolumler)\s*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "");
  return { metin: temiz, etiketVar: false, kesik: false };
}

function ozetCikar(modelMetni) {
  const e = etiketIci(String(modelMetni || ""), "ozet");
  if (!e || e.kesik) return "";
  return e.icerik.replace(/\s+/g, " ").trim().slice(0, 600);
}

// <gorseller> JSON dizisi: [{p:1, ara:["..",".."], uret:"..."}]  -> Map(p -> {aramalar, uret})
function gorselAramaCikar(modelMetni) {
  const sonuc = new Map();
  const e = etiketIci(String(modelMetni || ""), "gorseller");
  if (!e) return sonuc;
  let ham = e.icerik.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let liste = null;
  try { const j = JSON.parse(ham); liste = Array.isArray(j) ? j : (j && Array.isArray(j.paragraflar) ? j.paragraflar : null); }
  catch (err) { /* asagida nesne nesne kurtarmayi dene */ }
  if (!liste) {
    liste = [];
    for (const m of ham.matchAll(/\{[^{}]*\}/g)) { try { liste.push(JSON.parse(m[0])); } catch (err) { /* atla */ } }
  }
  for (const o of liste) {
    if (!o || typeof o !== "object") continue;
    const p = Number(o.p != null ? o.p : o.no);
    if (!Number.isInteger(p) || p < 1) continue;
    const ara = (Array.isArray(o.ara) ? o.ara : Array.isArray(o.aramalar) ? o.aramalar : [])
      .map(x => String(x || "").replace(/\s+/g, " ").trim()).filter(x => x.length >= 2 && x.length <= 120).slice(0, 3);
    const uret = typeof o.uret === "string" ? o.uret.replace(/\s+/g, " ").trim().slice(0, 400) : "";
    if (ara.length || uret) sonuc.set(p, { aramalar: ara, uret });
  }
  return sonuc;
}

// ---------------------------------------------------------------- blok temizleme
// "Here is the narration script:" gibi sohbet cumleleri ve sondaki "Word count: ..." notlari
// Kalip regex'leri ASCII yazilir ve KATLANMIS (katla) metne uygulanir: "İşte", "Giriş", "Kapanış", "Başlık" tanınsın diye.
const GIRIS_RE = /^(?:here(?:'s|\s+is|\s+are)|sure|certainly|of course|okay|ok|absolutely|below is|iste|tabii|elbette|tamam|asagida)\b/i;
const GIRIS_ANAHTAR_RE = /\b(?:script|narration|version|draft|text|voice-?over|anlatim|senaryo|metin|taslak)\b/i;
const SONUC_NOT_RE = /^(?:\(?\s*(?:word count|words?|kelime(?: sayisi)?)\s*[:=]|let me know|i hope this|feel free|note\s*:|not\s*:|\(?\s*\d[\d.,]*\s*(?:words?|kelime)\s*\)?\s*$)/i;
// \b Turkce harflerde (ASCII disi) calismaz; katlanmis metinde sorun yok
const girisMi = s => GIRIS_RE.test(katla(s));
const girisAnahtarMi = s => GIRIS_ANAHTAR_RE.test(katla(s));
const sonucNotMu = s => SONUC_NOT_RE.test(katla(s));

// Tek blok (bos satirla ayrilmis paragraf) icin: yonerge/markdown satirlarini at, bosluklari duzelt.
// Donus: temiz metin ("" = blok tamamen yonergeydi).
function blokTemizle(blok) {
  const satirlar = String(blok).replace(/\r/g, "").split("\n").filter(s => {
    const k = katla(s);
    if (/^\s*[\[(][^\])\n]{0,120}[\])]\s*$/.test(s)) return false;                          // [B-ROLL: ...] (pause)
    if (/^\s*#{1,6}\s/.test(s)) return false;                                               // ## Baslik
    if (/^\s*\**\s*(?:title|baslik|video title)\s*:/i.test(k)) return false;                // Title: ... / Başlık: ...
    if (/^\s*(?:HOOK|INTRO|OUTRO|BODY|SECTION|PART|SEGMENT|CTA|CONCLUSION|GIRIS|KAPANIS|BOLUM)\s*\d*\s*[:\-—]?\s*$/i.test(k)) return false;
    if (/^\s*\[?\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]?\s*$/.test(s)) return false;               // yalniz zaman damgasi
    if (/^\s*[-–—=*_]{3,}\s*$/.test(s)) return false;                                       // --- cizgisi
    if (/^\s*(?:part|section|chapter|scene|bolum|sahne)\s*\d+\s*[:.\-—–]\s*.{0,80}$/i.test(k)) return false;   // "Part 3: The Fall" baslik satiri
    return true;
  });
  let m = satirlar.join(" ");
  m = katliDegistir(m, /[\[(](?:b-?roll|visual|cut to|sfx|music|pause|beat|on screen|graphic|text|muzik|ses efekti|gorsel|ekranda|duraklama)[^\])\n]*[\])]/gi, "");
  m = m
    // zaman damgasi yalniz AYIRICILI ise silinir: "00:15 - ..." silinir, "3:15 a.m., the alarm" kalir
    .replace(/^\s*\[?\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]\s*[-—–:]?\s*/, "")
    .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*[-—–:]\s+/, "");
  m = katliDegistir(m, /^\s*(?:NARRATOR|VOICEOVER|VO|HOST|ANLATICI|SPIKER)\s*[:\-]\s*/gi, "");
  m = katliDegistir(m, /^\s*(?:paragraph|scene|paragraf|sahne)\s*\d+\s*[:.\-—]\s*/gi, "");
  m = m
    .replace(/\*\*/g, "").replace(/[*`]/g, "")
    .replace(/(^|\s)_+([^_\s][^_]*?)_+(?=\s|[.,;:!?]|$)/g, "$1$2")
    .replace(/^\s*[-–—>•]\s+/, "")
    .replace(/\s+/g, " ").trim();
  return m;
}

// Donus: {paragraflar:[{metin, hamNo}], silinen:[{hamNo, neden, ornek}], etiketVar, kesik}
//   hamNo = modelin kendi paragraf sirasi (<gorseller> bu sirayi kullanir, 1'den degil 0'dan)
function paragraflariTemizle(modelMetni) {
  const cikar = anlatimCikar(modelMetni);
  const govde = cikar.metin.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  // Yanit yalniz JSON ise (hata govdesi, beklenmedik arac ciktisi) senaryo SAYILMAZ.
  if (/^[\[{]/.test(govde) && !cikar.etiketVar) {
    let json = null;
    try { json = JSON.parse(govde); } catch (e) { /* JSON degil */ }
    if (json !== null)
      throw new OrtakHata("senaryo_json", "Model senaryo yerine JSON döndürdü; senaryo olarak kullanılmadı.", {
        cikis: CIKIS.YETERSIZ, cozum: "Tekrar dene; sürerse konu metnini sadeleştir.", detay: govde.slice(0, 200) });
  }
  const bloklar = govde.split(/\n\s*\n/);
  const sonuc = [], silinen = [];
  bloklar.forEach((b, hamNo) => {
    const temiz = blokTemizle(b);
    if (!temiz) { if (b.trim()) silinen.push({ hamNo, neden: "yönerge", ornek: b.trim().slice(0, 60) }); return; }
    if (temiz.length < 8 || !/\p{L}/u.test(temiz)) { silinen.push({ hamNo, neden: "çok kısa", ornek: temiz.slice(0, 60) }); return; }
    sonuc.push({ metin: temiz, hamNo });
  });
  // sohbet girisi (yalniz ilk paragraf) ve sondaki not (yalniz son paragraf)
  // <anlatim> etiketi kullanildiysa sohbet girisi zaten etiketin DISINDA kaldi; icerideki "Here is the text on the wall..."
  // gibi paragraf gercek anlatimdir, giris sayilip silinmez.
  if (sonuc.length > 1 && !cikar.etiketVar) {
    const ilk = sonuc[0];
    if (girisMi(ilk.metin) && kelimeSay(ilk.metin) <= 30 && (/[:：]\s*$/.test(ilk.metin) || girisAnahtarMi(ilk.metin))) {
      silinen.push({ hamNo: ilk.hamNo, neden: "model giriş cümlesi", ornek: ilk.metin.slice(0, 60) });
      sonuc.shift();
    }
  }
  if (sonuc.length > 1) {
    const son = sonuc[sonuc.length - 1];
    if (sonucNotMu(son.metin) && kelimeSay(son.metin) <= 30) {
      silinen.push({ hamNo: son.hamNo, neden: "model kapanış notu", ornek: son.metin.slice(0, 60) });
      sonuc.pop();
    }
  }
  return { paragraflar: sonuc, silinen, etiketVar: cikar.etiketVar, kesik: cikar.kesik };
}

// Temizlik raporunu tek satirlik log metnine cevirir (bos ise ""). birim: "paragraf" (varsayilan) | "cümle"
function temizlikRaporu(silinen, birim) {
  if (!silinen || !silinen.length) return "";
  return silinen.length + " " + (birim || "paragraf") + " silindi (" + [...new Set(silinen.map(s => s.neden))].join(", ") +
    "), ilk satır: " + silinen[0].ornek;
}

// ---------------------------------------------------------------- dil sanity kontrolu
// Model/vidIQ istenen dili tutturamadiysa (ornegin Turkce video icin Ingilizce metin) UYARI verir; hata degil.
const EN_DURAK = /\b(?:the|and|of|to|is|in|that|it|with|for|was|as|on|are|this)\b/gi;
const TR_HARF = /[çğışöüÇĞİŞÖÜ]/g;
// Yazisi kendine ozgu diller: metnin harflerinin cogu o yazidan olmali (Latin dilinde yazilmis Japonca isteginin
// Ingilizce gelmesi gibi uyusmazliklar stopword sayimiyla yakalanamaz; ornegin dil 'ja' iken "the/and" orani zaten 0'dir).
const DIL_YAZISI = {
  ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, zh: /\p{Script=Han}/gu, ko: /\p{Script=Hangul}/gu,
  ar: /\p{Script=Arabic}/gu, hi: /\p{Script=Devanagari}/gu, ru: /\p{Script=Cyrillic}/gu, uk: /\p{Script=Cyrillic}/gu,
  th: /\p{Script=Thai}/gu,
};
// Donus: "" (uyumlu / emin degil) ya da Turkce uyari metni. Hata DEGIL uyaridir; senaryo-yaz.js (vidIQ dil parametresi
// almadigi icin) uyusmazligi hata sayar, Claude yolu uyarir.
function dilUyarisi(metin, dil) {
  const kelime = kelimeSay(metin);
  if (kelime < 40) return "";
  const m = String(metin);
  const harf = (m.match(/\p{L}/gu) || []).length;
  if (DIL_YAZISI[dil] && harf >= 80) {
    const oran = (m.match(DIL_YAZISI[dil]) || []).length / harf;
    if (oran < 0.4) return "Metin '" + dil + "' dilinin yazısıyla yazılmamış görünüyor (harflerin yalnız %" + Math.round(oran * 100) +
      "'i o yazıda). Seslendirme yanlış okuyabilir; senaryoyu kontrol et ya da tekrar yaz.";
    return "";
  }
  if (!DIL_YAZISI[dil] && harf >= 80) {
    const latin = (m.match(/\p{Script=Latin}/gu) || []).length;
    if (latin / harf < 0.4) return "Metin '" + dil + "' dili için Latin harfleriyle yazılmış olmalıydı ama harflerin çoğu başka bir yazıda. " +
      "Seslendirme yanlış okuyabilir; senaryoyu kontrol et ya da tekrar yaz.";
  }
  const enOran = (m.match(EN_DURAK) || []).length / kelime;
  const trOran = (m.match(TR_HARF) || []).length / Math.max(1, m.length);
  if (dil !== "en" && enOran > 0.12)
    return "Metin İngilizce görünüyor ama video dili '" + dil + "'. Seslendirme yanlış okuyabilir; senaryoyu kontrol et ya da tekrar yaz.";
  if (dil === "en" && trOran > 0.02)
    return "Metin Türkçe görünüyor ama video dili 'en'. konu.json'da dil/ses ayarını kontrol et.";
  return "";
}

// ============================================================ cumle bolme (kisaltma duyarli)
const KISALTMALAR = new Set(["dr", "mr", "mrs", "ms", "prof", "st", "vs", "etc", "e.g", "i.e", "u.s", "u.k", "no",
  "jr", "sr", "inc", "ltd", "mt", "co", "corp", "fig", "approx", "doç", "doc", "vb", "bkz", "yy", "sn", "dk", "örn", "orn",
  "a.d", "b.c", "a.m", "p.m", "u.s.a", "ph.d"]);

const ACILIS_ISARETI = /^[("'“‘\[]+/;

// Kisaltma belirteci mi: unvan/kisaltma listesi, "U.S" gibi akronim ya da TEK buyuk harf bas harf ("J.")?
function kisaltmaBelirteci(belirtec) {
  const tok = String(belirtec).replace(ACILIS_ISARETI, "");
  if (!/\.$/.test(tok) || /[?!…]\.?$/.test(tok)) return false;
  const ham = tok.replace(/\.+$/, "");
  return KISALTMALAR.has(ham.toLowerCase()) || /^\p{Lu}$/u.test(ham) || /^(?:\p{L}\.)+\p{L}$/u.test(ham);
}

// s: cumle sonuna kadar olan parca; sonraki: ondan hemen sonra gelen parca (varsa).
// TEK buyuk harf + nokta ("C.", "B.") iki sey olabilir: bas harf ("J. K. Rowling", "Dr. J. Smith") ya da cumle sonu ("Vitamin C. Yeni...",
// "Plan B. Sonra..."). Ayirt etmek icin BAGLAM aranir: bas harf yalniz bir bas harf/unvan dizisinin icinde sayilir (onundeki belirtec de
// kisaltmaysa ya da sonraki parca da "X." ise). Tek basina "Yazar J. Smith" ise cumle sonu sayilir: bilinen takas, ters yon saglik/finans
// metinlerinde ("Hepatit B.", "Plan B.") cumleleri sessizce birlestiriyordu.
function kisaltmaIleBitiyor(s, sonraki) {
  const belirtecler = String(s).trim().split(/\s+/);
  const tok = belirtecler.pop().replace(ACILIS_ISARETI, "");
  if (!/\.$/.test(tok) || /[?!…]\.?$/.test(tok)) return false;
  const ham = tok.replace(/\.+$/, "");
  if (KISALTMALAR.has(ham.toLowerCase())) return true;
  // "J." gibi bas harf: yalniz BUYUK harf. Tek heceli kucuk/buyuk-kucuk harfsiz yazilarda ("나.", "我。") cumle sonudur.
  // (Buyuk harf sinamasi KUCULTULMEMIS govdede yapilir: kucultulmus metinde \p{Lu} hicbir zaman eslesmez.)
  if (/^\p{Lu}$/u.test(ham)) {
    const onceki = belirtecler.length ? belirtecler[belirtecler.length - 1] : "";
    if (onceki && kisaltmaBelirteci(onceki)) return true;
    const sonrakiIlk = String(sonraki == null ? "" : sonraki).trim().split(/\s+/)[0] || "";
    return /^[("'“‘\[]*\p{Lu}\.$/u.test(sonrakiIlk);
  }
  if (/^(?:\p{L}\.)+\p{L}$/u.test(ham)) return true;          // "U.S", "e.g"
  return false;
}

// Cumle sonu: Latin ".!?…" + Devanagari "।॥", Arapca "؟۔" ve tam genislikli "。！？｡" (Japonca/Cince bosluk koymaz).
const KAPATICI = "\"'”’)\\]」』）】»";
const GENIS_SON = "。！？｡";
const GENIS_BOL = new RegExp("(?<=[" + GENIS_SON + "][" + KAPATICI + GENIS_SON + "!?…]*)(?![" + KAPATICI + GENIS_SON + "!?…])\\s*", "u");
const LATIN_BOL = new RegExp("(?<=[.!?…।॥؟۔][" + KAPATICI + "]*)\\s+", "u");

function cumleBol(metin) {
  const ham = String(metin == null ? "" : metin).replace(/\s+/g, " ").trim();
  if (!ham) return [];
  const sonuc = [];
  // 1) tam genislikli sonlar SERT sinirdir (bosluk gerekmez, buyuk harf kurali uygulanmaz)
  for (const kaba of ham.split(GENIS_BOL).filter(x => x.trim())) {
    const bas = sonuc.length;
    // 2) Latin/Devanagari/Arapca sonlar: bosluktan sonra; kisaltma ya da KUCUK harfle baslayan parca onceki cumleye eklenir.
    //    (Eskiden "buyuk harf degil" yeterliydi: Korece/Arapca/Hintce'de buyuk harf olmadigindan butun metin tek cumle sayiliyordu.)
    for (const p of kaba.split(LATIN_BOL)) {
      if (sonuc.length > bas) {
        const onceki = sonuc[sonuc.length - 1];
        if (kisaltmaIleBitiyor(onceki, p) || /^\p{Ll}/u.test(p)) { sonuc[sonuc.length - 1] = onceki + " " + p; continue; }
      }
      sonuc.push(p);
    }
  }
  return sonuc;
}

// ============================================================ Shorts / Reels / TikTok kirpma
// Tavan = hedefKelime. Ilk cumle (kanca) HER ZAMAN kalir. Paragraf yapisi korunur;
// tek paragraf gelirse altyazi ritmi icin 2 cumlelik paragraflara bolunur.
// Cekirdek: paragraf dizisini hedef kelimeye kadar keser, paragraf yapisini ve kaynak numarasini korur.
// Donus: {paragraflar:[metin], kaynak:[ilk dizideki indeks], kirpildi:bool}
function kirpCekirdek(paragraflar, hedefKelime, esnek) {
  const cikti = [], kaynak = [];
  let n = 0, durdu = false;
  for (let i = 0; i < paragraflar.length; i++) {
    const alinan = [];
    for (const c of cumleBol(paragraflar[i])) {
      const k = kelimeSay(c);
      if (n + k > hedefKelime) {
        // Tavan SERTTIR (platform sureleri: Shorts 180 sn vb.). Yalniz acikca istenirse (esnek) cok kisa
        // kalan metne hedefin %110'una kadar bir cumle daha tanir.
        if (esnek && n < hedefKelime * 0.7 && n + k <= hedefKelime * 1.1) { alinan.push(c); n += k; }
        durdu = true;
        break;
      }
      alinan.push(c); n += k;
    }
    if (alinan.length) { cikti.push(alinan.join(" ")); kaynak.push(i); }
    if (durdu) break;
  }
  if (!cikti.length && paragraflar.length) { cikti.push(cumleBol(paragraflar[0])[0] || paragraflar[0]); kaynak.push(0); durdu = true; }
  const toplam = paragraflar.reduce((a, p) => a + kelimeSay(p), 0);
  return { paragraflar: cikti, kaynak, kirpildi: durdu && n < toplam };
}

function shortsKirp(metin, hedefKelime) {
  const paragraflar = ortak.paragraflaraBol(metin);
  if (!paragraflar.length) return "";
  const cikti = kirpCekirdek(paragraflar, hedefKelime).paragraflar;
  if (cikti.length < 3) {
    const cumleler = cikti.flatMap(p => cumleBol(p));
    if (cumleler.length >= 4) {
      const yeni = [];
      for (let i = 0; i < cumleler.length; i += 2) yeni.push(cumleler.slice(i, i + 2).join(" "));
      return yeni.join("\n\n");
    }
  }
  return cikti.join("\n\n");
}

// ============================================================ tekrar / giris-kapanis ayiklama
// Bosluksuz yazida (Japonca...) "4+ harflik sozcuk" butun bir tumce olur: tekrar benzerligi icin harf ikilileri kullanilir.
function kelimeKumesi(p) {
  const kume = new Set();
  for (const w of String(p).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []) {
    if (!BOSLUKSUZ_YAZI.test(w)) { kume.add(w); continue; }
    const h = Array.from(w);
    for (let i = 0; i + 1 < h.length; i++) kume.add(h[i] + h[i + 1]);
  }
  return kume;
}

// Daha once gelen bir paragrafla cok benzeyen (Jaccard >= esik) paragraflarin indeksleri.
function tekrarIndeksleri(paragraflar, esik) {
  const e = esik || 0.6;
  const kumeler = paragraflar.map(kelimeKumesi);
  const normal = paragraflar.map(p => String(p).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim());
  const atilan = new Set();
  for (let j = 1; j < paragraflar.length; j++) {
    for (let i = 0; i < j; i++) {
      if (atilan.has(i)) continue;
      if (normal[i] && normal[i] === normal[j]) { atilan.add(j); break; }
      if (kumeler[i].size < 8 || kumeler[j].size < 8) continue;
      let ortakSay = 0;
      for (const w of kumeler[j]) if (kumeler[i].has(w)) ortakSay++;
      const birlesim = kumeler[i].size + kumeler[j].size - ortakSay;
      if (birlesim && ortakSay / birlesim >= e) { atilan.add(j); break; }
    }
  }
  return atilan;
}

// Selam: "hi/hey/hello" yalniz selam gibi kullanildiginda ("Hi, ...", "Hello everyone"); "Hi-tech", "Hello Kitty" selam DEGIL.
const SELAM_RE = /^(?:welcome(?: back)?(?=[\s,.!]|$)|(?:hello|hi|hey|greetings)(?=\s*[,.!?]|\s*$|\s+(?:there|everyone|everybody|friends|folks|guys|all|dear|viewers|again|and)\b)|good (?:morning|evening|afternoon)\b|merhaba\b|selam(?:lar)?\b|hoş\s?geldin\w*)/i;
// Kapanis YALNIZ acik cagri/veda kaliplariyla taninir. Tek basina "like" (benzetme: "like a wall"), "unlike", "alike",
// "dislike" ya da "thumbs up" (el isareti) gercek anlatimdir; ESLESMEZ.
const CAGRI_RE = new RegExp([
  "\\bsubscribe\\b",
  "\\bnotification bell\\b",
  "\\b(?:don'?t forget|remember|be sure|make sure|please)\\s+to\\s+(?:like|subscribe|share|comment|hit)\\b",
  "\\b(?:leave|drop)\\s+(?:us\\s+)?a\\s+(?:like|comment)\\b",
  "\\bgive\\s+(?:it|this video|us)\\s+a\\s+(?:like|thumbs)",
  "\\babone\\s+ol",
  "beğen(?:meyi)?\\s+unutma",
  "bildirimleri\\s+aç",
].join("|"), "i");
// "Hit the bell", "Smash that like button": emir kipi, cumlenin BASINDA ("The hammer hit the bell" anlatimdir)
const CAGRI_BASI_RE = /^(?:(?:and|so|also|please)\s+)?(?:hit|smash|tap|click|press)\s+(?:the|that|this|a)\s+(?:like|bell|subscribe)\b/i;
const VEDA_RE = /(?:thanks? (?:so much )?for (?:watching|listening)|see you (?:in the )?next|until next time|[iİ]zlediğin(?:iz)? için teşekkür|bir sonraki videoda|görüşmek üzere)/i;
const KAPANIS_KELIME_SINIRI = 35;          // kapanis/cagri cumlesi kisadir; uzun cumle gercek anlatimdir

// parca: paragraf dizisi. Bastaki selamlama HER parcada, son=false ise sondaki kapanis (veda) cumleleri atilir;
// "subscribe/like" cagrilari her parcada atilir (kapanis karti zaten var).
// silinenListe (ops.): atilan her cumle {neden, ornek} olarak buraya eklenir (cagiran loga yazar; SESSIZ KAYIP YOK).
function parcaGirisKapanisTemizle(paragraflar, ilkParca, sonParca, silinenListe) {
  const liste = paragraflar.map(p => cumleBol(p));
  const toplamCumle = () => liste.reduce((a, c) => a + c.length, 0);
  const rapor = (neden, s) => { if (Array.isArray(silinenListe)) silinenListe.push({ neden, ornek: String(s).slice(0, 60) }); };
  const kisaMi = s => kelimeSay(s) <= KAPANIS_KELIME_SINIRI;
  const cagriMi = s => kisaMi(s) && (CAGRI_RE.test(s) || CAGRI_BASI_RE.test(s.trim()));
  const vedaMi = s => kisaMi(s) && VEDA_RE.test(s);
  // bastaki selamlar HER parcada atilir (video kancayla acilir; kanal tanitimi/selami zaten giris kartinda);
  // paragrafin tamami selamsa paragraf da gider. ilkParca yalniz API uyumu icin duruyor.
  while (liste.length && toplamCumle() > 1) {
    if (!liste[0].length) { liste.shift(); continue; }
    if (!SELAM_RE.test(liste[0][0])) break;
    rapor("selam", liste[0][0]);
    liste[0].shift();
  }
  // sondaki kapanis cumleleri; son parcada yalniz abone ol / begen cagrilari (veda cumlesi son parcada kalir)
  while (liste.length && toplamCumle() > 1) {
    const son = liste[liste.length - 1];
    if (!son.length) { liste.pop(); continue; }
    const s = son[son.length - 1];
    const cagri = cagriMi(s);
    if (!cagri && !(!sonParca && vedaMi(s))) break;
    rapor(cagri ? "abone/beğen çağrısı" : "veda", s);
    son.pop();
  }
  const sonuc = [];
  liste.forEach((c, i) => { if (c.length) sonuc.push({ metin: c.join(" "), kaynak: i }); });
  return sonuc;
}

// hedefin tolerans kati uzerine ciktiysa govdeden (ilk 2 ve son paragraf hariç) esit aralikli
// paragraflari atar. Atilan indeksleri dondurur. Son care: ayrintisi loglanir.
function govdeKirpIndeksleri(paragraflar, hedefKelime, tolerans) {
  const tol = tolerans || 1.15;
  const kelimeler = paragraflar.map(kelimeSay);
  let toplam = kelimeler.reduce((a, b) => a + b, 0);
  const atilan = new Set();
  if (toplam <= hedefKelime * tol) return atilan;
  const adaylar = [];
  for (let i = 2; i < paragraflar.length - 1; i++) adaylar.push(i);
  // esit aralikli sira: once ortadakiler, sonra kenarlara dogru
  const sira = [];
  const kopya = adaylar.slice();
  while (kopya.length) { const m = Math.floor(kopya.length / 2); sira.push(kopya.splice(m, 1)[0]); }
  for (const i of sira) {
    if (toplam <= hedefKelime * tol) break;
    atilan.add(i); toplam -= kelimeler[i];
  }
  return atilan;
}

// ============================================================ dosya yazimi
function sesDizini(is) { return path.join(ortak.isDizin(is), "Voice"); }

// Mevcut senaryo >50 karakterse zaman damgali yedek alir; hicbir yedek silinmez.
// Donus: yedek dosyasinin yolu ya da null.
function senaryoYedekle(is) {
  const hedef = path.join(sesDizini(is), "SESLENDIRME-TAM-METIN.txt");
  let mevcut = "";
  try { mevcut = fs.readFileSync(hedef, "utf8"); } catch (e) { return null; }
  if (mevcut.trim().length <= 50) return null;
  const yedekDizin = path.join(sesDizini(is), "yedek");
  fs.mkdirSync(yedekDizin, { recursive: true });
  let yol = path.join(yedekDizin, "SESLENDIRME-" + ortak.damga() + ".txt");
  for (let i = 2; fs.existsSync(yol); i++) yol = path.join(yedekDizin, "SESLENDIRME-" + ortak.damga() + "-" + i + ".txt");
  ortak.atomikYaz(yol, mevcut);
  return yol;
}

function senaryoYaz(is, metin, sonek) {
  const dosya = path.join(sesDizini(is), "SESLENDIRME-TAM-METIN" + (sonek || "") + ".txt");
  ortak.atomikYaz(dosya, String(metin).replace(/\s+$/, "") + "\n");
  return dosya;
}

// Bu kosuda uretilmeyen yan dosya onceki senaryodan kalmissa YANLIS bilgi verir (ornegin eski
// bolumler.json yeni metnin paragraf numaralariyla uyusmaz). Silmeyiz: yedek klasorune tasiriz.
function bayatYanDosyalariKaldir(is, adlar) {
  const ses = sesDizini(is);
  const yedek = path.join(ses, "yedek");
  const tasinan = [];
  for (const ad of adlar) {
    const yol = path.join(ses, ad);
    if (!fs.existsSync(yol)) continue;
    try {
      fs.mkdirSync(yedek, { recursive: true });
      const kok = path.basename(ad, path.extname(ad));
      fs.renameSync(yol, path.join(yedek, kok + "-" + ortak.damga() + path.extname(ad)));
      tasinan.push(ad);
    } catch (e) { /* tasinamadiysa kalsin: GO/R sha ile eslesmeyeni yok sayar */ }
  }
  return tasinan;
}

function gorselAramalariYaz(is, paragraflar, uretici) {
  const liste = [];
  paragraflar.forEach((p, no) => {
    if (p.aramalar && p.aramalar.length || p.uret) {
      const o = { no, aramalar: p.aramalar || [] };
      if (p.uret) o.uret = p.uret;
      liste.push(o);
    }
  });
  if (!liste.length) return null;
  const dosya = path.join(sesDizini(is), "gorsel-aramalari.json");
  ortak.atomikJsonYaz(dosya, {
    surum: 1,
    kaynakSenaryoSha1: ortak.paragrafOzeti(paragraflar.map(p => p.metin)),
    uretici, paragraflar: liste,
  });
  return dosya;
}

// bolumler: [{ad, paragrafBas, paragrafSon}] (kanonik indeksler)
function bolumlerYaz(is, bolumler) {
  const dosya = path.join(sesDizini(is), "bolumler.json");
  ortak.atomikJsonYaz(dosya, { surum: 1, bolumler });
  return dosya;
}

function ozetYaz(is, ozet) {
  const dosya = path.join(sesDizini(is), "aciklama-ozet.txt");
  ortak.atomikYaz(dosya, String(ozet).trim() + "\n");
  return dosya;
}

// Bolum adi: parca basina ilk 6 kelime (vidIQ yolu)
function ilkKelimeler(metin, n) {
  return String(metin).replace(/[^\p{L}\p{N}\s'’-]/gu, " ").split(/\s+/).filter(Boolean).slice(0, n || 6).join(" ");
}

// ============================================================ vidIQ `research` alani (B011)
// vidIQ semasi: research en cok 20000 karakter. Alan = "daha once islendi" listesi (kisa, SABIT butce) + kullanicinin kaynak
// metni. Sira bilincli: kesme gerekirse kaynagin SONU gider, tekrar-onleme listesi degil. Donus:
//   metin            : vidIQ'ya gidecek research
//   kaynakGonderilen : kaynak metninin vidIQ'ya GERCEKTEN giden ilk N karakteri (IDDIA raporu "kaynakta geciyor" kontrolunu
//                      yalniz bu kisma gore yapar; vidIQ'nun gormedigi kisim "guvenilir" sayilmaz)
function vidiqArastirmaKur(liste, kaynak, kap) {
  const sinir = Math.max(1, Math.floor(kap) || 20000);
  const once = String(liste || "").trim().slice(0, Math.min(2400, Math.floor(sinir / 2)));
  const k = String(kaynak || "").trim();
  if (!k) return { metin: once, kaynakGonderilen: 0 };
  const bas = (once ? once + "\n\n" : "") + "Source material from the author (primary source; stay consistent with it):\n";
  const butce = Math.max(0, sinir - bas.length);
  let kes = k;
  if (k.length > butce) {
    kes = k.slice(0, butce);
    const bosluk = kes.search(/\s\S*$/);                    // kelimeyi ortadan kesme
    if (bosluk > butce * 0.8) kes = kes.slice(0, bosluk);
    kes = kes.trim();
  }
  if (!kes) return { metin: once, kaynakGonderilen: 0 };
  return { metin: bas + kes, kaynakGonderilen: kes.length };
}

// ============================================================ trend/viral referansi (B020)
// konu._trendRapor (ya da trendRapor): "trend/2026-10-05-konu.json" gibi kok-goreli yol. Raporun
// satirlarindaki hook ve sure kaliplarini "ornek yapi" olarak prompta ekler. Yoksa/okunamazsa "".
function trendReferansi(konu) {
  const yol = konu && (konu._trendRapor || konu.trendRapor);
  if (!yol || typeof yol !== "string" || !/\.json$/i.test(yol)) return "";
  const kok = process.env.OTOMASYON_RAPOR_KOKU ? path.resolve(process.env.OTOMASYON_RAPOR_KOKU) : ortak.KOK;
  const tam = path.resolve(kok, yol);
  const izinli = ["trend", "viral-analiz"].some(d => ortak.yolIcinde(path.join(kok, d), tam));
  if (!izinli) return "";
  let j;
  try { j = JSON.parse(fs.readFileSync(tam, "utf8")); } catch (e) { return ""; }
  const satirlar = Array.isArray(j && j.satirlar) ? j.satirlar : [];
  const hooklar = satirlar.map(s => String(s.hook || "").trim()).filter(Boolean).slice(0, 4);
  const sureler = satirlar.map(s => Number(s.sureSn)).filter(n => n > 0).sort((a, b) => a - b);
  if (!hooklar.length && !sureler.length) return "";
  const ort = sureler.length ? sureler[Math.floor(sureler.length / 2)] : 0;
  const r = [];
  if (ort) r.push("Median length of the trending videos: " + ort + " seconds.");
  hooklar.forEach((h, i) => r.push("Opening pattern " + (i + 1) + ": " + h.slice(0, 200)));
  return r.join("\n");
}

module.exports = {
  kelimeSay, bosluksuzDilMi, KARAKTER_PER_KELIME, katla, dilAdi, PLATFORM_ADI, konuNotu, hedefler, sureTahmin, sureMetni,
  dilUyarisi, etiketIci, anlatimCikar, ozetCikar, gorselAramaCikar, blokTemizle, paragraflariTemizle, temizlikRaporu,
  cumleBol, kisaltmaIleBitiyor, kirpCekirdek, shortsKirp, tekrarIndeksleri, parcaGirisKapanisTemizle, govdeKirpIndeksleri,
  sesDizini, senaryoYedekle, senaryoYaz, bayatYanDosyalariKaldir, gorselAramalariYaz, bolumlerYaz, ozetYaz,
  ilkKelimeler, trendReferansi, vidiqArastirmaKur,
};
