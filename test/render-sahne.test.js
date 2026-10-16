// lib/render-sahne.js testleri: sayisal siralama (100+ sahne), klip plani degismezleri, manifest kapsami,
// odunc gorsel, bozuk gorsel ayiklama.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const fik = require("./render-fikstur");
const kok = fik.ortamKur();
const SH = require("../lib/render-sahne");
const A = require("../lib/render-ayar");
const ortak = require("../lib/ortak");
const ffvar = fik.ffmpegVarMi();

test.after(() => fik.temizle(kok));

test("dogalSirala: eski 2 haneli ve yeni 3 haneli klasorler sayisal oneke gore dizilir (sahne 100 sahne 11'den once gelmez)", () => {
  const ad = ["100-x", "11-c", "010-b", "9-a", "101-y", "110-z", "02-q"];
  assert.deepEqual(ad.slice().sort(SH.dogalSirala), ["02-q", "9-a", "010-b", "11-c", "100-x", "101-y", "110-z"]);
  // duz .sort() YANLIS olurdu:
  assert.notDeepEqual(ad.slice().sort(), ad.slice().sort(SH.dogalSirala));
});

test("klasordenTopla: 130 sahne klasoru sayisal sirayla gelir", () => {
  const vis = path.join(kok, "kt", "Visuals");
  const hepsi = [];
  for (let i = 1; i <= 130; i++) {
    const k = String(i).padStart(i < 100 ? 2 : 3, "0") + "-s";     // 01..99 iki, 100+ uc hane (eski + yeni karisik)
    fs.mkdirSync(path.join(vis, k), { recursive: true });
    fs.writeFileSync(path.join(vis, k, "01.jpg"), "x");
    fs.writeFileSync(path.join(vis, k, "02.jpg"), "x");
    hepsi.push(k);
  }
  const r = SH.klasordenTopla(vis);
  assert.equal(r.length, 260);
  const sahneNo = r.map(g => parseInt(g.ad, 10));
  for (let i = 1; i < sahneNo.length; i++) assert.ok(sahneNo[i] >= sahneNo[i - 1], "sira bozuk: " + sahneNo[i - 1] + " -> " + sahneNo[i]);
});

test("manifestKapsarMi: paragraf 0..N-1 kesintisiz ve sirali ortulmeli", () => {
  assert.equal(SH.manifestKapsarMi([{ paragraflar: [0, 1] }, { paragraflar: [2] }], 3), true);
  assert.equal(SH.manifestKapsarMi([{ paragraflar: [0, 1] }, { paragraflar: [3] }], 3), false);     // bosluk
  assert.equal(SH.manifestKapsarMi([{ paragraflar: [0] }, { paragraflar: [1] }], 3), false);        // eksik son
  assert.equal(SH.manifestKapsarMi([{ paragraflar: [1] }, { paragraflar: [0] }], 2), false);        // sira
  assert.equal(SH.manifestKapsarMi([{ paragraflar: [] }], 0), false);
});

function sahteSahneler(n, paragrafBasina, sureBasina, gorselSayisi) {
  const sahneler = []; let t = 0;
  for (let s = 0; s < n; s++) {
    t += paragrafBasina * sureBasina;
    sahneler.push({ no: s + 1, klasor: String(s + 1).padStart(3, "0") + "-s", son: t,
      gorseller: Array.from({ length: gorselSayisi }, (_, g) => ({ ad: "k" + (s + 1) + "/" + g, yol: "yol" + s + "-" + g, bayt: 1000 })) });
  }
  return sahneler;
}

test("klipPlani: 120 sahnede siralama dogru; klip i anlatimin T_i anindan baslar (gecis binmesi dahil)", () => {
  const ctx = A.ayarCoz ? { FPS: 30, cfKare: 24, MAX_L: 11 } : null;
  const sahneler = sahteSahneler(120, 2, 6, 2);               // 120 sahne, 12 sn'lik, 2 gorsel
  const kuyruk = 24;
  const klipler = SH.klipPlani(ctx, sahneler, kuyruk);
  assert.equal(klipler.length, 240);
  // sahne sirasi: no azalmaz (100. sahne 11.'den once gelmemeli)
  for (let i = 1; i < klipler.length; i++) assert.ok(klipler[i].sahne >= klipler[i - 1].sahne);
  // zaman cizelgesi degismezi: Sum_{j<i} kare_j - i*cf == basKare_i
  let toplam = 0;
  klipler.forEach((k, i) => {
    assert.equal(toplam - i * ctx.cfKare, k.basKare, "klip " + i);
    toplam += k.kare;
    assert.ok(k.kare >= ctx.cfKare);
  });
  const son = klipler[klipler.length - 1];
  assert.equal(son.kare, (son.sonKare - son.basKare) + kuyruk);
  assert.equal(son.sonKare, Math.round(sahneler[119].son * 30));                    // govde = anlatim suresi
  // her klip sahnesinin zaman araligi icinde
  for (const k of klipler) { assert.ok(k.sonKare > k.basKare); }
  // zoom yonu sirayla degisir
  assert.equal(klipler[0].zin, true); assert.equal(klipler[1].zin, false);
});

