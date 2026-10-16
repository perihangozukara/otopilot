'use strict';
// Guvenlik saldiri turu (2026-10-06): linkGecerli / yerelAdresMi atlatmalari.
// Eskiden [::ffff:127.0.0.1], [::7f00:1], 'localhost.', 100.64.0.1 gibi bicimler yerel ag kontrolunden geciyordu.
const ortam = require('./_ortam');
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../server.js');

test.after(() => ortam.temizle());

test('linkGecerli: IPv4-eslemeli/uyumlu IPv6, NAT64, 6to4, sondaki nokta, CGNAT ve ayrilmis aralıklar reddedilir', () => {
  for (const kotu of [
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[0:0:0:0:0:ffff:7f00:1]/', 'http://[::127.0.0.1]/', 'http://[::7f00:1]/',
    'http://[::ffff:10.0.0.1]/', 'http://[::ffff:192.168.1.1]/', 'http://[::ffff:169.254.169.254]/', 'http://[::ffff:a9fe:a9fe]/',
    'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/', 'http://[::]/', 'http://[::1]/', 'http://[fe80::1]/', 'http://[fd00::1]/', 'http://[ff02::1]/', 'http://[2001:db8::1]/',
    'http://localhost./', 'http://foo.localhost./', 'http://metadata.google.internal./', 'http://printer.local./', 'http://127.0.0.1./', 'http://a.lan/', 'http://x.home.arpa/',
    'http://127.1/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://2130706433/', 'http://0/',
    'http://router/', 'http://nas:8080/a', 'http:///x', 'http://intranet/',            // tek etiketli ad: arama son ekiyle yerel agdaki makineye cozulur
    'http://100.64.0.1/', 'http://100.127.255.255/', 'http://198.18.0.1/', 'http://192.0.0.1/', 'http://192.0.2.1/', 'http://224.0.0.1/', 'http://240.0.0.1/', 'http://255.255.255.255/',
  ]) assert.equal(m.linkGecerli(kotu), false, kotu);
});

test('linkGecerli: herkese acik adresler (IPv4/IPv6, sinir degerler) hala gecer', () => {
  for (const iyi of [
    'https://www.youtube.com/watch?v=jNQXAC9IVRw', 'http://93.184.216.34/', 'http://8.8.8.8/', 'http://[2606:4700:4700::1111]/', 'http://[::ffff:8.8.8.8]/',
    'http://172.15.0.1/', 'http://172.32.0.1/', 'http://100.63.0.1/', 'http://100.128.0.1/', 'http://198.17.0.1/', 'http://198.20.0.1/', 'http://192.0.1.1/',
  ]) assert.equal(m.linkGecerli(iyi), true, iyi);
});

test('yerelAdresMi: dogrudan cagrida da kisaltmali/IPv6/bolge kimlikli bicimleri yakalar', () => {
  for (const kotu of ['127.1', '::ffff:127.0.0.1', '::1', 'localhost.', 'fe80::1%eth0', '0x7f.1', '[::ffff:7f00:1]', '', '   ', null, undefined, 'bozuk host adi']) assert.equal(m.yerelAdresMi(kotu), true, String(kotu));
  for (const iyi of ['8.8.8.8', 'example.com', '2606:4700:4700::1111']) assert.equal(m.yerelAdresMi(iyi), false, iyi);
});

test('yerelAdresMi: lib/ag-guvenlik.js (gorsel indirme) ile ayni tabloyu verir (iki kopya birbirinden kopmasin)', (t) => {
  let ag;
  try { ag = require('../../lib/ag-guvenlik.js'); } catch { t.skip('indirici otomasyon klasoru disinda: lib/ag-guvenlik.js yok'); return; }
  const tablo = ['localhost', 'localhost.', '127.1', '0x7f000001', '10.1.2.3', '100.64.0.1', '169.254.169.254', '[::1]', '[::ffff:127.0.0.1]', '::7f00:1', '[64:ff9b::7f00:1]', '[2002:7f00:1::]', 'fe80::1%eth0',
    'a.lan', 'router', 'foo.local.', '', 'pexels.com', '8.8.8.8', '172.32.0.1', '100.128.0.1', '[2606:4700:4700::1111]', '::ffff:8.8.8.8', 'xn--bcher-kva.example', '203.0.113.5', '224.0.0.1'];
  for (const h of tablo) assert.equal(m.yerelAdresMi(h), ag.yerelAdresMi(h), JSON.stringify(h));
});

