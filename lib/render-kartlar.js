// lib/render-kartlar.js — intro, konu karti, kapanis (outro) karti ve film lideri geri sayimi.
//
// Tum yazilar lib/yazi.js uzerinden (textfile + expansion=none): kanal adi, slogan ve baslikta
// tek tirnak, iki nokta, yuzde, ters egik cizgi olsa da filtre bozulmaz. Yazi tipi platforma gore
// secilir. Outro metinleri konu.json/panel ayarindan (dil tablosu) gelir; sabit "documentaries"
// ifadesi kalkti.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const ortak = require("./ortak");
const F = require("./render-ffmpeg");
const Y = require("./yazi");
const { RENDER_SURUM } = require("./render-ayar");

const sp = s => Array.from(String(s)).join(" ");        // harf arasi bosluk

// ---- marka gorseli: ufuk cizgisi + patlayan tekillik (profil/banner ile ayni dil) ----
function markaGeq(cx, cy, sc) {
  const line = `exp(-pow(Y-${cy},2)/${(55 * sc * sc).toFixed(0)})*exp(-pow(X-${cx},2)/${(520000 * sc * sc).toFixed(0)})`;
  const core = `exp(-pow(hypot(X-${cx},Y-${cy}),2)/${(2600 * sc * sc).toFixed(0)})`;
  const halo = `exp(-pow(hypot(X-${cx},Y-${cy}),2)/${(150000 * sc * sc).toFixed(0)})`;
  return `geq=r='clip(255*(0.50*${line}+0.80*${core}+0.08*${halo}),0,255)':` +
         `g='clip(255*(0.84*${line}+0.92*${core}+0.18*${halo}),0,255)':` +
         `b='clip(255*(1.0*${line}+1.0*${core}+0.28*${halo}),0,255)'`;
}

// Ortalama karakter genisligi (punto orani), Arial icin: BUYUK harf kucukten belirgin genis. Sabit 0.55 BUYUK HARFLI uzun
// metinde ("ABONE OL VE BİLDİRİMLERİ AÇ") yaziyi karttan tasiriyordu (tam cozunurlukte gorsel olarak denendi).
function ortalamaGenislik(metin, tur) {
  const kalin = tur !== "normal";
  const ks = Array.from(String(metin));
  if (!ks.length) return 0.55;
  let t = 0;
  for (const c of ks) {
    if (c === " ") t += 0.28;
    else if (c !== c.toLocaleLowerCase()) t += kalin ? 0.74 : 0.68;       // BUYUK harf
    else if (/[\p{L}\p{N}]/u.test(c)) t += kalin ? 0.6 : 0.54;
    else t += 0.4;
  }
  return Math.max(0.4, t / ks.length) * 1.04;
}

// Bir drawtext satiri: genislige sigsin diye punto kucultulur
function satir(ayar, tmp, ad, metin, tur, istenen, y, renk, genislikOran, ekstra, harfAraligi) {
  const boyut = Y.sigdir(metin, ayar.W * (genislikOran || 0.9), istenen, ortalamaGenislik(metin, tur));
  return Y.drawtext({ font: tur, metin, dizin: tmp, ad, boyut, renk, x: "(w-text_w)/2", y, ekstra });
}

// PNG kare uret (lavfi renk + filtre) -> hedef
function pngUret(hedef, vf, ayar) {
  return F.uret(hedef, K => ["-f", "lavfi", "-i", `color=c=0x04060B:s=${ayar.W}x${ayar.H}`, "-vf", vf, "-frames:v", "1"], { etiket: path.basename(hedef) });
}

