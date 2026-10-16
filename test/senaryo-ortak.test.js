// lib/senaryo-ortak.js, senaryo-prompt.js, senaryo-iddia.js saf fonksiyon testleri
"use strict";
const Y = require("./senaryo-yardim");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const S = require("../lib/senaryo-ortak");
const P = require("../lib/senaryo-prompt");
const I = require("../lib/senaryo-iddia");
const ortak = require("../lib/ortak");

// ---------------------------------------------------------------- hedefler
test("hedefler: dil, format, kelime hizi ve Shorts sinirlari", () => {
  const uzun = S.hedefler({ format: "long", hedefSaniye: 900, dil: "en" });
  assert.equal(uzun.kelimeHizi, 151);
  assert.equal(uzun.hedefKelime, 2265);
  assert.equal(uzun.tekAtis, false);
  const tr = S.hedefler({ format: "long", hedefSaniye: 900, dil: "tr" });
  assert.equal(tr.kelimeHizi, 113);                          // OLCULEN Turkce hizi
  assert.equal(tr.hedefKelime, Math.round(900 / 60 * 113));
  const kisa = S.hedefler({ format: "short", hedefSaniye: 40, dil: "en" });
  assert.equal(kisa.kelimeHizi, 137);                        // <=60 sn olculen kisa hiz
  assert.equal(kisa.hedefKelime, Math.round(40 / 60 * 137));
  assert.equal(kisa.kisa, true);
  assert.equal(kisa.tekAtis, true);
  const trKisa = S.hedefler({ format: "tiktok", hedefSaniye: 60, dil: "tr" });
  assert.equal(trKisa.kelimeHizi, Math.round(113 * 137 / 151));
  // Shorts teknik siniri 180 sn: ustu kirpilir ve uyari doner
  const asan = S.hedefler({ format: "short", hedefSaniye: 600, dil: "en" });
  assert.equal(asan.hedefSn, 180);
  assert.equal(asan.uyarilar.length, 1);
  // eski hedefDakika okunur; 4 dakikadan kisa uzun video tek atista yazilir
  assert.equal(S.hedefler({ format: "long", hedefDakika: 3 }).hedefSn, 180);
  assert.equal(S.hedefler({ format: "long", hedefSaniye: 180 }).tekAtis, true);
});

// ---------------------------------------------------------------- <anlatim> ayiklama
test("anlatimCikar: etiket ici, kapanmayan etiket, etiketsiz yanit", () => {
  assert.equal(S.anlatimCikar("Here is it\n<anlatim>\nA\n\nB\n</anlatim>\n<gorseller>[]</gorseller>").metin.trim(), "A\n\nB");
  const kesik = S.anlatimCikar("<anlatim>\nA\n\nB yarim");
  assert.equal(kesik.kesik, true);
  assert.equal(kesik.etiketVar, true);
  const yok = S.anlatimCikar("Duz metin burada.\n\n<gorseller>[{\"p\":1}]</gorseller>");
  assert.equal(yok.etiketVar, false);
  assert.ok(!/gorseller/.test(yok.metin));
});

test("paragraflariTemizle: giris cumlesi atilir, kisa vurucu paragraf KORUNUR, saat damgasi gercek cumleyi kesmez", () => {
  const ham = [
    "Sure, here is the narration script:",
    "<anlatim>",
    "Nobody saw it coming.",
    "",
    "3:15 a.m., the alarm went off in the control room and nobody moved.",
    "",
    "00:15 - The second paragraph carries on with a timestamp prefix that must go.",
    "",
    "[B-ROLL: harbour at dawn]",
    "",
    "## Section Two",
    "",
    "**Bold** and `code` markers disappear from the spoken text.",
    "</anlatim>",
  ].join("\n");
  const t = S.paragraflariTemizle(ham);
  const m = t.paragraflar.map(p => p.metin);
  assert.equal(m[0], "Nobody saw it coming.");                              // 21 karakter: ESKI kod bunu siliyordu
  assert.ok(m[1].startsWith("3:15 a.m., the alarm"));                        // saat damgasi regex'i basi kesmiyor
  assert.ok(m[2].startsWith("The second paragraph"));                        // ayiricili damga silindi
  assert.equal(m.length, 4);
  assert.ok(!m.join(" ").includes("**"));
  assert.ok(t.silinen.some(s => s.neden === "yönerge"));
});

