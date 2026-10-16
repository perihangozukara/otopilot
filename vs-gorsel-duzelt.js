// VS gorsellerini DEGISTIRIR: yanlis tur gelen (Pexels "honey badger" icin bronz heykel, "polar bear" icin muze maketi)
// gorselin yerine tur filtresinden gecen BASKA bir gorsel kurar. Su an kurulu gorsel tekrar secilmez.
//
// Kullanim: node vs-gorsel-duzelt.js <is> [<is>...] [--taraf ust|alt]    (taraf verilmezse ikisi de)
//           node vs-gorsel-duzelt.js                                      (vs-tanim.json olan tum isler; yoksa eski 5 is)
//
// Is listesi uretim/<is>/vs-tanim.json'dan okunur (ust/alt: ara, zorunlu, sorgular). vs-tanim.json'u olmayan eski
// 106-110 numarali isler icin asagidaki gomulu liste kullanilir. Eleme kurali vs-kur.js ile AYNI (lib/gorsel-vs.js):
// zorunlu kelime sart, heykel/oyuncak/cizim/kostum elenir, sorgular sirayla denenir, kareye yakin kadraj secilir.
// Ilerleme: taraf (ust/alt) basina @@ILERLEME (n/toplam).
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./lib/ortak.js");
const vs = require("./lib/gorsel-vs.js");
const man = require("./lib/gorsel-manifest.js");
const vsKur = require("./vs-kur.js");

const OrtakHata = ortak.OrtakHata;

// vs-tanim.json'u olmayan eski isler: tek tarafin (yanlis gelen) yeniden secimi
const ESKI_ISLER = [
  { is: "106-harpi-vs-kartal", taraf: "ust", sorgular: ["harpy eagle adult", "harpy eagle bird", "eagle predator perched"], zorunlu: ["harpy", "eagle"] },
  { is: "107-komodo-vs-bal-porsugu", taraf: "alt", sorgular: ["honey badger animal", "ratel honey badger", "badger wildlife"], zorunlu: ["badger"] },
  { is: "109-kutup-ayisi-vs-kaplan", taraf: "ust", sorgular: ["polar bear arctic snow", "polar bear wild", "polar bear swimming"], zorunlu: ["polar", "bear"] },
  { is: "110-sirtlan-vs-kurt", taraf: "alt", sorgular: ["gray wolf wild", "wolf howling forest", "grey wolf wildlife"], zorunlu: ["wolf"] },
  { is: "108-jaguar-vs-anakonda", taraf: "alt", sorgular: ["green anaconda snake", "anaconda water snake", "large constrictor snake"], zorunlu: ["anaconda", "snake"] },
];

