'use strict';
// Sunucu testleri: gercek HTTP sunucusu (rastgele port) + sahte yt-dlp + sahte vidIQ + sahte DNS. Gercek ag/anahtar yok.
const ortam = require('./_ortam');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');
const m = require('../server.js');

let port = 0;
const gercekMp4 = { var: false };
const APOSTROFLU = "I can't stop [abc123]; & %PATH% ^caret.mp4";   // Windows'ta gecerli, ' ; & % ^ iceriyor
const ac = [];                                                      // ic.ac cagrilari

test.before(async () => {
  gercekMp4.var = ortam.ornekMp4Uret(ortam.dosyalar.mp4);
  // zehirli ayar dosyasi: acilista reddedilmeli, varsayilan klasore donulmeli
  fs.writeFileSync(ortam.dosyalar.ayar, JSON.stringify({ klasor: 'C:\\Windows', kalite: 'zzz', cerez: true }));
  m.ic.ac = (hedef, sec) => ac.push([hedef, sec]);
  // linkleriSuz alan adlarini DNS ile sorar (yerel adrese cozulenleri reddeder): gercek DNS'e gidilmesin,
  // cevrimdisi / NXDOMAIN'i modeme yonlendiren agda test dalgalanmasin
  m.ic.dns = { lookup: async () => [{ address: '93.184.216.34', family: 4 }] };
  const s = await m.baslat({ port: 0 });
  port = s.address().port;
});
test.after(async () => {
  await m.kapat();
  ortam.temizle();
});

function istek(yontem, yol, { headers = {}, govde, jeton = true, host } = {}) {
  return new Promise((coz, red) => {
    const h = { ...headers };
    if (jeton === true) h['X-Panel-Token'] = m.jeton();
    else if (typeof jeton === 'string') h['X-Panel-Token'] = jeton;
    let veri = null;
    if (govde !== undefined) veri = (typeof govde === 'string' || Buffer.isBuffer(govde)) ? govde : JSON.stringify(govde);
    if (yontem === 'POST' && !h['Content-Type']) h['Content-Type'] = 'application/json';
    if (veri !== null) h['Content-Length'] = Buffer.byteLength(veri);
    if (host) h.Host = host;
    let tamam = false;
    const r = http.request({ host: '127.0.0.1', port, path: yol, method: yontem, headers: h }, (res) => {
      const parcalar = [];
      res.on('data', (c) => parcalar.push(c));
      res.on('end', () => {
        tamam = true;
        const g = Buffer.concat(parcalar);
        let j = null;
        try { j = JSON.parse(g.toString('utf8')); } catch { /* json degil */ }
        coz({ durum: res.statusCode, basliklar: res.headers, govde: g, metin: g.toString('utf8'), json: j });
      });
    });
    r.on('error', (e) => { if (!tamam) red(e); });
    if (veri !== null) r.write(veri);
    r.end();
  });
}
const al = (yol, o) => istek('GET', yol, o);
const gonder = (yol, govde, o) => istek('POST', yol, { ...o, govde });
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
// Sunucu asiri buyuk govdeye 413 verip baglantiyi kapatir (Connection: close). Istemci govdeyi yazarken baglanti kapanirsa
// Node yaniti okumadan ECONNRESET/EPIPE verebilir (yaris durumu, yuklu CI'da gorulur): yanit gelene kadar birkac kez dener.
const BAGLANTI_KOPTU = /ECONNRESET|EPIPE/;
async function gonderYarisli(yol, govde, o) {
  for (let i = 0; ; i++) {
    try { return await gonder(yol, govde, o); } catch (e) { if (i >= 3 || !BAGLANTI_KOPTU.test(String(e && (e.code || e.message)))) throw e; await bekle(100); }
  }
}
async function kadarBekle(kosul, ms = 15000) {
  const bas = Date.now();
  for (;;) {
    const v = await kosul();
    if (v) return v;
    if (Date.now() - bas > ms) throw new Error('zaman aşımı');
    await bekle(100);
  }
}
const isleriAl = async () => (await al('/api/durum')).json.isler;

