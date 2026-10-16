'use strict';
// Regresyon testleri (denetim turu 2): iptal yarisi, beyaz liste uzantilari, spawn hatasinda tek bitis, panelin eski kopyayi tanimasi.
// Gercek ag/anahtar yok: sahte yt-dlp + gecici klasorler. Panel testi ayri surec olarak panel.js'i baslatir (ag'a cikmaz).
const ortam = require('./_ortam');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const m = require('../server.js');
const panelYardim = require('../../test/panel-yardim');

let port = 0;
const ac = [];                                  // ic.ac cagrilari
const BITEN = ['bitti', 'hata', 'iptal'];

test.before(async () => {
  ortam.ornekMp4Uret(ortam.dosyalar.mp4);
  m.ic.ac = (hedef, sec) => ac.push([hedef, sec]);
  m.ic.dns = { lookup: async () => [{ address: '93.184.216.34', family: 4 }] };   // gercek DNS'e gidilmesin
  const s = await m.baslat({ port: 0 });
  port = s.address().port;
});
test.after(async () => {
  await m.kapat();
  ortam.temizle();
});

function istek(yontem, yol, { govde, basliklar = {} } = {}) {
  return new Promise((coz, red) => {
    const h = { 'X-Panel-Token': m.jeton(), ...basliklar };
    let veri = null;
    if (govde !== undefined) veri = typeof govde === 'string' ? govde : JSON.stringify(govde);
    if (yontem === 'POST') h['Content-Type'] = 'application/json';
    if (veri !== null) h['Content-Length'] = Buffer.byteLength(veri);
    const r = http.request({ host: '127.0.0.1', port, path: yol, method: yontem, headers: h }, (res) => {
      const parcalar = [];
      res.on('data', (c) => parcalar.push(c));
      res.on('end', () => {
        const g = Buffer.concat(parcalar);
        let j = null;
        try { j = JSON.parse(g.toString('utf8')); } catch { /* json degil */ }
        coz({ durum: res.statusCode, basliklar: res.headers, govde: g, json: j });
      });
    });
    r.on('error', red);
    if (veri !== null) r.write(veri);
    r.end();
  });
}
const al = (yol, o) => istek('GET', yol, o);
const gonder = (yol, govde) => istek('POST', yol, { govde });
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
async function kadarBekle(kosul, ms = 15000) {
  const bas = Date.now();
  for (;;) {
    const v = await kosul();
    if (v) return v;
    if (Date.now() - bas > ms) throw new Error('zaman aşımı');
    await bekle(50);
  }
}
const isleriAl = async () => (await al('/api/durum')).json.isler;
const surecOlu = (pid) => { try { process.kill(pid, 0); return false; } catch { return true; } };
async function hepsiniKapat() {
  for (const i of (await isleriAl()).filter((x) => !BITEN.includes(x.durum)).sort((a, b) => b.id - a.id)) await gonder('/api/iptal', { id: i.id });
  await kadarBekle(async () => (await isleriAl()).every((i) => BITEN.includes(i.durum)), 20000);
  await gonder('/api/temizle', {});
}

// ------------------------------------------------------------------ 1) iptal yarisi
test('iptal: süreç ölürken basılan ilerleme/birleştirme satırları durumu "iptal"in üstüne yazamaz (hata olmaz)', async () => {
  for (let tur = 1; tur <= 6; tur++) {
    fs.rmSync(ortam.dosyalar.pid, { force: true });
    await gonder('/api/indir', { url: 'https://example.com/seli-' + tur });
    const is = await kadarBekle(async () => (await isleriAl()).find((i) => i.durum === 'indiriliyor' && i.yuzde > 0));
    const pid = Number(await kadarBekle(() => fs.existsSync(ortam.dosyalar.pid) && fs.readFileSync(ortam.dosyalar.pid, 'utf8').trim()));
    assert.equal((await gonder('/api/iptal', { id: is.id })).durum, 200);
    // iptalden sonra ~1.2 sn boyunca (taskkill asenkron, süreç hâlâ satır basıyor) durum hiç "iptal"den başka olmamalı
    const bas = Date.now();
    while (Date.now() - bas < 1200) {
      const s = (await isleriAl()).find((i) => i.id === is.id);
      assert.equal(s.durum, 'iptal', 'tur ' + tur + ': durum "iptal" kalmalı, şu an: ' + s.durum + ' / ' + s.hata);
      await bekle(40);
    }
    await kadarBekle(() => surecOlu(pid), 8000);
    await bekle(300);                                   // close işleyicisinin çalışması için
    const son = (await isleriAl()).find((i) => i.id === is.id);
    assert.equal(son.durum, 'iptal', 'süreç kapandıktan sonra da "iptal" (tur ' + tur + ')');
    assert.equal(son.hata, '', 'iptal edilen işte hata metni olmamalı');
  }
  await gonder('/api/temizle', {});
});

