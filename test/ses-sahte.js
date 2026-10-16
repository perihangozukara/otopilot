// test/ses-sahte.js — seslendirme testleri icin ortak yardimcilar (test dosyasi DEGIL).
//
// Gercek ffmpeg (lavfi) ile SENTETIK ses uretir; Edge/Azure/Piper agi SAHTELENIR (enjeksiyon).
// Gercek .env ve panel-ayar.json'a ASLA dokunulmaz: ortam degiskenleri gecici dosyaya cevrilir.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { Readable } = require("stream");

const KOK = path.resolve(__dirname, "..");

// ffmpeg + ffprobe kurulu mu? (CI'da yoksa ffmpeg isteyen testler SKIP edilir.)
// ff-yol.js bulamazsa surec oldurmez; varMi() ffmpeg + ffprobe'u gercekten cozer.
const ffmpegVar = require("../ff-yol.js").varMi();
// ffmpeg gerektiren test: yoksa atlanir
const ffmpegTesti = test => (ad, fn) => (ffmpegVar ? test(ad, fn) : test(ad, { skip: "ffmpeg bulunamadı" }, fn));

// ---- ortam: gercek .env / panel-ayar.json okunmasin ----
function ortamiYalitla() {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), "ses-test-ortam-"));
  const envDosyasi = path.join(dizin, "bos.env");
  fs.writeFileSync(envDosyasi, "");
  process.env.OTOMASYON_ENV_DOSYASI = envDosyasi;
  process.env.OTOMASYON_AYAR_DOSYASI = path.join(dizin, "panel-ayar.json");     // yok -> varsayilanlar
  return { dizin, envDosyasi, temizle: () => fs.rmSync(dizin, { recursive: true, force: true }) };
}

// ---- gecici is klasoru: uretim/_test-ses-<rastgele>/ ----
function testUretimi() {
  const taban = path.join(KOK, "uretim", "_test-ses-" + process.pid + "-" + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(taban, { recursive: true });
  return { taban, temizle: () => fs.rmSync(taban, { recursive: true, force: true }) };
}

function isOlustur(taban, ad, paragraflar) {
  const dizin = path.join(taban, ad);
  fs.mkdirSync(path.join(dizin, "Voice"), { recursive: true });
  if (paragraflar) fs.writeFileSync(path.join(dizin, "Voice", "SESLENDIRME-TAM-METIN.txt"), paragraflar.join("\n\n") + "\n");
  return dizin;
}

// ---- sentetik mp3 (24 kHz mono 96k: Edge ciktisiyla ayni bicim) ----
const _onbellek = new Map();
function sentetikMp3(sn) {
  const anahtar = Math.round(sn * 100);
  if (_onbellek.has(anahtar)) return _onbellek.get(anahtar);
  const ff = require("../ff-yol.js").ffmpeg;
  const buf = execFileSync(ff, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "sine=frequency=440:duration=" + (anahtar / 100), "-ar", "24000", "-ac", "1", "-b:a", "96k", "-f", "mp3", "pipe:1"],
    { maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] });
  _onbellek.set(anahtar, buf);
  return buf;
}

// ---- sahte msedge-tts ----
// karar(istekNo, metin, durum) -> "tam" | "kesik" | "hata" | "asili" | "bos" | "kelimesiz" | "yaridaKapan"
const SN_KELIME = 0.3;
function sahteEdge(karar) {
  const durum = { baglanti: 0, setMetadata: 0, kapatilan: 0, istekler: [] };
  class MsEdgeTTS {
    constructor() { durum.baglanti++; }
    async setMetadata() { durum.setMetadata++; }
    close() { durum.kapatilan++; }
    toStream(metin, secenek) {
      durum.istekler.push({ metin, rate: secenek && secenek.rate });
      const k = karar ? karar(durum.istekler.length, metin, durum) : "tam";
      const audioStream = new Readable({ read() {} });
      const metadataStream = new Readable({ read() {} });
      const kelimeler = metin.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").split(/\s+/).filter(Boolean);
      const sureSn = Math.max(0.6, kelimeler.length * SN_KELIME);
      const metaYolla = adet => {
        for (let i = 0; i < Math.min(adet, kelimeler.length); i++) {
          metadataStream.push(Buffer.from(JSON.stringify({ Metadata: [{ Type: "WordBoundary",
            Data: { Offset: Math.round(i * SN_KELIME * 1000) * 10000, Duration: Math.round(SN_KELIME * 800) * 10000,
                    text: { Text: kelimeler[i], Length: kelimeler[i].length, BoundaryType: "WordBoundary" } } }] })));
        }
      };
      setImmediate(() => {
        if (k === "asili") return;                                   // hicbir sey gelmez
        if (k === "hata") return audioStream.destroy(new Error("Edge WebSocket koptu (sahte)"));
        if (k === "bos") { audioStream.push(null); return; }
        if (k === "yaridaKapan") { audioStream.push(sentetikMp3(sureSn / 2)); return audioStream.destroy(new Error("turn.end gelmedi")); }
        if (k === "kesik") { metaYolla(Math.ceil(kelimeler.length * 0.4)); audioStream.push(sentetikMp3(sureSn * 0.4)); audioStream.push(null); return; }
        if (k !== "kelimesiz") metaYolla(kelimeler.length);
        audioStream.push(sentetikMp3(sureSn));
        audioStream.push(null);
      });
      return { audioStream, metadataStream, requestId: "sahte" };
    }
  }
  return { MsEdgeTTS, OUTPUT_FORMAT: { AUDIO_24KHZ_96KBITRATE_MONO_MP3: "audio-24khz-96kbitrate-mono-mp3" }, durum };
}

// ---- sahte piper calistiricisi: ffmpeg ile WAV yazar ----
function sahtePiperCalistir(karar) {
  const durum = { cagri: 0, girdiler: [] };
  const calistir = async o => {
    durum.cagri++;
    const girdi = String(o.girdi);
    durum.girdiler.push(girdi);
    const k = karar ? karar(durum.cagri, girdi) : "tam";
    if (k === "hata") return { kod: 3, stderr: "model yuklenemedi (sahte)" };
    const wav = o.argv[o.argv.indexOf("--output_file") + 1];
    const kelime = girdi.split(/\s+/).filter(Boolean).length;
    execFileSync(require("../ff-yol.js").ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      "sine=frequency=330:duration=" + Math.max(0.6, kelime * 0.25), "-ar", "22050", "-ac", "1", wav], { stdio: "ignore" });
    return { kod: 0, stderr: "" };
  };
  return { calistir, durum };
}

const hizliAyar = (ek) => Object.assign({
  bekle: async () => {}, zamanAsimiMs: 2000, denemeSayisi: 5,
}, ek || {});

module.exports = { KOK, ffmpegVar, ffmpegTesti, ortamiYalitla, testUretimi, isOlustur, sentetikMp3, sahteEdge, sahtePiperCalistir, hizliAyar, SN_KELIME };
