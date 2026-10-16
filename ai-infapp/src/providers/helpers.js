'use strict';

/** Saglayicilarin ortak kullandigi HTTP / donusum yardimcilari. */

const { yerelAdresMi, adYerelCozuluyorMu } = require('./ag-guvenlik');

const MB = 1024 * 1024;

/**
 * Bayt sinirlari: tek yanit bellegi sinirsiz tuketemesin.
 * Yerel servis (A1111) base64 listeleri ve buyutme sonuclari daha buyuk olabilir.
 */
const SINIR = {
  json: 16 * MB, // bulut saglayici JSON yanitlari
  ikili: 32 * MB, // indirilen tek gorsel
  yerelJson: 96 * MB, // yerel servislerin base64 gorsel listeleri (A1111 batch)
  buyutme: 128 * MB, // buyutme sonuclari (4x PNG; base64'te %33 sisiyor)
  hata: 4096, // HTTP hata govdesinden okunan en cok bayt
};

const MAKS_YONLENDIRME = 5;
const YONLENDIRME_KODLARI = new Set([301, 302, 303, 307, 308]);
// Baska siteye giden yonlendirmede tasinmasina izin verilen basliklar (sirsiz olanlar).
const CAPRAZ_SITE_BASLIK = new Set(['accept', 'user-agent']);

// Test kancasi: alan adi cozumleme (DNS) yerine sahte cozucu koymak icin.
let dnsCozucu = null;
function dnsAyarla(cozucu) {
  dnsCozucu = cozucu || null;
}

async function adresYerelMi(hostname) {
  if (yerelAdresMi(hostname)) return true;
  return adYerelCozuluyorMu(hostname, dnsCozucu ? { dns: dnsCozucu } : undefined);
}

/**
 * Kullanicinin KENDI yazdigi adres yerel/ozel agda mi? (yerelIzin kararini vermek icin)
 * Gecersiz adres false doner; istegin kendisi zaten "Gecersiz adres" hatasi verir.
 */
async function yerelHedefMi(adres) {
  let u;
  try {
    u = new URL(String(adres));
  } catch {
    return false;
  }
  return adresYerelMi(u.hostname);
}

