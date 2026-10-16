// GORSEL HATTININ HTTP ISTEMCISI (GO grubu) — gorsel-bul, gorsel-cek, portre-cek, gorsel-uret, vs-kur
// hep bunu kullanir; her dosyada ayri kopya olmasin.
//
// Garantiler:
//   - bagimsiz zaman asimi: soket bosta kalirsa (zamanAsimiMs) VE toplam sure asilirsa (toplamAsimiMs)
//   - indirme ust siniri (maksBayt): Content-Length + akis sayaci; yarim kalan indirme hata verir
//   - yonlendirmede (baska makineye ya da baska protokole, ornegin https -> http) Authorization/Cookie/x-api-key DUSER;
//     en cok 5 yonlendirme
//   - 429: Retry-After / X-Ratelimit-Reset kadar bekler (limitBekleSn'yi asmiyorsa), degilse hata + bekleSn
//   - 5xx ve ag kopmasi: 2 kez daha dener (artan bekleme)
//   - yerel/ozel ag adreslerine (localhost, 10.x, 192.168.x ...) GITMEZ (izinYerel: testler icin)
//   - GET varsayilan; secenek.gonder (string/Buffer) verilirse POST (yonlendirme izlenmez); hataGovdesi: servisin
//     hata aciklamasini (ilk 300 karakter) e.govde'ye alir
// Testlerde ag, {https, http} modulu ya da dogrudan `getir` islevi enjekte edilerek sahtelenir.
"use strict";
const httpsModul = require("https");
const httpModul = require("http");
const agGuvenlik = require("./ag-guvenlik");

const UA = "OtomasyonPaneli/1.0 (kisisel video uretimi; node " + process.versions.node + ")";
const MAKS_GORSEL_BAYT = 25 * 1024 * 1024;           // sozlesme: 25 MB ust sinir
const HASSAS_BASLIK = /^(authorization|cookie|proxy-authorization|x-api-key)$/i;

class AgHatasi extends Error {
  // kod: HTTP durumu (sayi) ya da "zaman_asimi" | "cok_buyuk" | "yarim" | "yonlendirme" | "adres" | "yerel_adres" | "json"
  constructor(mesaj, kod, ek) {
    super(mesaj);
    this.name = "AgHatasi";
    this.kod = kod;
    if (ek) Object.assign(this, ek);
  }
}

const uyku = ms => new Promise(r => setTimeout(r, ms));

// Yerel/ozel ag karari lib/ag-guvenlik.js'te (IPv6'da gomulu IPv4, 'localhost.', tek etiketli ad, CGNAT ... dahil).
const ozelAdresMi = agGuvenlik.yerelAdresMi;

// Alan adinin yerel adrese COZULME denetimi (DNS), bilinen proxy/VPN "fake-ip" modunu (198.18.0.0/15) zaten engellemez
// (lib/ag-guvenlik.js). Baska bir kurulumda (kurumsal DNS, 100.64.x ile cozen VPN) her istek yine reddediliyorsa denetim
// ortam degiskeniyle kapatilabilir: .env'e ya da ortama GORSEL_YEREL_AG_IZIN=1 yaz. YALNIZ ad cozumleme denetimini kapatir;
// dogrudan IP olarak yazilan yerel adresler (127.0.0.1, 192.168.x.x ...) ve .local/.internal adlari yine reddedilir.
function dnsDenetimiKapaliMi() {
  let v = process.env.GORSEL_YEREL_AG_IZIN;
  try { v = require("./ortak.js").envOku("GORSEL_YEREL_AG_IZIN") || v; } catch (e) { /* ortak.js okunamazsa ortam degiskeni yeter */ }
  return /^(1|true|evet|yes)$/i.test(String(v || "").trim());
}

// Gercek ag modulu kullaniliyorsa (testlerde https/http enjekte edilir) alan adi yerel adrese cozuluyor mu diye de bakar:
// localtest.me, 127.0.0.1.nip.io gibi adlar yalniz adres denetimini asiyordu. Yonlendirmeler de buradan gecer (tekIstekIc kendini tekIstek ile cagirir).
async function tekIstek(url, o, derinlik) {
  if (!o.izinYerel && !o.https && !o.http) {
    let host = "";
    try { const u = new URL(url); if (u.protocol === "https:" || u.protocol === "http:") host = u.hostname; } catch (e) { /* tekIstekIc "adres" hatasini verir */ }
    // ortam degiskeni yalniz denetim "yerel" dediginde okunur (her istekte .env okunmasin)
    if (host && !ozelAdresMi(host) && await agGuvenlik.adYerelCozuluyorMu(host) && !dnsDenetimiKapaliMi())
      throw new AgHatasi("Yerel ağ adresine çözülen ad: " + host + " (VPN/proxy kullanıyorsan .env dosyasına GORSEL_YEREL_AG_IZIN=1 yazabilirsin)", "yerel_adres", { adCozumu: true });
  }
  return tekIstekIc(url, o, derinlik);
}

