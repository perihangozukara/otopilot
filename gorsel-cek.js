// NASA gorsel cekici — BEDAVA, API anahtari gerekmez, kamu mali (ticari kullanim serbest).
// Kullanim: node gorsel-cek.js <is> [sahne-basina-adet]        (varsayilan 12)
//
// Sahneler: konu.json > sahneler: [{ "n": "01-hook", "q": ["spiral galaxy", "nebula"] }, ...]
//   n = sahne klasoru (yalniz harf/rakam/bosluk/tire/alt cizgi; "01-..." gibi sayisal onek = sahne numarasi,
//       klasor adi farkli olsa da ayni numarali sahnenin klasorune eklenir)
//   q = NASA arama ifadeleri
// konu.json'da "sahneler" yoksa 8 sahnelik VARSAYILAN UZAY seti kullanilir (uyari verir).
//
// Ciktilar: Visuals/<sahne>/NN.jpg  +  Visuals/manifest.json kaydi (kaynak "nasa", sahne->paragraf eslemesi gorsel-bul
// ile ayni) + ATIF.txt. Ayni NASA gorseli iki sahnede cikmaz (tum sahneler arasi), silinenler.json'dakiler gelmez.
// Inen dosya dogrulanir: JPEG/PNG sihirli bayti, 25 MB siniri, gercek cozunurluk (uzun kenar >=1280).
// NASA'da grafik/toplanti/laboratuvar gibi goruntuler BASLIGA bakan kara listeyle elenir; donanim/rampa/simulasyon gibi
// turler elenmez, puan kirilir (gorsel-puan.js, lib/gorsel-kaynak.js).
// Ilerleme: sahne basina @@ILERLEME (n/toplam). Sahneler zaten dolusa ag cagrisi yapilmaz; hicbir sey indirilmezse
// @@SONUC atlandi:true (idempotans).
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./lib/ortak.js");
const ag = require("./lib/gorsel-ag.js");
const man = require("./lib/gorsel-manifest.js");
const puanModul = require("./lib/gorsel-puan.js");
const indirModul = require("./lib/gorsel-indir.js");
const { KaynakYonetici } = require("./lib/gorsel-kaynak.js");

const OrtakHata = ortak.OrtakHata;
const ADLI = /^[A-Za-z0-9 _-]{1,40}$/;
const uyku = ms => new Promise(r => setTimeout(r, ms));

const DEFAULT_SCENES = [
  { n: "01-hook",        q: ["spiral galaxy", "galaxy nebula", "cosmic vortex"] },
  { n: "02-what-is-time",q: ["star field", "milky way", "deep space stars"] },
  { n: "03-forward-real",q: ["international space station", "astronaut spacewalk", "earth from orbit"] },
  { n: "04-arrow-time",  q: ["supernova", "galaxy collision", "stellar explosion"] },
  { n: "05-wormhole",    q: ["black hole", "gravitational lensing", "quasar"] },
  { n: "06-paradox",     q: ["twin galaxies", "star cluster", "interacting galaxies"] },
  { n: "07-ai",          q: ["supercomputer", "simulation visualization", "data visualization"] },
  { n: "08-finale",      q: ["hubble deep field", "andromeda galaxy", "universe galaxies"] },
];

