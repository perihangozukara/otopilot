// GO — gorsel-cek.js (NASA) ve portre-cek.js (Wikimedia portre): manifest eslemesi, lisans/atif, global tekrar onleme,
// sahne adi dogrulama. Ag sahtelenir; gercek NASA/Wikimedia'ya cikmaz.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const yardim = require("./gorsel-yardim.js");
const ortak = require("../lib/ortak.js");
const ag = require("../lib/gorsel-ag.js");
const cek = require("../gorsel-cek.js");
const portre = require("../portre-cek.js");

const FFMPEG = yardim.ffmpegVarMi();
const atla = !FFMPEG && "ffmpeg yok";
test.after(() => yardim.temizle());
let _t = 9000;
const jpg = (en, boy) => yardim.tekil(yardim.gorselUret("jpg", en || 1920, boy || 1080), ++_t);
const isYol = (is, ...p) => path.join(process.env.OTOMASYON_URETIM, is, ...p);
const manifest = is => JSON.parse(fs.readFileSync(isYol(is, "Visuals", "manifest.json"), "utf8"));

function bag(getir, ek) {
  const log = [], uyarilar = [];
  return Object.assign({ getir, bekle: yardim.uyku0, bekleKaynak: yardim.uyku0, aralik: {}, log: m => log.push(m), uyari: m => uyarilar.push(m), _log: log, _uyari: uyarilar }, ek || {});
}

// ------------------------------------------------------------------ NASA
function nasaAg(katalog) {
  const resimler = new Map();
  const istekler = [];
  const oge = (id, baslik, aciklama) => {
    const taban = "https://images-assets.nasa.gov/image/" + id + "/" + id;
    resimler.set(taban + "~orig.jpg", jpg(3000, 2000));
    return { data: [{ title: baslik, description: aciklama || baslik, nasa_id: id, keywords: [], photographer: "NASA" }], links: [{ href: taban + "~thumb.jpg" }] };
  };
  const getir = async () => { throw new Error("getir cagrilmamali"); };
  getir.json = async (url) => { istekler.push(url); const q = new URL(url).searchParams.get("q"); const v = katalog(q, oge); if (v instanceof Error) throw v; return { collection: { items: v } }; };
  getir.gorsel = async (url) => { const r = resimler.get(url); if (!r) throw new ag.AgHatasi("HTTP 404", 404); return { govde: r }; };
  return { getir, resimler, istekler };
}

test("gorsel-cek: konu.sahneler -> Visuals/<n>/NN.jpg + manifest 'nasa' kaydi; ayni NASA gorseli iki sahnede cikmaz; kara liste", { skip: atla }, async () => {
  const is = "cek-temel";
  yardim.isKur(is, { konu: { format: "long", sahneler: [{ n: "01-galaxy", q: ["spiral galaxy"] }, { n: "02-more", q: ["spiral galaxy", "nebula"] }] } });
  const a = nasaAg((q, oge) => (q === "nebula"
    ? [oge("N5", "Orion nebula"), oge("N6", "Crab nebula")]
    : [oge("N1", "Spiral galaxy M51"), oge("N2", "Spiral galaxy M101"), oge("N3", "Meeting of NASA staff"), oge("N4", "Spiral galaxy chart diagram")]));
  const b = bag(a.getir);
  await cek.calistir({ is, adet: 2 }, b);
  const m = manifest(is);
  const s1 = m.sahneler.find(s => s.klasor === "01-galaxy"), s2 = m.sahneler.find(s => s.klasor === "02-more");
  assert.equal(s1.gorseller.length, 2); assert.equal(s2.gorseller.length, 2);
  const urller = [].concat(s1.gorseller, s2.gorseller).map(g => g.kaynakUrl);
  assert.equal(new Set(urller).size, 4, "ayni NASA gorseli iki sahnede cikmis: " + urller);
  assert.ok(!urller.some(u => /N3|N4/.test(u)), "toplanti/grafik elenmeli");
  assert.ok(urller.some(u => /N5|N6/.test(u)), "ikinci sahne yedek aramaya (nebula) dusmeli");
  for (const g of s1.gorseller) { assert.equal(g.kaynak, "nasa"); assert.equal(g.lisansKodu, "nasa"); assert.match(g.dosya, /^01-galaxy\/\d\d\.jpg$/); assert.deepEqual([g.en, g.boy], [3000, 2000]); assert.ok(fs.existsSync(isYol(is, "Visuals", g.dosya))); }
  assert.ok(!fs.existsSync(isYol(is, "ATIF.txt")), "NASA atif listesine girmez");
  // ikinci calisma: yeterli, yeni gorsel eklemez
  const once = fs.readdirSync(isYol(is, "Visuals", "01-galaxy")).length;
  await cek.calistir({ is, adet: 2 }, bag(a.getir));
  assert.equal(fs.readdirSync(isYol(is, "Visuals", "01-galaxy")).length, once);
});

