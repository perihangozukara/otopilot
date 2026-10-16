// BIRIM TESTLERI — formul-kart.js ve prompt-kart.js (komut satiri, gercek ffmpeg, sentetik zemin; ag ve ucret yok).
// Bulgu karsiliklari: B019 (tanimsiz OUT -> ReferenceError, zincirin seslendirmeye ulasamamasi), B044/B069 (ozel karakter, yol kacisi).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const B = require("./birim-yardim");

const ortam = B.ortamKur("kart");
test.after(() => ortam.temizle());

let FF = null, FP = null;
try { const f = require("../ff-yol"); FF = f.ffmpeg; FP = f.ffprobe; } catch (e) { /* ffmpeg yok */ }
const skip = FF ? false : "ffmpeg kurulu degil";

const FK = require("../formul-kart");
const PK = require("../prompt-kart");

function isKur(ad, konu) {
  const d = path.join(ortam.uretim, ad);
  fs.mkdirSync(path.join(d, "Voice"), { recursive: true });
  fs.writeFileSync(path.join(d, "konu.json"), JSON.stringify(konu, null, 2));
  return d;
}
function betik(ad, args) {
  const env = Object.assign({}, process.env, { OTOMASYON_URETIM: ortam.uretim, OTOMASYON_ENV_DOSYASI: ortam.env, OTOMASYON_AYAR_DOSYASI: ortam.ayar });
  const r = spawnSync(process.execPath, [path.join(B.KOK, ad), ...args], { env, encoding: "utf8", timeout: 120000, windowsHide: true });
  return { kod: r.status, out: r.stdout, err: r.stderr };
}
const boyut = dosya => {
  const r = spawnSync(FP, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", dosya], { encoding: "utf8", windowsHide: true });
  const [w, h] = r.stdout.trim().split(",").map(Number);
  return { w, h };
};

test("formulFiltresi (saf): metin filtre dizgisine girmez, ozel karakter sorun cikarmaz; cok uzun formul kucultulur/satirlanir", () => {
  const f = FK.formulFiltresi({ ust: "Bob's: 100% Facts \\", ana: "E = mc²", alt: "Einstein, 1905" }, 0, "0x6FD8FF", path.join(ortam.kok, "kf"));
  assert.match(f, /drawtext=fontfile='/);
  assert.match(f, /textfile='/);
  assert.match(f, /expansion=none/);
  assert.ok(!f.includes("Bob") && !f.includes("mc²"), "metin dizgiye girmemeli");
  assert.match(f, /drawbox=/);
  const uzun = FK.formulFiltresi({ ana: "∮ E·dA = Q/ε₀ ve ∇×B = μ₀J + μ₀ε₀ ∂E/∂t Maxwell denklemleri bir arada yazilinca tek satira asla sigmaz" }, 1, "0x6FD8FF", path.join(ortam.kok, "kf"));
  assert.ok((uzun.match(/drawtext=/g) || []).length >= 2, "sigmayan formul satirlanmali");
  assert.throws(() => FK.formulFiltresi({ ust: "x".repeat(500) }, 0, "0x6FD8FF", path.join(ortam.kok, "kf")), e => e.cikis === 2);
});

test("prompt-kart yerlestir (saf): satir sarma ve punto kucultme", () => {
  const k = PK.yerlestir(["$ git commit -m 'fix: 100% done'", "# yorum", "> cikti " + "uzun ".repeat(60)]);
  assert.ok(k.satirlar.length > 3, "uzun satir sarilmali");
  assert.ok(k.satirlar.every(s => Array.from(s.metin).length <= Math.floor(1548 / (k.punto * 0.6)) + 2));
  assert.equal(PK.yerlestir(Array.from({ length: 60 }, (_, i) => "satir " + i)).kesildi, true);
});

test("formul-kart.js CLI: tanimsiz OUT degiskeni yok (ReferenceError yok), cikis 0, kartlar uretildi, .part/_tmp/kilit artigi yok", { skip }, () => {
  const d = isKur("kartlar1", { baslik_en: "F", _not: "k", format: "long", vurguRenk: "FFAA00", formuller: [
    { n: "e-mc2", ust: "Bob's: 100% Facts \\ test", ana: "E = mc²", alt: "Einstein, 1905", hedef: "001-einstein" },
    { n: "uzun", ust: "Çok uzun", ana: "∮ E·dA = Q/ε₀ ve ∇×B = μ₀J + μ₀ε₀ ∂E/∂t Maxwell denklemleri", alt: "x" },
  ] });
  const r = betik("formul-kart.js", ["kartlar1"]);
  assert.equal(r.kod, 0, r.err);
  assert.doesNotMatch(r.err + r.out, /ReferenceError|OUT is not defined/);
  assert.match(r.out, /2 formül kartı üretildi/);
  const a = path.join(d, "Visuals", "001-einstein", "90-formul-e-mc2.jpg"), b = path.join(d, "Visuals", "14-formuller", "90-formul-uzun.jpg");
  for (const f of [a, b]) { assert.ok(fs.statSync(f).size > 5000, f); assert.deepEqual(boyut(f), { w: 1920, h: 1080 }); }
  assert.ok(!fs.existsSync(path.join(d, "_tmp")), "gecici metin dosyalari silinmeli");
  assert.ok(!fs.existsSync(path.join(d, ".kilit")), "kilit birakilmali");
  assert.deepEqual(fs.readdirSync(path.join(d, "Visuals", "001-einstein")).filter(x => /\.part\./.test(x)), []);
  // @@ protokolu
  assert.match(r.out, /@@SONUC \{"kart":2\}/);
});

test("formul-kart.js / prompt-kart.js: formuller/promptlar yoksa cikis 0 ve kart 0; zemin gorseli yoksa duz koyu zemin", { skip }, () => {
  isKur("kartlar2", { baslik_en: "F", _not: "k", format: "long" });
  for (const betikAdi of ["formul-kart.js", "prompt-kart.js"]) {
    const r = betik(betikAdi, ["kartlar2"]);
    assert.equal(r.kod, 0, r.err);
    assert.match(r.out, /@@SONUC \{"kart":0\}/);
  }
  const d = isKur("kartlar3", { baslik_en: "P", _not: "k", format: "long", promptlar: [{ baslik: "claude: 'terminal' 100%", satirlar: ["$ ls", "> tamam"], alt: "alt: 50%" }] });
  const r = betik("prompt-kart.js", ["kartlar3"]);
  assert.equal(r.kod, 0, r.err);
  assert.ok(fs.existsSync(path.join(d, "Visuals", "90-promptlar", "95-prompt-01.jpg")));
});

test("kart betikleri: konu.json'daki yol bilesenleri ('..', egik cizgi, nokta) dogrulanir; disariya hicbir dosya yazilmaz; cikis 2", { skip }, () => {
  for (const [ad, konu, betikAdi] of [
    ["kartkacis1", { baslik_en: "F", _not: "k", format: "long", formuller: [{ n: "a", ana: "x", hedef: "../../disari" }] }, "formul-kart.js"],
    ["kartkacis2", { baslik_en: "F", _not: "k", format: "long", formuller: [{ n: "..", ana: "x" }] }, "formul-kart.js"],
    ["kartkacis3", { baslik_en: "P", _not: "k", format: "long", promptlar: [{ baslik: "b", satirlar: ["x"], hedef: "a/b" }] }, "prompt-kart.js"],
    ["kartkacis4", { baslik_en: "P", _not: "k", format: "long", promptlar: [{ baslik: "b", satirlar: ["x"], hedef: "a\\b" }] }, "prompt-kart.js"],
  ]) {
    isKur(ad, konu);
    const r = betik(betikAdi, [ad]);
    assert.equal(r.kod, 2, ad + ": " + r.err);
    assert.match(r.err, /✗ /);
    assert.doesNotMatch(r.err, /\n\s+at\s/);
  }
  assert.equal(fs.existsSync(path.join(ortam.kok, "disari")), false);
  assert.equal(fs.existsSync(path.join(ortam.uretim, "disari")), false);
  // bozuk konu.json: sessizce varsayilana dusmez, cikis 2 ve satir bilgisi
  const d = isKur("kartbozuk", { baslik_en: "F" });
  fs.writeFileSync(path.join(d, "konu.json"), '{"formuller": [,]}');
  const r = betik("formul-kart.js", ["kartbozuk"]);
  assert.equal(r.kod, 2);
  assert.match(r.err, /konu\.json bozuk/);
});
