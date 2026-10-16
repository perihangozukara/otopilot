// lib/ortak.js — konu.json sozlesmesi (konuDogrula/konuHam/konuEtkin) ve panel-ayar.json (ayarOku/ayarDogrula).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ortak = require("../lib/ortak");

// Her test kendi gecici uretim/ayar dosyasini kullanir; gercek dosyalara ASLA dokunulmaz.
function ortamKur() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "konu-test-"));
  const onceki = { u: process.env.OTOMASYON_URETIM, a: process.env.OTOMASYON_AYAR_DOSYASI };
  process.env.OTOMASYON_URETIM = path.join(d, "uretim");
  process.env.OTOMASYON_AYAR_DOSYASI = path.join(d, "panel-ayar.json");
  fs.mkdirSync(process.env.OTOMASYON_URETIM, { recursive: true });
  return {
    d, uretim: process.env.OTOMASYON_URETIM, ayar: process.env.OTOMASYON_AYAR_DOSYASI,
    konuYaz(is, nesneVeyaMetin) {
      const p = path.join(process.env.OTOMASYON_URETIM, is);
      fs.mkdirSync(p, { recursive: true });
      fs.writeFileSync(path.join(p, "konu.json"), typeof nesneVeyaMetin === "string" ? nesneVeyaMetin : JSON.stringify(nesneVeyaMetin));
    },
    geri() {
      for (const [k, v] of [["OTOMASYON_URETIM", onceki.u], ["OTOMASYON_AYAR_DOSYASI", onceki.a]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* gecici klasor */ }
    },
  };
}

test("konuDogrula: gecerli ornek", () => {
  const r = ortak.konuDogrula({ surum: 1, baslik_en: "x", format: "long", aspect: "16:9", hedefSaniye: 900, geriSayim: 5, intro: 8, outro: 12,
    gecis: "dissolve", gecisSure: 0.8, efekt: "zoom", renk: "sinematik", sesHizi: "+7%", dil: "tr", tur: "belgesel", onay: { senaryo: true, gorsel: false },
    vurguRenk: "6FD8FF", outroMetni: { baslik: "ABONE OL" }, yayin: { hashtagler: ["a", "b"] }, formuller: [{ hedef: "kart-1" }], sahneler: [{ n: "sahne 1" }] });
  assert.equal(r.gecerli, true, JSON.stringify(r.hatalar));
  assert.deepEqual(r.uyarilar, []);
});

test("konuDogrula: her aralik/enum ihlali alan adiyla raporlanir", () => {
  const kotu = { baslik_en: "", kanal: "k".repeat(61), slogan: "s".repeat(121), format: "mp4", aspect: "1:1", hedefSaniye: 5, geriSayim: 3, intro: 31, konuKarti: -1,
    outro: "x", muzikSeviyesi: 2, gecis: "yok", gecisSure: 9, efekt: "ucan", renk: "mor", sesHizi: "+90%", sahneKelimeleri: [5], uretAdet: 9, dil: "TR", altyaziDili: "tur",
    altyazi: "evet", altyaziStil: "x", sesMotoru: "gtts", tur: "komedi", kisiselKatki: "k".repeat(1501), onay: { senaryo: "e" }, acilisStili: "x", markaKose: 11,
    vurguRenk: "#fff", outroMetni: { baslik: "b".repeat(81) }, muzikRuhu: "x", muzikDucking: 1, cesitlilik: "e", maliyetUstSinirUSD: -1,
    yayin: { hashtagler: new Array(16).fill("a") }, formuller: [{ hedef: "../x" }], portreler: [{ n: "a/b" }], okunus: "x", kanalSesi: { tarif: "t".repeat(501) } };
  const r = ortak.konuDogrula(kotu);
  assert.equal(r.gecerli, false);
  const alanlar = new Set(r.hatalar.map(h => h.alan));
  for (const a of ["baslik_en", "kanal", "slogan", "format", "aspect", "hedefSaniye", "geriSayim", "intro", "konuKarti", "outro", "muzikSeviyesi", "gecis", "gecisSure",
    "efekt", "renk", "sesHizi", "sahneKelimeleri[0]", "uretAdet", "dil", "altyaziDili", "altyazi", "altyaziStil", "sesMotoru", "tur", "kisiselKatki", "onay.senaryo",
    "acilisStili", "markaKose", "vurguRenk", "outroMetni.baslik", "muzikRuhu", "muzikDucking", "cesitlilik", "maliyetUstSinirUSD", "yayin.hashtagler",
    "formuller[0].hedef", "portreler[0].n", "okunus", "kanalSesi.tarif"])
    assert.ok(alanlar.has(a), "eksik: " + a + " / var: " + [...alanlar].join(","));
});

