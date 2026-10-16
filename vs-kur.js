// VS ISLERINI KURAR: vs.json yazar + gorselleri indirir (uretim/<is>/Images/ust.jpg, alt.jpg).
// Kullanim: node vs-kur.js                 (vs-tanim.json olan tum isler + gomulu ornek)
//           node vs-kur.js 103 105          (yalniz bu isler)
//           node vs-kur.js <is> --yeniden   (gorselleri yeniden sec; su anki gorsel tekrar secilmez)
//
// Is TANIMI: uretim/<is>/vs-tanim.json (panelde VS ekrani yazar) — vs.json bicimi + her tarafta arama alanlari:
//   "ust": { "ad": "POLAR BEAR", "renk": "3BE07A", "ara": "polar bear arctic snow",
//            "zorunlu": ["polar", "bear"],               <- aday metninde EN AZ BIRI gecmeli (verilmezse ilk 2 kelime)
//            "sorgular": ["polar bear wild", "..."] }    <- yedek sorgular, sirayla denenir
// vs-tanim.json yoksa asagidaki gomulu ISLER dizisine bakilir. vs.json'a arama alanlari YAZILMAZ.
//
// Gorsel secimi: Pexels/Pixabay (anahtar varsa), Wikimedia, Openverse; lisans suzgeci (NC/ND elenir), tur filtresi
// (heykel/oyuncak/cizim/kostum elenir, zorunlu kelime sart), kadraja (~1.1:1) en uygun gorsel. Yazar/lisans
// Images/kaynak.json ve ATIF.txt'ye yazilir. Hicbir aday bulunamazsa exit 4.
// Cekirdek: lib/gorsel-vs.js
// Ilerleme: taraf (ust/alt) basina @@ILERLEME (n/toplam). Icerigi uygunsuz cikan adaylar bir kez indirilir, taraflar arasi
// yeniden indirilmez.
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./lib/ortak.js");
const vs = require("./lib/gorsel-vs.js");
const man = require("./lib/gorsel-manifest.js");

const OrtakHata = ortak.OrtakHata;

// ---------------------------------------------------------------------------
// GOMULU ORNEK ESLESMELER (vs-tanim.json'u olmayan isler icin)
// Kendi konularini vs-tanim.json ile (panelden) ya da buraya ekleyebilirsin. Her olcu icin:
//   ustDeger / altDeger : sayisal deger (bar uzunlugu bundan hesaplanir)
//   ustMetin / altMetin : ekranda gorunen metin
//   kazanan             : o turu kim kazaniyor ("ust" | "alt")
//   not                 : plakette gorunen tek satirlik not
//   ara / zorunlu / sorgular : gorsel arama (yukaridaki aciklama)
// Sayilari kendin dogrula — ekranda yazan her sey iddiadir.
// ---------------------------------------------------------------------------
const ISLER = [
  { id: "ornek-1", baslik: "OPTION A vs OPTION B",
    ust: { ad: "OPTION A", renk: "3BE07A", ara: "mountain landscape" },
    alt: { ad: "OPTION B", renk: "FFB020", ara: "desert landscape" },
    olculer: [
      { ad: "HEIGHT",   ustDeger: 8848, ustMetin: "8848 m", altDeger: 0,  altMetin: "sea level", kazanan: "ust", not: "highest point on land" },
      { ad: "AREA",     ustDeger: 1,    ustMetin: "small",  altDeger: 9,  altMetin: "vast",      kazanan: "alt", not: "one covers far more ground" },
      { ad: "RAINFALL", ustDeger: 450,  ustMetin: "450 mm", altDeger: 25, altMetin: "25 mm",     kazanan: "ust", not: "per year" },
      { ad: "SPECIES",  ustDeger: 3,    ustMetin: "FEW",    altDeger: 4,  altMetin: "MANY",      kazanan: "alt", not: "life finds a way" },
    ], kazanan: "ust",
    sonuc: "One wins on extremes.", sonuc2: "The other wins on scale." },
];

// ---------------------------------------------------------------------------
function tanimDosyasi(id) { return path.join(ortak.isDizin(id), "vs-tanim.json"); }

function tanimliIsler() {
  let l = [];
  try { l = fs.readdirSync(ortak.uretimDizini(), { withFileTypes: true }); } catch (e) { return []; }
  return l.filter(d => d.isDirectory() && ortak.guvenliAd(d.name) && fs.existsSync(path.join(ortak.uretimDizini(), d.name, "vs-tanim.json"))).map(d => d.name).sort();
}

function tanimOku(id) {
  const t = ortak.jsonOku(tanimDosyasi(id), null);              // bozuksa OrtakHata (exit 2)
  return { id, tanim: vs.tanimDogrula(t, id + "/vs-tanim.json"), gomulu: false };
}

