// test/ses-koruma.test.js — lib/ses-koruma.js: betik girislerinin surec duzeyi korumasi.
// Yakalanmamis hata davranisi ayri surecte denenir (testin kendi surecine handler kurulmaz).
"use strict";
const path = require("path");
const { spawnSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../lib/ses-koruma.js");

const KORUMA = path.join(__dirname, "..", "lib", "ses-koruma.js");
const BASLANGIC = "require(%YOL%).kur();\n".replace("%YOL%", JSON.stringify(KORUMA));      // cocuk surecte korumayi kurar
const calistir = kod => spawnSync(process.execPath, ["-e", BASLANGIC + kod],
  { encoding: "utf8", timeout: 30000, env: Object.assign({}, process.env, { OTOMASYON_ENV_DOSYASI: path.join(__dirname, "yok.env") }) });

const KUTUPHANE_HATASI = `
  const e = new TypeError("Cannot read properties of undefined (reading 'metadata')");
  e.stack = "TypeError: " + e.message + "\\n    at MsEdgeTTS._pushMetadata (C:\\\\x\\\\node_modules\\\\msedge-tts\\\\dist\\\\MsEdgeTTS.js:277:34)";`;

test("gecKareHatasi: yalniz msedge-tts yiginli 'undefined okuma' TypeError'u", () => {
  const e = new TypeError("Cannot read properties of undefined (reading 'turnEnded')");
  e.stack = "TypeError: x\n    at MsEdgeTTS.onmessage (C:\\a\\node_modules\\msedge-tts\\dist\\MsEdgeTTS.js:165:50)";
  assert.equal(K.gecKareHatasi(e), true);
  e.stack = "TypeError: x\n    at ben (C:\\a\\baska-yer.js:1:1)";
  assert.equal(K.gecKareHatasi(e), false, "kutuphane disi TypeError yutulmaz");
  assert.equal(K.gecKareHatasi(new Error("Cannot read properties of undefined")), false, "TypeError degil");
  assert.equal(K.gecKareHatasi("metin"), false);
  assert.equal(K.gecKareHatasi(null), false);
});

test("bilinen kutuphane gec-kare hatasi yok sayilir (@@UYARI) ve surec devam eder", () => {
  const r = calistir(KUTUPHANE_HATASI + `
    setTimeout(() => { throw e; }, 10);
    setTimeout(() => { console.log("DEVAM"); process.exit(0); }, 300);`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /@@UYARI Edge, iptal edilmiş bir isteğe geç yanıt gönderdi/);
  assert.match(r.stdout, /DEVAM/);
});

test("baska yakalanmamis hata: Turkce tek satir + @@HATA, exit 1 (ham 'Uncaught' dokumu yok)", () => {
  const r = calistir(`setTimeout(() => { throw new Error("rastgele iç hata"); }, 10); setTimeout(() => {}, 5000);`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /@@HATA \{"kod":"genel"/);
  assert.match(r.stderr, /✗ rastgele iç hata/);
  assert.doesNotMatch(r.stderr, /Node\.js v\d/, "node'un kendi coken-surec dokumu yazilmamali");
});

test("yakalanmamis soz reddi (metin ve Error) de ortak.bitir'e gider", () => {
  const a = calistir(`Promise.reject("ham metin"); setTimeout(() => {}, 5000);`);
  assert.equal(a.status, 1);
  assert.match(a.stderr, /✗ ham metin/);
  const b = calistir(`Promise.reject(Object.assign(new Error("ag koptu"), { code: "ECONNRESET" })); setTimeout(() => {}, 5000);`);
  assert.equal(b.status, 3, "ag hatasi dis servis cikis kodu (3)");
});

test("kur() iki kez cagrilirsa handler tekrarlanmaz", () => {
  const once = process.listenerCount("uncaughtException");
  K.kur(); K.kur();
  assert.equal(process.listenerCount("uncaughtException"), once + 1);
  process.removeListener("uncaughtException", K.isle);      // test sureci temiz kalsin
  process.removeListener("unhandledRejection", K.isle);
});
