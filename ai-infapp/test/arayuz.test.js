'use strict';

/**
 * ARAYUZ (ai-infapp/public/app.js) TESTLERI
 *
 * Iki katman:
 *  1) vm + sahte DOM: app.js tarayici olmadan yuklenir, ekran fonksiyonlari dogrudan cagrilir. Hizli, her yerde calisir.
 *  2) Gercek Chrome/Edge (bassiz, DevTools protokolu, bagimlilik yok): SVG temizligi gercek bir DOM ister.
 *     Tarayici yoksa bu katman ATLANIR (hata sayilmaz). Gercek ai-infapp/server.js gecici veri klasoruyle baslar.
 *
 * Hicbiri gercek data/ klasorune dokunmaz; ag yok (127.0.0.1 disina cikilmaz).
 *
 * Kapsanan bulgular (denetim kodlari):
 *  UI-01 clickjacking: panel baska sitenin iframe'ine gomulunce kendini kapatir
 *  UI-03 sunucu SVG'si ham innerHTML ile basiliyordu: script/olay/dis kaynak temizlenir
 *  UI-04 Etsy OAuth state degeri arayuzden hic gonderilmiyordu
 *  UI-05 API anahtari alanlari duz metin kutusuydu
 *  UI-06 karakter hikayesi cift kacislaniyordu
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const vm = require('node:vm');
const { spawn, execFileSync } = require('child_process');

const KOK = path.join(__dirname, '..');
// AI_INFAPP_PUBLIC: duzeltmeden once/sonra kiyaslamak icin vm katmani baska bir public klasorune bakabilir.
const PUBLIC = process.env.AI_INFAPP_PUBLIC ? path.resolve(process.env.AI_INFAPP_PUBLIC) : path.join(KOK, 'public');
const APP_JS = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
// Gorev kuyruklarini bosalt: init() ve olay islemcileri asenkron biter.
async function sakinles(tur = 12) { for (let i = 0; i < tur; i++) await new Promise((r) => setImmediate(r)); }

/* ============================================================ sahte DOM (vm) */

function sahteEleman(id) {
  return {
    id, innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, checked: false,
    className: '', scrollTop: 0, dataset: {}, style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    appendChild(c) { return c; }, replaceChildren() {}, remove() {}, focus() {}, click() {},
    closest() { return null; }, setAttribute() {}, removeAttribute() {},
  };
}

/**
 * public/app.js'i bir vm baglaminda yukler.
 *  secenek.cerceveIcinde : true ise window.top !== window.self (sayfa baska bir sitenin iframe'inde).
 *  secenek.api           : { '/api/yol': deger | (govde) => deger } sahte sunucu yanitlari.
 */
function arayuzYukle(secenek = {}) {
  const fetchler = [];
  const hatalar = [];
  const elemanlar = new Map();
  const eleman = (id) => {
    if (!elemanlar.has(id)) elemanlar.set(id, sahteEleman(id));
    return elemanlar.get(id);
  };

  const yanitlar = {
    '/api/durum': {
      character: null, hasCharacter: false, activeStudio: 'karakter',
      studios: [{ id: 'karakter', label: 'Karakter', icon: '', tagline: '', tabs: [] }],
      provider: { generates: false, label: 'Yok' }, app: { welcomeSeen: true },
    },
    '/api/saglayicilar': { providers: [], active: '' },
    '/api/sorular': { questions: [], answers: {} },
    ...(secenek.api || {}),
  };

  const belge = {
    getElementById: eleman,
    createElement: (etiket) => sahteEleman(etiket),
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    documentElement: { textContent: 'SAYFA ICERIGI' },
    body: sahteEleman('body'),
  };

  const pencere = {};
  pencere.self = pencere;
  pencere.top = secenek.cerceveIcinde ? {} : pencere;
  pencere.location = { href: 'http://localhost/', reload() {} };

  const sahteFetch = async (url, ayar = {}) => {
    const govde = ayar.body ? JSON.parse(ayar.body) : undefined;
    fetchler.push({ url, yontem: ayar.method || 'GET', govde });
    const k = yanitlar[url];
    const veri = typeof k === 'function' ? k(govde) : (k === undefined ? {} : k);
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(veri)) };
  };

  const baglam = vm.createContext({
    window: pencere, document: belge, fetch: sahteFetch,
    navigator: { clipboard: { writeText: async () => {} } },
    console, setTimeout, clearTimeout, URL, Blob,
    FormData: class { get() { return ''; } },
  });

  // Olay islemcilerinde yutulmayan reddedilmis sozler testte gorunsun.
  const onRed = (neden) => hatalar.push(neden);
  process.on('unhandledRejection', onRed);

  let yuklemeHatasi = null;
  try {
    vm.runInContext(APP_JS, baglam, { filename: 'public/app.js' });
  } catch (err) {
    yuklemeHatasi = err;
  }

  return {
    belge, eleman, fetchler, hatalar, yuklemeHatasi,
    calistir: (kod) => vm.runInContext(kod, baglam),
    bitir: () => process.removeListener('unhandledRejection', onRed),
  };
}

