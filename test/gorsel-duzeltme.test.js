// GO — duzeltme turu (denetci bulgulari + regresyonlar): kara liste yalniz BASLIKTA, reddedilen adaylar yeniden inmez,
// --sahne yeniden aramasi sahneyi bosaltmaz, bozuk manifest diskten yeniden baglanir, arsiv silinmez, bayrak dogrulama,
// @@ILERLEME (nokta/+/x yok), idempotans (@@SONUC atlandi), fake-ip DNS, https->http yonlendirmede anahtar dusmesi.
// Ag SAHTELENIR; gorseller ffmpeg gerektirmeyen sentetik JPEG iskeletleridir (test/birim-yardim.js). Gercek aga/.env'e cikmaz.
"use strict";
const Y = require("./birim-yardim");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { spawnSync } = require("child_process");

const ortak = require("../lib/ortak.js");
const ag = require("../lib/gorsel-ag.js");
const agGuvenlik = require("../lib/ag-guvenlik.js");
const puan = require("../lib/gorsel-puan.js");
const kaynak = require("../lib/gorsel-kaynak.js");
const indir = require("../lib/gorsel-indir.js");
const man = require("../lib/gorsel-manifest.js");
const { lisansCoz } = require("../lib/gorsel-lisans.js");
const { calistir } = require("../lib/gorsel-akis.js");
const cek = require("../gorsel-cek.js");
const portre = require("../portre-cek.js");
const uretici = require("../gorsel-uret.js");
const vsKur = require("../vs-kur.js");
const duzelt = require("../vs-gorsel-duzelt.js");

const ortam = Y.ortamKur("gorsel-duzeltme");
test.after(() => ortam.temizle());
const bos = async () => {};

// ------------------------------------------------------------------ yardimcilar
let _n = 3000;
const jpg = (en, boy) => Y.jpegUret(en || 1920, boy || 1080, { bayt: 3000 + (++_n) });
const isYol = (is, ...p) => path.join(process.env.OTOMASYON_URETIM, is, ...p);
const manifest = is => JSON.parse(fs.readFileSync(isYol(is, "Visuals", "manifest.json"), "utf8"));
const arsivler = is => fs.readdirSync(isYol(is, "Visuals")).filter(x => /^_eski-/.test(x));
const shalar = s => s.gorseller.map(g => g.sha1).sort();

function isKur(ad, o) {
  const d = isYol(ad);
  fs.mkdirSync(path.join(d, "Voice"), { recursive: true });
  if (o.senaryo !== undefined) fs.writeFileSync(path.join(d, "Voice", "SESLENDIRME-TAM-METIN.txt"), o.senaryo, "utf8");
  if (o.konu !== undefined) fs.writeFileSync(path.join(d, "konu.json"), JSON.stringify(o.konu, null, 2), "utf8");
  return d;
}
const senaryoUret = (n, k) => Array.from({ length: n }, (_, i) => Array.from({ length: k || 30 }, (_, j) => "terim" + i + "x" + j).join(" ") + ".").join("\n\n");

// Sahte internet (gorsel-akis testindeki ile ayni): kaynaklar{wikimedia:q=>[...], ...}; indirilen: url -> kac kez indirildi
function sahteAg(kaynaklar) {
  const resimler = new Map(), indirilen = new Map();
  const sayac = { gorsel: 0, json: 0 };
  const sorgular = [];
  const json = async (url) => {
    sayac.json++;
    const u = new URL(url), p = u.searchParams;
    const al = (ad, q) => { sorgular.push([ad, q]); const v = kaynaklar[ad] ? kaynaklar[ad](q) : []; if (v instanceof Error) throw v; return v; };
    if (u.hostname === "commons.wikimedia.org") return { query: { pages: al("wikimedia", p.get("gsrsearch").replace(/ filetype:bitmap$/, "")) } };
    if (u.hostname === "api.openverse.org") return { results: al("openverse", p.get("q")) };
    if (u.hostname === "api.pexels.com") return { photos: al("pexels", p.get("query")) };
    if (u.hostname === "pixabay.com") return { hits: al("pixabay", p.get("q")) };
    if (u.hostname === "images-api.nasa.gov") return { collection: { items: al("nasa", p.get("q")) } };
    throw new ag.AgHatasi("beklenmeyen adres: " + u.hostname, "adres");
  };
  const gorsel = async (url) => {
    sayac.gorsel++;
    indirilen.set(url, (indirilen.get(url) || 0) + 1);
    const r = resimler.get(url);
    if (!r) throw new ag.AgHatasi("HTTP 404", 404);
    if (r instanceof Error) throw r;
    return { govde: r, durum: 200, basliklar: {} };
  };
  const getir = async (url) => ({ govde: Buffer.from(JSON.stringify(await json(url))) });
  getir.json = json; getir.gorsel = gorsel;
  return { getir, resimler, indirilen, sayac, sorgular };
}
const thumbUrl = ad => "https://upload.test/thumb/" + encodeURIComponent(ad) + ".jpg";
function wiki(a, ad, o) {
  o = o || {};
  const en = o.en || 3000, boy = o.boy || 2000;
  a.resimler.set(thumbUrl(ad), o.govde || jpg(o.gercekEn || 1920, o.gercekBoy || 1080));
  return { pageid: ++_n, title: "File:" + ad + ".jpg",
    imageinfo: [{ thumburl: thumbUrl(ad), url: "https://upload.test/orig/" + encodeURIComponent(ad) + ".jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(ad),
      width: en, height: boy, thumbwidth: Math.min(en, 1920), thumbheight: Math.round(Math.min(en, 1920) * boy / en), mime: "image/jpeg",
      extmetadata: { LicenseShortName: { value: o.lisans || "CC0" }, Artist: { value: o.yazar || "Test Yazar" }, ImageDescription: { value: o.aciklama || "" } } }] };
}
const sirala = l => l.map((p, i) => Object.assign(p, { index: i + 1 }));
function bag(a, ek) {
  const log = [], uyarilar = [];
  return Object.assign({ getir: a.getir, bekle: bos, bekleKaynak: bos, aralik: {}, indirmeAra: 0, anahtarlar: { pexels: "", pixabay: "" },
    log: m => log.push(m), uyari: m => uyarilar.push(m), _log: log, _uyari: uyarilar }, ek || {});
}
const HAYVANLAR = ["bear", "wolf", "fox"];
// her sorgu icin "<q> PD one" (kamu mali) + "<q> BY one" (CC BY, atif gerekir) + yedek
const katalog = a => q => {
  if (q === "zzzz") return [];
  if (q === "polar") return sirala([wiki(a, "polar one", { aciklama: "polar" })]);
  if (q === "otter") return sirala([1, 2, 3].map(i => wiki(a, "otter " + i, { aciklama: "otter" })));
  return sirala([wiki(a, q + " PD one", { lisans: "Public domain", aciklama: q }), wiki(a, q + " BY one", { lisans: "CC BY 4.0", yazar: "Ayse Yilmaz", aciklama: q })]);
};
// 3 hayvan sahneli is + ilk calisma
async function ilkCalisma(is) {
  isKur(is, { senaryo: senaryoUret(3, 30), konu: { format: "long", sahneKelimeleri: HAYVANLAR.map(h => [h]) } });
  const a = sahteAg({ wikimedia: q => katalog(a)(q) });
  await calistir({ is }, bag(a));
  return a;
}

