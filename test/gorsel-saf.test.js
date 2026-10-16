// GO — saf fonksiyon testleri: arama kelimesi cikarimi, plan, puanlama/kara liste, lisans, dogrulama, ag istemcisi.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const yardim = require("./gorsel-yardim.js");
const sorgu = require("../lib/gorsel-sorgu.js");
const puan = require("../lib/gorsel-puan.js");
const lisans = require("../lib/gorsel-lisans.js");
const dogrula = require("../lib/gorsel-dogrula.js");
const ag = require("../lib/gorsel-ag.js");
const man = require("../lib/gorsel-manifest.js");

test.after(() => yardim.temizle());

// ------------------------------------------------------------------ arama kelimesi cikarimi
test("kelimeler: Unicode harfleri atmaz, Turkce durak sozcukleri ve ek'i ayiklar", () => {
  assert.deepEqual(sorgu.kelimeler("Albert Einstein'in kara delik teorisi çok önemliydi", "tr"),
    ["albert", "einstein", "kara", "delik", "teorisi", "önemliydi"]);
  const en = sorgu.kelimeler("The café in Zürich and the cat", "en");
  assert.ok(en.includes("café") && en.includes("zürich") && en.includes("cat"), String(en));
  assert.ok(!en.includes("the") && !en.includes("and"));
  assert.ok(!sorgu.kelimeler("ve bir bu için", "tr").length);
});

test("ozelIsimler: cumle basi siradan kelime atilir, kisaltmalar yakalanir", () => {
  const metin = "Imagine Einstein standing in Zurich. NASA and CERN study black holes. Albert Einstein changed physics. We imagine things.";
  const kucuk = sorgu.kucukSozluk(metin, "en");
  const hepsi = [].concat(...metin.split(". ").map(p => sorgu.ozelIsimler(p, { dil: "en", kucuk })));
  assert.ok(hepsi.includes("Einstein"), "Imagine Einstein -> Einstein");
  assert.ok(!hepsi.some(x => /^Imagine/.test(x)), "Imagine ozel isim sayilmamali: " + hepsi);
  assert.ok(hepsi.includes("NASA") && hepsi.includes("CERN"), "kisaltmalar yakalanmali");
  assert.ok(hepsi.includes("Albert Einstein"));
  assert.ok(hepsi.includes("Zurich"));
  // Turkce buyuk harfler
  assert.deepEqual(sorgu.ozelIsimler("Dün İstanbul Boğazı çok güzeldi.", { dil: "tr", kucuk: new Set() }).slice(0, 1), ["İstanbul Boğazı"]);
});

test("ifadeCikar: ozel isim once, bos kalmaz, tekrar eden ikili ifade one gecer", () => {
  const txt = "A black hole bends light. Scientists study each black hole carefully. Another black hole appears near the star.";
  const par = txt.split(". ").map(x => x + ".");
  const kucuk = sorgu.kucukSozluk(txt, "en");
  const gs = {}; for (const w of sorgu.kelimeler(txt, "en")) gs[w] = (gs[w] || 0) + 1;
  const ikili = sorgu.ikiliSayimlari(txt, "en");
  const l = sorgu.ifadeCikar(par[0], { dil: "en", genelSayim: gs, toplamKelime: 20, capa: ["black hole"], paragrafta: { black: 3, hole: 3 }, kucuk, ikiliGenel: ikili });
  assert.ok(l.length >= 2);
  assert.ok(l.includes("black hole"), "ikili kavram aday olmali: " + l);
});

test("kozmikMi: tek 'space' yetmez, guclu terimler >=3 gerekir", () => {
  assert.equal(sorgu.kozmikMi("He had half a second of space to react."), false);
  assert.equal(sorgu.kozmikMi("The galaxy holds a black hole near a planet."), true);
  assert.equal(sorgu.kozmikSahneMi("moon landing"), true);
});

test("sahnePlan: HICBIR paragraf dusmez, kisalar komsuyla birlesir, indeksler ardisik", () => {
  const par = ["Short.", "x ".repeat(30).trim(), "tiny", "y ".repeat(40).trim(), "end"];
  const plan = sorgu.sahnePlan(par, {});
  const hepsi = [].concat(...plan.map(s => s.paragraflar));
  assert.deepEqual(hepsi, [0, 1, 2, 3, 4]);
  plan.forEach((s, i) => assert.equal(s.no, i + 1));
  // 8 harfli "tiny" paragrafi ayri sahne olmaz
  assert.ok(plan.every(s => s.kelime >= 22 || plan.length === 1));
});

