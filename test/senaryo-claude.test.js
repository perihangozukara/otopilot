// senaryo-claude.js uctan uca testleri: SAHTE Claude istemcisi (ag yok, ucret yok).
"use strict";
const Y = require("./senaryo-yardim");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ortak = require("../lib/ortak");
const S = require("../lib/senaryo-ortak");
const SC = require("../senaryo-claude");

let sayac = 0;
const yeniIs = (konu, senaryo) => { const ad = "senaryotest-c" + (++sayac); Y.isOlustur(ad, konu, senaryo); return ad; };
const metinOku = ad => Y.oku(Y.URETIM, ad, "Voice", "SESLENDIRME-TAM-METIN.txt");
const kelime = s => S.kelimeSay(s);
const sistemMetni = Y.sistemMetni;

// n kelimelik, benzersiz sozcuklerden olusan paragraflar (her biri ~80 kelime)
function paragraflar(etiket, n) {
  const ps = []; let k = 0;
  while (n > 0) {
    const m = Math.min(80, n);
    ps.push(Array.from({ length: m }, (_, i) => etiket + "w" + (k * 100 + i)).join(" ") + ".");
    n -= m; k++;
  }
  return ps;
}
const gorseller = (ps, etiket) => "<gorseller>\n" + JSON.stringify(ps.map((_, i) => ({ p: i + 1, ara: [etiket + " scene " + (i + 1), "generic " + etiket] }))) + "\n</gorseller>";

// oran: modelin istenen kelimeyi tutturma orani (1 = tam, 0.5 = yarisi)
function sahteModel(secenek) {
  const s = Object.assign({ oran: 1, planBolum: null, iddia: "ok", planGecersiz: false, devamOran: 1, kisaKelime: 0, hataBolum: 0 }, secenek || {});
  return (params, no) => {
    const ist = params.messages[0].content, sis = sistemMetni(params);
    let m;
    if (/Plan the video/.test(ist)) {
      if (s.planGecersiz) return { text: "Tabii, planı şöyle yaparız: ..." };
      const n = s.planBolum || Number(ist.match(/exactly (\d+) parts/)[1]);
      return { text: JSON.stringify({ ozet: "Kisa video ozeti burada.", bolumler: Array.from({ length: n }, (_, i) => ({ ad: "Bolum " + (i + 1), ozet: "Bolum ozeti " + (i + 1), acik_dongu: i < n - 1 ? "Peki sonra ne oldu?" : "" })) }) };
    }
    if ((m = ist.match(/NOW WRITE PART (\d+) OF (\d+)/))) {
      if (s.hataBolum && Number(m[1]) === s.hataBolum) throw Y.hata(529, "overloaded");
      const hedef = Math.round(Number(ist.match(/about (\d+) words/)[1]) * s.oran);
      const ps = paragraflar("b" + m[1], hedef);
      return { text: "<anlatim>\n" + ps.join("\n\n") + "\n</anlatim>\n" + gorseller(ps, "b" + m[1]) };
    }
    if (/CURRENT SCRIPT:/.test(ist)) {
      const eksik = Number(ist.match(/Write about (\d+) NEW words/)[1]);
      const ps = paragraflar("devam" + no, Math.round(eksik * s.devamOran));
      return { text: "<anlatim>\n" + ps.join("\n\n") + "\n</anlatim>\n" + gorseller(ps, "devam") };
    }
    if (/CHECKABLE FACTUAL CLAIMS/.test(sis)) {
      if (s.iddia === "bozuk") return { text: "Maalesef JSON üretemedim." };
      return { text: JSON.stringify({ iddialar: [{ paragraf: 1, tur: "rakam", metin: "Bir rakam iddiasi", baglam: "b1w0", risk: "yuksek", not: "Kontrol et" }] }) };
    }
    if (/Write the narration for a/.test(ist)) {                       // kisa video
      const ps = paragraflar("k", s.kisaKelime || 200);
      return { text: "Işte senaryo:\n<anlatim>\n" + ps.join("\n\n") + "\n</anlatim>\n" + gorseller(ps, "k") + "\n<ozet>Kisa ozet.</ozet>" };
    }
    if (/Write the complete narration script/.test(ist)) {            // tek atis uzun
      const hedef = Math.round(Number(ist.match(/LENGTH: (\d+) words/)[1]) * s.oran);
      const ps = paragraflar("t", hedef);
      return { text: "<anlatim>\n" + ps.join("\n\n") + "\n</anlatim>\n" + gorseller(ps, "t") };
    }
    throw new Error("sahte model tanimadi: " + ist.slice(0, 80));
  };
}

