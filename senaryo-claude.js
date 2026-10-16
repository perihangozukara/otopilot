// senaryo-claude.js <is> [--model X] [--iddia-yok] [--yedek] | --anahtar-test
// Konudan seslendirme metnini Claude API ile yazar.
// Anahtar: .env icindeki ANTHROPIC_API_KEY  (console.anthropic.com/settings/keys)
//
// NASIL YAZAR (sure garantisi icin):
//   kisa video (short/reels/tiktok) : tek istek, dikey istem (ilk 2 sn kancasi), shortsKirp ile sinir
//   4 dakikadan kisa uzun video     : tek istek
//   uzun video                      : ONCE ana hat (12-14 bolum), SONRA bolum bolum (her bolume
//                                     oncekilerin ozeti verilir), esik hedefin %95'i; altinda kalirsa
//                                     "devam et" turu. Yine altindaysa metin -yarim.txt olarak KAYDEDILIR
//                                     ama cikis kodu 4 (odenen metin cope gitmez).
//   Her yanit <anlatim>...</anlatim> icinden alinir (giris cumlesi, JSON, yonerge ayiklanir).
//   Ikinci gecis: IDDIA-RAPORU.* (dogrulanabilir iddialar; DOGRULAMA DEGIL, kontrol listesi).
//   Her cagri uretim/<is>/kullanim.json'a yazilir; konu.maliyetUstSinirUSD asilirsa baslamadan cikis 7.
//
// Cikis kodlari: 0 tamam | 2 girdi/yapilandirma | 3 Claude hatasi (anahtar, kredi, limit, ag)
//                4 yetersiz sonuc (kisa kalan senaryo, ret) | 6 kilit | 7 maliyet siniri
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./lib/ortak");
const S = require("./lib/senaryo-ortak");
const P = require("./lib/senaryo-prompt");
const K = require("./lib/senaryo-kullanim");
const C = require("./lib/senaryo-claude-istemci");
const I = require("./lib/senaryo-iddia");

const { OrtakHata, CIKIS } = ortak;
const BETIK = "senaryo-claude.js";
const ESIK = 0.95;                 // uzun videoda hedef kelimenin en az bu kadari
const DEVAM_TURU = 2;              // esik altinda en cok kac "devam et" turu
const IDDIA_MAKS_TOKEN = 24000;    // iddia ikinci gecisi: en cok 80 iddia (~15 bin token) + dusunme payi

