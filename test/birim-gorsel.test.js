// BIRIM TESTLERI — gorsel bulucu: lisans suzgeci, alaka siralamasi, kara liste, dosya dogrulama, sayisal klasor sirasi,
// arama ifadesi cikarimi, ag katmani (yerel sahte sunucu). Ag/ucret/ffmpeg YOK (gorseller elle uretilmis ikililer).
// Bulgu karsiliklari: B022/B074 (lisans), B024 (siralama), B025/B067 (dogrulama, 25 MB, yonlendirmede anahtar),
// B023 (arama ifadeleri), B086 (100+ sahne siralamasi), B028 (kelime sinirli kara liste).
"use strict";
const Y = require("./birim-yardim");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const lisans = require("../lib/gorsel-lisans");
const puan = require("../lib/gorsel-puan");
const dog = require("../lib/gorsel-dogrula");
const sorgu = require("../lib/gorsel-sorgu");
const ag = require("../lib/gorsel-ag");
const indir = require("../lib/gorsel-indir");
const man = require("../lib/gorsel-manifest");
const { dogalSirala, klasordenTopla } = require("../lib/render-sahne");
const { aramalariBelirle } = require("../lib/gorsel-akis");

const ortam = Y.ortamKur("gorsel");
test.after(() => ortam.temizle());

// ---------------------------------------------------------------- lisans suzgeci
test("lisans: Openverse NC / ND / sampling / bos / taninmayan ELENIR; CC0, PDM, BY, BY-SA kabul", () => {
  for (const k of ["by-nc", "by-nd", "by-nc-sa", "by-nc-nd", "sampling+", "nc-sampling+", "", undefined, "gpl"])
    assert.equal(lisans.openverseLisans(k).kabul, false, "elenmeliydi: " + k);
  assert.match(lisans.openverseLisans("by-nc").neden, /NC/);
  assert.match(lisans.openverseLisans("by-nd").neden, /ND/);
  const cc0 = lisans.openverseLisans("cc0");
  assert.deepEqual([cc0.kabul, cc0.lisansKodu, cc0.lisansSira, cc0.atifGerekli], [true, "cc0", 0, false]);
  assert.deepEqual([lisans.openverseLisans("pdm").lisansKodu, lisans.openverseLisans("pdm").lisansSira], ["pdm", 0]);
  const by = lisans.openverseLisans("by", "4.0");
  assert.deepEqual([by.lisansKodu, by.lisansSira, by.atifGerekli, by.lisans], ["by", 1, true, "CC BY 4.0"]);
  const bysa = lisans.openverseLisans("by-sa", "3.0");
  assert.deepEqual([bysa.lisansKodu, bysa.lisansSira, bysa.atifGerekli], ["by-sa", 2, true]);
  assert.ok(bysa.uyari, "BY-SA icin uyari beklenir");
});

test("lisans: Wikimedia NC/ND/GFDL/non-free ELENIR; kamu mali > CC BY > CC BY-SA siralanir; taninmayan lisans sona + atif ister", () => {
  for (const a of ["CC BY-NC 4.0", "CC BY-NC-SA 3.0", "CC BY-ND 2.0", "CC BY-NC-ND 4.0", "GFDL 1.2", "Non-commercial"])
    assert.equal(lisans.wikimediaLisans(a).kabul, false, "elenmeliydi: " + a);
  assert.equal(lisans.wikimediaLisans("CC BY 4.0", { nonFree: "true" }).kabul, false);
  const beklenen = { "CC0": "cc0", "CC0 1.0": "cc0", "Public domain": "pdm", "PD-old-70": "pdm", "CC BY 4.0": "by", "Attribution": "by", "CC BY-SA 4.0": "by-sa" };
  for (const [a, kod] of Object.entries(beklenen)) {
    const r = lisans.wikimediaLisans(a);
    assert.equal(r.kabul, true, a);
    assert.equal(r.lisansKodu, kod, a);
  }
  const sira = ["Public domain", "CC BY 4.0", "CC BY-SA 4.0", "Ozel Bir Lisans"].map(a => lisans.wikimediaLisans(a).lisansSira);
  assert.deepEqual(sira, [0, 1, 2, 3]);
  const bilinmeyen = lisans.wikimediaLisans("Ozel Bir Lisans");
  assert.equal(bilinmeyen.lisansKodu, "bilinmiyor");
  assert.equal(bilinmeyen.atifGerekli, true);
});

