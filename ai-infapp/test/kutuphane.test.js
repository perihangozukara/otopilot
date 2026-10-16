'use strict';

/**
 * SAHNE KUTUPHANESI - KABUL KAPILARI
 *
 * Bu dosya bir SOZU teste bagliyor. Kutuphane bir kez temizlendi ama
 * kaynak gunde iki kez guncelleniyor; elle yapilan bir temizlik bir
 * sonraki senkronda sessizce geri sizar. Asagidaki uc kapi her calisan
 * icin ayni: sizarsa test kirmizi olur.
 *
 * Calistir:  node test/kutuphane.test.js
 * Sifir bagimlilik - test cercevesi yok, cikis kodu 0/1.
 */

const path = require('path');
const kutuphane = require(path.join(__dirname, '..', 'src', 'kutuphane'));
const promptcraft = require(path.join(__dirname, '..', 'src', 'promptcraft'));
const paket = require(path.join(__dirname, '..', 'src', 'kutuphane', 'sahneler.json'));

let hata = 0;
const bildir = (ad, gecti, detay) => {
  console.log(`  ${gecti ? 'OK  ' : 'HATA'}  ${ad}${detay ? `  -> ${detay}` : ''}`);
  if (!gecti) hata++;
};

console.log(`\nSAHNE KUTUPHANESI TESTI (${paket.kayitlar.length} kayit)\n`);

/* ─────────────────────────────────────────── 1. KIMLIK KAPISI */
console.log('1. Kimlik kapisi - hicbir alan kisi tarif etmemeli');
{
  const kotu = paket.kayitlar.filter((k) => kutuphane.denetle(k).length > 0);
  bildir('denetle() temiz', kotu.length === 0,
    kotu.length ? `${kotu.length} kayit: #${kotu[0].i} ${kutuphane.denetle(kotu[0]).join(', ')}` : '');
}

/* ──────────────────────────────── 2. NEGATIF CARPISMASI KAPISI */
console.log('\n2. Negatif carpismasi - kutuphane metni NEGATIVE listesini istememeli');
{
  const NEG = (promptcraft.NEGATIVE || []).filter((x) => x.length > 5);
  const carpisan = [];
  for (const k of paket.kayitlar) {
    const metin = kutuphane.ALANLAR.map((a) => k[a]).filter(Boolean).join(' ').toLowerCase();
    const n = NEG.find((x) => metin.includes(x.toLowerCase()));
    if (n) carpisan.push([k.i, n]);
  }
  bildir('carpisma yok', carpisan.length === 0,
    carpisan.length ? `${carpisan.length} kayit, ornek #${carpisan[0][0]} "${carpisan[0][1]}"` : '');
}

/* ───────────────────────────────────────────── 3. GORSEL KAPISI */
console.log('\n3. Gorsel kapisi - paket hicbir gorsel baglantisi tasimamali');
{
  const ham = JSON.stringify(paket);
  bildir('sourceMedia anahtari yok', !ham.includes('sourceMedia'));
  const httpVar = /"[^"]*https?:\/\/[^"]*"/.test(JSON.stringify(paket.kayitlar));
  bildir('kayitlarda http baglantisi yok', !httpVar);
}

/* ──────────────────── 4. KILIT KAPISI - gercek karakterle uctan uca */
console.log('\n4. Kilit kapisi - uretilen prompt kilitli kimligi bozmamali');
{
  let karakter = null;
  try {
    karakter = require(path.join(__dirname, '..', 'data', 'character.json'));
  } catch { /* karakter yoksa bu kapi atlanir */ }

  if (!karakter || !karakter.identity) {
    console.log('  ATLA  karakter yok (data/character.json) - bu kapi calistirilamadi');
  } else {
    const kimlik = promptcraft.identityLine(karakter.identity);
    /* Bagimsiz prob: hasat/denetle listelerinden AYRI tutuluyor.
     * Ayni listeyle hem temizleyip hem olcersek tanim geregi sifir
     * bulur ve hicbir sey ogrenmeyiz. */
    /* Prob YALNIZCA kisiye baglanabilecek ifadeleri arar.
     *
     * Ilk surumde "tall" ve "platinum" da vardi ve 25 yanlis pozitif
     * uretti: "tall grass", "tall hedge wall", "field of tall dry
     * grasses", "thin platinum choker". Hicbiri kisi tarifi degil.
     *
     * Ciplak sifat aramanin mantiksiz oldugunu 1. kapi zaten kanitliyor:
     * alanlarda hicbir kisi ismi/zamiri yok, yani "tall" sifatinin
     * baglanacagi bir insan da yok. Bu yuzden prob yalnizca ICINDE
     * beden/sac/goz ismi GECEN ifadeleri tutuyor. */
    const RAKIP = /\b(blonde|brunette|redhead|auburn hair|blue eyes|green eyes|hazel eyes|brown eyes|freckled face|olive skin|pale skin|tanned skin|curly hair|wavy hair|straight hair|long hair|short hair|petite frame|curvy figure|athletic build|slim build)\b/i;

    const bozan = [];
    for (const k of paket.kayitlar) {
      const sahne = kutuphane.sahneYap(k);
      const p = promptcraft.build(karakter, sahne, 'flux');
      // Kilitli kimlik satiri prompt'ta AYNEN olmali
      if (!p.prompt.includes(kimlik)) { bozan.push([k.i, 'kimlik satiri yok']); continue; }
      // Kutuphanenin kattigi metinde rakip tarif OLMAMALI
      const katki = kutuphane.ALANLAR.map((a) => k[a]).filter(Boolean).join(' ');
      const m = katki.match(RAKIP);
      if (m) bozan.push([k.i, `rakip tarif: ${m[0]}`]);
    }
    bildir(`${paket.kayitlar.length} kayit x gercek karakter`, bozan.length === 0,
      bozan.length ? `${bozan.length} kayit, ornek #${bozan[0][0]} ${bozan[0][1]}` : '');
  }
}

