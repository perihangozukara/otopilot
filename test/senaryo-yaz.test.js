// senaryo-yaz.js (vidIQ yolu) uctan uca testleri: yerel SAHTE MCP sunucusu (gercek vidIQ'ya ve krediye dokunulmaz).
"use strict";
const Y = require("./senaryo-yardim");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ortak = require("../lib/ortak");
const S = require("../lib/senaryo-ortak");
const SY = require("../senaryo-yaz");

let sayac = 0;
const yeniIs = (konu) => { const ad = "senaryotest-y" + (++sayac); Y.isOlustur(ad, konu); return ad; };
const metinOku = ad => Y.oku(Y.URETIM, ad, "Voice", "SESLENDIRME-TAM-METIN.txt");

// 12 kelimelik cumleler: her cumle BUYUK harfle baslar (gercek metne benzesin; cumleBol kucuk harfle baslayani onceki cumleye ekler)
function paragraf(etiket, n, k) {
  const sozler = Array.from({ length: n }, (_, i) => etiket + "w" + (k * 100 + i));
  const cumleler = [];
  for (let i = 0; i < sozler.length; i += 12) {
    const c = sozler.slice(i, i + 12);
    c[0] = c[0][0].toUpperCase() + c[0].slice(1);
    cumleler.push(c.join(" ") + ".");
  }
  return cumleler.join(" ");
}
// istenen dakikanin ~1.55 kati kelime; bas ve sona selam/kapanis cumleleri koyar (modelin gercek huyu)
function betikMetni(etiket, dk, carpan) {
  const kelime = Math.round(dk * 1.55 * 151 * (carpan || 1));
  const ps = []; let kalan = kelime, k = 0;
  while (kalan > 0) { const n = Math.min(90, kalan); ps.push(paragraf(etiket, n, k++)); kalan -= n; }
  ps[0] = "Welcome back everyone. " + ps[0];
  ps[ps.length - 1] += " Thanks for watching! Like and subscribe for more.";
  return ps.join("\n\n");
}

// Sahte araclar. durum: {isler, krediler, args}
function sahteAraclar(sec) {
  const s = Object.assign({ carpan: 1, kredi: 1000, dogrulamaHatasi: false, basarisiz: false }, sec || {});
  const durum = { isler: new Map(), args: [], kredi: s.kredi, n: 0 };
  return {
    durum,
    araclar: {
      vidiq_balance: () => ({ structured: { type: "limited", totalCredits: durum.kredi } }),
      vidiq_generate_script: (arg) => {
        durum.args.push(arg);
        if (s.dogrulamaHatasi && durum.args.length === 1) return { isError: true, text: "Input validation error: research is too long" };
        const id = "is-" + (++durum.n);
        durum.kredi -= arg.lengthMinutes;
        durum.isler.set(id, { arg, etiket: "p" + durum.n });
        return { structured: { mcpJobId: id } };
      },
      vidiq_job_poll: (arg) => {
        const is = durum.isler.get(arg.mcpJobId);
        if (s.basarisiz) return { structured: { status: "failed", errorCode: "SCRIPT_FAIL", refunded: true } };
        return { structured: { status: "completed", result: betikMetni(is.etiket, is.arg.lengthMinutes, s.carpan) } };
      },
    },
  };
}

async function calistir(ad, araclar, sec, mcpSec) {
  const m = await Y.sahteMcp(araclar, mcpSec);
  try {
    return await Y.sessiz(() => SY.ana([ad], Object.assign({ vidiqSecenek: Object.assign({}, m.secenek), aralikSn: 1 }, sec || {})));
  } finally { await m.kapat(); }
}
process.env.VIDIQ_KEY = "test-vidiq";