test("lisans: sabit kaynaklar ve bilinmeyen kaynak; atif listesine kimler girer", () => {
  assert.equal(lisans.lisansCoz("pexels").lisansKodu, "pexels");
  assert.equal(lisans.lisansCoz("pexels").atifOnerilen, true);
  assert.equal(lisans.lisansCoz("nasa").lisansKodu, "nasa");
  assert.equal(lisans.lisansCoz("uretim").lisansKodu, "ai");
  assert.equal(lisans.lisansCoz("elle").lisansSira, 3);
  assert.equal(lisans.lisansCoz("flickr").kabul, false);
  assert.equal(lisans.lisansCoz("openverse", { license: "by-nc" }).kabul, false);
  assert.equal(lisans.lisansCoz("wikimedia", { kisaAd: "CC BY-SA 4.0" }).lisansKodu, "by-sa");
  const girer = k => lisans.atifListesineGirer({ lisansKodu: k });
  assert.deepEqual(["by", "by-sa", "pexels"].map(girer), [true, true, true]);
  assert.deepEqual(["cc0", "pdm", "nasa", "pixabay", "ai"].map(girer), [false, false, false, false, false]);
  assert.equal(lisans.atifListesineGirer({ lisansKodu: "bilinmiyor", atifGerekli: true }), true);
});

test("atifMetni: '\"Baslik\" — Yazar — Lisans — url' bicimi; tirnak ve satir sonu temizlenir; ASCII dusmeyen (object) satir yok", () => {
  const s = lisans.atifMetni({ baslik: 'Aslan "Kral"\n 2024', atif: "Ayşe Y.", lisans: "CC BY 4.0", kaynakUrl: "https://example.test/a" });
  assert.equal(s, "\"Aslan 'Kral' 2024\" — Ayşe Y. — CC BY 4.0 — https://example.test/a");
  assert.doesNotMatch(s, /\[object Object\]/);
  assert.match(lisans.atifMetni({ lisans: "CC BY 4.0" }), /^"Başlıksız" — Bilinmeyen — CC BY 4\.0 — $/);
});

// ---------------------------------------------------------------- alaka puani ve kara liste
const ctx = (ek) => Object.assign({ sorgu: "polar bear", sorguTok: puan.sorguTokenleri("polar bear"), yon: "yatay", siraLimiti: 40 }, ek || {});
const aday = (ek) => Object.assign({ kaynak: "pexels", baslik: "Polar bear on the ice", sira: 0, en: 1920, boy: 1080, lisansSira: 0 }, ek || {});

test("puanla: ALAKA dosya boyutundan once gelir (eski hata: en buyuk dosya kazaniyordu)", () => {
  const alakali = puan.puanla(aday({ sira: 0, en: 1920, boy: 1080 }), ctx());
  const buyukAmaAlakasiz = puan.puanla(aday({ sira: 35, baslik: "Sunset over the mountains", en: 8000, boy: 4500 }), ctx());
  assert.equal(alakali.elendi, null);
  assert.equal(buyukAmaAlakasiz.elendi, null);
  assert.ok(alakali.puan > buyukAmaAlakasiz.puan, alakali.puan + " > " + buyukAmaAlakasiz.puan);
  // ayni alaka: kaynak sirasi belirler
  assert.ok(puan.puanla(aday({ sira: 2 }), ctx()).puan > puan.puanla(aday({ sira: 20 }), ctx()).puan);
});

test("puanla: cozunurluk yalniz ALT ESIK (uzun kenar >= 1280); esigin altindaki elenir", () => {
  assert.match(puan.puanla(aday({ en: 1000, boy: 700 }), ctx()).elendi, /çözünürlük düşük/);
  assert.equal(puan.puanla(aday({ en: 1280, boy: 720 }), ctx()).elendi, null);
  assert.equal(puan.puanla(aday({ en: 0, boy: 0 }), ctx()).elendi, null, "boyut bilinmiyorsa dosya dogrulamasina birakilir");
  assert.equal(puan.puanla(aday({ en: 800, boy: 600 }), ctx({ minUzunKenar: 0 })).elendi, null);
});