// ------------------------------------------------------------------ arayuz + basliklar
test('/ : jeton meta + HttpOnly SameSite=Strict cerez + CSP (script-src self, unsafe-inline yok)', async () => {
  assert.equal(m.sunucu.address().address, '127.0.0.1', 'yalnızca yerel arayüzü dinlemeli (ağa kapalı)');
  const r = await al('/', { jeton: false });
  assert.equal(r.durum, 200);
  assert.ok(r.metin.includes('<meta name="panel-token" content="' + m.jeton() + '">'));
  assert.ok(!r.metin.includes('__PANEL_JETON__'));
  const cerez = r.basliklar['set-cookie'][0];
  assert.match(cerez, new RegExp('^' + m.CEREZ_AD + '=' + m.jeton() + '; HttpOnly; SameSite=Strict; Path=/'));
  const csp = r.basliklar['content-security-policy'];
  const scriptSrc = /script-src ([^;]+)/.exec(csp)[1];
  assert.equal(scriptSrc, "'self'");
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.equal(r.basliklar['x-content-type-options'], 'nosniff');
  assert.equal(r.basliklar['x-frame-options'], 'DENY');
  assert.equal(r.basliklar['referrer-policy'], 'no-referrer');
  assert.equal(r.basliklar['cross-origin-resource-policy'], 'same-origin');
  // sayfa dosyalari
  assert.equal((await al('/uygulama.js', { jeton: false })).durum, 200);
  assert.match((await al('/stil.css', { jeton: false })).basliklar['content-type'], /text\/css/);
  assert.equal((await al('/server.js', { jeton: false })).durum, 404, 'beyaz liste dışı dosya sunulmamalı');
  assert.equal((await al('/public/index.html', { jeton: false })).durum, 404);
});

// ------------------------------------------------------------------ Host / Origin / jeton / icerik turu
test('Host başlığı: yanlış host (DNS rebinding) ve yanlış port 403', async () => {
  for (const host of ['evil.example:' + port, 'localhost:1', 'localhost', '127.0.0.1.evil.com:' + port]) {
    const r = await al('/', { host, jeton: false });
    assert.equal(r.durum, 403, host);
    assert.equal(r.json.kod, 'host');
  }
  assert.equal((await al('/', { host: 'localhost:' + port, jeton: false })).durum, 200);
  assert.equal((await al('/', { host: '127.0.0.1:' + port, jeton: false })).durum, 200);
  // jetonlu istek bile yanlis host ile reddedilir
  assert.equal((await al('/api/durum', { host: 'evil.example:' + port })).durum, 403);
});

test('jeton: yok / yanlış → 403 token; GET dahil tüm /api; çerez yalnız akış ve dosya için', async () => {
  for (const [y, yol] of [['GET', '/api/durum'], ['GET', '/api/kesfet'], ['GET', '/api/gunluk'], ['POST', '/api/indir'], ['POST', '/api/sil'], ['POST', '/api/ayar'], ['POST', '/api/kesfet-yenile']]) {
    for (const jeton of [false, 'yanlis', '']) {
      const r = await istek(y, yol, { jeton, govde: y === 'POST' ? {} : undefined });
      assert.equal(r.durum, 403, y + ' ' + yol);
      assert.equal(r.json.kod, 'token');
      assert.match(r.json.hata, /Oturum süresi doldu/);
    }
  }
  const cerez = { Cookie: m.CEREZ_AD + '=' + m.jeton() };
  assert.equal((await al('/api/durum', { jeton: false, headers: cerez })).durum, 403, 'çerez /api/durum için yetmez');
  assert.equal((await istek('POST', '/api/temizle', { jeton: false, headers: cerez, govde: {} })).durum, 403, 'çerez POST için yetmez');
  assert.equal((await al('/api/durum')).durum, 200);
});

test('POST: Content-Type JSON değilse 415; çapraz Origin / Sec-Fetch-Site 403', async () => {
  for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx']) {
    const r = await gonder('/api/temizle', '{}', { headers: { 'Content-Type': ct } });
    assert.equal(r.durum, 415, ct);
    assert.equal(r.json.kod, 'icerik_turu');
  }
  assert.equal((await gonder('/api/temizle', '{}', { headers: { 'Content-Type': 'application/json; charset=utf-8' } })).durum, 200);
  for (const origin of ['https://evil.example', 'http://localhost:4173', 'null', 'http://localhost:' + port + '.evil.com']) {
    const r = await gonder('/api/temizle', {}, { headers: { Origin: origin } });
    assert.equal(r.durum, 403, origin);
    assert.equal(r.json.kod, 'origin');
    assert.equal((await al('/api/durum', { headers: { Origin: origin } })).durum, 403, 'GET + yabancı origin');
  }
  assert.equal((await gonder('/api/temizle', {}, { headers: { Origin: 'http://localhost:' + port } })).durum, 200);
  assert.equal((await gonder('/api/temizle', {}, { headers: { Origin: 'http://127.0.0.1:' + port } })).durum, 200);
  assert.equal((await al('/api/durum', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).durum, 403);
  assert.equal((await al('/api/durum', { headers: { 'Sec-Fetch-Site': 'same-site' } })).durum, 403);
  assert.equal((await al('/api/durum', { headers: { 'Sec-Fetch-Site': 'same-origin' } })).durum, 200);
  // desteklenmeyen yontemler (CORS on-kontrolu dahil)
  assert.equal((await istek('OPTIONS', '/api/indir')).durum, 405);
  assert.equal((await istek('PUT', '/api/ayar', { govde: {} })).durum, 405);
  assert.equal((await istek('DELETE', '/api/sil')).durum, 405);
});

