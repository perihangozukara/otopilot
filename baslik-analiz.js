// baslik-analiz.js <is> [--on] [--yeniden]
// vidIQ ile BASLIK PUANLAMA + ANAHTAR KELIME ARASTIRMASI.
//
//   --on        yalniz puan + alternatif basliklar (SENARYODAN ONCE calistirilir: puan dusukse
//               senaryoya para harcamadan baslik degistirilir). Etiket/kelime arastirmasi YAPILMAZ.
//   (bayraksiz) tam calisma: puan + alternatifler + anahtar kelimeler + etiketler. Ayni baslik icin
//               --on sonucu varsa tekrar kredi harcamaz (--yeniden ile zorlanir).
//
// Cikti: BASLIK-VE-ETIKETLER.md (okunur) + baslik.json (panel icin):
//   {surum:1,tarih,dil,mevcut:{baslik,puan},alternatifler:[{baslik,puan}],
//    anahtarKelimeler:[{kelime,hacim,rekabet,skor}],etiketler:[...],tohum}
// konu.json'a ASLA yazmaz (tek yazar panel); baslik secimi panelin /api/baslik-sec ucuyla yapilir.
//
// Cikis kodlari: 0 tamam | 2 vidIQ anahtari yok | 3 vidIQ hatasi (anahtar, kredi, ag) | 6 kilit
//   (panelde bu adim istege baglidir: hata verse de video uretimi surer.)
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./lib/ortak");
const S = require("./lib/senaryo-ortak");
const K = require("./lib/senaryo-kullanim");
const { VidiqIstemci } = require("./lib/vidiq");

const { OrtakHata, CIKIS } = ortak;
const BETIK = "baslik-analiz.js";

// ---------- tohum (anahtar kelime) cikarimi: DIL DUYARLI ----------
// Durak listesi GENIS olmali. Dar tutulunca senaryonun en sik kelimeleri "not than" gibi anlamsiz
// bir tohum uretiyor, vidIQ da anlamsiz tohuma o anki trendi donduruyor.
const DURAK_EN = ("the a an and or of in on to for is are was were be been being how why what when where " +
  "this that these those with without within from into onto over under about across through " +
  "i we you it its it's my your our their them they he she his her him us me " +
  "just now new best top gave asked found here there then than not no nor so but yet " +
  "s did does do done doing did can could would should will shall may might must " +
  "have has had having get gets got make makes made made take takes took " +
  "one two three first second last next each every all any some many much more most " +
  "very only also even still much less least own same other another such both either neither " +
  "because since while during before after again once ever never always often sometimes " +
  "thing things something anything nothing everything way ways lot lots kind sort " +
  "who whom whose which whether if unless until than as at by out up down off " +
  "like likes look looks say says said see sees seen know knows known think thinks " +
  "come comes came go goes went want wants use uses used using").split(/\s+/);
const DURAK_TR = ("ve veya ile için gibi kadar daha çok çoğu bir iki üç bu şu o bunu şunu onu bunun onun neden nasıl hangi " +
  "ne zaman nerede kim kimin mı mi mu mü değil var yok olarak olan oldu olur olmuş olacak ise ama fakat çünkü ki da de " +
  "sadece bile her hiç hep artık şimdi sonra önce tüm bütün başka diğer bazı biraz çok az en gerçek aslında yani " +
  "dir dır tir tır idi imiş mış miş ben sen biz siz onlar benim senin bizim sizin").split(/\s+/);
const DURAK_ES = ("el la los las un una unos unas de del y o en con por para como que es son fue ser este esta estos estas " +
  "mas muy pero si no su sus al lo le les se me te nos").split(/\s+/);
const DURAK_DE = ("der die das ein eine einen und oder von mit fur für auf in im zu zum zur ist sind war wie was warum " +
  "nicht aber auch dass den dem des sich es er sie wir ihr ich du").split(/\s+/);
const DURAK_FR = ("le la les un une des et ou de du en dans pour par sur avec que qui est sont etait ete comment pourquoi " +
  "pas mais aussi ce cet cette ces se ne il elle nous vous ils elles je tu").split(/\s+/);