test("sahneAdetleri: 2-14 arasi; cok uzun videoda toplam ~160 tavanina iner", () => {
  const az = sorgu.sahneAdetleri(Array.from({ length: 10 }, () => ({ kelime: 90 })), { kelimeHizi: 151 });
  assert.ok(az.every(x => x >= 2 && x <= 14));
  assert.equal(sorgu.sahneAdetleri([{ kelime: 10 }], { kelimeHizi: 151 })[0], 2);
  const cok = sorgu.sahneAdetleri(Array.from({ length: 120 }, () => ({ kelime: 90 })), { kelimeHizi: 151 });
  const toplam = cok.reduce((p, c) => p + c, 0);
  assert.ok(toplam <= 175, "toplam " + toplam);
  assert.ok(cok.every(x => x >= 1));
});

test("sahneKlasorAdi: 3 hane + ASCII slug", () => {
  assert.equal(sorgu.sahneKlasorAdi(7, "Albert Einstein"), "007-albert-einstein");
  assert.equal(sorgu.sahneKlasorAdi(120, "Şeker Fabrikası"), "120-seker-fabrikasi");
  assert.equal(sorgu.sahneKlasorAdi(1, "???"), "001-sahne");
});

// ------------------------------------------------------------------ klasor sirasi (B086)
test("sayisalSirala: 100+ sahnede sahne 100, sahne 11'den ONCE gelmez", () => {
  const adlar = [];
  for (let i = 1; i <= 120; i++) adlar.push(String(i).padStart(3, "0") + "-x");
  const karisik = adlar.slice().sort(() => 0.5 - Math.random()).concat(["11-eski", "09-eski", "100-eski"]);
  karisik.sort(man.sayisalSirala);
  const sayilar = karisik.map(a => parseInt(a, 10));
  for (let i = 1; i < sayilar.length; i++) assert.ok(sayilar[i - 1] <= sayilar[i], "sirasiz: " + sayilar[i - 1] + " > " + sayilar[i]);
  // harf sirasi hatasi: "100-x" < "11-x"
  assert.ok(["100-x", "11-x"].sort()[0] === "100-x");
  assert.ok(["100-x", "11-x"].sort(man.sayisalSirala)[0] === "11-x");
});

// ------------------------------------------------------------------ puanlama
const ctx = (ek) => Object.assign({ sorgu: "polar bear", sorguTok: puan.sorguTokenleri("polar bear", "en"), yon: "yatay", siraLimiti: 40, aramaDili: "en" }, ek || {});
const aday = (o) => Object.assign({ kaynak: "pexels", baslik: "polar bear on ice", etiket: "", sira: 0, en: 1920, boy: 1080, lisansSira: 0 }, o || {});

test("puan: ALAKA, dosya boyutundan once gelir (eski hata: en buyuk dosya secilirdi)", () => {
  const alakali = puan.puanla(aday({ sira: 0, en: 1400, boy: 788, baslik: "polar bear walking" }), ctx());
  const buyukAlakasiz = puan.puanla(aday({ sira: 37, en: 6000, boy: 3375, baslik: "arctic sunset landscape" }), ctx());
  assert.ok(alakali.puan > buyukAlakasiz.puan, alakali.puan + " > " + buyukAlakasiz.puan);
});

test("puan: kara liste harita/diyagram/logo/taranmis sayfayi eler; sorgunun kendisi bu kelimeyi iceriyorsa elemez", () => {
  assert.ok(puan.puanla(aday({ baslik: "Map of polar bear habitat" }), ctx()).elendi);
  assert.ok(puan.puanla(aday({ baslik: "Polar bear logo" }), ctx()).elendi);
  assert.ok(puan.puanla(aday({ baslik: "scanned page of an old book" }), ctx()).elendi);
  const c = ctx({ sorgu: "world map", sorguTok: puan.sorguTokenleri("world map", "en") });
  assert.equal(puan.puanla(aday({ baslik: "world map of 1500" }), c).elendi, null);
});