// Tek istek (yonlendirmeleri takip eder). Basarida {govde, durum, basliklar, sonUrl}.
function tekIstekIc(url, o, derinlik) {
  return new Promise((coz, red) => {
    let u;
    try { u = new URL(url); } catch (e) { return red(new AgHatasi("Geçersiz adres.", "adres")); }
    if (u.protocol !== "https:" && u.protocol !== "http:") return red(new AgHatasi("Yalnızca http/https adresleri desteklenir.", "adres"));
    if (!o.izinYerel && ozelAdresMi(u.hostname)) return red(new AgHatasi("Yerel ağ adreslerine gidilmez: " + u.hostname, "yerel_adres"));
    const modul = u.protocol === "https:" ? (o.https || httpsModul) : (o.http || httpModul);
    const basliklar = Object.assign({ "User-Agent": UA, "Accept": "*/*" }, o.basliklar || {});
    const gonder = o.gonder !== undefined && o.gonder !== null ? o.gonder : null;      // POST govdesi (string/Buffer)
    const metot = gonder !== null ? "POST" : "GET";
    if (gonder !== null) basliklar["Content-Length"] = Buffer.byteLength(gonder);

    let bitti = false, tToplam = null, req = null;
    const bitir = (fn, v) => {
      if (bitti) return;
      bitti = true;
      clearTimeout(tToplam);
      fn(v);
    };
    // once sonucu kilitle, sonra baglantiyi kes (destroy 'aborted' olayini hemen tetikler; hata turu ezilmesin)
    const durdur = hata => { bitir(red, hata); try { if (req) req.destroy(); } catch (e) {} };

    tToplam = setTimeout(() => durdur(new AgHatasi("Zaman aşımı (toplam süre doldu).", "zaman_asimi")), o.toplamAsimiMs || 120000);
    try {
      req = modul.request(u, { method: metot, headers: basliklar, timeout: o.zamanAsimiMs || 30000 }, res => {
        const durum = res.statusCode;
        if (durum >= 300 && durum < 400 && res.headers.location && metot === "GET") {
          res.resume();
          if (derinlik >= (o.yonlendirmeSiniri || 5)) return bitir(red, new AgHatasi("Çok fazla yönlendirme.", "yonlendirme"));
          let hedef;
          try { hedef = new URL(res.headers.location, u); } catch (e) { return bitir(red, new AgHatasi("Geçersiz yönlendirme adresi.", "yonlendirme")); }
          // baska makineye ya da baska PROTOKOLE (https -> http: acik metin) gidiyorsak gizli basliklari (Pexels Authorization
          // anahtari dahil) birakma
          const yeni = Object.assign({}, o.basliklar || {});
          if (hedef.host !== u.host || hedef.protocol !== u.protocol) for (const k of Object.keys(yeni)) if (HASSAS_BASLIK.test(k)) delete yeni[k];
          bitti = true; clearTimeout(tToplam);
          return coz(tekIstek(hedef.toString(), Object.assign({}, o, { basliklar: yeni }), derinlik + 1));
        }
        if (durum !== 200) {
          if (!o.hataGovdesi) { res.resume(); return bitir(red, new AgHatasi("HTTP " + durum, durum, { basliklar: res.headers })); }
          // servis hata aciklamasini (kisa) oku: "Pollinations: HTTP 502 ..." gibi gorunur hata icin
          const k = []; let n = 0;
          res.on("data", c => { if (n < 600) { k.push(c); n += c.length; } });
          const kapat = () => bitir(red, new AgHatasi("HTTP " + durum, durum, { basliklar: res.headers, govde: Buffer.concat(k).toString("utf8").slice(0, 300) }));
          res.on("end", kapat); res.on("error", kapat); res.on("aborted", kapat);
          return;
        }
        const cl = Number(res.headers["content-length"]);
        if (o.maksBayt && Number.isFinite(cl) && cl > o.maksBayt)
          return durdur(new AgHatasi("Dosya çok büyük (" + Math.round(cl / 1048576) + " MB).", "cok_buyuk"));
        const parca = [];
        let toplam = 0;
        res.on("data", c => {
          toplam += c.length;
          if (o.maksBayt && toplam > o.maksBayt) return durdur(new AgHatasi("Dosya çok büyük (sınır aşıldı).", "cok_buyuk"));
          parca.push(c);
        });
        res.on("end", () => {
          if (Number.isFinite(cl) && cl !== toplam && !res.headers["content-encoding"])
            return bitir(red, new AgHatasi("İndirme yarım kaldı.", "yarim"));
          bitir(coz, { govde: Buffer.concat(parca), durum, basliklar: res.headers, sonUrl: u.toString() });
        });
        res.on("error", e => bitir(red, e));
        res.on("aborted", () => bitir(red, new AgHatasi("Bağlantı yarıda koptu.", "yarim")));
      });
      req.on("timeout", () => durdur(new AgHatasi("Zaman aşımı.", "zaman_asimi")));
      req.on("error", e => bitir(red, e));
      if (gonder !== null) req.write(gonder);
      req.end();
    } catch (e) { bitir(red, e); }
  });
}

