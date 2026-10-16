// ENTEGRASYON TESTLERI — Ai Infapp: panelin "AIINFAPP_PORT'ta kim dinliyor?" teshisi, POST /api/aiinfapp/baslat ve
// GET /api/ozellikler > aiinfapp. Yerel sahte HTTP sunuculari (yeni/eski/baska/sessiz) ve gecici klasorler kullanilir;
// gercek ai-infapp/data/ klasorune ve ag'a dokunulmaz. Panel ayri surec olarak baslar (test/panel-yardim.js).
// Gercek ai-infapp/server.js yalniz son testte, gecici veri klasoruyle baslatilir (kimlik basligi sozlesmesini sinar).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const http = require("http");
const Y = require("./panel-yardim");

const KIMLIK = "ai-infapp/9.9.9-test";
const bekle = ms => new Promise(r => setTimeout(r, ms));
const geciciKlasor = onek => fs.mkdtempSync(path.join(os.tmpdir(), "ss-ent-" + onek + "-"));
const gercekYol = y => fs.realpathSync.native(y);

// ---------------------------------------------------------------- temizlik (hata olsa da surecler ve klasorler kalmasin)
const temizlik = [];
test.after(async () => { for (const f of temizlik.reverse()) { try { await f(); } catch (e) { /* kilitli klasor vb. */ } } });

async function oldur(pid) {
  if (!pid) return;
  try { process.kill(pid); } catch (e) { return; }
  for (let i = 0; i < 50; i++) { try { process.kill(pid, 0); } catch (e) { return; } await bekle(100); }
}
function klasorSil(d) { return async () => { for (let i = 0; i < 20; i++) { try { fs.rmSync(d, { recursive: true, force: true }); return; } catch (e) { await bekle(150); } } }; }

async function panelAc(ad, env) {
  const ortam = Y.geciciOrtam(ad);
  const panel = await Y.panelBaslat(ortam, { env });
  temizlik.push(async () => { await panel.kapat(); await klasorSil(ortam.kok)(); });
  return panel;
}

// "Portu dinleyen program" taklidi. tur: yeni (kimlik basligi var) | eski (baslik yok, sayfada "Ai Infapp" yazar) |
// baska (ilgisiz sayfa) | sahte (kimlik basligi biciminde degil) | dev (eski kopya, 2 MB sayfa) | sessiz (baglantiyi kabul eder, yanit vermez)
async function dinleyici(tur, port) {
  const soketler = new Set();
  const sunucu = tur === "sessiz" ? net.createServer(() => { /* yanit yok */ }) : http.createServer((q, r) => {
    const bas = { "Content-Type": "text/html; charset=utf-8" };
    if (tur === "yeni") bas["X-Ai-Infapp"] = KIMLIK;
    if (tur === "sahte") bas["X-Ai-Infapp"] = "baska-program/1.0";
    r.writeHead(tur === "baska" || tur === "sahte" ? 404 : 200, bas);
    if (tur === "dev") return r.end("<!doctype html><title>Ai Infapp</title>" + "x".repeat(2 * 1024 * 1024));
    r.end(tur === "baska" || tur === "sahte" ? "<html><body>ilgisiz bir program</body></html>" : "<!doctype html><title>Ai Infapp</title>");
  });
  sunucu.on("connection", s => { soketler.add(s); s.on("close", () => soketler.delete(s)); });
  for (let i = 0; ; i++) {
    const acildi = await new Promise(coz => { sunucu.once("error", () => coz(false)); sunucu.listen(port, "127.0.0.1", () => coz(true)); });
    sunucu.removeAllListeners("error");
    if (acildi) break;
    if (i >= 30) throw new Error("port acilamadi: " + port);
    await bekle(100);
  }
  return { kapat: () => new Promise(coz => { for (const s of soketler) s.destroy(); sunucu.close(() => coz()); }) };
}
async function dinleyiciyleSina(tur, port, sina) {
  const d = await dinleyici(tur, port);
  try { return await sina(); } finally { await d.kapat(); }
}

