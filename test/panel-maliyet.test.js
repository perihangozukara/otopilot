// lib/panel-maliyet.js onkontrol — altyazi cevirisi (altyaziDili != dil) zincirde Claude anahtari ister ve maliyete girer (B085).
// Betigin kendi atlama kararinin aynisi: ceviri dosyasi guncelse anahtar aranmaz. Ag/ucretli servis yok; anahtarlar enjekte edilir.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ortak = require("../lib/ortak");
const maliyet = require("../lib/panel-maliyet");

const d = fs.mkdtempSync(path.join(os.tmpdir(), "panel-maliyet-"));
const onceki = ["OTOMASYON_URETIM", "OTOMASYON_AYAR_DOSYASI", "OTOMASYON_ENV_DOSYASI"].map(k => [k, process.env[k]]);
process.env.OTOMASYON_URETIM = path.join(d, "uretim");
process.env.OTOMASYON_AYAR_DOSYASI = path.join(d, "panel-ayar.json");
process.env.OTOMASYON_ENV_DOSYASI = path.join(d, ".env");
fs.mkdirSync(process.env.OTOMASYON_URETIM, { recursive: true });
fs.writeFileSync(process.env.OTOMASYON_ENV_DOSYASI, "");
test.after(() => {
  for (const [k, v] of onceki) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* gecici */ }
});

const SADECE_VIDIQ = ad => ad === "VIDIQ_KEY";
const CLAUDE_VAR = ad => ad === "ANTHROPIC_API_KEY";
const HICBIRI = () => false;
const ceviriSorunu = r => r.sorunlar.filter(s => s.kod === "anahtar_yok" && /çeviri/i.test(s.mesaj));

const SENARYO = "Birinci paragraf yeterince uzun bir cumleden olusuyor ve bitiyor.\n\nIkinci paragraf da bir baska uzun cumleden olusuyor ve bitiyor.\n";
function isKur(ad, konu, dosyalar) {
  const b = path.join(ortak.uretimDizini(), ad);
  fs.mkdirSync(path.join(b, "Voice"), { recursive: true });
  fs.writeFileSync(path.join(b, "konu.json"), JSON.stringify(Object.assign({ baslik_en: ad }, konu)));
  for (const [rel, icerik] of Object.entries(dosyalar || {})) fs.writeFileSync(path.join(b, "Voice", rel), icerik);
  return b;
}

test("yeni is: dil en + altyaziDili tr + yalniz vidIQ anahtari → 'Claude anahtari gerekir' hatasi (senaryo uretilip onaylandiktan SONRA dusmesin)", () => {
  const r = maliyet.onkontrol({ tur: "hepsi", is: null, b: { dil: "en", altyaziDili: "tr" }, anahtarVar: SADECE_VIDIQ });
  const s = ceviriSorunu(r);
  assert.equal(s.length, 1, JSON.stringify(r.sorunlar));
  assert.equal(s[0].seviye, "hata"); assert.match(s[0].cozum, /Claude anahtar|altyazı dilini/);
  assert.equal(r.ok, false);
});

test("yeni is: Claude anahtari varsa hata yok; ceviri ucretli adimlarda listelenir ve tahmini maliyete eklenir", () => {
  const ayar = ortak.ayarOku();
  const bir = maliyet.onkontrol({ tur: "hepsi", is: null, b: { dil: "en", altyaziDili: "en" }, anahtarVar: CLAUDE_VAR });
  const iki = maliyet.onkontrol({ tur: "hepsi", is: null, b: { dil: "en", altyaziDili: "tr" }, anahtarVar: CLAUDE_VAR });
  assert.equal(ceviriSorunu(iki).length, 0);
  assert.ok(iki.ucretliAdimlar.some(a => a.ad === "ceviri" && a.saglayici === "Claude"), JSON.stringify(iki.ucretliAdimlar));
  assert.ok(!bir.ucretliAdimlar.some(a => a.ad === "ceviri"));
  const t = maliyet.tahmin(900, "en", ayar);
  assert.equal(iki.maliyetTahmin.usd, Math.round((t.usd + t.ceviriUSD) * 100) / 100);
  assert.equal(bir.maliyetTahmin.usd, Math.round(t.usd * 100) / 100);
  assert.ok(iki.maliyetTahmin.usd > bir.maliyetTahmin.usd);
});

