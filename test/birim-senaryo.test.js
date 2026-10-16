// BIRIM TESTLERI — senaryo uzunluk/sure mantigi, dil ve format sinirlari, model ciktisi temizligi.
// Ag YOK: Claude istemcisi enjeksiyonla sahtelenir (test/senaryo-yardim.js gecici .env/uretim kurar; gercek .env'e dokunulmaz).
// Bu dosya bulgu listesindeki B012-B016 ve B013'un kod duzeyindeki kanitidir.
"use strict";
const Y = require("./senaryo-yardim");           // ENV yonlendirmesi icin EN ONCE
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ortak = require("../lib/ortak");
const S = require("../lib/senaryo-ortak");
const P = require("../lib/senaryo-prompt");
const SC = require("../senaryo-claude");

let sayac = 0;
const yeniIs = (konu, senaryo) => { const ad = "birimsenaryo" + (++sayac); Y.isOlustur(ad, konu, senaryo); return ad; };
const kelime = S.kelimeSay;
const ana = (ad, istemci, ek) => Y.sessiz(() => SC.ana([ad].concat(ek || []), { istemci }));
const dizin = ad => path.join(Y.URETIM, ad);

// benzersiz sozcuklu, cumleli paragraflar: "w0 w1 ... w{n-1}." (tekrar ayiklama onlari silmesin)
function paragraflar(etiket, toplamKelime, paragrafBasina) {
  const ps = [];
  let k = 0, kalan = toplamKelime;
  while (kalan > 0) {
    const m = Math.min(paragrafBasina || 20, kalan);
    const cumleler = [];
    for (let c = 0; c < m; c += 10) {
      const n = Math.min(10, m - c);
      cumleler.push(Array.from({ length: n }, (_, i) => etiket + "w" + (k * 1000 + c + i)).join(" ") + ".");
    }
    ps.push(cumleler.join(" "));
    kalan -= m; k++;
  }
  return ps;
}
const anlatimSar = ps => "<anlatim>\n" + ps.join("\n\n") + "\n</anlatim>";

// ---------------------------------------------------------------- dil / format sinirlari
test("kelimeHizi: en 151 ve tr 113 OLCULDU; digerleri 140; bolge kodu ve buyuk harf tolere edilir", () => {
  assert.equal(ortak.kelimeHizi("en"), 151);
  assert.equal(ortak.kelimeHizi("tr"), 113);
  assert.equal(ortak.kelimeHizi("TR"), 113);
  assert.equal(ortak.kelimeHizi("tr-TR"), 113);
  assert.equal(ortak.kelimeHizi("de"), 140);
  assert.equal(ortak.kelimeHizi(), 151);
  assert.equal(ortak.kelimeHizi(null), 151);
});

test("formatSiniri: Shorts teknik siniri 180 sn (Ekim 2024), reels 1200, tiktok 600; bilinmeyen format uzun sayilir; kopya doner", () => {
  assert.equal(ortak.formatSiniri("short").teknikMaxSn, 180);
  assert.equal(ortak.formatSiniri("short").oneriSn, 40);
  assert.equal(ortak.formatSiniri("reels").teknikMaxSn, 1200);
  assert.equal(ortak.formatSiniri("tiktok").teknikMaxSn, 600);
  assert.equal(ortak.formatSiniri("long").oneriSn, 900);
  assert.equal(ortak.formatSiniri("yok-boyle-bir-format").dikey, false);
  assert.equal(ortak.formatSiniri("short").dikey, true);
  const a = ortak.formatSiniri("short");
  a.teknikMaxSn = 1;                                   // dis degisiklik ortak tabloyu bozmamali
  assert.equal(ortak.formatSiniri("short").teknikMaxSn, 180);
});

test("hedefler: Shorts 40 sn = 91 kelime (137 kel/dk), uzun 15 dk en = 2265, tr = 1695 (113 kel/dk)", () => {
  const k = S.hedefler({ format: "short" });
  assert.equal(k.hedefSn, 40);
  assert.equal(k.kelimeHizi, 137);                     // 60 sn ve altinda OLCULEN oran
  assert.equal(k.hedefKelime, 91);
  assert.equal(k.kisa, true);
  assert.equal(k.dikey, true);
  const u = S.hedefler({ format: "long", hedefSaniye: 900 });
  assert.equal(u.hedefKelime, 2265);
  assert.equal(u.kelimeHizi, 151);
  assert.equal(S.hedefler({ format: "long", hedefSaniye: 900, dil: "tr" }).hedefKelime, 1695);
  assert.equal(S.hedefler({ format: "long", hedefSaniye: 900, dil: "tr" }).dilAdi, "Turkish");
});

