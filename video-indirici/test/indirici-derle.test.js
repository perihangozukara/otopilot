'use strict';
// arac/kesfet-derle.cjs: gercek kesfet-veri.json'a dokunmadan (INDIRICI_KESFET_DOSYASI) sentetik girdiyle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'indirici-derle-'));
test.after(() => fs.rmSync(gecici, { recursive: true, force: true }));
const arac = path.join(__dirname, '..', 'arac', 'kesfet-derle.cjs');
const hedef = path.join(gecici, 'kesfet.json');
const calistir = (...argv) => spawnSync(process.execPath, [arac, ...argv], {
  encoding: 'utf8', env: { ...process.env, INDIRICI_KESFET_DOSYASI: hedef },
});

test('argümansız çalışırsa mevcut listeyi ezmez, exit 2', () => {
  fs.writeFileSync(hedef, '{"adet":99}');
  const r = calistir();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /✗ Girdi dosyası verilmedi/);
  assert.equal(fs.readFileSync(hedef, 'utf8'), '{"adet":99}');
  assert.equal(calistir(path.join(gecici, 'yok.json')).status, 2);
});

test('sentetik vidIQ çıktısından liste derler; geçersiz video kimlikleri elenir; boş sonuç yazmaz', () => {
  const ig = path.join(gecici, 'ig.json');
  const yt = path.join(gecici, 'yt.json');
  fs.writeFileSync(ig, ['## TikTok', '**@k1** — "Başlık"', '  4M views (30x their median of 1K) · 100 followers · 15s',
    '  https://www.tiktok.com/@k1/video/123'].join('\n'));
  fs.writeFileSync(yt, JSON.stringify({ videos: [
    { videoId: 'abcdefghijk', videoTitle: 'İyi', viewCount: 5000000, channelTitle: 'K' },
    { videoId: 'bad id"><x', videoTitle: 'Kötü', viewCount: 9000000 },
  ] }));
  const r = calistir(ig, yt);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(fs.readFileSync(hedef, 'utf8'));
  assert.equal(j.adet, 2);
  assert.deepEqual(j.videolar.map((v) => v.platform), ['youtube', 'tiktok']);
  assert.equal(fs.readdirSync(gecici).filter((a) => a.endsWith('.tmp')).length, 0);

  const bos = path.join(gecici, 'bos.json');
  fs.writeFileSync(bos, '{"videos":[]}');
  const once = fs.readFileSync(hedef, 'utf8');
  const r2 = calistir(bos);
  assert.equal(r2.status, 4);
  assert.equal(fs.readFileSync(hedef, 'utf8'), once, 'boş sonuç mevcut listeyi ezmemeli');
});