test('iptal: kapanışta aktif sayacı doğru düşer — iptalden sonra sıradaki iş başlar, eşzamanlılık 2 kalır', async () => {
  try {
    const url = ['seli-a', 'seli-b', 'slow-c', 'slow-d'].map((x) => 'https://example.com/' + x).join(' ');
    assert.equal((await gonder('/api/indir', { url })).json.adet, 4);
    const calisan = async () => (await isleriAl()).filter((i) => ['bilgi-aliniyor', 'indiriliyor'].includes(i.durum));
    await kadarBekle(async () => (await calisan()).length === 2);
    const a = (await isleriAl()).find((i) => i.url.endsWith('seli-a'));
    await gonder('/api/iptal', { id: a.id });
    await kadarBekle(async () => (await isleriAl()).find((i) => i.id === a.id && i.durum === 'iptal'));
    // sıradaki (slow-c) devralmalı; en çok 2 iş çalışmalı
    await kadarBekle(async () => (await isleriAl()).find((i) => i.url.endsWith('slow-c') && i.durum === 'indiriliyor'));
    await bekle(400);
    assert.equal((await calisan()).length, 2, 'iptal sonrası tam 2 iş çalışmalı (sayaç ne eksik ne fazla)');
    assert.equal((await isleriAl()).find((i) => i.url.endsWith('slow-d')).durum, 'bekliyor');
  } finally { await hepsiniKapat(); }
});

// ------------------------------------------------------------------ 2) uzanti beyaz listesi
const TS_GERCEK = (() => { const b = Buffer.alloc(188 * 3, 0); b[0] = 0x47; b[188] = 0x47; b[376] = 0x47; return b; })();

test('uzantı listesi: yt-dlp tek dosya formatları (.flv .m4v .3gp .ts .ogv .ogg .aac .flac) oynatılır/gösterilir/silinir/sunulur', async () => {
  const klasor = ortam.klasor;
  const medya = ['yeni.flv', 'a.m4v', 'b.3gp', 'c.ogv', 'd.ogg', 'e.aac', 'f.flac', 'g.ts'];
  for (const ad of medya) fs.writeFileSync(path.join(klasor, ad), ad === 'g.ts' ? TS_GERCEK : Buffer.alloc(2048, 3));
  fs.writeFileSync(path.join(klasor, 'kaynak.ts'), 'export const deger: number = 1;\nexport default deger;\n');   // TypeScript kaynağı
  const kotu = ['kotu.exe', 'kotu.bat', 'kotu.cmd', 'kotu.ps1', 'kotu.js', 'kotu.html', 'kotu.lnk', 'kotu.txt'];
  for (const ad of kotu) fs.writeFileSync(path.join(klasor, ad), 'x');
  try {
    for (const ad of medya) assert.ok(m.guvenliDosya(ad), ad + ' kabul edilmeli');
    for (const ad of [...kotu, 'kaynak.ts']) assert.equal(m.guvenliDosya(ad), null, ad + ' reddedilmeli');

    const liste = (await al('/api/durum')).json.dosyalar.map((d) => d.ad);
    for (const ad of medya) assert.ok(liste.includes(ad), ad + ' listede olmalı');
    for (const ad of [...kotu, 'kaynak.ts']) assert.ok(!liste.includes(ad), ad + ' listede olmamalı');

    ac.length = 0;
    for (const ad of medya) assert.equal((await gonder('/api/oynat', { dosya: ad })).durum, 200, ad + ' Oynat');
    assert.equal(ac.length, medya.length);
    assert.deepEqual(ac.map((x) => x[1]), medya.map(() => false));
    ac.length = 0;
    assert.equal((await gonder('/api/klasor', { dosya: 'yeni.flv' })).durum, 200);
    assert.equal(ac.length, 1);
    assert.equal(ac[0][1], true, 'Klasörde göster dosyayı seçmeli (yalnız klasörü açmamalı)');
    assert.equal(path.basename(ac[0][0]), 'yeni.flv');
    for (const ad of [...kotu, 'kaynak.ts']) assert.equal((await gonder('/api/oynat', { dosya: ad })).durum, 404, ad + ' Oynat 404');

    const cerez = { Cookie: m.CEREZ_AD + '=' + m.jeton() };
    const tipler = { 'yeni.flv': 'video/x-flv', 'a.m4v': 'video/x-m4v', 'b.3gp': 'video/3gpp', 'g.ts': 'video/mp2t', 'f.flac': 'audio/flac', 'e.aac': 'audio/aac', 'd.ogg': 'audio/ogg' };
    for (const [ad, tip] of Object.entries(tipler)) {
      const r = await istek('GET', '/dosya/' + encodeURIComponent(ad), { basliklar: cerez });
      assert.equal(r.durum, 200, ad);
      assert.equal(r.basliklar['content-type'], tip);
    }
    assert.equal((await istek('GET', '/dosya/kaynak.ts', { basliklar: cerez })).durum, 404);

    assert.equal((await gonder('/api/sil', { dosya: 'yeni.flv' })).durum, 200);
    assert.ok(!fs.existsSync(path.join(klasor, 'yeni.flv')));
    assert.equal((await gonder('/api/sil', { dosya: 'kaynak.ts' })).durum, 404);
    assert.ok(fs.existsSync(path.join(klasor, 'kaynak.ts')), 'TypeScript dosyası silinmemeli');
    assert.equal((await gonder('/api/sil', { dosya: 'kotu.exe' })).durum, 404);
    assert.ok(fs.existsSync(path.join(klasor, 'kotu.exe')));
  } finally {
    for (const f of fs.readdirSync(klasor)) { try { fs.rmSync(path.join(klasor, f), { recursive: true, force: true }); } catch { /* acik */ } }
  }
});

