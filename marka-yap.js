// KANAL MARKA URETICI — profil resmi + banner (fotograf tabanli, sinematik)
// Kullanim: node marka-yap.js "KANAL ADI" "SLOGAN" [cikis-klasoru] [--rozet XX] [--alt-metin "..."] [--dil en|tr]
//   Argumanlar verilmezse panel ayarindan (panel-ayar.json) okunur: kanal, slogan, rozet,
//   bannerAltMetin, vurguRenk, dil. Rozet bos/verilmemisse kanal adinin bas harfleri kullanilir.
//   Ciktilar .part'a yazilip yeniden adlandirilir; ayni adli onceki kosudan kalan obur uzanti (png/jpg) silinir.
//
// Ilk surum duz renk uzerine yaziydi ve ucuz duruyordu. Bu surum kanalin kendi
// gorsellerini kullaniyor: bolunmus kompozisyon, sicak/soguk renk
// ayrimi, vinyet, altin degrade yazi, simsek ayrac.
//
// Yazilar lib/yazi.js uzerinden (textfile): ad/slogan/rozette ozel karakter filtreyi bozmaz, punto
// uzunluga gore kuculur. Banner yazilari YouTube'un telefon "guvenli alani" (y ~ 508-931) icinde kalir.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const ortak = require("./lib/ortak");
const Y = require("./lib/yazi");
const RF = require("./lib/render-ffmpeg");
const { renkKodu } = require("./lib/render-ayar");

const BANNER_MAKS_BAYT = 5.5 * 1024 * 1024;       // YouTube banner sinirı 6 MB; payli birakiyoruz
const GUVENLI = { x0: 507, x1: 2053, y0: 508, y1: 931 };   // 1546 x 423 (telefonda SADECE burasi gorunur)
const ALT_METIN = { en: "NEW VIDEOS EVERY WEEK", tr: "HER HAFTA YENİ VİDEO" };

// bagimli durum (main'de doldurulur)
let FF, CIKIS, TMP, VURGU;

function run(argv, etiket) {
  try { execFileSync(FF, ["-y", "-hide_banner", "-loglevel", "error", ...argv], { stdio: "pipe", timeout: 240000, windowsHide: true }); }
  catch (e) {
    const err = ((e.stderr && e.stderr.toString()) || e.message).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    throw new ortak.OrtakHata("ffmpeg", "Marka görseli üretilemedi (" + etiket + "): " + (err[err.length - 1] || "bilinmeyen hata"),
      { cikis: ortak.CIKIS.GENEL, detay: err.slice(-6) });
  }
}

// KULLANICIYA GIDEN cikti dosyalari: ffmpeg <ad>.part.<uz>'e yazar, basariliysa yeniden adlandirilir. Yarida kesilen
// (Durdur, disk dolu) bir uretim yarim PNG/JPG'yi yuklenebilir bir dosya gibi birakmaz. argv, cikti yolu OLMADAN verilir.
const sil = yol => { try { fs.unlinkSync(yol); } catch (e) { /* yok */ } };
function ciktiYaz(argv, hedef, etiket) {
  const part = RF.partYolu(hedef);
  sil(part);
  try { run([...argv, part], etiket); RF.partBitir(part, hedef); }
  catch (e) { sil(part); throw e; }
}

// Profil rozeti: kanal adinin bas harfleri (en cok 3 sozcuk; sembol/tirnak atlanir). Panelde rozet BOS ise kullanilir —
// eskiden sabit "VS" varsayilani her kanalin profil resmine "VS" yaziyordu.
function rozetTuret(ad, dil) {
  const buyut = s => { try { return s.toLocaleUpperCase(dil === "tr" ? "tr-TR" : undefined); } catch (e) { return s.toUpperCase(); } };
  const harfler = String(ad || "").split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}]+/u, "")).filter(Boolean).map(w => Array.from(w)[0]);
  const r = buyut(harfler.slice(0, 3).join(""));
  if (r) return r;
  return buyut(Array.from(String(ad || "").replace(/\s+/g, "")).slice(0, 2).join("")) || "K";
}