test("hedefler: kisa formatta teknik siniri asan hedef kirpilir ve UYARI verir; reels 180 sn sinira takilmaz", () => {
  const s = S.hedefler({ format: "short", hedefSaniye: 500 });
  assert.equal(s.hedefSn, 180);
  assert.equal(s.uyarilar.length, 1);
  assert.match(s.uyarilar[0], /180/);
  const r = S.hedefler({ format: "reels" });
  assert.equal(r.hedefSn, 180);
  assert.equal(r.uyarilar.length, 0);
  assert.equal(r.kelimeHizi, 151);                     // 60 sn ustu: normal hiz
  assert.equal(S.hedefler({ format: "reels", hedefSaniye: 1300 }).hedefSn, 1200);
  assert.equal(S.hedefler({ format: "tiktok", hedefSaniye: 700 }).hedefSn, 600);
});

test("hedefler: tek atis esigi 240 sn; eski hedefDakika okunur; aspect 9:16 kisa sayilir; gecersiz dil en olur", () => {
  assert.equal(S.hedefler({ format: "long", hedefSaniye: 239 }).tekAtis, true);
  assert.equal(S.hedefler({ format: "long", hedefSaniye: 240 }).tekAtis, false);
  assert.equal(S.hedefler({ format: "long", hedefDakika: 10 }).hedefSn, 600);
  assert.equal(S.hedefler({ aspect: "9:16" }).format, "short");
  assert.equal(S.hedefler({ format: "long", dil: "Turkce" }).dil, "en");
  assert.equal(S.hedefler({}).format, "long");
  assert.equal(S.hedefler(null).hedefSn, 900);
});

test("sureTahmin / sureMetni", () => {
  assert.equal(S.sureTahmin(2265, 151), 900);
  assert.equal(S.sureTahmin(113, 113), 60);
  assert.equal(S.sureTahmin(100), Math.round(100 / 151 * 60));
  assert.equal(S.sureMetni(45), "45 sn");
  assert.equal(S.sureMetni(75), "1 dk 15 sn");
  assert.equal(S.dilAdi("tr"), "Turkish");
  assert.equal(S.dilAdi("de"), "German");
});

// ---------------------------------------------------------------- model ciktisi temizligi
test("paragraflariTemizle: model giris cumlesi ve kapanis notu atilir, kisa vurucu paragraf ve '3:15 a.m.' acilisi KORUNUR", () => {
  const ham = [
    "Here is the narration script:", "",
    "Nobody saw it coming.", "",                                   // 21 karakter: eskiden >25 filtresiyle silinirdi
    "3:15 a.m., the alarm went off in the empty lab and nobody noticed.", "",
    "[B-ROLL: empty corridor]", "",
    "Word count: 41",
  ].join("\n");
  const r = S.paragraflariTemizle(ham);
  const metinler = r.paragraflar.map(p => p.metin);
  assert.deepEqual(metinler, ["Nobody saw it coming.", "3:15 a.m., the alarm went off in the empty lab and nobody noticed."]);
  assert.ok(r.silinen.length >= 2);
  assert.match(S.temizlikRaporu(r.silinen), /paragraf silindi.*ilk satır/);
  assert.equal(S.temizlikRaporu([]), "");
});

test("paragraflariTemizle: <anlatim> disindaki metin alinmaz; kapanis etiketi yoksa (token siniri) kesik isaretlenir", () => {
  const tam = S.paragraflariTemizle("Selam!\n<anlatim>\nBirinci paragraf burada duruyor.\n\nIkinci paragraf da burada.\n</anlatim>\n<gorseller>[]</gorseller>");
  assert.equal(tam.etiketVar, true);
  assert.equal(tam.kesik, false);
  assert.deepEqual(tam.paragraflar.map(p => p.metin), ["Birinci paragraf burada duruyor.", "Ikinci paragraf da burada."]);
  const kesik = S.paragraflariTemizle("<anlatim>\nBirinci paragraf tamam.\n\nIkinci paragraf yarim kal");
  assert.equal(kesik.kesik, true);
  assert.equal(kesik.paragraflar.length, 2);
});

test("paragraflariTemizle: beklenmedik JSON yaniti senaryo SAYILMAZ (cikis 4)", () => {
  assert.throws(() => S.paragraflariTemizle('{"error":{"type":"overloaded","message":"x"}}'),
    e => e instanceof ortak.OrtakHata && e.cikis === ortak.CIKIS.YETERSIZ);
  assert.throws(() => S.paragraflariTemizle('[{"a":1}]'), e => e.cikis === ortak.CIKIS.YETERSIZ);
});