test("paragraflariTemizle: etiket disindaki giris cumlesi / sondaki not / model sohbeti ayiklanir", () => {
  const t = S.paragraflariTemizle("Here is the narration script:\n\nOpening paragraph with real content about the topic.\n\nSecond real paragraph of the narration text.\n\nWord count: 2265");
  const m = t.paragraflar.map(p => p.metin);
  assert.equal(m.length, 2);
  assert.ok(t.silinen.some(s => s.neden === "model giriş cümlesi"));
  assert.ok(t.silinen.some(s => s.neden === "model kapanış notu"));
  assert.match(S.temizlikRaporu(t.silinen), /2 paragraf silindi.*ilk satır: /);
});

test("paragraflariTemizle: beklenmedik JSON senaryo SAYILMAZ (hata, cikis 4)", () => {
  assert.throws(() => S.paragraflariTemizle('{"error":{"type":"overloaded"},"script":"x"}'),
    e => e.kod === "senaryo_json" && e.cikis === 4);
  // ama JSON gibi gorunen etiketli gercek metin kabul edilir
  assert.equal(S.paragraflariTemizle("<anlatim>\nJSON is a data format used everywhere today.\n</anlatim>").paragraflar.length, 1);
});

test("gorselAramaCikar: p numarasi, 3 ifade siniri, bozuk JSON'da nesne nesne kurtarma", () => {
  const ok = S.gorselAramaCikar('<gorseller>\n```json\n[{"p":1,"ara":["Albert Einstein 1921","physicist","blackboard","x extra"]},{"p":2,"ara":["a"],"uret":"abstract glow"}]\n```\n</gorseller>');
  assert.deepEqual(ok.get(1).aramalar, ["Albert Einstein 1921", "physicist", "blackboard"]);
  assert.equal(ok.get(2).uret, "abstract glow");
  const bozuk = S.gorselAramaCikar('<gorseller>[{"p":1,"ara":["bir","iki"]},{"p":2,"ara":["uc"]},]</gorseller>');
  assert.deepEqual(bozuk.get(2).aramalar, ["uc"]);
  assert.equal(S.gorselAramaCikar("etiket yok").size, 0);
});

// ---------------------------------------------------------------- cumle bolme / kirpma
test("cumleBol: Dr., U.S., e.g., bas harf ve ondalik cumleyi bolmez", () => {
  const c = S.cumleBol("Dr. Smith met J. K. Rowling in the U.S. last year. They discussed e.g. magic and 3.5 percent growth. It was late!");
  assert.equal(c.length, 3);
  assert.ok(c[0].startsWith("Dr. Smith") && c[0].endsWith("last year."));
  assert.deepEqual(S.cumleBol("Prof. Yılmaz geldi. Doç. Kaya da geldi, vb. kişiler de vardı. Bitti."), [
    "Prof. Yılmaz geldi.", "Doç. Kaya da geldi, vb. kişiler de vardı.", "Bitti."]);
});

