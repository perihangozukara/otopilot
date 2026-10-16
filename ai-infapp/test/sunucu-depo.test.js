'use strict';

/**
 * SUNUCU / DEPOLAMA / CIKTI / KURULUM GUVENLIGI
 *
 * server.js, store.js, output.js, reference.js, caption.js, promptcraft.js,
 * life.js ve traits.js icin bagimsiz denetimin (S-01 ... S-17) bulgularini teste baglar:
 *
 *   S-01  her yanitta X-Ai-Infapp kimlik basligi (panelin "kim dinliyor" teshisi buna dayanir)
 *   S-02  CSP / X-Frame-Options / nosniff / Referrer-Policy; GET /api/* cross-site ise 403
 *   S-03  bozuk adres (%, NUL, //, mutlak form) 400 ile cevaplanir, baglanti asili kalmaz
 *   S-04  caption.fitToLimit dogrusal; sahne metinleri sunucu sinirinda kirpilir
 *   S-05  reference.pickReference geri izleme (ReDoS) yapmaz
 *   S-06  govde siniri 256 KB; persona alanlari tur ve boyut denetiminden gecer
 *   S-07  "klasor ac" dosya acmaz
 *   S-08  cikti kokunde UNC / \\?\ / ProgramData / Baslangic klasoru reddedilir
 *   S-09  klasor acici surec hata verirse sunucu olmez
 *   S-10  TUM VERIYI SIL (--all / --hard) gercekten siler: anahtar dosyalari ve arsiv
 *   S-11  GET yanitlarinda URL kimlik bilgisi, ?key=, JSON anahtarlari ve kisa jetonlar maskelenir
 *   S-12  statik servis "public-x" kardes klasorune gecmez
 *   S-13  bayat .instance (PID yeniden kullanimi) baslatmayi engellemez; gercek ikinci ornek yine engellenir
 *   S-14  null/dizi/bozuk govde 400, prototip anahtarli degerler 500 vermez
 *   S-15  AI_INFAPP_VERI verildiyse cikti kokunde gecici klasore gider (gercek masaustune yazmaz)
 *   S-16  proje ici cikti kokunde kendi .gitignore'u olur (uretim ciktilari depoya girmez)
 *   S-17  sahip olunan kaynaklarda BOM / Kiril / U+FFFD / NUL yok
 *
 * Gercek data/ klasorune ve gercek masaustune dokunulmaz: veri klasoru gecici (AI_INFAPP_VERI),
 * sunucular 127.0.0.1 uzerinde 4290-4299 portlarinda, ag yok. Testler biterken surecler oldurulur.
 *
 * Calistir:  node --test ai-infapp/test/sunucu-depo.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const cp = require('child_process');
const { EventEmitter } = require('events');

const KOK = path.join(__dirname, '..');

/* ------------------------------------------------- gecici veri klasoru
 * store / output require edilmeden ONCE ayarlanmali: yollar yukleme aninda hesaplaniyor. */
const GECICI = [];
function geciciKlasor(onek) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `ss-${onek}-`));
  GECICI.push(d);
  return d;
}
const VERI = geciciKlasor('depo');
process.env.AI_INFAPP_VERI = VERI;

/* ------------------------------------------------- spawn gozlemcisi
 * output.js spawn'i yukleme aninda alir; bu yuzden require edilmeden once sarmalaniyor.
 * Hicbir gercek surec (Explorer) acilmaz. */
const spawnKaydi = [];
const gercekSpawn = cp.spawn;
cp.spawn = function sahteSpawn(komut, args, secenek) {
  const cocuk = new EventEmitter();
  cocuk.unref = () => {};
  spawnKaydi.push({ komut, args, cocuk });
  return cocuk;
};

const store = require(path.join(KOK, 'src', 'store'));
const output = require(path.join(KOK, 'src', 'output'));
const reference = require(path.join(KOK, 'src', 'reference'));
const caption = require(path.join(KOK, 'src', 'caption'));
const life = require(path.join(KOK, 'src', 'life'));

test.after(async () => {
  cp.spawn = gercekSpawn;
  for (const s of SUNUCULAR) await durdur(s);
  for (const d of GECICI) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* kilitliyse isletim sistemi temizler */ }
  }
});

/* =================================================================== yardimcilar */

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

const SUNUCULAR = [];

function portDene(port) {
  return new Promise((coz) => {
    const s = net.createServer();
    s.once('error', () => coz(false));
    s.listen(port, '127.0.0.1', () => s.close(() => coz(true)));
  });
}

/**
 * Bos port bulur. Ayni aralikta (4290-4299) baska testler ve ajanlar da sunucu aciyor; bu yuzden
 * sira her seferinde karisik ve secimden sonra HICBIR yere istek atilmaz: sunucunun gercekten
 * o portu aldigi, kendi acilis afisinden (stdout) anlasilir.
 */
async function bosPort(haric = []) {
  const portlar = [];
  for (let p = 4290; p <= 4299; p++) if (!haric.includes(p)) portlar.push(p);
  for (let i = portlar.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [portlar[i], portlar[j]] = [portlar[j], portlar[i]];
  }
  for (const p of portlar) if (await portDene(p)) return p;
  throw new Error('4290-4299 araliginda bos port yok');
}

/**
 * Gercek server.js'i (ya da verilen klasordeki kopyayi) gecici veri klasoruyle baslatir.
 * Hazir sayilmak icin sunucunun KENDI acilis afisini ("Panel : http://localhost:<port>") yazmasi gerekir:
 * port baska bir surece kaptirildiysa (EADDRINUSE) o surecin yanitini kendi sunucumuzun yaniti sanmayiz.
 */
