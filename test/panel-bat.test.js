// PANEL.bat yeniden baslatma dongusu (B003): panel her seferinde ilk dakikasinda cokerse 5. denemede birakir; normal kapanista
// (kod 0) ve port dolu kodunda (98) biter; 60 sn'den uzun yasayan calisma sayaci sifirlar. Yalniz Windows. Sahte panel: gercek panel baslamaz.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const WIN = process.platform === "win32";
const BAT = path.resolve(__dirname, "..", "PANEL.bat");

// Bat'in on kontrollerini (node, ffmpeg, paketler) gecirecek en kucuk sahte klasor + sahte panel
function sahteKlasor(esikSn) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "panel-bat-"));
  fs.mkdirSync(path.join(d, "lib"));
  for (const m of ["@anthropic-ai/sdk", "msedge-tts"]) {
    fs.mkdirSync(path.join(d, "node_modules", m), { recursive: true });
    fs.writeFileSync(path.join(d, "node_modules", m, "package.json"), JSON.stringify({ name: m, main: "i.js" }));
    fs.writeFileSync(path.join(d, "node_modules", m, "i.js"), "");
  }
  fs.writeFileSync(path.join(d, "ff-yol.js"), "process.exit(0)\n");
  fs.writeFileSync(path.join(d, "lib", "panel-tarayici-ac.js"), "");
  // KODLAR=1,1,0 → n. calismanin cikis kodu; BEKLE=0,0,3 → n. calismanin suresi (sn). Sayac sayac.txt'de
  fs.writeFileSync(path.join(d, "panel.js"), [
    'const fs=require("fs");let n=0;try{n=Number(fs.readFileSync("sayac.txt","utf8"))||0}catch(e){}',
    'fs.writeFileSync("sayac.txt",String(n+1));',
    'const k=(process.env.KODLAR||"1").split(",").map(Number), b=(process.env.BEKLE||"0").split(",").map(Number);',
    'setTimeout(()=>process.exit(k[Math.min(n,k.length-1)]),b[Math.min(n,b.length-1)]*1000);',
  ].join("\n"));
  let bat = fs.readFileSync(BAT, "latin1");
  if (esikSn !== undefined) bat = bat.replace("LSS 60", "LSS " + esikSn);       // 60 sn'lik sinir testte kisaltilir
  fs.writeFileSync(path.join(d, "PANEL.bat"), bat, "latin1");
  return d;
}
function calistir(d, kodlar, bekle) {
  try { fs.unlinkSync(path.join(d, "sayac.txt")); } catch (e) { /* ilk calisma */ }
  const r = spawnSync("cmd.exe", ["/c", ".\\PANEL.bat"], {
    cwd: d, env:Object.assign({}, process.env, { KODLAR: kodlar, BEKLE: bekle || "0", PANEL_PORT: "4173" }), encoding: "utf8", windowsHide: true, timeout: 90000, stdio: ["ignore", "pipe", "pipe"],
  });
  let sayac = 0; try { sayac = Number(fs.readFileSync(path.join(d, "sayac.txt"), "utf8")); } catch (e) { /* hic calismadi */ }
  return { cikis: r.status, sayac, cikti: String(r.stdout || "") + String(r.stderr || "") };
}

test("PANEL.bat dosyasi ASCII ve CRLF (eski Windows'larda goto/etiket bozulmasin)", () => {
  const b = fs.readFileSync(BAT);
  assert.ok(!b.some(x => x > 127), "ASCII olmali");
  let crlf = 0, lf = 0;
  for (let i = 0; i < b.length; i++) if (b[i] === 10) { if (b[i - 1] === 13) crlf++; else lf++; }
  assert.equal(lf, 0, "bos LF satir sonu olmamali"); assert.ok(crlf > 50);
});

test("PANEL.bat: panel her seferinde hemen coker → 5. denemede yeniden denemeyi birakir (sonsuz dongu yok), cikis 1", { skip: !WIN && "yalniz Windows" }, () => {
  const d = sahteKlasor();
  try {
    const r = calistir(d, "1");
    assert.equal(r.sayac, 5, r.cikti);
    assert.equal(r.cikis, 1);
    assert.match(r.cikti, /art arda 5 kez/); assert.match(r.cikti, /uretim\\_log\\panel-\*\.log/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("PANEL.bat: gecici cokme sonrasi toparlanir (1,1,0 → 3 calisma), normal kapanista (0) ve port dolu kodunda (98) biter", { skip: !WIN && "yalniz Windows" }, () => {
  const d = sahteKlasor();
  try {
    const a = calistir(d, "1,1,0");
    assert.equal(a.sayac, 3, a.cikti); assert.equal(a.cikis, 0); assert.match(a.cikti, /Panel kapatildi/);
    const b = calistir(d, "98");
    assert.equal(b.sayac, 1, b.cikti); assert.equal(b.cikis, 0); assert.match(b.cikti, /zaten acik/);
    const k = calistir(d, "0");
    assert.equal(k.sayac, 1); assert.equal(k.cikis, 0);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("PANEL.bat: esikten uzun yasayan calisma cokme sayacini sifirlar (uzun calisip cokenler 'ilk dakikada coktu' sayilmaz)", { skip: !WIN && "yalniz Windows" }, () => {
  const d = sahteKlasor(2);                                   // esik 2 sn: 5. calisma 3 sn yasar → sayac 1'e doner, 7 calismada biter
  try {
    const r = calistir(d, "1,1,1,1,1,1,0", "0,0,0,0,3,0,0");
    assert.equal(r.sayac, 7, r.cikti); assert.equal(r.cikis, 0);
    assert.doesNotMatch(r.cikti, /art arda/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
