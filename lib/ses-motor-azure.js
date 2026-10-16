// lib/ses-motor-azure.js — Azure Speech (resmi REST + SSML). Ticari haklari net, anahtar ister.
//
// .env:  AZURE_SPEECH_KEY=...   AZURE_SPEECH_REGION=westeurope   (portal > Speech > Keys and Endpoint)
// Ses adi Edge ile ORTAK katalogdur (en-US-ChristopherNeural, tr-TR-AhmetNeural...).
// REST yaniti kelime zamani vermez: kelimeler [] doner (altyazi karakter oranina duser).
//
// Ag cagrisi {getir} ile enjekte edilir (testte sahte). Varsayilan: https.request.
"use strict";
const https = require("https");
const { xmlKacis } = require("./ses-metin.js");

const SES_ADI = /^[A-Za-z0-9-]{3,80}$/;
const BOLGE = /^[a-z0-9]{2,30}(?:-[a-z0-9]{1,20})*$/;          // ana makine adina girer: kisitli
const MAKS_YANIT = 40 * 1024 * 1024;

function hata(mesaj, secenek) {
  const e = new Error(mesaj);
  Object.assign(e, secenek || {});
  return e;
}

function varsayilanGetir(url, o) {
  return new Promise((coz, red) => {
    const u = new URL(url);
    const istek = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: o.method || "POST",
      headers: Object.assign({}, o.headers, { "Content-Length": Buffer.byteLength(o.govde || "") }),
      timeout: o.zamanAsimiMs || 45000,
    }, res => {
      const c = []; let n = 0;
      res.on("data", d => {
        n += d.length;
        if (n > MAKS_YANIT) { istek.destroy(new Error("Azure yanıtı beklenenden büyük")); return; }
        c.push(d);
      });
      res.on("end", () => coz({ durum: res.statusCode, basliklar: res.headers, govde: Buffer.concat(c) }));
      res.on("error", red);
    });
    istek.on("error", red);
    istek.on("timeout", () => istek.destroy(new Error("Azure zaman aşımı")));
    if (o.sinyal) {
      if (o.sinyal.aborted) istek.destroy(o.sinyal.reason);
      else o.sinyal.addEventListener("abort", () => istek.destroy(o.sinyal.reason), { once: true });
    }
    istek.end(o.govde || "");
  });
}

function olustur(ayar) {
  const ses = String(ayar.ses || "");
  if (!SES_ADI.test(ses)) throw hata("Geçersiz ses adı: '" + ses + "'", { kalici: true });
  const anahtar = String(ayar.anahtar || "").trim();
  const bolge = String(ayar.bolge || "").trim().toLowerCase();
  if (!anahtar) throw hata("AZURE_SPEECH_KEY tanımlı değil", { kalici: true });
  if (!BOLGE.test(bolge)) throw hata("AZURE_SPEECH_REGION geçersiz (örnek: westeurope)", { kalici: true });
  const getir = ayar.getir || varsayilanGetir;
  const url = "https://" + bolge + ".tts.speech.microsoft.com/cognitiveservices/v1";
  const xmlDil = (/^[A-Za-z]{2,3}-[A-Za-z0-9]{2,8}/.exec(ses) || ["en-US"])[0];

  async function sentez(metin, secenek) {
    const sinyal = secenek && secenek.sinyal;
    const ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="' + xmlDil + '">' +
      '<voice name="' + ses + '"><prosody rate="' + xmlKacis(String(ayar.hiz || "+0%")) + '">' +
      xmlKacis(metin) + "</prosody></voice></speak>";
    const r = await getir(url, {
      method: "POST", govde: ssml, sinyal, zamanAsimiMs: ayar.zamanAsimiMs || 45000,
      headers: {
        "Ocp-Apim-Subscription-Key": anahtar,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
        "User-Agent": "youtube-otomasyon",
      },
    });
    const d = r && r.durum;
    if (d === 200) {
      if (!r.govde || r.govde.length < 200) throw hata("Azure boş ya da çok kısa ses döndürdü");
      return { buf: r.govde, kelimeler: [] };
    }
    const govde = r && r.govde ? String(r.govde).slice(0, 200) : "";
    if (d === 401 || d === 403)
      throw hata("Azure Speech anahtarı ya da bölgesi geçersiz (HTTP " + d + ")", { kalici: true, kod: "anahtar_gecersiz" });
    if (d === 400)
      throw hata("Azure isteği reddetti (HTTP 400): ses adı ya da metin geçersiz olabilir. " + govde, { kalici: true });
    if (d === 429) {
      const ra = Number(r.basliklar && r.basliklar["retry-after"]);
      throw hata("Azure istek sınırı (HTTP 429)", { beklemeMs: Number.isFinite(ra) ? Math.min(ra, 60) * 1000 : 0 });
    }
    throw hata("Azure Speech hata verdi (HTTP " + d + ")");
  }

  return { ad: "azure", kelimeZamani: false, ses, sentez, sifirla: async () => {}, kapat: () => {} };
}

module.exports = { olustur, varsayilanGetir };
