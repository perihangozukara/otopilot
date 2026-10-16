// lib/ses-altyazi.js — kelime zamanlarindan altyazi satiri kurma (video-seslendir.js icin).
//
// Ana hat altyazisini render grubu kurar (video-yap); bu dosya yalniz video-seslendir.js'in
// tek paragraf -> satirlar ihtiyacini karsilar. Mantik ayni sozlesmeye uyar:
//  - OZGUN kelime j -> okunan kelime min(M-1, round(j*M/Wo)); zaman = parca baslangici + t/1000
//  - kelime zamani yoksa paragrafin suresi KARAKTER oraniyla satirlara dagitilir
//  - cumle sonu "Dr.", "U.S.", "vs." gibi kisaltmalarda sayilmaz
"use strict";

const KISALTMA = new Set([
  "dr", "mr", "mrs", "ms", "prof", "st", "vs", "etc", "e.g", "i.e", "u.s", "u.k", "no", "jr", "sr", "inc", "ltd",
  "doç", "vb", "bkz", "sn", "yrd", "örn", "yy",
]);

function srtZaman(ms) {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000), d = Math.floor(ms % 3600000 / 60000);
  const s = Math.floor(ms % 60000 / 1000), x = ms % 1000;
  const p = (n, k = 2) => String(n).padStart(k, "0");
  return p(h) + ":" + p(d) + ":" + p(s) + "," + p(x, 3);
}

// "bitti." -> true ; "Dr." / "U.S." / "vs." -> false ; "mı?" -> true
function cumleSonuMu(kelime) {
  if (!/[.!?…]["'”’)\]]*$/.test(kelime)) return false;
  const govde = kelime.replace(/["'”’)\]]+$/, "");
  if (/[?!…]$/.test(govde)) return true;
  const k = govde.replace(/\.$/, "").toLowerCase();
  if (KISALTMA.has(k)) return false;
  if (/^(?:[a-zçğıöşü]\.)+[a-zçğıöşü]$/i.test(k)) return false;          // U.S, e.g, i.e
  return true;
}

// Maks karakteri asan tek cumleyi DENGELI satirlara bol (son satirda tek kelime kalmasin).
function dengeliBol(kelimeler, maks) {
  const toplam = kelimeler.join(" ").length;
  for (let k = Math.ceil(toplam / maks); k <= kelimeler.length; k++) {
    const hedef = toplam / k;
    const satirlar = [];
    let cur = [];
    for (const w of kelimeler) {
      const aday = cur.length ? cur.join(" ") + " " + w : w;
      const mevcut = cur.join(" ").length;
      const kalan = k - satirlar.length - 1;                    // bu satirdan sonra acilabilecek satir
      if (cur.length && (aday.length > maks || (kalan > 0 && Math.abs(aday.length - hedef) > Math.abs(mevcut - hedef)))) {
        satirlar.push(cur); cur = [w];
      } else cur.push(w);
    }
    satirlar.push(cur);
    if (satirlar.every(s => s.join(" ").length <= maks)) return satirlar;
  }
  return kelimeler.map(w => [w]);                               // tek kelime maks'tan uzunsa: kelime kelime
}

// kelime listesini satirlara bol: <=maks karakter, cumle sonunda satir biter
function satirlaraBol(kelimeler, maks) {
  const sinir = maks || 42;
  const cumleler = [];
  let cur = [];
  for (const w of kelimeler) {
    cur.push(w);
    if (cumleSonuMu(w)) { cumleler.push(cur); cur = []; }
  }
  if (cur.length) cumleler.push(cur);
  const satirlar = [];
  for (const c of cumleler) {
    if (c.join(" ").length <= sinir) satirlar.push(c); else satirlar.push(...dengeliBol(c, sinir));
  }
  return satirlar;
}

// Bir paragrafin altyazi bloklari.
//   p: {metin (OZGUN), baslangicSn, sureSn, kelimeler:[{t,d,w}] (ms, parcaya gore goreli; bos olabilir)}
//   -> [{bas, bit, metin}]  (ms, mutlak)
function paragrafBloklari(p, secenek) {
  const maks = (secenek && secenek.maks) || 42;
  const minMs = (secenek && secenek.minMs) || 600;
  const kelimeler = String(p.metin).split(/\s+/).filter(Boolean);
  if (!kelimeler.length) return [];
  const satirlar = satirlaraBol(kelimeler, maks);
  const bas0 = p.baslangicSn * 1000, bit0 = (p.baslangicSn + p.sureSn) * 1000;
  const okunan = (p.kelimeler || []).filter(k => k && k.w !== undefined);
  const Wo = kelimeler.length, M = okunan.length;
  const toplamKarakter = satirlar.reduce((a, s) => a + s.join(" ").length, 0) || 1;

  let oncekiKarakter = 0, j = 0;
  const baslar = satirlar.map(s => {
    let t;
    if (M > 0) t = bas0 + okunan[Math.min(M - 1, Math.round(j * M / Wo))].t;
    else t = bas0 + (bit0 - bas0) * (oncekiKarakter / toplamKarakter);
    oncekiKarakter += s.join(" ").length;
    j += s.length;
    return Math.min(Math.max(t, bas0), bit0);
  });
  // artan olsun (kelime esleme yuvarlamasi geriye gidemez)
  for (let i = 1; i < baslar.length; i++) if (baslar[i] < baslar[i - 1]) baslar[i] = baslar[i - 1];

  // Satir, sonraki satir baslayana kadar gorunur (cakisma yok). Son satir en az minMs gorunur ama
  // sonraki paragrafin baslangicini (tavanMs) asmaz.
  const tavan = secenek && Number.isFinite(secenek.tavanMs) ? secenek.tavanMs : Infinity;
  return satirlar.map((s, i) => {
    const son = i + 1 === baslar.length;
    const bit = Math.min(son ? Math.max(bit0, baslar[i] + minMs) : baslar[i + 1], tavan);
    return { bas: baslar[i], bit: Math.max(bit, baslar[i] + 1), metin: s.join(" ") };
  });
}

function srtMetni(bloklar) {
  return bloklar.map((b, i) => (i + 1) + "\n" + srtZaman(b.bas) + " --> " + srtZaman(b.bit) + "\n" + b.metin + "\n").join("\n");
}

module.exports = { srtZaman, cumleSonuMu, satirlaraBol, paragrafBloklari, srtMetni };
