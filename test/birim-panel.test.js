// BIRIM TESTLERI — panel: yol / is adi dogrulama, Host-Origin-jeton-Content-Type kapisi, konu.json semasi, is adi uretimi,
// gercek panel sureci uzerinde saldiri senaryolari (127.0.0.1, 4301-4399 portlari). Ag yok, ucretli servis yok.
// Bulgu karsiliklari: B061, B062, B063, B066, B010, B054.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const http = require("http");
const Y = require("./panel-yardim");
const B = require("./birim-yardim");

const ortak = require("../lib/ortak");
const G = require("../lib/panel-guvenlik");
const YI = require("../lib/panel-yeni-is");

// ---------------------------------------------------------------- is adi ve yol dogrulamasi
test("guvenliAd: yalniz harf/rakam/tire/alt cizgi; nokta, egik cizgi, bosluk, bos, 65 karakter, Windows rezerve adlari REDDEDILIR", () => {
  for (const iyi of ["a", "Roma-neden-coktu", "is_1", "0abc", "a".repeat(64), "con-is", "COM10", "lpt"])
    assert.equal(ortak.guvenliAd(iyi), true, iyi);
  for (const kotu of ["", ".", "..", ".env", "-x", "_x", "a.b", "a/b", "a\\b", "a b", "a:b", "a*b", "a\0b", "a".repeat(65), "con", "NUL", "Aux", "prn", "com1", "LPT9",
    "ｃｏｎ", "é", "iş", "a\n", " a", "a ", "../x", "x/../y", null, undefined, 5, {}, []])
    assert.equal(ortak.guvenliAd(kotu), false, JSON.stringify(kotu));
});

test("isDizin: gecersiz adda OrtakHata (cikis 2); gecerli adda uretim klasorunun ALTINDA yol", () => {
  const o = B.ortamKur("panel-dizin");
  try {
    for (const kotu of ["..", "../x", "a/b", "", "con", "x".repeat(65)]) assert.throws(() => ortak.isDizin(kotu), e => e instanceof ortak.OrtakHata && e.cikis === 2, kotu);
    const d = ortak.isDizin("iyi-is");
    assert.equal(path.dirname(d), o.uretim);
    assert.equal(ortak.yolIcinde(o.uretim, d), true);
  } finally { o.temizle(); }
});

test("yolIcinde: path.relative tabanli; kardes klasor (abc/abcd), '..' kacisi, mutlak ve bos yollar", () => {
  const t = path.resolve(os.tmpdir(), "birim-taban", "abc");
  assert.equal(ortak.yolIcinde(t, t), true);
  assert.equal(ortak.yolIcinde(t, path.join(t, "alt", "dosya.txt")), true);
  assert.equal(ortak.yolIcinde(t, path.join(t, "..", "abcd", "x")), false, "abcd, abc'nin icinde degil");
  assert.equal(ortak.yolIcinde(t, path.join(t, "..", "abc2")), false);
  assert.equal(ortak.yolIcinde(t, path.join(t, "alt", "..", "..", "disari")), false);
  assert.equal(ortak.yolIcinde(t, path.resolve(t, "..")), false);
  assert.equal(ortak.yolIcinde(t, path.parse(t).root), false);
  assert.equal(ortak.yolIcinde(t, path.join(t, "a..b")), true, "adin icinde '..' gecmesi disari cikis degil");
  assert.equal(ortak.yolIcinde(t, path.join(t, "..a", "x")), true);
});

// ---------------------------------------------------------------- Host / Origin / jeton / Content-Type kapisi (saf)
const istek = (yontem, baslik) => ({ method: yontem, headers: Object.assign({}, baslik || {}) });
const P = 4321, J = "a".repeat(64);