test("cumleBol: cumleyi bitiren TEK buyuk harf bolunur ('Plan B. Sonra'); ardisik bas harfler ve unvandan sonraki bas harf bolunmez", () => {
  // Saglik/finans metinlerinde 'Vitamin C.', 'Hepatit B.', 'Plan B.' cumle sonudur: eskiden her tek buyuk harf bas harf sanilip cumleler birlesiyordu
  assert.deepEqual(S.cumleBol("Vitamin C. Yeni cümle burada."), ["Vitamin C.", "Yeni cümle burada."]);
  assert.deepEqual(S.cumleBol("Plan B. Sonra devam ettik."), ["Plan B.", "Sonra devam ettik."]);
  assert.deepEqual(S.cumleBol("Hepatit A. Aşısı yapıldı."), ["Hepatit A.", "Aşısı yapıldı."]);
  assert.deepEqual(S.cumleBol("Formül X. Bunu hesapla."), ["Formül X.", "Bunu hesapla."]);
  assert.deepEqual(S.cumleBol("Plan B. Plan C. Sonra devam."), ["Plan B.", "Plan C.", "Sonra devam."]);
  // bas harf DIZISI ve unvandan sonraki bas harf hala tek cumle
  assert.deepEqual(S.cumleBol("J. K. Rowling yazdı. Sonra gitti."), ["J. K. Rowling yazdı.", "Sonra gitti."]);
  assert.deepEqual(S.cumleBol("Bugün J. K. Rowling geldi. Sonra gitti."), ["Bugün J. K. Rowling geldi.", "Sonra gitti."]);
  assert.deepEqual(S.cumleBol("Dr. J. Smith geldi. Sonra gitti."), ["Dr. J. Smith geldi.", "Sonra gitti."]);
  // kisaltmaIleBitiyor tek basina: sonraki parca yoksa tek bas harf cumle sonu sayilir; unvan/akronim kisaltmadir
  assert.equal(S.kisaltmaIleBitiyor("Vitamin C."), false);
  assert.equal(S.kisaltmaIleBitiyor("Vitamin C.", "Yeni cümle."), false);
  assert.equal(S.kisaltmaIleBitiyor("Bugün J.", "K."), true);
  assert.equal(S.kisaltmaIleBitiyor("Dr. J."), true);
  assert.equal(S.kisaltmaIleBitiyor("see Dr."), true);
  assert.equal(S.kisaltmaIleBitiyor("in the U.S."), true);
});

test("shortsKirp: kanca kalir, tavan asilmaz, paragraf yapisi korunur, tek blok 2 cumlelik paragraflara bolunur", () => {
  const metin = ["Hook sentence stays first.", "Second beat with a new fact now.\nThird beat adds more detail here.", "Fourth paragraph is much longer and carries many many words that will overflow the ceiling for sure okay."].join("\n\n");
  const k = S.shortsKirp(metin, 14);
  assert.ok(S.kelimeSay(k) <= 14, "tavan asildi: " + S.kelimeSay(k));
  assert.ok(k.startsWith("Hook sentence stays first."));
  // hook tek basina tavandan uzun olsa bile birakilir
  assert.equal(S.shortsKirp("One two three four five six seven eight nine ten eleven twelve. Next.", 5), "One two three four five six seven eight nine ten eleven twelve.");
  const tek = S.shortsKirp("A one two three. B one two three. C one two three. D one two three.", 100);
  assert.equal(tek.split("\n\n").length, 2);
  const c = S.kirpCekirdek(["Alpha beta gamma.", "Delta epsilon zeta eta theta."], 5);
  assert.deepEqual(c.kaynak, [0]);
  assert.equal(c.kirpildi, true);
});

test("tekrarIndeksleri: yakin kopya paragraf atilir, farkli paragraflar kalir", () => {
  const a = "The reactor core temperature rose steadily during the long overnight experiment at the plant.";
  const b = "The reactor core temperature rose steadily during the long overnight experiment at the plant today.";
  const c = "Engineers later published an entirely different report about funding priorities and public trust.";
  const at = S.tekrarIndeksleri([a, c, b]);
  assert.deepEqual([...at], [2]);
  assert.deepEqual([...S.tekrarIndeksleri([a, a])], [1]);
});

