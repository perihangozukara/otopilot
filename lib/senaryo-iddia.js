// lib/senaryo-iddia.js — senaryodaki DOGRULANABILIR iddialari cikarir ve isaretler.
//
// ONEMLI: bu bir DOGRULAMA degildir. Model (ya da yerel desen) "su cumle kontrol edilmeli"
// der; hicbir iddiayi dogru ilan etmez. Rapor bunu her satirda ve basta soyler.
//   - Claude yolu: ikinci gecis (ucuz cagri) iddialari listeler + modelin kendi RISK tahminini verir.
//   - vidIQ yolu / Claude cagrisi basarisizsa: yerel regex listesi (guven "kaynaksiz").
//   - Kullanici konu.json'a `arastirma` (kaynak metni) verdiyse iddiadaki rakam/isimler kaynakta
//     gecip gecmedigine bakilir (yerel metin eslesmesi): gecmiyorsa "dusuk".
//
// Cikti: IDDIA-RAPORU.json + IDDIA-RAPORU.md (is klasoru koku)
//   {surum:1,tarih,uretici,model,iddialar:[{no,paragraf,tur,metin,baglam,guven,not}],ozet:{toplam,dusukGuven}}
//   paragraf = KANONIK indeks (0'dan); .md'de insana 1'den yazilir.
"use strict";
const path = require("path");
const ortak = require("./ortak");
const S = require("./senaryo-ortak");

const TURLER = ["rakam", "tarih", "isim", "olay", "alinti"];
const MAKS_IDDIA = 80;

// ---------------------------------------------------------------- yerel regex listesi
const AYLAR = "january|february|march|april|may|june|july|august|september|october|november|december|ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık";
const BIRIMLER = "percent|per cent|yüzde|million|billion|trillion|thousand|milyon|milyar|trilyon|bin|km|kilometers?|kilometres?|miles?|meters?|metres?|kg|tons?|tonnes?|years?|yıl|days?|gün|hours?|saat|degrees?|derece|dollars?|euros?|dolar|lira";
const RE_RAKAM = new RegExp("\\d+(?:[.,]\\d+)*\\s?%|\\b\\d+(?:[.,]\\d+)*\\s?(?:" + BIRIMLER + ")\\b|\\b\\d{1,3}(?:[.,]\\d{3})+\\b", "giu");
const RE_YIL = /\b(?:1[0-9]{3}|20[0-9]{2})\b/g;
const RE_TARIH = new RegExp("\\b(?:\\d{1,2}\\s+(?:" + AYLAR + ")\\b(?:\\s+\\d{4})?|(?:" + AYLAR + ")\\s+\\d{1,2}(?:,?\\s+\\d{4})?)", "giu");
const RE_ALINTI = /["“«][^"”»\n]{12,200}["”»]/g;
const RE_ISIM = /\p{Lu}[\p{Ll}'’-]{2,}(?:\s+(?:(?:of|de|von|van|bin|ibn|the)\s+)?\p{Lu}[\p{Ll}'’-]{2,}){1,3}/gu;

const CUMLE_BASI = new Set(("the a an this that these those in on at it he she they we but and so then when while after before " +
  "as if once now here there bu şu o ve ama fakat çünkü sonra önce şimdi böylece").split(/\s+/));

