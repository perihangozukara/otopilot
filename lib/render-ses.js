// lib/render-ses.js — seslendirme parcalarini okur, DOGRULAR ve tek anlatim ses dosyasi kurar.
//
// SESSIZ KAYMA YOK: parca sayisi paragraf sayisiyla uyusmuyorsa / seslendirme guncel degilse
// render baslamaz (cikis 4). Zaman cizelgesi MP3 sure tahmininden degil, parcalarin PCM'e
// cozulmus gercek ornek sayisindan kurulur: 100+ parcada birikimli kayma olmaz.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ortak = require("./ortak");
const F = require("./render-ffmpeg");

const ORNEKLEME = 48000;          // anlatim 48 kHz mono 16 bit PCM
const ESKI_BOSLUK = 0.35;         // zamanlama.json olmayan eski islerde parcalar arasi sessizlik

const sesEski = (neden) => new ortak.OrtakHata("ses_eski", "Seslendirme güncel değil: seslendirmeyi yeniden yap", {
  cikis: ortak.CIKIS.YETERSIZ, cozum: neden + " Panelde Seslendirme adımını yeniden çalıştır (node seslendir.js <iş> --yeniden).",
  detay: neden });

// Kanonik paragraf listesi: SESLENDIRME-TAM-METIN.txt. HICBIR grup paragraf dusurmez.
function kanonikParagraflar(voiceDir) {
  const f = path.join(voiceDir, "SESLENDIRME-TAM-METIN.txt");
  let metin = "";
  try { metin = fs.readFileSync(f, "utf8").replace(/^﻿/, ""); } catch (e) { /* yok */ }
  const p = ortak.paragraflaraBol(metin);
  if (!p.length)
    throw new ortak.OrtakHata("senaryo_yok", "Seslendirme metni yok: Voice/SESLENDIRME-TAM-METIN.txt boş ya da eksik.", {
      cikis: ortak.CIKIS.GIRDI, cozum: "Önce senaryoyu yaz (panelde Senaryo adımı) ya da metni elle yapıştır." });
  return p;
}

// Hangi parca dosyalari kullanilacak? Gecerli degilse OrtakHata('ses_eski', cikis 4).
// Donus: { kaynak, parcalar:[{no, yol}], bosluk, z, uyarilar }
function parcalariBul(voiceDir, kanon) {
  const N = kanon.length;
  const uyarilar = [];
  const zYol = path.join(voiceDir, "zamanlama.json");
  let z = null;
  if (fs.existsSync(zYol)) {
    try { z = ortak.jsonOku(zYol, null); }
    catch (e) { throw sesEski("zamanlama.json bozuk (" + e.message + ")."); }
  }
  if (z) {
    if (!ortak.duzNesne(z)) throw sesEski("zamanlama.json geçersiz.");
    if (typeof z.surum === "number" && z.surum > 1) uyarilar.push("zamanlama.json daha yeni bir sürümden (surum " + z.surum + "); alanlar yanlış yorumlanabilir.");
    if (z.metinOzeti !== ortak.paragrafOzeti(kanon)) throw sesEski("Senaryo metni seslendirmeden sonra değişmiş.");
    if (z.paragrafSayisi !== N || !Array.isArray(z.paragraflar) || z.paragraflar.length !== N)
      throw sesEski("Paragraf sayısı uyuşmuyor (senaryo " + N + ", seslendirme " + (z.paragraflar ? z.paragraflar.length : "?") + ").");
    const parcalar = [];
    for (let i = 0; i < N; i++) {
      const p = z.paragraflar[i] || {};
      const no = Number.isInteger(p.no) ? p.no : i;
      const yol = path.resolve(voiceDir, String(p.dosya || ""));
      if (no !== i || !p.dosya || !ortak.yolIcinde(voiceDir, yol) || !fs.existsSync(yol))
        throw sesEski("Paragraf " + (i + 1) + " için ses dosyası yok ya da numarası kaymış.");
      parcalar.push({ no: i, yol, sha: p.sha || null });
    }
    const bosluk = typeof z.bosluk === "number" && z.bosluk >= 0 && z.bosluk < 5 ? z.bosluk : ESKI_BOSLUK;
    return { kaynak: "zamanlama", parcalar, bosluk, z, uyarilar };
  }
  // ESKI IS (zamanlama.json yok): parts/ icinde 0..N-1 kesintisiz mp3 olmali
  const partsDir = path.join(voiceDir, "parts");
  let dosyalar = [];
  try { dosyalar = fs.readdirSync(partsDir).filter(f => /^\d+\.mp3$/.test(f)); } catch (e) { /* klasor yok */ }
  const sayilar = dosyalar.map(f => parseInt(f, 10)).sort((a, b) => a - b);
  if (!sayilar.length) throw sesEski("Ses parçası yok (Voice/parts boş).");
  const eksik = [];
  for (let i = 0; i < Math.max(N, sayilar.length); i++) if (!sayilar.includes(i)) eksik.push(i + 1);
  if (sayilar.length !== N || eksik.length)
    throw sesEski("Ses parçaları paragraflarla uyuşmuyor (senaryo " + N + " paragraf, klasörde " + sayilar.length + " parça" +
      (eksik.length ? "; eksik: " + eksik.slice(0, 8).join(", ") : "") + ").");
  const byNo = new Map(dosyalar.map(f => [parseInt(f, 10), f]));
  uyarilar.push("zamanlama.json yok (eski iş): parça süreleri ölçülerek kuruldu. Seslendirmeyi yeniden yapmak daha doğru altyazı verir.");
  return { kaynak: "eski", parcalar: sayilar.map(i => ({ no: i, yol: path.join(partsDir, byNo.get(i)), sha: null })), bosluk: ESKI_BOSLUK, z: null, uyarilar };
}