test("parcaGirisKapanisTemizle: 2. parcadaki selam ve ara parcadaki kapanis atilir", () => {
  const r = S.parcaGirisKapanisTemizle(["Welcome back everyone. The story continues in 1969 with a launch.", "More facts follow here and here.", "Thanks for watching! See you in the next one. Subscribe now."], false, false);
  const m = r.map(x => x.metin).join(" ");
  assert.ok(!/Welcome back/i.test(m));
  assert.ok(!/Thanks for watching|Subscribe/i.test(m));
  assert.ok(/1969/.test(m));
  // son parcada yalniz abone ol cagrisi atilir
  const son = S.parcaGirisKapanisTemizle(["Closing thought about everything. Like and subscribe for more."], true, true);
  assert.ok(!/subscribe/i.test(son[0].metin));
});

test("govdeKirpIndeksleri: tolerans icindeyse dokunmaz; asarsa ortadan, ilk 2 ve son paragraf korunur", () => {
  const ps = Array.from({ length: 10 }, (_, i) => "word ".repeat(20).trim() + " p" + i);   // 10 x 21 kelime
  assert.equal(S.govdeKirpIndeksleri(ps, 210, 1.15).size, 0);
  const at = S.govdeKirpIndeksleri(ps, 126, 1.15);       // hedef 126 -> 144 sinir: en az 4 paragraf atilmali
  assert.ok(at.size >= 3);
  for (const i of at) assert.ok(i >= 2 && i <= 8, "korunan paragraf atildi: " + i);
});

// ---------------------------------------------------------------- dosya yazimi
test("senaryoYedekle: >50 karakter zaman damgali yedek, hicbiri silinmez; yan dosya bayatsa yedege tasinir", () => {
  const d = Y.isOlustur("senaryotest-yedek", { baslik_en: "x" }, "A".repeat(80));
  const y1 = S.senaryoYedekle("senaryotest-yedek");
  assert.ok(fs.existsSync(y1) && /SESLENDIRME-\d{8}-\d{6}\.txt$/.test(y1));
  const y2 = S.senaryoYedekle("senaryotest-yedek");          // ayni saniye: ikinci yedek ezmez
  assert.notEqual(y1, y2);
  assert.ok(fs.existsSync(y1) && fs.existsSync(y2));
  fs.writeFileSync(path.join(d, "Voice", "SESLENDIRME-TAM-METIN.txt"), "kisa");
  assert.equal(S.senaryoYedekle("senaryotest-yedek"), null);   // 50 karakter altinda yedek yok

  fs.writeFileSync(path.join(d, "Voice", "bolumler.json"), "{}");
  assert.deepEqual(S.bayatYanDosyalariKaldir("senaryotest-yedek", ["bolumler.json", "yok.json"]), ["bolumler.json"]);
  assert.ok(!fs.existsSync(path.join(d, "Voice", "bolumler.json")));
  assert.ok(fs.readdirSync(path.join(d, "Voice", "yedek")).some(x => /^bolumler-.*\.json$/.test(x)));
});

test("gorselAramalariYaz: kaynakSenaryoSha1 kanonik paragraf ozetiyle eslesir", () => {
  Y.isOlustur("senaryotest-ara", { baslik_en: "x" });
  const ps = [{ metin: "Birinci paragraf metni burada.", aramalar: ["a", "b"], uret: "" }, { metin: "Ikinci paragraf metni burada.", aramalar: [], uret: "" },
    { metin: "Ucuncu paragraf burada.", aramalar: ["c"], uret: "glow" }];
  S.gorselAramalariYaz("senaryotest-ara", ps, "claude");
  const j = Y.jsonOku(Y.URETIM, "senaryotest-ara", "Voice", "gorsel-aramalari.json");
  assert.equal(j.surum, 1);
  assert.equal(j.uretici, "claude");
  assert.equal(j.kaynakSenaryoSha1, ortak.paragrafOzeti(ps.map(p => p.metin).join("\n\n")));
  assert.deepEqual(j.paragraflar.map(x => x.no), [0, 2]);            // aramasi olmayan paragraf listelenmez, no = kanonik indeks
  assert.equal(j.paragraflar[1].uret, "glow");
});