test("klipPlani: cok uzun sahne ayni gorselle tekrarlanir (MAX_L), kisa sahnede gorsel sayisi azalir", () => {
  const ctx = { FPS: 30, cfKare: 12, MAX_L: 6 };
  const uzun = [{ no: 1, klasor: "001", son: 60, gorseller: [{ ad: "a", yol: "a", bayt: 1 }] }];
  const k1 = SH.klipPlani(ctx, uzun, 12);
  assert.ok(k1.length >= 4 && k1.length <= 4 * 1, "60 sn / 1 gorsel: " + k1.length);       // en cok 4x tekrar
  assert.ok(k1.every(k => k.ad === "a"));
  const kisa = [{ no: 1, klasor: "001", son: 2.5, gorseller: ["a", "b", "c", "d"].map(x => ({ ad: x, yol: x, bayt: 1 })) }];
  const k2 = SH.klipPlani(ctx, kisa, 12);
  assert.ok(k2.length <= 2, "2.5 sn'ye 4 gorsel sigmaz: " + k2.length);
});

test("esitKlipPlani (eski yol): esit sure, listeyi tekrarlar, toplam anlatim suresi kadar", () => {
  const ctx = { FPS: 30, cfKare: 24, CF: 0.8, MAX_L: 11 };
  const ses = { toplam: 100 };
  const gor = ["a", "b", "c"].map(x => ({ ad: x, yol: x, bayt: 1 }));
  const r = SH.esitKlipPlani(ctx, ses, gor, 24);
  assert.ok(r.klipler.length > 3 && r.klipler.length <= 12);
  assert.equal(r.klipler[r.klipler.length - 1].sonKare, 3000);
});

// ---- gercek dosyalarla (ffprobe) ----
function sesSahte(N, sure) { const baslangic = []; for (let i = 0; i < N; i++) baslangic.push(i * (sure + 0.35)); return { N, baslangic, sure: Array(N).fill(sure), toplam: N * sure + (N - 1) * 0.35, ozet: "x" }; }

test("sahneleriTopla: gorseli olmayan sahne komsudan odunc alir, bozuk gorsel ayiklanir", { skip: !ffvar && "ffmpeg yok" }, async () => {
  const j = fik.isKur(kok, { ad: "sj1", paragraf: 6, sahneBasina: 2, gorselBasina: 2 });
  const ctx = A.ayarCoz("sj1");
  const vis = path.join(j.dizin, "Visuals");
  // sahne 2'nin tum gorsellerini sil, sahne 3'un ilkini HTML ile boz
  fs.rmSync(path.join(vis, "002-sahne", "01.jpg")); fs.rmSync(path.join(vis, "002-sahne", "02.jpg"));
  fs.writeFileSync(path.join(vis, "003-sahne", "01.jpg"), "<!DOCTYPE html><html>429 Too Many Requests</html>".repeat(20));
  const r = await SH.sahneleriTopla(ctx, sesSahte(6, 5));
  assert.equal(r.mod, "manifest");
  assert.equal(r.sahneler.length, 3);
  assert.ok(r.sahneler[1].odunc, "sahne 2 odunc almali");
  assert.equal(r.sahneler[1].gorseller.length, 1);
  assert.ok(r.gecersiz.some(g => g.ad.endsWith("003-sahne/01.jpg")), JSON.stringify(r.gecersiz));
  assert.equal(r.sahneler[2].gorseller.length, 1);
  assert.ok(r.uyarilar.some(u => /Sahne 2/.test(u)));
  // sahne araliklari: son = son paragrafin bitisi; ilk sahne 0'dan baslar, sonrakiler oncekinin sonundan
  assert.equal(r.sahneler[0].bas, 0);
  assert.ok(Math.abs(r.sahneler[1].bas - r.sahneler[0].son) < 1e-9);
  assert.ok(Math.abs(r.sahneler[2].son - sesSahte(6, 5).toplam) < 1e-9);
});

test("sahneleriTopla: tum gorseller bozuksa 'Gorsel X bozuk, panelden sil' (cikis 4)", { skip: !ffvar && "ffmpeg yok" }, async () => {
  const j = fik.isKur(kok, { ad: "sj2", paragraf: 2, sahneBasina: 2, gorselBasina: 1 });
  const ctx = A.ayarCoz("sj2");
  fs.writeFileSync(path.join(j.dizin, "Visuals", "001-sahne", "01.jpg"), "<html>hata</html>");
  await assert.rejects(() => SH.sahneleriTopla(ctx, sesSahte(2, 5)), e => e.cikis === 4 && /bozuk, panelden sil/.test(e.message) && /01\.jpg/.test(e.message));
  // hic gorsel yoksa
  fs.rmSync(path.join(j.dizin, "Visuals", "001-sahne", "01.jpg"));
  await assert.rejects(() => SH.sahneleriTopla(ctx, sesSahte(2, 5)), e => e.cikis === 4 && e.kod === "gorsel_yok");
});

test("sahneleriTopla: manifest paragraflari ortmuyorsa eski yola duser ve uyarir", { skip: !ffvar && "ffmpeg yok" }, async () => {
  const j = fik.isKur(kok, { ad: "sj3", paragraf: 4, sahneBasina: 2, gorselBasina: 1 });
  const ctx = A.ayarCoz("sj3");
  const mYol = path.join(j.dizin, "Visuals", "manifest.json");
  const m = JSON.parse(fs.readFileSync(mYol, "utf8")); m.sahneler[1].paragraflar = [3];            // 2. paragraf eksik
  fs.writeFileSync(mYol, JSON.stringify(m));
  const r = await SH.sahneleriTopla(ctx, sesSahte(4, 5));
  assert.equal(r.mod, "eski");
  assert.ok(r.uyarilar.some(u => /uyuşmuyor/.test(u)));
  assert.equal(r.sahneler[0].gorseller.length, 2);
  // manifest hic yoksa da eski yol
  fs.rmSync(mYol);
  const r2 = await SH.sahneleriTopla(ctx, sesSahte(4, 5));
  assert.equal(r2.mod, "eski");
  void ortak;
});
