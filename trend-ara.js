// TREND ARAMA — YouTube + Instagram + TikTok, tek raporda.
//
// Kullanim:
//   node trend-ara.js "konu"                    ucu birden
//   node trend-ara.js "konu" --dil tr           Turkce icerik
//   node trend-ara.js "konu" --min 500000       Instagram/TikTok izlenme esigi
//   node trend-ara.js "konu" --vph 150          YouTube saatlik izlenme esigi
//   node trend-ara.js "konu" --platform yt      yalniz YouTube   (yt | ig | tt | hepsi)
//   node trend-ara.js "konu" --siki             YouTube'da tum kelimeler gecsin
//   node trend-ara.js                           konu vermeden genel trend
//
// --platform GERCEKTEN uygulanir: "yt" iken Instagram/TikTok araci hic cagrilmaz (kredi harcanmaz);
// "ig" ve "tt" iken YouTube cagrilmaz. vidIQ'nun Instagram+TikTok araci tek cagrida ikisini
// dondurdugu icin "ig"/"tt" secilince yalniz o platformun bolumu rapora girer.
//
// Cikti: trend/<tarih>-<konu>.md + .json  ({surum:1,tur:"trend",tarih,konu,dil,platform,satirlar:[...]})
// Panel .json'u tablo olarak gosterir ve her satirdan "Bu konuda video yap" baslatabilir.
//
// YouTube tarafi HIZ olcer (saatlik izlenme) — su an ne patliyor.
// Instagram/TikTok tarafi ASIRI PERFORMANS olcer — hesabin kendi ortalamasini kac kat asmis.
//
// Cikis kodlari: 0 tamam (bos sonuc dahil) | 2 vidIQ anahtari yok / gecersiz bayrak | 3 vidIQ hatasi
"use strict";
const ortak = require("./lib/ortak");
const R = require("./lib/senaryo-rapor");
const K = require("./lib/senaryo-kullanim");
const V = require("./lib/vidiq");

const { OrtakHata, CIKIS } = ortak;
const BETIK = "trend-ara.js";
const PLATFORM_TAKMA = { yt: "yt", youtube: "yt", ig: "ig", instagram: "ig", tt: "tt", tiktok: "tt", hepsi: "hepsi", all: "hepsi" };
const BASLIK_DILLERI = new Set(["en", "es", "ja", "ru", "ko", "ar", "hi", "vi", "id", "th", "tr", "de", "fr", "pl", "pt", "uk", "it", "mr", "fa"]);