test("15 dk: parca parca ister; dakika = hedef/hiz/1.55; Part N of M; selam ve kapanis ayiklanir; bolumler.json; kredi kaydi", async () => {
  const ad = yeniIs({ baslik_en: "Roma", _not: "Roma cokusu", format: "long", hedefSaniye: 900, dil: "en", ton: "t".repeat(190), kisiselKatki: "Bence her imparatorluk kendini yer." });
  Y.isOlustur(ad, JSON.parse(Y.oku(Y.URETIM, ad, "konu.json")));
  fs.writeFileSync(path.join(Y.URETIM, ad, "Voice", "gorsel-aramalari.json"), "{}");     // bayat dosya
  const f = sahteAraclar();
  const r = await calistir(ad, f.araclar);
  assert.ok(r.kelime >= 2265 * 0.95 && r.kelime <= 2265 * 1.15, "kelime " + r.kelime);
  assert.equal(f.durum.args.length, 2);
  // katsayi baglandi: 15 dk DEGIL, parca basina ~5 dk istenir
  assert.deepEqual(f.durum.args.map(a => a.lengthMinutes), [5, 5]);
  assert.ok(f.durum.args.every(a => a.tone.length <= 100), "tone vidIQ sinirini (100) asmamali");
  assert.match(f.durum.args[0].concept, /PART 1 OF 2/);
  assert.match(f.durum.args[1].concept, /PART 2 OF 2/);
  assert.match(f.durum.args[1].concept, /NO greeting/);
  assert.match(f.durum.args[0].concept, /Do NOT conclude/);
  assert.match(f.durum.args[1].concept, /close the video/);
  assert.match(f.durum.args[0].concept, /WRITE ENTIRELY IN ENGLISH/);
  assert.match(f.durum.args[0].concept, /Bence her imparatorluk kendini yer/);        // kisisel katki iki motorda da islenir
  assert.match(f.durum.args[1].research, /DO NOT REPEAT/);                              // onceki parcanin ozeti verilir

  const metin = metinOku(ad);
  assert.ok(!/Welcome back/.test(metin.slice(metin.indexOf("P2w"))), "2. parcanin selami ayiklanmali");
  assert.ok(!/subscribe/i.test(metin), "abone ol cagrilari her parcada ayiklanmali");
  assert.ok((metin.match(/Thanks for watching/g) || []).length <= 1, "yalniz SON parca kapanis yapabilir");
  const b = Y.jsonOku(Y.URETIM, ad, "Voice", "bolumler.json");
  assert.equal(b.bolumler.length, 2);
  assert.equal(b.bolumler[0].paragrafBas, 0);
  assert.equal(b.bolumler[1].paragrafSon, ortak.paragraflaraBol(metin).length - 1);
  assert.match(b.bolumler[0].ad, /^P1w/);                                                // ilk 6 kelime (ilk parcanin selami da atilir)
  assert.ok(!fs.existsSync(path.join(Y.URETIM, ad, "Voice", "gorsel-aramalari.json")), "vidIQ yolu gorsel-aramalari.json yazmaz; bayati yedege tasinir");
  assert.equal(Y.jsonOku(Y.URETIM, ad, "IDDIA-RAPORU.json").uretici, "yerel");
  const k = Y.jsonOku(Y.URETIM, ad, "kullanim.json");
  assert.equal(k.kayitlar[0].saglayici, "vidiq");
  assert.equal(k.kayitlar[0].kredi, 10);                                                 // bakiye farki: 1000 -> 990
  assert.equal(k.toplamKredi, 10);
  assert.ok(!fs.existsSync(path.join(Y.URETIM, ad, ".kilit")));
});

test("Turkce: dil briefe girer, kelime hizi 113 ile parca/dakika hesaplanir", async () => {
  const ad = yeniIs({ baslik_en: "Roma", _not: "Roma", format: "long", hedefSaniye: 600, dil: "tr" });
  const f = sahteAraclar();
  const r = await calistir(ad, f.araclar);
  assert.equal(r.dil, "tr");
  assert.equal(r.hedefKelime, Math.round(10 * 113));
  assert.match(f.durum.args[0].concept, /WRITE ENTIRELY IN TURKISH/);
  assert.equal(f.durum.args[0].lengthMinutes, Math.round(1130 / 113 / 1.55));         // 6
});

test("hedefin cok ustunde gelen metin govdeden kirpilir (uzun/orta videolarda da sinir var)", async () => {
  const ad = yeniIs({ baslik_en: "Uzun", _not: "Konu", format: "long", hedefSaniye: 600, dil: "en" });
  const f = sahteAraclar({ carpan: 1.6 });
  const r = await calistir(ad, f.araclar);
  assert.ok(r.kelime <= 1510 * 1.15, "kirpma: " + r.kelime);
  assert.ok(r.kelime >= 1510 * 0.95);
});

test("esik altinda devam parcasi kapanisin onune girer; yine yetmezse -yarim.txt + cikis 4 (kredi bosa gitmez)", async () => {
  const ad = yeniIs({ baslik_en: "Kisa", _not: "Konu", format: "long", hedefSaniye: 900, dil: "en" });
  const f = sahteAraclar({ carpan: 0.5 });
  await assert.rejects(calistir(ad, f.araclar), e => e.kod === "senaryo_kisa" && e.cikis === 4);
  assert.ok(f.durum.args.length > 2, "devam parcasi istenmeli");
  assert.match(f.durum.args[2].concept, /EXTRA middle part/);
  assert.ok(S.kelimeSay(Y.oku(Y.URETIM, ad, "Voice", "SESLENDIRME-TAM-METIN-yarim.txt")) > 800);
  assert.ok(!fs.existsSync(path.join(Y.URETIM, ad, "Voice", "SESLENDIRME-TAM-METIN.txt")), "ana dosyaya yazilmadi");
});

