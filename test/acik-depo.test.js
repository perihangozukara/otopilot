// HERKESE ACIK DEPO HIJYENI
// Depo herkese acik olabilecegi icin yabanci biri baktiginda sunlar gorunmemeli: yonlendirme/referans (affiliate) linki,
// kisisel hesap ve e-posta, yazara ozel yerel klasor/kullanici adi, ucuncu taraf veri dokumu, gercek bicimli sir.
// Taranan kume: izlenen + .gitignore'a takilmayan yeni dosyalar (git yoksa klasor gezilir; yerel .env/uretim gibi
// yok sayilan dosyalar HIC taranmaz). Desenler parcalardan kurulur: bu dosyanin kendisi de eslesmez.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const KOK = path.join(__dirname, "..");
const BU = path.relative(KOK, __filename).split(path.sep).join("/");
const IKILI = new Set([".woff", ".woff2", ".ttf", ".otf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp3", ".mp4", ".wav", ".pdf", ".zip"]);
const GEZME_DISI = new Set(["node_modules", ".git", "uretim", "onizleme", "data", "indirilenler", "log", "trend"]);

function dosyalar() {
  try {
    const r = cp.spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: KOK, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status === 0 && r.stdout) return r.stdout.split("\0").filter(Boolean);
  } catch (e) { /* git yok */ }
  const cikti = [];
  (function gez(d) {
    for (const e of fs.readdirSync(path.join(KOK, d), { withFileTypes: true })) {
      if (GEZME_DISI.has(e.name) || /^\.env/.test(e.name) || /^panel-ayar\.json/.test(e.name)) continue;
      const g = d ? d + "/" + e.name : e.name;
      if (e.isDirectory()) gez(g); else cikti.push(g);
    }
  })("");
  return cikti;
}
function metinDosyalari() {
  const liste = [];
  for (const f of dosyalar()) {
    if (f === BU || IKILI.has(path.extname(f).toLowerCase())) continue;
    const yol = path.join(KOK, f);
    let tampon; try { tampon = fs.readFileSync(yol); } catch (e) { continue; }       // silinmis ama izlenen dosya
    if (tampon.subarray(0, 4000).includes(0)) continue;                                // ikili
    liste.push({ f, metin: tampon.toString("utf8") });
  }
  return liste;
}
function tara(desen) {
  const bulunan = [];
  for (const { f, metin } of metinDosyalari()) {
    metin.split(/\r?\n/).forEach((satir, i) => { if (desen.test(satir)) bulunan.push(f + ":" + (i + 1) + ": " + satir.trim().slice(0, 100)); });
  }
  return bulunan;
}
const rx = (parcalar, bayrak) => new RegExp(parcalar.join(""), bayrak === undefined ? "i" : bayrak);

test("tarayici kendini sinar: bilinen kotu ornekleri yakalar, iyi ornekleri yakalamaz", () => {
  const referans = rx(["https?:\\/\\/(www\\.)?vidiq\\.com\\/[a-z0-9_-]"]);
  assert.ok(referans.test("link: https://www.vidiq.com/birisi"));
  assert.ok(referans.test("https://vidiq.com/x"));
  assert.ok(!referans.test("app.vidiq.com/account/settings/mcp"), "anahtar yardim metni yonlendirme degildir");
  const yol = rx(["[A-Za-z]:\\\\{1,2}Users\\\\{1,2}(?!ornek|kullanici|user|name|x\\b|<|%|\\*|\\$|\\.)[A-Za-z0-9._-]+"]);
  assert.ok(yol.test("C:\\Users\\Birisi\\dosya"), "tek ters egik cizgili yol");
  assert.ok(yol.test("C:\\\\Users\\\\Birisi\\\\dosya"), "kacisli (kaynak kodundaki) yol");
  assert.ok(!yol.test("C:\\\\Users\\\\ornek\\\\dosya"), "noter ornek ad serbest");
  assert.ok(rx(["aff", "iliate"]).test("Affiliate linki"));
});

test("depoda yonlendirme/referans (affiliate) linki yok; vidIQ yalniz 'anahtari nereden alirim' yardim metni olarak gecer", () => {
  assert.deepEqual(tara(rx(["aff", "iliate"])), []);
  assert.deepEqual(tara(rx(["https?:\\/\\/(www\\.)?vidiq\\.com\\/[a-z0-9_-]"])), [], "vidiq.com/<kisi> bicimli yonlendirme linki");
});

test("depoda kisisel hesap/e-posta ve yazara ozel yerel klasor adi yok", () => {
  const izler = ["money" + "print", "tuhaf" + "vegarip", "efe" + "cim", "cyber" + "power", "siderev" + "enues", "pinar" + "tanriver"];
  assert.deepEqual(tara(rx(["(", izler.join("|"), ")"])), []);
  assert.deepEqual(tara(rx(["[\\w.+-]+@(gmail|hotmail|outlook|yahoo|icloud|proton)\\.(com|me)"])), []);
});

test("depoda gercek yerel kullanici yolu yok (ornek yollar 'ornek'/'kullanici' gibi notr adlar kullanir)", () => {
  const yol = rx(["[A-Za-z]:\\\\{1,2}Users\\\\{1,2}(?!ornek|kullanici|user|name|x\\b|<|%|\\*|\\$|\\.)[A-Za-z0-9._-]+"]);
  assert.deepEqual(tara(yol), []);
});

test("vidIQ'dan alinmis ucuncu taraf veri dokumu depoda degil (kesfet-veri.json .gitignore'da)", () => {
  const gi = fs.readFileSync(path.join(KOK, ".gitignore"), "utf8");
  assert.match(gi, /^video-indirici\/kesfet-veri\.json\s*$/m);
  assert.ok(!dosyalar().includes("video-indirici/kesfet-veri.json"), "izlenen ya da yok sayilmayan kesfet-veri.json var");
});

test("kokte MIT LICENSE var ve README ona baglanir", () => {
  const lisans = fs.readFileSync(path.join(KOK, "LICENSE"), "utf8");
  assert.match(lisans, /^MIT License/);
  assert.match(lisans, /Copyright \(c\) 20\d\d \S+/);
  assert.match(fs.readFileSync(path.join(KOK, "README.md"), "utf8"), /\(LICENSE\)/);
});
