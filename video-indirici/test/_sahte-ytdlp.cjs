#!/usr/bin/env node
/*
 * Test icin sahte yt-dlp. Gercek hicbir siteye baglanmaz.
 *  - --version                  -> surum yazar
 *  - --dump-single-json         -> sahte video bilgisi (url'de "fail"/"private" varsa hata)
 *  - -J (arama)                 -> sahte arama sonucu
 *  - indirme (--progress-template) -> ornek mp4'u -o sablonundaki yere kopyalar, ilerleme satirlari basar
 *    url'de "slow" varsa sonsuza dek bekler (iptal testi) ve pid'ini SAHTE_YTDLP_PID dosyasina yazar;
 *    "seli" varsa bekleme yerine milisaniyede bir ilerleme satiri basar (iptal yarisi testi)
 * Sunucunun yt-dlp'ye URL'yi "--" ile verdigini de dogrular (yoksa exit 3).
 */
'use strict';
const fs = require('fs');

const a = process.argv.slice(2);
const hata = (m, k = 1) => { process.stderr.write(m + '\n'); process.exit(k); };

if (a.includes('--version')) { console.log('2099.01.01'); process.exit(0); }

const son = a[a.length - 1];
if (a[a.length - 2] !== '--') hata('ERROR: sahte yt-dlp: URL öncesinde -- yok', 3);
if (!/^https?:\/\//.test(son)) hata('ERROR: sahte yt-dlp: geçersiz url', 3);
if (process.env.SAHTE_YTDLP_GUNLUK) fs.appendFileSync(process.env.SAHTE_YTDLP_GUNLUK, JSON.stringify(a) + '\n');

const BASLIK = 'Fake it\'s & test (x)';

if (a.includes('--dump-single-json')) {
  if (/fail/.test(son)) hata('ERROR: [generic] Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>');
  if (/private/.test(son)) hata('ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access to this video');
  // url'de PLbuyuk<N> varsa N ogeli (kuyruk siniri testi) liste doner; yoksa 2 ogeli
  const buyuk = /PLbuyuk(\d+)/.exec(son);
  const entries = buyuk
    ? Array.from({ length: Number(buyuk[1]) }, (_, i) => ({ id: 'b' + String(i).padStart(10, '0'), title: 'b' + i }))
    : [{ id: 'listeEleman1', title: 'a' }, { id: 'listeEleman2', title: 'b' }];
  console.log(JSON.stringify({
    title: BASLIK, uploader: 'Kanal "adı"', duration: 12, thumbnail: 'https://i.ytimg.com/vi/x/hq.jpg',
    entries,
  }));
  process.exit(0);
}

if (a.includes('-J')) {
  console.log(JSON.stringify({
    entries: [
      { id: 'abcdefghijk', title: 'İyi video', view_count: 5000000, duration: 30, channel: 'C' },
      { id: 'bad id!<x>', title: 'Kötü id', view_count: 9e9, duration: 5 },
      { id: 'zzzzzzzzzzz', title: 'az izlenen', view_count: 10, duration: 5 },
    ],
  }));
  process.exit(0);
}

// indirme
const klasor = a[a.indexOf('-P') + 1];
if (a.indexOf('-P') < 0 || !klasor) hata('ERROR: sahte yt-dlp: -P yok (klasör -o şablonuna gömülmemeli)', 3);
const sablon = require('path').join(klasor, a[a.indexOf('-o') + 1]);
const mp3 = a.includes('-x');
const id = (/[?&]v=([^&]+)/.exec(son) || [])[1] || 'abc123';
const cikti = sablon.replace('%(title).150B', BASLIK).replace('%(id)s', id).replace('%(ext)s', mp3 ? 'mp3' : 'mp4');
process.stdout.write('@P@10|1000|10|99\n');
if (/slow|seli/.test(son)) {
  if (process.env.SAHTE_YTDLP_PID) fs.writeFileSync(process.env.SAHTE_YTDLP_PID, String(process.pid));
  if (/seli/.test(son)) {
    // iptal yarisi testi: oldurulene kadar milisaniyede bir ilerleme satiri basar (Windows'ta taskkill asenkron,
    // surec komuttan sonra 50-200 ms daha yazar; gercek yt-dlp da ayni anda ilerleme basar)
    let n = 10;
    setInterval(() => process.stdout.write('@P@' + (n += 1) + '|1000000|1000|99\n'), 1);
  } else setInterval(() => {}, 1000);
} else {
  process.stdout.write('@P@500|1000|500|1\n');
  process.stdout.write('[Merger] Merging formats into "' + cikti + '"\n');
  if (process.env.SAHTE_YTDLP_MP4 && fs.existsSync(process.env.SAHTE_YTDLP_MP4)) fs.copyFileSync(process.env.SAHTE_YTDLP_MP4, cikti);
  else fs.writeFileSync(cikti, Buffer.alloc(2048, 1));
  process.stdout.write('@F@' + cikti + '\n');
  process.exit(0);
}
