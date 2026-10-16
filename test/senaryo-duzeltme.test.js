// Senaryo grubu DUZELTME turu regresyon testleri (B011, B018, B020 + denetci regresyonlari).
// Ag yok, ucret yok: yerel SAHTE vidIQ MCP sunucusu ve SAHTE Claude istemcisi.
"use strict";
const Y = require("./senaryo-yardim");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const S = require("../lib/senaryo-ortak");
const P = require("../lib/senaryo-prompt");
const I = require("../lib/senaryo-iddia");
const SY = require("../senaryo-yaz");
const SC = require("../senaryo-claude");
const VA = require("../viral-analiz");
process.env.VIDIQ_KEY = "test-vidiq";

let sayac = 0;
const yeniIs = (konu) => { const ad = "senaryotest-d" + (++sayac); Y.isOlustur(ad, konu); return ad; };
const metinOku = ad => Y.oku(Y.URETIM, ad, "Voice", "SESLENDIRME-TAM-METIN.txt");

// ================================================================ parcaGirisKapanisTemizle (regresyon 1)
test("kapanis temizligi: 'unlike/alike/dislike/like a wall' gercek anlatimdir, SILINMEZ; tek basina 'like' kapanis degildir", () => {
  const ps = ["The wave moved like nothing the coast had ever seen. It was unlike any storm on record."];
  const atilan = [];
  const r = S.parcaGirisKapanisTemizle(ps, true, false, atilan);
  assert.equal(r.length, 1);
  assert.equal(r[0].metin, ps[0]);
  assert.deepEqual(atilan, []);
  for (const s of ["The two towns were alike in almost every way.", "Critics dislike the plan for good reason.",
    "The wave rose like a wall of dark glass over the harbor.", "The hammer hit the bell and the whole valley heard it.",
    "The emperor gave the crowd a thumbs up and the arena roared."]) {
    const x = S.parcaGirisKapanisTemizle(["Opening sentence about the harbor town. " + s], false, false);
    assert.ok(x[0].metin.endsWith(s), "silindi: " + s);
  }
});

test("kapanis temizligi: son parcada 'like a wall' cumlesi kalir; abone ol cagrisi gider ve RAPORLANIR", () => {
  const son = S.parcaGirisKapanisTemizle(["The storm passed. The wave rose like a wall of dark glass over the harbor."], false, true);
  assert.match(son[0].metin, /like a wall of dark glass over the harbor\.$/);
  const atilan = [];
  const r = S.parcaGirisKapanisTemizle(["Welcome back everyone. The story goes on in 1969.", "Closing thought. Thanks for watching! Hit the bell and like and subscribe."], false, false, atilan);
  const m = r.map(x => x.metin).join(" ");
  assert.ok(!/Welcome back|Thanks for watching|subscribe/i.test(m));
  assert.ok(/1969/.test(m));
  assert.deepEqual(atilan.map(a => a.neden), ["selam", "abone/beğen çağrısı", "veda"]);
  assert.match(S.temizlikRaporu(atilan, "cümle"), /^3 cümle silindi \(selam, abone\/beğen çağrısı, veda\), ilk satır: Welcome back everyone\.$/);
  // veda cumlesi son parcada kalir (yalniz cagri gider)
  const sonVeda = S.parcaGirisKapanisTemizle(["Last fact here. Thanks for watching! Like and subscribe."], false, true);
  assert.match(sonVeda[0].metin, /Thanks for watching!$/);
});

test("selam temizligi: 'Hi-tech' ve 'Hello Kitty' selam DEGIL; 'Hello everyone' / 'Hi, ...' selam", () => {
  for (const s of ["Hi-tech factories changed the valley in a decade.", "Hello Kitty was created in 1974 at a small stationery company."]) {
    const x = S.parcaGirisKapanisTemizle([s + " Another sentence follows right here."], true, false);
    assert.ok(x[0].metin.startsWith(s.slice(0, 8)), "silindi: " + s);
  }
  const g = S.parcaGirisKapanisTemizle(["Hello everyone. The year was 1969.", "Another paragraph with a new fact."], true, false);
  assert.equal(g[0].metin, "The year was 1969.");
  assert.equal(g.length, 2);
  const h = S.parcaGirisKapanisTemizle(["Hi, today we look at the moon. Fact two follows."], true, false);
  assert.equal(h[0].metin, "Fact two follows.");
});