test("blokTemizle: yonerge/markdown/konusmaci etiketi/zaman damgasi ayiklanir, metin kalir", () => {
  assert.equal(S.blokTemizle("## Part 3\nNARRATOR: The **old** harbour woke slowly."), "The old harbour woke slowly.");
  assert.equal(S.blokTemizle("00:15 - The engine started."), "The engine started.");
  assert.equal(S.blokTemizle("(pause) Then silence."), "Then silence.");
});

test("cumleBol: kisaltmalarda (Dr., U.S., vs.) bolunmez", () => {
  const c = S.cumleBol("Dr. Smith moved to the U.S. in 1999. He liked it there. Prof. Lee agreed.");
  assert.deepEqual(c, ["Dr. Smith moved to the U.S. in 1999.", "He liked it there.", "Prof. Lee agreed."]);
  assert.equal(S.kisaltmaIleBitiyor("see Dr."), true);
  assert.equal(S.kisaltmaIleBitiyor("It ended."), false);
});

test("shortsKirp: hedef kelime TAVAN, ilk cumle (kanca) kalir, kisaltmadan bolunmez", () => {
  const ps = paragraflar("k", 300, 30);
  ps[0] = "Dr. Rivera never expected it. " + ps[0];
  const metin = ps.join("\n\n");
  const kirpik = S.shortsKirp(metin, 91);
  assert.ok(kelime(kirpik) <= 91, "kelime: " + kelime(kirpik));
  assert.ok(kelime(kirpik) >= 60, "fazla kirpildi: " + kelime(kirpik));
  assert.ok(kirpik.startsWith("Dr. Rivera never expected it."));
  assert.ok(ortak.paragraflaraBol(kirpik).length >= 2, "paragraf yapisi korunmali");
  assert.equal(S.shortsKirp("", 50), "");
  // hedefin altindaki metne dokunmaz
  const kisa = "Bir cumle burada.\n\nIkinci cumle de burada.";
  assert.equal(S.shortsKirp(kisa, 50), kisa);
});

test("tekrarIndeksleri: ayni ya da cok benzer paragraf ikinci kez atilir", () => {
  const a = "the roman empire collapsed slowly because taxes failed armies grew restless and borders thinned out";
  const at = S.tekrarIndeksleri([a, "tamamen farkli bir konu hakkinda uzun bir paragraf yaziyoruz burada bugun", a]);
  assert.deepEqual([...at], [2]);
});

test("dilUyarisi: dil tr ama metin Ingilizce -> uyari; uyumluysa bos; kisa metinde sessiz", () => {
  const en = "The old harbour was the heart of the city and it was the place that the people of the coast went to for the news of the day with the boats in the water and the sun on the stones. ".repeat(2);
  assert.match(S.dilUyarisi(en, "tr"), /İngilizce görünüyor/);
  assert.equal(S.dilUyarisi(en, "en"), "");
  assert.equal(S.dilUyarisi("The harbour.", "tr"), "");
  const tr = "Şehrin kalbi eski limandı ve çevredeki köylerden gelen balıkçılar sabahın ilk ışıklarıyla birlikte oraya akın ederdi; çarşı, çay ocakları ve gümrük binası aynı sokakta sıralanırdı. ".repeat(2);
  assert.match(S.dilUyarisi(tr, "en"), /Türkçe görünüyor/);
  assert.equal(S.dilUyarisi(tr, "tr"), "");
});

// ---------------------------------------------------------------- trend / viral rapor yardimcilari (B020)
test("rapor: bicim sonsuz/NaN/negatif sayiyi 'InfinityB' diye YAZMAZ, esikleri yuvarlanmis degere gore uygular; ortanca bos listede 0", () => {
  const R = require("../lib/senaryo-rapor");
  for (const kotu of [Infinity, -Infinity, NaN, undefined, null, "abc", -5]) assert.equal(R.bicim(kotu), "0", String(kotu));
  assert.equal(R.bicim(999), "999");
  assert.equal(R.bicim(1500), "2K");
  assert.equal(R.bicim(999499), "999K");
  assert.equal(R.bicim(999999), "1.0M", "'1000K' olmamali");
  assert.equal(R.bicim(1500000), "1.5M");
  assert.equal(R.bicim(999950000), "1.0B");
  assert.equal(R.bicim(2.5e9), "2.5B");
  assert.equal(R.ortanca([]), 0);
  assert.equal(R.ortanca([5, NaN, "x", 1, 3]), 3);
});

