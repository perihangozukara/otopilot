'use strict';

/**
 * MASAUSTU CIKTI KLASORLERI
 *
 * Ne ise yarar: kullanici bir is sectiginde (bir sahne uretti, bir Etsy
 * tasarimi cikardi, bir reklam gorseli yapti) o isin TUM ciktilarini
 * masaustunde KENDI klasorune yazar.
 *
 * Neden: `data/images/` altinda her sey tek bir yigin halinde duruyordu -
 * dosya adlari `img_m8k2p_3f1a.png` gibi, hangisinin ne oldugu belli degil,
 * yanlarinda prompt/metin yok. Kullanici galeriyi acmadan hicbir seyi
 * bulamiyordu.
 *
 * DUZEN - IC ICE DEGIL, DUZ LISTE:
 *
 *   Masaustu\Ai Infapp\
 *     2026-08-20 21-45 - AI Influencer - kahve reklami\
 *       01.png
 *       prompt.txt
 *       bilgi.txt
 *     2026-08-20 21-52 - Etsy POD - anne gunu\
 *       01.png
 *       etsy-listeleme.txt
 *       bilgi.txt
 *     2026-08-20 22-03 - Reklam - acilis duyurusu\
 *       01.png
 *       bilgi.txt
 *
 * Her isin klasoru kokte, yan yana. Studyo icin ayri bir alt katman ACILMAZ:
 * studyo adi klasor adinda zaten yaziyor ve iki kademe inmek, aranan seyi
 * bulmayi kolaylastirmiyor.
 *
 * `data/` yine eskisi gibi calisir - burasi ONA EK, onun yerine gecmez.
 * Galeri, vesikalik zinciri ve referans secimi hep `data/`yi kullanir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const store = require('./store');

const CONFIG_FILE = path.join(store.DATA_DIR, 'cikti.json');
const KOK_AD = 'Ai Infapp';

/**
 * Kullanicinin duzeltebilecegi hata (gecersiz yol, klasor degil...): HTTP 400.
 * Duz Error 500 donuyordu ve her seferinde konsola yigin izi basiliyordu.
 */
function kullaniciHatasi(mesaj) {
  const err = new Error(mesaj);
  err.status = 400;
  return err;
}

/** `alt`, `ust` klasorunun kendisi ya da icindeki bir yol mu? (Windows'ta buyuk/kucuk harf duyarsiz) */
function icinde(ust, alt) {
  const u = path.resolve(ust);
  const a = path.resolve(alt);
  const kucult = process.platform === 'win32' ? (x) => x.toLowerCase() : (x) => x;
  return kucult(a) === kucult(u) || kucult(a).startsWith(kucult(u) + path.sep);
}

/* ------------------------------------------------------------- masaustu */

/**
 * Masaustunu bulur.
 * OneDrive yedeklemesi acikken Windows masaustunu OneDrive altina tasiyor;
 * ikisini de deniyoruz. Hicbiri yoksa proje icine dusuyoruz - kullanici
 * ciktisini kaybetmesin.
 */
function detectDesktop() {
  const adaylar = [];
  const home = process.env.USERPROFILE || os.homedir();

  if (process.env.OneDrive) adaylar.push(path.join(process.env.OneDrive, 'Desktop'));
  if (process.env.OneDriveConsumer) adaylar.push(path.join(process.env.OneDriveConsumer, 'Desktop'));
  if (home) {
    adaylar.push(path.join(home, 'OneDrive', 'Desktop'));
    adaylar.push(path.join(home, 'Desktop'));
    adaylar.push(path.join(home, 'Masaüstü'));
  }

  for (const aday of adaylar) {
    try {
      if (fs.existsSync(aday) && fs.statSync(aday).isDirectory()) return aday;
    } catch {
      // erisilemeyen adayi atla
    }
  }
  return null;
}