// ================================================================ giris cumlesi + <anlatim> (regresyon 3)
test("paragraflariTemizle: <anlatim> icindeki 'Here is the text on the wall...' paragrafi SILINMEZ; etiketsiz sohbet girisi hala silinir", () => {
  const ic = "Here is the text on the wall that nobody could read.\n\nThe plaster had flaked away long before the first visitors arrived.";
  const t = S.paragraflariTemizle("Sure, here is the script:\n<anlatim>\n" + ic + "\n</anlatim>");
  assert.equal(t.paragraflar.length, 2);
  assert.match(t.paragraflar[0].metin, /^Here is the text on the wall/);
  assert.deepEqual(t.silinen, []);
  const e = S.paragraflariTemizle("Here is the narration script:\n\nFirst real paragraph of the story goes right here today.\n\nSecond real paragraph follows after it.");
  assert.equal(e.paragraflar.length, 2);
  assert.equal(e.silinen[0].neden, "model giriş cümlesi");
});

// ================================================================ vidIQ yolu uctan uca
function sahteVidiq(metinUret) {
  const durum = { isler: new Map(), args: [], n: 0 };
  return {
    durum,
    araclar: {
      vidiq_balance: () => ({ structured: { type: "limited", totalCredits: 1000 } }),
      vidiq_generate_script: (arg) => {
        durum.args.push(arg);
        const id = "is-" + (++durum.n);
        durum.isler.set(id, { arg, no: durum.n });
        return { structured: { mcpJobId: id } };
      },
      vidiq_job_poll: (arg) => { const is = durum.isler.get(arg.mcpJobId); return { structured: { status: "completed", result: metinUret(is.arg, is.no) } }; },
    },
  };
}
function paragraf(etiket, n, k) {
  const sozler = Array.from({ length: n }, (_, i) => etiket + "w" + (k * 100 + i));
  const c = [];
  for (let i = 0; i < sozler.length; i += 12) { const x = sozler.slice(i, i + 12); x[0] = x[0][0].toUpperCase() + x[0].slice(1); c.push(x.join(" ") + "."); }
  return c.join(" ");
}
// kelime sayisi kadar paragraf; sonuna ek cumle(ler) eklenebilir
function metinUret(etiket, kelime, ekSon) {
  const ps = []; let kalan = kelime, k = 0;
  while (kalan > 0) { const n = Math.min(90, kalan); ps.push(paragraf(etiket, n, k++)); kalan -= n; }
  if (ekSon) ps[ps.length - 1] += " " + ekSon;
  return ps.join("\n\n");
}
// istenen dakikanin ~1.55 kati kelime; esigi (%95) rahat gecsin diye +%8
const kelimeIste = arg => Math.round(arg.lengthMinutes * 1.55 * 151 * 1.08);
async function calistir(ad, araclar, mcpSec) {
  const m = await Y.sahteMcp(araclar, mcpSec);
  try {
    const cikti = [];
    const r = await Y.sessiz(async (c) => { try { return await SY.ana([ad], { vidiqSecenek: Object.assign({}, m.secenek), aralikSn: 1 }); } finally { cikti.push(...c); } });
    return { r, cikti };
  } finally { await m.kapat(); }
}

test("vidIQ yolu: 'like'/'unlike' iceren GERCEK cumleler sessizce silinmez (parca sonu ve son cumle)", async () => {
  const ad = yeniIs({ baslik_en: "Dalga", _not: "Dev dalga", format: "long", hedefSaniye: 900, dil: "en" });
  const f = sahteVidiq((arg, no) => {
    const kelime = Math.round(arg.lengthMinutes * 1.55 * 151);
    return no === 1 ? metinUret("a", kelime, "The wave moved like nothing the coast had ever seen. It was unlike any storm on record.")
      : metinUret("b", kelime, "The wave rose like a wall of dark glass over the harbor.");
  });
  const { r } = await calistir(ad, f.araclar);
  const metin = metinOku(ad);
  assert.ok(metin.includes("The wave moved like nothing the coast had ever seen. It was unlike any storm on record."), "1. parcanin sonu silindi");
  assert.ok(metin.trimEnd().endsWith("The wave rose like a wall of dark glass over the harbor."), "son cumle silindi");
  assert.ok(r.kelime > 2000);
});