// 429 yanitinda beklenecek sure (sn); basliklardan okunamazsa null
function beklemeSuresi(basliklar) {
  if (!basliklar) return null;
  const ra = basliklar["retry-after"];
  if (ra !== undefined) {
    const n = Number(ra);
    if (Number.isFinite(n)) return Math.max(0, n);
    const t = Date.parse(ra);
    if (Number.isFinite(t)) return Math.max(0, (t - Date.now()) / 1000);
  }
  const reset = Number(basliklar["x-ratelimit-reset"]);       // Pexels: UNIX saniyesi
  if (Number.isFinite(reset) && reset > 1e9) return Math.max(0, reset - Date.now() / 1000);
  if (Number.isFinite(reset)) return Math.max(0, reset);
  return null;
}

const AG_KODLARI = ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "EPIPE", "ECONNABORTED", "UND_ERR_CONNECT_TIMEOUT"];
function yenidenDenenir(e) {
  if (typeof e.kod === "number") return e.kod >= 500;
  if (["zaman_asimi", "yarim"].includes(e.kod)) return true;
  return AG_KODLARI.includes(e.code);
}

// Yeniden deneme + 429 bekleme
async function getirDene(url, o) {
  const bekle = o.bekle || uyku;
  const toplamDeneme = o.denemeSayisi || 3;
  const limitIzin = o.limitBekleSn !== undefined ? o.limitBekleSn : 30;
  let son;
  for (let i = 0; i < toplamDeneme; i++) {
    try { return await tekIstek(url, o, 0); }
    catch (e) {
      son = e;
      const sonDeneme = i >= toplamDeneme - 1;
      if (e.kod === 429) {
        const sn = beklemeSuresi(e.basliklar);
        const bekleSn = sn === null ? [2, 6, 12][i] : sn;
        if (e.basliklar) e.bekleSn = sn;
        if (!sonDeneme && bekleSn !== undefined && bekleSn <= limitIzin) { await bekle(Math.ceil(bekleSn * 1000) + 250); continue; }
        throw e;
      }
      if (e.kod === "zaman_asimi" && o.zamanAsimiTekrarYok) throw e;       // yavas servisi 3 kez bekleme
      if (!sonDeneme && yenidenDenenir(e)) { await bekle([1000, 3000, 6000][i] || 6000); continue; }
      throw e;
    }
  }
  throw son;
}

// Varsayilan secenekleri bagli bir getir(url, secenek) islevi dondurur.
//   getir(url)         -> {govde: Buffer, durum, basliklar, sonUrl}
//   getir.json(url)    -> ayristirilmis JSON
//   getir.gorsel(url)  -> {govde,...}, MAKS_GORSEL_BAYT sinirli, daha az yeniden deneme
function istemciYap(varsayilan) {
  const taban = varsayilan || {};
  const getir = (url, o) => getirDene(url, Object.assign({}, taban, o || {}));
  getir.json = async (url, o) => {
    const r = await getir(url, o);
    try { return JSON.parse(r.govde.toString("utf8")); }
    catch (e) { throw new AgHatasi("Servis geçersiz JSON döndürdü.", "json"); }
  };
  getir.gorsel = (url, o) => getir(url, Object.assign({ maksBayt: MAKS_GORSEL_BAYT, denemeSayisi: 2, limitBekleSn: 5 }, o || {}));
  getir.taban = taban;
  return getir;
}

// Hata icin kisa, kullaniciya gosterilebilir aciklama (adres/anahtar SIZDIRMAZ)
function hataOzeti(e) {
  if (!e) return "bilinmeyen hata";
  if (typeof e.kod === "number") return "HTTP " + e.kod;
  if (e.kod === "zaman_asimi") return "zaman aşımı";
  if (e.kod === "yarim") return "indirme yarım kaldı";
  if (e.kod === "cok_buyuk") return "dosya çok büyük";
  if (e.kod === "json") return "geçersiz yanıt";
  if (e.kod === "yerel_adres") return e.adCozumu ? "ad yerel ağ adresine çözüldü (VPN/proxy ise .env'e GORSEL_YEREL_AG_IZIN=1 yaz)" : "yerel ağ adresi engellendi";
  if (e.code) return String(e.code);
  return String(e.message || e).split("\n")[0].slice(0, 80);
}

module.exports = { AgHatasi, istemciYap, getirDene, tekIstek, beklemeSuresi, ozelAdresMi, hataOzeti, dnsDenetimiKapaliMi, UA, MAKS_GORSEL_BAYT, uyku };
