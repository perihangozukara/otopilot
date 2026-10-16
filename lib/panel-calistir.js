// PANEL: ISLEM CALISTIRICI — betikleri surec olarak calistirir, zincir/kilit/slot/log/durum.json/onay/yetim yonetimi.
// (SOZLESME 6.2, 6.3, 7.) Disk-bagimsiz cekirdek: fabrika fonksiyonu, testlerde sahte betik klasoruyle calisir.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ortak = require("./ortak");
const komutlar = require("./panel-komutlar");
const isler = require("./panel-isler");
const { HttpHata } = require("./panel-http");

const WIN = process.platform === "win32";
const iso = ms => new Date(ms).toISOString();
const BITIS_DURUMLARI = new Set(["bitti", "hata", "durduruldu"]);
const ETKIN_DURUMLAR = new Set(["calisiyor", "sirada"]);       // is kilidi tutan durumlar (onay_bekliyor tutmaz)

// kucuk sayac-semafor: al() sirada bekletir, birak() siradakini uyandirir
function semafor(maks) {
  let kul = 0; const bekleyen = [];
  return {
    kullanilan: () => kul, bekleyen: () => bekleyen.length,
    al(k, onBekle) {
      return new Promise(coz => {
        if (kul < maks) { kul++; return coz(true); }
        bekleyen.push({ k, coz });
        if (onBekle) onBekle();
      });
    },
    birak() {
      kul = Math.max(0, kul - 1);
      while (kul < maks && bekleyen.length) { const b = bekleyen.shift(); kul++; b.coz(true); }
    },
    iptal(k) {
      const i = bekleyen.findIndex(b => b.k === k);
      if (i < 0) return false;
      bekleyen.splice(i, 1)[0].coz(false); return true;
    },
  };
}

// surec agacini oldur: Windows'ta taskkill /T /F, digerlerinde surec grubu (detached acildi)
function agaciOldur(pid, surec) {
  if (!pid) return;
  if (WIN) {
    try {
      const t = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      t.on("error", () => { try { surec && surec.kill(); } catch (e) {} });
    } catch (e) { try { surec && surec.kill(); } catch (e2) {} }
  } else {
    try { process.kill(-pid, "SIGTERM"); } catch (e) { try { process.kill(pid, "SIGTERM"); } catch (e2) {} }
    const t = setTimeout(() => { try { process.kill(-pid, "SIGKILL"); } catch (e) { try { process.kill(pid, "SIGKILL"); } catch (e2) {} } }, 5000);
    if (t.unref) t.unref();
  }
}
const pidCanli = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

const CIKIS_ACIKLAMA = {
  2: { kod: "girdi", ozet: "girdi ya da ayar eksik/hatalı.", cozum: "Günlükteki ✗ satırına bak, eksik olanı tamamla." },
  3: { kod: "servis", ozet: "dış servis hata verdi.", cozum: "Anahtarı, krediyi ve internet bağlantısını kontrol edip tekrar dene (iş kaldığı yerden devam eder)." },
  4: { kod: "yetersiz", ozet: "yeterli sonuç alınamadı.", cozum: "Günlükteki ✗ satırı neyin eksik kaldığını söyler; düzeltip tekrar dene." },
  5: { kod: "disk_dolu", ozet: "disk ya da kaynak yetersiz.", cozum: "Disk alanı aç (Disk bölümünden ara dosyaları temizle) ve tekrar dene." },
  6: { kod: "kilit", ozet: "bu iş başka bir yerde çalışıyor.", cozum: "Çalışan işin bitmesini bekle ya da Durdur'a bas." },
  7: { kod: "maliyet", ozet: "maliyet sınırı aşıldı.", cozum: "Ayarlardan maliyet sınırını yükselt ya da işi küçült." },
};

