'use strict';

/**
 * STUDYO / RASTER / KUTUPHANE GUVENLIGI
 *
 * Studyolar (Etsy, Fotoroman, Reklam), raster motoru ve sahne kutuphanesi
 * istemciden gelen veriyle calisir. Bu dosya su sozleri teste baglar:
 *
 *   C-01  olcu/aile/palet listeleri tekrarsiz ve tablo boyutuyla sinirli:
 *         kucuk bir istek yuz binlerce SVG uretip sunucuyu cokertemez
 *   C-02  Etsy magaza yapilandirmasi HAM API anahtarini disari vermez
 *   C-03  fotoroman panelNo'su SVG ozniteligine kacissiz girmez
 *   C-04  bassiz Chrome kapali kutuda: kendi profili, agsiz, loopback'e kapali
 *   C-05  fotoroman en fazla 24 kare / 280 karakterlik balon; fazlasi 400
 *   C-06  kutuphane aramasinda terim sayisi sinirli, 'constructor' 500 vermez
 *   C-07  kaynakta ham NUL / DEL / kontrol karakteri yok
 *   C-08  secenek tablolari yalniz KENDI anahtarlariyla yoklanir
 *   C-09  galeriye/sablona yalniz bilinen alanlar, sinirli uzunlukta yazilir
 *
 * Gercek data/ klasorune ve masaustune dokunulmaz: veri klasoru gecici
 * (AI_INFAPP_VERI) ve masaustu ciktisi kapali. Ag yok; yerel sahte sunucu
 * 127.0.0.1 uzerinde. Chrome gerektiren testler Chrome yoksa atlanir.
 *
 * Calistir:  node --test ai-infapp/test/studyo-guvenlik.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const cp = require('child_process');

/* ------------------------------------------------- gecici veri klasoru
 * store / output require edilmeden ONCE ayarlanmali: yollar yukleme aninda
 * hesaplaniyor. Asagidaki kapi, ayar tutmadiysa (gercek data/ gorunuyorsa)
 * hicbir sey calistirmadan durur. */
const VERI = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-studyo-'));
process.env.AI_INFAPP_VERI = VERI;
fs.writeFileSync(
  path.join(VERI, 'cikti.json'),
  JSON.stringify({ enabled: false, root: path.join(VERI, 'cikti') })
);

/* ------------------------------------------------- execFile gozlemcisi
 * raster.js execFile'i yukleme aninda alir; bu yuzden SRC require edilmeden
 * once sarmalaniyor. execKaydi bir dizi ise Chrome CALISTIRILMAZ, yalniz
 * arguman listesi kaydedilir; degilse gercek execFile calisir. */
const gercekExecFile = cp.execFile;
let execKaydi = null;
cp.execFile = function sarmalanmisExecFile(...a) {
  if (execKaydi) {
    const bitis = a.find((x) => typeof x === 'function');
    const args = Array.isArray(a[1]) ? a[1] : [];
    let html = null; // Chrome'a verilecek sayfa (cagridan sonra silinir, bu yuzden simdi okunur)
    try { html = fs.readFileSync(new URL(args[args.length - 1]), 'utf8'); } catch { /* sayfa degil */ }
    execKaydi.push({ dosya: a[0], args, html });
    process.nextTick(() => bitis(new Error('sahte: Chrome calistirilmadi'), '', ''));
    return { kill() {} };
  }
  return gercekExecFile.apply(cp, a);
};

const SRC = path.join(__dirname, '..', 'src');
const store = require(path.join(SRC, 'store'));
const output = require(path.join(SRC, 'output'));
const raster = require(path.join(SRC, 'raster'));
const studios = require(path.join(SRC, 'studios'));
const design = require(path.join(SRC, 'studios', 'etsy', 'design'));
const duvar = require(path.join(SRC, 'studios', 'etsy', 'duvar'));
const listing = require(path.join(SRC, 'studios', 'etsy', 'listing'));
const magaza = require(path.join(SRC, 'studios', 'etsy', 'magaza'));
const mockup = require(path.join(SRC, 'studios', 'etsy', 'mockup'));
const reklamDesign = require(path.join(SRC, 'studios', 'reklam', 'design'));
const hikaye = require(path.join(SRC, 'studios', 'fotoroman', 'hikaye'));
const sayfa = require(path.join(SRC, 'studios', 'fotoroman', 'sayfa'));
const kutuphane = require(path.join(SRC, 'kutuphane'));
const tipografi = require(path.join(SRC, 'tipografi'));

if (store.DATA_DIR !== path.resolve(VERI) || output.getConfig().enabled !== false) {
  throw new Error(
    `Test durduruldu: veri klasoru gecici degil (${store.DATA_DIR}) ya da masaustu ciktisi acik. `
    + 'Gercek veriye dokunmamak icin hicbir test calistirilmadi.'
  );
}

const ROUTES = studios.routes();
const cagir = (anahtar, govde) => ROUTES[anahtar](govde || {});

test.after(() => {
  cp.execFile = gercekExecFile;
  try { fs.rmSync(VERI, { recursive: true, force: true }); } catch { /* gecici klasor */ }
});

