'use strict';

/**
 * SAGLAYICI / BUYUTME DIS AG GUVENLIGI
 *
 * src/providers ve src/upscalers dis servislerle konusur: yanit saldirgan
 * elinde olabilir (ele gecirilmis API, http uzerinde araya giren, acik
 * yonlendirme). Bu dosya su sozleri teste baglar:
 *   - yanittaki / yonlendirmedeki yerel ag adresi indirilmez (SSRF)
 *   - indirilen sey gercekten PNG/JPEG/WEBP (bayt imzasi)
 *   - tek yanit bellegi sinirsiz tuketemez (bayt siniri)
 *   - capraz-site yonlendirmede ozel baslik ve govde baska siteye gitmez
 *   - bozuk sablon hatasi acik API anahtarini sizdirmaz
 *   - stability uc noktasi ve replicate durum adresi sabit hosta bagli
 *   - URL sablonunda {{prompt}} / {{id}} kodlanir (parametre enjeksiyonu yok)
 *
 * Gercek aga cikilmaz: bulut adresleri sahte fetch ile, yerel servisler
 * 127.0.0.1 uzerindeki gecici sunucularla taklit edilir. Gercek data/
 * klasorune dokunulmaz (saglayici dosyalari store'u kullanmaz).
 *
 * Calistir:  node --test ai-infapp/test/saglayici-guvenlik.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');

const providers = require(path.join(__dirname, '..', 'src', 'providers'));
const upscalers = require(path.join(__dirname, '..', 'src', 'upscalers'));
const helpers = require(path.join(__dirname, '..', 'src', 'providers', 'helpers'));

const MB = 1024 * 1024;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const GENEL_IP = '93.184.216.34'; // herkese acik gorunen sabit IP (DNS gerekmez)

/* ------------------------------------------------------------ yerel sunucu */

// 4290-4299 araligini DONEREK dener (kapanan sunucunun eski baglantisi ayni porta
// hemen denk gelmesin), doluysa isletim sisteminin verdigi porta duser
// (baska testler/surecler ayni anda calisabilir).
let sonrakiPort = 0;
function dinle(srv) {
  const aralik = [4290, 4291, 4292, 4293, 4294, 4295, 4296, 4297, 4298, 4299];
  const bas = sonrakiPort++ % aralik.length;
  const portlar = [...aralik.slice(bas), ...aralik.slice(0, bas), 0];
  return new Promise((resolve, reject) => {
    const dene = (i) => {
      const onHata = (err) => {
        if (err.code === 'EADDRINUSE' && i + 1 < portlar.length) dene(i + 1);
        else reject(err);
      };
      srv.once('error', onHata);
      srv.listen(portlar[i], '127.0.0.1', () => {
        srv.removeListener('error', onHata);
        resolve(srv.address().port);
      });
    };
    dene(0);
  });
}

async function sunucuAc(isleyici) {
  const istekler = [];
  const srv = http.createServer((req, res) => {
    // HER yanit baglantiyi kapatir: istemcinin (global undici havuzunun) bayat keep-alive soketi, ayni portu alan
    // sonraki test sunucusuna gitmesin (yuk altinda "fetch failed" / ECONNRESET: hata govdesi ve ayni-site yonlendirme testleri).
    res.setHeader('connection', 'close');
    const parcalar = [];
    req.on('data', (c) => parcalar.push(c));
    req.on('end', () => {
      const kayit = { yontem: req.method, yol: req.url, baslik: req.headers, govde: Buffer.concat(parcalar).toString() };
      istekler.push(kayit);
      isleyici(req, res, kayit);
    });
  });
  const port = await dinle(srv);
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    istekler,
    kapat: () => new Promise((resolve) => {
      if (srv.closeAllConnections) srv.closeAllConnections();
      srv.close(() => resolve());
    }),
  };
}

/** Sunucu(lar)i acar, fonksiyonu calistirir, hata olsa da kapatir. */
async function sunucularla(isleyiciler, fn) {
  const acik = [];
  try {
    for (const isleyici of isleyiciler) acik.push(await sunucuAc(isleyici));
    return await fn(...acik);
  } finally {
    await Promise.all(acik.map((s) => s.kapat()));
  }
}

function json(res, nesne, kod = 200) {
  const govde = JSON.stringify(nesne);
  res.writeHead(kod, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(govde), connection: 'close' });
  res.end(govde);
}

