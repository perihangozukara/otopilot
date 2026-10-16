// INEN GORSELI DOGRULAR (GO grubu): sihirli bayt (JPEG/PNG), GERCEK piksel boyutu, cozunurluk esigi.
// API'nin soyledigi en/boy'a guvenilmez; dosyanin kendi basligindan okunur (EXIF donusu dahil).
// Hicbir dis bagimlilik yok (ffmpeg/ffprobe cagirmaz); saf fonksiyonlar, test edilebilir.
"use strict";
const crypto = require("crypto");

const MIN_UZUN_KENAR = 1280;          // sozlesme: uzun kenar >=1280 zorunlu
const TERCIH_UZUN_KENAR = 1920;       // >=1920 tercih
const MIN_BAYT = 3000;                // bundan kucuk dosya gorsel degildir (hata sayfasi vb.)
const MAKS_PIKSEL = 100e6;            // 100 MP ustu: ffmpeg'i bellek darliginda birakir

const SOF = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);

// "jpg" | "png" | null
function sihirliBayt(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return "png";
  return null;
}

// APP1/Exif icinden yon (1-8); yoksa 1
function exifYon(b, bas, uzunluk) {
  if (uzunluk < 14 || b.toString("latin1", bas, bas + 4) !== "Exif") return 1;
  const t = bas + 6;                                        // TIFF baslangici
  const le = b.toString("latin1", t, t + 2) === "II";
  const u16 = p => (le ? b.readUInt16LE(p) : b.readUInt16BE(p));
  const u32 = p => (le ? b.readUInt32LE(p) : b.readUInt32BE(p));
  try {
    const ifd = t + u32(t + 4);
    const n = u16(ifd);
    for (let i = 0; i < n && i < 64; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > b.length) break;
      if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
    }
  } catch (err) { /* bozuk EXIF: yok say */ }
  return 1;
}

// {en, boy} (gorunen yon, EXIF donusu uygulanmis) | null
function boyutOku(b, tur) {
  tur = tur || sihirliBayt(b);
  if (tur === "png") {
    if (b.length < 24 || b.toString("latin1", 12, 16) !== "IHDR") return null;
    const en = b.readUInt32BE(16), boy = b.readUInt32BE(20);
    return en > 0 && boy > 0 ? { en, boy } : null;
  }
  if (tur === "jpg") {
    let i = 2, yon = 1;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      while (i < b.length && b[i] === 0xFF) i++;            // dolgu baytlari
      const m = b[i];
      i++;
      if (m === undefined) break;
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) continue;     // uzunluksuz isaretler
      if (m === 0xD9 || m === 0xDA) break;                                   // veri basliyor
      if (i + 2 > b.length) break;
      const len = b.readUInt16BE(i);
      if (len < 2) break;
      if (m === 0xE1 && i + len <= b.length) yon = exifYon(b, i + 2, len - 2);
      if (SOF.has(m)) {
        if (i + 7 > b.length) return null;
        const boy = b.readUInt16BE(i + 3), en = b.readUInt16BE(i + 5);
        if (!en || !boy) return null;
        return yon >= 5 ? { en: boy, boy: en } : { en, boy };
      }
      i += len;
    }
    return null;
  }
  return null;
}

// Tek giris noktasi.
//   secenek: {minUzunKenar, maksBayt}
//   -> {tamam, neden, tur, uzanti, en, boy, bayt, sha1}
function dogrula(b, secenek) {
  const o = secenek || {};
  const minKenar = o.minUzunKenar !== undefined ? o.minUzunKenar : MIN_UZUN_KENAR;
  if (!Buffer.isBuffer(b) || b.length < MIN_BAYT) return { tamam: false, neden: "dosya çok küçük (görsel değil)" };
  if (o.maksBayt && b.length > o.maksBayt) return { tamam: false, neden: "dosya çok büyük" };
  const tur = sihirliBayt(b);
  if (!tur) return { tamam: false, neden: "görsel değil (JPEG/PNG değil; HTML hata sayfası, WebP veya SVG olabilir)" };
  const d = boyutOku(b, tur);
  if (!d) return { tamam: false, neden: "görselin boyutu okunamadı (bozuk dosya)" };
  const sonuc = { tamam: true, tur, uzanti: tur === "png" ? ".png" : ".jpg", en: d.en, boy: d.boy, bayt: b.length,
                  sha1: crypto.createHash("sha1").update(b).digest("hex") };
  if (d.en * d.boy > MAKS_PIKSEL) return Object.assign(sonuc, { tamam: false, neden: "çözünürlük aşırı yüksek (" + d.en + "x" + d.boy + ")" });
  if (Math.max(d.en, d.boy) < minKenar)
    return Object.assign(sonuc, { tamam: false, neden: "çözünürlük düşük (" + d.en + "x" + d.boy + ", en az " + minKenar + " px gerekli)" });
  return sonuc;
}

module.exports = { sihirliBayt, boyutOku, dogrula, MIN_UZUN_KENAR, TERCIH_UZUN_KENAR, MIN_BAYT, MAKS_PIKSEL };
