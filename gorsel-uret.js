// GORSEL URETECI — ucretsiz AI modelleriyle sahne gorseli uretir.
//
// Stok fotograf bulunamayan ya da anlamsiz kalan soyut sahneler icin.
// "kuantum dolanikligi", "sinir agi", "hicligin icinden cikan madde" gibi
// kavramlarin stok fotografi yoktur; bunlar uretilir. Gercek seyler
// (bir hayvan, bir bilim insani, bir bina) stok fotograftan gelmeli —
// uretilmis gorsel orada yalan soyler.
//
// Kullanim:
//   node gorsel-uret.js <is>                 # "uret:" ile isaretli sahneler
//   node gorsel-uret.js <is> --hepsi         # tum sahneler
//   node gorsel-uret.js --istem "..." --cikti out.jpg
//
// konu.json'da bir sahneyi uretime isaretlemek:
//   "sahneKelimeleri": [
//     ["polar bear arctic"],                        <- stok fotograf
//     ["uret: a lattice of light, dark background"] <- AI uretimi
//   ]
// Sahne basina adet: konu.json > uretAdet (varsayilan 2, en cok 6). Her gorselin istemi acisi/plani degistirilerek
// cesitlendirilir (yalniz tohum degisince kompozisyonlar birbirine cok benziyordu).
//
// Servisler (sirayla denenir, ilk calisan kullanilir):
//   1. Pollinations     — anahtar GEREKMEZ, varsayilan
//   2. Cloudflare       — CF_ACCOUNT_ID + CF_API_TOKEN  (ucretsiz kademe)
//   3. Together         — TOGETHER_KEY                  (ucretsiz kademe)
//   4. Hugging Face     — HF_TOKEN                      (ucretsiz)
//
// Dayaniklilik: istek basina 45 sn bosta / 60 sn toplam zaman asimi; 5xx, 429 ve ag kopmasinda yeniden deneme;
// ust uste 3 hata veren servis o calisma icin KAPATILIR (her gorselde 2 dakika beklenmez); hatanin nedeni
// ("Pollinations olmadi: HTTP 502") gorunur yazilir. Uretilen gorseller Visuals/manifest.json'a "uretim" kaynagiyla
// islenir (YouTube'un sentetik icerik beyani icin).
// Ilerleme @@ILERLEME satirlariyla verilir (sahne n/toplam); satir sonu olmadan '+'/'x' basilmaz. Isaretli her sahne zaten
// uretilmisse @@SONUC atlandi:true (idempotans).
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./lib/ortak.js");
const ag = require("./lib/gorsel-ag.js");
const { dogrula } = require("./lib/gorsel-dogrula.js");
const { lisansCoz } = require("./lib/gorsel-lisans.js");

const OrtakHata = ortak.OrtakHata;
const env = ad => ortak.envOku(ad);
const bekle = ms => new Promise(r => setTimeout(r, ms));

const BOSTA_ASIMI_MS = 45000;        // bagimsiz soket zaman asimi
const TOPLAM_ASIMI_MS = 60000;       // bir istegin toplam suresi (eskiden 120 sn, her gorselde 2 dk bekletiyordu)
const DEVRE_ESIGI = 3;               // ust uste bu kadar hata -> servis bu calismada kapanir

// Ag istemcisi: yeniden deneme (5xx/429/kopma) var, zaman asiminda tekrar YOK (yavas servisi 3 kez beklemeyelim)
function varsayilanGetir() {
  return ag.istemciYap({
    zamanAsimiMs: BOSTA_ASIMI_MS, toplamAsimiMs: TOPLAM_ASIMI_MS, denemeSayisi: 3, hataGovdesi: true,
    zamanAsimiTekrarYok: true, maksBayt: ag.MAKS_GORSEL_BAYT, limitBekleSn: 20,
    basliklar: { "User-Agent": "Mozilla/5.0" },
  });
}

// Gelen govde gercekten gorsel mi? (sihirli bayt + boyut). Dondurur: Buffer ya da firlatir.
function gorselKontrol(b, ipucu) {
  const v = dogrula(b, { minUzunKenar: 512 });
  if (!v.tamam) throw new Error((ipucu || "geçersiz görsel") + ": " + v.neden);
  return b;
}