test("trendReferansi: yalniz trend/ ve viral-analiz/ icindeki .json; hook ve ortanca sure prompta girer", () => {
  const kok = process.env.OTOMASYON_RAPOR_KOKU;
  fs.mkdirSync(path.join(kok, "trend"), { recursive: true });
  fs.writeFileSync(path.join(kok, "trend", "x.json"), JSON.stringify({ satirlar: [{ hook: "Cold open on a ticking clock", sureSn: 30 }, { hook: "Shock number first", sureSn: 50 }, { sureSn: 40 }] }));
  const r = S.trendReferansi({ _trendRapor: "trend/x.json" });
  assert.match(r, /Median length of the trending videos: 40 seconds/);
  assert.match(r, /Cold open on a ticking clock/);
  assert.equal(S.trendReferansi({ _trendRapor: "../../etc/passwd.json" }), "");
  assert.equal(S.trendReferansi({ _trendRapor: "trend/yok.json" }), "");
  assert.equal(S.trendReferansi({}), "");
});

// ---------------------------------------------------------------- istemler
test("sistemPromptu: dil, tur, kanal sesi, kisisel katki, arastirma ve kisa video kurallari", () => {
  const taban = { tur: "belgesel", dil: "tr", dilAdi: "Turkish", kisa: false, format: "long", hedefKelime: 1695, hedefSn: 900, hedefDk: 15, kelimeHizi: 113, konuNotu: "Roma", baslik: "Roma" };
  const s = P.sistemPromptu(Object.assign({}, taban, { kanalSesi: { tarif: "dry humour", ornekParagraf: "Ornek metin." }, kisiselKatki: "Bence her imparatorluk kendini yer.", arastirma: "Kaynak: MS 476." }));
  assert.match(s, /ENTIRELY IN TURKISH/);
  assert.match(s, /CHANNEL VOICE/);
  assert.match(s, /dry humour/);
  assert.match(s, /AUTHOR'S OWN PERSPECTIVE/);
  assert.match(s, /<kaynak>[\s\S]*MS 476[\s\S]*<\/kaynak>/);
  assert.match(s, /Every claim must be true/);
  assert.match(s, /re-?hook|fresh reason to stay/i);                  // uzun videoda yeniden-kanca kurali
  const reklam = P.sistemPromptu(Object.assign({}, taban, { tur: "reklam" }));
  assert.match(reklam, /never invent prices/i);
  const kisa = P.sistemPromptu(Object.assign({}, taban, { kisa: true, format: "tiktok", hedefKelime: 100, hedefSn: 45, kelimeHizi: 137, dil: "en", dilAdi: "English" }));
  assert.match(kisa, /first 2 seconds/);
  assert.match(kisa, /HARD LIMIT: at most 100 words/);
  assert.match(kisa, /TikTok/);
  assert.ok(!/4-5 sentences|Three short paragraphs/.test(kisa));      // eski celiskili yapi gitti
});

test("planCoz: gecerli plan, kod citi, yanlis bolum sayisi", () => {
  const gec = JSON.stringify({ ozet: "Ozet", bolumler: Array.from({ length: 12 }, (_, i) => ({ ad: "Bolum " + i, ozet: "o", acik_dongu: "d" })) });
  assert.equal(P.planCoz("```json\n" + gec + "\n```", 13).bolumler.length, 12);
  assert.equal(P.planCoz("sohbet", 13), null);
  assert.equal(P.planCoz(JSON.stringify({ bolumler: [{ ad: "tek" }] }), 13), null);
  assert.equal(P.bolumSayisi(900), 13);
  assert.equal(P.bolumSayisi(3600), 24);
});

// ---------------------------------------------------------------- iddia
test("yerelIddialar: rakam, tarih, alinti ve isim desenleri; guven kaynaksiz", () => {
  const ps = ["The engine lost 30% of thrust in 1969. Neil Armstrong said \"That's one small step for man\" as cameras rolled.", "Nothing factual in this closing line at all."];
  const l = I.yerelIddialar(ps);
  const turler = new Set(l.map(x => x.tur));
  for (const t of ["rakam", "tarih", "alinti", "isim"]) assert.ok(turler.has(t), "eksik tur: " + t);
  assert.ok(l.every(x => x.paragraf === 0 && x.guven === "kaynaksiz"));
});

test("iddia raporu: kaynak metni verilirse eslesme guveni; model riski; ozet sayilari; md uyari icerir", () => {
  const model = [
    { paragraf: 0, tur: "rakam", metin: "Apollo 11 landed in 1969", baglam: "1969", modelRiski: "yuksek", not: "tarihi kontrol et" },
    { paragraf: 1, tur: "isim", metin: "Margaret Hamilton led the software team", baglam: "Margaret Hamilton", modelRiski: "orta", not: "" },
  ];
  const kaynakli = I.rapor("claude", "m", model, "Apollo 11 landed on the Moon in 1969 according to NASA records. Kaynak metni yeterince uzun olsun diye eklenen dolgu cümlesi burada.");
  assert.equal(kaynakli.iddialar[0].guven, "yuksek");                 // rakam ve isim kaynakta geciyor
  assert.equal(kaynakli.iddialar[1].guven, "dusuk");                  // Margaret Hamilton kaynakta yok
  assert.equal(kaynakli.ozet.dusukGuven, 1);
  const kaynaksiz = I.rapor("claude", "m", model, "");
  assert.ok(kaynaksiz.iddialar.every(x => x.guven === "kaynaksiz"));
  assert.equal(kaynaksiz.ozet.dusukGuven, 1);                         // modelin "yuksek" riskli dedigi
  const md = I.raporMd("deneme", kaynaksiz);
  assert.match(md, /DOĞRULAMA DEĞİLDİR/);
  assert.match(md, /Kaynak metni verilmedi/);
});

test("modelIddialariniCoz: gecersiz paragraf/tur duzeltilir, JSON degilse null", () => {
  const l = I.modelIddialariniCoz('```json\n{"iddialar":[{"paragraf":2,"tur":"garip","metin":"x iddiasi","risk":"yuksek","not":"n"},{"paragraf":99,"tur":"rakam","metin":"yok"}]}\n```', 3);
  assert.equal(l.length, 1);
  assert.equal(l[0].paragraf, 1);
  assert.equal(l[0].tur, "olay");
  assert.equal(I.modelIddialariniCoz("sohbet", 3), null);
});

test("dilUyarisi: Turkce video icin Ingilizce metin ve tersi uyari verir; kisa metin ve dogru dil uyarmaz", () => {
  const en = "The empire collapsed after the long decline of the army and the economy, and it was the end of the old order in the world that we know. ".repeat(3);
  const tr = "İmparatorluk, ordunun ve ekonominin uzun çöküşünün ardından yıkıldı ve bildiğimiz eski düzenin sonu böylece geldi çatmıştı. ".repeat(3);
  assert.match(S.dilUyarisi(en, "tr"), /İngilizce görünüyor ama video dili 'tr'/);
  assert.match(S.dilUyarisi(tr, "en"), /Türkçe görünüyor/);
  assert.equal(S.dilUyarisi(en, "en"), "");
  assert.equal(S.dilUyarisi(tr, "tr"), "");
  assert.equal(S.dilUyarisi("The short text.", "tr"), "");
});

test("paragraflariTemizle: 'Part 3: Baslik' satiri atilir ama 'Part 3 of the plan failed.' cumlesi kalir", () => {
  const t = S.paragraflariTemizle("<anlatim>\nPart 3: The Fall of Rome\nThe walls finally gave way after a long siege.\n\nPart 3 of the plan failed completely that night.\n</anlatim>");
  const m = t.paragraflar.map(p => p.metin);
  assert.deepEqual(m, ["The walls finally gave way after a long siege.", "Part 3 of the plan failed completely that night."]);
});