test("rapor: dosya adi Turkce harfi korur (ASCII'ye cevirir), Latin disi konu 'n-<sha6>' alir, bos konu 'genel'; farkli konu ayni ada dusmez", () => {
  const R = require("../lib/senaryo-rapor");
  const ad = k => R.raporAdi(k).replace(/^\d{4}-\d{2}-\d{2}-/, "");
  assert.equal(ad("yapay zekâ"), "yapay-zeka");
  assert.equal(ad("Çay & Şeker"), "cay-seker");
  assert.match(ad("你好世界"), /^n-[0-9a-f]{6}$/);
  assert.notEqual(ad("你好世界"), ad("你好地球"));
  assert.equal(ad(""), "genel");
  assert.equal(ad(null), "genel");
  assert.ok(ad("x".repeat(200)).length <= 40);
});

// ---------------------------------------------------------------- istem (dil parametresi, B013/B018)
const temelBaglam = (ek) => Object.assign({ tur: "belgesel", dil: "en", dilAdi: "English", kisa: false, format: "long", hedefKelime: 2265,
  hedefSn: 900, hedefDk: 15, kelimeHizi: 151, konuNotu: "Roma", baslik: "Roma" }, ek || {});

test("sistemPromptu: dil parametreli (Ingilizce'ye sabit DEGIL); Turkce videoda TURKISH yazar", () => {
  const tr = P.sistemPromptu(temelBaglam({ dil: "tr", dilAdi: "Turkish" }));
  assert.match(tr, /ENTIRELY IN TURKISH/);
  assert.doesNotMatch(tr, /ENTIRELY IN ENGLISH/);
  assert.match(P.sistemPromptu(temelBaglam()), /ENTIRELY IN ENGLISH/);
  assert.match(P.vidiqBrief(temelBaglam({ dil: "es", dilAdi: "Spanish" })), /WRITE ENTIRELY IN SPANISH/);
});