test("puanla: sert kara liste (harita, logo, tarama, ...) elenir; sorgunun KENDISINDE geciyorsa elenmez", () => {
  for (const baslik of ["Map of polar bear range", "Polar bear logo", "Scanned book cover polar bear", "Polar bear coat of arms", "Polar bear diagram"])
    assert.match(puan.puanla(aday({ baslik }), ctx()).elendi, /kara liste/, baslik);
  assert.equal(puan.puanla(aday({ baslik: "Map of Africa" }), ctx({ sorgu: "map of africa", sorguTok: puan.sorguTokenleri("map of africa") })).elendi, null);
});

test("puanla: yumusak kara liste (heykel/oyuncak) puan kirar ama elemez; VS videosunda ELER; sorguda gecen elenmez", () => {
  const duz = puan.puanla(aday({ baslik: "Polar bear in the snow" }), ctx());
  const heykel = puan.puanla(aday({ baslik: "Polar bear bronze statue" }), ctx());
  assert.equal(heykel.elendi, null);
  assert.ok(heykel.puan < duz.puan - 10, "heykel cezasi: " + heykel.puan + " vs " + duz.puan);
  assert.match(puan.puanla(aday({ baslik: "Polar bear bronze statue" }), ctx({ vs: true })).elendi, /tür uyumsuz/);
  const sorguStatue = ctx({ sorgu: "bronze statue of lincoln", sorguTok: puan.sorguTokenleri("bronze statue of lincoln") });
  assert.equal(puan.puanla(aday({ baslik: "Bronze statue of Lincoln in the park" }), sorguStatue).elendi, null);
});

test("puanla: kara liste KELIME SINIRLI ('art', 'pet' icin part/start/carpet elenmez — B028)", () => {
  for (const baslik of ["Part of the polar bear family", "Start of the polar bear season", "Carpet python near a polar bear", "Competition for polar bear photographers"])
    assert.equal(puan.puanla(aday({ baslik }), ctx()).elendi, null, baslik);
  assert.ok(puan.karaBul("Bronze sculpture", "eagle", puan.YUMUSAK));
  assert.equal(puan.karaBul("Carpet and apartment", "x", puan.KATI), null);
  assert.equal(puan.karaBul("Cats and pets", "x", puan.VS_EK), null);
});

test("puanla: yon/oran cezasi — yatay videoda dikey gorsel, dikey videoda yatay gorsel daha dusuk puan alir", () => {
  const yatay = aday({ en: 1920, boy: 1080 }), dikey = aday({ en: 1080, boy: 1920 });
  assert.ok(puan.puanla(yatay, ctx()).puan > puan.puanla(dikey, ctx()).puan);
  assert.ok(puan.puanla(dikey, ctx({ yon: "dikey" })).puan > puan.puanla(yatay, ctx({ yon: "dikey" })).puan);
});

test("puanla: yasak ve zorunlu kelimeler; kanonikUrl tekrar onleme anahtari", () => {
  assert.match(puan.puanla(aday({ baslik: "Polar bear toy" }), ctx({ yasak: ["toy"] })).elendi, /yasak kelime/);
  assert.match(puan.puanla(aday({ baslik: "Arctic landscape" }), ctx({ zorunlu: ["bear"] })).elendi, /zorunlu/);
  assert.equal(puan.puanla(aday({ baslik: "Cute bears" }), ctx({ zorunlu: ["bear"] })).elendi, null);
  assert.equal(puan.kanonikUrl("HTTPS://Ex.test/a/b.jpg?w=100#x"), puan.kanonikUrl("https://ex.test/a/b.jpg/"));
});