// GORSELLER
// Marka, kanalin kendi videolarindaki gorsellerden kurulur — boylece kanal
// sayfasi ve videolar ayni yerden gorunur.
//
// Kaynak klasoru MARKA_GORSEL degiskeniyle verilir; verilmezse uretim/
// altindaki tum islerin Images ve Visuals klasorleri taranir.
//   MARKA_GORSEL=C:/gorseller node marka-yap.js "KANAL" "SLOGAN"
//
// En az 2 gorsel gerekir (profil resmi icin), banner 4 tanesini kullanir.
function gorselleriTopla() {
  const elle = process.env.MARKA_GORSEL;
  const URETIM = ortak.uretimDizini();
  const kokler = elle ? [elle] : (fs.existsSync(URETIM)
    ? fs.readdirSync(URETIM).filter(is => !is.startsWith("_")).flatMap(is =>
        ["Images", "Visuals"].map(a => path.join(URETIM, is, a)))
    : []);
  const bulunan = [];
  const tara = (d, derinlik) => {
    if (derinlik > 2 || !fs.existsSync(d)) return;
    for (const ad of fs.readdirSync(d).sort()) {
      const t = path.join(d, ad);
      let st; try { st = fs.statSync(t); } catch (e) { continue; }
      if (st.isDirectory()) tara(t, derinlik + 1);
      else if (/\.(jpe?g|png)$/i.test(ad) && st.size > 40000) bulunan.push(t);
    }
  };
  for (const k of kokler) tara(k, 0);
  return bulunan;
}

// ucgen dalga toplami — videolardaki ayni simsek
function zikzak(genlikOlcek, periyotOlcek) {
  const t = (p, a) => {
    const P = Math.max(3, Math.round(p * periyotOlcek)), A = (a * genlikOlcek).toFixed(2);
    return `${A}*(2*(2*abs(X/${P}-floor(X/${P}+0.5)))-1)`;
  };
  return `(${t(97, 30)}+${t(41, 15)}+${t(17, 7)})`;
}

// Tek drawtext (textfile): kontur/golge secenekleri ekstra ile
const dt = (ad, metin, tur, punto, renk, x, y, ekstra) => Y.drawtext({ font: tur, metin, dizin: TMP, ad, boyut: punto, renk, x, y, ekstra });

// ---------------------------------------------------------------------------
// ALTIN DEGRADE YAZI
// Once koyu kalin konturu tabana ciziyoruz, sonra sadece harf govdesini
// maske yapip uzerine altin degradeyi bindiriyoruz. Tek drawtext ile
// degrade dolgu yapilamiyor.
// ---------------------------------------------------------------------------
function altinYazi(taban, cikti, W, H, metin, punto, y, konturKalinlik, ad) {
  const mask = path.join(TMP, ad + "-mask.png");
  const grad = path.join(TMP, ad + "-grad.png");
  run(["-f", "lavfi", "-i", `color=c=black:s=${W}x${H}`,
    "-vf", dt(ad + "-m", metin, "impact", punto, "white", "(w-text_w)/2", y),
    "-frames:v", "1", mask], "yazı maskesi");
  run(["-f", "lavfi", "-i",
    `gradients=s=${W}x${H}:c0=0xFFF3C4:c1=0xE0A42B:type=linear:x0=0:y0=${y}:x1=0:y1=${y + punto}`,
    "-frames:v", "1", grad], "altın degrade");
  run(["-i", taban, "-i", grad, "-i", mask,
    "-filter_complex",
      // kontur + govde golgesi
      `[0:v]${dt(ad + "-k", metin, "impact", punto, "0x0A0D10", "(w-text_w)/2", y,
        `borderw=${konturKalinlik}:bordercolor=0x0A0D10:shadowcolor=black@0.75:shadowx=6:shadowy=8`)}[b];` +
      `[1:v][2:v]alphamerge[g];[b][g]overlay=0:0`,
    "-frames:v", "1", cikti], "altın yazı bindirme");
}