test("puan: heykel/oyuncak sert elenmez ama puani kirilir; VS modunda ELENIR", () => {
  const normal = puan.puanla(aday({ baslik: "polar bear" }), ctx());
  const heykel = puan.puanla(aday({ baslik: "polar bear bronze statue" }), ctx());
  assert.equal(heykel.elendi, null);
  assert.ok(heykel.puan < normal.puan - 10);
  const vs = puan.puanla(aday({ baslik: "polar bear bronze statue" }), ctx({ vs: true, yon: "vs" }));
  assert.match(vs.elendi, /tür uyumsuz/);
  const portre = puan.puanla(aday({ baslik: "portrait painting of Lincoln" }), ctx({ sorgu: "Lincoln", sorguTok: ["lincoln"], yumusakKapali: true }));
  assert.equal(portre.elendi, null);
});

test("puan: kelime SINIRLI eslesme — 'part' ve 'carpet' 'art'/'pet' yasagina takilmaz (eski regex hatasi)", () => {
  const c = ctx({ sorgu: "wolf", sorguTok: ["wolf"], yasak: ["art", "pet"], vs: true, yon: "vs" });
  assert.equal(puan.puanla(aday({ baslik: "wolf in a carpet of snow, part of the pack" }), c).elendi, null);
  assert.match(puan.puanla(aday({ baslik: "wolf pet photo" }), c).elendi, /yasak/);
});

test("puan: zorunlu kelimelerden EN AZ BIRI aday metninde olmali", () => {
  const c = ctx({ sorgu: "honey badger", sorguTok: ["honey", "badger"], zorunlu: ["badger"], vs: true, yon: "vs" });
  assert.match(puan.puanla(aday({ baslik: "bronze bee statue" }), c).elendi, /tür uyumsuz|zorunlu/);
  assert.match(puan.puanla(aday({ baslik: "random animal outdoors" }), c).elendi, /zorunlu/);
  assert.equal(puan.puanla(aday({ baslik: "honey badger hunting", etiket: "" }), c).elendi, null);
  // kelime sinirli: "badgers" (cogul) eslesir, "badge" eslesmez
  assert.equal(puan.puanla(aday({ baslik: "two badgers" }), c).elendi, null);
});

test("puan: cozunurluk alt esigi (uzun kenar >=1280) ve yon cezasi", () => {
  assert.match(puan.puanla(aday({ en: 800, boy: 600 }), ctx()).elendi, /çözünürlük/);
  const yatay = puan.puanla(aday({ en: 1920, boy: 1080 }), ctx());
  const dikeyFoto = puan.puanla(aday({ en: 1080, boy: 1920 }), ctx());
  assert.ok(dikeyFoto.puan < yatay.puan - 15, "yatay videoda dikey foto cezali olmali");
  const dikeyVideo = puan.puanla(aday({ en: 1080, boy: 1920 }), ctx({ yon: "dikey" }));
  assert.ok(dikeyVideo.puan > dikeyFoto.puan);
  // VS: ~1.1:1 kare ya da hafif yatay tercih edilir
  const kare = puan.puanla(aday({ en: 1600, boy: 1400 }), ctx({ vs: true, yon: "vs", hedefOran: 1.125, oranAgirlik: 60 }));
  const uzun = puan.puanla(aday({ en: 1000, boy: 1600 }), ctx({ vs: true, yon: "vs", hedefOran: 1.125, oranAgirlik: 60 }));
  assert.ok(kare.puan > uzun.puan + 25, kare.puan + " vs " + uzun.puan);
});

test("puan: kanonikUrl sorgu parametresini atar", () => {
  assert.equal(puan.kanonikUrl("https://X.com/a/b.jpg?w=100#z"), "https://x.com/a/b.jpg");
});

// ------------------------------------------------------------------ lisans
test("lisans: NC ve ND ELENIR (Openverse)", () => {
  for (const k of ["by-nc", "by-nd", "by-nc-sa", "by-nc-nd", "nc-sampling+", "sampling+"])
    assert.equal(lisans.openverseLisans(k, "2.0").kabul, false, k);
  const by = lisans.openverseLisans("by", "4.0");
  assert.equal(by.kabul, true); assert.equal(by.lisansKodu, "by"); assert.equal(by.lisans, "CC BY 4.0");
  assert.equal(by.atifGerekli, true); assert.equal(by.lisansSira, 1);
  const sa = lisans.openverseLisans("by-sa", "3.0");
  assert.equal(sa.lisansKodu, "by-sa"); assert.ok(sa.uyari, "BY-SA icin uyari olmali"); assert.equal(sa.lisansSira, 2);
  assert.equal(lisans.openverseLisans("cc0", "1.0").lisansKodu, "cc0");
  assert.equal(lisans.openverseLisans("cc0", "1.0").atifGerekli, false);
  assert.equal(lisans.openverseLisans("pdm", "1.0").lisansKodu, "pdm");
});

