/*
 * Video Indirici arayuzu.
 * Guvenlik: hicbir yerde innerHTML / satir ici onclick YOK. Tum metinler textContent ile,
 * tum olaylar addEventListener ile baglanir; dosya adi / baslik / link ne icerirse icersin
 * sayfaya kod giremez (sunucu ayrica script-src 'self' CSP'si gonderir).
 */
'use strict';

const $ = (s) => document.querySelector(s);
const JETON = (document.querySelector('meta[name="panel-token"]') || {}).content || '';
const isler = new Map();      // id -> sunucudan gelen is
const kartlar = new Map();    // id -> {kart, imza, refs}
let kalite = 'en-iyi';

/* ------------------------------------------------- DOM yardimcilari */
const SVG_NS = 'http://www.w3.org/2000/svg';

/* el('div', {sinif:'x', metin:'...', title:'...', onclick:fn}, ...cocuklar) */
function el(etiket, ozellik, ...cocuklar) {
  const e = document.createElement(etiket);
  if (ozellik) {
    for (const [k, v] of Object.entries(ozellik)) {
      if (v == null || v === false) continue;
      if (k === 'sinif') e.className = v;
      else if (k === 'metin') e.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of cocuklar.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

function ikon(ad) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', 'ik');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVG_NS, 'use');
  u.setAttribute('href', '#i-' + ad);
  s.append(u);
  return s;
}

function ikonDugme(ad, baslik, tehlike, tikla, hedef) {
  const tam = hedef ? baslik + ': ' + hedef : baslik;
  return el('button', { type: 'button', sinif: 'ikon' + (tehlike ? ' tehlike' : ''), title: baslik, 'aria-label': tam, onclick: tikla }, ikon(ad));
}

function nokta() { return el('span', { sinif: 'nokta', 'aria-hidden': 'true', metin: '·' }); }

/* yalniz http(s) baglantisi dondurur: betik / veri adresleri asla href ya da src olmaz */
function guvenliUrl(u, yalnizHttps) {
  const s = String(u || '');
  return (yalnizHttps ? /^https:\/\//i : /^https?:\/\//i).test(s) ? s : '';
}

/* ------------------------------------------------- yardimcilar */
function boyut(b) {
  if (!b || b < 0) return '';
  const bir = ['B', 'KB', 'MB', 'GB']; let i = 0; let s = b;
  while (s >= 1024 && i < bir.length - 1) { s /= 1024; i++; }
  return s.toFixed(s < 10 && i > 0 ? 1 : 0) + ' ' + bir[i];
}
function hizYazi(h) { return h > 0 ? boyut(h) + '/sn' : ''; }
function sureYazi(s) {
  s = Math.round(s || 0); if (!s) return '';
  const d = Math.floor(s / 60), k = s % 60;
  if (d >= 60) return Math.floor(d / 60) + ' sa ' + (d % 60) + ' dk';
  return d ? d + ':' + String(k).padStart(2, '0') : k + ' sn';
}
function tost(m) {
  const t = $('#tost'); t.textContent = m; t.classList.add('gorunur');
  clearTimeout(t._z); t._z = setTimeout(() => t.classList.remove('gorunur'), 3200);
}
function hataYazi(c) { return (c.hata || 'İşlem başarısız.') + (c.cozum ? ' ' + c.cozum : ''); }

function uyariGoster(metin, dugmeAd, dugmeTikla, hata) {
  const u = $('#uyari');
  u.className = 'uyari gorunur' + (hata ? ' hata' : '');
  u.replaceChildren(metin);
  if (dugmeAd) u.append(el('button', { type: 'button', sinif: 'dugme ikincil', onclick: dugmeTikla, metin: dugmeAd }));
}
function oturumBitti() {
  uyariGoster('Oturum süresi doldu ya da indirici yeniden başlatıldı. Sayfayı yenile.', 'Yenile', () => location.reload(), true);
}

async function api(yol, govde) {
  let c;
  try {
    c = await fetch(yol, govde !== undefined
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel-Token': JETON }, body: JSON.stringify(govde) }
      : { headers: { 'X-Panel-Token': JETON } });
  } catch {
    return { hata: 'İndiriciye ulaşılamadı. Pencere kapanmış olabilir; BASLAT.bat ile yeniden aç.', kod: 'ag' };
  }
  const j = await c.json().catch(() => ({}));
  if (c.status === 403 && j.kod === 'token') oturumBitti();
  if (!c.ok && !j.hata) j.hata = 'İşlem başarısız (' + c.status + ').';
  return j;
}

/* ------------------------------------------------- durum yazilari */
const DURUM_YAZI = {
  'bekliyor': 'sırada', 'bilgi-aliniyor': 'bilgi alınıyor…', 'indiriliyor': 'indiriliyor',
  'birlestiriliyor': 'birleştiriliyor…', 'sese-cevriliyor': 'MP3’e çevriliyor…',
  'isleniyor': 'işleniyor…', 'bitti': 'bitti', 'hata': 'hata', 'iptal': 'iptal edildi',
};
const CALISIYOR = ['bekliyor', 'bilgi-aliniyor', 'indiriliyor', 'birlestiriliyor', 'sese-cevriliyor', 'isleniyor'];

/* ------------------------------------------------- is cizimi */
function durumEkYazi(is) {
  if (is.durum === 'indiriliyor') {
    return [is.yuzde ? is.yuzde.toFixed(0) + '%' : '', hizYazi(is.hiz), is.kalan ? '~' + sureYazi(is.kalan) : ''].filter(Boolean).join(' · ');
  }
  return is.durum === 'bitti' && is.boyut ? boyut(is.boyut) : '';
}

function kapakBos() { return el('div', { sinif: 'kapak bos', 'aria-hidden': 'true' }, ikon('film')); }

function isKartiKur(is) {
  const calisiyor = CALISIYOR.includes(is.durum);
  const refs = {};
  const durumSinif = 'd-' + (is.durum === 'bitti' ? 'bitti' : is.durum === 'hata' ? 'hata' : is.durum === 'iptal' ? 'iptal' : calisiyor ? 'indiriliyor' : 'bekliyor');

  let kapak;
  if (guvenliUrl(is.kapak, true)) {
    kapak = el('img', { sinif: 'kapak', src: is.kapak, referrerpolicy: 'no-referrer', alt: '' });
    kapak.addEventListener('error', () => kapak.replaceWith(kapakBos()));
  } else kapak = kapakBos();

  const meta = el('div', { sinif: 'meta' }, el('span', { sinif: 'site', metin: is.site || '?' }));
  const ekle = (m) => { if (m) meta.append(nokta(), m); };
  ekle(is.kanal);
  ekle(is.sure ? sureYazi(is.sure) : '');
  if (is.kalite === 'mp3') ekle('MP3');
  else if (is.kalite === '2160') ekle('4K');
  else if (is.kalite !== 'en-iyi') ekle(is.kalite + 'p');
  meta.append(nokta(), el('span', { sinif: 'durum ' + durumSinif, metin: DURUM_YAZI[is.durum] || is.durum }));
  refs.ek = el('span', { metin: durumEkYazi(is) });
  refs.ekGrup = el('span', { sinif: 'ek-grup' }, nokta(), refs.ek);
  refs.ekGrup.hidden = !refs.ek.textContent;
  meta.append(refs.ekGrup);

  const orta = el('div', { sinif: 'orta' },
    el('div', { sinif: 'ad', title: is.baslik, metin: is.baslik }),
    meta);
  if (calisiyor) {
    refs.barI = el('i');
    refs.bar = el('div', { sinif: 'bar', role: 'progressbar', 'aria-label': 'İndirme ilerlemesi', 'aria-valuemin': 0, 'aria-valuemax': 100 }, refs.barI);
    orta.append(refs.bar);
  }
  if (is.durum === 'hata' && is.hata) orta.append(el('div', { sinif: 'hata-metin', role: 'alert', metin: is.hata }));

  const sag = el('div', { sinif: 'sag' });
  if (calisiyor) sag.append(ikonDugme('kapat', 'İptal', true, () => iptal(is.id), is.baslik));
  if (is.durum === 'hata' || is.durum === 'iptal') sag.append(ikonDugme('tekrar', 'Tekrar dene', false, () => tekrar(is.id), is.baslik));
  if (is.durum === 'bitti') {
    sag.append(
      ikonDugme('oynat', 'Oynat', false, () => oynatYol(is.id), is.baslik),
      ikonDugme('klasor', 'Klasörde göster', false, () => gosterYol(is.id), is.baslik));
  }

  const kart = el('div', { sinif: 'kart', id: 'is-' + is.id }, kapak, orta, sag);
  ilerlemeGuncelle(is, refs);
  return { kart, refs };
}

function ilerlemeGuncelle(is, r) {
  if (r.barI) r.barI.style.width = (is.yuzde || 0) + '%';
  if (r.bar) {
    r.bar.classList.toggle('belirsiz', !(is.yuzde > 0));
    r.bar.setAttribute('aria-valuenow', String(Math.round(is.yuzde || 0)));
  }
  r.ek.textContent = durumEkYazi(is);
  r.ekGrup.hidden = !r.ek.textContent;
}

function bosIsMesaji() {
  return el('div', { sinif: 'bos-mesaj', metin: 'Henüz bir şey indirmedin. Yukarıya link yapıştır.' });
}

function isCiz(is) {
  // yapi (durum, baslik, hata...) degistiyse karti yeniden kur; yalniz ilerleme degistiyse yerinde guncelle
  const imza = [is.durum, is.baslik, is.kanal, is.sure, is.kapak, is.hata, is.site, is.kalite, is.dosya].join('\u0001');
  const k = kartlar.get(is.id);
  if (k && k.imza === imza) { ilerlemeGuncelle(is, k.refs); return; }
  const yeni = isKartiKur(is);
  if (k) k.kart.replaceWith(yeni.kart);
  else {
    const kap = $('#isler');
    const bos = kap.querySelector('.bos-mesaj');
    if (bos) bos.remove();
    kap.prepend(yeni.kart);
  }
  kartlar.set(is.id, { kart: yeni.kart, imza, refs: yeni.refs });
}

function isSil(id) {
  const k = kartlar.get(id);
  if (k) k.kart.remove();
  kartlar.delete(id);
  isler.delete(id);
  if (!$('#isler').children.length) $('#isler').append(bosIsMesaji());
}

/* ------------------------------------------------- eylemler */
async function indir() {
  const url = $('#link').value.trim();
  if (!url) { tost('Önce bir link yapıştır'); $('#link').focus(); return; }
  $('#indir').disabled = true;
  const c = await api('/api/indir', { url, kalite, liste: $('#liste').checked });
  $('#indir').disabled = false;
  if (c.hata) { tost(hataYazi(c)); return; }
  $('#link').value = '';
  const ek = c.atlanan ? ' (' + c.atlanan + ' geçersiz link atlandı)' : '';
  tost((c.adet > 1 ? c.adet + ' video kuyruğa eklendi' : 'Kuyruğa eklendi') + ek);
}
async function yapistirIndir() {
  try {
    const m = await navigator.clipboard.readText();
    if (!m || !/^https?:\/\//i.test(m.trim())) { tost('Panoda link yok'); return; }
    $('#link').value = m.trim();
    indir();
  } catch { tost('Panoya erişemedim — elle yapıştır (Ctrl+V)'); $('#link').focus(); }
}
async function eylem(yol, govde) {
  const c = await api(yol, govde);
  if (c.hata) tost(hataYazi(c));
  return c;
}
function iptal(id) { return eylem('/api/iptal', { id }); }
function tekrar(id) { return eylem('/api/tekrar', { id }); }
function dosyaAdi(id) { const is = isler.get(id); return is && is.dosya ? is.dosya.split(/[\\/]/).pop() : null; }
async function oynatYol(id) { const d = dosyaAdi(id); if (d) await eylem('/api/oynat', { dosya: d }); }
async function gosterYol(id) { const d = dosyaAdi(id); await eylem('/api/klasor', d ? { dosya: d } : {}); }
function oynat(ad) { return eylem('/api/oynat', { dosya: ad }); }
function goster(ad) { return eylem('/api/klasor', { dosya: ad }); }
async function dosyaSil(ad) {
  if (!confirm('Silinsin mi?\n\n' + ad)) return;
  const c = await eylem('/api/sil', { dosya: ad });
  if (!c.hata) { dosyalariYenile(); tost('Silindi'); }
}

/* ------------------------------------------------- dosya listesi */
async function dosyalariYenile() {
  const d = await api('/api/durum');
  cizDosyalar(d.dosyalar || []);
}
function cizDosyalar(liste) {
  const k = $('#dosyalar');
  k.replaceChildren();
  if (!liste.length) { k.append(el('div', { sinif: 'bos-mesaj', metin: 'Klasör boş.' })); return; }
  for (const f of liste) {
    const ses = /\.(mp3|m4a|opus|wav|aac|flac|ogg)$/i.test(f.ad);
    k.append(el('div', { sinif: 'dosya' },
      ikon(ses ? 'muzik' : 'film'),
      el('span', { sinif: 'ad', title: f.ad, metin: f.ad }),
      el('span', { sinif: 'boy', metin: boyut(f.boyut) }),
      ikonDugme('oynat', 'Oynat', false, () => oynat(f.ad), f.ad),
      ikonDugme('klasor', 'Klasörde göster', false, () => goster(f.ad), f.ad),
      ikonDugme('sil', 'Sil', true, () => dosyaSil(f.ad), f.ad)));
  }
}

/* ------------------------------------------------- rozetler / kurulum */
function rozetleriCiz(d) {
  const r = $('#rozetler');
  r.replaceChildren();
  r.append(d.ytdlp
    ? el('span', { sinif: 'rozet iyi' }, 'yt-dlp ', el('b', { metin: d.ytdlp }))
    : el('button', { type: 'button', sinif: 'rozet kotu', onclick: ytGuncelle, metin: 'yt-dlp yok — kurmak için tıkla' }));
  r.append(d.ffmpeg
    ? el('span', { sinif: 'rozet iyi', metin: 'ffmpeg var' })
    : el('span', { sinif: 'rozet kotu', metin: 'ffmpeg yok' }));

  const u = $('#uyari');
  if (!d.ytdlp) {
    uyariGoster('yt-dlp kurulu değil — indirme motoru bu.', 'Şimdi kur', ytGuncelle);
  } else if (!d.ffmpeg) {
    uyariGoster(el('span', null, 'ffmpeg bulunamadı: 1080p ses+görüntü birleştirme ve MP3 çevirme çalışmaz. ', el('b', { metin: 'winget install ffmpeg' }), ' ile kurabilirsin.'));
  } else if (typeof d.diskBosGB === 'number' && d.diskBosGB < 2) {
    uyariGoster('Diskte yalnızca ' + d.diskBosGB.toFixed(1) + ' GB boş yer kaldı; indirmeler başlamayabilir.', null, null, true);
  } else u.className = 'uyari';
}
async function ytGuncelle() {
  tost('Kuruluyor… (1-2 dk sürebilir)');
  const c = await api('/api/guncelle', {});
  if (c.tamam) { tost('Hazır — yt-dlp ' + c.surum); baslangic(); }
  else tost(c.hata ? hataYazi(c) : 'Kurulamadı. Python kurulu mu? (pip install -U --pre yt-dlp)');
}

/* ------------------------------------------------- canli akis */
let akisDeneme = 0;
function akisBagla() {
  const es = new EventSource('/api/akis');
  es.addEventListener('open', () => { akisDeneme = 0; });
  es.addEventListener('is', (e) => {
    const is = JSON.parse(e.data);
    const onceki = isler.get(is.id);
    isler.set(is.id, is);
    isCiz(is);
    rozetGuncelle();
    if (is.durum === 'bitti' && (!onceki || onceki.durum !== 'bitti')) {
      dosyalariYenile();
      tost('İndi: ' + (is.baslik || '').slice(0, 52));
    }
  });
  es.addEventListener('sil', (e) => { isSil(JSON.parse(e.data).id); rozetGuncelle(); });
  es.onerror = () => {
    // tarayici gecici kopmada kendi yeniden baglanir; tamamen kapandiysa (403 = eski oturum) kullaniciya soyle
    if (es.readyState === EventSource.CLOSED) {
      es.close();
      if (++akisDeneme > 2) oturumBitti();
      else setTimeout(akisBagla, 3000);
    }
  };
}

/* ------------------------------------------------- baslangic */
function kaliteCipleriniIsaretle() {
  document.querySelectorAll('.cip[data-kalite]').forEach((b) => cipIsaretle(b, b.dataset.kalite === kalite));
}
function cipIsaretle(b, secili) {
  b.classList.toggle('secili', secili);
  b.setAttribute('aria-pressed', secili ? 'true' : 'false');
}
async function baslangic() {
  const d = await api('/api/durum');
  if (d.hata && !d.ayar) return;
  rozetleriCiz(d);
  if (d.ayar) {
    kalite = d.ayar.kalite || 'en-iyi';
    $('#cerez').checked = !!d.ayar.cerez;
    $('#klasor-yolu').textContent = d.ayar.klasor;
  }
  kaliteCipleriniIsaretle();
  (d.isler || []).forEach((is) => { isler.set(is.id, is); isCiz(is); });
  rozetGuncelle();
  cizDosyalar(d.dosyalar || []);
}

/* cip gruplari: her grup kendi icinde tek secim */
function cipGrubu(alan, secildi) {
  const hepsi = [...document.querySelectorAll('.cip[' + alan + ']')];
  const ad = alan.replace('data-', '');
  hepsi.forEach((b) => b.addEventListener('click', () => {
    // ayni deger baska sekmede de varsa ikisini birden isaretle (kalite cipleri iki yerde)
    hepsi.forEach((x) => cipIsaretle(x, x.dataset[ad] === b.dataset[ad]));
    secildi(b.dataset[ad], b);
  }));
}
cipGrubu('data-kalite', (v) => { kalite = v; });
$('#indir').addEventListener('click', indir);
$('#yapistir').addEventListener('click', yapistirIndir);
$('#temizle').addEventListener('click', async () => { const c = await eylem('/api/temizle', {}); if (!c.hata) tost('Temizlendi'); });
$('#klasor-ac').addEventListener('click', () => eylem('/api/klasor', {}));
$('#klasor-yolu').addEventListener('click', () => eylem('/api/klasor', {}));
$('#cerez').addEventListener('change', (e) => eylem('/api/ayar', { cerez: e.target.checked }));
$('#link').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); indir(); }
});
/* pencereye donunce imleci link kutusuna al - ama Keşfet'te yazi yazmayi bozma */
window.addEventListener('focus', () => {
  if ($('#sekme-indir').hidden) return;
  const a = document.activeElement;
  if (a && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(a.tagName) && a.id !== 'link') return;
  $('#link').focus();
});