test("konuDogrula: 29 gecis adi kabul, eski hedefDakika, bilinmeyen alan uyari, _ onekli serbest", () => {
  assert.equal(ortak.GECISLER.length, 29);
  for (const g of ortak.GECISLER) assert.equal(ortak.konuDogrula({ gecis: g }).gecerli, true, g);
  const r = ortak.konuDogrula({ hedefDakika: 15, _not_ozel: 1, yazimHatasi: 2 });
  assert.equal(r.gecerli, true);
  assert.deepEqual(r.uyarilar.map(u => u.alan), ["yazimHatasi"]);
  assert.equal(ortak.konuDogrula([]).gecerli, false);
  assert.equal(ortak.konuDogrula(null).gecerli, false);
});

test("konuHam: yoksa null; bozuk JSON konu_bozuk(satir/sutun); nesne degilse konu_gecersiz", () => {
  const o = ortamKur();
  try {
    assert.equal(ortak.konuHam("yok-is"), null);
    o.konuYaz("a", '{\n "baslik_en": "x",\n}');
    assert.throws(() => ortak.konuHam("a"), e => e.kod === "konu_bozuk" && e.satir === 3 && e.cikis === 2 && /konu\.json bozuk \(satır 3/.test(e.message));
    o.konuYaz("b", "[1,2]");
    assert.throws(() => ortak.konuHam("b"), e => e.kod === "konu_gecersiz");
    o.konuYaz("c", { baslik_en: "iyi" });
    assert.equal(ortak.konuHam("c").baslik_en, "iyi");
    assert.throws(() => ortak.konuHam("../a"), e => e.kod === "gecersiz_is");
  } finally { o.geri(); }
});

test("konuEtkin: eski isler degismesin diye format varsayilanlari (uzun 5/8/2.5/12, short 0/1.5/0/3, reels 0/1.5/0/0)", () => {
  const o = ortamKur();
  try {
    o.konuYaz("uzun", { baslik_en: "u" });
    o.konuYaz("kisa", { baslik_en: "k", format: "short" });
    o.konuYaz("reels", { baslik_en: "r", format: "reels" });
    o.konuYaz("tiktok", { baslik_en: "t", aspect: "9:16", format: "tiktok" });
    o.konuYaz("eskidikey", { baslik_en: "d", aspect: "9:16" });
    const al = (is) => { const e = ortak.konuEtkin(is); return [e.geriSayim, e.intro, e.konuKarti, e.outro, e.hedefSaniye, e.format]; };
    assert.deepEqual(al("uzun"), [5, 8, 2.5, 12, 900, "long"]);
    assert.deepEqual(al("kisa"), [0, 1.5, 0, 3, 40, "short"]);
    assert.deepEqual(al("reels"), [0, 1.5, 0, 0, 180, "reels"]);
    assert.deepEqual(al("tiktok"), [0, 1.5, 0, 0, 60, "tiktok"]);
    assert.deepEqual(al("eskidikey"), [0, 1.5, 0, 3, 40, "short"]);
    const e = ortak.konuEtkin("uzun");
    assert.equal(e.aspect, "16:9"); assert.equal(e.dikey, false); assert.equal(e.altyaziStil, "cumle");
    assert.equal(ortak.konuEtkin("kisa").altyaziStil, "kelime");
    assert.equal(e.muzikSeviyesi, 0.4); assert.equal(e.muzikDucking, true); assert.equal(e.cesitlilik, true); assert.equal(e.altyazi, true);
    assert.equal(e.gecis, undefined, "verilmemis gecis/efekt/renk undefined kalmali (cesitlilik rotasyonu icin)");
  } finally { o.geri(); }
});

test("konuEtkin: dil/ses/hiz onceligi konu > ayar > varsayilan; eski hedefDakika; outro metni dile gore", () => {
  const o = ortamKur();
  try {
    fs.writeFileSync(o.ayar, JSON.stringify({ kanal: "KANAL-A", dil: "tr", ses: "tr-TR-EmelNeural", sesHizi: "+3%", tur: "haber-spor", vurguRenk: "ff0000" }));
    o.konuYaz("a", { baslik_en: "x" });
    o.konuYaz("b", { baslik_en: "x", ses: "de-DE-ConradNeural", hedefDakika: 2, kanal: "KONU-KANAL" });
    o.konuYaz("c", { baslik_en: "x", dil: "en" });
    const a = ortak.konuEtkin("a"), b = ortak.konuEtkin("b"), c = ortak.konuEtkin("c");
    assert.equal(a.dil, "tr"); assert.equal(a.ses, "tr-TR-EmelNeural"); assert.equal(a.sesHizi, "+3%"); assert.equal(a.kanal, "KANAL-A");
    assert.equal(a.tur, "haber-spor"); assert.equal(a.vurguRenk, "FF0000");
    assert.deepEqual(a.outroMetni, { baslik: "ABONE OL", alt: "BİLDİRİMLERİ AÇ", altSlogan: "Her hafta yeni videolar" });
    assert.equal(b.dil, "de", "dil, ses onekinden"); assert.equal(b.hedefSaniye, 120); assert.equal(b.kanal, "KONU-KANAL");
    assert.equal(c.dil, "en"); assert.equal(c.ses, "en-US-ChristopherNeural", "dil ayardan farkliysa ayarin sesi kullanilmaz");
    assert.equal(ortak.sesSec("tr", "en-US-ChristopherNeural"), "tr-TR-AhmetNeural", "ayarda dil tr ama ses Ingilizceyse dilin sesi");
    assert.equal(ortak.sesSec("tr", "tr-TR-EmelNeural"), "tr-TR-EmelNeural");
    assert.deepEqual(c.outroMetni, { baslik: "SUBSCRIBE", alt: "TURN ON NOTIFICATIONS", altSlogan: "New videos every week" });
    assert.equal(c.altyaziDili, "en");
  } finally { o.geri(); }
});

test("konuEtkin: sema ihlali konu_gecersiz firlatir (betik kendi basina varsayilana dusmez)", () => {
  const o = ortamKur();
  try {
    o.konuYaz("x", { baslik_en: "x", hedefSaniye: 1 });
    assert.throws(() => ortak.konuEtkin("x"), e => e.kod === "konu_gecersiz" && e.cikis === 2 && /hedefSaniye/.test(e.message));
    assert.equal(ortak.konuEtkin("yok"), null);
  } finally { o.geri(); }
});

test("ayarOku: yoksa varsayilan; bozuk/null dosyada ASLA firlatmaz; eski bicim (nasa/wikimedia) kaynaklara tasinir; alt nesneler birlesir", () => {
  const o = ortamKur();
  try {
    assert.equal(ortak.ayarOku().kanal, "KANALIM");
    assert.equal(ortak.ayarOku().diskEsikGB, 5);
    fs.writeFileSync(o.ayar, "null");
    assert.equal(ortak.ayarOku().claudeModel, "claude-opus-5");
    fs.writeFileSync(o.ayar, "{bozuk");
    assert.equal(ortak.ayarOku().dil, "en");
    fs.writeFileSync(o.ayar, JSON.stringify({ kanal: "K", nasa: false, wikimedia: true, onay: { gorsel: true }, outroMetni: { baslik: "B" } }));
    const a = ortak.ayarOku();
    assert.equal(a.kaynaklar.nasa, false); assert.equal(a.kaynaklar.wikimedia, true); assert.equal(a.kaynaklar.pexels, true);
    assert.equal(a.nasa, undefined);
    assert.deepEqual(a.onay, { senaryo: true, gorsel: true });
    assert.deepEqual(a.outroMetni, { baslik: "B", alt: "", altSlogan: "" });
  } finally { o.geri(); }
});

test("ayarDogrula: bilinmeyen anahtari reddeder, sinirlari denetler", () => {
  assert.equal(ortak.ayarDogrula({ kanal: "x", maliyet: { gunlukUSD: 5, aylikUSD: null } }).gecerli, true);
  const r = ortak.ayarDogrula({ bilinmeyen: 1, kanal: "k".repeat(61), dil: "tr-TR", senaryoMotoru: "gpt", diskEsikGB: -1, onay: { senaryo: 1 },
    kaynaklar: { nasa: 1, flickr: true }, maliyet: { gunlukUSD: -2 }, fiyat: { m: { giris: -1 } } });
  assert.equal(r.gecerli, false);
  const al = r.hatalar.map(h => h.alan);
  for (const a of ["bilinmeyen", "kanal", "dil", "senaryoMotoru", "diskEsikGB", "onay.senaryo", "kaynaklar.nasa", "kaynaklar.flickr", "maliyet.gunlukUSD", "fiyat.m"])
    assert.ok(al.includes(a), "eksik: " + a);
  assert.equal(ortak.ayarDogrula(5).gecerli, false);
});
