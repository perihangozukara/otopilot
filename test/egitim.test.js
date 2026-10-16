"use strict";
// lib/egitim.js: eğitim PDF'lerinin masaüstüne kopyalanması. Gerçek masaüstüne dokunmaz: her test geçici klasör kullanır.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const egitim = require("../lib/egitim");

const EGITIM_DIZIN = path.join(__dirname, "..", "egitim");
const gecici = () => fs.mkdtempSync(path.join(os.tmpdir(), "egitim-test-"));
const temizle = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* kilitli */ } };

test("egitim/ klasöründeki her PDF listede, listedeki her PDF depoda; hepsi gerçek PDF", () => {
  const depoda = fs.readdirSync(EGITIM_DIZIN).filter((a) => a.toLowerCase().endsWith(".pdf")).sort();
  const listede = egitim.DOSYALAR.map(([ad]) => ad).sort();
  assert.deepEqual(depoda, listede, "depodaki PDF'ler ile DOSYALAR listesi aynı olmalı");
  for (const ad of depoda) {
    const b = fs.readFileSync(path.join(EGITIM_DIZIN, ad));
    assert.equal(b.subarray(0, 5).toString("latin1"), "%PDF-", ad + " PDF başlığı taşımıyor");
    assert.ok(b.length > 10000, ad + " beklenmedik küçük");
  }
  // masaüstü adları benzersiz ve .pdf ile biter
  const gorunen = egitim.DOSYALAR.map(([, g]) => g);
  assert.equal(new Set(gorunen).size, gorunen.length);
  assert.ok(gorunen.every((g) => g.endsWith(".pdf")));
});

test("kopyala: masaüstünde 'Otomasyon Eğitim' klasörü açar, dört PDF'i koyar; ikinci çalıştırma yeniden kopyalamaz", () => {
  const masaustu = gecici();
  try {
    const bir = egitim.kopyala({ masaustu, isaret: null });
    assert.equal(bir.klasor, path.join(masaustu, egitim.KLASOR_ADI));
    assert.equal(bir.kopyalanan.length, egitim.DOSYALAR.length);
    assert.deepEqual(bir.eksik, []);
    for (const [ad, gorunen] of egitim.DOSYALAR) {
      const hedef = path.join(bir.klasor, gorunen);
      assert.ok(fs.existsSync(hedef), gorunen + " yok");
      assert.deepEqual(fs.readFileSync(hedef), fs.readFileSync(path.join(EGITIM_DIZIN, ad)), gorunen + " içeriği farklı");
    }
    assert.deepEqual(fs.readdirSync(bir.klasor).filter((a) => a.endsWith(".part")), [], "yarım (.part) dosya kalmamalı");
    const iki = egitim.kopyala({ masaustu, isaret: null });
    assert.equal(iki.kopyalanan.length, 0);
    assert.equal(iki.mevcut.length, egitim.DOSYALAR.length);
  } finally { temizle(masaustu); }
});

test("kopyala: var olan dosyanın üstüne yazmaz, silinen dosyayı geri getirir (elle çalıştırmada)", () => {
  const masaustu = gecici();
  try {
    const ilk = egitim.kopyala({ masaustu, isaret: null });
    const [, gorunen0] = egitim.DOSYALAR[0];
    const [, gorunen1] = egitim.DOSYALAR[1];
    fs.writeFileSync(path.join(ilk.klasor, gorunen0), "kullanıcı notu");
    fs.rmSync(path.join(ilk.klasor, gorunen1));
    const ikinci = egitim.kopyala({ masaustu, isaret: null });
    assert.equal(fs.readFileSync(path.join(ilk.klasor, gorunen0), "utf8"), "kullanıcı notu", "değiştirilmiş dosya ezildi");
    assert.deepEqual(ikinci.kopyalanan, [gorunen1]);
  } finally { temizle(masaustu); }
});

test("kopyala: PDF'ler tamamsa işaret dosyası yazar; eksik PDF varsa yazmaz", () => {
  const masaustu = gecici(), isaretDizin = gecici();
  try {
    const isaret = path.join(isaretDizin, ".egitim-indirildi");
    egitim.kopyala({ masaustu, isaret });
    assert.ok(fs.existsSync(isaret), "işaret yazılmadı");
    const bosKaynak = gecici();
    const isaret2 = path.join(isaretDizin, "ikinci");
    const s = egitim.kopyala({ masaustu: gecici(), kaynakDizin: bosKaynak, isaret: isaret2 });
    assert.equal(s.eksik.length, egitim.DOSYALAR.length);
    assert.ok(!fs.existsSync(isaret2), "eksik kaynakta işaret yazılmamalı");
    temizle(bosKaynak);
  } finally { temizle(masaustu); temizle(isaretDizin); }
});

test("otomatik kopyalama testte/CI'da/terminal dışında masaüstüne DOKUNMAZ", () => {
  const masaustu = gecici();
  const eski = process.env.OTOMASYON_MASAUSTU;
  process.env.OTOMASYON_MASAUSTU = masaustu;
  try {
    const s = egitim.kopyala({ otomatik: true, isaret: null });
    assert.ok(s.atlandi, "test ortamında otomatik kopyalama atlanmalı");
    assert.deepEqual(fs.readdirSync(masaustu), [], "masaüstüne yazıldı");
    assert.doesNotThrow(() => egitim.otomatik());
    assert.deepEqual(fs.readdirSync(masaustu), []);
  } finally {
    if (eski === undefined) delete process.env.OTOMASYON_MASAUSTU; else process.env.OTOMASYON_MASAUSTU = eski;
    temizle(masaustu);
  }
});

test("masaüstü bulunamazsa hata vermez, atlar", () => {
  const eski = process.env.OTOMASYON_MASAUSTU;
  process.env.OTOMASYON_MASAUSTU = path.join(os.tmpdir(), "yok-boyle-bir-klasor-" + Date.now());
  try {
    assert.equal(egitim.masaustuBul(), null);
    const s = egitim.kopyala({ isaret: null });
    assert.match(s.atlandi, /masaüstü/);
  } finally {
    if (eski === undefined) delete process.env.OTOMASYON_MASAUSTU; else process.env.OTOMASYON_MASAUSTU = eski;
  }
});

test("CLI: node lib/egitim.js seçilen masaüstüne kopyalar ve özet yazar (gerçek masaüstüne değil)", () => {
  const masaustu = gecici();
  try {
    const r = require("child_process").spawnSync(process.execPath, [path.join(__dirname, "..", "lib", "egitim.js")], {
      env: Object.assign({}, process.env, { OTOMASYON_MASAUSTU: masaustu }), encoding: "utf8", windowsHide: true,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Eğitim PDF'leri/);
    assert.equal(fs.readdirSync(path.join(masaustu, egitim.KLASOR_ADI)).length, egitim.DOSYALAR.length);
    // CLI işaret dosyasını depo köküne yazar: testte temizle ki sonraki çalışmayı etkilemesin
    try { fs.rmSync(path.join(__dirname, "..", ".egitim-indirildi"), { force: true }); } catch (e) { /* yok */ }
  } finally { temizle(masaustu); }
});