// ids bossa: vs-tanim.json olan tum isler + gomulu ornekler. Doluysa: kesin ad, sonra tekil on ek.
function isleriSec(ids) {
  const sonuc = [];
  const ekle = x => { if (!sonuc.some(y => y.id === x.id)) sonuc.push(x); };
  if (!ids.length) {
    for (const id of tanimliIsler()) ekle(tanimOku(id));
    for (const g of ISLER) ekle({ id: g.id, tanim: vs.tanimDogrula(JSON.parse(JSON.stringify(g)), g.id), gomulu: true });
    return sonuc;
  }
  const tanimli = tanimliIsler();
  for (const a of ids) {
    if (ortak.guvenliAd(a) && tanimli.includes(a)) { ekle(tanimOku(a)); continue; }
    const onEk = tanimli.filter(x => x.startsWith(a));
    if (onEk.length === 1) { ekle(tanimOku(onEk[0])); continue; }
    const gom = ISLER.filter(x => x.id.startsWith(a));
    if (gom.length) { for (const g of gom) ekle({ id: g.id, tanim: vs.tanimDogrula(JSON.parse(JSON.stringify(g)), g.id), gomulu: true }); continue; }
    throw new OrtakHata("vs_tanim_yok", "VS tanımı bulunamadı: " + a, { cikis: ortak.CIKIS.GIRDI,
      cozum: "uretim/" + a + "/vs-tanim.json dosyasını oluştur (panelde VS ekranı) ya da vs-kur.js içindeki ISLER dizisine ekle." });
  }
  return sonuc;
}

async function calistir(o, bag) {
  bag = bag || {};
  const log = bag.log || (m => console.log(m));
  const uyari = bag.uyari || ortak.uyari;
  const isler = isleriSec(o.ids || []);
  if (!isler.length) throw new OrtakHata("vs_tanim_yok", "Kurulacak VS işi yok.", { cikis: ortak.CIKIS.GIRDI, cozum: "Panelde VS ekranından bir eşleşme kaydet." });
  ortak.diskKontrol(ortak.uretimDizini(), 1);
  const { getir, yonetici } = vs.yoneticiOlustur(bag, log, uyari);
  log(isler.length + " iş kurulacak\n");

  let eksik = 0, yeni = 0, var_ = 0;
  const redUrl = new Set();                                     // icerigi uygunsuz cikan adaylar: taraflar/isler arasi yeniden indirilmez
  const adimToplam = isler.length * vs.TARAFLAR.length;
  let adim = 0;
  for (const w of isler) {
    const P = man.yollar(w.id);
    ortak.kilitAl(w.id, "vs-kur");
    try {
      fs.mkdirSync(path.join(P.BASE, "Images"), { recursive: true });
      const v = vs.vsJsonUret(w.tanim);
      ortak.atomikJsonYaz(path.join(P.BASE, "vs.json"), v);
      for (const taraf of vs.TARAFLAR) {
        const r = await vs.tarafKur({ is: w.id, tarafAd: taraf, tanim: w.tanim, yeniden: !!o.yeniden, getir, yonetici, log, bekle: bag.bekle, jpegeCevirFn: bag.jpegeCevirFn, redUrl,
          ilerleme: { asama: "vs-kur", adim: adim++, toplam: adimToplam } });
        if (r.durum === "var") { var_++; log("  " + r.mesaj); }
        else if (r.durum === "indi") { yeni++; log("  " + r.mesaj); }
        else { eksik++; log("  !! GÖRSEL YOK (" + taraf + "): " + r.mesaj); }
      }
      log(w.id + " hazır (" + v.olculer.length + " ölçü, " + (v.introSure + v.olcuSure * v.olculer.length + v.sonSure).toFixed(1) + " sn)\n");
    } finally { ortak.kilitBirak(w.id); }
  }
  ortak.ilerleme("vs-kur", 100, { n: adimToplam, toplam: adimToplam });
  const kh = yonetici.kaynakHatalari();
  if (Object.keys(kh).length) log("kaynak hataları: " + JSON.stringify(kh));
  if (eksik)
    throw new OrtakHata("gorsel_yok", eksik + " taraf için uygun görsel bulunamadı.", { cikis: ortak.CIKIS.YETERSIZ,
      cozum: "vs-tanim.json içinde 'ara', 'sorgular' ya da 'zorunlu' alanlarını değiştir (daha genel/farklı sorgular ekle); Pexels/Pixabay anahtarı girmek sonucu iyileştirir.", detay: kh });
  const sonuc = { isler: isler.length, yeni, mevcut: var_ };
  if (!yeni) { sonuc.atlandi = true; sonuc.neden = "görseller zaten kurulu"; }
  ortak.sonuc(sonuc);
  return sonuc;
}

module.exports = { ISLER, isleriSec, calistir, tanimOku };

if (require.main === module) {
  const { konum, bayrak } = ortak.argumanCoz(process.argv.slice(2), {});
  calistir({ ids: konum, yeniden: !!bayrak.yeniden }).catch(ortak.bitir);
}
