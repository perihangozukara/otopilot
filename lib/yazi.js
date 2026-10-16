// lib/yazi.js — ffmpeg drawtext icin ortak yardimcilar (font yolu, guvenli metin, sigdirma).
//
// NEDEN VAR: metin (kanal adi, slogan, baslik) eskiden dogrudan filtre dizgisine
// gomuluyordu. Tek tirnak, iki nokta, yuzde ve ters egik cizgi filtre soz dizimini
// bozuyordu ("Bob's Facts", "Bilim: Basitce", "30% daha hizli"). Burada metin UTF-8
// bir dosyaya yazilip `textfile=...:expansion=none` ile okutulur; HICBIR karakter
// ozel olmaz. Yol kacisi de (font, textfile) tek yerde, gercek ffmpeg ile denenmis
// sekilde yapilir.
//
// Font yolu platforma gore secilir; projede `fonts/` klasoru varsa once oradakine
// bakilir (kalin.ttf, normal.ttf, impact.ttf, mono.ttf, mono-kalin.ttf, sembol.ttf).
"use strict";
const fs = require("fs");
const path = require("path");

const KOK = path.join(__dirname, "..");
const TURLER = ["kalin", "normal", "impact", "mono", "mono-kalin", "sembol"];

// Hata: ortak.js varsa OrtakHata, yoksa ayni alanlara sahip duz Error.
function hata(kod, mesaj, secenek) {
  try {
    const O = require("./ortak");
    if (O && O.OrtakHata) {
      const e = new O.OrtakHata(kod, mesaj, secenek);
      if (e && e.cikis === undefined && secenek && secenek.cikis !== undefined) e.cikis = secenek.cikis;
      return e;
    }
  } catch (e) { /* ortak.js yok ya da bozuk: duz Error'a dus */ }
  const e = new Error(mesaj);
  e.kod = kod;
  Object.assign(e, secenek || {});
  return e;
}

// ffmpeg filtre dizgisinde TEK TIRNAK ICINDE kullanilacak yol kacisi.
// Gercek ffmpeg 8 ile denendi: ':' -> '\:' ; "'" -> "'\\\''" (tirnagi kapat, kacir, ac).
// `, [ ] ; % & # bosluk` tirnak icinde zaten serbest.
//   kullanim:  fontfile='${kacisliYol(p)}'   textfile='${kacisliYol(p)}'
function kacisliYol(p) {
  return String(p).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\\\\\''");
}

// ---- font bulma ------------------------------------------------------------
function sistemAdaylari(tur) {
  if (process.platform === "win32") {
    const f = path.join(process.env.WINDIR || process.env.SystemRoot || "C:\\Windows", "Fonts");
    const t = {
      kalin: ["arialbd.ttf", "segoeuib.ttf", "calibrib.ttf"],
      normal: ["arial.ttf", "segoeui.ttf", "calibri.ttf"],
      impact: ["impact.ttf"],
      mono: ["consola.ttf", "cour.ttf"],
      "mono-kalin": ["consolab.ttf", "courbd.ttf"],
      sembol: ["seguisym.ttf", "seguiemj.ttf"],
    };
    return (t[tur] || []).map(a => path.join(f, a));
  }
  if (process.platform === "darwin") {
    const S = "/System/Library/Fonts/Supplemental/", Y = "/System/Library/Fonts/";
    const t = {
      kalin: [S + "Arial Bold.ttf", Y + "Helvetica.ttc"],
      normal: [S + "Arial.ttf", Y + "Helvetica.ttc"],
      impact: [S + "Impact.ttf", S + "Arial Black.ttf"],
      mono: [S + "Courier New.ttf", Y + "Menlo.ttc"],
      "mono-kalin": [S + "Courier New Bold.ttf", Y + "Menlo.ttc"],
      sembol: [Y + "Apple Symbols.ttf", S + "Arial Unicode.ttf"],
    };
    return t[tur] || [];
  }
  const D = "/usr/share/fonts/truetype/dejavu/", L = "/usr/share/fonts/truetype/liberation/",
    L2 = "/usr/share/fonts/liberation/", D2 = "/usr/share/fonts/dejavu/", D3 = "/usr/share/fonts/TTF/";
  const t = {
    kalin: [D + "DejaVuSans-Bold.ttf", L + "LiberationSans-Bold.ttf", L2 + "LiberationSans-Bold.ttf", D2 + "DejaVuSans-Bold.ttf", D3 + "DejaVuSans-Bold.ttf"],
    normal: [D + "DejaVuSans.ttf", L + "LiberationSans-Regular.ttf", L2 + "LiberationSans-Regular.ttf", D2 + "DejaVuSans.ttf", D3 + "DejaVuSans.ttf"],
    impact: [D + "DejaVuSans-Bold.ttf", L + "LiberationSans-Bold.ttf", L2 + "LiberationSans-Bold.ttf", D3 + "DejaVuSans-Bold.ttf"],
    mono: [D + "DejaVuSansMono.ttf", L + "LiberationMono-Regular.ttf", L2 + "LiberationMono-Regular.ttf", D3 + "DejaVuSansMono.ttf"],
    "mono-kalin": [D + "DejaVuSansMono-Bold.ttf", L + "LiberationMono-Bold.ttf", L2 + "LiberationMono-Bold.ttf", D3 + "DejaVuSansMono-Bold.ttf"],
    sembol: [D + "DejaVuSans.ttf", D3 + "DejaVuSans.ttf"],
  };
  return t[tur] || [];
}