// ---------------------------------------------------------------------------
// PROFIL RESMI 1024x1024
// YouTube daireye kirpiyor: onemli her sey merkezdeki daire icinde.
// ---------------------------------------------------------------------------
function profil(sec, kanal, rozet) {
  // 1024 — YouTube bazi ekranlarda "en az 1024x576" istiyor, 800x800 reddediliyor.
  // Kare kalmali (daireye kirpiliyor), o yuzden 1024x1024.
  const S = 1024, M = S / 2, k = S / 800;   // k: 800'e gore olceklenen olculer
  const z = zikzak(0.55 * k, 0.62 * k);
  const a1 = path.join(TMP, "pp-a.png"), a2 = path.join(TMP, "pp-b.png");

  run([
    "-i", sec(0), "-i", sec(1),
    "-filter_complex", [
      // ust yari — sicak, kontrastli
      `[0:v]scale=${S}:${M}:force_original_aspect_ratio=increase,crop=${S}:${M},` +
        `eq=contrast=1.22:saturation=1.35:brightness=-0.03,` +
        `colorbalance=rs=.10:rm=.10:bs=-.06,unsharp=5:5:0.7[t]`,
      // alt yari — soguk govde, ust yaridan ayrilsin
      `[1:v]scale=${S}:${M}:force_original_aspect_ratio=increase,crop=${S}:${M},` +
        `eq=contrast=1.22:saturation=1.20:brightness=-0.06,` +
        `colorbalance=rs=-.06:bs=.12:bm=.06,unsharp=5:5:0.7[b]`,
      `[t][b]vstack=inputs=2[v0]`,
      // merkeze odaklayan vinyet + hafif karartma
      `[v0]vignette=angle=PI/3.4:x0=${M}:y0=${M},eq=brightness=-0.05[v1]`,
      // simsek ayrac: halo + cekirdek
      `[v1]geq=` +
        `r='if(lt(abs(Y-${M}-${z}),3.2),245,if(lt(abs(Y-${M}-${z}),11),140,r(X,Y)))':` +
        `g='if(lt(abs(Y-${M}-${z}),3.2),252,if(lt(abs(Y-${M}-${z}),11),190,g(X,Y)))':` +
        `b='if(lt(abs(Y-${M}-${z}),3.2),255,if(lt(abs(Y-${M}-${z}),11),210,b(X,Y)))'[v2]`,
      // daire kirpma sinirinda altin halka (kirpik icinde kalir)
      `[v2]geq=` +
        `r='if(between(hypot(X-${M},Y-${M}),${Math.round(372 * k)},${Math.round(384 * k)}),224,r(X,Y))':` +
        `g='if(between(hypot(X-${M},Y-${M}),${Math.round(372 * k)},${Math.round(384 * k)}),164,g(X,Y))':` +
        `b='if(between(hypot(X-${M},Y-${M}),${Math.round(372 * k)},${Math.round(384 * k)}),43,b(X,Y))'`,
    ].join(";"),
    "-frames:v", "1", a1,
  ], "profil taban");

  // ROZET (eskiden hep "VS") — altin degrade, kalin kontur; uzunluga gore punto kuculur
  const rozetPunto = Y.sigdir(rozet, 620 * k, Math.round(300 * k), 0.55);
  altinYazi(a1, a2, S, S, rozet, rozetPunto, Math.round(M - rozetPunto * 0.59), Math.round(rozetPunto * 0.06), "rozet");

  // alt kenara kanal adi (genislige sigdirilir)
  const adPunto = Y.sigdir(kanal, 800 * k, Math.round(46 * k), 0.58);
  const dosya = path.join(CIKIS, `Profile Picture ${S}x${S}.png`);
  ciktiYaz(["-i", a2, "-vf",
    dt("pp-ad", kanal, "kalin", adPunto, "white", "(w-text_w)/2", Math.round(S - 150 * k),
      `borderw=${Math.round(7 * k)}:bordercolor=0x0A0D10:shadowcolor=black@0.8:shadowx=3:shadowy=4`),
    "-frames:v", "1"], dosya, "profil ad");
  return boyutKontrol(dosya, 4 * 1024 * 1024);
}

