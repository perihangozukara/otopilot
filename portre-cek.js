// Wikimedia Commons portre/tarihsel gorsel cekici — BEDAVA, anahtar gerekmez.
// Yalnizca TICARI KULLANIMA ACIK lisansli gorseller: kamu mali (PD/CC0), CC BY, CC BY-SA. NC/ND ve serbest olmayan
// dosyalar ELENIR. Yazar ve lisans Visuals/manifest.json'a ve ATIF.txt'ye yazilir (CC BY/BY-SA: atif zorunlu).
// Kullanim: node portre-cek.js <is>
//
// konu.json > portreler: [{ "n": "03-einstein", "q": ["Albert Einstein", "Einstein 1921"], "adet": 3 }, ...]
//   n    = sahne klasoru (yalniz harf/rakam/bosluk/tire/alt cizgi; "03-..." sayisal onek = sahne numarasi)
//   q    = Commons arama ifadeleri, adet = sahne basina gorsel (varsayilan 3)
// Inen dosya dogrulanir (JPEG/PNG sihirli bayti, 25 MB, gercek cozunurluk >=1280); ayni gorsel iki sahnede cikmaz;
// silinenler.json'daki gorseller bir daha gelmez. Hiz sinirina takilirsa bekler, kaynak hatalari raporlanir.
// Ilerleme: portre basina @@ILERLEME (n/toplam). Portreler zaten dolusa ag cagrisi yapilmaz; hicbir sey indirilmezse
// @@SONUC atlandi:true (idempotans). 2:3 dikey fotograflar yatay videoda REDDEDILMEZ (yalniz asiri serit/panorama);
// yon uyumsuzlugu puan cezasidir.
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
// Commons'ta portre aramasini bozan alakasiz turler (heykel/resim/minyatur burada GECERLI; bkz yumusakKapali)
const PORTRE_YASAK = ["plaque", "grave", "gravestone", "tomb", "building", "memorial"];