test("vidIQ yolu: silinen selam/kapanis cumleleri LOGA yazilir", async () => {
  const ad = yeniIs({ baslik_en: "Log", _not: "Konu", format: "long", hedefSaniye: 900, dil: "en" });
  const f = sahteVidiq((arg, no) => {
    const kelime = Math.round(arg.lengthMinutes * 1.55 * 151);
    return (no === 2 ? "Welcome back everyone. " : "") + metinUret("p" + no, kelime, no === 1 ? "Thanks for watching! Subscribe for more." : "");
  });
  const { cikti } = await calistir(ad, f.araclar);
  const hepsi = cikti.join("");
  assert.match(hepsi, /temizlik \(parça 1, selam\/kapanış\): 2 cümle silindi \(veda, abone\/beğen çağrısı\)|temizlik \(parça 1, selam\/kapanış\): 2 cümle silindi \(abone\/beğen çağrısı, veda\)/);
  assert.match(hepsi, /temizlik \(parça 2, selam\/kapanış\): 1 cümle silindi \(selam\), ilk satır: Welcome back everyone\./);
});

test("vidIQ yolu: Reels (180 sn) 1 dakika DEGIL hedef sureye gore istenir; kisa kalirsa uyarir", async () => {
  const ad = yeniIs({ baslik_en: "Reel", _not: "Konu", format: "reels", hedefSaniye: 180, dil: "en" });
  const f = sahteVidiq(() => metinUret("r", 90));            // hedef 453 kelime, gelen 90
  const { r, cikti } = await calistir(ad, f.araclar);
  assert.equal(f.durum.args.length, 1);
  assert.equal(f.durum.args[0].lengthMinutes, SY.dakikaIste(453, 151));
  assert.equal(f.durum.args[0].lengthMinutes, 2);
  assert.equal(r.hedefKelime, 453);
  assert.ok(cikti.some(x => /@@UYARI Senaryo hedefin yarısından kısa \(90\/453 kelime\)/.test(x)), cikti.join(""));
  // tahmini kredi de ayni dakikayi kullanir
  assert.ok(cikti.some(x => /~2 kredi/.test(x)));
  // 40 sn Shorts hala 1 dakika
  const ad2 = yeniIs({ baslik_en: "Short", _not: "Konu", format: "short", hedefSaniye: 40, dil: "en" });
  const f2 = sahteVidiq(() => metinUret("s", 120));
  await calistir(ad2, f2.araclar);
  assert.equal(f2.durum.args[0].lengthMinutes, 1);
});

test("vidIQ yolu: tek parcali uzun videoda acilis kancasi kurali briefe girer; cok parcali videoda 1. parca kancayla acar", async () => {
  const ad = yeniIs({ baslik_en: "Tek", _not: "Konu", format: "long", hedefSaniye: 300, dil: "en" });
  const f = sahteVidiq((arg) => metinUret("t", kelimeIste(arg)));
  await calistir(ad, f.araclar);
  assert.equal(f.durum.args.length, 1);
  assert.match(f.durum.args[0].concept, /Open with a concrete hook in the first two sentences/);
  assert.doesNotMatch(f.durum.args[0].concept, /PART 1 OF/);
  // cok parcali videoda 1. parca kancayla acar (parca kurali), tek-parca kancasi eklenmez
  const ad2 = yeniIs({ baslik_en: "Cok", _not: "Konu", format: "long", hedefSaniye: 900, dil: "en" });
  const f2 = sahteVidiq((arg, no) => metinUret("c" + no, kelimeIste(arg)));
  await calistir(ad2, f2.araclar);
  assert.match(f2.durum.args[0].concept, /PART 1 OF 2[\s\S]*Open with the hook; no greeting/);
  assert.doesNotMatch(f2.durum.args[0].concept, /Open with a concrete hook in the first two sentences/);
});