test("hostIzinli: yalniz localhost / 127.0.0.1 / [::1] + TAM port; buyuk harf serbest; alt alan adi, portsuz, bos reddedilir", () => {
  for (const h of ["localhost:4321", "127.0.0.1:4321", "[::1]:4321", "LOCALHOST:4321", "LocalHost:4321"]) assert.equal(G.hostIzinli(h, P), true, h);
  for (const h of ["localhost", "127.0.0.1", "localhost:4322", "localhost:43210", "evil.com", "evil.com:4321", "localhost.evil.com:4321", "127.0.0.1.nip.io:4321",
    "0.0.0.0:4321", "[::]:4321", "localhost:4321 ", " localhost:4321", "localhost:4321.evil.com", "", undefined, null, 5, ["localhost:4321"]])
    assert.equal(G.hostIzinli(h, P), false, JSON.stringify(h));
  // panel ag'a acilamaz: ucuncu arguman (eski "ek host" listesi) artik yok sayilir, baska adres hicbir yolla izinli olmaz
  assert.equal(G.hostIzinli("benim.pc:4321", P, ["benim.pc:4321"]), false, "ek host listesi kaldirildi");
  assert.equal(G.originIzinli("http://benim.pc:4321", P, ["benim.pc:4321"]), false, "ek origin listesi kaldirildi");
});

test("originIzinli: Origin yoksa serbest (jeton yine sart); varsa kendi adresi olmali; 'null' ve yabanci reddedilir", () => {
  assert.equal(G.originIzinli(undefined, P), true);
  for (const o of ["http://localhost:4321", "http://127.0.0.1:4321", "http://[::1]:4321", "HTTP://LOCALHOST:4321"]) assert.equal(G.originIzinli(o, P), true, o);
  for (const o of ["null", "", "http://evil.com", "https://localhost:4321", "http://localhost", "http://localhost:4322", "http://localhost:4321.evil.com", "http://localhost:4321/", "file://", 5])
    assert.equal(G.originIzinli(o, P), false, JSON.stringify(o));
  assert.equal(G.fetchSiteIzinli(undefined), true);
  assert.equal(G.fetchSiteIzinli("same-origin"), true);
  assert.equal(G.fetchSiteIzinli("none"), true);
  for (const s of ["cross-site", "same-site", "", "SAME-ORIGIN"]) assert.equal(G.fetchSiteIzinli(s), false, s);
});

test("jetonEsit / jetonUret: rastgele 64 hane, sabit-zamanli karsilastirma; bos/tur uyusmazligi hep false", () => {
  const a = G.jetonUret(), b = G.jetonUret();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.equal(G.jetonEsit(a, a), true);
  assert.equal(G.jetonEsit(a, b), false);
  assert.equal(G.jetonEsit(a, a + "0"), false);
  assert.equal(G.jetonEsit(a, a.slice(0, 63)), false);
  for (const x of ["", null, undefined, 5, {}]) { assert.equal(G.jetonEsit(x, a), false); assert.equal(G.jetonEsit(a, x), false); }
  assert.equal(G.jetonEsit("", ""), false, "iki bos jeton ESIT SAYILMAZ (jetonsuz giris)");
});

