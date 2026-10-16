// test/birim-yardim.js — birim-*.test.js ve duman.test.js icin ortak yardimcilar (test dosyasi DEGIL).
// Ag YOK (yalnizca 127.0.0.1'e baglanan yerel sahte sunucular, 4301-4399 portlari), ucretli servis YOK,
// gercek .env ve uretim/ klasorune dokunulmaz.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const KOK = path.resolve(__dirname, "..");
const PORT_ALT = 4301, PORT_UST = 4399;

// 4301-4399 araliginda bos bir porta yerel http sunucusu acar. Birden cok test dosyasi ayni anda calisabilir:
// baslangic noktasi surec numarasina gore kayar, EADDRINUSE olursa siradakini dener.
async function sunucuAc(handler, secenek) {
  const o = secenek || {};
  const aralik = PORT_UST - PORT_ALT + 1;
  const kayma = ((o.kayma !== undefined ? o.kayma : process.pid) * 7) % aralik;
  for (let i = 0; i < aralik; i++) {
    const port = PORT_ALT + ((kayma + i) % aralik);
    const sunucu = http.createServer(handler);
    const acildi = await new Promise(coz => {
      sunucu.once("error", () => coz(false));
      sunucu.listen(port, "127.0.0.1", () => coz(true));
    });
    if (acildi) {
      return { sunucu, port, url: "http://127.0.0.1:" + port,
        kapat: () => new Promise(k => { try { sunucu.closeAllConnections(); } catch (e) { /* eski node */ } sunucu.close(() => k()); }) };
    }
  }
  throw new Error("4301-4399 araliginda bos port yok");
}

// ---------------------------------------------------------------- sentetik gorsel ikilileri (ffmpeg gerektirmez)
// Gecerli bir JPEG iskeleti: SOI + (istege bagli EXIF yonu) + SOF0 (en/boy) + dolgu + EOI. Yalniz BASLIK okuyucularini sinar.
function jpegUret(en, boy, secenek) {
  const o = secenek || {};
  const parcalar = [Buffer.from([0xFF, 0xD8])];
  if (o.exifYon) {
    const tiff = Buffer.alloc(26);
    tiff.write("MM", 0, "latin1"); tiff.writeUInt16BE(0x2A, 2); tiff.writeUInt32BE(8, 4);
    tiff.writeUInt16BE(1, 8);                                                   // 1 giris
    tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(o.exifYon, 18);
    const veri = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
    const bas = Buffer.from([0xFF, 0xE1, 0, 0]);
    bas.writeUInt16BE(veri.length + 2, 2);
    parcalar.push(bas, veri);
  }
  const sof = Buffer.from([0xFF, 0xC0, 0, 17, 8, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.writeUInt16BE(boy, 5); sof.writeUInt16BE(en, 7);
  parcalar.push(sof, Buffer.alloc(o.bayt || 4000, 0x11), Buffer.from([0xFF, 0xD9]));
  return Buffer.concat(parcalar);
}

function pngUret(en, boy, bayt) {
  const imza = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write("IHDR", 4, "latin1"); ihdr.writeUInt32BE(en, 8); ihdr.writeUInt32BE(boy, 12); ihdr[16] = 8; ihdr[17] = 2;
  return Buffer.concat([imza, ihdr, Buffer.alloc(bayt || 4000, 7)]);
}

const htmlHataSayfasi = () => Buffer.from("<html><body>" + "Erisim engellendi. ".repeat(400) + "</body></html>");
const webpUret = () => Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0x20, 0x10, 0, 0]), Buffer.from("WEBPVP8 ", "latin1"), Buffer.alloc(4000, 3)]);

// ---------------------------------------------------------------- gecici ortam
// uretim/, .env ve panel-ayar.json gecici klasore yonlendirilir (gercek dosyalara ASLA dokunulmaz)
function ortamKur(onek) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), "otomasyon-birim-" + (onek || "x") + "-"));
  const o = { kok, uretim: path.join(kok, "uretim"), env: path.join(kok, ".env"), ayar: path.join(kok, "panel-ayar.json") };
  fs.mkdirSync(o.uretim, { recursive: true });
  fs.writeFileSync(o.env, "");
  process.env.OTOMASYON_URETIM = o.uretim;
  process.env.OTOMASYON_ENV_DOSYASI = o.env;
  process.env.OTOMASYON_AYAR_DOSYASI = o.ayar;
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "VIDIQ_KEY", "PEXELS_KEY", "PIXABAY_KEY", "AZURE_SPEECH_KEY"]) delete process.env[k];
  o.temizle = () => { try { fs.rmSync(kok, { recursive: true, force: true }); } catch (e) { /* windows kilidi */ } };
  return o;
}

// konsol ciktisini (console.log + stdout/stderr dizgeleri) yakalar; node:test'in ikili olay yazimlarina dokunmaz
async function yakala(fn) {
  const w = process.stdout.write.bind(process.stdout), e = process.stderr.write.bind(process.stderr), l = console.log;
  const ciktilar = [];
  process.stdout.write = (s, ...r) => (typeof s === "string" ? (ciktilar.push(s), true) : w(s, ...r));
  process.stderr.write = (s, ...r) => (typeof s === "string" ? (ciktilar.push(s), true) : e(s, ...r));
  console.log = (...a) => { ciktilar.push(a.join(" ") + "\n"); };
  try { return await fn(ciktilar); }
  finally { process.stdout.write = w; process.stderr.write = e; console.log = l; }
}

const bekle = ms => new Promise(r => setTimeout(r, ms));

module.exports = { KOK, sunucuAc, jpegUret, pngUret, htmlHataSayfasi, webpUret, ortamKur, yakala, bekle };