// Bir tur bulunamazsa siradaki yakin tura dusulur (impact -> kalin gibi).
const YEDEK_TUR = {
  kalin: ["normal"], normal: ["kalin"], impact: ["kalin", "normal"],
  mono: ["normal"], "mono-kalin": ["mono", "kalin"], sembol: ["normal", "kalin"],
};

function projeFontu(tur) {
  const d = path.join(KOK, "fonts");
  for (const uz of [".ttf", ".otf"]) {
    const y = path.join(d, tur + uz);
    if (fs.existsSync(y)) return y;
  }
  return null;
}

function turBul(tur) {
  const p = projeFontu(tur);
  if (p) return p;
  for (const y of sistemAdaylari(tur)) if (fs.existsSync(y)) return y;
  return null;
}

// Cozulmus (kacissiz) mutlak font yolu; bulunamazsa OrtakHata('font_yok', cikis 2).
function fontDosyasi(tur) {
  tur = tur || "kalin";
  if (!TURLER.includes(tur)) throw hata("font_yok", "Bilinmeyen font turu: " + tur, { cikis: 2 });
  for (const t of [tur, ...(YEDEK_TUR[tur] || []), "kalin", "normal"]) {
    const y = turBul(t);
    if (y) return y;
  }
  throw hata("font_yok", "Yazı tipi bulunamadı (" + tur + ")", {
    cikis: 2,
    cozum: "Projeye fonts/ klasörü açıp içine kalin.ttf ve normal.ttf (Türkçe karakterli bir font) koy.",
  });
}

// ffmpeg-kacisli font yolu: fontfile='${fontYolu("kalin")}'
function fontYolu(tur) {
  return kacisliYol(fontDosyasi(tur));
}

// ---- metin dosyasi ---------------------------------------------------------
// UTF-8 (BOM'suz), sonda satir sonu YOK (drawtext sondaki satir sonunu kutu olarak cizebilir).
// Donus: tek tirnak icinde kullanilacak kacisli mutlak yol.
function metinDosyasi(metin, dizin, ad) {
  fs.mkdirSync(dizin, { recursive: true });
  let dosyaAdi = String(ad || "metin").replace(/[^A-Za-z0-9_.-]/g, "_");
  if (!/\.[A-Za-z0-9]+$/.test(dosyaAdi)) dosyaAdi += ".txt";
  const yol = path.resolve(dizin, dosyaAdi);
  const icerik = String(metin == null ? "" : metin).replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  fs.writeFileSync(yol, icerik, "utf8");
  return kacisliYol(yol);
}

// ---- drawtext --------------------------------------------------------------
// font: tur adi ("kalin"...) ya da fontYolu() sonucu (kacisli yol).
// x, y: sayi ya da ffmpeg ifadesi ("(w-text_w)/2"). ekstra: "borderw=4:bordercolor=black" gibi.
// Donus: "drawtext=fontfile='…':textfile='…':expansion=none:fontsize=…:fontcolor=…:x=…:y=…[:ekstra]"
function drawtext(o) {
  const font = TURLER.includes(o.font) ? fontYolu(o.font) : (o.font || fontYolu("kalin"));
  const tf = metinDosyasi(o.metin, o.dizin, o.ad);
  const p = [
    `fontfile='${font}'`,
    `textfile='${tf}'`,
    "expansion=none",
    `fontsize=${o.boyut == null ? 48 : o.boyut}`,
    `fontcolor=${o.renk || "white"}`,
    `x=${o.x == null ? "(w-text_w)/2" : o.x}`,
    `y=${o.y == null ? "(h-text_h)/2" : o.y}`,
  ];
  if (o.ekstra) p.push(String(o.ekstra).replace(/^:+/, ""));
  return "drawtext=" + p.join(":");
}

// ---- sigdirma / satirlama --------------------------------------------------
// Arial/Impact'te ortalama karakter genisligi ~0.52 x punto. Metin genislige
// sigmazsa punto kucultulur (en az 12). Donus: tam sayi punto.
function sigdir(metin, genislikPx, istenenPunto, oran) {
  const o = oran || 0.52;
  const n = Math.max(1, Array.from(String(metin == null ? "" : metin)).length);
  const g = Math.floor(genislikPx / (n * o));
  return Math.max(12, Math.min(istenenPunto, g));
}

// Kelime sarma. maksKarakter'den uzun tek kelime sert bolunur. Donus: satir dizisi.
function satirla(metin, maksKarakter) {
  const maks = Math.max(4, Math.floor(maksKarakter || 30));
  const kelimeler = String(metin == null ? "" : metin).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const satirlar = [];
  let cur = "";
  for (let k of kelimeler) {
    while (Array.from(k).length > maks) {           // cok uzun kelime
      const parca = Array.from(k);
      if (cur) { satirlar.push(cur); cur = ""; }
      satirlar.push(parca.slice(0, maks).join(""));
      k = parca.slice(maks).join("");
    }
    if (!cur) cur = k;
    else if (Array.from(cur + " " + k).length > maks) { satirlar.push(cur); cur = k; }
    else cur += " " + k;
  }
  if (cur) satirlar.push(cur);
  return satirlar;
}

module.exports = { fontYolu, fontDosyasi, metinDosyasi, drawtext, kacisliYol, sigdir, satirla, TURLER };