const calistir = (ad, istemci, ek) => Y.sessiz(() => SC.ana([ad].concat(ek || []), { istemci }));

test("15 dk uzun video: ana hat + 13 bolum + iddia; yan dosyalar tutarli; kullanim.json; kilit birakildi", async () => {
  const ad = yeniIs({ baslik_en: "Roma", _not: "Roma Imparatorlugunun cokusu", format: "long", hedefSaniye: 900, dil: "en", tur: "belgesel",
    ton: "dry and serious", kanalSesi: { tarif: "cold open humour", ornekParagraf: "Ornek." }, kisiselKatki: "Benim gorusum: imparatorluklar icten coker.", arastirma: "Kaynak: MS 476 yilinda cokus." });
  const ist = Y.sahteClaude(sahteModel());
  const r = await calistir(ad, ist);
  assert.ok(r.kelime >= 2265 * 0.95 && r.kelime <= 2265 * 1.15, "kelime: " + r.kelime);
  assert.equal(r.bolum, 13);
  assert.equal(ist.cagrilar.length, 15);                               // ana hat + 13 bolum + iddia

  // istem icerigi: tum kurallar ilk cagrinin sistem istemine girmis
  const sis = sistemMetni0(ist.cagrilar[0]);
  for (const parca of [/ENTIRELY IN ENGLISH/, /dry and serious/, /cold open humour/, /AUTHOR'S OWN PERSPECTIVE/, /imparatorluklar icten coker/, /MS 476/]) assert.match(sis, parca);
  assert.ok(Array.isArray(ist.cagrilar[0].system) && ist.cagrilar[0].system[0].cache_control, "istem onbellegi (cache_control) kullanilmali");
  assert.equal(ist.cagrilar[1].output_config.effort, "medium");
  assert.equal(ist.cagrilar[0].output_config.effort, "high");

  const metin = metinOku(ad);
  const ps = ortak.paragraflaraBol(metin);
  const aramalar = Y.jsonOku(Y.URETIM, ad, "Voice", "gorsel-aramalari.json");
  assert.equal(aramalar.kaynakSenaryoSha1, ortak.paragrafOzeti(ps));
  assert.equal(aramalar.uretici, "claude");
  assert.equal(aramalar.paragraflar.length, ps.length);
  assert.ok(aramalar.paragraflar[0].aramalar.length >= 1);

  const b = Y.jsonOku(Y.URETIM, ad, "Voice", "bolumler.json");
  assert.equal(b.bolumler.length, 13);
  assert.equal(b.bolumler[0].paragrafBas, 0);
  assert.equal(b.bolumler[12].paragrafSon, ps.length - 1);
  for (let i = 1; i < b.bolumler.length; i++) assert.equal(b.bolumler[i].paragrafBas, b.bolumler[i - 1].paragrafSon + 1);
  assert.equal(Y.oku(Y.URETIM, ad, "Voice", "aciklama-ozet.txt").trim(), "Kisa video ozeti burada.");

  const iddia = Y.jsonOku(Y.URETIM, ad, "IDDIA-RAPORU.json");
  assert.equal(iddia.uretici, "claude");
  assert.equal(iddia.surum, 1);
  assert.match(Y.oku(Y.URETIM, ad, "IDDIA-RAPORU.md"), /DOĞRULAMA DEĞİLDİR/);

  const k = Y.jsonOku(Y.URETIM, ad, "kullanim.json");
  assert.equal(k.surum, 1);
  assert.equal(k.kayitlar.length, 15);
  assert.ok(Math.abs(k.toplamUSD - 15 * 0.0175) < 1e-6, "toplamUSD " + k.toplamUSD);
  assert.equal(k.kayitlar[0].saglayici, "anthropic");
  assert.equal(k.kayitlar[0].model, "claude-opus-5");
  assert.ok(!fs.existsSync(path.join(Y.URETIM, ad, ".kilit")), "kilit birakilmali");
});
const sistemMetni0 = p => Y.sistemMetni(p);

test("Turkce senaryo: dil prompta girer, kelime hizi 113 ile hedef hesaplanir", async () => {
  const ad = yeniIs({ baslik_en: "Roma", _not: "Roma", format: "long", hedefSaniye: 180, dil: "tr" });
  const ist = Y.sahteClaude(sahteModel());
  const r = await calistir(ad, ist);
  assert.equal(r.dil, "tr");
  assert.equal(r.kelimeHizi, 113);
  assert.equal(r.hedefKelime, Math.round(3 * 113));
  assert.equal(ist.cagrilar.length, 2);                                // 4 dakikadan kisa: tek atis + iddia
  assert.match(Y.sistemMetni(ist.cagrilar[0]), /ENTIRELY IN TURKISH/);
  assert.match(ist.cagrilar[0].messages[0].content, /LANGUAGE: Turkish/);
});

test("model hep %80 yazsa bile bolum butcesi kalan kelimeye gore ayarlandigi icin hedef tutar (devam turu gerekmez)", async () => {
  const ad = yeniIs({ baslik_en: "Uyum", _not: "Konu", format: "long", hedefSaniye: 900, dil: "en" });
  const ist = Y.sahteClaude(sahteModel({ oran: 0.8 }));
  const r = await calistir(ad, ist);
  assert.ok(r.kelime >= 2265 * 0.95, "kelime: " + r.kelime);
  assert.equal(ist.cagrilar.filter(p => /CURRENT SCRIPT:/.test(p.messages[0].content)).length, 0);
});

test("esik altinda: devam turu eksigi KAPANISIN onune ekler; hedefe ulasinca basarili", async () => {
  const ad = yeniIs({ baslik_en: "Devam", _not: "Konu", format: "long", hedefSaniye: 900, dil: "en" });
  const ist = Y.sahteClaude(sahteModel({ oran: 0.5 }));
  const r = await calistir(ad, ist);
  const devamlar = ist.cagrilar.filter(p => /CURRENT SCRIPT:/.test(p.messages[0].content));
  assert.ok(devamlar.length >= 1, "devam turu yapilmali");
  assert.ok(r.kelime >= 2265 * 0.95, "devam turundan sonra hedef tutmali: " + r.kelime);
  const ps = ortak.paragraflaraBol(metinOku(ad));
  assert.match(ps[ps.length - 1], /^b13w/, "kapanis paragraflari en sonda kalmali");
  assert.ok(ps.some(p => /^devam/.test(p)), "devam metni senaryoda olmali");
  // devam eden paragraflarin gorsel aramasi da dosyada
  const aramalar = Y.jsonOku(Y.URETIM, ad, "Voice", "gorsel-aramalari.json");
  assert.equal(aramalar.paragraflar.length, ps.length);
});

test("devam turu da yetmezse: ana dosya YAZILMAZ, metin -yarim.txt olarak kaydedilir, cikis 4", async () => {
  const ad = yeniIs({ baslik_en: "Kisa", _not: "Konu", format: "long", hedefSaniye: 900, dil: "en" }, "ESKI SENARYO ".repeat(10));
  const ist = Y.sahteClaude(sahteModel({ oran: 0.5, devamOran: 0.05 }));
  await assert.rejects(calistir(ad, ist), e => e.kod === "senaryo_kisa" && e.cikis === 4 && /-yarim/.test(e.message));
  assert.equal(metinOku(ad), "ESKI SENARYO ".repeat(10), "ana senaryo dosyasina dokunulmamali");
  const yarim = Y.oku(Y.URETIM, ad, "Voice", "SESLENDIRME-TAM-METIN-yarim.txt");
  assert.ok(kelime(yarim) > 500, "yarim metin kaydedilmeli (para bosa gitmez): " + kelime(yarim));
  assert.equal(Y.jsonOku(Y.URETIM, ad, "kullanim.json").kayitlar.length, ist.cagrilar.length, "harcama kaydi eksiksiz");
  assert.ok(!fs.existsSync(path.join(Y.URETIM, ad, ".kilit")));
});

test("ana hat okunamazsa tek istekle yazar (metin kaybolmaz)", async () => {
  const ad = yeniIs({ baslik_en: "Plansiz", _not: "Konu", format: "long", hedefSaniye: 900, dil: "en" });
  const ist = Y.sahteClaude(sahteModel({ planGecersiz: true }));
  const r = await calistir(ad, ist);
  assert.ok(r.kelime >= 2265 * 0.95);
  assert.equal(r.bolum, 0);                                            // bolumler.json yok
  assert.ok(!fs.existsSync(path.join(Y.URETIM, ad, "Voice", "bolumler.json")));
  assert.equal(ist.cagrilar.filter(p => /Plan the video/.test(p.messages[0].content)).length, 2);   // 2 deneme
});

test("kisa video: tavan kelimeye kirpilir, paragraf yapisi ve gorsel aramalari kalir; bayat yan dosyalar yedege gider", async () => {
  const ad = yeniIs({ baslik_en: "Kisa", _not: "Konu", format: "tiktok", hedefSaniye: 45, dil: "en" },
    "Eski senaryo metni burada ve elli karakterden uzun olmali ki yedeklensin.");
  const dir = path.join(Y.URETIM, ad, "Voice");
  fs.writeFileSync(path.join(dir, "bolumler.json"), JSON.stringify({ surum: 1, bolumler: [{ ad: "eski", paragrafBas: 0, paragrafSon: 99 }] }));
  const ist = Y.sahteClaude(sahteModel({ kisaKelime: 400 }));                // 400 kelime donduruyor
  const r = await calistir(ad, ist);
  const tavan = Math.round(45 / 60 * 137);
  assert.equal(r.hedefKelime, tavan);
  assert.ok(r.kelime <= tavan, r.kelime + " > " + tavan);
  assert.match(ist.cagrilar[0].messages[0].content, /TikTok/);
  assert.match(Y.sistemMetni(ist.cagrilar[0]), /first 2 seconds/);
  const ps = ortak.paragraflaraBol(metinOku(ad));
  const aramalar = Y.jsonOku(dir, "gorsel-aramalari.json");
  assert.equal(aramalar.kaynakSenaryoSha1, ortak.paragrafOzeti(ps));
  assert.ok(!fs.existsSync(path.join(dir, "bolumler.json")), "bayat bolumler.json kalmamali");
  assert.ok(fs.readdirSync(path.join(dir, "yedek")).some(x => /^SESLENDIRME-/.test(x)), "eski metin yedeklenmeli");
  assert.ok(fs.readdirSync(path.join(dir, "yedek")).some(x => /^bolumler-/.test(x)));
  assert.match(Y.oku(dir, "aciklama-ozet.txt"), /Kisa ozet/);
});

test("Shorts 180 sn teknik sinirini asan hedef kirpilir ve uyarilir", async () => {
  const ad = yeniIs({ baslik_en: "S", _not: "K", format: "short", hedefSaniye: 600, dil: "en" });
  const ist = Y.sahteClaude(sahteModel({ kisaKelime: 900 }));
  const r = await calistir(ad, ist);
  assert.equal(r.hedefSn, 180);
  assert.ok(r.kelime <= Math.round(3 * 137));
});

test("maliyet siniri: asilacaksa HIC cagri yapmadan cikis 7", async () => {
  const ad = yeniIs({ baslik_en: "Pahali", _not: "K", format: "long", hedefSaniye: 900, dil: "en", maliyetUstSinirUSD: 0.01 });
  const ist = Y.sahteClaude(sahteModel());
  await assert.rejects(calistir(ad, ist), e => e.kod === "maliyet_siniri" && e.cikis === 7);
  assert.equal(ist.cagrilar.length, 0);
  // onceki harcama sinira dayaliysa da durur
  const ad2 = yeniIs({ baslik_en: "Pahali2", _not: "K", format: "short", hedefSaniye: 30, dil: "en", maliyetUstSinirUSD: 0.5 });
  fs.writeFileSync(path.join(Y.URETIM, ad2, "kullanim.json"), JSON.stringify({ surum: 1, kayitlar: [{ zaman: new Date().toISOString(), usd: 0.6 }], toplamUSD: 0.6, toplamKredi: 0 }));
  const ist2 = Y.sahteClaude(sahteModel());
  await assert.rejects(calistir(ad2, ist2), e => e.cikis === 7);
  assert.equal(ist2.cagrilar.length, 0);
});

test("Anthropic hatalari ayri Turkce mesaj ve cikis kodu 3 ile cevrilir", async () => {
  const vaka = [
    [401, "invalid x-api-key", "claude_anahtar", /ANTHROPIC_API_KEY geçersiz/],
    [400, "Your credit balance is too low to access the Anthropic API", "claude_kredi", /kredi bitti/],
    [402, "payment", "claude_kredi", /kredi bitti/],
    [404, "model: claude-yok", "claude_model", /modeli bulunamadı/],
    [429, "rate_limit", "claude_limit", /istek sınırına/],
    [529, "overloaded", "claude_yogun", /aşırı yüklü/],
    [500, "internal", "claude_yogun", /aşırı yüklü/],
  ];
  for (const [status, mesaj, kod, desen] of vaka) {
    const ad = yeniIs({ baslik_en: "H", _not: "K", format: "short", hedefSaniye: 30, dil: "en" });
    const ist = Y.sahteClaude(() => { throw Y.hata(status, mesaj); });
    await assert.rejects(calistir(ad, ist), e => e.kod === kod && e.cikis === 3 && desen.test(e.message), status + " -> " + kod);
  }
});

test("ortada hata olursa o ana kadar yazilan bolumler -yarim.txt'ye kaydedilir, hata aynen iletilir", async () => {
  const ad = yeniIs({ baslik_en: "Yarida", _not: "K", format: "long", hedefSaniye: 900, dil: "en" });
  const ist = Y.sahteClaude(sahteModel({ hataBolum: 5 }));
  await assert.rejects(calistir(ad, ist), e => e.kod === "claude_yogun" && e.cikis === 3);
  const yarim = Y.oku(Y.URETIM, ad, "Voice", "SESLENDIRME-TAM-METIN-yarim.txt");
  assert.ok(kelime(yarim) > 4 * 100);
  assert.ok(/^b1w/.test(yarim) && !/b5w/.test(yarim));
});

test("iddia ikinci gecisi basarisizsa yerel desen listesi yazilir (senaryo yine hazir)", async () => {
  const ad = yeniIs({ baslik_en: "Iddia", _not: "K", format: "long", hedefSaniye: 900, dil: "en" });
  const ist = Y.sahteClaude(sahteModel({ iddia: "bozuk" }));
  const r = await calistir(ad, ist);
  assert.ok(r.kelime > 2000);
  assert.equal(Y.jsonOku(Y.URETIM, ad, "IDDIA-RAPORU.json").uretici, "yerel");
  const ad2 = yeniIs({ baslik_en: "Iddia2", _not: "K", format: "short", hedefSaniye: 40, dil: "en" });
  const ist2 = Y.sahteClaude(sahteModel());
  await calistir(ad2, ist2, ["--iddia-yok"]);
  assert.ok(!fs.existsSync(path.join(Y.URETIM, ad2, "IDDIA-RAPORU.json")));
});

test("girdi hatalari: konu bos, konu.json bozuk, is yok -> cikis 2; anahtar yok -> 2", async () => {
  const bos = yeniIs({ baslik_en: "B", format: "short" });
  await assert.rejects(calistir(bos, Y.sahteClaude(sahteModel())), e => e.kod === "konu_bos" && e.cikis === 2);
  const bozuk = yeniIs(null);
  fs.writeFileSync(path.join(Y.URETIM, bozuk, "konu.json"), '{"baslik_en": "x",, }');
  await assert.rejects(calistir(bozuk, Y.sahteClaude(sahteModel())), e => e.kod === "konu_bozuk" && e.cikis === 2 && e.satir === 1);
  await assert.rejects(calistir("senaryotest-yok", Y.sahteClaude(sahteModel())), e => e.kod === "is_yok" && e.cikis === 2);
  await assert.rejects(calistir("../etc", Y.sahteClaude(sahteModel())), e => e.kod === "gecersiz_is" && e.cikis === 2);
  const ad = yeniIs({ baslik_en: "A", _not: "K", format: "short" });
  await assert.rejects(Y.sessiz(() => SC.ana([ad], {})), e => e.kod === "anahtar_yok" && e.cikis === 2);     // istemci ve anahtar yok
});

test("model sohbetli/etiketsiz yanit verse de metin temiz kaydedilir (giris cumlesi seslendirmeye gitmez)", async () => {
  const ad = yeniIs({ baslik_en: "Temiz", _not: "K", format: "short", hedefSaniye: 40, dil: "en" });
  const ist = Y.sahteClaude(() => ({ text: "Sure, here is the narration script:\n\nNobody saw it coming at all, and the whole city slept on without any warning.\n\n3:15 a.m., the alarm rang across the hall and nobody in the control room moved.\n\nWord count: 20" }));
  await calistir(ad, ist);
  const ps = ortak.paragraflaraBol(metinOku(ad));
  assert.equal(ps.length, 2);
  assert.ok(ps[0].startsWith("Nobody saw it coming"));
  assert.ok(ps[1].startsWith("3:15 a.m., the alarm"));
});

test("--anahtar-test: SDK modeller listesi (ucretsiz) ile sonucu @@SONUC olarak basar", async () => {
  const cikti = [];
  const r = await Y.sessiz(async (c) => { const x = await SC.ana(["--anahtar-test"], { istemci: Y.sahteClaude(() => ({})) }); cikti.push(...c); return x; });
  assert.equal(r.ok, false);                                           // test ortaminda anahtar yok
  const t = await require("../lib/senaryo-claude-istemci").anahtarTest("anahtar", { istemci: Y.sahteClaude(() => ({})) });
  assert.equal(t.ok, true);
  const kotu = await require("../lib/senaryo-claude-istemci").anahtarTest("anahtar", { istemci: { models: { list: async () => { throw Y.hata(401, "bad key"); } } } });
  assert.equal(kotu.ok, false);
  assert.match(kotu.mesaj, /geçersiz/);
  process.exitCode = 0;
});

test("--yedek: Claude servis hatasi verirse vidIQ'ya duser (komut satiri); bayrak yoksa dusmez", async () => {
  const Mcp = Y.sahteMcp;
  const araclar = {
    vidiq_balance: () => ({ structured: { totalCredits: 500 } }),
    vidiq_generate_script: () => ({ structured: { mcpJobId: "j1" } }),
    vidiq_job_poll: () => ({ structured: { status: "completed", result: paragraflar("v", 90).join("\n\n") } }),
  };
  const m = await Mcp(araclar);
  process.env.VIDIQ_KEY = "test-vidiq";
  try {
    const ad = yeniIs({ baslik_en: "Yedek", _not: "Konu", format: "short", hedefSaniye: 40, dil: "en" });
    const ist = Y.sahteClaude(() => { throw Y.hata(529, "overloaded"); });
    const r = await Y.sessiz(() => SC.ana([ad, "--yedek"], { istemci: ist, yedekSecenek: { vidiqSecenek: m.secenek, aralikSn: 1 } }));
    assert.ok(r.kelime > 20);
    assert.equal(Y.jsonOku(Y.URETIM, ad, "kullanim.json").kayitlar.some(k => k.saglayici === "vidiq"), true);
    const ad2 = yeniIs({ baslik_en: "Yedek2", _not: "Konu", format: "short", hedefSaniye: 40, dil: "en" });
    await assert.rejects(Y.sessiz(() => SC.ana([ad2], { istemci: Y.sahteClaude(() => { throw Y.hata(529, "overloaded"); }) })), e => e.kod === "claude_yogun");
  } finally { delete process.env.VIDIQ_KEY; await m.kapat(); }
});

test("Claude yanit vermezse zaman asimi: claude_zaman_asimi (cikis 3), asili kalmaz", async () => {
  const ad = yeniIs({ baslik_en: "Z", _not: "K", format: "short", hedefSaniye: 30, dil: "en" });
  const ist = { messages: { stream() { return { on() { return this; }, finalMessage: () => new Promise(() => {}) }; } } };     // hic cevap vermez
  const t0 = Date.now();
  await assert.rejects(Y.sessiz(() => SC.ana([ad], { istemci: ist, zamanAsimiMs: 150 })), e => e.kod === "claude_zaman_asimi" && e.cikis === 3);
  assert.ok(Date.now() - t0 < 3000);
  assert.ok(!fs.existsSync(path.join(Y.URETIM, ad, ".kilit")));
});
