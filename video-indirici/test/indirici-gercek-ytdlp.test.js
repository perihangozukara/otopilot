'use strict';
// GERCEK yt-dlp ile duman testi — ama yalniz KENDI yerel 127.0.0.1 sunucumuza baglanir (internet yok).
// Amac: sunucunun yt-dlp'ye verdigi arguman dizisi (-P klasor, "--", --print, ilerleme sablonu)
// sahte degil, gercek yt-dlp'de de calisiyor mu. yt-dlp kurulu degilse atlanir.
process.env.GERCEK_YTDLP = '1';
const ortam = require('./_ortam');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const m = require('../server.js');

let yerel, yerelPort, ytVar = false;

test.before(async () => {
  ortam.ornekMp4Uret(ortam.dosyalar.mp4);
  const veri = fs.readFileSync(ortam.dosyalar.mp4);
  yerel = http.createServer((req, res) => {
    const aralik = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const bas = aralik ? Number(aralik[1]) : 0;
    const son = aralik && aralik[2] ? Math.min(Number(aralik[2]), veri.length - 1) : veri.length - 1;
    const baslik = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': son - bas + 1 };
    if (aralik) baslik['Content-Range'] = `bytes ${bas}-${son}/${veri.length}`;
    res.writeHead(aralik ? 206 : 200, baslik);
    res.end(req.method === 'HEAD' ? undefined : veri.subarray(bas, son + 1));
  });
  await new Promise((coz) => yerel.listen(0, '127.0.0.1', coz));
  yerelPort = yerel.address().port;
  await m.baslat({ port: 0 });
  ytVar = !!m.durum().YT && !/_sahte-ytdlp/.test(JSON.stringify(m.durum().YT));
});
test.after(async () => {
  await m.kapat();
  await new Promise((coz) => yerel.close(coz));
  ortam.temizle();
});

