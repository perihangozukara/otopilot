// Panel testleri icin ortak yardimcilar: gecici ortam, sahte betik klasoru, panel sureci baslatma, jetonlu HTTP istemcisi.
// Gercek .env'e, ucretli servise ve ag'a DOKUNMAZ: ortam degiskenleri gecici dosyalara yonlendirilir.
"use strict";
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const KOK = path.resolve(__dirname, "..");

function bosPort() {
  return new Promise((coz, red) => {
    const s = net.createServer();
    s.on("error", red);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => coz(p)); });
  });
}

// Sahte betikler: her biri uretim/<is>/_sahte.json'daki yonergeye gore davranir.
//   {"hata":{"video-yap.js":3}, "bekle":{"seslendir.js":3000}, "sessiz":{"video-yap.js":true}}
const SAHTE_BETIK = `
"use strict";
const fs = require("fs"), path = require("path");
const ad = path.basename(__filename);
const is = process.argv[2];
const U = process.env.OTOMASYON_URETIM;
const B = path.join(U, is || "_yok");
let y = {}; try { y = JSON.parse(fs.readFileSync(path.join(B, "_sahte.json"), "utf8")); } catch (e) {}
try { fs.appendFileSync(path.join(B, "_cagrilar.txt"), ad + " " + process.argv.slice(2).join(" ") + "\\n"); } catch (e) {}
const dur = (y.bekle || {})[ad] || 0;
function say(s) { console.log(s); }
function yaz(p, icerik) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, icerik); }
async function ana() {
  say("basladi " + ad);
  console.log("@@ILERLEME " + JSON.stringify({ asama: "sahte", n: 1, toplam: 2, yuzde: 50 }));
  if ((y.sessiz || {})[ad]) { await new Promise(() => setInterval(() => {}, 1000)); }
  if (dur) {
    yaz(path.join(B, "Videos", "yarim.part.mp4"), "x");
    await new Promise(r => setTimeout(r, dur));
  }
  const kod = (y.hata || {})[ad];
  if (kod) { console.error("@@HATA " + JSON.stringify({ kod: "sahte", mesaj: ad + " sahte hata verdi", cozum: "sahte cozum" })); console.error("✗ " + ad + " sahte hata verdi"); process.exit(kod); }
  if (ad === "senaryo-claude.js" || ad === "senaryo-yaz.js") yaz(path.join(B, "Voice", "SESLENDIRME-TAM-METIN.txt"), "Birinci paragraf yeterince uzun bir cumle olsun diye yaziliyor.\\n\\nIkinci paragraf da bir baska uzun cumleden olusuyor ve bitiyor.\\n");
  if (ad === "gorsel-bul.js") { if ((y.atla || {})[ad]) { console.log("@@SONUC " + JSON.stringify({ atlandi: true, neden: "gorseller guncel" })); return; } yaz(path.join(B, "Visuals", "001-a", "01.jpg"), "jpg"); }
  if (ad === "seslendir.js") { yaz(path.join(B, "Voice", "parts", "000.mp3"), "m"); yaz(path.join(B, "Voice", "parts", "001.mp3"), "m"); }
  if (ad === "video-yap.js") yaz(path.join(B, "Videos", is + ".mp4"), Buffer.alloc(200000, 1));
  console.log("@@SONUC " + JSON.stringify({ tamam: true }));
}
ana().catch(e => { console.error("✗ " + e.message); process.exit(1); });
`;
const SAHTE_ADLAR = ["senaryo-claude.js", "senaryo-yaz.js", "gorsel-bul.js", "seslendir.js", "video-yap.js", "baslik-analiz.js",
  "altyazi-cevir.js", "formul-kart.js", "prompt-kart.js", "kapak-yap.js", "yayin-paketi.js", "gorsel-uret.js", "gorsel-cek.js", "portre-cek.js"];

function geciciOrtam(onek) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), "otomasyon-" + (onek || "test") + "-"));
  const o = { kok, uretim: path.join(kok, "uretim"), env: path.join(kok, ".env"), ayar: path.join(kok, "panel-ayar.json"), betik: path.join(kok, "betikler") };
  fs.mkdirSync(o.uretim, { recursive: true });
  fs.mkdirSync(o.betik, { recursive: true });
  fs.writeFileSync(o.env, "");
  for (const a of SAHTE_ADLAR) fs.writeFileSync(path.join(o.betik, a), SAHTE_BETIK);
  o.temizle = () => { try { fs.rmSync(kok, { recursive: true, force: true }); } catch (e) {} };
  return o;
}