// ---------------------------------------------------------------- dosya dogrulama
test("dogrula: HTML hata sayfasi, WebP, SVG, bos/kucuk dosya REDDEDILIR (gorsel diye kaydedilmez)", () => {
  const html = dog.dogrula(Y.htmlHataSayfasi());
  assert.equal(html.tamam, false);
  assert.match(html.neden, /görsel değil/);
  assert.match(dog.dogrula(Y.webpUret()).neden, /görsel değil/);
  assert.match(dog.dogrula(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'>" + " ".repeat(4000) + "</svg>")).neden, /görsel değil/);
  assert.match(dog.dogrula(Buffer.alloc(100)).neden, /çok küçük/);
  assert.match(dog.dogrula(null).neden, /çok küçük/);
  assert.equal(dog.sihirliBayt(Y.jpegUret(10, 10)), "jpg");
  assert.equal(dog.sihirliBayt(Y.pngUret(10, 10)), "png");
  assert.equal(dog.sihirliBayt(Buffer.alloc(20)), null);
});

test("dogrula: GERCEK boyut dosyadan okunur (JPEG + PNG); EXIF yonu 6 en/boy'u degistirir; sha1 ve uzanti dogru", () => {
  const j = Y.jpegUret(1920, 1080);
  const r = dog.dogrula(j);
  assert.deepEqual([r.tamam, r.tur, r.uzanti, r.en, r.boy], [true, "jpg", ".jpg", 1920, 1080]);
  assert.equal(r.sha1, crypto.createHash("sha1").update(j).digest("hex"));
  assert.equal(r.bayt, j.length);
  const p = dog.dogrula(Y.pngUret(2560, 1440));
  assert.deepEqual([p.tamam, p.uzanti, p.en, p.boy], [true, ".png", 2560, 1440]);
  const dondurulmus = dog.dogrula(Y.jpegUret(1920, 1280, { exifYon: 6 }));
  assert.deepEqual([dondurulmus.en, dondurulmus.boy], [1280, 1920], "EXIF 6: gorunen yon dikey");
  const duz = dog.dogrula(Y.jpegUret(1920, 1280, { exifYon: 1 }));
  assert.deepEqual([duz.en, duz.boy], [1920, 1280]);
});

test("dogrula: cozunurluk esigi (1280), 25 MB siniri, 100 MP ust siniri, minUzunKenar gecersiz kilma", () => {
  const dusuk = dog.dogrula(Y.jpegUret(1000, 700));
  assert.equal(dusuk.tamam, false);
  assert.match(dusuk.neden, /çözünürlük düşük \(1000x700, en az 1280 px gerekli\)/);
  assert.equal(dog.dogrula(Y.jpegUret(1280, 720)).tamam, true);
  assert.equal(dog.dogrula(Y.jpegUret(720, 1280)).tamam, true, "uzun kenar esigi: dikey de gecer");
  assert.equal(dog.dogrula(Y.jpegUret(1000, 700), { minUzunKenar: 0 }).tamam, true);
  assert.match(dog.dogrula(Y.jpegUret(1920, 1080, { bayt: 6000 }), { maksBayt: 5000 }).neden, /çok büyük/);
  assert.match(dog.dogrula(Y.jpegUret(20000, 10000)).neden, /aşırı yüksek/);
  assert.equal(ag.MAKS_GORSEL_BAYT, 25 * 1024 * 1024);
  // baslik bozuk (SOF yok): boyut okunamadi
  const bozuk = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(5000, 0x22)]);
  assert.match(dog.dogrula(bozuk).neden, /boyutu okunamadı/);
});

// ---------------------------------------------------------------- indirme (sahte getir)
const sahteGetir = (harita) => ({ gorsel: async (u) => {
  const v = harita[u];
  if (v instanceof Error) throw v;
  if (!v) throw new ag.AgHatasi("HTTP 404", 404);
  return { govde: v };
} });
const indirSecenek = (harita, ek) => Object.assign({ getir: sahteGetir(harita), reddedilen: {}, gorulenSha: new Set(), bekle: async () => {} }, ek || {});