// ---------------------------------------------------------------- 1) teshis islevi
test("tani: kimlik basligi -> yeni; baslik yok + sayfada 'Ai Infapp' -> eski; ilgisiz ya da taklit baslikli program -> baska; yanit vermeyen -> yanit_yok; kimse yok -> yok", async () => {
  const S = require("../lib/panel-aiinfapp");
  const port = await Y.bosPort();
  assert.equal(await S.tani(port, 500), "yok", "kapali port");
  const beklenen = { yeni: "yeni", eski: "eski", baska: "baska", sahte: "baska", sessiz: "yanit_yok", dev: "eski" };
  for (const [tur, sonuc] of Object.entries(beklenen))
    assert.equal(await dinleyiciyleSina(tur, port, () => S.tani(port, 400)), sonuc, tur);
  assert.equal(await S.tani(port, 500), "yok", "dinleyici kapaninca yine yok");
});

// ---------------------------------------------------------------- 2) panel uclari (dinleyen program taklitleriyle)
let panel1, port1;
async function panel1Al() {
  if (!panel1) {
    port1 = await Y.bosPort();
    panel1 = await panelAc("ss1", { AIINFAPP_PORT: String(port1), PANEL_AIINFAPP_KAPALI: "1", PANEL_AIINFAPP_DIZINI: "" });
  }
  return panel1.istemci;
}

test("/api/ozellikler: aiinfapp {var, calisiyor, port}; kimse dinlemiyorken calisiyor=false, indirici alani korunur", async () => {
  const c = await panel1Al();
  const r = (await c.get("/api/ozellikler")).json;
  assert.deepEqual(Object.keys(r.aiinfapp).sort(), ["calisiyor", "port", "var"]);
  assert.deepEqual(r.aiinfapp, { var: true, calisiyor: false, port: port1 }, "ai-infapp/server.js bu depoda var");
  assert.deepEqual(Object.keys(r.indirici).sort(), ["calisiyor", "port", "var"]);
});

test("baslat + ozellikler: yeni -> zatenAcik; ESKI kopya ve ilgisiz program -> 409 (acilmaz); sessiz program -> calisiyor sayilir (indirici kalibi)", async () => {
  const c = await panel1Al();
  await dinleyiciyleSina("yeni", port1, async () => {
    assert.equal((await c.get("/api/ozellikler")).json.aiinfapp.calisiyor, true);
    const b = await c.post("/api/aiinfapp/baslat");
    assert.equal(b.durum, 200, b.metin);
    assert.deepEqual(b.json, { ok: true, port: port1, zatenAcik: true });
  });
  await dinleyiciyleSina("eski", port1, async () => {
    assert.equal((await c.get("/api/ozellikler")).json.aiinfapp.calisiyor, false, "eski kopya 'calisiyor' sayilmaz");
    const b = await c.post("/api/aiinfapp/baslat");
    assert.equal(b.durum, 409, b.metin);
    assert.equal(b.json.kod, "aiinfapp_eski");
    assert.match(b.json.hata, /ESKİ/);
    assert.match(b.json.hata, /eski bir Ai Infapp klasörü/, "eski kopyanin ne oldugu söylenmeli");
    assert.match(b.json.hata, /açmaz/, "neden acilmadigi söylenmeli");
    assert.ok(b.json.cozum && b.json.cozum.length > 20, "cozum onerisi");
  });
  for (const tur of ["baska", "sahte"]) {
    await dinleyiciyleSina(tur, port1, async () => {
      assert.equal((await c.get("/api/ozellikler")).json.aiinfapp.calisiyor, false, tur);
      const b = await c.post("/api/aiinfapp/baslat");
      assert.equal(b.durum, 409, tur + ": " + b.metin);
      assert.equal(b.json.kod, "aiinfapp_port");
      assert.match(b.json.cozum, /AIINFAPP_PORT/);
    });
  }
  await dinleyiciyleSina("sessiz", port1, async () => {
    assert.equal((await c.get("/api/ozellikler")).json.aiinfapp.calisiyor, true, "TCP acik ama HTTP yanit yok: mesgul sunucu olabilir");
    const b = await c.post("/api/aiinfapp/baslat");
    assert.equal(b.durum, 200, b.metin);
    assert.equal(b.json.zatenAcik, true);
  });
});

test("baslat: kimse dinlemiyorsa ve PANEL_AIINFAPP_KAPALI=1 ise hicbir sey baslatilmaz (500 'kapali')", async () => {
  const c = await panel1Al();
  const b = await c.post("/api/aiinfapp/baslat");
  assert.equal(b.durum, 500, b.metin);
  assert.equal(b.json.kod, "aiinfapp");
  assert.match(b.json.hata, /kapalı/);
  assert.equal((await c.get("/api/ozellikler")).json.aiinfapp.calisiyor, false);
});