async function sunucuBaslat({ veri, dizin = KOK, port, oncedenYaz } = {}) {
  veri = veri || geciciKlasor('veri');
  // olculmus glif tablosu hazir: sunucu acilisinda Chrome ile olcum baslatmasin
  if (!fs.existsSync(path.join(veri, 'glif-tablo.json'))) {
    fs.writeFileSync(path.join(veri, 'glif-tablo.json'), JSON.stringify({ platform: process.platform, tablo: { kalin: {} } }));
  }
  if (oncedenYaz) oncedenYaz(veri);

  let sonHata = '';
  for (let deneme = 0; deneme < 5; deneme++) {
    const p = (deneme === 0 && port) || await bosPort();
    if (deneme > 0) { try { fs.rmSync(path.join(veri, '.instance'), { force: true }); } catch (e) { /* yok */ } }
    const env = { ...process.env, AI_INFAPP_VERI: veri, AI_INFAPP_PORT: String(p) };
    const surec = gercekSpawn.call(cp, process.execPath, [path.join(dizin, 'server.js')], { cwd: dizin, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    surec.cikti = '';
    surec.stdout.on('data', (c) => { surec.cikti += c; });
    surec.stderr.on('data', (c) => { surec.cikti += c; });
    surec.cikis = new Promise((coz) => surec.once('exit', (kod) => coz(kod)));
    const s = { surec, port: p, veri, cikti: () => surec.cikti };
    SUNUCULAR.push(s);

    const son = Date.now() + 10000;
    let cikmis = false;
    surec.once('exit', () => { cikmis = true; });
    while (Date.now() < son && !cikmis && !surec.cikti.includes(`http://localhost:${p}`)) await bekle(50);
    if (!cikmis && surec.cikti.includes(`http://localhost:${p}`)) return s;

    sonHata = surec.cikti;
    await durdur(s);
    if (!/portu dolu/.test(sonHata)) break; // port kaptirilmasi disindaki hatada yeniden deneme
  }
  throw new Error(`sunucu acilmadi: ${sonHata}`);
}

async function durdur(s) {
  if (!s || !s.surec) return;
  if (s.surec.exitCode === null && !s.surec.killed) {
    try { s.surec.kill(); } catch (e) { /* zaten kapali */ }
  }
  await Promise.race([s.surec.cikis, bekle(3000)]);
}

function istek(port, yontem, yol, { baslik = {}, govde } = {}) {
  return new Promise((coz, red) => {
    let veri = null;
    if (govde !== undefined) {
      veri = Buffer.isBuffer(govde) ? govde : Buffer.from(typeof govde === 'string' ? govde : JSON.stringify(govde));
    }
    const h = { host: `127.0.0.1:${port}`, ...baslik };
    if (veri) {
      h['content-type'] = h['content-type'] || 'application/json';
      h['content-length'] = veri.length;
    }
    const r = http.request({ host: '127.0.0.1', port, method: yontem, path: yol, headers: h, agent: false }, (res) => {
      const parcalar = [];
      res.on('data', (c) => parcalar.push(c));
      res.on('end', () => {
        const metin = Buffer.concat(parcalar).toString('utf8');
        let json = null;
        try { json = JSON.parse(metin); } catch (e) { /* json degil */ }
        coz({ status: res.statusCode, headers: res.headers, metin, json });
      });
      res.on('error', red);
    });
    r.on('error', red);
    r.setTimeout(20000, () => r.destroy(new Error('istek zaman asimi')));
    if (veri) r.write(veri);
    r.end();
  });
}

/** Ham TCP: istek satirini oldugu gibi gonderir, ilk yaniti (ya da null) doner. */
function ham(port, metin, ms = 2500) {
  return new Promise((coz) => {
    const soket = net.connect(port, '127.0.0.1');
    let alinan = '';
    let bitti = false;
    const son = (v) => { if (bitti) return; bitti = true; clearTimeout(saat); soket.destroy(); coz(v); };
    const saat = setTimeout(() => son(alinan || null), ms);
    soket.on('connect', () => soket.write(metin));
    soket.on('data', (c) => { alinan += c.toString('latin1'); if (alinan.includes('\r\n\r\n')) son(alinan); });
    soket.on('error', () => son(alinan || null));
    soket.on('close', () => son(alinan || null));
  });
}

const ORNEK_CEVAP = {
  gender: 'Kadin', region: 'Akdeniz', ethnicity: 'Akdeniz', skinTone: 'Cok acik (porselen)',
  eyeColor: 'Kahverengi', hairColor: 'Siyah', hairStyle: 'Trasli / cok kisa', age: 25, bodyType: 'Ince / zayif',
  measurements: { height_cm: 170, weight_kg: 60, bust_cm: 90, waist_cm: 70, hips_cm: 95, shoe_eu: 39 },
  distinctive: ['Ben (yuzde)'],
  faceShape: 'Belirtmeyecegim', jawline: 'Belirtmeyecegim', cheekbones: 'Belirtmeyecegim', forehead: 'Belirtmeyecegim',
  eyeShape: 'Belirtmeyecegim', eyeSet: 'Belirtmeyecegim', browShape: 'Belirtmeyecegim', noseBridge: 'Belirtmeyecegim',
  noseTip: 'Belirtmeyecegim', lipFullness: 'Belirtmeyecegim', philtrum: 'Belirtmeyecegim', ears: 'Belirtmeyecegim',
  skinTexture: 'Belirtmeyecegim', zodiac: 'Koc', education: 'Ilkogretim', interests: ['Fitness', 'Yoga / pilates'],
};

// ortak sunucu: HTTP testlerinin cogu bunu kullanir (tek surec, hizli)
let ORTAK = null;
async function ortak() {
  if (ORTAK) return ORTAK;
  ORTAK = await sunucuBaslat();
  const r = await istek(ORTAK.port, 'POST', '/api/karakter', { govde: { answers: ORNEK_CEVAP } });
  assert.equal(r.status, 200, `karakter olusmadi: ${r.metin}`);
  return ORTAK;
}

/* =================================================================== S-01 / S-02 */

test('S-01: her yanit (ana sayfa, 404, 403, 415) X-Ai-Infapp kimligini tasir', async () => {
  const { port } = await ortak();
  const surum = require(path.join(KOK, 'package.json')).version;
  const beklenen = `ai-infapp/${surum}`;

  const ana = await istek(port, 'GET', '/');
  assert.equal(ana.status, 200);
  assert.equal(ana.headers['x-ai-infapp'], beklenen, 'ana sayfa');

  const yok = await istek(port, 'GET', '/api/yok-boyle-bir-uc');
  assert.equal(yok.status, 404);
  assert.equal(yok.headers['x-ai-infapp'], beklenen, '404 JSON');

  const yasak = await istek(port, 'GET', '/', { baslik: { host: 'evil.example.com' } });
  assert.equal(yasak.status, 403);
  assert.equal(yasak.headers['x-ai-infapp'], beklenen, 'Host reddi (403)');

  const tur = await istek(port, 'POST', '/api/sorular', { baslik: { 'content-type': 'text/plain' }, govde: '{}' });
  assert.equal(tur.status, 415);
  assert.equal(tur.headers['x-ai-infapp'], beklenen, '415');

  const durum = await istek(port, 'GET', '/api/durum');
  assert.equal(durum.headers['x-ai-infapp'], beklenen, 'API 200');
});

test('S-02: guvenlik basliklari (CSP frame-ancestors none, nosniff, X-Frame-Options, Referrer-Policy) her yanitta', async () => {
  const { port } = await ortak();
  for (const yol of ['/', '/app.js', '/api/durum', '/api/yok']) {
    const r = await istek(port, 'GET', yol);
    const h = r.headers;
    const csp = String(h['content-security-policy'] || '');
    assert.match(csp, /frame-ancestors 'none'/, `${yol}: frame-ancestors`);
    assert.match(csp, /default-src 'self'/, `${yol}: default-src`);
    const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src ')) || '';
    assert.equal(scriptSrc, "script-src 'self'", `${yol}: script-src satir ici betige izin vermemeli`);
    assert.match(csp, /object-src 'none'/, `${yol}: object-src`);
    assert.equal(h['x-content-type-options'], 'nosniff', `${yol}: nosniff`);
    assert.equal(h['x-frame-options'], 'DENY', `${yol}: x-frame-options`);
    assert.equal(h['referrer-policy'], 'no-referrer', `${yol}: referrer-policy`);
  }
});

test('S-02: baska sitenin GET /api/* istegi (Sec-Fetch-Site: cross-site / same-site) reddedilir; ayni kaynak ve adres cubugu gecer', async () => {
  const { port } = await ortak();
  for (const site of ['cross-site', 'same-site']) {
    const r = await istek(port, 'GET', '/api/durum', { baslik: { 'sec-fetch-site': site } });
    assert.equal(r.status, 403, `Sec-Fetch-Site: ${site}`);
  }
  for (const site of ['same-origin', 'none']) {
    const r = await istek(port, 'GET', '/api/durum', { baslik: { 'sec-fetch-site': site } });
    assert.equal(r.status, 200, `Sec-Fetch-Site: ${site}`);
  }
  // sayfanin kendisi baska siteden baglanti ile acilabilir (yalniz /api/ kapali)
  const sayfa = await istek(port, 'GET', '/', { baslik: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(sayfa.status, 200);
});

/* =================================================================== S-03 */

test('S-03: bozuk adresler 400 ile cevaplanir, baglanti asili kalmaz, sunucu uyari logu yazmaz', async () => {
  const s = await ortak();
  const kotuYollar = ['/%', '/%zz', '/api/%E0%A4%A', '/gorseller/%00', '/%00', '//', 'http://[::1'];
  for (const yol of kotuYollar) {
    const yanit = await ham(s.port, `GET ${yol} HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\nConnection: close\r\n\r\n`);
    assert.ok(yanit, `${JSON.stringify(yol)}: yanit gelmedi (baglanti asili)`);
    assert.match(yanit, /^HTTP\/1\.1 400 /, `${JSON.stringify(yol)}: ${String(yanit).split('\r\n')[0]}`);
  }
  // POST ve yanlis Host: Host denetimi bozuk adreste de calismali
  const yabanci = await ham(s.port, 'GET /% HTTP/1.1\r\nHost: evil.example.com\r\nConnection: close\r\n\r\n');
  assert.ok(yabanci, 'yabanci Host + bozuk adres: yanit gelmedi');
  assert.match(yabanci, /^HTTP\/1\.1 403 /);
  const post = await ham(s.port, `POST /api/sifirla% HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`);
  assert.ok(post, 'POST bozuk adres: yanit gelmedi');
  assert.match(post, /^HTTP\/1\.1 400 /);

  await bekle(150);
  assert.doesNotMatch(s.cikti(), /Yakalanmamis hata|URI malformed|Invalid URL/, 'sunucu bozuk adreste yakalanmamis hata logladi');
  // sunucu hala saglikli
  assert.equal((await istek(s.port, 'GET', '/api/durum')).status, 200);
});

/* =================================================================== S-12 */

test('S-12: statik servis "public-x" kardes klasorune gecmez', async () => {
  const kopya = geciciKlasor('kopya');
  fs.cpSync(KOK, kopya, {
    recursive: true,
    filter: (kaynak) => !/[\\/](data|node_modules|test|cikti)([\\/]|$)/.test(path.relative(KOK, kaynak).replace(/^/, path.sep)),
  });
  fs.mkdirSync(path.join(kopya, 'public-x'));
  fs.writeFileSync(path.join(kopya, 'public-x', 'gizli.txt'), 'GIZLI-ICERIK');
  const s = await sunucuBaslat({ dizin: kopya });
  for (const yol of ['/..%2fpublic-x%2fgizli.txt', '/..%5cpublic-x%5cgizli.txt']) {
    const r = await istek(s.port, 'GET', yol);
    assert.notEqual(r.status, 200, `${yol} kardes klasoru acti`);
    assert.doesNotMatch(r.metin, /GIZLI-ICERIK/);
  }
  assert.equal((await istek(s.port, 'GET', '/..%2fserver.js')).status, 403, 'public disina cikis hep 403');
  assert.equal((await istek(s.port, 'GET', '/app.js')).status, 200, 'normal statik dosya calismali');
  await durdur(s);
});

/* =================================================================== S-04 / S-05 */

/** Eski (dogrusal olmayan) uygulama: yeni uygulamanin SONUCU ile birebir ayni olmali. */
function eskiFitToLimit(text, limit) {
  if (text.length <= limit) return text;
  const cumleler = text.split(/(?<=[.!?])\s+/);
  while (cumleler.length > 1) {
    cumleler.pop();
    const aday = cumleler.join(' ');
    if (aday.length <= limit) return aday;
  }
  const kelimeler = cumleler[0].split(/\s+/);
  while (kelimeler.length > 1) {
    kelimeler.pop();
    const aday = `${kelimeler.join(' ')}...`;
    if (aday.length <= limit) return aday;
  }
  return kelimeler[0].slice(0, Math.max(1, limit));
}

function olc(fn) {
  const t = process.hrtime.bigint();
  const sonuc = fn();
  return { sonuc, ms: Number(process.hrtime.bigint() - t) / 1e6 };
}

test('S-04: caption.fitToLimit dev girdide kareli degil (60 bin kelime, 60 bin cumle)', () => {
  const kelimeler = olc(() => caption.fitToLimit('a '.repeat(60000), 280));
  assert.ok(kelimeler.ms < 1000, `kelime dongusu cok yavas: ${kelimeler.ms.toFixed(0)} ms`);
  assert.ok(kelimeler.sonuc.length <= 280);
  const cumleler = olc(() => caption.fitToLimit('a. '.repeat(60000), 280));
  assert.ok(cumleler.ms < 1000, `cumle dongusu cok yavas: ${cumleler.ms.toFixed(0)} ms`);
  assert.ok(cumleler.sonuc.length <= 280);
});

test('S-04: caption.fitToLimit yeni uygulamasi eskisiyle ayni sonucu verir (rastgele girdilerle)', () => {
  let tohum = 12345;
  const rnd = () => { tohum = (Math.imul(tohum, 1664525) + 1013904223) >>> 0; return tohum / 4294967296; };
  const parca = ['a', 'bb', 'merhaba', 'dunya.', 'ne?', 'tamam!', '  ', '\n', 'x'.repeat(30), 'Soyle,', '...', '.', '\u00e7', '\u{1F600}'];
  for (let i = 0; i < 400; i++) {
    const n = 1 + Math.floor(rnd() * 60);
    let metin = '';
    for (let k = 0; k < n; k++) metin += parca[Math.floor(rnd() * parca.length)] + (rnd() < 0.7 ? ' ' : '');
    if (rnd() < 0.2) metin = '  ' + metin;
    const limit = 1 + Math.floor(rnd() * 120);
    assert.equal(caption.fitToLimit(metin, limit), eskiFitToLimit(metin, limit), `girdi=${JSON.stringify(metin)} limit=${limit}`);
  }
});

test('S-05: reference.pickReference "turned " / "side profile " yiginlarinda geri izleme yapmaz', () => {
  const karakter = { referenceSet: { quarter_left: { filename: 'l.png' }, front: { filename: 'f.png' } }, reference: { filename: 'f.png' } };
  for (const metin of ['turned '.repeat(40000), 'side profile '.repeat(40000), 'three-quarter '.repeat(40000)]) {
    const o = olc(() => reference.pickReference(karakter, { pose: metin }));
    assert.ok(o.ms < 300, `${metin.slice(0, 14)}...: ${o.ms.toFixed(0)} ms`);
  }
});

test('S-05: pickReference normal pozlarda eskisi gibi eslestirir', () => {
  const set = {};
  for (const a of reference.ANGLES) set[a.key] = { filename: `${a.key}.png` };
  const k = { referenceSet: set, reference: { filename: 'front.png' } };
  const sec = (pose, shot) => reference.pickReference(k, { pose, shot });
  assert.equal(sec('head turned 45 degrees to their left in a three-quarter view'), 'quarter_left.png');
  assert.equal(sec('head turned slightly to the right'), 'quarter_right.png');
  assert.equal(sec('a full 90 degree left profile'), 'profile_left.png');
  assert.equal(sec('looking over her left shoulder'), 'quarter_left.png');
  assert.equal(sec('seen from behind'), 'back_quarter.png');
  assert.equal(sec('smiling', 'photographed from below'), 'tilt_up.png');
  assert.equal(sec('smiling at the camera'), 'front.png');
});

/* =================================================================== S-04 / S-06 (sunucu sinirinda) */

test('S-04/S-06: dev sahne metni sunucu sinirinda kirpilir; /api/metin olay dongusunu kilitlemez', async () => {
  const { port } = await ortak();
  const dev = 'a '.repeat(32000);
  const t = Date.now();
  const r = await istek(port, 'POST', '/api/metin', { govde: { scene: { request: dev }, platform: 'x' } });
  const sure = Date.now() - t;
  assert.equal(r.status, 200, r.metin.slice(0, 200));
  assert.ok(sure < 2500, `dev istek ${sure} ms surdu (olay dongusu kilitlendi)`);
  for (const v of r.json.variants) assert.ok(v.text.length <= 280);
});

test('S-06: /api/prompt sahne alanlarini kirpar (100 bin karakterlik poz prompt\'a girmez)', async () => {
  const { port } = await ortak();
  const r = await istek(port, 'POST', '/api/prompt', { govde: { scene: { pose: 'x'.repeat(55000), shot: 'y'.repeat(55000), outfit: ['z'.repeat(55000)], extra: 'e'.repeat(55000) } } });
  assert.equal(r.status, 200, r.metin.slice(0, 200));
  assert.ok(r.json.active.prompt.length < 4000, `prompt ${r.json.active.prompt.length} karakter`);
});

test('S-06/S-14: govde siniri 256 KB (413), bozuk JSON 400, null/dizi/ilkel govde 400, ardindan sunucu saglikli', async () => {
  const { port } = await ortak();
  const buyuk = await istek(port, 'POST', '/api/prompt', { govde: JSON.stringify({ scene: { pose: 'p'.repeat(300 * 1024) } }) });
  assert.equal(buyuk.status, 413, buyuk.metin.slice(0, 200));

  const bozuk = await istek(port, 'POST', '/api/sifirla', { govde: '{"confirm":' });
  assert.equal(bozuk.status, 400, bozuk.metin.slice(0, 200));

  for (const govde of ['null', '[]', '[1,2]', '"metin"', '42', 'true']) {
    const r = await istek(port, 'POST', '/api/sifirla', { govde });
    assert.equal(r.status, 400, `govde ${govde}: ${r.status} ${r.metin.slice(0, 120)}`);
  }
  // karakter silinmemis olmali (hicbiri sifirlamadi)
  assert.equal((await istek(port, 'GET', '/api/durum')).json.hasCharacter, true);
});

test('S-06: /api/karakter/persona tur ve boyut dogrular; gecerli guncelleme calisir', async () => {
  const { port } = await ortak();
  const post = (govde) => istek(port, 'POST', '/api/karakter/persona', { govde });

  const avoidDev = await post({ voiceGuide: { avoid: Array.from({ length: 20000 }, (_, i) => 'k' + i) } });
  assert.equal(avoidDev.status, 400, 'avoid 20000 oge kabul edildi');
  const avoidUzun = await post({ voiceGuide: { avoid: ['u'.repeat(500)] } });
  assert.equal(avoidUzun.status, 400, 'avoid 500 karakterlik oge kabul edildi');
  const tur = await post({ contentPillars: 'dizi degil' });
  assert.equal(tur.status, 400, 'dizi beklenen yerde string kabul edildi');
  const nesne = await post({ wardrobe: [{ ic: 'ice' }] });
  assert.equal(nesne.status, 400, 'dizi ogesi string degil');
  const metinDev = await post({ backstory: 'b'.repeat(5000) });
  assert.equal(metinDev.status, 400, 'backstory 5000 karakter kabul edildi');
  const stringDegil = await post({ tone: { x: 1 } });
  assert.equal(stringDegil.status, 400, 'tone nesne kabul edildi');

  const iyi = await post({ tone: 'sakin ve net', wardrobe: ['bej ceket', 'beyaz gomlek'], voiceGuide: { avoid: ['bol vaat', 'abartili sozler'] } });
  assert.equal(iyi.status, 200, iyi.metin.slice(0, 200));
  assert.equal(iyi.json.character.persona.tone, 'sakin ve net');
  assert.deepEqual(iyi.json.character.persona.voiceGuide.avoid, ['bol vaat', 'abartili sozler']);
  // bozuk girdiler diske HIC yazilmamis olmali
  const diskte = JSON.parse(fs.readFileSync(path.join(ORTAK.veri, 'character.json'), 'utf8'));
  assert.ok(diskte.persona.voiceGuide.avoid.length <= 30);
  assert.equal(typeof diskte.persona.backstory, 'string');
  assert.ok(diskte.persona.backstory.length < 2500);
});

/* =================================================================== S-14 */

test('S-14: prototip anahtarli degerler (aspect/realism/style = constructor, __proto__, toString) 500 vermez', async () => {
  const { port } = await ortak();
  const ayarlar = [{ aspect: 'constructor' }, { aspect: '__proto__' }, { realism: '__proto__' }, { realism: 'constructor' }, { style: 'toString' }, { style: '__proto__' }, { aspect: 'hasOwnProperty', realism: 'valueOf', style: 'constructor' }];
  for (const scene of ayarlar) {
    const r = await istek(port, 'POST', '/api/prompt', { govde: { scene } });
    assert.equal(r.status, 200, `${JSON.stringify(scene)}: ${r.status} ${r.metin.slice(0, 160)}`);
    assert.ok(r.json.active.width > 0 && r.json.active.height > 0, JSON.stringify(scene));
  }
  // __proto__ JSON'dan gercek (own) anahtar olarak gelebilir: nesneyi zehirlememeli
  const zehir = await istek(port, 'POST', '/api/prompt', { govde: '{"scene":{"__proto__":{"polluted":"evet"},"pose":"standing"}}' });
  assert.equal(zehir.status, 200, zehir.metin.slice(0, 160));
  assert.equal({}.polluted, undefined);
});

test('S-14: /api/referans/birincil prototip anahtarli aciyi reddeder ve karakter dosyasini bozmaz', async () => {
  const { port } = await ortak();
  const once = fs.readFileSync(path.join(ORTAK.veri, 'character.json'), 'utf8');
  for (const angle of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = await istek(port, 'POST', '/api/referans/birincil', { govde: { angle } });
    assert.equal(r.status, 404, `${angle}: ${r.status} ${r.metin.slice(0, 120)}`);
  }
  assert.equal(fs.readFileSync(path.join(ORTAK.veri, 'character.json'), 'utf8'), once, 'karakter dosyasi degisti');
});

test('S-14: life.autoFill / continentOf / citiesFor prototip anahtarlarda atmaz', () => {
  for (const kotu of ['__proto__', 'constructor', 'toString']) {
    assert.doesNotThrow(() => life.autoFill({ region: 'Akdeniz', continent: 'Avrupa', country: kotu }), `country=${kotu}`);
    assert.doesNotThrow(() => life.autoFill({ region: 'Akdeniz', continent: kotu }), `continent=${kotu}`);
    assert.doesNotThrow(() => life.autoFill({ region: kotu }), `region=${kotu}`);
    assert.doesNotThrow(() => life.autoFill({ region: 'Akdeniz', hometownMode: 'Farkli bir yer sececegim', hometownContinent: kotu, hometownCountry: kotu }), `hometown=${kotu}`);
    assert.deepEqual(life.citiesFor(kotu), []);
    assert.equal(life.continentOf(kotu), null);
  }
  // Normal akis degismedi
  const dolu = life.autoFill({ region: 'Akdeniz', gender: 'Kadin', age: 25 });
  assert.equal(dolu.country, '\u0130spanya');
});

test('S-14: POST /api/karakter prototip anahtarli kita/ulke ile 500 degil 400 (dogrulama) doner', async () => {
  const s = await sunucuBaslat();
  const r = await istek(s.port, 'POST', '/api/karakter', { govde: { answers: { ...ORNEK_CEVAP, continent: '__proto__', country: '__proto__', cityName: 'constructor' } } });
  assert.ok(r.status === 400 || r.status === 200, `${r.status} ${r.metin.slice(0, 160)}`);
  assert.notEqual(r.status, 500);
  await durdur(s);
});

/* =================================================================== S-11 */

test('S-11: saglayici/buyutme GET yanitlari URL kimligini, ?key=, JSON anahtarini ve kisa jetonlari sizdirmaz; kayit korunur', async () => {
  const s = await sunucuBaslat();
  const port = s.port;
  const SIRLAR = ['URLKEY_SEKRET_AAAA1111', 'BODYKEY_SEKRET_BBBB2222', 'PASS_SEKRET_CCCC3333', 'BASICPASS_SEKRET_DDDD4444', 'shortTok1234', 'UPURLKEY_SEKRET_EEEE5555', 'UPBODY_SEKRET_FFFF6666', 'Zm9vYmFyYmF6cXV4+/=QQ'];
  const ozel = {
    url: `https://api.example.test/gen?model=a&key=${SIRLAR[0]}&x=1`,
    method: 'POST',
    headers: `{"content-type":"application/json","Authorization":"Bearer ${SIRLAR[4]}","x-extra":"${SIRLAR[7]}"}`,
    body: `{"api_key":"${SIRLAR[1]}","prompt":"{{prompt}}"}`,
    pollUrl: `https://u:${SIRLAR[2]}@poll.example.test/jobs/{{id}}`,
  };
  const kaydet = await istek(port, 'POST', '/api/saglayici', { govde: { id: 'custom', config: ozel } });
  assert.equal(kaydet.status, 200, kaydet.metin);
  const oa = await istek(port, 'POST', '/api/saglayici', { govde: { id: 'openai', config: { baseUrl: `https://user:${SIRLAR[3]}@proxy.example.test/v1`, model: 'gpt-image-1' } } });
  assert.equal(oa.status, 200, oa.metin);
  const up = await istek(port, 'POST', '/api/buyutme', { govde: { id: 'custom', config: { url: `https://up.example.test/x?token=${SIRLAR[5]}`, body: `{"secret":"${SIRLAR[6]}"}` } } });
  assert.equal(up.status, 200, up.metin);

  for (const yanit of [kaydet, oa, up, await istek(port, 'GET', '/api/saglayicilar'), await istek(port, 'GET', '/api/buyutme')]) {
    for (const sir of SIRLAR) assert.ok(!yanit.metin.includes(sir), `yanit sirri sizdirdi: ${sir}`);
  }
  // Maskelenen alanlar yine de gorunur sekilde (bos degil) doner: kullanici bir sey kayitli oldugunu gormeli
  const liste = (await istek(port, 'GET', '/api/saglayicilar')).json.providers;
  const c = liste.find((p) => p.id === 'custom').config;
  assert.match(c.url, /^https:\/\/api\.example\.test\/gen\?model=a&key=/, 'adres yapisi okunur kalmali');
  assert.ok(c.url.includes('\u2022'), 'anahtar maskelenmeli');
  assert.match(c.url, /&x=1$/);
  assert.match(c.pollUrl, /^https:\/\/u:/);
  assert.match(c.pollUrl, /@poll\.example\.test\/jobs\/\{\{id\}\}$/);
  assert.ok(c.body.includes('{{prompt}}'), 'sablon degiskeni korunmali');

  // Panel maskeli degeri aynen geri yollar: eski deger DISKTE korunmali
  const geri = await istek(port, 'POST', '/api/saglayici', { govde: { id: 'custom', config: { ...c, method: 'PUT' } } });
  assert.equal(geri.status, 200, geri.metin);
  const disk = JSON.parse(fs.readFileSync(path.join(s.veri, 'providers.json'), 'utf8')).entries.custom;
  assert.equal(disk.url, ozel.url, 'maskeli url diske yazildi');
  assert.equal(disk.body, ozel.body, 'maskeli govde diske yazildi');
  assert.equal(disk.pollUrl, ozel.pollUrl, 'maskeli pollUrl diske yazildi');
  assert.equal(disk.headers, ozel.headers, 'maskeli basliklar diske yazildi');
  assert.equal(disk.method, 'PUT', 'maskesiz alan guncellenebilmeli');

  // Kullanici adresi gercekten degistirirse yeni deger yazilir
  const yeni = await istek(port, 'POST', '/api/saglayici', { govde: { id: 'custom', config: { ...c, url: 'https://yeni.example.test/v2/gen' } } });
  assert.equal(yeni.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.veri, 'providers.json'), 'utf8')).entries.custom.url, 'https://yeni.example.test/v2/gen');
  await durdur(s);
});

test('S-11: saglayici config nesne degilse 400 (500 degil)', async () => {
  const { port } = await ortak();
  for (const config of ['metin', 5, [1], true]) {
    const r = await istek(port, 'POST', '/api/saglayici', { govde: { id: 'custom', config } });
    assert.equal(r.status, 400, `config=${JSON.stringify(config)}: ${r.status} ${r.metin.slice(0, 100)}`);
  }
});

test('S-11: 250 KB\'lik "a.a.a." adresi/basligi/govdesi maskelemede kareli degil (diskte kalmis ayar GET\'i kilitlemez); yeni yazma sinirda 400', async () => {
  const dev = 'a.'.repeat(125000);
  const s = await sunucuBaslat({
    oncedenYaz: (veri) => fs.writeFileSync(path.join(veri, 'providers.json'),
      JSON.stringify({ active: 'custom', entries: { custom: { url: dev, pollUrl: dev, headers: dev, body: dev } } })),
  });
  try {
    const t = Date.now();
    const liste = await istek(s.port, 'GET', '/api/saglayicilar');
    const sure = Date.now() - t;
    assert.equal(liste.status, 200, liste.metin.slice(0, 200));
    assert.ok(sure < 3000, `GET /api/saglayicilar ${sure} ms surdu (maskeleme regex'i kareli: olay dongusu kilitlendi)`);

    // yeni yazma: ayni dev deger kabul edilmez, ayar dosyasi degismez
    for (const config of [{ url: dev }, { headers: dev }, { body: dev }, { pollUrl: 'u'.repeat(5000) }]) {
      const t2 = Date.now();
      const r = await istek(s.port, 'POST', '/api/saglayici', { govde: { id: 'custom', config } });
      assert.equal(r.status, 400, `${Object.keys(config)[0]}: ${r.status} ${r.metin.slice(0, 120)}`);
      assert.match(r.metin, /en fazla \d+ karakter/);
      assert.ok(Date.now() - t2 < 3000, 'reddetme gecikmeli');
    }
    // sinir icindeki uzun govde sablonu yazilir
    const uzun = 'x'.repeat(10000);
    const iyi = await istek(s.port, 'POST', '/api/saglayici', { govde: { id: 'custom', config: { body: uzun } } });
    assert.equal(iyi.status, 200, iyi.metin.slice(0, 200));
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.veri, 'providers.json'), 'utf8')).entries.custom.body, uzun);
  } finally { await durdur(s); }
});

