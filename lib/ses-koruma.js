// lib/ses-koruma.js — seslendirme betiklerinin (seslendir.js, video-seslendir.js) surec duzeyi korumasi.
//
// NEDEN VAR: msedge-tts, zaman asimiyla iptal edilmis bir istege SONRADAN kare gelirse kendi icinde
// TypeError firlatir (yakalanamaz: websocket olay kancasi). Ham yigin izi + exit 1 yerine:
//   - motor katmani soketi zaten keser (ses-motor-edge.js); yine de kacan bir gec kare bilinen
//     kutuphane hatasiysa yok sayilir (uyariyla) ve is SURER;
//   - baska her yakalanmamis hata/reddedilen soz ortak.bitir ile Turkce tek satir + uygun cikis kodu.
// Yalniz betik GIRISLERINDE (require.main === module) kurulur; testler/panel icinde kurulmaz.
"use strict";
const ortak = require("./ortak.js");

// msedge-tts'in "silinmis istege gec kare" hatasi: TypeError + yigin kutuphane dosyasini gosterir.
function gecKareHatasi(e) {
  if (!(e instanceof TypeError)) return false;
  if (!/Cannot read propert(?:y|ies) of undefined/.test(String(e.message))) return false;
  return /msedge-tts[\\/]/i.test(String(e.stack || ""));
}

let kuruldu = false, bitiyor = false;

// ortak.hataCevir hata TURUNU yigin izinden de siniflar: "Timeout._onTimeout" gibi bir satir sıradan bir
// kod hatasini "internet yok" diye gosterirdi. Beklenmeyen hatada yalniz mesaj (+ ag kodu) siniflanir;
// yigin izi ayrica, girintili satirlar olarak stderr'e yazilir (hata ayiklama icin).
function sade(e) {
  if (e instanceof ortak.OrtakHata || typeof e === "string") return e;
  const kaynak = e instanceof Error ? e : new Error(String(e));
  const h = new Error(kaynak.message);
  for (const alan of ["code", "status", "statusCode"]) if (kaynak[alan] !== undefined) h[alan] = kaynak[alan];
  h.stack = "Error: " + kaynak.message;
  return h;
}

function isle(e) {
  if (gecKareHatasi(e)) {
    ortak.uyari("Edge, iptal edilmiş bir isteğe geç yanıt gönderdi; yok sayıldı.");
    return;
  }
  if (bitiyor) return;                       // ikinci hata ilk cikisi bozmasin
  bitiyor = true;
  if (e instanceof Error && e.stack && !(e instanceof ortak.OrtakHata)) {
    const satirlar = String(e.stack).split("\n").slice(1, 9).map(s => "    " + s.trim()).join("\n");
    try { process.stderr.write("  ! Beklenmeyen hata ayrıntısı:\n" + satirlar + "\n"); } catch (e2) { /* yoksay */ }
  }
  ortak.bitir(sade(e));
}

function kur() {
  if (kuruldu) return;
  kuruldu = true;
  process.on("uncaughtException", isle);
  process.on("unhandledRejection", isle);
}

module.exports = { kur, gecKareHatasi, isle };
