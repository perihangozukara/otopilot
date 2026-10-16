// lib/senaryo-kart.js — formul-kart.js ve prompt-kart.js icin ortak parcalar.
//
// Kartlar ffmpeg ile tek karelik JPG olarak uretilir. Metin lib/yazi.js uzerinden (textfile) gider,
// boylece tirnak, iki nokta, yuzde ve ters egik cizgi filtreyi bozmaz; font yolu platforma gore secilir.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const ortak = require("./ortak");

const { OrtakHata, CIKIS } = ortak;

// Hedef klasor / dosya adi bileseni: konu.json'dan gelir, yola girer. konuDogrula da ayni kurali uygular;
// burada ikinci kez denetlenir (betik tek basina da cagrilabilir).
const AD_RE = /^[A-Za-z0-9 _-]{1,40}$/;
function adDogrula(deger, alan) {
  if (typeof deger !== "string" || !AD_RE.test(deger))
    throw new OrtakHata("konu_gecersiz", "konu.json: " + alan + " yalnızca harf, rakam, boşluk, tire ve alt çizgi içerebilir (1-40 karakter).",
      { cikis: CIKIS.GIRDI, cozum: "Panelde Ham ayarlar kutusundan '" + alan + "' değerini düzelt (nokta ve eğik çizgi yasak)." });
  return deger;
}

function metinDogrula(deger, alan, maks) {
  if (deger === undefined || deger === null) return "";
  if (typeof deger !== "string" || deger.length > (maks || 300))
    throw new OrtakHata("konu_gecersiz", "konu.json: " + alan + " en çok " + (maks || 300) + " karakterlik bir metin olmalı.",
      { cikis: CIKIS.GIRDI, cozum: "Panelde Ham ayarlar kutusundan '" + alan + "' alanını kısalt." });
  return deger;
}

// Zemin icin mevcut gorsellerden ilkini kullan (yoksa duz koyu). _eski-* ve kart klasorleri atlanir.
function arkaPlanBul(visDizin, atlanan) {
  if (!fs.existsSync(visDizin)) return null;
  const klasorler = fs.readdirSync(visDizin, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith("_") && !(atlanan || []).includes(d.name))
    .map(d => d.name)
    .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b));
  for (const k of klasorler) {
    const dosyalar = fs.readdirSync(path.join(visDizin, k)).filter(x => /\.(jpe?g|png)$/i.test(x)).sort();
    if (dosyalar.length) return path.join(visDizin, k, dosyalar[0]);
  }
  return null;
}

// ffmpeg'i calistirir; cikti once .part dosyasina yazilir, basarida yeniden adlandirilir.
// "-threads 1" (cikis kodlayicisi icin) ZORUNLU DEGIL gibi gorunur ama: bellek kisitli makinede ya da ayni anda baska
// ffmpeg calisirken mjpeg kodlayicisinin kare-iplik baslatmasi "ff_frame_thread_encoder_init failed: Cannot allocate memory"
// ile dusuyor ve tek karelik kart "Nothing was written into output file" diye uretilemiyordu (OLCULDU: 8 paralel ffmpeg
// altinda 160 denemenin 134'u basarisiz; -threads 1 ile 0'i). Tek kare icin iplik zaten gereksiz.
function karePng(ff, onArgs, vf, cikti, zamanAsimiMs) {
  const part = cikti.replace(/(\.[A-Za-z0-9]+)$/, ".part$1");
  try {
    execFileSync(ff, ["-y", ...onArgs, "-vf", vf, "-frames:v", "1", "-q:v", "2", "-threads", "1", part],
      { stdio: ["ignore", "ignore", "pipe"], timeout: zamanAsimiMs || 120000, windowsHide: true });
    fs.renameSync(part, cikti);
  } catch (e) {
    try { fs.unlinkSync(part); } catch (e2) { /* yoktu */ }
    const hata = String((e.stderr && e.stderr.toString()) || e.message || "").split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");
    throw new OrtakHata("kart_uretilemedi", "Kart görseli üretilemedi (" + path.basename(cikti) + ").",
      { cikis: CIKIS.GENEL, cozum: "ffmpeg kurulu mu kontrol et; kart metnindeki alanlar çok uzunsa kısalt.", detay: hata });
  }
}

function geciciDizin(is, ad) {
  const d = path.join(ortak.isDizin(is), "_tmp", ad + "-" + process.pid);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function geciciTemizle(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* kalirsa partTemizle/--temiz siler */ }
  // bos _tmp klasorunu da kaldir (R dosya sayimini bozmasin)
  try { fs.rmdirSync(path.dirname(d)); } catch (e) { /* dolu ya da yok */ }
}

const accent = konu => "0x" + String((konu && konu.vurguRenk) || "6FD8FF").toUpperCase();

module.exports = { AD_RE, adDogrula, metinDogrula, arkaPlanBul, karePng, geciciDizin, geciciTemizle, accent };
