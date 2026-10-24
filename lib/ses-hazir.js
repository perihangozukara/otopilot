// Voice/hazir/ içindeki paragraf WAV'larını standart Otopilot zamanlamasına bağlar.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ortak = require("./ortak");
const { kelimeSay } = require("./ses-metin");

const no = i => String(i + 1).padStart(3, "0");
const yuvarla = x => Math.round(x * 1000) / 1000;

function wavBilgisi(dosya) {
  const b = fs.readFileSync(dosya);
  if (b.length < 44 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE")
    throw new ortak.OrtakHata("hazir_wav_gecersiz", "Geçerli WAV değil: " + path.basename(dosya), { cikis: 2 });
  let byteRate = 0, dataSize = -1;
  for (let p = 12; p + 8 <= b.length;) {
    const id = b.toString("ascii", p, p + 4), size = b.readUInt32LE(p + 4), start = p + 8;
    if (start + size > b.length) break;
    if (id === "fmt " && size >= 16) byteRate = b.readUInt32LE(start + 8);
    if (id === "data") { dataSize = size; break; }
    p = start + size + (size % 2);
  }
  if (!byteRate || dataSize <= 0) throw new ortak.OrtakHata("hazir_wav_gecersiz", "WAV biçimi okunamadı: " + path.basename(dosya), { cikis: 2 });
  return { sureSn: dataSize / byteRate, bayt: b.length,
    sha: crypto.createHash("sha256").update(b).digest("hex") };
}

function oku(dizin) {
  const sesDizin = path.join(dizin, "Voice"), hazirDizin = path.join(sesDizin, "hazir");
  const metinYolu = path.join(sesDizin, "SESLENDIRME-TAM-METIN.txt");
  if (!fs.existsSync(hazirDizin)) return null;
  const wavlar = fs.readdirSync(hazirDizin).filter(f => /^\d+\.wav$/i.test(f));
  if (!wavlar.length) return null;
  let ham;
  try { ham = fs.readFileSync(metinYolu, "utf8").replace(/^\uFEFF/, ""); }
  catch (e) { throw new ortak.OrtakHata("senaryo_yok", "Seslendirme metni okunamadı.", { cikis: 2 }); }
  const paragraflar = ortak.paragraflaraBol(ham), n = paragraflar.length;
  if (!n) throw new ortak.OrtakHata("senaryo_yok", "Seslendirilecek metin yok.", { cikis: 2 });
  const beklenen = Array.from({ length: n }, (_, i) => no(i) + ".wav");
  const mevcut = wavlar.map(f => f.toLowerCase()).sort();
  const eksik = beklenen.filter(f => !mevcut.includes(f.toLowerCase()));
  const fazla = mevcut.filter(f => !beklenen.some(e => e.toLowerCase() === f));
  if (eksik.length || fazla.length) {
    const ayrinti = [eksik.length && "eksik: " + eksik.join(", "), fazla.length && "fazla: " + fazla.join(", ")].filter(Boolean).join("; ");
    throw new ortak.OrtakHata("hazir_wav_sayisi", "Voice/hazir WAV'ları senaryo paragraflarıyla eşleşmiyor (" + ayrinti + ").", {
      cikis: 4, cozum: "Her paragraf için 001.wav, 002.wav… oluştur; yenilemek için node voxcpm2-seslendir.js <iş> --yeniden çalıştır." });
  }
  const dosyalar = beklenen.map(f => ({ dosya: f, ...wavBilgisi(path.join(hazirDizin, f)) }));
  let profil = {};
  try { profil = ortak.jsonOku(path.join(hazirDizin, "manifest.json"), {}) || {}; } catch (e) { /* elle hazırlanmış WAV da desteklenir */ }
  const ozet = ortak.paragrafOzeti(paragraflar);
  if (profil.text_sha1 && profil.text_sha1 !== ozet)
    throw new ortak.OrtakHata("hazir_wav_eski", "Voice/hazir sesleri mevcut senaryodan önce üretilmiş.", {
      cikis: 4, cozum: "Güncel VoxCPM2 seslerini üret: node voxcpm2-seslendir.js <iş> --yeniden." });
  if (Array.isArray(profil.files)) {
    for (let i = 0; i < dosyalar.length; i++) {
      if (!profil.files[i] || profil.files[i].sha256 !== dosyalar[i].sha)
        throw new ortak.OrtakHata("hazir_wav_degisti", "Voice/hazir ses dosyası manifest ile eşleşmiyor: " + dosyalar[i].dosya, {
          cikis: 4, cozum: "VoxCPM2 seslerini yeniden üret: node voxcpm2-seslendir.js <iş> --yeniden." });
    }
  }
  return { sesDizin, hazirDizin, paragraflar, dosyalar, profil, ozet };
}

function guncelMi(sesDizin, ver, dil, bosluk) {
  let z;
  try { z = ortak.jsonOku(path.join(sesDizin, "zamanlama.json"), null); } catch (e) { return false; }
  if (!z || z.surum !== 1 || z.motor !== "voxcpm2" || z.dil !== dil || z.metinOzeti !== ver.ozet || z.bosluk !== bosluk ||
      z.paragrafSayisi !== ver.paragraflar.length || !Array.isArray(z.paragraflar) || z.paragraflar.length !== ver.dosyalar.length) return false;
  return z.paragraflar.every((p, i) => p && p.no === i && p.dosya === "hazir/" + ver.dosyalar[i].dosya && p.sha === ver.dosyalar[i].sha);
}

// Paragraf arası sessizlik: konu.json "paragrafEs" > cümle cümle üretilmiş seste 1 sn > eski üretimde 0,35 sn.
function paragrafEsi(dizin, profil) {
  let konu = {};
  try { konu = ortak.jsonOku(path.join(dizin, "konu.json"), {}) || {}; } catch (e) { /* konu.json yoksa varsayılan */ }
  const k = Number(konu.paragrafEs);
  if (konu.paragrafEs !== undefined && Number.isFinite(k) && k >= 0 && k <= 3) return k;
  return profil.mode === "reference_continuation" ? 1.0 : 0.35;
}

// Python'un manifest'e yazdığı cümle-kelime zamanları (ms, paragraf başına göre); yoksa boş liste.
function kelimeZamanlari(profil, i) {
  const f = Array.isArray(profil.files) ? profil.files[i] : null;
  if (!f || !Array.isArray(f.words)) return [];
  return f.words.filter(k => k && Number.isFinite(Number(k.t))).map(k => ({ t: Number(k.t), d: Number(k.d) || 0, w: String(k.w || "") }));
}

function kullan(dizin, dil) {
  const ver = oku(dizin);
  if (!ver) return null;
  const bosluk = paragrafEsi(dizin, ver.profil);
  if (guncelMi(ver.sesDizin, ver, dil, bosluk)) return { atlandi: true, motor: "voxcpm2", ses: "masalsi-kadin-01", paragrafSayisi: ver.paragraflar.length,
    toplamSn: ortak.jsonOku(path.join(ver.sesDizin, "zamanlama.json"), {}).toplamSn };

  let bas = 0;
  const paragraflar = ver.dosyalar.map((f, i) => {
    const satir = { no: i, dosya: "hazir/" + f.dosya, sureSn: yuvarla(f.sureSn), baslangicSn: yuvarla(bas),
      kelimeSayisi: kelimeSay(ver.paragraflar[i]), sha: f.sha, bayt: f.bayt };
    bas += f.sureSn + (i < ver.dosyalar.length - 1 ? bosluk : 0);
    return satir;
  });
  const toplamSn = yuvarla(bas), ses = ver.profil.ses || "masalsi-kadin-01";
  ortak.atomikJsonYaz(path.join(ver.sesDizin, "kelimeler.json"), {
    surum: 1, dil, ses, motor: "voxcpm2", paragraflar: ver.paragraflar.map((_, i) => ({ no: i, kelimeler: kelimeZamanlari(ver.profil, i) })),
  });
  ortak.atomikJsonYaz(path.join(ver.sesDizin, "zamanlama.json"), {
    surum: 1, olusturma: new Date().toISOString(), metinOzeti: ver.ozet, dil, ses, motor: "voxcpm2",
    hiz: ver.profil.mode === "reference_continuation" ? "referans-cumle" : "tasarim", cumleEs: ver.profil.sentence_gap ?? null,
    bosluk, paragrafSayisi: paragraflar.length, toplamSn, hedefSn: null, sapmaYuzde: null,
    olculenKelimeHizi: toplamSn ? yuvarla(paragraflar.reduce((a, p) => a + p.kelimeSayisi, 0) / (toplamSn / 60)) : 0,
    okunusOzeti: "", paragraflar,
  });
  console.log("Hazır WAV'lar kullanıldı; Edge seslendirmesi atlandı. WAV sürelerinden sahne zamanları kuruldu.");
  return { atlandi: false, motor: "voxcpm2", ses, paragrafSayisi: paragraflar.length, toplamSn };
}

module.exports = { oku, kullan, wavBilgisi };