// ---------------------------------------------------------------- 3) gercek baslatma yolu (sahte sunucu dosyasiyla)
const SAHTE_SUNUCU = [
  "\"use strict\";",
  "const http = require(\"http\"), fs = require(\"fs\"), path = require(\"path\");",
  "fs.appendFileSync(path.join(__dirname, \"basladi.txt\"), process.pid + \"\\n\");",
  "fs.writeFileSync(path.join(__dirname, \"ortam.json\"), JSON.stringify({ pid: process.pid, port: process.env.AI_INFAPP_PORT, cwd: process.cwd(), serbest: process.env.SS_TEST_SERBEST, gizli: Object.keys(process.env).filter(k => /KEY|TOKEN|SECRET|PASSWORD/i.test(k)) }));",
  "http.createServer((q, r) => { r.writeHead(200, { \"Content-Type\": \"text/html\", \"X-Ai-Infapp\": \"" + KIMLIK + "\" }); r.end(\"<title>Ai Infapp</title>\"); })",
  "  .listen(Number(process.env.AI_INFAPP_PORT), \"127.0.0.1\");",
  "",
].join("\n");

let panel2, port2, dizin2;
async function panel2Al() {
  if (!panel2) {
    port2 = await Y.bosPort();
    dizin2 = geciciKlasor("sahte");
    temizlik.push(klasorSil(dizin2));
    temizlik.push(async () => { try { await oldur(JSON.parse(fs.readFileSync(path.join(dizin2, "ortam.json"), "utf8")).pid); } catch (e) { /* hic baslamadi */ } });
    panel2 = await panelAc("ss2", { AIINFAPP_PORT: String(port2), PANEL_AIINFAPP_DIZINI: dizin2, PANEL_AIINFAPP_KAPALI: "", SS_TEST_SERBEST: "ok", SS_TEST_API_KEY: "deger-1", SS_TEST_TOKEN: "deger-2" });
  }
  return panel2.istemci;
}

test("sunucu dosyasi yoksa: /api/ozellikler var=false, baslat 404 aiinfapp_yok", async () => {
  const c = await panel2Al();
  assert.deepEqual((await c.get("/api/ozellikler")).json.aiinfapp, { var: false, calisiyor: false, port: port2 });
  const b = await c.post("/api/aiinfapp/baslat");
  assert.equal(b.durum, 404, b.metin);
  assert.equal(b.json.kod, "aiinfapp_yok");
});

test("yetkisiz cagri reddedilir ve HICBIR SEY baslatmaz: jetonsuz/yanlis jeton, yanlis Origin, cross-site, text/plain, yabanci Host; GET ile de acilmaz", async () => {
  const c = await panel2Al();
  fs.writeFileSync(path.join(dizin2, "server.js"), SAHTE_SUNUCU);        // artik baslatilabilir: tek engel kapi olmali
  const kod = r => r.json && r.json.kod;
  const U = "/api/aiinfapp/baslat";
  assert.deepEqual([(await c.istek("POST", U, {}, { jetonsuz: true })).durum, kod(await c.istek("POST", U, {}, { jetonsuz: true }))], [403, "token"]);
  const eski = c.jeton; c.jeton = "0".repeat(64);
  assert.equal(kod(await c.post(U)), "token");
  c.jeton = eski;
  assert.equal(kod(await c.post(U, {}, { baslik: { Origin: "http://evil.example" } })), "origin");
  assert.equal(kod(await c.post(U, {}, { baslik: { "Sec-Fetch-Site": "cross-site" } })), "origin");
  const tur = await c.post(U, "{}", { baslik: { "Content-Type": "text/plain" } });
  assert.deepEqual([tur.durum, kod(tur)], [415, "icerik_turu"]);
  assert.equal(kod(await c.post(U, {}, { baslik: { Host: "evil.example" } })), "host");
  assert.equal((await c.get("/api/ozellikler", { jetonsuz: true })).json.kod, "token");
  const get = await c.get(U);
  assert.deepEqual([get.durum, kod(get)], [404, "yok"], "baslatma yalniz POST");
  await bekle(300);
  assert.equal(fs.existsSync(path.join(dizin2, "basladi.txt")), false, "reddedilen cagrilar sunucu surecini baslatmamali");
});

