// test/ses-edge-gercek.test.js — GERCEK msedge-tts + yerel ws sahte sunucu: zaman asimi iptali sonrasi gelen
// gec kareler sureci cokertmemeli (B033 regresyonu). Microsoft'a ag cagrisi YOK (yalniz 127.0.0.1).
// Senaryo ayri surecte (ses-edge-gercek-cocuk.js) kosar: kutuphane hatasi yakalanamaz, surec olur.
"use strict";
const path = require("path");
const { spawnSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const kurulu = (() => {
  try { require.resolve("ws"); require.resolve("msedge-tts"); return true; } catch (e) { return false; }
})();
const testK = (ad, fn) => (kurulu ? test(ad, fn) : test(ad, { skip: "ws / msedge-tts kurulu degil" }, fn));

const COCUK = path.join(__dirname, "ses-edge-gercek-cocuk.js");
const calistir = (gecikmeMs, zamanAsimiMs) => spawnSync(process.execPath, [COCUK, String(gecikmeMs), String(zamanAsimiMs)],
  { encoding: "utf8", timeout: 60000, env: Object.assign({}, process.env, { OTOMASYON_ENV_DOSYASI: path.join(__dirname, "yok.env") }) });

testK("gercek kutuphane: zaman asimindan sonra sunucu gec kare yollarsa surec CALISMAYA DEVAM EDER, ayni motor yeni baglantiyla calisir", () => {
  const r = calistir(1200, 400);
  assert.equal(r.status, 0, "cokme: " + r.stderr);
  assert.match(r.stdout, /TAMAM/);
  assert.doesNotMatch(r.stderr, /Cannot read properties of undefined/);
});

testK("gercek kutuphane: iptal baglanti kurulurken / istek yollanirken de cokertmez", () => {
  for (const zamanAsimi of [1, 20, 120]) {
    const r = calistir(300, zamanAsimi);
    assert.equal(r.status, 0, "zaman asimi " + zamanAsimi + " ms: " + r.stderr);
    assert.match(r.stdout, /TAMAM/);
  }
});
