// lib/render-ortam.js — video kliplerin KENDI sesinden ortam sesi izi kurar (konu.json › ortamSesi > 0).
//
// Her klibin sesi, klibin videoda gorundugu ana yerlestirilir ve goruntuyle ayni sekilde oturtulur:
// yavaslat'ta ayni oranda yavaslar, dongu'de tekrarlanir, dondur/kes'te kaynak bitince susar.
// Klip baslari/sonlari kisa fade ile yumusatilir (gecislerde tik sesi olmasin). Sesi olmayan klip atlanir.
// Seviye ve konusma altinda kisilma render-muzik.js › sesGrafi'nda yapilir.
"use strict";
const fs = require("fs");
const path = require("path");
const F = require("./render-ffmpeg");
const M = require("./render-muzik");

// klip -> { kip, oran, sesSn }: render-klip.js › videoKlipArgv ile ayni karar
function oturtma(ayar, k) {
  const hedefSn = k.kare / ayar.FPS;
  const kaynak = k.kaynakSure > 0 ? k.kaynakSure : hedefSn;
  const kisa = kaynak + 0.05 < hedefSn;
  const kip = kisa ? ayar.klipUzat : "kes";
  const oran = kip === "yavaslat" ? Math.min(2, hedefSn / kaynak) : 1;
  const sesSn = kip === "dongu" ? hedefSn : Math.min(hedefSn, kaynak * oran);
  return { kip, oran, sesSn, hedefSn };
}

// Donus: { wav, I, klipSayisi } ya da null (sesli klip yoksa)
async function ortamSesiKur(ayar, klipler, bodyStart, D, tmp) {
  const adaylar = klipler.filter(k => k.video);
  if (!adaylar.length) return null;
  const bilgiler = await F.paralel(adaylar, 6, k => F.bilgiAsync(k.yol));
  const sesli = adaylar.filter((k, i) => bilgiler[i].ok && bilgiler[i].deger.sesVar);
  if (!sesli.length) return null;

  const girdi = [], satirlar = [], etiketler = [];
  sesli.forEach((k, j) => {
    const o = oturtma(ayar, k);
    if (o.kip === "dongu") girdi.push("-stream_loop", "-1");
    girdi.push("-i", k.yol);
    const ms = Math.round((bodyStart + k.basKare / ayar.FPS) * 1000);
    const fo = Math.min(0.3, o.sesSn / 4);
    const tempo = o.oran > 1.001 ? `atempo=${(1 / o.oran).toFixed(4)},` : "";
    satirlar.push(`[${j}:a]aformat=sample_rates=48000:channel_layouts=stereo,${tempo}atrim=duration=${o.sesSn.toFixed(3)},` +
      `afade=t=in:d=${Math.min(0.15, fo).toFixed(3)},afade=t=out:st=${Math.max(0, o.sesSn - fo).toFixed(3)}:d=${fo.toFixed(3)},adelay=${ms}|${ms}[o${j}]`);
    etiketler.push(`[o${j}]`);
  });
  satirlar.push(`${etiketler.join("")}amix=inputs=${etiketler.length}:duration=longest:dropout_transition=0:normalize=0,` +
    `apad=whole_dur=${D.toFixed(3)},atrim=duration=${D.toFixed(3)}[ortam]`);
  const fcDosya = path.join(tmp, "filter-ortam.txt");
  fs.writeFileSync(fcDosya, satirlar.join(";\n"), "utf8");
  const wav = path.join(tmp, "ortam.wav");
  await F.uret(wav, () => [...girdi, require("../ff-yol").filtreBayragi, fcDosya, "-map", "[ortam]", "-c:a", "pcm_s16le", "-ar", "48000"],
    { cwd: tmp, etiket: "ortam-sesi", zamanAsimiMs: F.zamanAsimi(D, 2, 120), girdiler: sesli.map(k => k.yol) });
  try { fs.unlinkSync(fcDosya); } catch (e) { /* yok */ }
  const I = await M.lufsOlc(["-i", wav], 0, tmp);
  return { wav, I, klipSayisi: sesli.length };
}

module.exports = { ortamSesiKur, oturtma };
