// lib/vidiq.js — vidIQ MCP istemcisi (TEK KOPYA).
// senaryo-yaz, baslik-analiz, trend-ara, viral-analiz, performans ve panelin
// anahtar testi bunu kullanir. Eskiden bu istemci 5 dosyada kopyaydi.
//
// Sifir bagimlilik: sadece node built-in. Ag katmani ENJEKSIYONLA degistirilebilir:
//   new VidiqIstemci(anahtar, { https: require("http"), host: "127.0.0.1", port: 4567 })
// boylece testler yerel sahte sunucuya konusur, gercek vidIQ'ya (ve krediye) dokunmaz.
//
// Hata kodlari (OrtakHata.kod, cikis 3 = dis servis; anahtar YOKSA 2):
//   vidiq_anahtar | vidiq_kredi | vidiq_zaman_asimi | vidiq_ag
//   (+ vidiq_uretim: is basladi ama vidIQ tarafinda basarisiz bitti)
"use strict";
const nodeHttps = require("https");

// ---------- hata uretici ----------
// ortak.js baska grubun dosyasi; yuklenemezse (ya da yarim yazilmissa) kendi
// hata sinifimizla ayni alanlari tasiyan bir Error doneriz.
function hata(kod, mesaj, sec) {
  sec = sec || {};
  try {
    const o = require("./ortak");
    if (o && typeof o.OrtakHata === "function") return new o.OrtakHata(kod, mesaj, sec);
  } catch (e) { /* asagidaki yedek */ }
  const e = new Error(mesaj);
  e.name = "OrtakHata";
  e.kod = kod;
  e.cikis = sec.cikis || 1;
  if (sec.cozum) e.cozum = sec.cozum;
  if (sec.detay !== undefined) e.detay = sec.detay;
  return e;
}

