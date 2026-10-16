// lib/senaryo-rapor.js — trend / viral rapor yardimcilari (ortak).
//
// Cikti sozlesmesi (panel gosterebilsin diye):
//   trend/<tarih>-<slug>.md + .json        viral-analiz/<tarih>-<slug>.md + .json
//   {surum:1, tur:"trend|viral", tarih, konu, dil, platform,
//    satirlar:[{platform:"youtube-short|youtube-long|instagram|tiktok", baslik, url, izlenme, vph,
//               sureSn, abone, kanal, hook}]}
// Slug ortak.slugla ile (Turkce->ASCII, Latin disi -> n-<sha6>); ayni gun ayni konu ayni ada yazar
// (ust uste yazma bilincli). Farkli konularin slug'i cakisabiliyorsa ("C++", "C#", "C" hep "c"; ilk 40 karakteri ayni
// iki uzun konu) adin sonuna konunun tam metninden sha6 eklenir: farkli konu ayni gun ayni dosyayi ezmez.
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./ortak");

const bicim = n => {
  n = Number(n);
  if (!Number.isFinite(n) || n < 0) n = 0;           // Infinity / NaN / negatif raporda "InfinityB" ya da "NaN" yazmasin (bos listede Math.min = Infinity)
  // esikler YUVARLANMIS degere gore: 999999 "1000K" degil "1.0M" olur
  return n >= 999.95e6 ? (n / 1e9).toFixed(1) + "B" : n >= 999.5e3 ? (n / 1e6).toFixed(1) + "M"
    : n >= 999.5 ? Math.round(n / 1e3) + "K" : String(Math.round(n));
};
const ortanca = a => {
  const s = a.filter(x => typeof x === "number" && isFinite(x)).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const yerelTarih = (d) => {
  d = d || new Date();
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
};

// Testler gercek trend/ ve viral-analiz/ klasorlerini kirletmesin diye ortam degiskeniyle yer degistirilebilir
const raporKoku = () => process.env.OTOMASYON_RAPOR_KOKU ? path.resolve(process.env.OTOMASYON_RAPOR_KOKU) : ortak.KOK;

const SLUG_MAKS = 40;
// Konu adinda ANLAMLI sembol (bitisik + # & @ % ...): slug'a girmez ama konuyu ayirir ("C++" / "C#" / "50%").
const ANLAMLI_SEMBOL = /[\p{L}\p{N}][+#&@%$*=<>~^]|[+#@%$*=<>~^][\p{L}\p{N}]/u;
function raporSlug(konu) {
  const t = String(konu == null ? "" : konu).trim();
  if (!t) return "genel";
  let slug = ortak.slugla(t, { maks: SLUG_MAKS });
  const kirpildi = ortak.slugla(t, { maks: 1000 }) !== slug;
  const sha = ortak.sha1(t).slice(0, 6);
  if ((kirpildi || ANLAMLI_SEMBOL.test(t)) && !slug.endsWith(sha))
    slug = slug.slice(0, SLUG_MAKS - 7).replace(/-+$/, "") + "-" + sha;
  return slug;
}
function raporAdi(konu) {
  return yerelTarih() + "-" + raporSlug(konu);
}

// md: metin, json: nesne. Donus: {md, json} tam yollar
function raporYaz(klasor, konu, md, json) {
  const dizin = path.join(raporKoku(), klasor);
  const ad = raporAdi(konu);
  const mdYol = path.join(dizin, ad + ".md");
  const jsYol = path.join(dizin, ad + ".json");
  ortak.atomikYaz(mdYol, md.endsWith("\n") ? md : md + "\n");
  ortak.atomikJsonYaz(jsYol, json);
  return { md: mdYol, json: jsYol };
}

// ---------------------------------------------------------------- vidIQ satirlarini sozlesme biciminde kur
function youtubeSatiri(v, format) {
  const id = v.videoId || v.id || "";
  const kisa = format === "short";
  return {
    platform: kisa ? "youtube-short" : "youtube-long",
    baslik: String(v.videoTitle || v.title || "").trim(),
    url: id ? "https://www.youtube.com/" + (kisa ? "shorts/" : "watch?v=") + id : "",
    izlenme: Number(v.viewCount) || 0,
    vph: v.vph != null ? Math.round(Number(v.vph) * 10) / 10 : null,
    sureSn: Number(v.videoDuration) || null,
    abone: v.subscriberCount != null ? Number(v.subscriberCount) : null,
    kanal: String(v.channelTitle || v.channelName || "").trim(),
    hook: null,
  };
}

// Instagram/TikTok araci: tek cagrida iki platform. Yapisal veri bicimi sabit degil, bu yuzden
// iki asamali okunur: (1) structuredContent icinde video benzeri nesneler, (2) metin ozetindeki baglantilar.
const PLATFORM_RE = [["instagram", /instagram|reels?\b|\big\b/i], ["tiktok", /tiktok|\btt\b/i]];
function platformBul(...ipuclari) {
  for (const ip of ipuclari) {
    if (!ip) continue;
    for (const [ad, re] of PLATFORM_RE) if (re.test(String(ip))) return ad;
  }
  return null;
}
const ilk = (o, anahtarlar) => { for (const k of anahtarlar) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return null; };
function videoBenzeriMi(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const kimlik = ilk(o, ["url", "permalink", "videoUrl", "link", "shortcode", "videoId", "id"]);
  const veri = ilk(o, ["views", "viewCount", "playCount", "plays", "caption", "description", "title", "hook_0_3s", "hook"]);
  return kimlik !== null && veri !== null;
}
function igTtSatiri(o, ipucu) {
  const url0 = ilk(o, ["url", "permalink", "videoUrl", "link"]);
  const platform = platformBul(ilk(o, ["platform", "source"]), url0, ipucu);
  if (!platform) return null;
  let url = url0 ? String(url0) : "";
  const kod = ilk(o, ["shortcode", "videoId", "id"]);
  if (!url && kod) url = platform === "instagram" ? "https://www.instagram.com/reel/" + kod + "/" : "";
  const baslik = String(ilk(o, ["caption", "description", "title", "text"]) || "").replace(/\s+/g, " ").trim().slice(0, 140);
  const sayi = x => (x === null || x === undefined || isNaN(Number(x)) ? null : Number(x));
  return {
    platform, baslik, url,
    izlenme: sayi(ilk(o, ["views", "viewCount", "playCount", "plays"])) || 0,
    vph: null,
    sureSn: sayi(ilk(o, ["duration", "durationSeconds", "videoDuration"])),
    abone: sayi(ilk(o, ["followers", "followerCount", "subscriberCount"])),
    kanal: String(ilk(o, ["username", "handle", "creator", "author", "ownerUsername", "channel"]) || "").replace(/^@/, ""),
    hook: ilk(o, ["hook_0_3s", "hook", "first3s"]) ? String(ilk(o, ["hook_0_3s", "hook", "first3s"])).replace(/\s+/g, " ").trim().slice(0, 240) : null,
  };
}
function yapisaldanSatirlar(veri) {
  const satirlar = [];
  const gor = new Set();
  const dolas = (x, ipucu, derinlik) => {
    if (!x || typeof x !== "object" || derinlik > 4) return;
    if (Array.isArray(x)) {
      for (const e of x) {
        if (videoBenzeriMi(e)) { const s = igTtSatiri(e, ipucu); if (s && !gor.has(s.url + s.baslik)) { gor.add(s.url + s.baslik); satirlar.push(s); } }
        else dolas(e, ipucu, derinlik + 1);
      }
      return;
    }
    for (const [k, v] of Object.entries(x)) dolas(v, platformBul(k) || ipucu, derinlik + 1);
  };
  dolas(veri, null, 0);
  return satirlar;
}

// Metin ozetini ## basliklarina gore bloklara ayirir: [{baslik, platform, govde}]
function mdBloklari(md) {
  const bloklar = [];
  let simdiki = { baslik: "", platform: null, satirlar: [] };
  for (const l of String(md || "").split(/\r?\n/)) {
    if (/^#{1,4}\s/.test(l)) {
      bloklar.push(simdiki);
      simdiki = { baslik: l, platform: platformBul(l), satirlar: [l] };
    } else simdiki.satirlar.push(l);
  }
  bloklar.push(simdiki);
  return bloklar.filter(b => b.satirlar.some(x => x.trim())).map(b => ({ baslik: b.baslik, platform: b.platform, govde: b.satirlar.join("\n") }));
}

// Platform secimi (ig|tt|hepsi) metne uygulanir. Platform basligi bulunamazsa tum metin doner, uyari=true.
function mdPlatformSuz(md, platform) {
  if (platform !== "instagram" && platform !== "tiktok") return { md, uyari: false };
  const bloklar = mdBloklari(md);
  if (!bloklar.some(b => b.platform)) return { md, uyari: true };
  const sec = bloklar.filter(b => b.platform === platform || !b.platform).map(b => b.govde).join("\n");
  return { md: sec, uyari: false };
}

function metindenSatirlar(md, platformIpucu) {
  const satirlar = [];
  for (const b of mdBloklari(md)) {
    for (const l of b.govde.split("\n")) {
      for (const m of l.matchAll(/\[([^\]]{1,200})\]\((https?:\/\/[^)\s]+)\)/g)) {
        const platform = platformBul(m[2], b.platform, platformIpucu);
        if (!platform) continue;
        const iz = l.match(/([\d.,]+\s?[KMB]?)\s*(?:views|izlenme)/i);
        satirlar.push({ platform, baslik: m[1].trim().slice(0, 140), url: m[2], izlenme: iz ? kisaSayi(iz[1]) : 0,
          vph: null, sureSn: null, abone: null, kanal: "", hook: null });
      }
    }
  }
  return satirlar;
}
function kisaSayi(s) {
  const m = String(s).trim().match(/^([\d.,]+)\s?([KMB])?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, "")) || 0;
  return Math.round(n * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1));
}

module.exports = { bicim, ortanca, yerelTarih, raporKoku, raporAdi, raporSlug, raporYaz, youtubeSatiri, igTtSatiri, yapisaldanSatirlar,
  mdBloklari, mdPlatformSuz, metindenSatirlar, platformBul, kisaSayi };
