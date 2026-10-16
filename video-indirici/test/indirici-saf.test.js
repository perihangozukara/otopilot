'use strict';
// Saf fonksiyon testleri: sunucu acilmaz, ag/yt-dlp yok.
const ortam = require('./_ortam');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const m = require('../server.js');

test.after(() => ortam.temizle());

test('hostGecerli: yalnız localhost / 127.0.0.1 / [::1] + doğru port', () => {
  assert.equal(m.hostGecerli('localhost:4190', 4190), true);
  assert.equal(m.hostGecerli('127.0.0.1:4190', 4190), true);
  assert.equal(m.hostGecerli('[::1]:4190', 4190), true);
  assert.equal(m.hostGecerli('LOCALHOST:4190', 4190), true);
  for (const kotu of ['evil.com:4190', 'localhost:4191', 'localhost', '127.0.0.1.evil.com:4190', 'localhost:4190.evil.com', '', undefined, null, 'localhost:4190, evil.com']) {
    assert.equal(m.hostGecerli(kotu, 4190), false, String(kotu));
  }
});

test('originGecerli: yalnız kendi adresi', () => {
  assert.equal(m.originGecerli('http://localhost:4190', 4190), true);
  assert.equal(m.originGecerli('http://127.0.0.1:4190', 4190), true);
  for (const kotu of ['https://localhost:4190', 'http://evil.com', 'null', 'http://localhost:4173', 'http://localhost:4190.evil.com', '', undefined]) {
    assert.equal(m.originGecerli(kotu, 4190), false, String(kotu));
  }
});

test('linkGecerli: yalnız http(s), yerel ağ adresi / kimlik bilgisi / boşluk yok', () => {
  for (const iyi of ['https://www.youtube.com/watch?v=jNQXAC9IVRw', 'http://example.com/a', 'https://www.tiktok.com/@x/video/1', 'https://youtu.be/abc?t=5']) {
    assert.equal(m.linkGecerli(iyi), true, iyi);
  }
  for (const kotu of [
    'file:///C:/Windows/win.ini', 'javascript:alert(1)', 'ftp://x.com/a', 'data:text/html,<b>', '--exec=calc',
    'http://localhost:4173/api/anahtarlar', 'http://127.0.0.1/', 'http://127.1.2.3:80/', 'http://0.0.0.0/', 'http://[::1]/',
    'http://192.168.1.1/', 'http://10.0.0.5/', 'http://172.16.0.1/', 'http://169.254.169.254/latest', 'http://2130706433/',
    'http://foo.local/', 'http://user:pw@example.com/', 'https://example.com/a b', 'https://exa mple.com', '', 'abc', null, undefined,
    'https://example.com/' + 'a'.repeat(2100),
  ]) {
    assert.equal(m.linkGecerli(kotu), false, String(kotu).slice(0, 60));
  }
});

test('klasorDogrula: yalnız izinli kökler; .. / UNC / göreli / dış yol reddedilir', () => {
  const ok = m.klasorDogrula(path.join(ortam.klasor, 'alt', 'klasor'));
  assert.equal(ok.ok, true);
  assert.equal(m.klasorDogrula(ortam.klasor).ok, true);
  const kotuler = [
    path.join(ortam.klasor, '..', 'dis'),                 // .. ile kök dışına
    path.join(ortam.klasor, '..'),
    path.resolve(__dirname, '..'),                        // proje klasörü
    path.resolve(__dirname, '..', '..'),
    os.homedir(),
    path.join(os.homedir(), 'Documents'),
    'relative/yol', '.', '..', '', '   ', '\0',
    ortam.klasor + 'X',                                   // 'dl' ile 'dlX' karışmasın
    123, null, undefined, {},
    'C:\\Windows\\System32', '\\\\sunucu\\paylasim\\x', '/etc',
  ];
  for (const k of kotuler) assert.equal(m.klasorDogrula(k).ok, false, JSON.stringify(k));
});

test('klasorDogrula: junction ile izinli kökten dışarı kaçış reddedilir (ve dışarıda klasör açılmaz)', (t) => {
  const dis = path.join(ortam.gecici, 'junction-hedef');
  fs.mkdirSync(dis, { recursive: true });
  const baglanti = path.join(ortam.klasor, 'kacis');
  try { fs.symlinkSync(dis, baglanti, 'junction'); }
  catch (e) { return t.skip('bağlantı oluşturulamadı: ' + e.code); }
  const r = m.klasorDogrula(path.join(baglanti, 'yeni'));
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(path.join(dis, 'yeni')), false, 'doğrulama dışarıda klasör yaratmamalı');
  fs.rmSync(baglanti, { recursive: true, force: true });
});

test('guvenliDosya: yalnız klasördeki, beyaz listeli uzantılı düz dosya adı', (t) => {
  const apostrof = "I can't stop [abc123]; <img src=x onerror=alert(1)> & %PATH%.mp4";
  // Windows dosya adında < > yasak: o harfleri çıkarıp kalan özel karakterleri (' ; & % [ ]) dene
  const ad = process.platform === 'win32' ? "I can't stop [abc123]; & %PATH%.mp4" : apostrof;
  fs.writeFileSync(path.join(ortam.klasor, ad), 'x');
  fs.writeFileSync(path.join(ortam.klasor, 'betik.js'), 'x');
  fs.writeFileSync(path.join(ortam.klasor, 'gizli.env'), 'x');
  fs.writeFileSync(path.join(ortam.gecici, 'dis.mp4'), 'x');
  assert.equal(m.guvenliDosya(ad), path.join(path.resolve(ortam.klasor), ad));
  const kotuler = [
    'betik.js', 'gizli.env', 'yok.mp4', '..\\dis.mp4', '../dis.mp4', '..', '.', '', 'a/b.mp4', 'a\\b.mp4',
    path.join(ortam.gecici, 'dis.mp4'), 'x.mp4\0.txt', 'x.mp4.exe', 'x.exe', 'x.bat', 'x.lnk', 'x.mp4 ',
    123, null, undefined, {}, [ad],
  ];
  for (const k of kotuler) assert.equal(m.guvenliDosya(k), null, JSON.stringify(k));
  const sembolik = path.join(ortam.klasor, 'sembolik.mp4');
  try {
    fs.symlinkSync(path.join(ortam.gecici, 'dis.mp4'), sembolik, 'file');
    assert.equal(m.guvenliDosya('sembolik.mp4'), null, 'symlink reddedilmeli');
  } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
    t.diagnostic('symlink izni yok, o alt kontrol atlandı');
  }
});