test('gövde: 1 MB üstü 413 (sunucu sağ kalır); bozuk JSON 400; dizi/null gövde düz nesne sayılır', async () => {
  const r = await gonderYarisli('/api/indir', Buffer.alloc(1024 * 1024 + 10, 97));
  assert.equal(r.durum, 413);
  assert.equal(r.json.kod, 'govde_buyuk');
  const akis = await gonderYarisli('/api/indir', '{"url":"' + 'a'.repeat(1024 * 1024) + '"}');
  assert.equal(akis.durum, 413);
  // Content-Length olmadan (chunked) gelen büyük gövde de akarken kesilir
  const parcaliDene = () => new Promise((coz, red) => {
    let tamam = false;
    const r = http.request({ host: '127.0.0.1', port, path: '/api/indir', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Panel-Token': m.jeton(), 'Transfer-Encoding': 'chunked' } }, (res) => {
      const p = []; res.on('data', (c) => p.push(c));
      res.on('end', () => { tamam = true; coz({ durum: res.statusCode, json: JSON.parse(Buffer.concat(p).toString('utf8')) }); });
    });
    r.on('error', (e) => { if (!tamam) red(e); });
    for (let i = 0; i < 3; i++) r.write(Buffer.alloc(512 * 1024, 97));
    r.end();
  });
  let parcali;
  for (let i = 0; ; i++) {
    try { parcali = await parcaliDene(); break; } catch (e) { if (i >= 3 || !BAGLANTI_KOPTU.test(String(e && (e.code || e.message)))) throw e; await bekle(100); }
  }
  assert.equal(parcali.durum, 413);
  assert.equal(parcali.json.kod, 'govde_buyuk');
  assert.equal((await gonder('/api/indir', '{bozuk')).json.kod, 'json_bozuk');
  assert.equal((await gonder('/api/indir', '[1,2]')).json.kod, 'link');
  assert.equal((await gonder('/api/indir', 'null')).json.kod, 'link');
  assert.equal((await gonder('/api/indir', '')).json.kod, 'link');
  assert.equal((await al('/api/durum')).durum, 200, 'sunucu hâlâ yanıt veriyor');
});

test('işleyici hatası sunucuyu düşürmez: 500 + Türkçe genel mesaj, yığın izi sızmaz', async () => {
  const eski = m.ic.ac;
  m.ic.ac = () => { throw new Error('PATLADI-gizli-ayrinti'); };
  try {
    const r = await gonder('/api/klasor', {});
    assert.equal(r.durum, 500);
    assert.equal(r.json.kod, 'sunucu');
    assert.ok(!r.metin.includes('PATLADI') && !/\n\s+at |node:internal/.test(r.metin), 'ayrıntı/yığın sızmamalı');
    assert.match(r.json.hata, /Beklenmeyen/);
  } finally { m.ic.ac = eski; }
  assert.equal((await al('/api/durum')).durum, 200);
  assert.equal((await al('/api/yok')).durum, 404);
  assert.equal((await istek('GET', '/%zz')).durum, 404);
});

// ------------------------------------------------------------------ ayarlar
test('zehirli ayarlar.json: dışarıdaki klasör reddedilir, varsayılana dönülür', async () => {
  const d = (await al('/api/durum')).json;
  assert.equal(d.ayar.klasor, path.resolve(ortam.klasor));
  assert.equal(d.ayar.kalite, 'en-iyi', 'geçersiz kalite yok sayılmalı');
  assert.equal(d.ayar.cerez, true, 'geçerli alanlar okunur');
  assert.equal(d.surum, 1);
});