const KREDI_RE = /credit|insufficient|kredi|quota|payment required|out of (?:credits|usage)/i;
const ANAHTAR_RE = /unauthori[sz]ed|forbidden|invalid (?:api )?(?:key|token)|authentication|api key/i;
const AG_KODLARI = new Set(["ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED",
  "EPIPE", "ECONNABORTED", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_SOCKET", "CERT_HAS_EXPIRED"]);

const ANAHTAR_COZUM = "Panel > Kaynaklar sekmesinden vidIQ anahtarını yenile (app.vidiq.com/account/settings/mcp).";
const KREDI_COZUM = "vidIQ kredini kontrol et (app.vidiq.com) ya da senaryoyu Claude anahtarıyla yaz.";

// vidIQ araclari sonucu {content:[{type:"text",text}], structuredContent?, isError?} dondurur
function metinCikar(sonuc) {
  if (!sonuc) return "";
  const t = Array.isArray(sonuc.content) && sonuc.content.find(x => x && x.type === "text");
  return t && typeof t.text === "string" ? t.text : "";
}

// yapisal veri: structuredContent > metnin JSON hali > duz metin.
// beklenen (ops.): ["status"] gibi anahtar listesi. Verilirse, bu anahtarlardan birini ICEREN aday secilir
// (structuredContent ile metin JSON'u farkli bicimdeyse dogru olani bulur); hicbiri icermezse varsayilan sira.
function yapisalCikar(sonuc, beklenen) {
  if (!sonuc) return null;
  const adaylar = [];
  if (sonuc.structuredContent !== undefined && sonuc.structuredContent !== null) adaylar.push(sonuc.structuredContent);
  const metin = metinCikar(sonuc);
  if (metin) { let j; try { j = JSON.parse(metin); } catch (e) { j = metin; } adaylar.push(j); }
  if (Array.isArray(beklenen)) {
    for (const a of adaylar) if (a && typeof a === "object" && !Array.isArray(a) && beklenen.some(k => k in a)) return a;
  }
  return adaylar.length ? adaylar[0] : null;
}

const uyku = ms => new Promise(coz => setTimeout(coz, ms));

class VidiqIstemci {
  constructor(anahtar, secenek) {
    const s = secenek || {};
    if (!anahtar) {
      throw hata("vidiq_anahtar", "VIDIQ_KEY yok.", { cikis: 2,
        cozum: "Panel > Kaynaklar sekmesine vidIQ anahtarını yapıştır (app.vidiq.com/account/settings/mcp)." });
    }
    this.anahtar = String(anahtar);
    this.zamanAsimiMs = s.zamanAsimiMs > 0 ? s.zamanAsimiMs : 90000;
    this.https = s.https || nodeHttps;
    this.host = s.host || "mcp.vidiq.com";
    this.port = s.port;
    this.yol = s.yol || "/mcp";
    // TEST ortami: OTOMASYON_VIDIQ_URL=http://127.0.0.1:PORT/mcp (ayri surec olarak calisan CLI testleri icin).
    // Gercek kullanimda tanimli degildir.
    if (!s.https && !s.host && process.env.OTOMASYON_VIDIQ_URL) {
      try {
        const u = new URL(process.env.OTOMASYON_VIDIQ_URL);
        this.https = u.protocol === "http:" ? require("http") : nodeHttps;
        this.host = u.hostname; this.port = u.port ? Number(u.port) : undefined; this.yol = u.pathname || "/mcp";
      } catch (e) { /* gecersiz adres: varsayilana dus */ }
    }
    this.bekle = s.bekle || uyku;            // testte bekleme atlanabilsin
    this.oturum = null;
    this.sayac = 0;
    this.hazir = false;
  }

  // --- tek HTTP istegi ---
  _istek(govde, bildirim) {
    return new Promise((coz, red) => {
      const veri = JSON.stringify(govde);
      const basliklar = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": "Bearer " + this.anahtar,
        "Content-Length": Buffer.byteLength(veri),
      };
      if (this.oturum) basliklar["Mcp-Session-Id"] = this.oturum;

      let bitti = false;
      let zamanlayici = null;
      const bitir = (fn, deger) => { if (bitti) return; bitti = true; clearTimeout(zamanlayici); fn(deger); };

      const secenek = { hostname: this.host, path: this.yol, method: "POST", headers: basliklar };
      if (this.port) secenek.port = this.port;
      const r = this.https.request(secenek, res => {
        const sid = res.headers["mcp-session-id"];
        if (sid) this.oturum = sid;
        let g = "";
        res.setEncoding("utf8");
        res.on("data", c => g += c);
        res.on("error", e => bitir(red, this._agHatasi(e)));
        res.on("end", () => {
          const d = res.statusCode;
          if (d === 401 || d === 403)
            return bitir(red, hata("vidiq_anahtar", "vidIQ anahtarı kabul edilmedi (HTTP " + d + ").",
              { cikis: 3, cozum: ANAHTAR_COZUM, detay: g.slice(0, 200) }));
          if (d === 402)
            return bitir(red, hata("vidiq_kredi", "vidIQ kredin bitmiş görünüyor (HTTP 402).",
              { cikis: 3, cozum: KREDI_COZUM, detay: g.slice(0, 200) }));
          if (d === 429)
            return bitir(red, hata("vidiq_ag", "vidIQ istek sınırına takıldı (HTTP 429). Biraz bekleyip tekrar dene.",
              { cikis: 3, cozum: "Birkaç dakika sonra yeniden dene.", detay: g.slice(0, 200) }));
          if (d >= 500)
            return bitir(red, hata("vidiq_ag", "vidIQ şu an yanıt vermiyor (HTTP " + d + ").",
              { cikis: 3, cozum: "Birkaç dakika sonra yeniden dene.", detay: g.slice(0, 200) }));
          if (d >= 400 && !bildirim) {
            const e = hata(KREDI_RE.test(g) ? "vidiq_kredi" : "vidiq_ag",
              KREDI_RE.test(g) ? "vidIQ krediniz yetersiz." : "vidIQ isteği reddetti (HTTP " + d + ").",
              { cikis: 3, cozum: KREDI_RE.test(g) ? KREDI_COZUM : undefined, detay: g.slice(0, 300) });
            e.httpDurum = d;
            return bitir(red, e);
          }
          if (bildirim) return bitir(coz, null);

          // yanit ya duz JSON ya da SSE ("data: {...}") olabilir
          let j = null;
          if (/^\s*\{/.test(g)) { try { j = JSON.parse(g); } catch (e) { /* SSE dene */ } }
          if (!j) {
            for (const satir of g.split(/\r?\n/)) {
              const m = satir.match(/^data:\s*(\{.*\})\s*$/);
              if (m) { try { const p = JSON.parse(m[1]); if (p.result || p.error) j = p; } catch (e) { /* sonraki satir */ } }
            }
          }
          if (!j) return bitir(red, hata("vidiq_ag", "vidIQ yanıtı okunamadı.",
            { cikis: 3, detay: g.slice(0, 200) }));
          if (j.error) {
            const msj = j.error.message || JSON.stringify(j.error);
            const kod = KREDI_RE.test(msj) ? "vidiq_kredi" : ANAHTAR_RE.test(msj) ? "vidiq_anahtar" : "vidiq_ag";
            return bitir(red, hata(kod, "vidIQ: " + msj,
              { cikis: 3, cozum: kod === "vidiq_kredi" ? KREDI_COZUM : kod === "vidiq_anahtar" ? ANAHTAR_COZUM : undefined }));
          }
          bitir(coz, j.result);
        });
      });
      zamanlayici = setTimeout(() => {
        bitir(red, hata("vidiq_zaman_asimi", "vidIQ " + Math.round(this.zamanAsimiMs / 1000) + " sn içinde yanıt vermedi.",
          { cikis: 3, cozum: "İnternet bağlantını kontrol edip tekrar dene." }));
        try { r.destroy(); } catch (e) { /* zaten kapali */ }
      }, this.zamanAsimiMs);
      r.on("error", e => bitir(red, this._agHatasi(e)));
      r.write(veri);
      r.end();
    });
  }

  _agHatasi(e) {
    const kod = e && e.code;
    return hata("vidiq_ag",
      "vidIQ'ya ulaşılamadı" + (kod ? " (" + kod + ")" : "") + ". İnternet bağlantını kontrol et.",
      { cikis: 3, cozum: "Bağlantı geri gelince tekrar dene.", detay: e && e.message });
  }

  // --- MCP el sikismasi (idempotent) ---
  async baslat() {
    if (this.hazir) return this;
    let son = null;
    for (let deneme = 0; deneme < 2; deneme++) {
      try {
        await this._istek({
          jsonrpc: "2.0", id: ++this.sayac, method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "otomasyon-paneli", version: "1.0" } },
        });
        await this._istek({ jsonrpc: "2.0", method: "notifications/initialized" }, true);
        this.hazir = true;
        return this;
      } catch (e) {
        son = e;
        // anahtar/kredi hatasinda tekrar denemenin anlami yok; sadece ag hatasinda 1 kez daha
        if (e.kod !== "vidiq_ag" && e.kod !== "vidiq_zaman_asimi") break;
        await this.bekle(1500);
      }
    }
    throw son;
  }

  // ham MCP sonucu (isError denetimli). Metin ozeti de lazimsa bunu kullan.
  async cagirHam(arac, arg) {
    await this.baslat();
    let sonuc;
    try {
      sonuc = await this._istek({ jsonrpc: "2.0", id: ++this.sayac, method: "tools/call",
        params: { name: arac, arguments: arg || {} } });
    } catch (e) {
      // oturum suresi dolduysa (404) istek ISLENMEMISTIR; yeniden baslatip bir kez tekrar guvenli
      if (e.httpDurum === 404 && this.oturum) {
        this.oturum = null; this.hazir = false;
        await this.baslat();
        sonuc = await this._istek({ jsonrpc: "2.0", id: ++this.sayac, method: "tools/call",
          params: { name: arac, arguments: arg || {} } });
      } else throw e;
    }
    const metin = metinCikar(sonuc);
    if (sonuc && (sonuc.isError || /^MCP error|Input validation error/i.test(metin))) {
      const ozet = metin.replace(/\s+/g, " ").slice(0, 300);
      const kod = KREDI_RE.test(ozet) ? "vidiq_kredi" : ANAHTAR_RE.test(ozet) ? "vidiq_anahtar" : "vidiq_ag";
      throw hata(kod, "vidIQ isteği reddetti (" + arac + "): " + ozet,
        { cikis: 3, cozum: kod === "vidiq_kredi" ? KREDI_COZUM : kod === "vidiq_anahtar" ? ANAHTAR_COZUM : undefined });
    }
    return sonuc;
  }

  // yapilandirilmis sonuc (structuredContent > JSON metin > duz metin); beklenen: yapisalCikar'a bkz.
  async cagir(arac, arg, beklenen) {
    return yapisalCikar(await this.cagirHam(arac, arg), beklenen);
  }

  // asenkron isi (vidiq_generate_script gibi) bitene kadar sorgular; sonucu dondurur.
  async isBekle(jobId, sec) {
    const s = sec || {};
    const maksSn = s.maksSn > 0 ? s.maksSn : 360;
    const aralikSn = s.aralikSn > 0 ? s.aralikSn : 4;
    const adim = Math.max(1, Math.ceil(maksSn / aralikSn));
    for (let i = 0; i < adim; i++) {
      await this.bekle(aralikSn * 1000);
      const d = await this.cagir("vidiq_job_poll", { mcpJobId: jobId }, ["status"]);
      if (!d || typeof d !== "object") continue;
      if (d.status === "completed") return d.result;
      if (d.status === "failed" || d.status === "expired") {
        const neden = d.errorCode || d.status;
        const iade = d.refunded === true ? " Krediler iade edildi." : "";
        throw hata(KREDI_RE.test(String(neden)) ? "vidiq_kredi" : "vidiq_uretim",
          "vidIQ üretimi başarısız oldu (" + neden + ")." + iade,
          { cikis: 3, cozum: "Biraz sonra tekrar dene ya da senaryoyu Claude anahtarıyla yaz.", detay: d });
      }
      if (typeof s.onIlerleme === "function") {
        try { s.onIlerleme({ gecenSn: (i + 1) * aralikSn, maksSn, durum: d.status }); } catch (e) { /* ilerleme gostergesi isi bozmasin */ }
      }
    }
    throw hata("vidiq_zaman_asimi", "vidIQ işi " + Math.round(maksSn / 60) + " dakikada bitmedi.",
      { cikis: 3, cozum: "Biraz sonra tekrar dene. İş vidIQ tarafında sürüyorsa kredi harcanmış olabilir (iş no: " + jobId + ").",
        detay: { jobId } });
  }
}

