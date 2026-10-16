// TOPLU URETIM MOTORU — toplu-uret.cjs (Shorts) ve toplu-uret-uzun.cjs (uzun) ayni cekirdegi kullanir (SOZLESME 6.7).
// Iki serit: [hazirlik] seslendir -> gorsel-bul (sirali, API nezaketi)   [render] hazirligi biten is video-yap'a girer.
// Dayanikli: yarim kalan kosudan devam eder, var olan konu.json/senaryoyu EZMEZ, sayac yalniz dogrulanmis videoyu sayar,
// hata varsa cikis kodu 1, tam gunluk uretim/_toplu-<tarih>.log dosyasina yazilir.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ortak = require("./ortak");
const isler = require("./panel-isler");
const { acilisSureleri } = require("./panel-yeni-is");
const { agaciOldur } = require("./panel-calistir");

// Calisan alt surecler: toplu is Ctrl+C / SIGTERM ile kesilirse ya da bir hatayla cikarsa yetim video-yap/ffmpeg kalmasin.
// (POSIX'te cocuklar ayri surec grubunda acilir; terminaldeki Ctrl+C onlara kendiliginden gitmez. Windows'ta taskkill /T agaci kapatir.)
const aktifCocuklar = new Set();
let _cocukKancasi = false;
function cocukKancasi(p) {
  aktifCocuklar.add(p);
  if (_cocukKancasi) return; _cocukKancasi = true;
  const temizle = () => { for (const c of Array.from(aktifCocuklar)) { try { agaciOldur(c.pid, c); } catch (e) { /* zaten bitmis */ } } };
  process.on("exit", temizle);
  for (const [sig, kod] of [["SIGINT", 130], ["SIGTERM", 143]]) process.on(sig, () => { temizle(); process.exit(kod); });
}

// Profil varsayilanlari (alan yoksa). Eski betiklerin degerleri korundu; muzik 0.40 (olculen deger).
const PROFIL = {
  short: { format: "short", hedefSaniye: 50, sesHizi: "+18%", acilis: "hizli" },
  long: { format: "long", hedefSaniye: 930, renk: "sinematik", gecis: "dissolve", acilis: "hizli" },
};

const ISARET = (ad, v) => v !== undefined && v !== null && v !== "";

// Manifest: dizi ya da {kanal, varsayilan:{...}, isler:[...]}. Gecersizse hata listesi doner.
function manifestOku(dosya) {
  let ham;
  try { ham = ortak.jsonOku(dosya, undefined); }
  catch (e) { throw new ortak.OrtakHata("manifest", "Manifest okunamadı: " + e.message, { cikis: ortak.CIKIS.GIRDI }); }
  if (ham === undefined) throw new ortak.OrtakHata("manifest", "Manifest dosyası bulunamadı: " + dosya, { cikis: ortak.CIKIS.GIRDI });
  let kok = {}, liste;
  if (Array.isArray(ham)) liste = ham;
  else if (ortak.duzNesne(ham) && Array.isArray(ham.isler)) { kok = ham; liste = ham.isler; }
  else throw new ortak.OrtakHata("manifest", "Manifest bir iş dizisi ya da {kanal, varsayilan, isler} olmalı.", { cikis: ortak.CIKIS.GIRDI });
  const varsayilan = ortak.duzNesne(kok.varsayilan) ? kok.varsayilan : {};
  const hatalar = [];
  const sonuc = liste.map((x, i) => {
    if (!ortak.duzNesne(x)) { hatalar.push((i + 1) + ". öğe bir nesne değil"); return null; }
    const slug = x.slug;
    if (!ortak.guvenliAd(slug)) hatalar.push((i + 1) + ". öğe: geçersiz slug '" + slug + "' (harf, rakam, tire, alt çizgi)");
    if (typeof x.baslik_en !== "string" || !x.baslik_en.trim()) hatalar.push((i + 1) + ". öğe (" + slug + "): baslik_en gerekli");
    if (!Array.isArray(x.paragraflar) || !x.paragraflar.length || x.paragraflar.some(p => typeof p !== "string" || !p.trim()))
      hatalar.push((i + 1) + ". öğe (" + slug + "): paragraflar boş olmayan metinlerden oluşan bir liste olmalı");
    return x;
  }).filter(Boolean);
  if (hatalar.length) throw new ortak.OrtakHata("manifest", "Manifestte hata var: " + hatalar.slice(0, 5).join("; "), { cikis: ortak.CIKIS.GIRDI, detay: hatalar });
  const kopyalar = new Set();
  for (const x of sonuc) { if (kopyalar.has(x.slug)) throw new ortak.OrtakHata("manifest", "Aynı slug iki kez var: " + x.slug, { cikis: ortak.CIKIS.GIRDI }); kopyalar.add(x.slug); }
  return { kok, varsayilan, isler: sonuc };
}