/* =================================================================== S-13 */

test('S-13: PID baska bir surecin (yeniden kullanilmis) bayat .instance baslatmayi engellemez; port bos oldugu icin devralinir', async () => {
  const port = await bosPort();
  const s = await sunucuBaslat({
    port,
    oncedenYaz: (veri) => fs.writeFileSync(path.join(veri, '.instance'), JSON.stringify({
      pid: process.pid, // canli ama ai-infapp degil: PID yeniden kullanimi
      port,
      at: new Date(Date.now() - 3600 * 1000).toISOString(),
    })),
  });
  const kilit = JSON.parse(fs.readFileSync(path.join(s.veri, '.instance'), 'utf8'));
  assert.equal(kilit.pid, s.surec.pid, 'kilit yeni sunucuya devredilmeli');
  await durdur(s);
});

test('S-13: gercekten calisan ikinci ornek yine ENGELLENIR (ayni veri klasoru)', async () => {
  const a = await sunucuBaslat();
  const portB = await bosPort([a.port]);
  const b = gercekSpawn.call(cp, process.execPath, [path.join(KOK, 'server.js')], {
    cwd: KOK, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AI_INFAPP_VERI: a.veri, AI_INFAPP_PORT: String(portB) },
  });
  let cikti = '';
  b.stdout.on('data', (c) => { cikti += c; });
  b.stderr.on('data', (c) => { cikti += c; });
  const kod = await Promise.race([new Promise((r) => b.once('exit', r)), bekle(8000).then(() => 'zaman-asimi')]);
  if (kod === 'zaman-asimi') b.kill();
  assert.equal(kod, 1, `ikinci ornek kapanmali: ${cikti}`);
  assert.match(cikti, /zaten bir panel calisiyor/);
  assert.equal((await istek(a.port, 'GET', '/api/durum')).status, 200, 'birinci ornek etkilenmemeli');
  await durdur(a);
});

