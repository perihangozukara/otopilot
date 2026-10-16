// PANEL <-> AI INFAPP — "AIINFAPP_PORT'ta KIM dinliyor?" teshisi ve ai-infapp/server.js'i dugmeyle baslatma. Sifir bagimlilik.
// Ai Infapp (ai-infapp/) ayri bir yerel web panelidir (kendi sunucusu, kendi data/ klasoru); panel onu video-indirici gibi
// kendiliginden ACMAZ, yalniz "Ai Infapp" dugmesine basilinca baslatir. Port yalniz 127.0.0.1'e baglidir.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { HttpHata, portAcikMi } = require("./panel-http");

// ai-infapp/server.js her yanita "X-Ai-Infapp: ai-infapp/<surum>" basligi koyar; kimlik bu bicimde degilse sayilmaz
// (baska bir program ayni basligi taklit ederse yine "baska" cikar).
const KIMLIK = /^ai-infapp\/\d+\.\d+\.\d+/;
const SAYFA_OKUMA = 64 * 1024;      // kimliksiz sayfanin yalniz ilk 64 KB'ina bakilir (dev bir yanit bellegi sismesin)
const bekle = ms => new Promise(r => setTimeout(r, ms));

// Alt surece panelin ortami gecer ama anahtar/jeton benzeri degiskenler GECMEZ: Ai Infapp bunlari kullanmaz (kendi anahtarlari data/ icindedir)
// ve kullanici adresine istek atan, ayri bir guven alanidir (en az yetki).
// Kara liste yalniz savunma derinligi; bilinen sir adlarini (DB_PASS, DATABASE_URL, GH_PAT, SSH_PASSPHRASE, COOKIE ...) de kapsar.
const GIZLI_AD = /KEY|TOKEN|SECRET|PASS|PWD|CREDENTIAL|COOKIE|AUTH|PRIVATE|SESSION_|_PAT$|^GH_|^GITHUB_|^DATABASE_URL$|CONNECTION_STRING|(^|_)DSN$/i;
function altOrtam(port) {
  const env = {};
  for (const [ad, deger] of Object.entries(process.env)) if (!GIZLI_AD.test(ad)) env[ad] = deger;
  env.AI_INFAPP_PORT = String(port);
  return env;
}

// Portta KIM dinliyor? "TCP acik" demek yetmez: proje disindaki ESKI kopya (bu depo disindaki eski bir klasor, ayni 4200 portu;
// Host/Origin denetimi yok) aciksa panel kullaniciyi ona yonlendirir ve yeni kopyanin korumalari sessizce devre disi kalirdi.
// -> "yok" | "yeni" (kimlik basligi var) | "eski" (baslik yok ama sayfada "Ai Infapp" yazar) | "baska" (baska program)
//    | "yanit_yok" (port acik ama HTTP cevap vermiyor: mesgul sunucu olabilir)
async function tani(port, ms) {
  if (!(await portAcikMi(port, 300))) return "yok";        // kapali portta HTTP zaman asimi "yanit yok" sanilmasin
  return new Promise(coz => {
    let bitti = false, istek = null, saat = null;
    const son = v => { if (bitti) return; bitti = true; clearTimeout(saat); try { if (istek) istek.destroy(); } catch (e) { /* kapali */ } coz(v); };
    saat = setTimeout(() => son("yanit_yok"), ms || 600);
    try {
      istek = http.get({ host: "127.0.0.1", port, path: "/", agent: false, headers: { Accept: "text/html" } }, res => {
        if (KIMLIK.test(String(res.headers["x-ai-infapp"] || ""))) return son("yeni");
        let sayfa = "", boyut = 0;
        const karar = () => (/Ai Infapp/.test(sayfa) ? "eski" : "baska");
        clearTimeout(saat); saat = setTimeout(() => son(karar()), 1500);
        res.setEncoding("utf8");
        res.on("data", parca => { sayfa += parca; boyut += parca.length; if (boyut >= SAYFA_OKUMA) son(karar()); });
        res.on("end", () => son(karar()));
        res.on("error", () => son(karar()));
      });
      // baglanti reddi: port bu arada kapandi; baska hata (sifirlama, HTTP olmayan konusma): baska bir program
      istek.on("error", e => son(e && e.code === "ECONNREFUSED" ? "yok" : "baska"));
    } catch (e) { son("yanit_yok"); }
  });
}