// Bir isin konu.json'u: yoksa yazilir, varsa YALNIZ eksik alanlar eklenir (panel/senaryo duzenlemesi ezilmez).
function konuHazirla(uretim, x, m, profilAd, ayar) {
  const p = PROFIL[profilAd];
  const dir = path.join(uretim, x.slug);
  const konuYolu = path.join(dir, "konu.json");
  const uyarilar = [];
  const sec = alan => (ISARET(alan, x[alan]) ? x[alan] : ISARET(alan, m.varsayilan[alan]) ? m.varsayilan[alan] : undefined);
  const fmt = sec("format") || p.format;
  const dikey = fmt !== "long";
  const [gs, intro, kk, outro] = acilisSureleri(fmt, sec("acilisStili") || p.acilis);
  const kanal = ISARET("kanal", x.kanal) ? x.kanal : ISARET("kanal", m.varsayilan.kanal) ? m.varsayilan.kanal : ISARET("kanal", m.kok.kanal) ? m.kok.kanal : undefined;
  const oneri = { baslik_en: x.baslik_en.trim(), format: fmt, aspect: dikey ? "9:16" : "16:9", geriSayim: gs, intro, konuKarti: kk, outro,
    muzikSeviyesi: 0.4, hedefSaniye: sec("hedefSaniye") || p.hedefSaniye };
  if (fmt === "long" && (sec("acilisStili") || p.acilis) === "hizli") oneri.markaKose = 2;
  if (kanal) oneri.kanal = kanal;
  for (const a of ["ses", "sesHizi", "dil", "altyaziDili", "tur", "ton", "slogan"]) { const v = sec(a); if (v !== undefined) oneri[a] = v; }
  if (p.sesHizi && oneri.sesHizi === undefined) oneri.sesHizi = p.sesHizi;
  for (const a of ["renk", "gecis"]) if (p[a] && sec(a) === undefined) oneri[a] = p[a]; else if (sec(a) !== undefined) oneri[a] = sec(a);
  if (!kanal && (!ayar.kanal || ayar.kanal === "KANALIM")) uyarilar.push("kanal adı verilmedi (öğede, manifestte ya da panel ayarında); videoda 'KANALIM' yazacak");
  fs.mkdirSync(path.join(dir, "Voice"), { recursive: true });
  let mevcut = null;
  if (fs.existsSync(konuYolu)) mevcut = ortak.jsonOku(konuYolu, null);      // bozuksa OrtakHata: o is atlanir
  if (mevcut === null) ortak.atomikJsonYaz(konuYolu, Object.assign({ surum: 1 }, oneri));
  else {
    let degisti = false;
    for (const [k, v] of Object.entries(oneri)) if (mevcut[k] === undefined) { mevcut[k] = v; degisti = true; }
    if (degisti) ortak.atomikJsonYaz(konuYolu, mevcut);
  }
  // senaryo: dosya doluysa (>=50 karakter) DOKUNMA
  const senaryo = path.join(dir, "Voice", "SESLENDIRME-TAM-METIN.txt");
  let dolu = false;
  try { dolu = fs.readFileSync(senaryo, "utf8").trim().length >= 50; } catch (e) {}
  if (!dolu) ortak.atomikYaz(senaryo, x.paragraflar.join("\n\n") + "\n");
  return { uyarilar, senaryoYazildi: !dolu };
}

