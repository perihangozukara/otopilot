// Arayuz uyumu turu: gruplar arasi sozlesme bosluklarini kapatan panel uclari (gercek surec).
// Onizleme ve Shorts servisi, is-detay yeni dosya bayraklari, ortak onbellek temizligi, PIPER/Azure alan dogrulamasi,
// trend referansi (konu._trendRapor), gorsel silince ATIF.txt tazelenmesi, VS tanimi 'yasak' alani.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Y = require("./panel-yardim");

const kok = (o, ...p) => path.join(o.uretim, ...p);
const yaz = (p, i) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof i === "string" || Buffer.isBuffer(i) ? i : JSON.stringify(i)); };

let ortam, panel, c;
test.before(async () => {
  ortam = Y.geciciOrtam("entegrasyon");
  panel = await Y.panelBaslat(ortam);
  c = panel.istemci;
});
test.after(async () => { if (panel) await panel.kapat(); if (ortam) ortam.temizle(); });

async function yeniIs(ek) { const r = await c.post("/api/yeni", Object.assign({ baslik: "Entegrasyon testi" }, ek || {})); assert.equal(r.durum, 200, r.metin); return r.json.ad; }

test("onizleme ve Shorts: /video/<is>/onizleme, /shorts/<is>/<dosya> cerezle servis edilir (Range 206, ?indir=1), cerezsiz 403, yol kacisi 400", async () => {
  const ad = await yeniIs();
  yaz(kok(ortam, ad, "Videos", ad + "-onizleme.mp4"), Buffer.alloc(5000, 7));
  yaz(kok(ortam, ad, "Shorts", "01-giris.mp4"), Buffer.alloc(3000, 1));
  yaz(kok(ortam, ad, "Shorts", "02-yarim.part.mp4"), Buffer.alloc(100, 2));
  yaz(kok(ortam, ad, "Shorts", "03-bos.mp4"), "");

  const onizle = await c.get("/video/" + ad + "/onizleme", { cerezli: true });
  assert.equal(onizle.durum, 200); assert.equal(onizle.buf.length, 5000); assert.equal(onizle.baslik["content-type"], "video/mp4");
  const kismi = await c.istek("GET", "/video/" + ad + "/onizleme", undefined, { cerezli: true, baslik: { Range: "bytes=10-19" } });
  assert.equal(kismi.durum, 206); assert.equal(kismi.buf.length, 10);
  assert.equal((await c.get("/video/" + ad + "/onizleme")).durum, 403, "cerezsiz medya istegi reddedilir");
  assert.equal((await c.get("/indir/" + ad + "/onizleme", { cerezli: true })).baslik["content-disposition"].startsWith("attachment"), true);

  const l = (await c.get("/api/shorts?is=" + ad)).json.shorts;
  assert.deepEqual(l.map(x => x.ad), ["01-giris.mp4"], ".part ve bos dosya listede yok");
  const s = await c.get("/shorts/" + ad + "/01-giris.mp4", { cerezli: true });
  assert.equal(s.durum, 200); assert.equal(s.buf.length, 3000);
  const ind = await c.get("/shorts/" + ad + "/01-giris.mp4?indir=1", { cerezli: true });
  assert.match(ind.baslik["content-disposition"], /attachment; filename="[^"]*01-giris\.mp4"/);
  assert.equal((await c.get("/shorts/" + ad + "/01-giris.mp4")).durum, 403);
  assert.equal((await c.get("/shorts/" + ad + "/02-yarim.part.mp4", { cerezli: true })).durum, 400);
  assert.equal((await c.get("/shorts/" + ad + "/..%2Fkonu.json", { cerezli: true })).durum, 400);
  assert.equal((await c.get("/shorts/" + ad + "/yok.mp4", { cerezli: true })).durum, 404);
  assert.equal((await c.get("/api/shorts?is=../x")).durum, 400);

  const d = (await c.get("/api/is-detay?is=" + ad)).json.dosyalar;
  assert.equal(d.onizleme, true); assert.equal(d.shorts, 1);
});