// Durgun PNG'den zoompan'li kisa klip: acilista/kapanista fade
function pngKlip(hedef, png, ayar, sn, zoomIfade, olcek, fadeIn, fadeOut) {
  const W = ayar.W, H = ayar.H, FPS = ayar.FPS;
  const kare = Math.round(sn * FPS);
  const fi = Math.min(fadeIn, sn / 2), fo = Math.min(fadeOut, sn / 2);
  const cift = n => Math.round(n / 2) * 2;
  return F.uret(hedef, K => ["-i", png, "-vf",
    `scale=${cift(W * olcek)}:${cift(H * olcek)},zoompan=z='${zoomIfade}':d=${kare}:` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},setsar=1,` +
    `fade=t=in:st=0:d=${fi.toFixed(2)},fade=t=out:st=${Math.max(0, sn - fo).toFixed(2)}:d=${fo.toFixed(2)},${F.RENK_RGB_YUV}`,
    "-frames:v", String(kare), ...K.ara, "-an"], { etiket: path.basename(hedef), zamanAsimiMs: F.zamanAsimi(sn, 30, 60) });
}

// ---------------------------------------------------------------- INTRO
// Marka animasyonu (yavas zoom + fade). Kanal adi birden fazla kelimeyse son kelime alt satira gecer.
// Kanal adi yoksa yalniz animasyon cizilir.
async function introUret(ayar, tmp, hedef) {
  const W = ayar.W, H = ayar.H, TS = ayar.TS;
  const cx = Math.round(W / 2), cyI = Math.round(H * 0.42), scI = W / 2560;
  const parcalar = [];
  if (ayar.kanal) {
    const p = ayar.kanal.split(/\s+/);
    const ust = p.length > 1 ? p.slice(0, -1).join(" ") : p[0];
    const alt = p.length > 1 ? p[p.length - 1] : "";
    parcalar.push(satir(ayar, tmp, "intro-ust", sp(ust), "kalin", TS(120), Math.round(H * (alt ? 0.53 : 0.575)), "white", 0.9, "", true));
    if (alt) parcalar.push(satir(ayar, tmp, "intro-alt", sp(alt), "kalin", TS(120), Math.round(H * 0.62), ayar.vurgu, 0.9, "", true));
    if (ayar.slogan) parcalar.push(satir(ayar, tmp, "intro-slogan", ayar.slogan, "normal", TS(42), Math.round(H * 0.72), "0xAAB8C4", 0.9));
  }
  const png = path.join(tmp, "intro.png");
  await pngUret(png, `format=rgb24,${markaGeq(cx, cyI, scI)}` + (parcalar.length ? "," + parcalar.join(",") : ""), ayar);
  await pngKlip(hedef, png, ayar, ayar.intro, "min(1+0.00035*on,1.10)", 1.2, 1, 1);
  return hedef;
}

// ---------------------------------------------------------------- KONU KARTI
// Bu video ne anlatiyor: ilk gorsel bulaniklastirilip baslik uzerine yazilir.
async function konuKartiUret(ayar, tmp, hedef, ilkGorsel) {
  const W = ayar.W, H = ayar.H, TS = ayar.TS;
  const maks = Math.max(8, Math.floor(W * 0.88 / (TS(96) * 0.55)));
  const satirlar = Y.satirla(ayar.baslik, maks).slice(0, 5);
  let dt = "";
  satirlar.forEach((ln, i) => {
    dt += "," + satir(ayar, tmp, "konu-" + i, ln, "kalin", TS(96), Math.round(H * 0.42) + i * TS(120), "white", 0.92,
      "shadowcolor=black:shadowx=4:shadowy=4");
  });
  const png = path.join(tmp, "topic.png");
  await F.uret(png, K => ["-i", ilkGorsel, "-vf",
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},eq=brightness=-0.22:contrast=1.05,boxblur=6:1` + dt,
    "-frames:v", "1"], { etiket: "konu-karti-png" });
  await pngKlip(hedef, png, ayar, ayar.konuKarti, "min(1+0.0006*on,1.08)", 1.15, 0.5, 0.6);
  return hedef;
}

// ---------------------------------------------------------------- OUTRO
// Abone ol + bildirim. Metinler outroMetni'ndan (dil tablosu); yalniz outro suresi > 0 ise uretilir.
async function outroUret(ayar, tmp, hedef) {
  const W = ayar.W, H = ayar.H, TS = ayar.TS;
  const cx = Math.round(W / 2), sc = W / 2560;
  const m = ayar.outroMetni || {};
  const y0 = Math.round(H * 0.40);
  const p = [`format=rgb24,${markaGeq(cx, Math.round(H * 0.30), sc)}`];
  if (m.baslik) p.push(satir(ayar, tmp, "outro-baslik", m.baslik, "kalin", TS(170), y0, "white", 0.9, "shadowcolor=black:shadowx=5:shadowy=5"));
  p.push(`drawbox=x=(iw-${TS(760)})/2:y=${y0 + TS(200)}:w=${TS(760)}:h=${TS(9)}:color=${ayar.vurgu}@0.95:t=fill`);
  if (m.alt) p.push(satir(ayar, tmp, "outro-alt", sp(m.alt), "kalin", TS(52), y0 + TS(270), ayar.vurgu, 0.9, "", true));
  if (m.altSlogan) p.push(satir(ayar, tmp, "outro-slogan", m.altSlogan, "normal", TS(46), y0 + TS(370), "0xAAB8C4", 0.9));
  if (ayar.kanal) p.push(satir(ayar, tmp, "outro-kanal", sp(ayar.kanal), "kalin", TS(44), Math.round(H * 0.83), "white", 0.9, "", true));
  const png = path.join(tmp, "outro.png");
  await pngUret(png, p.join(","), ayar);
  await pngKlip(hedef, png, ayar, ayar.outro, "max(1.08-0.0003*on,1.0)", 1.15, 0.8, 1.2);
  return hedef;
}

// ---------------------------------------------------------------- FILM LIDERI GERI SAYIMI
// geri-sayim.js ayri surecte calisir (kendi ses+goruntusunu uretir); .part yazip yeniden adlandirir.
function geriSayimImzasi(ayar) {
  let m = 0;
  try { m = Math.round(fs.statSync(path.join(__dirname, "..", "geri-sayim.js")).mtimeMs); } catch (e) { /* yok sayilir */ }
  return ortak.sha1(["gs", RENDER_SURUM, ayar.W, ayar.H, ayar.FPS, m].join("|")).slice(0, 8);
}
async function geriSayimUret(ayar, tmp, hedef) {
  const betik = path.join(__dirname, "..", "geri-sayim.js");
  await new Promise((coz, red) => {
    execFile(process.execPath, [betik, hedef, String(ayar.W), String(ayar.H)], { timeout: 900000, maxBuffer: 1 << 24, windowsHide: true },
      (e, out, err) => {
        if (!e) return coz();
        red(new ortak.OrtakHata("geri_sayim", "Geri sayım kartı üretilemedi: " + (String(err || e.message).trim().split("\n").pop()), {
          cikis: ortak.CIKIS.GENEL, detay: String(err).slice(-600) }));
      });
  });
  const wav = path.join(tmp, "geri-sayim.wav");
  await F.uret(wav, ["-i", hedef, "-vn", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le"], { etiket: "geri-sayim-ses" });
  return { mp4: hedef, wav };
}

module.exports = { introUret, konuKartiUret, outroUret, geriSayimUret, geriSayimImzasi, markaGeq, sp };