test('adYerelCozuluyorMu: alan adi yerel adrese cozuluyorsa engellenir; cozulemezse engellenmez; sonuc onbelleklenir', async () => {
  const eski = m.ic.dns;
  let sayac = 0;
  try {
    m.ic.dns = { lookup: async (ad) => { sayac++; if (ad === 'yerel.test-ssrf') return [{ address: '127.0.0.1', family: 4 }]; if (ad === 'karisik.test-ssrf') return [{ address: '8.8.8.8', family: 4 }, { address: '::ffff:10.0.0.1', family: 6 }]; if (ad === 'acik.test-ssrf') return [{ address: '93.184.216.34', family: 4 }]; throw new Error('ENOTFOUND'); } };
    assert.equal(await m.adYerelCozuluyorMu('yerel.test-ssrf'), true);
    assert.equal(await m.adYerelCozuluyorMu('karisik.test-ssrf'), true, 'adreslerden biri yerelse engellenir');
    assert.equal(await m.adYerelCozuluyorMu('acik.test-ssrf'), false);
    assert.equal(await m.adYerelCozuluyorMu('yok.test-ssrf'), false, 'cozulemeyen ad engellenmez (yt-dlp kendi hatasini verir)');
    const once = sayac;
    await m.adYerelCozuluyorMu('yerel.test-ssrf'); await m.adYerelCozuluyorMu('acik.test-ssrf');
    assert.equal(sayac, once, 'ikinci sorgu onbellekten gelir');
    const suzulen = await m.linkleriSuz(['http://yerel.test-ssrf/v', 'https://acik.test-ssrf/v', 'http://[::ffff:7f00:1]/', 'ftp://x.com/']);
    assert.deepEqual(suzulen, ['https://acik.test-ssrf/v']);
    assert.equal(await m.adYerelCozuluyorMu('8.8.8.8'), false, 'IP degeri DNS sorgusuna gitmez');
  } finally { m.ic.dns = eski; }
});

test('fake-ip VPN (Clash/sing-box TUN): alan adı 198.18.0.0/15\'e çözülüyorsa link REDDEDİLMEZ; doğrudan IP olarak yazılırsa reddedilir', async () => {
  const eski = m.ic.dns;
  try {
    m.ic.dns = { lookup: async (ad) => {
      if (ad === 'fakeip.test-ssrf') return [{ address: '198.18.0.57', family: 4 }];
      if (ad === 'fakeip2.test-ssrf') return [{ address: '198.19.255.1', family: 4 }, { address: '::ffff:198.18.3.4', family: 6 }];
      if (ad === 'fakeip-yerel.test-ssrf') return [{ address: '198.18.0.57', family: 4 }, { address: '10.0.0.1', family: 4 }];
      if (ad === 'sinir.test-ssrf') return [{ address: '198.17.255.255', family: 4 }];
      if (ad === 'sinir2.test-ssrf') return [{ address: '198.20.0.0', family: 4 }];
      if (ad === 'pihole.test-ssrf') return [{ address: '0.0.0.0', family: 4 }];
      throw new Error('ENOTFOUND');
    } };
    assert.equal(await m.adYerelCozuluyorMu('fakeip.test-ssrf'), false, 'fake-ip cevabı yerel sayılmamalı');
    assert.equal(await m.adYerelCozuluyorMu('fakeip2.test-ssrf'), false, '198.19/16 ve ::ffff:198.18.x.x de fake-ip');
    assert.equal(await m.adYerelCozuluyorMu('fakeip-yerel.test-ssrf'), true, 'fake-ip yanında gerçek yerel adres varsa yine engellenir');
    assert.equal(await m.adYerelCozuluyorMu('sinir.test-ssrf'), false, '198.17.255.255: blok dışı ama zaten yerel değil');
    assert.equal(await m.adYerelCozuluyorMu('sinir2.test-ssrf'), false);
    assert.equal(await m.adYerelCozuluyorMu('pihole.test-ssrf'), true, 'Pi-hole 0.0.0.0 yanıtı bilinçli olarak engellenir');
    assert.deepEqual(await m.linkleriSuz(['https://fakeip.test-ssrf/watch?v=1', 'http://198.18.0.1/', 'http://[::ffff:198.18.0.1]/']), ['https://fakeip.test-ssrf/watch?v=1'],
      'doğrudan IP girişi (198.18.0.1) hâlâ reddedilir');
  } finally { m.ic.dns = eski; }
});