test("kisa video: tavan kelimeye kirpilir, 1 dakikalik tek cagri, bolum listesi yok", async () => {
  const ad = yeniIs({ baslik_en: "Kisa", _not: "Konu", format: "short", hedefSaniye: 40, dil: "en" });
  const f = sahteAraclar();
  const r = await calistir(ad, f.araclar);
  const tavan = Math.round(40 / 60 * 137);
  assert.equal(f.durum.args.length, 1);
  assert.equal(f.durum.args[0].lengthMinutes, 1);
  assert.match(f.durum.args[0].concept, new RegExp("Never exceed " + tavan + " words"));
  assert.ok(r.kelime <= tavan, r.kelime + " > " + tavan);
  assert.ok(!fs.existsSync(path.join(Y.URETIM, ad, "Voice", "bolumler.json")));
  assert.equal(r.bolum, 0);
});

test("alan uzunlugu yuzunden reddedilirse kisaltilmis alanlarla BIR kez yeniden dener", async () => {
  const ad = yeniIs({ baslik_en: "K", _not: "Konu", format: "short", hedefSaniye: 40, dil: "en", arastirma: "x ".repeat(2000) });
  const f = sahteAraclar({ dogrulamaHatasi: true });
  await calistir(ad, f.araclar);
  assert.equal(f.durum.args.length, 2);
  assert.ok(f.durum.args[0].research.length > 1200);
  assert.ok(f.durum.args[1].research.length <= 1200);
});

test("kredi yetersizse BASLAMADAN vidiq_kredi (cikis 3); uretim basarisiz bitince vidiq_uretim; anahtar yoksa cikis 2", async () => {
  const ad = yeniIs({ baslik_en: "Pahali", _not: "Konu", format: "long", hedefSaniye: 900, dil: "en" });
  const f = sahteAraclar({ kredi: 3 });
  await assert.rejects(calistir(ad, f.araclar), e => e.kod === "vidiq_kredi" && e.cikis === 3 && /yetersiz/.test(e.message));
  assert.equal(f.durum.args.length, 0, "kredi yetmiyorsa uretim istenmemeli");

  const ad2 = yeniIs({ baslik_en: "Basarisiz", _not: "Konu", format: "short", hedefSaniye: 40, dil: "en" });
  const f2 = sahteAraclar({ basarisiz: true });
  await assert.rejects(calistir(ad2, f2.araclar), e => e.kod === "vidiq_uretim" && e.cikis === 3 && /iade edildi/.test(e.message));

  const ad3 = yeniIs({ baslik_en: "A", _not: "K", format: "short", hedefSaniye: 40 });
  const eski = process.env.VIDIQ_KEY; delete process.env.VIDIQ_KEY;
  try { await assert.rejects(Y.sessiz(() => SY.ana([ad3], {})), e => e.kod === "vidiq_anahtar" && e.cikis === 2); }
  finally { process.env.VIDIQ_KEY = eski; }
});

test("vidIQ beklenmedik JSON dondururse senaryo SAYILMAZ", () => {
  assert.equal(SY.scriptMetni("duz metin"), "duz metin");
  assert.equal(SY.scriptMetni({ script: "icerik" }), "icerik");
  assert.throws(() => SY.scriptMetni({ error: "x" }), e => e.kod === "vidiq_cevap" && e.cikis === 3);
  assert.equal(SY.dakikaIste(2265, 151), 10);
  assert.equal(SY.parcaPlani({ kisa: false, hedefKelime: 2265 }).M, 2);
  assert.equal(SY.parcaPlani({ kisa: true, hedefKelime: 91 }).M, 1);
});

test("maliyet siniri vidIQ yolunda da baslamadan denetlenir (Claude harcamasi sinira dayaliysa)", async () => {
  const ad = yeniIs({ baslik_en: "S", _not: "K", format: "short", hedefSaniye: 40, maliyetUstSinirUSD: 0.5 });
  fs.writeFileSync(path.join(Y.URETIM, ad, "kullanim.json"), JSON.stringify({ surum: 1, kayitlar: [{ zaman: new Date().toISOString(), usd: 0.9 }], toplamUSD: 0.9, toplamKredi: 0 }));
  const f = sahteAraclar();
  await assert.rejects(calistir(ad, f.araclar), e => e.cikis === 7);
  assert.equal(f.durum.args.length, 0);
});

test("--yedek: vidIQ servis hatasi verirse Claude'a duser", async () => {
  const ad = yeniIs({ baslik_en: "Yedek", _not: "Konu", format: "short", hedefSaniye: 40, dil: "en" });
  const f = sahteAraclar({ basarisiz: true });
  const ist = Y.sahteClaude(() => ({ text: "<anlatim>\n" + paragraf("c", 40, 0) + "\n\n" + paragraf("d", 30, 1) + "\n</anlatim>" }));
  const m = await Y.sahteMcp(f.araclar);
  try {
    const r = await Y.sessiz(() => SY.ana([ad, "--yedek"], { vidiqSecenek: m.secenek, aralikSn: 1, yedekSecenek: { istemci: ist, iddiaYok: true } }));
    assert.ok(r.kelime >= 20);
    assert.ok(ist.cagrilar.length >= 1);
    assert.match(metinOku(ad), /^C/);
  } finally { await m.kapat(); }
});
