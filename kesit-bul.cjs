/*
 * kesit-bul.cjs — uzun videodan Shorts kesit araliklari uretir (shorts-kes.cjs'in girdisi).
 *
 * ESKI MOD (paragraf secimi + altyazi hizalama):
 *   node kesit-bul.cjs <is-slug> <secim.json> <cikti-kesitler.json>
 *   secim.json: [{ "ad":"giyotin", "bas":0, "son":1 }, ...]  (paragraf indeksleri, dahil)
 *   Yontem: SRT kelime akisi ile senaryo kelime akisini hizalar.
 *
 * OTOMATIK MOD (panel "Bu videodan Shorts cikar"):
 *   node kesit-bul.cjs <is-slug> --otomatik <cikti-kesitler.json> [--adet 3] [--min 30] [--max 55]
 *   Voice/zamanlama.json'daki paragraf araliklarindan (SRT hizalamasi GEREKMEZ) paragraf gruplari secer:
 *   videoya yayilmis, ust uste binmeyen, her biri min-max sn arasi kesitler. Cikti:
 *   [{ ad, bas, sure, paragraflar:[a,b] }]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ortak = require('./lib/ortak');

const SHORTS_MAX_SN = 180;

// Anlatimin videoda basladigi an: render-sonuc.json (kesin) ya da konu.json'dan hesap
function anlatimBaslangic(is, BASE) {
  const r = ortak.jsonOku(path.join(BASE, 'render-sonuc.json'), null);
  if (r && typeof r.anlatimBaslangicSn === 'number') return r.anlatimBaslangicSn;
  const konu = ortak.konuEtkin(is);
  if (!konu) return 0;
  const cf = typeof konu.gecisSure === 'number' ? konu.gecisSure : (konu.dikey ? 0.4 : 0.8);
  const parcalar = [konu.geriSayim > 0 ? 5 : 0, konu.intro > 0 ? konu.intro : 0, (konu.konuKarti > 0 && konu.baslik_en) ? konu.konuKarti : 0].filter(x => x > 0);
  return Math.max(0, parcalar.reduce((a, b) => a + b, 0) - parcalar.length * cf);
}

function paragraflariOku(BASE) {
  const j = ortak.jsonOku(path.join(BASE, 'paragraflar.json'), null);
  if (Array.isArray(j) && j.length) return j.map(String);
  let metin = '';
  try { metin = fs.readFileSync(path.join(BASE, 'Voice', 'SESLENDIRME-TAM-METIN.txt'), 'utf8'); } catch (e) { /* yok */ }
  const p = ortak.paragraflaraBol(metin);
  if (!p.length)
    throw new ortak.OrtakHata('senaryo_yok', 'Paragraf listesi yok (paragraflar.json ve seslendirme metni boş).', { cikis: ortak.CIKIS.GIRDI,
      cozum: 'Önce videoyu kur: node video-yap.js <iş> paragraflar.json dosyasını kendisi yazar.' });
  return p;
}