/** Ekrani kuran bir test icin: yukle, acilis isini bitir, render()'i etkisizlestir (basarili islem sonrasi yeniden cizim gurultusu). */
async function ekranHazirla(api) {
  const y = arayuzYukle({ api });
  assert.equal(y.yuklemeHatasi, null, 'app.js yuklenemedi');
  await sakinles();
  y.calistir('render = async function () {}; refresh = async function () {};');
  y.fetchler.length = 0;
  return y;
}

/** innerHTML metninden id'si verilen <input> etiketini cikarir. */
function girdiEtiketi(html, id) {
  const m = html.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`));
  return m ? m[0] : null;
}

/* ====================================================================== UI-01 */

test('UI-01 clickjacking: panel baska bir sitenin iframe\'ine gomulurse hicbir sey cizmez ve sunucuya gitmez', async () => {
  const cerceve = arayuzYukle({ cerceveIcinde: true });
  try {
    await sakinles();
    assert.ok(cerceve.yuklemeHatasi, 'cerceve icinde acilinca betik durmali (hata firlatmali)');
    assert.equal(cerceve.belge.documentElement.textContent, '', 'sayfa icerigi silinmeli');
    assert.equal(cerceve.fetchler.length, 0, 'cerceve icinde sunucuya istek atilmamali');
  } finally { cerceve.bitir(); }

  // Kontrol: normal pencerede (top === self) arayuz acilir ve sunucuya baglanir.
  const normal = arayuzYukle({});
  try {
    await sakinles();
    assert.equal(normal.yuklemeHatasi, null);
    assert.equal(normal.belge.documentElement.textContent, 'SAYFA ICERIGI');
    assert.ok(normal.fetchler.some((f) => f.url === '/api/durum'), 'normal acilista /api/durum okunmali');
  } finally { normal.bitir(); }
});

/* ====================================================================== UI-06 */

test('UI-06 karakter hikayesi tek kez kacislanir (apostrof ve & bozulmaz, etiket yine etkisiz)', async () => {
  const y = await ekranHazirla({ '/api/sorular': { questions: [], answers: {} } });
  try {
    y.calistir(`S.status = {
      character: {
        identity: { name: 'Ada', handle: 'ada' }, seed: 7, createdAt: 0,
        life: { city: 'Izmir' },
        dossier: "Ada Turkiye'da dogdu & buyudu.\\n\\nIkinci <img src=x onerror=alert(1)> paragraf",
        persona: { traits: [], tone: 't', signatureHook: 'h', contentPillars: [] },
      },
      identityLine: 'x', risks: [], reference: null,
    };`);
    await y.calistir('renderDossier()');
    const html = y.eleman('view').innerHTML;
    const m = html.match(/<div class="dossier">([\s\S]*?)<\/div>/);
    assert.ok(m, 'hikaye kutusu cizilmeli');
    assert.equal(
      m[1],
      '<p>Ada Turkiye&#39;da dogdu &amp; buyudu.</p><p>Ikinci &lt;img src=x onerror=alert(1)&gt; paragraf</p>',
      'hikaye tek kacislanmis olmali'
    );
    assert.deepEqual(y.hatalar, []);
  } finally { y.bitir(); }
});

/* ====================================================================== UI-04 */

const MAGAZA_DURUM = {
  config: { apiKeyMask: '', redirectUri: 'https://ornek.test/etsy', bagli: false, bekleyen: true },
  kurulum: { baslik: 'Kurulum', neden: 'neden', adimlar: ['bir'], notlar: [], kayitUrl: 'https://www.etsy.com/developers/register' },
};

async function kodYapistir(ham) {
  const y = await ekranHazirla({ '/api/etsy/magaza/durum': MAGAZA_DURUM, '/api/etsy/magaza/kod': { config: {} } });
  try {
    await y.calistir('renderEtsyMagaza()');
    y.eleman('m_kod').value = ham;
    await y.eleman('mkod').onclick();
    await sakinles();
    const istek = y.fetchler.find((f) => f.url === '/api/etsy/magaza/kod');
    assert.ok(istek, 'kod sunucuya gonderilmeli');
    assert.deepEqual(y.hatalar, []);
    return istek.govde;
  } finally { y.bitir(); }
}

test('UI-04 Etsy OAuth: yapistirilan adresteki state de sunucuya gider (sunucudaki state kontrolu devreye girer)', async () => {
  const govde = await kodYapistir('https://ornek.test/etsy?code=ABC123&state=ST%2B45');
  assert.equal(govde.kod, 'ABC123');
  assert.equal(govde.state, 'ST+45', 'state adresten ayiklanip cozulmeli');
});

test('UI-04 Etsy OAuth: adres cubugundan kopyalanan "code=..&state=.." parcasi ve yalin kod da kabul edilir', async () => {
  const parca = await kodYapistir('code=XYZ&state=ABC');
  assert.deepEqual(parca, { kod: 'XYZ', state: 'ABC' });

  const yalin = await kodYapistir('  SADECEKOD  ');
  assert.equal(yalin.kod, 'SADECEKOD');
  assert.equal(yalin.state, undefined, 'state yoksa uydurulmaz');
});

/* ====================================================================== UI-05 */

test('UI-05 Etsy API anahtari kutulari (magaza + pazar arastirmasi) password tipinde, yonlendirme adresi duz metin kalir', async () => {
  const y = await ekranHazirla({
    '/api/etsy/magaza/durum': MAGAZA_DURUM,
    '/api/etsy/pazar/durum': {
      hazir: false, anahtar: '', siralama: {},
      kurulum: { baslik: 'k', neden: 'n', adimlar: [], notlar: [], kayitUrl: 'https://a.test', dokumanUrl: 'https://b.test' },
    },
  });
  try {
    await y.calistir('renderEtsyMagaza()');
    const magaza = y.eleman('view').innerHTML;
    assert.match(girdiEtiketi(magaza, 'm_key'), /type="password"/, 'm_key password olmali');
    assert.doesNotMatch(girdiEtiketi(magaza, 'm_redirect'), /type="password"/, 'yonlendirme adresi gizlenmez');

    await y.calistir('renderEtsyPazar()');
    assert.match(girdiEtiketi(y.eleman('view').innerHTML, 'p_key'), /type="password"/, 'p_key password olmali');
    assert.deepEqual(y.hatalar, []);
  } finally { y.bitir(); }
});

test('UI-05 saglayici ve buyutme ayarlarinda type=password alanlari password kutusu olarak cizilir', async () => {
  const saglayici = {
    id: 'replicate', label: 'Replicate', blurb: '', docs: '', local: false, configured: true,
    cost: 'ucretli', realism: 'yuksek', referenceState: 'ready', maxResolution: '1MP', setup: 'anahtar',
    fields: [
      { key: 'apiKey', label: 'API anahtari', type: 'password', required: true },
      { key: 'model', label: 'Model', type: 'text' },
      { key: 'adet', label: 'Adet', type: 'number' },
    ],
    config: { apiKey: '••••abcd', apiKey__set: true, model: 'm', adet: 1 },
  };
  const buyutme = {
    upscalers: [{
      id: 'replicate', label: 'Replicate', blurb: '',
      fields: [{ key: 'apiKey', label: 'Anahtar', type: 'password' }, { key: 'model', label: 'Model', type: 'text' }],
      config: { apiKey: '••••zzzz', apiKey__set: true, model: 'm' },
    }],
    active: 'replicate', scale: 2,
  };
  const y = await ekranHazirla({ '/api/buyutme': buyutme, '/api/cikti': { config: {}, jobs: [] }, '/api/kurulum': { adimlar: [] } });
  try {
    y.calistir(`S.providers = ${JSON.stringify({ providers: [saglayici], active: 'replicate' })};`);
    y.eleman('provsel').value = 'replicate';
    y.eleman('upsel').value = 'replicate';
    y.calistir('renderSettings()');
    await sakinles();

    const alanlar = y.eleman('provfields').innerHTML;
    assert.match(girdiEtiketi(alanlar, 'pf_apiKey'), /type="password"/, 'pf_apiKey password olmali');
    assert.match(girdiEtiketi(alanlar, 'pf_model'), /type="text"/, 'sade metin alani metin kalir');
    assert.match(girdiEtiketi(alanlar, 'pf_adet'), /type="number"/, 'sayi alani sayi kalir');

    const yuk = y.eleman('upfields').innerHTML;
    assert.match(girdiEtiketi(yuk, 'uf_apiKey'), /type="password"/, 'uf_apiKey password olmali');
    assert.match(girdiEtiketi(yuk, 'uf_model'), /type="text"/);
  } finally { y.bitir(); }
});

/* ====================================================================== UI-03 (kaynak taramasi) */

test('UI-03 sunucudan gelen SVG hicbir yerde ham innerHTML ile basilmaz (hepsi svgKoy uzerinden)', () => {
  const satirlar = APP_JS.split(/\r?\n/);
  const sorunlar = [];
  satirlar.forEach((s, i) => {
    // yorum satirlari ve toast() (textContent kullanir) tarama disi
    if (/^\s*(\/\/|\*|\/\*)/.test(s) || /\btoast\(/.test(s)) return;
    // ham SVG degiskenleri: r.svg / v.svg (yanit), t.onizleme (duvar paketi), sayfa SVG'leri
    if (/\$\{\s*(r|v)\.svg\s*\}/.test(s)) sorunlar.push(`${i + 1}: ${s.trim()}`);
    if (/innerHTML\s*=\s*(r|v)\.svg\b/.test(s)) sorunlar.push(`${i + 1}: ${s.trim()}`);
    if (/\bt\.onizleme\b.*\.replace\(/.test(s)) sorunlar.push(`${i + 1}: ${s.trim()}`);
    if (/svg\.replace\('<svg '/.test(s)) sorunlar.push(`${i + 1}: ${s.trim()}`);
    if (/\$\{\s*(k|c|kare)\.panelNo\s*\}/.test(s)) sorunlar.push(`${i + 1}: kacissiz panelNo: ${s.trim()}`);
  });
  assert.deepEqual(sorunlar, []);
  assert.match(APP_JS, /function svgKoy\(/, 'svgKoy yardimcisi tanimli olmali');
});

/* ====================================================================== UI-03 (gercek tarayici) */

// Port isletim sistemine biraktirilir: 4290-4299 gibi sabit araliklari baska calisanlar da kullaniyor ve
// "bos gorunen" porta baska bir sunucu oturmus olabiliyor.
function bosPort() {
  return new Promise((coz, red) => {
    const sv = net.createServer();
    sv.once('error', red);
    sv.listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => coz(p)); });
  });
}
const geciciKlasor = (onek) => fs.mkdtempSync(path.join(os.tmpdir(), `ss-arayuz-${onek}-`));
async function klasorSil(d) {
  for (let i = 0; i < 25; i++) {
    try { fs.rmSync(d, { recursive: true, force: true }); return; } catch (e) { await bekle(200); }
  }
}
function surecOldur(surec) {
  try {
    if (!surec || !surec.pid) return;
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(surec.pid), '/T', '/F'], { stdio: 'ignore' });
    else surec.kill('SIGKILL');
  } catch (e) { /* zaten kapali */ }
}

/**
 * Gercek ai-infapp/server.js'i gecici veri klasoruyle baslatir.
 * Acildigi, sunucunun KENDI acilis ciktisindan anlasilir: o port baska bir surece aitse sunucu hata verip kapanir
 * ve ona ait olmayan bir yanita guvenilmez.
 */
async function sunucuBaslat() {
  const veri = geciciKlasor('veri');
  const port = await bosPort();
  const surec = spawn(process.execPath, [path.join(KOK, 'server.js')], {
    cwd: KOK, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, AI_INFAPP_VERI: veri, AI_INFAPP_PORT: String(port) },
  });
  let cikti = '';
  let kapandi = false;
  surec.stdout.on('data', (d) => { cikti += d; });
  surec.stderr.on('data', (d) => { cikti += d; });
  surec.on('exit', () => { kapandi = true; });
  for (let i = 0; i < 150 && !kapandi; i++) {
    if (cikti.includes(`http://localhost:${port}`)) {
      return { port, kapat: async () => { surecOldur(surec); await bekle(300); await klasorSil(veri); } };
    }
    await bekle(100);
  }
  surecOldur(surec);
  await klasorSil(veri);
  throw new Error(`ai-infapp sunucusu acilmadi: ${cikti.slice(0, 300)}`);
}

