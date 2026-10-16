// GO — VS gorsel secimi: vs-kur.js + vs-gorsel-duzelt.js (lib/gorsel-vs.js). Ag sahtelenir (istemciler + getir).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const yardim = require("./gorsel-yardim.js");
const ortak = require("../lib/ortak.js");
const ag = require("../lib/gorsel-ag.js");
const { lisansCoz } = require("../lib/gorsel-lisans.js");
const dogrula = require("../lib/gorsel-dogrula.js");
const vsKur = require("../vs-kur.js");
const duzelt = require("../vs-gorsel-duzelt.js");

const FFMPEG = yardim.ffmpegVarMi();
const atla = !FFMPEG && "ffmpeg yok";
test.after(() => yardim.temizle());
let _t = 20000;
const isYol = (is, ...p) => path.join(process.env.OTOMASYON_URETIM, is, ...p);

// Pexels tarzi aday uretir; resim deposuna kaydeder
function ortam() {
  const resimler = new Map();
  const sayac = { gorsel: 0 };
  let n = 0;
  const aday = (baslik, en, boy, o) => {
    o = o || {};
    const id = ++n;
    const url = "https://img.test/" + id + "." + (o.png ? "png" : "jpg");
    resimler.set(url, o.govde || yardim.tekil(yardim.gorselUret(o.png ? "png" : "jpg", o.gercekEn || en, o.gercekBoy || boy), ++_t));
    return Object.assign({ kaynak: "pexels", url, yedekUrl: [], baslik, etiket: "", atif: "Foto " + id, kaynakUrl: "https://www.pexels.com/photo/" + id + "/", indirmeUrl: url, en, boy, sira: o.sira !== undefined ? o.sira : id }, lisansCoz("pexels"));
  };
  const getir = async () => { throw new Error("getir cagrilmamali"); };
  getir.json = async () => { throw new Error("json cagrilmamali"); };
  getir.gorsel = async (u) => { sayac.gorsel++; const r = resimler.get(u); if (!r) throw new ag.AgHatasi("HTTP 404", 404); return { govde: r }; };
  return { aday, resimler, getir, sayac };
}
function bag(o, istemciler, ek) {
  const log = [];
  return Object.assign({ getir: o.getir, anahtarlar: { pexels: "x", pixabay: "" }, istemciler: Object.assign({ pixabay: async () => [], wikimedia: async () => [], openverse: async () => [], nasa: async () => [] }, istemciler),
    bekle: yardim.uyku0, bekleKaynak: yardim.uyku0, aralik: {}, log: m => log.push(m), uyari: () => {}, _log: log }, ek || {});
}
const tanim = (ek) => Object.assign({
  surum: 1, baslik: "POLAR BEAR vs WOLF",
  ust: { ad: "POLAR BEAR", renk: "3BE07A", ara: "polar bear arctic snow", zorunlu: ["polar", "bear"], sorgular: ["polar bear wild"] },
  alt: { ad: "WOLF", renk: "FFB020", ara: "gray wolf wild", zorunlu: ["wolf"], sorgular: ["wolf howling forest"] },
  olculer: [{ ad: "SPEED", ustDeger: 40, ustMetin: "40 km/h", altDeger: 60, altMetin: "60 km/h", kazanan: "alt", not: "wolves are faster" },
            { ad: "WEIGHT", ustDeger: 450, ustMetin: "450 kg", altDeger: 40, altMetin: "40 kg", kazanan: "ust", not: "huge" }],
  kazanan: "ust", sonuc: "Bear wins on power.", sonuc2: "Wolf wins on speed.",
}, ek || {});
function isKurVs(ad, t) {
  const d = yardim.isKur(ad, {});
  fs.writeFileSync(path.join(d, "vs-tanim.json"), JSON.stringify(t, null, 2));
  return d;
}