/* ================================================= KEŞFET ================================================= */
let kesfetHam = [];      // vidIQ akisi
let kesfetSuzulmus = [];
let filtrePlat = 'hepsi', filtreMin = 0;
let aramaDonem = 'hafta', aramaTur = 'kisa';
const istenen = new Set(); // indirmeye gonderilen url'ler

function izlenmeYazi(n) {
  if (!n) return '';
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.0', '') + 'Mr';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'B';
  return String(n);
}
const PLAT_AD = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };
const PLAT_KISA = { youtube: 'YT', tiktok: 'TT', instagram: 'IG' };

function vkart(v) {
  const p = PLAT_AD[v.platform] ? v.platform : 'youtube';
  const url = guvenliUrl(v.url);
  const gonderildi = istenen.has(v.url);
  const baslik = v.baslik || '(başlıksız)';

  const vkapak = el('div', { sinif: 'vkapak ' + (p === 'tiktok' ? 'tt' : p === 'instagram' ? 'ig' : '') });
  const yedek = () => el('span', { sinif: 'pikon', metin: PLAT_KISA[p] });
  if (guvenliUrl(v.kapak, true)) {
    const img = el('img', { src: v.kapak, referrerpolicy: 'no-referrer', loading: 'lazy', alt: '' });
    img.addEventListener('error', () => img.replaceWith(yedek()));
    vkapak.append(img);
  } else vkapak.append(yedek());
  if (v.sure) vkapak.append(el('span', { sinif: 'rozet-sure', metin: sureYazi(v.sure) }));

  const meta = el('div', { sinif: 'vmeta' });
  const ekle = (m) => { if (m) { if (meta.childNodes.length) meta.append(nokta()); meta.append(m); } };
  ekle(v.kanal);
  if (v.izlenme) ekle(el('span', { sinif: 'izlenme', metin: izlenmeYazi(v.izlenme) + ' izlenme' }));
  if (v.katsayi > 3) ekle(el('span', { sinif: 'patlama', metin: Math.round(v.katsayi) + 'x patlama' }));
  else if (v.saatlik > 50000) ekle(el('span', { sinif: 'patlama', metin: izlenmeYazi(v.saatlik) + '/saat' }));
  if (p !== 'youtube') ekle(el('span', { sinif: 'site', metin: PLAT_AD[p] }));

  const kart = el('div', { sinif: 'vkart' + (gonderildi ? ' indi' : '') });
  const indirDugme = el('button', { type: 'button', sinif: 'mini ana', disabled: gonderildi || !url,
    'aria-label': 'İndir: ' + baslik, metin: gonderildi ? 'Kuyrukta' : 'İndir' });
  indirDugme.addEventListener('click', () => kesfetIndir(v.url, indirDugme));
  const ac = url
    ? el('a', { sinif: 'mini', href: url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Sitede aç: ' + baslik, metin: 'Aç' })
    : null;

  kart.append(vkapak,
    el('div', { sinif: 'vgovde' }, el('div', { sinif: 'vad', title: baslik, metin: baslik }), meta),
    el('div', { sinif: 'veylem' }, indirDugme, ac));
  return kart;
}

async function kesfetIndir(url, dugme) {
  if (!guvenliUrl(url)) return;
  dugme.disabled = true; dugme.textContent = 'Kuyrukta';
  dugme.closest('.vkart').classList.add('indi');
  istenen.add(url);
  const c = await api('/api/indir', { url, kalite });
  if (c.hata) {
    tost(hataYazi(c));
    istenen.delete(url);
    dugme.disabled = false; dugme.textContent = 'İndir';
    dugme.closest('.vkart').classList.remove('indi');
    return;
  }
  tost('Kuyruğa eklendi — "İndir" sekmesinde');
}

function kesfetSuz() {
  kesfetSuzulmus = kesfetHam.filter((v) =>
    (filtrePlat === 'hepsi' || v.platform === filtrePlat) && (v.izlenme || 0) >= filtreMin);
  const k = $('#kesfet-liste');
  k.replaceChildren();
  if (kesfetSuzulmus.length) kesfetSuzulmus.forEach((v) => k.append(vkart(v)));
  else k.append(el('div', { sinif: 'bos-mesaj', metin: 'Bu filtreye uyan video yok — barajı düşür.' }));
  $('#kesfet-adet').textContent = kesfetSuzulmus.length + ' video';
}

async function kesfetYukle() {
  const d = await api('/api/kesfet');
  kesfetHam = d.videolar || [];
  const bilgi = $('#kesfet-bilgi');
  if (d.guncellendi) {
    const t = new Date(d.guncellendi);
    const fark = Math.round((Date.now() - t) / 86400000);
    bilgi.textContent = 'vidIQ verisi · ' + t.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }) +
      (fark > 0 ? ' (' + fark + ' gün önce)' : ' (bugün)');
  } else {
    bilgi.textContent = 'Henüz viral verisi yok.';
  }
  kesfetSuz();
}

