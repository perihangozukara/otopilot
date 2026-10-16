// Yan araclarin testleri: kapak-yap, yayin-paketi, kesit-bul (eski + otomatik), shorts-kes, marka-yap,
// vs-yap, geri-sayim, ff-yol ve komut satiri arguman uyumu. Gercek ffmpeg, sentetik girdi.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const fik = require("./render-fikstur");
const kok = fik.ortamKur();
const ffvar = fik.ffmpegVarMi();
const skip = !ffvar && "ffmpeg yok";
const YA = require("../lib/render-yayin");

test.after(() => fik.temizle(kok));

const oku = (j, ...p) => JSON.parse(fs.readFileSync(path.join(j.dizin, ...p), "utf8"));
const goruntuBoyutu = f => { const r = JSON.parse(execFileSync(fik.FP(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", f], { windowsHide: true })); return r.streams[0]; };

// ---------------- saf: bolum / zaman / hashtag ----------------
test("zamanMetni / bolumleriKur: 00:00'dan baslar, >=3 madde, her biri >=10 sn", () => {
  assert.equal(YA.zamanMetni(0), "00:00"); assert.equal(YA.zamanMetni(75.9), "01:15"); assert.equal(YA.zamanMetni(3725), "1:02:05");
  const kanon = Array.from({ length: 12 }, (_, i) => "Paragraf " + i + " has some words here");
  const baslangic = kanon.map((_, i) => 7.6 + i * 20);                    // her paragraf 20 sn, anlatim 7.6'da basliyor
  const b = YA.bolumleriKur(baslangic, kanon, null, 7.6 + 12 * 20 + 12);
  assert.equal(b[0].sn, 0);                                                // ilk bolum 00:00 (intro dahil)
  assert.ok(b.length >= 3);
  for (let i = 1; i < b.length; i++) assert.ok(b[i].sn - b[i - 1].sn >= 10 - 1e-9);
  assert.ok((7.6 + 12 * 20 + 12) - b[b.length - 1].sn >= 10);
  // bolumler.json'dan
  const bj = { bolumler: [{ ad: "Giriş", paragrafBas: 0, paragrafSon: 3 }, { ad: "Orta", paragrafBas: 4, paragrafSon: 8 }, { ad: "Son", paragrafBas: 9, paragrafSon: 11 }] };
  const b2 = YA.bolumleriKur(baslangic, kanon, bj, 7.6 + 12 * 20 + 12);
  assert.deepEqual(b2.map(x => x.baslik), ["Giriş", "Orta", "Son"]);
  assert.equal(b2[0].sn, 0); assert.equal(b2[1].sn, baslangic[4]);
  // kisa video: bolum eklenmez
  assert.deepEqual(YA.bolumleriKur([0, 5, 9], ["a b", "c d", "e f"], null, 14), []);
  // 10 sn'den kisa araliklar birlesir
  const kisa = YA.bolumleriKur([0, 4, 8, 30, 50], ["a", "b", "c", "d", "e"], { bolumler: [0, 1, 2, 3, 4].map(i => ({ ad: "B" + i, paragrafBas: i })) }, 70);
  for (let i = 1; i < kisa.length; i++) assert.ok(kisa[i].sn - kisa[i - 1].sn >= 10 - 1e-9);
});

test("hashtagYap / atiflariKur", () => {
  assert.equal(YA.hashtagYap("black holes"), "#BlackHoles");
  assert.equal(YA.hashtagYap("#zaman yolculuğu"), "#ZamanYolculuğu");
});

// ---------------- gercek is: tek render, sonraki testler ayni ciktiyi kullanir ----------------
let J = null;
test("hazirlik: sentetik is render edilir", { skip }, async () => {
  J = fik.isKur(kok, { ad: "a1", paragraf: 8, sahneBasina: 2, gorselBasina: 2, konu: { intro: 1.5, outro: 3, gecisSure: 0.4, muzikSeviyesi: 0.3, kisiselKatki: "benim yorumum" } });
  fs.writeFileSync(path.join(J.dizin, "Voice", "bolumler.json"), JSON.stringify({ surum: 1, bolumler: [
    { ad: "Giriş", paragrafBas: 0, paragrafSon: 2 }, { ad: "Orta bölüm: 100%", paragrafBas: 3, paragrafSon: 5 }, { ad: "Sonuç", paragrafBas: 6, paragrafSon: 7 }] }));
  fs.writeFileSync(path.join(J.dizin, "Voice", "aciklama-ozet.txt"), "Kısa bir özet cümlesi. İkinci cümle.\n");
  const r = await fik.betikCalistir("video-yap.js", ["a1"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
});

test("yayin-paketi: bolumler gercek zamandan (intro kaymasi dahil), atiflar manifestten, uyum alani", { skip }, async () => {
  const r = await fik.betikCalistir("yayin-paketi.js", ["a1"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const y = oku(J, "yayin.json");
  assert.equal(y.bolumler.length, 3);
  assert.equal(y.bolumler[0].zaman, "00:00");
  const s = oku(J, "render-sonuc.json");
  assert.ok(Math.abs(y.bolumler[1].sn - s.paragrafBaslangic[3]) < 0.01, "bolum 2 = paragraf 3'un video zamani");
  assert.ok(y.bolumler[1].sn > s.anlatimBaslangicSn, "intro kaymasi eklenmis olmali");
  const txt = fs.readFileSync(path.join(J.dizin, "bolumler.txt"), "utf8");
  assert.match(txt, /^00:00 Giriş\n\d\d:\d\d Orta bölüm: 100%\n/);
  assert.match(y.aciklama, /^Kısa bir özet cümlesi\./);
  assert.match(y.aciklama, /Görsel kaynakları \/ Image credits:/);
  assert.ok(y.aciklama.includes(txt.trim()));
  assert.equal(y.atiflar.length, 4 * 2);                                   // 4 sahne x 2 gorsel, kaynakUrl tekil
  assert.ok(y.atiflar.every(a => a.atifMetni.includes(a.kaynakUrl)));
  assert.equal(y.uyum.atifGerekli, true);
  assert.deepEqual(y.uyum.uyarilar.filter(u => /kişisel katkı/.test(u)), [], "kisiselKatki verilmis");
  const md = fs.readFileSync(path.join(J.dizin, "YAYIN-PAKETI.md"), "utf8");
  assert.match(md, /## Açıklama/); assert.match(md, /## Bölümler/); assert.match(md, /değiştirilmiş\/sentetik içerik/);
  // silinen gorselin atfi aciklamaya girmez
  const m = oku(J, "Visuals", "manifest.json");
  const sil = m.sahneler[1].gorseller.pop();
  fs.rmSync(path.join(J.dizin, "Visuals", sil.dosya));
  fs.writeFileSync(path.join(J.dizin, "Visuals", "manifest.json"), JSON.stringify(m));
  const r2 = await fik.betikCalistir("yayin-paketi.js", ["a1"]);
  assert.equal(r2.kod, 0);
  assert.ok(!oku(J, "yayin.json").aciklama.includes(sil.kaynakUrl));
});

test("kapak-yap: 1280x720 jpg, <= 2 MB; dikey formatta 1080x1920; gorselsiz is de kapak uretir", { skip }, async () => {
  fs.rmSync(path.join(J.dizin, "Videos", "a1-kapak.jpg"), { force: true });
  const r = await fik.betikCalistir("kapak-yap.js", ["a1"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const kapak = path.join(J.dizin, "Videos", "a1-kapak.jpg");
  const b = goruntuBoyutu(kapak);
  assert.deepEqual([b.width, b.height], [1280, 720]);
  assert.ok(fs.statSync(kapak).size <= 2 * 1024 * 1024);
  assert.ok(!fs.existsSync(path.join(J.dizin, "Videos", "a1-kapak.part.jpg")));
  // dikey + ozel karakterli uzun baslik + gorselsiz
  const v = fik.isKur(kok, { ad: "a2", paragraf: 2, konu: { format: "short", aspect: "9:16", baslik_en: "100% Bob's: A very long title that must wrap into at most three lines for sure \\ ok" } });
  fs.rmSync(path.join(v.dizin, "Visuals"), { recursive: true });
  const r2 = await fik.betikCalistir("kapak-yap.js", ["a2"]);
  assert.equal(r2.kod, 0, r2.stdout + r2.stderr);
  const b2 = goruntuBoyutu(path.join(v.dizin, "Videos", "a2-kapak.jpg"));
  assert.deepEqual([b2.width, b2.height], [1080, 1920]);
});

test("kesit-bul otomatik: paragraf gruplarindan, ust uste binmeyen, videoyu asmayan kesitler", { skip }, async () => {
  const cikti = path.join(J.dizin, "kesitler.json");
  const r = await fik.betikCalistir("kesit-bul.cjs", ["a1", "--otomatik", cikti, "--adet", "2", "--min", "8", "--max", "20"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const k = JSON.parse(fs.readFileSync(cikti, "utf8"));
  const s = oku(J, "render-sonuc.json");
  assert.equal(k.length, 2);
  for (const x of k) {
    assert.ok(x.bas >= 0 && x.sure > 0 && x.bas + x.sure <= s.sureSn + 0.01, JSON.stringify(x));
    assert.ok(x.sure >= 8 && x.sure <= 22, "sure " + x.sure);
    assert.equal(x.paragraflar.length, 2);
  }
  assert.ok(k[1].paragraflar[0] > k[0].paragraflar[1], "kesitler ust uste binmemeli");
  assert.ok(k[0].bas >= s.anlatimBaslangicSn - 0.3 - 1e-6, "anlatim baslangicindan once baslamamali");
});

test("kesit-bul eski mod: secim.json + altyazi hizalama; sabit +19 yok (final SRT kayma icerir)", { skip }, async () => {
  const secim = path.join(J.dizin, "secim.json"), cikti = path.join(J.dizin, "kesitler-eski.json");
  fs.writeFileSync(secim, JSON.stringify([{ ad: "ilk", bas: 0, son: 1 }, { ad: "orta", bas: 3, son: 4 }]));
  const r = await fik.betikCalistir("kesit-bul.cjs", ["a1", secim, cikti]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const k = JSON.parse(fs.readFileSync(cikti, "utf8"));
  const s = oku(J, "render-sonuc.json");
  assert.equal(k.length, 2);
  assert.ok(Math.abs(k[0].bas - Math.max(0, s.paragrafBaslangic[0] - 0.25)) < 0.5, "ilk kesit paragraf 0 zamaninda baslamali: " + k[0].bas);
  assert.ok(Math.abs(k[1].bas - (s.paragrafBaslangic[3] - 0.25)) < 0.6, "ikinci kesit paragraf 3'te: " + k[1].bas + " vs " + s.paragrafBaslangic[3]);
  assert.match(r.stdout, /final SRT/);
});

test("shorts-kes: tasan/gecersiz kesit digerlerini engellemez; exit 1; cikti .part'siz", { skip }, async () => {
  const kes = path.join(J.dizin, "ks.json");
  fs.writeFileSync(kes, JSON.stringify([{ ad: "iyi bir kesit", bas: 1, sure: 5 }, { ad: "tasan", bas: 20, sure: 500 }, { ad: "nan", bas: "x", sure: 3 }, { ad: "iyi2", bas: 2, sure: 4 }]));
  const r = await fik.betikCalistir("shorts-kes.cjs", ["a1", kes]);
  assert.equal(r.kod, 1, r.stdout + r.stderr);
  assert.equal((r.stderr.match(/✗ Kesit/g) || []).length, 2, r.stderr);
  const kl = path.join(J.dizin, "Shorts");
  const dosyalar = fs.readdirSync(kl).sort();
  assert.deepEqual(dosyalar, ["01-iyi-bir-kesit.mp4", "04-iyi2.mp4"]);
  const b = goruntuBoyutu(path.join(kl, dosyalar[0]));
  assert.deepEqual([b.width, b.height], [1080, 1920]);
  assert.ok(Math.abs(fik.sureOlc(path.join(kl, dosyalar[0])) - 5) < 0.3);
  // hepsi iyiyse exit 0
  fs.writeFileSync(kes, JSON.stringify([{ ad: "tek", bas: 1, sure: 3 }]));
  const r2 = await fik.betikCalistir("shorts-kes.cjs", ["a1", kes]);
  assert.equal(r2.kod, 0, r2.stdout + r2.stderr);
});

test("marka-yap: ozel karakterli ad, rozet, banner yazisi guvenli alanda; PNG>5.5MB ise JPG", { skip }, async () => {
  const cikis = path.join(kok, "marka-cikti");
  const r = await fik.betikCalistir("marka-yap.js", ["Bob's: 100% Facts", "Bilim: Basitçe", cikis, "--rozet", "BF", "--dil", "tr"],
    { env: { MARKA_GORSEL: path.join(J.dizin, "Visuals") } });
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const dosyalar = fs.readdirSync(cikis);
  assert.ok(dosyalar.some(d => /^Profile Picture 1024x1024\./.test(d)) && dosyalar.some(d => /^Banner 2560x1440\./.test(d)));
  assert.ok(!fs.existsSync(path.join(cikis, ".tmp")));
  const b = goruntuBoyutu(path.join(cikis, dosyalar.find(d => /^Banner/.test(d))));
  assert.deepEqual([b.width, b.height], [2560, 1440]);
  assert.ok(fs.statSync(path.join(cikis, dosyalar.find(d => /^Banner/.test(d)))).size <= 5.5 * 1024 * 1024 + 1);
  // gorsel yoksa exit 4
  const r2 = await fik.betikCalistir("marka-yap.js", ["X", "Y", path.join(kok, "marka2")], { env: { MARKA_GORSEL: path.join(kok, "yok-klasor") } });
  assert.equal(r2.kod, 4, r2.stdout + r2.stderr);
  assert.match(r2.stderr, /En az 2 görsel gerekiyor/);
});

test("vs-yap: ozel karakterli isimlerle uretir; gecersiz vs.json exit 2; gorsel yoksa exit 4", { skip }, async () => {
  const d = path.join(kok, "vs1"); fs.mkdirSync(path.join(d, "Images"), { recursive: true });
  fik.ff(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=1", "-frames:v", "1", path.join(d, "Images", "ust.jpg")]);
  fik.ff(["-f", "lavfi", "-i", "mandelbrot=s=640x360:r=1", "-frames:v", "1", path.join(d, "Images", "alt.jpg")]);
  const vs = { surum: 1, introSure: 1.5, olcuSure: 1.5, sonSure: 2, ust: { ad: "Bob's: LION", renk: "FF5A36" }, alt: { ad: "100% TIGER", renk: "36A3FF" },
    olculer: [{ ad: "SPEED: km/h", ustDeger: 80, ustMetin: "80 km/h", altDeger: 65, altMetin: "65 km/h", kazanan: "ust", not: "Sprint" }], kazanan: "alt", sonuc: "Tiger wins: 100%", sonuc2: "close" };
  fs.writeFileSync(path.join(d, "vs.json"), JSON.stringify(vs));
  const r = await fik.betikCalistir("vs-yap.js", ["vs1"], { zamanAsimiMs: 280000 });
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const mp4 = path.join(d, "Videos", "vs1.mp4");
  assert.ok(Math.abs(fik.sureOlc(mp4) - (1.5 + 1.5 + 2)) < 0.4);
  assert.deepEqual(fs.readdirSync(path.join(d, "Videos")), ["vs1.mp4"]);
  assert.ok(!fs.existsSync(path.join(d, "_tmp")));
  // gecersiz vs.json
  fs.writeFileSync(path.join(d, "vs.json"), JSON.stringify({ ust: { ad: "x", renk: "zz" }, alt: {}, olculer: [], kazanan: "orta" }));
  const r2 = await fik.betikCalistir("vs-yap.js", ["vs1"]);
  assert.equal(r2.kod, 2, r2.stdout + r2.stderr);
  assert.match(r2.stderr, /vs\.json geçersiz/);
  // gorsel yok
  fs.writeFileSync(path.join(d, "vs.json"), JSON.stringify(vs)); fs.rmSync(path.join(d, "Images", "alt.jpg"));
  const r3 = await fik.betikCalistir("vs-yap.js", ["vs1"]);
  assert.equal(r3.kod, 4, r3.stdout + r3.stderr);
});

test("geri-sayim.js: 5 sn, sesli, .part'siz; gecersiz boyut exit 2", { skip }, async () => {
  const out = path.join(kok, "gs", "gs.mp4");
  const r = await fik.betikCalistir("geri-sayim.js", [out, "320", "180"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.ok(Math.abs(fik.sureOlc(out) - 5) < 0.2);
  assert.deepEqual(fs.readdirSync(path.dirname(out)), ["gs.mp4"]);
  const r2 = await fik.betikCalistir("geri-sayim.js", [out, "10", "10"]);
  assert.equal(r2.kod, 2, r2.stdout + r2.stderr);
});

test("komut satiri uyumu: <is> zorunlu (exit 2), olmayan is exit 2, bilinen eski cagri bicimleri calisir", { skip }, async () => {
  let r = await fik.betikCalistir("video-yap.js", []);
  assert.equal(r.kod, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /✗ Kullanım: node video-yap\.js <iş-adı>/);
  r = await fik.betikCalistir("video-yap.js", ["yok-boyle-is"]);
  assert.equal(r.kod, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /İş bulunamadı/);
  r = await fik.betikCalistir("video-yap.js", ["../kacis"]);
  assert.equal(r.kod, 2, r.stdout + r.stderr);                       // yol gecisi reddedilir
  for (const betik of ["kapak-yap.js", "yayin-paketi.js", "vs-yap.js", "shorts-kes.cjs", "kesit-bul.cjs"]) {
    r = await fik.betikCalistir(betik, []);
    assert.equal(r.kod, 2, betik + ": " + r.stdout + r.stderr);
  }
});

test("ff-yol.js dogrudan calistirilinca yollari yazar, 0 ile cikar (yoksa 2 + kurulum talimati)", { skip }, () => {
  const r = spawnSync(process.execPath, [path.join(fik.KOK, "ff-yol.js")], { encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ffmpeg/i);
});