test("kapi(): sira Host > Origin/Sec-Fetch-Site > Content-Type > jeton; medya yollari cerez ister; yanit {durum, kod, hata}", () => {
  const iyi = { host: "localhost:" + P, "content-type": "application/json", "x-panel-token": J };
  assert.equal(G.kapi(istek("GET", { host: "localhost:" + P, "x-panel-token": J }), "/api/isler", P, J), null);
  assert.equal(G.kapi(istek("POST", iyi), "/api/yeni", P, J), null);
  assert.equal(G.kapi(istek("POST", Object.assign({}, iyi, { "content-type": "application/json; charset=utf-8" })), "/api/yeni", P, J), null);
  const ret = (r, durum, kod) => { assert.ok(r, "reddedilmeliydi"); assert.equal(r.durum, durum); assert.equal(r.kod, kod); assert.equal(typeof r.hata, "string"); };
  ret(G.kapi(istek("GET", { host: "evil.com", "x-panel-token": J }), "/api/isler", P, J), 403, "host");
  ret(G.kapi(istek("GET", { "x-panel-token": J }), "/api/isler", P, J), 403, "host");
  ret(G.kapi(istek("POST", Object.assign({}, iyi, { origin: "http://evil.com" })), "/api/yeni", P, J), 403, "origin");
  ret(G.kapi(istek("POST", Object.assign({}, iyi, { "sec-fetch-site": "cross-site" })), "/api/yeni", P, J), 403, "origin");
  ret(G.kapi(istek("DELETE", Object.assign({}, iyi, { "content-type": "text/plain" })), "/api/x", P, J), 415, "icerik_turu");
  for (const tur of ["application/jsonx", "text/html", "multipart/form-data", "application/x-www-form-urlencoded", "", "json"])
    ret(G.kapi(istek("PUT", Object.assign({}, iyi, { "content-type": tur })), "/api/x", P, J), 415, "icerik_turu");
  ret(G.kapi(istek("GET", { host: "localhost:" + P }), "/api/isler", P, J), 403, "token");
  ret(G.kapi(istek("GET", { host: "localhost:" + P, "x-panel-token": "b".repeat(64) }), "/api/isler", P, J), 403, "token");
  ret(G.kapi(istek("GET", { host: "localhost:" + P, origin: "http://evil.com", "x-panel-token": J }), "/api/isler", P, J), 403, "origin");
  // medya: header degil CEREZ
  ret(G.kapi(istek("GET", { host: "localhost:" + P, "x-panel-token": J }), "/video/x", P, J), 403, "token");
  assert.equal(G.kapi(istek("GET", { host: "localhost:" + P, cookie: "baska=1; " + G.CEREZ_AD + "=" + J }), "/video/x", P, J), null);
  ret(G.kapi(istek("GET", { host: "localhost:" + P, cookie: G.CEREZ_AD + "=" + "c".repeat(64) }), "/onizle/a/b/c.jpg", P, J), 403, "token");
  // statik sayfa jetonsuz acilir
  assert.equal(G.kapi(istek("GET", { host: "localhost:" + P }), "/panel.html", P, J), null);
  assert.equal(G.cerezDegeri(J), "panel_oturum=" + J + "; HttpOnly; SameSite=Strict; Path=/");
  assert.ok(G.CSP.includes("frame-ancestors 'none'") && G.CSP.includes("base-uri 'none'") && G.CSP.includes("connect-src 'self'"));
});

test("htmlEnjekte: jeton meta'si <head>'e girer; sarmalayici SADECE ayni kaynaktaki /api/ isteklerine X-Panel-Token ekler", () => {
  const s = G.htmlEnjekte("<!doctype html><html><head><title>x</title></head><body></body></html>", J);
  assert.match(s, /<head><meta name="panel-token" content="a{64}"><script>/);
  assert.match(s, /x\.origin===location\.origin&&x\.pathname\.indexOf\('\/api\/'\)===0/);
  assert.ok(G.htmlEnjekte("<body>x</body>", J).startsWith('<meta name="panel-token"'), "head yoksa da calisir");
  assert.equal((s.match(/panel-token/g) || []).length >= 2, true);
});