async function topluIndir() {
  const ilk = kesfetSuzulmus.filter((v) => !istenen.has(v.url) && guvenliUrl(v.url)).slice(0, 10);
  if (!ilk.length) { tost('İndirilecek yeni video kalmadı'); return; }
  if (!confirm(ilk.length + ' video indirilecek.\n\nBunlar başkalarının içerikleri. Yalnızca kullanım izni olanları indir; ' +
    'izinsiz yeniden yükleme telif ihlalidir.\n\nDevam edilsin mi?')) return;
  ilk.forEach((v) => istenen.add(v.url));
  const c = await api('/api/indir', { url: ilk.map((v) => v.url).join('\n'), kalite });
  if (c.hata) { ilk.forEach((v) => istenen.delete(v.url)); tost(hataYazi(c)); }
  else tost(ilk.length + ' video kuyruğa eklendi');
  kesfetSuz();
}

async function kesfetTazele() {
  if (!confirm('vidIQ’dan canlı viral listesi çekilecek.\n\nBu işlem yaklaşık 10 vidIQ kredisi harcar. Devam edilsin mi?')) return;
  const b = $('#kesfet-yenile');
  b.disabled = true;
  b.replaceChildren(ikon('yenile'), 'vidIQ’dan çekiliyor…');
  tost('Canlı viral listesi çekiliyor (~30 sn, ~10 kredi)');
  const c = await api('/api/kesfet-yenile', { minIzlenme: 1000000, onay: true });
  b.disabled = false;
  b.replaceChildren(ikon('yenile'), 'vidIQ’dan tazele');
  if (c.hata) { tost(hataYazi(c)); return; }
  kesfetHam = c.videolar || [];
  istenen.clear();
  kesfetSuz();
  $('#kesfet-bilgi').textContent = 'vidIQ canlı · az önce güncellendi · ' + c.adet + ' video';
  tost(c.uyari ? 'Kısmi güncelleme: ' + c.uyari : c.adet + ' viral video güncellendi');
}