test("indirDene: HTML/WebP/dusuk cozunurluk atlanir, yedek adrese gecilir; ayni icerik ikinci kez alinmaz", async () => {
  const iyi = Y.jpegUret(1920, 1080, { bayt: 5000 });
  const o = indirSecenek({ "http://x/a": Y.htmlHataSayfasi(), "http://x/b": Y.jpegUret(900, 600), "http://x/c": iyi });
  const r = await indir.indirDene({ kaynak: "pexels", url: "http://x/a", yedekUrl: ["http://x/b", "http://x/c"] }, o);
  assert.ok(r && r.v.tamam);
  assert.equal(r.v.sha1, crypto.createHash("sha1").update(iyi).digest("hex"));
  assert.equal(o.reddedilen["görsel değil"], 1);
  assert.equal(o.reddedilen["çözünürlük düşük"], 1);
  // ayni sha ikinci sahnede
  o.gorulenSha.add(r.v.sha1);
  const tekrar = await indir.indirDene({ kaynak: "pexels", url: "http://x/c" }, o);
  assert.equal(tekrar, null);
  assert.equal(o.reddedilen["aynı görsel zaten var"], 1);
});

test("indirDene: kullanicinin sildigi gorsel (silinenSha) bir daha gelmez; kadraja uymayan oran reddedilir; ag hatasi sayilir", async () => {
  const sil = Y.jpegUret(1920, 1080, { bayt: 5200 });
  const sha = crypto.createHash("sha1").update(sil).digest("hex");
  const o = indirSecenek({ "http://x/s": sil, "http://x/dar": Y.jpegUret(400, 4000) }, { silinenSha: new Set([sha]) });
  assert.equal(await indir.indirDene({ kaynak: "wikimedia", url: "http://x/s" }, o), null);
  assert.equal(await indir.indirDene({ kaynak: "wikimedia", url: "http://x/dar" }, Object.assign(o, { oranSiniri: indir.ORAN_SINIRI.yatay })), null);
  assert.equal(o.reddedilen["kadraja uymayan oran"], 1);
  const hata = indirSecenek({ "http://x/z": new ag.AgHatasi("t", "zaman_asimi") }, { indirmeHata: {} });
  assert.equal(await indir.indirDene({ kaynak: "openverse", url: "http://x/z" }, hata), null);
  assert.equal(hata.indirmeHata.openverse, 1);
  // bir kaynak 6 kez cevap vermediyse o calismada denenmez
  const kesik = indirSecenek({}, { indirmeHata: { openverse: 6 } });
  assert.equal(await indir.indirDene({ kaynak: "openverse", url: "http://x/y" }, kesik), null);
});

// ---------------------------------------------------------------- sayisal klasor sirasi (B086)
test("sayisalSirala / dogalSirala: 120 sahnede 100-109, 11'den ONCE gelmez; eski 2 haneli ve yeni 3 haneli adlar karisik dogru siralanir", () => {
  const adlar = [];
  for (let i = 1; i <= 120; i++) adlar.push(i < 100 && i % 2 ? String(i).padStart(2, "0") + "-eski" : String(i).padStart(3, "0") + "-yeni");
  const karisik = adlar.slice().sort((a, b) => (a < b ? 1 : -1));                      // ters harf sirasi
  for (const sirala of [man.sayisalSirala, dogalSirala]) {
    const s = karisik.slice().sort(sirala);
    assert.deepEqual(s.map(a => parseInt(a, 10)), Array.from({ length: 120 }, (_, i) => i + 1));
  }
  // duz harf sirasi (eski hata) 100'u 11'den once koyardi: kanit
  const harf = ["10-x", "11-x", "100-x"].sort();
  assert.deepEqual(harf, ["10-x", "100-x", "11-x"]);
  assert.deepEqual(["10-x", "11-x", "100-x"].sort(man.sayisalSirala), ["10-x", "11-x", "100-x"]);
  assert.equal(man.sayisalOnek("007-a"), 7);
  assert.equal(man.sayisalOnek("abc"), Infinity);
});