test("gorsel-cek: sayisal on ek senaryo planindaki sahneye baglanir (paragraf eslemesi), silinenler dislanir", { skip: atla }, async () => {
  const is = "cek-esleme";
  const senaryo = yardim.senaryoUret(4, 30);
  yardim.isKur(is, { senaryo, konu: { format: "long", sahneler: [{ n: "02-uzay", q: ["galaxy"] }, { n: "zzz-ek", q: ["galaxy"] }] } });
  const a = nasaAg((q, oge) => [oge("A1", "galaxy one"), oge("A2", "galaxy two"), oge("A3", "galaxy three"), oge("A4", "galaxy four")]);
  fs.writeFileSync(isYol(is, "silinenler.json"), JSON.stringify({ surum: 1, silinenler: [{ sahne: "02-uzay", ad: "01.jpg", kaynakUrl: "https://images.nasa.gov/details/A1", sha1: "", zaman: "x" }] }));
  await cek.calistir({ is, adet: 2 }, bag(a.getir));
  const m = manifest(is);
  assert.equal(m.sahneler.filter(s => s.paragraflar.length).length, 4, "plan sahneleri korunur");
  assert.deepEqual([].concat(...m.sahneler.map(s => s.paragraflar)).sort(), [0, 1, 2, 3]);
  const s2 = m.sahneler.find(s => s.no === 2 && s.paragraflar.length);
  assert.equal(s2.klasor, "02-uzay");
  assert.equal(s2.gorseller.length, 2);
  assert.ok(!JSON.stringify(m).includes("/A1"), "silinen A1 geri gelmemeli");
  // numarasi olmayan ad ("zzz-ek"): paragrafsiz ek sahne YARATILMAZ (render yalniz paragrafa bagli sahneleri kullanir);
  // gorsel son sahnenin kendi klasorune eklenir ve sozlesmedeki kapsama bozulmaz
  assert.ok(m.sahneler.every(s => s.paragraflar.length > 0), "paragrafsiz sahne olmamali");
  const son = m.sahneler[m.sahneler.length - 1];
  assert.equal(son.klasor, "zzz-ek"); assert.equal(son.gorseller.length, 1);
  assert.ok(m.sahneler.every((s, i, a) => i === 0 || a[i - 1].no < s.no));
  assert.equal(m.kaynakSenaryoSha1, ortak.paragrafOzeti(ortak.paragraflaraBol(senaryo)));
});

test("gorsel-cek: gecersiz sahne adi (../) konu dogrulamasinda reddedilir (exit 2); varsayilan sahneler uyarili; hic gorsel yoksa exit 4", { skip: atla }, async () => {
  yardim.isKur("cek-yol", { konu: { format: "long", sahneler: [{ n: "../../kacis", q: ["x"] }] } });
  await assert.rejects(() => cek.calistir({ is: "cek-yol" }, bag(nasaAg(() => []).getir)), e => e.cikis === 2 && /konu\.json geçersiz/.test(e.message));
  assert.ok(!fs.existsSync(path.join(process.env.OTOMASYON_URETIM, "..", "kacis")));

  yardim.isKur("cek-varsayilan", { konu: { format: "long" } });
  const b = bag(nasaAg(() => []).getir);
  await assert.rejects(() => cek.calistir({ is: "cek-varsayilan" }, b), e => e.kod === "gorsel_yok" && e.cikis === 4);
  assert.ok(b._uyari.some(m => /varsayılan 8 uzay sahnesi/.test(m)));

  // ag yok -> exit 3
  yardim.isKur("cek-ag", { konu: { format: "long", sahneler: [{ n: "01-x", q: ["x"] }] } });
  await assert.rejects(() => cek.calistir({ is: "cek-ag" }, bag(nasaAg(() => new ag.AgHatasi("HTTP 503", 503)).getir)), e => e.cikis === 3);
});