async function calistir(o, bag) {
  bag = bag || {};
  const is = o.is;
  const log = bag.log || (m => console.log(m));
  const uyari = bag.uyari || ortak.uyari;
  const bekle = bag.bekle || uyku;
  const P = man.yollar(is);
  if (!fs.existsSync(P.BASE)) throw new OrtakHata("is_yok", "İş bulunamadı: " + is, { cikis: ortak.CIKIS.GIRDI, cozum: "İş adını kontrol et ya da panelden yeni iş aç." });
  ortak.kilitAl(is, "portre-cek");
  const konu = ortak.konuEtkin(is);                            // bozuksa OrtakHata (exit 2)
  if (!konu) throw new OrtakHata("konu_yok", "konu.json yok: " + is, { cikis: ortak.CIKIS.GIRDI, cozum: "Önce işi panelden oluştur." });
  const liste = Array.isArray(konu.portreler) ? konu.portreler : [];
  if (!liste.length) {
    log("konu.json içinde 'portreler' yok, atlanıyor.");
    ortak.sonuc({ atlandi: true, neden: "portreler tanımlı değil" });
    return { toplam: 0 };
  }
  ortak.diskKontrol(P.BASE, 1);

  const dil = String(konu.dil || "en").toLowerCase();
  const dikey = !!konu.dikey;
  const sen = man.senaryoOku(is);
  const pl = man.planYukle({ is, kanonik: sen.paragraflar, ozet: sen.ozet, dil, yon: dikey ? "dikey" : "yatay", kisa: dikey, adopt: true, log, uyari });
  const M = pl.manifest;
  M.dil = dil; M.hedefYon = dikey ? "dikey" : "yatay";

  const getir = bag.getir || ag.istemciYap({ limitBekleSn: 60 });
  const yonetici = bag.yonetici || new KaynakYonetici({ getir, anahtarlar: {}, istemciler: bag.istemciler, log, uyari, bekle: bag.bekleKaynak,
    etkin: { pexels: false, pixabay: false, wikimedia: true, openverse: false, nasa: false }, aralik: bag.aralik });

  const silinen = man.silinenleriOku(is, uyari);
  const gorulenUrl = new Set(), gorulenSha = new Set();
  const redUrl = new Set();                                     // icerigi uygunsuz cikan adaylar: portre basina yeniden indirilmez
  for (const s of M.sahneler) for (const g of s.gorseller) {
    if (g.kaynakUrl) gorulenUrl.add(puanModul.kanonikUrl(g.kaynakUrl));
    if (g.indirmeUrl) gorulenUrl.add(puanModul.kanonikUrl(g.indirmeUrl));
    if (g.sha1) gorulenSha.add(g.sha1);
  }

  let toplam = 0, bosSahne = 0, atlanan = 0, gecerliSahne = 0, sira = 0;
  const reddedilen = {}, indirmeHata = {};
  for (const sc of liste) {
    ortak.ilerleme("portre", sira / liste.length * 100, { n: sira + 1, toplam: liste.length });
    sira++;
    if (!sc || typeof sc.n !== "string" || !ADLI.test(sc.n) || !Array.isArray(sc.q)) {
      uyari("Geçersiz portre tanımı atlandı: " + JSON.stringify(sc && sc.n !== undefined ? sc.n : sc));
      continue;
    }
    // klasor adinda bosluk olmasin (panel sahne klasorlerini bosluksuz bekler): "03 einstein" -> "03-einstein"
    const klasorAd = sc.n.trim().replace(/\s+/g, "-");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(klasorAd)) { uyari("Sahne adı harf/rakamla başlamalı (\"" + sc.n + "\"), atlandı."); continue; }
    const S = man.sahneBulAdla(M, klasorAd);
    if (!S.klasor) S.klasor = klasorAd;
    const dizin = path.join(P.VIS, S.klasor);
    if (!ortak.yolIcinde(P.VIS, dizin)) { uyari("Sahne klasörü Visuals dışına çıkıyor, atlandı: " + sc.n); continue; }
    fs.mkdirSync(dizin, { recursive: true });

    const per = Math.max(1, Math.min(20, Number(sc.adet) || 3));
    gecerliSahne++;
    const mevcut = S.gorseller.filter(g => g.kaynak === "wikimedia").length;
    let kaydedilen = mevcut;
    for (const q of sc.q.map(x => String(x).trim()).filter(Boolean)) {
      if (kaydedilen >= per) break;
      if (!yonetici.acikMi("wikimedia")) break;
      const ham = await yonetici.ara("wikimedia", q, { limit: 40 });
      const sorguTok = puanModul.sorguTokenleri(q, "en");
      const adaylar = [];
      for (const a of ham) {
        const k1 = puanModul.kanonikUrl(a.kaynakUrl || a.indirmeUrl), k2 = puanModul.kanonikUrl(a.indirmeUrl);
        if (gorulenUrl.has(k1) || gorulenUrl.has(k2)) continue;
        if (silinen.url.has(k1) || silinen.url.has(k2)) continue;
        const r = puanModul.puanla(a, { sorgu: q, sorguTok, yon: dikey ? "dikey" : "yatay", siraLimiti: 40, yumusakKapali: true, yasak: PORTRE_YASAK });
        if (r.elendi) { const t = r.elendi.split(":")[0]; reddedilen[t] = (reddedilen[t] || 0) + 1; continue; }
        adaylar.push(Object.assign({}, a, { puan: r.puan }));
      }
      adaylar.sort((x, y) => y.puan - x.puan);
      const r = await indirModul.adaylardanIndir({ P, S, adaylar, kac: per - kaydedilen, getir, gorulenUrl, gorulenSha, silinen,
        reddedilen, redUrl, indirmeHata, bekle, aralikMs: 400, klasorIfade: klasorAd, klasorAta: (s, i) => man.klasorAta(P, s, i),
        oranSiniri: indirModul.ORAN_SINIRI[dikey ? "dikey" : "yatay"] });
      kaydedilen += r.eklenen; toplam += r.eklenen;
    }
    S.aramalar = sc.q.map(String);
    S.kullanilanArama = S.kullanilanArama || (sc.q[0] ? String(sc.q[0]) : null);
    S.durum = man.durumHesapla(S, per);
    if (mevcut >= per) atlanan++;                               // portre zaten dolu: arama yapilmadi
    else if (!S.gorseller.length) bosSahne++;
    log(" " + sc.n + (S.klasor !== sc.n ? " (→ " + S.klasor + ")" : "") + " → " + kaydedilen + " görsel" + (mevcut ? " (" + mevcut + " zaten vardı)" : ""));
    M.kaynakHatalari = Object.assign({}, M.kaynakHatalari, yonetici.kaynakHatalari());
    man.manifestYaz(is, M);
  }
  man.manifestYaz(is, M);
  const atif = man.atifYaz(is, M);

  log("");
  log("TOPLAM " + toplam + " portre/tarihsel görsel → " + P.VIS);
  if (atif) log("atıf      : " + atif + " görsel için atıf gerekli → ATIF.txt (YouTube açıklamasına yapıştır)");
  const reds = Object.entries(reddedilen).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k + " " + v);
  if (reds.length) log("reddedilen: " + reds.join(", "));
  const d = yonetici.durum.wikimedia;
  if (d.hata || d.kapandi || d.lisansElenen) log("kaynak    : " + yonetici.ozetMetni(man.kaynakSayaclari(M)));
  for (const u of man.uyariListesi(M)) uyari(u);

  if (toplam === 0 && !M.sahneler.some(s => s.gorseller.some(g => g.kaynak === "wikimedia")))
    throw new OrtakHata("gorsel_yok", "Commons'tan hiç portre/tarihsel görsel indirilemedi" + (d.hata ? " (kaynak " + d.hata + " hata verdi)" : "") + ".",
      { cikis: d.hata && !d.basarili ? ortak.CIKIS.SERVIS : ortak.CIKIS.YETERSIZ,
        cozum: "Arama ifadelerini değiştir (örn. daha tanınır bir ad); bağlantını kontrol et.", detay: yonetici.kaynakHatalari() });
  if (bosSahne) uyari(bosSahne + " portre sahnesi için görsel bulunamadı.");
  ortak.ilerleme("portre", 100, { n: liste.length, toplam: liste.length });
  const sonuc = { gorsel: toplam, sahne: liste.length };
  // hicbir sey indirilmedi ve gecerli her portre zaten doluydu -> PA adimi "atlandi" isaretler (idempotans)
  if (toplam === 0 && gecerliSahne > 0 && atlanan === gecerliSahne) { sonuc.atlandi = true; sonuc.neden = "portreler güncel"; }
  ortak.sonuc(sonuc);
  return { manifest: M, toplam, atlandi: !!sonuc.atlandi };
}

module.exports = { calistir };

if (require.main === module) {
  const { konum } = ortak.argumanCoz(process.argv.slice(2), {});
  const is = konum[0];
  if (!is) { console.error("✗ Kullanım: node portre-cek.js <iş-adı>"); process.exit(ortak.CIKIS.GIRDI); }
  calistir({ is }).catch(ortak.bitir);
}
