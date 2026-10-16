// Denetim kalintilari (gercek panel sureci + sahte betikler): altyazi dosyasi ucu (B039/B052), PID yeniden kullanimi (B004),
// port doluyken ikinci panel (B003), ag'a acma seceneginin kalkmasi (B061), zincirde altyazi cevirisi on kontrolu (B085).
// Gercek .env'e, ucretli servise ve ag'a dokunmaz.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const Y = require("./panel-yardim");

const bekle = ms => new Promise(r => setTimeout(r, ms));
const kok = (o, ...p) => path.join(o.uretim, ...p);
const yaz = (p, i) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof i === "string" || Buffer.isBuffer(i) ? i : JSON.stringify(i)); };
const canliMi = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const cocuklar = [];
function alakasizProgram() {
  const c = process.platform === "win32" ? spawn("ping", ["-n", "90", "127.0.0.1"], { stdio: "ignore", windowsHide: true }) : spawn("sleep", ["90"], { stdio: "ignore" });
  cocuklar.push(c); return c;
}
test.after(() => { for (const c of cocuklar) { try { c.kill(); } catch (e) { /* zaten bitmis */ } } });
async function bekleKosul(fn, ms, aciklama) {
  const bas = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - bas > (ms || 10000)) throw new Error("zaman asimi: " + (aciklama || "")); await bekle(60); }
}

let ortam, panel, c;
test.before(async () => {
  ortam = Y.geciciOrtam("kalinti");
  panel = await Y.panelBaslat(ortam);
  c = panel.istemci;
});
test.after(async () => { if (panel) await panel.kapat(); if (ortam) ortam.temizle(); });
async function yeniIs(ek) { const r = await c.post("/api/yeni", Object.assign({ baslik: "Kalinti testi" }, ek || {})); assert.equal(r.durum, 200, r.metin); return r.json.ad; }

// ---------------------------------------------------------------- B039 / B052
test("altyazi ucu: altyazi dili = anlatim dili olan iste (yeni islerin varsayilani) GET bos+kullanilmiyor, POST 400 — artik 500 degil", async () => {
  const ad = await yeniIs({ dil: "en" });
  const g = await c.get("/api/dosya?is=" + ad + "&tur=altyazi");
  assert.equal(g.durum, 200, g.metin);
  assert.equal(g.json.icerik, ""); assert.equal(g.json.kullanilmiyor, true); assert.match(g.json.mesaj, /anlatım diliyle aynı/);
  const p = await c.post("/api/dosya?is=" + ad + "&tur=altyazi", { icerik: "yazilmamali" });
  assert.equal(p.durum, 400, p.metin); assert.equal(p.json.kod, "altyazi_kullanilmiyor"); assert.match(p.json.hata, /anlatım diliyle aynı/);
  assert.deepEqual(fs.readdirSync(kok(ortam, ad, "Voice")).filter(x => /^ALTYAZI/.test(x)), [], "ceviri dosyasi olusmamali");
  // sunucu ayakta ve gunlukte TypeError yok
  assert.equal((await c.get("/api/ozellikler")).durum, 200);
  const gunluk = path.join(ortam.uretim, "_log");
  const icerik = fs.existsSync(gunluk) ? fs.readdirSync(gunluk).filter(x => /^panel-/.test(x)).map(x => fs.readFileSync(path.join(gunluk, x), "utf8")).join("\n") : "";
  assert.ok(!/ERR_INVALID_ARG_TYPE|TypeError/.test(icerik), icerik.slice(-400));
});