test("baslat: kimse yoksa ai-infapp sunucusunu AI_INFAPP_PORT ile, kendi klasorunde baslatir; ikinci basis yeniden baslatmaz", async () => {
  const c = await panel2Al();
  const r = await c.post("/api/aiinfapp/baslat");
  assert.equal(r.durum, 200, r.metin);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.port, port2);
  assert.ok(!r.json.zatenAcik, "ilk basista zatenAcik olmamali");
  const o = JSON.parse(fs.readFileSync(path.join(dizin2, "ortam.json"), "utf8"));
  assert.equal(o.port, String(port2), "alt surec portu AI_INFAPP_PORT ile almali");
  assert.equal(gercekYol(o.cwd), gercekYol(dizin2), "alt surec sunucu dosyasinin klasorunde calismali");
  assert.equal(o.serbest, "ok", "siradan ortam degiskenleri alt surece gecmeli");
  assert.deepEqual(o.gizli, [], "panel sureci anahtar/jeton benzeri ortam degiskenlerini Ai Infapp'e GECIRMEMELI (en az yetki)");
  assert.equal((await c.get("/api/ozellikler")).json.aiinfapp.calisiyor, true);
  const ikinci = await c.post("/api/aiinfapp/baslat");
  assert.deepEqual(ikinci.json, { ok: true, port: port2, zatenAcik: true });
  assert.equal(fs.readFileSync(path.join(dizin2, "basladi.txt"), "utf8").trim().split("\n").length, 1, "sunucu bir kez baslamali");
});

test("baslat: sunucu acilmadan kapanirsa 8 sn beklenmez; cikis kodu mesajda gorunur (500 aiinfapp)", async () => {
  const c = await panel2Al();
  const eski = JSON.parse(fs.readFileSync(path.join(dizin2, "ortam.json"), "utf8")).pid;
  await oldur(eski);
  // port bosalana dek bekle (oldurulen sunucunun soketi kapanmali)
  for (let i = 0; i < 50; i++) { const acik = await new Promise(coz => { const s = net.connect({ port: port2, host: "127.0.0.1" }); s.on("connect", () => { s.destroy(); coz(true); }); s.on("error", () => coz(false)); }); if (!acik) break; await bekle(100); }
  fs.writeFileSync(path.join(dizin2, "server.js"), "process.exit(3);\n");
  const bas = Date.now();
  const r = await c.post("/api/aiinfapp/baslat");
  const sure = Date.now() - bas;
  assert.equal(r.durum, 500, r.metin);
  assert.equal(r.json.kod, "aiinfapp");
  assert.match(r.json.hata, /kapandı/);
  assert.match(r.json.hata, /3/, "cikis kodu gorunmeli");
  assert.ok(r.json.cozum && /BASLAT\.bat/.test(r.json.cozum), "elle baslatma onerisi");
  assert.ok(sure < 6500, "8 sn zaman asimina kadar beklememeli (" + sure + " ms)");
});

test("baslat: cikis kodu 1 ile kapanan surec yerine baska bir kopya (kilit sahibi) kisa sure icinde aciliyorsa hata degil zatenAcik", async () => {
  const S = require("../lib/panel-aiinfapp");
  const port = await Y.bosPort();
  const dizin = geciciKlasor("rekabet");
  temizlik.push(klasorSil(dizin));
  fs.writeFileSync(path.join(dizin, "server.js"), "setTimeout(() => process.exit(1), 120);\n");      // 'ayni data klasorunde baska panel var' cikisi
  const baslat = S.baslat({ port, dizin, kapali: false });
  await bekle(450);                                  // alt surec coktan cikti; kilit sahibi panel simdi aciliyor
  const d = await dinleyici("yeni", port);
  try {
    assert.deepEqual(await baslat, { ok: true, port, zatenAcik: true });
  } finally { await d.kapat(); }
});