async function hedefDenetle(u, yerelIzin) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Desteklenmeyen adres turu (${u.protocol}). Yalniz http ve https kullanilabilir.`);
  }
  if (yerelIzin) return;
  if (await adresYerelMi(u.hostname)) {
    throw new Error(`Yerel ag adresine istek engellendi (${u.hostname}). Servis yaniti yerel/ozel bir adrese isaret ediyor; guvenlik icin indirilmedi.`);
  }
}

// Ayni site mi? http -> https yukseltmesi (ayni ad, varsayilan portlar) ayni site sayilir.
function ayniSite(a, b) {
  if (a.origin === b.origin) return true;
  return a.protocol === 'http:' && b.protocol === 'https:' && a.hostname === b.hostname && a.port === '' && b.port === '';
}

function cokBuyuk(maks) {
  return new Error(`Yanit cok buyuk (en fazla ${Math.round(maks / MB)} MB okunur). Servis beklenmeyen bir veri akitiyor olabilir.`);
}

/**
 * Govdeyi AKIS halinde, bayt sayarak okur.
 * kes=true: sinira varinca hata vermez, okunani dondurur (HTTP hata govdeleri icin).
 */
async function govdeOku(res, maks, kes) {
  const bildirilen = Number(res.headers.get('content-length'));
  if (!kes && Number.isFinite(bildirilen) && bildirilen > maks) {
    if (res.body) await res.body.cancel().catch(() => {});
    throw cokBuyuk(maks);
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parcalar = [];
  let toplam = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    toplam += value.length;
    if (toplam > maks) {
      await reader.cancel().catch(() => {});
      if (!kes) throw cokBuyuk(maks);
      parcalar.push(value.subarray(0, value.length - (toplam - maks)));
      break;
    }
    parcalar.push(value);
  }
  return Buffer.concat(parcalar);
}

/**
 * TUM dis istekler buradan gecer.
 *
 *  - yalniz http/https
 *  - yonlendirmeler ELLE izlenir (en cok 5); HER sicramada (ilk istek dahil) hedef
 *    yerel/ozel ag adresiyse (veya yerel adrese cozuluyorsa) yerelIzin yoksa reddedilir
 *  - baska SITEYE giden yonlendirmede: POST/PUT gibi govdeli istek izlenmez (hata);
 *    GET izlenir ama ozel basliklar (x-api-key vb.) ve govde dusurulur
 *  - govde akis halinde okunur, maksBayt asilirsa kesilir
 *
 * Sinir: alan adi kontrolden sonra baska adrese cozulurse (DNS rebinding) yakalanmaz;
 * bu, kok lib/ag-guvenlik.js ile ayni bilinen sinirdir.
 *
 * @returns {{ ok: boolean, status: number, buffer: Buffer }}
 */
async function guvenliIstek(url, init = {}, ek = {}) {
  const { timeoutMs = 180000, maksBayt = SINIR.ikili, yerelIzin = false } = ek;

  let hedef;
  try {
    hedef = new URL(String(url));
  } catch {
    throw new Error('Gecersiz adres (URL).');
  }

  let method = String(init.method || 'GET').toUpperCase();
  let headers = new Headers(init.headers || {});
  let body = init.body;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let sicrama = 0; ; sicrama++) {
      await hedefDenetle(hedef, yerelIzin);
      const res = await fetch(hedef.href, { method, headers, body, redirect: 'manual', signal: controller.signal });

      const konum = res.headers.get('location');
      if (!YONLENDIRME_KODLARI.has(res.status) || !konum) {
        const buffer = await govdeOku(res, res.ok ? maksBayt : SINIR.hata, !res.ok);
        return { ok: res.ok, status: res.status, buffer };
      }

      if (res.body) await res.body.cancel().catch(() => {});
      if (sicrama >= MAKS_YONLENDIRME) throw new Error(`Cok fazla yonlendirme (en fazla ${MAKS_YONLENDIRME}).`);
      let sonraki;
      try {
        sonraki = new URL(konum, hedef);
      } catch {
        throw new Error('Gecersiz yonlendirme adresi.');
      }

      // Fetch standardi: 303 (HEAD disi) ile 301/302+POST govdeyi atip GET'e doner.
      if (res.status === 303 ? method !== 'HEAD' : (res.status === 301 || res.status === 302) && method === 'POST') {
        method = 'GET';
        body = undefined;
        headers.delete('content-type');
        headers.delete('content-length');
      }

      if (!ayniSite(hedef, sonraki)) {
        if (method !== 'GET' && method !== 'HEAD') {
          throw new Error(`Servis istegi baska siteye yonlendirdi: ${sonraki.host}. Govde ve basliklar gonderilmedi.`);
        }
        headers = new Headers([...headers].filter(([ad]) => CAPRAZ_SITE_BASLIK.has(ad.toLowerCase())));
        body = undefined;
      }
      hedef = sonraki;
    }
  } finally {
    clearTimeout(timer);
  }
}

/** options: fetch secenekleri + yerelIzin (bool) + maksBayt (sayi). */
async function fetchJson(url, options = {}, timeoutMs = 180000) {
  const { yerelIzin, maksBayt, ...init } = options;
  const res = await guvenliIstek(url, init, { timeoutMs, yerelIzin, maksBayt: maksBayt || SINIR.json });
  const text = res.buffer.toString('utf8');
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = typeof body === 'string' ? body.slice(0, 600) : JSON.stringify(body).slice(0, 600);
    throw new Error(`HTTP ${res.status} - ${anahtarMaskele(detail)}`);
  }
  return body;
}

/** options: fetch secenekleri + yerelIzin (bool) + maksBayt (sayi). */
async function fetchBinary(url, options = {}, timeoutMs = 180000) {
  const { yerelIzin, maksBayt, ...init } = options;
  const res = await guvenliIstek(url, init, { timeoutMs, yerelIzin, maksBayt: maksBayt || SINIR.ikili });
  if (!res.ok) {
    // Hata govdesi bazen gorsel (ornegin "odeme gerekli" resmi): ikili veriyi mesaja basma.
    const ilk = res.buffer.subarray(0, 600);
    const metin = ilk.some((b) => b < 9 || (b > 13 && b < 32)) ? '(metin degil, ikili yanit)' : ilk.toString('utf8');
    throw new Error(`HTTP ${res.status} - ${anahtarMaskele(metin)}`);
  }
  return res.buffer;
}

/** Ilk baytlardan gorsel turunu anlar (PNG, JPEG, WEBP); tanimazsa null. */
function gorselTuru(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Gorsel indirir. Varsayilan: yerel/ozel ag adresleri KAPALI (yanittan gelen url
 * saldirgan olabilir); yerelIzin yalniz kullanicinin kendi yerel servisi icin acilir.
 * Mime URL uzantisindan degil BAYT IMZASINDAN gelir; gorsel olmayan icerik reddedilir.
 */
async function downloadImage(url, opts = {}) {
  const { yerelIzin = false, maksBayt = SINIR.ikili } = opts;
  let buffer;
  let kaynak = url;
  if (/^data:/i.test(String(url))) {
    const m = /^data:[^,]*;base64,([\s\S]*)$/i.exec(String(url));
    if (!m) throw new Error('Desteklenmeyen veri adresi (yalniz base64 gorsel kabul edilir).');
    if (m[1].length * 0.75 > maksBayt) throw cokBuyuk(maksBayt);
    buffer = Buffer.from(m[1], 'base64');
    kaynak = 'data-uri';
  } else {
    buffer = await fetchBinary(url, { yerelIzin, maksBayt });
  }
  const mime = gorselTuru(buffer);
  if (!mime) throw new Error('Indirilen dosya bir gorsel degil (PNG, JPEG veya WEBP bekleniyordu).');
  return { buffer, mime, sourceUrl: kaynak };
}

function fromBase64(b64, mime = 'image/png') {
  const clean = String(b64).replace(/^data:[^;]+;base64,/, '');
  return { buffer: Buffer.from(clean, 'base64'), mime };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** "a.b[0].c" seklindeki yoldan deger okur. */
function dig(obj, path) {
  if (!path) return obj;
  return String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/** Sablondaki {{anahtar}} yerlerini doldurur. */
function fill(template, vars) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    if (!(key in vars)) return match;
    const value = vars[key];
    return value == null ? '' : String(value);
  });
}

/**
 * URL sablonu doldurur; degerler KODLANIR. Kodlanmazsa prompt'taki "&", "#", "?"
 * baska sorgu parametresi enjekte eder ya da adresi keser. Yalniz sablonda gecen
 * anahtarlar kodlanir (dev base64 degiskenleri bosuna islenmez).
 */
function fillUrl(template, vars) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    if (!(key in vars)) return match;
    const value = vars[key];
    if (value == null) return '';
    const metin = String(value);
    return encodeURIComponent(typeof metin.toWellFormed === 'function' ? metin.toWellFormed() : metin);
  });
}

/** JSON gövde sablonu: string degerlerde {{}} doldurur, tip korunur. */
function fillDeep(node, vars) {
  if (typeof node === 'string') {
    // Tek basina {{seed}} gibi bir deger ise sayiyi sayi olarak birak
    const solo = node.match(/^\{\{\s*(\w+)\s*\}\}$/);
    if (solo && solo[1] in vars) return vars[solo[1]];
    return fill(node, vars);
  }
  if (Array.isArray(node)) return node.map((n) => fillDeep(n, vars));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = fillDeep(v, vars);
    return out;
  }
  return node;
}

/**
 * Hata mesajlarinda gizli anahtar gostermemek icin maskeler.
 *  - sablonMaskele: 16+ karakterlik jeton benzeri dizileri maskeler (kullanicinin kendi
 *    sablon metni icin; anahtarlar oraya yazilmis olabilir)
 *  - anahtarMaskele: yalniz bilinen anahtar bicimlerini maskeler (servis hata govdesi
 *    gibi okunabilir kalmasi gereken metinler icin)
 */
const PUL = String.fromCharCode(0x2022); // maske karakteri (kaynak dosya ASCII kalsin)

function sablonMaskele(text) {
  return String(text).replace(/[A-Za-z0-9_\-.:]{16,}/g, (t) => PUL.repeat(12) + t.slice(-4));
}

function anahtarMaskele(text) {
  return String(text)
    .replace(/\b(Bearer|Key|Token|Basic)\s+[A-Za-z0-9_\-.=+/]{8,}/gi, '$1 ' + PUL.repeat(4))
    .replace(/\b(?:sk|key|r8|fal)[-_][A-Za-z0-9_-]{8,}/gi, PUL.repeat(4));
}

/**
 * JSON sablonunu once DOLDURUP sonra ayristirir.
 *
 * Neden gerekli: kullanicilar platform dokumanindan kopyalarken sayilari
 * tirnaksiz yazar -> {"seed": {{seed}}}. Bu, doldurmadan once gecerli JSON
 * DEGILDIR; once parse etmeye calisirsak patlar. Burada once metin olarak
 * doldurup (degerleri JSON'a gore kacislayarak) sonra ayristiriyoruz.
 *
 *   "{{prompt}}"  -> "tirnakli, kacislanmis metin"
 *   {{seed}}      -> 851317130   (sayi sayi kalir)
 *   "on {{aspect}} canvas" -> string icinde guvenli kacislama
 */
function fillJsonTemplate(template, vars, label = 'Sablon') {
  let text = String(template);

  // 1) Tam tirnakli yer tutucu: "{{key}}" -> degerin dogal JSON karsiligi
  text = text.replace(/"\{\{\s*(\w+)\s*\}\}"/g, (match, key) => {
    if (!(key in vars)) return match;
    return JSON.stringify(vars[key] == null ? '' : vars[key]);
  });

  // 2) Kalan yer tutucular: string ise tirnaksiz kacislanmis govde,
  //    sayi/boolean ise dogrudan deger.
  text = text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    if (!(key in vars)) return match;
    const value = vars[key];
    if (typeof value === 'string') return JSON.stringify(value).slice(1, -1);
    return JSON.stringify(value == null ? '' : value);
  });

  try {
    return JSON.parse(text);
  } catch (err) {
    // V8 mesajlari kaynak metinden parca tasiyabilir; yalniz konumu aliyoruz.
    const konum = /position (\d+)/.exec(err.message);
    const yer = konum ? ` (yaklasik ${konum[1]}. karakter)` : '';
    if (label === 'Basliklar') {
      // Basliklarda API anahtari var: doldurulmus metni ASLA gosterme.
      throw new Error(`${label} gecerli JSON degil${yer}. Tirnak, virgul ve suslu parantezleri kontrol et (guvenlik icin icerik gosterilmiyor).`);
    }
    throw new Error(`${label} gecerli JSON degil${yer}. Doldurulmus hali: ${sablonMaskele(text).slice(0, 120)}`);
  }
}

/**
 * Replicate yanitindaki durum (poll) adresi. Bearer anahtar yanittan gelen mutlak
 * adrese gonderildigi icin yalniz api.replicate.com kabul edilir.
 */
function replicateDurumAdresi(prediction) {
  const adres = prediction && prediction.urls && prediction.urls.get;
  let u;
  try {
    u = new URL(String(adres));
  } catch {
    throw new Error('Replicate yaniti durum adresi icermiyor.');
  }
  if (u.protocol !== 'https:' || u.host !== 'api.replicate.com') {
    throw new Error('Replicate yaniti beklenmeyen bir durum adresi verdi; anahtar baska siteye gonderilmesin diye durduruldu.');
  }
  return u.href;
}

module.exports = {
  SINIR,
  guvenliIstek,
  fetchJson,
  fetchBinary,
  downloadImage,
  gorselTuru,
  yerelHedefMi,
  dnsAyarla,
  fromBase64,
  sleep,
  dig,
  fill,
  fillUrl,
  fillDeep,
  fillJsonTemplate,
  sablonMaskele,
  anahtarMaskele,
  replicateDurumAdresi,
};