test("lisans: Wikimedia lisans adlari", () => {
  const k = a => lisans.wikimediaLisans(a, {});
  assert.equal(k("CC BY-NC 4.0").kabul, false);
  assert.equal(k("CC BY-ND 2.0").kabul, false);
  assert.equal(k("GFDL 1.2").kabul, false);
  assert.equal(lisans.wikimediaLisans("CC BY 4.0", { nonFree: "true" }).kabul, false);
  assert.equal(k("CC BY-SA 4.0").lisansKodu, "by-sa");
  assert.equal(k("CC BY 2.0").lisansKodu, "by");
  assert.equal(k("CC0").lisansKodu, "cc0");
  assert.equal(k("Public domain").lisansKodu, "pdm");
  assert.equal(k("PD-old-70").lisansKodu, "pdm");
  assert.equal(k("PD-USGov-NASA").lisansKodu, "pdm");
  const bil = k("Garip Lisans 3");
  assert.equal(bil.kabul, true); assert.equal(bil.lisansKodu, "bilinmiyor"); assert.equal(bil.atifGerekli, true);
});

test("lisans: atif listesine yalniz CC BY, CC BY-SA ve Pexels girer", () => {
  const g = kod => ({ lisansKodu: kod, atifGerekli: kod === "by" || kod === "by-sa" });
  assert.ok(lisans.atifListesineGirer(g("by")) && lisans.atifListesineGirer(g("by-sa")) && lisans.atifListesineGirer(g("pexels")));
  assert.ok(!lisans.atifListesineGirer(g("cc0")) && !lisans.atifListesineGirer(g("pixabay")) && !lisans.atifListesineGirer(g("nasa")) && !lisans.atifListesineGirer(g("ai")));
});

// ------------------------------------------------------------------ dogrulama
test("dogrula: sihirli bayt, gercek boyut (JPEG+PNG), cozunurluk esigi", { skip: !yardim.ffmpegVarMi() && "ffmpeg yok" }, () => {
  const jpg = yardim.gorselUret("jpg", 1920, 1080);
  const png = yardim.gorselUret("png", 1600, 900);
  const kucuk = yardim.gorselUret("jpg", 640, 360);
  const dikey = yardim.gorselUret("jpg", 1080, 1920);
  let v = dogrula.dogrula(jpg);
  assert.equal(v.tamam, true); assert.equal(v.tur, "jpg"); assert.deepEqual([v.en, v.boy], [1920, 1080]); assert.equal(v.uzanti, ".jpg");
  v = dogrula.dogrula(png);
  assert.equal(v.tamam, true); assert.equal(v.tur, "png"); assert.deepEqual([v.en, v.boy], [1600, 900]);
  v = dogrula.dogrula(kucuk);
  assert.equal(v.tamam, false); assert.match(v.neden, /çözünürlük düşük/);
  assert.equal(dogrula.dogrula(kucuk, { minUzunKenar: 0 }).tamam, true);
  v = dogrula.dogrula(dikey);
  assert.deepEqual([v.en, v.boy], [1080, 1920]);
  // ek bayt (tekil kopya) boyutu bozmaz
  assert.deepEqual(dogrula.boyutOku(yardim.tekil(jpg, 5)), { en: 1920, boy: 1080 });
  // sha1 farkli
  assert.notEqual(dogrula.dogrula(yardim.tekil(jpg, 1)).sha1, dogrula.dogrula(yardim.tekil(jpg, 2)).sha1);
});

