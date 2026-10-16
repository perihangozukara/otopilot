// PANEL: YAYIN DURUMU + PERFORMANS OZETI (SOZLESME 6.6, karar K5).
// Otomatik YouTube yukleme YOK (Google OAuth kimligi + API denetimi gerekir; yayina alma urun sahibinin kapisi).
// Yerine: yayin paketi + el ile "yuklendi" isaretleme + performans geri bildirimi.
//
// uretim/<is>/yayin-durum.json:
//   {surum:1, guncelleme, platformlar:{youtube:{durum:"hazir|planli|yuklendi", url, videoId, guncelleme}, instagram:{...}, tiktok:{...}}}
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./ortak");
const { HttpHata } = require("./panel-http");
const isler = require("./panel-isler");

const PLATFORMLAR = { youtube: "youtube", yt: "youtube", instagram: "instagram", ig: "instagram", tiktok: "tiktok", tt: "tiktok" };
const DURUMLAR = ["hazir", "planli", "yuklendi"];

// YouTube video kimligi: izleme/kisa/youtu.be adreslerinden ya da dogrudan 11 karakterlik kimlikten
function videoIdCikar(url, videoId) {
  if (typeof videoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(videoId.trim())) return videoId.trim();
  if (typeof url !== "string") return null;
  let m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/) || url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) || url.match(/youtube\.com\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function yayinIsaretle(is, g) {
  // Yalniz KENDI anahtarlari: "constructor" / "__proto__" gibi miras ozellikler gecerli platform sanilip yayin-durum.json'a
  // "function Object() { [native code] }" anahtariyla yaziliyordu.
  const platformAdi = typeof g.platform === "string" ? g.platform.toLowerCase() : "";
  const platform = Object.prototype.hasOwnProperty.call(PLATFORMLAR, platformAdi) ? PLATFORMLAR[platformAdi] : undefined;
  if (!platform) throw new HttpHata(400, "platform", "Platform youtube, instagram ya da tiktok olmalı.");
  if (!DURUMLAR.includes(g.durum)) throw new HttpHata(400, "durum", "Durum şunlardan biri olmalı: " + DURUMLAR.join(", ") + ".");
  let url = null;
  if (g.url !== undefined && g.url !== null && g.url !== "") {
    if (typeof g.url !== "string" || g.url.length > 500 || !/^https?:\/\//i.test(g.url)) throw new HttpHata(400, "url", "Adres http(s):// ile başlamalı (en çok 500 karakter).");
    // gecerli bir adres olmali; tirnak/bosluk/kontrol karakterli degerler reddedilir, kayit normallestirilmis haliyle (u.href) tutulur
    let u = null;
    try { u = new URL(g.url); } catch (e) { u = null; }
    if (!u || (u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password || /[\s"'<>`\\\u0000-\u001f]/.test(g.url))
      throw new HttpHata(400, "url", "Adres geçerli bir http(s) bağlantısı olmalı (boşluk, tırnak ve kullanıcı adı/parola içeremez).");
    url = u.href;
  }
  const videoId = platform === "youtube" ? videoIdCikar(url, g.videoId) : null;
  if (g.videoId && platform === "youtube" && !videoId) throw new HttpHata(400, "video_id", "YouTube video kimliği 11 karakterlik olmalı.");
  const dosya = path.join(ortak.isDizin(is), "yayin-durum.json");
  const mevcut = isler.jsonSessiz(dosya, null);
  const o = mevcut && ortak.duzNesne(mevcut) && ortak.duzNesne(mevcut.platformlar) ? mevcut : { surum: 1, platformlar: {} };
  o.surum = 1; o.guncelleme = new Date().toISOString();
  o.platformlar[platform] = { durum: g.durum, url, videoId, guncelleme: o.guncelleme };
  ortak.atomikJsonYaz(dosya, o);
  return o;
}

// Isler arasi performans: izlenme / sure -> basit oneri
function performansOzeti() {
  const liste = [];
  let adlar = [];
  try { adlar = fs.readdirSync(ortak.uretimDizini(), { withFileTypes: true }).filter(d => d.isDirectory() && ortak.guvenliAd(d.name)).map(d => d.name); } catch (e) {}
  for (const is of adlar) {
    const p = isler.jsonSessiz(path.join(ortak.uretimDizini(), is, "performans.json"), null);
    if (!p || !ortak.duzNesne(p) || typeof p.izlenme !== "number") continue;
    const rs = isler.jsonSessiz(path.join(ortak.uretimDizini(), is, "render-sonuc.json"), null);
    liste.push({ is, izlenme: p.izlenme, sureSn: rs && Number(rs.sureSn) > 0 ? Math.round(Number(rs.sureSn)) : null });
  }
  liste.sort((a, b) => b.izlenme - a.izlenme);
  return { isler: liste, oneri: oneriUret(liste) };
}
const KOVALAR = [[60, "1 dakikadan kısa"], [180, "1–3 dakika"], [600, "3–10 dakika"], [1200, "10–20 dakika"], [Infinity, "20 dakikadan uzun"]];
function oneriUret(liste) {
  const olcumlu = liste.filter(x => x.sureSn);
  if (olcumlu.length < 3) return "Öneri için en az 3 yayınlanmış ve ölçülmüş video gerekli (şu an " + olcumlu.length + ").";
  const grup = new Map();
  for (const x of olcumlu) {
    const [, ad] = KOVALAR.find(([maks]) => x.sureSn < maks);
    if (!grup.has(ad)) grup.set(ad, []);
    grup.get(ad).push(x.izlenme);
  }
  let en = null;
  for (const [ad, v] of grup) { const ort = v.reduce((a, b) => a + b, 0) / v.length; if (!en || ort > en.ort) en = { ad, ort, n: v.length }; }
  return "Şu ana kadar en iyi ortalama izlenme " + en.ad + " videolarda (" + Math.round(en.ort) + " izlenme, " + en.n + " video). Az örneğe dayanır; kesin kural değil.";
}

module.exports = { yayinIsaretle, performansOzeti, videoIdCikar, oneriUret, PLATFORMLAR };
