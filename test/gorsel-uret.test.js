// GO — gorsel-uret.js: servis secimi, yeniden deneme, DEVRE KESICI, gorunur hata, istem cesitleme, is modu (manifest).
// Ag sahtelenir (servisler/getir enjekte); Pollinations'a ve diger ucretli/dis servislere GITMEZ.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const yardim = require("./gorsel-yardim.js");
const uretici = require("../gorsel-uret.js");
const ag = require("../lib/gorsel-ag.js");

const FFMPEG = yardim.ffmpegVarMi();
const atla = !FFMPEG && "ffmpeg yok";
test.after(() => yardim.temizle());
test.beforeEach(() => uretici.sifirla());
const bos = () => Promise.resolve();
let _t = 5000;
const jpg = (en, boy) => yardim.tekil(yardim.gorselUret("jpg", en || 1280, boy || 720), ++_t);

function servis(ad, davranis) {
  const s = { ad, cagri: 0, hazir: () => true, async uret(...a) { s.cagri++; return davranis(s.cagri, ...a); } };
  return s;
}

test("istemKur / istemCesitle: uret: onek atilir, stil eklenir, k>0 icin aci/plan degisir (k=0 ayni)", () => {
  assert.equal(uretici.istemKur("uret: a lattice of light", "dark"), "a lattice of light, dark");
  assert.match(uretici.istemKur("x"), /cinematic/);
  const t = "a bear";
  assert.equal(uretici.istemCesitle(t, 0), t);
  const s = new Set([1, 2, 3, 4, 5, 6].map(k => uretici.istemCesitle(t, k)));
  assert.equal(s.size, 6, "6 farkli plan");
  assert.equal(uretici.istemCesitle(t, 1), uretici.istemCesitle(t, 7), "plan listesi doner");
  assert.ok(uretici.istemCesitle(t, 2).startsWith(t + ", "));
});

test("uretBir: gecici hatada (429/yukleniyor) bir kez daha dener ve basarir; gecersiz govde (HTML) HATA sayilir", { skip: atla }, async () => {
  const s = servis("Deneme", (n) => { if (n === 1) { const e = new Error("rate limit"); e.kod = 429; throw e; } return jpg(); });
  const r = await uretici.uretBir("x", 1280, 720, 1, true, { servisler: [s], bekleMs: 0, log: () => {} });
  assert.equal(r.servis, "Deneme"); assert.equal(s.cagri, 2);
  // Pollinations + sahte getir: HTML dondurunce hata, JPEG dondurunce basari; URL parametreleri
  const urller = [];
  const html = (url) => { urller.push(url); return { govde: yardim.htmlSayfasi() }; };
  const getirHtml = Object.assign(async (u) => html(u), {});
  await assert.rejects(() => uretici.uretBir("a b", 1280, 720, 7, true, { servisler: [uretici.SERVISLER[0]], getir: getirHtml, bekleMs: 0, log: () => {} }), /görsel döndürmedi|görsel değil/);
  const getirTamam = async (u) => { urller.push(u); return { govde: jpg() }; };
  const r2 = await uretici.uretBir("a b", 1280, 720, 7, true, { servisler: [uretici.SERVISLER[0]], getir: getirTamam, bekleMs: 0, log: () => {} });
  assert.equal(r2.servis, "Pollinations");
  const son = urller[urller.length - 1];
  assert.match(son, /^https:\/\/image\.pollinations\.ai\/prompt\/a%20b\?width=1280&height=720&nologo=true&seed=7$/);
});

test("DEVRE KESICI: ust uste 3 hata -> servis kapanir (daha cagrilmaz), gorunur log, sonraki servise gecilir", { skip: atla }, async () => {
  const kotu = servis("Kotu", () => { const e = new Error("HTTP 502"); e.kod = 502; throw e; });
  const iyi = servis("Iyi", () => jpg());
  const log = [];
  const opt = { servisler: [kotu, iyi], bekleMs: 0, log: m => log.push(m) };
  for (let i = 0; i < 5; i++) { const r = await uretici.uretBir("x", 1280, 720, i, false, opt); assert.equal(r.servis, "Iyi"); }
  assert.equal(kotu.cagri, 3, "3 hatadan sonra Kotu bir daha cagrilmamali");
  assert.ok(log.some(m => /Kotu olmadı: HTTP 502/.test(m)), "hata nedeni gorunur olmali: " + log.join("|"));
  assert.ok(log.some(m => /Kotu bu çalışmada kapatıldı/.test(m)));
  // hepsi kapaliysa anlasilir hata
  const yalniz = servis("Tek", () => { throw new Error("patladi"); });
  uretici.sifirla();
  for (let i = 0; i < 3; i++) await assert.rejects(() => uretici.uretBir("x", 1280, 720, 1, true, { servisler: [yalniz], bekleMs: 0, log: () => {} }));
  await assert.rejects(() => uretici.uretBir("x", 1280, 720, 1, true, { servisler: [yalniz], bekleMs: 0, log: () => {} }), /kapandı: Tek/);
  assert.equal(yalniz.cagri, 3, "kapandiktan sonra servis bir daha cagrilmamali");
});