// Ses imzasi: seslendirme ayni mi? (final onbellek kontrolu icin; decode gerektirmez)
function sesImzasi(bul, kanon) {
  const imzaParca = [];
  for (const p of bul.parcalar) { const st = fs.statSync(p.yol); imzaParca.push(p.no + ":" + st.size + ":" + Math.round(st.mtimeMs)); }
  return ortak.sha1([ortak.paragrafOzeti(kanon), bul.z ? [bul.z.ses, bul.z.hiz, bul.z.motor].join("|") : "eski", imzaParca.join(",")].join("#"));
}

// mp3 -> ham PCM (s16le mono 48k). Bellege alinir; en cok birkac dakikalik parca.
function pcmCoz(yol) {
  return new Promise((coz, red) => {
    const c = spawn(F.ffmpegYolu(), ["-v", "error", "-i", yol, "-vn", "-f", "s16le", "-acodec", "pcm_s16le",
      "-ar", String(ORNEKLEME), "-ac", "1", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const parca = []; let err = "", bitti = false;
    const t = setTimeout(() => { try { c.kill("SIGKILL"); } catch (e) { /* bitmis */ } }, 120000);
    const son = (fn, v) => { if (bitti) return; bitti = true; clearTimeout(t); fn(v); };
    c.stdout.on("data", d => parca.push(d));
    c.stderr.on("data", d => { err += d.toString("utf8"); if (err.length > 20000) err = err.slice(-10000); });
    c.on("error", e => son(red, e));
    c.on("close", kod => {
      if (kod === 0) return son(coz, Buffer.concat(parca));
      son(red, new ortak.OrtakHata("ses_parca_bozuk", "Ses parçası okunamadı: " + path.basename(yol), {
        cikis: ortak.CIKIS.YETERSIZ, cozum: "Seslendirmeyi yeniden yap (node seslendir.js <iş> --yeniden).",
        detay: F.sonSatirlar(err).slice(-4) }));
    });
  });
}

function wavBaslik(veriBayt) {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0); b.writeUInt32LE(36 + veriBayt, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(ORNEKLEME, 24); b.writeUInt32LE(ORNEKLEME * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(veriBayt, 40);
  return b;
}

// Dogrulanmis parcalardan anlatim.wav kurar; her parcanin GERCEK suresini/baslangicini dondurur.
//   hedefWav: yazilacak yol (.part'a yazilip yeniden adlandirilir)
//   ilerleme(yuzde 0..100)
async function sesHazirla(ctx, hedefWav, ilerleme) {
  const voiceDir = path.join(ctx.dizin, "Voice");
  const kanon = kanonikParagraflar(voiceDir);
  const bul = parcalariBul(voiceDir, kanon);
  const N = kanon.length;
  const bosOrnek = Math.round(bul.bosluk * ORNEKLEME);
  const bosBuf = Buffer.alloc(bosOrnek * 2);

  fs.mkdirSync(path.dirname(hedefWav), { recursive: true });
  const part = hedefWav.replace(/\.wav$/i, "") + ".part.wav";
  const fd = fs.openSync(part, "w");
  const sure = new Array(N), baslangic = new Array(N);
  let ornek = 0;
  try {
    fs.writeSync(fd, Buffer.alloc(44));            // baslik sonda duzeltilecek
    const PARTI = 4;
    for (let a = 0; a < N; a += PARTI) {
      const grup = bul.parcalar.slice(a, a + PARTI);
      const sonuc = await F.paralel(grup, PARTI, p => pcmCoz(p.yol));
      for (let j = 0; j < grup.length; j++) {
        if (!sonuc[j].ok) throw sonuc[j].hata;
        const i = a + j, buf = sonuc[j].deger;
        if (buf.length < 2) throw new ortak.OrtakHata("ses_parca_bozuk", "Ses parçası boş: " + path.basename(grup[j].yol), {
          cikis: ortak.CIKIS.YETERSIZ, cozum: "Seslendirmeyi yeniden yap (node seslendir.js <iş> --yeniden)." });
        baslangic[i] = ornek / ORNEKLEME;
        const n = Math.floor(buf.length / 2);
        sure[i] = n / ORNEKLEME;
        fs.writeSync(fd, buf, 0, n * 2);
        ornek += n;
        if (i < N - 1 && bosOrnek > 0) { fs.writeSync(fd, bosBuf); ornek += bosOrnek; }
      }
      if (ilerleme) ilerleme(Math.round(100 * Math.min(N, a + PARTI) / N));
    }
    fs.writeSync(fd, wavBaslik(ornek * 2), 0, 44, 0);
  } catch (e) {
    try { fs.closeSync(fd); } catch (e2) { /* kapali */ }
    try { fs.unlinkSync(part); } catch (e2) { /* yok */ }
    if (e && (e.code === "ENOSPC" || e.code === "EDQUOT"))
      throw new ortak.OrtakHata("disk_dolu", "Diskte boş yer kalmadı; anlatım sesi yazılamadı.", { cikis: ortak.CIKIS.DISK });
    throw e;
  }
  fs.closeSync(fd);
  fs.renameSync(part, hedefWav);

  const toplam = ornek / ORNEKLEME;
  const uyarilar = bul.uyarilar.slice();
  if (bul.z && typeof bul.z.toplamSn === "number" && Math.abs(bul.z.toplamSn - toplam) > 1.0)
    uyarilar.push("Ses süresi zamanlama.json'dan farklı çıktı (ölçülen " + toplam.toFixed(1) + " sn, kayıtlı " + bul.z.toplamSn.toFixed(1) + " sn); ölçülen değer kullanıldı.");

  // kelime zamanlari (altyazi icin) — varsa ve gecerliyse
  let kelimeler = null;
  const kYol = path.join(voiceDir, "kelimeler.json");
  if (fs.existsSync(kYol)) {
    try {
      const k = ortak.jsonOku(kYol, null);
      if (k && Array.isArray(k.paragraflar) && k.paragraflar.length === N) kelimeler = k.paragraflar;
      else uyarilar.push("kelimeler.json paragraf sayısı uyuşmuyor; altyazı karakter oranıyla kurulacak.");
    } catch (e) { uyarilar.push("kelimeler.json okunamadı (" + e.message + "); altyazı karakter oranıyla kurulacak."); }
  }

  const sesImza = sesImzasi(bul, kanon);

  return { kanon, N, bosluk: bul.bosluk, sure, baslangic, toplam, wav: hedefWav, kaynak: bul.kaynak,
    z: bul.z, kelimeler, uyarilar, sesImza, ozet: ortak.paragrafOzeti(kanon) };
}

// Paragraflarin ARKASINA ek sessizlik koyar (klipTamOynat: anlatim klipten kisa kalinca klip kesilmesin).
//   ekler[i] = paragraf i bittikten sonra eklenecek saniye (0 / tanimsiz = yok)
// anlatim.wav yerinde yeniden yazilir; ses.baslangic ve ses.toplam guncellenir. Eklenen toplam saniyeyi dondurur.
function boslukEkle(ses, ekler) {
  const ekOrnek = ses.sure.map((_, i) => Math.max(0, Math.round((Number(ekler[i]) || 0) * ORNEKLEME)));
  const toplamEk = ekOrnek.reduce((a, n) => a + n, 0);
  if (!toplamEk) return 0;
  const eski = fs.readFileSync(ses.wav);
  const veri = eski.subarray(44);
  const parcalar = [];
  let okunan = 0, kayma = 0;
  for (let i = 0; i < ses.N; i++) {
    const bitis = Math.round((ses.baslangic[i] + ses.sure[i]) * ORNEKLEME);
    ses.baslangic[i] += kayma / ORNEKLEME;
    if (!ekOrnek[i]) continue;
    parcalar.push(veri.subarray(okunan * 2, bitis * 2), Buffer.alloc(ekOrnek[i] * 2));
    okunan = bitis; kayma += ekOrnek[i];
  }
  parcalar.push(veri.subarray(okunan * 2));
  const yeniVeri = Buffer.concat(parcalar);
  const part = ses.wav.replace(/\.wav$/i, "") + ".part.wav";
  fs.writeFileSync(part, Buffer.concat([wavBaslik(yeniVeri.length), yeniVeri]));
  fs.renameSync(part, ses.wav);
  ses.toplam = yeniVeri.length / 2 / ORNEKLEME;
  // sahne zamanlamasi eklenen sessizligi paragrafin SAHNESINE yazsin (render-sahne.js › zamanla)
  ses.ekSonra = ekOrnek.map(n => n / ORNEKLEME);
  return toplamEk / ORNEKLEME;
}

module.exports = { kanonikParagraflar, parcalariBul, sesImzasi, sesHazirla, boslukEkle, pcmCoz, ORNEKLEME, ESKI_BOSLUK };
