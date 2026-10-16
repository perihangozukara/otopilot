// lib/render-altyazi.js — altyazi (SRT) kurma. Saf fonksiyonlar + kucuk dosya okuma.
//
// Zamanlama: seslendirme sirasinda kaydedilen KELIME zamanlarindan (Voice/kelimeler.json) gelir.
// Ozgun (altyazi) kelime j -> okunan kelime min(M-1, round(j*M/Wo)); M okunan, Wo ozgun kelime sayisi.
// (Okunus sozlugu "GPU" -> "G P U" gibi kelime sayisini degistirebilir; altyazi ozgun kalir.)
// Kelime zamani yoksa paragraf, karakter oraniyla yayilir.
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./ortak");

const MIN_GORUNUR = 0.6;       // bir altyazi satiri en az bu kadar ekranda kalir
const YATAY_MAKS = 42;         // yatayda parca basina en cok karakter
const DIKEY_KELIME_MAKS = 4;

// "Dr." "U.S." gibi kisaltmalar cumle sonu SAYILMAZ
const KISALTMA = {
  en: ["dr", "mr", "mrs", "ms", "prof", "st", "vs", "etc", "e.g", "i.e", "u.s", "u.k", "no", "jr", "sr", "inc", "ltd", "mt", "gen", "col", "capt", "lt", "sgt", "rev", "hon", "approx", "fig", "vol"],
  tr: ["dr", "prof", "doç", "vb", "vs", "bkz", "sn", "yy", "örn", "no", "mah", "cad", "sok", "tel", "yrd", "uzm", "av", "alb", "gen", "kd", "milattan önce"],
};
const KAPATAN = /["'”’»)\]]+$/;

function cumleSonuMu(kelime, dil) {
  let w = String(kelime || "").replace(KAPATAN, "");
  if (/[?!…]$/.test(w) || /\.\.\.$/.test(w)) return true;
  if (!/\.$/.test(w)) return false;
  const govde = w.replace(/\.$/, "").replace(/^[("'“‘«\[]+/, "").toLowerCase();
  const d = String(dil || "en").slice(0, 2).toLowerCase();
  const liste = KISALTMA[d] || KISALTMA.en;
  if (liste.includes(govde)) return false;
  if (/^[a-zçğıöşü]$/i.test(govde)) return false;                 // bas harf: "J. Robert"
  if (/^(?:[a-zçğıöşü]\.)+[a-zçğıöşü]$/i.test(govde)) return false; // "U.S." "e.g."
  if (d === "tr" && /^\d+$/.test(govde)) return false;            // sira sayisi: "3. sirada"
  return true;
}
const virgulSonuMu = k => /[,;:]["'”’)\]]*$/.test(String(k));

// kelimeler: string dizisi. Donus: [{bas, son}] (kelime indeksi araligi, son dahil)
function parcala(kelimeler, secenek) {
  const o = secenek || {};
  const n = kelimeler.length;
  const out = [];
  if (!n) return out;
  const dikey = o.stil === "kelime" || (o.stil === undefined && o.dikey);
  let bas = 0, say = 0, uzun = 0;
  const bit = son => { out.push({ bas, son }); bas = son + 1; say = 0; uzun = 0; };
  for (let i = 0; i < n; i++) {
    const w = kelimeler[i];
    if (!dikey) {
      // yatay: <=42 karakter; sigmiyorsa parcayi once kapat
      if (say > 0 && uzun + 1 + w.length > (o.yatayMaks || YATAY_MAKS)) bit(i - 1);
      uzun = say === 0 ? w.length : uzun + 1 + w.length; say++;
      if (cumleSonuMu(w, o.dil)) bit(i);
    } else {
      uzun = say === 0 ? w.length : uzun + 1 + w.length; say++;
      const kalan = n - i - 1;
      if (cumleSonuMu(w, o.dil)) { bit(i); continue; }
      if (say >= DIKEY_KELIME_MAKS) { bit(i); continue; }
      if (say >= 2 && virgulSonuMu(w)) { bit(i); continue; }
      if (say >= 2 && uzun > 24) { bit(i); continue; }
      if (say >= 3 && kalan !== 1) { bit(i); continue; }      // tek kelime artmasin: 4. kelimeyi katar
    }
  }
  if (bas < n) bit(n - 1);
  return out;
}

const srtZaman = sn => {
  const ms = Math.max(0, Math.round(sn * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000), x = ms % 1000;
  const p = (v, k) => String(v).padStart(k || 2, "0");
  return p(h) + ":" + p(m) + ":" + p(s) + "," + p(x, 3);
};

const temizMetin = t => String(t).replace(/[{}]/g, m => (m === "{" ? "(" : ")")).replace(/\s+/g, " ").trim();

// Altyazi metin paragraflari: dil ayarina gore dosya sec, paragraf sayisini DOGRULA.
// Donus: { paragraflar, kaynak, uyarilar }
function altyaziMetni(ctx, kanon) {
  const voiceDir = path.join(ctx.dizin, "Voice");
  const uyarilar = [];
  const ham = (() => { try { return ortak.konuHam(ctx.is) || {}; } catch (e) { return {}; } })();
  const ad = dil => "ALTYAZI-" + String(dil).toUpperCase() + ".txt";
  let hedef = null;
  if (ctx.altyaziDili && ctx.altyaziDili !== ctx.dil) {
    hedef = path.join(voiceDir, ad(ctx.altyaziDili));
    if (!fs.existsSync(hedef))
      throw new ortak.OrtakHata("altyazi_yok", "Altyazı dosyası yok: Voice/" + ad(ctx.altyaziDili), { cikis: ortak.CIKIS.GIRDI,
        cozum: "Önce altyazı çevirisini yap (node altyazi-cevir.js " + ctx.is + ") ya da dosyayı elle yaz: paragraf sayısı " + kanon.length + " olmalı." });
  } else if (ham.altyaziDili === undefined) {
    // Eski isler: konu.json'da altyaziDili yoksa ALTYAZI-TR.txt varligi altyaziyi Turkce yapardi.
    const eski = path.join(voiceDir, "ALTYAZI-TR.txt");
    if (ctx.dil !== "tr" && fs.existsSync(eski)) {
      hedef = eski;
      uyarilar.push("Voice/ALTYAZI-TR.txt bulundu (konu.json'da altyaziDili yok): Türkçe altyazı kullanılıyor.");
    }
  }
  if (!hedef) return { paragraflar: kanon, kaynak: "SESLENDIRME-TAM-METIN.txt", uyarilar };
  let metin = "";
  try { metin = fs.readFileSync(hedef, "utf8").replace(/^﻿/, ""); } catch (e) { /* asagida hata */ }
  const p = ortak.paragraflaraBol(metin);
  if (p.length !== kanon.length)
    throw new ortak.OrtakHata("altyazi_sayi", path.basename(hedef) + " paragraf sayısı (" + p.length + ") seslendirme paragraf sayısından (" + kanon.length + ") farklı.", {
      cikis: ortak.CIKIS.YETERSIZ, cozum: "Altyazı metnini düzelt: her paragraf boş satırla ayrılmış ve seslendirmeyle aynı sayıda olmalı (sessiz kayma olmasın diye render durduruldu)." });
  return { paragraflar: p, kaynak: path.basename(hedef), uyarilar };
}

// Altyazi satirlarini kurar. ses: sesHazirla sonucu (baslangic[], sure[], kelimeler[]).
// bodyStart: anlatimin videoda basladigi an (sn). Donus: [{bas, son, metin}] (video zamani, sn)
function altyaziKur(altyaziParagraflari, ses, bodyStart, secenek) {
  const o = secenek || {};
  const N = ses.N;
  const cues = [];
  // 0.6 sn birlestirmesi de parcalamayla ayni sinira uyar: yatay parca 42 karakteri, kelime stili 40 karakteri asmaz
  // (eskiden yatayda 64'e kadar birlestirilip sozlesmedeki 42 asiliyordu). Stil verilmediyse dikeylik parcala() ile ayni kurala bagli.
  const kelimeStili = o.stil === "kelime" || (o.stil === undefined && !!o.dikey);
  const maksKarakter = kelimeStili ? 40 : (o.yatayMaks || YATAY_MAKS);
  for (let no = 0; no < N; no++) {
    const metin = temizMetin(altyaziParagraflari[no] || "");
    const kelimeler = metin ? metin.split(" ") : [];
    if (!kelimeler.length) continue;
    const parBas = ses.baslangic[no], parSon = ses.baslangic[no] + ses.sure[no];
    const okunan = ses.kelimeler && ses.kelimeler[no] && Array.isArray(ses.kelimeler[no].kelimeler) ? ses.kelimeler[no].kelimeler : [];
    const M = okunan.length, Wo = kelimeler.length;
    const toplamKarakter = kelimeler.reduce((a, w) => a + w.length + 1, 0) || 1;
    const aralik = parcala(kelimeler, { stil: o.stil, dikey: o.dikey, dil: o.dil });

    // her parca icin baslangic
    const satir = aralik.map(r => {
      let bas;
      if (M > 0) {
        const idx = Math.min(M - 1, Math.round(r.bas * M / Wo));
        const t = Number(okunan[idx] && okunan[idx].t);
        bas = parBas + (Number.isFinite(t) ? t / 1000 : 0);
      } else {
        const oncekiKarakter = kelimeler.slice(0, r.bas).reduce((a, w) => a + w.length + 1, 0);
        bas = parBas + ses.sure[no] * (oncekiKarakter / toplamKarakter);
      }
      bas = Math.min(Math.max(bas, parBas), parSon);
      return { bas, son: parSon, metin: kelimeler.slice(r.bas, r.son + 1).join(" ") };
    });
    // parca sonu = sonraki parcanin basi
    for (let i = 0; i < satir.length - 1; i++) satir[i].son = Math.max(satir[i].bas, satir[i + 1].bas);

    // en az 0.6 sn gorunur: kisa parcalari komsuyla birlestir, olmazsa uzat
    for (let i = 0; i < satir.length; i++) {
      while (satir[i].son - satir[i].bas < MIN_GORUNUR) {
        if (i < satir.length - 1 && (satir[i].metin + " " + satir[i + 1].metin).length <= maksKarakter) {
          satir[i].metin += " " + satir[i + 1].metin; satir[i].son = satir[i + 1].son; satir.splice(i + 1, 1);
        } else if (i > 0 && (satir[i - 1].metin + " " + satir[i].metin).length <= maksKarakter) {
          satir[i - 1].metin += " " + satir[i].metin; satir[i - 1].son = satir[i].son; satir.splice(i, 1); i--;
        } else break;
      }
    }
    for (const s of satir) cues.push({ bas: s.bas + bodyStart, son: s.son + bodyStart, metin: s.metin, par: no });
  }
  // Baslangiclari 0.05 sn'den yakin satirlar (kelime zamani bozuk/sifir geldiyse) TEK satirda birlesir. Aksi halde
  // asagidaki sure kisaltmasi onlarin gorunme suresini sifira indirir ve son filtre satirin METNINI sessizce atardi.
  for (let i = 0; i < cues.length - 1;) {
    if (cues[i + 1].bas - cues[i].bas < 0.05) {
      cues[i].metin += " " + cues[i + 1].metin;
      cues[i].son = Math.max(cues[i].son, cues[i + 1].son);
      cues.splice(i + 1, 1);
    } else i++;
  }
  // sure yetmeyen (paragraf sonunda tek kisa satir) parcalari bosluga uzat; ust uste binmeyi kes
  for (let i = 0; i < cues.length; i++) {
    const sonraki = i < cues.length - 1 ? cues[i + 1].bas : Infinity;
    if (cues[i].son - cues[i].bas < MIN_GORUNUR) cues[i].son = Math.min(cues[i].bas + MIN_GORUNUR, sonraki - 0.02);
    if (cues[i].son > sonraki) cues[i].son = Math.max(cues[i].bas + 0.05, sonraki);
  }
  return cues.filter(c => c.son > c.bas);
}

const srtMetni = cues => cues.map((c, i) => (i + 1) + "\n" + srtZaman(c.bas) + " --> " + srtZaman(c.son) + "\n" + c.metin + "\n").join("\n");

// Videoya GOMULEN altyazi icin (libass): metindeki ters egik cizgi ("C:\new" -> satir sonu/bosluk olur, "\N" yeni satir)
// ve HTML benzeri etiketler ("<i>x</i>" -> italik, etiketin kendisi kaybolur) ozel anlam tasir. Arkasina gorunmez
// sifir genislikli bosluk (U+200B) konunca duz yazi olarak cizilir (gercek libass ile denendi). YALNIZ render icin
// kullanilir: kullaniciya giden altyazi.srt / Videos/<is>.srt temiz kalir.
const libassKacis = t => String(t).replace(/\\/g, "\\\u200b").replace(/<(?=[\/!a-zA-Z])/g, "<\u200b");

module.exports = { cumleSonuMu, parcala, altyaziMetni, altyaziKur, srtMetni, srtZaman, temizMetin, libassKacis, MIN_GORUNUR, YATAY_MAKS };