async function calistir(o, bag) {
  bag = bag || {};
  const log = bag.log || (m => console.log(m));
  const uyari = bag.uyari || ortak.uyari;
  const ids = o.ids || [];
  if (o.taraf && !vs.TARAFLAR.includes(o.taraf)) throw new OrtakHata("arguman", "--taraf 'ust' ya da 'alt' olmalı.", { cikis: ortak.CIKIS.GIRDI });

  // is listesi: [{id, tanim (yalniz ilgili taraflar yeterli), taraflar:[...]}]
  const is = [];
  const tarafAdlari = () => (o.taraf ? [o.taraf] : vs.TARAFLAR.slice());
  const eskiEkle = e => {
    if (is.some(x => x.id === e.is)) return;
    if (!fs.existsSync(path.join(ortak.uretimDizini(), e.is))) { log("- " + e.is + ": iş klasörü yok, atlandı"); return; }
    if (o.taraf && o.taraf !== e.taraf) return;
    const taraf = { ad: e.is, ara: e.sorgular[0], sorgular: e.sorgular.slice(1), zorunlu: e.zorunlu };
    is.push({ id: e.is, tanim: { [e.taraf]: taraf }, taraflar: [e.taraf] });
  };
  if (ids.length) {
    for (const a of ids) {
      let bulundu = [];
      try { bulundu = vsKur.isleriSec([a]).filter(x => !x.gomulu); }
      catch (e) { if (!(e instanceof OrtakHata) || e.kod !== "vs_tanim_yok") throw e; }
      for (const x of bulundu) if (!is.some(y => y.id === x.id)) is.push({ id: x.id, tanim: x.tanim, taraflar: tarafAdlari() });
      if (!bulundu.length) {
        const eski = ESKI_ISLER.filter(e => e.is === a || e.is.startsWith(a));
        if (!eski.length) throw new OrtakHata("vs_tanim_yok", "VS tanımı bulunamadı: " + a, { cikis: ortak.CIKIS.GIRDI,
          cozum: "uretim/" + a + "/vs-tanim.json dosyası olmalı (panelde VS ekranı yazar)." });
        eski.forEach(eskiEkle);
      }
    }
  } else {
    for (const x of vsKur.isleriSec([]).filter(y => !y.gomulu)) is.push({ id: x.id, tanim: x.tanim, taraflar: tarafAdlari() });
    if (!is.length) ESKI_ISLER.forEach(eskiEkle);
  }
  if (!is.length)
    throw new OrtakHata("vs_tanim_yok", "Düzeltilecek VS işi bulunamadı.", { cikis: ortak.CIKIS.GIRDI,
      cozum: "İş adını ver (node vs-gorsel-duzelt.js <iş>) ve işte uretim/<iş>/vs-tanim.json olduğundan emin ol." });

  ortak.diskKontrol(ortak.uretimDizini(), 1);
  const { getir, yonetici } = vs.yoneticiOlustur(bag, log, uyari);
  let degisen = 0, basarisiz = 0;
  const redUrl = new Set();                                     // icerigi uygunsuz cikan adaylar: taraflar/isler arasi yeniden indirilmez
  const adimToplam = is.reduce((t, w) => t + w.taraflar.length, 0);
  let adim = 0;
  for (const w of is) {
    const P = man.yollar(w.id);
    if (!fs.existsSync(P.BASE)) { log("- " + w.id + ": iş klasörü yok, atlandı"); adim += w.taraflar.length; continue; }
    ortak.kilitAl(w.id, "vs-gorsel-duzelt");
    try {
      for (const t of w.taraflar) {
        const r = await vs.tarafKur({ is: w.id, tarafAd: t, tanim: w.tanim, yeniden: true, getir, yonetici, log, bekle: bag.bekle, jpegeCevirFn: bag.jpegeCevirFn, redUrl,
          ilerleme: { asama: "vs-duzelt", adim: adim++, toplam: adimToplam } });
        if (r.durum === "indi") { degisen++; log(w.id + "/" + r.mesaj); }
        else { basarisiz++; log("!! " + w.id + " — " + t + ": " + r.mesaj); }
      }
    } finally { ortak.kilitBirak(w.id); }
  }
  ortak.ilerleme("vs-duzelt", 100, { n: adimToplam, toplam: adimToplam });
  const kh = yonetici.kaynakHatalari();
  if (Object.keys(kh).length) log("kaynak hataları: " + JSON.stringify(kh));
  if (basarisiz)
    throw new OrtakHata("gorsel_yok", basarisiz + " taraf için uygun görsel bulunamadı (eski görsel yerinde duruyor).", { cikis: ortak.CIKIS.YETERSIZ,
      cozum: "vs-tanim.json içinde 'sorgular' ya da 'zorunlu' alanlarını değiştir; Pexels/Pixabay anahtarı girmek sonucu iyileştirir.", detay: kh });
  ortak.sonuc({ degisen });
  return { degisen };
}

module.exports = { ESKI_ISLER, calistir };

if (require.main === module) {
  const { konum, bayrak } = ortak.argumanCoz(process.argv.slice(2), { deger: ["taraf"] });
  // --taraf degersiz yazildiysa (argumanCoz bunu `true` yapar) sessizce "ikisi de" olmasin
  if (bayrak.taraf === true || (bayrak.taraf !== undefined && /^--/.test(String(bayrak.taraf)))) {
    console.error("✗ --taraf için ust ya da alt ver: --taraf alt");
    process.exit(ortak.CIKIS.GIRDI);
  }
  calistir({ ids: konum, taraf: bayrak.taraf !== undefined ? String(bayrak.taraf) : null }).catch(ortak.bitir);
}