test('S-13: yeni baslayan (10 sn icinde) ve portu henuz acilmamis sahip bayat sayilmaz', async () => {
  // Kilidi tutan surec acilis aninda; port henuz dinlemiyor olabilir. Bu durumda devralmak iki ornek demek.
  const port = await bosPort();
  const veri = geciciKlasor('taze');
  fs.writeFileSync(path.join(veri, '.instance'), JSON.stringify({ pid: process.pid, port, at: new Date().toISOString() }));
  const b = gercekSpawn.call(cp, process.execPath, [path.join(KOK, 'server.js')], {
    cwd: KOK, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AI_INFAPP_VERI: veri, AI_INFAPP_PORT: String(port) },
  });
  let cikti = '';
  b.stdout.on('data', (c) => { cikti += c; });
  b.stderr.on('data', (c) => { cikti += c; });
  const kod = await Promise.race([new Promise((r) => b.once('exit', r)), bekle(8000).then(() => 'zaman-asimi')]);
  if (kod === 'zaman-asimi') b.kill();
  assert.equal(kod, 1, `taze kilit korunmali: ${cikti}`);
});

/* =================================================================== S-10 */

function veriDosyasi(ad, icerik) {
  const f = path.join(VERI, ad);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof icerik === 'string' ? icerik : JSON.stringify(icerik));
  return f;
}