// ------------------------------------------------------------------ PORTRE
function wikiAg(katalog) {
  const resimler = new Map();
  const istekler = [];
  const sayfa = (i, ad, lisans, o) => {
    o = o || {};
    const thumb = "https://upload.test/p/" + encodeURIComponent(ad) + ".jpg";
    resimler.set(thumb, jpg(1920, 2400));
    return { pageid: i, index: i, title: "File:" + ad + ".jpg", imageinfo: [{ thumburl: thumb, url: thumb, descriptionurl: "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(ad),
      width: 1920, height: 2400, thumbwidth: 1920, thumbheight: 2400, mime: "image/jpeg",
      extmetadata: { LicenseShortName: { value: lisans }, Artist: { value: o.yazar || "Foto Yazari" }, ImageDescription: { value: o.aciklama || ad } } }] };
  };
  const getir = async () => { throw new Error("cagrilmamali"); };
  getir.json = async (url) => { istekler.push(url); const q = new URL(url).searchParams.get("gsrsearch").replace(/ filetype:bitmap$/, ""); const v = katalog(q, sayfa); if (v instanceof Error) throw v; return { query: { pages: v } }; };
  getir.gorsel = async (url) => { const r = resimler.get(url); if (!r) throw new ag.AgHatasi("HTTP 404", 404); return { govde: r }; };
  return { getir, istekler, resimler };
}

test("portre-cek: yalniz ticari kullanima acik lisans; yazar+lisans manifeste ve ATIF.txt'ye; mezar elenir ama tablo gecerli", { skip: atla }, async () => {
  const is = "portre-temel";
  yardim.isKur(is, { konu: { format: "long", portreler: [{ n: "03-einstein", q: ["Albert Einstein"], adet: 3 }] } });
  const a = wikiAg((q, sayfa) => [
    sayfa(1, "Albert Einstein NC portrait", "CC BY-NC 4.0"),
    sayfa(2, "Albert Einstein 1921", "Public domain", { yazar: "Ferdinand Schmutzer" }),
    sayfa(3, "Albert Einstein grave", "CC0"),
    sayfa(4, "Albert Einstein portrait painting", "CC BY-SA 3.0", { yazar: "Ressam Ali" }),
    sayfa(5, "Albert Einstein ND photo", "CC BY-ND 2.0"),
    sayfa(6, "Albert Einstein at the blackboard", "CC BY 4.0", { yazar: "Ayse <b>Yilmaz</b>" }),
    sayfa(7, "Albert Einstein extra", "CC BY 2.0", { yazar: "Fazla" }),
  ]);
  const b = bag(a.getir);
  await portre.calistir({ is }, b);
  const m = manifest(is);
  const s = m.sahneler.find(x => x.klasor === "03-einstein");
  assert.equal(s.gorseller.length, 3, "adet 3");
  const basliklar = s.gorseller.map(g => g.baslik);
  assert.ok(!basliklar.some(x => /NC|ND|grave/.test(x)), "NC/ND/mezar elendi: " + basliklar);
  assert.ok(basliklar.includes("Albert Einstein portrait painting"), "tablo portre icin gecerli");
  for (const g of s.gorseller) { assert.equal(g.kaynak, "wikimedia"); assert.ok(g.atif); assert.ok(g.kaynakUrl.startsWith("https://commons.wikimedia.org/wiki/File:")); assert.match(g.dosya, /^03-einstein\/\d\d\.jpg$/); }
  const atif = fs.readFileSync(isYol(is, "ATIF.txt"), "utf8").trim().split("\n");
  assert.equal(atif[0], "Görsel kaynakları / Image credits:");
  const govde = atif.slice(1).join("\n");
  assert.match(govde, /CC BY-SA 3\.0/); assert.match(govde, /Ressam Ali/);
  assert.ok(m.uyarilar && m.uyarilar.length >= 1, "BY-SA uyarisi");
  assert.ok(a.istekler.every(u => /filetype%3Abitmap/.test(u)));
});

test("portre-cek: portreler yoksa atlandi (exit 0); Commons'ta hic sonuc yoksa exit 4; ag yoksa exit 3; gecersiz n konu dogrulamasinda reddedilir", { skip: atla }, async () => {
  yardim.isKur("portre-bos", { konu: { format: "long" } });
  const r = await portre.calistir({ is: "portre-bos" }, bag(wikiAg(() => []).getir));
  assert.equal(r.toplam, 0);
  yardim.isKur("portre-yok", { konu: { format: "long", portreler: [{ n: "01-x", q: ["Hic Kimse"] }] } });
  await assert.rejects(() => portre.calistir({ is: "portre-yok" }, bag(wikiAg(() => []).getir)), e => e.kod === "gorsel_yok" && e.cikis === 4);
  yardim.isKur("portre-ag", { konu: { format: "long", portreler: [{ n: "01-x", q: ["Einstein"] }] } });
  await assert.rejects(() => portre.calistir({ is: "portre-ag" }, bag(wikiAg(() => new ag.AgHatasi("HTTP 503", 503)).getir)), e => e.cikis === 3);
  yardim.isKur("portre-yol", { konu: { format: "long", portreler: [{ n: "..\\..\\x", q: ["a"] }] } });
  await assert.rejects(() => portre.calistir({ is: "portre-yol" }, bag(wikiAg(() => []).getir)), e => e.cikis === 2);
});