test('/api/ayar: klasör kısıtı, cerez/kalite doğrulaması, atomik kaydetme', async () => {
  for (const k of [path.join(ortam.klasor, '..', 'dis'), path.resolve(__dirname, '..'), 'C:\\Windows', 'baska/gorece', '\\\\sunucu\\x\\y', '', 5]) {
    const r = await gonder('/api/ayar', { klasor: k });
    assert.equal(r.durum, 400, JSON.stringify(k));
    assert.equal(r.json.kod, 'klasor');
  }
  assert.equal((await gonder('/api/ayar', { cerez: 'evet' })).durum, 400);
  assert.equal((await gonder('/api/ayar', { kalite: 'zzz' })).durum, 400);
  const alt = path.join(ortam.klasor, 'alt-klasor');
  const r = await gonder('/api/ayar', { klasor: alt, cerez: false, kalite: '720' });
  assert.equal(r.durum, 200);
  assert.equal(r.json.ayar.klasor, alt);
  assert.ok(fs.existsSync(alt));
  const kayit = JSON.parse(fs.readFileSync(ortam.dosyalar.ayar, 'utf8'));
  assert.equal(kayit.klasor, alt);
  assert.equal(kayit.kalite, '720');
  assert.equal(fs.readdirSync(ortam.gecici).filter((a) => a.endsWith('.tmp')).length, 0, 'geçici dosya kalmamalı');
  // geri al
  assert.equal((await gonder('/api/ayar', { klasor: ortam.klasor, kalite: 'en-iyi' })).durum, 200);
});

// ------------------------------------------------------------------ dosya islemleri (apostrof / ozel karakter)
test('apostroflu ve özel karakterli dosya: listele, Range ile sun, oynat, klasörde göster, sil', async (t) => {
  const tam = path.join(ortam.klasor, APOSTROFLU);
  fs.copyFileSync(ortam.dosyalar.mp4, tam);
  const boy = fs.statSync(tam).size;

  const d = (await al('/api/durum')).json;
  assert.ok(d.dosyalar.some((f) => f.ad === APOSTROFLU && f.boyut === boy), 'liste adı birebir döndürmeli');

  const tamCevap = await al('/dosya/' + encodeURIComponent(APOSTROFLU), { jeton: false, headers: { Cookie: m.CEREZ_AD + '=' + m.jeton() } });
  assert.equal(tamCevap.durum, 200);
  assert.equal(tamCevap.basliklar['content-type'], 'video/mp4');
  assert.equal(tamCevap.govde.length, boy);
  assert.ok(tamCevap.govde.equals(fs.readFileSync(tam)));
  // header ile de olur
  assert.equal((await al('/dosya/' + encodeURIComponent(APOSTROFLU))).durum, 200);

  const kismi = await al('/dosya/' + encodeURIComponent(APOSTROFLU), { headers: { Range: 'bytes=0-99' } });
  assert.equal(kismi.durum, 206);
  assert.equal(kismi.basliklar['content-range'], `bytes 0-99/${boy}`);
  assert.equal(kismi.govde.length, 100);
  const son = await al('/dosya/' + encodeURIComponent(APOSTROFLU), { headers: { Range: 'bytes=-50' } });
  assert.equal(son.durum, 206);
  assert.ok(son.govde.equals(fs.readFileSync(tam).subarray(boy - 50)));
  const hatali = await al('/dosya/' + encodeURIComponent(APOSTROFLU), { headers: { Range: 'bytes=99999999-' } });
  assert.equal(hatali.durum, 416);

  // yetkisiz / kotu adlar
  assert.equal((await al('/dosya/' + encodeURIComponent(APOSTROFLU), { jeton: false })).durum, 403);
  assert.equal((await al('/dosya/..%2f..%2fserver.js')).durum, 404);
  assert.equal((await al('/dosya/%2e%2e%5cserver.js')).durum, 404);
  assert.equal((await al('/dosya/server.js')).durum, 404);
  assert.equal((await al('/dosya/%E0%A4%A')).durum, 400);

  ac.length = 0;
  assert.equal((await gonder('/api/oynat', { dosya: APOSTROFLU })).durum, 200);
  assert.deepEqual(ac.pop(), [path.join(path.resolve(ortam.klasor), APOSTROFLU), false]);
  assert.equal((await gonder('/api/klasor', { dosya: APOSTROFLU })).durum, 200);
  assert.deepEqual(ac.pop(), [path.join(path.resolve(ortam.klasor), APOSTROFLU), true]);
  assert.equal((await gonder('/api/klasor', {})).durum, 200);
  assert.deepEqual(ac.pop(), [path.resolve(ortam.klasor), false]);

  if (gercekMp4.var && !spawnSync('ffprobe', ['-version'], { windowsHide: true }).error) {
    const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tam], { windowsHide: true });
    assert.ok(parseFloat(String(p.stdout)) > 1, 'sunulan dosya geçerli bir video olmalı');
  } else t.diagnostic('ffmpeg/ffprobe yok: sentetik video doğrulaması atlandı');

  assert.equal((await gonder('/api/sil', { dosya: APOSTROFLU })).durum, 200);
  assert.ok(!fs.existsSync(tam));
  assert.equal((await gonder('/api/sil', { dosya: APOSTROFLU })).durum, 404);
});