test("vidIQ yolu: kanalSesi, kanal, ton, kisiselKatki ve trend referansi briefe girer (Claude ile ayni girdiler); tone alani <=100", async () => {
  const kok = process.env.OTOMASYON_RAPOR_KOKU;
  fs.mkdirSync(path.join(kok, "trend"), { recursive: true });
  fs.writeFileSync(path.join(kok, "trend", "dalga.json"), JSON.stringify({ satirlar: [{ hook: "Cold open on a ticking clock", sureSn: 30 }, { sureSn: 50 }, { sureSn: 40 }] }));
  const ad = yeniIs({ baslik_en: "Ses", _not: "Konu", format: "long", hedefSaniye: 300, dil: "en", kanal: "Zaman Kirigi", ton: "dry and serious ".repeat(12),
    kanalSesi: { tarif: "cold open humour", ornekParagraf: "Ornek kanal paragrafi burada." }, kisiselKatki: "Bence her dalga bir uyaridir.", _trendRapor: "trend/dalga.json" });
  const f = sahteVidiq((arg) => metinUret("k", kelimeIste(arg)));
  await calistir(ad, f.araclar);
  const c = f.durum.args[0].concept;
  for (const parca of [/CHANNEL VOICE/, /cold open humour/, /Ornek kanal paragrafi burada/, /The channel is called "Zaman Kirigi"/,
    /Tone: dry and serious/, /Bence her dalga bir uyaridir/, /STRUCTURE REFERENCE/, /Cold open on a ticking clock/, /Median length of the trending videos: 40 seconds/])
    assert.match(c, parca);
  assert.ok(f.durum.args[0].tone.length <= 100);
  assert.ok(c.length <= 8000);
  // KANALIM varsayilani kanal adi sayilmaz
  assert.doesNotMatch(P.vidiqBrief({ tur: "belgesel", dilAdi: "English", kanal: "KANALIM" }), /The channel is called/);
});