function ikili(res, buf, tur = 'image/png') {
  res.writeHead(200, { 'content-type': tur, 'content-length': buf.length, connection: 'close' });
  res.end(buf);
}

/* --------------------------------------------------- sahte bulut (fetch) */

const gercekFetch = globalThis.fetch;
const yollar = [];

function sahteAgKur() {
  globalThis.fetch = async (girdi, init = {}) => {
    const url = String((girdi && girdi.url) || girdi);
    const yol = yollar.find((y) => url.startsWith(y.onek));
    if (!yol) return gercekFetch(girdi, init);
    const yanit = await yol.isleyici(url, init);
    // Varsayilan modda (redirect:'follow') tarayici/undici yonlendirmeyi kendisi izler;
    // 'manual' istenmisse ham 3xx yanit doner. Bu taklit ayni davranisi uretir.
    const loc = yanit.headers.get('location');
    if (init.redirect !== 'manual' && yanit.status >= 300 && yanit.status < 400 && loc) {
      return gercekFetch(new URL(loc, url).href, { method: 'GET', signal: init.signal });
    }
    return yanit;
  };
}

function sahteYol(onek, isleyici) {
  yollar.push({ onek, isleyici });
}

function jsonYanit(nesne, kod = 200) {
  return new Response(JSON.stringify(nesne), { status: kod, headers: { 'content-type': 'application/json' } });
}

test.before(() => {
  sahteAgKur();
  // Bulut adlari (api.replicate.com vb.) gercek DNS'e gitmeden "herkese acik" cozulsun.
  if (helpers.dnsAyarla) {
    helpers.dnsAyarla({ lookup: async (ad) => (ad === 'gizli.ornek' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: GENEL_IP, family: 4 }]) });
  }
});

test.after(() => {
  globalThis.fetch = gercekFetch;
  if (helpers.dnsAyarla) helpers.dnsAyarla(null);
});

test.afterEach(() => { yollar.length = 0; });

/* =================================================== SS-SAG-01 SSRF + tur */

const TEMEL = { prompt: 'bir kedi', negative: '', seed: 1, width: 64, height: 64, aspectRatio: '1:1', count: 1 };

// Her satir: bulut gibi gorunen bir API yaniti, indirme adresi olarak YEREL bir url verir.
// Beklenti: indirme reddedilir, yerel sunucuya tek istek gitmez.
const BULUT_SENARYOLARI = [
  {
    ad: 'custom (images[0].url)',
    calistir: (ic) => {
      sahteYol(`https://${GENEL_IP}/gen`, () => jsonYanit({ images: [{ url: `${ic.base}/gizli.png` }] }));
      return providers.get('custom').generate({
        ...TEMEL,
        config: { url: `https://${GENEL_IP}/gen`, body: '{"prompt":"{{prompt}}"}', resultType: 'url', resultPath: 'images[0].url' },
      });
    },
  },
  {
    ad: 'openai (data[0].url)',
    calistir: (ic) => {
      sahteYol(`https://${GENEL_IP}/v1/images/generations`, () => jsonYanit({ data: [{ url: `${ic.base}/gizli.png` }] }));
      return providers.get('openai').generate({ ...TEMEL, size: '1024x1024', config: { apiKey: 'k', baseUrl: `https://${GENEL_IP}/v1` } });
    },
  },
  {
    ad: 'replicate (output[0])',
    calistir: (ic) => {
      sahteYol('https://api.replicate.com/', () => jsonYanit({ id: 'p1', status: 'succeeded', output: [`${ic.base}/gizli.png`], urls: { get: 'https://api.replicate.com/v1/predictions/p1' } }));
      return providers.get('replicate').generate({ ...TEMEL, config: { apiKey: 'k', model: 'a/b' } });
    },
  },
  {
    ad: 'fal (images[0].url)',
    calistir: (ic) => {
      sahteYol('https://fal.run/', () => jsonYanit({ images: [{ url: `${ic.base}/gizli.png` }] }));
      return providers.get('fal').generate({ ...TEMEL, config: { apiKey: 'k', model: 'fal-ai/flux/dev' } });
    },
  },
  {
    ad: 'upscaler custom (output)',
    calistir: (ic) => {
      sahteYol(`https://${GENEL_IP}/up`, () => jsonYanit({ output: `${ic.base}/gizli.png` }));
      return upscalers.get('custom').upscale({
        buffer: PNG,
        scale: 2,
        config: { url: `https://${GENEL_IP}/up`, body: '{"i":"{{imageBase64}}"}', resultType: 'url', resultPath: 'output' },
      });
    },
  },
  {
    ad: 'upscaler replicate (output)',
    calistir: (ic) => {
      sahteYol('https://api.replicate.com/', () => jsonYanit({ id: 'u1', status: 'succeeded', output: `${ic.base}/gizli.png`, urls: { get: 'https://api.replicate.com/v1/predictions/u1' } }));
      return upscalers.get('replicate').upscale({ buffer: PNG, scale: 2, config: { apiKey: 'k' } });
    },
  },
];