/* ───────────────────────────────────────── 5. ARAMA SAGLIGI */
console.log('\n5. Arama - Turkce sorgu alakali sonuc dondurmeli');
{
  const BEKLENEN = {
    kar: /snow|winter/i, kafe: /cafe|coffee/i, ayna: /mirror/i,
    deniz: /\bsea\b|ocean|coastal/i, mutfak: /kitchen/i, gece: /night/i,
  };
  let yanlis = 0;
  for (const [q, bek] of Object.entries(BEKLENEN)) {
    const r = kutuphane.ara({ sorgu: q, limit: 1 });
    const ilk = r.kayitlar[0];
    const metin = ilk ? kutuphane.ALANLAR.map((a) => ilk[a]).filter(Boolean).join(' ') : '';
    if (!ilk || !bek.test(metin)) yanlis++;
  }
  bildir('ilk sonuclar alakali', yanlis === 0, yanlis ? `${yanlis} sorgu alakasiz` : '');
}

/* ───────────────────────────────────── 6. SAHNE SOZLESMESI */
console.log('\n6. Sahne sozlesmesi - sahneYap() promptcraft ile uyumlu olmali');
{
  const s = kutuphane.sahneYap(paket.kayitlar[0]);
  bildir('extra bos', s.extra === '');
  bildir('category = library', s.category === 'library');
  bildir('style = photo', s.style === 'photo');
  bildir('shot dolu', !!s.shot);
}

/* ───────────────────────────────────── 7. BELGELENEN SAYI */
console.log('\n7. Belgelenen sayi - belgeler ve lisans bildirimi GERCEK kayit sayisini soylemeli');
{
  const fs = require('fs');
  const say = paket.kayitlar.length;
  bildir('kaynak.gonderilen = kayit sayisi', paket.kaynak.gonderilen === say, `${paket.kaynak.gonderilen} / ${say}`);
  bildir('bilgi().kayit = kayit sayisi', kutuphane.bilgi().kayit === say);
  bildir('kid benzersiz', new Set(paket.kayitlar.map((k) => k.kid)).size === say);

  // Belgelerdeki sayi eskiden elle yazilmisti (677/678) ve veri genisleyince (surum 2) sessizce bayatladi;
  // lisans bildirimindeki "N kayit kaldi" beyani da yanlis sayiyla yayimlaniyordu.
  const kok = path.join(__dirname, '..');
  const belgeler = [
    ['README.md', 1],
    ['THIRD_PARTY_LICENSES.md', 1],
    [path.join('src', 'kutuphane', 'index.js'), 2],
    [path.join('..', 'README.md'), 1], // ust depo kokundeki lisans cumlesi (ai-infapp tek basina kopyalandiysa yok)
  ];
  const KALIPLAR = [
    /(\d[\d.,]*)\*{0,2}\s+haz.r sahne/g,           // "1.264 hazir sahne"
    /benzersiz kay.ttan\s+\*{0,2}(\d[\d.,]*)/g,    // "14.753 benzersiz kayittan 1.264'u kaldi"
    /unique upstream records,\s+\*{0,2}(\d[\d.,]*)/g, // "14,753 unique upstream records, 1,264 survive"
    /x\s+(\d[\d.,]*)\s+kayit/g,                    // "RegExp x 1.264 kayit"
  ];
  for (const [goreli, enAz] of belgeler) {
    const yol = path.join(kok, goreli);
    if (!fs.existsSync(yol)) { console.log(`  ATLA  ${goreli} yok`); continue; }
    const metin = fs.readFileSync(yol, 'utf8');
    const sayilar = [];
    for (const kalip of KALIPLAR) for (const m of metin.matchAll(kalip)) sayilar.push(Number(m[1].replace(/[.,]/g, '')));
    const yanlis = sayilar.filter((n) => n !== say);
    bildir(`${goreli} dogru sayiyi soyluyor (${sayilar.length} yer)`, sayilar.length >= enAz && yanlis.length === 0,
      yanlis.length ? `bayat sayi: ${yanlis.join(', ')} (gercek ${say})` : (sayilar.length < enAz ? 'sayi bulunamadi' : ''));
  }
}

console.log(`\n${hata === 0 ? 'TUM KAPILAR GECTI' : `${hata} KAPI KIRMIZI`}\n`);
process.exit(hata === 0 ? 0 : 1);
