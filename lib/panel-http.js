// PANEL HTTP YARDIMCILARI — yanit/govde/statik dosya/Range akisi. Sifir bagimlilik.
"use strict";
const fs = require("fs");
const net = require("net");
const path = require("path");
const ortak = require("./ortak");

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".srt": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

// Isleyicilerin firlatabildigi, dogrudan yanita donusen hata.
class HttpHata extends Error {
  constructor(durum, kod, hata, ek) {
    super(hata);
    this.durum = durum; this.kod = kod; this.hata = hata;
    if (ek) Object.assign(this, ek);
  }
}

function json(res, durum, nesne) {
  if (res.headersSent) { try { res.end(); } catch (e) {} return; }
  const govde = JSON.stringify(nesne);
  res.writeHead(durum, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(govde) });
  res.end(govde);
}
// Hata govdesi: {hata, kod, cozum?, detay?} — yigin izi ASLA sizmaz.
function hataYaniti(res, h) {
  const o = { hata: h.hata || h.message, kod: h.kod || "sunucu" };
  for (const k of ["cozum", "detay", "id", "satir", "sutun", "alanlar", "sorunlar"]) if (h[k] !== undefined) o[k] = h[k];
  json(res, h.durum || 500, o);
}

const GOVDE_SINIRI = 5 * 1024 * 1024;
// JSON gövdesini okur. Duz nesne degilse {}. Cok buyukse 413, bozuksa 400.
function govdeOku(req, sinir) {
  sinir = sinir || GOVDE_SINIRI;
  return new Promise((coz, red) => {
    const parcalar = []; let toplam = 0, bitti = false;
    req.on("data", c => {
      if (bitti) return;
      toplam += c.length;
      if (toplam > sinir) { bitti = true; req.resume(); return red(new HttpHata(413, "cok_buyuk", "İstek gövdesi çok büyük (en çok " + Math.round(sinir / 1048576) + " MB).")); }
      parcalar.push(c);
    });
    req.on("error", () => { if (!bitti) { bitti = true; red(new HttpHata(400, "istek", "İstek okunamadı.")); } });
    req.on("end", () => {
      if (bitti) return; bitti = true;
      const metin = Buffer.concat(parcalar).toString("utf8");
      if (!metin.trim()) return coz({});
      let o;
      try { o = JSON.parse(metin.replace(/^\uFEFF/, "")); }
      catch (e) { return red(new HttpHata(400, "json_bozuk", "İstek gövdesi geçerli JSON değil.")); }
      coz(ortak.duzNesne(o) ? o : {});
    });
  });
}

// Statik dosya: yalnizca izinli uzantilar, kok disina cikamaz.
function statikGonder(res, kokDizin, istekYolu, secenek) {
  secenek = secenek || {};
  let yol;
  try { yol = decodeURIComponent(istekYolu); } catch (e) { throw new HttpHata(400, "yol", "Geçersiz adres."); }
  if (yol.includes("\0")) throw new HttpHata(400, "yol", "Geçersiz adres.");
  if (yol === "/") yol = "/panel.html";
  const dosya = path.join(kokDizin, path.normalize(yol));
  if (!ortak.yolIcinde(kokDizin, dosya)) throw new HttpHata(403, "yol", "Bu yola erişim yok.");
  const uz = path.extname(dosya).toLowerCase();
  if (!MIME[uz]) throw new HttpHata(404, "yok", "Bulunamadı.");
  let buf;
  try { buf = fs.readFileSync(dosya); } catch (e) { throw new HttpHata(404, "yok", "Bulunamadı."); }
  if (secenek.donustur && uz === ".html") buf = Buffer.from(secenek.donustur(buf.toString("utf8")), "utf8");
  const bas = { "Content-Type": MIME[uz], "Content-Length": buf.length };
  if (secenek.cerez && uz === ".html") bas["Set-Cookie"] = secenek.cerez;
  res.writeHead(200, bas);
  res.end(buf);
}

// Range destekli dosya akisi (video oynatma/atlama). indirAd verilirse Content-Disposition: attachment.
function dosyaAkit(req, res, dosya, secenek) {
  secenek = secenek || {};
  let st;
  try { st = fs.statSync(dosya); } catch (e) { throw new HttpHata(404, "yok", "Dosya bulunamadı."); }
  if (!st.isFile()) throw new HttpHata(404, "yok", "Dosya bulunamadı.");
  const uz = path.extname(dosya).toLowerCase();
  const bas = { "Content-Type": secenek.tur || MIME[uz] || "application/octet-stream", "Accept-Ranges": "bytes",
    "Cache-Control": secenek.onbellek || "private, no-cache" };
  if (secenek.indirAd) {
    const ad = String(secenek.indirAd);
    bas["Content-Disposition"] = "attachment; filename=\"" + ad.replace(/[^\x20-\x7E]|["\\]/g, "_") + "\"; filename*=UTF-8''" + encodeURIComponent(ad);
  }
  let basla = 0, bitis = st.size - 1, durum = 200;
  const r = req.headers.range;
  if (r) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(r).trim());
    if (!m || (m[1] === "" && m[2] === "")) { res.writeHead(416, { "Content-Range": "bytes */" + st.size }); return res.end(); }
    if (m[1] === "") { basla = Math.max(0, st.size - Number(m[2])); }
    else { basla = Number(m[1]); if (m[2] !== "") bitis = Math.min(bitis, Number(m[2])); }
    if (basla > bitis || basla >= st.size) { res.writeHead(416, { "Content-Range": "bytes */" + st.size }); return res.end(); }
    durum = 206;
    bas["Content-Range"] = "bytes " + basla + "-" + bitis + "/" + st.size;
  }
  bas["Content-Length"] = bitis - basla + 1;
  res.writeHead(durum, bas);
  if (req.method === "HEAD" || st.size === 0) return res.end();
  const akis = fs.createReadStream(dosya, { start: basla, end: bitis });
  akis.on("error", () => { try { res.destroy(); } catch (e) {} });
  res.on("close", () => akis.destroy());
  akis.pipe(res);
}

// 127.0.0.1:<port> TCP baglantisi kabul ediyor mu? (video indirici ve Ai Infapp teshisi bunu kullanir)
function portAcikMi(port, ms) {
  return new Promise(coz => {
    const s = net.connect({ port, host: "127.0.0.1" });
    const son = x => { try { s.destroy(); } catch (e) {} coz(x); };
    s.setTimeout(ms || 400, () => son(false));
    s.on("connect", () => son(true)); s.on("error", () => son(false));
  });
}

module.exports = { MIME, HttpHata, json, hataYaniti, govdeOku, statikGonder, dosyaAkit, GOVDE_SINIRI, portAcikMi };