/* ------------------------------------------------------------ yardimcilar */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

/** Chrome'u sahte rasterle degistirir; cagrilari sayar ve geri koyar. */
async function sahteRasterle(fn) {
  const eski = { svgToPng: raster.svgToPng, svgToPdf: raster.svgToPdf, available: raster.available };
  const cagrilar = { png: [], pdf: [] };
  raster.svgToPng = async (svg, w, h) => { cagrilar.png.push({ w, h }); return PNG; };
  raster.svgToPdf = async (svg, w, h) => { cagrilar.pdf.push({ w, h }); return Buffer.from('%PDF-1.4 sahte'); };
  raster.available = () => true;
  try {
    return await fn(cagrilar);
  } finally {
    Object.assign(raster, eski);
  }
}

const MIRAS = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
const BOZUK = /undefined|NaN|\[object|function /;

function kare(no, metin) {
  return {
    panelNo: no, perde: 'kurulus', perdeLabel: 'Kurulus', shotKey: 'wide', pose: 'ayakta',
    balon: metin ? { tip: 'konusma', metin } : null,
  };
}

const galeriDosyaBoyu = () => fs.statSync(path.join(VERI, 'gallery.json')).size;

/** 127.0.0.1 uzerinde sahte sunucu; 4290-4299'u dener, doluysa isletim sistemine birakir. */
function sahteSunucu(isle) {
  const srv = http.createServer(isle);
  const portlar = [4290, 4291, 4292, 4293, 4294, 4295, 4296, 4297, 4298, 4299, 0];
  return new Promise((resolve, reject) => {
    const dene = (i) => {
      const onHata = (err) => {
        if (err.code === 'EADDRINUSE' && i + 1 < portlar.length) dene(i + 1);
        else reject(err);
      };
      srv.once('error', onHata);
      srv.listen(portlar[i], '127.0.0.1', () => {
        srv.removeListener('error', onHata);
        resolve({ srv, port: srv.address().port });
      });
    };
    dene(0);
  });
}

/** Chrome yalnizca "kurulu" degil, bu ortamda bassiz render de edebiliyor mu? (bir kez denenir) */
let chromeDurumu;
async function chromeCalisiyor() {
  if (chromeDurumu !== undefined) return chromeDurumu;
  if (!raster.available()) { chromeDurumu = false; return false; }
  try {
    const b = await raster.svgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>', 8, 8);
    chromeDurumu = Buffer.isBuffer(b) && b.length > 50;
  } catch {
    chromeDurumu = false;
  }
  return chromeDurumu;
}

/** Basliksiz Chrome yuk altinda ara sira takilip zaman asimina dusebiliyor (CI); sinanan sey bu degil, bir kez daha dene. */
async function tekrarDene(fn, n = 2) {
  let son;
  for (let i = 0; i < n; i++) { try { return await fn(); } catch (e) { son = e; } }
  throw son;
}

/* ═════════════════════════════════════════════════════════════════ C-01 */

test('C-01 duvar.paket: tekrarlanan olcu/aile/palet listesi isi buyutmez', () => {
  const p = duvar.paket({ adet: 3, olculer: Array(2000).fill('ipad') });
  assert.equal(p.dosyaSayisi, 3);
  assert.deepEqual(p.olculer, ['ipad']);
  assert.equal(p.tasarimlar.length, 3);
  assert.equal(p.tasarimlar[0].dosyalar.length, 1);

  const q = duvar.paket({
    adet: 4, aileler: Array(3000).fill('gradyan'), paletler: Array(3000).fill('toprak'),
  });
  assert.equal(q.tasarimlar.length, 4);
  assert.ok(q.tasarimlar.every((t) => t.aile === 'gradyan' && t.palet === 'toprak'));

  // Tekilleme kaynak sirasini korur ve gecersiz adlari atar.
  const r = duvar.paket({ adet: 1, olculer: ['ipad', 'yok', 'iphone', 'ipad', 'constructor'] });
  assert.deepEqual(r.olculer, ['ipad', 'iphone']);
});

test('C-01 duvar.paket: adet ust sinirda kalir', () => {
  const p = duvar.paket({ adet: 1e9, olculer: ['iphone'], aileler: ['gradyan'], paletler: ['toprak'] });
  assert.equal(p.tasarimlar.length, duvar.ADET_UST);
  assert.equal(p.dosyaSayisi, duvar.ADET_UST);
});

test('C-01 POST /duvar/paket: 25 KB yerine tek olculuk is', async () => {
  const r = await cagir('POST /api/etsy/duvar/paket', { adet: 3, olculer: Array(3000).fill('ipad') });
  assert.equal(r.dosyaSayisi, 3);
  assert.equal(r.adet, 3);
  assert.deepEqual(r.olculer, ['ipad']);
});

test('C-01 POST /toplu: ayni olcu tekrar tekrar uretilmez, miras adlar olcu sayilmaz', async () => {
  await sahteRasterle(async (c) => {
    const r = await cagir('POST /api/etsy/toplu', {
      design: { lines: ['B'] },
      sizes: ['sticker', 'sticker', 'sticker', 'constructor', '__proto__'],
    });
    assert.equal(r.sonuclar.length, 1);
    assert.equal(r.hatalar.length, 0);
    assert.equal(c.png.length, 1);
    assert.deepEqual(c.png[0], { w: 900, h: 900 });
  });
});

/* ═════════════════════════════════════════════════════════════════ C-02 */

test('C-02 magaza.getConfig ham API anahtarini disari vermez', async () => {
  const ANAHTAR = 'abcd1234EFGH5678ijkl9012';
  magaza.saveConfig({ apiKey: ANAHTAR, redirectUri: 'https://example.com/etsy' });

  const cfg = magaza.getConfig();
  assert.ok(!JSON.stringify(cfg).includes(ANAHTAR), 'getConfig ham anahtari tasiyor');
  assert.ok(cfg.apiKeyMask.endsWith('9012'));
  assert.equal(cfg.redirectUri, 'https://example.com/etsy');

  // Disari cikan her rota ayni nesneyi donduruyor.
  const yanitlar = [
    await cagir('GET /api/etsy/magaza/durum'),
    await cagir('POST /api/etsy/magaza/ayar', { apiKey: ANAHTAR, redirectUri: 'https://example.com/etsy' }),
    await cagir('POST /api/etsy/magaza/kopar'),
  ];
  for (const y of yanitlar) {
    assert.ok(!JSON.stringify(y).includes(ANAHTAR), 'rota yaniti ham anahtari tasiyor');
  }

  // Modulun kendi akisi (yetkilendirme adresi) anahtari hala kullanabilmeli.
  const url = new URL(magaza.buildAuthUrl().url);
  assert.equal(url.searchParams.get('client_id'), ANAHTAR);

  // Panel maskeyi geri gonderirse kayitli anahtar bozulmaz.
  magaza.saveConfig({ apiKey: cfg.apiKeyMask });
  assert.equal(new URL(magaza.buildAuthUrl().url).searchParams.get('client_id'), ANAHTAR);
});

test('C-02 Etsy pazar yaniti anahtari maskeli verir', async () => {
  const ANAHTAR = 'zzzz0000YYYY1111xxxx2222';
  await cagir('POST /api/etsy/pazar/anahtar', { apiKey: ANAHTAR });
  const d = await cagir('GET /api/etsy/pazar/durum');
  assert.ok(!JSON.stringify(d).includes(ANAHTAR));
  assert.ok(d.anahtar.endsWith('2222'));
});

test('C-02 anahtar/jeton dosyalari yalniz sahibine acik yazilir (mod 0600)', async () => {
  // Windows mod bitlerini yok sayar; bu yuzden yazma cagrisinin SECENEGI de dogrulanir.
  const gercek = fs.writeFileSync;
  const yazimlar = [];
  fs.writeFileSync = function izleyici(dosya, veri, secenek, ...diger) {
    if (/etsy-(magaza|api)\.json$/.test(String(dosya))) yazimlar.push({ dosya: String(dosya), secenek });
    return gercek.call(this, dosya, veri, secenek, ...diger);
  };
  try {
    magaza.saveConfig({ apiKey: 'k'.repeat(24) });
    await cagir('POST /api/etsy/pazar/anahtar', { apiKey: 'p'.repeat(24) });
  } finally {
    fs.writeFileSync = gercek;
  }
  assert.ok(yazimlar.some((y) => /etsy-magaza\.json$/.test(y.dosya)), 'magaza yapilandirmasi yazilmadi');
  assert.ok(yazimlar.some((y) => /etsy-api\.json$/.test(y.dosya)), 'pazar yapilandirmasi yazilmadi');
  for (const y of yazimlar) {
    assert.equal(y.secenek && y.secenek.mode, 0o600, `${path.basename(y.dosya)} 0600 ile yazilmiyor`);
  }
  if (process.platform !== 'win32') {
    for (const y of yazimlar) assert.equal(fs.statSync(y.dosya).mode & 0o077, 0, `${path.basename(y.dosya)} baskalarina acik`);
  }
});

/* ═════════════════════════════════════════════════════════════════ C-03 */

test('C-03 fotoroman: panelNo SVG ozniteligine kacissiz girmez', () => {
  const kotu = '1"/><script>new Image().src="http://127.0.0.1:1/pwn"</script><x a="';
  const r = sayfa.sayfalar({ baslik: 'x', kareler: [kare(kotu, 'merhaba')] }, { size: 'kare' });
  const svg = r.sayfalar[0];
  // Dusmanca metin yalniz KACISLI metin olarak gorunebilir (placeholder yazisi); etiket olusmamali.
  assert.doesNotMatch(svg, /<(script|x)\b/i);
  const etiketler = new Set([...svg.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]));
  const izinli = new Set(['svg', 'rect', 'clipPath', 'text', 'path', 'circle', 'image']);
  assert.deepEqual([...etiketler].filter((e) => !izinli.has(e)), [], 'sayfada beklenmeyen etiket var');
  const idler = [...svg.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(idler.length >= 1);
  for (const id of idler) assert.match(id, /^[A-Za-z0-9_-]+$/, `gecersiz id: ${id}`);
  const ref = svg.match(/clip-path="url\(#([^)]*)\)"/);
  if (ref) assert.match(ref[1], /^[A-Za-z0-9_-]+$/);
});

test('C-03 fotoroman: gecerli panelNo icin id degismez (k<no>c)', () => {
  const r = sayfa.sayfalar({ baslik: 'x', kareler: [kare(3, 'a')] }, { size: 'kare' });
  assert.match(r.sayfalar[0], /<clipPath id="fr[0-9a-z]+k3c">/);
});

test('C-03 POST /onizleme: dusmanca panelNo yanita script olarak donmez', async () => {
  const r = await cagir('POST /api/fotoroman/onizleme', {
    hikaye: { baslik: 'x', kareler: [kare('"><script>x</script>', 'a')] },
    size: 'kare',
  });
  assert.doesNotMatch(r.sayfalar.join(''), /<script/i);
});

/* ═════════════════════════════════════════════════════════════════ C-04 */

const GUVENLI_BAYRAKLAR = [
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
];

function bayrakKontrol(args, ad) {
  const profil = args.find((a) => a.startsWith('--user-data-dir='));
  assert.ok(profil, `${ad}: --user-data-dir yok (gercek Chrome profili kullaniliyor)`);
  const klasor = path.resolve(profil.slice('--user-data-dir='.length));
  assert.ok(klasor.startsWith(path.resolve(os.tmpdir()) + path.sep), `${ad}: profil gecici klasorde degil`);
  for (const b of GUVENLI_BAYRAKLAR) assert.ok(args.includes(b), `${ad}: ${b} yok`);
}

test('C-04 raster: PNG, PDF ve glif olcumu kapali kutu bayraklariyla acilir', { skip: !raster.available() && 'Chrome/Edge yok' }, async () => {
  execKaydi = [];
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
    await assert.rejects(raster.svgToPng(svg, 10, 10));
    await assert.rejects(raster.svgToPdf(svg, 300, 300));
    await assert.rejects(raster.measureGlyphs('Arial', 400, 5000));
    assert.equal(execKaydi.length, 3);
    bayrakKontrol(execKaydi[0].args, 'svgToPng');
    bayrakKontrol(execKaydi[1].args, 'svgToPdf');
    bayrakKontrol(execKaydi[2].args, 'measureGlyphs');
    // Sayfa adresi (file://) hala son arguman: bayraklar onu itmemis olmali.
    for (const k of execKaydi) assert.match(k.args[k.args.length - 1], /^file:\/\/\//);
  } finally {
    execKaydi = null;
  }
});

test('C-04 raster: sayfadaki betik 127.0.0.1\'e istek atamaz, PNG yine uretilir', async (t) => {
  if (!(await chromeCalisiyor())) return t.skip('Chrome/Edge yok ya da bu ortamda bassiz calismiyor');
  let istek = 0;
  const { srv, port } = await sahteSunucu((req, res) => {
    istek += 1;
    res.writeHead(200, { 'access-control-allow-origin': '*' });
    res.end('ok');
  });
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">'
      + '<rect width="64" height="64" fill="#c00"/>'
      + `<script>new Image().src="http://127.0.0.1:${port}/img";`
      + `fetch("http://127.0.0.1:${port}/f",{mode:"no-cors"});</script></svg>`;
    const buf = await tekrarDene(() => raster.svgToPng(svg, 64, 64));
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(istek, 0, `sahte yerel sunucuya ${istek} istek geldi`);
  } finally {
    srv.close();
  }
});

