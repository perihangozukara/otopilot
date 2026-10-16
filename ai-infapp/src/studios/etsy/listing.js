'use strict';

/**
 * ETSY LISTELEME METNI
 *
 * Etsy SEO'su baslik + 13 etiket + aciklamada yasiyor. Cogu satici burada
 * kaybediyor. Sifir API, tamamen sablon - ama satisi dogrudan etkiliyor.
 *
 * Etsy sinirlari (dogrulanmasi kolay, degisirse tek yerden guncellenir):
 *   baslik  : 140 karakter
 *   etiket  : 13 adet, her biri en fazla 20 karakter
 */
const LIMITS = { title: 140, tagCount: 13, tagLength: 20 };

const { sec } = require('../secenek');

const PRODUCT_WORDS = {
  tisort: ['shirt', 'tshirt', 'tee', 'graphic tee'],
  kare: ['tote bag', 'pillow', 'canvas'],
  kupa: ['mug', 'coffee mug', 'cup'],
  poster: ['poster', 'wall art', 'print'],
};

const OCCASIONS = [
  'birthday gift', 'christmas gift', 'gift for her', 'gift for him',
  'mothers day', 'fathers day', 'funny gift', 'gift idea',
];

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function trimTo(s, n) {
  const t = clean(s);
  return t.length <= n ? t : t.slice(0, n).replace(/[\s,-]+$/, '');
}

const niches = require('./niches');

/**
 * @param {object} input
 *   phrase   tasarimdaki ana soz
 *   niche    kategori/tema ("cat lover", "camping", "nurse")
 *   size     urun tipi anahtari
 *   audience hedef ("for women", "for dad")
 *   keywords kullanicinin arastirmadan getirdigi anahtar kelimeler (dizi)
 */
