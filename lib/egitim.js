"use strict";
// EĞİTİM PDF'LERİ → kullanıcının masaüstü.
// Depodaki egitim/ klasöründeki PDF'ler, kullanıcının masaüstünde "Otopilot Eğitim" klasörüne kopyalanır.
//  - Var olan dosyanın ÜSTÜNE yazmaz (kullanıcı değiştirmiş ya da taşımış olabilir).
//  - Bir kez indirilince depo kökünde .egitim-indirildi işareti bırakır; panel kendiliğinden yeniden kopyalamaz
//    (kullanıcı PDF'leri bilerek sildiyse geri gelmesin). Elle: npm run egitim (eksik olanları kopyalar).
//  - Panel yalnız gerçek bir terminalde açıldıysa kendiliğinden dener; test, CI ve arka plan işlerinde masaüstüne dokunmaz.
//  - Hata vermez: masaüstü bulunamazsa ya da yazılamazsa sessizce atlar, panelin açılışını engellemez.
const fs = require("fs");
const os = require("os");
const path = require("path");

const KOK = path.join(__dirname, "..");
const KAYNAK_DIZIN = path.join(KOK, "egitim");
const ISARET = path.join(KOK, ".egitim-indirildi");
const KLASOR_ADI = "Otopilot Eğitim";

// depodaki ASCII dosya adı → masaüstünde görünecek ad
const DOSYALAR = [
  ["youtube-icerik-uretimi-seri1.pdf", "YouTube İçerik Üretimi - Seri 1.pdf"],
  ["instagram-buyume-yol-haritasi.pdf", "Instagram Büyüme Yol Haritası.pdf"],
  ["tiktok-algoritmasi-rehberi-ve-buyume-haritasi.pdf", "TikTok Algoritması Rehberi ve Büyüme Haritası.pdf"],
  ["tiktok-ai-influencer-rehberi.pdf", "TikTok AI Influencer Rehberi.pdf"],
];

function klasorMu(y) { try { return fs.statSync(y).isDirectory(); } catch (e) { return false; } }

/** Masaüstü klasörü: OTOMASYON_MASAUSTU (elle) > OneDrive'a yönlendirilmiş masaüstü > ~/Desktop > ~/Masaüstü. Yoksa null. */
function masaustuBul() {
  if (process.env.OTOMASYON_MASAUSTU) return klasorMu(process.env.OTOMASYON_MASAUSTU) ? process.env.OTOMASYON_MASAUSTU : null;
  const ev = os.homedir();
  const adaylar = [];
  if (process.env.OneDrive) adaylar.push(path.join(process.env.OneDrive, "Desktop"), path.join(process.env.OneDrive, "Masaüstü"));
  adaylar.push(path.join(ev, "Desktop"), path.join(ev, "Masaüstü"));
  return adaylar.find(klasorMu) || null;
}

/**
 * Eksik PDF'leri masaüstüne kopyalar. Dönüş: { klasor, kopyalanan[], mevcut[], eksik[] } ya da { atlandi: "neden" }.
 * Seçenekler (testler için): masaustu, kaynakDizin, isaret (null = işaret dosyası kullanma), otomatik (true = terminal/CI/işaret denetimi).
 */
function kopyala(o) {
  o = o || {};
  const kaynakDizin = o.kaynakDizin || KAYNAK_DIZIN;
  const isaret = o.isaret === undefined ? ISARET : o.isaret;
  if (o.otomatik) {
    if (process.env.CI || process.env.NODE_TEST_CONTEXT || !process.stdout.isTTY) return { atlandi: "otomatik kopyalama yalnız terminalde açılan panelde çalışır" };
    if (isaret && fs.existsSync(isaret)) return { atlandi: "eğitim PDF'leri daha önce indirilmiş" };
  }
  const masaustu = o.masaustu || masaustuBul();
  if (!masaustu) return { atlandi: "masaüstü klasörü bulunamadı" };
  const hedef = path.join(masaustu, KLASOR_ADI);
  fs.mkdirSync(hedef, { recursive: true });
  const kopyalanan = [], mevcut = [], eksik = [];
  for (const [ad, gorunen] of DOSYALAR) {
    const kaynak = path.join(kaynakDizin, ad);
    if (!fs.existsSync(kaynak)) { eksik.push(ad); continue; }
    const hedefDosya = path.join(hedef, gorunen);
    if (fs.existsSync(hedefDosya)) { mevcut.push(gorunen); continue; }
    const gecici = hedefDosya + ".part";
    fs.copyFileSync(kaynak, gecici);
    fs.renameSync(gecici, hedefDosya);
    kopyalanan.push(gorunen);
  }
  if (isaret && eksik.length === 0) { try { fs.writeFileSync(isaret, new Date().toISOString() + "\n"); } catch (e) { /* salt okunur klasör: sorun değil */ } }
  return { klasor: hedef, kopyalanan, mevcut, eksik };
}

/** Panel açılışında: hata vermeden, yalnız kopyalama olduysa tek satır yazar. */
function otomatik() {
  try {
    const s = kopyala({ otomatik: true });
    if (s.kopyalanan && s.kopyalanan.length) console.log("   Eğitim PDF'leri masaüstüne kopyalandı: " + s.klasor + "\n");
  } catch (e) { /* masaüstü yazılamıyor: panel yine açılır */ }
}

if (require.main === module) {
  try {
    const s = kopyala({});
    if (s.atlandi) console.log("Eğitim PDF'leri kopyalanmadı: " + s.atlandi + ".");
    else console.log("Eğitim PDF'leri: " + s.klasor + " (" + s.kopyalanan.length + " yeni, " + s.mevcut.length + " zaten vardı" + (s.eksik.length ? ", " + s.eksik.length + " dosya depoda yok" : "") + ")");
  } catch (e) {
    console.error("✗ Eğitim PDF'leri kopyalanamadı: " + e.message);
    process.exit(1);
  }
}

module.exports = { kopyala, otomatik, masaustuBul, KLASOR_ADI, DOSYALAR };