function veriyiTemizle() {
  for (const ad of fs.readdirSync(VERI)) fs.rmSync(path.join(VERI, ad), { recursive: true, force: true });
}

function sirliVeriKur() {
  veriyiTemizle();
  store.ensureDirs();
  veriDosyasi('character.json', { identity: { name: 'Test' } });
  veriDosyasi('gallery.json', [{ id: 'img_1', filename: 'img_1.png' }]);
  veriDosyasi('images/img_1.png', 'png');
  veriDosyasi('providers.json', { active: 'fal', entries: { fal: { apiKey: 'SEKRET-PROVIDERS' } } });
  veriDosyasi('upscaler.json', { active: 'replicate', entries: { replicate: { apiKey: 'SEKRET-UPSCALER' } } });
  veriDosyasi('etsy-api.json', { apiKey: 'SEKRET-ETSY-API' });
  veriDosyasi('etsy-magaza.json', { accessToken: 'SEKRET-ETSY-ACCESS', refreshToken: 'SEKRET-ETSY-REFRESH' });
  veriDosyasi('_arsiv/eski-damga/character.json', { identity: { name: 'ESKI-KARAKTER' } });
  veriDosyasi('_arsiv/eski-damga/providers.json', { entries: { fal: { apiKey: 'SEKRET-ESKI-ARSIV' } } });
  veriDosyasi('_arsiv/silinen/img_0.png', 'png');
}