const DURAKLAR = { en: new Set(DURAK_EN), tr: new Set(DURAK_TR), es: new Set(DURAK_ES), de: new Set(DURAK_DE), fr: new Set(DURAK_FR) };

// Bunlar hemen her senaryoda gecer, dolayisiyla ALAKA KANITI SAYILMAZ.
const COKGENEL_EN = ("world people person time times life live living day days year years " +
  "man men woman women boy girl home house work money god war story full episode official " +
  "video trailer lyrics song music tiktok shorts funny reaction vlog channel subscribe " +
  "part place point number thing name today tomorrow yesterday history future past").split(/\s+/);
const COKGENEL_TR = ("dünya insan insanlar zaman hayat gün yıl adam kadın ev iş para tanrı savaş hikaye tam bölüm resmi " +
  "video fragman şarkı müzik komik tepki kanal abone parça yer nokta sayı isim bugün yarın dün tarih gelecek geçmiş").split(/\s+/);
const COKGENEL = { en: new Set(COKGENEL_EN), tr: new Set(COKGENEL_TR) };

const ULKE = { tr: "TR", de: "DE", fr: "FR", es: "ES", it: "IT", pt: "BR", ja: "JP", ko: "KR", ru: "RU" };

const kucukHarf = (m, dil) => dil === "tr" ? String(m).toLocaleLowerCase("tr") : String(m).toLowerCase();
function sozcuk(m, dil) {
  const durak = DURAKLAR[dil] || DURAKLAR.en;
  return kucukHarf(m, dil).replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/).filter(w => w.length > 2 && !durak.has(w) && !/^\d+$/.test(w));
}

// Tohumlar genelden ozele. Ingilizce videoda Turkce karakterli (konu notundan gelen) tohum elenir:
// Turkce tohum vidIQ'ya Turkce YouTube'u aratip alakasiz kelimeler donduruyordu. Baska dillerde bu
// kisit YOKTUR (kanalin dili ne ise tohum da odur).
function tohumlariKur(baslik, senaryo, notKonu, dil) {
  const TR = /[çğıöşüÇĞİÖŞÜ]/;
  const uygun = s => s && (dil !== "en" || !TR.test(s));
  const bs = sozcuk(baslik, dil);
  let senaryoKelime = [];
  if (senaryo) {
    const say = {};
    for (const w of sozcuk(senaryo, dil)) say[w] = (say[w] || 0) + 1;
    senaryoKelime = Object.keys(say).sort((a, b) => say[b] - say[a]).slice(0, 6);
  }
  const tohumlar = [...new Set([
    bs.slice(0, 2).join(" "),                    // basliktan iki kelime
    senaryoKelime.slice(0, 2).join(" "),         // senaryonun en sik iki kelimesi
    bs[0] || "", senaryoKelime[0] || "",         // tek kelime: en genis
    dil === "en" ? (uygun(notKonu) ? sozcuk(notKonu, dil).slice(0, 2).join(" ") : "") : sozcuk(notKonu, dil).slice(0, 2).join(" "),
  ].filter(t => t && t.length > 2 && uygun(t)))];
  // Videonun kendi kelime dagarcigi: donen etiketlerin alakasini olcmek icin
  const dagarcik = new Set([...bs, ...senaryoKelime]);
  if (senaryo) for (const w of sozcuk(senaryo, dil)) dagarcik.add(w);
  return { tohumlar, dagarcik };
}

// vidIQ anlamsiz tohuma o anki trendi donduruyor. Donen listenin gercekten bu videoyla ilgili olup
// olmadigina bakilir: etiketlerin en az ucte biri, TOHUM DISINDA, videonun dagarciginda gecmeli.
function alakaliMi(liste, tohum, dagarcik, dil) {
  const metin = liste.map(x => (x && (x.keyword || x.query || x.text || x.name)) || String(x));
  if (!metin.length) return false;
  const tohumKel = new Set(sozcuk(tohum, dil));
  const genel = COKGENEL[dil] || new Set();
  const kanit = t => sozcuk(t, dil).some(w => !tohumKel.has(w) && !genel.has(w) && dagarcik.has(w));
  return metin.filter(kanit).length / metin.length >= 0.34;
}

