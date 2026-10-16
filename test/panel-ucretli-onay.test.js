// Panel: zincirin ucretli adimlari onkontrolde listelenir (senaryo VAR olsa bile vidIQ baslik adimlari) ve panel yeniden baslayinca
// durum.json'daki onay beklemesi is listesinde kaybolmaz. Ag yok, ucretli servis yok, gercek .env'e dokunulmaz.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const maliyet = require("../lib/panel-maliyet");
const isler = require("../lib/panel-isler");

function ortamKur() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "panel-ucretli-"));
  const onceki = ["OTOMASYON_URETIM", "OTOMASYON_AYAR_DOSYASI", "OTOMASYON_ENV_DOSYASI"].map(k => [k, process.env[k]]);
  process.env.OTOMASYON_URETIM = path.join(d, "uretim");
  process.env.OTOMASYON_AYAR_DOSYASI = path.join(d, "panel-ayar.json");
  process.env.OTOMASYON_ENV_DOSYASI = path.join(d, ".env");
  fs.mkdirSync(process.env.OTOMASYON_URETIM, { recursive: true });
  fs.writeFileSync(process.env.OTOMASYON_ENV_DOSYASI, "");
  return {
    uretim: process.env.OTOMASYON_URETIM,
    yaz(rel, icerik) { const p = path.join(process.env.OTOMASYON_URETIM, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof icerik === "string" ? icerik : JSON.stringify(icerik)); },
    geri() {
      for (const [k, v] of onceki) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* gecici klasor */ }
    },
  };
}
const METIN = "Birinci paragraf yeterince uzun bir cumle olsun diye yaziliyor ve bitiyor.\n\nIkinci paragraf da bir baska uzun cumleden olusuyor ve bitiyor.\n";
const anahtarlar = (...adlar) => ad => adlar.includes(ad);

test("onkontrol.ucretliAdimlar: senaryo VAR olsa bile vidIQ anahtari varsa baslik adimlari ucretli diye sayilir", () => {
  const o = ortamKur();
  try {
    o.yaz("var/konu.json", { surum: 1, baslik_en: "Konu", dil: "en", format: "long" });
    o.yaz("var/Voice/SESLENDIRME-TAM-METIN.txt", METIN);
    const r = maliyet.onkontrol({ tur: "hepsi", is: "var", anahtarVar: anahtarlar("VIDIQ_KEY") });
    assert.deepEqual(r.ucretliAdimlar.map(a => a.ad), ["baslik-on", "baslik"]);
    assert.ok(r.ucretliAdimlar.every(a => a.saglayici === "vidIQ" && a.istegeBagli === true));
    // limit denetimi (hata) yalniz senaryo yazilacaksa devreye girer: bu liste onu degistirmez
    assert.equal(r.ok, true);
  } finally { o.geri(); }
});

test("onkontrol.ucretliAdimlar: senaryo YOK -> yazim (Claude) listede; anahtarsiz ve senaryolu is -> bos; tek tur -> bos", () => {
  const o = ortamKur();
  try {
    o.yaz("yok/konu.json", { surum: 1, baslik_en: "Konu", dil: "en", format: "long" });
    const r = maliyet.onkontrol({ tur: "hepsi", is: "yok", anahtarVar: anahtarlar("ANTHROPIC_API_KEY", "VIDIQ_KEY") });
    assert.deepEqual(r.ucretliAdimlar.map(a => a.ad + ":" + a.saglayici), ["baslik-on:vidIQ", "senaryo:Claude", "baslik:vidIQ"]);
    o.yaz("var/konu.json", { surum: 1, baslik_en: "Konu", dil: "en", format: "long" });
    o.yaz("var/Voice/SESLENDIRME-TAM-METIN.txt", METIN);
    assert.deepEqual(maliyet.onkontrol({ tur: "hepsi", is: "var", anahtarVar: anahtarlar() }).ucretliAdimlar, []);
    assert.deepEqual(maliyet.onkontrol({ tur: "video", is: "var", anahtarVar: anahtarlar("VIDIQ_KEY") }).ucretliAdimlar, []);
  } finally { o.geri(); }
});

test("onkontrol.ucretliAdimlar: altyazi dili farkliysa ceviri (Claude) de listelenir", () => {
  const o = ortamKur();
  try {
    o.yaz("ceviri/konu.json", { surum: 1, baslik_en: "Konu", dil: "en", altyaziDili: "tr", format: "long" });
    o.yaz("ceviri/Voice/SESLENDIRME-TAM-METIN.txt", METIN);
    const r = maliyet.onkontrol({ tur: "hepsi", is: "ceviri", anahtarVar: anahtarlar("ANTHROPIC_API_KEY") });
    assert.deepEqual(r.ucretliAdimlar.map(a => a.ad + ":" + a.saglayici), ["ceviri:Claude"]);
  } finally { o.geri(); }
});

test("isOzeti: panel yeniden basladiktan sonra durum.json'daki onay_bekliyor 'yeni'ye dusmez", () => {
  const o = ortamKur();
  try {
    o.yaz("onay/konu.json", { surum: 1, baslik_en: "Konu", dil: "en", format: "long" });
    o.yaz("onay/Voice/SESLENDIRME-TAM-METIN.txt", METIN);
    o.yaz("onay/durum.json", { surum: 1, is: "onay", son: { tur: "hepsi", id: "eski", durum: "onay_bekliyor" }, adimlar: [{ ad: "senaryo", durum: "bitti" }, { ad: "gorsel", durum: "onay" }] });
    assert.equal(isler.isOzeti("onay", null, { boyutsuz: true }).durum, "onay_bekliyor");
    // canli kayit varsa o esas alinir
    assert.equal(isler.isOzeti("onay", { durum: "calisiyor" }, { boyutsuz: true }).durum, "calisiyor");
    o.yaz("bos/konu.json", { surum: 1, baslik_en: "Konu", dil: "en", format: "long" });
    assert.equal(isler.isOzeti("bos", null, { boyutsuz: true }).durum, "yeni");
  } finally { o.geri(); }
});