// ---------------------------------------------------------------- konu.json semasi
test("konuDogrula: gecerli ornek; her alan icin sinir/enum ihlali ALAN ADIYLA raporlanir", () => {
  const iyi = { surum: 1, baslik_en: "Roma", _not: "n", kanal: "K", slogan: "s", format: "long", aspect: "16:9", hedefSaniye: 900, geriSayim: 5, intro: 8, konuKarti: 2.5, outro: 12,
    muzikSeviyesi: 0.4, gecis: "circleopen", gecisSure: 0.8, efekt: "kaydir", renk: "siyahbeyaz", ses: "tr-TR-AhmetNeural", sesHizi: "+7%", dil: "tr", altyaziDili: "en",
    altyazi: true, altyaziStil: "kelime", sesMotoru: "piper", okunus: { GPU: "G P U" }, tur: "haber-spor", kanalSesi: { tarif: "t", ornekParagraf: "o" },
    onay: { senaryo: true, gorsel: false }, acilisStili: "hizli", markaKose: 2, vurguRenk: "FFAA00", outroMetni: { baslik: "A", alt: "B", altSlogan: "C" },
    muzikRuhu: "gerilim", muzikDucking: false, cesitlilik: true, maliyetUstSinirUSD: 3.5, yayin: { hashtagler: ["#a"], aciklamaSablonu: "x", seri: "y" },
    sahneKelimeleri: ["a", ["b", "c"]], formuller: [{ n: "e", hedef: "001-a" }], uretAdet: 2 };
  assert.deepEqual(ortak.konuDogrula(iyi), { gecerli: true, hatalar: [], uyarilar: [] });
  const kotu = [
    ["hedefSaniye", 14], ["hedefSaniye", 3601], ["hedefSaniye", "900"], ["geriSayim", 3], ["geriSayim", "5"], ["intro", -1], ["intro", 31], ["konuKarti", 31], ["outro", 99],
    ["muzikSeviyesi", 1.5], ["muzikSeviyesi", -0.1], ["gecis", "yok-boyle"], ["gecisSure", 0.1], ["gecisSure", 5], ["efekt", "dondur"], ["renk", "mor"], ["format", "uzun"], ["aspect", "4:3"],
    ["sesHizi", "7%"], ["sesHizi", "+7"], ["sesHizi", "+60%"], ["sesHizi", "fast"], ["dil", "TR"], ["dil", "tur"], ["altyaziDili", "e"], ["altyaziStil", "buyuk"], ["sesMotoru", "google"],
    ["tur", "komedi"], ["acilisStili", "yavas"], ["markaKose", 11], ["vurguRenk", "#6FD8FF"], ["vurguRenk", "6FD8F"], ["muzikRuhu", "hüzün"], ["maliyetUstSinirUSD", -1],
    ["uretAdet", 0], ["uretAdet", 7], ["uretAdet", 2.5], ["baslik_en", ""], ["baslik_en", "x".repeat(301)], ["kanal", "k".repeat(61)], ["slogan", "s".repeat(121)], ["_not", "n".repeat(5001)],
    ["muzikDucking", "evet"], ["cesitlilik", 1], ["altyazi", "acik"], ["okunus", []], ["kanalSesi", "x"], ["onay", { senaryo: "evet" }], ["outroMetni", { baslik: "x".repeat(81) }],
    ["yayin", { hashtagler: new Array(16).fill("#a") }], ["sahneKelimeleri", "tek"], ["sahneKelimeleri", [5]], ["formuller", {}], ["formuller", [{ n: "../x" }]], ["promptlar", [{ hedef: "a/b" }]],
    ["portreler", [{ n: "a.b" }]], ["sahneler", ["x"]],
  ];
  for (const [alan, deger] of kotu) {
    const r = ortak.konuDogrula(Object.assign({}, iyi, { [alan]: deger }));
    assert.equal(r.gecerli, false, alan + "=" + JSON.stringify(deger).slice(0, 50) + " reddedilmeliydi");
    assert.ok(r.hatalar.some(h => h.alan === alan || h.alan.startsWith(alan + "[") || h.alan.startsWith(alan + ".")), alan + " alani raporlanmali: " + JSON.stringify(r.hatalar));
  }
  for (const nesne of [null, [], "x", 5, undefined]) assert.equal(ortak.konuDogrula(nesne).gecerli, false);
  assert.ok(ortak.GECISLER.length === 29 && new Set(ortak.GECISLER).size === 29, "29 gecis");
  assert.ok(ortak.konuDogrula({ bilinmeyen: 1, _ozel: 2 }).uyarilar.some(u => u.alan === "bilinmeyen"));
  assert.equal(ortak.konuDogrula({ _ozel: 2 }).uyarilar.length, 0, "_ onekli alan serbest");
});