/** Sunucuya JSON POST (Node fetch; Origin gondermez, yerel panel kapisindan gecer). */
async function sunucuyaPost(port, yolu, govde) {
  const r = await fetch(`http://127.0.0.1:${port}${yolu}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(govde),
  });
  return { durum: r.status, veri: await r.json() };
}

/** Sihirbazin sorularini ilk secenekle doldurup gercek bir karakter kilitler (fotoroman onizlemesi karakter ister). */
async function karakterOlustur(port) {
  const cevaplar = {};
  for (let tur = 0; tur < 80; tur++) {
    const { veri } = await sunucuyaPost(port, '/api/sorular', { answers: cevaplar });
    const q = veri.questions.find((x) => cevaplar[x.key] === undefined && x.required !== false);
    if (!q) break;
    let v;
    if (q.type === 'select' || q.type === 'select-or-text' || q.type === 'dynamic-select') v = (q.options && q.options[0]) || 'Izmir';
    else if (q.type === 'multiselect') v = (q.options || []).slice(0, q.min || 0);
    else if (q.type === 'number') v = q.default != null ? q.default : q.min;
    else if (q.type === 'measurements') {
      v = {};
      for (const f of q.fields) if (f.required) v[f.key] = f.default != null ? f.default : f.min;
    } else v = 'Deneme';
    cevaplar[q.key] = v;
  }
  const r = await sunucuyaPost(port, '/api/karakter', { answers: cevaplar });
  assert.equal(r.durum, 200, `karakter olusturulamadi: ${JSON.stringify(r.veri).slice(0, 300)}`);
}

/**
 * Bassiz Chrome/Edge + DevTools protokolu (Node'un yerlesik WebSocket'i). Tarayici yoksa ya da acilmazsa null.
 */
async function tarayiciAc() {
  let yol = null;
  try { yol = require('../src/raster').findBrowser(); } catch (e) { /* yok */ }
  if (!yol || typeof WebSocket !== 'function') return null;

  const profil = geciciKlasor('chrome');
  const surec = spawn(yol, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profil}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--mute-audio', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  const kapat = async () => { surecOldur(surec); await bekle(300); await klasorSil(profil); };

  try {
    // DevToolsActivePort: 1. satir port, 2. satir tarayici WebSocket yolu.
    let satirlar = null;
    for (let i = 0; i < 100 && !satirlar; i++) {
      await bekle(150);
      try {
        const s = fs.readFileSync(path.join(profil, 'DevToolsActivePort'), 'utf8').split(/\r?\n/);
        if (s[0] && s[1]) satirlar = s;
      } catch (e) { /* henuz yok */ }
    }
    if (!satirlar) throw new Error('DevToolsActivePort olusmadi');

    const ws = new WebSocket(`ws://127.0.0.1:${satirlar[0]}${satirlar[1]}`);
    await new Promise((coz, red) => { ws.onopen = coz; ws.onerror = () => red(new Error('WebSocket acilamadi')); });

    let no = 0;
    const bekleyen = new Map();
    ws.onmessage = (m) => {
      const v = JSON.parse(m.data);
      if (v.id && bekleyen.has(v.id)) {
        const { coz, red } = bekleyen.get(v.id);
        bekleyen.delete(v.id);
        if (v.error) red(new Error(v.error.message)); else coz(v.result);
      }
    };
    const gonder = (yontem, parametre = {}, sessionId) => new Promise((coz, red) => {
      const id = ++no;
      const zaman = setTimeout(() => { if (bekleyen.delete(id)) red(new Error(`CDP zaman asimi: ${yontem}`)); }, 30000);
      bekleyen.set(id, { coz: (v) => { clearTimeout(zaman); coz(v); }, red: (e) => { clearTimeout(zaman); red(e); } });
      ws.send(JSON.stringify({ id, method: yontem, params: parametre, ...(sessionId ? { sessionId } : {}) }));
    });

    const { targetId } = await gonder('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await gonder('Target.attachToTarget', { targetId, flatten: true });
    await gonder('Page.enable', {}, sessionId);
    await gonder('Runtime.enable', {}, sessionId);

    return {
      git: async (url) => {
        await gonder('Page.navigate', { url }, sessionId);
        await bekle(300);
        for (let i = 0; i < 100; i++) {
          const r = await gonder('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sessionId);
          if (r.result.value === 'complete') return;
          await bekle(100);
        }
        throw new Error('sayfa yuklenmedi');
      },
      degerlendir: async (ifade) => {
        const r = await gonder('Runtime.evaluate', { expression: ifade, awaitPromise: true, returnByValue: true }, sessionId);
        if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
        return r.result.value;
      },
      kapat: async () => { try { ws.close(); } catch (e) { /* */ } await kapat(); },
    };
  } catch (err) {
    await kapat();
    return null;
  }
}

// Sayfaya yuklenen zehirli SVG: <img> ile SVG'den cikis, script, olay niteligi, javascript: baglantisi, dis kaynaklar.
// Zararsiz parcalar (rect#iyi, textPath, clipPath, /gorseller/ gorseli) ONCE gelir: kacis sonrasi parcalar HTML sayilir.
const ZEHIRLI_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" onload="window.__pwn=(window.__pwn||0)+1">',
  '<defs><clipPath id="k1"><rect width="50" height="50"/></clipPath></defs>',
  '<rect id="iyi" width="40" height="40" fill="#123456" clip-path="url(#k1)" onclick="window.__pwn=9"/>',
  '<rect id="dis" width="4" height="4" style="fill:url(https://kotu.example/p.svg#a)"/>',
  '<image id="resim" href="/gorseller/yok-2.png" width="10" height="10" onerror="window.__pwn=(window.__pwn||0)+1"/>',
  '<text id="yazi" x="1" y="9"><textPath href="#k1">yol</textPath></text>',
  '<a id="baglanti" href="javascript:window.__pwn=7"><text x="1" y="20">tikla</text></a>',
  '<a id="eski" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="javascript:window.__pwn=5"><text x="1" y="30">x</text></a>',
  '<a id="gizli" href="java&#x09;script:window.__pwn=6"><text x="1" y="40">x</text></a>',
  '<use id="dis2" href="https://kotu.example/x.svg#a"/>',
  '<set attributeName="href" to="javascript:window.__pwn=8"/>',
  '<style>@import url(https://kotu.example/a.css);</style>',
  '<script>window.__pwn=(window.__pwn||0)+1</script>',
  '<foreignObject width="10" height="10"><iframe srcdoc="x"></iframe></foreignObject>',
  '</clipPath><img id="kacis" src="/yok-1.png" onerror="window.__pwn=(window.__pwn||0)+1">',
  '</svg>',
].join('');

// Panelin gercekten urettigi turden zararsiz bir SVG: hicbir parca silinmemeli.
const ZARARSIZ_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">',
  '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>',
  '<clipPath id="c"><rect width="100" height="100"/></clipPath><path id="yay" d="M0 50 A50 50 0 0 1 100 50"/></defs>',
  '<rect width="200" height="100" fill="url(#g)" clip-path="url(#c)"/>',
  '<image href="/gorseller/x.png" width="100" height="100" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>',
  '<image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>',
  '<text x="10" y="10" font-size="12"><textPath href="#yay" startOffset="50%">yazi</textPath></text>',
  '<use href="#yay"/>',
  '</svg>',
].join('');