test('C-04 raster: Chrome\'a verilen sayfa icerik politikasi tasir (betik yok, ag yok) - Chrome calistirmadan sinanir', async () => {
  execKaydi = [];
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
    await assert.rejects(raster.svgToPng(svg, 10, 10));
    await assert.rejects(raster.svgToPdf(svg, 300, 300));
    await assert.rejects(raster.measureGlyphs('Arial', 400, 5000));
    assert.equal(execKaydi.length, 3);
    const [png, pdf, glif] = execKaydi.map((k) => k.html);
    for (const [ad, html] of [['svgToPng', png], ['svgToPdf', pdf], ['measureGlyphs', glif]]) {
      assert.ok(html, `${ad}: sayfa okunamadi`);
      assert.match(html, /<meta http-equiv="Content-Security-Policy"/, `${ad}: icerik politikasi yok`);
      assert.match(html, /default-src 'none'/, `${ad}: default-src 'none' degil`);
      assert.match(html, /connect-src 'none'/, `${ad}: fetch/XHR kapali degil`);
      assert.match(html, /img-src data: file: blob:/, `${ad}: gorsel kaynagi sinirli degil`);
      // Politika sayfadaki ilk icerikten ONCE gelmeli (sonrakini korumaz).
      assert.ok(html.indexOf('Content-Security-Policy') < html.search(/<svg|<style|<body|<script/), `${ad}: politika icerikten sonra`);
    }
    // Cizilen SVG'nin betigi calismaz; glif olcum sayfasi yalniz kendi satir ici betigini calistirir.
    assert.match(png, /script-src 'none'/);
    assert.match(pdf, /script-src 'none'/);
    assert.match(glif, /script-src 'unsafe-inline'/);
  } finally {
    execKaydi = null;
  }
});