// Dosya sinirin ustundeyse ayni gorseli JPG'ye cevirir (png silinir). Donus: son dosya yolu.
// Ayni adli ONCEKI KOSUDAN kalma obur uzanti (png <-> jpg) silinir: klasorde iki surum kalip yanlisi yuklenmesin.
function boyutKontrol(png, sinir) {
  const jpg = png.replace(/\.png$/i, ".jpg");
  if (fs.statSync(png).size <= sinir) { sil(jpg); return png; }
  const part = RF.partYolu(jpg);
  let sigdi = false;
  try {
    for (const q of [2, 3, 5, 8]) {
      sil(part);
      run(["-i", png, "-q:v", String(q), "-frames:v", "1", part], "jpg dönüşümü");
      sigdi = fs.statSync(part).size <= sinir;
      if (sigdi) break;
    }
    RF.partBitir(part, jpg);
  } finally { sil(part); }
  try { fs.unlinkSync(png); } catch (e) { ortak.uyari(path.basename(png) + " silinemedi (başka programda açık olabilir): yüklemek için " + path.basename(jpg) + " dosyasını kullan."); }
  console.log("  " + path.basename(png) + " " + (sinir / 1048576).toFixed(1) + " MB sınırını aşıyordu: JPG olarak kaydedildi");
  if (!sigdi) ortak.uyari(path.basename(jpg) + " en düşük kalitede bile " + (sinir / 1048576).toFixed(1) + " MB'ı aşıyor.");
  return jpg;
}