async function canliAra() {
  const sorgu = $('#arama').value.trim();
  if (!sorgu) { tost('Aranacak kelimeyi yaz'); $('#arama').focus(); return; }
  const k = $('#arama-liste');
  k.replaceChildren(el('div', { sinif: 'yukleniyor', metin: 'Aranıyor… (10-20 sn)' }));
  $('#ara').disabled = true;
  const c = await api('/api/kesfet-ara', { sorgu, donem: aramaDonem, tur: aramaTur, adet: 60 });
  $('#ara').disabled = false;
  k.replaceChildren();
  if (c.hata) { k.append(el('div', { sinif: 'bos-mesaj', metin: hataYazi(c) })); return; }
  if ((c.videolar || []).length) c.videolar.forEach((v) => k.append(vkart(v)));
  else k.append(el('div', { sinif: 'bos-mesaj', metin: 'Sonuç yok — dönemi genişlet ya da barajı düşür.' }));
}

/* sekmeler (oklarla da gezilir) */
const SEKMELER = [...document.querySelectorAll('.sekme')];
function sekmeAc(b, odak) {
  SEKMELER.forEach((x) => {
    const aktif = x === b;
    x.classList.toggle('aktif', aktif);
    x.setAttribute('aria-selected', aktif ? 'true' : 'false');
    x.tabIndex = aktif ? 0 : -1;
  });
  const s = b.dataset.sekme;
  $('#sekme-indir').hidden = s !== 'indir';
  $('#sekme-kesfet').hidden = s !== 'kesfet';
  if (odak) b.focus();
  if (s === 'kesfet' && !kesfetHam.length) kesfetYukle();
}
SEKMELER.forEach((b, i) => {
  b.addEventListener('click', () => sekmeAc(b));
  b.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      sekmeAc(SEKMELER[(i + (e.key === 'ArrowRight' ? 1 : SEKMELER.length - 1)) % SEKMELER.length], true);
    }
  });
});

cipGrubu('data-plat', (v) => { filtrePlat = v; kesfetSuz(); });
cipGrubu('data-min', (v) => { filtreMin = Number(v); kesfetSuz(); });
cipGrubu('data-donem', (v) => { aramaDonem = v; });
cipGrubu('data-tur', (v) => { aramaTur = v; });
$('#toplu').addEventListener('click', topluIndir);
$('#kesfet-yenile').addEventListener('click', kesfetTazele);
$('#ara').addEventListener('click', canliAra);
$('#arama').addEventListener('keydown', (e) => { if (e.key === 'Enter') canliAra(); });

/* kuyruk rozeti */
function rozetGuncelle() {
  const n = [...isler.values()].filter((i) => CALISIYOR.includes(i.durum)).length;
  const r = $('#say-kuyruk');
  r.hidden = n === 0; r.textContent = n;
}

$('#isler').append(bosIsMesaji());
baslangic();
akisBagla();
$('#link').focus();