test('C-04 raster: PDF ve glif olcumu kapali kutuda da calisir', async (t) => {
  if (!(await chromeCalisiyor())) return t.skip('Chrome/Edge yok ya da bu ortamda bassiz calismiyor');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300"/></svg>';
  const pdf = await tekrarDene(() => raster.svgToPdf(svg, 300, 300));
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  const tablo = await tekrarDene(() => raster.measureGlyphs('Arial', 400, 60000));
  assert.equal(typeof tablo.A, 'number');
  assert.ok(tablo.A > 0.3 && tablo.A < 1.2);
});

/* ═════════════════════════════════════════════════════════════════ C-05 */

test('C-05 fotoroman: 24 kareden fazlasi /onizleme /uret /pdf /senaryo icin 400', async () => {
  const h = { baslik: 'x', kareler: Array.from({ length: 25 }, (_, i) => kare(i + 1)) };
  // /senaryo once karakter ister; yoksa 404 doner ve dogrulamaya hic gelmez.
  fs.writeFileSync(path.join(VERI, 'character.json'), JSON.stringify({ identity: { name: 'Test' } }));
  try {
    await sahteRasterle(async (c) => {
      for (const yol of ['onizleme', 'uret', 'pdf', 'senaryo']) {
        await assert.rejects(
          () => cagir(`POST /api/fotoroman/${yol}`, { hikaye: h }),
          (e) => e.status === 400 && /24/.test(e.message),
          `${yol} reddetmedi`
        );
      }
      assert.equal(c.png.length, 0, 'Chrome (PNG) calistirildi');
      assert.equal(c.pdf.length, 0, 'Chrome (PDF) calistirildi');
    });
  } finally {
    fs.rmSync(path.join(VERI, 'character.json'), { force: true });
  }
});