async function calistir(o, bag) {
  bag = bag || {};
  const is = o.is;
  const log = bag.log || (m => console.log(m));
  const uyari = bag.uyari || ortak.uyari;
  const bekle = bag.bekle || uyku;
  const P = man.yollar(is);
  if (!fs.existsSync(P.BASE)) throw new OrtakHata("is_yok", "İş bulunamadı: " + is, { cikis: ortak.CIKIS.GIRDI, cozum: "İş adını kontrol et ya da panelden yeni iş aç." });
  ortak.kilitAl(is, "gorsel-cek");
  const konu = ortak.konuEtkin(is) || {};                      // bozuksa OrtakHata (exit 2)
  ortak.diskKontrol(P.BASE, 1);

  const perScene = Math.max(1, Math.min(40, Number(o.adet) || 12));
  let sahneTanim = Array.isArray(konu.sahneler) && konu.sahneler.length ? konu.sahneler : null;
  if (!sahneTanim) {
    uyari("konu.json'da 'sahneler' tanımlı değil: varsayılan 8 uzay sahnesi kullanılıyor (konunla ilgisiz olabilir).");
    sahneTanim = DEFAULT_SCENES;
  }
  const dil = String(konu.dil || "en").toLowerCase();
  const dikey = !!konu.dikey;
  const sen = man.senaryoOku(is);
  const pl = man.planYukle({ is, kanonik: sen.paragraflar, ozet: sen.ozet, dil, yon: dikey ? "dikey" : "yatay", kisa: dikey, adopt: true, log, uyari });
  const M = pl.manifest;
  M.dil = dil; M.hedefYon = dikey ? "dikey" : "yatay";

  const getir = bag.getir || ag.istemciYap({ limitBekleSn: 30 });
  const yonetici = bag.yonetici || new KaynakYonetici({ getir, anahtarlar: {}, istemciler: bag.istemciler, log, uyari, bekle: bag.bekleKaynak,
    etkin: { pexels: false, pixabay: false, wikimedia: false, openverse: false, nasa: true }, aralik: bag.aralik });

  const silinen = man.silinenleriOku(is, uyari);
  const gorulenUrl = new Set(), gorulenSha = new Set();
  const redUrl = new Set();                                     // icerigi uygunsuz cikan adaylar: sahne basina yeniden indirilmez
  for (const s of M.sahneler) for (const g of s.gorseller) {
    if (g.kaynakUrl) gorulenUrl.add(puanModul.kanonikUrl(g.kaynakUrl));
    if (g.indirmeUrl) gorulenUrl.add(puanModul.kanonikUrl(g.indirmeUrl));
    if (g.sha1) gorulenSha.add(g.sha1);
  }

  let toplam = 0, hata = 0, atlanan = 0, gecerliSahne = 0, sira = 0;
  const reddedilen = {}, indirmeHata = {};
  for (const sc of sahneTanim) {
    ortak.ilerleme("nasa", sira / sahneTanim.length * 100, { n: sira + 1, toplam: sahneTanim.length });
    sira++;
    if (!sc || typeof sc.n !== "string" || !ADLI.test(sc.n) || !Array.isArray(sc.q)) {
      uyari("Geçersiz sahne tanımı atlandı: " + JSON.stringify(sc && sc.n !== undefined ? sc.n : sc));
      continue;
    }
    // klasor adinda bosluk olmasin (panel sahne klasorlerini bosluksuz bekler): "03 uzay" -> "03-uzay"
    const klasorAd = sc.n.trim().replace(/\s+/g, "-");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(klasorAd)) { uyari("Sahne adı harf/rakamla başlamalı (\"" + sc.n + "\"), atlandı."); continue; }
    const S = man.sahneBulAdla(M, klasorAd);
    if (!S.klasor) S.klasor = klasorAd;
    const dizin = path.join(P.VIS, S.klasor);
    if (!ortak.yolIcinde(P.VIS, dizin)) { uyari("Sahne klasörü Visuals dışına çıkıyor, atlandı: " + sc.n); continue; }
    fs.mkdirSync(dizin, { recursive: true });

    gecerliSahne++;
    const mevcut = S.gorseller.filter(g => g.kaynak === "nasa").length;
    let kaydedilen = mevcut;
    for (const q of sc.q.map(x => String(x).trim()).filter(Boolean)) {
      if (kaydedilen >= perScene) break;
      if (!yonetici.acikMi("nasa")) break;
      const ham = await yonetici.ara("nasa", q, { limit: 40 });
      const sorguTok = puanModul.sorguTokenleri(q, "en");
      const adaylar = [];
      for (const a of ham) {
        const k1 = puanModul.kanonikUrl(a.kaynakUrl || a.indirmeUrl), k2 = puanModul.kanonikUrl(a.indirmeUrl);
        if (gorulenUrl.has(k1) || gorulenUrl.has(k2)) continue;
        if (silinen.url.has(k1) || silinen.url.has(k2)) continue;
        const r = puanModul.puanla(a, { sorgu: q, sorguTok, yon: dikey ? "dikey" : "yatay", siraLimiti: 40, kozmik: true });
        if (r.elendi) continue;
        adaylar.push(Object.assign({}, a, { puan: r.puan }));
      }
      adaylar.sort((x, y) => y.puan - x.puan);
      const r = await indirModul.adaylardanIndir({ P, S, adaylar, kac: perScene - kaydedilen, getir, gorulenUrl, gorulenSha, silinen,
        reddedilen, redUrl, indirmeHata, bekle, aralikMs: 150, klasorIfade: klasorAd, klasorAta: (s, i) => man.klasorAta(P, s, i),
        oranSiniri: indirModul.ORAN_SINIRI[dikey ? "dikey" : "yatay"] });
      kaydedilen += r.eklenen; toplam += r.eklenen;
    }
    S.aramalar = sc.q.map(String);
    S.kullanilanArama = S.kullanilanArama || (sc.q[0] ? String(sc.q[0]) : null);
    S.durum = man.durumHesapla(S, perScene);
    if (mevcut >= perScene) atlanan++;                          // sahne zaten dolu: arama yapilmadi, uyari gerektirmez
    else if (kaydedilen === mevcut) hata++;                     // dolu degildi ve yeni gorsel gelmedi
    log(" " + sc.n + (S.klasor !== sc.n ? " (→ " + S.klasor + ")" : "") + " → " + kaydedilen + " görsel" + (mevcut ? " (" + mevcut + " zaten vardı)" : ""));
    M.kaynakHatalari = Object.assign({}, M.kaynakHatalari, yonetici.kaynakHatalari());
    man.manifestYaz(is, M);
  }
  man.manifestYaz(is, M);
  const atif = man.atifYaz(is, M);

  log("");
  log("=== TAMAM ===");
  log("  TOPLAM: " + toplam + " yeni NASA görseli");
  log("  Klasör: " + P.VIS);
  if (atif) log("  Atıf  : " + atif + " görsel için ATIF.txt yazıldı");
  const reds = Object.entries(reddedilen).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + " " + v);
  if (reds.length) log("  Reddedilen: " + reds.join(", "));
  const ozet = yonetici.ozetMetni(man.kaynakSayaclari(M));
  if (yonetici.kaynakHatalari().nasa) log("  Kaynak: " + ozet);

  const nasaToplam = M.sahneler.reduce((a, s) => a + s.gorseller.filter(g => g.kaynak === "nasa").length, 0);
  if (nasaToplam === 0) {
    const d = yonetici.durum.nasa;
    throw new OrtakHata("gorsel_yok", "NASA'dan hiç görsel indirilemedi" + (d.hata ? " (kaynak " + d.hata + " hata verdi)" : "") + ".",
      { cikis: d.hata && !d.basarili ? ortak.CIKIS.SERVIS : ortak.CIKIS.YETERSIZ,
        cozum: "Bağlantını kontrol et ya da konu.json > sahneler içindeki 'q' arama ifadelerini değiştir.", detay: yonetici.kaynakHatalari() });
  }
  if (hata) uyari(hata + " sahnede yeni görsel bulunamadı; arama ifadelerini değiştirmeyi dene.");
  ortak.ilerleme("nasa", 100, { n: sahneTanim.length, toplam: sahneTanim.length });
  const sonuc = { gorsel: toplam, sahne: sahneTanim.length };
  // hicbir sey indirilmedi ve gecerli her sahne zaten doluydu -> PA adimi "atlandi" isaretler (idempotans)
  if (toplam === 0 && gecerliSahne > 0 && atlanan === gecerliSahne) { sonuc.atlandi = true; sonuc.neden = "görseller güncel"; }
  ortak.sonuc(sonuc);
  return { manifest: M, toplam, atlandi: !!sonuc.atlandi };
}

module.exports = { calistir, DEFAULT_SCENES };

if (require.main === module) {
  const { konum } = ortak.argumanCoz(process.argv.slice(2), {});
  const is = konum[0];
  if (!is) { console.error("✗ Kullanım: node gorsel-cek.js <iş-adı> [sahne-başına-adet]"); process.exit(ortak.CIKIS.GIRDI); }
  const adet = konum[1] !== undefined ? Number(konum[1]) : undefined;
  if (adet !== undefined && (!Number.isFinite(adet) || adet < 1)) { console.error("✗ Sahne başına adet pozitif bir sayı olmalı."); process.exit(ortak.CIKIS.GIRDI); }
  calistir({ is, adet }).catch(ortak.bitir);
}