test("diskte 120 sahne klasoru: sahneKlasorleri ve klasordenTopla SAYISAL sirada; '_' ile baslayanlar disarida", () => {
  const VIS = path.join(ortam.kok, "vis120");
  for (let i = 1; i <= 120; i++) {
    const k = path.join(VIS, String(i).padStart(3, "0") + "-s");
    fs.mkdirSync(k, { recursive: true });
    fs.writeFileSync(path.join(k, "01.jpg"), "x");
  }
  fs.mkdirSync(path.join(VIS, "_eski-20260101-000000"), { recursive: true });
  const kl = man.sahneKlasorleri(VIS);
  assert.equal(kl.length, 120);
  assert.deepEqual(kl.map(k => parseInt(k, 10)), Array.from({ length: 120 }, (_, i) => i + 1));
  const top = klasordenTopla(VIS);
  assert.equal(top.length, 120);
  assert.equal(top[0].ad, "001-s/01.jpg");
  assert.equal(top[109].ad, "110-s/01.jpg");
  assert.equal(top[119].ad, "120-s/01.jpg");
  assert.ok(!top.some(x => x.ad.startsWith("_")));
});

test("sahneKlasorAdi: 3 hane, ASCII slug; Turkce harf sadelesir; bos ifade 'sahne'", () => {
  assert.equal(sorgu.sahneKlasorAdi(7, "Albert Einstein"), "007-albert-einstein");
  assert.equal(sorgu.sahneKlasorAdi(120, "Şeker Fabrikası"), "120-seker-fabrikasi");
  assert.equal(sorgu.sahneKlasorAdi(1, "???"), "001-sahne");
  assert.ok(sorgu.sahneKlasorAdi(5, "x".repeat(80)).length <= 3 + 1 + 24);
});

// ---------------------------------------------------------------- arama ifadeleri (B023)
test("ozelIsimler: cumle basi siradan kelime ozel isim sayilmaz; NASA/CERN/GPT kisaltmalari yakalanir, OK/AM degil", () => {
  assert.deepEqual(sorgu.ozelIsimler("Imagine Einstein walking along the river.", { kucuk: new Set(["imagine"]) }), ["Einstein"]);
  assert.deepEqual(sorgu.ozelIsimler("Then Cristiano Ronaldo scored for Real Madrid.", {}).slice(0, 3), ["Cristiano Ronaldo", "Real Madrid"]);
  const k = sorgu.ozelIsimler("NASA and CERN built a GPT lab, OK? It started at 3 AM.");
  assert.ok(k.includes("NASA") && k.includes("CERN") && k.includes("GPT"), k.join());
  assert.ok(!k.includes("OK") && !k.includes("AM"));
  assert.ok(sorgu.ozelIsimler("The Tower of London stood there.").includes("Tower of London"));
});

test("kelimeler: Turkce harfler atilmaz, durak sozcukler ve sayilar elenir, apostrof eki kesilir", () => {
  assert.deepEqual(sorgu.kelimeler("Şehrin eski limanı ve çarşısı güzeldi", "tr").slice(0, 3), ["şehrin", "eski", "limanı"]);
  assert.ok(sorgu.kelimeler("Bu çok güzel bir gün", "tr").length === 1 || !sorgu.kelimeler("Bu çok güzel bir gün", "tr").includes("çok"));
  assert.ok(sorgu.kelimeler("İstanbul'da yaşadık", "tr").includes("istanbul"));
  assert.ok(!sorgu.kelimeler("In 1923 the old harbour opened", "en").includes("1923"));
  assert.ok(sorgu.kelimeler("Einstein's theory", "en").includes("einstein"));
});

test("kozmikMi: tek 'space' NASA'yi tetiklemez (futbol metni); gercek uzay metni tetikler", () => {
  assert.equal(sorgu.kozmikMi("He had half a second of space to shoot. The goal was beautiful."), false);
  assert.equal(sorgu.kozmikMi("The telescope saw a nebula in the galaxy, near a black hole."), true);
  assert.equal(sorgu.kozmikSahneMi("Mars and the moon"), true);
  assert.equal(sorgu.kozmikSahneMi("A cat on a sofa"), false);
});

