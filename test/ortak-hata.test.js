// lib/ortak.js hataCevir — HTTP durum kodlari YALNIZ HTTP baglaminda taninir. ffmpeg ilerleme satiri ("frame=  401 fps= 30")
// eskiden 'API anahtari gecersiz' / 'servis siniri' diye cevriliyordu (@@HATA kaydi olmadan dusen video adiminin stderr kuyrugu).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const ortak = require("../lib/ortak");

const kod = e => ortak.hataCevir(e).kod;

test("hataCevir: ffmpeg ilerleme satirindaki 401/402/429/529 hata kodu SAYILMAZ", () => {
  for (const n of [401, 402, 429, 529]) {
    assert.equal(kod("frame=  " + n + " fps= 30 q=28.0 size=  " + n + "kB time=00:00:13.36 bitrate=1000kbits/s speed=2x"), "genel", String(n));
    assert.equal(kod("size=   " + n + "kB time=00:00:04." + (n % 100) + " bitrate= 800.0kbits/s"), "genel", String(n));
    assert.equal(kod("frame=" + n + " fps=30"), "genel", String(n));
    assert.equal(kod(n + " frames processed"), "genel", n + " frames");
  }
});

test("hataCevir: baglamli HTTP kodlari hala taninir (HTTP N, status N, (N), satir basi N, Error: N, nesne.status)", () => {
  assert.equal(kod("Error: 401 invalid x-api-key"), "anahtar_gecersiz");
  assert.equal(kod("HTTP 401"), "anahtar_gecersiz");
  assert.equal(kod("Pexels HTTP 429"), "limit");
  assert.equal(kod("istek limiti doldu (429, bekle 30 sn)"), "limit");
  assert.equal(kod("Claude istek sınırına takıldı (429)."), "limit");
  assert.equal(kod("status: 402"), "kredi_bitti");
  assert.equal(kod("statusCode=529"), "limit");
  assert.equal(kod("429 Too Many Requests"), "limit");
  assert.equal(kod('401 {"type":"error","error":{"type":"authentication_error"}}'), "anahtar_gecersiz");
  assert.equal(kod({ status: 401, message: "x" }), "anahtar_gecersiz");
  assert.equal(kod({ status: 402, message: "x" }), "kredi_bitti");
  assert.equal(kod({ status: 429, message: "x" }), "limit");
  assert.equal(kod({ statusCode: 529, message: "x" }), "limit");
  // metin kalibi olanlar yine tanir
  assert.equal(kod("invalid x-api-key"), "anahtar_gecersiz");
  assert.equal(kod("Your credit balance is too low"), "kredi_bitti");
  assert.equal(kod("rate limit exceeded"), "limit");
});

test("hataCevir: ffmpeg satirlari ile gercek servis hatasi ayni metinde — gercek hata kazanir, ilerleme satiri yanilmaz", () => {
  const metin = "frame=  401 fps= 30 q=28.0 size=  429kB time=00:00:13.36\nError: 429 rate limit";
  assert.equal(kod(metin), "limit");
  // yalniz ilerleme + baska hata: ilerleme sayilari karismaz
  assert.equal(kod("frame=  401 fps= 30 q=28.0 size=  429kB\nspawn ffmpeg ENOENT"), "ffmpeg_yok");
});
