// senaryo-yaz.js <is> [--yedek]
// Konudan seslendirme metnini vidIQ ile URETIR (Claude anahtari yoksa ya da yedek olarak).
// Anahtar: .env icindeki VIDIQ_KEY  (panel > Kaynaklar; app.vidiq.com/account/settings/mcp)
//
// vidIQ tek cagrida ~1400 kelimede tikaniyor (OLCULDU), istenen dakikanin ~1.55 kati metin yaziyor
// (OLCULDU: 3 dk istendi -> 716 kelime = 4,7 dk). Bu yuzden uzun video PARCA PARCA istenir:
//   - her parcaya "Part N of M; yalniz sonuncusu kapanis yapar, ilk parca disinda selam yok" brief'i,
//   - istenen dakika = hedef kelime / kelime hizi / 1.55 (katsayi GERCEKTEN baglidir),
//   - onceki parcalarin ozeti sonrakine "tekrar etme" diye verilir,
//   - birlestirmede tekrar tespiti + selam/kapanis cumlelerinin ayiklanmasi,
//   - hedefin %115'ini asan metin kirpilir (kisa videoda tavan zaten sert),
//   - kisa formatlar (Shorts/Reels/TikTok) hedef sureye gore istenir (dakikaIste), fazlasi shortsKirp ile kesilir,
//   - kullanicinin kaynak metni (konu.arastirma) vidIQ `research` alanina KIRPILMADAN girer (sema siniri 20000);
//     sigmazsa uyarilir ve IDDIA raporu "kaynakta geciyor" kontrolunu yalniz vidIQ'nun gordugu kisma gore yapar,
//   - brief Claude yoluyla ayni girdileri okur: tur, ton, kanalSesi, kanal, kisiselKatki, dil, trend referansi.
// Esik hedefin %95'i; altinda "devam et" parcasi istenir, yine altindaysa metin -yarim.txt olarak
// KAYDEDILIR ama cikis 4 (kredi bosa gitmez).
// vidIQ script araci DIL PARAMETRESI ALMAZ (sema okundu): dil brief'e ve konu satirina yazilir; donen metin istenen dilde
// degilse ana dosyaya yazilmaz, -dil-uyumsuz.txt olarak saklanir, cikis 4 (yabanci dilde seslendirme olmasin).
// Ucretli cagri kabul edildiyse kredi kaydi (kullanim.json) HER cikista yazilir (hata yollari dahil).
//
// Cikis kodlari: 0 tamam | 2 girdi/yapilandirma (anahtar yok) | 3 vidIQ hatasi (anahtar, kredi, ag)
//                4 yetersiz sonuc | 6 kilit | 7 maliyet siniri
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./lib/ortak");
const S = require("./lib/senaryo-ortak");
const P = require("./lib/senaryo-prompt");
const K = require("./lib/senaryo-kullanim");
const I = require("./lib/senaryo-iddia");
const { VidiqIstemci } = require("./lib/vidiq");

const { OrtakHata, CIKIS } = ortak;
const BETIK = "senaryo-yaz.js";
const ESIK = 0.95;
const VIDIQ_KATSAYI = 1.55;          // OLCULDU: vidIQ istenen dakikanin ~1.55 kati metin yaziyor
const PARCA_KELIME = 1300;           // OLCULDU: tek cagri ~1400 kelimede tikaniyor
const DEVAM_PARCASI = 2;
// vidIQ vidiq_generate_script SEMASI: topic <=500, title <=300, tone <=100, concept <=20000, research <=20000.
// concept'te 8000 yeter (brief en kotu durumda ~6000 karakter); asarsa TUM istegi reddeder, bu yuzden yine sinirlanir.
const CONCEPT_KAP = 8000;
const ARASTIRMA_KAP = 20000;
const KISALTMA_KAP = 1200;           // alan uzunlugu hatasindan sonraki tek kisaltilmis deneme