test("konuHam: bozuk JSON satir/sutunla konu_bozuk (betik varsayilana DUSMEZ); konuEtkin yoksa null; JSON dizi ise konu_gecersiz", () => {
  const o = B.ortamKur("panel-konu");
  try {
    const d = path.join(o.uretim, "kk");
    fs.mkdirSync(d, { recursive: true });
    assert.equal(ortak.konuEtkin("kk"), null);
    fs.writeFileSync(path.join(d, "konu.json"), '{\n  "format": "short",\n  "intro": ,\n}');
    assert.throws(() => ortak.konuHam("kk"), e => e.kod === "konu_bozuk" && e.cikis === 2 && e.satir === 3 && Number.isInteger(e.sutun));
    assert.throws(() => ortak.konuEtkin("kk"), e => e.kod === "konu_bozuk");
    fs.writeFileSync(path.join(d, "konu.json"), "[1,2]");
    assert.throws(() => ortak.konuHam("kk"), e => e.kod === "konu_gecersiz" && e.cikis === 2);
    fs.writeFileSync(path.join(d, "konu.json"), '{"format":"short","intro":99}');
    assert.throws(() => ortak.konuEtkin("kk"), e => e.kod === "konu_gecersiz" && /intro/.test(e.message));
  } finally { o.temizle(); }
});