test('sil / oynat / klasör: yol kaçışı, uzantı dışı dosya ve dış dosya reddedilir ve dokunulmaz', async () => {
  const dis = path.join(ortam.gecici, 'dis-dosya.mp4');
  fs.writeFileSync(dis, 'DIS');
  const betik = path.join(ortam.klasor, 'betik.js');
  const env = path.join(ortam.klasor, '.env');
  fs.writeFileSync(betik, 'x'); fs.writeFileSync(env, 'ANAHTAR=1');
  ac.length = 0;
  for (const ad of ['..\\dis-dosya.mp4', '../dis-dosya.mp4', dis, '..', '.', 'betik.js', '.env', 'x.exe', 'x.bat', 'x.lnk', 'x.mp4\0.txt', '', null, 5, ['a.mp4']]) {
    for (const yol of ['/api/sil', '/api/oynat']) {
      const r = await gonder(yol, { dosya: ad });
      // nesne/liste degeri govde asamasinda 400 govde_tipi ile reddedilir (String() patlatma saldirisi); digerleri dosya kapisindan 404
      assert.equal(r.durum, ad !== null && typeof ad === 'object' ? 400 : 404, yol + ' ' + JSON.stringify(ad));
    }
  }
  assert.equal(ac.length, 0, 'oynat çağrılmamalı');
  assert.ok(fs.existsSync(dis) && fs.existsSync(betik) && fs.existsSync(env), 'hiçbir dosya silinmemeli');
  // klasor ac: gecersiz dosya adi klasoru acar, dis dosyayi secmez
  await gonder('/api/klasor', { dosya: '..\\dis-dosya.mp4' });
  assert.deepEqual(ac.pop(), [path.resolve(ortam.klasor), false]);
  fs.rmSync(betik); fs.rmSync(env);
});

// ------------------------------------------------------------------ indirme akisi (sahte yt-dlp)
test('/api/indir: geçersiz / yerel adresli linkler reddedilir; kalite doğrulanır', async () => {
  const kotu = 'file:///C:/Windows/win.ini javascript:alert(1) http://localhost:4173/x http://127.0.0.1/ http://192.168.1.1/ --exec=calc ftp://a.b';
  const r = await gonder('/api/indir', { url: kotu });
  assert.equal(r.durum, 400);
  assert.equal(r.json.kod, 'link');
  assert.equal((await gonder('/api/indir', { url: 'https://example.com/a', kalite: '$(calc)' })).json.kod, 'kalite');
  assert.equal((await isleriAl()).length, 0, 'hiç iş açılmamalı');
  fs.rmSync(ortam.dosyalar.gunluk, { force: true });
});

test('/api/indir: başarılı indirme — dosya adı özel karakterli, sahte yt-dlp "--" ile çağrılır', async () => {
  const r = await gonder('/api/indir', { url: 'https://example.com/ok mple.com javascript:x', kalite: '1080' });
  assert.equal(r.durum, 200);
  assert.equal(r.json.adet, 1);
  assert.equal(r.json.atlanan, 2);
  const is = await kadarBekle(async () => (await isleriAl()).find((i) => i.durum === 'bitti' || i.durum === 'hata'));
  assert.equal(is.durum, 'bitti', is.hata);
  assert.equal(is.baslik, "Fake it's & test (x)");
  assert.equal(is.kanal, 'Kanal "adı"');
  assert.equal(is.dosya, "Fake it's & test (x) [abc123].mp4", 'tam yol değil, yalnız dosya adı döner');
  assert.ok(fs.existsSync(path.join(ortam.klasor, is.dosya)));
  assert.equal(is.yuzde, 100);
  const d = (await al('/api/durum')).json;
  assert.ok(d.dosyalar.some((f) => f.ad === is.dosya));
  // yt-dlp'ye giden her komutta URL "--"dan sonra
  const komutlar = fs.readFileSync(ortam.dosyalar.gunluk, 'utf8').trim().split('\n').map((s) => JSON.parse(s));
  assert.ok(komutlar.length >= 2, 'bilgi + indirme çağrısı');
  for (const k of komutlar) {
    assert.equal(k[k.length - 2], '--');
    assert.equal(k[k.length - 1], 'https://example.com/ok');
    assert.ok(k.includes('--socket-timeout'));
  }
  // kalite kaydedildi
  assert.equal(JSON.parse(fs.readFileSync(ortam.dosyalar.ayar, 'utf8')).kalite, '1080');
  // dosya dosya sunulur + silinir
  assert.equal((await gonder('/api/sil', { dosya: is.dosya })).durum, 200);
  assert.equal((await gonder('/api/temizle', {})).durum, 200);
  assert.equal((await isleriAl()).length, 0);
});