test("is-detay: yarim senaryo ve yayin durumu bayraklari; /api/dosya senaryoyarim + yayinDurum okunur", async () => {
  const ad = await yeniIs();
  let d = (await c.get("/api/is-detay?is=" + ad)).json.dosyalar;
  assert.equal(d.senaryoYarim, false); assert.equal(d.yayinDurum, false); assert.equal(d.onizleme, false); assert.equal(d.shorts, 0);
  const yarim = "Bu metin hedef sureye ulasamadi ama saklandi, odenen cagri bos gitmesin.\n\nIkinci paragraf da burada duruyor.";
  yaz(kok(ortam, ad, "Voice", "SESLENDIRME-TAM-METIN-yarim.txt"), yarim);
  const r = await c.post("/api/yayin-isaretle", { is: ad, platform: "youtube", durum: "yuklendi", url: "https://youtu.be/abcdefghijk" });
  assert.equal(r.durum, 200);
  d = (await c.get("/api/is-detay?is=" + ad)).json.dosyalar;
  assert.equal(d.senaryoYarim, true); assert.equal(d.yayinDurum, true);
  assert.equal((await c.get("/api/dosya?is=" + ad + "&tur=senaryoyarim")).json.icerik, yarim);
  const yd = (await c.get("/api/dosya?is=" + ad + "&tur=yayinDurum")).json;
  assert.equal(yd.json.platformlar.youtube.durum, "yuklendi");
  assert.equal(yd.json.platformlar.youtube.videoId, "abcdefghijk");
});

test("ortak onbellek: /api/disk onbellekMB raporlar, /api/temizle {tur:onbellek} siler; video kurulurken 409", async () => {
  yaz(kok(ortam, "_onbellek", "aa0-geri-sayim-x.mp4"), Buffer.alloc(3 * 1048576, 1));
  const d = (await c.get("/api/disk")).json;
  assert.ok(d.onbellekMB >= 3, "onbellek boyutu raporlanir: " + d.onbellekMB);
  assert.ok(d.uretimGB >= 0);
  const t = await c.post("/api/temizle", { tur: "onbellek" });
  assert.equal(t.durum, 200); assert.ok(t.json.serbestMB >= 3);
  assert.equal(fs.existsSync(kok(ortam, "_onbellek")), false);
  assert.equal((await c.post("/api/temizle", { tur: "yanlis" })).durum, 400);
  // panel disinda calisan bir video-yap (canli pid'li is kilidi) varsa onbellek silinmez
  const ad = await yeniIs();
  yaz(kok(ortam, "_onbellek", "aa0-geri-sayim-y.mp4"), Buffer.alloc(100, 1));
  yaz(kok(ortam, ad, ".kilit"), { pid: process.pid, baslangic: new Date().toISOString(), komut: "video-yap" });
  const k = await c.post("/api/temizle", { tur: "onbellek" });
  assert.equal(k.durum, 409); assert.equal(k.json.kod, "is_calisiyor");
  assert.equal(fs.existsSync(kok(ortam, "_onbellek", "aa0-geri-sayim-y.mp4")), true);
  fs.unlinkSync(kok(ortam, ad, ".kilit"));
});