// ------------------------------------------------------------------ 1) kara liste yalniz BASLIKTA (regresyon)
const ctx = (sorgu, ek) => Object.assign({ sorgu, sorguTok: puan.sorguTokenleri(sorgu, "en"), yon: "yatay", siraLimiti: 40 }, ek || {});
const aday = (baslik, etiket, ek) => Object.assign({ kaynak: "wikimedia", baslik, etiket: etiket || "", sira: 0, en: 1920, boy: 1080, lisansSira: 0 }, ek || {});
const nasa = (baslik, etiket, ek) => Object.assign({ kaynak: "nasa", baslik, etiket: etiket || "", sira: 0, en: 0, boy: 0, lisansSira: 0, nasaKara: kaynak.KARA_NASA, nasaYumusak: kaynak.NASA_YUMUSAK }, ek || {});

test("kara liste YALNIZ BASLIGA bakar: NASA aciklamasindaki 'instrument', Commons kategorisindeki 'scan'/'map' gorseli ELEMEZ (VS haric)", () => {
  assert.equal(puan.puanla(nasa("Pillars of Creation", "Hubble's Wide Field Camera 3 instrument captured this scan of the pillars"), ctx("pillars of creation", { kozmik: true })).elendi, null);
  assert.equal(puan.puanla(nasa("Orion Nebula", "composite scan of the nebula, ground hardware and a dish antenna", {}), ctx("orion nebula", { kozmik: true })).elendi, null);
  assert.equal(puan.puanla(aday("DSC 1234", "map of the region; museum statue of a bear"), ctx("polar bear")).elendi, null, "Commons aciklamasi/kategorisi elemez");
  // baslikta gecen sert kelime hala eler
  assert.match(puan.puanla(nasa("Meeting of NASA staff", ""), ctx("nasa", { kozmik: true })).elendi, /kara liste/);
  assert.match(puan.puanla(nasa("Spiral galaxy chart", ""), ctx("spiral galaxy", { kozmik: true })).elendi, /kara liste/);
  assert.match(puan.puanla(aday("Map of polar bear range"), ctx("polar bear")).elendi, /kara liste/);
  // VS videosunda aciklama da sayilir (hayvan yerine heykel/oyuncak gelmesin): eski davranis korunur
  assert.match(puan.puanla(aday("DSC 1234", "bronze statue in a park"), ctx("polar bear", { vs: true, yon: "vs" })).elendi, /tür uyumsuz/);
});

test("tur sozcukleri (coin, newspaper, stamp, launch pad, telescope mirror) ELENMEZ, puan kirar; VS'de elenir; portre modunda da cezali", () => {
  const c = ctx("roman economy");
  for (const b of ["Roman gold coin", "Gold bars and coins", "Front page of the newspaper 1969", "Soviet postage stamp", "Apollo 11 poster", "Signature of Lincoln", "Medieval manuscript", "US dollar banknote", "CT scan of the brain"])
    assert.equal(puan.puanla(aday(b), c).elendi, null, b);
  const duz = puan.puanla(aday("Roman gold ring"), ctx("roman gold")), para = puan.puanla(aday("Roman gold coin"), ctx("roman gold"));
  assert.equal(Math.round(duz.puan - para.puan), 25, "belge cezasi 25");
  assert.match(puan.puanla(aday("Roman gold coin"), ctx("roman gold", { vs: true, yon: "vs" })).elendi, /tür uyumsuz/);
  // sorgunun kendisinde geciyorsa ceza yok
  assert.equal(puan.puanla(aday("Roman gold coin"), ctx("roman gold coin")).elendi, null);
  // portre/tarihsel mod: resim/heykel serbest, pul/banknot yine cezali
  const p = ctx("einstein", { yumusakKapali: true });
  assert.equal(puan.puanla(aday("Einstein oil painting"), p).puan, puan.puanla(aday("Einstein oil photo"), p).puan, "resim cezasiz");
  assert.ok(puan.puanla(aday("Einstein postage stamp"), p).puan < puan.puanla(aday("Einstein photograph"), p).puan - 20);
  // NASA: rampa/teleskop aynasi/sanatci cizimi elenmez, 25 puan kirar
  const rampa = puan.puanla(nasa("Saturn V on Launch Pad 39A", ""), ctx("saturn v rocket", { kozmik: true }));
  const rampasiz = puan.puanla(nasa("Saturn V on Launch Pad 39A", "", { nasaYumusak: null }), ctx("saturn v rocket", { kozmik: true }));
  assert.equal(rampa.elendi, null);
  assert.equal(Math.round(rampasiz.puan - rampa.puan), 25);
  for (const b of ["Webb telescope mirror segments", "Artist's illustration of an exoplanet - illustration of a gas giant", "Official portrait of Neil Armstrong", "Mission Control control room", "Black hole simulation"])
    assert.equal(puan.puanla(nasa(b, ""), ctx("space", { kozmik: true })).elendi, null, b);
  assert.ok(kaynak.KARA_NASA.source && kaynak.NASA_YUMUSAK.source);
});