for (const s of BULUT_SENARYOLARI) {
  test(`SS-SAG-01: ${s.ad} yanitindaki yerel ag adresi indirilmez`, async () => {
    await sunucularla([(req, res) => ikili(res, PNG)], async (ic) => {
      await assert.rejects(() => s.calistir(ic), /Yerel ag adresine/);
      assert.equal(ic.istekler.length, 0, 'yerel sunucuya istek gitmemeli');
    });
  });
}

test('SS-SAG-01: leonardo + custom async (poll) yanitindaki yerel adres de indirilmez (yavas: 4 sn bekleme)', async () => {
  await sunucularla([(req, res) => ikili(res, PNG)], async (ic) => {
    sahteYol('https://cloud.leonardo.ai/api/rest/v1/generations', (url, init) => {
      if (String(init.method).toUpperCase() === 'POST') return jsonYanit({ sdGenerationJob: { generationId: 'g1' } });
      return jsonYanit({ generations_by_pk: { status: 'COMPLETE', generated_images: [{ url: `${ic.base}/gizli.png` }] } });
    });
    sahteYol(`https://${GENEL_IP}/baslat`, () => jsonYanit({ id: 'is1' }));
    sahteYol(`https://${GENEL_IP}/durum/`, () => jsonYanit({ result: { images: [{ url: `${ic.base}/gizli.png` }] } }));

    const leonardo = providers.get('leonardo').generate({ ...TEMEL, config: { apiKey: 'k' } });
    const poll = providers.get('custom').generate({
      ...TEMEL,
      config: {
        url: `https://${GENEL_IP}/baslat`,
        body: '{"p":"{{prompt}}"}',
        resultType: 'async',
        pollUrl: `https://${GENEL_IP}/durum/{{id}}`,
        pollIdPath: 'id',
        pollResultPath: 'result.images[0].url',
      },
    });
    await Promise.all([
      assert.rejects(() => leonardo, /Yerel ag adresine/),
      assert.rejects(() => poll, /Yerel ag adresine/),
    ]);
    assert.equal(ic.istekler.length, 0);
  });
});

test('SS-SAG-01: bulut yaniti yerel adrese YONLENDIRIRSE de indirilmez', async () => {
  await sunucularla([(req, res) => ikili(res, PNG)], async (ic) => {
    sahteYol(`https://${GENEL_IP}/r.png`, () => new Response(null, { status: 302, headers: { location: `${ic.base}/gizli.png` } }));
    await assert.rejects(() => helpers.downloadImage(`https://${GENEL_IP}/r.png`), /Yerel ag adresine/);
    assert.equal(ic.istekler.length, 0);
  });
});

test('SS-SAG-01: yerel adrese cozulen alan adi indirilmez; herkese acik ad indirilir', async () => {
  if (!helpers.dnsAyarla) assert.fail('helpers.dnsAyarla yok');
  let cagri = 0;
  sahteYol('http://gizli.ornek/', () => { cagri++; return new Response(PNG, { status: 200 }); });
  sahteYol('http://acik.ornek/', () => new Response(PNG, { status: 200 }));
  await assert.rejects(() => helpers.downloadImage('http://gizli.ornek/x.png'), /Yerel ag adresine/);
  assert.equal(cagri, 0);
  const ok = await helpers.downloadImage('http://acik.ornek/x.png');
  assert.equal(ok.mime, 'image/png');
});