test('UI-03 gercek tarayici (Chrome/Edge + gercek ai-infapp sunucusu)', async (t) => {
  const tarayici = await tarayiciAc();
  if (!tarayici) return t.skip('Chrome/Edge bulunamadi ya da acilamadi');
  let sunucu = null;
  t.after(async () => {
    await tarayici.kapat();
    if (sunucu) await sunucu.kapat();
  });
  sunucu = await sunucuBaslat();
  await karakterOlustur(sunucu.port);
  const sayfaAc = async () => { await tarayici.git(`http://127.0.0.1:${sunucu.port}/`); await bekle(400); };

  await t.test('zehirli SVG calismaz, zararsiz SVG eksiksiz kalir (5 SVG girisinin hepsi)', async () => {
    await sayfaAc();

    // Sayfa icinde: fetch'i yalnizca zehirli yanit doneceklerde ele gecir, gerisi gercek sunucuya gitsin.
    await tarayici.degerlendir(`(() => {
      window.__pwn = 0;
      const ZEHIR = ${JSON.stringify(ZEHIRLI_SVG)};
      const gercek = window.fetch.bind(window);
      const yanitlar = {
        '/api/etsy/onizleme': { svg: ZEHIR },
        '/api/etsy/varyantlar': { varyantlar: [{ svg: ZEHIR, etiket: 'v1', design: {} }] },
        '/api/etsy/mockup/onizleme': { svg: ZEHIR },
        '/api/fotoroman/onizleme': { sayfalar: [ZEHIR], sayfaSayisi: 1 },
      };
      window.fetch = (url, ayar) => {
        const k = yanitlar[String(url)];
        if (!k) return gercek(url, ayar);
        return Promise.resolve(new Response(JSON.stringify(k), { status: 200, headers: { 'content-type': 'application/json' } }));
      };
      return true;
    })()`);

    // Her kutuda ayni olcutleri uygulayan denetleyici (sayfa icinde calisir).
    const DENETLE = `(kutu) => {
      const tum = [...kutu.querySelectorAll('*')];
      const yasak = tum.filter((e) => /^(script|foreignobject|iframe|object|embed|style|set|animate|img)$/i.test(e.localName)).map((e) => e.localName);
      const htmlEleman = tum.filter((e) => e.namespaceURI !== 'http://www.w3.org/2000/svg').map((e) => e.localName);
      const olay = tum.flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name)).map((a) => e.localName + '@' + a.name));
      const baglanti = tum.flatMap((e) => [...e.attributes].filter((a) => /(^|:)href$/i.test(a.name)).map((a) => a.value));
      const disUrl = tum.flatMap((e) => [...e.attributes].filter((a) => /url\\(\\s*['"]?\\s*[^#'"\\s]/i.test(a.value)).map((a) => a.name));
      return {
        yasak, htmlEleman, olay, disUrl,
        kotuBaglanti: baglanti.filter((v) => !/^(#|\\/gorseller\\/|data:image\\/)/i.test(v.trim())),
        iyi: !!kutu.querySelector('#iyi') && kutu.querySelector('#iyi').getAttribute('fill') === '#123456'
          && kutu.querySelector('#iyi').getAttribute('clip-path') === 'url(#k1)',
        resim: !!kutu.querySelector('#resim') && kutu.querySelector('#resim').getAttribute('href') === '/gorseller/yok-2.png',
        yazi: !!kutu.querySelector('#yazi textPath'),
        svgSayisi: kutu.querySelectorAll('svg').length,
      };
    }`;
    // Bes SVG girisinin hepsini sirayla calistir, sonuclari topla; kontroller en sonda (hata mesaji tum tabloyu gostersin).
    const rapor = {};
    const bekleSure = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;

    // 1) etsy/reklam canli onizleme (box.innerHTML = r.svg) + 2) varyantlar
    await tarayici.degerlendir(`(async () => {
      S.studio = 'etsy'; S.tab = 'tasarim'; delete S.design.etsy;
      await renderStudioDesign('etsy');
      ${bekleSure(700)}
      document.getElementById('dvaryant').onclick();
      ${bekleSure(700)}
      return true;
    })()`);
    rapor['etsy onizleme'] = await tarayici.degerlendir(`(${DENETLE})(document.getElementById('dprev'))`);
    rapor['varyantlar'] = await tarayici.degerlendir(`(${DENETLE})(document.querySelector('#dvaryantlar .varyantgorsel'))`);

    // 3) listeleme gorseli (mockup)
    await tarayici.degerlendir(`(async () => {
      await mockupPaneli('etsy');
      ${bekleSure(900)}
      return true;
    })()`);
    rapor['mockup'] = await tarayici.degerlendir(`(${DENETLE})(document.querySelector('#mockonizleme .mockonizleme'))`);

    // 4) fotoroman sayfa onizlemesi (svg.replace('<svg ', ...) ile ham basiliyordu)
    await tarayici.degerlendir(`(async () => {
      document.getElementById('view').innerHTML = '<div id="sprev"></div>';
      S.fotoroman = null;
      await fotoromanOnizleme();
      ${bekleSure(700)}
      return true;
    })()`);
    rapor['fotoroman'] = await tarayici.degerlendir(`(${DENETLE})(document.querySelector('#sprev > div > div'))`);
    const fotoStil = await tarayici.degerlendir(`(document.querySelector('#sprev svg') || document.body).getAttribute('style')`);

    // 5) duvar kagidi paketi (t.onizleme)
    await tarayici.degerlendir(`(async () => {
      document.getElementById('view').innerHTML = '<div id="dv_prev"></div>';
      S.duvar = null;
      const D = duvarDurum();
      D.paket = { adet: 1, dosyaSayisi: 3, tasarimlar: [{ no: 1, aile: 'aile', onizleme: ${JSON.stringify(ZEHIRLI_SVG)} }] };
      duvarPaketCiz();
      ${bekleSure(700)}
      return true;
    })()`);
    rapor['duvar'] = await tarayici.degerlendir(`(${DENETLE})(document.querySelector('#dv_prev > div > div > div'))`);
    const duvarStil = await tarayici.degerlendir(`(document.querySelector('#dv_prev svg') || document.body).getAttribute('style')`);

    // EN ONEMLISI: zehirli SVG icindeki hicbir kod calismamis olmali (img onerror, image onerror, script...).
    assert.equal(await tarayici.degerlendir('window.__pwn'), 0, 'zehirli SVG icindeki kod calisti');

    const BEKLENEN_TEMIZ = { yasak: [], htmlEleman: [], olay: [], disUrl: [], kotuBaglanti: [] };
    for (const [ad, o] of Object.entries(rapor)) {
      assert.deepEqual(
        { yasak: o.yasak, htmlEleman: o.htmlEleman, olay: o.olay, disUrl: o.disUrl, kotuBaglanti: o.kotuBaglanti },
        BEKLENEN_TEMIZ, `${ad}: tehlikeli parca kaldi`
      );
      assert.equal(o.iyi, true, `${ad}: zararsiz sekil (rect#iyi) korunmali`);
      assert.equal(o.svgSayisi >= 1, true, `${ad}: svg koku korunmali`);
    }
    assert.equal(rapor['etsy onizleme'].resim, true, 'etsy onizleme: /gorseller/ gorseli korunmali');
    assert.equal(rapor['etsy onizleme'].yazi, true, 'etsy onizleme: textPath korunmali');
    assert.match(fotoStil, /width:\s*100%/, 'fotoroman: onizleme genisligi (kok stil) korunmali');
    assert.match(duvarStil, /width:\s*100%/, 'duvar: onizleme genisligi (kok stil) korunmali');

    // Zararsiz SVG: svgKoy hicbir elemani silmemeli (ayni etiket dizisi).
    const zararsiz = await tarayici.degerlendir(`(() => {
      const kap = document.createElement('div');
      document.body.appendChild(kap);
      svgKoy(kap, ${JSON.stringify(ZARARSIZ_SVG)});
      const sablon = document.createElement('template');
      sablon.innerHTML = ${JSON.stringify(ZARARSIZ_SVG)};
      const etiketler = (kok) => [...kok.querySelectorAll('*')].map((e) => e.localName);
      const baglantilar = [...kap.querySelectorAll('[href]')].map((e) => e.getAttribute('href'));
      return { sonra: etiketler(kap), once: etiketler(sablon.content), baglantilar };
    })()`);
    assert.deepEqual(zararsiz.sonra, zararsiz.once, 'zararsiz SVG\'den parca silinmemeli');
    assert.deepEqual(zararsiz.baglantilar, ['/gorseller/x.png', 'data:image/png;base64,iVBORw0KGgo=', '#yay', '#yay']);
  });

  await t.test("panelin GERCEK urettigi SVG'ler svgKoy'dan sonra birebir ayni kalir (etsy, reklam, varyant, mockup, duvar, fotoroman)", async () => {
    await sayfaAc();
    const sonuc = await tarayici.degerlendir(`(async () => {
      const sonuc = {};
      const karsilastir = (ad, svg) => {
        const sablon = document.createElement('template');
        sablon.innerHTML = svg;
        const kap = document.createElement('div');
        svgKoy(kap, svg);
        sonuc[ad] = { ayni: kap.innerHTML === sablon.innerHTML, svgSayisi: sablon.content.querySelectorAll('svg').length, boy: svg.length };
      };
      for (const id of ['etsy', 'reklam']) {
        S.studio = id; S.tab = 'tasarim'; delete S.design[id];
        await renderStudioDesign(id);
        karsilastir(id + ' onizleme', (await api('/api/' + id + '/onizleme', { design: S.design[id] })).svg);
      }
      const v = await api('/api/etsy/varyantlar', { design: S.design.etsy });
      v.varyantlar.forEach((x, i) => karsilastir('varyant ' + i, x.svg));
      const mo = await api('/api/etsy/mockup/secenekler');
      const m = await api('/api/etsy/mockup/onizleme', { design: S.design.etsy, urun: mo.urunler[0].key, renk: mo.renkler[0].key });
      karsilastir('mockup', m.svg);
      const d = await api('/api/etsy/duvar/paket', { adet: 3, tohum: 1, olculer: null, aileler: [], paletler: [] });
      d.tasarimlar.forEach((x, i) => karsilastir('duvar ' + i, x.onizleme));
      const h = (await api('/api/fotoroman/kur', { ayar: { tur: 'gundelik', kareSayisi: 8, zaman: '', mekanSayisi: 2, konu: '', tohum: 0 } })).hikaye;
      const fo = await api('/api/fotoroman/onizleme', { hikaye: h, size: 'karusel', tema: 'klasik', font: 'elyazisi' });
      fo.sayfalar.forEach((x, i) => karsilastir('fotoroman ' + i, x));
      return sonuc;
    })()`);
    const adlar = Object.keys(sonuc);
    for (const beklenen of ['etsy onizleme', 'reklam onizleme', 'varyant 0', 'mockup', 'duvar 0', 'fotoroman 0']) {
      assert.ok(adlar.includes(beklenen), `${beklenen} denenmedi (denenenler: ${adlar.join(', ')})`);
    }
    for (const [ad, o] of Object.entries(sonuc)) {
      assert.equal(o.svgSayisi >= 1, true, `${ad}: yanitta svg yok`);
      assert.equal(o.ayni, true, `${ad}: svgKoy uretecin gercek ciktisindan bir sey sildi (uretec yasakli bir etiket/nitelik kullaniyor olabilir)`);
    }
  });
});