function build(input = {}) {
  // Girdi uzunluklari sinirli: soz aciklamaya aynen giriyor, listeleme de galeriye
  // yaziliyor; sinirsiz soz gallery.json'u sisiriyordu. Etsy basligi zaten 140.
  const phrase = clean(input.phrase).slice(0, 600) || 'Custom Design';
  const audience = clean(input.audience).slice(0, 120);

  // NIS INGILIZCEYE COZULUR. Kullanici "kedi" yazabilir; Etsy alicisi "cat"
  // ariyor. Etiketler zaten niches.js uzerinden Ingilizce turuyordu ama
  // baslik ve aciklama ham girdiyi kullaniyordu - yani baslikta "kedi shirt"
  // yaziyordu ve o terimi kimse aramiyor.
  const nisCozum = clean(input.niche) ? niches.resolve(clean(input.niche).slice(0, 120)) : null;
  const niche = nisCozum ? nisCozum.en : '';
  const nicheHam = clean(input.niche).slice(0, 120);
  const product = sec(PRODUCT_WORDS, input.size, PRODUCT_WORDS.tisort);
  // Anahtar kelimeler sinirli: dizi uzunlugu ve her biri (galeriye giren listeleme sismesin).
  const extra = (Array.isArray(input.keywords) ? input.keywords : [])
    .slice(0, 50).map((k) => clean(k).slice(0, 120)).filter(Boolean);

  /* ---------------------------------------------------------------- BASLIK
   *
   * Etsy basligin ILK kelimelerine daha cok agirlik veriyor. Eskiden basta
   * tasarimin sozu vardi ("Powered by coffee and cat hair, ...") - oysa
   * kimse onu aramiyor. Aranan sey nis + urun: "cat mom shirt".
   *
   * Bu yuzden sira degisti: once ARANAN terim, sonra tasarimin sozu.
   * Soz kaybolmuyor, basligin ikinci parcasi oluyor.
   */
  const anaTerim = niche ? `${niche} ${product[0]}` : product[0];
  const titleBits = [
    anaTerim,
    phrase !== 'Custom Design' ? phrase : '',
    audience,
    // Uzun kuyruk: Etsy uzun ve tanimlayici basliklari odullendiriyor.
    niche ? `${niche} gift` : 'gift idea',
    'Gift for Her',
    'Gift for Him',
  ].filter(Boolean);

  // 140'i asmadan olabildigince cok terim sigdir.
  let title = '';
  for (const bit of titleBits) {
    const aday = title ? `${title}, ${bit}` : bit;
    if (aday.length > LIMITS.title) break;
    title = aday;
  }
  if (!title) title = trimTo(anaTerim, LIMITS.title);

  /* -------------------------------------------------------------- ETIKETLER
   *
   * TEK KELIMELIK ETIKET URETILMEZ. Etsy'de "shirt" gibi tek kelimede
   * rekabet o kadar yuksek ki gorunme sansi yok; deger alicinin gercekten
   * yazdigi cok kelimeli terimde ("funny cat mom shirt").
   *
   * Uretim niches.js'e devredildi: nis kutuphanesindeki gercek arama
   * terimlerinden turer, kutuphanede olmayan nislerde jenerik kaliplara duser.
   */
  const tags = nicheHam
    ? niches.expandTags(nicheHam, product, audience, extra, LIMITS.tagCount)
    : (() => {
      // Nis yoksa elde yalnizca sozle urun var - yine de tek kelime uretme.
      const havuz = [
        ...extra,
        `funny ${product[0]}`,
        `${product[0]} gift`,
        `gift for her`,
        `gift for him`,
        `birthday gift`,
        `christmas gift`,
        `custom ${product[0]}`,
        `unique ${product[0]}`,
      ];
      const g = new Set(); const out = [];
      for (const h of havuz) {
        const e = trimTo(String(h).toLowerCase(), LIMITS.tagLength);
        if (!e.includes(' ') || g.has(e)) continue;
        g.add(e); out.push(e);
        if (out.length === LIMITS.tagCount) break;
      }
      return out;
    })();

  /* -------------------------------------------------------------- ACIKLAMA
   *
   * Etsy aciklamanin ILK satirlarini aramada kullaniyor. Eskiden aciklama
   * yalnizca tasarimin sozuyle basliyordu - arama icin bos bir satir.
   * Artik ilk cumle nis + urun + hediye dilini tasiyor.
   */
  const ilkCumle = niche
    ? `${phrase} - ${niche} ${product[0]}, a gift for ${niche} lovers${audience ? ` ${audience}` : ''}.`
    : `${phrase} - an original ${product[0]} design.`;

  /* DIJITAL MI FIZIKSEL MI? (A8)
   * Eskiden baslik ve etiketler TISORT satiyordu ama aciklama PNG DOSYASI
   * teslim ediyordu ("High resolution print-ready file"). Bu celiski
   * dogrudan iade ve olumsuz yorum demek: alici tisort bekleyip zip aliyor.
   * Artik ne sattigini soyluyorsun ve aciklama ona gore yaziliyor.
   */
  const dijital = input.delivery === 'dijital';

  const description = [
    ilkCumle,
    '',
    'WHAT YOU GET',
    ...(dijital ? [
      '- INSTANT DIGITAL DOWNLOAD - no physical item will be shipped',
      '- High resolution print-ready file (300 DPI, sRGB)',
      '- Transparent background PNG',
      '- Ready for direct-to-garment and print-on-demand',
      '- Files are available right after purchase',
    ] : [
      '- A printed physical item, made to order and shipped to you',
      '- Printed at 300 DPI on demand',
      '- Please check the size chart before ordering',
    ]),
    '',
    'PERFECT FOR',
    niche
      ? `- ${niche} lovers, birthdays, Christmas, Mother's Day and Father's Day`
      : '- Birthdays, Christmas and everyday gifting',
    audience ? `- Thoughtful gift ${audience}` : '- A thoughtful gift for someone who gets the joke',
    '',
    'NOTE',
    'Colours may vary slightly between screens and printed products.',
    'This is an original design created by us.',
  ].join('\n');

  const uyarilar = [
    tags.length < LIMITS.tagCount
      ? `Yalnizca ${tags.length}/13 etiket uretildi - "ek anahtar kelime" alanina birkac terim daha ekle.`
      : null,
    title.length < 80
      ? `Baslik ${title.length}/140 karakter. Etsy uzun ve tanimlayici basliklari odullendiriyor; nis veya hedef kitle ekleyerek uzat.`
      : null,
    input.delivery === undefined
      ? 'Teslim turu secilmedi. Etsy alicisi TISORT mu yoksa INDIRILEBILIR DOSYA mi aldigini bilmeli - bu celiski en sik iade sebeplerinden.'
      : null,
    !nicheHam
      ? 'Nis girilmedi. Nis olmadan etiketler jenerik kaliyor - "kedi", "hemsire", "kamp" gibi bir nis yazarsan etiketler ciddi guclenir.'
      : null,
    nisCozum && nisCozum.ozel && /[^\x00-\x7F]/.test(nicheHam)
      ? `Nis Turkce yazilmis ("${nicheHam}") ve kutuphanede karsiligi yok, bu yuzden baslik ve etiketler Turkce kaldi. Etsy alicilari Ingilizce ariyor - nisin Ingilizce karsiligini yaz.`
      : null,
    ...(nicheHam ? niches.uyarilar(nicheHam, product, audience, extra) : []),
  ].filter(Boolean);

  return {
    title,
    titleLength: title.length,
    tags,
    tagCount: tags.length,
    // Tek kelimelik etiket kalmadigini panelde de gosterebilmek icin
    tekKelimeEtiket: tags.filter((t) => !t.includes(' ')).length,
    description,
    limits: LIMITS,
    warnings: uyarilar,
  };
}

module.exports = { build, LIMITS };