test("gorsel-cek (NASA): aciklamada 'instrument' olan Pillars of Creation ve rampadaki Saturn V INER; toplanti/grafik elenir; ilerleme @@ILERLEME, nokta yok; ikinci calisma atlandi", async () => {
  const is = "duz-nasa";
  isKur(is, { konu: { format: "long", sahneler: [{ n: "01-uzay", q: ["pillars"] }, { n: "02-bos", q: ["hicbirsey"] }] } });
  const resimler = new Map();
  const oge = (id, baslik, aciklama) => {
    const taban = "https://images-assets.nasa.gov/image/" + id + "/" + id;
    resimler.set(taban + "~orig.jpg", jpg(3000, 2000));
    return { data: [{ title: baslik, description: aciklama, nasa_id: id, keywords: [], photographer: "NASA" }], links: [{ href: taban + "~thumb.jpg" }] };
  };
  const getir = async () => { throw new Error("cagrilmamali"); };
  getir.json = async (url) => {
    const q = new URL(url).searchParams.get("q");
    return { collection: { items: q === "pillars" ? [oge("P1", "Pillars of Creation", "Hubble WFC3 instrument scan"), oge("S1", "Saturn V on Launch Pad 39A", "Apollo launch"), oge("M1", "Meeting of NASA staff", "staff"), oge("C1", "Pillars chart diagram", "x")] : [] } };
  };
  getir.gorsel = async (u) => { const r = resimler.get(u); if (!r) throw new ag.AgHatasi("HTTP 404", 404); return { govde: r }; };
  const b = bag({ getir });
  let sonuc;
  const cikti = [];
  await Y.yakala(async c => { cikti.push(c); sonuc = await cek.calistir({ is, adet: 2 }, b); });
  const m = manifest(is);
  const s1 = m.sahneler.find(s => s.klasor === "01-uzay");
  assert.deepEqual(s1.gorseller.map(g => g.kaynakUrl.split("/").pop()).sort(), ["P1", "S1"], "tesadufi kelimeli ikisi de gelmeli");
  const hamCikti = cikti[0].join("");
  assert.match(hamCikti, /@@ILERLEME \{"asama":"nasa"/);
  assert.ok(!cikti[0].some(s => /^[.+x]+$/.test(s)), "satir sonu olmadan nokta basilmaz: " + JSON.stringify(cikti[0].filter(s => /^[.+x]+$/.test(s))));
  // 02-bos sahnesi dolu degil ve yeni gorsel gelmedi -> uyari (gercekten bos kalan sahne)
  assert.ok(b._uyari.some(u => /1 sahnede yeni görsel bulunamadı/.test(u)));
  assert.ok(!sonuc.atlandi);

  // ikinci calisma: 01-uzay zaten dolu (uyari/arama yok), 02-bos hala bos -> atlandi DEGIL; bu yuzden ayri bir dolu is ile idempotansi sina
  const is2 = "duz-nasa-dolu";
  isKur(is2, { konu: { format: "long", sahneler: [{ n: "01-uzay", q: ["pillars"] }] } });
  const b2 = bag({ getir });
  await Y.yakala(async () => { await cek.calistir({ is: is2, adet: 2 }, b2); });
  const b3 = bag({ getir });
  const cikti3 = [];
  let r3;
  await Y.yakala(async c => { cikti3.push(c); r3 = await cek.calistir({ is: is2, adet: 2 }, b3); });
  assert.equal(r3.atlandi, true);
  assert.ok(!b3._uyari.some(u => /yeni görsel bulunamadı/.test(u)), "hicbir sey yapilmayan calismada 'bulunamadi' uyarisi olmamali: " + b3._uyari);
  assert.match(cikti3[0].join(""), /@@SONUC \{"gorsel":0,"sahne":1,"atlandi":true,"neden":"görseller güncel"\}/);
});

// ------------------------------------------------------------------ 2) oran siniri + reddedilen adaylar
test("oran siniri: 2:3 ve 9:16 dikey fotograf yatay videoda REDDEDILMEZ (puan cezasi); yalniz asiri serit/panorama reddedilir", async () => {
  const harita = { "http://x/23": Y.jpegUret(1280, 1920), "http://x/916": Y.jpegUret(1080, 1920), "http://x/serit": Y.jpegUret(700, 1900), "http://x/yatay16": Y.jpegUret(1920, 1080), "http://x/pano": Y.jpegUret(1920, 700) };
  const getir = { gorsel: async u => ({ govde: harita[u] }) };
  const sec = ek => Object.assign({ getir, reddedilen: {}, gorulenSha: new Set(), bekle: bos }, ek || {});
  assert.deepEqual(indir.ORAN_SINIRI.yatay, [0.55, 4]);
  for (const u of ["http://x/23", "http://x/916"]) assert.ok(await indir.indirDene({ kaynak: "wikimedia", url: u }, sec({ oranSiniri: indir.ORAN_SINIRI.yatay })), u + " yatayda gecmeli");
  const o = sec({ oranSiniri: indir.ORAN_SINIRI.yatay });
  assert.equal(await indir.indirDene({ kaynak: "wikimedia", url: "http://x/serit" }, o), null);
  assert.equal(o.reddedilen["kadraja uymayan oran"], 1);
  // dikey video: 16:9 gecer (simetri), cok yatay panorama gecmez
  assert.ok(await indir.indirDene({ kaynak: "wikimedia", url: "http://x/yatay16" }, sec({ oranSiniri: indir.ORAN_SINIRI.dikey })));
  assert.equal(await indir.indirDene({ kaynak: "wikimedia", url: "http://x/pano" }, sec({ oranSiniri: indir.ORAN_SINIRI.dikey })), null);
  // sıralamada ceza duruyor: ayni alaka, dikey gorsel yatay videoda daha dusuk puan
  assert.ok(puan.puanla(aday("bear", "", { en: 1920, boy: 1080 }), ctx("bear")).puan > puan.puanla(aday("bear", "", { en: 1280, boy: 1920 }), ctx("bear")).puan);
});

test("reddedilen adaylar calisma boyunca hatirlanir (redUrl): ayni uygunsuz aday sahne basina yeniden INMEZ; gecici ag hatasi hatirlanmaz", async () => {
  const sayac = {};
  const harita = { "http://x/dar": Y.jpegUret(700, 1900), "http://x/html": Y.htmlHataSayfasi(), "http://x/kucuk": Y.jpegUret(900, 600),
    "http://x/gecici": new ag.AgHatasi("zaman asimi", "zaman_asimi") };
  const getir = { gorsel: async u => { sayac[u] = (sayac[u] || 0) + 1; const v = harita[u]; if (v instanceof Error) throw v; if (!v) throw new ag.AgHatasi("HTTP 404", 404); return { govde: v }; } };
  const adaylar = [{ kaynak: "wikimedia", url: "http://x/dar" }, { kaynak: "wikimedia", url: "http://x/html", yedekUrl: ["http://x/kucuk"] },
    { kaynak: "pexels", url: "http://x/yok404" }, { kaynak: "openverse", url: "http://x/gecici" }];
  const redUrl = new Set(), reddedilen = {};
  for (let sahne = 0; sahne < 4; sahne++)
    await indir.adaylardanIndir({ adaylar, kac: 1, getir, gorulenUrl: new Set(), gorulenSha: new Set(), reddedilen, redUrl, indirmeHata: {}, bekle: bos, aralikMs: 0,
      oranSiniri: indir.ORAN_SINIRI.yatay, silinen: { url: new Set(), sha1: new Set() } });
  assert.equal(sayac["http://x/dar"], 1, "kadraja uymayan aday bir kez inmeli");
  assert.equal(sayac["http://x/html"], 1); assert.equal(sayac["http://x/kucuk"], 1);
  assert.equal(sayac["http://x/yok404"], 1, "kalici 404 de hatirlanir");
  assert.equal(sayac["http://x/gecici"], 4, "gecici hata (zaman asimi) hatirlanmaz: sonra indirilebilir");
  assert.equal(reddedilen["kadraja uymayan oran"], 1, "reddetme sayaci da tek: " + JSON.stringify(reddedilen));
  assert.ok(indir.kaliciHataMi(new ag.AgHatasi("x", 404)) && indir.kaliciHataMi(new ag.AgHatasi("x", "cok_buyuk")));
  assert.ok(!indir.kaliciHataMi(new ag.AgHatasi("x", 429)) && !indir.kaliciHataMi(new ag.AgHatasi("x", 503)) && !indir.kaliciHataMi(new ag.AgHatasi("x", "zaman_asimi")));
});

test("akis: API 1920x1080 diyen ama gercekte kadraja uymayan 3 aday 6 sahnenin her birinde yeniden INMEZ (URL basina tek indirme)", async () => {
  const is = "duz-red";
  isKur(is, { senaryo: senaryoUret(6, 30), konu: { format: "long", sahneKelimeleri: Array.from({ length: 6 }, () => ["bear"]) } });
  const a = sahteAg({ wikimedia: () => {
    const l = [];
    for (let i = 1; i <= 3; i++) l.push(wiki(a, "bear bad " + i, { aciklama: "bear", gercekEn: 700, gercekBoy: 1900 }));
    for (let i = 1; i <= 14; i++) l.push(wiki(a, "bear good " + i, { aciklama: "bear" }));
    return sirala(l);
  } });
  await calistir({ is }, bag(a));
  const m = manifest(is);
  assert.equal(m.sahneler.length, 6);
  assert.ok(m.sahneler.every(s => s.gorseller.length === 2), "her sahne dolu");
  for (let i = 1; i <= 3; i++) assert.equal(a.indirilen.get(thumbUrl("bear bad " + i)), 1, "bear bad " + i + " " + a.indirilen.get(thumbUrl("bear bad " + i)) + " kez indi");
});

// ------------------------------------------------------------------ 3) --sahne N --ara: sahne bosalmaz (regresyon)
test("--sahne --ara sonuc vermezse: eski gorseller GERI KONUR, sahne bosalmaz, manifest ayni; yine de exit 4 + 'korundu' mesaji", async () => {
  const is = "duz-geri-yok";
  const a = await ilkCalisma(is);
  const once = manifest(is).sahneler[1];
  assert.equal(once.gorseller.length, 2);
  const b = bag(a);
  await assert.rejects(() => calistir({ is, sahne: 2, ara: "zzzz" }, b),
    e => e.kod === "gorsel_yok" && e.cikis === 4 && /Sahne 2 için "zzzz" aramasında yeni görsel bulunamadı; mevcut görseller korundu/.test(e.message));
  const sonra = manifest(is).sahneler[1];
  assert.deepEqual(shalar(sonra), shalar(once), "ayni gorseller");
  assert.equal(sonra.gorseller.length, 2);
  for (const g of sonra.gorseller) assert.ok(fs.existsSync(isYol(is, "Visuals", g.dosya)), "dosya yerinde: " + g.dosya);
  assert.deepEqual(sonra.aramalar, once.aramalar, "arama kaydi eski haliyle");
  assert.equal(sonra.kullanilanArama, once.kullanilanArama);
  assert.equal(sonra.durum, "tamam");
  assert.equal(arsivler(is).length, 0, "bos arsiv klasoru birakilmamali");
  // render'in gordugu klasorde de iki dosya var
  assert.equal(man.resimDosyalari(isYol(is, "Visuals", sonra.klasor)).length, 2);
});

test("--sahne --ara yetersiz sonuc: sahne 'eksik'e dusmesin diye eksik kalan kadari eski gorsellerden tamamlanir (uyari); fazlasi arsivde kalir; art arda iki arama dosya ezmez", async () => {
  const is = "duz-geri-kismi";
  const a = await ilkCalisma(is);
  const once = manifest(is).sahneler[1];
  const b = bag(a);
  await calistir({ is, sahne: 2, ara: "polar" }, b);                      // tek aday: 1 yeni + 1 eski
  const m = manifest(is).sahneler[1];
  assert.equal(m.gorseller.length, 2);
  assert.ok(m.gorseller.some(g => g.baslik === "polar one"), "yeni gorsel var");
  assert.equal(m.gorseller.filter(g => once.gorseller.some(o => o.sha1 === g.sha1)).length, 1, "eski gorsellerden biri geri konmus");
  assert.deepEqual(m.aramalar, ["polar"]);
  assert.equal(m.durum, "tamam");
  assert.ok(b._uyari.some(u => /Sahne 2: yeni aramada yalnızca 1 görsel bulundu; eski görsellerden 1 tanesi geri konuldu/.test(u)), b._uyari.join("|"));
  // ikinci yeniden arama (ayni saniyede olabilir): arsivdeki dosyalar ezilmemeli -> toplam 3 dosya (1 + 2) arsivde
  await calistir({ is, sahne: 2, ara: "otter" }, bag(a));
  const m2 = manifest(is).sahneler[1];
  assert.equal(m2.gorseller.length, 2);
  assert.ok(m2.gorseller.every(g => /^otter /.test(g.baslik)), "yeterli yeni gorsel varsa eskiler karismaz");
  let arsivDosya = 0;
  for (const d of arsivler(is)) arsivDosya += fs.readdirSync(isYol(is, "Visuals", d, m2.klasor)).length;
  assert.equal(arsivDosya, 3, "arsivlenen hicbir gorsel ezilmemeli");
});

test("--sahne --ara yeterli sonuc: eski gorseller _eski-<damga>/<klasor>/ altina tasinir (silinmez), yeni arama kaydedilir", async () => {
  const is = "duz-geri-tam";
  const a = await ilkCalisma(is);
  const once = manifest(is).sahneler[1];
  await calistir({ is, sahne: 2, ara: "otter" }, bag(a));
  const m = manifest(is).sahneler[1];
  assert.equal(m.gorseller.length, 2);
  assert.ok(m.gorseller.every(g => /^otter /.test(g.baslik)));
  assert.deepEqual(m.aramalar, ["otter"]);
  const arsiv = arsivler(is);
  assert.equal(arsiv.length, 1);
  assert.equal(fs.readdirSync(isYol(is, "Visuals", arsiv[0], once.klasor)).length, 2);
});

test("--sahne --ara beklenmeyen hata verirse (ag disi): eski gorseller geri konur, hata iletilir", async () => {
  const is = "duz-geri-hata";
  const a = await ilkCalisma(is);
  const once = manifest(is).sahneler[1];
  const y = new kaynak.KaynakYonetici({ getir: a.getir, anahtarlar: {}, etkin: {}, aralik: {}, bekle: bos });
  y.hepsindeAra = async () => { throw new Error("bomba"); };
  await assert.rejects(() => calistir({ is, sahne: 2, ara: "x" }, bag(a, { yonetici: y })), /bomba/);
  const sonra = manifest(is).sahneler[1];
  assert.deepEqual(shalar(sonra), shalar(once));
  for (const g of sonra.gorseller) assert.ok(fs.existsSync(isYol(is, "Visuals", g.dosya)));
});

// ------------------------------------------------------------------ 4) bozuk manifest: diskten yeniden bagla (regresyon)
test("bozuk manifest.json: sahne klasorleri arsive ATILMAZ, tekrar INDIRILMEZ; diskten yeniden baglanir; yedek + ATIF yedegi birakilir", async () => {
  const is = "duz-bozuk";
  const a = await ilkCalisma(is);
  const once = manifest(is);
  const atifOnce = fs.readFileSync(isYol(is, "ATIF.txt"), "utf8");
  assert.match(atifOnce, /Ayse Yilmaz/);
  const indirmeOnce = a.sayac.gorsel;
  fs.writeFileSync(isYol(is, "Visuals", "manifest.json"), '{ "surum": 1, "sahneler": [ { "no": 1, ');
  const b = bag(a);
  const r = await calistir({ is }, b);
  assert.equal(arsivler(is).length, 0, "klasorler arsive tasinmamali");
  assert.equal(a.sayac.gorsel, indirmeOnce, "yeniden indirme olmamali");
  const m = manifest(is);
  assert.equal(m.sahneler.length, 3);
  m.sahneler.forEach((s, i) => {
    assert.equal(s.klasor, once.sahneler[i].klasor);
    assert.deepEqual(shalar(s), shalar(once.sahneler[i]), "ayni dosyalar sahnelere yeniden baglanmis");
    assert.ok(s.gorseller.every(g => g.kaynak === "elle"), "kaynak bilgisi kurtarilamadi: elle");
  });
  assert.deepEqual([].concat(...m.sahneler.map(s => s.paragraflar)), [0, 1, 2]);
  const yedekler = fs.readdirSync(isYol(is, "Visuals"));
  assert.ok(yedekler.some(x => /^manifest\.bozuk-.*\.json$/.test(x)), "bozuk manifest yedegi");
  const atifYedek = yedekler.find(x => /^ATIF\.bozuk-.*\.txt$/.test(x));
  assert.ok(atifYedek, "ATIF yedegi: " + yedekler);
  assert.equal(fs.readFileSync(isYol(is, "Visuals", atifYedek), "utf8"), atifOnce, "atif bilgisi yedekte duruyor");
  assert.ok(b._uyari.some(u => /Manifest bozuktu: Visuals içindeki 3 sahne klasörü diskten yeniden bağlandı/.test(u)), b._uyari.join("|"));
  assert.equal(r.sonuc.atlandi, true, "sahneler yeterli: adim atlandi sayilir");

  // yapi gecersiz ("sahneler" liste degil) ayni sekilde ele alinir
  fs.writeFileSync(isYol(is, "Visuals", "manifest.json"), JSON.stringify({ surum: 1, sahneler: 5 }));
  await calistir({ is }, bag(a));
  assert.equal(arsivler(is).length, 0);
  assert.equal(a.sayac.gorsel, indirmeOnce);
  assert.equal(manifest(is).sahneler.length, 3);
});

test("manifestOkuDetay: yok / tamam / bozuk / gecersiz yapi / ust surum ayirt edilir; bozuk dosya yedeklenir", () => {
  const is = "duz-oku";
  isKur(is, { senaryo: senaryoUret(2, 30) });
  fs.mkdirSync(isYol(is, "Visuals"), { recursive: true });
  const f = isYol(is, "Visuals", "manifest.json");
  assert.equal(man.manifestOkuDetay(is).durum, "yok");
  fs.writeFileSync(f, JSON.stringify({ surum: 1, sahneler: [] }));
  assert.equal(man.manifestOkuDetay(is).durum, "tamam");
  fs.writeFileSync(f, "{ bozuk");
  let d = man.manifestOkuDetay(is);
  assert.equal(d.durum, "bozuk"); assert.ok(d.yedek && fs.existsSync(d.yedek)); assert.ok(!fs.existsSync(f));
  fs.writeFileSync(f, JSON.stringify({ surum: 1 }));
  d = man.manifestOkuDetay(is);
  assert.equal(d.durum, "bozuk"); assert.ok(!fs.existsSync(f), "gecersiz yapi da yedeklenir");
  fs.writeFileSync(f, JSON.stringify({ surum: 99, sahneler: [] }));
  assert.equal(man.manifestOkuDetay(is).durum, "ust-surum");
  assert.equal(man.manifestOku(is), null);
});

// ------------------------------------------------------------------ 5) komut satiri: degersiz bayrak
function cli(betik, args) {
  const r = spawnSync(process.execPath, [path.join(Y.KOK, betik)].concat(args), { encoding: "utf8", timeout: 60000, env: process.env });
  return { kod: r.status, out: r.stdout || "", err: r.stderr || "" };
}
test("gorsel-bul: degersiz --sahne / --limit-bekle / '--ara --bayrak' sessizce 1'e cevrilmez (exit 2); vs-gorsel-duzelt --taraf degersiz exit 2", () => {
  isKur("duz-cli", { senaryo: senaryoUret(2, 30), konu: { format: "long" } });
  let r = cli("gorsel-bul.js", ["duz-cli", "--sahne"]);
  assert.equal(r.kod, 2); assert.match(r.err, /✗ --sahne için bir sahne numarası ver/);
  r = cli("gorsel-bul.js", ["duz-cli", "--sahne", "--yeniden"]);
  assert.equal(r.kod, 2); assert.match(r.err, /--sahne için bir sahne numarası ver/);
  r = cli("gorsel-bul.js", ["duz-cli", "--limit-bekle"]);
  assert.equal(r.kod, 2); assert.match(r.err, /--limit-bekle için saniye ver/);
  r = cli("gorsel-bul.js", ["duz-cli", "--sahne", "2", "--ara", "--yeniden"]);
  assert.equal(r.kod, 2); assert.match(r.err, /--ara için bir arama ifadesi ver/);
  r = cli("vs-gorsel-duzelt.js", ["x", "--taraf"]);
  assert.equal(r.kod, 2); assert.match(r.err, /--taraf için ust ya da alt ver/);
  // gecerli bayrak ayni dogrulamadan gecer (hata baska yerden gelir: kaynaklar kapali degil ama senaryo/ag yok -> exit 2 degil 'Kullanim' degil)
  r = cli("gorsel-bul.js", ["duz-cli", "--sahne", "3", "--limit-bekle", "0"]);
  assert.doesNotMatch(r.err, /için bir sahne numarası ver|için saniye ver/);
});

// ------------------------------------------------------------------ 6) @@ILERLEME ve idempotans (portre, uret, vs)
function wikiAg(katalogFn) {
  const resimler = new Map();
  const sayfa = (i, ad, lisans) => {
    const thumb = "https://upload.test/p/" + encodeURIComponent(ad) + ".jpg";
    resimler.set(thumb, jpg(1280, 1920));                       // 2:3 dikey portre fotografi (eskiden yatay videoda reddedilirdi)
    return { pageid: i, index: i, title: "File:" + ad + ".jpg", imageinfo: [{ thumburl: thumb, url: thumb, descriptionurl: "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(ad),
      width: 1920, height: 2400, thumbwidth: 1920, thumbheight: 2400, mime: "image/jpeg",
      extmetadata: { LicenseShortName: { value: lisans }, Artist: { value: "Foto Yazari" }, ImageDescription: { value: ad } } }] };
  };
  const getir = async () => { throw new Error("cagrilmamali"); };
  getir.json = async (url) => { const q = new URL(url).searchParams.get("gsrsearch").replace(/ filetype:bitmap$/, ""); return { query: { pages: katalogFn(q, sayfa) } }; };
  getir.gorsel = async (url) => { const r = resimler.get(url); if (!r) throw new ag.AgHatasi("HTTP 404", 404); return { govde: r }; };
  return { getir };
}

test("portre-cek: @@ILERLEME (nokta yok), 2:3 dikey portre yatay videoda ALINIR; ikinci calisma 'atlandi' ve yeni-gorsel-bulunamadi uyarisi yok", async () => {
  const is = "duz-portre";
  isKur(is, { konu: { format: "long", portreler: [{ n: "03-einstein", q: ["Albert Einstein"], adet: 2 }] } });
  const a = wikiAg((q, sayfa) => [sayfa(1, "Albert Einstein 1921", "Public domain"), sayfa(2, "Albert Einstein at work", "CC BY 4.0"), sayfa(3, "Albert Einstein extra", "CC0")]);
  const cikti = [];
  let r1;
  await Y.yakala(async c => { cikti.push(c); r1 = await portre.calistir({ is }, bag(a)); });
  assert.equal(r1.toplam, 2, "1280x1920 (2:3) dikey portreler yatay videoda reddedilmemeli");
  assert.match(cikti[0].join(""), /@@ILERLEME \{"asama":"portre"/);
  assert.ok(!cikti[0].some(s => /^[.+x]+$/.test(s)), "nokta yok");
  const b2 = bag(a), cikti2 = [];
  let r2;
  await Y.yakala(async c => { cikti2.push(c); r2 = await portre.calistir({ is }, b2); });
  assert.equal(r2.toplam, 0); assert.equal(r2.atlandi, true);
  assert.ok(!b2._uyari.some(u => /görsel bulunamadı/.test(u)));
  assert.match(cikti2[0].join(""), /@@SONUC \{"gorsel":0,"sahne":1,"atlandi":true,"neden":"portreler güncel"\}/);
});

test("gorsel-uret: ilerleme @@ILERLEME (satir sonu olmadan '+'/'x' basilmaz); basarisiz uretimde hata satiri gorunur; ikinci calisma @@SONUC atlandi", async () => {
  uretici.sifirla();
  const is = "duz-uret";
  isKur(is, { senaryo: senaryoUret(2, 30), konu: { format: "long", uretAdet: 2, sahneKelimeleri: [["uret: glowing lattice"], ["uret: neural network"]] } });
  const getir = async (u) => { if (/neural/.test(decodeURIComponent(u))) throw new ag.AgHatasi("HTTP 502", 502); return { govde: Y.jpegUret(1280, 720, { bayt: 3000 + (++_n) }) }; };
  const cikti = [];
  await Y.yakala(async c => {
    cikti.push(c);
    await assert.rejects(() => uretici.isModu(is, false, { getir }), e => e.kod === "uretim_basarisiz" && e.cikis === 4);
  });
  const metin = cikti[0].join("");
  assert.match(metin, /@@ILERLEME \{"asama":"gorsel-uret"/);
  assert.ok(!cikti[0].some(s => /^[.+x]+$/.test(s)), "'+'/'x' tek basina basilmaz: " + JSON.stringify(cikti[0].filter(s => /^[.+x]+$/.test(s))));
  assert.match(metin, /→ 2\/2 görsel/);
  assert.match(metin, /→ 0\/2 görsel/);
  assert.match(metin, / ! /, "hata nedeni satir olarak gorunur");

  // tamamen uretilmis bir is: ikinci calisma atlandi
  uretici.sifirla();
  const is2 = "duz-uret-tamam";
  isKur(is2, { senaryo: senaryoUret(1, 30), konu: { format: "long", uretAdet: 2, sahneKelimeleri: [["uret: glowing lattice"]] } });
  const ok = async () => ({ govde: Y.jpegUret(1280, 720, { bayt: 3000 + (++_n) }) });
  await Y.yakala(async () => { await uretici.isModu(is2, false, { getir: ok }); });
  const cikti2 = [];
  await Y.yakala(async c => { cikti2.push(c); await uretici.isModu(is2, false, { getir: ok }); });
  assert.match(cikti2[0].join(""), /@@SONUC \{"uretilen":0,"atlanan":1,"atlandi":true,"neden":"görseller zaten üretilmiş"\}/);
});

// VS
const tanim = () => ({ surum: 1, baslik: "POLAR BEAR vs WOLF",
  ust: { ad: "POLAR BEAR", renk: "3BE07A", ara: "polar bear arctic", zorunlu: ["polar", "bear"] },
  alt: { ad: "WOLF", renk: "FFB020", ara: "gray wolf wild", zorunlu: ["wolf"] },
  olculer: [{ ad: "SPEED", ustDeger: 40, ustMetin: "40 km/h", altDeger: 60, altMetin: "60 km/h", kazanan: "alt", not: "wolves are faster" }],
  kazanan: "alt", sonuc: "Wolf wins.", sonuc2: "Bear loses." });
function vsOrtam() {
  const resimler = new Map(), say = {};
  let n = 0;
  const ekle = (baslik, en, boy) => {
    const url = "https://img.test/" + (++n) + ".jpg";
    resimler.set(url, Y.jpegUret(en, boy, { bayt: 3000 + (++_n) }));
    return Object.assign({ kaynak: "pexels", url, yedekUrl: [], baslik, etiket: "", atif: "Foto", kaynakUrl: "https://www.pexels.com/photo/" + n + "/", indirmeUrl: url, en: 1600, boy: 1400, sira: n }, lisansCoz("pexels"));
  };
  const getir = async () => { throw new Error("cagrilmamali"); };
  getir.json = async () => { throw new Error("cagrilmamali"); };
  getir.gorsel = async u => { say[u] = (say[u] || 0) + 1; const r = resimler.get(u); if (!r) throw new ag.AgHatasi("HTTP 404", 404); return { govde: r }; };
  return { ekle, getir, say };
}
test("vs-kur / vs-gorsel-duzelt: @@ILERLEME (taraf basina); iki tarafin da gordugu uygunsuz aday TEK kez iner (paylasilan redUrl)", async () => {
  const is = "duz-vs";
  const d = isKur(is, {});
  fs.writeFileSync(path.join(d, "vs-tanim.json"), JSON.stringify(tanim(), null, 2));
  const o = vsOrtam();
  // ortak 'kotu' aday: API 1600x1400 diyor, gercekte 600x3000 (kadraja uymaz); her iki taraf da en ustte gorur
  const kotu = o.ekle("polar bear and gray wolf wild portrait", 600, 3000);
  const kotuHam = Object.assign({}, kotu);
  const pexels = async q => /polar/.test(q) ? [kotuHam, o.ekle("polar bear on ice floe", 1600, 1400)] : [kotuHam, o.ekle("gray wolf wild howling", 1500, 1500)];
  const b = { getir: o.getir, anahtarlar: { pexels: "x", pixabay: "" }, istemciler: { pexels, pixabay: async () => [], wikimedia: async () => [], openverse: async () => [], nasa: async () => [] },
    bekle: bos, bekleKaynak: bos, aralik: {}, log: () => {}, uyari: () => {} };
  const cikti = [];
  let sonuc;
  await Y.yakala(async c => { cikti.push(c); sonuc = await vsKur.calistir({ ids: [is] }, b); });
  assert.equal(sonuc.yeni, 2);
  assert.equal(o.say[kotu.url], 1, "kotu aday iki tarafta toplam bir kez indi: " + o.say[kotu.url]);
  assert.match(cikti[0].join(""), /@@ILERLEME \{"asama":"vs-kur"/);
  assert.ok(!cikti[0].some(s => /^[.+x]+$/.test(s)));
  const cikti2 = [];
  await Y.yakala(async c => { cikti2.push(c); await duzelt.calistir({ ids: [is] }, b); });
  assert.match(cikti2[0].join(""), /@@ILERLEME \{"asama":"vs-duzelt"/);
});

// ------------------------------------------------------------------ 7) ag: fake-ip, ortam degiskeni, protokol dusurme
test("ag-guvenlik: proxy 'fake-ip' (198.18.0.0/15) cozumu engellenmez; 100.64/10, 127.x ve karisik cozum engellenir; IP-literal 198.18.x.x hala engelli", async () => {
  assert.ok(agGuvenlik.fakeIpMi("198.18.0.7") && agGuvenlik.fakeIpMi("198.19.255.1"));
  assert.ok(!agGuvenlik.fakeIpMi("198.20.0.1") && !agGuvenlik.fakeIpMi("100.64.0.1") && !agGuvenlik.fakeIpMi("127.0.0.1"));
  const dns = adresler => ({ lookup: async () => adresler.map(address => ({ address, family: 4 })) });
  assert.equal(await agGuvenlik.adYerelCozuluyorMu("pexels.example", { dns: dns(["198.18.0.7"]) }), false, "Clash/Surge fake-ip");
  assert.equal(await agGuvenlik.adYerelCozuluyorMu("pexels.example", { dns: dns(["198.18.0.7", "198.19.1.2"]) }), false);
  assert.equal(await agGuvenlik.adYerelCozuluyorMu("tailnet.example", { dns: dns(["100.64.0.5"]) }), true, "CGNAT/tailnet hala engelli");
  assert.equal(await agGuvenlik.adYerelCozuluyorMu("ic.example", { dns: dns(["127.0.0.1"]) }), true);
  assert.equal(await agGuvenlik.adYerelCozuluyorMu("karisik.example", { dns: dns(["198.18.0.7", "192.168.1.5"]) }), true, "fake-ip yaninda gercek yerel adres de varsa engellenir");
  assert.equal(agGuvenlik.yerelAdresMi("198.18.0.7"), true, "dogrudan IP olarak yazilan 198.18.x.x tablodaki gibi engelli");
});

test("GORSEL_YEREL_AG_IZIN=1: yalniz ad cozumleme denetimini kapatir; IP-literal yerel adres yine reddedilir", async () => {
  const eski = process.env.GORSEL_YEREL_AG_IZIN;
  try {
    delete process.env.GORSEL_YEREL_AG_IZIN;
    assert.equal(ag.dnsDenetimiKapaliMi(), false);
    process.env.GORSEL_YEREL_AG_IZIN = "1";
    assert.equal(ag.dnsDenetimiKapaliMi(), true);
    process.env.GORSEL_YEREL_AG_IZIN = "0";
    assert.equal(ag.dnsDenetimiKapaliMi(), false);
    process.env.GORSEL_YEREL_AG_IZIN = "1";
    await assert.rejects(() => ag.tekIstek("http://192.168.1.10/x", {}, 0), e => e.kod === "yerel_adres" && !e.adCozumu);
    assert.match(ag.hataOzeti(new ag.AgHatasi("x", "yerel_adres", { adCozumu: true })), /GORSEL_YEREL_AG_IZIN=1/);
    assert.equal(ag.hataOzeti(new ag.AgHatasi("x", "yerel_adres")), "yerel ağ adresi engellendi");
  } finally { if (eski === undefined) delete process.env.GORSEL_YEREL_AG_IZIN; else process.env.GORSEL_YEREL_AG_IZIN = eski; }
});

// sahte https/http modulleri: yonlendirme ve gonderilen basliklar kaydedilir
function sahteModul(kayit, davranis) {
  return { request(u, opts, cb) {
    const req = new EventEmitter();
    req.destroy = () => {}; req.write = () => {};
    req.end = () => setImmediate(() => {
      kayit.push({ url: u.toString(), basliklar: Object.assign({}, opts.headers) });
      const d = davranis(u);
      const res = new EventEmitter();
      res.statusCode = d.durum; res.headers = d.basliklar || {}; res.resume = () => {};
      cb(res);
      if (d.govde) setImmediate(() => { res.emit("data", Buffer.from(d.govde)); res.emit("end"); });
    });
    return req;
  } };
}
test("yonlendirme: https -> http (ayni makine) ve baska makineye gecerken Authorization/Cookie DUSER; ayni makine ve protokolde korunur", async () => {
  const kHttps = [], kHttp = [];
  const davranis = u => {
    if (u.pathname === "/ayni") return { durum: 302, basliklar: { location: "/hedef" } };
    if (u.pathname === "/dusur") return { durum: 302, basliklar: { location: "http://api.pexels.test/hedef" } };
    if (u.pathname === "/baska") return { durum: 302, basliklar: { location: "https://cdn.baska.test/hedef" } };
    return { durum: 200, govde: "tamam" };
  };
  const o = { https: sahteModul(kHttps, davranis), http: sahteModul(kHttp, davranis), basliklar: { Authorization: "GIZLI-ANAHTAR", Cookie: "c=1", Accept: "application/json" } };
  await ag.tekIstek("https://api.pexels.test/ayni", o, 0);
  assert.equal(kHttps.length, 2); assert.equal(kHttps[1].basliklar.Authorization, "GIZLI-ANAHTAR", "ayni makine + protokol: anahtar korunur");
  kHttps.length = 0;
  await ag.tekIstek("https://api.pexels.test/dusur", o, 0);
  assert.equal(kHttp.length, 1, "http'ye yonlendirildi");
  assert.ok(!("Authorization" in kHttp[0].basliklar) && !("Cookie" in kHttp[0].basliklar), "acik metin http'ye anahtar gitmemeli: " + JSON.stringify(kHttp[0].basliklar));
  assert.equal(kHttp[0].basliklar.Accept, "application/json", "hassas olmayan baslik korunur");
  kHttps.length = 0;
  await ag.tekIstek("https://api.pexels.test/baska", o, 0);
  assert.ok(!("Authorization" in kHttps[1].basliklar), "baska makineye anahtar gitmemeli");
});