test("baslat: ayni anda gelen istekler (cift tik) TEK surec baslatir; hepsi basarili doner (yanlis 'acilmadan kapandi' yok)", async () => {
  const S = require("../lib/panel-aiinfapp");
  const port = await Y.bosPort();
  const dizin = geciciKlasor("cifttik");
  temizlik.push(klasorSil(dizin));
  temizlik.push(async () => { try { await oldur(JSON.parse(fs.readFileSync(path.join(dizin, "ortam.json"), "utf8")).pid); } catch (e) { /* hic baslamadi */ } });
  // gercek sunucu gibi: ikinci kopya kilidi gorup 1 ile kapanir (kilit dosyasi 'wx')
  fs.writeFileSync(path.join(dizin, "server.js"), [
    "\"use strict\";",
    "const http = require(\"http\"), fs = require(\"fs\"), path = require(\"path\");",
    "try { fs.writeFileSync(path.join(__dirname, \".kilit\"), String(process.pid), { flag: \"wx\" }); } catch (e) { process.exit(1); }",
    "fs.writeFileSync(path.join(__dirname, \"ortam.json\"), JSON.stringify({ pid: process.pid }));",
    "setTimeout(() => http.createServer((q, r) => { r.writeHead(200, { \"X-Ai-Infapp\": \"" + KIMLIK + "\" }); r.end(\"<title>Ai Infapp</title>\"); })",
    "  .listen(Number(process.env.AI_INFAPP_PORT), \"127.0.0.1\"), 700);",
    "",
  ].join("\n"));
  const sonuclar = await Promise.allSettled([1, 2, 3].map(() => S.baslat({ port, dizin, kapali: false })));
  assert.deepEqual(sonuclar.map(s => s.status), ["fulfilled", "fulfilled", "fulfilled"], JSON.stringify(sonuclar.map(s => s.reason && s.reason.message)));
  for (const s of sonuclar) assert.equal(s.value.ok, true);
  assert.equal(sonuclar.filter(s => !s.value.zatenAcik).length, 1, "tam bir istek baslatmali, digerleri zatenAcik donmeli");
  // istek bitince 'ucusta' kaydi temizlenir: sonraki cagri yeniden teshis eder
  assert.deepEqual(await S.baslat({ port, dizin, kapali: false }), { ok: true, port, zatenAcik: true });
});

// Arayuz (panel-public/panel-araclar.js) tarayicisiz, sahte window/P ile yuklenir: dugme mantigi yalniz bu dosyada.
function aracDugmeleriYukle() {
  const vm = require("vm");
  const kod = fs.readFileSync(path.join(Y.KOK, "panel-public", "panel-araclar.js"), "utf8");
  const durum = { acilan: 0, istek: 0, bekleyen: [], hata: [], yonlendirme: [] };
  const P = {
    ozellikler: { aiinfapp: { var: true }, indirici: { var: true } }, gorunumKaydet() { /* arac gorunumu bu testte yok */ },
    api: () => { durum.istek++; return new Promise((coz, red) => durum.bekleyen.push({ coz, red })); },
    bildir: (m, tur) => durum.hata.push(m), durumYaz: (y, tur, e) => durum.hata.push(String(e)), hataMetni: e => String((e && e.message) || e),
  };
  const pencere = { P, open: () => { durum.acilan++; const w = { location: {}, opener: {}, close() { w.kapandi = true; } }; durum.yonlendirme.push(w); return w; } };
  vm.runInNewContext(kod, { window: pencere }, { filename: "panel-araclar.js" });
  return { P, durum };
}

test("arayuz: Ai Infapp dugmesine ust uste basmak (cift tik, ust dugme + Araclar dugmesi) ikinci pencere ve ikinci istek acmaz; istek bitince tekrar acilabilir", async () => {
  const { P, durum } = aracDugmeleriYukle();
  const a = P.aiInfappAc(null), b = P.aiInfappAc(null), c = P.aiInfappAc(null);
  assert.equal(durum.acilan, 1, "tek pencere");
  assert.equal(durum.istek, 1, "tek baslatma istegi");
  // baska arac (indirici) kendi kilidini kullanir: Ai Infapp'in suren istegi onu engellemez
  const ind = P.indiriciAc(null);
  assert.equal(durum.istek, 2);
  durum.bekleyen[0].coz({ ok: true, port: 4200 });
  durum.bekleyen[1].coz({ ok: true, port: 4190 });
  await Promise.all([a, b, c, ind]);
  assert.equal(durum.yonlendirme[0].location.href, "http://localhost:4200");
  // basari sonrasi kilit kalkar
  const d = P.aiInfappAc(null);
  assert.equal(durum.istek, 3, "istek bitince yeni tik yeniden baslatabilmeli");
  // hata sonrasi da kilit kalkar (pencere kapanir, kullanici tekrar deneyebilir)
  durum.bekleyen[2].red(new Error("kapandi"));
  await d;
  assert.equal(durum.yonlendirme[2].kapandi, true);
  const e = P.aiInfappAc(null);
  assert.equal(durum.istek, 4, "hatadan sonra yeniden denenebilmeli");
  durum.bekleyen[3].coz({ ok: true, port: 4200 });
  await e;
});