test('.ts içerik denetimi: MPEG-TS sync baytı (0x47, 188 bayt arayla) yoksa video sayılmaz; başka uzantılara dokunmaz', () => {
  const yaz = (ad, ic) => { const y = path.join(ortam.klasor, ad); fs.writeFileSync(y, ic); return y; };
  try {
    assert.ok(m.guvenliDosya(path.basename(yaz('gercek.ts', TS_GERCEK))));
    // "Get..." ile başlayan TypeScript: ilk bayt 0x47 ama 188. baytta sync yok
    assert.equal(m.guvenliDosya(path.basename(yaz('get.ts', Buffer.from('Get' + ' value'.repeat(100))))), null);
    assert.equal(m.guvenliDosya(path.basename(yaz('bos.ts', Buffer.alloc(0)))), null);
    assert.ok(m.guvenliDosya(path.basename(yaz('tek.mp4', Buffer.alloc(10, 1)))), '.mp4 içerik denetimine takılmaz');
  } finally {
    for (const f of ['gercek.ts', 'get.ts', 'bos.ts', 'tek.mp4']) fs.rmSync(path.join(ortam.klasor, f), { force: true });
  }
});

// ------------------------------------------------------------------ 3) spawn hatasinda tek bitis
test('spawn hiç başlamazsa iş YALNIZ BİR KEZ biter: eşzamanlılık sınırı aşılmaz, gerçek hata mesajı korunur', async () => {
  const YT = m.durum().YT;
  const asil = Object.getOwnPropertyDescriptor(YT, 'cmd');
  try {
    await gonder('/api/indir', { url: 'https://example.com/slow-b' });
    await kadarBekle(async () => (await isleriAl()).find((i) => i.url.endsWith('slow-b') && i.durum === 'indiriliyor'));
    // sıradaki 2. okuma (indirme sürecinin spawn'ı) var olmayan komut olsun; bilgi alma (1. okuma) çalışır
    let okuma = 0;
    Object.defineProperty(YT, 'cmd', { configurable: true, get() { okuma++; return okuma === 2 ? 'olmayan-yt-dlp-komutu-xyz' : asil.value; } });
    const url = ['bozuk-a', 'slow-c', 'slow-d'].map((x) => 'https://example.com/' + x).join(' ');
    assert.equal((await gonder('/api/indir', { url })).json.adet, 3);
    const a = await kadarBekle(async () => (await isleriAl()).find((i) => i.url.endsWith('bozuk-a') && i.durum === 'hata'));
    assert.ok(a.hata && !/kodu ile çıktı|-4058/.test(a.hata), 'gerçek spawn hatası "yt-dlp -4058 kodu" ile ezilmemeli: ' + a.hata);
    await bekle(500);                                    // ikinci (hatalı) isBitti varsa sıradaki iş de başlamış olurdu
    const son = await isleriAl();
    const calisan = son.filter((i) => ['bilgi-aliniyor', 'indiriliyor'].includes(i.durum));
    assert.equal(calisan.length, 2, 'en çok 2 indirme eşzamanlı çalışmalı, şu an: ' + calisan.map((i) => i.url).join(', '));
    assert.equal(son.find((i) => i.url.endsWith('slow-d')).durum, 'bekliyor', 'sınır aşılmamalı: 4. iş hâlâ sırada');
  } finally {
    Object.defineProperty(YT, 'cmd', asil);
    await hepsiniKapat();
  }
});