function diskteSekretVarMi() {
  const bulunan = [];
  (function gez(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const tam = path.join(d, e.name);
      if (e.isDirectory()) gez(tam);
      else if (/SEKRET/.test(fs.readFileSync(tam, 'utf8'))) bulunan.push(path.relative(VERI, tam));
    }
  })(VERI);
  return bulunan.sort();
}

test('S-10: resetAll({keepProviders:false}) tum anahtar dosyalarini (providers, upscaler, etsy) arsive TASIMADAN siler', () => {
  sirliVeriKur();
  const sonuc = store.resetAll({ hard: false, keepProviders: false });
  const kalan = diskteSekretVarMi().filter((f) => !f.startsWith('_arsiv' + path.sep + 'eski-damga'));
  assert.deepEqual(kalan, [], 'anahtar iceren dosya diskte kaldi');
  for (const ad of ['providers.json', 'upscaler.json', 'etsy-api.json', 'etsy-magaza.json']) {
    assert.ok(!fs.existsSync(path.join(VERI, ad)), `${ad} silinmeliydi`);
  }
  assert.ok(sonuc.archive && fs.existsSync(path.join(sonuc.archive, 'character.json')), 'karakter yine arsive tasinir (geri alinabilir)');
  assert.ok(Array.isArray(sonuc.secretsRemoved) && sonuc.secretsRemoved.length === 4, JSON.stringify(sonuc.secretsRemoved));
});

