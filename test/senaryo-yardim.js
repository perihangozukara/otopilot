// test/senaryo-yardim.js — senaryo grubu testlerinin ortak yardimcilari.
// DIKKAT: bu dosya testlerde EN ONCE require edilmelidir: ortam degiskenlerini (uretim klasoru, .env,
// panel-ayar, rapor koku) gecici klasore cevirir; gercek .env ve uretim/ ASLA okunmaz/yazilmaz.
// Ag cagrilari sahtelenir: sahteMcp (yerel http sunucu) ve sahteClaude (istemci enjeksiyonu).
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const KOK = fs.mkdtempSync(path.join(os.tmpdir(), "senaryo-test-"));
const URETIM = path.join(KOK, "uretim");
fs.mkdirSync(URETIM, { recursive: true });
process.env.OTOMASYON_URETIM = URETIM;
process.env.OTOMASYON_ENV_DOSYASI = path.join(KOK, ".env");            // yok = bos
process.env.OTOMASYON_AYAR_DOSYASI = path.join(KOK, "panel-ayar.json");  // yok = varsayilanlar
process.env.OTOMASYON_RAPOR_KOKU = path.join(KOK, "raporlar");
// gercek anahtarlar sizmasin; testler anahtari kendisi verir
for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "VIDIQ_KEY", "MALIYET_UST_SINIR_USD", "ANTHROPIC_BASE_URL"]) delete process.env[k];

function temizle() { try { fs.rmSync(KOK, { recursive: true, force: true }); } catch (e) { /* windows kilidi */ } }
process.on("exit", temizle);

function isOlustur(ad, konu, senaryo) {
  const d = path.join(URETIM, ad);
  fs.mkdirSync(path.join(d, "Voice"), { recursive: true });
  if (konu !== null) fs.writeFileSync(path.join(d, "konu.json"), JSON.stringify(konu, null, 2));
  if (senaryo) fs.writeFileSync(path.join(d, "Voice", "SESLENDIRME-TAM-METIN.txt"), senaryo);
  return d;
}
// betigin konsol ciktisini testte sustur (hatalar ve @@ satirlari dahil)
async function sessiz(fn) {
  const w = process.stdout.write.bind(process.stdout), e = process.stderr.write.bind(process.stderr), l = console.log;
  const ciktilar = [];
  // node:test alt sureci olaylari stdout'a IKILI (Buffer) yazar: onlari yutma, yalniz metni sustur
  process.stdout.write = (s, ...r) => (typeof s === "string" ? (ciktilar.push(s), true) : w(s, ...r));
  process.stderr.write = (s, ...r) => (typeof s === "string" ? (ciktilar.push(s), true) : e(s, ...r));
  console.log = (...a) => { ciktilar.push(a.join(" ") + "\n"); };
  try { return await fn(ciktilar); }
  finally { process.stdout.write = w; process.stderr.write = e; console.log = l; }
}
const oku = (...p) => fs.readFileSync(path.join(...p), "utf8");
const jsonOku = (...p) => JSON.parse(oku(...p));

// ---- sahte Claude istemcisi ----
// yanit(params, cagriNo) -> {text, usage?, stop_reason?} ya da firlatir (hata nesnesi: {status, message})
function sahteClaude(yanit) {
  const cagrilar = [];
  return {
    cagrilar,
    messages: {
      stream(params) {
        const no = cagrilar.length;
        cagrilar.push(params);
        const dinleyiciler = {};
        return {
          on(ad, fn) { dinleyiciler[ad] = fn; return this; },
          async finalMessage() {
            const y = await yanit(params, no);
            if (dinleyiciler.text) dinleyiciler.text(y.text || "");
            return { content: [{ type: "text", text: y.text || "" }], stop_reason: y.stop_reason || "end_turn",
              usage: y.usage || { input_tokens: 1000, output_tokens: 500 } };
          },
        };
      },
    },
    models: { async list() { return { data: [] }; } },
  };
}
const sistemMetni = p => (Array.isArray(p.system) ? p.system.map(b => b.text).join("\n") : String(p.system || ""));
const hata = (status, message) => Object.assign(new Error(message || "hata"), { status, name: "APIError" });

// ---- sahte vidIQ MCP sunucusu ----
// araclar: { ad: (arg, tum) => sonuc }  sonuc: {structured} | {text} | {isError,text} | dogrudan MCP sonucu
function sahteMcp(araclar, secenek) {
  const s = secenek || {};
  const cagrilar = [];
  const sunucu = http.createServer((req, res) => {
    let g = "";
    req.on("data", c => g += c);
    req.on("end", () => {
      if (s.durum) { res.writeHead(s.durum, { "Content-Type": "application/json" }); return res.end(JSON.stringify(s.govde || { detail: "x" })); }
      if (s.gecikmeMs) return setTimeout(() => { try { res.end("{}"); } catch (e) { /* kapandi */ } }, s.gecikmeMs);
      let j; try { j = JSON.parse(g); } catch (e) { res.writeHead(400); return res.end("bad"); }
      cagrilar.push({ basliklar: req.headers, govde: j });
      if (j.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
      const yaz = (sonuc) => {
        const gov = JSON.stringify({ jsonrpc: "2.0", id: j.id, result: sonuc });
        if (s.sse) { res.writeHead(200, { "Content-Type": "text/event-stream", "mcp-session-id": "oturum-1" }); return res.end("event: message\ndata: " + gov + "\n\n"); }
        res.writeHead(200, { "Content-Type": "application/json", "mcp-session-id": "oturum-1" }); res.end(gov);
      };
      if (j.method === "initialize") return yaz({ protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "sahte" } });
      if (j.method === "tools/call") {
        const f = araclar[j.params.name];
        if (!f) return yaz({ isError: true, content: [{ type: "text", text: "MCP error -32602: tool not found " + j.params.name }] });
        Promise.resolve(f(j.params.arguments || {}, cagrilar)).then(r => {
          if (r && r.rpcHata) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id, error: { message: r.rpcHata } })); }
          if (r && r.structured !== undefined) return yaz({ content: [{ type: "text", text: r.text || JSON.stringify(r.structured) }], structuredContent: r.structured });
          if (r && r.isError) return yaz({ isError: true, content: [{ type: "text", text: r.text }] });
          if (r && r.text !== undefined) return yaz({ content: [{ type: "text", text: r.text }] });
          yaz(r);
        });
        return;
      }
      yaz({});
    });
  });
  return new Promise(coz => sunucu.listen(0, "127.0.0.1", () => coz({
    sunucu, port: sunucu.address().port, cagrilar,
    kapat: () => new Promise(k => { sunucu.closeAllConnections && sunucu.closeAllConnections(); sunucu.close(() => k()); }),
    secenek: { https: http, host: "127.0.0.1", port: sunucu.address().port, bekle: async () => {} },
  })));
}

module.exports = { KOK, URETIM, isOlustur, oku, jsonOku, sessiz, sahteClaude, sistemMetni, hata, sahteMcp, temizle };