test("yeni is: altyaziDili verilmemis ya da dille ayni → ceviri yok (varsayilan altyazi dili = dil); bozuk govde patlatmaz", () => {
  assert.equal(ceviriSorunu(maliyet.onkontrol({ tur: "hepsi", is: null, b: { dil: "tr" }, anahtarVar: SADECE_VIDIQ })).length, 0);
  assert.equal(ceviriSorunu(maliyet.onkontrol({ tur: "hepsi", is: null, anahtarVar: SADECE_VIDIQ })).length, 0);
  for (const b of [null, "x", 5, [], { dil: { toString: "x" }, altyaziDili: 5 }])
    assert.doesNotThrow(() => maliyet.onkontrol({ tur: "hepsi", is: null, b, anahtarVar: SADECE_VIDIQ }), JSON.stringify(b));
});

test("var olan is: ceviri dosyasi YOKSA anahtar ister; senaryodan yeni + ayni paragraf sayisindaysa istemez; eskiyse ya da sayi farkliysa yine ister", () => {
  const b = isKur("cev1", { dil: "en", altyaziDili: "tr" }, { "SESLENDIRME-TAM-METIN.txt": SENARYO });
  assert.equal(ceviriSorunu(maliyet.onkontrol({ tur: "hepsi", is: "cev1", anahtarVar: HICBIRI })).length, 1, "ceviri dosyasi yok");
  const hedef = path.join(b, "Voice", "ALTYAZI-TR.txt");
  fs.writeFileSync(hedef, "Birinci.\n\nIkinci.\n");
  const kaynak = path.join(b, "Voice", "SESLENDIRME-TAM-METIN.txt");
  const simdi = Date.now() / 1000;
  fs.utimesSync(kaynak, simdi - 100, simdi - 100); fs.utimesSync(hedef, simdi - 10, simdi - 10);
  const guncel = maliyet.onkontrol({ tur: "hepsi", is: "cev1", anahtarVar: HICBIRI });
  assert.equal(ceviriSorunu(guncel).length, 0, "ceviri guncel: altyazi-cevir.js zaten atlar, anahtar aranmaz");
  assert.ok(!guncel.ucretliAdimlar.some(a => a.ad === "ceviri"));
  fs.utimesSync(hedef, simdi - 200, simdi - 200);                                   // senaryodan ESKI
  assert.equal(ceviriSorunu(maliyet.onkontrol({ tur: "hepsi", is: "cev1", anahtarVar: HICBIRI })).length, 1, "eski ceviri");
  fs.utimesSync(hedef, simdi - 10, simdi - 10);
  fs.writeFileSync(hedef, "Tek paragraf.\n"); fs.utimesSync(hedef, simdi - 10, simdi - 10);
  assert.equal(ceviriSorunu(maliyet.onkontrol({ tur: "hepsi", is: "cev1", anahtarVar: HICBIRI })).length, 1, "paragraf sayisi tutmuyor");
});

test("var olan is: senaryo bu kosuda YAZILACAKSA eski ceviri bayat kalir → ceviri kesin gerekir", () => {
  const b = isKur("cev2", { dil: "en", altyaziDili: "tr" }, { "SESLENDIRME-TAM-METIN.txt": "", "ALTYAZI-TR.txt": "Birinci.\n\nIkinci.\n" });
  const r = maliyet.onkontrol({ tur: "hepsi", is: "cev2", anahtarVar: SADECE_VIDIQ });
  assert.equal(ceviriSorunu(r).length, 1, JSON.stringify(r.sorunlar));
  assert.ok(fs.existsSync(path.join(b, "Voice", "ALTYAZI-TR.txt")));
});