function defaultRoot() {
  // AI_INFAPP_VERI (test / ikinci kurulum) verildiyse veri klasoru zaten yalitilmis;
  // cikti da onun icine gitsin. Aksi halde testler gercek Masaustu\Ai Infapp'e yaziyordu.
  if (process.env.AI_INFAPP_VERI) return path.join(store.DATA_DIR, 'cikti');
  const desktop = detectDesktop();
  if (desktop) return path.join(desktop, KOK_AD);
  // Masaustu bulunamadi - ciktilar kaybolmasin diye proje icine.
  return path.join(store.ROOT, 'cikti');
}

/* ------------------------------------------------------------- yapilandirma */

function getConfig() {
  const kayitli = (() => {
    try {
      if (!fs.existsSync(CONFIG_FILE)) return null;
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
      return null;
    }
  })();

  const varsayilan = defaultRoot();
  return {
    // VARSAYILAN ACIK: kullanici bir sey ayarlamadan ciktisini masaustunde bulmali.
    enabled: kayitli && typeof kayitli.enabled === 'boolean' ? kayitli.enabled : true,
    root: (kayitli && kayitli.root) || varsayilan,
    defaultRoot: varsayilan,
    desktopFound: !!detectDesktop(),
  };
}

/** Cikti kokunun icinde OLAMAYACAK sistem klasorleri (Windows). */
function yasakliKlasorler() {
  const e = process.env;
  const win = process.platform === 'win32';
  const adaylar = [
    e.SystemRoot || (win ? 'C:\\Windows' : null),
    e.ProgramFiles || (win ? 'C:\\Program Files' : null),
    e['ProgramFiles(x86)'] || (win ? 'C:\\Program Files (x86)' : null),
    e.ProgramW6432,
    // ProgramData tum kullanicilarin ortak veri alani; altindaki Start Menu\Programs\StartUp her girisde calisir.
    e.ProgramData || (win ? 'C:\\ProgramData' : null),
  ];
  // Kullanicinin Baslat menusu (Startup klasoru dahil): buraya dosya yazmak her oturum acisinda calistirir.
  if (e.APPDATA) adaylar.push(path.join(e.APPDATA, 'Microsoft', 'Windows', 'Start Menu'));
  return adaylar.filter(Boolean).map((x) => path.resolve(x));
}

/**
 * Yolu GERCEK (sembolik baglanti / kavsak / 8.3 kisa ad cozulmus) haline cevirir.
 * Henuz olusmamis klasorlerde var olan en yakin ust klasor cozulur, kalani eklenir.
 */
function gercekYol(normal) {
  let ust = normal;
  const kuyruk = [];
  for (;;) {
    try {
      const gercek = fs.realpathSync.native(ust);
      return kuyruk.length ? path.join(gercek, ...kuyruk.reverse()) : gercek;
    } catch {
      const yeni = path.dirname(ust);
      if (yeni === ust) return normal;
      kuyruk.push(path.basename(ust));
      ust = yeni;
    }
  }
}

/**
 * Kok klasoru dogrular.
 * Kullanici buraya elle yol yazabildigi icin sistem klasorlerine yazmayi
 * en bastan reddediyoruz - yanlis yapistirilmis bir yol yuzunden Windows
 * klasorune dosya sacilmasin.
 */
function validateRoot(aday) {
  const p = String(aday || '').trim();
  if (!p) throw kullaniciHatasi('Klasor yolu bos.');
  if (p.includes('\0')) throw kullaniciHatasi('Klasor yolunda gecersiz karakter var.');
  // UNC (\\sunucu\paylasim), \\?\ ve \\.\ on ekleri: sonraki her uretim uzak bir makineye yazmaya
  // calisir ve Windows kimlik dogrulamasini (NTLM) o makineye gonderir; sistem klasoru kontrolunu de atlatir.
  if (/^[\\/]{2}/.test(p)) {
    throw kullaniciHatasi('Ag yolu (\\\\sunucu\\paylasim) ve \\\\?\\ gibi ozel on ekli yollar kabul edilmez. Bu bilgisayarda bir klasor sec.');
  }
  if (!path.isAbsolute(p)) throw kullaniciHatasi('Tam yol yaz (ornek: C:\\Users\\...\\Desktop\\Ai Infapp).');

  const normal = path.resolve(p);
  const parcalar = normal.split(path.sep).filter(Boolean);
  if (parcalar.length < 2) {
    throw kullaniciHatasi('Surucu kokune yazilamaz. Bir klasor sec (ornek: Masaustu\\Ai Infapp).');
  }

  // Hem yazilan yol hem gercek yol denetlenir: C:\PROGRA~1 ya da bir kavsak sistem klasorune cikabilir.
  const yollar = [normal, gercekYol(normal)];
  for (const y of yasakliKlasorler()) {
    if (yollar.some((x) => icinde(y, x))) {
      throw kullaniciHatasi('Sistem klasorune yazilamaz. Masaustu veya Belgeler altinda bir yer sec.');
    }
  }
  return normal;
}