test("vidIQ yolu: kullanicinin KAYNAK metni vidIQ'ya kirpilmadan (2000 degil, tam) gider; cok parcali videoda tekrar-onleme listesi korunur", async () => {
  const kaynak = "Kaynak cumlesi yedi: dalga 7777 yilinda limani vurdu. ".repeat(300);        // ~16 bin karakter
  const ad = yeniIs({ baslik_en: "Kaynak", _not: "Konu", format: "long", hedefSaniye: 900, dil: "en", arastirma: kaynak });
  const f = sahteVidiq((arg, no) => metinUret("q" + no, kelimeIste(arg)));
  const { cikti } = await calistir(ad, f.araclar);
  assert.equal(f.durum.args.length, 2);
  const tam = kaynak.trim();
  assert.ok(f.durum.args[0].research.includes(tam), "1. parcada kaynak tam gitmedi");
  assert.ok(f.durum.args[1].research.includes(tam), "2. parcada kaynak tam gitmedi");
  assert.match(f.durum.args[1].research, /DO NOT REPEAT/);
  assert.ok(f.durum.args.every(a => a.research.length <= 20000));
  assert.ok(!cikti.some(x => /vidIQ'ya yalnızca ilk/.test(x)), "sigan kaynak icin uyari cikmamali");
  assert.equal(Y.jsonOku(Y.URETIM, ad, "IDDIA-RAPORU.json").kaynakKirpildi, undefined);
});

test("vidIQ yolu: kaynak alana SIGMAZSA uyarilir; IDDIA raporu yalniz vidIQ'nun gordugu kisma gore 'kaynakta geciyor' der", async () => {
  // konu.json siniri 20000: 2. parcada "daha once islendi" listesi de alana girer, kaynagin kuyrugu sigmaz.
  // Gorulen kisimda 1555, gorulmeyen kuyrukta 1777 gecer.
  const bas = "Kaynak: dalga 1555 yilinda limani vurdu. ".repeat(470);                    // ~19300 karakter
  const kuyruk = "Ek not: ikinci dalga 1777 yilinda geldi. ".repeat(14);                    // ~570 karakter
  const ad = yeniIs({ baslik_en: "Uzun kaynak", _not: "Konu", format: "long", hedefSaniye: 900, dil: "en", arastirma: bas + kuyruk });
  const f = sahteVidiq((arg, no) => metinUret("u" + no, kelimeIste(arg), no === 1 ? "In 1777 the second wave struck the harbor and 1555 people watched it." : ""));
  const { cikti } = await calistir(ad, f.araclar);
  const toplam = (bas + kuyruk).trim().length;
  const rapor = Y.jsonOku(Y.URETIM, ad, "IDDIA-RAPORU.json");
  assert.equal(rapor.kaynakKirpildi.toplam, toplam);
  assert.ok(rapor.kaynakKirpildi.gorulen < toplam && rapor.kaynakKirpildi.gorulen >= 18000, "gorulen: " + rapor.kaynakKirpildi.gorulen);
  assert.ok(f.durum.args[0].research.includes((bas + kuyruk).trim()), "1. parcada kaynak tam gitmeliydi");
  assert.ok(f.durum.args.every(a => a.research.length <= 20000));
  assert.ok(cikti.some(x => /@@UYARI Kaynak metni \d+ karakter; vidIQ'ya yalnızca ilk \d+ karakteri sığdı/.test(x)));
  assert.match(Y.oku(Y.URETIM, ad, "IDDIA-RAPORU.md"), /yalnızca ilk \d+ karakteri gönderilebildi/);
  // 1777 kaynagin gorulmeyen kuyrugunda: iddianin tum rakamlari kaynakta gecmedigi icin "yuksek" DENMEZ
  const yedi = rapor.iddialar.find(x => /1777/.test(x.metin));
  assert.ok(yedi, "1777 iddiasi cikarilmadi");
  assert.notEqual(yedi.guven, "yuksek");
});

test("vidiqArastirmaKur: liste once, kaynak sonra; kesme kaynagin SONUNDAN; kap asilmaz; kaynak yoksa yalniz liste", () => {
  const k = S.vidiqArastirmaKur("Already covered:\n1. x", "kelime ".repeat(5000), 20000);
  assert.ok(k.metin.length <= 20000);
  assert.ok(k.metin.startsWith("Already covered:"));
  assert.ok(k.kaynakGonderilen > 17000 && k.kaynakGonderilen < 20000);
  assert.ok(k.metin.endsWith("kelime"), "kelime ortadan kesildi");
  const kisa = S.vidiqArastirmaKur("liste", "kisa kaynak", 20000);
  assert.equal(kisa.kaynakGonderilen, "kisa kaynak".length);
  assert.deepEqual(S.vidiqArastirmaKur("sadece liste", "", 20000), { metin: "sadece liste", kaynakGonderilen: 0 });
  assert.equal(S.vidiqArastirmaKur("", "", 20000).metin, "");
  const dar = S.vidiqArastirmaKur("L".repeat(5000), "k".repeat(5000), 1200);
  assert.ok(dar.metin.length <= 1200);
});

// ================================================================ iddia ikinci gecisi (regresyon 4)
const iddiaNesnesi = i => ({ paragraf: 1, tur: "rakam", metin: "Iddia numara " + i + " { ve } karakterli", baglam: "b1w" + i, risk: "orta", not: "Kontrol et " + i });

test("modelIddialariniCoz: sonu kesilen yanittan TAMAMLANMIS iddialar kurtarilir (dize icindeki { } sayimi bozmaz)", () => {
  const tam = JSON.stringify({ iddialar: Array.from({ length: 40 }, (_, i) => iddiaNesnesi(i)) });
  assert.equal(I.modelIddialariniCoz(tam, 3).length, 40);
  const kesik = tam.slice(0, tam.length - 55);                       // son nesnenin ortasinda kesildi
  assert.throws(() => JSON.parse(kesik));
  const d = I.modelIddialariniCozDetay(kesik, 3);
  assert.equal(d.kurtarildi, true);
  assert.equal(d.liste.length, 39);
  assert.equal(I.modelIddialariniCoz(kesik, 3).length, 39);
  assert.equal(I.modelIddialariniCozDetay(tam, 3).kurtarildi, false);
  // fence icinde de kesik olabilir
  assert.equal(I.modelIddialariniCoz("```json\n" + kesik, 3).length, 39);
  // ilk nesne bile tamamlanmadiysa / JSON hic yoksa null
  assert.equal(I.modelIddialariniCoz('{"iddialar":[{"paragraf":1,"tur":"ra', 3), null);
  assert.equal(I.modelIddialariniCoz("Maalesef üretemedim.", 3), null);
});

test("Claude yolu: iddia yanıtı max_tokens'ta kesilirse ucretli cikti cope gitmez; sinir yukseltildi; rapora 'kesik' notu dusulur", async () => {
  const ad = yeniIs({ baslik_en: "Kisa", _not: "Konu", format: "short", hedefSaniye: 40, dil: "en" });
  const tamIddia = JSON.stringify({ iddialar: Array.from({ length: 30 }, (_, i) => iddiaNesnesi(i)) });
  const ps = [paragraf("h", 24, 0), paragraf("i", 24, 1), paragraf("j", 12, 2)];
  const ist = Y.sahteClaude((params) => {
    if (/CHECKABLE FACTUAL CLAIMS/.test(Y.sistemMetni(params))) return { text: tamIddia.slice(0, tamIddia.length - 40), stop_reason: "max_tokens" };
    return { text: "<anlatim>\n" + ps.join("\n\n") + "\n</anlatim>\n<ozet>Ozet.</ozet>" };
  });
  const cikti = [];
  await Y.sessiz(async (c) => { try { await SC.ana([ad], { istemci: ist }); } finally { cikti.push(...c); } });
  const iddiaCagrisi = ist.cagrilar.find(p => /CHECKABLE FACTUAL CLAIMS/.test(Y.sistemMetni(p)));
  assert.ok(iddiaCagrisi.max_tokens >= 16000, "iddia sinirı: " + iddiaCagrisi.max_tokens);
  const r = Y.jsonOku(Y.URETIM, ad, "IDDIA-RAPORU.json");
  assert.equal(r.uretici, "claude");
  assert.equal(r.iddialar.length, 29);
  assert.equal(r.listeKesik, true);
  assert.match(Y.oku(Y.URETIM, ad, "IDDIA-RAPORU.md"), /uzunluk sınırında kesildi/);
  assert.ok(cikti.some(x => /@@UYARI İddia listesi token sınırında kesildi; tamamlanan 29 iddia/.test(x)));
});

// ================================================================ viral-analiz kumeleme (B020)
test("kumeleV: anlamli kelimesi olmayan basliklar SAHTE kume olusturmaz; tek ortak kelime benzerlik sayilmaz", () => {
  const v = (t, i) => ({ videoTitle: t, videoId: "X" + i, viewCount: 1e6, videoDuration: 20, subscriberCount: 1000, channelTitle: "K" + i });
  const kisa = ["Why do we go", "Is it me?", "Wow so big"].map(v);
  const kumeler = VA.kumeleV(kisa);
  assert.equal(kumeler.length, 3, "anlamsiz basliklar tek kumeye toplandi");
  assert.ok(kumeler.every(k => k.length === 1));
  const tek = ["Football highlights today", "Football goals compilation", "Football fails weekly"].map(v);
  assert.ok(VA.kumeleV(tek).every(k => k.length === 1), "tek ortak kelime kume yapti");
  const gercek = ["Ancient pyramids secret chamber", "Secret chamber found pyramids", "Pyramids ancient chamber revealed", "Baska konu tamamen"].map(v);
  const g = VA.kumeleV(gercek);
  assert.equal(g[0].length, 3);
  assert.ok(VA.ortakKelimeler(g[0]).includes("pyramids"));
});

test("raporKur: anlamsiz basliklarda 'Benzer baslik yapisi' hukmu YAZILMAZ; gercek kumede ORTAK KELIMELER listelenir", () => {
  const v = (t, i) => ({ videoTitle: t, videoId: "Y" + i, viewCount: 2e6, videoDuration: 20, subscriberCount: 1000, channelTitle: "K" + i, engagementRate: 0.05 });
  const ayar = { konu: "", dil: "en", esik: 1e6, format: "short" };
  const bos = VA.raporKur(["Why do we go", "Is it me?", "Wow so big"].map(v), ayar).md;
  assert.doesNotMatch(bos, /Benzer başlık yapısı|birbirine çok benziyor/);
  const dolu = VA.raporKur(["Ancient pyramids secret chamber", "Secret chamber found pyramids", "Pyramids ancient chamber revealed"].map(v), ayar).md;
  assert.match(dolu, /Benzer başlık yapısı 3 videoda görülüyor/);
  assert.match(dolu, /ortak geçen kelimeler: .*pyramids/);
});