// POST /api/aiinfapp/baslat'in govdesi. secenek: {port, dizin (ai-infapp klasoru), kapali (testte baslatma kapali)}
// -> {ok, port, zatenAcik?} ya da HttpHata (404 yok, 409 eski/baska program, 500 baslatilamadi)
// Ayni port icin tek ucustaki baslatma: cift tik / ust dugme + Araclar dugmesi ayni anda iki surec acar; ikincisi data/.instance
// kilidini gorup cikis 1 ile kapanir ve kullaniciya YANLIS "acilmadan kapandi" hatasi gider. Gec gelen istek ilkinin sonucunu bekler.
const ucustaki = new Map();
async function baslat(secenek) {
  const devam = ucustaki.get(secenek.port);
  if (devam) return Object.assign({}, await devam, { zatenAcik: true });
  const is = baslatTek(secenek);
  ucustaki.set(secenek.port, is);
  try { return await is; } finally { ucustaki.delete(secenek.port); }
}

async function baslatTek(secenek) {
  const { port, dizin, kapali } = secenek;
  const dosyaYolu = path.join(dizin, "server.js");
  if (!fs.existsSync(dosyaYolu)) throw new HttpHata(404, "aiinfapp_yok", "Ai Infapp bu kurulumda yok (ai-infapp klasörü eksik).");
  const t = await tani(port, 600);
  if (t === "yeni" || t === "yanit_yok") return { ok: true, port, zatenAcik: true };
  if (t === "eski") throw new HttpHata(409, "aiinfapp_eski", "Port " + port + "'de ESKİ, güvenlik denetimi olmayan bir Ai Infapp çalışıyor (bu projenin dışındaki, eski bir Ai Infapp klasörü). Panel onu açmaz.",
    { cozum: "O Ai Infapp penceresini kapat, sonra bu düğmeye yeniden bas. O klasörü bir daha açma: güncellenmiyor. Karakterin ve görsellerin onun data\\ klasöründe duruyor; taşımak istersen önce yedeğini al, sonra bu projedeki ai-infapp\\data içine kopyala." });
  if (t === "baska") throw new HttpHata(409, "aiinfapp_port", "Port " + port + " başka bir program tarafından kullanılıyor; Ai Infapp açılamaz.",
    { cozum: "Portu kullanan programı kapat ya da AIINFAPP_PORT ortam değişkeniyle başka bir port ver (panel ve ai-infapp\\BASLAT.bat aynı değeri görmeli)." });
  if (kapali) throw new HttpHata(500, "aiinfapp", "Ai Infapp başlatma bu ortamda kapalı.");

  let hata = null, cikis = null;
  const p = spawn(process.execPath, [dosyaYolu], { cwd: dizin, windowsHide: true, stdio: "ignore", detached: true, env: altOrtam(port) });
  p.on("error", e => { hata = e; });
  p.on("exit", (kod, sinyal) => { cikis = { kod, sinyal }; });
  p.unref();
  let son = "yok";
  for (let i = 0; i < 40; i++) {                            // en fazla 8 sn: 200 ms'de bir yokla
    await bekle(200);
    if (hata || cikis) break;                               // sunucu acilmadan kapandiysa 8 sn bosuna beklenmez
    son = await tani(port, 400);
    if (son === "yeni") return { ok: true, port };
  }
  // Surec "baska panel zaten acik" (kilit) diye cikis 1 ile kapanmis olabilir: kilit sahibi o sirada aciliyor/acildiysa hata degil basaridir.
  if (cikis && !hata) {
    for (let i = 0; i < 6; i++) {
      if ((await tani(port, 400)) === "yeni") return { ok: true, port, zatenAcik: true };
      await bekle(200);
    }
  }
  const elle = "ai-infapp klasöründe BASLAT.bat ile elle başlatıp penceredeki hata mesajını oku.";
  if (hata) throw new HttpHata(500, "aiinfapp", "Ai Infapp başlatılamadı: " + hata.message, { cozum: elle });
  if (cikis) throw new HttpHata(500, "aiinfapp", "Ai Infapp açılmadan kapandı (" + (cikis.kod !== null ? "çıkış kodu " + cikis.kod : "sinyal " + cikis.sinyal) + ").",
    { cozum: "Port " + port + " başka bir programda ya da Ai Infapp başka bir pencerede açık olabilir (aynı data klasörüne iki sunucu yazamaz). Ayrıca " + elle });
  if (son === "yanit_yok") return { ok: true, port };       // surec yasiyor ve port acik: yalniz yavas yanit veriyor
  try { p.kill(); } catch (e) { /* zaten kapali */ }        // acilmayan sureci arkada yetim birakma
  throw new HttpHata(500, "aiinfapp", "Ai Infapp başlatılamadı (8 sn içinde açılmadı).", { cozum: "Önce " + elle });
}

module.exports = { tani, baslat, altOrtam };
