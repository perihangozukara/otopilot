'use strict';

/**
 * SECENEK YOKLAMA - istemciden gelen anahtarlar icin
 *
 * Studyolarin secenek tablolari (olcu, palet, font, tema...) duz nesnedir ve
 * istemci bunlara anahtar gonderir. `TABLO[anahtar]` yoklamasi MIRAS ozellikleri
 * de gorur: anahtar 'constructor' ya da '__proto__' olunca tablo bir fonksiyon
 * dondurur, kod bunu gecerli secim sanir ve cikti "undefined" olculerle
 * (width="undefined", --window-size=undefined,undefined) uretilir ya da
 * `A.uret is not a function` ile 500 verir.
 *
 * Burada yalnizca tablonun KENDI anahtarlari gecerlidir ve anahtar metin
 * olmak zorundadir (dizi/nesne anahtara cevrilip tabloya sizamaz).
 */

/** Anahtar tablonun kendi anahtari mi? */
function gecerli(tablo, anahtar) {
  return typeof anahtar === 'string' && Object.hasOwn(tablo, anahtar);
}

/** Gecerli anahtarsa tablo[anahtar], degilse yedek. */
function sec(tablo, anahtar, yedek) {
  return gecerli(tablo, anahtar) ? tablo[anahtar] : yedek;
}

/**
 * Anahtar listesini suzer: yalniz tablonun kendi anahtarlari, TEKRARSIZ,
 * ilk gorunme sirasiyla. Cikti uzunlugu hicbir zaman tablo boyutunu asmaz;
 * "ayni olcuyu 5000 kez yaz" gibi bir girdi isi 5000 kat buyutemez.
 */
function tekil(liste, tablo) {
  if (!Array.isArray(liste)) return [];
  const goruldu = new Set();
  const cikti = [];
  for (const x of liste) {
    if (!gecerli(tablo, x) || goruldu.has(x)) continue;
    goruldu.add(x);
    cikti.push(x);
  }
  return cikti;
}

/** Istemci metnini sinirli uzunlukta metne cevirir (kayit/cikti sisirmesin). */
function kisa(deger, uzunluk) {
  return String(deger == null ? '' : deger).slice(0, uzunluk);
}

module.exports = { gecerli, sec, tekil, kisa };