const TON = {
  belgesel: "cinematic documentary, measured, no hype", reklam: "persuasive, warm, honest, no hype",
  "haber-spor": "neutral, factual, energetic", egitim: "clear, friendly, educational",
  hikaye: "immersive storytelling, suspenseful", tanitim: "warm, confident, informative",
};
const ACILAR = [
  "Cover the origins and the background the audience needs first.",
  "Now go deeper: the mechanisms, the specifics, the concrete examples and numbers.",
  "Now the consequences, the objections, the counter-arguments and what is still unresolved.",
  "Now the wider implications and where this is heading next.",
  "Now bring in fresh angles: surprising details, human stories and concrete cases not covered yet.",
  "Now tie the threads together and show what the viewer should take away.",
];

const sinirla = (n, a, b) => Math.max(a, Math.min(b, n));
const dakikaIste = (kelime, hiz) => sinirla(Math.round(kelime / hiz / VIDIQ_KATSAYI), 1, 60);
// vidIQ alan sinirlari: topic 500, title 300, tone 100. Asarsa TUM istegi reddediyor.
const kirp = (s, n) => { s = String(s || "").trim(); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…"; };

// vidIQ is sonucundan metin cikarir. Beklenmedik JSON/bos yanit senaryo SAYILMAZ.
function scriptMetni(sonuc) {
  if (typeof sonuc === "string") return sonuc;
  if (sonuc && typeof sonuc === "object") {
    for (const a of ["script", "text", "content", "body"]) if (typeof sonuc[a] === "string" && sonuc[a].trim()) return sonuc[a];
  }
  throw new OrtakHata("vidiq_cevap", "vidIQ beklenmedik biçimde yanıt verdi; senaryo olarak kullanılmadı.",
    { cikis: CIKIS.SERVIS, cozum: "Tekrar dene; sürerse senaryoyu Claude anahtarıyla yaz.", detay: JSON.stringify(sonuc).slice(0, 200) });
}

// Parca plani: kac parca, her parcada kac kelime ve vidIQ'dan kac dakika istenecek
function parcaPlani(hedef) {
  const M = hedef.kisa ? 1 : sinirla(Math.ceil(hedef.hedefKelime / PARCA_KELIME), 1, 6);
  return { M, kelimeBasi: Math.round(hedef.hedefKelime / M) };
}

function parcaBriefi(b, k, M, kelime, aciklamaBrief) {
  let ek = "";
  if (M > 1) {
    ek = "This is PART " + k + " OF " + M + " of ONE continuous video that is written in separate requests. " +
      (k === 1 ? "Open with the hook; no greeting. "
        : "Continue seamlessly in the middle of the story: NO greeting, NO introduction of the topic, NO recap. ") +
      (k < M ? "Do NOT conclude and do not say goodbye: end on an open question that leads into the next part. "
        : "This is the LAST part: pay off the open loops and close the video. ") +
      (ACILAR[Math.min(k - 1, ACILAR.length - 1)]) + " About " + kelime + " words.";
  } else if (!b.kisa) {
    // tek parcali uzun video (~8,6 dk alti): parca kurali yok, acilis kancasi kurali burada verilir (kisa videoda vidiqBrief verir)
    ek = "Open with a concrete hook in the first two sentences (a specific image, number or tension). " +
      "No greeting, no \"in this video\", no introduction of the topic.";
  }
  if (aciklamaBrief) ek = (ek ? ek + " " : "") + String(aciklamaBrief).slice(0, 1500);
  return P.vidiqBrief(b, ek);
}

async function ana(argv, secenek) {
  secenek = secenek || {};
  const { konum, bayrak } = ortak.argumanCoz(argv, {});
  const is = konum[0];
  if (!is) throw new OrtakHata("arguman", "Kullanım: node senaryo-yaz.js <is-adi> [--yedek]", { cikis: CIKIS.GIRDI });
  const dizin = ortak.isDizin(is);
  if (!fs.existsSync(dizin)) throw new OrtakHata("is_yok", "İş bulunamadı: " + is, { cikis: CIKIS.GIRDI, cozum: "Önce panelden yeni video oluştur." });
  ortak.kilitAl(is, BETIK);
  try {
    try {
      return await yaz(is, secenek);
    } catch (e) {
      // --yedek: vidIQ servis hatasi (anahtar, kredi, ag) verirse ve Claude anahtari varsa Claude ile dener.
      // (Panel zincirinde bu gecis panelin isidir; bayrak komut satirindan kullanim icindir.)
      const yedekVar = secenek.yedekSecenek || ortak.envOku("ANTHROPIC_API_KEY");
      if (bayrak.yedek && e instanceof OrtakHata && e.cikis === CIKIS.SERVIS && yedekVar) {
        ortak.uyari("vidIQ hata verdi (" + e.message + "); yedek motor Claude ile yazılıyor.");
        return await require("./senaryo-claude").ana([is], secenek.yedekSecenek || {});
      }
      throw e;
    }
  } finally { ortak.kilitBirak(is); }
}

// Ucretli cagri yapildiktan sonra NEREDE biterse bitsin (basari, vidiq_bos, senaryo_kisa, cagri hatasi) kredi kaydi
// kullanim.json'a yazilir: panelin /api/maliyet toplami eksik kalmasin. Kayit bir kez yazilir (durum.kaydet idempotent).
async function yaz(is, secenek) {
  const durum = { kaydet: null };
  let hata = null;
  try { return await yazIc(is, secenek, durum); }
  catch (e) { hata = e; throw e; }
  finally { if (durum.kaydet) await durum.kaydet(hata ? (hata.kod || "hata") : ""); }
}

async function yazIc(is, secenek, durum) {
  const log = m => console.log(m);
  const konu = ortak.konuEtkin(is);
  if (!konu) throw new OrtakHata("konu_yok", "konu.json yok: " + is, { cikis: CIKIS.GIRDI, cozum: "Panelden yeni video oluştur." });
  const konuNotu = S.konuNotu(konu);
  if (!konuNotu) throw new OrtakHata("konu_bos", "Konu yazılmamış (konu.json içindeki _not alanı boş).",
    { cikis: CIKIS.GIRDI, cozum: "Panelde yeni video oluştururken 'Konu' kutusunu doldur." });
  const anahtar = ortak.envOku("VIDIQ_KEY");
  if (!anahtar && !secenek.vidiq)
    throw new OrtakHata("vidiq_anahtar", "VIDIQ_KEY yok.", { cikis: CIKIS.GIRDI,
      cozum: "Panel > Kaynaklar sekmesine vidIQ anahtarını yapıştır (app.vidiq.com/account/settings/mcp)." });

  const hedef = S.hedefler(konu);
  for (const u of hedef.uyarilar) ortak.uyari(u);
  const baslik = konu.baslik_en || is;
  const plan = parcaPlani(hedef);
  // Claude yoluyla AYNI girdiler (senaryo-claude.js baglami): tur, ton, kanalSesi, kanal, kisiselKatki, dil, trend referansi
  const baglam = {
    tur: konu.tur, dil: hedef.dil, dilAdi: hedef.dilAdi, kisa: hedef.kisa, format: hedef.format,
    hedefKelime: hedef.hedefKelime, hedefSn: hedef.hedefSn, kisiselKatki: konu.kisiselKatki,
    kanal: konu.kanal, ton: konu.ton, kanalSesi: konu.kanalSesi, trend: S.trendReferansi(konu),
  };
  const ton = kirp(konu.ton || TON[konu.tur] || TON.belgesel, 100);
  const kaynakTam = String(konu.arastirma || "").trim();

  log("konu    : " + konuNotu.slice(0, 90));
  log("başlık  : " + baslik);
  log("dil     : " + hedef.dilAdi + " (" + hedef.dil + ") · tür: " + konu.tur);
  log("format  : " + S.PLATFORM_ADI[hedef.format] + " · hedef " + S.sureMetni(Math.round(hedef.hedefSn)) + " (~" + hedef.hedefKelime + " kelime)");
  K.maliyetKontrol(is, konu, 0);       // Claude harcamasi zaten sinirdaysa vidIQ ile devam etmeyi de durdur

  const vidiq = secenek.vidiq || new VidiqIstemci(anahtar, secenek.vidiqSecenek);

  // ---- baslamadan once kredi yeterli mi? (vidiq_balance ucretsiz) ----
  // kisa formatlar (Shorts/Reels/TikTok) da hedef sureye gore istenir: Reels 180 sn icin 1 dakika degil ~2 dakika.
  // vidIQ fazlasini yazarsa shortsKirp tavana indirir; eksik kalirsa asagida uyarilir.
  const kisaDakika = dakikaIste(hedef.hedefKelime, hedef.kelimeHizi);
  const tahminiKredi = hedef.kisa ? kisaDakika : Array.from({ length: plan.M }, () => dakikaIste(plan.kelimeBasi, hedef.kelimeHizi)).reduce((a, b) => a + b, 0) + 2;
  let oncekiKredi = null;
  try {
    const b = await vidiq.cagir("vidiq_balance", {});
    if (b && typeof b.totalCredits === "number") oncekiKredi = b.totalCredits;
  } catch (e) {
    if (e.kod === "vidiq_anahtar") throw e;                     // anahtar gecersizse hemen soyle
    /* bakiye okunamadiysa devam: asil cagri zaten kredi hatasini verir */
  }
  if (oncekiKredi !== null && oncekiKredi < tahminiKredi)
    throw new OrtakHata("vidiq_kredi", "vidIQ kredin yetersiz: bu senaryo ~" + tahminiKredi + " kredi harcar, kalan " + oncekiKredi + ".",
      { cikis: CIKIS.SERVIS, cozum: "vidIQ kredini yenile (app.vidiq.com) ya da senaryoyu Claude anahtarıyla yaz.", detay: { kalan: oncekiKredi, tahmin: tahminiKredi } });
  log("vidIQ'ya gönderiliyor… (~" + tahminiKredi + " kredi" + (oncekiKredi !== null ? ", kalan " + oncekiKredi : "") + ")");

  let harcananDakika = 0, cagriSayisi = 0;
  // Kullanim kaydi: kredi = bakiye farki (okunabildiyse), yoksa kabul edilen cagrilarin istenen dakikasi.
  let kayit = null;
  async function kullanimKaydet(neden) {
    if (kayit) return kayit;
    if (!cagriSayisi) return { kredi: 0, sonraki: null };           // hic ucretli cagri kabul edilmedi: kaydedilecek harcama yok
    let sonraki = null;
    try {
      const b = await vidiq.cagir("vidiq_balance", {});
      if (b && typeof b.totalCredits === "number") sonraki = b.totalCredits;
    } catch (e) { /* bakiye okunamadi: istenen dakikayi kaydet */ }
    let kredi = harcananDakika;
    if (oncekiKredi !== null && sonraki !== null && oncekiKredi >= sonraki) kredi = oncekiKredi - sonraki;
    try {
      K.kullanimEkle(is, { betik: BETIK, saglayici: "vidiq", model: "vidiq_generate_script", giris: 0, cikis: 0, kredi, usd: 0,
        not: cagriSayisi + " çağrı, " + harcananDakika + " dakika istendi" + (sonraki !== null ? ", kalan kredi " + sonraki : "") +
          (neden ? " (işlem " + neden + " ile bitti)" : "") });
    } catch (e) { /* kayit yazilamadiysa senaryo/hata yine iletilir */ }
    kayit = { kredi, sonraki };
    return kayit;
  }
  durum.kaydet = kullanimKaydet;
  // Kullanicinin kaynak/arastirma metninin vidIQ'ya GERCEKTEN giden en kisa oneki (IDDIA raporu yalniz bunu "kaynak" sayar)
  let kaynakGorulen = kaynakTam.length;
  // vidIQ script araci dil parametresi ALMAZ (sema: topic, title, concept, research, lengthMinutes, tone). Dil brief'e (concept)
  // girer; ek olarak ingilizce olmayan dillerde konu satirinin sonuna da yazilir ki model dili atlamasin.
  const dilEki = hedef.dil === "en" ? "" : " (Write the script in " + hedef.dilAdi + ".)";
  // Tek vidIQ cagrisi: ham metni dondurur. onceki: "daha once islendi" listesi (kisa); kaynak metni research'e tam girer.
  async function birCagri(dk, brief, onceki) {
    const govde = (kisaltma) => {
      const a = S.vidiqArastirmaKur(onceki, kaynakTam, kisaltma ? KISALTMA_KAP : ARASTIRMA_KAP);
      if (kaynakTam) kaynakGorulen = Math.min(kaynakGorulen, a.kaynakGonderilen);
      return {
        topic: kirp(konuNotu, 500 - dilEki.length) + dilEki,
        title: kirp(baslik, 300),
        concept: kirp(brief, kisaltma ? KISALTMA_KAP : CONCEPT_KAP),
        research: a.metin || kirp(konuNotu, kisaltma ? KISALTMA_KAP : ARASTIRMA_KAP),
        lengthMinutes: sinirla(dk, 1, 60),
        tone: ton,
      };
    };
    let g;
    const ISKIMLIK = ["mcpJobId", "jobId"];
    try { g = await vidiq.cagir("vidiq_generate_script", govde(false), ISKIMLIK); }
    catch (e) {
      // alan uzunlugu yuzunden reddedildiyse (kredi harcanmadan) bir kez kisaltilmis alanlarla dene
      if (e.kod === "vidiq_ag" && /validation|too long|maxLength|max(imum)? length/i.test(e.message)) g = await vidiq.cagir("vidiq_generate_script", govde(true), ISKIMLIK);
      else throw e;
    }
    // Cagri KABUL edildi (is kimligi ya da dogrudan metin dondu): kredi bu noktada dusuldu (hata olursa vidIQ iade eder,
    // iadeyi bakiye farki yakalar). Kabul edilmeyen cagri (dogrulama/ag hatasi) sayilmaz.
    cagriSayisi++;
    harcananDakika += dk;
    const isId = g && typeof g === "object" && (g.mcpJobId || g.jobId);
    if (!isId) return scriptMetni(g);
    const sonuc = await vidiq.isBekle(isId, { maksSn: 360, aralikSn: secenek.aralikSn || 4,
      onIlerleme: x => { if (x.gecenSn % 20 === 0) log("  … üretiliyor (" + x.gecenSn + " sn)"); ortak.ilerleme("vidiq", null, { gecenSn: x.gecenSn }); } });
    return scriptMetni(sonuc);
  }

  // parcalar: [{ad, paragraflar:[metin]}]
  let parcalar = [];
  const toplam = () => parcalar.reduce((a, p) => a + p.paragraflar.reduce((x, m) => x + S.kelimeSay(m), 0), 0);
  const kismiKaydet = neden => {
    const metin = parcalar.flatMap(p => p.paragraflar).join("\n\n");
    if (S.kelimeSay(metin) < 30) return;
    const dosya = S.senaryoYaz(is, metin, "-yarim");
    console.error("  ↳ Yazılan kısım (" + S.kelimeSay(metin) + " kelime) " + path.basename(dosya) + " olarak kaydedildi: " + neden);
  };
  // Bir ham yaniti temizleyip parca olarak ekler. indeks: parcalar icindeki yer
  function parcaCoz(ham, k, M) {
    const t = S.paragraflariTemizle(ham);
    const rap = S.temizlikRaporu(t.silinen); if (rap) log("temizlik (parça " + k + "): " + rap);
    // selam / abone ol / veda cumleleri atilir; neyin atildigi LOGA yazilir (sessiz icerik kaybi olmasin)
    const atilan = [];
    const duz = S.parcaGirisKapanisTemizle(t.paragraflar.map(p => p.metin), k === 1, k === M, atilan).map(x => x.metin);
    const rap2 = S.temizlikRaporu(atilan, "cümle"); if (rap2) log("temizlik (parça " + k + ", selam/kapanış): " + rap2);
    return duz;
  }

  try {
    for (let k = 1; k <= plan.M; k++) {
      K.maliyetKontrol(is, konu, 0);
      const yazilan = toplam();
      const kalanKelime = Math.max(100, Math.round((hedef.hedefKelime - yazilan) / (plan.M - k + 1)));
      const dk = hedef.kisa ? kisaDakika : dakikaIste(kalanKelime, hedef.kelimeHizi);
      const brief = parcaBriefi(baglam, k, plan.M, kalanKelime, konu.aciklamaBrief);
      const onceki = parcalar.length
        ? "Already covered in earlier parts, DO NOT REPEAT any of it:\n" +
          parcalar.map((p, i) => (i + 1) + ". " + (p.paragraflar[0] || "").slice(0, 160)).join("\n") +
          "\nEnd of the previous part: " + parcalar[parcalar.length - 1].paragraflar.slice(-2).join(" ").slice(-500)
        : "";
      ortak.ilerleme("vidiq", 10 + 70 * (k - 1) / plan.M, { parca: k, toplam: plan.M });
      const ham = await birCagri(dk, brief, onceki);
      const paragraflar = parcaCoz(ham, k, plan.M);
      if (!paragraflar.length) { ortak.uyari("vidIQ " + k + ". parça için kullanılabilir metin döndürmedi."); break; }
      parcalar.push({ ad: S.ilkKelimeler(paragraflar[0], 6), paragraflar });
      log("  parça " + k + "/" + plan.M + ": +" + paragraflar.reduce((a, m) => a + S.kelimeSay(m), 0) + " kelime → toplam " + toplam() + "/" + hedef.hedefKelime);
      if (hedef.kisa) break;
    }

    // ---- esik altinda "devam et" parcasi (kapanisin ONUNE girer) ----
    for (let tur = 0; !hedef.kisa && parcalar.length && tur < DEVAM_PARCASI && toplam() < hedef.hedefKelime * ESIK; tur++) {
      K.maliyetKontrol(is, konu, 0);
      const eksik = hedef.hedefKelime - toplam();
      ortak.uyari("Senaryo " + toplam() + " kelime, hedef " + hedef.hedefKelime + ": " + eksik + " kelimelik devam parçası isteniyor.");
      const dk = dakikaIste(eksik, hedef.kelimeHizi);
      const brief = P.vidiqBrief(baglam, "This is an EXTRA middle part of the same video. Go deeper with new facts, examples and mechanisms that are NOT covered yet. " +
        "NO greeting, NO recap, do NOT conclude and do not say goodbye. About " + eksik + " words." + (konu.aciklamaBrief ? " " + konu.aciklamaBrief : ""));
      const onceki = "Already covered, DO NOT REPEAT any of it:\n" + parcalar.map((p, i) => (i + 1) + ". " + (p.paragraflar[0] || "").slice(0, 160)).join("\n");
      const ham = await birCagri(dk, brief, onceki);
      const paragraflar = parcaCoz(ham, 2, 3);        // ortada: selam ve kapanis ayiklanir
      if (!paragraflar.length) break;
      if (parcalar.length === 1) {
        // tek parca: acilis kancasi ve kapanis ayni parcada, ek metin kapanis paragrafinin onune girer
        const ps = parcalar[0].paragraflar;
        ps.splice(Math.max(1, ps.length - 1), 0, ...paragraflar);
      } else {
        parcalar.splice(parcalar.length - 1, 0, { ad: S.ilkKelimeler(paragraflar[0], 6), paragraflar });
      }
      log("  devam parçası: +" + paragraflar.reduce((a, m) => a + S.kelimeSay(m), 0) + " kelime");
    }
  } catch (e) {
    if (parcalar.length) { try { kismiKaydet("işlem " + (e && e.kod ? e.kod : "hata") + " ile yarıda kaldı"); } catch (e2) { /* asil hata onemli */ } }
    throw e;
  }

  if (!parcalar.length || toplam() < 20) throw new OrtakHata("vidiq_bos", "vidIQ boş senaryo döndürdü.",
    { cikis: CIKIS.YETERSIZ, cozum: "Tekrar dene ya da senaryoyu Claude anahtarıyla yaz." });

  // ---- birlestirme: tekrar ayikla, sinirla ----
  const duz = [];
  parcalar.forEach((p, pi) => p.paragraflar.forEach(m => duz.push({ pi, m })));
  const at = S.tekrarIndeksleri(duz.map(x => x.m), 0.6);
  if (at.size) log("tekrar : " + at.size + " benzer paragraf ayıklandı");
  let kalan = duz.filter((x, i) => !at.has(i));
  if (!hedef.kisa) {
    const kes = S.govdeKirpIndeksleri(kalan.map(x => x.m), hedef.hedefKelime, 1.15);
    if (kes.size) { ortak.uyari("Senaryo hedefin %15'inden fazla uzundu: " + kes.size + " paragraf gövdeden çıkarıldı."); kalan = kalan.filter((x, i) => !kes.has(i)); }
  }
  let metin = kalan.map(x => x.m).join("\n\n");
  let paragraflar = kalan.map(x => x.m);
  let parcaIndisleri = kalan.map(x => x.pi);
  if (hedef.kisa) {
    const once = S.kelimeSay(metin);
    metin = S.shortsKirp(metin, hedef.hedefKelime);
    if (S.kelimeSay(metin) < once) log("kırpma  : " + once + " → " + S.kelimeSay(metin) + " kelime (sınır " + hedef.hedefKelime + ")");
    paragraflar = ortak.paragraflaraBol(metin);
    parcaIndisleri = null;                               // kisa videoda bolum listesi yok
  }
  const kelime = S.kelimeSay(metin);
  const sn = S.sureTahmin(kelime, hedef.kelimeHizi);

  if (!hedef.kisa && kelime < hedef.hedefKelime * ESIK) {
    const dosya = S.senaryoYaz(is, metin, "-yarim");
    throw new OrtakHata("senaryo_kisa",
      "Senaryo " + kelime + " kelimede kaldı (~" + S.sureMetni(sn) + "), hedef " + S.sureMetni(Math.round(hedef.hedefSn)) +
      " (" + hedef.hedefKelime + " kelime). Metin " + path.basename(dosya) + " olarak kaydedildi.",
      { cikis: CIKIS.YETERSIZ,
        cozum: "Konuyu ve kaynak metnini ayrıntılandır ya da kaydedilen -yarim metnini panelde düzenleyip senaryo olarak kaydet.",
        detay: { kelime, hedefKelime: hedef.hedefKelime } });
  }
  if (!hedef.kisa && kelime > hedef.hedefKelime * 1.15)
    ortak.uyari("Senaryo hedefin %15 üstünde (" + kelime + "/" + hedef.hedefKelime + " kelime): video ~" + S.sureMetni(sn) + " sürecek.");
  // vidIQ'nun script araci dil parametresi ALMAZ (brief'e uymayabilir). Yanlis dilde metin seslendirmeye gidince yabanci
  // dilde okunur (ucretli ses+video bosa gider), bu yuzden Claude yolundaki gibi yalniz uyarmak yetmez: ana dosyaya
  // YAZILMAZ, "-dil-uyumsuz" olarak saklanir (kredi bosa gitmez), cikis 4.
  const dilU = S.dilUyarisi(metin, hedef.dil);
  if (dilU) {
    const dosya = S.senaryoYaz(is, metin, "-dil-uyumsuz");
    throw new OrtakHata("senaryo_dil",
      "vidIQ senaryoyu istenen dilde (" + hedef.dilAdi + ") yazmadı: " + dilU + " Metin " + path.basename(dosya) + " olarak kaydedildi.",
      { cikis: CIKIS.YETERSIZ,
        cozum: "Senaryoyu Claude anahtarıyla yaz (her dilde yazar), ya da kaydedilen metni kendin çevirip Senaryo kutusuna yapıştır.",
        detay: { dil: hedef.dil, kelime } });
  }
  if (hedef.kisa && kelime < hedef.hedefKelime * 0.5)
    ortak.uyari("Senaryo hedefin yarısından kısa (" + kelime + "/" + hedef.hedefKelime + " kelime): video planlanandan kısa çıkacak.");
  // kaynak metni vidIQ alanina sigmadiysa: gorulmeyen kisim IDDIA raporunda "kaynakta geciyor" diye guven vermesin
  const kaynakKirpildi = kaynakTam.length > kaynakGorulen ? { toplam: kaynakTam.length, gorulen: kaynakGorulen } : null;
  if (kaynakKirpildi)
    ortak.uyari("Kaynak metni " + kaynakKirpildi.toplam + " karakter; vidIQ'ya yalnızca ilk " + kaynakKirpildi.gorulen +
      " karakteri sığdı. İddia raporu \"kaynakta geçiyor\" kontrolünü yalnız o kısma göre yapar.");

  // ---- dosyalar: yan dosyalar once, metin EN SON ----
  fs.mkdirSync(S.sesDizini(is), { recursive: true });
  const yedek = S.senaryoYedekle(is);
  const uretilmeyen = ["gorsel-aramalari.json", "aciklama-ozet.txt"];      // vidIQ yolu bunlari uretmez; eskisi yaniltir
  let bolumSayisi = 0;
  if (parcaIndisleri) {
    // bolum = parca; adi parcanin ilk 6 kelimesi. Paragraf sirasi birlestirmeden sonraki KANONIK sira.
    const bolumler = [];
    parcaIndisleri.forEach((pi, i) => {
      const son = bolumler[bolumler.length - 1];
      if (son && son.pi === pi) son.paragrafSon = i;
      else bolumler.push({ pi, ad: parcalar[pi].ad || ("Parça " + (pi + 1)), paragrafBas: i, paragrafSon: i });
    });
    if (bolumler.length >= 2) {
      S.bolumlerYaz(is, bolumler.map(b => ({ ad: b.ad, paragrafBas: b.paragrafBas, paragrafSon: b.paragrafSon })));
      bolumSayisi = bolumler.length;
    } else uretilmeyen.push("bolumler.json");
  } else uretilmeyen.push("bolumler.json");
  const tasinan = S.bayatYanDosyalariKaldir(is, uretilmeyen);
  S.senaryoYaz(is, metin);
  try { fs.unlinkSync(path.join(S.sesDizini(is), "SESLENDIRME-TAM-METIN-yarim.txt")); } catch (e) { /* yoktu */ }

  // ---- iddia listesi (yerel desen: vidIQ yolunda model ikinci gecisi yok) ----
  const iddia = I.rapor("yerel", "", I.yerelIddialar(paragraflar), kaynakTam.slice(0, kaynakGorulen), kaynakKirpildi);
  I.raporYaz(is, iddia);

  // ---- kullanim kaydi (hata yollarinda yaz() sarmalayicisi ayni kaydi yazar) ----
  const { kredi, sonraki } = await kullanimKaydet("");

  log("");
  log("✓ senaryo yazıldı: Voice/SESLENDIRME-TAM-METIN.txt");
  log("  " + kelime + " kelime · ~" + S.sureMetni(sn) + " · " + paragraflar.length + " paragraf");
  log("  vidIQ kredisi: ~" + kredi + (sonraki !== null ? " (kalan " + sonraki + ")" : ""));
  if (yedek) log("  önceki metin yedeklendi: Voice/yedek/" + path.basename(yedek));
  if (tasinan.length) log("  eski yan dosyalar yedek klasörüne taşındı: " + tasinan.join(", "));
  log("  iddia listesi: IDDIA-RAPORU.md — " + iddia.ozet.toplam + " iddia (yerel desen; doğrulama DEĞİLDİR)");
  if (sn > hedef.hedefSn * 1.15) ortak.uyari("Süre hedefi (" + hedef.hedefSn + " sn) %15 aşıyor.");
  const sonuc = { kelime, paragraf: paragraflar.length, tahminiSn: sn, hedefSn: hedef.hedefSn, hedefKelime: hedef.hedefKelime,
    kelimeHizi: hedef.kelimeHizi, dil: hedef.dil, kredi, bolum: bolumSayisi, yedek: yedek ? path.basename(yedek) : null,
    iddia: iddia.ozet };
  ortak.sonuc(sonuc);
  return sonuc;
}

module.exports = { ana, scriptMetni, parcaPlani, parcaBriefi, dakikaIste, VIDIQ_KATSAYI };

if (require.main === module) ana(process.argv.slice(2)).catch(ortak.bitir);
