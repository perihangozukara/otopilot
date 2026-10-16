// altyazi-cevir.js testleri: SAHTE Claude istemcisi.
"use strict";
const Y = require("./senaryo-yardim");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ortak = require("../lib/ortak");
const AC = require("../altyazi-cevir");

let sayac = 0;
function yeniIs(konu, paragrafSayisi) {
  const ad = "senaryotest-t" + (++sayac);
  const ps = Array.from({ length: paragrafSayisi || 12 }, (_, i) => Array.from({ length: 100 }, (_, k) => "kelime" + i + "x" + k).join(" ") + ".");
  Y.isOlustur(ad, konu, ps.join("\n\n") + "\n");
  return { ad, ps };
}
// istekteki JSON dizisini okur; cevir(dizi) -> yeni dizi
const sahte = (cevir) => Y.sahteClaude((params) => {
  const ist = params.messages[0].content;
  const dizi = JSON.parse(ist.slice(ist.indexOf("[")));
  return { text: JSON.stringify(cevir(dizi)) };
});
const calistir = (ad, istemci, ek) => Y.sessiz(() => AC.ana([ad].concat(ek || []), { istemci }));

test("ceviri: paragraf sayisi korunur, ALTYAZI-TR.txt yazilir, parti parti istenir, kullanim kaydi tutulur", async () => {
  const { ad, ps } = yeniIs({ baslik_en: "A", _not: "k", format: "long", dil: "en", altyaziDili: "tr" });
  const ist = sahte(d => d.map(p => "TR: " + p));
  const r = await calistir(ad, ist);
  assert.equal(r.paragraf, 12);
  assert.equal(r.dosya, "ALTYAZI-TR.txt");
  assert.ok(ist.cagrilar.length >= 2, "1200 kelime bir istege sigmaz");
  const cikti = ortak.paragraflaraBol(Y.oku(Y.URETIM, ad, "Voice", "ALTYAZI-TR.txt"));
  assert.equal(cikti.length, ps.length);
  assert.ok(cikti.every((c, i) => c === "TR: " + ps[i]));
  assert.match(ist.cagrilar[0].system, /from English into Turkish/);
  assert.equal(ist.cagrilar[0].output_config.effort, "low");
  assert.equal(Y.jsonOku(Y.URETIM, ad, "kullanim.json").kayitlar.length, ist.cagrilar.length);
  assert.ok(!fs.existsSync(path.join(Y.URETIM, ad, ".kilit")));
});

test("model paragraf sayisini tutturamazsa parti ikiye bolunur; tek paragrafta da tutmazsa cikis 4 (sessiz kayma yok)", async () => {
  const { ad, ps } = yeniIs({ baslik_en: "A", _not: "k", format: "long", dil: "en", altyaziDili: "de" }, 8);
  const ist = sahte(d => (d.length > 2 ? d.slice(1).map(p => "DE: " + p) : d.map(p => "DE: " + p)));    // 3+ paragrafta bir tanesini yutar
  await calistir(ad, ist);
  const cikti = ortak.paragraflaraBol(Y.oku(Y.URETIM, ad, "Voice", "ALTYAZI-DE.txt"));       // dil koduna gore dosya adi
  assert.equal(cikti.length, ps.length);
  const { ad: ad2 } = yeniIs({ baslik_en: "A", _not: "k", format: "long", dil: "en", altyaziDili: "fr" }, 3);
  await assert.rejects(calistir(ad2, sahte(() => ["a", "b", "c", "d"])), e => e.kod === "ceviri_sayi" && e.cikis === 4);
  assert.ok(!fs.existsSync(path.join(Y.URETIM, ad2, "Voice", "ALTYAZI-FR.txt")), "yarim ceviri yazilmamali");
});

test("diller ayniysa atlanir; guncel ceviri tekrar ucretli cagri yapmaz; senaryo sonradan degistiyse eskisi yedeklenip yenilenir", async () => {
  const ayni = yeniIs({ baslik_en: "A", _not: "k", format: "long", dil: "en" }, 3);
  const ist0 = sahte(d => d);
  const r0 = await calistir(ayni.ad, ist0);
  assert.equal(r0.atlandi, true);
  assert.equal(ist0.cagrilar.length, 0);

  const { ad } = yeniIs({ baslik_en: "A", _not: "k", format: "long", dil: "en", altyaziDili: "tr" }, 3);
  const ist = sahte(d => d.map(p => "TR " + p));
  await calistir(ad, ist);
  const n = ist.cagrilar.length;
  const r = await calistir(ad, ist);
  assert.equal(r.atlandi, true);
  assert.equal(ist.cagrilar.length, n, "guncel ceviri tekrar cevrilmemeli");

  // senaryo degisti (dosya daha yeni): eski ceviri Voice/yedek'e alinir
  const dosya = path.join(Y.URETIM, ad, "Voice", "ALTYAZI-TR.txt");
  const eski = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(dosya, eski, eski);
  const r2 = await calistir(ad, ist);
  assert.equal(r2.atlandi, undefined);
  assert.ok(ist.cagrilar.length > n);
  assert.ok(fs.readdirSync(path.join(Y.URETIM, ad, "Voice", "yedek")).some(x => /^ALTYAZI-TR-\d{8}-\d{6}\.txt$/.test(x)));
});

test("girdi hatalari: senaryo yok / anahtar yok -> cikis 2", async () => {
  const { ad } = yeniIs({ baslik_en: "A", _not: "k", format: "long", dil: "en", altyaziDili: "tr" });
  fs.writeFileSync(path.join(Y.URETIM, ad, "Voice", "SESLENDIRME-TAM-METIN.txt"), "");
  await assert.rejects(calistir(ad, sahte(d => d)), e => e.kod === "senaryo_yok" && e.cikis === 2);
  const { ad: ad2 } = yeniIs({ baslik_en: "A", _not: "k", format: "long", dil: "en", altyaziDili: "tr" });
  await assert.rejects(Y.sessiz(() => AC.ana([ad2], {})), e => e.kod === "anahtar_yok" && e.cikis === 2);
});

test("ceviriCoz: kod citi, bos eleman ve yanlis sayi reddedilir", () => {
  assert.deepEqual(AC.ceviriCoz('```json\n["a","b"]\n```', 2), ["a", "b"]);
  assert.equal(AC.ceviriCoz('["a"]', 2), null);
  assert.equal(AC.ceviriCoz('["a",""]', 2), null);
  assert.equal(AC.ceviriCoz("sohbet", 1), null);
  assert.equal(AC.partilere(Array.from({ length: 12 }, () => "kelime ".repeat(100))).length, 2);
});