test("yeni is adi: rezerve Windows adlari ('Con', 'Nul', 'Com1') '-is' ekiyle acilir (eskiden 'gecerli bir ada cevrilemedi'); cakismada -2", () => {
  const o = B.ortamKur("panel-yeni");
  try {
    for (const [baslik, beklenen] of [["Con", "con-is"], ["NUL", "nul-is"], ["Com1", "com1-is"], ["lpt9", "lpt9-is"], ["Roma neden çöktü?", "roma-neden-coktu"], ["Çay: 100% güzel", "cay-100-guzel"]]) {
      const r = YI.yeniIs({ baslik, nis: "bir konu", format: "long" }, { uretim: o.uretim });
      assert.equal(r.ad, beklenen);
      assert.equal(ortak.guvenliAd(r.ad), true);
      assert.ok(fs.existsSync(path.join(o.uretim, r.ad, "konu.json")));
    }
    const ikinci = YI.yeniIs({ baslik: "Con", nis: "x", format: "long" }, { uretim: o.uretim });
    assert.equal(ikinci.ad, "con-is-2");
    // Latin disi baslik: n-<sha6>, gecerli ad
    const cin = YI.yeniIs({ baslik: "你好世界", nis: "x", format: "short" }, { uretim: o.uretim });
    assert.match(cin.ad, /^n-[0-9a-f]{6}$/);
    // rastgele baslik taramasi: uretilen ad HER ZAMAN gecerli, klasor uretim disinda acilmaz
    let t = 5;
    const rnd = () => (t = (t * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const harfler = "abcçdğeıiöşüXYZ 0123-_./\\:*?\"<>|%'`~!@#$^&()+=[]{};,CON NUL ";
    for (let i = 0; i < 80; i++) {
      const baslik = Array.from({ length: 1 + Math.floor(rnd() * 30) }, () => harfler[Math.floor(rnd() * harfler.length)]).join("");
      if (!baslik.trim()) continue;
      const r = YI.yeniIs({ baslik, nis: "x", format: "long" }, { uretim: o.uretim });
      assert.equal(ortak.guvenliAd(r.ad), true, JSON.stringify(baslik) + " -> " + r.ad);
      assert.equal(path.dirname(r.dizin), o.uretim);
    }
  } finally { o.temizle(); }
});

// ---------------------------------------------------------------- gercek panel sureci (4301-4399)
let ortam, panel, c, portlar = [];
async function portBul(kayma) {
  const s = await B.sunucuAc((q, r) => r.end(), { kayma });
  const p = s.port;
  await s.kapat();
  return p;
}
test.before(async () => {
  ortam = Y.geciciOrtam("birim");
  panel = await Y.panelBaslat(ortam, { port: await portBul(11) });
  c = panel.istemci;
});
test.after(async () => { if (panel) await panel.kapat(); if (ortam) ortam.temizle(); });

// ham istek: Node'un Host/Content-Length davranisina karismadan baslik gonderir
function ham(yontem, yol, baslik, govde) {
  return new Promise((coz, red) => {
    const h = Object.assign({}, baslik || {});
    const r = http.request({ host: "127.0.0.1", port: panel.port, path: yol, method: yontem, headers: h }, res => {
      const p = []; res.on("data", x => p.push(x));
      res.on("end", () => { const m = Buffer.concat(p).toString("utf8"); let j = null; try { j = JSON.parse(m); } catch (e) { /* json degil */ } coz({ durum: res.statusCode, baslik: res.headers, metin: m, json: j }); });
    });
    r.on("error", red);
    if (govde !== undefined) r.write(govde);
    r.end();
  });
}

test("panel: /api/yeni ile 'Con' basligi acilir ('con-is'); yanit ad'i bildirir; konu.json gecerli", async () => {
  const r = await c.post("/api/yeni", { baslik: "Con", nis: "bir konu", format: "long", kanal: "K" });
  assert.equal(r.durum, 200, r.metin);
  assert.equal(r.json.ad, "con-is");
  const k = JSON.parse(fs.readFileSync(path.join(ortam.uretim, "con-is", "konu.json"), "utf8"));
  assert.equal(ortak.konuDogrula(k).gecerli, true);
});

test("panel: Host/Origin/jeton/Content-Type reddi gercek istekte (404/200 degil 403/415); hicbir yanitta CORS izni YOK", async () => {
  const jeton = c.jeton, host = "localhost:" + panel.port;
  let r = await ham("GET", "/api/isler", { Host: "evil.example", "X-Panel-Token": jeton });
  assert.deepEqual([r.durum, r.json.kod], [403, "host"]);
  r = await ham("GET", "/api/isler", { Host: host });
  assert.deepEqual([r.durum, r.json.kod], [403, "token"]);
  r = await ham("POST", "/api/durdur", { Host: host, "X-Panel-Token": jeton, "Content-Type": "application/json", Origin: "http://evil.example" }, "{}");
  assert.deepEqual([r.durum, r.json.kod], [403, "origin"]);
  r = await ham("POST", "/api/durdur", { Host: host, "X-Panel-Token": jeton, "Content-Type": "text/plain" }, "{}");
  assert.deepEqual([r.durum, r.json.kod], [415, "icerik_turu"]);
  r = await ham("POST", "/api/durdur", { Host: host, "X-Panel-Token": jeton, "Content-Type": "application/json" }, JSON.stringify({ id: "yok" }));
  assert.equal(r.durum, 200);
  for (const [yontem, yol, baslik] of [["OPTIONS", "/api/isler", { Origin: "http://evil.example", "Access-Control-Request-Method": "POST" }], ["GET", "/", {}], ["GET", "/api/isler", { "X-Panel-Token": jeton }]]) {
    const x = await ham(yontem, yol, Object.assign({ Host: host }, baslik));
    for (const k of Object.keys(x.baslik)) assert.ok(!/^access-control-/i.test(k), yontem + " " + yol + " CORS basligi donuyor: " + k);
    assert.doesNotMatch(x.metin, /Access-Control/);
  }
});

test("panel: '..' ile proje dosyasi silinemez/okunamaz (canary dosyalari yerinde); bozuk govdeler sunucuyu DUSURMEZ", async () => {
  const kok = ortam.kok;
  const canary = [ortam.env, path.join(kok, "canary.txt")];     // uretim/'in bir ust klasoru = '..' ile ulasilabilecek "proje koku"
  fs.writeFileSync(canary[1], "dokunma");
  const once = canary.map(f => fs.readFileSync(f, "utf8"));
  for (const govde of [{ is: "..", sahne: "..", ad: ".env" }, { is: "..", sahne: "..", ad: "canary.txt" }, { is: "con-is", sahne: "..", ad: "..\\..\\canary.txt" },
    { is: "con-is", sahne: "../..", ad: "canary.txt" }, { is: "con-is", sahne: "001-a", ad: "../../../canary.txt" }, { is: "con-is", sahne: "001-a", ad: "..\\..\\..\\canary.txt" }]) {
    const r = await c.post("/api/gorsel-sil", govde);
    assert.ok([400, 404].includes(r.durum), JSON.stringify(govde) + " -> " + r.durum);
  }
  for (const yol of ["/api/dosya?is=..&tur=konu", "/api/dosya?is=con-is&tur=../../canary", "/api/dosya?is=con-is&tur=%2e%2e", "/api/is-detay?is=..%2f..", "/api/gorseller?is=a%00b"]) {
    const r = await c.get(yol);
    assert.ok(r.durum >= 400 && r.durum < 500, yol + " -> " + r.durum);
    assert.doesNotMatch(r.metin, /dokunma|ANTHROPIC_API_KEY=/);
  }
  assert.deepEqual(canary.map(f => fs.readFileSync(f, "utf8")), once);
  // bozuk govdeler
  for (const g of ["null", "[]", "5", '"x"', "{", "{\"is\":", "\u0000", "{\"a\":1}garbage"]) {
    const r = await c.istek("POST", "/api/yeni", g);
    assert.ok(r.durum >= 400 && r.durum < 500, JSON.stringify(g) + " -> " + r.durum);
    assert.equal(typeof r.json.hata, "string");
  }
  assert.equal((await c.get("/api/ozellikler")).durum, 200, "panel hayatta");
});

test("panel: konu.json semasi API'de — gecersiz alan 400 {alanlar}, bozuk JSON satir/sutun, gecerli kayit .bak yedegi birakir", async () => {
  const yeni = await c.post("/api/yeni", { baslik: "Sema denemesi", nis: "x", format: "long" });
  const ad = yeni.json.ad;
  const konuYolu = path.join(ortam.uretim, ad, "konu.json");
  const once = fs.readFileSync(konuYolu, "utf8");
  let r = await c.post("/api/dosya?is=" + ad + "&tur=konu", { icerik: JSON.stringify(Object.assign(JSON.parse(once), { hedefSaniye: 5, sesHizi: "+99%" })) });
  assert.equal(r.durum, 400, r.metin);
  assert.ok(Array.isArray(r.json.alanlar) && r.json.alanlar.some(a => a.alan === "hedefSaniye") && r.json.alanlar.some(a => a.alan === "sesHizi"), r.metin);
  r = await c.post("/api/dosya?is=" + ad + "&tur=konu", { icerik: '{\n "format": "short",\n "intro": ,\n}' });
  assert.equal(r.durum, 400);
  assert.equal(r.json.satir, 3);
  assert.equal(fs.readFileSync(konuYolu, "utf8"), once, "gecersiz kayit dosyayi DEGISTIRMEMELI");
  const gecerli = Object.assign(JSON.parse(once), { hedefSaniye: 600, kanal: "Yeni Kanal" });
  r = await c.post("/api/dosya?is=" + ad + "&tur=konu", { icerik: JSON.stringify(gecerli, null, 2) });
  assert.equal(r.durum, 200, r.metin);
  assert.equal(JSON.parse(fs.readFileSync(konuYolu, "utf8")).hedefSaniye, 600);
  assert.ok(fs.existsSync(konuYolu + ".bak"), "yedek alinmali");
  // bozuk konu.json varken Gorunum 'Uygula' uzerine YAZMAZ (409)
  fs.writeFileSync(konuYolu, '{"format": "short",');
  r = await c.post("/api/gorunum", { is: ad, gecis: "fade" });
  assert.equal(r.durum, 409, r.metin);
  assert.equal(fs.readFileSync(konuYolu, "utf8"), '{"format": "short",');
});

test("panel: beyaz liste alanlarina 'constructor' / '__proto__' / 'toString' gibi miras anahtarlar GECERLI SAYILMAZ (eski hata: 200 + bozuk yayin-durum.json)", async () => {
  const yeni = await c.post("/api/yeni", { baslik: "Prototip denemesi", nis: "x", format: "long" });
  const ad = yeni.json.ad;
  const durumDosyasi = path.join(ortam.uretim, ad, "yayin-durum.json");
  for (const a of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "prototype"]) {
    const rapor = [];
    const dene = async (etiket, r) => { if (r.durum !== 400) rapor.push(etiket + " -> " + r.durum + " " + r.metin.slice(0, 80)); };
    await dene("yayin-isaretle platform", await c.post("/api/yayin-isaretle", { is: ad, platform: a, durum: "hazir" }));
    await dene("yayin-isaretle durum", await c.post("/api/yayin-isaretle", { is: ad, platform: "youtube", durum: a }));
    await dene("dosya GET tur", await c.get("/api/dosya?is=" + ad + "&tur=" + a));
    await dene("dosya POST tur", await c.post("/api/dosya?is=" + ad + "&tur=" + a, { icerik: "x" }));
    await dene("calistir tur", await c.post("/api/calistir", { tur: a, is: ad }));
    await dene("raporlar tur", await c.get("/api/raporlar?tur=" + a));
    await dene("anahtar-test", await c.get("/api/anahtar-test?anahtar=" + a));
    await dene("yeni format", await c.post("/api/yeni", { baslik: "P " + a, nis: "x", format: a }));
    await dene("gorunum gecis", await c.post("/api/gorunum", { is: ad, gecis: a }));
    await dene("temizle tur", await c.post("/api/temizle", { is: ad, tur: a }));
    assert.deepEqual(rapor, [], "'" + a + "' gecerli sayildi");
  }
  assert.equal(fs.existsSync(durumDosyasi), false, "gecersiz platform yayin-durum.json yazmamali");
  // gecerli platform ve takma adlar calismaya devam eder
  for (const [platform, beklenen] of [["youtube", "youtube"], ["YT", "youtube"], ["ig", "instagram"], ["TikTok", "tiktok"]]) {
    const r = await c.post("/api/yayin-isaretle", { is: ad, platform, durum: "hazir" });
    assert.equal(r.durum, 200, platform + " " + r.metin);
    assert.ok(r.json.yayin.platformlar[beklenen], platform + " -> " + beklenen);
  }
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(durumDosyasi, "utf8")).platformlar).sort(), ["instagram", "tiktok", "youtube"]);
});

test("panel: yalniz 127.0.0.1'de dinler (tum arayuzlerde degil); bagli olmayan adrese baglanti reddedilir", async () => {
  const disAdresler = [].concat(...Object.values(os.networkInterfaces())).filter(a => a.family === "IPv4" && !a.internal).map(a => a.address);
  for (const adres of disAdresler.slice(0, 2)) {
    const sonuc = await new Promise(coz => {
      const s = net.connect({ host: adres, port: panel.port, timeout: 1500 });
      s.on("connect", () => { s.destroy(); coz("acik"); });
      s.on("error", e => coz(e.code));
      s.on("timeout", () => { s.destroy(); coz("zaman"); });
    });
    assert.notEqual(sonuc, "acik", adres + " uzerinden panel ERISILEBILIR (0.0.0.0 dinliyor)");
  }
  assert.ok(panel.port >= 4301 && panel.port <= 4399, "test portu 4301-4399 araliginda: " + panel.port);
});