// Rapor govdesi + satirlar. veri: {yt:[{etiket,format,videolar}], ig:{md, satirlar}|null}
function raporKur(ayar, veri) {
  const { konu, dil, esik, vph, platform, tarih } = ayar;
  const satir = [], y = s => satir.push(s);
  y("# Trend Arama" + (konu ? " - " + konu : ""));
  y("");
  y("Tarih: " + tarih + " - Dil: " + dil + " - Platform: " + platform);
  const esikler = [];
  if (veri.yt.length) esikler.push("YouTube eşiği: " + vph + " izlenme/saat");
  if (veri.ig) esikler.push("Instagram/TikTok eşiği: " + R.bicim(esik) + "+ izlenme");
  y(esikler.join(" - "));
  y("");

  for (const b of veri.yt) {
    y("## YouTube - " + b.etiket);
    y("");
    if (!b.videolar.length) {
      y("Bu eşikte sonuç yok. Şu anda " + dil + " dilinde, saatte " + vph + "+ izlenme alan" +
        (konu ? " ve \"" + konu + "\" ile ilgili" : "") + " trend video bulunamadı.");
      y("");
      y("Deneyebileceklerin:");
      y("- eşiği düşür: `--vph 50`");
      y("- konuyu genelleştir ya da boş bırak");
      y("- dili değiştir: `--dil tr`");
      y("");
      continue;
    }
    const sureler = b.videolar.map(x => x.videoDuration).filter(n => typeof n === "number" && n > 0);
    const abone = b.videolar.map(x => x.subscriberCount).filter(n => typeof n === "number" && n > 0);
    const parcalar = [];
    if (sureler.length) parcalar.push("Ortanca süre **" + R.ortanca(sureler) + " sn**");
    if (abone.length) parcalar.push("en küçük kanal **" + R.bicim(Math.min(...abone)) + " abone**");
    if (parcalar.length) { y(parcalar.join(" - ")); y(""); }
    y("| izlenme | izl/saat | süre | abone | video |");
    y("|---|---|---|---|---|");
    for (const x of b.videolar) {
      const t = String(x.videoTitle || "").replace(/\|/g, "/").slice(0, 56);
      const url = "https://youtube.com/" + (b.format === "short" ? "shorts/" : "watch?v=") + x.videoId;
      y("| " + R.bicim(x.viewCount) + " | " + Math.round(x.vph || 0) + " | " + (x.videoDuration || "-") + "sn | " + R.bicim(x.subscriberCount) + " | [" + t + "](" + url + ") |");
    }
    y("");
  }

  if (veri.ig) {
    y("## Instagram + TikTok - aşırı performans gösterenler");
    y("");
    y("> `Nx median` değeri, videonun o hesabın kendi ortalamasını kaç kat aştığını gösterir.");
    y("> Büyük hesap olmak gerekmiyor; kalıbı tutan küçük hesap da listeye giriyor.");
    y("");
    y(veri.ig.md.replace(/^## /gm, "### "));
    y("");
  }

  y("---");
  y("");
  y("## Nasıl okunur");
  y("");
  const maddeler = [];
  if (veri.yt.some(b => b.videolar.length))
    maddeler.push("**Ortanca süreye bak.** Kendi videon ondan çok uzunsa izlenme oranı düşebilir.",
      "YouTube bölümündeki **izl/saat** sütunu asıl sinyaldir: toplam izlenme videonun kaç günlük olduğunu da yansıtır, saatlik hız ise şu anda ne kadar hızlı büyüdüğünü gösterir.");
  if (veri.ig)
    maddeler.push("**`hook_0_3s` alanını oku (Instagram/TikTok).** İlk üç saniyede ekranda ne olduğunu ve ne yazdığını söyler; kalıp orada.",
      "**`format` ve `effort` alanlarına bak.** Bir şey bir saatlik emekle milyonlar alıyorsa, o formatı kendi konunla denemek en hızlı yoldur.",
      "**Aynı kalıp iki farklı hesapta varsa** o bir trend olabilir; bir kere gördüysen tesadüf olabilir.");
  if (!maddeler.length) maddeler.push("Bu çalışmada okunacak sonuç çıkmadı; eşikleri düşürüp tekrar dene.");
  maddeler.forEach((m, i) => y((i + 1) + ". " + m));
  y("");
  y("Kalıbı (format, süre, açılış yapısı) örnek al; içeriği kendin üret. Başkasının videosunu izinsiz yeniden yüklemek telif ihlalidir.");
  return satir.join("\n");
}

async function ana(argv, secenek) {
  secenek = secenek || {};
  const { konum, bayrak } = ortak.argumanCoz(argv, { deger: ["dil", "min", "vph", "platform"] });
  const konu = konum[0] || "";
  const dil = String(bayrak.dil || "en").toLowerCase();
  const esik = Number(bayrak.min !== undefined ? bayrak.min : 200000);   // Instagram/TikTok izlenme esigi
  // YouTube trending TAZE videoya bakar; toplam izlenme esigi koymak yanlis: trendde olculen sey HIZ.
  const vph = Number(bayrak.vph !== undefined ? bayrak.vph : 150);
  const platform = PLATFORM_TAKMA[String(bayrak.platform === true ? "" : (bayrak.platform || "hepsi")).toLowerCase()];
  const siki = !!bayrak.siki;
  if (!platform) throw new OrtakHata("arguman", "Geçersiz --platform değeri.", { cikis: CIKIS.GIRDI, cozum: "yt, ig, tt veya hepsi yaz." });
  if (!(esik >= 0) || !(vph >= 0)) throw new OrtakHata("arguman", "--min ve --vph sayı olmalı.", { cikis: CIKIS.GIRDI });

  const anahtar = ortak.envOku("VIDIQ_KEY");
  if (!anahtar && !secenek.vidiq)
    throw new OrtakHata("vidiq_anahtar", "VIDIQ_KEY yok; trend araması yapılamadı.", { cikis: CIKIS.GIRDI,
      cozum: "Panel > Kaynaklar sekmesine vidIQ anahtarını yapıştır (app.vidiq.com/account/settings/mcp)." });

  const vidiq = secenek.vidiq || new V.VidiqIstemci(anahtar, secenek.vidiqSecenek);
  const onceki = await K.vidiqBakiye(vidiq);
  const yap = platform === "hepsi" || platform === "yt";
  const sos = platform === "hepsi" || platform === "ig" || platform === "tt";
  const veri = { yt: [], ig: null };
  const satirlar = [];
  const hatalar = [];
  let cagri = 0, basarili = 0;

  // ================= YOUTUBE =================
  if (yap) for (const [etiket, format] of [["Shorts", "short"], ["Uzun video", "long"]]) {
    process.stdout.write("YouTube " + etiket + " aranıyor... ");
    try {
      cagri++;
      const arg = { videoFormat: format, limit: 12, sortBy: "vph", vphMin: vph };
      if (konu) { arg.titleQuery = konu; arg.requireAllTitleTerms = siki; }
      if (BASLIK_DILLERI.has(dil)) arg.videoTitleLanguage = dil;
      const d = await vidiq.cagir("vidiq_trending_videos", arg);
      const v = (d && Array.isArray(d.videos)) ? d.videos : [];
      console.log(v.length + " video");
      basarili++;
      veri.yt.push({ etiket, format, videolar: v });
      for (const x of v) satirlar.push(R.youtubeSatiri(x, format));
    } catch (e) {
      if (e.kod === "vidiq_anahtar" || e.kod === "vidiq_kredi") { console.log("olmadı"); throw e; }
      console.log("olmadı: " + String(e.message).slice(0, 70));
      hatalar.push(e);
    }
  }

  // ================= INSTAGRAM + TIKTOK =================
  if (sos) {
    process.stdout.write("Instagram + TikTok aranıyor... ");
    try {
      cagri++;
      const bolge = dil === "tr" ? "Turkey/Turkish" : "Global/English";
      const kuresel = dil === "tr" ? "false" : "true";
      const arg = {
        query: konu || "trending short form video",
        audienceQuery: "Culture/Region: " + bolge + "; Global: " + kuresel + "; Demographics: general audience interested in " + (konu || "trending short video content") + ";",
        resultsPerPlatform: 6,
        viewsMin: Math.round(esik),
      };
      if (dil !== "en") arg.descriptionLanguage = [dil.slice(0, 2)];
      const ham = await vidiq.cagirHam("vidiq_instagram_tiktok_outlier_search", arg);
      let md = V.metinCikar(ham);
      console.log(md ? "geldi" : "boş");
      basarili++;
      if (md) {
        const secim = platform === "ig" ? "instagram" : platform === "tt" ? "tiktok" : null;
        if (secim) {
          const f = R.mdPlatformSuz(md, secim);
          if (f.uyari) ortak.uyari("vidIQ yanıtında platform başlığı bulunamadı; Instagram ve TikTok birlikte gösteriliyor.");
          md = f.md;
        }
        let rows = ham && ham.structuredContent ? R.yapisaldanSatirlar(ham.structuredContent) : [];
        if (!rows.length) rows = R.metindenSatirlar(md);
        if (secim) rows = rows.filter(r => r.platform === secim);
        veri.ig = { md, satirlar: rows };
        satirlar.push(...rows);
      }
    } catch (e) {
      if (e.kod === "vidiq_anahtar" || e.kod === "vidiq_kredi") { console.log("olmadı"); throw e; }
      console.log("olmadı: " + String(e.message).slice(0, 90));
      hatalar.push(e);
    }
  }

  // Hicbir cagri basarili olmadiysa bu bir HATADIR (bos sonuc degil)
  if (!basarili && hatalar.length) throw hatalar[0];
  for (const e of hatalar) ortak.uyari("Bir bölüm alınamadı: " + String(e.message).slice(0, 100));

  const tarih = R.yerelTarih();
  const md = raporKur({ konu, dil, esik, vph, platform, tarih }, veri);
  const dosyalar = R.raporYaz("trend", konu, md, {
    surum: 1, tur: "trend", tarih: new Date().toISOString(), konu, dil, platform, satirlar,
  });
  const kr = await K.vidiqKullanimKaydet(null, vidiq, onceki, BETIK, cagri * 5, "");
  console.log("");
  console.log("rapor: " + dosyalar.md);
  console.log("vidIQ kredisi: ~" + kr.kredi + (kr.kalan !== null ? " (kalan " + kr.kalan + ")" : ""));
  ortak.sonuc({ satir: satirlar.length, platform, rapor: dosyalar.md, json: dosyalar.json, kredi: kr.kredi });
  return { satirlar, rapor: dosyalar };
}

module.exports = { ana, raporKur };

if (require.main === module) ana(process.argv.slice(2)).catch(ortak.bitir);