test("zaman asimi: yavas servis 60 sn degil, enjekte edilen sure kadar bekletir (AgHatasi zaman_asimi tekrar denenmez)", async () => {
  const http = require("http");
  const s = http.createServer(() => { /* cevap yok */ });
  await new Promise(r => s.listen(0, "127.0.0.1", r));
  try {
    const getir = ag.istemciYap({ izinYerel: true, zamanAsimiMs: 120, toplamAsimiMs: 500, denemeSayisi: 3, zamanAsimiTekrarYok: true, bekle: bos });
    const t0 = Date.now();
    await assert.rejects(() => getir("http://127.0.0.1:" + s.address().port + "/x"), e => e.kod === "zaman_asimi");
    assert.ok(Date.now() - t0 < 1500, "zaman asiminda yeniden denememeli");
  } finally { s.close(); }
});

test("is modu: uret: sahneleri manifeste 'uretim' kaynagiyla isler; uretAdet; ikinci calisma atlar; yarisi basarisizsa exit 4", { skip: atla }, async () => {
  const is = "uret-is";
  const senaryo = yardim.senaryoUret(3, 30);
  yardim.isKur(is, { senaryo, konu: { format: "long", uretAdet: 3, sahneKelimeleri: [["uret: glowing lattice"], ["bear"], ["uret: neural network"]] } });
  let n = 0;
  const getir = async (u) => {
    n++;
    if (/neural/.test(decodeURIComponent(u))) { const e = new ag.AgHatasi("HTTP 502", 502); throw e; }
    return { govde: jpg() };
  };
  await assert.rejects(() => uretici.isModu(is, false, { getir, log: () => {} }), e => e.kod === "uretim_basarisiz" && e.cikis === 4);
  const m = JSON.parse(fs.readFileSync(path.join(process.env.OTOMASYON_URETIM, is, "Visuals", "manifest.json"), "utf8"));
  const s1 = m.sahneler[0];
  assert.equal(s1.gorseller.length, 3, "uretAdet=3");
  assert.equal(s1.klasor.replace(/\d+/, ""), "-uretilen");
  assert.ok(s1.gorseller.every(g => g.kaynak === "uretim" && g.lisansKodu === "ai" && /glowing lattice/.test(g.istem)));
  assert.equal(new Set(s1.gorseller.map(g => g.istem)).size, 3, "3 farkli istem");
  assert.equal(m.sahneler[1].gorseller.length, 0, "isaretsiz sahne atlanir (stok)");
  assert.equal(m.sahneler[2].gorseller.length, 0);
  const once = n;
  // 2. calisma: uretilmis olan sahneye dokunmaz (yalniz basarisiz olani yeniden dener)
  await assert.rejects(() => uretici.isModu(is, false, { getir, log: () => {} }), e => e.kod === "uretim_basarisiz");
  const m2 = JSON.parse(fs.readFileSync(path.join(process.env.OTOMASYON_URETIM, is, "Visuals", "manifest.json"), "utf8"));
  assert.deepEqual(m2.sahneler[0].gorseller.map(g => g.sha1), s1.gorseller.map(g => g.sha1));
  assert.ok(n - once <= 6, "yalniz basarisiz sahne icin yeniden denenir: " + (n - once));
});

test("is modu: isaretli sahne yoksa atlandi; konu.json/sahneKelimeleri yoksa exit 2", { skip: atla }, async () => {
  yardim.isKur("uret-yok", { senaryo: yardim.senaryoUret(1, 30), konu: { format: "long", sahneKelimeleri: [["bear"]] } });
  await uretici.isModu("uret-yok", false, { getir: async () => { throw new Error("cagrilmamali"); }, log: () => {} });
  yardim.isKur("uret-bos", { senaryo: yardim.senaryoUret(1, 30), konu: { format: "long" } });
  await assert.rejects(() => uretici.isModu("uret-bos", false, {}), e => e.kod === "sahne_kelimesi_yok" && e.cikis === 2);
  yardim.isKur("uret-konusuz", { senaryo: yardim.senaryoUret(1, 30) });
  await assert.rejects(() => uretici.isModu("uret-konusuz", false, {}), e => e.kod === "konu_yok" && e.cikis === 2);
});