test('gerçek yt-dlp: % ve [ ] içeren klasöre indirir, ilerleme/yol satırları ayrıştırılır', async (t) => {
  if (!ytVar) return t.skip('yt-dlp kurulu değil');
  const hedefKlasor = path.join(ortam.klasor, '100% [x] klasör');
  assert.equal(m.klasorDogrula(hedefKlasor).ok, true);
  // ayari dogrudan degistirmek yerine sunucunun kendi uc noktasini kullan
  const http2 = (govde) => new Promise((coz, red) => {
    const v = JSON.stringify(govde);
    const r = http.request({ host: '127.0.0.1', port: m.sunucu.address().port, path: '/api/ayar', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Panel-Token': m.jeton(), 'Content-Length': Buffer.byteLength(v) } }, (res) => {
      const p = []; res.on('data', (c) => p.push(c)); res.on('end', () => coz({ durum: res.statusCode, json: JSON.parse(Buffer.concat(p).toString('utf8')) }));
    });
    r.on('error', red); r.end(v);
  });
  const a = await http2({ klasor: hedefKlasor, cerez: false, kalite: 'en-iyi' });
  assert.equal(a.durum, 200, JSON.stringify(a.json));

  const is = m.isEkle('http://127.0.0.1:' + yerelPort + '/ornek-video.mp4', 'en-iyi');
  const bas = Date.now();
  while (!['bitti', 'hata', 'iptal'].includes(is.durum)) {
    if (Date.now() - bas > 90000) throw new Error('zaman aşımı, durum=' + is.durum);
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(is.durum, 'bitti', is.hata + ' | ' + is.hataDetay + ' | ' + is.gunluk.join(' / '));
  assert.ok(is.dosya, 'yt-dlp @F@ satırından dosya yolu alınmalı');
  assert.equal(path.dirname(is.dosya), hedefKlasor, 'dosya -P klasörüne inmeli');
  assert.ok(fs.existsSync(is.dosya));
  assert.ok(fs.readFileSync(is.dosya).equals(fs.readFileSync(ortam.dosyalar.mp4)), 'indirilen dosya kaynakla aynı olmalı');
  assert.equal(is.yuzde, 100);
  assert.ok(is.boyut > 0);
  assert.ok(fs.readdirSync(hedefKlasor).every((a) => !a.endsWith('.part')), 'yarım dosya kalmamalı');
});

test('gerçek yt-dlp: erişilemeyen adres Türkçe hata verir (ham yt-dlp metni değil)', async (t) => {
  if (!ytVar) return t.skip('yt-dlp kurulu değil');
  const is = m.isEkle('http://127.0.0.1:9/yok.mp4', 'en-iyi');   // 9 = discard portu, kapali
  const bas = Date.now();
  while (!['bitti', 'hata', 'iptal'].includes(is.durum)) {
    if (Date.now() - bas > 90000) throw new Error('zaman aşımı');
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(is.durum, 'hata');
  assert.match(is.hata, /İnternet bağlantısı kurulamadı/);
  assert.ok(!/ERROR:|WinError/.test(is.hata));
});

test('gerçek yt-dlp: iptal her seferinde "iptal" olarak biter (süreç ölürken basılan ilerleme satırı "hata"ya çevirmez)', async (t) => {
  if (!ytVar) return t.skip('yt-dlp kurulu değil');
  // yavas yerel sunucu: 40 MB, ~2 MB/sn (yt-dlp saniyede birkac ilerleme satiri basar); HEAD hemen cevaplanir
  const TOPLAM = 40 * 1024 * 1024;
  const yavas = http.createServer((req, res) => {
    const aralik = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const bas = aralik ? Number(aralik[1]) : 0;
    const baslik = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': TOPLAM - bas };
    if (aralik) baslik['Content-Range'] = `bytes ${bas}-${TOPLAM - 1}/${TOPLAM}`;
    res.writeHead(aralik ? 206 : 200, baslik);
    if (req.method === 'HEAD') return res.end();
    const parca = Buffer.alloc(32 * 1024, 5);
    let yazilan = 0;
    const zaman = setInterval(() => { res.write(parca); yazilan += parca.length; if (bas + yazilan >= TOPLAM) { clearInterval(zaman); res.end(); } }, 15);
    res.on('close', () => clearInterval(zaman));
  });
  await new Promise((coz) => yavas.listen(0, '127.0.0.1', coz));
  const yavasPort = yavas.address().port;
  const port = m.sunucu.address().port;
  const iptal = (id) => new Promise((coz, red) => {
    const v = JSON.stringify({ id });
    const r = http.request({ host: '127.0.0.1', port, path: '/api/iptal', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Panel-Token': m.jeton(), 'Content-Length': Buffer.byteLength(v) } }, (res) => { res.resume(); res.on('end', () => coz(res.statusCode)); });
    r.on('error', red); r.end(v);
  });
  const bekleKosul = async (kosul, ms) => { const bas = Date.now(); while (!kosul()) { if (Date.now() - bas > ms) throw new Error('zaman aşımı'); await new Promise((r) => setTimeout(r, 25)); } };
  try {
    for (let tur = 1; tur <= 4; tur++) {
      const is = m.isEkle('http://127.0.0.1:' + yavasPort + '/yavas-' + tur + '.mp4', 'en-iyi');
      await bekleKosul(() => is.durum === 'indiriliyor' && is.yuzde > 0, 60000);
      assert.equal(await iptal(is.id), 200);
      for (let k = 0; k < 40; k++) {                         // ~1 sn: durum hic "iptal"den baska olmamali
        assert.equal(is.durum, 'iptal', 'tur ' + tur + ': ' + is.durum + ' / ' + is.hata);
        await new Promise((r) => setTimeout(r, 25));
      }
      await bekleKosul(() => !is.surec, 10000);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(is.durum, 'iptal', 'tur ' + tur + ' kapanışta: ' + is.durum + ' / ' + is.hata);
      assert.equal(is.hata, '');
    }
  } finally {
    await new Promise((coz) => { yavas.close(coz); if (yavas.closeAllConnections) yavas.closeAllConnections(); });
  }
});