test('indirme hataları Türkçe çevrilir (internet yok / özel video)', async () => {
  await gonder('/api/indir', { url: 'https://example.com/fail https://example.com/private' });
  const bitenler = await kadarBekle(async () => {
    const l = await isleriAl();
    return l.length === 2 && l.every((i) => i.durum === 'hata') ? l : null;
  });
  const fail = bitenler.find((i) => i.url.endsWith('fail'));
  const ozel = bitenler.find((i) => i.url.endsWith('private'));
  assert.match(fail.hata, /İnternet bağlantısı kurulamadı/);
  assert.match(ozel.hata, /Video özel/);
  assert.ok(!/ERROR|getaddrinfo/.test(fail.hata), 'ham yt-dlp metni kullanıcıya gösterilmemeli');
  assert.equal((await gonder('/api/tekrar', { id: fail.id })).json.tamam, true, 'hatalı iş tekrar denenebilir');
  assert.equal((await gonder('/api/tekrar', { id: 99999 })).durum, 404);
  await kadarBekle(async () => (await isleriAl()).every((i) => i.durum === 'hata'));
  await gonder('/api/temizle', {});
  assert.equal((await isleriAl()).length, 0);
});

test('iptal: çalışan yt-dlp süreci öldürülür; bitmeyen işe tekrar 409', async () => {
  fs.rmSync(ortam.dosyalar.pid, { force: true });
  await gonder('/api/indir', { url: 'https://example.com/slow' });
  const is = await kadarBekle(async () => (await isleriAl()).find((i) => i.durum === 'indiriliyor'));
  const pid = Number(await kadarBekle(() => fs.existsSync(ortam.dosyalar.pid) && fs.readFileSync(ortam.dosyalar.pid, 'utf8').trim()));
  assert.ok(pid > 0);
  assert.equal((await gonder('/api/tekrar', { id: is.id })).durum, 409);
  assert.equal((await gonder('/api/iptal', { id: is.id })).durum, 200);
  const son = await kadarBekle(async () => (await isleriAl()).find((i) => i.id === is.id && i.durum === 'iptal'));
  assert.equal(son.durum, 'iptal');
  await kadarBekle(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, 8000);
  assert.equal((await gonder('/api/iptal', { id: 99999 })).durum, 404);
  await gonder('/api/temizle', {});
});

test('oynatma listesi: ögeler tek tek kuyruğa girer (en çok 200); liste kutusu kapalıysa tek iş', async () => {
  const r = await gonder('/api/indir', { url: 'https://www.youtube.com/playlist?list=PLabc', liste: true });
  assert.equal(r.json.adet, 2);
  const tek = await gonder('/api/indir', { url: 'https://www.youtube.com/playlist?list=PLabc' });
  assert.equal(tek.json.adet, 1);
  await kadarBekle(async () => (await isleriAl()).every((i) => ['bitti', 'hata'].includes(i.durum)), 20000);
  await gonder('/api/temizle', {});
  for (const f of fs.readdirSync(ortam.klasor)) if (!fs.statSync(path.join(ortam.klasor, f)).isDirectory()) fs.rmSync(path.join(ortam.klasor, f));
});