test("altyazi ucu: altyazi dili FARKLI olan iste okuma/yazma calisir (Voice/ALTYAZI-TR.txt)", async () => {
  const ad = await yeniIs({ dil: "en", altyaziDili: "tr" });
  const g0 = await c.get("/api/dosya?is=" + ad + "&tur=altyazi");
  assert.equal(g0.durum, 200); assert.equal(g0.json.icerik, ""); assert.equal(g0.json.kullanilmiyor, undefined); assert.equal(g0.json.dosya, "ALTYAZI-TR.txt");
  const p = await c.post("/api/dosya?is=" + ad + "&tur=altyazi", { icerik: "Merhaba dünya.\n\nİkinci paragraf." });
  assert.equal(p.durum, 200, p.metin);
  assert.equal(fs.readFileSync(kok(ortam, ad, "Voice", "ALTYAZI-TR.txt"), "utf8"), "Merhaba dünya.\n\nİkinci paragraf.");
  assert.equal((await c.get("/api/dosya?is=" + ad + "&tur=altyazi")).json.icerik, "Merhaba dünya.\n\nİkinci paragraf.");
});

test("altyazi ucu: bozuk konu.json'da 'kullanilmiyor' demez, 409 konu_bozuk verir", async () => {
  const ad = await yeniIs({ dil: "en" });
  fs.writeFileSync(kok(ortam, ad, "konu.json"), "{ bozuk");
  const g = await c.get("/api/dosya?is=" + ad + "&tur=altyazi");
  assert.equal(g.durum, 409, g.metin); assert.equal(g.json.kod, "konu_bozuk");
  assert.equal((await c.post("/api/dosya?is=" + ad + "&tur=altyazi", { icerik: "x" })).durum, 409);
});

// ---------------------------------------------------------------- B085 (HTTP seviyesi)
test("/api/yeni uret:true: altyazi dili farkli + Claude anahtari yok → 400 anahtar_yok ve KLASOR ACILMAZ", async () => {
  const o2 = Y.geciciOrtam("ceviri");
  fs.writeFileSync(o2.env, "VIDIQ_KEY=vk-test-0000\n");                     // senaryoyu vidIQ yazabilir; Claude yok
  const p2 = await Y.panelBaslat(o2);
  try {
    const c2 = p2.istemci;
    const once = fs.readdirSync(o2.uretim).filter(x => !x.startsWith("_"));
    const r = await c2.post("/api/yeni", { baslik: "Cevirili video", dil: "en", altyaziDili: "tr", uret: true });
    assert.equal(r.durum, 400, r.metin); assert.equal(r.json.kod, "anahtar_yok");
    assert.match(r.json.hata, /çeviri/i);
    assert.deepEqual(fs.readdirSync(o2.uretim).filter(x => !x.startsWith("_")), once, "klasor acilmamali");
    // ayni dil: ayni anahtarlarla gecer (uret:false: yalniz klasor)
    const r2 = await c2.post("/api/yeni", { baslik: "Cevirisiz video", dil: "en", uret: true });
    assert.equal(r2.durum, 200, r2.metin);
    await c2.post("/api/durdur", { id: r2.json.id });
    // toplu ekleme: listede bir ceviri isi varsa hepsi reddedilir, klasor acilmaz
    const sayi = fs.readdirSync(o2.uretim).filter(x => !x.startsWith("_")).length;
    const k = await c2.post("/api/kuyruk/ekle", { isler: [{ baslik: "a", dil: "en" }, { baslik: "b", dil: "en", altyaziDili: "es" }] });
    assert.equal(k.durum, 400, k.metin); assert.equal(k.json.kod, "anahtar_yok");
    assert.equal(fs.readdirSync(o2.uretim).filter(x => !x.startsWith("_")).length, sayi);
  } finally { await p2.kapat(); o2.temizle(); }
});

