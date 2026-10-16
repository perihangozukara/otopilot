// lib/render-ses.js testleri: seslendirme gecerlilik kurallari (sessiz kayma YOK) ve ornek-kesin zaman cizelgesi.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const fik = require("./render-fikstur");
const kok = fik.ortamKur();
const S = require("../lib/render-ses");
const ortak = require("../lib/ortak");
const ffvar = fik.ffmpegVarMi();

test.after(() => fik.temizle(kok));

// ffmpeg gerektirmeyen iskelet: bos "mp3" dosyalari + zamanlama.json
function iskelet(ad, paragraflar, secenek) {
  const o = Object.assign({ zamanlama: true, parcaNo: null, ozet: null }, secenek || {});
  const voice = path.join(kok, ad, "Voice"), parts = path.join(voice, "parts");
  fs.mkdirSync(parts, { recursive: true });
  fs.writeFileSync(path.join(voice, "SESLENDIRME-TAM-METIN.txt"), paragraflar.join("\n\n") + "\n");
  const nolar = o.parcaNo || paragraflar.map((_, i) => i);
  nolar.forEach(i => fs.writeFileSync(path.join(parts, String(i).padStart(3, "0") + ".mp3"), "x"));
  if (o.zamanlama) fs.writeFileSync(path.join(voice, "zamanlama.json"), JSON.stringify({ surum: 1, metinOzeti: o.ozet || ortak.paragrafOzeti(paragraflar),
    dil: "en", ses: "t", motor: "t", hiz: "+0%", bosluk: 0.35, paragrafSayisi: paragraflar.length, toplamSn: 10,
    paragraflar: paragraflar.map((_, i) => ({ no: i, dosya: "parts/" + String(i).padStart(3, "0") + ".mp3", sureSn: 1, baslangicSn: i * 1.35 })) }));
  return voice;
}

test("parcalariBul: guncel zamanlama.json kabul edilir", () => {
  const p = ["a b c", "d e f", "g h i"];
  const v = iskelet("s1", p);
  const r = S.parcalariBul(v, S.kanonikParagraflar(v));
  assert.equal(r.kaynak, "zamanlama");
  assert.equal(r.parcalar.length, 3);
  assert.equal(r.bosluk, 0.35);
});

test("parcalariBul: senaryo degismis -> 'Seslendirme guncel degil' cikis 4", () => {
  const v = iskelet("s2", ["a b c", "d e f"], { ozet: ortak.paragrafOzeti(["eski metin", "d e f"]) });
  assert.throws(() => S.parcalariBul(v, S.kanonikParagraflar(v)), e => e.kod === "ses_eski" && e.cikis === 4 && /güncel değil: seslendirmeyi yeniden yap/.test(e.message));
});

test("parcalariBul: parca dosyasi eksik / paragraf sayisi farkli -> hata", () => {
  const v = iskelet("s3", ["a", "b", "c"]);
  fs.rmSync(path.join(v, "parts", "001.mp3"));
  assert.throws(() => S.parcalariBul(v, S.kanonikParagraflar(v)), e => e.kod === "ses_eski" && e.cikis === 4);
  // paragraf sayisi farkli: metne paragraf eklendi
  const v2 = iskelet("s3b", ["a", "b"]);
  fs.writeFileSync(path.join(v2, "SESLENDIRME-TAM-METIN.txt"), "a\n\nb\n\nc\n");
  assert.throws(() => S.parcalariBul(v2, S.kanonikParagraflar(v2)), e => e.cikis === 4);
});

test("parcalariBul (zamanlama.json yok, eski is): 0..N-1 kesintisiz olmali; artik/delik parca hata", () => {
  const v = iskelet("s4", ["a", "b", "c"], { zamanlama: false });
  assert.equal(S.parcalariBul(v, S.kanonikParagraflar(v)).kaynak, "eski");
  fs.writeFileSync(path.join(v, "parts", "003.mp3"), "x");                       // eski artik parca
  assert.throws(() => S.parcalariBul(v, S.kanonikParagraflar(v)), e => e.kod === "ses_eski" && /uyuşmuyor/.test(e.detay));
  fs.rmSync(path.join(v, "parts", "003.mp3"));
  fs.rmSync(path.join(v, "parts", "001.mp3"));                                   // delik: 000, 002
  fs.writeFileSync(path.join(v, "parts", "003.mp3"), "x");
  assert.throws(() => S.parcalariBul(v, S.kanonikParagraflar(v)), e => e.kod === "ses_eski" && /eksik: 2/.test(e.detay));
});

test("parcalariBul: parca numarasi sayisal okunur (parseInt), leksikografik degil", () => {
  const p = Array.from({ length: 12 }, (_, i) => "p" + i);
  const v = iskelet("s5", p, { zamanlama: false });
  const r = S.parcalariBul(v, S.kanonikParagraflar(v));
  assert.deepEqual(r.parcalar.map(x => x.no), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("kanonikParagraflar: bos metin -> cikis 2 (senaryo yok)", () => {
  const voice = path.join(kok, "s6", "Voice"); fs.mkdirSync(voice, { recursive: true });
  fs.writeFileSync(path.join(voice, "SESLENDIRME-TAM-METIN.txt"), "\n\n  \n");
  assert.throws(() => S.kanonikParagraflar(voice), e => e.kod === "senaryo_yok" && e.cikis === 2);
});

test("sesHazirla: orneklerden kesin sure ve baslangic; baslangic[i] = sum(sure)+i*bosluk", { skip: !ffvar && "ffmpeg yok" }, async () => {
  const j = fik.isKur(kok, { ad: "sh1", paragraf: 5 });
  const ses = await S.sesHazirla({ is: "sh1", dizin: j.dizin }, path.join(kok, "sh1-anlatim.wav"));
  assert.equal(ses.N, 5);
  let beklenen = 0;
  for (let i = 0; i < 5; i++) {
    assert.ok(Math.abs(ses.baslangic[i] - beklenen) < 1e-9, "baslangic " + i);
    beklenen += ses.sure[i] + 0.35;
  }
  assert.ok(Math.abs(ses.toplam - (beklenen - 0.35)) < 1e-9);
  // wav'in gercek suresi = toplam (ornek-kesin)
  assert.ok(Math.abs(fik.sureOlc(ses.wav) - ses.toplam) < 0.01, fik.sureOlc(ses.wav) + " vs " + ses.toplam);
  // SE'nin olcumuyle uyumlu (flite mp3 tahmini sapmasi < 0.3 sn/parca)
  j.zParca.forEach((z, i) => assert.ok(Math.abs(z.sureSn - ses.sure[i]) < 0.3, "parca " + i));
  assert.ok(ses.kelimeler && ses.kelimeler.length === 5);
  assert.equal(ses.kaynak, "zamanlama");
});
