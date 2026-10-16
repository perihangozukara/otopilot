/*
 * Indirici testleri icin ortak hazirlik. server.js yuklenmeden ONCE require edilmeli:
 * ortam degiskenleri server.js yuklenirken okunur.
 *  - tum dosyalar gecici bir klasore yazilir (gercek indirilenler/, ayarlar.json, kesfet-veri.json,
 *    .env ve uretim/ klasorlerine DOKUNULMAZ)
 *  - yt-dlp yerine test/_sahte-ytdlp.cjs kullanilir: hicbir gercek siteye baglanilmaz
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'indirici-test-'));
const klasor = path.join(gecici, 'dl');
const dosyalar = {
  ayar: path.join(gecici, 'ayar.json'),
  kesfet: path.join(gecici, 'kesfet.json'),
  env: path.join(gecici, 'env.txt'),
  uretim: path.join(gecici, 'uretim'),
  mp4: path.join(gecici, 'ornek.mp4'),
  gunluk: path.join(gecici, 'sahte-ytdlp-gunluk.txt'),
  pid: path.join(gecici, 'sahte-ytdlp.pid'),
};
fs.mkdirSync(klasor, { recursive: true });
fs.writeFileSync(dosyalar.env, '');

process.env.INDIRICI_KLASOR = klasor;
process.env.INDIRICI_AYAR_DOSYASI = dosyalar.ayar;
process.env.INDIRICI_KESFET_DOSYASI = dosyalar.kesfet;
process.env.OTOMASYON_ENV_DOSYASI = dosyalar.env;
process.env.OTOMASYON_URETIM = dosyalar.uretim;
// GERCEK_YTDLP=1 ise sahte yt-dlp kullanilmaz (yalniz yerel 127.0.0.1 sunucusuna baglanan duman testi icin)
if (process.env.GERCEK_YTDLP === '1') delete process.env.YTDLP_YOL;
else process.env.YTDLP_YOL = path.join(__dirname, '_sahte-ytdlp.cjs');
process.env.SAHTE_YTDLP_MP4 = dosyalar.mp4;
process.env.SAHTE_YTDLP_GUNLUK = dosyalar.gunluk;
process.env.SAHTE_YTDLP_PID = dosyalar.pid;
delete process.env.VIDIQ_KEY;
delete process.env.INDIRICI_PORT;

function ffmpegVar() {
  const r = spawnSync('ffmpeg', ['-version'], { windowsHide: true });
  return !r.error && r.status === 0;
}

// gercek (lavfi sentetik) kucuk bir mp4: 2 sn goruntu + ses
function ornekMp4Uret(hedef) {
  if (!ffmpegVar()) { fs.writeFileSync(hedef, Buffer.alloc(4096, 7)); return false; }
  const r = spawnSync('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', hedef,
  ], { windowsHide: true });
  if (r.status !== 0) { fs.writeFileSync(hedef, Buffer.alloc(4096, 7)); return false; }
  return true;
}

function temizle() {
  try { fs.rmSync(gecici, { recursive: true, force: true }); } catch { /* acik dosya kalmis olabilir */ }
}

module.exports = { gecici, klasor, dosyalar, ffmpegVar, ornekMp4Uret, temizle };