// ----------------------------------------------------------------------------------- OTOMATIK
function otomatik(IS, BASE, cikti, adet, min, max) {
  const z = ortak.jsonOku(path.join(BASE, 'Voice', 'zamanlama.json'), null);
  if (!z || !Array.isArray(z.paragraflar) || !z.paragraflar.length)
    throw new ortak.OrtakHata('zamanlama_yok', 'Voice/zamanlama.json yok: paragraf zamanları bilinmiyor.', { cikis: ortak.CIKIS.YETERSIZ,
      cozum: 'Seslendirmeyi (yeniden) yap: node seslendir.js ' + IS + ' --yeniden; sonra videoyu kur.' });
  const kanon = paragraflariOku(BASE);
  const P = z.paragraflar.length;
  const sonuc = ortak.jsonOku(path.join(BASE, 'render-sonuc.json'), null);
  const kayma = anlatimBaslangic(IS, BASE);
  // paragraf basi (VIDEO saniyesi): render-sonuc kesinse onu, degilse zamanlama + anlatim baslangici
  const bas = z.paragraflar.map((p, i) => (sonuc && Array.isArray(sonuc.paragrafBaslangic) && sonuc.paragrafBaslangic.length === P)
    ? sonuc.paragrafBaslangic[i] : kayma + Number(p.baslangicSn || 0));
  const sure = z.paragraflar.map(p => Number(p.sureSn || 0));
  const videoSn = (sonuc && sonuc.sureSn) || (bas[P - 1] + sure[P - 1] + 1);
  if (max > SHORTS_MAX_SN) max = SHORTS_MAX_SN;
  if (min > max) min = Math.max(5, max - 5);
  const bitis = i => bas[i] + sure[i];

  const kesitler = [];
  let sonPar = -1;
  for (let n = 0; n < adet; n++) {
    let a = Math.max(Math.round(n * P / adet), sonPar + 1);
    if (a >= P) break;
    let e = a;
    while (bitis(e) - bas[a] < min && e < P - 1) e++;
    if (bitis(e) - bas[a] > max && e > a && bitis(e - 1) - bas[a] >= 0.6 * min) e--;      // max'i asma
    const bs = Math.max(0, bas[a] - 0.25);
    const sn = Math.min(bitis(e) + 0.45, videoSn) - bs;
    if (sn <= 1) break;
    const ilkKelimeler = String(kanon[a] || '').split(/\s+/).slice(0, 4).join(' ');
    kesitler.push({ ad: 'kesit-' + String(n + 1).padStart(2, '0') + '-' + (ortak.slugla(ilkKelimeler, { maks: 28 }) || 'bolum'),
      bas: +bs.toFixed(2), sure: +sn.toFixed(2), paragraflar: [a, e] });
    sonPar = e;
    if (sn > max + 5) ortak.uyari('Kesit ' + (n + 1) + ' ' + sn.toFixed(0) + ' sn (hedef en çok ' + max + ' sn): paragraf tek başına uzun.');
  }
  if (!kesitler.length)
    throw new ortak.OrtakHata('kesit_yok', 'Uygun kesit bulunamadı (video çok kısa ya da paragraflar tek parça).', { cikis: ortak.CIKIS.YETERSIZ });
  if (kesitler.length < adet) ortak.uyari('İstenen ' + adet + ' kesitten ' + kesitler.length + ' tanesi çıkarılabildi.');
  ortak.atomikJsonYaz(cikti, kesitler);
  for (const k of kesitler)
    console.log(k.ad.padEnd(34) + ' par ' + k.paragraflar[0] + '-' + k.paragraflar[1] + '  ' + k.bas.toFixed(1) + ' sn +' + k.sure.toFixed(1) + ' sn');
  console.log('kesitler yazıldı (paragraf zamanlamasından): ' + cikti);
  ortak.sonuc({ kesit: kesitler.length, dosya: cikti });
}

