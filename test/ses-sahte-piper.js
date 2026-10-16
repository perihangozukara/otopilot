// test/ses-sahte-piper.js — GERCEK Piper yerine gecen sahte yurutulebilir (test dosyasi DEGIL).
// PIPER_YOL=<bu dosya> (".js" ise node ile calistirilir). Piper komut satirini taklit eder:
//   --model <onnx> --output_file <wav> [--length_scale X]   metin stdin'den
// Ses: ffmpeg lavfi sinus; sure kelime sayisiyla orantili. Metinde "PIPER_HATA" varsa hata kodu 3.
"use strict";
const { execFileSync } = require("child_process");
const a = process.argv.slice(2);
const al = ad => a[a.indexOf(ad) + 1];
const cikti = al("--output_file");
let girdi = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", d => { girdi += d; });
process.stdin.on("end", () => {
  if (!cikti || !al("--model")) { console.error("eksik arguman"); process.exit(2); }
  if (/PIPER_HATA/.test(girdi)) { console.error("model yuklenemedi (sahte piper)"); process.exit(3); }
  const kelime = girdi.split(/\s+/).filter(Boolean).length;
  const uret = () => execFileSync(require("../ff-yol.js").ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "sine=frequency=330:duration=" + Math.max(0.6, kelime * 0.25), "-ar", "22050", "-ac", "1", cikti], { stdio: "ignore" });
  // SAHTE_PIPER_GECIKME_MS: yavas motor taklidi (Durdur/kesinti testleri icin)
  const gecikme = Number(process.env.SAHTE_PIPER_GECIKME_MS || 0);
  if (gecikme > 0) setTimeout(uret, gecikme); else uret();
});