function yerelIddialar(paragraflar) {
  const sonuc = [];
  const gorulen = new Set();
  const ekle = (paragraf, tur, cumle, eslesme) => {
    const anahtar = paragraf + "|" + tur + "|" + cumle.slice(0, 80);
    if (gorulen.has(anahtar)) return;
    gorulen.add(anahtar);
    sonuc.push({ paragraf, tur, metin: cumle.slice(0, 220), baglam: String(eslesme).trim().slice(0, 120) });
  };
  paragraflar.forEach((p, pi) => {
    for (const cumle of S.cumleBol(p)) {
      const hepsi = (re) => Array.from(cumle.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")), m => m[0]);
      for (const m of hepsi(RE_ALINTI)) ekle(pi, "alinti", cumle, m);
      for (const m of hepsi(RE_TARIH)) ekle(pi, "tarih", cumle, m);
      const yillar = hepsi(RE_YIL);
      if (yillar.length) ekle(pi, "tarih", cumle, yillar[0]);
      const rakamlar = hepsi(RE_RAKAM);
      if (rakamlar.length) ekle(pi, "rakam", cumle, rakamlar[0]);
      // ozel isimler: yan yana en az 2 buyuk harfli sozcuk; cumle basindaki siradan sozcuk ("The", "Then") sayilmaz
      const isimler = [];
      for (const m of cumle.matchAll(RE_ISIM)) {
        const sozler = m[0].trim().split(/\s+/);
        if (m.index === 0 && CUMLE_BASI.has(sozler[0].toLowerCase())) sozler.shift();
        if (sozler.length >= 2) isimler.push(sozler.join(" "));
      }
      if (isimler.length) ekle(pi, "isim", cumle, isimler[0]);
    }
  });
  return sonuc.slice(0, MAKS_IDDIA * 2).map(x => Object.assign(x, { guven: "kaynaksiz", modelRiski: null,
    not: "Yerel desen eşleşmesi: kontrol edilmeli, model doğrulaması yapılmadı." }));
}

// ---------------------------------------------------------------- Claude ikinci gecis
function iddiaIstemi(paragraflar, arastirma, dilAdi) {
  const sistem = [
    "You extract CHECKABLE FACTUAL CLAIMS from a narration script so that a human can verify them before the video is published.",
    "You do NOT verify anything yourself and you never present a claim as confirmed or true.",
    "Be precise: copy the claim as it is stated in the script.",
  ].join("\n");
  const r = ["Script language: " + dilAdi + ". Paragraphs are numbered from 1."];
  if (arastirma) r.push("", "SOURCE MATERIAL (supplied by the author; claims found in it are better supported than claims that are not):", "<kaynak>", String(arastirma).slice(0, 12000), "</kaynak>");
  r.push("", "SCRIPT:");
  paragraflar.forEach((p, i) => r.push("[" + (i + 1) + "] " + p));
  r.push("",
    "Extract every checkable factual claim: specific numbers, dates and years, named people, places or organisations tied to an event,",
    "events that supposedly happened, causal claims stated as fact, and quotes. Skip opinions, rhetorical lines and common knowledge nobody disputes.",
    "For each claim give your OWN estimate of how likely it is to be wrong or hard to verify:",
    "\"yuksek\" = a precise figure, date, quote or attribution that is easy to get wrong; \"orta\"; \"dusuk\" = very well known.",
    "At most " + MAKS_IDDIA + " claims; prefer the riskiest ones. Return ONLY JSON, no markdown fence:",
    "{\"iddialar\":[{\"paragraf\":3,\"tur\":\"rakam|tarih|isim|olay|alinti\",\"metin\":\"the claim, max 200 chars\",",
    "\"baglam\":\"the exact words from the paragraph, max 120 chars\",\"risk\":\"dusuk|orta|yuksek\",",
    "\"not\":\"what to check and where, max 160 chars, written in Turkish\"}]}");
  return { sistem, istek: r.join("\n") };
}

// Token sinirinda KESILEN yanittan, "iddialar" dizisindeki TAMAMLANMIS nesneleri kurtarir (eksik son nesne atilir).
// Dizeleri/kacislari izleyen sayac kullanir: metin icindeki { } karakterleri sayimi bozmaz.
function kesikIddialariKurtar(ham) {
  const anahtar = /"iddialar"\s*:\s*\[/.exec(ham);
  if (!anahtar) return null;
  const liste = [];
  let derinlik = 0, dizede = false, kacis = false, bas = -1;
  for (let i = anahtar.index + anahtar[0].length; i < ham.length; i++) {
    const c = ham[i];
    if (dizede) {
      if (kacis) kacis = false;
      else if (c === "\\") kacis = true;
      else if (c === "\"") dizede = false;
      continue;
    }
    if (c === "\"") { dizede = true; continue; }
    if (c === "{") { if (derinlik === 0) bas = i; derinlik++; }
    else if (c === "}") {
      derinlik--;
      if (derinlik === 0 && bas >= 0) {
        try { liste.push(JSON.parse(ham.slice(bas, i + 1))); } catch (e) { /* bozuk nesne: atla */ }
        bas = -1;
      } else if (derinlik < 0) break;
    } else if (c === "]" && derinlik === 0) break;
  }
  return liste.length ? { iddialar: liste } : null;
}

// Donus: {liste, kurtarildi} | null. kurtarildi=true: yanit kesikti, yalniz tamamlanan iddialar alindi.
function modelIddialariniCozDetay(metin, paragrafSayisi) {
  let ham = String(metin || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const ilk = ham.indexOf("{"), son = ham.lastIndexOf("}");
  if (ilk < 0) return null;
  let j = null, kurtarildi = false;
  if (son > ilk) { try { j = JSON.parse(ham.slice(ilk, son + 1)); } catch (e) { /* kesik olabilir: asagida kurtarilir */ } }
  if (!j) { j = kesikIddialariKurtar(ham.slice(ilk)); kurtarildi = !!j; }
  if (!j || !Array.isArray(j.iddialar)) return null;
  return { liste: iddialariSuz(j.iddialar, paragrafSayisi), kurtarildi };
}

function modelIddialariniCoz(metin, paragrafSayisi) {
  const d = modelIddialariniCozDetay(metin, paragrafSayisi);
  return d ? d.liste : null;
}

function iddialariSuz(iddialar, paragrafSayisi) {
  const cikti = [];
  for (const x of iddialar) {
    if (!x || typeof x !== "object") continue;
    const p = Number(x.paragraf);
    const metinX = String(x.metin || "").replace(/\s+/g, " ").trim();
    if (!metinX || !Number.isInteger(p) || p < 1 || p > paragrafSayisi) continue;
    cikti.push({
      paragraf: p - 1,
      tur: TURLER.includes(x.tur) ? x.tur : "olay",
      metin: metinX.slice(0, 220),
      baglam: String(x.baglam || "").replace(/\s+/g, " ").trim().slice(0, 120),
      modelRiski: ["dusuk", "orta", "yuksek"].includes(x.risk) ? x.risk : "orta",
      not: String(x.not || "").replace(/\s+/g, " ").trim().slice(0, 200),
    });
    if (cikti.length >= MAKS_IDDIA) break;
  }
  return cikti;
}

// ---------------------------------------------------------------- kaynakla yerel eslesme
// Eslesme YEREL ve basittir (dogrulama degil); ama yanlis "kaynakta geciyor" vermemesi icin:
//   - sayilar yalniz SAYI SINIRINDA eslesir ('5', kaynaktaki '2015' icinde bulunmus sayilmaz; '3.5' icindeki '5' de),
//   - sayi, iddianin baska bir anlamli kelimesiyle YAKIN (+-120 karakter) gecmiyorsa sayilmaz (kaynakta 'bolum 5' var diye
//     'savas 5 yil surdu' dogrulanmis olmaz),
//   - cumle basinda buyuk yazilan siradan sozcukler ("The", "May", "Bu", "Sonra") ozel isim sayilmaz,
//   - aksan/Turkce harf farki yok sayilir (Istanbul = İstanbul).
const katliKucuk = s => S.katla(String(s == null ? "" : s).normalize("NFD").replace(/\p{M}+/gu, "")).toLowerCase();
const sayiNormal = s => String(s).replace(/(\d)[.,](?=\d{3}(?!\d))/g, "$1").replace(/(\d),(?=\d)/g, "$1.");
function kaynakNormal(s) { return sayiNormal(katliKucuk(s)); }
const kacis = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SIRADAN = new Set(("the a an this that these those then when while after before however but and also one its his her their our " +
  "they she he we you there here once now since because although though during according many some most several each every only even " +
  "such with without from into over under about around between among within may can will would could should might must did does was were " +
  "has had have not yet still soon later today yesterday tomorrow in on at as if so or it " +
  "bu şu o ve ama fakat çünkü sonra önce şimdi böylece ancak ayrıca ardından her bazı çok daha hiç bütün tüm yani hatta üstelik oysa ise " +
  "bir iki ilk son ne nasıl neden kim hangi bugün dün yarın").split(/\s+/).map(katliKucuk));

// Iddiadan kontrol edilecek parcalar: {sayilar:[], isimler:[], baglam:[]}
function iddiaParcalari(iddia) {
  const ham = sayiNormal(String(iddia.metin || "") + " " + String(iddia.baglam || ""));
  const sayilar = [...new Set(Array.from(ham.matchAll(/\d+(?:\.\d+)?/g), m => m[0]))];
  const isimler = [...new Set(Array.from(ham.matchAll(/\p{Lu}[\p{Ll}'’-]{2,}/gu), m => katliKucuk(m[0])).filter(t => !SIRADAN.has(t)))];
  // yakinlik kelimeleri: bosluklu yazilarda (Latin/Kiril/Yunan) 4+ harfli anlamli sozcukler; bosluksuz yazida bos (yakinlik aranmaz)
  const baglam = [...new Set(katliKucuk(ham).match(/[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]{4,}/gu) || [])]
    .filter(w => !SIRADAN.has(w)).slice(0, 10);
  return { sayilar, isimler, baglam };
}

function sayiKaynaktaMi(norm, sayi, baglam) {
  const re = new RegExp("(?<!\\d|\\d[.,])" + kacis(sayi) + "(?!\\d|[.,]\\d)", "g");
  for (const m of norm.matchAll(re)) {
    if (!baglam.length) return true;
    const pencere = norm.slice(Math.max(0, m.index - 120), m.index + m[0].length + 120);
    if (baglam.some(w => pencere.includes(w))) return true;
  }
  return false;
}
// Ozel isim: sozcuk basi siniri yeter (Turkce ekler: Roma'nin, Romalilar); 'chrome' icindeki 'rome' sayilmaz
const isimKaynaktaMi = (norm, isim) => new RegExp("(?<![\\p{L}\\p{N}])" + kacis(isim), "u").test(norm);

// iddiadaki rakam ve ozel isimlerin kaynakta gecme orani. Kontrol edilecek bir sey yoksa null.
function kaynakOrani(iddia, arastirmaNormal) {
  const p = iddiaParcalari(iddia);
  const toplam = p.sayilar.length + p.isimler.length;
  if (!toplam) return null;
  let bulunan = 0;
  for (const s of p.sayilar) if (sayiKaynaktaMi(arastirmaNormal, s, p.baglam)) bulunan++;
  for (const i of p.isimler) if (isimKaynaktaMi(arastirmaNormal, i)) bulunan++;
  return bulunan / toplam;
}

// guven: yuksek|orta|dusuk|kaynaksiz  — "yuksek" = KAYNAK METNINDE geciyor (dogru oldugunun kaniti degil)
function guvenAta(iddialar, arastirma) {
  const kaynakVar = !!(arastirma && String(arastirma).trim().length > 40);
  const norm = kaynakVar ? kaynakNormal(arastirma) : "";
  return iddialar.map((x, i) => {
    const o = Object.assign({}, x, { no: i + 1 });
    if (!kaynakVar) { o.guven = "kaynaksiz"; return o; }
    const oran = kaynakOrani(o, norm);
    if (oran === null) o.guven = o.modelRiski === "yuksek" ? "dusuk" : "orta";
    else if (oran >= 0.99) { o.guven = "yuksek"; o.not = ((o.not ? o.not + " " : "") + "(Kaynak metinde geçiyor.)").trim(); }
    else if (oran >= 0.5) o.guven = "orta";
    else { o.guven = "dusuk"; o.not = ((o.not ? o.not + " " : "") + "(Verilen kaynak metinde bulunamadı.)").trim(); }
    return o;
  });
}

// arastirma: kontrolde kullanilacak kaynak metni (vidIQ yolunda: vidIQ'ya GERCEKTEN giden kisim).
// kaynakKirpildi (ops.): {toplam, gorulen} — kaynak uretici motora tam gitmediyse rapora not dusulur.
function rapor(uretici, model, iddialar, arastirma, kaynakKirpildi) {
  const liste = guvenAta(iddialar, arastirma);
  const dusuk = liste.filter(x => x.guven === "dusuk" || (x.guven !== "yuksek" && x.modelRiski === "yuksek")).length;
  const kirpik = kaynakKirpildi && kaynakKirpildi.toplam > kaynakKirpildi.gorulen
    ? { toplam: kaynakKirpildi.toplam, gorulen: kaynakKirpildi.gorulen } : null;
  return Object.assign({
    surum: 1, tarih: new Date().toISOString(), uretici, model: model || "",
    kaynakMetniVar: !!(arastirma && String(arastirma).trim().length > 40),
    iddialar: liste.map(x => ({ no: x.no, paragraf: x.paragraf, tur: x.tur, metin: x.metin, baglam: x.baglam,
      guven: x.guven, modelRiski: x.modelRiski || null, not: x.not || "" })),
    ozet: { toplam: liste.length, dusukGuven: dusuk },
  }, kirpik ? { kaynakKirpildi: kirpik } : {});
}

// ---------------------------------------------------------------- .md
const GUVEN_ETIKET = { yuksek: "kaynakta geçiyor", orta: "kısmen kaynakta", dusuk: "DÜŞÜK", kaynaksiz: "kaynaksız" };
const RISK_ETIKET = { yuksek: "yüksek", orta: "orta", dusuk: "düşük" };
const hucre = s => String(s == null ? "" : s).replace(/\|/g, "/").replace(/\s+/g, " ");

function raporMd(is, r) {
  const sat = [];
  sat.push("# İddia raporu — " + is, "");
  sat.push("> Bu liste DOĞRULAMA DEĞİLDİR. Hiçbir iddia doğru ilan edilmedi; yalnızca videoyu yayınlamadan önce");
  sat.push("> bir insanın kontrol etmesi gereken rakam, tarih, isim, olay ve alıntılar çıkarıldı.");
  sat.push("> Üretici: " + r.uretici + (r.model ? " (" + r.model + ")" : "") +
    (r.uretici === "yerel" ? " — yalnızca desen eşleşmesi, model kullanılmadı." : " — risk sütunu modelin kendi tahminidir."));
  sat.push(r.kaynakMetniVar
    ? "> Kaynak metni verildi: \"güven\" sütunu, iddiadaki rakam/isimlerin o metinde geçip geçmediğini gösterir (doğruluk kanıtı değil)."
    : "> Kaynak metni verilmedi: tüm iddialar \"kaynaksız\" sayıldı. Yeni videoda 'Kaynak / araştırma metni' alanını doldurmak riski düşürür.");
  if (r.kaynakKirpildi)
    sat.push("> Kaynak metni " + r.kaynakKirpildi.toplam + " karakter; senaryoyu yazan motora yalnızca ilk " + r.kaynakKirpildi.gorulen +
      " karakteri gönderilebildi. \"Güven\" sütunu yalnız o kısma göre hesaplandı; kaynağın geri kalanında geçen bilgiler \"kaynakta geçiyor\" sayılmadı.");
  if (r.listeKesik)
    sat.push("> Modelin iddia listesi uzunluk sınırında kesildi: yalnızca tamamlanan iddialar listelendi, liste eksik olabilir.");
  sat.push("");
  sat.push("Toplam **" + r.ozet.toplam + "** iddia, bunların **" + r.ozet.dusukGuven + "** tanesi öncelikli kontrol gerektiriyor.", "");
  const sirala = x => (x.guven === "dusuk" ? 0 : x.modelRiski === "yuksek" ? 1 : x.guven === "kaynaksiz" ? 2 : x.guven === "orta" ? 3 : 4);
  const sirali = r.iddialar.slice().sort((a, b) => sirala(a) - sirala(b) || a.paragraf - b.paragraf);
  if (!sirali.length) { sat.push("Kontrol edilecek bir iddia bulunamadı.", ""); return sat.join("\n"); }
  sat.push("| No | Paragraf | Tür | İddia | Güven | Risk | Not |", "|---|---|---|---|---|---|---|");
  for (const x of sirali)
    sat.push("| " + x.no + " | " + (x.paragraf + 1) + " | " + x.tur + " | " + hucre(x.metin) + " | " + (GUVEN_ETIKET[x.guven] || x.guven) +
      " | " + (x.modelRiski ? RISK_ETIKET[x.modelRiski] : "-") + " | " + hucre(x.not) + " |");
  sat.push("", "_Paragraf numarası 1'den başlar (senaryo dosyasındaki sıra)._", "");
  return sat.join("\n");
}

function raporYaz(is, r) {
  const dizin = ortak.isDizin(is);
  ortak.atomikJsonYaz(path.join(dizin, "IDDIA-RAPORU.json"), r);
  ortak.atomikYaz(path.join(dizin, "IDDIA-RAPORU.md"), raporMd(is, r));
  return { json: path.join(dizin, "IDDIA-RAPORU.json"), md: path.join(dizin, "IDDIA-RAPORU.md") };
}

module.exports = { TURLER, yerelIddialar, iddiaIstemi, modelIddialariniCoz, modelIddialariniCozDetay, guvenAta, rapor, raporMd, raporYaz,
  kaynakOrani, kaynakNormal };