test("dogrula: HTML/WebP/SVG/kisa dosya reddedilir; 25 MB siniri", () => {
  const html = yardim.htmlSayfasi();
  assert.equal(dogrula.dogrula(html).tamam, false);
  assert.match(dogrula.dogrula(html).neden, /görsel değil/);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(5000)]);
  assert.equal(dogrula.dogrula(webp).tamam, false);
  assert.equal(dogrula.dogrula(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>".repeat(200))).tamam, false);
  assert.equal(dogrula.dogrula(Buffer.alloc(100)).tamam, false);
  assert.equal(dogrula.dogrula(Buffer.alloc(5000, 1), { maksBayt: 4000 }).tamam, false);
});

test("dogrula: EXIF yonu 6/8 ise en-boy yer degistirir", () => {
  // minimal JPEG: SOI, APP1(Exif, orientation=6), SOF0 800x600, EOI
  const exif = Buffer.concat([
    Buffer.from("Exif\0\0"), Buffer.from("MM"), Buffer.from([0, 42, 0, 0, 0, 8]),         // TIFF basligi, IFD0 ofseti 8
    Buffer.from([0, 1]),                                                                   // 1 giris
    Buffer.from([0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0]),                               // tag 0x0112, SHORT, 1, deger 6
    Buffer.from([0, 0, 0, 0]),
  ]);
  const app1 = Buffer.concat([Buffer.from([0xFF, 0xE1]), Buffer.from([(exif.length + 2) >> 8, (exif.length + 2) & 255]), exif]);
  const sof = Buffer.from([0xFF, 0xC0, 0, 17, 8, 0x02, 0x58, 0x03, 0x20, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);   // 600 yuk x 800 en
  const jpg = Buffer.concat([Buffer.from([0xFF, 0xD8]), app1, sof, Buffer.from([0xFF, 0xD9]), Buffer.alloc(20)]);
  assert.deepEqual(dogrula.boyutOku(jpg), { en: 600, boy: 800 });
});

// ------------------------------------------------------------------ ag istemcisi (yerel http, gercek aga cikmaz)
function sunucu(isleyici) {
  return new Promise(coz => {
    const s = http.createServer(isleyici);
    s.listen(0, "127.0.0.1", () => coz({ s, port: s.address().port, url: p => "http://127.0.0.1:" + s.address().port + p }));
  });
}

test("ag: yerel adreslere GITMEZ (izinYerel olmadan)", async () => {
  const getir = ag.istemciYap({});
  await assert.rejects(() => getir("http://127.0.0.1:1/x"), e => e.kod === "yerel_adres");
  await assert.rejects(() => getir("http://localhost/x"), e => e.kod === "yerel_adres");
  await assert.rejects(() => getir("http://192.168.1.5/x"), e => e.kod === "yerel_adres");
  await assert.rejects(() => getir("file:///etc/passwd"), e => e.kod === "adres");
});

test("ag: boyut siniri (Content-Length ve akis), yarim indirme, zaman asimi", async () => {
  const { s, url } = await sunucu((q, r) => {
    if (q.url === "/buyuk") { r.writeHead(200, { "Content-Length": 5000 }); r.end(Buffer.alloc(5000)); }
    else if (q.url === "/akis") { r.writeHead(200); r.write(Buffer.alloc(3000)); r.end(Buffer.alloc(3000)); }
    else if (q.url === "/yarim") { r.writeHead(200, { "Content-Length": 5000 }); r.write(Buffer.alloc(100)); setTimeout(() => r.destroy(), 20); }
    else if (q.url === "/yavas") { /* hic cevap verme */ }
    else if (q.url === "/tamam") { r.writeHead(200); r.end("merhaba"); }
  });
  try {
    const getir = ag.istemciYap({ izinYerel: true, denemeSayisi: 1, bekle: yardim.uyku0 });
    await assert.rejects(() => getir(url("/buyuk"), { maksBayt: 1000 }), e => e.kod === "cok_buyuk");
    await assert.rejects(() => getir(url("/akis"), { maksBayt: 4000 }), e => e.kod === "cok_buyuk");
    await assert.rejects(() => getir(url("/yarim")), e => ["yarim"].includes(e.kod) || e.code === "ECONNRESET");
    await assert.rejects(() => getir(url("/yavas"), { zamanAsimiMs: 150 }), e => e.kod === "zaman_asimi");
    const r = await getir(url("/tamam"), { maksBayt: 100 });
    assert.equal(r.govde.toString(), "merhaba");
  } finally { s.close(); }
});

test("ag: yonlendirmede baska makineye gidince Authorization DUSER; ayni makinede korunur; en cok 5 yonlendirme", async () => {
  const gorulen = [];
  const b = await sunucu((q, r) => { gorulen.push({ yol: q.url, auth: q.headers.authorization || null }); r.writeHead(200); r.end("b"); });
  const a = await sunucu((q, r) => {
    if (q.url === "/baska") { r.writeHead(302, { Location: "http://localhost:" + b.port + "/hedef" }); r.end(); }
    else if (q.url === "/ayni") { r.writeHead(302, { Location: "/ayni-hedef" }); r.end(); }
    else if (q.url === "/ayni-hedef") { gorulen.push({ yol: q.url, auth: q.headers.authorization || null }); r.writeHead(200); r.end("a"); }
    else if (q.url === "/dongu") { r.writeHead(302, { Location: "/dongu" }); r.end(); }
  });
  try {
    const getir = ag.istemciYap({ izinYerel: true, denemeSayisi: 1 });
    await getir(a.url("/baska"), { basliklar: { Authorization: "GIZLI-ANAHTAR" } });
    await getir(a.url("/ayni"), { basliklar: { Authorization: "GIZLI-ANAHTAR" } });
    const hedef = gorulen.find(x => x.yol === "/hedef");
    assert.ok(hedef, "yonlendirme hedefe ulasmali");
    assert.equal(hedef.auth, null, "baska makineye Authorization SIZMAMALI");
    assert.equal(gorulen.find(x => x.yol === "/ayni-hedef").auth, "GIZLI-ANAHTAR");
    await assert.rejects(() => getir(a.url("/dongu")), e => e.kod === "yonlendirme");
  } finally { a.s.close(); b.s.close(); }
});

test("ag: 429 -> Retry-After kadar bekler ve yeniden dener; limit asilirsa hata + bekleSn; 5xx yeniden denenir", async () => {
  let n429 = 0, n500 = 0;
  const { s, url } = await sunucu((q, r) => {
    if (q.url === "/limit") { n429++; if (n429 === 1) { r.writeHead(429, { "Retry-After": "1" }); r.end(); } else { r.writeHead(200); r.end("ok"); } }
    else if (q.url === "/uzun") { r.writeHead(429, { "Retry-After": "600" }); r.end(); }
    else if (q.url === "/hata") { n500++; if (n500 < 3) { r.writeHead(502); r.end(); } else { r.writeHead(200); r.end("kurtuldu"); } }
    else if (q.url === "/kalici") { r.writeHead(503); r.end(); }
    else if (q.url === "/401") { r.writeHead(401); r.end(); }
  });
  try {
    const beklenen = [];
    const getir = ag.istemciYap({ izinYerel: true, bekle: ms => { beklenen.push(ms); return Promise.resolve(); } });
    assert.equal((await getir(url("/limit"))).govde.toString(), "ok");
    assert.ok(beklenen[0] >= 1000, "Retry-After 1 sn beklenmeli: " + beklenen);
    await assert.rejects(() => getir(url("/uzun")), e => e.kod === 429 && e.bekleSn === 600);
    assert.equal((await getir(url("/hata"))).govde.toString(), "kurtuldu");
    await assert.rejects(() => getir(url("/kalici")), e => e.kod === 503);
    await assert.rejects(() => getir(url("/401")), e => e.kod === 401);
  } finally { s.close(); }
});

test("ag: POST govdesi ve hata govdesi", async () => {
  const { s, url } = await sunucu((q, r) => {
    if (q.url === "/post") { const c = []; q.on("data", d => c.push(d)); q.on("end", () => { r.writeHead(200); r.end(q.method + ":" + Buffer.concat(c).toString() + ":" + q.headers["content-type"]); }); }
    else { r.writeHead(500); r.end("servis coktu: ayrinti"); }
  });
  try {
    const getir = ag.istemciYap({ izinYerel: true, denemeSayisi: 1, hataGovdesi: true });
    const r = await getir(url("/post"), { gonder: '{"a":1}', basliklar: { "Content-Type": "application/json" } });
    assert.equal(r.govde.toString(), 'POST:{"a":1}:application/json');
    await assert.rejects(() => getir(url("/hata")), e => e.kod === 500 && /servis coktu/.test(e.govde));
  } finally { s.close(); }
});