// Model cevabini senaryo parcasina cevirir: paragraflar + her paragrafin gorsel aramalari
function cevabiCoz(metin) {
  const t = S.paragraflariTemizle(metin);
  const ara = S.gorselAramaCikar(metin);
  const paragraflar = t.paragraflar.map(p => {
    const a = ara.get(p.hamNo + 1) || {};
    return { metin: p.metin, aramalar: a.aramalar || [], uret: a.uret || "" };
  });
  // token sinirinda kesilen son paragrafi (cumle bitmeden) at
  if (t.kesik && paragraflar.length > 1 && !/[.!?…"”’)]$/.test(paragraflar[paragraflar.length - 1].metin)) paragraflar.pop();
  return { paragraflar, silinen: t.silinen, etiketVar: t.etiketVar, kesik: t.kesik, ozet: S.ozetCikar(metin) };
}

const toplamKelime = bolumler => bolumler.reduce((a, b) => a + b.paragraflar.reduce((x, p) => x + S.kelimeSay(p.metin), 0), 0);

// "devam et" turunda uretilen paragraflar kapanisin ONUNE girer
function kapanistanOnceEkle(bolumler, yeni) {
  if (bolumler.length > 1) { bolumler[bolumler.length - 2].paragraflar.push(...yeni); return; }
  const ps = bolumler[0].paragraflar;
  ps.splice(Math.max(0, ps.length - 1), 0, ...yeni);
}

// Birbirine cok benzeyen paragraflari (modelin kendini tekrari) at; bos kalan bolumu da at
function bolumleriAyikla(bolumler, log) {
  const duz = [];
  bolumler.forEach((b, bi) => b.paragraflar.forEach((p, pi) => duz.push({ bi, pi, metin: p.metin })));
  const at = S.tekrarIndeksleri(duz.map(x => x.metin), 0.7);
  if (!at.size) return bolumler;
  log("tekrar : " + at.size + " benzer paragraf ayıklandı");
  const silinecek = new Set(Array.from(at, i => duz[i].bi + ":" + duz[i].pi));
  return bolumler
    .map((b, bi) => Object.assign({}, b, { paragraflar: b.paragraflar.filter((p, pi) => !silinecek.has(bi + ":" + pi)) }))
    .filter(b => b.paragraflar.length);
}

async function ana(argv, secenek) {
  secenek = secenek || {};
  const log = m => console.log(m);
  const { konum, bayrak } = ortak.argumanCoz(argv, { deger: ["model"] });

  // ---- anahtar testi (ucretsiz: modeller listesi) ----
  if (bayrak["anahtar-test"]) {
    const t = await C.anahtarTest(C.claudeAnahtari(), secenek);
    console.log((t.ok ? "✓ " : "✗ ") + t.mesaj);
    ortak.sonuc(t);
    if (!t.ok) process.exitCode = CIKIS.SERVIS;
    return t;
  }

  const is = konum[0];
  if (!is) throw new OrtakHata("arguman", "Kullanım: node senaryo-claude.js <is-adi>", { cikis: CIKIS.GIRDI });
  const dizin = ortak.isDizin(is);
  if (!fs.existsSync(dizin)) throw new OrtakHata("is_yok", "İş bulunamadı: " + is, { cikis: CIKIS.GIRDI,
    cozum: "Önce panelden yeni video oluştur." });
  ortak.kilitAl(is, BETIK);
  try {
    try {
      return await yaz(is, bayrak, secenek);
    } catch (e) {
      // --yedek: Claude servis hatasi (anahtar, kredi, limit, ag) verirse ve vidIQ anahtari varsa vidIQ ile dener.
      // (Panel zincirinde bu gecis panelin isidir; bayrak komut satirindan kullanim icindir.)
      const yedekVar = secenek.yedekSecenek || ortak.envOku("VIDIQ_KEY");
      if (bayrak.yedek && e instanceof OrtakHata && e.cikis === CIKIS.SERVIS && yedekVar) {
        ortak.uyari("Claude hata verdi (" + e.message + "); yedek motor vidIQ ile yazılıyor.");
        return await require("./senaryo-yaz").ana([is], secenek.yedekSecenek || {});
      }
      throw e;
    }
  } finally {
    ortak.kilitBirak(is);            // ayni surecte tekrar cagrilabilsin (testler, panel ici kullanim)
  }
}

async function yaz(is, bayrak, secenek) {
  const log = m => console.log(m);
  const konu = ortak.konuEtkin(is);
  if (!konu) throw new OrtakHata("konu_yok", "konu.json yok: " + is, { cikis: CIKIS.GIRDI, cozum: "Panelden yeni video oluştur." });
  const konuNotu = S.konuNotu(konu);
  if (!konuNotu) throw new OrtakHata("konu_bos", "Konu yazılmamış (konu.json içindeki _not alanı boş).",
    { cikis: CIKIS.GIRDI, cozum: "Panelde 'Ne istiyorsun?' kutusunu doldur." });

  const anahtar = C.claudeAnahtari();
  if (!anahtar && !secenek.istemci)
    throw new OrtakHata("anahtar_yok", "ANTHROPIC_API_KEY yok.", { cikis: CIKIS.GIRDI,
      cozum: "Panel > Kaynaklar sekmesine yapıştır (anahtarı console.anthropic.com/settings/keys adresinden al) ya da vidIQ ile yaz." });

  const model = K.modelSec(bayrak.model);
  const hedef = S.hedefler(konu);
  for (const u of hedef.uyarilar) ortak.uyari(u);
  const baslik = konu.baslik_en || is;
  const planBolum = hedef.tekAtis ? 0 : P.bolumSayisi(hedef.hedefSn);
  const formatAd = S.PLATFORM_ADI[hedef.format];

  log("konu    : " + konuNotu.slice(0, 100));
  log("başlık  : " + baslik);
  log("dil     : " + hedef.dilAdi + " (" + hedef.dil + ") · tür: " + konu.tur);
  log("hedef   : " + formatAd + " · " + S.sureMetni(Math.round(hedef.hedefSn)) + " (~" + hedef.hedefKelime + " kelime, " + hedef.kelimeHizi + " kelime/dk)");
  log("model   : " + model + (planBolum ? " · " + planBolum + " bölümlü yazım" : " · tek istek"));

  // ---- maliyet sinirini BASLAMADAN denetle ----
  const cagriSayisi = planBolum ? planBolum + 2 : 1;
  const tahmin = K.claudeTahminUSD(model, hedef.hedefKelime, cagriSayisi, 3500) + (secenek.iddiaYok || bayrak["iddia-yok"] ? 0 : 0.03);
  K.maliyetKontrol(is, konu, tahmin);
  log("tahmini maliyet: ~$" + tahmin.toFixed(2) + " (fiyat: " + K.fiyatBul(model).kaynak + ")");
  log("");

  const baglam = {
    tur: konu.tur, dil: hedef.dil, dilAdi: hedef.dilAdi, kisa: hedef.kisa, format: hedef.format,
    hedefKelime: hedef.hedefKelime, hedefSn: hedef.hedefSn, hedefDk: hedef.hedefDk, kelimeHizi: hedef.kelimeHizi,
    kanal: konu.kanal, ton: konu.ton, kanalSesi: konu.kanalSesi, kisiselKatki: konu.kisiselKatki,
    arastirma: konu.arastirma || "", trend: S.trendReferansi(konu), konuNotu, baslik,
  };
  const sistem = [{ type: "text", text: P.sistemPromptu(baglam), cache_control: { type: "ephemeral" } }];

  let harcananUSD = 0;
  const cagri = async (etiket, istek, o) => {
    const c = await C.claudeIste({ is, betik: BETIK, istemci: secenek.istemci, anahtar, model, sistem, istek,
      effort: o.effort, maksToken: o.maksToken, not: etiket, zamanAsimiMs: secenek.zamanAsimiMs,
      onMetin: () => ortak.ilerleme("claude", o.yuzde == null ? null : o.yuzde, { etiket }) });
    harcananUSD += c.usd;
    return c;
  };

  // ---- uretim ----
  let bolumler = [];         // [{ad, paragraflar:[{metin, aramalar, uret}]}]
  let ozet = "";
  let bolumKaydi = false;    // bolumler.json yazilsin mi (yalniz cok bolumlu yolda)
  const kismiKaydet = (neden) => {
    const metin = bolumler.flatMap(b => b.paragraflar.map(p => p.metin)).join("\n\n");
    if (S.kelimeSay(metin) < 30) return null;
    const dosya = S.senaryoYaz(is, metin, "-yarim");
    console.error("  ↳ Yazılan kısım (" + S.kelimeSay(metin) + " kelime) " + path.relative(ortak.KOK, dosya).replace(/\\/g, "/") + " olarak kaydedildi: " + neden);
    return dosya;
  };

  try {
    if (hedef.kisa) {
      const maks = Math.max(8000, hedef.hedefKelime * 6 + 4000);       // dusunme tokenleri de bu sinira girer
      const c = await cagri("kısa video", P.tekAtisIstegi(baglam), { effort: "medium", maksToken: maks, yuzde: 20 });
      if (c.durum === "max_tokens") ortak.uyari("Yanıt token sınırında kesildi; yine de kullanılıyor.");
      const r = cevabiCoz(c.metin);
      if (!r.etiketVar) ortak.uyari("Model <anlatim> etiketini kullanmadı; yanıtın tamamı senaryo sayıldı.");
      const t = S.temizlikRaporu(r.silinen); if (t) log("temizlik: " + t);
      bolumler = [{ ad: "", paragraflar: r.paragraflar }];
      ozet = r.ozet;
    } else if (hedef.tekAtis) {
      const c = await cagri("senaryo", P.tekAtisIstegi(baglam), { effort: "high", maksToken: Math.min(48000, Math.max(12000, hedef.hedefKelime * 8)), yuzde: 20 });
      if (c.durum === "max_tokens") ortak.uyari("Yanıt token sınırında kesildi; devam turu eksik kalanı tamamlayacak.");
      const r = cevabiCoz(c.metin);
      if (!r.etiketVar) ortak.uyari("Model <anlatim> etiketini kullanmadı; yanıtın tamamı senaryo sayıldı.");
      const t = S.temizlikRaporu(r.silinen); if (t) log("temizlik: " + t);
      bolumler = [{ ad: "", paragraflar: r.paragraflar }];
      ozet = r.ozet;
    } else {
      // --- 1) ana hat ---
      let plan = null;
      for (let deneme = 0; deneme < 2 && !plan; deneme++) {
        const c = await cagri("ana hat", P.anaHatIstegi(baglam, planBolum), { effort: "high", maksToken: 8000, yuzde: 5 });
        plan = P.planCoz(c.metin, planBolum);
        if (!plan) ortak.uyari("Ana hat okunamadı" + (deneme ? "; tek istekle yazılacak." : ", yeniden deneniyor."));
      }
      if (!plan) {
        const c = await cagri("senaryo", P.tekAtisIstegi(baglam), { effort: "high", maksToken: 48000, yuzde: 20 });
        const r = cevabiCoz(c.metin);
        const t = S.temizlikRaporu(r.silinen); if (t) log("temizlik: " + t);
        bolumler = [{ ad: "", paragraflar: r.paragraflar }];
        ozet = r.ozet;
      } else {
        ozet = plan.ozet;
        const n = plan.bolumler.length;
        log("ana hat : " + n + " bölüm");
        // --- 2) bolum bolum ---
        for (let i = 0; i < n; i++) {
          const yazilan = toplamKelime(bolumler);
          const kalan = Math.max(60, Math.round((hedef.hedefKelime - yazilan) / (n - i)));     // erken kisa kalan bolumun acigi sonrakilere eklenir
          const onceki = bolumler.length ? bolumler[bolumler.length - 1].paragraflar.slice(-2).map(p => p.metin).join("\n\n") : "";
          let r = null;
          for (let deneme = 0; deneme < 2 && (!r || !r.paragraflar.length); deneme++) {
            const c = await cagri("bölüm " + (i + 1) + "/" + n, P.bolumIstegi(baglam, plan, i, kalan, onceki),
              { effort: "medium", maksToken: 8000, yuzde: 8 + 70 * i / n });
            r = cevabiCoz(c.metin);
            const t = S.temizlikRaporu(r.silinen); if (t) log("temizlik (bölüm " + (i + 1) + "): " + t);
          }
          if (!r.paragraflar.length) throw new OrtakHata("bolum_bos", "Claude " + (i + 1) + ". bölüm için metin döndürmedi.",
            { cikis: CIKIS.YETERSIZ, cozum: "Tekrar dene." });
          bolumler.push({ ad: plan.bolumler[i].ad, paragraflar: r.paragraflar });
          log("  bölüm " + (i + 1) + "/" + n + ": +" + toplamKelime([bolumler[bolumler.length - 1]]) + " kelime → toplam " + toplamKelime(bolumler) + "/" + hedef.hedefKelime);
          K.maliyetKontrol(is, konu, 0);       // sinir asildiysa kalan bolumleri YAZMA (metin kismi kaydedilir)
        }
        bolumKaydi = true;
      }
    }

    // ---- uzun videoda esik: hedefin %95'i, altinda "devam et" turu ----
    if (!hedef.kisa) {
      for (let tur = 0; tur < DEVAM_TURU && toplamKelime(bolumler) < hedef.hedefKelime * ESIK; tur++) {
        const mevcut = toplamKelime(bolumler);
        const eksik = hedef.hedefKelime - mevcut;
        ortak.uyari("Senaryo " + mevcut + " kelime, hedef " + hedef.hedefKelime + ": " + eksik + " kelimelik devam turu yazılıyor.");
        K.maliyetKontrol(is, konu, 0.05);
        const metin = bolumler.flatMap(b => b.paragraflar.map(p => p.metin)).join("\n\n");
        const c = await cagri("devam turu " + (tur + 1), P.devamIstegi(baglam, metin, mevcut, eksik),
          { effort: "medium", maksToken: Math.min(32000, Math.max(6000, eksik * 6 + 2000)), yuzde: 85 });
        const r = cevabiCoz(c.metin);
        if (!r.paragraflar.length) break;
        kapanistanOnceEkle(bolumler, r.paragraflar);
        log("  devam turu " + (tur + 1) + ": +" + r.paragraflar.reduce((a, p) => a + S.kelimeSay(p.metin), 0) + " kelime");
      }
    }
  } catch (e) {
    // Odenen metin cope gitmesin: o ana kadarki kismi kaydet, sonra hatayi aynen ilet.
    if (bolumler.length) { try { kismiKaydet("işlem " + (e && e.kod ? e.kod : "hata") + " ile yarıda kaldı"); } catch (e2) { /* asil hata onemli */ } }
    throw e;
  }

  // ---- ayikla / kirp ----
  bolumler = bolumleriAyikla(bolumler, log);
  if (hedef.kisa) {
    // Shorts/Reels/TikTok: hedef kelime TAVAN. Paragraf yapisi ve gorsel aramalari korunur.
    const duz = bolumler[0].paragraflar;
    const k = S.kirpCekirdek(duz.map(p => p.metin), hedef.hedefKelime);
    if (k.kirpildi) {
      log("kırpma  : " + toplamKelime(bolumler) + " kelime hedefin (" + hedef.hedefKelime + ") üstünde, sınıra kırpıldı");
      bolumler = [{ ad: "", paragraflar: k.paragraflar.map((m, i) => Object.assign({}, duz[k.kaynak[i]], { metin: m })) }];
    }
  }
  const tumParagraflar = bolumler.flatMap(b => b.paragraflar);
  const metin = tumParagraflar.map(p => p.metin).join("\n\n");
  const kelime = S.kelimeSay(metin);
  if (!tumParagraflar.length || kelime < 20) throw new OrtakHata("bos_senaryo", "Claude boş ya da çok kısa senaryo döndürdü.", { cikis: CIKIS.YETERSIZ, cozum: "Tekrar dene." });
  const sn = S.sureTahmin(kelime, hedef.kelimeHizi);

  // uzun videoda %95 altinda: ANA dosyaya yazma, -yarim olarak sakla, cikis 4
  if (!hedef.kisa && kelime < hedef.hedefKelime * ESIK) {
    const dosya = S.senaryoYaz(is, metin, "-yarim");
    throw new OrtakHata("senaryo_kisa",
      "Senaryo " + kelime + " kelimede kaldı (~" + S.sureMetni(sn) + "), hedef " + S.sureMetni(Math.round(hedef.hedefSn)) +
      " (" + hedef.hedefKelime + " kelime). Metin " + path.basename(dosya) + " olarak kaydedildi.",
      { cikis: CIKIS.YETERSIZ,
        cozum: "Konuyu ve kaynak metnini ayrıntılandır ya da kaydedilen -yarim metnini panelde düzenleyip senaryo olarak kaydet.",
        detay: { kelime, hedefKelime: hedef.hedefKelime, harcananUSD } });
  }
  const dilU = S.dilUyarisi(metin, hedef.dil);
  if (dilU) ortak.uyari(dilU);
  if (hedef.kisa && kelime < hedef.hedefKelime * 0.5)
    ortak.uyari("Senaryo hedefin yarısından kısa (" + kelime + "/" + hedef.hedefKelime + " kelime): video planlanandan kısa çıkacak.");
  if (!hedef.kisa && kelime > hedef.hedefKelime * 1.15)
    ortak.uyari("Senaryo hedefin %15 üstünde (" + kelime + "/" + hedef.hedefKelime + " kelime): video ~" + S.sureMetni(sn) + " sürecek.");

  // ---- dosyalar: yan dosyalar once, senaryo metni EN SON ----
  fs.mkdirSync(S.sesDizini(is), { recursive: true });
  const yedek = S.senaryoYedekle(is);
  const aramaDosyasi = S.gorselAramalariYaz(is, tumParagraflar, "claude");
  const uretilmeyen = [];
  if (!aramaDosyasi) uretilmeyen.push("gorsel-aramalari.json");
  if (bolumKaydi && bolumler.length >= 3) {
    let konumBas = 0;
    const liste = bolumler.map(b => { const o = { ad: b.ad, paragrafBas: konumBas, paragrafSon: konumBas + b.paragraflar.length - 1 }; konumBas += b.paragraflar.length; return o; });
    S.bolumlerYaz(is, liste);
  } else uretilmeyen.push("bolumler.json");
  if (ozet) S.ozetYaz(is, ozet); else uretilmeyen.push("aciklama-ozet.txt");
  const tasinan = S.bayatYanDosyalariKaldir(is, uretilmeyen);
  S.senaryoYaz(is, metin);
  try { fs.unlinkSync(path.join(S.sesDizini(is), "SESLENDIRME-TAM-METIN-yarim.txt")); } catch (e) { /* yoktu */ }

  // ---- ikinci gecis: iddia listesi ----
  let iddia = null;
  if (!(secenek.iddiaYok || bayrak["iddia-yok"])) {
    const paragrafMetinleri = tumParagraflar.map(p => p.metin);
    try {
      K.maliyetKontrol(is, konu, 0.02);
      const { sistem: iSistem, istek: iIstek } = I.iddiaIstemi(paragrafMetinleri, konu.arastirma, hedef.dilAdi);
      // 80 iddia ~ 15 bin cikis tokeni (Turkce not dahil); sinir dusunme tokenlerini de kapsar, bu yuzden genis tutulur.
      const c = await C.claudeIste({ is, betik: BETIK, istemci: secenek.istemci, anahtar, model, sistem: iSistem, istek: iIstek,
        effort: "low", maksToken: IDDIA_MAKS_TOKEN, not: "iddia listesi", zamanAsimiMs: secenek.zamanAsimiMs });
      harcananUSD += c.usd;
      // Yanit yine de token sinirinda kesilirse ucretli cikti cope gitmez: tamamlanan iddialar kurtarilir.
      const d = I.modelIddialariniCozDetay(c.metin, paragrafMetinleri.length);
      if (!d) throw new Error("model iddia listesini JSON olarak döndürmedi" + (c.durum === "max_tokens" ? " (token sınırında kesildi)" : ""));
      if (d.kurtarildi) ortak.uyari("İddia listesi token sınırında kesildi; tamamlanan " + d.liste.length + " iddia kullanıldı, liste eksik olabilir.");
      iddia = I.rapor("claude", model, d.liste, konu.arastirma);
      if (d.kurtarildi) iddia.listeKesik = true;
    } catch (e) {
      ortak.uyari("İddia listesi modelle çıkarılamadı (" + String(e.message).slice(0, 80) + "); yerel desen listesi yazıldı.");
      iddia = I.rapor("yerel", "", I.yerelIddialar(paragrafMetinleri), konu.arastirma);
    }
    I.raporYaz(is, iddia);
  }

  log("");
  log("✓ senaryo yazıldı: Voice/SESLENDIRME-TAM-METIN.txt");
  log("  " + kelime + " kelime · ~" + S.sureMetni(sn) + " · " + tumParagraflar.length + " paragraf");
  log("  maliyet: ~$" + harcananUSD.toFixed(3) + " (tahmin; toplam kayıt: uretim/" + is + "/kullanim.json)");
  if (yedek) log("  önceki metin yedeklendi: Voice/yedek/" + path.basename(yedek));
  if (tasinan.length) log("  eski yan dosyalar yedek klasörüne taşındı: " + tasinan.join(", "));
  if (iddia) log("  iddia listesi: IDDIA-RAPORU.md — " + iddia.ozet.toplam + " iddia, " + iddia.ozet.dusukGuven + " öncelikli kontrol (doğrulama DEĞİLDİR)");
  if (sn > hedef.hedefSn * 1.15) ortak.uyari("Süre hedefi (" + hedef.hedefSn + " sn) %15 aşıyor.");
  const sonuc = { kelime, paragraf: tumParagraflar.length, tahminiSn: sn, hedefSn: hedef.hedefSn, hedefKelime: hedef.hedefKelime,
    kelimeHizi: hedef.kelimeHizi, dil: hedef.dil, model, usd: Math.round(harcananUSD * 1000) / 1000,
    bolum: bolumKaydi ? bolumler.length : 0, yedek: yedek ? path.basename(yedek) : null,
    iddia: iddia ? iddia.ozet : null };
  ortak.sonuc(sonuc);
  return sonuc;
}

module.exports = { ana, cevabiCoz, toplamKelime, kapanistanOnceEkle, bolumleriAyikla };

if (require.main === module) ana(process.argv.slice(2)).catch(ortak.bitir);