test('C-05 fotoroman: tam 24 kare kabul edilir, bozuk kare 400 verir', async () => {
  const h = { baslik: 'x', kareler: Array.from({ length: hikaye.KARE_UST }, (_, i) => kare(i + 1, 'a')) };
  const r = await cagir('POST /api/fotoroman/onizleme', { hikaye: h });
  assert.equal(r.sayfaSayisi, 24);
  await assert.rejects(
    () => cagir('POST /api/fotoroman/onizleme', { hikaye: { baslik: 'x', kareler: [kare(1), null] } }),
    (e) => e.status === 400
  );
});

test('C-05 fotoroman: dev balon metni olay dongusunu mesgul etmez', () => {
  const dev = 'kelime '.repeat(150000); // ~1 MB
  const t0 = Date.now();
  const r = sayfa.sayfalar({ baslik: 'x', kareler: [kare(1, dev)] }, { size: 'kare' });
  const ms = Date.now() - t0;
  assert.ok(ms < 800, `1 MB balon metni ${ms} ms surdu`);
  // Cizilen metin sinirlidir (280 karakter ~ 40 kelime), satir satir bolunmus olsa da.
  const kelime = (r.sayfalar[0].match(/kelime/g) || []).length;
  assert.ok(kelime <= 60, `cikti ${kelime} kelime tasiyor`);
});

test('C-05 fotoroman: siniri asan balon metni uc noktayla kesilir, kisa metin aynen kalir', () => {
  const uzun = 'a'.repeat(1000);
  const k = sayfa.sayfalar({ baslik: 'x', kareler: [{ ...kare(1), balon: { tip: 'anlatici', metin: uzun } }] }, { size: 'kare' });
  assert.ok(!k.sayfalar[0].includes('a'.repeat(281)));
  const kisaMetin = sayfa.sayfalar({ baslik: 'x', kareler: [kare(1, 'Merhaba')] }, { size: 'kare' });
  assert.match(kisaMetin.sayfalar[0], /Merhaba/);
});

test('C-05 tipografi.sigdir: metin uzunlugu maliyeti sinirsiz buyutmez', () => {
  const t0 = Date.now();
  const r = tipografi.sigdir('kelime '.repeat(150000), 'kalin', 400, 120, { maxPx: 36, minPx: 14 });
  const ms = Date.now() - t0;
  assert.ok(ms < 500, `1 MB metin ${ms} ms surdu`);
  assert.ok(r.satirlar.length >= 1);
  // Normal metin degismez.
  assert.deepEqual(tipografi.sigdir('Merhaba dunya', 'kalin', 800, 200).satirlar, ['Merhaba dunya']);
});

/* ═════════════════════════════════════════════════════════════════ C-06 */

test('C-06 kutuphane.ara: miras adlar 500 vermez', () => {
  for (const q of ['constructor', '__proto__', 'CONSTRUCTOR']) {
    assert.doesNotThrow(() => kutuphane.ara({ sorgu: q }), q);
    const r = kutuphane.ara({ sorgu: q });
    assert.equal(typeof r.toplam, 'number');
  }
});