test("sahnePlan: HICBIR paragraf dusmez, sirali ve kesintisiz; kisa paragraflar komsuyla birlesir; sahneAdetleri tavani asmaz", () => {
  const ps = [];
  for (let i = 0; i < 140; i++) ps.push(Array.from({ length: i % 7 === 0 ? 3 : 10 + (i % 40) }, (_, k) => "w" + i + "x" + k).join(" "));
  const plan = sorgu.sahnePlan(ps);
  assert.deepEqual(plan.flatMap(s => s.paragraflar), Array.from({ length: 140 }, (_, i) => i));
  assert.deepEqual(plan.map(s => s.no), Array.from({ length: plan.length }, (_, i) => i + 1));
  assert.ok(plan.length < 140, "kisa paragraflar birlesmeli");
  const adet = sorgu.sahneAdetleri(plan);
  assert.equal(adet.length, plan.length);
  assert.ok(adet.every(n => n >= 1 && n <= 14));
  assert.ok(adet.reduce((a, b) => a + b, 0) <= 160 + plan.length, "toplam tavan");
});

test("aramalariBelirle: oncelik elle > Claude/vidIQ (gorsel-aramalari.json) > otomatik; sahnedeki paragraflarin listeleri birlesir", () => {
  const otomatik = () => ["otomatik-ifade"];
  const info = { s: { no: 2, paragraflar: [3, 4] } };
  const harita = new Map([[3, { aramalar: ["Albert Einstein", "physicist"], uret: "" }], [4, { aramalar: ["Princeton 1930"], uret: "an abstract idea" }]]);
  const elle = aramalariBelirle(info, { konu: { sahneKelimeleri: ["x", ["Elle Bir", "Elle Iki"]] }, aramalarHarita: harita, otomatik });
  assert.deepEqual([elle.kaynak, elle.liste], ["elle", ["Elle Bir", "Elle Iki"]]);
  const claude = aramalariBelirle(info, { konu: {}, aramalarHarita: harita, otomatik });
  assert.equal(claude.kaynak, "claude");
  assert.deepEqual(claude.liste, ["Albert Einstein", "Princeton 1930", "physicist"]);
  assert.equal(claude.aiIstem, "an abstract idea");
  const oto = aramalariBelirle(info, { konu: {}, aramalarHarita: null, otomatik });
  assert.deepEqual([oto.kaynak, oto.liste], ["otomatik", ["otomatik-ifade"]]);
});

// ---------------------------------------------------------------- ag katmani (yerel sahte sunucu, 4301-4399)
test("ag: yerel/ozel adreslere varsayilan olarak GIDILMEZ; ozelAdresMi tablosu", async () => {
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.1.5", "172.16.0.1", "172.31.255.1", "169.254.1.1", "::1", "[::1]", "fd00::1", "foo.local", "db.internal", "0.0.0.0"])
    assert.equal(ag.ozelAdresMi(h), true, h);
  for (const h of ["pexels.com", "8.8.8.8", "172.32.0.1", "commons.wikimedia.org"]) assert.equal(ag.ozelAdresMi(h), false, h);
  await assert.rejects(() => ag.tekIstek("http://127.0.0.1:4399/x", {}, 0), e => e.kod === "yerel_adres");
  await assert.rejects(() => ag.tekIstek("ftp://example.test/x", {}, 0), e => e.kod === "adres");
  await assert.rejects(() => ag.tekIstek("duz metin", {}, 0), e => e.kod === "adres");
});

test("ag: yonlendirmede BASKA makineye gidince Authorization/Cookie/x-api-key DUSER; ayni makinede kalir (Pexels anahtari sizmaz)", async () => {
  const hedefBasliklar = [];
  const hedef = await Y.sunucuAc((req, res) => { hedefBasliklar.push(Object.assign({ yol: req.url }, req.headers)); res.writeHead(200); res.end("tamam"); });
  const kaynak = await Y.sunucuAc((req, res) => {
    if (req.url === "/baska") { res.writeHead(302, { Location: "http://localhost:" + hedef.port + "/hedef" }); return res.end(); }
    if (req.url === "/ayni") { res.writeHead(302, { Location: "/yerel" }); return res.end(); }
    hedefBasliklar.push(Object.assign({ yol: req.url, sunucu: "kaynak" }, req.headers)); res.writeHead(200); res.end("tamam");
  }, { kayma: 3 });
  try {
    const o = { izinYerel: true, basliklar: { Authorization: "PEXELS-GIZLI-ANAHTAR", "X-Api-Key": "k", Cookie: "a=b", Accept: "image/*" } };
    const r = await ag.tekIstek(kaynak.url + "/baska", o, 0);
    assert.equal(r.govde.toString(), "tamam");
    const h = hedefBasliklar.find(x => x.yol === "/hedef");
    assert.ok(h, "hedef sunucuya ulasilmadi");
    assert.equal(h.authorization, undefined);
    assert.equal(h["x-api-key"], undefined);
    assert.equal(h.cookie, undefined);
    assert.equal(h.accept, "image/*", "hassas olmayan baslik kalir");
    await ag.tekIstek(kaynak.url + "/ayni", o, 0);
    const a = hedefBasliklar.find(x => x.yol === "/yerel");
    assert.equal(a.authorization, "PEXELS-GIZLI-ANAHTAR", "ayni makinede anahtar korunur");
  } finally { await kaynak.kapat(); await hedef.kapat(); }
});