test("/api/anahtarlar: PIPER_YOL/PIPER_MODEL yalniz var olan mutlak yol; kabuk karakteri, yanlis tur, bolge/model adi reddedilir", async () => {
  const piper = path.join(ortam.kok, "piper.exe"), model = path.join(ortam.kok, "ses.onnx"), yanlisModel = path.join(ortam.kok, "ses.bin");
  yaz(piper, "x"); yaz(model, "x"); yaz(yanlisModel, "x");
  const dene = async ayarla => c.post("/api/anahtarlar", { ayarla });
  assert.equal((await dene({ PIPER_YOL: "piper.exe" })).durum, 400, "goreli yol");
  assert.equal((await dene({ PIPER_YOL: path.join(ortam.kok, "yok.exe") })).durum, 400, "dosya yok");
  assert.equal((await dene({ PIPER_YOL: ortam.kok })).durum, 400, "klasor dosya degil");
  assert.equal((await dene({ PIPER_YOL: piper + " & calc" })).durum, 400, "kabuk karakteri");
  assert.equal((await dene({ PIPER_MODEL: yanlisModel })).durum, 400, ".onnx olmali");
  assert.equal((await dene({ AZURE_SPEECH_REGION: "west europe; rm" })).durum, 400);
  assert.equal((await dene({ ANTHROPIC_MODEL: "claude opus 5" })).durum, 400);
  const yanit = await dene({ PIPER_YOL: piper, PIPER_MODEL: model, AZURE_SPEECH_REGION: "westeurope", ANTHROPIC_MODEL: "claude-opus-5" });
  assert.equal(yanit.durum, 200, yanit.metin);
  const g = (await c.get("/api/anahtarlar")).json;
  assert.equal(g.PIPER_YOL, piper); assert.equal(g.PIPER_MODEL, model);
  assert.equal((await c.post("/api/anahtarlar", { sil: ["PIPER_YOL", "PIPER_MODEL", "AZURE_SPEECH_REGION", "ANTHROPIC_MODEL"] })).durum, 200);
});

test("/api/yeni trendRapor: yalniz trend/ ve viral-analiz/ altindaki .json adresi konu.json'a _trendRapor olarak yazilir", async () => {
  const r = await c.post("/api/yeni", { baslik: "Trend konusu", trendRapor: "trend/2026-10-05-animal.json" });
  assert.equal(r.durum, 200, r.metin);
  const k = JSON.parse(fs.readFileSync(kok(ortam, r.json.ad, "konu.json"), "utf8"));
  assert.equal(k._trendRapor, "trend/2026-10-05-animal.json");
  assert.equal((await c.get("/api/dosya?is=" + r.json.ad + "&tur=konu")).json.icerik.includes("_trendRapor"), true);
  for (const kotu of ["../konu.json", "trend/../../.env", "baska/rapor.json", "trend/rapor.md", "viral-analiz/", "/etc/passwd"]) {
    const x = await c.post("/api/yeni", { baslik: "Kotu " + kotu, trendRapor: kotu });
    assert.equal(x.durum, 400, kotu); assert.ok(x.json.alanlar.some(a => a.alan === "trendRapor"));
  }
  const v = await c.post("/api/yeni", { baslik: "Viral konu", trendRapor: "viral-analiz/2026-10-05-x.json" });
  assert.equal(v.durum, 200, v.metin);
});

test("gorsel silinince ATIF.txt manifestten yeniden kurulur (silinen gorselin atfi aciklamaya girmez)", async () => {
  const ad = await yeniIs();
  const g = (n, yazar) => ({ dosya: "001-a/0" + n + ".jpg", kaynak: "wikimedia", lisans: "CC BY 4.0", lisansKodu: "by", atifGerekli: true, atif: yazar,
    baslik: "Foto " + n, kaynakUrl: "https://commons.example/" + n, indirmeUrl: "https://upload.example/" + n, en: 1920, boy: 1080, bayt: 4, sha1: "a".repeat(39) + n });
  yaz(kok(ortam, ad, "Visuals", "001-a", "01.jpg"), "jpg1"); yaz(kok(ortam, ad, "Visuals", "001-a", "02.jpg"), "jpg2");
  yaz(kok(ortam, ad, "Visuals", "manifest.json"), { surum: 1, olusturma: new Date().toISOString(), kaynakSenaryoSha1: "x", dil: "en", hedefYon: "yatay",
    sahneler: [{ no: 1, klasor: "001-a", paragraflar: [0], aramalar: ["a"], kullanilanArama: "a", durum: "tamam", gorseller: [g(1, "Ayse"), g(2, "Mehmet")] }], toplamGorsel: 2 });
  yaz(kok(ortam, ad, "ATIF.txt"), "Görsel kaynakları / Image credits:\n\"Foto 1\" — Ayse — CC BY 4.0 — https://commons.example/1\n\"Foto 2\" — Mehmet — CC BY 4.0 — https://commons.example/2\n");
  const r = await c.post("/api/gorsel-sil", { is: ad, sahne: "001-a", ad: "01.jpg" });
  assert.equal(r.durum, 200, r.metin);
  const atif = fs.readFileSync(kok(ortam, ad, "ATIF.txt"), "utf8");
  assert.ok(!atif.includes("Foto 1") && !atif.includes("Ayse"), "silinen gorselin atfi kalmamali:\n" + atif);
  assert.ok(atif.includes("Foto 2"));
  const s = JSON.parse(fs.readFileSync(kok(ortam, ad, "silinenler.json"), "utf8"));
  assert.equal(s.silinenler.length, 1);
  // kalan tek gorsel de silinince atif gerektiren gorsel kalmaz: ATIF.txt kaldirilir
  assert.equal((await c.post("/api/gorsel-sil", { is: ad, sahne: "001-a", ad: "02.jpg" })).durum, 200);
  assert.equal(fs.existsSync(kok(ortam, ad, "ATIF.txt")), false);
});