// ---------------------------------------------------------------------------
// BANNER 2560x1440
// Guvenli alan 1546x423 (telefonda SADECE o gorunuyor) — yazilar orada.
// Kenarlardaki gorseller masaustunde gorunur, bu alanin dogru kullanimi.
// ---------------------------------------------------------------------------
function banner(sec, kanal, slogan, altMetin) {
  const W = 2560, H = 1440, MY = H / 2;
  // 6 dar sutun ozneleri taninmaz hale getiriyordu. 4 x 640 = tam 2560 ve
  // her gorsel seciliyor.
  const SIRA = [sec(0), sec(1), sec(2), sec(3)];
  const TW = Math.ceil(W / SIRA.length);          // 640
  const z = zikzak(1.9, 2.1);
  const a1 = path.join(TMP, "bn-a.png"), a2 = path.join(TMP, "bn-b.png");

  const girisler = [];
  SIRA.forEach(f => { girisler.push("-i", f); });

  const f = [];
  SIRA.forEach((_, i) => {
    f.push(`[${i}:v]scale=${TW}:${H}:force_original_aspect_ratio=increase,crop=${TW}:${H},` +
           `eq=contrast=1.14:saturation=0.80:brightness=-0.06,setsar=1[p${i}]`);
  });
  f.push(SIRA.map((_, i) => `[p${i}]`).join("") + `hstack=inputs=${SIRA.length}[strip]`);
  // hstack cikis genisligi kaynak oranlarina gore degisebiliyor; scale ile tam olcuye getir.
  f.push(`[strip]scale=${W}:${H}[bg]`);
  // Genis merkez karartmasi resmi camura ceviriyordu. Yerine yazinin arkasina
  // tasarlanmis bir sinema bandi: her yerde okunur ve kasitli duruyor.
  f.push(`[bg]geq=` +
    `r='r(X,Y)*min(1, 0.52 + 0.00042*abs(X-${W / 2}))':` +
    `g='g(X,Y)*min(1, 0.52 + 0.00042*abs(X-${W / 2}))':` +
    `b='b(X,Y)*min(1, 0.54 + 0.00042*abs(X-${W / 2}))'[dim]`);
  f.push(`[dim]vignette=angle=PI/4.2,eq=brightness=-0.04,` +
    `drawbox=x=0:y=${MY - 310}:w=${W}:h=620:color=0x080B0E@0.80:t=fill,` +
    `drawbox=x=0:y=${MY - 310}:w=${W}:h=3:color=${VURGU}@0.55:t=fill,` +
    `drawbox=x=0:y=${MY + 307}:w=${W}:h=3:color=${VURGU}@0.55:t=fill[v1]`);
  // simsek
  f.push(`[v1]geq=` +
    `r='if(lt(abs(Y-${MY}-${z}),4.5),245,if(lt(abs(Y-${MY}-${z}),16),135,r(X,Y)))':` +
    `g='if(lt(abs(Y-${MY}-${z}),4.5),252,if(lt(abs(Y-${MY}-${z}),16),186,g(X,Y)))':` +
    `b='if(lt(abs(Y-${MY}-${z}),4.5),255,if(lt(abs(Y-${MY}-${z}),16),206,b(X,Y)))'`);

  run([...girisler, "-filter_complex", f.join(";"), "-frames:v", "1", a1], "banner taban");

  // --- YAZI DUZENI: guvenli alanin (y 508-931) ICINDE, dikeyde ortali ---
  const gen = GUVENLI.x1 - GUVENLI.x0 - 60;           // yatay pay
  const adPunto = Y.sigdir(kanal, gen, 170, 0.5);      // Impact ~0.5 x punto
  const sloganPunto = slogan ? Y.sigdir(slogan, gen, 54, 0.56) : 0;
  const altPunto = altMetin ? Y.sigdir(altMetin, gen, 36, 0.56) : 0;
  const BOSLUK = 22;
  const adKutu = Math.round(adPunto * 1.12), cizgi1 = 14;
  const bloklar = [adKutu, cizgi1];
  if (sloganPunto) bloklar.push(Math.round(sloganPunto * 1.15), BOSLUK);
  if (altPunto) bloklar.push(cizgi1, Math.round(altPunto * 1.15));
  const toplam = bloklar.reduce((a, b) => a + b, 0);
  let y = Math.round(MY - toplam / 2);
  if (y < GUVENLI.y0 + 8) y = GUVENLI.y0 + 8;
  const adY = y; y += adKutu;
  const cizgiY = y + 4; y += cizgi1;
  let sloganY = 0, altCizgiY = 0, altY = 0;
  if (sloganPunto) { sloganY = y; y += Math.round(sloganPunto * 1.15) + BOSLUK; }
  if (altPunto) { altCizgiY = y - 6; y += cizgi1; altY = y; y += Math.round(altPunto * 1.15); }

  // kanal adi — altin degrade
  altinYazi(a1, a2, W, H, kanal, adPunto, adY, Math.max(6, Math.round(adPunto / 11)), "ban-ad");

  const dosya = path.join(CIKIS, "Banner 2560x1440.png");
  const vf = [`drawbox=x=${W / 2 - 430}:y=${cizgiY}:w=860:h=4:color=${VURGU}@0.95:t=fill`];
  if (sloganPunto) vf.push(dt("ban-slogan", slogan, "kalin", sloganPunto, "white", "(w-text_w)/2", sloganY,
    "borderw=8:bordercolor=0x0A0D10:shadowcolor=black@0.8:shadowx=3:shadowy=4"));
  if (altPunto) {
    vf.push(`drawbox=x=${W / 2 - 240}:y=${altCizgiY}:w=480:h=3:color=${VURGU}@0.55:t=fill`);
    vf.push(dt("ban-alt", altMetin, "kalin", altPunto, "0xD8C79A", "(w-text_w)/2", altY, "borderw=6:bordercolor=0x0A0D10"));
  }
  ciktiYaz(["-i", a2, "-vf", vf.join(","), "-frames:v", "1"], dosya, "banner yazı");
  return { dosya: boyutKontrol(dosya, BANNER_MAKS_BAYT), alan: { adY, adKutu, altBitis: y } };
}

function kontrol(bannerDosya) {
  const dosya = path.join(CIKIS, "_banner-guvenli-alan-kontrol.png");
  ciktiYaz(["-i", bannerDosya, "-vf",
    `drawbox=x=${(2560 - 1546) / 2}:y=${(1440 - 423) / 2}:w=1546:h=423:color=0xFF3B30@0.9:t=5,` +
    `drawbox=x=${(2560 - 1855) / 2}:y=${(1440 - 423) / 2}:w=1855:h=423:color=0xFFCC00@0.7:t=3,` +
    dt("kontrol", "kırmızı = telefon   sarı = tablet   dışı = masaüstü", "kalin", 42, "white", 40, 40, "borderw=5:bordercolor=black"),
    "-frames:v", "1"], dosya, "kontrol");
  return dosya;
}