test('kuyruk sınırı: oynatma listesi AÇILINCA da uygulanır (ya hep ya hiç); sınır dolunca yeni link 409', async () => {
  const slow = (bas, son) => Array.from({ length: son - bas }, (_, i) => 'https://example.com/slow-' + (bas + i)).join(' ');
  const liste = (n, k) => 'https://www.youtube.com/playlist?list=PLbuyuk' + n + '&k=' + k;
  const bekleyenler = async () => (await isleriAl()).filter((i) => !['bitti', 'hata', 'iptal'].includes(i.durum)).length;
  try {
    // eski hata: 3 liste x 200 öge = 600 iş, çünkü sınır yalnız istenen LINK sayısına (3) bakıyordu
    const r0 = await gonder('/api/indir', { url: [liste(200, 1), liste(200, 2), liste(200, 3)].join(' '), liste: true });
    assert.equal(r0.durum, 409);
    assert.equal(r0.json.kod, 'kuyruk_dolu');
    assert.match(r0.json.hata, /Hiçbiri eklenmedi/);
    assert.equal((await isleriAl()).length, 0, 'sınır aşılınca kuyruğa HİÇBİR iş girmemeli (kısmen eklenmiş kuyruk yok)');

    // 400 bekleyen iş (2'si çalışır, gerisi sırada)
    assert.equal((await gonder('/api/indir', { url: slow(0, 200) })).json.adet, 200);
    assert.equal((await gonder('/api/indir', { url: slow(200, 400) })).json.adet, 200);
    assert.equal(await bekleyenler(), 400);
    // 400 + 200 (liste açılınca) > 500
    const r1 = await gonder('/api/indir', { url: liste(200, 4), liste: true });
    assert.equal(r1.durum, 409);
    assert.equal(r1.json.kod, 'kuyruk_dolu');
    assert.equal(await bekleyenler(), 400, 'reddedilen istek kuyruğu değiştirmemeli');
    // sığan küçük liste (2 öge) geçer: 402
    const r2 = await gonder('/api/indir', { url: liste(2, 5), liste: true });
    assert.equal(r2.durum, 200);
    assert.equal(r2.json.adet, 2);
    // tam sınıra kadar doldur (500), bir tane daha 409
    assert.equal((await gonder('/api/indir', { url: slow(400, 498) })).json.adet, 98);
    assert.equal(await bekleyenler(), m.KUYRUK_MAX);
    const r3 = await gonder('/api/indir', { url: 'https://example.com/slow-son' });
    assert.equal(r3.durum, 409);
    assert.equal(r3.json.kod, 'kuyruk_dolu');
    assert.equal(await bekleyenler(), m.KUYRUK_MAX);
  } finally {
    // sondan başa iptal: önce sıradakiler (süreç yok), en son çalışan ikisi
    const hepsi = await isleriAl();
    for (const i of hepsi.slice().sort((a, b) => b.id - a.id)) await gonder('/api/iptal', { id: i.id });
    await kadarBekle(async () => (await isleriAl()).every((i) => ['bitti', 'hata', 'iptal'].includes(i.durum)), 20000);
    await gonder('/api/temizle', {});
    for (const f of fs.readdirSync(ortam.klasor)) if (!fs.statSync(path.join(ortam.klasor, f)).isDirectory()) fs.rmSync(path.join(ortam.klasor, f));
  }
});

test('canlı akış (SSE): çerezle açılır, çerezsiz/yanlış çerezle 403', async () => {
  const baglan = (basliklar) => new Promise((coz, red) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/api/akis', headers: basliklar }, (res) => {
      let g = '';
      res.on('data', (c) => { g += c; if (g.includes('retry: 2000')) { res.destroy(); coz({ durum: res.statusCode, tip: res.headers['content-type'], g }); } });
      res.on('end', () => coz({ durum: res.statusCode, tip: res.headers['content-type'], g }));
      res.on('error', () => {});
    });
    r.on('error', red); r.end();
  });
  const iyi = await baglan({ Cookie: m.CEREZ_AD + '=' + m.jeton() });
  assert.equal(iyi.durum, 200);
  assert.match(iyi.tip, /text\/event-stream/);
  assert.equal((await baglan({})).durum, 403);
  assert.equal((await baglan({ Cookie: m.CEREZ_AD + '=yanlis' })).durum, 403);
  assert.equal((await baglan({ 'X-Panel-Token': m.jeton() })).durum, 200, 'başlık da kabul');
});

// ------------------------------------------------------------------ kesfet
test('/api/kesfet-ara: geçersiz video kimlikleri ve düşük izlenmeler ayıklanır', async () => {
  assert.equal((await gonder('/api/kesfet-ara', { sorgu: '   ' })).json.kod, 'sorgu');
  const r = await gonder('/api/kesfet-ara', { sorgu: 'kedi', donem: 'hafta', tur: 'kisa', minIzlenme: 1000 });
  assert.equal(r.durum, 200);
  assert.equal(r.json.adet, 1);
  assert.equal(r.json.videolar[0].url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(r.json.videolar[0].baslik, 'İyi video');
  const komut = JSON.parse(fs.readFileSync(ortam.dosyalar.gunluk, 'utf8').trim().split('\n').pop());
  assert.equal(komut[komut.length - 2], '--');
  assert.match(komut[komut.length - 1], /^https:\/\/www\.youtube\.com\/results\?search_query=kedi&sp=/);
});

function sahteVidiq({ gecikme = 0, dururum = 200 } = {}) {
  const istekler = [];
  const https = {
    request(secenek, cb) {
      const r = new EventEmitter();
      let govde = '';
      r.write = (c) => { govde += c; };
      r.destroy = (e) => { r.emit('error', e || new Error('iptal')); };
      r.end = () => {
        const j = JSON.parse(govde);
        istekler.push({ secenek, j });
        const res = new EventEmitter();
        res.setEncoding = () => {};
        res.statusCode = dururum;
        res.headers = { 'mcp-session-id': 'oturum-1' };
        setTimeout(() => {
          cb(res);
          let yanit = '';
          if (j.method === 'initialize') yanit = JSON.stringify({ jsonrpc: '2.0', id: j.id, result: { protocolVersion: '2024-11-05' } });
          else if (j.method === 'tools/call' && j.params.name === 'vidiq_outliers') {
            yanit = JSON.stringify({ jsonrpc: '2.0', id: j.id, result: { structuredContent: { videos: [
              { videoId: 'abcdefghijk', videoTitle: 'Patlayan <b>video</b>', channelTitle: 'K', viewCount: 5000000, subscriberCount: 10, videoDuration: 20, vph: 1000, breakoutScore: 12 },
              { videoId: 'bad id"><script>', videoTitle: 'kötü', viewCount: 9000000 },
            ] } } });
          } else if (j.method === 'tools/call') {
            yanit = 'event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: j.id, result: { content: [{ type: 'text', text:
              '## TikTok\n**@k1** — "Başlık"\n  4M views (30x their median of 1K) · 100 followers · 15s\n  https://www.tiktok.com/@k1/video/123\n' }] } }) + '\n\n';
          }
          if (j.method !== 'notifications/initialized') res.emit('data', yanit);
          res.emit('end');
        }, gecikme);
      };
      return r;
    },
  };
  return { https, istekler };
}

