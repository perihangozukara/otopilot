// lib/yazi.js testleri: font yolu, guvenli metin dosyasi, sigdirma, satirlama ve gercek ffmpeg ile
// ozel karakterli (tek tirnak, iki nokta, yuzde, ters egik cizgi, virgul, koseli parantez) drawtext.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const fik = require("./render-fikstur");
const kok = fik.ortamKur();
const Y = require("../lib/yazi");
const ffvar = fik.ffmpegVarMi();

test.after(() => fik.temizle(kok));

test("satirla: kelime sarar, cok uzun kelimeyi boler, bos metin bos dizi", () => {
  assert.deepEqual(Y.satirla("bir iki üç dört", 8), ["bir iki", "üç dört"]);
  const s = Y.satirla("Pneumonoultramicroscopicsilicovolcanoconiosis kısa", 10);
  assert.ok(s.length >= 5 && s.every(l => Array.from(l).length <= 10), JSON.stringify(s));
  assert.deepEqual(Y.satirla("", 10), []);
  assert.deepEqual(Y.satirla("   ", 10), []);
});

test("sigdir: genislige sigmayinca punto kuculur, alt sinir 12", () => {
  assert.equal(Y.sigdir("AB", 1000, 120), 120);
  const kucuk = Y.sigdir("KANAL ADI ÇOK UZUN BİR KANAL ADI", 600, 120);
  assert.ok(kucuk < 120 && kucuk >= 12);
  assert.equal(Y.sigdir("x".repeat(500), 100, 80), 12);
});

test("kacisliYol: iki nokta ve tek tirnak kacirilir, ters egik cizgi / olur", () => {
  assert.equal(Y.kacisliYol("C:\\Windows\\Fonts\\a.ttf"), "C\\:/Windows/Fonts/a.ttf");
  assert.ok(Y.kacisliYol("a'b").includes("'\\\\\\''"));
});

test("metinDosyasi: BOM'suz UTF-8, sonda satir sonu yok, ozel karakter korunur", () => {
  const d = path.join(kok, "yazi-t");
  const kacisli = Y.metinDosyasi("Bob's: 100% \\ Çğ\r\n\r\n", d, "m1");
  const yol = path.join(d, "m1.txt");
  const b = fs.readFileSync(yol);
  assert.notEqual(b[0], 0xEF);                     // BOM yok
  assert.equal(b.toString("utf8"), "Bob's: 100% \\ Çğ");
  assert.ok(kacisli.includes("m1.txt"));
});

test("fontYolu: tum turler platformda bulunur (ya da font_yok cikis 2)", () => {
  for (const t of Y.TURLER) {
    try { const f = Y.fontDosyasi(t); assert.ok(fs.existsSync(f), t); }
    catch (e) { assert.equal(e.kod, "font_yok"); assert.equal(e.cikis, 2); }
  }
  assert.throws(() => Y.fontDosyasi("yok-tur"), e => e.kod === "font_yok" && e.cikis === 2);
});

test("drawtext: ozel karakterli metinler ffmpeg'de gecer", { skip: !ffvar && "ffmpeg yok" }, () => {
  const FF = fik.FF();
  const d = path.join(kok, "a'b,c[d];e%f g");       // klasor adinin kendisi de ozel karakterli
  fs.mkdirSync(d, { recursive: true });
  for (const m of ["Bob's Facts", "Bilim: Basitçe", "30% daha hızlı", "Ters \\ eğik", "ÇĞİÖŞÜ çğıöşü", "a,b;c[d]", "100% 'x': \\n"]) {
    const vf = Y.drawtext({ font: "kalin", metin: m, dizin: d, ad: "t", boyut: 28, renk: "white" });
    execFileSync(FF, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=480x90:d=0.1", "-vf", vf,
      "-frames:v", "1", path.join(d, "o.png")], { stdio: "pipe", windowsHide: true });
    assert.ok(fs.statSync(path.join(d, "o.png")).size > 100, m);
  }
});