test('C-06 kutuphane.ara: terim sayisi sinirli, sorgu uzunlugu isi buyutmez', () => {
  const cop = Array.from({ length: 6000 }, (_, i) => `zq${i}`).join(' ');
  const t0 = Date.now();
  const r = kutuphane.ara({ sorgu: cop });
  const ms = Date.now() - t0;
  assert.ok(ms < 300, `6000 terimli sorgu ${ms} ms surdu`);
  assert.equal(r.toplam, 0);

  // Ilk TERIM_UST (6) terim aranir; sonrasi yok sayilir.
  const yedinci = kutuphane.ara({ sorgu: 'zq1 zq2 zq3 zq4 zq5 zq6 kar' });
  assert.equal(yedinci.toplam, 0, '7. terim hala aramaya katiliyor');
  const ilk = kutuphane.ara({ sorgu: 'kar zq1 zq2 zq3 zq4 zq5' });
  assert.ok(ilk.toplam > 0, 'ilk terimler aranmiyor');
});

test('C-06 kutuphane.ara: normal Turkce arama bozulmadi', () => {
  const r = kutuphane.ara({ sorgu: 'kafe', limit: 5 });
  assert.ok(r.toplam > 0);
  assert.ok(r.kayitlar.length <= 5);
  assert.ok(kutuphane.ara({ sorgu: 'deniz plaj' }).toplam > 0);
});

/* ═════════════════════════════════════════════════════════════════ C-07 */

const YASAK_BAYTLAR = (b) => b <= 0x08 || b === 0x0b || b === 0x0c || (b >= 0x0e && b <= 0x1f) || b === 0x7f;

function jsDosyalari(klasor, cikti = []) {
  for (const g of fs.readdirSync(klasor, { withFileTypes: true })) {
    const yol = path.join(klasor, g.name);
    if (g.isDirectory()) jsDosyalari(yol, cikti);
    else if (g.name.endsWith('.js')) cikti.push(yol);
  }
  return cikti;
}

test('C-07 studyo / raster / tipografi / glif / kutuphane kaynaklarinda ham kontrol karakteri yok', () => {
  const dosyalar = [
    ...jsDosyalari(path.join(SRC, 'studios')),
    ...jsDosyalari(path.join(SRC, 'kutuphane')),
    path.join(SRC, 'raster.js'), path.join(SRC, 'tipografi.js'), path.join(SRC, 'glifler.js'),
  ];
  const sorunlar = [];
  for (const d of dosyalar) {
    const b = fs.readFileSync(d);
    for (let i = 0; i < b.length; i++) {
      if (YASAK_BAYTLAR(b[i])) {
        sorunlar.push(`${path.relative(SRC, d)} bayt ${i}: 0x${b[i].toString(16)}`);
        break;
      }
    }
  }
  assert.deepEqual(sorunlar, []);
});

test('C-07 listing: Turkce nis uyarisi (kacis dizisiyle) ayni davranir', () => {
  const turkce = listing.build({ phrase: 'Test', niche: 'caliskan ogrenci xyzç' });
  assert.ok(turkce.warnings.some((w) => /Turkce yazilmis/.test(w)));
  const ascii = listing.build({ phrase: 'Test', niche: 'zzqq nis' });
  assert.ok(!ascii.warnings.some((w) => /Turkce yazilmis/.test(w)));
});

/* ═════════════════════════════════════════════════════════════════ C-08 */

test('C-08 etsy tasarimi: miras adlar varsayilana duser, undefined olcu uretmez', () => {
  for (const alan of ['size', 'palette', 'font', 'layout']) {
    for (const m of MIRAS) {
      const hedef = design.toSvg({ lines: ['AB', 'CD'], [alan]: m });
      assert.doesNotMatch(hedef, BOZUK, `${alan}=${m}`);
      assert.equal(hedef, design.toSvg({ lines: ['AB', 'CD'], [alan]: 'yok' }), `${alan}=${m}`);
    }
  }
  // Metin olmayan anahtar da tabloya sizmaz.
  assert.equal(design.toSvg({ lines: ['A'], size: ['sticker'] }), design.toSvg({ lines: ['A'] }));
});

test('C-08 reklam tasarimi: miras adlar varsayilana duser', () => {
  for (const alan of ['size', 'theme', 'layout']) {
    for (const m of MIRAS) {
      const hedef = reklamDesign.toSvg({ headline: 'Merhaba', [alan]: m });
      assert.doesNotMatch(hedef, BOZUK, `${alan}=${m}`);
      assert.equal(hedef, reklamDesign.toSvg({ headline: 'Merhaba', [alan]: 'yok' }), `${alan}=${m}`);
    }
  }
});

test('C-08 duvar kagidi: miras adlar 500 vermez, varsayilan olcu kullanilir', () => {
  for (const m of MIRAS) {
    const r = duvar.uret({ aile: m, palet: m, olcu: m });
    assert.equal(r.w, duvar.OLCULER.iphonePro.w, m);
    assert.equal(r.h, duvar.OLCULER.iphonePro.h, m);
    assert.doesNotMatch(r.svg, BOZUK, m);
  }
});