test('/api/kesfet-yenile: onay şart; anahtar yoksa 400; onaylı ve anahtarlı çağrı sahte vidIQ ile çalışır', async () => {
  // onaysiz (ucretli) cagri hicbir sey yapmaz
  const eski = m.ic.https;
  const s0 = sahteVidiq();
  m.ic.https = s0.https;
  try {
    for (const g of [{}, { onay: false }, { onay: 'true' }, { onay: 1 }, { minIzlenme: 1 }]) {
      const r = await gonder('/api/kesfet-yenile', g);
      assert.equal(r.durum, 400, JSON.stringify(g));
      assert.equal(r.json.kod, 'onay_gerek');
    }
    assert.equal(s0.istekler.length, 0, 'onaysız çağrıda vidIQ’ya istek gitmemeli');
    // anahtar yok (gecici .env bos)
    const r = await gonder('/api/kesfet-yenile', { onay: true });
    assert.equal(r.json.kod, 'anahtar_yok');
    assert.equal(s0.istekler.length, 0);

    fs.writeFileSync(ortam.dosyalar.env, 'ANTHROPIC_API_KEY=baska\nVIDIQ_KEY=test-anahtar-123\n');
    const s = sahteVidiq({ gecikme: 150 });
    m.ic.https = s.https;
    const ilk = gonder('/api/kesfet-yenile', { onay: true, minIzlenme: 2000000 });
    await bekle(50);
    const ikinci = await gonder('/api/kesfet-yenile', { onay: true });
    assert.equal(ikinci.durum, 409, 'aynı anda ikinci yenileme (çift kredi harcaması) engellenmeli');
    const sonuc = await ilk;
    assert.equal(sonuc.durum, 200, sonuc.metin);
    assert.equal(sonuc.json.adet, 2);
    assert.deepEqual(sonuc.json.videolar.map((v) => v.platform).sort(), ['tiktok', 'youtube']);
    assert.ok(sonuc.json.videolar.every((v) => !/[<">]/.test(v.url)), 'kötü video kimliği elenmeli');
    assert.ok(s.istekler.every((i) => i.secenek.hostname === 'mcp.vidiq.com'));
    assert.ok(s.istekler.every((i) => i.secenek.headers.Authorization === 'Bearer test-anahtar-123'));
    const outlier = s.istekler.find((i) => i.j.params && i.j.params.name === 'vidiq_outliers');
    assert.equal(outlier.j.params.arguments.minViews, 2000000);
    const yazilan = JSON.parse(fs.readFileSync(ortam.dosyalar.kesfet, 'utf8'));
    assert.equal(yazilan.adet, 2);
    assert.equal((await al('/api/kesfet')).json.adet, 2);
    assert.equal(fs.readdirSync(ortam.gecici).filter((a) => a.endsWith('.tmp')).length, 0);
  } finally { m.ic.https = eski; fs.writeFileSync(ortam.dosyalar.env, ''); }
});

test('/api/kesfet-yenile: vidIQ 401 → Türkçe hata, kredi yok', async () => {
  const eski = m.ic.https;
  fs.writeFileSync(ortam.dosyalar.env, 'VIDIQ_KEY=x\n');
  m.ic.https = sahteVidiq({ dururum: 401 }).https;
  try {
    const r = await gonder('/api/kesfet-yenile', { onay: true });
    assert.equal(r.durum, 502);
    assert.match(r.json.hata, /vidIQ anahtarı kabul edilmedi/);
  } finally { m.ic.https = eski; fs.writeFileSync(ortam.dosyalar.env, ''); }
});