const sayiOku = (x) => (typeof x === "number" && isFinite(x) ? x : null);
function puanOku(p) {
  if (p === null || p === undefined) return null;
  if (typeof p === "number") return p;
  if (typeof p === "object") return sayiOku(p.score ?? p.overallScore ?? p.overall_score);
  return null;
}
function alternatifListesi(a) {
  const liste = Array.isArray(a) ? a : (a && (a.titles || a.suggestions || a.results)) || [];
  return liste.map(t => {
    if (typeof t === "string") return { baslik: t.trim(), puan: null };
    if (!t || typeof t !== "object") return null;
    return { baslik: String(t.title || t.text || "").trim(), puan: sayiOku(t.score ?? t.overallScore ?? t.overall_score) };
  }).filter(x => x && x.baslik).sort((x, y) => (y.puan ?? -1) - (x.puan ?? -1));
}
function kelimeSatiri(w) {
  const kelime = String((w && (w.keyword || w.term || w.text || w.name)) || (typeof w === "string" ? w : "")).trim();
  return { kelime, hacim: w && (w.searchVolume ?? w.volume) !== undefined ? (w.searchVolume ?? w.volume) : null,
    rekabet: w && w.competition !== undefined ? w.competition : null,
    skor: w && (w.score ?? w.overallScore) !== undefined ? (w.score ?? w.overallScore) : null };
}
// YouTube etiket siniri: toplam 500 karakter
function etiketleriKes(kelimeler) {
  const cikti = []; let n = 0;
  for (const k of kelimeler) {
    if (!k || n + k.length + 2 > 500) break;
    cikti.push(k); n += k.length + 2;
  }
  return cikti;
}

function mdKur(is, j) {
  const sat = ["# Başlık ve etiket analizi", "", "İş: " + is + " · Dil: " + j.dil + " · " + j.tarih.slice(0, 10), ""];
  sat.push("## Mevcut başlık", "", "**" + j.mevcut.baslik + "**", "",
    "Puan: **" + (j.mevcut.puan !== null ? j.mevcut.puan : "?") + "** (0-100, tıklanma potansiyeli)", "");
  if (j.alternatifler.length) {
    sat.push("## Alternatif başlıklar", "", "| Puan | Başlık |", "|---|---|");
    for (const a of j.alternatifler) sat.push("| " + (a.puan !== null ? a.puan : "-") + " | " + a.baslik.replace(/\|/g, "/") + " |");
    sat.push("", "_Bir başlığı kullanmak için panelde ilgili işin 'Başlık ve etiketler' kartından seç._", "");
  }
  if (j.anahtarKelimeler.length) {
    sat.push("## Anahtar kelimeler", "", "_Arama tohumu: **" + j.tohum + "**_", "", "| Kelime | Arama | Rekabet | Skor |", "|---|---|---|---|");
    for (const w of j.anahtarKelimeler) sat.push("| " + w.kelime.replace(/\|/g, "/") + " | " + (w.hacim ?? "-") + " | " + (w.rekabet ?? "-") + " | " + (w.skor ?? "-") + " |");
    sat.push("", "### Etiketler (YouTube'a yapıştır)", "", "```", j.etiketler.join(", "), "```", "");
  }
  return sat.join("\n");
}

async function ana(argv, secenek) {
  secenek = secenek || {};
  const { konum, bayrak } = ortak.argumanCoz(argv, {});
  const is = konum[0];
  if (!is) throw new OrtakHata("arguman", "Kullanım: node baslik-analiz.js <is-adi> [--on]", { cikis: CIKIS.GIRDI });
  const dizin = ortak.isDizin(is);
  if (!fs.existsSync(dizin)) throw new OrtakHata("is_yok", "İş bulunamadı: " + is, { cikis: CIKIS.GIRDI, cozum: "Önce panelden yeni video oluştur." });
  ortak.kilitAl(is, BETIK);
  try { return await calis(is, dizin, !!bayrak.on, !!bayrak.yeniden, secenek); } finally { ortak.kilitBirak(is); }
}

