// test/render-fikstur.js — render testleri icin SENTETIK is kurar (gercek ffmpeg, ag yok, ucret yok).
//
// Konusma: ffmpeg'in flite sentezleyicisi (yoksa genlik modulasyonlu sinus). Gorsel: lavfi testsrc2/mandelbrot.
// Tum iller `uretim/_test-render-<rastgele>/` altinda; OTOMASYON_URETIM bu klasore, ayar/env dosyalari
// bos gecici dosyalara yonlendirilir: gercek .env ve panel-ayar.json'a ASLA dokunulmaz.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const KOK = path.resolve(__dirname, "..");

function ortamKur() {
  const kok = path.join(KOK, "uretim", "_test-render-" + process.pid + "-" + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(kok, { recursive: true });
  process.env.OTOMASYON_URETIM = kok;
  process.env.OTOMASYON_AYAR_DOSYASI = path.join(kok, "panel-ayar.test.json");
  process.env.OTOMASYON_ENV_DOSYASI = path.join(kok, ".env.test");
  fs.writeFileSync(process.env.OTOMASYON_ENV_DOSYASI, "");
  return kok;
}

function ffmpegVarMi() {
  try { const ff = require("../ff-yol"); void ff.ffmpeg; void ff.ffprobe; return true; } catch (e) { return false; }
}
const FF = () => require("../ff-yol").ffmpeg;
const FP = () => require("../ff-yol").ffprobe;
const ff = args => execFileSync(FF(), ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "pipe", windowsHide: true, timeout: 120000 });
const sureOlc = f => Number(execFileSync(FP(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { windowsHide: true }).toString().trim());

const CUMLELER = [
  "The first paragraph opens the story with a strong hook and a clear promise.",
  "Dr. Smith explained the idea in plain words, and nobody in the room moved.",
  "A second image changes the mood while the narrator keeps a steady pace.",
  "Numbers matter, so we say them slowly: one hundred and twenty three.",
  "The middle part slows down and lets the visuals breathe for a while.",
  "Then a surprising fact arrives and the whole argument turns around.",
  "Now the story speeds up again with shorter sentences. Short ones. Many.",
  "The ending ties every thread together and leaves one open question.",
];

function konusmaUret(metin, hedef, ton) {
  if (ton) {          // cok paragrafli buyuk testler icin: hizli, ~1.2 sn sabit ton
    ff(["-f", "lavfi", "-i", "sine=frequency=" + (200 + (metin.length % 5) * 40) + ":duration=1.2", "-af", "tremolo=f=5:d=0.7", "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", hedef]);
    return;
  }
  const guvenli = metin.replace(/[':\\,]/g, " ");
  try {
    ff(["-f", "lavfi", "-i", "flite=text='" + guvenli + "':voice=slt", "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", hedef]);
  } catch (e) {
    // flite yoksa: konusma benzeri genlik modulasyonlu ton (kelime basina ~0.3 sn)
    const sn = Math.max(1.5, metin.split(/\s+/).length * 0.3);
    ff(["-f", "lavfi", "-i", "sine=frequency=180:duration=" + sn, "-af", "tremolo=f=4:d=0.8", "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", hedef]);
  }
}

// secenek: { ad, paragraf (sayi), konu (konu.json alanlari), sahneBasina (paragraf), gorselBasina, genislik, yukseklik }
function isKur(kok, secenek) {
  const o = Object.assign({ ad: "tjob", paragraf: 4, sahneBasina: 2, gorselBasina: 2, genislik: 1280, yukseklik: 720, konu: {}, ton: false }, secenek || {});
  const ortak = require("../lib/ortak");
  const dizin = path.join(kok, o.ad);
  const voice = path.join(dizin, "Voice"), parts = path.join(voice, "parts"), vis = path.join(dizin, "Visuals");
  for (const d of [parts, vis]) fs.mkdirSync(d, { recursive: true });
  const konu = Object.assign({ surum: 1, baslik_en: "Synthetic Test Video", kanal: "TEST KANAL", slogan: "A test slogan", format: "long",
    geriSayim: 0, intro: 1.5, konuKarti: 0, outro: 3, gecisSure: 0.4, cesitlilik: false, muzikSeviyesi: 0.4 }, o.konu);
  fs.writeFileSync(path.join(dizin, "konu.json"), JSON.stringify(konu, null, 2) + "\n");

  const paragraflar = Array.from({ length: o.paragraf }, (_, i) => CUMLELER[i % CUMLELER.length] + (i >= CUMLELER.length ? " Part " + (i + 1) + "." : ""));
  fs.writeFileSync(path.join(voice, "SESLENDIRME-TAM-METIN.txt"), paragraflar.join("\n\n") + "\n");
  const bosluk = 0.35, zParca = [], kParca = [];
  let baslangic = 0;
  paragraflar.forEach((p, i) => {
    const ad = String(i).padStart(3, "0") + ".mp3", yol = path.join(parts, ad);
    konusmaUret(p, yol, o.ton);
    const sure = sureOlc(yol);
    zParca.push({ no: i, dosya: "parts/" + ad, sureSn: Math.round(sure * 1000) / 1000, baslangicSn: Math.round(baslangic * 1000) / 1000, kelimeSayisi: p.split(/\s+/).length, sha: "t" + i });
    const kel = p.split(/\s+/);
    kParca.push({ no: i, okunanMetin: p, metinDegisti: false, kelimeler: kel.map((w, j) => ({ t: Math.round(j * sure * 1000 / kel.length), d: Math.round(sure * 1000 / kel.length) - 20, w })) });
    baslangic += sure + bosluk;
  });
  const toplam = baslangic - bosluk;
  fs.writeFileSync(path.join(voice, "zamanlama.json"), JSON.stringify({ surum: 1, olusturma: new Date().toISOString(),
    metinOzeti: ortak.paragrafOzeti(paragraflar), dil: "en", ses: "test", motor: "test", hiz: "+0%", bosluk, paragrafSayisi: o.paragraf,
    toplamSn: toplam, hedefSn: toplam, sapmaYuzde: 0, olculenKelimeHizi: 150, paragraflar: zParca }, null, 2) + "\n");
  fs.writeFileSync(path.join(voice, "kelimeler.json"), JSON.stringify({ surum: 1, dil: "en", ses: "test", motor: "test", paragraflar: kParca }, null, 2) + "\n");

  // gorseller + manifest
  const sahneSayisi = Math.ceil(o.paragraf / o.sahneBasina);
  const sahneler = [];
  for (let s = 0; s < sahneSayisi; s++) {
    const klasor = String(s + 1).padStart(3, "0") + "-sahne";
    fs.mkdirSync(path.join(vis, klasor), { recursive: true });
    const paragraflar2 = [];
    for (let p = s * o.sahneBasina; p < Math.min(o.paragraf, (s + 1) * o.sahneBasina); p++) paragraflar2.push(p);
    const gorseller = [];
    for (let g = 0; g < o.gorselBasina; g++) {
      const ad = String(g + 1).padStart(2, "0") + ".jpg", yol = path.join(vis, klasor, ad);
      const kaynak = (s + g) % 2 === 0 ? "testsrc2=s=" + o.genislik + "x" + o.yukseklik : "mandelbrot=s=" + o.genislik + "x" + o.yukseklik + ":end_scale=" + (4 + s);
      if (o.ton) { // hizli: iki taban gorseli kopyala
        const taban = path.join(vis, "_taban-" + (g % 2) + ".jpg");
        if (!fs.existsSync(taban)) ff(["-f", "lavfi", "-i", kaynak + ":r=1", "-frames:v", "1", "-q:v", "3", taban]);
        fs.copyFileSync(taban, yol);
      } else ff(["-f", "lavfi", "-i", kaynak + ":r=1", "-frames:v", "1", "-q:v", "3", yol]);
      gorseller.push({ dosya: klasor + "/" + ad, kaynak: g === 0 && s === 0 ? "pexels" : "wikimedia", lisans: g === 0 && s === 0 ? "Pexels License" : "CC BY 4.0",
        lisansKodu: g === 0 && s === 0 ? "pexels" : "by", atifGerekli: true, atifOnerilen: true, atif: "Test Yazar " + s, baslik: "Test Görsel " + s + "-" + g,
        kaynakUrl: "https://example.test/" + s + "/" + g, en: o.genislik, boy: o.yukseklik });
    }
    sahneler.push({ no: s + 1, klasor, paragraflar: paragraflar2, aramalar: ["test"], kullanilanArama: "test", durum: "tamam", gorseller });
  }
  fs.writeFileSync(path.join(vis, "manifest.json"), JSON.stringify({ surum: 1, olusturma: new Date().toISOString(), kaynakSenaryoSha1: ortak.paragrafOzeti(paragraflar),
    dil: "en", hedefYon: "yatay", sahneler, toplamGorsel: sahneSayisi * o.gorselBasina }, null, 2) + "\n");
  return { dizin, ad: o.ad, paragraflar, toplam, bosluk, zParca };
}

// video-yap.js vb. betigi alt surecte calistir: { kod, stdout, stderr }
function betikCalistir(betik, args, secenek) {
  const o = secenek || {};
  return new Promise(coz => {
    const c = spawn(process.execPath, [path.join(KOK, betik), ...args], { cwd: KOK, windowsHide: true,
      env: Object.assign({}, process.env, { RENDER_OLCEK: process.env.RENDER_OLCEK || "0.25" }, o.env || {}) });
    let out = "", err = "";
    c.stdout.on("data", d => { out += d; if (o.cikti) o.cikti(c, d.toString()); });
    c.stderr.on("data", d => { err += d; });
    const t = setTimeout(() => { try { c.kill("SIGKILL"); } catch (e) { /* bitmis */ } }, o.zamanAsimiMs || 600000);
    c.on("close", kod => { clearTimeout(t); coz({ kod, stdout: out, stderr: err }); });
  });
}

function temizle(kok) { try { fs.rmSync(kok, { recursive: true, force: true }); } catch (e) { /* kilitli olabilir */ } }

module.exports = { ortamKur, ffmpegVarMi, isKur, betikCalistir, temizle, ff, sureOlc, KOK, FF, FP };