// ---------------------------------------------------------------- B004
test("PID yeniden kullanimi: kilit alakasiz bir programa gecmis — panel sahte 'yetim is' gostermez, isi engellemez, bayat kilidi siler, o programa DOKUNMAZ", async () => {
  const o2 = Y.geciciOrtam("pid");
  const alak = alakasizProgram();
  yaz(kok(o2, "is1", "konu.json"), { baslik_en: "x" });
  yaz(kok(o2, "is1", ".kilit"), { pid: alak.pid, baslangic: new Date().toISOString(), komut: "video-yap.js" });
  const p2 = await Y.panelBaslat(o2);
  try {
    const c2 = p2.istemci;
    assert.equal((await c2.get("/api/calisanlar")).json.calisanlar.some(x => x.is === "is1"), false, "yetim gosterilmemeli");
    assert.equal(fs.existsSync(kok(o2, "is1", ".kilit")), false, "bayat kilit silinmeli");
    const r = await c2.post("/api/calistir", { tur: "gorsel", is: "is1" });
    assert.equal(r.durum, 200, "is 409 ile engellenmemeli: " + r.metin);
    await c2.bekle(r.json.id, ["bitti", "hata", "durduruldu"]);
    const d = await c2.post("/api/durdur", { id: "y-is1" });
    assert.equal(d.json.ok, false, "durduracak yetim yok");
    await bekle(400);
    assert.equal(canliMi(alak.pid), true, "alakasiz program oldurulmemeli");
  } finally { await p2.kapat(); o2.temizle(); }
});

test("PID yeniden kullanimi (calistirici): yetim kaydi sonradan bayatlarsa Durdur o PID'in surec agacini OLDURMEZ, yalniz kilidi temizler; gercek yetim hala olur", async () => {
  const o2 = Y.geciciOrtam("pid2");
  const onceki = process.env.OTOMASYON_URETIM;
  process.env.OTOMASYON_URETIM = o2.uretim;
  const { calistiriciOlustur } = require("../lib/panel-calistir");
  const cal = calistiriciOlustur({ kok: Y.KOK, betikDizini: o2.betik });
  try {
    const alak = alakasizProgram();
    const gercek = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
    cocuklar.push(gercek);
    await bekle(600);
    yaz(kok(o2, "a1", "konu.json"), { baslik_en: "a" }); yaz(kok(o2, "a2", "konu.json"), { baslik_en: "b" });
    // a1: PID alakasiz programa gecmis; kayit "yetim" diye bellekte kalmis (tarama sonrasi PID devri)
    yaz(kok(o2, "a1", ".kilit"), { pid: alak.pid, baslangic: new Date().toISOString(), komut: "video-yap.js" });
    cal.yetimler.set("a1", { pid: alak.pid, komut: "video-yap.js", baslangic: new Date().toISOString() });
    assert.equal(cal.durdur("y-a1"), true);
    await bekle(1800);
    assert.equal(canliMi(alak.pid), true, "alakasiz program oldurulmemeli");
    assert.equal(fs.existsSync(kok(o2, "a1", ".kilit")), false, "bayat kilit silinmeli");
    assert.equal(cal.yetimler.has("a1"), false);
    // a2: gercek yetim (node) → olur
    yaz(kok(o2, "a2", ".kilit"), { pid: gercek.pid, baslangic: new Date().toISOString(), komut: "video-yap.js" });
    cal.yetimler.set("a2", { pid: gercek.pid, komut: "video-yap.js", baslangic: new Date().toISOString() });
    assert.equal(cal.durdur("y-a2"), true);
    await bekleKosul(() => !canliMi(gercek.pid), 8000, "gercek yetim olmeli");
  } finally {
    cal.kapat();
    if (onceki === undefined) delete process.env.OTOMASYON_URETIM; else process.env.OTOMASYON_URETIM = onceki;
    o2.temizle();
  }
});