test("VS tanimi: 'yasak' listesi vs-tanim.json'a gecer ve dogrulanir", async () => {
  const tanim = yasak => ({ baslik: "LION vs TIGER", ust: { ad: "Lion", renk: "3BE07A", ara: "lion", yasak }, alt: { ad: "Tiger", renk: "FF6B6B", ara: "tiger" },
    olculer: [{ ad: "Hiz", ustDeger: 80, ustMetin: "80 km/s", altDeger: 65, altMetin: "65 km/s", kazanan: "ust" }], kazanan: "ust" });
  const r = await c.post("/api/vs-yeni", tanim(["cub", "statue"]));
  assert.equal(r.durum, 200, r.metin);
  const t = JSON.parse(fs.readFileSync(kok(ortam, r.json.ad, "vs-tanim.json"), "utf8"));
  assert.deepEqual(t.ust.yasak, ["cub", "statue"]); assert.equal("yasak" in t.alt, false);
  const kotu = await c.post("/api/vs-yeni", tanim("cub"));
  assert.equal(kotu.durum, 400); assert.ok(kotu.json.alanlar.some(a => a.alan === "ust.yasak"));
});

test("/api/sahneler: manifestin lisans uyarilari ve kaynak hatalari sahne listesiyle birlikte gelir", async () => {
  const ad = await yeniIs();
  yaz(kok(ortam, ad, "Visuals", "001-a", "01.jpg"), "jpg");
  yaz(kok(ortam, ad, "Visuals", "manifest.json"), { surum: 1, kaynakSenaryoSha1: "x", dil: "en", hedefYon: "yatay", toplamGorsel: 1,
    uyarilar: ["CC BY-SA lisanslı görsel var: türev eser aynı lisansla paylaşılmalı."], kaynakHatalari: { wikimedia: 2, openverse: "kapali (429)", kotu: { x: 1 } },
    sahneler: [{ no: 1, klasor: "001-a", paragraflar: [0], aramalar: ["a"], durum: "doldurma", gorseller: [{ dosya: "001-a/01.jpg", kaynak: "elle", lisans: "Elle eklendi" }] }] });
  const r = (await c.get("/api/sahneler?is=" + ad)).json;
  assert.equal(r.sahneler.length, 1); assert.equal(r.sahneler[0].durum, "doldurma"); assert.equal(r.sahneler[0].gorseller[0].kaynak, "elle");
  assert.deepEqual(r.uyarilar, ["CC BY-SA lisanslı görsel var: türev eser aynı lisansla paylaşılmalı."]);
  assert.deepEqual(r.kaynakHatalari, { wikimedia: 2, openverse: "kapali (429)" }, "yalniz sayi/metin degerleri");
  const bos = await yeniIs();
  const b = (await c.get("/api/sahneler?is=" + bos)).json;
  assert.deepEqual([b.sahneler, b.uyarilar, b.kaynakHatalari], [[], [], {}]);
});
