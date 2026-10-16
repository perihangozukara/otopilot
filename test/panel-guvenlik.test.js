// Panel sunucusu (gercek surec): Host/Origin/Icerik-turu/jeton reddi, guvenlik basliklari, yol kacislari, bozuk istekler, cokme dayanikliligi.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Y = require("./panel-yardim");

let ortam, panel, c;
test.before(async () => {
  ortam = Y.geciciOrtam("guv");
  panel = await Y.panelBaslat(ortam);
  c = panel.istemci;
});
test.after(async () => { if (panel) await panel.kapat(); if (ortam) ortam.temizle(); });

test("ana sayfa: jeton meta'si + sarmalayici, HttpOnly SameSite=Strict cerez, guvenlik basliklari", async () => {
  const r = await c.get("/", { jetonsuz: true });
  assert.equal(r.durum, 200);
  assert.match(r.metin, /<meta name="panel-token" content="[0-9a-f]{64}">/);
  assert.match(r.metin, /X-Panel-Token/);
  const sc = r.baslik["set-cookie"][0];
  assert.match(sc, /^panel_oturum=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/$/);
  const b = r.baslik;
  assert.match(b["content-security-policy"], /default-src 'self'/);
  assert.match(b["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(b["x-content-type-options"], "nosniff");
  assert.equal(b["x-frame-options"], "DENY");
  assert.equal(b["referrer-policy"], "no-referrer");
  assert.equal(b["cross-origin-resource-policy"], "same-origin");
  assert.equal(b["cache-control"], "no-store");
  const r2 = await c.get("/panel.html", { jetonsuz: true });
  assert.match(r2.metin, /panel-token/);
});

test("Host basligi izin listesi disindaysa 403 {kod:'host'} (DNS rebinding)", async () => {
  for (const host of ["evil.com", "localhost", "localhost.evil.com:" + panel.port, "127.0.0.1.nip.io:" + panel.port, "attacker.example:" + panel.port]) {
    const r = await c.get("/", { jetonsuz: true, baslik: { Host: host } });
    assert.equal(r.durum, 403, host); assert.equal(r.json.kod, "host");
    const r2 = await c.get("/api/isler", { baslik: { Host: host } });
    assert.equal(r2.durum, 403, host); assert.equal(r2.json.kod, "host");
  }
  for (const host of ["localhost:" + panel.port, "127.0.0.1:" + panel.port]) assert.equal((await c.get("/api/ozellikler", { baslik: { Host: host } })).durum, 200, host);
});

test("her /api cagrisi (GET dahil) jeton ister; yanlis jeton reddedilir; medya yollari cerez ister", async () => {
  for (const yol of ["/api/isler", "/api/ayarlar", "/api/anahtarlar", "/api/calisanlar", "/api/disk", "/api/log?id=x"]) {
    const r = await c.get(yol, { jetonsuz: true });
    assert.equal(r.durum, 403, yol); assert.equal(r.json.kod, "token"); assert.equal(r.json.hata, "Oturum süresi doldu, sayfayı yenile");
  }
  const eski = c.jeton; c.jeton = "0".repeat(64);
  assert.equal((await c.get("/api/isler")).json.kod, "token");
  assert.equal((await c.post("/api/yeni", { baslik: "x" })).json.kod, "token");
  c.jeton = eski;
  assert.equal((await c.get("/api/isler")).durum, 200);
  for (const yol of ["/video/x", "/onizle/a/b/c.jpg", "/indir/x/video", "/marka/a.png", "/sestesti/abc"]) {
    assert.equal((await c.get(yol)).json.kod, "token", yol + " (cerezsiz)");
    assert.notEqual((await c.get(yol, { cerezli: true })).json.kod, "token", yol + " (cerezli)");
  }
  assert.equal((await c.get("/video/x", { baslik: { Cookie: "panel_oturum=" + "0".repeat(64) } })).json.kod, "token");
});

test("durum degistiren isteklerde Origin, Sec-Fetch-Site ve Content-Type denetimi", async () => {
  const govde = { baslik: "x" };
  let r = await c.post("/api/yeni", govde, { baslik: { Origin: "http://evil.com" } });
  assert.equal(r.durum, 403); assert.equal(r.json.kod, "origin");
  r = await c.post("/api/yeni", govde, { baslik: { Origin: "null" } });
  assert.equal(r.json.kod, "origin");
  r = await c.post("/api/yeni", govde, { baslik: { "Sec-Fetch-Site": "cross-site" } });
  assert.equal(r.json.kod, "origin");
  r = await c.post("/api/yeni", govde, { baslik: { "Sec-Fetch-Site": "same-site" } });
  assert.equal(r.json.kod, "origin");
  r = await c.istek("POST", "/api/yeni", JSON.stringify(govde), { baslik: { "Content-Type": "text/plain" } });
  assert.equal(r.durum, 415); assert.equal(r.json.kod, "icerik_turu");
  r = await c.istek("POST", "/api/yeni", JSON.stringify(govde), { baslik: { "Content-Type": "application/x-www-form-urlencoded" } });
  assert.equal(r.durum, 415);
  r = await c.istek("POST", "/api/durdur", "", { baslik: { "Content-Type": "" } });
  assert.equal(r.durum, 415);
  // GET'te yabanci Origin (CORS okumasi) de reddedilir
  r = await c.get("/api/isler", { baslik: { Origin: "http://evil.com" } });
  assert.equal(r.durum, 403);
  // kendi origin'i serbest
  r = await c.post("/api/durdur", { id: "yok" }, { baslik: { Origin: "http://localhost:" + panel.port, "Sec-Fetch-Site": "same-origin" } });
  assert.equal(r.durum, 200);
});

test("hata yanitlari {hata,kod}; yigin izi sizmaz; bilinmeyen uc 404", async () => {
  let r = await c.get("/api/yok-boyle-bir-uc");
  assert.equal(r.durum, 404); assert.equal(r.json.kod, "yok"); assert.equal(typeof r.json.hata, "string");
  r = await c.get("/api/is-detay?is=olmayan-is");
  assert.equal(r.durum, 404);
  r = await c.get("/api/is-detay");
  assert.equal(r.durum, 400); assert.equal(r.json.kod, "gecersiz_is");
  for (const x of [r.metin, (await c.get("/api/yok")).metin]) assert.doesNotMatch(x, /\bat [A-Za-z.<>]+ \(|\.js:\d+/);
  assert.equal((await c.get("/baska/yol/yok.html")).durum, 404);
});

test("yol kacislari: '..' ile silme/okuma/acma reddedilir, proje dosyalari yerinde kalir", async () => {
  const korunan = path.join(ortam.kok, "korunan.txt");
  fs.writeFileSync(korunan, "dokunma");
  const envKorunan = ortam.env;
  const kotuIsler = ["..", ".", "../x", "..\\x", "a/../..", "x".repeat(65), "%2e%2e", "a b", ""];
  for (const is of kotuIsler) {
    for (const [yol, govde] of [["/api/gorsel-sil", { is, sahne: "..", ad: "korunan.txt" }], ["/api/gorunum", { is, gecis: "fade" }], ["/api/ac", { is }], ["/api/temizle", { is, tur: "ara" }],
      ["/api/is-arsivle", { is }], ["/api/calistir", { tur: "video", is }], ["/api/yayin-isaretle", { is, platform: "yt", durum: "hazir" }]]) {
      const r = await c.post(yol, govde);
      assert.equal(r.durum, 400, yol + " is=" + JSON.stringify(is));
      assert.equal(r.json.kod, "gecersiz_is");
    }
    assert.equal((await c.get("/api/dosya?tur=konu&is=" + encodeURIComponent(is))).durum, 400);
    assert.equal((await c.get("/api/gorseller?is=" + encodeURIComponent(is))).durum, 400);
    assert.equal((await c.get("/api/sahneler?is=" + encodeURIComponent(is))).durum, 400);
  }
  // (URL ayristirici '/video/..' gibi nokta segmentlerini kendisi '/' yapar; onemli olan hicbir dosyanin sizmamasi)
  for (const yol of ["/onizle/../../x/a.jpg", "/onizle/..%2f..%2fx/a/b.jpg", "/video/..", "/video/%2e%2e", "/indir/../video", "/marka/..%2f..%2f.env", "/marka/..\\..\\.env"]) {
    const r = await c.get(yol, { cerezli: true });
    assert.ok([200, 400, 403, 404].includes(r.durum), yol + " -> " + r.durum);
    assert.doesNotMatch(r.metin, /createServer|ANTHROPIC_API_KEY=|dokunma/, yol);
  }
  // statik dosya kacisi
  for (const yol of ["/..%2f..%2fpanel.js", "/%2e%2e/%2e%2e/.env", "/..\\..\\panel.js", "/panel-public/../panel.js", "/%00"]) {
    const r = await c.get(yol, { jetonsuz: true });
    assert.ok([400, 403, 404].includes(r.durum), yol + " -> " + r.durum);
    assert.doesNotMatch(r.metin, /createServer|ANTHROPIC/);
  }
  assert.equal(fs.readFileSync(korunan, "utf8"), "dokunma");
  assert.equal(fs.existsSync(envKorunan), true);
});

test("is adi icin yalniz beyaz liste: /api/yeni ad'i kendisi temizler, kotu karakterli ad olusmaz", async () => {
  const r = await c.post("/api/yeni", { baslik: "x", ad: "../../kacis" });
  assert.equal(r.durum, 200);
  assert.match(r.json.ad, /^[a-z0-9-]+$/);
  assert.equal(fs.existsSync(path.join(ortam.kok, "kacis")), false);
  assert.equal(fs.existsSync(path.join(ortam.uretim, r.json.ad, "konu.json")), true);
});

test("bozuk istek govdeleri: null/dizi/bozuk JSON/cok buyuk — sunucu ayakta kalir", async () => {
  let r = await c.istek("POST", "/api/yeni", "null");
  assert.equal(r.durum, 400); assert.equal(r.json.kod, "girdi");
  r = await c.istek("POST", "/api/yeni", "[1,2,3]");
  assert.equal(r.durum, 400);
  r = await c.istek("POST", "/api/calistir", "{bozuk json");
  assert.equal(r.durum, 400); assert.equal(r.json.kod, "json_bozuk");
  r = await c.istek("POST", "/api/gorunum", "5");
  assert.equal(r.durum, 400);
  r = await c.post("/api/calistir", {});
  assert.equal(r.durum, 400); assert.equal(r.json.kod, "gecersiz_islem");
  r = await c.post("/api/calistir", { tur: "video" });
  assert.equal(r.durum, 400); assert.equal(r.json.kod, "gecersiz_is");
  r = await c.post("/api/calistir", { tur: "video", is: { x: 1 } });
  assert.equal(r.durum, 400);
  r = await c.post("/api/calistir", { tur: "olmayan-tur", is: "x" });
  assert.equal(r.durum, 400);
  r = await c.post("/api/calistir", { tur: "mix", klasor: "C:\\" });
  assert.equal(r.durum, 400, "mix/tonMuzik kaldirildi");
  r = await c.post("/api/yeni", { baslik: "x".repeat(6 * 1024 * 1024) }).catch(e => ({ durum: "kopuk", hata: e }));
  assert.ok(r.durum === 413 || r.durum === "kopuk", "5 MB ustu govde reddedilir: " + r.durum);
  assert.equal((await c.get("/api/ozellikler")).durum, 200, "sunucu hala ayakta");
  r = await c.post("/api/durdur", { id: null }); assert.equal(r.json.ok, false);
  r = await c.post("/api/durdur", {}); assert.equal(r.json.ok, false);
  r = await c.get("/api/log?id=" + "x".repeat(5000)); assert.equal(r.durum, 404);
  r = await c.get("/api/log"); assert.equal(r.durum, 404);
  r = await c.get("/%E0%A4%A", { jetonsuz: true }); assert.ok([400, 404].includes(r.durum));
});

test("cokme dayaniklilik: beklenmeyen bir hata 500 {kod:'sunucu'} verir, yigin sizmaz, sunucu ve gunluk yasar", async () => {
  const o2 = Y.geciciOrtam("cokme");
  fs.mkdirSync(o2.ayar);                               // ayar dosyasi yerine KLASOR: yazma EISDIR/EPERM ile patlar
  const p2 = await Y.panelBaslat(o2);
  try {
    const c2 = p2.istemci;
    const r = await c2.post("/api/ayarlar", { kanal: "Yeni Kanal" });
    assert.equal(r.durum, 500);
    assert.ok(r.json && typeof r.json.hata === "string" && r.json.kod);
    assert.doesNotMatch(r.metin, /\bat [A-Za-z.<>]+ \(|[A-Z]:\\|\.js:\d+/);
    assert.equal((await c2.get("/api/isler")).durum, 200, "sunucu cokmedi");
    assert.equal((await c2.get("/api/ayarlar")).json.kanal, "KANALIM", "bozuk/okunamayan ayar dosyasinda varsayilan");
    assert.equal(p2.cikisKodu(), null);
    const gunluk = fs.readdirSync(path.join(o2.uretim, "_log")).filter(x => /^panel-\d{8}\.log$/.test(x));
    assert.equal(gunluk.length, 1, "beklenmeyen hata uretim/_log/panel-<tarih>.log'a yazilmali");
    assert.match(fs.readFileSync(path.join(o2.uretim, "_log", gunluk[0]), "utf8"), /istek hatasi POST \/api\/ayarlar/);
  } finally { await p2.kapat(); o2.temizle(); }
});

test("port doluysa Turkce mesaj ve cikis kodu 98 (PANEL.bat dongusu bunu 'biter' sayar)", async () => {
  const { spawn } = require("child_process");
  const o3 = Y.geciciOrtam("port");
  try {
    const p = spawn(process.execPath, [path.join(Y.KOK, "panel.js")], { cwd: Y.KOK, windowsHide: true,
      env: Object.assign({}, process.env, { OTOMASYON_URETIM: o3.uretim, OTOMASYON_ENV_DOSYASI: o3.env, OTOMASYON_AYAR_DOSYASI: o3.ayar, PANEL_PORT: String(panel.port) }) });
    let cikti = ""; p.stderr.on("data", d => cikti += d); p.stdout.on("data", d => cikti += d);
    const kod = await new Promise(coz => { p.on("close", coz); setTimeout(() => { try { p.kill(); } catch (e) {} }, 8000).unref(); });
    assert.equal(kod, 98);
    assert.match(cikti, /port dolu/);
  } finally { o3.temizle(); }
});

test("panel yalniz 127.0.0.1'e baglanir (tum arayuzlere degil)", async () => {
  const os = require("os");
  const harici = [].concat(...Object.values(os.networkInterfaces())).find(i => i && !i.internal && i.family === "IPv4");
  if (!harici) return;                                 // makinede dis arayuz yoksa denenemez
  const http = require("http");
  const sonuc = await new Promise(coz => {
    const r = http.get({ host: harici.address, port: panel.port, path: "/", timeout: 2000 }, res => { res.resume(); coz("baglandi"); });
    r.on("error", e => coz(e.code || "hata")); r.on("timeout", () => { r.destroy(); coz("zaman"); });
  });
  assert.notEqual(sonuc, "baglandi", "dis arayuzden baglanilabiliyor: " + harici.address);
});