test('C-08 mockup ve fotoroman sayfasi: miras adlar bozuk cikti uretmez', () => {
  for (const m of MIRAS) {
    assert.doesNotMatch(mockup.toSvg({ lines: ['A'], palette: m, size: m }, { urun: 'tisort', renk: m }), BOZUK, m);
    const r = sayfa.sayfalar({ baslik: 'x', kareler: [kare(1, 'a')] }, { size: m, tema: m, font: m });
    assert.equal(r.w, sayfa.SIZES.karusel.w, m);
    assert.equal(r.h, sayfa.SIZES.karusel.h, m);
    assert.doesNotMatch(r.sayfalar[0], BOZUK, m);
  }
});

test('C-08 hikaye.kur: miras tur/zaman adlari TypeError vermez', () => {
  for (const m of MIRAS) {
    const h = hikaye.kur({}, { tur: m, zaman: m });
    assert.equal(h.tur, 'gundelik', m);
    assert.ok(h.kareler.length >= 5);
    assert.doesNotMatch(JSON.stringify(h), /undefined|\[object|function /, m);
  }
});

test('C-08 POST /etsy/uret: miras olcu adi Chrome\'a undefined olcu gondermez', async () => {
  await sahteRasterle(async (c) => {
    const r = await cagir('POST /api/etsy/uret', { design: { lines: ['A'], size: 'constructor' } });
    assert.deepEqual(c.png[0], { w: 4500, h: 5400 });
    assert.equal(r.size.w, 4500);
    assert.doesNotMatch(r.image.category, BOZUK);
  });
  const o = await cagir('POST /api/etsy/onizleme', { design: { lines: ['A'], size: '__proto__' } });
  assert.equal(o.size.w, 4500);
  const rk = await cagir('POST /api/reklam/onizleme', { design: { headline: 'x', size: 'constructor' } });
  assert.equal(rk.size.w, 1080);
  const dv = await cagir('POST /api/etsy/duvar/onizleme', { aile: 'constructor' });
  assert.equal(dv.w, duvar.OLCULER.iphonePro.w);
});

/* ═════════════════════════════════════════════════════════════════ C-09 */

test('C-09 POST /etsy/uret: galeriye yalniz bilinen tasarim alanlari yazilir', async () => {
  await sahteRasterle(async () => {
    await cagir('POST /api/etsy/uret', {
      design: {
        lines: ['POWERED BY', 'COFFEE'], layout: 'blok', palette: 'retro', font: 'serif',
        size: 'sticker', uppercase: false, junk: 'x'.repeat(2 * 1024 * 1024),
      },
      listing: { phrase: 'y'.repeat(1024 * 1024), niche: 'n'.repeat(500000), keywords: Array(5000).fill('k'.repeat(300)) },
    });
  });
  const kayit = store.getGallery()[0];
  assert.deepEqual(kayit.design, {
    lines: ['POWERED BY', 'COFFEE'], layout: 'blok', palette: 'retro', font: 'serif',
    size: 'sticker', uppercase: false,
  });
  assert.ok(!JSON.stringify(kayit).includes('junk'));
  assert.ok(galeriDosyaBoyu() < 100 * 1024, `gallery.json ${galeriDosyaBoyu()} bayt`);
  assert.ok(kayit.listing.description.length < 6000);
});

test('C-09 POST /etsy/toplu ve /mockup/uret: sismis alan ve serbest dizgi galeriye girmez', async () => {
  await sahteRasterle(async () => {
    await cagir('POST /api/etsy/toplu', {
      design: { lines: ['B'], junk: 'x'.repeat(1024 * 1024) }, sizes: ['sticker'],
    });
    assert.ok(!JSON.stringify(store.getGallery()[0]).includes('junk'));

    await cagir('POST /api/etsy/mockup/uret', {
      design: { lines: ['C'], junk: 'x'.repeat(1024 * 1024) },
      urun: 'u'.repeat(1024 * 1024), renkler: ['r'.repeat(1024 * 1024)],
    });
    const m = store.getGallery()[0];
    assert.equal(m.category, 'Listeleme gorseli · tisort · siyah');
    assert.ok(!JSON.stringify(m).includes('junk'));
  });
  assert.ok(galeriDosyaBoyu() < 200 * 1024, `gallery.json ${galeriDosyaBoyu()} bayt`);
});

test('C-09 POST /reklam/uret: tasarim alanlari korunur, yabanci alan atilir', async () => {
  await sahteRasterle(async () => {
    await cagir('POST /api/reklam/uret', {
      design: {
        headline: 'Sezon sonu', sub: 'Secili urunlerde', cta: 'Hemen incele', theme: 'neon',
        size: 'ig_kare', layout: 'duyuru', junk: 'x'.repeat(2 * 1024 * 1024),
      },
    });
  });
  const kayit = store.getGallery()[0];
  assert.equal(kayit.studio, 'reklam');
  assert.equal(kayit.design.headline, 'Sezon sonu');
  assert.equal(kayit.design.theme, 'neon');
  assert.equal(kayit.design.size, 'ig_kare');
  assert.ok(!JSON.stringify(kayit).includes('junk'));
});

test('C-09 POST /fotoroman/uret: hikaye kaydi bilinen alanlarla sinirli, gercek alanlar korunur', async () => {
  const h = {
    baslik: 'Gunluk hayat', tur: 'gundelik', turLabel: 'Gundelik', zaman: 'gunduz', zamanLabel: 'Gunduz',
    kiyafet: 'beyaz tisort', mekanlar: ['kafe', 'sokak'], esya: 'kitap', junk: 'x'.repeat(1024 * 1024),
    kareler: [
      { ...kare(1, 'Merhaba'), junk: 'x'.repeat(1024 * 1024), setting: 'kafe', imageId: 'img_yok' },
      { ...kare(2, 'z'.repeat(5000)), tip: 'x' },
    ],
  };
  await sahteRasterle(async () => {
    await cagir('POST /api/fotoroman/uret', { hikaye: h, size: 'kare' });
  });
  const kayit = store.getGallery().find((g) => g.hikaye);
  assert.ok(kayit, 'ilk sayfa kaydinda hikaye yok');
  assert.ok(!JSON.stringify(kayit).includes('junk'));
  assert.equal(kayit.hikaye.baslik, 'Gunluk hayat');
  assert.equal(kayit.hikaye.kiyafet, 'beyaz tisort');
  assert.deepEqual(kayit.hikaye.mekanlar, ['kafe', 'sokak']);
  assert.equal(kayit.hikaye.kareler.length, 2);
  assert.equal(kayit.hikaye.kareler[0].panelNo, 1);
  assert.equal(kayit.hikaye.kareler[0].setting, 'kafe');
  assert.equal(kayit.hikaye.kareler[0].imageId, 'img_yok');
  assert.deepEqual(kayit.hikaye.kareler[0].balon, { tip: 'konusma', metin: 'Merhaba' });
  assert.ok(kayit.hikaye.kareler[1].balon.metin.length <= 280);
});

test('C-09 POST /fotoroman/kare-uret: sahne kaydi bilinen alanlarla sinirli', async () => {
  fs.writeFileSync(path.join(VERI, 'character.json'), JSON.stringify({ identity: { name: 'Test' } }));
  studios.init({
    generateScene: async () => ({
      images: [{ id: 'img_kare_t', filename: 'img_kare_t.png', url: '/gorseller/img_kare_t.png' }],
      built: { prompt: 'p' },
      reference: null,
    }),
  });
  try {
    await cagir('POST /api/fotoroman/kare-uret', {
      kare: { ...kare(4, 'Selam'), pose: 'oturuyor', junk: 'x'.repeat(2 * 1024 * 1024) },
    });
  } finally {
    fs.rmSync(path.join(VERI, 'character.json'), { force: true });
  }
  const kayit = store.getGallery()[0];
  assert.equal(kayit.studio, 'fotoroman');
  assert.equal(kayit.scene.panelNo, 4);
  assert.equal(kayit.scene.pose, 'oturuyor');
  assert.deepEqual(kayit.scene.balon, { tip: 'konusma', metin: 'Selam' });
  assert.ok(!JSON.stringify(kayit).includes('junk'));
});

test('C-09 POST /etsy/sablon/kaydet: sablon alanlari kisa metin, nesne/devasa deger kaydedilmez', async () => {
  const r = await cagir('POST /api/etsy/sablon/kaydet', {
    ad: 'Benim sablonum',
    design: { layout: { junk: 'x'.repeat(1024 * 1024) }, palette: 'retro', font: 'f'.repeat(100000), uppercase: true },
  });
  const s = r.sablonlar.find((x) => x.ad === 'Benim sablonum');
  assert.ok(s);
  assert.equal(s.layout, undefined);
  assert.equal(s.palette, 'retro');
  assert.equal(s.font.length, 40);
  assert.equal(s.uppercase, true);
  assert.ok(fs.statSync(path.join(VERI, 'sablonlar.json')).size < 5000);
});

test('C-09 listing.build: girdi uzunluklari sinirli, normal cikti degismez', () => {
  const dev = listing.build({ phrase: 'p'.repeat(1e6), niche: 'n'.repeat(1e6), audience: 'a'.repeat(1e6), keywords: Array(9999).fill('k'.repeat(999)) });
  assert.ok(dev.description.length < 6000);
  assert.ok(JSON.stringify(dev).length < 20000);

  const normal = listing.build({ phrase: 'Powered by coffee and cat hair', niche: 'cat lover', size: 'kupa' });
  assert.match(normal.title, /mug/i);
  assert.ok(normal.tags.length > 0);
  assert.match(normal.description, /Powered by coffee and cat hair/);
});

/* ───────────────────────────────────────── yan etki: temiz cikis kontrolu */

test('masaustu ciktisi kapali kaldi, gercek veri klasorune yazilmadi', () => {
  assert.equal(output.getConfig().enabled, false);
  assert.equal(store.DATA_DIR, path.resolve(VERI));
  assert.ok(!fs.existsSync(path.join(VERI, 'cikti')), 'cikti klasoru acilmis');
});