test("sistemPromptu: kisa video sert kelime siniri, tur/ton/kanalSesi/kisiselKatki/arastirma girer; KANALIM adi girmez", () => {
  const kisa = P.sistemPromptu(temelBaglam({ kisa: true, format: "short", hedefKelime: 91, hedefSn: 40, kelimeHizi: 137 }));
  assert.match(kisa, /HARD LIMIT: at most 91 words/);
  assert.match(kisa, /first 2 seconds/);
  const tam = P.sistemPromptu(temelBaglam({ tur: "reklam", ton: "warm and plain", kanal: "KANALIM",
    kanalSesi: { tarif: "dry humour", ornekParagraf: "Ornek paragraf." }, kisiselKatki: "Bence en onemlisi sabir.",
    arastirma: "Kaynak: 1923 yilinda kuruldu." }));
  for (const parca of [/never invent prices/, /TONE: warm and plain/, /dry humour/, /AUTHOR'S OWN PERSPECTIVE/, /sabir/, /<kaynak>\nKaynak: 1923/])
    assert.match(tam, parca);
  assert.doesNotMatch(tam, /The channel is called/);
  assert.match(P.sistemPromptu(temelBaglam({ kanal: "Zaman Kirigi" })), /The channel is called "Zaman Kirigi"/);
});

test("bolumSayisi: ~70 sn/bolum, 3..24; planCoz: gecersiz plan null, makul plan kabul", () => {
  assert.equal(P.bolumSayisi(900), 13);
  assert.equal(P.bolumSayisi(60), 3);
  assert.equal(P.bolumSayisi(100000), 24);
  assert.equal(P.planCoz("Tabii, plan şöyle", 5), null);
  const ok = P.planCoz('```json\n{"ozet":"x","bolumler":[{"ad":"A","ozet":"a"},{"ad":"B","ozet":"b"},{"ad":"C","ozet":"c"}]}\n```', 4);
  assert.equal(ok.bolumler.length, 3);
  assert.equal(P.planCoz('{"bolumler":[{"ad":"A"}]}', 6), null);       // yarisindan az
});

// ---------------------------------------------------------------- sahte Claude ile uctan uca (ag yok, ucret yok)
test("Claude yolu: kisa Turkce video — kelime tavani UYGULANIR (eski hata: yalniz uyari), 113->103 kel/dk, istem Turkce", async () => {
  const ad = yeniIs({ baslik_en: "Test", _not: "Bir deney", format: "short", hedefSaniye: 40, dil: "tr" });
  const ps = paragraflar("a", 260, 20);                        // modelin tavani asan 260 kelimelik yaniti
  const ist = Y.sahteClaude(() => ({ text: anlatimSar(ps) + "\n<ozet>Kisa ozet.</ozet>" }));
  const r = await ana(ad, ist, ["--iddia-yok"]);
  assert.equal(r.dil, "tr");
  assert.equal(r.kelimeHizi, 103);                            // round(113 * 137 / 151)
  assert.equal(r.hedefKelime, 69);
  assert.ok(r.kelime <= 69, "tavan asildi: " + r.kelime);
  assert.ok(r.kelime >= 40, "asiri kirpildi: " + r.kelime);
  const yazilan = fs.readFileSync(path.join(dizin(ad), "Voice", "SESLENDIRME-TAM-METIN.txt"), "utf8");
  assert.equal(kelime(yazilan), r.kelime);
  assert.match(Y.sistemMetni(ist.cagrilar[0]), /ENTIRELY IN TURKISH/);
  assert.match(Y.sistemMetni(ist.cagrilar[0]), /HARD LIMIT: at most 69 words/);
});

test("Claude yolu: maliyet sinirina takilirsa BASLAMADAN cikis 7 ve model hic cagrilmaz", async () => {
  const ad = yeniIs({ baslik_en: "Test", _not: "Bir deney", format: "short", hedefSaniye: 40, maliyetUstSinirUSD: 0.00001 });
  const ist = Y.sahteClaude(() => ({ text: anlatimSar(paragraflar("m", 90)) }));
  await assert.rejects(() => ana(ad, ist), e => e instanceof ortak.OrtakHata && e.cikis === ortak.CIKIS.MALIYET);
  assert.equal(ist.cagrilar.length, 0);
  assert.equal(fs.existsSync(path.join(dizin(ad), "Voice", "SESLENDIRME-TAM-METIN.txt")), false);
});

test("Claude yolu: uzun video %95 altinda kalirsa ana dosya YAZILMAZ, metin -yarim.txt olarak saklanir, cikis 4", async () => {
  const ad = yeniIs({ baslik_en: "Test", _not: "Bir deney", format: "long", hedefSaniye: 180 });      // 453 kelime, tek atis
  const ist = Y.sahteClaude((params) => {
    const ist1 = params.messages[0].content;
    if (/CURRENT SCRIPT:/.test(ist1)) return { text: anlatimSar(paragraflar("dv", 12)) };            // devam turu da yetersiz
    return { text: anlatimSar(paragraflar("ta", 200)) };                                              // hedefin ~%44'u
  });
  await assert.rejects(() => ana(ad, ist, ["--iddia-yok"]), e => e instanceof ortak.OrtakHata && e.cikis === ortak.CIKIS.YETERSIZ && /kelimede kaldı/.test(e.message));
  const ses = path.join(dizin(ad), "Voice");
  assert.equal(fs.existsSync(path.join(ses, "SESLENDIRME-TAM-METIN.txt")), false);
  assert.equal(fs.existsSync(path.join(ses, "SESLENDIRME-TAM-METIN-yarim.txt")), true);
  assert.ok(kelime(fs.readFileSync(path.join(ses, "SESLENDIRME-TAM-METIN-yarim.txt"), "utf8")) >= 200);
});

test("Claude yolu: mevcut senaryo uzerine yazilirsa ZAMAN DAMGALI yedek alinir; ikinci yazimda ilk yedek silinmez", async () => {
  const eski = "Elle duzeltilmis birinci paragraf. ".repeat(10) + "\n\n" + "Elle duzeltilmis ikinci paragraf. ".repeat(10);
  const ad = yeniIs({ baslik_en: "Test", _not: "Bir deney", format: "short", hedefSaniye: 40 }, eski);
  const ist = Y.sahteClaude(() => ({ text: anlatimSar(paragraflar("y", 80)) }));
  await ana(ad, ist, ["--iddia-yok"]);
  const yedek = path.join(dizin(ad), "Voice", "yedek");
  const ilk = fs.readdirSync(yedek).filter(f => /^SESLENDIRME-\d{8}-\d{6}/.test(f));
  assert.equal(ilk.length, 1);
  assert.equal(fs.readFileSync(path.join(yedek, ilk[0]), "utf8"), eski);
  await ana(ad, ist, ["--iddia-yok"]);
  const sonra = fs.readdirSync(yedek).filter(f => /^SESLENDIRME-\d{8}-\d{6}/.test(f));
  assert.equal(sonra.length, 2, "ilk (elle duzeltilmis) yedek ezilmemeli");
  assert.ok(sonra.some(f => fs.readFileSync(path.join(yedek, f), "utf8") === eski));
});