test("vs-kur: tur filtresi gercekten eler (heykel/zorunlu kelime/kadraj), yedek sorgulara gecer, vs.json'a arama alanlari yazilmaz, kaynak.json + ATIF", { skip: atla }, async () => {
  const is = "vs-temel";
  isKurVs(is, tanim());
  const o = ortam();
  const sorgular = [];
  const pexels = async (q) => {
    sorgular.push(q);
    if (q === "polar bear arctic snow") return [
      o.aday("bronze polar bear statue in a park", 1600, 1400, { sira: 0 }),          // heykel -> elenir
      o.aday("tiger resting in jungle", 1600, 1400, { sira: 1 }),                      // zorunlu kelime yok -> elenir
      o.aday("polar bear portrait close up", 1000, 1600, { sira: 2 }),                 // dikey: kadraja uymaz (cezali)
      o.aday("polar bear on ice floe", 1600, 1400, { sira: 3 }),                       // KARE -> secilir
    ];
    if (q === "gray wolf wild") return [o.aday("wolf plush toy", 1600, 1400, { sira: 0 }), o.aday("sunset over hills", 1600, 1400, { sira: 1 })];   // hic uygun yok -> sonraki sorgu
    if (q === "wolf howling forest") return [o.aday("gray wolf howling at dusk", 1500, 1500, { sira: 0 })];
    return [];
  };
  const b = bag(o, { pexels });
  const sonuc = await vsKur.calistir({ ids: [is] }, b);
  assert.equal(sonuc.yeni, 2);
  assert.deepEqual(sorgular.filter(q => q === "polar bear arctic snow").length, 1);
  assert.ok(sorgular.includes("wolf howling forest"), "ilk sorgu bos kalinca yedek sorguya gecilmeli: " + sorgular);
  assert.ok(!sorgular.includes("polar bear wild"), "ilk sorgu yeterliyse yedege gerek yok");

  const vsJson = JSON.parse(fs.readFileSync(isYol(is, "vs.json"), "utf8"));
  assert.deepEqual(Object.keys(vsJson.ust).sort(), ["ad", "renk"], "arama alanlari vs.json'a yazilmaz");
  assert.equal(vsJson.altBaslik, "WHO WINS?"); assert.equal(vsJson.introSure, 4); assert.equal(vsJson.olculer.length, 2);
  assert.equal(vsJson.olculer[0].ustMetin, "40 km/h"); assert.equal(vsJson.kazanan, "ust");

  const ust = fs.readFileSync(isYol(is, "Images", "ust.jpg")), alt = fs.readFileSync(isYol(is, "Images", "alt.jpg"));
  assert.equal(dogrula.dogrula(ust).tur, "jpg"); assert.equal(dogrula.dogrula(alt).tur, "jpg");
  assert.deepEqual([dogrula.dogrula(ust).en, dogrula.dogrula(ust).boy], [1600, 1400], "kare gorsel secilmeli (dikey/heykel degil)");
  assert.deepEqual([dogrula.dogrula(alt).en, dogrula.dogrula(alt).boy], [1500, 1500]);

  const kj = JSON.parse(fs.readFileSync(isYol(is, "Images", "kaynak.json"), "utf8"));
  assert.equal(kj.surum, 1);
  assert.equal(kj.ust.baslik, "polar bear on ice floe"); assert.equal(kj.ust.lisansKodu, "pexels"); assert.equal(kj.ust.dosya, "Images/ust.jpg");
  assert.equal(kj.alt.sorgu, "wolf howling forest"); assert.match(kj.alt.sha1, /^[0-9a-f]{40}$/);
  const atif = fs.readFileSync(isYol(is, "ATIF.txt"), "utf8").trim().split("\n");
  assert.equal(atif[0], "Görsel kaynakları / Image credits:");
  assert.equal(atif.length, 3, "Pexels: iki taraf icin atif");
  assert.match(atif[1], /Pexels License — https:\/\/www\.pexels\.com\/photo\//);
});

test("vs-kur: ikinci calisma dokunmaz (atlandi); --yeniden su anki gorseli TEKRAR secmez", { skip: atla }, async () => {
  const is = "vs-yeniden";
  isKurVs(is, tanim());
  const o = ortam();
  const liste = [o.aday("polar bear one", 1600, 1400), o.aday("polar bear two", 1600, 1400), o.aday("wolf one", 1600, 1400), o.aday("wolf two", 1600, 1400)];
  const pexels = async (q) => (/polar/.test(q) ? liste.slice(0, 2) : liste.slice(2));
  const b = bag(o, { pexels });
  await vsKur.calistir({ ids: [is] }, b);
  const once = fs.readFileSync(isYol(is, "Images", "ust.jpg"));
  const r2 = await vsKur.calistir({ ids: [is] }, b);
  assert.equal(r2.atlandi, true); assert.equal(r2.yeni, 0);
  assert.ok(fs.readFileSync(isYol(is, "Images", "ust.jpg")).equals(once));
  await vsKur.calistir({ ids: [is], yeniden: true }, b);
  const sonra = fs.readFileSync(isYol(is, "Images", "ust.jpg"));
  assert.ok(!sonra.equals(once), "yeniden: baska gorsel secilmeli");
  const kj = JSON.parse(fs.readFileSync(isYol(is, "Images", "kaynak.json"), "utf8"));
  assert.equal(kj.ust.baslik, "polar bear two");
});

test("vs-kur: PNG gelirse JPEG'e cevrilir (vs-yap ust.jpg bekler)", { skip: atla }, async () => {
  const is = "vs-png";
  isKurVs(is, tanim());
  const o = ortam();
  const pexels = async (q) => (/polar/.test(q) ? [o.aday("polar bear png", 1600, 1400, { png: true })] : [o.aday("wolf jpg", 1600, 1400)]);
  await vsKur.calistir({ ids: [is] }, bag(o, { pexels }));
  const b = fs.readFileSync(isYol(is, "Images", "ust.jpg"));
  assert.equal(b[0], 0xFF); assert.equal(b[1], 0xD8);
  const v = dogrula.dogrula(b);
  assert.equal(v.tur, "jpg"); assert.deepEqual([v.en, v.boy], [1600, 1400]);
  assert.equal(JSON.parse(fs.readFileSync(isYol(is, "Images", "kaynak.json"), "utf8")).ust.sha1, v.sha1);
});

test("vs-kur: Pexels/Pixabay anahtarsizsa Wikimedia + Openverse devreye girer; lisans (NC) suzulur", { skip: atla }, async () => {
  const is = "vs-anahtarsiz";
  isKurVs(is, tanim());
  const o = ortam();
  const wik = (baslik, kod) => Object.assign({ kaynak: "wikimedia", sira: 0, atif: "Commons Yazari", en: 1800, boy: 1500, baslik, etiket: "" }, lisansCoz("wikimedia", { kisaAd: kod }), (() => { const a = o.aday(baslik, 1800, 1500); return { url: a.url, indirmeUrl: a.url, kaynakUrl: "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(baslik) }; })());
  const wikimedia = async (q) => (/polar/.test(q) ? [wik("polar bear commons", "CC BY-SA 4.0")] : [wik("wolf commons", "CC0")]);
  const b = bag(o, { wikimedia }, { anahtarlar: { pexels: "", pixabay: "" } });
  const r = await vsKur.calistir({ ids: [is] }, b);
  assert.equal(r.yeni, 2);
  const kj = JSON.parse(fs.readFileSync(isYol(is, "Images", "kaynak.json"), "utf8"));
  assert.equal(kj.ust.kaynak, "wikimedia"); assert.equal(kj.ust.lisansKodu, "by-sa"); assert.equal(kj.alt.lisansKodu, "cc0");
  const atif = fs.readFileSync(isYol(is, "ATIF.txt"), "utf8");
  assert.match(atif, /polar bear commons.*CC BY-SA 4\.0/); assert.ok(!/wolf commons/.test(atif), "CC0: atif gerekmez");
});

test("vs-kur: hic uygun gorsel yoksa exit 4 (gorsel olmayan taraf bildirilir); gecersiz tanim exit 2; tanim yoksa exit 2; gomulu ornek bulunur", { skip: atla }, async () => {
  isKurVs("vs-bos", tanim());
  const o = ortam();
  await assert.rejects(() => vsKur.calistir({ ids: ["vs-bos"] }, bag(o, { pexels: async () => [] })), e => e.kod === "gorsel_yok" && e.cikis === 4);
  assert.ok(fs.existsSync(isYol("vs-bos", "vs.json")), "vs.json yine de yazilir");

  isKurVs("vs-renk", tanim({ ust: { ad: "A", renk: "kirmizi", ara: "x" } }));
  await assert.rejects(() => vsKur.calistir({ ids: ["vs-renk"] }, bag(o, {})), e => e.cikis === 2 && /renk/.test(e.message));
  isKurVs("vs-olcu", tanim({ olculer: [] }));
  await assert.rejects(() => vsKur.calistir({ ids: ["vs-olcu"] }, bag(o, {})), e => e.cikis === 2);
  fs.writeFileSync(isYol("vs-bos", "vs-tanim.json"), "{ bozuk");
  await assert.rejects(() => vsKur.calistir({ ids: ["vs-bos"] }, bag(o, {})), e => e.cikis === 2 && /bozuk/.test(e.message));
  await assert.rejects(() => vsKur.calistir({ ids: ["hic-yok"] }, bag(o, {})), e => e.kod === "vs_tanim_yok" && e.cikis === 2);
  assert.deepEqual(vsKur.isleriSec(["ornek"]).map(x => x.id), ["ornek-1"]);
  assert.equal(vsKur.ISLER[0].olculer[0].ustDeger, 8848, "gomulu ornek vs.json bicimine cevrilmis");
});

test("vs-gorsel-duzelt: vs-tanim.json'dan is listesi; yalniz --taraf; su anki gorsel degisir; yoksa eski 106-110 listesi", { skip: atla }, async () => {
  const is = "vs-duzelt";
  isKurVs(is, tanim());
  const o = ortam();
  const liste = [o.aday("polar bear a", 1600, 1400), o.aday("polar bear b", 1600, 1400), o.aday("wolf a", 1600, 1400), o.aday("wolf b", 1600, 1400)];
  const pexels = async (q) => (/polar/.test(q) ? liste.slice(0, 2) : liste.slice(2));
  const b = bag(o, { pexels });
  await vsKur.calistir({ ids: [is] }, b);
  const ust0 = fs.readFileSync(isYol(is, "Images", "ust.jpg")), alt0 = fs.readFileSync(isYol(is, "Images", "alt.jpg"));
  const r = await duzelt.calistir({ ids: [is], taraf: "alt" }, b);
  assert.equal(r.degisen, 1);
  assert.ok(fs.readFileSync(isYol(is, "Images", "ust.jpg")).equals(ust0), "ust'e dokunulmamali");
  assert.ok(!fs.readFileSync(isYol(is, "Images", "alt.jpg")).equals(alt0), "alt degismeli");
  await assert.rejects(() => duzelt.calistir({ ids: [is], taraf: "orta" }, b), e => e.cikis === 2);
  await assert.rejects(() => duzelt.calistir({ ids: ["hic-yok"] }, b), e => e.kod === "vs_tanim_yok");

  // eski liste: is klasoru var, vs-tanim.json yok
  const eski = "106-harpi-vs-kartal";
  yardim.isKur(eski, {});
  fs.mkdirSync(isYol(eski, "Images"), { recursive: true });
  fs.writeFileSync(isYol(eski, "Images", "ust.jpg"), Buffer.alloc(30000, 1));
  const o2 = ortam();
  const pex2 = async () => [o2.aday("harpy eagle perched", 1600, 1400), o2.aday("eagle statue bronze", 1600, 1400)];
  // vs-tanim.json'u olan "vs-duzelt" is listesinden DISARIDA: yalniz eski is adini ver
  const r2 = await duzelt.calistir({ ids: [eski] }, bag(o2, { pexels: pex2 }));
  assert.equal(r2.degisen, 1);
  const v = dogrula.dogrula(fs.readFileSync(isYol(eski, "Images", "ust.jpg")));
  assert.equal(v.tamam, true);
  const kj = JSON.parse(fs.readFileSync(isYol(eski, "Images", "kaynak.json"), "utf8"));
  assert.equal(kj.ust.baslik, "harpy eagle perched", "heykel elendi");
});