function saveConfig(gelen = {}) {
  const mevcut = getConfig();
  const root = gelen.root ? validateRoot(gelen.root) : mevcut.root;
  const enabled = typeof gelen.enabled === 'boolean' ? gelen.enabled : mevcut.enabled;

  store.ensureDirs();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ enabled, root }, null, 2), 'utf8');
  return getConfig();
}

/* ------------------------------------------------------------- klasor adi */

/** Windows'ta dosya adinda kullanilamayan karakterleri temizler. */
function safeName(text, fallback = 'is') {
  let s = String(text || '').trim();
  // Windows yasaklari: < > : " / \ | ? *  + kontrol karakterleri
  s = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // Nokta ile biten klasor adlarini Windows kabul etmiyor.
  s = s.replace(/\.+$/, '').trim();
  if (!s) return fallback;
  // Cok uzun ad = 260 karakter yol siniri riski.
  if (s.length > 60) s = s.slice(0, 60).trim();
  return s;
}

function stamp(d = new Date()) {
  const iki = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())} ${iki(d.getHours())}-${iki(d.getMinutes())}`;
}

const STUDYO_ADI = {
  karakter: 'AI Influencer',
  etsy: 'Etsy POD',
  reklam: 'Reklam',
};

/**
 * Bir is icin klasor acar.
 * Ayni dakikada ayni adla ikinci bir is gelirse sonuna sayi eklenir -
 * ustune yazip onceki ciktiyi yok etmez.
 */
function createJobFolder({ studio = 'karakter', title = '' } = {}) {
  const cfg = getConfig();
  if (!cfg.enabled) return null;

  const studyo = STUDYO_ADI[studio] || studio;
  const ad = `${stamp()} - ${safeName(studyo, 'Studyo')} - ${safeName(title, 'is')}`;

  let hedef = path.join(cfg.root, ad);
  let sayac = 2;
  while (fs.existsSync(hedef)) {
    hedef = path.join(cfg.root, `${ad} (${sayac++})`);
    if (sayac > 99) break;
  }

  fs.mkdirSync(hedef, { recursive: true });
  gitIgnoreKoy(cfg.root);
  return { path: hedef, name: path.basename(hedef), root: cfg.root };
}

/**
 * Masaustu bulunamayinca ciktilar proje klasorunun icine (cikti/) duser. Kokteki .gitignore yalniz
 * *.png'yi yakalar; prompt.txt / bilgi.txt (karakter adi, prompt'lar) yanlislikla commit edilebilirdi.
 * Kok proje icindeyse kendi .gitignore'unu koyariz: her seyi yok sayar. Proje disindaki kokte (masaustu) dokunmaz.
 */
function gitIgnoreKoy(kok) {
  try {
    if (!icinde(store.ROOT, kok)) return;
    fs.writeFileSync(path.join(kok, '.gitignore'), '# Ai Infapp ciktilari (gorsel, prompt, bilgi) depoya girmez\n*\n', { flag: 'wx' });
  } catch {
    // zaten var ya da yazilamadi: cikti uretimini engelleme
  }
}

/**
 * Var olan bir is klasorunu yeniden kullanir (metni gorselin yanina yazmak icin).
 *
 * Panelden yalnizca KLASOR ADI gelir, tam yol degil: boylece panel keyfi bir
 * yola yazdiramaz. Ad koke gore cozulur ve kokun disina cikmadigi dogrulanir.
 */
function reuseJobFolder(name) {
  const cfg = getConfig();
  if (!cfg.enabled) return null;

  const temiz = path.basename(String(name || '').trim());
  if (!temiz) return null;

  const hedef = path.resolve(path.join(cfg.root, temiz));
  const kok = path.resolve(cfg.root);
  if (!hedef.startsWith(kok + path.sep)) return null;
  if (!fs.existsSync(hedef) || !fs.statSync(hedef).isDirectory()) return null;

  return { path: hedef, name: temiz, root: cfg.root };
}

/* --------------------------------------------------------------- yazma */

function writeImage(folder, buffer, { index = 1, ext = 'png', label = '' } = {}) {
  if (!folder) return null;
  const taban = label ? `${String(index).padStart(2, '0')} - ${safeName(label, 'kare')}` : String(index).padStart(2, '0');
  const dosya = path.join(folder.path, `${taban}.${ext}`);
  fs.writeFileSync(dosya, buffer);
  return dosya;
}

function writeText(folder, filename, content) {
  if (!folder || !content) return null;
  const dosya = path.join(folder.path, safeName(filename, 'not.txt'));
  // Windows Not Defteri'nde duzgun gorunsun diye CRLF + BOM.
  const govde = '\ufeff' + String(content).replace(/\r?\n/g, '\r\n');
  fs.writeFileSync(dosya, govde, 'utf8');
  return dosya;
}

/* ------------------------------------------------------------ klasoru ac */

/**
 * Klasoru Dosya Gezgini'nde acar.
 * Yalnizca yapilandirilmis kokun ALTINDAKI bir yolu acar - panelden gelen
 * keyfi bir yolu acmaz.
 */
function openFolder(target) {
  const cfg = getConfig();
  const kok = path.resolve(cfg.root);

  // Panel yalnizca KLASOR ADI gonderiyor (tam yol degil). Bare bir adi
  // path.resolve'a verirsek calisma dizinine gore cozulur ve her zaman
  // reddedilir - once koke gore birlestir.
  const ham = String(target || '').trim();
  const istenen = !ham
    ? kok
    : (path.isAbsolute(ham) ? path.resolve(ham) : path.resolve(path.join(kok, path.basename(ham))));

  if (istenen !== kok && !istenen.startsWith(kok + path.sep)) {
    throw kullaniciHatasi('Yalnizca cikti klasorunun ici acilabilir.');
  }
  if (!fs.existsSync(istenen)) throw kullaniciHatasi('Klasor henuz olusmamis.');
  // explorer.exe / open / xdg-open bir DOSYA verilirse onu ilgili programla acar (calistirir): yalniz klasor.
  if (!fs.statSync(istenen).isDirectory()) throw kullaniciHatasi('Yalnizca klasor acilabilir.');

  const komut = process.platform === 'win32' ? 'explorer.exe' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
  const cocuk = spawn(komut, [istenen], { detached: true, stdio: 'ignore' });
  // 'error' dinleyicisi sart: komut yoksa (xdg-open olmayan Linux/WSL) olay dinlenmezse
  // yakalanmamis istisna tum panel surecini kapatir.
  cocuk.on('error', (err) => console.error('[cikti] klasor acilamadi (' + komut + '):', err.message));
  cocuk.unref();
  return istenen;
}

/** Kokteki is klasorlerini listeler (en yeni ustte). */
function listJobs(limit = 40) {
  const cfg = getConfig();
  if (!fs.existsSync(cfg.root)) return [];
  return fs.readdirSync(cfg.root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const tam = path.join(cfg.root, d.name);
      let dosyaSayisi = 0;
      try { dosyaSayisi = fs.readdirSync(tam).length; } catch {}
      return { name: d.name, path: tam, files: dosyaSayisi };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1))
    .slice(0, limit);
}

module.exports = {
  getConfig,
  saveConfig,
  validateRoot,
  defaultRoot,
  detectDesktop,
  createJobFolder,
  reuseJobFolder,
  writeImage,
  writeText,
  openFolder,
  listJobs,
  safeName,
  STUDYO_ADI,
};