async function calis(is, dizin, onModu, yeniden, secenek) {
  const konu = ortak.konuEtkin(is);
  if (!konu) throw new OrtakHata("konu_yok", "konu.json yok: " + is, { cikis: CIKIS.GIRDI });
  const anahtar = ortak.envOku("VIDIQ_KEY");
  if (!anahtar && !secenek.vidiq)
    throw new OrtakHata("vidiq_anahtar", "VIDIQ_KEY yok; başlık analizi yapılamadı (zorunlu değil).", { cikis: CIKIS.GIRDI,
      cozum: "İstersen Kaynaklar sekmesine vidIQ anahtarı ekle (app.vidiq.com/account/settings/mcp)." });

  const dil = konu.dil;
  const baslik = konu.baslik_en || is;
  const notKonu = S.konuNotu(konu).slice(0, 400);
  const tur = konu.dikey ? "short" : "long";
  const vidiq = secenek.vidiq || new VidiqIstemci(anahtar, secenek.vidiqSecenek);
  const onceki = await K.vidiqBakiye(vidiq);
  let cagri = 0;

  const jsonYol = path.join(dizin, "baslik.json");
  let eski = null;
  try { eski = ortak.jsonOku(jsonYol, null); } catch (e) { eski = null; }
  // Tam calisma zaten yapilmissa (ayni baslik, kelimeler var, senaryodan YENI) tekrar kredi harcama
  if (!onModu && !yeniden && eski && eski.mevcut && eski.mevcut.baslik === baslik && Array.isArray(eski.anahtarKelimeler) && eski.anahtarKelimeler.length) {
    let guncel = true;
    try { guncel = fs.statSync(jsonYol).mtimeMs >= fs.statSync(path.join(dizin, "Voice", "SESLENDIRME-TAM-METIN.txt")).mtimeMs; } catch (e) { /* senaryo yok: guncel say */ }
    if (guncel) {
      console.log("Başlık ve etiket analizi güncel (baslik.json); kredi harcanmadı. Zorlamak için --yeniden.");
      ortak.sonuc({ atlandi: true, neden: "başlık analizi güncel" });
      return { atlandi: true };
    }
  }
  const j = { surum: 1, tarih: new Date().toISOString(), dil, mevcut: { baslik, puan: null }, alternatifler: [],
    anahtarKelimeler: [], etiketler: [], tohum: null };

  // 1) mevcut basligi puanla + 2) alternatifler. --on ile yapilmis ayni baslik sonucu varsa kullan.
  if (!yeniden && eski && eski.mevcut && eski.mevcut.baslik === baslik && Array.isArray(eski.alternatifler) && eski.alternatifler.length) {
    j.mevcut = eski.mevcut; j.alternatifler = eski.alternatifler;
    console.log("başlık puanı ve alternatifler önceki çalışmadan alındı (kredi harcanmadı).");
  } else {
    console.log("başlık puanlanıyor: " + baslik);
    try {
      cagri++;
      j.mevcut.puan = puanOku(await vidiq.cagir("vidiq_score_title", { title: baslik, type: tur }));
      console.log("  puan: " + (j.mevcut.puan !== null ? j.mevcut.puan : "okunamadı"));
    } catch (e) { if (e.kod === "vidiq_anahtar" || e.kod === "vidiq_kredi") throw e; ortak.uyari("Başlık puanlama olmadı: " + e.message); }

    console.log("alternatif başlıklar üretiliyor…");
    try {
      cagri++;
      // videoId/title/description'dan en az biri sart: baslik + konuyu veriyoruz
      const a = await vidiq.cagir("vidiq_generate_titles", {
        title: baslik, description: notKonu || undefined, type: tur, numTitles: 8, language: dil,
      });
      j.alternatifler = alternatifListesi(a).slice(0, 12);
      for (const t of j.alternatifler) console.log("  " + (t.puan !== null ? "[" + t.puan + "] " : "") + t.baslik);
    } catch (e) { if (e.kod === "vidiq_anahtar" || e.kod === "vidiq_kredi") throw e; ortak.uyari("Başlık üretimi olmadı: " + e.message); }
  }

  if (j.mevcut.puan !== null && j.mevcut.puan < 50) {
    const iyi = j.alternatifler.filter(a => a.puan !== null && a.puan > j.mevcut.puan);
    if (iyi.length) ortak.uyari("Başlık puanı düşük (" + j.mevcut.puan + "). Daha yüksek puanlı alternatif var: \"" + iyi[0].baslik + "\" (" + iyi[0].puan + ").");
  }

  // 3) anahtar kelime arastirmasi (yalniz tam calismada). On modda ayni basliga ait eski kelimeler korunur.
  if (onModu && eski && eski.mevcut && eski.mevcut.baslik === baslik) {
    if (Array.isArray(eski.anahtarKelimeler)) j.anahtarKelimeler = eski.anahtarKelimeler;
    if (Array.isArray(eski.etiketler)) j.etiketler = eski.etiketler;
    if (eski.tohum) j.tohum = eski.tohum;
  }
  if (!onModu) {
    let senaryo = "";
    try { senaryo = fs.readFileSync(path.join(dizin, "Voice", "SESLENDIRME-TAM-METIN.txt"), "utf8"); } catch (e) { /* senaryo henuz yok */ }
    const { tohumlar, dagarcik } = tohumlariKur(baslik, senaryo, notKonu, dil);
    let bulunanListe = [];
    for (const tohum of tohumlar) {
      console.log("anahtar kelimeler araştırılıyor: \"" + tohum + "\"");
      try {
        cagri++;
        const arg = { mode: "research", keyword: tohum.slice(0, 150), includeRelated: true };
        if (ULKE[dil]) arg.country = ULKE[dil];
        const k = await vidiq.cagir("vidiq_keyword_research", arg);
        const bulunan = Array.isArray(k) ? k : (k && (k.relatedKeywords || k.keywords || k.results)) || [];
        if (bulunan.length && !alakaliMi(bulunan, tohum, dagarcik, dil)) {
          console.log("  " + bulunan.length + " kelime döndü ama konuyla alakasız — atlandı");
          continue;
        }
        if (bulunan.length) { bulunanListe = bulunan; j.tohum = tohum; break; }
        console.log("  sonuç yok, daha genel tohum deneniyor…");
      } catch (e) {
        if (e.kod === "vidiq_anahtar" || e.kod === "vidiq_kredi") throw e;
        console.log("  olmadı: " + String(e.message).slice(0, 80));
      }
    }
    if (!bulunanListe.length) console.log("anahtar kelime bulunamadı — etiketleri elle yaz.");
    j.anahtarKelimeler = bulunanListe.slice(0, 25).map(kelimeSatiri).filter(w => w.kelime);
    j.etiketler = etiketleriKes(j.anahtarKelimeler.slice(0, 20).map(w => w.kelime));
    if (j.anahtarKelimeler.length) console.log("  " + j.anahtarKelimeler.length + " kelime bulundu");
  }

  ortak.atomikJsonYaz(jsonYol, j);
  ortak.atomikYaz(path.join(dizin, "BASLIK-VE-ETIKETLER.md"), mdKur(is, j));
  const kr = await K.vidiqKullanimKaydet(is, vidiq, onceki, BETIK, cagri * 5, cagri + " çağrı" + (onModu ? " (ön analiz)" : ""));
  console.log("");
  console.log("✓ BASLIK-VE-ETIKETLER.md ve baslik.json yazıldı" + (onModu ? " (ön analiz: etiket araştırması yapılmadı)" : ""));
  console.log("  vidIQ kredisi: ~" + kr.kredi + (kr.kalan !== null ? " (kalan " + kr.kalan + ")" : ""));
  const sonuc = { on: onModu, puan: j.mevcut.puan, alternatif: j.alternatifler.length, etiket: j.etiketler.length, kredi: kr.kredi };
  ortak.sonuc(sonuc);
  return sonuc;
}

module.exports = { ana, sozcuk, tohumlariKur, alakaliMi, puanOku, alternatifListesi, kelimeSatiri, etiketleriKes, mdKur };

if (require.main === module) ana(process.argv.slice(2)).catch(ortak.bitir);