test('SS-SAG-01: yalniz http/https desteklenir (file:, ftp:)', async () => {
  for (const adres of ['file:///C:/Windows/win.ini', 'ftp://ornek.test/x.png']) {
    await assert.rejects(() => helpers.downloadImage(adres), /Desteklenmeyen adres turu/);
  }
});

test('SS-SAG-01: base64 data: adresi (zararsiz) hala indirilebilir ve imza dogrulanir', async () => {
  const ok = await helpers.downloadImage(`data:image/png;base64,${PNG.toString('base64')}`);
  assert.equal(ok.mime, 'image/png');
  await assert.rejects(() => helpers.downloadImage(`data:text/plain;base64,${Buffer.from('MERHABA').toString('base64')}`), /gorsel degil/);
});

test('SS-SAG-01: yerelIzin:true ile yerel servisten gorsel indirilir; mime bayt imzasindan gelir', async () => {
  await sunucularla([(req, res) => ikili(res, req.url.startsWith('/jpeg') ? JPEG : PNG, 'application/octet-stream')], async (ic) => {
    const png = await helpers.downloadImage(`${ic.base}/a.jpg`, { yerelIzin: true });
    assert.equal(png.mime, 'image/png', 'uzanti .jpg ama icerik PNG');
    const jpg = await helpers.downloadImage(`${ic.base}/jpeg/b.png`, { yerelIzin: true });
    assert.equal(jpg.mime, 'image/jpeg', 'uzanti .png ama icerik JPEG');
    await assert.rejects(() => helpers.downloadImage(`${ic.base}/a.png`), /Yerel ag adresine/, 'izin verilmezse yerel adres kapali');
  });
});

test('SS-SAG-01: gorsel olmayan icerik (HTML, JSON, ic servis cevabi) galeriye "gorsel" diye yazilmaz', async () => {
  await sunucularla([(req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end('{"metadata":"IC-AG-GIZLI-VERISI","token":"abc123"}');
  }], async (ic) => {
    await assert.rejects(() => helpers.downloadImage(`${ic.base}/latest/meta-data`, { yerelIzin: true }), /gorsel degil/);
  });
});

test('SS-SAG-01: ag-guvenlik kopyasi kok lib ile ayni tabloyu verir', () => {
  const kopya = require(path.join(__dirname, '..', 'src', 'providers', 'ag-guvenlik'));
  const YEREL = ['localhost', 'localhost.', 'foo.localhost', '127.0.0.1', '127.1', '0x7f000001', '2130706433', '0.0.0.0',
    '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '224.0.0.1', '[::1]', '::ffff:127.0.0.1',
    '[::ffff:7f00:1]', '[64:ff9b::7f00:1]', '[2002:7f00:1::]', 'fe80::1', 'fd00::1', 'foo.local', 'db.internal', 'nas.lan', 'router', '', 'bozuk host adi'];
  const GENEL = ['pexels.com', '8.8.8.8', GENEL_IP, '172.15.0.1', '172.32.0.1', '100.63.255.255', '[2606:4700:4700::1111]', '::ffff:8.8.8.8'];
  for (const h of YEREL) assert.equal(kopya.yerelAdresMi(h), true, JSON.stringify(h));
  for (const h of GENEL) assert.equal(kopya.yerelAdresMi(h), false, h);
  let kok = null;
  try { kok = require(path.join(__dirname, '..', '..', 'lib', 'ag-guvenlik')); } catch { /* ai-infapp tek basina kopyalanmis */ }
  if (kok) for (const h of [...YEREL, ...GENEL]) assert.equal(kopya.yerelAdresMi(h), kok.yerelAdresMi(h), `kok lib ile ayrildi: ${JSON.stringify(h)}`);
});