test('dnsAdresiYerelMi: yalnız 198.18/15 muaf; diğer yerel aralıklar ve geçersiz girdiler yerel kalır', () => {
  for (const muaf of ['198.18.0.0', '198.18.255.255', '198.19.0.1', '198.19.255.255', '::ffff:198.18.0.1', '[::ffff:c612:1]']) assert.equal(m.dnsAdresiYerelMi(muaf), false, muaf);
  for (const yerel of ['127.0.0.1', '10.1.1.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::ffff:10.0.0.1', 'fe80::1', '198.51.100.1', '', null, 'bozuk']) assert.equal(m.dnsAdresiYerelMi(yerel), true, String(yerel));
  for (const acik of ['8.8.8.8', '198.17.255.255', '198.20.0.0', '2606:4700:4700::1111']) assert.equal(m.dnsAdresiYerelMi(acik), false, acik);
  // dogrudan IP cagrisi (yerelAdresMi) 198.18/15'i hala yerel sayar
  assert.equal(m.yerelAdresMi('198.18.0.1'), true);
  assert.equal(m.yerelAdresMi('198.19.1.1'), true);
});

test('portDoluTani: eski korumasız indirici, yeni indirici (403) ve başka program ayırt edilir', async () => {
  const http = require('http');
  const sunucuAc = (isle) => new Promise((coz) => { const s = http.createServer(isle); s.listen(0, '127.0.0.1', () => coz(s)); });
  const kapat = (s) => new Promise((coz) => { s.close(() => coz()); if (s.closeAllConnections) s.closeAllConnections(); });
  const eskiKopya = await sunucuAc((req, res) => {                                   // jetonsuz 200 + indirici JSON'u: eski kopya
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ytdlp: '2099', ffmpeg: true, ayar: { klasor: 'x', kalite: 'en-iyi', cerez: false }, isler: [], dosyalar: [] }));
  });
  const yeniKopya = await sunucuAc((req, res) => { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"kod":"token"}'); });
  const baskaProgram = await sunucuAc((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>merhaba</html>'); });
  const yanitsiz = await sunucuAc(() => { /* hic yanit vermez */ });
  try {
    assert.equal(await m.portDoluTani(eskiKopya.address().port), 'korumasiz');
    assert.equal(await m.portDoluTani(yeniKopya.address().port), 'indirici');
    assert.equal(await m.portDoluTani(baskaProgram.address().port), 'baska');
    assert.equal(await m.portDoluTani(yanitsiz.address().port, { zamanAsimiMs: 200 }), 'yanit_yok');
    const kapaliPort = await new Promise((coz) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => coz(p)); }); });
    assert.equal(await m.portDoluTani(kapaliPort), 'yanit_yok', 'dinleyen yoksa bağlantı hatası → yanit_yok');
  } finally { await Promise.all([eskiKopya, yeniKopya, baskaProgram, yanitsiz].map(kapat)); }
});