test("ag: boyut siniri (Content-Length ve akis), yarim indirme, 5 yonlendirme siniri, 4xx tekrar denenmez / 5xx ve 429 denenir", async () => {
  let istek = 0;
  const s = await Y.sunucuAc((req, res) => {
    istek++;
    if (req.url === "/dev") { res.writeHead(200, { "Content-Length": String(40 * 1024 * 1024) }); return res.end("x"); }
    if (req.url === "/akis") { res.writeHead(200); res.write(Buffer.alloc(3000, 1)); res.write(Buffer.alloc(3000, 1)); return setTimeout(() => res.end(Buffer.alloc(3000, 1)), 5); }
    if (req.url === "/dongu") { res.writeHead(302, { Location: "/dongu" }); return res.end(); }
    if (req.url === "/404") { res.writeHead(404); return res.end(); }
    if (req.url === "/503") { res.writeHead(503); return res.end(); }
    if (req.url === "/429") {
      if (istek % 2) { res.writeHead(429, { "Retry-After": "0" }); return res.end(); }
      res.writeHead(200); return res.end("sonunda");
    }
    res.writeHead(200); res.end("ok");
  }, { kayma: 5 });
  try {
    const o = { izinYerel: true };
    await assert.rejects(() => ag.tekIstek(s.url + "/dev", Object.assign({ maksBayt: 25 * 1024 * 1024 }, o), 0), e => e.kod === "cok_buyuk");
    await assert.rejects(() => ag.tekIstek(s.url + "/akis", Object.assign({ maksBayt: 5000 }, o), 0), e => e.kod === "cok_buyuk");
    await assert.rejects(() => ag.tekIstek(s.url + "/dongu", o, 0), e => e.kod === "yonlendirme");
    istek = 0;
    await assert.rejects(() => ag.getirDene(s.url + "/404", Object.assign({ bekle: async () => {} }, o)), e => e.kod === 404);
    assert.equal(istek, 1, "404 tekrar denenmemeli");
    istek = 0;
    await assert.rejects(() => ag.getirDene(s.url + "/503", Object.assign({ bekle: async () => {} }, o)), e => e.kod === 503);
    assert.equal(istek, 3, "5xx: 3 deneme");
    istek = 0;
    const r = await ag.getirDene(s.url + "/429", Object.assign({ bekle: async () => {} }, o));
    assert.equal(r.govde.toString(), "sonunda", "429 + Retry-After sonrasi yeniden denenir");
  } finally { await s.kapat(); }
});

test("ag: beklemeSuresi (Retry-After sn / tarih, X-Ratelimit-Reset) ve hataOzeti", () => {
  assert.equal(ag.beklemeSuresi({ "retry-after": "7" }), 7);
  assert.equal(ag.beklemeSuresi({}), null);
  assert.ok(Math.abs(ag.beklemeSuresi({ "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 30) }) - 30) < 2);
  assert.equal(ag.beklemeSuresi({ "retry-after": new Date(Date.now() + 20000).toUTCString() }) > 15, true);
  assert.equal(ag.hataOzeti(new ag.AgHatasi("x", 429)), "HTTP 429");
  assert.equal(ag.hataOzeti(new ag.AgHatasi("x", "zaman_asimi")), "zaman aşımı");
  assert.equal(ag.hataOzeti(Object.assign(new Error("x"), { code: "ECONNRESET" })), "ECONNRESET");
});
