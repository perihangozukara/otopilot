/*
 * shorts-kes.cjs — bitmis uzun videodan dikey (9:16) Shorts keser.
 * Teknik: bulanik arka plan + ortada tam 16:9 kare (gomulu altyazilar korunur).
 *
 * Kullanim: node shorts-kes.cjs <is-slug> <kesitler.json>
 * kesitler.json: [{ "ad": "giyotin", "bas": 12.5, "sure": 52 }, ...]   (saniye)
 *   (kesit-bul.cjs <is> --otomatik <cikti> bu dosyayi paragraf gruplarindan kendisi uretir)
 * Cikti: uretim/<is>/Shorts/01-<ad>.mp4 ...
 *
 * DAYANIKLILIK: her kesit kendi try/catch'inde; biri patlarsa (ya da bas+sure videoyu asarsa / sayi
 * degilse) hata satiri yazilir, KALANLAR uretilmeye devam eder; basarisiz varsa cikis kodu 1.
 * Cikti .part'a yazilip yeniden adlandirilir (yarim Shorts kalmaz).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ortak = require('./lib/ortak');

const SHORTS_MAX_SN = 180;      // Ekim 2024'te 45 -> 180 sn (ortak.formatSiniri('short').teknikMaxSn)

async function main() {
  const { konum } = ortak.argumanCoz(process.argv.slice(2), { deger: [] });
  const [JOB, KESIT_DOSYA] = konum;
  if (!JOB || !KESIT_DOSYA)
    throw new ortak.OrtakHata('girdi', 'Kullanım: node shorts-kes.cjs <iş> <kesitler.json>', { cikis: ortak.CIKIS.GIRDI,
      cozum: 'kesitler.json: [{"ad":"giris","bas":12.5,"sure":52}, ...] ya da önce: node kesit-bul.cjs <iş> --otomatik <çıktı.json>' });
  const BASE = ortak.isDizin(JOB);
  const KAYNAK = path.join(BASE, 'Videos', JOB + '.mp4');
  const CIKTI = path.join(BASE, 'Shorts');
  if (!fs.existsSync(KAYNAK))
    throw new ortak.OrtakHata('video_yok', 'Kaynak video yok: Videos/' + JOB + '.mp4', { cikis: ortak.CIKIS.GIRDI, cozum: 'Önce videoyu kur (node video-yap.js ' + JOB + ').' });
  if (!fs.existsSync(KESIT_DOSYA))
    throw new ortak.OrtakHata('kesit_yok', 'Kesit dosyası yok: ' + KESIT_DOSYA, { cikis: ortak.CIKIS.GIRDI });
  const kesitler = ortak.jsonOku(KESIT_DOSYA, null);
  if (!Array.isArray(kesitler) || !kesitler.length)
    throw new ortak.OrtakHata('kesit_gecersiz', 'Kesit dosyası boş ya da liste değil: ' + path.basename(KESIT_DOSYA), { cikis: ortak.CIKIS.GIRDI });

  ortak.kilitAl(JOB, 'shorts-kes');
  fs.mkdirSync(CIKTI, { recursive: true });
  ortak.partTemizle(CIKTI);
  const F = require('./lib/render-ffmpeg');
  const kaynakBilgi = F.bilgi(KAYNAK);
  const kaynakSn = kaynakBilgi.sure || 0;
  const sesVar = kaynakBilgi.sesVar;

  const FILTRE =
    '[0:v]split=2[bg][fg];' +
    '[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:12,eq=brightness=-0.18:saturation=0.85[bgb];' +
    '[fg]scale=1080:-2[fgs];' +
    '[bgb][fgs]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]';

  let uretilen = 0; const basarisiz = [];
  for (let i = 0; i < kesitler.length; i++) {
    const k = kesitler[i] || {};
    const no = String(i + 1).padStart(2, '0');
    const ad = no + '-' + (ortak.slugla(String(k.ad || 'kesit'), { maks: 40 }) || 'kesit') + '.mp4';
    const hedef = path.join(CIKTI, ad);
    try {
      const bas = Number(k.bas), sure = Number(k.sure);
      if (!Number.isFinite(bas) || bas < 0) throw new Error('"bas" geçerli bir saniye değeri değil (' + k.bas + ')');
      if (!Number.isFinite(sure) || sure <= 0) throw new Error('"sure" geçerli bir saniye değeri değil (' + k.sure + ')');
      if (kaynakSn && bas >= kaynakSn) throw new Error('başlangıç (' + bas + ' sn) videonun süresini (' + kaynakSn.toFixed(1) + ' sn) aşıyor');
      if (kaynakSn && bas + sure > kaynakSn + 0.05) throw new Error('bas+sure (' + (bas + sure).toFixed(1) + ' sn) videonun süresini (' + kaynakSn.toFixed(1) + ' sn) aşıyor');
      if (sure > SHORTS_MAX_SN) ortak.uyari('Kesit ' + no + ' ' + sure.toFixed(0) + ' sn: Shorts sınırı ' + SHORTS_MAX_SN + ' sn.');
      const fade = Math.min(0.4, sure / 3);
      const sonSt = (sure - fade).toFixed(2);
      console.log('[' + (i + 1) + '/' + kesitler.length + '] ' + ad + ' (' + bas + 's + ' + sure + 's) kesiliyor...');
      await F.uret(hedef, (K) => {
        const a = ['-ss', String(bas), '-t', String(sure), '-i', KAYNAK,
          '-filter_complex', FILTRE + `;[v]fade=t=in:st=0:d=${Math.min(0.3, fade).toFixed(2)},fade=t=out:st=${sonSt}:d=${fade.toFixed(2)}[vo]`,
          '-map', '[vo]'];
        if (sesVar) a.push('-map', '0:a', '-af', `afade=t=in:st=0:d=${Math.min(0.3, fade).toFixed(2)},afade=t=out:st=${sonSt}:d=${fade.toFixed(2)}`);
        a.push(...K.ara, '-r', '30', '-pix_fmt', 'yuv420p');
        if (sesVar) a.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000');
        a.push('-movflags', '+faststart');
        return a;
      }, { etiket: 'kesit ' + no, zamanAsimiMs: F.zamanAsimi(sure, 20, 120) });
      const mb = (fs.statSync(hedef).size / 1048576).toFixed(1);
      console.log('  tamam, ' + mb + ' MB');
      uretilen++;
      ortak.ilerleme('kesit', 100 * (i + 1) / kesitler.length, { n: i + 1, toplam: kesitler.length });
    } catch (e) {
      const ilk = String(e && e.message || e).split('\n')[0];
      console.error('✗ Kesit ' + no + ' (' + String(k.ad || '?') + ') üretilemedi: ' + ilk);
      basarisiz.push({ no: i + 1, ad: k.ad || null, neden: ilk });
    }
  }
  console.log('\nShorts klasörü: ' + CIKTI + ' (' + uretilen + ' kesit' + (basarisiz.length ? ', ' + basarisiz.length + ' başarısız' : '') + ')');
  ortak.sonuc({ uretilen, basarisiz: basarisiz.length, klasor: 'Shorts' });
  if (basarisiz.length) process.exitCode = ortak.CIKIS.GENEL;
}

if (require.main === module) main().catch(ortak.bitir);
module.exports = { main };
