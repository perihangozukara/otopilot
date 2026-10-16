// performans.js [--is <ad> | --hepsi]
// Yayinlanmis videolarin performansini vidIQ'dan ceker ve uretim/<is>/performans.json'a yazar:
//   {surum:1, guncelleme, kaynak:"vidiq", izlenme, begeni, yorum, ham:{...}}
// Hangi video: uretim/<is>/yayin-durum.json icindeki YouTube videoId (ya da YouTube baglantisi).
// Panel bunu "hangi konu/sure tuttu" ozeti ve yeni video formundaki sure onerisi icin okur.
// Her is icin 1 vidIQ cagrisi (vidiq_video_stats, ~5 kredi). Henuz yuklenmemis isler atlanir.
//
// Cikis kodlari: 0 tamam (atlanan isler dahil) | 2 anahtar yok / video bulunamadi (--is ile) | 3 vidIQ hatasi
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./lib/ortak");
const K = require("./lib/senaryo-kullanim");
const { VidiqIstemci } = require("./lib/vidiq");

const { OrtakHata, CIKIS } = ortak;
const BETIK = "performans.js";
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

// "https://youtu.be/ID", "watch?v=ID", "/shorts/ID", "/live/ID" ya da duz ID
function idCoz(deger) {
  const s = String(deger || "").trim();
  if (ID_RE.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/live\/|\/embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// yayin-durum.json biciminden bagimsiz: YouTube'a ait videoId/url'yi bulur. durum belirtilmisse "yuklendi" olmali.
function videoIdBul(veri) {
  let bulunan = null, yukluDegil = false;
  const dolas = (x, youtubeIpucu, derinlik) => {
    if (bulunan || !x || typeof x !== "object" || derinlik > 5) return;
    if (Array.isArray(x)) { x.forEach(e => dolas(e, youtubeIpucu, derinlik + 1)); return; }
    const yt = youtubeIpucu || /youtube/i.test(String(x.platform || ""));
    if (yt || derinlik === 0) {
      const id = idCoz(x.videoId) || idCoz(x.url) || idCoz(x.link);
      if (id && (yt || x.videoId)) {
        if (x.durum && x.durum !== "yuklendi") { yukluDegil = true; return; }
        bulunan = id; return;
      }
    }
    for (const [k, v] of Object.entries(x)) dolas(v, yt || /youtube/i.test(k), derinlik + 1);
  };
  dolas(veri, false, 0);
  return { id: bulunan, yukluDegil };
}

// vidiq_video_stats sonucundan son veri noktasi: zaman serisi dizisini bul
function sonNokta(veri) {
  let en = null;
  const dolas = (x, derinlik) => {
    if (!x || typeof x !== "object" || derinlik > 4) return;
    if (Array.isArray(x)) {
      const noktalar = x.filter(e => e && typeof e === "object" && (e.views !== undefined || e.viewCount !== undefined));
      if (noktalar.length && (!en || noktalar.length > en.length)) en = noktalar;
      x.forEach(e => dolas(e, derinlik + 1));
      return;
    }
    Object.values(x).forEach(v => dolas(v, derinlik + 1));
  };
  dolas(veri, 0);
  if (!en) return { son: null, noktalar: [] };
  const zaman = e => Date.parse(e.timestamp || e.date || e.time || e.t || "") || 0;
  const sirali = en.slice().sort((a, b) => zaman(a) - zaman(b));
  return { son: sirali[sirali.length - 1], noktalar: sirali };
}
const sayi = x => (typeof x === "number" && isFinite(x) ? x : null);

async function isIcin(is, vidiq, onceki, secenek) {
  const dizin = ortak.isDizin(is);
  let durum;
  try { durum = ortak.jsonOku(path.join(dizin, "yayin-durum.json"), null); }
  catch (e) { return { is, atlandi: true, neden: "yayin-durum.json okunamadı" }; }
  if (!durum) return { is, atlandi: true, neden: "yayin-durum.json yok (video yayınlandı olarak işaretlenmemiş)" };
  const { id, yukluDegil } = videoIdBul(durum);
  if (!id) return { is, atlandi: true, neden: yukluDegil ? "video henüz YouTube'a yüklenmedi olarak işaretli" : "yayin-durum.json'da YouTube videoId/bağlantısı yok" };

  const bitis = new Date();
  const bas = new Date(bitis.getTime() - 30 * 24 * 3600 * 1000);
  const d = await vidiq.cagir("vidiq_video_stats", { videoId: id, granularity: "daily", from: bas.toISOString(), to: bitis.toISOString() });
  const { son, noktalar } = sonNokta(d);
  if (!son) return { is, atlandi: true, neden: "vidIQ bu video için veri döndürmedi (yeni video olabilir)" };
  const izlenme = sayi(son.views ?? son.viewCount);
  const sonuc = {
    surum: 1, guncelleme: new Date().toISOString(), kaynak: "vidiq", videoId: id, izlenme,
    begeni: sayi(son.likes ?? son.likeCount), yorum: sayi(son.comments ?? son.commentCount),
    ham: { sonNokta: son, noktaSayisi: noktalar.length, noktalar: noktalar.slice(-30) },
  };
  ortak.atomikJsonYaz(path.join(dizin, "performans.json"), sonuc);
  return { is, izlenme, begeni: sonuc.begeni, yorum: sonuc.yorum };
}

async function ana(argv, secenek) {
  secenek = secenek || {};
  const { bayrak } = ortak.argumanCoz(argv, { deger: ["is"] });
  const tek = typeof bayrak.is === "string" ? bayrak.is : null;
  if (!tek && !bayrak.hepsi) throw new OrtakHata("arguman", "Kullanım: node performans.js --is <is-adi>  veya  --hepsi", { cikis: CIKIS.GIRDI });
  const anahtar = ortak.envOku("VIDIQ_KEY");
  if (!anahtar && !secenek.vidiq)
    throw new OrtakHata("vidiq_anahtar", "VIDIQ_KEY yok; performans verisi alınamadı.", { cikis: CIKIS.GIRDI,
      cozum: "Panel > Kaynaklar sekmesine vidIQ anahtarını yapıştır (app.vidiq.com/account/settings/mcp)." });

  let isler;
  if (tek) {
    const d = ortak.isDizin(tek);
    if (!fs.existsSync(d)) throw new OrtakHata("is_yok", "İş bulunamadı: " + tek, { cikis: CIKIS.GIRDI });
    isler = [tek];
  } else {
    isler = fs.readdirSync(ortak.uretimDizini(), { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith("_") && ortak.guvenliAd(e.name) && fs.existsSync(path.join(ortak.uretimDizini(), e.name, "yayin-durum.json")))
      .map(e => e.name);
  }
  if (!isler.length) { console.log("Yayınlandı olarak işaretlenmiş iş yok."); ortak.sonuc({ guncellenen: 0, atlanan: 0 }); return { guncellenen: 0 }; }

  const vidiq = secenek.vidiq || new VidiqIstemci(anahtar, secenek.vidiqSecenek);
  const onceki = await K.vidiqBakiye(vidiq);
  const guncellenen = [], atlanan = [];
  let cagri = 0;
  for (const is of isler) {
    const r = await isIcin(is, vidiq, onceki, secenek);
    if (r.atlandi) { atlanan.push(r); console.log("— " + is + ": atlandı (" + r.neden + ")"); continue; }
    cagri++;
    guncellenen.push(r);
    console.log("✓ " + is + ": " + (r.izlenme !== null ? r.izlenme + " izlenme" : "izlenme okunamadı") +
      (r.begeni !== null ? ", " + r.begeni + " beğeni" : "") + (r.yorum !== null ? ", " + r.yorum + " yorum" : ""));
  }
  // tek is verildi ve video bulunamadiysa bu bir girdi hatasidir
  if (tek && !guncellenen.length) throw new OrtakHata("video_yok", "Performans alınamadı: " + atlanan[0].neden + ".", { cikis: CIKIS.GIRDI,
    cozum: "Panelde videoyu YouTube'a yüklendi olarak işaretle ve videoId/bağlantı gir." });
  if (cagri) await K.vidiqKullanimKaydet(tek || null, vidiq, onceki, BETIK, cagri * 5, cagri + " video");
  const sonuc = { guncellenen: guncellenen.length, atlanan: atlanan.length, isler: guncellenen };
  ortak.sonuc(sonuc);
  return sonuc;
}

module.exports = { ana, idCoz, videoIdBul, sonNokta };

if (require.main === module) ana(process.argv.slice(2)).catch(ortak.bitir);
