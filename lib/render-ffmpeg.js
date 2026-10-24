// lib/render-ffmpeg.js — render icin ffmpeg/ffprobe calistirma katmani.
//
// Tum video adimlari buradan gecer:
//   - ZAMAN ASIMI: her adim sureye gore makul bir sinirla calisir; takilan ffmpeg oldurulur.
//   - GPU -> CPU: kodlayici hatasi (nvenc/amf/"Error while opening encoder") gorulurse GPU
//     kapatilir, ayni adim x264 ile BIR kez tekrarlanir (render ortasinda da calisir).
//   - ILERLEME: -progress pipe:1 okunur, adim icindeki yuzde disariya verilir.
//   - HATA: stderr'in son satirlari Turkce tek cumlelik OrtakHata'ya cevrilir.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const ortak = require("./ortak");
const ffyol = require("../ff-yol");

const ffmpegYolu = () => ffyol.ffmpeg;
const ffprobeYolu = () => ffyol.ffprobe;

// ---------------------------------------------------------------- calisan cocuklar
// Sunucu ya da kullanici sureci oldurunce ffmpeg cocuklari sahipsiz kalmasin.
const aktif = new Set();
process.on("exit", () => { for (const c of aktif) { try { c.kill("SIGKILL"); } catch (e) { /* zaten bitmis */ } } });

// ---------------------------------------------------------------- kodlayici secimi
// GPU kodlama (NVENC/AMF) CPU'dan ~5 kat hizli ama surucu eskiyse ffmpeg hata verir.
// O yuzden ONCE DENIYORUZ; calisirsa kullaniriz. Render ortasinda hata verirse CPU'ya geceriz.
const CPU_ARA = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"];
const CPU_SON = ["-c:v", "libx264", "-preset", "medium", "-crf", "20"];
const durum = { denendi: false, gpu: null, kapali: false };

// RENK BILGISI: HD icin standart BT.709 + SINIRLI (tv) aralik, tum ara dosyalarda ve finalde. Eskiden JPEG kaynakli klipler
// "yuvj420p / tam aralik", PNG kaynakli kartlar "yuv420p / etiketsiz" cikiyor, birlesince final yuvj420p (tam aralik)
// isaretli kaliyordu: etiketi yok sayan/tam araligi bilmeyen oynaticilar (bazi telefonlar, editorler) videoyu soluk gosterir.
const RENK_ETIKET = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const RENK_SETPARAMS = "setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709";
const RENK_YUV_SON = "format=yuv420p," + RENK_SETPARAMS;                                              // zaten YUV olan akis icin
const RENK_RGB_YUV = "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p," + RENK_SETPARAMS;    // RGB akisi -> BT.709 tv YUV

function gpuDene() {
  if (ortak.envOku("VIDEO_KODEK").toLowerCase() === "cpu") return null;      // .env'e ya da ortama yazilabilir
  const adaylar = [
    { ad: "NVIDIA NVENC", marka: "nvidia", argv: ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "20"] },
    { ad: "AMD AMF", marka: "amd", argv: ["-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i", "20", "-qp_p", "22"] },
  ];
  for (const a of adaylar) {
    try {
      execFileSync(ffmpegYolu(), ["-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=1", ...a.argv, "-an",
        "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"],
        { stdio: "ignore", timeout: 25000, windowsHide: true });
      return a;
    } catch (e) { /* bu kodlayici yok ya da surucu eski — sonrakine bak */ }
  }
  return null;
}

// Donus: { ad, gpu, marka, ara:[...], son:[...] }  (ara = ara dosyalar, son = final)
function kodekler() {
  if (!durum.denendi) { durum.denendi = true; durum.gpu = gpuDene(); }
  if (durum.gpu && !durum.kapali) {
    return { ad: durum.gpu.ad, gpu: true, marka: durum.gpu.marka, ara: [...durum.gpu.argv, ...RENK_ETIKET], son: [...durum.gpu.argv, ...RENK_ETIKET] };
  }
  return { ad: "libx264", gpu: false, marka: "cpu", ara: [...CPU_ARA, ...RENK_ETIKET], son: [...CPU_SON, ...RENK_ETIKET] };
}
function gpuKapat() { durum.kapali = true; }
function gpuAcikMi() { return !!durum.gpu && !durum.kapali; }