function gorselSayisi(dir) {
  let n = 0;
  try {
    for (const d of fs.readdirSync(path.join(dir, "Visuals"), { withFileTypes: true }))
      if (d.isDirectory() && !d.name.startsWith("_")) n += fs.readdirSync(path.join(dir, "Visuals", d.name)).filter(x => /\.(jpe?g|png|webp)$/i.test(x)).length;
  } catch (e) {}
  return n;
}
// "bitti": mp4 var, .part yok, sure okunabiliyor (ffprobe) — yarim video bitmis sayilmaz
function bittiMi(uretim, slug) {
  const b = path.join(uretim, slug);
  const v = isler.videoBilgisi(b, slug, { senkron: true });
  return !!(v && v.gecerli);
}

// calistir({ profil, manifest, betikDizini?, uretim?, cikti?: fn })
async function toplu(o) {
  const profil = o.profil, uretim = o.uretim || ortak.uretimDizini();
  const BETIK = o.betikDizini || ortak.KOK;
  fs.mkdirSync(uretim, { recursive: true });
  const logYolu = path.join(uretim, "_toplu-" + ortak.damga() + ".log");
  const yaz = (m) => { (o.cikti || console.log)(m); try { fs.appendFileSync(logYolu, String(m) + "\n", "utf8"); } catch (e) {} };
  const m = manifestOku(o.manifest);
  m.kok = m.kok || {};
  const ayar = ortak.ayarOku();
  const gosterYol = p => (ortak.yolIcinde(ortak.KOK, p) ? path.relative(ortak.KOK, p) : p);
  yaz(m.isler.length + " iş yüklendi · günlük: " + gosterYol(logYolu));
  const durum = {}, hata = [];
  const bitenler = [];

  // 1) dosyalar: konu.json yoksa yaz / eksik alani tamamla; dolu senaryoyu ezme
  for (const x of m.isler) {
    try {
      const r = konuHazirla(uretim, x, { varsayilan: m.varsayilan, kok: m.kok }, profil, ayar);
      for (const u of r.uyarilar) yaz("  ⚠ " + x.slug + ": " + u);
    } catch (e) {
      durum[x.slug] = "HATA-konu"; hata.push(x.slug);
      yaz("[HATA] " + x.slug + " konu.json/senaryo hazırlanamadı: " + e.message);
    }
  }
  yaz("konu.json + senaryo dosyaları hazır (var olanlar ezilmedi)\n");

  // Alt surecin BOSTA KALMA izleyicisi (panelin kendi calistiricisindaki 45/90 dk kuralinin aynisi): gece gozetimsiz calisan toplu iste
  // zaman asimi olmayan tek bir takilmis cocuk (kopmus ag cagrisi, donmus ffmpeg) butun seriyi sonsuza dek bekletirdi. Cikti
  // gelmeyen sure esigi asarsa surec agaci oldurulur, is "HATA-<asama>" sayilir ve seri sonraki ise gecer.
  // Esikler: genel 45 dk, video-yap 90 dk; gorsel-bul sessiz 429 beklemesi (GORSEL_LIMIT_BEKLE_SN) + 10 dk payla bu esigi asabilir.
  const sayiAyar = (deger, env, varsayilan) => { const n = Number(deger !== undefined ? deger : process.env[env]); return Number.isFinite(n) && n > 0 ? n : varsayilan; };
  const BOSTA = { genel: sayiAyar(o.bostaOldurSn, "TOPLU_BOSTA_OLDUR_SN", 2700), video: sayiAyar(o.videoBostaOldurSn, "TOPLU_VIDEO_BOSTA_OLDUR_SN", 5400) };
  const kontrolMs = sayiAyar(o.kontrolMs, "TOPLU_KONTROL_MS", 5000);
  const bostaEsigiSn = (betik, env) => {
    if (betik === "video-yap.js") return Math.max(BOSTA.genel, BOSTA.video);
    const bekle = Number(env.GORSEL_LIMIT_BEKLE_SN);
    return betik === "gorsel-bul.js" && Number.isFinite(bekle) && bekle > 0 ? Math.max(BOSTA.genel, bekle + 600) : BOSTA.genel;
  };
  const calistirChild = (betik, arg) => new Promise(coz => {
    const yol = path.join(BETIK, betik);
    let cikti = "";
    let p;
    // Gece toplu isinde Pexels/Pixabay 429'u gorulurse kaynagi kapatmak yerine siniri bekle (sinir saatlik doner);
    // ortamdan GORSEL_LIMIT_BEKLE_SN verilmisse o gecerli.
    const env = Object.assign({}, process.env);
    if (betik === "gorsel-bul.js" && !env.GORSEL_LIMIT_BEKLE_SN) env.GORSEL_LIMIT_BEKLE_SN = "3600";
    // detached (POSIX): surec grubu olarak oldurulebilsin (ffmpeg torunlari kalmasin); Windows'ta taskkill /T agaci kapatir
    try { p = spawn(process.execPath, [yol, arg], { cwd: ortak.KOK, windowsHide: true, env, detached: process.platform !== "win32" }); }
    catch (e) { return coz({ kod: -1, cikti: String(e) }); }
    cocukKancasi(p);
    const esikSn = bostaEsigiSn(betik, env);
    let bitti = false, bostaOldu = false, sonCikti = Date.now();
    const bitir = (kod) => {
      if (bitti) return; bitti = true; clearInterval(izle);
      aktifCocuklar.delete(p);
      coz({ kod: bostaOldu ? (kod ? kod : -1) : (kod === null ? -1 : kod), cikti, bosta: bostaOldu });
    };
    const al = d => { sonCikti = Date.now(); cikti += d; if (cikti.length > 600000) cikti = cikti.slice(-300000); };     // ilerleme satirlari bellegi sismesin
    const izle = setInterval(() => {
      if (Date.now() - sonCikti <= esikSn * 1000) return;
      bostaOldu = true; clearInterval(izle);
      cikti += "\n✗ " + (esikSn >= 120 ? Math.round(esikSn / 60) + " dakikadır" : Math.round(esikSn) + " saniyedir") + " çıktı yok; takılmış sayılıp süreç sonlandırıldı (" + betik + " " + arg + ").\n";
      agaciOldur(p.pid, p);
      const t = setTimeout(() => bitir(-1), 15000); if (t.unref) t.unref();       // torun boruyu tutarsa 'close' hic gelmeyebilir
    }, kontrolMs);
    if (izle.unref) izle.unref();
    p.stdout.on("data", al); p.stderr.on("data", al);
    p.on("error", e => { cikti += String(e); bitir(-1); });
    p.on("close", kod => bitir(kod));
  });
  const basarisiz = (slug, asama, r) => {
    durum[slug] = "HATA-" + asama; hata.push(slug);
    try { fs.appendFileSync(logYolu, "----- " + slug + " " + asama + " ÇIKTISI (tam) -----\n" + r.cikti + "\n-----\n", "utf8"); } catch (e) {}
    const son = r.cikti.split(/\r?\n/).filter(l => l.trim()).slice(-4).join("\n      ");
    yaz("[HATA] " + slug + " " + asama + " (çıkış kodu " + r.kod + "):\n      " + son);
  };

  const hazir = [];
  let hazirlikBitti = false;
  async function hazirlikSeridi() {
    for (const x of m.isler) {
      const slug = x.slug;
      if (durum[slug]) continue;                                   // konu hazirlanamadi
      if (bittiMi(uretim, slug)) { durum[slug] = "BITTI"; bitenler.push(slug); yaz("[hazırlık] " + slug + " zaten üretilmiş, atlandı"); continue; }
      const t0 = Date.now();
      durum[slug] = "seslendirme";
      yaz("[hazırlık] " + slug + " seslendiriliyor...");
      let r = await calistirChild("seslendir.js", slug);                 // seslendir.js kendi icinde guncelse atlar
      if (r.kod !== 0) { basarisiz(slug, "ses", r); continue; }
      const g = gorselSayisi(path.join(uretim, slug));
      if (g >= 6) yaz("[hazırlık] " + slug + " görseller zaten var (" + g + "), atlandı");
      else {
        durum[slug] = "gorsel";
        yaz("[hazırlık] " + slug + " görseller çekiliyor...");
        r = await calistirChild("gorsel-bul.js", slug);
        if (r.kod !== 0) { basarisiz(slug, "gorsel", r); continue; }
      }
      durum[slug] = "render-bekliyor";
      hazir.push(slug);
      yaz("[hazırlık] " + slug + " HAZIR (" + ((Date.now() - t0) / 1000 | 0) + " sn) — render kuyruğunda");
    }
    hazirlikBitti = true;
  }
  async function renderSeridi() {
    while (!hazirlikBitti || hazir.length) {
      const slug = hazir.shift();
      if (!slug) { await new Promise(z => setTimeout(z, o.bekleMs || 1000)); continue; }
      const t0 = Date.now();
      durum[slug] = "render";
      yaz("[render] " + slug + " başladı...");
      const r = await calistirChild("video-yap.js", slug);
      if (r.kod !== 0) { basarisiz(slug, "render", r); continue; }
      if (!bittiMi(uretim, slug)) { basarisiz(slug, "mp4", { kod: r.kod, cikti: r.cikti + "\n(video dosyası bulunamadı ya da süresi okunamadı)" }); continue; }
      durum[slug] = "BITTI"; bitenler.push(slug);        // sayac YALNIZ dogrulanmis videoda artar
      yaz("[render] " + slug + " BİTTİ (" + ((Date.now() - t0) / 1000 | 0) + " sn) — " + bitenler.length + "/" + m.isler.length);
    }
  }
  const t0 = Date.now();
  await Promise.all([hazirlikSeridi(), renderSeridi()]);
  yaz("\n========== ÖZET ==========");
  for (const x of m.isler) yaz("  " + x.slug + ": " + (durum[x.slug] || "?"));
  yaz("Toplam: " + bitenler.length + "/" + m.isler.length + " video, " + ((Date.now() - t0) / 60000).toFixed(1) + " dk");
  if (hata.length) yaz("✗ " + hata.length + " iş başarısız: " + hata.join(", ") + " — ayrıntı: " + gosterYol(logYolu));
  return { durum, bitenler, hata, logYolu, toplam: m.isler.length };
}

// .cjs sarmalayicilari icin ortak giris
function cli(profil, dosyaAdi) {
  const manifest = process.argv[2];
  if (!manifest || manifest === "--yardim" || manifest === "-h") {
    console.error("Kullanım: node " + dosyaAdi + " <senaryolar.json>");
    console.error("Manifest: [{ \"slug\":\"021-ornek\", \"baslik_en\":\"...\", \"paragraflar\":[\"...\"] }, ...]");
    console.error("      ya da { \"kanal\":\"AD\", \"varsayilan\":{ \"ses\":\"...\", \"dil\":\"tr\" }, \"isler\":[ ... ] }");
    console.error("Öğede kanal, ses, sesHizi, dil, hedefSaniye, format isteğe bağlıdır. Var olan konu.json ve dolu senaryolar ezilmez.");
    process.exit(manifest ? 0 : ortak.CIKIS.GIRDI);
  }
  toplu({ profil, manifest: path.resolve(manifest) }).then(r => { if (r.hata.length) process.exitCode = 1; }).catch(ortak.bitir);
}

module.exports = { toplu, manifestOku, konuHazirla, bittiMi, cli, PROFIL };