// ------------------------------------------------------------------ 4) panel: eski kopya tanima
function sahteSunucu(cevap) {
  const s = http.createServer((req, res) => cevap(req, res));
  return new Promise((coz) => s.listen(0, '127.0.0.1', () => coz(s)));
}
const kapatSunucu = (s) => new Promise((coz) => { s.close(() => coz()); if (s.closeAllConnections) s.closeAllConnections(); });

test('panel: indirici portunda KİM var ayırt edilir — eski korumasız kopya "çalışıyor" sayılmaz, açılmaz', async () => {
  const p = await sahteSunucu((req, res) => {                  // ESKİ kopya: jetonsuz /api/durum 200 + {isler, ayar}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ isler: [], ayar: { klasor: 'x', kalite: 'en-iyi' }, dosyalar: [] }));
  });
  const indPort = p.address().port;
  let sunucu = p;
  const o = panelYardim.geciciOrtam('indirici-tani');
  const panel = await panelYardim.panelBaslat(o, { env: { INDIRICI_PORT: String(indPort) } });
  const c = panel.istemci;
  try {
    // eski kopya
    let oz = (await c.get('/api/ozellikler')).json;
    assert.equal(oz.indirici.calisiyor, false, 'eski kopya "çalışıyor" görünmemeli');
    assert.deepEqual(Object.keys(oz.indirici).sort(), ['calisiyor', 'port', 'var']);
    let b = await c.post('/api/indirici/baslat');
    assert.equal(b.durum, 409);
    assert.equal(b.json.kod, 'indirici_eski');
    assert.match(b.json.hata, /ESKİ/);
    assert.ok(b.json.cozum, 'çözüm cümlesi olmalı');

    // başka bir program
    await kapatSunucu(sunucu);
    sunucu = http.createServer((req, res) => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('baska'); });
    await new Promise((coz) => sunucu.listen(indPort, '127.0.0.1', coz));
    oz = (await c.get('/api/ozellikler')).json;
    assert.equal(oz.indirici.calisiyor, false);
    b = await c.post('/api/indirici/baslat');
    assert.equal(b.durum, 409);
    assert.equal(b.json.kod, 'indirici_port');

    // port kapalı: başlatma bu testte kapalı (PANEL_INDIRICI_KAPALI) → eski davranış, 500
    await kapatSunucu(sunucu);
    sunucu = null;
    oz = (await c.get('/api/ozellikler')).json;
    assert.equal(oz.indirici.calisiyor, false);
    assert.equal((await c.post('/api/indirici/baslat')).durum, 500);

    // GERÇEK yeni indirici (jetonsuz /api/durum → 403 token): çalışıyor, başlat ok
    await m.kapat();
    const yeni = await m.baslat({ port: indPort });
    assert.equal(yeni.address().port, indPort);
    oz = (await c.get('/api/ozellikler')).json;
    assert.equal(oz.indirici.calisiyor, true, 'bu projenin indiricisi çalışıyor görünmeli');
    b = await c.post('/api/indirici/baslat');
    assert.equal(b.durum, 200);
    assert.equal(b.json.port, indPort);
  } finally {
    if (sunucu) await kapatSunucu(sunucu);
    await panel.kapat();
    o.temizle();
  }
});