// Paneli ayri surec olarak baslatir. secenek: {env:{}, port}
async function panelBaslat(ortam, secenek) {
  secenek = secenek || {};
  const port = secenek.port || await bosPort();
  const env = Object.assign({}, process.env, {
    OTOMASYON_URETIM: ortam.uretim, OTOMASYON_ENV_DOSYASI: ortam.env, OTOMASYON_AYAR_DOSYASI: ortam.ayar,
    OTOMASYON_RAPOR_KOKU: ortam.kok, PANEL_PORT: String(port), PANEL_BETIK_DIZINI: ortam.betik, PANEL_ANAHTAR_TEST_KAPALI: "1",
    PANEL_AC_KAPALI: "1", PANEL_INDIRICI_KAPALI: "1", PANEL_KONTROL_MS: "200",
  }, secenek.env || {});
  delete env.ANTHROPIC_API_KEY; delete env.VIDIQ_KEY; delete env.ANTHROPIC_MODEL;
  Object.assign(env, secenek.env || {});
  const p = spawn(process.execPath, [path.join(KOK, "panel.js")], { cwd: KOK, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let cikti = "";
  p.stdout.on("data", d => cikti += d); p.stderr.on("data", d => cikti += d);
  let bitti = null;
  p.on("close", k => { bitti = k; });
  const istemci = new Istemci(port);
  const bas = Date.now();
  for (;;) {
    if (bitti !== null) throw new Error("panel acilmadan kapandi (kod " + bitti + "): " + cikti);
    try { await istemci.jetonAl(); break; } catch (e) { if (Date.now() - bas > 15000) throw new Error("panel acilmadi: " + cikti); await new Promise(r => setTimeout(r, 100)); }
  }
  return { p, port, istemci, cikti: () => cikti, kapat: () => new Promise(coz => { if (bitti !== null) return coz(); p.on("close", () => coz()); try { p.kill(); } catch (e) { coz(); } setTimeout(coz, 3000).unref(); }), cikisKodu: () => bitti };
}

class Istemci {
  constructor(port) { this.port = port; this.jeton = null; this.cerez = null; }
  istek(yontem, yol, govde, ek) {
    ek = ek || {};
    return new Promise((coz, red) => {
      const h = Object.assign({}, ek.baslik || {});
      let veri = null;
      if (govde !== undefined && govde !== null) { veri = typeof govde === "string" ? govde : JSON.stringify(govde); }
      if (veri !== null && !("Content-Type" in h) && !("content-type" in h)) h["Content-Type"] = "application/json";
      if (veri !== null) h["Content-Length"] = Buffer.byteLength(veri);
      if (this.jeton && !ek.jetonsuz) h["X-Panel-Token"] = this.jeton;
      if (this.cerez && ek.cerezli) h["Cookie"] = this.cerez;
      const r = http.request({ host: "127.0.0.1", port: this.port, path: yol, method: yontem, headers: h }, res => {
        const p = []; res.on("data", c => p.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(p); let json = null;
          try { json = JSON.parse(buf.toString("utf8")); } catch (e) {}
          coz({ durum: res.statusCode, baslik: res.headers, buf, metin: buf.toString("utf8"), json });
        });
      });
      r.on("error", red);
      if (veri !== null) r.write(veri);
      r.end();
    });
  }
  get(yol, ek) { return this.istek("GET", yol, undefined, ek); }
  post(yol, govde, ek) { return this.istek("POST", yol, govde === undefined ? {} : govde, ek); }
  async jetonAl() {
    const r = await this.istek("GET", "/", undefined, { jetonsuz: true });
    const m = /<meta name="panel-token" content="([0-9a-f]+)"/.exec(r.metin);
    if (!m) throw new Error("jeton yok (durum " + r.durum + ")");
    this.jeton = m[1];
    const sc = r.baslik["set-cookie"];
    if (sc && sc[0]) this.cerez = sc[0].split(";")[0];
    return this.jeton;
  }
  // bir kosu bitene kadar bekle ({durum} istenen durumlardan birine gelince doner)
  async bekle(id, durumlar, ms) {
    const bas = Date.now();
    for (;;) {
      const r = await this.get("/api/log?id=" + id);
      if (r.json && durumlar.includes(r.json.durum)) return r.json;
      if (Date.now() - bas > (ms || 15000)) throw new Error("zaman asimi; son durum: " + (r.json && r.json.durum) + " " + JSON.stringify(r.json && r.json.satirlar && r.json.satirlar.slice(-5)));
      await new Promise(z => setTimeout(z, 80));
    }
  }
}

const ISE_YAZ = (ortam, is, sahte) => fs.writeFileSync(path.join(ortam.uretim, is, "_sahte.json"), JSON.stringify(sahte));

module.exports = { KOK, bosPort, geciciOrtam, panelBaslat, Istemci, ISE_YAZ, SAHTE_ADLAR };