// anahtar canli mi? (ucretsiz: el sikisma + bakiye). Asla firlatmaz.
async function test(anahtar, secenek) {
  if (!anahtar) return { ok: false, mesaj: "anahtar girilmemiş" };
  let ist;
  try {
    ist = new VidiqIstemci(anahtar, Object.assign({ zamanAsimiMs: 20000 }, secenek || {}));
    await ist.baslat();
  } catch (e) {
    if (e.kod === "vidiq_anahtar")
      return { ok: false, mesaj: "anahtar geçersiz — vidIQ'dan yeni anahtar al (app.vidiq.com/account/settings/mcp)" };
    if (e.kod === "vidiq_zaman_asimi") return { ok: false, mesaj: "vidIQ yanıt vermedi" };
    return { ok: false, mesaj: e.message };
  }
  let ek = "";
  try {
    const b = await bakiye(anahtar, Object.assign({}, secenek || {}, { istemci: ist }));
    if (b.kalan !== null) ek = " — kalan kredi: " + b.kalan;
  } catch (e) { /* bakiye okunamadiysa anahtar yine de calisiyor */ }
  return { ok: true, mesaj: "çalışıyor — vidIQ hazır" + ek };
}

// kalan kredi: vidiq_balance {totalCredits,...} dondurur. Bicim degisirse kalan=null, ham doner.
async function bakiye(anahtar, secenek) {
  const s = secenek || {};
  const ist = s.istemci || new VidiqIstemci(anahtar, s);
  const ham = await ist.cagir("vidiq_balance", {});
  let kalan = null;
  if (ham && typeof ham === "object") {
    for (const alan of ["totalCredits", "total", "credits", "balance", "remaining"]) {
      if (typeof ham[alan] === "number") { kalan = ham[alan]; break; }
    }
  }
  return { kalan, ham };
}

module.exports = { VidiqIstemci, test, bakiye, metinCikar, yapisalCikar };
