// Lara & Tikky'nin seçili VoxCPM2 sesiyle Otopilot işi için paragraf WAV'ları üretir.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ortak = require("./lib/ortak.js");
const hazir = require("./lib/ses-hazir.js");

function calistir(dosya, args) {
  return new Promise((coz, red) => {
    const p = spawn(dosya, args, { stdio: "inherit", windowsHide: true });
    p.on("error", red);
    p.on("close", kod => kod === 0 ? coz() : red(new ortak.OrtakHata("voxcpm2_basarisiz", "VoxCPM2 üretimi başarısız (çıkış " + kod + ").", { cikis: 1 })));
  });
}

async function ana(argv) {
  const { konum, bayrak } = ortak.argumanCoz(argv, { deger: ["python", "referans"], mantik: ["yeniden"] });
  const is = konum[0];
  if (!is) throw new ortak.OrtakHata("arguman", "İş adı gerekli.", { cikis: 2, cozum: "Kullanım: node voxcpm2-seslendir.js <iş> [--yeniden] [--python <python.exe>] [--referans <ses.wav>]" });
  const dizin = ortak.isDizin(is);
  if (!fs.existsSync(dizin)) throw new ortak.OrtakHata("is_yok", "İş bulunamadı: " + is, { cikis: 2 });
  ortak.kilitAl(is, "seslendir");
  try {
    const metin = path.join(dizin, "Voice", "SESLENDIRME-TAM-METIN.txt");
    if (!fs.existsSync(metin)) throw new ortak.OrtakHata("senaryo_yok", "Voice/SESLENDIRME-TAM-METIN.txt bulunamadı.", { cikis: 2 });
    const konu = ortak.konuEtkin(is) || {};
    const dil = String(konu.dil || "tr").slice(0, 2).toLowerCase();
    // Yerel yollar: --python/--referans > ortam (VOXCPM2_PYTHON, VOXCPM2_REFERANS) > yerel-ayar.json (git'e girmez)
    let yerel = {};
    try { yerel = ortak.jsonOku(path.join(__dirname, "yerel-ayar.json"), {}) || {}; } catch (e) { /* yoksa boş */ }
    const vox = ortak.duzNesne(yerel.voxcpm2) ? yerel.voxcpm2 : {};
    const python = typeof bayrak.python === "string" ? bayrak.python : (process.env.VOXCPM2_PYTHON || vox.python || "python");
    const referans = typeof bayrak.referans === "string" ? bayrak.referans : (process.env.VOXCPM2_REFERANS || vox.referans || "");
    if (!referans) throw new ortak.OrtakHata("referans_yok", "VoxCPM2 referans sesi verilmedi.", { cikis: 2,
      cozum: "--referans <ses.wav> ver ya da yerel-ayar.json içine {\"voxcpm2\": {\"python\": \"...\", \"referans\": \"...wav\"}} yaz." });
    const pyScript = path.join(__dirname, "voxcpm2-seslendir.py");
    const ffmpeg = require("./lib/render-ffmpeg").ffmpegYolu();
    const args = [pyScript, "--metin", metin, "--cikti", path.join(dizin, "Voice", "hazir"), "--referans", referans, "--ffmpeg", ffmpeg];
    if (bayrak.yeniden) args.push("--yeniden");
    // konu.json "cumleEs": cümleler arası sessizlik (sn, varsayılan 0.6).
    const cumleEs = Number.isFinite(konu.cumleEs) ? konu.cumleEs : 0.6;
    args.push("--cumle-es", String(cumleEs));
    // konu.json "okunus" yalnız VoxCPM2'ye giden metne uygulanır; altyazı ve metin özeti özgün metinden kalır.
    let okunusDizin = null;
    if (konu.okunus && typeof konu.okunus === "object" && Object.keys(konu.okunus).length) {
      okunusDizin = fs.mkdtempSync(path.join(require("os").tmpdir(), "voxcpm2-okunus-"));
      const okunusYolu = path.join(okunusDizin, "okunus.json");
      fs.writeFileSync(okunusYolu, JSON.stringify(konu.okunus), "utf8");
      args.push("--okunus", okunusYolu);
    }
    try {
      await calistir(python, args);
    } finally {
      if (okunusDizin) fs.rmSync(okunusDizin, { recursive: true, force: true });
    }
    const r = hazir.kullan(dizin, dil);
    if (!r) throw new ortak.OrtakHata("voxcpm2_bos", "VoxCPM2 WAV dosyaları oluşmadı.", { cikis: 1 });
    ortak.sonuc({ paragrafSayisi: r.paragrafSayisi, toplamSn: r.toplamSn, motor: r.motor, ses: r.ses });
  } finally {
    ortak.kilitBirak(is);
  }
}

if (require.main === module) {
  require("./lib/ses-koruma.js").kur();
  ana(process.argv.slice(2)).then(() => {
    const t = setTimeout(() => process.exit(0), 1500);
    if (t.unref) t.unref();
  }).catch(ortak.bitir);
}

module.exports = { ana };