// ---------------------------------------------------------------- B003: ikinci panel
test("port doluyken ikinci panel 98 ile cikar ve ilk panelin durum.json/_kuyruk.json dosyalarina DOKUNMAZ", async () => {
  const o2 = Y.geciciOrtam("ikinci");
  const p1 = await Y.panelBaslat(o2);
  try {
    // ilk panelin "adimlar arasi" calisan isi + acik kuyrugu: baslangic taramasi calisirsa 'panel_kapandi' diye bozulurdu
    const durum = kok(o2, "calisan", "durum.json"), kuyruk = kok(o2, "_kuyruk.json");
    yaz(kok(o2, "calisan", "konu.json"), { baslik_en: "x" });
    yaz(durum, { surum: 1, is: "calisan", guncelleme: "x", son: { tur: "hepsi", id: "r1", baslangic: "2026-01-01T00:00:00.000Z", bitis: null, durum: "calisiyor", kod: null, hata: null }, adimlar: [{ ad: "video", durum: "calisiyor" }] });
    yaz(kuyruk, { surum: 1, duraklatildi: false, ogeler: [{ id: "k1", is: "calisan", tur: "hepsi", eklendi: "x", durum: "calisiyor", hata: null, onaysiz: false }] });
    const once = [fs.readFileSync(durum, "utf8"), fs.readFileSync(kuyruk, "utf8")];
    const env = Object.assign({}, process.env, {
      OTOMASYON_URETIM: o2.uretim, OTOMASYON_ENV_DOSYASI: o2.env, OTOMASYON_AYAR_DOSYASI: o2.ayar, PANEL_PORT: String(p1.port),
      PANEL_BETIK_DIZINI: o2.betik, PANEL_ANAHTAR_TEST_KAPALI: "1",
    });
    const kod = await new Promise((coz, red) => {
      const p = spawn(process.execPath, [path.join(Y.KOK, "panel.js")], { cwd: Y.KOK, env, windowsHide: true, stdio: "ignore" });
      p.on("close", coz); p.on("error", red);
      setTimeout(() => { try { p.kill(); } catch (e) {} coz("zaman asimi"); }, 15000).unref();
    });
    assert.equal(kod, 98, "port dolu: cikis kodu 98");
    assert.deepEqual([fs.readFileSync(durum, "utf8"), fs.readFileSync(kuyruk, "utf8")], once, "ikinci panel ilk panelin dosyalarini bozmamali");
    assert.equal((await p1.istemci.get("/api/ozellikler")).durum, 200, "ilk panel ayakta");
  } finally { await p1.kapat(); o2.temizle(); }
});

// ---------------------------------------------------------------- B061
test("PANEL_HOST / PANEL_IZINLI_HOST artik etkisiz: panel yalniz 127.0.0.1'e baglanir, ek Host basligi 403, ag adresinden baglanti kurulamaz", async () => {
  const o2 = Y.geciciOrtam("host");
  const port = await Y.bosPort();
  const p2 = await Y.panelBaslat(o2, { port, env: { PANEL_HOST: "0.0.0.0", PANEL_IZINLI_HOST: "benim.pc:" + port + ",evil.example:" + port } });
  try {
    const durumu = host => new Promise((coz, red) => {
      const r = http.request({ host: "127.0.0.1", port, path: "/api/ozellikler", headers: { Host: host, "X-Panel-Token": p2.istemci.jeton } }, res => { res.resume(); coz(res.statusCode); });
      r.on("error", red); r.end();
    });
    assert.equal(await durumu("localhost:" + port), 200);
    assert.equal(await durumu("benim.pc:" + port), 403, "izinli listesi artik yok");
    assert.equal(await durumu("evil.example:" + port), 403);
    const dis = Object.values(os.networkInterfaces()).flat().find(a => a && a.family === "IPv4" && !a.internal);
    if (dis) {
      const baglandi = await new Promise(coz => {
        const s = net.connect({ host: dis.address, port });
        s.setTimeout(1500, () => { s.destroy(); coz(false); });
        s.on("connect", () => { s.destroy(); coz(true); }); s.on("error", () => coz(false));
      });
      assert.equal(baglandi, false, "ag arayuzunden (" + dis.address + ") panele baglanilamamali");
    }
  } finally { await p2.kapat(); o2.temizle(); }
});