test("tek 'ceviri' islemi: diller ayniysa anahtar gerekmez (betik atlar), farkliysa gerekir", () => {
  isKur("cev3", { dil: "en", altyaziDili: "en" }, { "SESLENDIRME-TAM-METIN.txt": SENARYO });
  const ayni = maliyet.onkontrol({ tur: "ceviri", is: "cev3", anahtarVar: HICBIRI });
  assert.equal(ceviriSorunu(ayni).length, 0);
  assert.equal(ayni.ok, true, JSON.stringify(ayni.sorunlar));
  isKur("cev4", { dil: "en", altyaziDili: "es" }, { "SESLENDIRME-TAM-METIN.txt": SENARYO });
  assert.equal(ceviriSorunu(maliyet.onkontrol({ tur: "ceviri", is: "cev4", anahtarVar: HICBIRI })).length, 1);
  assert.equal(ceviriSorunu(maliyet.onkontrol({ tur: "ceviri", is: "cev4", anahtarVar: CLAUDE_VAR })).length, 0);
});

test("toplu ekleme: girdiler listesinde ceviri gerektiren is sayilir; Claude yoksa hata, varsa maliyet = senaryolar + sadece o cevirisi", () => {
  const girdiler = [{ baslik: "a", dil: "en", altyaziDili: "tr" }, { baslik: "b", dil: "en" }, { baslik: "c", dil: "tr", altyaziDili: "en" }];
  const yok = maliyet.onkontrol({ tur: "hepsi", is: null, adet: 3, girdiler, anahtarVar: SADECE_VIDIQ });
  assert.equal(ceviriSorunu(yok).length, 1);
  const var_ = maliyet.onkontrol({ tur: "hepsi", is: null, adet: 3, girdiler, anahtarVar: CLAUDE_VAR });
  assert.equal(ceviriSorunu(var_).length, 0);
  const t = maliyet.tahmin(900, "en", ortak.ayarOku());
  assert.equal(var_.maliyetTahmin.usd, Math.round((t.usd * 3 + t.ceviriUSD * 2) * 100) / 100, "3 senaryo + 2 ceviri");
  const hicCeviri = maliyet.onkontrol({ tur: "hepsi", is: null, adet: 2, girdiler: [{ dil: "en" }, { dil: "tr", altyaziDili: "tr" }], anahtarVar: SADECE_VIDIQ });
  assert.equal(ceviriSorunu(hicCeviri).length, 0);
});

test("maliyet sinirlari ceviri tutarini da sayar (gunluk sinir cevirinin eklenmesiyle asilirsa hata)", () => {
  const ayar = ortak.ayarOku();
  const t = maliyet.tahmin(900, "en", ayar);
  // senaryo VAR (yazim ucretsiz), yalniz ceviri ucretli: sinir ceviri tutarindan kucuk
  isKur("cev5", { dil: "en", altyaziDili: "tr" }, { "SESLENDIRME-TAM-METIN.txt": SENARYO });
  const sinirli = Object.assign({}, ayar, { maliyet: Object.assign({}, ayar.maliyet, { gunlukUSD: t.ceviriUSD / 2 }) });
  const r = maliyet.onkontrol({ tur: "hepsi", is: "cev5", ayar: sinirli, anahtarVar: CLAUDE_VAR });
  assert.ok(r.sorunlar.some(s => s.kod === "maliyet" && s.seviye === "hata"), JSON.stringify(r.sorunlar));
  // ceviri gerekmeyen is ayni sinirla uyarilmaz (ucretli adim yok)
  isKur("cev6", { dil: "en", altyaziDili: "en" }, { "SESLENDIRME-TAM-METIN.txt": SENARYO });
  const r2 = maliyet.onkontrol({ tur: "hepsi", is: "cev6", ayar: sinirli, anahtarVar: CLAUDE_VAR });
  assert.ok(!r2.sorunlar.some(s => s.kod === "maliyet"), JSON.stringify(r2.sorunlar));
});