const KODLAYICI_HATASI = /nvenc|\bamf\b|h264_amf|Error while opening encoder|OpenEncodeSession|Could not open encoder|No capable devices found|Cannot load nvcuda|CUDA_ERROR|encoder.*(fail|not (found|supported))|Failed to create|InitializeEncoder|out of memory/i;
const kodlayiciHatasiMi = e => !!(e && KODLAYICI_HATASI.test(String((e.ffStderr || "") + " " + (e.message || ""))));

// ---------------------------------------------------------------- tek ffmpeg calistirma
function sonSatirlar(err) {
  return String(err || "").split(/\r?\n/).map(s => s.trim()).filter(s =>
    s && !/^(built with|configuration:|lib(av|sw|postproc)\w*\s+\d)/i.test(s));
}

// argv: -y/-hide_banner/-loglevel BURADA eklenir. secenek:
//   cwd, etiket, zamanAsimiMs, ilerleme(sn) -> adim icinde cikti suresi (sn)
function calistirTek(argv, secenek) {
  const o = secenek || {};
  return new Promise((coz, red) => {
    const tam = ["-y", "-hide_banner", "-loglevel", "error", "-nostats"];
    if (o.ilerleme) tam.push("-progress", "pipe:1");
    tam.push(...argv);
    const c = spawn(ffmpegYolu(), tam, { cwd: o.cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    aktif.add(c);
    let err = "", tampon = "", zamanAsimi = false, bitti = false;
    const sinir = o.zamanAsimiMs || 600000;
    const t = setTimeout(() => { zamanAsimi = true; try { c.kill("SIGKILL"); } catch (e) { /* bitmis */ } }, sinir);
    const bitir = (fn, v) => { if (bitti) return; bitti = true; clearTimeout(t); aktif.delete(c); fn(v); };
    c.stdout.on("data", d => {
      if (!o.ilerleme) return;
      tampon += d.toString("utf8");
      let i;
      while ((i = tampon.indexOf("\n")) >= 0) {
        const satir = tampon.slice(0, i).trim(); tampon = tampon.slice(i + 1);
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(satir);
        if (m) { try { o.ilerleme(Number(m[1]) / 1e6); } catch (e) { /* ilerleme hatasi isi bozmasin */ } }
      }
    });
    c.stderr.on("data", d => { err += d.toString("utf8"); if (err.length > 300000) err = err.slice(-150000); });
    c.on("error", e => {
      bitir(red, new ortak.OrtakHata("ffmpeg_yok", "ffmpeg başlatılamadı: " + e.message, { cikis: ortak.CIKIS.GIRDI,
        cozum: "ffmpeg kurulu mu? Windows'ta 'winget install Gyan.FFmpeg' ile kur." }));
    });
    c.on("close", kod => {
      if (zamanAsimi) {
        const sure = sinir < 60000 ? Math.round(sinir / 1000) + " saniyede" : (Math.round(sinir / 6000) / 10) + " dakikada";
        const e = new ortak.OrtakHata("ffmpeg_zaman_asimi", "ffmpeg adımı " + sure + " bitmedi" +
          (o.etiket ? " (" + o.etiket + ")" : "") + "; durduruldu.", { cikis: ortak.CIKIS.GENEL,
          cozum: "Bilgisayar çok yoğun olabilir; diğer programları kapatıp tekrar dene (iş kaldığı yerden sürer)." });
        e.ffStderr = err; return bitir(red, e);
      }
      if (kod === 0) return bitir(coz, { stderr: err });
      const satirlar = sonSatirlar(err);
      const son = satirlar[satirlar.length - 1] || ("çıkış kodu " + kod);
      let e;
      if (/No space left on device|ENOSPC/i.test(err)) {
        e = new ortak.OrtakHata("disk_dolu", "Diskte boş yer kalmadı; ffmpeg yazamadı.", { cikis: ortak.CIKIS.DISK,
          cozum: "Disk alanı aç (panelde Disk bölümünden ara dosyaları temizle) ve tekrar dene.", detay: satirlar.slice(-6) });
      } else if (/Invalid data found when processing input|moov atom not found/i.test(err)) {
        e = new ortak.OrtakHata("ffmpeg_girdi", "ffmpeg bir girdi dosyasını okuyamadı" + (o.etiket ? " (" + o.etiket + ")" : "") + ": " + son,
          { cikis: ortak.CIKIS.YETERSIZ, detay: satirlar.slice(-12) });
      } else {
        e = new ortak.OrtakHata("ffmpeg", "ffmpeg adımı başarısız" + (o.etiket ? " (" + o.etiket + ")" : "") + ": " + son,
          { cikis: ortak.CIKIS.GENEL, detay: satirlar.slice(-12),
            cozum: "İş kaldığı yerden devam eder: aynı işlemi tekrar çalıştır. Sürerse günlükteki (log) ffmpeg satırlarına bak." });
      }
      e.ffStderr = err; e.ffArgv = tam.slice(0, 14);
      bitir(red, e);
    });
  });
}

// girdi: argv dizisi YA DA (K)=>argv kurucu (K = kodekler()). Kurucu verilirse kodlayici hatasinda
// GPU kapatilip ayni adim CPU ile bir kez tekrarlanir.
async function calistir(girdi, secenek) {
  const kurucu = typeof girdi === "function";
  const dene = () => {
    const K = kodekler();
    return { K, p: calistirTek(kurucu ? girdi(K) : girdi, secenek) };
  };
  const d1 = dene();
  try { return await d1.p; }
  catch (e) {
    if (kurucu && d1.K.gpu && kodlayiciHatasiMi(e)) {
      if (gpuAcikMi()) { gpuKapat(); ortak.uyari("GPU hatası, CPU'ya geçildi"); }
      return (await dene().p);
    }
    throw e;
  }
}

// stderr metnini dondurur (ebur128, loudnorm olcumu icin): -loglevel info ile, hata atmaz
function olc(argv, secenek) {
  const o = secenek || {};
  return new Promise((coz, red) => {
    const c = spawn(ffmpegYolu(), ["-hide_banner", "-nostats", "-loglevel", "info", ...argv],
      { cwd: o.cwd, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    aktif.add(c);
    let err = "";
    const t = setTimeout(() => { try { c.kill("SIGKILL"); } catch (e) { /* bitmis */ } }, o.zamanAsimiMs || 300000);
    c.stderr.on("data", d => { err += d.toString("utf8"); if (err.length > 400000) err = err.slice(-200000); });
    c.on("error", e => { clearTimeout(t); aktif.delete(c); red(e); });
    c.on("close", kod => { clearTimeout(t); aktif.delete(c); coz({ kod, stderr: err }); });
  });
}

// ---------------------------------------------------------------- ffprobe
function bilgi(dosya) {
  let j;
  try {
    j = JSON.parse(execFileSync(ffprobeYolu(), ["-v", "error", "-show_entries",
      "format=duration:stream=codec_type,codec_name,width,height,sample_rate", "-of", "json", dosya],
      { timeout: 30000, windowsHide: true, maxBuffer: 1 << 22 }).toString("utf8"));
  } catch (e) {
    throw new ortak.OrtakHata("dosya_okunamadi", "Dosya okunamadı: " + path.basename(dosya), { cikis: ortak.CIKIS.YETERSIZ,
      detay: String(e.stderr || e.message).slice(-300) });
  }
  const v = (j.streams || []).find(s => s.codec_type === "video");
  const a = (j.streams || []).find(s => s.codec_type === "audio");
  const sure = Number(j.format && j.format.duration);
  return { sure: Number.isFinite(sure) ? sure : null, genislik: v ? v.width : null, yukseklik: v ? v.height : null,
    videoKodek: v ? v.codec_name : null, sesVar: !!a, sesOrnekleme: a ? Number(a.sample_rate) : null };
}
function sureOlc(dosya) {
  const b = bilgi(dosya);
  if (b.sure === null) throw new ortak.OrtakHata("dosya_okunamadi", "Dosyanın süresi okunamadı: " + path.basename(dosya), { cikis: ortak.CIKIS.YETERSIZ });
  return b.sure;
}
// bozuksa false (silmek/yeniden uretmek icin); beklenenSn verilirse +-tol ile karsilastirir
function gecerliMi(dosya, beklenenSn, tol) {
  try {
    if (!fs.existsSync(dosya) || fs.statSync(dosya).size === 0) return false;
    const b = bilgi(dosya);
    if (b.sure === null || b.sure <= 0) return false;
    if (beklenenSn !== undefined && beklenenSn !== null && Math.abs(b.sure - beklenenSn) > (tol === undefined ? 0.15 : tol)) return false;
    return true;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- gorsel dogrulama
const IMZALAR = [
  { ad: "jpeg", ok: b => b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { ad: "png", ok: b => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
  { ad: "webp", ok: b => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" },
];
// { ok, en, boy, neden } — sihirli bayt + ffprobe ile boyut. HTML hata sayfasi, 0 bayt, bozuk dosya elenir.
function gorselDogrula(dosya, yalnizImza) {
  let boyut = 0;
  try { boyut = fs.statSync(dosya).size; } catch (e) { return { ok: false, neden: "dosya yok" }; }
  if (boyut < 200) return { ok: false, neden: "dosya boş ya da çok küçük" };
  let bas;
  try {
    const fd = fs.openSync(dosya, "r");
    try { bas = Buffer.alloc(16); fs.readSync(fd, bas, 0, 16, 0); } finally { fs.closeSync(fd); }
  } catch (e) { return { ok: false, neden: "dosya okunamadı" }; }
  if (!IMZALAR.some(i => i.ok(bas))) return { ok: false, neden: "görsel biçimi tanınmadı (JPEG/PNG/WebP değil)" };
  if (yalnizImza) return { ok: true, bayt: boyut };
  try {
    const b = bilgi(dosya);
    if (!b.genislik || !b.yukseklik) return { ok: false, neden: "görsel boyutu okunamadı" };
    return { ok: true, en: b.genislik, boy: b.yukseklik, bayt: boyut };
  } catch (e) { return { ok: false, neden: "görsel okunamadı" }; }
}

// Ayni dogrulama, olay dongusunu bloklamadan (yuzlerce gorseli paralel dogrulamak icin)
function bilgiAsync(dosya) {
  const { execFile } = require("child_process");
  return new Promise((coz, red) => {
    execFile(ffprobeYolu(), ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,sample_rate",
      "-of", "json", dosya], { timeout: 30000, windowsHide: true, maxBuffer: 1 << 22 }, (e, out) => {
      if (e) return red(e);
      try {
        const j = JSON.parse(String(out));
        const v = (j.streams || []).find(s => s.codec_type === "video");
        const sesVar = (j.streams || []).some(s => s.codec_type === "audio");
        const sure = Number(j.format && j.format.duration);
        coz({ sure: Number.isFinite(sure) ? sure : null, genislik: v ? v.width : null, yukseklik: v ? v.height : null, sesVar });
      } catch (e2) { red(e2); }
    });
  });
}
async function gorselDogrulaAsync(dosya) {
  const on = gorselDogrula(dosya, true);      // yalniz boyut/imza (ffprobe'suz)
  if (!on.ok) return on;
  try {
    const b = await bilgiAsync(dosya);
    if (!b.genislik || !b.yukseklik) return { ok: false, neden: "görsel boyutu okunamadı" };
    return { ok: true, en: b.genislik, boy: b.yukseklik, bayt: on.bayt };
  } catch (e) { return { ok: false, neden: "görsel okunamadı" }; }
}

// Video klip dogrulamasi: { ok, video:true, en, boy, sure, bayt, neden }. 0 bayt / yarim indirme / goruntusuz dosya elenir.
async function videoDogrulaAsync(dosya) {
  let boyut = 0;
  try { boyut = fs.statSync(dosya).size; } catch (e) { return { ok: false, neden: "dosya yok" }; }
  if (boyut < 1024) return { ok: false, neden: "video dosyası boş ya da çok küçük" };
  try {
    const b = await bilgiAsync(dosya);
    if (!b.genislik || !b.yukseklik) return { ok: false, neden: "videoda görüntü akışı yok" };
    if (!(b.sure > 0.1)) return { ok: false, neden: "video süresi okunamadı (yarım indirilmiş olabilir)" };
    return { ok: true, video: true, en: b.genislik, boy: b.yukseklik, sure: b.sure, bayt: boyut };
  } catch (e) { return { ok: false, neden: "video okunamadı" }; }
}

// ---------------------------------------------------------------- paralel calistirma
// Her is kendi hatasini dondurur; digerlerini durdurmaz (bellek darken seri tekrar icin).
async function paralel(liste, n, calis) {
  const sonuc = new Array(liste.length);
  let sira = 0;
  const isci = async () => {
    for (;;) {
      const i = sira++;
      if (i >= liste.length) return;
      try { sonuc[i] = { ok: true, deger: await calis(liste[i], i) }; }
      catch (e) { sonuc[i] = { ok: false, hata: e }; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, liste.length)) }, isci));
  return sonuc;
}

// Surenin (sn) ffmpeg adimi icin makul zaman asimi (ms): taban + sure x carpan
const zamanAsimi = (sn, carpan, tabanSn) => Math.round(((tabanSn || 90) + Math.max(0, sn) * (carpan || 20)) * 1000);

// Isletim sistemine gore bos cihaz
const NULL_CIHAZ = process.platform === "win32" ? "NUL" : "/dev/null";

// Paralellik: cekirdek + bos bellek ile sinirli; NVIDIA tuketici kartlarinda eszamanli
// kodlama oturumu siniri nedeniyle en cok 3.
function paralellik() {
  const bosGB = os.freemem() / 1073741824;
  let n = Math.max(1, Math.min(4, os.cpus().length - 2, Math.floor(bosGB / 1.2)));
  const K = kodekler();
  if (K.gpu && K.marka === "nvidia") n = Math.min(n, 3);
  return { n, bosGB };
}

// concat demuxer satiri: yoldaki tek tirnak '\'' ile kacirilir
const concatSatiri = yol => "file '" + String(yol).replace(/\\/g, "/").replace(/'/g, "'\\''") + "'";

// ---------------------------------------------------------------- atomik cikti (.part -> yeniden adlandir)
// ffmpeg ciktisi dogrudan hedefe YAZILMAZ: <ad>.part.<uzanti>'ya yazilir, basariliysa yeniden adlandirilir.
// Boylece yarida kesilen (Durdur, elektrik, disk dolu) bir adim yarim dosyayi "bitmis" gibi birakmaz.
const partYolu = hedef => hedef.replace(/(\.[^./\\]+)$/, ".part$1");
const KILIT_KODLARI = ["EPERM", "EBUSY", "EACCES"];
const kilitHatasiMi = e => !!e && KILIT_KODLARI.includes(e.code);
const bekle = ms => new Promise(coz => setTimeout(coz, ms));

function kilitliHata(hedef, son, parkta) {
  const ad = path.basename(hedef);
  return new ortak.OrtakHata("cikti_kilitli", "Hazır dosya yeniden adlandırılamadı: " + ad + " başka bir program tarafından açık olabilir.", {
    cikis: ortak.CIKIS.GENEL, detay: son && son.message,
    cozum: parkta
      ? ad + " dosyasını açan programı (video oynatıcı, önizleme) kapatıp işi tekrar çalıştır: bitmiş sonuç saklandı, yeniden kodlanmaz."
      : ad + " dosyasını açan programı (video oynatıcı, önizleme, virüs taraması) kapatıp işi tekrar çalıştır." });
}

// Kisa, ESZAMANLI yeniden adlandirma (kapak gibi kucuk cikti icin). Uzun sure beklemesi gereken adimlar partBitirBekle kullanir.
function partBitir(part, hedef) {
  let son = null;
  for (let i = 0; i < 6; i++) {
    try { fs.renameSync(part, hedef); return; }
    catch (e) {
      son = e;
      if (!kilitHatasiMi(e)) break;
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60 * (i + 1)); } catch (e2) { /* bekleme olmadi */ }
    }
  }
  throw kilitliHata(hedef, son, false);
}

// Hedef dosya baska bir programda acikken (Windows'ta oynatici, paylasimsiz sayac) yeniden adlandirma BASARISIZ olur. Saatler
// suren final kodlamasi bu yuzden kaybolmasin diye: (1) hedef ACILANA kadar beklenir (o.kilitBeklemeSn; yoksa 3 sn, ortamdan
// RENDER_KILIT_BEKLEME_SN ile degistirilir), kullanici programi kapatinca islem kendiliginden surer; (2) sure dolarsa ve
// o.park verilmisse bitmis dosya park klasorune (.bekleyen) tasinir — .part gibi baslangicta SILINMEZ — ve sonraki calisma
// ayni imzayla onu bulup yeniden kodlamadan hedefe yerlestirir.
// o: { kilitBeklemeSn, park:{klasor, imza, beklenenSn}, yenidenAdlandir (test) }
async function partBitirBekle(part, hedef, o) {
  const op = o || {};
  const ren = op.yenidenAdlandir || fs.renameSync;
  const envHam = String(ortak.envOku("RENDER_KILIT_BEKLEME_SN") || "").trim();
  const envSn = envHam !== "" ? Number(envHam) : NaN;
  const bekleSn = Number.isFinite(envSn) && envSn >= 0 ? envSn : (op.kilitBeklemeSn !== undefined ? op.kilitBeklemeSn : 3);
  const bas = Date.now();
  let son = null, uyarildi = false, sonYazi = 0;
  for (let i = 0; ; i++) {
    try { ren(part, hedef); return; }
    catch (e) {
      son = e;
      if (!kilitHatasiMi(e)) break;
      const gecen = (Date.now() - bas) / 1000;
      if (gecen >= bekleSn) break;
      if (bekleSn > 5) {
        if (!uyarildi && gecen >= 2) {
          uyarildi = true; sonYazi = gecen;
          ortak.uyari(path.basename(hedef) + " başka bir programda açık görünüyor: kapatırsan işlem kendiliğinden sürer (en çok " + Math.round(bekleSn) + " sn beklenecek).");
        } else if (uyarildi && gecen - sonYazi >= 15) {
          sonYazi = gecen;
          console.log("  " + path.basename(hedef) + " hâlâ açık, bekleniyor... (" + Math.round(gecen) + "/" + Math.round(bekleSn) + " sn)");
        }
      }
      await bekle(i < 5 ? 60 * (i + 1) : 500);
    }
  }
  if (!kilitHatasiMi(son))
    throw new ortak.OrtakHata("cikti_yazilamadi", "Hazır dosya yerine konamadı: " + path.basename(hedef) + " (" + (son && son.code || (son && son.message)) + ")", {
      cikis: ortak.CIKIS.GENEL, detay: son && son.message, cozum: "Klasörün var ve yazılabilir olduğundan emin olup işi tekrar çalıştır." });
  const parkYolu = op.park ? bekletKaydet(part, hedef, op.park) : null;
  throw kilitliHata(hedef, son, !!parkYolu);
}

// ---- bekleyen (kilitli hedef yuzunden yerlestirilemeyen) bitmis sonuc
const bekleyenYolu = (hedef, klasor) => path.join(klasor, path.basename(hedef).replace(/(\.[^./\\]+)$/, ".bekleyen$1"));
function bekletKaydet(part, hedef, park) {
  try {
    fs.mkdirSync(park.klasor, { recursive: true });
    const b = bekleyenYolu(hedef, park.klasor);
    try { fs.unlinkSync(b); } catch (e) { /* yok */ }
    fs.renameSync(part, b);
    ortak.atomikJsonYaz(b + ".json", { surum: 1, imza: park.imza, hedef: path.basename(hedef), beklenenSn: park.beklenenSn,
      bayt: fs.statSync(b).size, zaman: new Date().toISOString() });
    return b;
  } catch (e) { return null; }          // park edilemedi (ornegin baska surucu): .part yerinde kalir, hata yine verilir
}
// Onceki calismadan kalan bekleyen sonuc AYNI imzada ve saglamsa hedefe yerlestirilir (true); degilse silinir (false).
async function bekleyeniUygula(hedef, o) {
  const b = bekleyenYolu(hedef, o.park.klasor), j = b + ".json";
  if (!fs.existsSync(b)) { try { fs.unlinkSync(j); } catch (e) { /* yok */ } return false; }
  let m = null;
  try { m = JSON.parse(fs.readFileSync(j, "utf8")); } catch (e) { m = null; }
  let saglam = false;
  try { saglam = !!m && m.imza === o.park.imza && (!m.bayt || fs.statSync(b).size === m.bayt) && gecerliMi(b, o.park.beklenenSn, 0.5); } catch (e) { saglam = false; }
  if (!saglam) { for (const x of [b, j]) { try { fs.unlinkSync(x); } catch (e) { /* yok */ } } return false; }
  console.log("  " + path.basename(hedef) + ": önceki çalışmada tamamlanıp hedef dosya açık olduğu için saklanan sonuç bulundu — yeniden kodlanmıyor");
  try { await partBitirBekle(b, hedef, Object.assign({}, o, { park: null })); }
  catch (e) { if (e && e.kod === "cikti_kilitli") throw kilitliHata(hedef, e, true); throw e; }
  try { fs.unlinkSync(j); } catch (e) { /* yok */ }
  return true;
}
// Kurucu (K)=>argv, SON argumani cikti yolu OLMAYAN dizi doner; cikti burada eklenir.
// secenek.girdiler: bu adimin girdisi olan ara dosyalar. Adim "girdi okunamadi" ile dusuyorsa bozuk olan girdi
// (ffprobe sureyi okur ama kare verisi bozuk olabilir) bulunup SILINIR ve cagirana 'ara_dosya_bozuk' firlatilir:
// aksi halde bozuk dosya onbellekte kalir ve her yeniden denemede ayni hata tekrarlanirdi.
// secenek.kilitBeklemeSn / secenek.park: hedef baska programda aciksa beklenir, hala aciksa bitmis sonuc saklanir (partBitirBekle).
async function uret(hedef, kurucu, secenek) {
  const part = partYolu(hedef);
  if (secenek && secenek.park && await bekleyeniUygula(hedef, secenek)) return hedef;
  try { fs.unlinkSync(part); } catch (e) { /* yok */ }
  try {
    await calistir(K => [...(typeof kurucu === "function" ? kurucu(K) : kurucu), part], secenek);
  } catch (e) {
    try { fs.unlinkSync(part); } catch (e2) { /* yok */ }
    const girdiler = secenek && Array.isArray(secenek.girdiler) ? secenek.girdiler : [];
    if (girdiler.length && (e.kod === "ffmpeg_girdi" || /Invalid data|moov atom|Error submitting packet|decoder/i.test(String(e.ffStderr || e.message)))) {
      const bozuk = [];
      for (const g of girdiler) if (!(await tamDogrula(g))) bozuk.push(g);
      for (const g of bozuk) { try { fs.unlinkSync(g); } catch (e2) { /* kilitli: sonraki calismada tekrar denenir */ } }
      if (bozuk.length) {
        const h = new ortak.OrtakHata("ara_dosya_bozuk", "Ara dosya bozuk çıktı ve silindi: " + bozuk.map(g => path.basename(g)).join(", "), {
          cikis: ortak.CIKIS.GENEL, cozum: "İşi aynı şekilde tekrar çalıştır: silinen ara dosyalar yeniden üretilir (başka bir şey yapmana gerek yok)." });
        h.silinen = bozuk;
        throw h;
      }
    }
    throw e;
  }
  await partBitirBekle(part, hedef, secenek);
  return hedef;
}

// Ara dosyanin ICINDEKI bozulmayi yakalar (ffprobe yalniz basligi/sureyi okur): video akisini bastan sona cozer, ilk
// hatada durur. Pahali oldugundan yalniz bir adim "girdi okunamadi" ile dustugunde, suclu girdiyi bulmak icin cagrilir.
function tamDogrula(dosya, zamanAsimiMs) {
  return new Promise(coz => {
    let c, bitti = false, t = null;
    const bit = v => { if (bitti) return; bitti = true; clearTimeout(t); if (c) aktif.delete(c); coz(v); };
    try {
      c = spawn(ffmpegYolu(), ["-v", "error", "-xerror", "-i", dosya, "-map", "0:v:0", "-f", "null", NULL_CIHAZ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    } catch (e) { return bit(true); }                    // calistirilamadi: dosyayi suclama
    aktif.add(c);
    let err = "";
    t = setTimeout(() => { try { c.kill("SIGKILL"); } catch (e) { /* bitmis */ } bit(true); }, zamanAsimiMs || 300000);   // takildi: suclama
    c.stderr.on("data", d => { err += d.toString("utf8"); if (err.length > 20000) err = err.slice(-10000); });
    c.on("error", () => bit(true));
    c.on("close", kod => bit(kod === 0 && !err.trim()));
  });
}

module.exports = {
  ffmpegYolu, ffprobeYolu, kodekler, gpuKapat, gpuAcikMi, kodlayiciHatasiMi,
  calistir, calistirTek, olc, bilgi, bilgiAsync, sureOlc, gecerliMi, gorselDogrula, gorselDogrulaAsync, videoDogrulaAsync,
  paralel, zamanAsimi, paralellik, NULL_CIHAZ, concatSatiri, sonSatirlar,
  partYolu, partBitir, partBitirBekle, bekleyenYolu, uret, tamDogrula, RENK_ETIKET, RENK_SETPARAMS, RENK_YUV_SON, RENK_RGB_YUV,
};