test('SS-SAG-01: yerel servisler (A1111, ComfyUI, A1111 buyutme) yerel adreste calismaya devam eder', async () => {
  const b64 = PNG.toString('base64');
  await sunucularla([
    (req, res) => {
      if (req.url === '/sdapi/v1/txt2img') return json(res, { images: [b64] });
      if (req.url === '/sdapi/v1/extra-single-image') return json(res, { image: b64 });
      if (req.url === '/prompt') return json(res, { prompt_id: 'p1' });
      if (req.url === '/history/p1') return json(res, { p1: { outputs: { 9: { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } });
      if (req.url.startsWith('/view?')) return ikili(res, PNG);
      return json(res, {}, 404);
    },
  ], async (yerel) => {
    const a1111 = await providers.get('automatic1111').generate({ ...TEMEL, config: { baseUrl: yerel.base } });
    assert.equal(a1111.images.length, 1);
    const up = await upscalers.get('automatic1111').upscale({ buffer: PNG, scale: 2, config: { baseUrl: yerel.base } });
    assert.ok(up.buffer.length > 0);
    const comfy = await providers.get('comfyui').generate({ ...TEMEL, config: { baseUrl: yerel.base, workflow: '{"3":{"inputs":{"text":"{{prompt}}"}}}' } });
    assert.equal(comfy.images.length, 1);
  });
});

test('SS-SAG-01: custom saglayici yerel adresi KULLANICI yazdiysa yerel gorsel adresi calisir', async () => {
  await sunucularla([(req, res) => {
    if (req.url === '/gen') return json(res, { images: [{ url: `http://127.0.0.1:${req.socket.localPort}/img.png` }] });
    return ikili(res, PNG);
  }], async (yerel) => {
    const out = await providers.get('custom').generate({
      ...TEMEL,
      config: { url: `${yerel.base}/gen`, body: '{"prompt":"{{prompt}}"}', resultType: 'url', resultPath: 'images[0].url' },
    });
    assert.equal(out.images.length, 1);
    assert.equal(out.images[0].mime, 'image/png');
  });
});

/* ====================================== SS-SAG-01 (5) replicate durum adresi */

test('SS-SAG-01: replicate yanitindaki durum adresi baska hosta gidiyorsa Bearer anahtar gonderilmez', async () => {
  await sunucularla([(req, res) => json(res, { status: 'succeeded', output: [] })], async (ic) => {
    sahteYol('https://api.replicate.com/', () => jsonYanit({ id: 'p1', status: 'starting', urls: { get: `${ic.base}/poll` } }));
    await assert.rejects(() => providers.get('replicate').generate({ ...TEMEL, config: { apiKey: 'SIR-REPLICATE', model: 'a/b' } }), /durum adresi/i);
    await assert.rejects(() => upscalers.get('replicate').upscale({ buffer: PNG, scale: 2, config: { apiKey: 'SIR-REPLICATE' } }), /durum adresi/i);
    assert.equal(ic.istekler.length, 0, 'durum adresine anahtar giden istek olmamali');
  });
});

/* ========================================================== SS-SAG-02 bayt siniri */

test('SS-SAG-02: akan govde (content-length yok) sinirdan buyukse kesilir', async () => {
  await sunucularla([(req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.write(PNG);
    const parca = Buffer.alloc(MB);
    let gonderilen = 0;
    const yaz = () => {
      while (gonderilen < 40) {
        gonderilen++;
        if (!res.write(parca)) return res.once('drain', yaz);
        if (res.destroyed) return undefined;
      }
      return res.end();
    };
    yaz();
  }], async (ic) => {
    await assert.rejects(() => helpers.downloadImage(`${ic.base}/dev.png`, { yerelIzin: true }), /cok buyuk/i);
  });
});

test('SS-SAG-02: content-length siniri asiyorsa govde hic okunmadan reddedilir', async () => {
  await sunucularla([(req, res) => {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(200 * MB) });
    res.write(PNG);
    setTimeout(() => res.destroy(), 500);
  }], async (ic) => {
    await assert.rejects(() => helpers.downloadImage(`${ic.base}/dev.png`, { yerelIzin: true }), /cok buyuk/i);
  });
});