// panel kok/betik/uretim ayarlari: { kok, betikDizini, zamanlar, onkontrol(tur, is, b), isMesguluOlayi }
function calistiriciOlustur(cfg) {
  const KOK = cfg.kok;
  const BETIK = cfg.betikDizini || cfg.kok;
  const T = Object.assign({ bostaUyariSn: 900, bostaOldurSn: 2700, videoBostaOldurSn: 5400, kontrolMs: 5000,
    halka: 2000, zincirMax: 2, saklanan: 40, logSakla: 20 }, cfg.zamanlar || {});
  const uretim = () => ortak.uretimDizini();
  const kayitlar = new Map();           // id -> kayit
  const isKos = new Map();              // is -> id (calisiyor|sirada)
  const onayBekleyen = new Map();       // is -> id
  const yetimler = new Map();           // is -> {pid, komut, baslangic}
  const dinleyiciler = [];
  const zincirSem = semafor(T.zincirMax), agirSem = semafor(1);
  let sayac = 0;
  const yeniId = () => "r" + Date.now().toString(36) + (++sayac).toString(36);

  const ctxKur = () => ({
    ayar: ortak.ayarOku(), anahtarVar: ad => !!ortak.envOku(ad), senaryoVar, konuHam: is => ortak.konuHam(is), uretim: uretim(),
  });
  function senaryoVar(is) {
    try { return fs.readFileSync(path.join(ortak.isDizin(is), "Voice", "SESLENDIRME-TAM-METIN.txt"), "utf8").trim().length >= 50; }
    catch (e) { return false; }
  }

  // ---------------------------------------------------------------- log
  function logDosyasi(k) {
    if (k.logDosya !== undefined) return k.logDosya;
    try {
      if (k.is && !fs.existsSync(ortak.isDizin(k.is))) { k.logDosya = null; return null; }
      const dizin = k.is ? path.join(ortak.isDizin(k.is), "_log") : path.join(uretim(), "_log");
      fs.mkdirSync(dizin, { recursive: true });
      k.logDosya = path.join(dizin, ortak.damga(new Date(k.baslangic)) + "-" + String(k.tur).replace(/[^A-Za-z0-9]/g, "") + ".log");
      // eski gunlukleri buda: yalniz bu bicimdeki dosyalar, en yeni 20 kalir
      const eski = fs.readdirSync(dizin).filter(x => /^\d{8}-\d{6}-.*\.log$/.test(x)).sort();
      for (const x of eski.slice(0, Math.max(0, eski.length - T.logSakla))) { try { fs.unlinkSync(path.join(dizin, x)); } catch (e) {} }
    } catch (e) { k.logDosya = null; }
    return k.logDosya;
  }
  function logDiskeYaz(k) {
    k.logZamanlayici = null;
    if (!k.logTampon.length) return;
    const f = logDosyasi(k);
    const metin = k.logTampon.join("\n") + "\n"; k.logTampon = [];
    if (!f) return;
    try { fs.appendFileSync(f, metin, "utf8"); } catch (e) { /* disk dolu: gunluk kaybi panel isini bozmasin */ }
  }
  function logYaz(k, metin, tip) {
    for (const parca of String(metin).split("\n")) {
      k.n++;
      const s = { n: k.n, t: parca, tip: tip || null, z: Date.now() };
      k.satirlar.push(s);
      if (k.satirlar.length > T.halka) k.satirlar.splice(0, k.satirlar.length - T.halka);
      k.logTampon.push(parca);
    }
    if (!k.logZamanlayici) { k.logZamanlayici = setTimeout(() => logDiskeYaz(k), 400); if (k.logZamanlayici.unref) k.logZamanlayici.unref(); }
  }

  // ---------------------------------------------------------------- durum.json
  function adimOzeti(a) {
    return { ad: a.ad, etiket: a.etiket, komut: a.komut, durum: a.durum, baslangic: a.baslangic ? iso(a.baslangic) : null,
      bitis: a.bitis ? iso(a.bitis) : null, kod: a.kod, yuzde: a.yuzde, ozet: a.ozet || "", istegeBagli: !!a.istegeBagli };
  }
  function durumYaz(k) {
    if (!k.is) return;
    try {
      // is klasoru arsivlendi/silindiyse hayalet klasor olusturma
      if (!fs.existsSync(ortak.isDizin(k.is))) return;
      ortak.atomikJsonYaz(path.join(ortak.isDizin(k.is), "durum.json"), {
        surum: 1, is: k.is, guncelleme: iso(Date.now()),
        son: { tur: k.tur, id: k.id, baslangic: iso(k.baslangic), bitis: k.bitis ? iso(k.bitis) : null, durum: k.durum, kod: k.kod, hata: k.hata || null },
        adimlar: k.adimlar.map(adimOzeti),
      });
    } catch (e) { /* disk dolu ya da klasor yok: panel durum yazamadi diye cokmesin */ }
  }
  let durumZamanlayici = new Set();
  function durumYazGecikmeli(k) {
    if (durumZamanlayici.has(k.id)) return;
    durumZamanlayici.add(k.id);
    const t = setTimeout(() => { durumZamanlayici.delete(k.id); durumYaz(k); }, 1500);
    if (t.unref) t.unref();
  }

  function genelYuzde(k) {
    const w = a => komutlar.AGIRLIK[a.ad] || 5;
    let toplam = 0, tamam = 0;
    for (const a of k.adimlar) {
      toplam += w(a);
      if (a.durum === "bitti" || a.durum === "atlandi" || (a.durum === "hata" && a.istegeBagli)) tamam += w(a);
      else if (a.durum === "calisiyor" && Number.isFinite(a.yuzde)) tamam += w(a) * a.yuzde / 100;
    }
    return toplam ? Math.max(0, Math.min(100, Math.round(tamam / toplam * 100))) : null;
  }

  // ---------------------------------------------------------------- kayit
  function kayitYarat(o) {
    const k = {
      id: yeniId(), is: o.is || null, tur: o.tur, komut: o.komut, baslangic: Date.now(), bitis: null,
      durum: "sirada", kod: null, hata: null, iptal: false, zincir: !!o.zincir, onaysiz: !!o.onaysiz, kuyrukId: o.kuyrukId || null,
      adimlar: o.adimlar.map(a => ({ ad: a.ad, etiket: a.etiket, komut: a.komutlar.map(c => c.betik + (c.argv.length ? " " + c.argv.join(" ") : "")).join(" && "),
        durum: "bekliyor", baslangic: null, bitis: null, kod: null, yuzde: null, ozet: "", istegeBagli: !!a.istegeBagli })),
      kalan: o.adimlar.slice(), tanimlar: o.adimlar.slice(), adimNo: 0, yuzde: null, surec: null, sonCikti: Date.now(), takildi: false,
      satirlar: [], n: 0, logTampon: [], logZamanlayici: null, slotTutuyor: false, agirTutuyor: false, uyarilar: [],
      atlaOnay: !!o.atlaOnay,
    };
    kayitlar.set(k.id, k);
    return k;
  }
  function eskileriAt() {
    const bitenler = Array.from(kayitlar.values()).filter(k => BITIS_DURUMLARI.has(k.durum)).sort((a, b) => a.bitis - b.bitis);
    for (const k of bitenler.slice(0, Math.max(0, bitenler.length - T.saklanan))) kayitlar.delete(k.id);
  }

  // ---------------------------------------------------------------- surec calistirma
  function satirlaraBol(k, kaynak, parca, tampon) {
    tampon.v += parca;
    let i;
    while ((i = tampon.v.indexOf("\n")) >= 0) {
      const satir = tampon.v.slice(0, i); tampon.v = tampon.v.slice(i + 1);
      // "\r" ile ustune yazilan ilerleme: yalniz son parca kalir (112 satirlik sel olmaz)
      const son = satir.replace(/\r+$/, "").split("\r").pop();
      k._isle(son, kaynak);
    }
    if (tampon.v.length > 8192) { const son = tampon.v.split("\r").pop(); tampon.v = ""; k._isle(son, kaynak); }
  }

  function tipBul(satir, kaynak) {
    if (/^\s*✗/.test(satir)) return "err";
    if (/^\s*✓/.test(satir)) return "ok";
    if (/^\s*▶/.test(satir)) return "cmd";
    if (/^\s*⚠/.test(satir)) return "uyari";
    if (kaynak === "err" && /\b(Error|Exception|HATA|Traceback|ENOENT|EACCES)\b/.test(satir)) return "err";
    return null;
  }

  // tek bir betigi calistirir -> {kod, sonuc, hataKaydi, stderrSon, cikanSinyal, iptal, bosta}
  function surecKos(k, a, komut, opt) {
    return new Promise(coz => {
      const yol = path.join(BETIK, komut.betik);
      const sonuc = { kod: null, sonuc: null, hataKaydi: null, stderrSon: [], stdoutSon: [], bosta: false };
      if (!fs.existsSync(yol)) {
        logYaz(k, "✗ " + komut.betik + " bu kurulumda yok.", "err");
        sonuc.kod = 2; sonuc.hataKaydi = { kod: "betik_yok", mesaj: komut.betik + " bu kurulumda yok.", cozum: "Projeyi yeniden indir ya da PANEL.bat'ı yeniden çalıştır." };
        return coz(sonuc);
      }
      let p, bitti = false;
      const bitir = (kod) => {
        if (bitti) return; bitti = true;
        k.surec = null;
        for (const t of ["out", "err"]) { const v = tamponlar[t].v; if (v) { tamponlar[t].v = ""; k._isle(v.replace(/\r+$/, "").split("\r").pop(), t); } }
        if (k.bostaOldu) { sonuc.bosta = true; k.bostaOldu = false; }
        sonuc.kod = kod; coz(sonuc);
      };
      const tamponlar = { out: { v: "" }, err: { v: "" } };
      k._isle = (satir, kaynak) => {
        if (!satir.trim()) return;
        k.sonCikti = Date.now(); k.takildi = false;
        const m = /^@@(ILERLEME|UYARI|SONUC|HATA)\s*(.*)$/.exec(satir);
        if (m) {
          let o = null;
          if (m[1] !== "UYARI") { try { o = JSON.parse(m[2]); } catch (e) { o = null; } }
          if (m[1] === "ILERLEME" && o) {
            if (Number.isFinite(o.yuzde)) a.yuzde = Math.max(0, Math.min(100, o.yuzde));
            a.ozet = String(o.asama || "") + (o.n != null && o.toplam ? " " + o.n + "/" + o.toplam : "");
            k.yuzde = k.zincir ? genelYuzde(k) : (Number.isFinite(a.yuzde) ? a.yuzde : null);
            durumYazGecikmeli(k);
          } else if (m[1] === "UYARI") {
            logYaz(k, "⚠ " + m[2], "uyari"); k.uyarilar.push(m[2]);
          } else if (m[1] === "SONUC" && o) {
            sonuc.sonuc = o;
            if (o.atlandi) logYaz(k, "— " + a.etiket + " atlandı" + (o.neden ? " (" + o.neden + ")" : ""), "ok");
          } else if (m[1] === "HATA" && o) {
            sonuc.hataKaydi = { kod: o.kod || "genel", mesaj: o.mesaj || "", cozum: o.cozum || "" };
          } else if (m[1] !== "UYARI") logYaz(k, satir, tipBul(satir, kaynak));
          return;
        }
        const tip = tipBul(satir, kaynak);
        logYaz(k, satir, tip);
        const dizi = kaynak === "err" ? sonuc.stderrSon : sonuc.stdoutSon;
        dizi.push(satir); if (dizi.length > 14) dizi.shift();
      };
      try {
        // Kuyruktan (gece, gozetimsiz) calisan isler Pexels/Pixabay 429'unda kaynagi kapatmak yerine siniri bekler; bekleme
        // bosta-oldurme esiginin altinda kalir (yoksa sessiz bekleme "takildi" sayilip surec olurdu).
        const ekEnv = { OTOMASYON_PANEL: "1", FORCE_COLOR: "0" };
        if (k.kuyrukId && !process.env.GORSEL_LIMIT_BEKLE_SN) ekEnv.GORSEL_LIMIT_BEKLE_SN = String(Math.max(30, Math.floor(T.bostaOldurSn) - 300));
        p = spawn(process.execPath, [yol].concat(komut.argv), { cwd: KOK, windowsHide: true, detached: !WIN,
          env: Object.assign({}, process.env, ekEnv) });
      } catch (e) {
        logYaz(k, "✗ Süreç başlatılamadı: " + e.message, "err");
        sonuc.kod = 1; sonuc.hataKaydi = { kod: "genel", mesaj: "Süreç başlatılamadı: " + e.message, cozum: "" };
        return coz(sonuc);
      }
      k.surec = p; k.sonCikti = Date.now(); k.oldurAsimi = opt && opt.agir ? T.videoBostaOldurSn : T.bostaOldurSn;
      p.stdout.setEncoding("utf8"); p.stderr.setEncoding("utf8");
      // satir sonu gelmese de (\r ile ustune yazan ilerleme) cikti geliyorsa surec yasiyordur: "takildi" sayilmasin
      p.stdout.on("data", d => { k.sonCikti = Date.now(); k.takildi = false; satirlaraBol(k, "out", d, tamponlar.out); });
      p.stderr.on("data", d => { k.sonCikti = Date.now(); k.takildi = false; satirlaraBol(k, "err", d, tamponlar.err); });
      p.on("error", e => {
        logYaz(k, "✗ Süreç hatası: " + e.message, "err");
        sonuc.hataKaydi = sonuc.hataKaydi || { kod: "genel", mesaj: "Süreç hatası: " + e.message, cozum: "" };
        bitir(1);
      });
      p.on("close", kod => bitir(kod === null ? 1 : kod));
    });
  }

  // ---------------------------------------------------------------- hata ozeti
  function adimHatasi(a, kod, sonuc, bosta) {
    if (bosta) return { kod: "takildi", ozet: a.etiket + " uzun süre çıktı vermedi ve durduruldu.", cozum: "Bağlantını/ekran kartını kontrol edip tekrar dene; iş kaldığı yerden devam eder.", detay: sonuc.stdoutSon.concat(sonuc.stderrSon).slice(-8).join("\n") };
    const detay = sonuc.stderrSon.length ? sonuc.stderrSon.join("\n") : sonuc.stdoutSon.join("\n");
    if (sonuc.hataKaydi && sonuc.hataKaydi.mesaj) {
      const hk = sonuc.hataKaydi;
      return { kod: hk.kod || "genel", ozet: hk.mesaj, cozum: hk.cozum || "", detay };
    }
    const sonX = sonuc.stderrSon.concat(sonuc.stdoutSon).reverse().find(s => /^\s*✗/.test(s));
    const c = ortak.hataCevir(detay || "çıkış kodu " + kod);
    if (c.kod !== "genel") return { kod: c.kod, ozet: a.etiket + ": " + c.ozet, cozum: c.cozum, detay };
    const ex = CIKIS_ACIKLAMA[kod];
    if (sonX) return { kod: ex ? ex.kod : "genel", ozet: sonX.replace(/^\s*✗\s*/, ""), cozum: ex ? ex.cozum : "Ayrıntı için günlüğe bak.", detay };
    if (ex) return { kod: ex.kod, ozet: a.etiket + ": " + ex.ozet, cozum: ex.cozum, detay };
    return { kod: "genel", ozet: a.etiket + " başarısız oldu (çıkış kodu " + kod + ").", cozum: "Ayrıntı için günlüğe bak; sürerse işi baştan dene.", detay };
  }

  // ---------------------------------------------------------------- bitirme
  function isKilidiniBirak(k) {
    if (k.is && isKos.get(k.is) === k.id) isKos.delete(k.is);
    if (k.is && onayBekleyen.get(k.is) === k.id) onayBekleyen.delete(k.is);
  }
  function slotlariBirak(k) {
    if (k.agirTutuyor) { k.agirTutuyor = false; agirSem.birak(); }
    if (k.slotTutuyor) { k.slotTutuyor = false; zincirSem.birak(); }
  }
  function temizlik(k) {
    if (!k.is) return;
    try { const d = ortak.isDizin(k.is); ortak.partTemizle(d); isler.boyutuSifirla(d); isler.boyutuSifirla(path.join(d, "_tmp")); } catch (e) {}
    // olu surecin birakmis oldugu kilidi sil (PID baska programa gecmisse de olu sayilir: ortak.kilitSahibiCanliMi)
    try {
      const f = path.join(ortak.isDizin(k.is), ".kilit"); const m = ortak.jsonOku(f, null);
      if (m && !ortak.kilitSahibiCanliMi(m)) fs.unlinkSync(f);
    } catch (e) {}
  }
  function bitir(k, durum, kod, hata) {
    if (BITIS_DURUMLARI.has(k.durum)) return;
    k.durum = durum; k.kod = kod; k.hata = hata || null; k.bitis = Date.now(); k.surec = null;
    for (const a of k.adimlar) if (a.durum === "calisiyor" || a.durum === "onay") { a.durum = durum === "durduruldu" ? "iptal" : "hata"; a.bitis = a.bitis || Date.now(); }
    if (durum === "durduruldu") for (const a of k.adimlar) if (a.durum === "bekliyor") a.durum = "iptal";
    k.yuzde = durum === "bitti" ? 100 : k.yuzde;
    if (durum === "bitti") logYaz(k, k.zincir ? "✓ ZİNCİR TAMAM — iş bitti" : "✓ BİTTİ", "ok");
    else if (durum === "durduruldu") logYaz(k, "■ DURDURULDU");
    else { logYaz(k, "✗ HATA — " + (hata ? hata.ozet : "işlem başarısız"), "err"); if (hata && hata.cozum) logYaz(k, "  ↳ " + hata.cozum); }
    isKilidiniBirak(k); slotlariBirak(k);
    if (durum !== "bitti") temizlik(k);
    else if (k.is) { try { const d = ortak.isDizin(k.is); isler.boyutuSifirla(d); isler.boyutuSifirla(path.join(d, "_tmp")); } catch (e) {} }     // is bitti: dosya boyutlari degisti
    logDiskeYaz(k);
    durumYaz(k);
    eskileriAt();
    for (const f of dinleyiciler) { try { f(k); } catch (e) {} }
  }

  // ---------------------------------------------------------------- yurutme
  async function adimKos(k, tanim, kayit) {
    // agir adimlar global tek slotta; sirada beklerken durum "sirada"
    if (tanim.agir) {
      const ok = await agirSem.al(k, () => { k.durum = "sirada"; kayit.ozet = "Sırada: başka bir video işlemi bitmesi bekleniyor"; logYaz(k, "… sırada: başka bir ağır işlem (video/ses) bitmesi bekleniyor", "uyari"); durumYaz(k); });
      if (!ok) return { iptal: true };
      k.agirTutuyor = true;                 // slot alindi: durdur araya girmis olsa bile bitir() slotu birakabilsin (slot sizmaz)
      if (k.iptal) return { iptal: true };
      k.durum = "calisiyor"; kayit.ozet = "";
    }
    kayit.durum = "calisiyor"; kayit.baslangic = Date.now(); kayit.yuzde = null;
    durumYaz(k);
    let son = null, bosta = false;
    try {
      for (const c of tanim.komutlar) {
        if (k.iptal) return { iptal: true };
        if (k.adimlar.length === 1 || tanim.komutlar.length > 1) logYaz(k, "▶ " + kayit.etiket + "  (" + c.betik + ")", "cmd");
        const r = await surecKos(k, kayit, c, { agir: tanim.agir });
        bosta = r.bosta || bosta;
        son = r;
        if (k.iptal) return { iptal: true };
        if (r.kod !== 0) break;
      }
    } finally {
      if (k.agirTutuyor) { k.agirTutuyor = false; agirSem.birak(); }
    }
    return { sonuc: son, bosta };
  }

  async function yurut(k) {
    try {
      if (k.zincir) {
        const ok = await zincirSem.al(k, () => { k.durum = "sirada"; logYaz(k, "… sırada: aynı anda en çok " + T.zincirMax + " iş zinciri çalışabilir", "uyari"); durumYaz(k); });
        if (!ok) return bitir(k, "durduruldu", -1, null);
        k.slotTutuyor = true;               // slot alindi: iptal araya girmis olsa bile bitir() birakir (slot sizmaz)
        if (k.iptal) return bitir(k, "durduruldu", -1, null);
      }
      k.durum = "calisiyor"; durumYaz(k);
      while (k.kalan.length) {
        if (k.iptal) return bitir(k, "durduruldu", -1, null);
        const tanim = k.kalan.shift();
        const idx = k.tanimlar.indexOf(tanim);
        const kayit = k.adimlar[idx];
        k.adimNo = idx + 1;
        if (k.adimlar.length > 1) logYaz(k, "", null), logYaz(k, "▶ " + (idx + 1) + "/" + k.adimlar.length + " — " + kayit.etiket, "cmd");
        let r = await adimKos(k, tanim, kayit);
        if (r.iptal || k.iptal) return bitir(k, "durduruldu", -1, null);
        let sonuc = r.sonuc;
        // senaryo motoru servis hatasi verdiyse (kod 3) otomatik modda diger motoru dene
        if (sonuc && sonuc.kod === 3 && tanim.yedek && !tanim.yedekDenendi) {
          tanim.yedekDenendi = true;
          logYaz(k, "⚠ " + kayit.etiket + " servis hatası verdi; yedek motor deneniyor: " + tanim.yedek.etiket, "uyari");
          const yt = Object.assign({}, tanim, { komutlar: [{ betik: tanim.yedek.betik, argv: tanim.komutlar[0].argv }] });
          kayit.etiket = tanim.yedek.etiket;
          r = await adimKos(k, yt, kayit);
          if (r.iptal || k.iptal) return bitir(k, "durduruldu", -1, null);
          sonuc = r.sonuc;
        }
        kayit.bitis = Date.now(); kayit.kod = sonuc ? sonuc.kod : 1;
        if (sonuc && sonuc.kod === 0) {
          const atlandi = !!(sonuc.sonuc && sonuc.sonuc.atlandi);
          kayit.durum = atlandi ? "atlandi" : "bitti"; kayit.yuzde = 100;
          if (!atlandi) logYaz(k, "✓ " + kayit.etiket + " bitti", "ok");
          durumYaz(k);
          k.yuzde = k.zincir ? genelYuzde(k) : 100;
          // onay duragi: senaryo bu kosuda uretildiyse (ya da gorsel onayi aciksa) kullanici bakmadan ilerleme
          if (tanim.onayDurak && !atlandi && k.kalan.length && !k.onaysiz && !k.atlaOnay && onayGerekli(k.is, tanim.onayDurak)) {
            const sonraki = k.adimlar[k.tanimlar.indexOf(k.kalan[0])];
            if (sonraki) sonraki.durum = "onay";
            k.durum = "onay_bekliyor"; k.surec = null;
            isKilidiniBirak(k); onayBekleyen.set(k.is, k.id);
            logYaz(k, "⏸ " + (tanim.onayDurak === "senaryo" ? "Senaryo hazır." : "Görseller hazır.") + " Gözden geçir, gerekirse düzenle, sonra ONAYLA — devam etmek için onay bekleniyor.", "uyari");
            slotlariBirak(k); durumYaz(k);
            return;
          }
          continue;
        }
        // basarisiz
        const hata = adimHatasi(kayit, kayit.kod, sonuc || { stderrSon: [], stdoutSon: [], hataKaydi: null }, r.bosta);
        if (tanim.istegeBagli) {
          kayit.durum = "hata";
          logYaz(k, "⚠ " + kayit.etiket + " başarısız (" + hata.ozet + ") — isteğe bağlı adım, zincir sürüyor", "uyari");
          durumYaz(k);
          continue;
        }
        kayit.durum = "hata";
        return bitir(k, "hata", kayit.kod, hata);
      }
      bitir(k, "bitti", 0, null);
    } catch (e) {
      logYaz(k, "✗ Panel hatası: " + (e && e.message), "err");
      bitir(k, "hata", 1, { kod: "sunucu", ozet: "Panel işi yürütürken beklenmeyen bir hata oluştu.", cozum: "Sayfayı yenileyip tekrar dene.", detay: String(e && e.stack || e).slice(-800) });
    }
  }

  function onayGerekli(is, durak) {
    try {
      const e = ortak.konuEtkin(is);
      if (e && e.onay && typeof e.onay[durak] === "boolean") return e.onay[durak];
    } catch (e) {}
    return durak === "senaryo";
  }

  // ---------------------------------------------------------------- disariya acilan islemler
  function isMesgulId(is) {
    if (!is) return null;
    const id = isKos.get(is);
    if (id) return id;
    const y = yetimler.get(is);
    if (y && pidCanli(y.pid)) return "y-" + is;
    if (y) yetimler.delete(is);
    return null;
  }

  // tur: komutlar.TURLER; b: istek govdesi. {id, is}
  function baslat(tur, b, secenek) {
    b = b || {}; secenek = secenek || {};
    if (!komutlar.TURLER.includes(tur)) throw new HttpHata(400, "gecersiz_islem", "Geçersiz işlem.");
    const issiz = komutlar.ISSIZ.has(tur);
    let is = b.is;
    if (!issiz || is) {
      if (!ortak.guvenliAd(is)) throw new HttpHata(400, "gecersiz_is", "Geçersiz iş adı.");
      if (!fs.existsSync(ortak.isDizin(is))) throw new HttpHata(404, "is_yok", "Böyle bir iş yok.");
    } else is = null;
    if (is) {
      const mesgul = isMesgulId(is);
      if (mesgul) throw new HttpHata(409, "is_calisiyor", "Bu iş zaten çalışıyor; bitmesini bekle ya da Durdur'a bas.", { id: mesgul });
    }
    const zincirTuru = tur === "hepsi" || tur === "devam";
    if (zincirTuru && is && onayBekleyen.has(is))
      throw new HttpHata(409, "onay_bekliyor", "Bu iş onay bekliyor; Onayla ya da Durdur'a bas.", { id: onayBekleyen.get(is) });
    if (komutlar.SENARYO_YAZAN.has(tur) && senaryoVar(is) && !b.onay)
      throw new HttpHata(409, "senaryo_var", "Bu işte zaten bir senaryo var. Yeniden yazmak ücretlidir ve mevcut metnin yerine geçer (eskisi yedeklenir).", { cozum: "Eminsen isteği onay:true ile gönder." });
    if (cfg.onkontrol) cfg.onkontrol(tur, is, b);
    const ctx = ctxKur();
    let adimlar;
    if (zincirTuru) adimlar = komutlar.zincirAdimlari(is, b, ctx);
    else adimlar = komutlar.tekTur(tur, b, ctx);
    const komutMetni = zincirTuru ? "zincir: " + adimlar.map(a => a.ad).join(" -> ")
      : adimlar.map(a => a.komutlar.map(c => c.betik + " " + c.argv.join(" ")).join(" && ")).join(" ; ");
    const k = kayitYarat({ is, tur, adimlar, zincir: zincirTuru, komut: komutMetni,
      onaysiz: secenek.onaysiz || b.onaysiz === true, kuyrukId: secenek.kuyrukId, atlaOnay: secenek.atlaOnay });
    if (is) isKos.set(is, k.id);
    logYaz(k, "$ " + komutMetni, "cmd");
    durumYaz(k);
    setImmediate(() => yurut(k));
    return { id: k.id, is };
  }

  function durdur(id) {
    if (typeof id === "string" && id.startsWith("y-")) {       // yetim surec
      const is = id.slice(2), y = yetimler.get(is);
      if (!y) return false;
      yetimler.delete(is);
      // Oldurmeden once sahibi DOGRULA: kilit eskiyse PID baska bir programa gecmis olabilir; o zaman o programin surec agacini
      // oldurmek yerine yalniz bayat kilidi temizle (taskkill /T /F alakasiz bir uygulamayi kapatmasin).
      const gercek = ortak.kilitSahibiCanliMi(y);
      if (gercek) agaciOldur(y.pid);
      try {
        const d = ortak.isDizin(is);
        const t = setTimeout(() => { try { ortak.partTemizle(d); const f = path.join(d, ".kilit"); const m = ortak.jsonOku(f, null); if (!m || !ortak.kilitSahibiCanliMi(m)) fs.unlinkSync(f); } catch (e) {} }, gercek ? 1500 : 0);
        if (t.unref) t.unref();
      } catch (e) {}
      return true;
    }
    const k = kayitlar.get(id);
    if (!k || BITIS_DURUMLARI.has(k.durum)) return false;
    k.iptal = true;
    if (k.surec && k.surec.pid) {
      agaciOldur(k.surec.pid, k.surec);          // close olayi zinciri durdurur
      return true;
    }
    // surec yok: sirada ya da onay bekliyor -> hemen bitir
    zincirSem.iptal(k); agirSem.iptal(k);
    if (k.durum === "onay_bekliyor" || k.durum === "sirada") bitir(k, "durduruldu", -1, null);
    return true;
  }

  function onayla(is) {
    if (!ortak.guvenliAd(is)) throw new HttpHata(400, "gecersiz_is", "Geçersiz iş adı.");
    const id = onayBekleyen.get(is);
    const k = id && kayitlar.get(id);
    if (k && k.durum === "onay_bekliyor") {
      if (isMesgulId(is)) throw new HttpHata(409, "is_calisiyor", "Bu iş şu an başka bir işlem çalıştırıyor; bitmesini bekle.", { id: isMesgulId(is) });
      onayBekleyen.delete(is);
      isKos.set(is, k.id);
      for (const a of k.adimlar) if (a.durum === "onay") a.durum = "bekliyor";
      k.durum = "sirada"; logYaz(k, "▶ Onaylandı — devam ediliyor", "cmd"); durumYaz(k);
      setImmediate(() => yurut(k));
      return { ok: true, id: k.id };
    }
    // panel yeniden baslamis olabilir: durum.json hala onay bekliyor diyorsa kalan adimlari bastan kur
    const dj = isler.jsonSessiz(path.join(ortak.isDizin(is), "durum.json"), null);
    if (dj && dj.son && dj.son.durum === "onay_bekliyor") {
      const r = baslat("hepsi", { is }, { atlaOnay: true });
      return { ok: true, id: r.id };
    }
    throw new HttpHata(404, "onay_yok", "Bu iş onay beklemiyor.");
  }

  // Bir video kuruluyor mu? Ortak onbellegi (uretim/_onbellek) silmeden once bakilir: panelin kendi agir slotu, onceki
  // oturumdan kalan surecler ve panel disinda calisan video-yap (toplu-uret*.cjs, elle) -- bunlar is kilidinden bilinir.
  function calisanVideoVar() {
    if (agirSem.kullanilan() > 0) return true;
    for (const y of yetimler.values()) if (pidCanli(y.pid)) return true;
    try {
      for (const d of fs.readdirSync(uretim(), { withFileTypes: true })) {
        if (!d.isDirectory() || !ortak.guvenliAd(d.name)) continue;
        let m = null;
        try { m = ortak.jsonOku(path.join(uretim(), d.name, ".kilit"), null); } catch (e) { m = null; }
        if (m && /video-yap/.test(String(m.komut || "")) && ortak.kilitSahibiCanliMi(m)) return true;
      }
    } catch (e) { /* uretim klasoru yok */ }
    return false;
  }

  function durumuAl(is) {
    const id = isKos.get(is) || onayBekleyen.get(is);
    const k = id && kayitlar.get(id);
    if (k) return { durum: k.durum, id: k.id };
    const y = yetimler.get(is);
    if (y && pidCanli(y.pid)) return { durum: "calisiyor", id: "y-" + is, yetim: true };
    return null;
  }

  function adimMetni(k) { const a = k.adimlar[Math.max(0, k.adimNo - 1)]; return a ? a.etiket : ""; }
  function calisanlar() {
    const out = [];
    for (const k of kayitlar.values()) {
      if (BITIS_DURUMLARI.has(k.durum)) continue;
      out.push({ id: k.id, is: k.is, tur: k.tur, komut: k.komut, baslangic: iso(k.baslangic), gecenSn: Math.round((Date.now() - k.baslangic) / 1000),
        durum: k.durum, adim: adimMetni(k), adimNo: k.adimNo, adimToplam: k.adimlar.length, yuzde: k.yuzde, takildi: k.takildi });
    }
    for (const [is, y] of Array.from(yetimler)) {
      if (!pidCanli(y.pid)) { yetimler.delete(is); continue; }
      out.push({ id: "y-" + is, is, tur: "yetim", komut: y.komut || "", baslangic: y.baslangic || null, gecenSn: y.baslangic ? Math.round((Date.now() - Date.parse(y.baslangic)) / 1000) : null,
        durum: "calisiyor", adim: "", adimNo: 0, adimToplam: 0, yuzde: null, yetim: true });
    }
    return out;
  }

  function log(id, ara) {
    const k = kayitlar.get(id);
    if (!k) return null;
    ara = Number.isFinite(ara) && ara > 0 ? ara : 0;
    const ilk = k.satirlar.length ? k.satirlar[0].n : k.n + 1;
    return {
      satirlar: k.satirlar.filter(s => s.n > ara).map(s => ({ n: s.n, t: s.t, tip: s.tip })), sonN: k.n, kesildi: ara + 1 < ilk,
      bitti: BITIS_DURUMLARI.has(k.durum), kod: k.kod, durum: k.durum, iptal: k.iptal, komut: k.komut, is: k.is, tur: k.tur,
      adim: adimMetni(k), adimNo: k.adimNo, adimToplam: k.adimlar.length, yuzde: k.yuzde, takildi: k.takildi, hata: k.hata || null,
      uyarilar: k.uyarilar,
    };
  }

  // Baslangic taramasi: canli pid'li kilitler yetim; oluler temizlenir; "calisiyor" diye kalmis durum.json duzeltilir.
  function baslangicTaramasi() {
    let adlar = [];
    try { adlar = fs.readdirSync(uretim(), { withFileTypes: true }).filter(d => d.isDirectory() && ortak.guvenliAd(d.name)).map(d => d.name); } catch (e) { return; }
    for (const is of adlar) {
      const d = path.join(uretim(), is);
      const f = path.join(d, ".kilit");
      let canli = false;
      try {
        const m = ortak.jsonOku(f, null);
        if (m && ortak.duzNesne(m)) {
          // kilit sahibi gercekten o betik sureci mi? (PID elektrik kesintisi/cokme sonrasi baska programa gecmis olabilir:
          // o zaman sahte "yetim is" gosterilmez, is 409 ile engellenmez, Durdur alakasiz programi oldurmez)
          if (m.pid !== process.pid && ortak.kilitSahibiCanliMi(m)) { yetimler.set(is, { pid: m.pid, komut: m.komut || "", baslangic: m.baslangic || null }); canli = true; }
          else { try { fs.unlinkSync(f); } catch (e) {} ortak.partTemizle(d); }
        }
      } catch (e) { try { fs.unlinkSync(f); } catch (e2) {} }
      if (canli) continue;
      const dj = isler.jsonSessiz(path.join(d, "durum.json"), null);
      if (dj && dj.son && ["calisiyor", "sirada"].includes(dj.son.durum)) {
        dj.son.durum = "durduruldu"; dj.son.bitis = iso(Date.now());
        dj.son.hata = { kod: "panel_kapandi", ozet: "Panel kapandığı için iş yarıda kaldı.", cozum: "İşi tekrar başlat; kaldığı yerden devam eder.", detay: "" };
        for (const a of dj.adimlar || []) if (a.durum === "calisiyor") a.durum = "iptal";
        try { ortak.atomikJsonYaz(path.join(d, "durum.json"), dj); } catch (e) {}
      }
    }
  }

  // Bosta kalma izleyicisi
  const izleyici = setInterval(() => {
    const simdi = Date.now();
    for (const k of kayitlar.values()) {
      if (!k.surec || BITIS_DURUMLARI.has(k.durum)) continue;
      const bos = (simdi - k.sonCikti) / 1000;
      if (bos > T.bostaUyariSn && !k.takildi) {
        k.takildi = true;
        logYaz(k, "⚠ " + Math.round(T.bostaUyariSn / 60 * 10) / 10 + " dakikadır çıktı yok — takılmış olabilir. Beklemek istemiyorsan Durdur'a bas.", "uyari");
        k.uyarilar.push("takildi");
      }
      if (bos > (k.oldurAsimi || T.bostaOldurSn)) {
        logYaz(k, "✗ " + Math.round(bos / 60) + " dakikadır çıktı yok; süreç sonlandırılıyor.", "err");
        k.bostaOldu = true;
        agaciOldur(k.surec.pid, k.surec);
      }
    }
  }, T.kontrolMs);
  if (izleyici.unref) izleyici.unref();

  return {
    baslat, durdur, onayla, calisanlar, log, durumuAl, isMesgulId, calisanVideoVar, baslangicTaramasi, dinle: f => dinleyiciler.push(f),
    kayitlar, yetimler, zincirSem, agirSem, T, senaryoVar, kapat() { clearInterval(izleyici); },
  };
}

module.exports = { calistiriciOlustur, agaciOldur, pidCanli, semafor };