test('S-10: resetAll varsayilani (keepProviders) anahtar dosyalarina dokunmaz', () => {
  sirliVeriKur();
  store.resetAll({ hard: false, keepProviders: true });
  for (const ad of ['providers.json', 'upscaler.json', 'etsy-api.json', 'etsy-magaza.json']) {
    assert.ok(fs.existsSync(path.join(VERI, ad)), `${ad} korunmaliydi`);
  }
  assert.ok(!fs.existsSync(path.join(VERI, 'character.json')));
  assert.ok(fs.existsSync(path.join(VERI, '_arsiv', 'eski-damga')), 'eski arsive dokunulmaz (kalici silme istenmedi)');
});

test('S-10: resetAll({hard:true, keepProviders:false}) onceki arsivleri ve anahtarlari da kalici siler', () => {
  sirliVeriKur();
  const sonuc = store.resetAll({ hard: true, keepProviders: false });
  assert.deepEqual(diskteSekretVarMi(), [], 'SEKRET iceren dosya diskte kaldi');
  assert.ok(!fs.existsSync(path.join(VERI, '_arsiv')), 'onceki arsivler "kalici silindi" demesine ragmen duruyor');
  assert.ok(!fs.existsSync(path.join(VERI, 'character.json')));
  assert.equal(fs.readdirSync(store.IMAGES_DIR).length, 0);
  assert.equal(sonuc.archiveRemoved, true);
  veriyiTemizle();
  store.ensureDirs();
});

test('S-10: reset.js --confirm --all anahtarlari gercekten siler ve mesaji sonuca gore yazar', () => {
  sirliVeriKur();
  const calis = (...args) => cp.spawnSync(process.execPath, [path.join(KOK, 'reset.js'), ...args], {
    cwd: KOK, env: { ...process.env, AI_INFAPP_VERI: VERI }, encoding: 'utf8', windowsHide: true,
  });
  const korunan = calis('--confirm');
  assert.equal(korunan.status, 0, korunan.stderr);
  assert.match(korunan.stdout, /korundu/);
  assert.ok(fs.existsSync(path.join(VERI, 'etsy-magaza.json')));

  const hepsi = calis('--confirm', '--all');
  assert.equal(hepsi.status, 0, hepsi.stderr);
  assert.match(hepsi.stdout, /API anahtarlari/);
  for (const ad of ['providers.json', 'upscaler.json', 'etsy-api.json', 'etsy-magaza.json']) {
    assert.ok(!fs.existsSync(path.join(VERI, ad)), `${ad} --all ile silinmeliydi`);
  }
  veriyiTemizle();
  store.ensureDirs();
});

/* =================================================================== S-07 / S-08 / S-09 / S-15 / S-16 */

function ciktiKokuKur(ad) {
  const kok = path.join(geciciKlasor(ad), 'cikti');
  fs.mkdirSync(kok, { recursive: true });
  output.saveConfig({ enabled: true, root: kok });
  return kok;
}

test('S-07: "klasor ac" bir DOSYAYI acmaz (explorer.exe <dosya> calistirirdi)', () => {
  const kok = ciktiKokuKur('ac');
  fs.writeFileSync(path.join(kok, 'evil.cmd'), 'echo pwn');
  spawnKaydi.length = 0;
  assert.throws(() => output.openFolder('evil.cmd'), (e) => e.status === 400 && /klasor/i.test(e.message));
  assert.throws(() => output.openFolder(path.join(kok, 'evil.cmd')), (e) => e.status === 400);
  assert.equal(spawnKaydi.length, 0, 'surec baslatilmamaliydi');

  fs.mkdirSync(path.join(kok, 'is-1'));
  assert.equal(output.openFolder('is-1'), path.join(kok, 'is-1'), 'klasor hala acilabilmeli');
  assert.equal(spawnKaydi.length, 1);
  assert.deepEqual(spawnKaydi[0].args, [path.join(kok, 'is-1')]);
  assert.equal(output.openFolder(), kok, 'argumansiz cagri koku acar');
  // kok disina cikis ve olmayan klasor hep reddedilir
  assert.throws(() => output.openFolder(path.join(kok, '..')), /Yalnizca/);
  assert.throws(() => output.openFolder('yok-boyle-klasor'), /henuz olusmamis/);
});