test('SS-SAG-02: JSON yanit siniri (varsayilan 16 MB ve ozel maksBayt)', async () => {
  await sunucularla([(req, res) => {
    const n = req.url === '/kucuk' ? 10 * 1024 : 17 * MB;
    const govde = Buffer.concat([Buffer.from('{"a":"'), Buffer.alloc(n, 0x61), Buffer.from('"}')]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(govde);
  }], async (ic) => {
    await assert.rejects(() => helpers.fetchJson(`${ic.base}/dev`, { yerelIzin: true }), /cok buyuk/i);
    await assert.rejects(() => helpers.fetchJson(`${ic.base}/kucuk`, { yerelIzin: true, maksBayt: 1024 }), /cok buyuk/i);
    const ok = await helpers.fetchJson(`${ic.base}/kucuk`, { yerelIzin: true });
    assert.equal(ok.a.length, 10 * 1024);
  });
});

test('SS-SAG-02: hata govdesi tamamen okunmaz, mesaj kisa kalir', async () => {
  await sunucularla([(req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(Buffer.alloc(5 * MB, 0x78));
  }], async (ic) => {
    const err = await helpers.fetchJson(`${ic.base}/hata`, { yerelIzin: true }).then(() => null, (e) => e);
    assert.ok(err, 'HTTP 500 hata olmali');
    assert.match(err.message, /^HTTP 500 - /);
    assert.ok(err.message.length < 700, `hata mesaji kisa olmali (${err.message.length})`);
  });
});

/* ============================================ SS-SAG-03 capraz-site yonlendirme */

test('SS-SAG-03: custom POST 307 ile baska siteye yonlendirilirse istek (baslik + govde) gitmez', async () => {
  await sunucularla([(req, res) => json(res, { ok: 1 })], async (hedef) => {
    await sunucularla([(req, res) => {
      res.writeHead(307, { location: `${hedef.base}/yakala` });
      res.end();
    }], async (api) => {
      await assert.rejects(() => providers.get('custom').generate({
        ...TEMEL,
        referenceDataUri: 'data:image/png;base64,AAAA',
        config: {
          url: `${api.base}/gen`,
          headers: '{"x-api-key":"SIR-ANAHTAR-123"}',
          body: '{"prompt":"{{prompt}}","image":"{{reference}}"}',
          resultType: 'url',
          resultPath: 'images[0].url',
        },
      }), /baska siteye yonlendirdi/);
      assert.equal(hedef.istekler.length, 0, 'baska origin hicbir sey gormemeli');
    });
  });
});

test('SS-SAG-03: upscaler custom POST 307 ile baska siteye yonlendirilirse gorsel + baslik gitmez', async () => {
  await sunucularla([(req, res) => json(res, { ok: 1 })], async (hedef) => {
    await sunucularla([(req, res) => {
      res.writeHead(307, { location: `${hedef.base}/yakala` });
      res.end();
    }], async (api) => {
      await assert.rejects(() => upscalers.get('custom').upscale({
        buffer: PNG,
        scale: 2,
        config: {
          url: `${api.base}/up`,
          headers: '{"x-api-key":"UPSCALER-SIR-777"}',
          body: '{"i":"{{imageBase64}}"}',
          resultType: 'url',
          resultPath: 'output',
        },
      }), /baska siteye yonlendirdi/);
      assert.equal(hedef.istekler.length, 0);
    });
  });
});

test('SS-SAG-03: GET 302 baska siteye giderse takip edilir ama ozel baslik dusurulur', async () => {
  await sunucularla([(req, res) => ikili(res, PNG)], async (hedef) => {
    await sunucularla([(req, res) => {
      res.writeHead(302, { location: `${hedef.base}/img.png` });
      res.end();
    }], async (api) => {
      const buf = await helpers.fetchBinary(`${api.base}/g`, {
        headers: { 'x-api-key': 'SIR-ANAHTAR-123', authorization: 'Bearer BEARER-SIR', accept: 'image/*' },
        yerelIzin: true,
      });
      assert.ok(buf.length > 0);
      assert.equal(hedef.istekler.length, 1);
      assert.equal(hedef.istekler[0].baslik['x-api-key'], undefined, 'x-api-key baska origin\'e sizdi');
      assert.equal(hedef.istekler[0].baslik.authorization, undefined);
    });
  });
});

test('SS-SAG-03: ayni site icindeki yonlendirmede baslik ve govde korunur', async () => {
  await sunucularla([(req, res) => {
    if (req.url === '/gen') {
      res.writeHead(307, { location: '/gen2' });
      return res.end();
    }
    if (req.url === '/img.png') return ikili(res, PNG);
    return json(res, { images: [{ url: `http://127.0.0.1:${req.socket.localPort}/img.png` }] });
  }], async (api) => {
    const out = await providers.get('custom').generate({
      ...TEMEL,
      config: {
        url: `${api.base}/gen`,
        headers: '{"x-api-key":"AYNI-SITE-ANAHTAR"}',
        body: '{"prompt":"{{prompt}}"}',
        resultType: 'url',
        resultPath: 'images[0].url',
      },
    });
    assert.equal(out.images.length, 1);
    const g2 = api.istekler.find((k) => k.yol === '/gen2');
    assert.ok(g2, 'yonlendirme izlenmeli');
    assert.equal(g2.yontem, 'POST');
    assert.equal(g2.baslik['x-api-key'], 'AYNI-SITE-ANAHTAR');
    assert.match(g2.govde, /bir kedi/);
  });
});

test('SS-SAG-03: sonsuz yonlendirme dongusu en fazla 5 sicramada kesilir', async () => {
  await sunucularla([(req, res) => {
    res.writeHead(302, { location: '/tekrar' });
    res.end();
  }], async (api) => {
    await assert.rejects(() => helpers.fetchBinary(`${api.base}/tekrar`, { yerelIzin: true }), /Cok fazla yonlendirme/);
    assert.ok(api.istekler.length <= 7, `istek sayisi sinirli olmali (${api.istekler.length})`);
  });
});

/* ============================================= SS-SAG-04 sablon hatasi sizintisi */

test('SS-SAG-04: bozuk basliklar sablonu hatasi acik API anahtarini icermez (saglayici)', async () => {
  const SIR = 'sk-' + 'proj-PROVIDER-SECRET-ABCDEFGH'; // bolunmus: kok duman testi gercek bicimli anahtar sansin diye
  const err = await providers.get('custom').generate({
    ...TEMEL,
    config: {
      url: `https://${GENEL_IP}/gen`,
      headers: `{"Authorization":"Bearer ${SIR}" "x":1}`,
      body: '{"prompt":"{{prompt}}"}',
    },
  }).then(() => null, (e) => e);
  assert.ok(err, 'bozuk JSON hata vermeli');
  assert.match(err.message, /Basliklar gecerli JSON degil/);
  assert.equal(err.message.includes('PROVIDER-SECRET'), false, `anahtar sizdi: ${err.message}`);
});

test('SS-SAG-04: bozuk basliklar sablonu hatasi acik API anahtarini icermez (buyutucu)', async () => {
  const err = await upscalers.get('custom').upscale({
    buffer: PNG,
    scale: 2,
    config: { url: `https://${GENEL_IP}/up`, headers: '{"x-api-key":"sk-live-UPSCALER-SECRET-0123456789",}', body: '{"i":"{{scale}}"}' },
  }).then(() => null, (e) => e);
  assert.ok(err);
  assert.match(err.message, /Basliklar gecerli JSON degil/);
  assert.equal(err.message.includes('UPSCALER-SECRET'), false, `anahtar sizdi: ${err.message}`);
});

test('SS-SAG-04: govde sablonu hatasinda uzun jetonlar maskelenir, kisa metin okunur kalir', () => {
  const err = (() => {
    try {
      helpers.fillJsonTemplate('{"api_key": "sk-live-ABCDEFGHIJKLMNOP1234" "prompt": "merhaba {{prompt}}"}', { prompt: 'dunya' }, 'Govde sablonu');
    } catch (e) { return e; }
    return null;
  })();
  assert.ok(err);
  assert.match(err.message, /Govde sablonu gecerli JSON degil/);
  assert.equal(err.message.includes('ABCDEFGHIJKLMNOP'), false, `anahtar sizdi: ${err.message}`);
  assert.match(err.message, /merhaba dunya/);
});

/* =========================================================== SS-SAG-05 stability */

test('SS-SAG-05: stability uc noktasi listedekilerden degilse anahtar gonderilmez', async () => {
  await sunucularla([(req, res) => ikili(res, PNG)], async (ic) => {
    await assert.rejects(() => providers.get('stability').generate({
      ...TEMEL,
      config: { apiKey: 'sk-STABILITY-SIR-1234', endpoint: `${ic.base}/herhangi-host` },
    }), /Gecersiz Stability/);
    assert.equal(ic.istekler.length, 0);
  });
});

test('SS-SAG-05: stability varsayilan ve listedeki uc nokta calisir', async () => {
  let gelen = 0;
  sahteYol('https://api.stability.ai/', () => { gelen++; return new Response(PNG, { status: 200 }); });
  const a = await providers.get('stability').generate({ ...TEMEL, config: { apiKey: 'k' } });
  const b = await providers.get('stability').generate({ ...TEMEL, config: { apiKey: 'k', endpoint: 'https://api.stability.ai/v2beta/stable-image/generate/ultra' } });
  assert.equal(a.images.length + b.images.length, 2);
  assert.equal(gelen, 2);
});

test('SS-SAG-05: openai http:// adresi yalniz yerel agda olur (acik metin anahtar onlenir)', async () => {
  let gelen = 0;
  sahteYol(`http://${GENEL_IP}/`, () => { gelen++; return jsonYanit({ data: [] }); });
  await assert.rejects(() => providers.get('openai').generate({ ...TEMEL, size: '1024x1024', config: { apiKey: 'k', baseUrl: `http://${GENEL_IP}/v1` } }), /https/);
  assert.equal(gelen, 0);

  await sunucularla([(req, res) => json(res, { data: [{ b64_json: PNG.toString('base64') }] })], async (yerel) => {
    const out = await providers.get('openai').generate({ ...TEMEL, size: '1024x1024', config: { apiKey: 'k', baseUrl: `${yerel.base}/v1` } });
    assert.equal(out.images.length, 1, 'yerel OpenAI uyumlu proxy http ile calismaya devam etmeli');
  });
});

/* ====================================================== SS-SAG-06 URL kodlama */

test('SS-SAG-06: {{prompt}} URL sablonunda kodlanir (parametre enjeksiyonu ve kesilme yok)', async () => {
  await sunucularla([(req, res) => ikili(res, PNG)], async (api) => {
    const prompt = 'sahil & gun batimi #4k&key=SALDIRGAN&n=99';
    const out = await providers.get('custom').generate({
      ...TEMEL,
      prompt,
      config: { url: `${api.base}/gen?q={{prompt}}&key=KULLANICI&n=1`, method: 'GET', resultType: 'binary' },
    });
    assert.equal(out.images.length, 1);
    const q = new URL(api.istekler[0].yol, api.base).searchParams;
    assert.equal(q.get('q'), prompt, 'prompt tek parametre olarak gelmeli');
    assert.deepEqual(q.getAll('key'), ['KULLANICI']);
    assert.deepEqual(q.getAll('n'), ['1']);
  });
});

test('SS-SAG-06: poll adresinde {{id}} kodlanir; id tam adres ise yalniz ayni siteyi kabul eder (yavas: 4 sn bekleme)', async () => {
  const ID = 'is/1&x=2#parca';
  await sunucularla([(req, res, kayit) => {
    if (req.url === '/baslat') return json(res, { id: req.headers['x-mod'] === 'tam' ? `http://127.0.0.1:${req.socket.localPort}/durum-tam` : ID });
    if (req.url === '/img.png') return ikili(res, PNG);
    return json(res, { result: { images: [{ url: `http://127.0.0.1:${req.socket.localPort}/img.png` }] } });
  }], async (api) => {
    const temel = (ek) => ({
      ...TEMEL,
      config: {
        url: `${api.base}/baslat`,
        headers: ek.headers || '',
        body: '{"p":"{{prompt}}"}',
        resultType: 'async',
        pollUrl: ek.pollUrl,
        pollIdPath: 'id',
        pollResultPath: 'result.images[0].url',
      },
    });
    // tam adres olarak gelen id baska siteye isaret ediyorsa hemen reddedilir (bekleme yok)
    await sunucularla([(req, res) => json(res, { id: 'http://127.0.0.1:9/yabanci' })], async (yabanci) => {
      await assert.rejects(() => providers.get('custom').generate({
        ...TEMEL,
        config: { url: `${yabanci.base}/baslat`, body: '{"p":"x"}', resultType: 'async', pollUrl: '{{id}}', pollIdPath: 'id', pollResultPath: 'r' },
      }), /ayni siteye/);
    });

    const [kodlu, tam] = await Promise.all([
      providers.get('custom').generate(temel({ pollUrl: `${api.base}/durum/{{id}}` })),
      providers.get('custom').generate(temel({ pollUrl: '{{id}}', headers: '{"x-mod":"tam"}' })),
    ]);
    assert.equal(kodlu.images.length, 1);
    assert.equal(tam.images.length, 1);
    const durum = api.istekler.find((k) => k.yol.startsWith('/durum/'));
    assert.ok(durum, 'poll istegi gelmeli');
    assert.equal(durum.yol, `/durum/${encodeURIComponent(ID)}`);
    assert.ok(api.istekler.some((k) => k.yol === '/durum-tam'));
  });
});
