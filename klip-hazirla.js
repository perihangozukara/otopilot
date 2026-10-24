// klip-hazirla.js <is> [--kaynak <klasor>] [--yeniden]
//
// KENDI VIDEO KLIPLERINLE video kurmak icin sahne klasorlerini hazirlar (animasyon, AI video, kendi cekimin).
// Stok gorsel ARANMAZ. Senaryodaki HER PARAGRAF bir sahnedir:
//
//   uretim/<is>/Visuals/001-<ilk-kelimeler>/   <- 1. paragrafin klibi (mp4/mov/webm/mkv/m4v) ya da gorseli buraya
//   uretim/<is>/Visuals/002-.../
//   uretim/<is>/Visuals/manifest.json          <- sahne -> paragraf eslemesi (klipModu: true)
//   uretim/<is>/SAHNE-LISTESI.md               <- hangi klasore hangi paragrafin klibi girecek (prompt yazmak icin)
//
// --kaynak <klasor>: klasordeki dosyalari ADINDAKI ILK SAYIYA gore sahnelere KOPYALAR (orijinallere dokunmaz):
//   "01.mp4", "1-orman.mp4", "sahne 3.mov" -> 1., 1., 3. sahne. Sayisi olmayan ya da sahne sayisini asan dosya atlanir (uyari).
// --yeniden: senaryo degistiyse manifesti yeni paragraflara gore yeniden yazar. Klasorlerdeki dosyalara DOKUNMAZ;
//   paragraf sayisi degistiyse klipleri kendin dogru klasore tasi.
//
// Sonra: seslendir.js <is> (ya da hazir ses) ve video-yap.js <is>. Sahne suresi = o paragrafin gercek ses suresi;
// klip uzunsa kesilir, kisaysa konu.json › klipUzat ("dondur" varsayilan | "dongu" | "yavaslat").
// Bu manifestle gorsel-bul.js stok gorsel aramaz (klipModu); stok gorsel istersen: gorsel-bul.js <is> --stok
//
// Cikis: 0 basari · 2 girdi (senaryo yok, kaynak klasor yok, baska aracin manifesti var)
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./lib/ortak.js");
const { sahneKlasorAdi } = require("./lib/gorsel-sorgu.js");
const { medyaMi, dogalSirala } = require("./lib/render-sahne.js");

const ilkKelimeler = p => String(p).split(/\s+/).filter(Boolean).slice(0, 4).join(" ");