test('S-09: acilan surecin "error" olayi sunucuyu oldurmez (xdg-open/open/explorer yoksa)', () => {
  const kok = ciktiKokuKur('hata');
  fs.mkdirSync(path.join(kok, 'is-2'));
  spawnKaydi.length = 0;
  output.openFolder('is-2');
  assert.equal(spawnKaydi.length, 1);
  assert.ok(spawnKaydi[0].cocuk.listenerCount('error') >= 1, 'error dinleyicisi yok: yakalanmamis istisna sureci kapatir');
  assert.doesNotThrow(() => spawnKaydi[0].cocuk.emit('error', Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' })));
});

test('S-08: cikti kokunde UNC, \\\\?\\, \\\\.\\ ve sistem/Baslangic klasorleri reddedilir; normal klasorler kabul', () => {
  const reddedilmeli = [
    '\\\\?\\C:\\Windows\\System32', '\\\\?\\C:\\Windows', '\\\\.\\C:\\Windows', '\\\\localhost\\C$\\Windows\\System32',
    '\\\\evil-host\\share\\x', '//evil-host/share/x', '\\\\?\\UNC\\evil-host\\share\\x',
  ];
  if (process.platform === 'win32') {
    const sr = process.env.SystemRoot || 'C:\\Windows';
    reddedilmeli.push(
      sr, path.join(sr, 'System32'), 'C:/Windows', 'C:\\Windows\\..\\Windows',
      process.env.ProgramFiles || 'C:\\Program Files', 'C:\\Program Files\\x',
      process.env.ProgramData || 'C:\\ProgramData', path.join(process.env.ProgramData || 'C:\\ProgramData', 'x'),
      path.join(process.env.APPDATA || 'C:\\Users\\x\\AppData\\Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
    );
    // 8.3 kisa ad (C:\PROGRA~1): makinede kisa ad uretimi aciksa gercek yola cozulup reddedilmeli
    try {
      if (fs.realpathSync.native('C:\\PROGRA~1').toLowerCase() === (process.env.ProgramFiles || 'C:\\Program Files').toLowerCase()) reddedilmeli.push('C:\\PROGRA~1\\x');
    } catch (e) { /* kisa ad yok */ }
  }
  for (const yol of reddedilmeli) {
    assert.throws(() => output.validateRoot(yol), (e) => e instanceof Error && e.status === 400, `kabul edildi: ${yol}`);
  }
  const iyi = path.join(os.tmpdir(), 'Ai Infapp Test');
  assert.equal(output.validateRoot(iyi), path.resolve(iyi));
  assert.equal(output.validateRoot(path.join(os.homedir(), 'Desktop', 'Ai Infapp')), path.resolve(os.homedir(), 'Desktop', 'Ai Infapp'));
  assert.throws(() => output.validateRoot('goreli/yol'), (e) => e.status === 400);
  assert.throws(() => output.validateRoot(''), (e) => e.status === 400);
  // saveConfig de ayni kapidan geciyor: reddedilen yol config'e YAZILMAZ
  const onceki = output.getConfig().root;
  assert.throws(() => output.saveConfig({ root: '\\\\evil-host\\share\\x' }));
  assert.equal(output.getConfig().root, onceki);
});

test('S-14: POST /api/cikti kullanici hatasi 400 doner (500 degil)', async () => {
  const { port } = await ortak();
  const r = await istek(port, 'POST', '/api/cikti', { govde: { root: '\\\\evil-host\\share\\x' } });
  assert.equal(r.status, 400, r.metin.slice(0, 160));
  const dosya = await istek(port, 'POST', '/api/cikti/ac', { govde: { path: 'olmayan-klasor' } });
  assert.equal(dosya.status, 400, dosya.metin.slice(0, 160));
});

test('S-15: AI_INFAPP_VERI verilince varsayilan cikti koku gecici veri klasorunun icinde (gercek masaustu degil)', () => {
  assert.equal(output.defaultRoot(), path.join(store.DATA_DIR, 'cikti'));
  const cikti = path.join(VERI, 'cikti.json');
  try { fs.rmSync(cikti, { force: true }); } catch (e) { /* yok */ }
  const cfg = output.getConfig();
  assert.equal(cfg.root, path.join(store.DATA_DIR, 'cikti'));
  const desktop = output.detectDesktop();
  if (desktop) assert.ok(!cfg.root.startsWith(desktop), 'varsayilan kok gercek masaustunu gosteriyor');
});

test('S-16: proje icindeki cikti kokunde kendi .gitignore\'u olusur (uretim ciktilari commit\'e girmez)', () => {
  const sahteDepo = geciciKlasor('depo-koku');
  const eskiKok = store.ROOT;
  store.ROOT = sahteDepo;
  try {
    const kok = path.join(sahteDepo, 'cikti');
    output.saveConfig({ enabled: true, root: kok });
    const is = output.createJobFolder({ studio: 'karakter', title: 'git-testi' });
    assert.ok(is && fs.existsSync(is.path));
    const ign = path.join(kok, '.gitignore');
    assert.ok(fs.existsSync(ign), '.gitignore olusmadi');
    assert.match(fs.readFileSync(ign, 'utf8'), /^\*\s*$/m);
    // proje DISINDAKI kokte (masaustu gibi) hicbir dosya eklenmez
    const disKok = path.join(geciciKlasor('dis'), 'cikti');
    output.saveConfig({ enabled: true, root: disKok });
    output.createJobFolder({ studio: 'karakter', title: 'dis' });
    assert.ok(!fs.existsSync(path.join(disKok, '.gitignore')), 'proje disi kokte .gitignore olusmamali');
  } finally {
    store.ROOT = eskiKok;
  }
});

/* =================================================================== S-17 */

test('S-17: sahip olunan kaynaklarda BOM, Kiril, U+FFFD, NUL ve gorunmez kontrol karakteri yok', () => {
  const dosyalar = [
    'server.js', 'reset.js', 'src/store.js', 'src/output.js', 'src/reference.js', 'src/wizard.js', 'src/welcome.js',
    'src/persona.js', 'src/life.js', 'src/traits.js', 'src/brief.js', 'src/caption.js', 'src/scenes.js', 'src/promptcraft.js', 'src/rng.js',
  ];
  for (const ad of dosyalar) {
    const ham = fs.readFileSync(path.join(KOK, ad));
    assert.ok(!(ham[0] === 0xEF && ham[1] === 0xBB && ham[2] === 0xBF), `${ad}: BOM var`);
    const metin = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(ham);
    assert.ok(!/[\u0400-\u04FF]/.test(metin), `${ad}: Kiril harf (gorunmeyen homoglif) var`);
    assert.ok(!metin.includes('\uFFFD'), `${ad}: U+FFFD var`);
    assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(metin), `${ad}: kontrol karakteri var`);
  }
});

/* =================================================================== S-11 birim: maskeleme ayrintilari */

test('S-11: kisa jeton ("Bearer shortTok1234") ve base64 parcalari secret alanda maskelenir; MIME ve basliklar okunur kalir', async () => {
  const s = await sunucuBaslat();
  const baslik = '{"content-type":"application/json","Authorization":"Bearer shortTok1234","x-api-key":"AbC123+/xyz=QQ"}';
  const r = await istek(s.port, 'POST', '/api/saglayici', { govde: { id: 'custom', config: { headers: baslik } } });
  assert.equal(r.status, 200, r.metin);
  const goster = r.json.config.headers;
  assert.ok(!goster.includes('shortTok1234'), goster);
  assert.ok(!goster.includes('AbC123+/xyz'), goster);
  assert.match(goster, /application\/json/, 'icerik turu okunur kalmali');
  assert.match(goster, /"Authorization"/, 'baslik adi okunur kalmali');
  await durdur(s);
});

/* =================================================================== S-18 */

test('S-18: karsilama ekrani linksiz ve reklamsiz; POST /api/karsilama cevap beklemez, ekrani bir kez kapatir', async () => {
  const s = await sunucuBaslat();
  const g = await istek(s.port, 'GET', '/api/karsilama');
  assert.equal(g.status, 200, g.metin);
  const w = g.json.welcome;
  assert.ok(!/https?:|www\.|vidiq|affili|referans/i.test(JSON.stringify(w)), 'karsilama link/reklam/ucuncu taraf onerisi icermemeli');
  assert.equal(w.offer, undefined);
  assert.equal(w.options, undefined);
  assert.equal(typeof w.button, 'string');
  assert.ok(Array.isArray(w.body) && w.body.length >= 3);
  assert.ok(!g.json.state.welcomeSeen, 'ilk acilista henuz gorulmemis');
  const p = await istek(s.port, 'POST', '/api/karsilama', { govde: {} });
  assert.equal(p.status, 200, p.metin);
  assert.equal(p.json.state.welcomeSeen, true);
  assert.ok(!p.json.state.welcomeAnswer, 'cevap saklanmaz (soru kalmadi)');
  const g2 = await istek(s.port, 'GET', '/api/karsilama');
  assert.equal(g2.json.state.welcomeSeen, true, 'bir daha cikmaz');
  await durdur(s);
});
