// lib/ortak.js — kilit sahibi dogrulamasi (B004): elektrik kesintisi / cokme sonrasi .kilit'teki PID baska bir programa gecmis olabilir.
// "PID canli" tek basina yetmez: bilgisayar acilisi, program adi (node) ve surec baslangici kontrol edilir.
// Gercek surecler kullanilir (node uyuyan surec = gercek sahip; ping/sleep = PID'i alan alakasiz program). Ag/ucretli servis yok.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const ortak = require("../lib/ortak");

const bekle = ms => new Promise(r => setTimeout(r, ms));
const cocuklar = [];
function uyuyanNode() { const c = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { stdio: "ignore", windowsHide: true }); cocuklar.push(c); return c; }
// node OLMAYAN canli bir program: PID'i yeniden kullanan "alakasiz uygulama"yi temsil eder
function alakasizProgram() {
  const c = process.platform === "win32" ? spawn("ping", ["-n", "60", "127.0.0.1"], { stdio: "ignore", windowsHide: true }) : spawn("sleep", ["60"], { stdio: "ignore" });
  cocuklar.push(c); return c;
}
const canliMi = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
test.after(() => { for (const c of cocuklar) { try { c.kill(); } catch (e) { /* zaten bitmis */ } } });

test("kilitSahibiCanliMi: gercek sahip (node, kilitten once dogmus) canli; olu pid, kendi pid ve bozuk kayit durumlari", async () => {
  const c = uyuyanNode();
  await bekle(700);                                                  // surec kilitten ONCE baslamis olmali
  assert.equal(ortak.kilitSahibiCanliMi({ pid: c.pid, baslangic: new Date().toISOString(), komut: "video-yap.js" }), true);
  assert.equal(ortak.kilitSahibiCanliMi({ pid: c.pid, baslangic: "x" }), true, "zaman okunamazsa yalniz ad/varlik bakilir");
  assert.equal(ortak.kilitSahibiCanliMi({ pid: 2147480000, baslangic: new Date().toISOString() }), false, "olu pid");
  assert.equal(ortak.kilitSahibiCanliMi({ pid: process.pid, baslangic: new Date().toISOString() }), true, "kendi pid");
  assert.equal(ortak.kilitSahibiCanliMi(null), false);
  assert.equal(ortak.kilitSahibiCanliMi({ pid: "abc" }), false);
});

test("kilitSahibiCanliMi: PID node olmayan bir programa gecmisse bayat (alakasiz programin 'yetim is' sanilmasi/oldurulmesi engellenir)", () => {
  const p = alakasizProgram();
  assert.equal(canliMi(p.pid), true);
  assert.equal(ortak.kilitSahibiCanliMi({ pid: p.pid, baslangic: new Date().toISOString(), komut: "video-yap.js" }), false);
});

test("kilitSahibiCanliMi: kilit bilgisayar acilmadan ONCE yazildiysa bayat (cold boot sonrasi PID yeniden kullanimi)", () => {
  const c = uyuyanNode();
  const acilistanOnce = new Date(Date.now() - (os.uptime() + 3 * 3600) * 1000).toISOString();
  assert.equal(ortak.kilitSahibiCanliMi({ pid: c.pid, baslangic: acilistanOnce }), false);
});

test("kilitSahibiCanliMi: surec kilitten SONRA baslamissa baska surectir (ayni PID, baska node)", async () => {
  const c = uyuyanNode();
  await bekle(700);
  const dahaEski = new Date(Date.now() - 120000).toISOString();      // kilit 2 dk once yazilmis ama bu surec 1 sn once dogdu
  assert.equal(ortak.kilitSahibiCanliMi({ pid: c.pid, baslangic: dahaEski }), false);
});

test("surecBilgisi: node icin ad+baslangic, olu pid icin var:false", async () => {
  const c = uyuyanNode();
  await bekle(500);
  const b = ortak.surecBilgisi(c.pid, true);
  assert.equal(b.var, true); assert.match(b.ad, /^node(js)?$/);
  assert.ok(b.baslangicMs === null || Math.abs(b.baslangicMs - Date.now()) < 120000, "baslangic makul");
  assert.equal(ortak.surecBilgisi(2147480000, false).var, false);
  assert.equal(ortak.surecBilgisi(0, false).var, false);
});

test("kilitAl: PID alakasiz bir programa gecmis bayat kilit alinabilir; gercek canli sahip hala exit 6", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ortak-kilit-"));
  const once = process.env.OTOMASYON_URETIM;
  process.env.OTOMASYON_URETIM = d;
  try {
    fs.mkdirSync(path.join(d, "is1"), { recursive: true });
    const kilit = path.join(d, "is1", ".kilit");
    const p = alakasizProgram();
    fs.writeFileSync(kilit, JSON.stringify({ pid: p.pid, baslangic: new Date().toISOString(), komut: "video-yap.js" }));
    ortak.kilitAl("is1", "test");                                    // bayat sayilir, hata atmaz
    assert.equal(JSON.parse(fs.readFileSync(kilit, "utf8")).pid, process.pid);
    ortak.kilitBirak("is1");
    // gercek sahip
    const c = uyuyanNode();
    await bekle(700);
    fs.writeFileSync(kilit, JSON.stringify({ pid: c.pid, baslangic: new Date().toISOString(), komut: "baska" }));
    assert.throws(() => ortak.kilitAl("is1", "test"), e => e.kod === "kilit" && e.cikis === 6);
    c.kill();
  } finally {
    if (once === undefined) delete process.env.OTOMASYON_URETIM; else process.env.OTOMASYON_URETIM = once;
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* gecici */ }
  }
});