function hazirla(o) {
  const is = o.is;
  const dizin = ortak.isDizin(is);
  if (!fs.existsSync(dizin)) throw new ortak.OrtakHata("is_yok", "İş bulunamadı: " + is, {
    cikis: ortak.CIKIS.GIRDI, cozum: "Önce işi aç: node yeni-is.js " + is + " --baslik \"...\"" });
  const senaryo = path.join(dizin, "Voice", "SESLENDIRME-TAM-METIN.txt");
  let metin = "";
  try { metin = fs.readFileSync(senaryo, "utf8"); } catch (e) { /* yok */ }
  const paragraflar = ortak.paragraflaraBol(metin);
  if (!paragraflar.length) throw new ortak.OrtakHata("senaryo_yok", "Senaryo boş: Voice/SESLENDIRME-TAM-METIN.txt", {
    cikis: ortak.CIKIS.GIRDI, cozum: "Önce senaryoyu yaz (paragraflar boş satırla ayrılır; her paragraf bir sahne olur)." });
  const ozet = ortak.paragrafOzeti(paragraflar);
  const vis = path.join(dizin, "Visuals");
  fs.mkdirSync(vis, { recursive: true });
  const mYol = path.join(vis, "manifest.json");

  let eski = null;
  try { eski = ortak.jsonOku(mYol, null); } catch (e) { eski = null; }
  if (eski && !eski.klipModu && Array.isArray(eski.sahneler) && eski.sahneler.some(s => Array.isArray(s.gorseller) && s.gorseller.length) && !o.yeniden)
    throw new ortak.OrtakHata("manifest_var", "Bu işte gorsel-bul.js'in bulduğu stok görseller var; klip moduna geçilmedi.", {
      cikis: ortak.CIKIS.GIRDI, cozum: "Klip moduna geçmek için: node klip-hazirla.js " + is + " --yeniden (stok görsel dosyaları silinmez, klasörlerde kalır)." });

  const uyarilar = [];
  let sahneler;
  const ayni = eski && eski.klipModu && eski.kaynakSenaryoSha1 === ozet && Array.isArray(eski.sahneler) && eski.sahneler.length === paragraflar.length;
  if (ayni) sahneler = eski.sahneler;
  else {
    if (eski && eski.klipModu && !o.yeniden)
      throw new ortak.OrtakHata("senaryo_degisti", "Senaryo, sahne klasörleri hazırlandıktan sonra değişmiş.", {
        cikis: ortak.CIKIS.GIRDI, cozum: "Manifesti yeni paragraflara göre yazmak için: node klip-hazirla.js " + is + " --yeniden (klipler yerinde kalır; paragraf sayısı değiştiyse klipleri doğru klasöre taşı)." });
    // var olan NNN- klasorleri ayni numarayla korunur (kullanici klip koymus olabilir)
    const mevcut = new Map();
    try {
      for (const d of fs.readdirSync(vis, { withFileTypes: true })) {
        const m = d.isDirectory() && /^(\d{3})-/.exec(d.name);
        if (m && !mevcut.has(Number(m[1]))) mevcut.set(Number(m[1]), d.name);
      }
    } catch (e) { /* yok */ }
    sahneler = paragraflar.map((p, i) => ({
      no: i + 1, klasor: mevcut.get(i + 1) || sahneKlasorAdi(i + 1, ilkKelimeler(p) || "sahne"),
      paragraflar: [i], aramalar: [], kullanilanArama: "", durum: "elle", gorseller: [] }));
    if (mevcut.size > paragraflar.length) uyarilar.push((mevcut.size - paragraflar.length) + " sahne klasörü artık hiçbir paragrafa denk gelmiyor (sona eklenecek); içindekileri kontrol et.");
  }
  for (const s of sahneler) fs.mkdirSync(path.join(vis, s.klasor), { recursive: true });

  // --kaynak: numarali dosyalari sahnelere kopyala
  let kopyalanan = 0;
  if (o.kaynak) {
    const kaynak = path.resolve(o.kaynak);
    if (!fs.existsSync(kaynak) || !fs.statSync(kaynak).isDirectory())
      throw new ortak.OrtakHata("kaynak_yok", "Kaynak klasör bulunamadı: " + kaynak, { cikis: ortak.CIKIS.GIRDI, cozum: "Klasör yolunu tırnak içinde ver: --kaynak \"D:\\Klipler\\Bolum 2\"" });
    for (const ad of fs.readdirSync(kaynak).filter(medyaMi).sort(dogalSirala)) {
      const m = /(\d+)/.exec(ad);
      const no = m ? parseInt(m[1], 10) : NaN;
      const s = sahneler.find(x => x.no === no);
      if (!s) { uyarilar.push("Atlandı: " + ad + (m ? " (" + no + ". sahne yok; " + sahneler.length + " sahne var)" : " (adında sahne numarası yok)")); continue; }
      const hedef = path.join(vis, s.klasor, ad);
      if (fs.existsSync(hedef) && fs.statSync(hedef).size === fs.statSync(path.join(kaynak, ad)).size) continue;
      fs.copyFileSync(path.join(kaynak, ad), hedef + ".part");
      fs.renameSync(hedef + ".part", hedef);
      kopyalanan++;
    }
  }

  ortak.atomikJsonYaz(mYol, { surum: 1, olusturma: new Date().toISOString(), klipModu: true, kaynakSenaryoSha1: ozet,
    sahneler, toplamGorsel: 0 });

  // sahne listesi + doluluk
  const satirlar = ["# Sahne listesi — " + is, "",
    "Her paragraf bir sahne. Klibi (mp4/mov/webm) ya da görseli sahnenin klasörüne koy: `uretim/" + is + "/Visuals/<klasör>/`.",
    "Bir klasörde birden çok dosya varsa sahne süresi aralarında eşit bölünür (ad sırasıyla).", "",
    "| # | Klasör | Paragraf | Dosya |", "|---|---|---|---|"];
  let bos = 0;
  for (const s of sahneler) {
    let dosyalar = [];
    try { dosyalar = fs.readdirSync(path.join(vis, s.klasor)).filter(medyaMi).sort(dogalSirala); } catch (e) { /* yok */ }
    if (!dosyalar.length) bos++;
    const p = String(paragraflar[s.paragraflar[0]] || "").replace(/\|/g, "/").replace(/\s+/g, " ");
    satirlar.push("| " + s.no + " | " + s.klasor + " | " + p + " | " + (dosyalar.join(", ") || "**boş**") + " |");
  }
  fs.writeFileSync(path.join(dizin, "SAHNE-LISTESI.md"), satirlar.join("\n") + "\n", "utf8");

  for (const u of uyarilar) ortak.uyari(u);
  console.log("SAHNE: " + sahneler.length + " sahne klasörü hazır (uretim/" + is + "/Visuals/)" + (kopyalanan ? ", " + kopyalanan + " dosya kopyalandı" : ""));
  console.log("LİSTE: uretim/" + is + "/SAHNE-LISTESI.md");
  if (bos) console.log("EKSİK: " + bos + " sahne boş. Boş sahnede komşu sahnenin klibi kullanılır (video-yap uyarır).");
  else console.log("sıradaki adım:\n    node seslendir.js " + is + "\n    node video-yap.js " + is);
  return { sahneler, bos, kopyalanan, uyarilar };
}

module.exports = { hazirla };

if (require.main === module) {
  try {
    const { konum, bayrak } = ortak.argumanCoz(process.argv.slice(2), { deger: ["kaynak"], mantik: ["yeniden"] });
    const is = konum[0];
    if (!is) { console.error("✗ Kullanım: node klip-hazirla.js <iş-adı> [--kaynak <klasör>] [--yeniden]"); process.exit(ortak.CIKIS.GIRDI); }
    if (bayrak.kaynak === true) { console.error("✗ --kaynak için klasör yolu ver."); process.exit(ortak.CIKIS.GIRDI); }
    hazirla({ is, kaynak: typeof bayrak.kaynak === "string" ? bayrak.kaynak : null, yeniden: !!bayrak.yeniden });
  } catch (e) { ortak.bitir(e); }
}