// ---------------------------------------------------------------- 4) gercek ai-infapp (sozlesme: X-Ai-Infapp basligi + AI_INFAPP_PORT/AI_INFAPP_VERI)
const GERCEK = path.join(Y.KOK, "ai-infapp", "server.js");
test("GERCEK ai-infapp/server.js: panel dugmesiyle baslar, kimlik basligini tasir, 'yeni' sayilir, veriyi gecici klasore yazar", { skip: !fs.existsSync(GERCEK) && "ai-infapp/server.js yok" }, async () => {
  const veri = geciciKlasor("veri");
  temizlik.push(klasorSil(veri));
  // olculmus glif tablosu hazir: sunucu acilisinda Chrome ile olcum baslatmasin (test bitince yetim Chrome kalmasin)
  fs.writeFileSync(path.join(veri, "glif-tablo.json"), JSON.stringify({ platform: process.platform, tablo: { kalin: {} } }));
  const port = await Y.bosPort();
  const panel = await panelAc("ss3", { AIINFAPP_PORT: String(port), AI_INFAPP_VERI: veri, PANEL_AIINFAPP_KAPALI: "", PANEL_AIINFAPP_DIZINI: "" });
  const c = panel.istemci;
  temizlik.push(async () => { try { await oldur(JSON.parse(fs.readFileSync(path.join(veri, ".instance"), "utf8")).pid); } catch (e) { /* hic baslamadi */ } });
  const r = await c.post("/api/aiinfapp/baslat");
  assert.equal(r.durum, 200, r.metin);
  assert.deepEqual([r.json.ok, r.json.port], [true, port]);
  // sunucu her yanitta kimligini bildirir: panelin "yeni" teshisi buna dayanir
  const ana = await new Promise((coz, red) => http.get({ host: "127.0.0.1", port, path: "/" }, res => { res.resume(); res.on("end", () => coz(res)); }).on("error", red));
  assert.match(String(ana.headers["x-ai-infapp"]), /^ai-infapp\/\d+\.\d+\.\d+/, "ana sayfa kimlik basligi");
  const api = await new Promise((coz, red) => http.get({ host: "127.0.0.1", port, path: "/api/yok-boyle-bir-uc" }, res => { res.resume(); res.on("end", () => coz(res)); }).on("error", red));
  assert.match(String(api.headers["x-ai-infapp"]), /^ai-infapp\//, "hata yanitlari da kimlik basligini tasimali");
  assert.equal((await c.get("/api/ozellikler")).json.aiinfapp.calisiyor, true, "gercek sunucu 'yeni' sayilmali");
  const ikinci = await c.post("/api/aiinfapp/baslat");
  assert.equal(ikinci.json.zatenAcik, true);
  assert.ok(fs.existsSync(path.join(veri, ".instance")), "AI_INFAPP_VERI gecici klasoru kullanilmali (gercek ai-infapp/data/ degil)");
  assert.equal(JSON.parse(fs.readFileSync(path.join(veri, ".instance"), "utf8")).port, port);
});

// ---------------------------------------------------------------- alt surec ortami (en az yetki)
test("altOrtam: sir benzeri degiskenler (DB_PASS, DATABASE_URL, GH_PAT, SSH_PASSPHRASE, COOKIE...) alt surece gecmez; normal sistem degiskenleri ve port gecer", () => {
  const { altOrtam } = require("../lib/panel-aiinfapp");
  const gizli = { DB_PASS: "a", DATABASE_URL: "b", GH_PAT: "c", SSH_PASSPHRASE: "d", COOKIE: "e", ANTHROPIC_API_KEY: "f", PGPASSWORD: "g", SENTRY_DSN: "h", NPM_TOKEN: "i" };
  const serbest = { SS_TEST_NORMAL: "x", HTTPS_PROXY: "http://127.0.0.1:9", LOCALAPPDATA: "C:\L" };
  const eski = {};
  for (const [a, v] of Object.entries(Object.assign({}, gizli, serbest))) { eski[a] = process.env[a]; process.env[a] = v; }
  try {
    const env = altOrtam(4242);
    for (const a of Object.keys(gizli)) assert.equal(env[a], undefined, a + " gecmemeli");
    for (const a of Object.keys(serbest)) assert.equal(env[a], serbest[a], a + " gecmeli");
    assert.equal(env.AI_INFAPP_PORT, "4242");
  } finally {
    for (const [a, v] of Object.entries(eski)) { if (v === undefined) delete process.env[a]; else process.env[a] = v; }
  }
});