test('aralikCoz: Range başlığı', () => {
  assert.deepEqual(m.aralikCoz('bytes=0-99', 1000), { bas: 0, son: 99 });
  assert.deepEqual(m.aralikCoz('bytes=900-', 1000), { bas: 900, son: 999 });
  assert.deepEqual(m.aralikCoz('bytes=-100', 1000), { bas: 900, son: 999 });
  assert.deepEqual(m.aralikCoz('bytes=0-99999', 1000), { bas: 0, son: 999 });
  assert.equal(m.aralikCoz('bytes=1000-', 1000), 'x');
  assert.equal(m.aralikCoz('bytes=500-100', 1000), 'x');
  assert.equal(m.aralikCoz('bytes=-0', 1000), 'x');
  assert.equal(m.aralikCoz(undefined, 1000), null);
  assert.equal(m.aralikCoz('bytes=0-1,5-6', 1000), null);
  assert.equal(m.aralikCoz('items=1-2', 1000), null);
});

test('hataCevir: yt-dlp hataları Türkçe özet + çözüm', () => {
  const t = (ham) => m.hataCevir(ham).ozet;
  assert.match(t('ERROR: [generic] Unable to download webpage: getaddrinfo failed'), /İnternet/);
  assert.match(t('ERROR: [youtube] x: Private video. Sign in if you\'ve been granted access'), /özel/);
  assert.match(t('ERROR: [youtube] x: Sign in to confirm you’re not a bot'), /giriş/);
  assert.match(t('OSError: [Errno 28] No space left on device'), /Diskte yer/);
  assert.match(t('ERROR: HTTP Error 429: Too Many Requests'), /çok fazla istek/);
  assert.match(t('ERROR: Requested format is not available'), /kalite/);
  assert.match(t('ERROR: ffmpeg not found'), /ffmpeg/);
  assert.match(t('ERROR: Unsupported URL: https://x.y'), /desteklenmiyor/);
  assert.match(t('ERROR: [TikTok] 1: Unable to extract webpage video data'), /yt-dlp/);
  const bilinmeyen = m.hataCevir('ERROR: tuhaf bir şey');
  assert.equal(bilinmeyen.ozet, 'tuhaf bir şey');
  assert.equal(bilinmeyen.detay, 'tuhaf bir şey');
  assert.equal(m.hataCevir(new Error('ENOSPC: no space left')).ozet, 'Diskte yer kalmadı.');
  assert.ok(m.hataCevir(null).ozet);
});

test('formatSecici / youtubeAramaUrl / kisaltmaSayi', () => {
  assert.equal(m.formatSecici('mp3'), null);
  assert.equal(m.formatSecici('en-iyi'), 'bv*+ba/b');
  assert.match(m.formatSecici('1080'), /height<=1080/);
  assert.match(m.formatSecici('2160'), /^bv\*\[height<=2160\]/);
  const u = m.youtubeAramaUrl('kedi & köpek', 'hafta', 'kisa');
  assert.match(u, /^https:\/\/www\.youtube\.com\/results\?search_query=kedi%20%26%20k%C3%B6pek&sp=/);
  // sp: 08 03 12 <uzunluk> 08 03 10 01 18 01
  const sp = decodeURIComponent(u.split('&sp=')[1]);
  assert.equal(Buffer.from(sp, 'base64').toString('hex'), '0803120608031001' + '1801');
  assert.equal(m.kisaltmaSayi('5.3M'), 5300000);
  assert.equal(m.kisaltmaSayi('327.2K'), 327200);
  assert.equal(m.kisaltmaSayi('1,234'), 1234);
  assert.equal(m.kisaltmaSayi('abc'), 0);
});

test('igTiktokAyristir: vidIQ markdown çıktısı', () => {
  const ham = [
    '## TikTok', '**@kanal1** — "Harika bir video..."',
    '  5.3M views (2731.8x their median of 1.9K) · 258 followers · 16s',
    '  https://www.tiktok.com/@kanal1/video/7666526507522739478',
    '## Instagram', '**@kanal2** — "Reel"', '  1.2M views · 10K followers · 30s', '  reel:AbC_123-x',
    '**@kanal3** — "linksiz"', '  900K views',
  ].join('\n');
  const r = m.igTiktokAyristir(ham);
  assert.equal(r.length, 2);
  assert.equal(r[0].platform, 'tiktok');
  assert.equal(r[0].izlenme, 5300000);
  assert.equal(r[0].takipci, 258);
  assert.equal(r[0].sure, 16);
  assert.equal(r[0].url, 'https://www.tiktok.com/@kanal1/video/7666526507522739478');
  assert.equal(r[1].url, 'https://www.instagram.com/reel/AbC_123-x/');
  assert.equal(r[1].platform, 'instagram');
});