// ---------------------------------------------------------------------------
// SERVISLER
// Her biri {ad, hazir(), uret(istem, en, boy, tohum, {getir})} -> Buffer
// ---------------------------------------------------------------------------
const SERVISLER = [
  {
    ad: "Pollinations",
    anahtarGerekli: false,
    hazir: () => true,
    async uret(istem, en, boy, tohum, c) {
      const u = "https://image.pollinations.ai/prompt/" + encodeURIComponent(istem) +
                `?width=${en}&height=${boy}&nologo=true&seed=${tohum}`;
      const r = await c.getir(u);
      return gorselKontrol(r.govde, "Pollinations görsel döndürmedi");
    },
  },
  {
    ad: "Cloudflare",
    anahtarGerekli: true,
    hazir: () => !!(env("CF_ACCOUNT_ID") && env("CF_API_TOKEN")),
    async uret(istem, en, boy, tohum, c) {
      const hesap = env("CF_ACCOUNT_ID"), jeton = env("CF_API_TOKEN");
      const u = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(hesap)}` +
                `/ai/run/@cf/black-forest-labs/flux-1-schnell`;
      const r = await c.getir(u, { basliklar: { Authorization: "Bearer " + jeton, "Content-Type": "application/json" },
        gonder: JSON.stringify({ prompt: istem, width: en, height: boy }) });
      // Cloudflare base64 JSON donduruyor
      try {
        const j = JSON.parse(r.govde.toString("utf8"));
        const b64 = j.result && (j.result.image || (j.result.images && j.result.images[0]));
        if (b64) return gorselKontrol(Buffer.from(b64, "base64"), "Cloudflare bozuk görsel");
      } catch (e) { if (/geçersiz|bozuk/.test(String(e.message))) throw e; }
      return gorselKontrol(r.govde, "Cloudflare görsel döndürmedi");
    },
  },
  {
    ad: "Together",
    anahtarGerekli: true,
    hazir: () => !!env("TOGETHER_KEY"),
    async uret(istem, en, boy, tohum, c) {
      const r = await c.getir("https://api.together.xyz/v1/images/generations",
        { basliklar: { Authorization: "Bearer " + env("TOGETHER_KEY"), "Content-Type": "application/json" },
          gonder: JSON.stringify({ model: "black-forest-labs/FLUX.1-schnell-Free", prompt: istem, width: en, height: boy, n: 1, response_format: "b64_json" }) });
      const j = JSON.parse(r.govde.toString("utf8"));
      const b64 = j.data && j.data[0] && j.data[0].b64_json;
      if (!b64) throw new Error("Together görsel döndürmedi");
      return gorselKontrol(Buffer.from(b64, "base64"), "Together bozuk görsel");
    },
  },
  {
    ad: "HuggingFace",
    anahtarGerekli: true,
    hazir: () => !!env("HF_TOKEN"),
    async uret(istem, en, boy, tohum, c) {
      const r = await c.getir("https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell",
        { basliklar: { Authorization: "Bearer " + env("HF_TOKEN"), "Content-Type": "application/json" },
          gonder: JSON.stringify({ inputs: istem }) });
      return gorselKontrol(r.govde, "HuggingFace görsel döndürmedi (model yükleniyor olabilir)");
    },
  },
];

// ---------------------------------------------------------------------------
// Devre kesici: servis basina ust uste hata sayaci (surec boyunca)
// ---------------------------------------------------------------------------
const servisDurum = new Map();
const durumDe = ad => { if (!servisDurum.has(ad)) servisDurum.set(ad, { ardisik: 0, kapali: null }); return servisDurum.get(ad); };
const sifirla = () => servisDurum.clear();

function hataOzetle(e) {
  let m = ag.hataOzeti(e);
  if (e && e.govde) m += " — " + String(e.govde).replace(/\s+/g, " ").trim().slice(0, 80);
  else if (e && e.message && typeof e.kod !== "number" && !/^zaman|^HTTP/.test(m)) m = String(e.message).split("\n")[0].slice(0, 100);
  return m;
}
const gecici = e => !!e && (e.kod === 429 || /yükleniyor|loading|busy|rate|limit|görsel döndürmedi/i.test(String(e.message)));

// ---------------------------------------------------------------------------
// TEK GORSEL URET — servisleri sirayla dener; her biri icin: yeniden deneme, zaman asimi, devre kesici
//   secenek: {getir, servisler, log}
// ---------------------------------------------------------------------------
async function uretBir(istem, en, boy, tohum, sessiz, secenek) {
  const o = secenek || {};
  const log = o.log || (m => console.log(m));
  const getir = o.getir || varsayilanGetir();
  const acik = (o.servisler || SERVISLER).filter(s => s.hazir());
  const kullanilabilir = acik.filter(s => !durumDe(s.ad).kapali);
  if (!kullanilabilir.length) {
    throw new Error(acik.length
      ? "Tüm görsel üretim servisleri bu çalışmada kapandı: " + acik.map(s => s.ad + " (" + durumDe(s.ad).kapali + ")").join(", ")
      : "Hiçbir görsel üretim servisi açık değil.");
  }
  let sonHata = null, sonServis = "";
  for (const s of kullanilabilir) {
    const d = durumDe(s.ad);
    let ozet = "";
    for (let deneme = 0; deneme < 2; deneme++) {
      try {
        const b = await s.uret(istem, en, boy, tohum, { getir });
        d.ardisik = 0;
        return { govde: b, servis: s.ad };
      } catch (e) {
        sonHata = e; sonServis = s.ad; ozet = hataOzetle(e);
        if (deneme === 0 && gecici(e)) { await bekle(o.bekleMs !== undefined ? o.bekleMs : 2500); continue; }
        break;
      }
    }
    d.ardisik++;
    if (!sessiz) log("  (" + s.ad + " olmadı: " + ozet.slice(0, 100) + ")");
    if (d.ardisik >= DEVRE_ESIGI) {
      d.kapali = ozet || "hata";
      log("  ! " + s.ad + " bu çalışmada kapatıldı (" + DEVRE_ESIGI + " ardışık hata: " + (ozet || "bilinmiyor").slice(0, 80) + ")");
    }
  }
  const h = new Error(sonServis + ": " + hataOzetle(sonHata));
  h.kod = sonHata && sonHata.kod;
  throw h;
}

// Sahne kelimesinden tam istem kurar. Stil konu.json > uretStil ile verilir.
function istemKur(metin, stil) {
  const temiz = String(metin).replace(/^uret:\s*/i, "").trim();
  const varsayilanStil =
    "cinematic, dramatic lighting, high detail, photographic, 35mm, shallow depth of field";
  return temiz + ", " + (stil || varsayilanStil);
}

// Ayni sahnedeki k. gorsel icin aci/plan degistirir (k=0: istem aynen). Yalniz tohum degisince kareler cok benziyordu.
const PLANLAR = ["wide establishing shot", "close-up detail", "low angle, dramatic perspective", "aerial top-down view",
  "medium shot, rule of thirds, soft backlight", "macro view, extreme detail"];
function istemCesitle(istem, k) {
  if (!k) return istem;
  return istem + ", " + PLANLAR[(k - 1) % PLANLAR.length];
}

// ---------------------------------------------------------------------------
module.exports = { uretBir, istemKur, istemCesitle, SERVISLER, sifirla, durumDe, varsayilanGetir };

// ---------------------------------------------------------------------------
// IS MODU: konu.json > sahneKelimeleri
// ---------------------------------------------------------------------------
async function isModu(IS, hepsi, bag) {
  const log = (bag && bag.log) || (m => console.log(m));
  const man = require("./lib/gorsel-manifest.js");
  const P = man.yollar(IS);
  if (!fs.existsSync(P.BASE)) throw new OrtakHata("is_yok", "İş bulunamadı: " + IS, { cikis: ortak.CIKIS.GIRDI });
  const konu = ortak.konuEtkin(IS);                            // bozuksa OrtakHata (exit 2)
  if (!konu) throw new OrtakHata("konu_yok", "konu.json yok: " + IS, { cikis: ortak.CIKIS.GIRDI, cozum: "Önce işi panelden oluştur." });
  const kelimeler = Array.isArray(konu.sahneKelimeleri) ? konu.sahneKelimeleri : [];
  if (!kelimeler.length)
    throw new OrtakHata("sahne_kelimesi_yok", "konu.json'da sahneKelimeleri yok.", { cikis: ortak.CIKIS.GIRDI,
      cozum: 'Örnek: "sahneKelimeleri": [["polar bear"], ["uret: a lattice of light, dark background"]]' });

  ortak.kilitAl(IS, "gorsel-uret");
  ortak.diskKontrol(P.BASE, 1);
  const dikey = !!konu.dikey;
  const EN = dikey ? 768 : 1280, BOY = dikey ? 1344 : 720;
  const basina = Math.max(1, Math.min(6, Number(konu.uretAdet) || 2));
  const dil = String(konu.dil || "en").toLowerCase();

  // sahne <-> paragraf eslemesi (manifest) icin plan; senaryo yoksa yalnizca dosya yazilir
  const sen = man.senaryoOku(IS);
  let M = null;
  if (sen.paragraflar.length) {
    const pl = man.planYukle({ is: IS, kanonik: sen.paragraflar, ozet: sen.ozet, dil, yon: dikey ? "dikey" : "yatay", kisa: dikey, adopt: true, log, uyari: ortak.uyari });
    M = pl.manifest; M.dil = dil; M.hedefYon = dikey ? "dikey" : "yatay";
  } else {
    ortak.uyari("Senaryo yok: görseller üretilir ama manifest.json'a işlenemez (paragraf eşlemesi için senaryo gerekli).");
    fs.mkdirSync(P.VIS, { recursive: true });
  }

  let uretilen = 0, atlanan = 0, basarisiz = 0;
  const lis = lisansCoz("uretim");
  const isaretliSahneler = [];
  for (let i = 0; i < kelimeler.length; i++) {
    const k = kelimeler[i];
    const ilk = Array.isArray(k) ? String(k[0] || "") : String(k);
    if (/^uret:/i.test(ilk) || hepsi) isaretliSahneler.push(i);
  }
  if (!isaretliSahneler.length) {
    atlanan = kelimeler.length;
    console.log("Üretilecek sahne yok: sahneKelimeleri içinde \"uret:\" işaretli sahne bulunmuyor.");
    console.log("  Tüm sahneleri üretmek için: node gorsel-uret.js " + IS + " --hepsi");
    ortak.sonuc({ atlandi: true, neden: "uret: işaretli sahne yok" });
    return;
  }

  let sira = 0;
  for (const i of isaretliSahneler) {
    const k = kelimeler[i];
    const ilk = Array.isArray(k) ? String(k[0] || "") : String(k);
    const no = i + 1;
    sira++;
    ortak.ilerleme("gorsel-uret", (sira - 1) / isaretliSahneler.length * 100, { n: sira, toplam: isaretliSahneler.length });

    let S = null;
    if (M) {
      S = man.sahneBulAdla(M, String(no).padStart(3, "0") + "-uretilen");
      man.klasorAta(P, S, "uretilen");
    }
    const klasorYol = M ? path.join(P.VIS, S.klasor) : path.join(P.VIS, String(no).padStart(3, "0") + "-uretilen");
    fs.mkdirSync(klasorYol, { recursive: true });
    const var_ = M ? S.gorseller.filter(g => g.kaynak === "uretim").length : man.resimDosyalari(klasorYol).length;
    const gerek = basina - var_;
    const etiket = (M ? S.klasor : path.basename(klasorYol)).padEnd(26);
    if (gerek <= 0) { atlanan++; console.log("  " + etiket + " · zaten " + var_ + " üretilmiş görsel var"); continue; }

    const temel = istemKur(ilk, konu.uretStil);
    let bu = 0;
    for (let n = 0; n < gerek; n++) {
      // ilerleme @@ILERLEME ile (satir sonsuz '+'/'x' basilmaz): sahne sahne + sahne icinde gorsel gorsel
      ortak.ilerleme("gorsel-uret", ((sira - 1) + n / gerek) / isaretliSahneler.length * 100, { n: sira, toplam: isaretliSahneler.length });
      const istem = istemCesitle(temel, var_ + n);
      try {
        const { govde } = await uretBir(istem, EN, BOY, no * 100 + var_ + n + 1, true, { log: m => console.log(m), getir: bag && bag.getir });
        const v = dogrula(govde, { minUzunKenar: 512 });
        if (!v.tamam) throw new Error(v.neden);
        if (M) man.gorselYaz(P, S, govde, v, Object.assign({ kaynak: "uretim", baslik: ilk.replace(/^uret:\s*/i, "").slice(0, 120), istem, atif: "", kaynakUrl: "", indirmeUrl: "" }, lis));
        else ortak.atomikYaz(path.join(klasorYol, String(man.sonrakiNo(klasorYol)).padStart(2, "0") + v.uzanti), govde);
        uretilen++; bu++;
      } catch (e) {
        console.log("    ! " + String(e.message).slice(0, 140));
      }
      await bekle(400);                                        // servise nazik davran
    }
    console.log("  " + etiket + " " + temel.slice(0, 48) + "… → " + bu + "/" + gerek + " görsel");
    if (!bu) basarisiz++;
    if (M) { S.aramalar = Array.isArray(k) ? k.map(String) : [String(k)]; S.durum = man.durumHesapla(S, basina); man.manifestYaz(IS, M); }
  }
  ortak.ilerleme("gorsel-uret", 100, { n: isaretliSahneler.length, toplam: isaretliSahneler.length });
  if (M) { man.manifestYaz(IS, M); man.atifYaz(IS, M); }

  console.log("");
  console.log(`✓ ${uretilen} görsel üretildi` + (atlanan ? `, ${atlanan} sahne zaten tamamdı` : "") + (M ? " · manifest.json güncellendi" : ""));
  if (!hepsi && kelimeler.length > isaretliSahneler.length)
    console.log("  Tüm sahneleri üretmek için: node gorsel-uret.js " + IS + " --hepsi");
  if (uretilen) ortak.uyari("Yapay zekâ görseli kullanıldı: YouTube Studio'da 'değiştirilmiş/sentetik içerik' beyanını kontrol et.");
  if (basarisiz)
    throw new OrtakHata("uretim_basarisiz", basarisiz + " sahne için hiç görsel üretilemedi.", { cikis: ortak.CIKIS.YETERSIZ,
      cozum: 'Yukarıdaki servis hatalarına bak; bir süre sonra tekrar dene ya da konu.json\'dan "uret:" işaretini kaldırıp stok aramaya bırak.' });
  const sonuc = { uretilen, atlanan };
  // hicbir sey uretilmedi ve isaretli her sahne zaten uretilmisti -> PA adimi "atlandi" isaretler (idempotans)
  if (!uretilen && atlanan === isaretliSahneler.length) { sonuc.atlandi = true; sonuc.neden = "görseller zaten üretilmiş"; }
  ortak.sonuc(sonuc);
}
module.exports.isModu = isModu;

if (require.main === module) (async () => {
  const { konum, bayrak } = ortak.argumanCoz(process.argv.slice(2), { deger: ["istem", "cikti", "en", "boy", "stil"] });

  const acik = SERVISLER.filter(s => s.hazir());
  console.log("Açık servisler: " + acik.map(s => s.ad).join(", "));

  // --- tek istem modu ---
  if (bayrak.istem !== undefined) {
    if (bayrak.istem === true || !String(bayrak.istem).trim()) throw new OrtakHata("arguman", "--istem için bir metin ver.", { cikis: ortak.CIKIS.GIRDI });
    const cikti = bayrak.cikti && bayrak.cikti !== true ? String(bayrak.cikti) : "uretilen.jpg";
    const en = Number(bayrak.en || 1280), boy = Number(bayrak.boy || 720);
    if (!(en >= 64 && en <= 2048 && boy >= 64 && boy <= 2048)) throw new OrtakHata("arguman", "--en ve --boy 64 ile 2048 arasında olmalı.", { cikis: ortak.CIKIS.GIRDI });
    const { govde, servis } = await uretBir(istemKur(bayrak.istem, bayrak.stil && bayrak.stil !== true ? bayrak.stil : undefined), en, boy, 1, false);
    ortak.atomikYaz(cikti, govde);
    console.log(`✓ ${cikti}  (${servis}, ${(govde.length / 1024) | 0} KB)`);
    return;
  }

  // --- is modu ---
  const IS = konum[0];
  if (!IS) {
    console.error("✗ Kullanım: node gorsel-uret.js <iş-adı> [--hepsi]");
    console.error('           node gorsel-uret.js --istem "..." --cikti out.jpg');
    process.exit(ortak.CIKIS.GIRDI);
  }
  await isModu(IS, !!bayrak.hepsi);
})().catch(ortak.bitir);