async function main() {
  const { konum, bayrak } = ortak.argumanCoz(process.argv.slice(2), { deger: ["rozet", "alt-metin", "dil"] });
  const ayar = ortak.ayarOku();
  const AD = String(konum[0] || ayar.kanal || "CHANNEL NAME");
  if (!konum[0] && (!ayar.kanal || ayar.kanal === "KANALIM")) ortak.uyari("Kanal adı verilmedi ve panel ayarında yok: '" + AD + "' kullanıldı.");
  const SLOGAN = konum[1] !== undefined ? String(konum[1]) : String(ayar.slogan || "");
  const dil = String(bayrak.dil && bayrak.dil !== true ? bayrak.dil : ayar.dil || "en").slice(0, 2).toLowerCase();
  // rozet onceligi: --rozet bayragi > panel ayari (doluysa) > kanal adinin bas harfleri
  const ROZET = String(bayrak.rozet && bayrak.rozet !== true ? bayrak.rozet : "").trim() || String(ayar.rozet || "").trim() || rozetTuret(AD, dil);
  const ALT = bayrak["alt-metin"] !== undefined
    ? (bayrak["alt-metin"] === true ? "" : String(bayrak["alt-metin"]))
    : (ayar.bannerAltMetin || ALT_METIN[dil] || ALT_METIN.en);
  // vurgu rengi drawbox filtre dizgisine girer: elle bozulmus panel-ayar.json filtreyi bozmasin / secenek sokmasin
  const hamVurgu = ayar.vurguRenk;
  if (hamVurgu !== undefined && hamVurgu !== null && hamVurgu !== "" && renkKodu(hamVurgu) !== String(hamVurgu).toUpperCase())
    ortak.uyari("Panel ayarındaki vurgu rengi geçersiz (6 haneli hex olmalı, # yok): varsayılan 6FD8FF kullanıldı.");
  VURGU = "0x" + renkKodu(hamVurgu);
  FF = require("./ff-yol").ffmpeg;

  // Cikis klasoru: 3. argumanla verilir, verilmezse repo icinde "marka/".
  CIKIS = path.resolve(konum[2] || path.join(__dirname, "marka"));
  TMP = path.join(CIKIS, ".tmp");
  fs.mkdirSync(CIKIS, { recursive: true });
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* kilitli: uzerine yazilir */ }     // onceki yarim kosudan kalan ara dosyalar
  fs.mkdirSync(TMP, { recursive: true });

  try {
    const HAVUZ = gorselleriTopla();
    if (HAVUZ.length < 2)
      throw new ortak.OrtakHata("gorsel_yok", "En az 2 görsel gerekiyor: önce bir video üret ya da MARKA_GORSEL=<klasör> ver.", {
        cikis: ortak.CIKIS.YETERSIZ, cozum: 'MARKA_GORSEL=<klasor> node marka-yap.js "KANAL ADI" "SLOGAN"' });
    // profil: ilk iki gorsel · banner: ilk dort (yeterince yoksa basa doner)
    const sec = i => HAVUZ[i % HAVUZ.length];

    const p = profil(sec, AD, ROZET);
    const b = banner(sec, AD, SLOGAN, ALT);
    const k = kontrol(b.dosya);
    console.log("KANAL: " + AD + (ROZET ? " (rozet " + ROZET + ")" : ""));
    console.log("  " + p);
    console.log("  " + b.dosya);
    console.log("  " + k + "   (yüklenmez)");
    ortak.sonuc({ profil: p, banner: b.dosya, kontrol: k });
  } finally {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* kilitli */ }
  }
}

if (require.main === module) main().catch(ortak.bitir);
module.exports = { main, zikzak, GUVENLI, rozetTuret };