// -------------------------------------------------------------------------------------- ESKI
function eskiMod(IS, BASE, SECIM, CIKTI) {
  const paragraflar = paragraflariOku(BASE);
  // altyazi.srt (iş kökü) final videonun SRT'sidir: intro/geri sayim kaymasi ZATEN icinde.
  // Yalniz eski Voice SRT (kaymasiz) kullanilirsa anlatim baslangici eklenir.
  let srtYol = path.join(BASE, 'altyazi.srt'), kaydirma = 0;
  if (!fs.existsSync(srtYol)) { srtYol = path.join(BASE, 'Voice', 'altyazi.srt'); kaydirma = anlatimBaslangic(IS, BASE); }
  if (!fs.existsSync(srtYol))
    throw new ortak.OrtakHata('srt_yok', 'Altyazı dosyası yok (altyazi.srt).', { cikis: ortak.CIKIS.GIRDI, cozum: 'Önce videoyu kur: node video-yap.js ' + IS });
  const srt = fs.readFileSync(srtYol, 'utf8').replace(/\r/g, '');
  const zaman = (t) => { const m = /(\d+):(\d+):(\d+),(\d+)/.exec(t); return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000; };
  // Unicode harf/rakam: Turkce ve diger diller de hizalanir
  const normal = (x) => x.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

  // SRT -> kelime akisi (her kelime hangi cue'dan)
  const cueler = [];
  for (const blok of srt.split(/\n\n+/)) {
    const s = blok.trim().split('\n'); if (s.length < 3) continue;
    const z = /(\S+) --> (\S+)/.exec(s[1]); if (!z) continue;
    cueler.push({ bas: zaman(z[1]) + kaydirma, son: zaman(z[2]) + kaydirma, metin: s.slice(2).join(' ') });
  }
  const srtKelime = []; // {k, cue}
  cueler.forEach((c, ci) => normal(c.metin).forEach((k) => srtKelime.push({ k, cue: ci })));

  // senaryo -> kelime akisi (her kelime hangi paragraftan)
  const senKelime = [];
  paragraflar.forEach((p, pi) => normal(p).forEach((k) => senKelime.push({ k, par: pi })));
  if (!senKelime.length || !srtKelime.length)
    throw new ortak.OrtakHata('hizalama', 'Altyazı ya da senaryo kelimesi yok; hizalanamadı.', { cikis: ortak.CIKIS.YETERSIZ });

  // hizalama: ayni metin oldugu icin indeksler buyuk oranda ortusur; sapmayi pencereyle duzelt
  function cueIndeksi(senIdx) {
    const hedef = senKelime[senIdx].k;
    const oran = srtKelime.length / senKelime.length;
    const tahmin = Math.round(senIdx * oran);
    // tahmin etrafinda +-120 kelimelik pencerede, 3 kelimelik dizi eslesmesi ara
    const dizi = senKelime.slice(senIdx, senIdx + 3).map((x) => x.k).join(' ');
    for (let d = 0; d <= 120; d++) {
      for (const j of [tahmin - d, tahmin + d]) {
        if (j < 0 || j + 2 >= srtKelime.length) continue;
        const aday = srtKelime.slice(j, j + 3).map((x) => x.k).join(' ');
        if (aday === dizi) return srtKelime[j].cue;
      }
    }
    // tek kelime esleme (son care)
    for (let d = 0; d <= 60; d++) for (const j of [tahmin - d, tahmin + d])
      if (j >= 0 && j < srtKelime.length && srtKelime[j].k === hedef) return srtKelime[j].cue;
    throw new ortak.OrtakHata('hizalama', 'Kelime hizalanamadı: ' + hedef + ' (senaryo kelime #' + senIdx + ')', { cikis: ortak.CIKIS.YETERSIZ,
      cozum: 'Altyazı başka dilde olabilir. Bunun yerine otomatik modu kullan: node kesit-bul.cjs ' + IS + ' --otomatik <çıktı.json>' });
  }

  const parBas = [], parSon = [];
  senKelime.forEach((x, i) => { if (parBas[x.par] === undefined) parBas[x.par] = i; parSon[x.par] = i; });

  const secim = ortak.jsonOku(SECIM, null);
  if (!Array.isArray(secim) || !secim.length)
    throw new ortak.OrtakHata('secim_gecersiz', 'Seçim dosyası boş ya da liste değil: ' + SECIM, { cikis: ortak.CIKIS.GIRDI });
  const kesitler = [];
  for (const s of secim) {
    if (parBas[s.bas] === undefined || parSon[s.son] === undefined)
      throw new ortak.OrtakHata('secim_gecersiz', 'Paragraf indeksi geçersiz: ' + s.bas + '-' + s.son + ' (0..' + (paragraflar.length - 1) + ')', { cikis: ortak.CIKIS.GIRDI });
    const c1 = cueIndeksi(parBas[s.bas]);
    const c2 = cueIndeksi(parSon[s.son]);
    const bas = Math.max(0, cueler[c1].bas - 0.25);
    const son = cueler[c2].son + 0.45;
    kesitler.push({ ad: s.ad, bas: +bas.toFixed(2), sure: +(son - bas).toFixed(2) });
    console.log(`${String(s.ad).padEnd(22)} par ${s.bas}-${s.son}  ${bas.toFixed(1)}s -> ${son.toFixed(1)}s  (${(son - bas).toFixed(1)} sn)  | "${cueler[c1].metin.slice(0, 28)}…${cueler[c2].metin.slice(-22)}"`);
  }
  ortak.atomikJsonYaz(CIKTI, kesitler);
  console.log('kesitler yazıldı (' + (kaydirma ? 'Voice SRT +' + kaydirma.toFixed(1) + 's' : 'final SRT') + ')');
  ortak.sonuc({ kesit: kesitler.length, dosya: CIKTI });
}

async function main() {
  const { konum, bayrak } = ortak.argumanCoz(process.argv.slice(2), { deger: ['otomatik', 'adet', 'min', 'max'] });
  const IS = konum[0];
  if (!IS)
    throw new ortak.OrtakHata('girdi', 'Kullanım: node kesit-bul.cjs <iş> --otomatik <çıktı.json> [--adet 3] [--min 30] [--max 55]   veya   <iş> <secim.json> <çıktı.json>',
      { cikis: ortak.CIKIS.GIRDI });
  const BASE = ortak.isDizin(IS);
  if (!fs.existsSync(BASE)) throw new ortak.OrtakHata('is_yok', 'İş bulunamadı: ' + IS, { cikis: ortak.CIKIS.GIRDI });
  if (bayrak.otomatik !== undefined) {
    const cikti = bayrak.otomatik === true ? path.join(BASE, 'kesitler.json') : String(bayrak.otomatik);
    const sayi = (v, v0, a, b) => { const n = Number(v === undefined || v === true ? v0 : v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : v0; };
    return otomatik(IS, BASE, cikti, Math.round(sayi(bayrak.adet, 3, 1, 12)), sayi(bayrak.min, 30, 5, 170), sayi(bayrak.max, 55, 10, SHORTS_MAX_SN));
  }
  const [, SECIM, CIKTI] = konum;
  if (!SECIM || !CIKTI)
    throw new ortak.OrtakHata('girdi', 'Kullanım: node kesit-bul.cjs <iş> <secim.json> <çıktı.json>  (ya da --otomatik <çıktı.json>)', { cikis: ortak.CIKIS.GIRDI });
  return eskiMod(IS, BASE, SECIM, CIKTI);
}

if (require.main === module) main().catch(ortak.bitir);
module.exports = { main, otomatik, anlatimBaslangic };
