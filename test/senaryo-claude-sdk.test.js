// Gercek @anthropic-ai/sdk + yerel SAHTE Anthropic sunucusu (ANTHROPIC_BASE_URL): istek bicimi, SSE okuma,
// hata cevirisi ve CLI cikis kodlari. Gercek API'ye ve krediye dokunulmaz.
"use strict";
const Y = require("./senaryo-yardim");
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const C = require("../lib/senaryo-claude-istemci");

const KOK = path.join(__dirname, "..");

function sse(metin, usage) {
  const u = usage || { input_tokens: 120, output_tokens: 80 };
  const olay = (ad, v) => "event: " + ad + "\ndata: " + JSON.stringify(v) + "\n\n";
  return olay("message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5", content: [], stop_reason: null, usage: { input_tokens: u.input_tokens, output_tokens: 0 } } }) +
    olay("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
    olay("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: metin } }) +
    olay("content_block_stop", { type: "content_block_stop", index: 0 }) +
    olay("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: u.output_tokens } }) +
    olay("message_stop", { type: "message_stop" });
}

// durum verilirse hata govdesi doner; yoksa SSE
function sahteAnthropic(secenek) {
  const s = secenek || {};
  const istekler = [];
  const sunucu = http.createServer((req, res) => {
    let g = ""; req.on("data", c => g += c);
    req.on("end", () => {
      let govde = null; try { govde = JSON.parse(g); } catch (e) { /* GET */ }
      istekler.push({ url: req.url, method: req.method, basliklar: req.headers, govde });
      if (req.method === "GET" && /\/v1\/models/.test(req.url)) {
        if (s.durum) { res.writeHead(s.durum, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } })); }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }));
      }
      if (s.durum) {
        res.writeHead(s.durum, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: s.tur || "invalid_request_error", message: s.mesaj || "hata" } }));
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(sse(typeof s.metin === "function" ? s.metin(govde) : s.metin));
    });
  });
  return new Promise(coz => sunucu.listen(0, "127.0.0.1", () => coz({
    url: "http://127.0.0.1:" + sunucu.address().port, istekler,
    kapat: () => new Promise(k => { sunucu.closeAllConnections && sunucu.closeAllConnections(); sunucu.close(() => k()); }),
  })));
}

test("claudeIste: gercek SDK ile akisli istek; sistem istemi onbellek isaretli, effort var; kullanim ve maliyet kaydi", async () => {
  const m = await sahteAnthropic({ metin: "<anlatim>\nMerhaba dunya, bu bir deneme paragrafidir.\n</anlatim>" });
  process.env.ANTHROPIC_BASE_URL = m.url;
  try {
    Y.isOlustur("senaryotest-sdk1", { baslik_en: "x" });
    const r = await C.claudeIste({ is: "senaryotest-sdk1", betik: "test", anahtar: "test-anahtar", model: "claude-opus-5",
      sistem: [{ type: "text", text: "sistem", cache_control: { type: "ephemeral" } }], istek: "selam", effort: "high", maksToken: 500 });
    assert.match(r.metin, /Merhaba dunya/);
    assert.equal(r.giris, 120);
    assert.equal(r.cikis, 80);
    assert.ok(Math.abs(r.usd - (120 / 1e6 * 5 + 80 / 1e6 * 25)) < 1e-9);
    const i = m.istekler[0];
    assert.equal(i.method, "POST");
    assert.match(i.url, /\/v1\/messages/);
    assert.equal(i.basliklar["x-api-key"], "test-anahtar");
    assert.equal(i.govde.stream, true);
    assert.equal(i.govde.model, "claude-opus-5");
    assert.equal(i.govde.output_config.effort, "high");
    assert.equal(i.govde.system[0].cache_control.type, "ephemeral");
    assert.equal(i.govde.max_tokens, 500);
    const k = Y.jsonOku(Y.URETIM, "senaryotest-sdk1", "kullanim.json");
    assert.equal(k.kayitlar.length, 1);
    assert.equal(k.kayitlar[0].giris, 120);
  } finally { delete process.env.ANTHROPIC_BASE_URL; await m.kapat(); }
});

test("effort desteklemeyen model (haiku) icin output_config GONDERILMEZ", async () => {
  const m = await sahteAnthropic({ metin: "tamam" });
  process.env.ANTHROPIC_BASE_URL = m.url;
  try {
    await C.claudeIste({ anahtar: "k", model: "claude-haiku-4-5", sistem: "s", istek: "i", effort: "high", maksToken: 100 });
    assert.equal(m.istekler[0].govde.output_config, undefined);
    assert.equal(C.efortDestekler("claude-opus-5-5"), true);
    assert.equal(C.efortDestekler("claude-sonnet-5-5"), true);
    assert.equal(C.efortDestekler("claude-haiku-4-5"), false);
  } finally { delete process.env.ANTHROPIC_BASE_URL; await m.kapat(); }
});

test("SDK hatalari: 401 / 404 / kredi(400) -> Turkce OrtakHata, cikis 3", async () => {
  const vaka = [
    [{ durum: 401, tur: "authentication_error", mesaj: "invalid x-api-key" }, "claude_anahtar"],
    [{ durum: 404, tur: "not_found_error", mesaj: "model: claude-yok" }, "claude_model"],
    [{ durum: 400, tur: "invalid_request_error", mesaj: "Your credit balance is too low to access the Anthropic API." }, "claude_kredi"],
  ];
  for (const [sec, kod] of vaka) {
    const m = await sahteAnthropic(sec);
    process.env.ANTHROPIC_BASE_URL = m.url;
    try {
      await assert.rejects(C.claudeIste({ anahtar: "k", model: "claude-yok", sistem: "s", istek: "i", maksToken: 100 }),
        e => e.kod === kod && e.cikis === 3, "beklenen " + kod);
    } finally { delete process.env.ANTHROPIC_BASE_URL; await m.kapat(); }
  }
});

test("anahtarTest: gercek SDK ile GET /v1/models; 401'de ok:false ve Turkce mesaj", async () => {
  const ok = await sahteAnthropic({});
  process.env.ANTHROPIC_BASE_URL = ok.url;
  try { assert.equal((await C.anahtarTest("k")).ok, true); } finally { delete process.env.ANTHROPIC_BASE_URL; await ok.kapat(); }
  const kotu = await sahteAnthropic({ durum: 401 });
  process.env.ANTHROPIC_BASE_URL = kotu.url;
  try {
    const t = await C.anahtarTest("k");
    assert.equal(t.ok, false);
    assert.match(t.mesaj, /geçersiz/);
  } finally { delete process.env.ANTHROPIC_BASE_URL; await kotu.kapat(); }
});

// ---- CLI: ayri surec, gercek cikis kodlari ve konsol protokolu ----
function cli(betik, args, env) {
  return new Promise(coz => {
    const p = spawn(process.execPath, [path.join(KOK, betik), ...args], { cwd: KOK, env: Object.assign({}, process.env, env) });
    let out = "", err = "";
    p.stdout.on("data", c => out += c); p.stderr.on("data", c => err += c);
    p.on("close", kod => coz({ kod, out, err }));
  });
}

test("CLI senaryo-claude.js: kisa video uctan uca (gercek SDK, sahte sunucu): @@SONUC, dosyalar, kilit yok", async () => {
  const metin = "<anlatim>\nBu ilk paragraf, konunun en carpici gercegini hemen soyler ve izleyiciyi ilk saniyede yakalar.\n\nIkinci paragraf yeni bir bilgi ekler, merak uyandirir ve videonun devamini izletir.\n</anlatim>\n" +
    "<gorseller>[{\"p\":1,\"ara\":[\"first photo\"]},{\"p\":2,\"ara\":[\"second photo\"]}]</gorseller>\n<ozet>Kisa ozet.</ozet>";
  const m = await sahteAnthropic({ metin: (g) => /CHECKABLE FACTUAL CLAIMS/.test(JSON.stringify(g.system)) ? '{"iddialar":[]}' : metin });
  try {
    const d = Y.isOlustur("senaryotest-cli1", { baslik_en: "Kisa", _not: "Konu metni", format: "short", hedefSaniye: 40, dil: "tr" });
    const r = await cli("senaryo-claude.js", ["senaryotest-cli1"], { ANTHROPIC_API_KEY: "test-anahtar", ANTHROPIC_BASE_URL: m.url });
    assert.equal(r.kod, 0, r.err + r.out);
    assert.match(r.out, /@@SONUC \{.*"kelime":/);
    assert.match(r.out, /✓ senaryo yazıldı/);
    assert.match(Y.oku(d, "Voice", "SESLENDIRME-TAM-METIN.txt"), /ilk paragraf/);
    assert.equal(Y.jsonOku(d, "Voice", "gorsel-aramalari.json").paragraflar.length, 2);
    assert.equal(Y.jsonOku(d, "kullanim.json").kayitlar.length, 2);
    assert.ok(!require("fs").existsSync(path.join(d, ".kilit")));
    assert.equal(m.istekler[0].govde.model, "claude-opus-5");
    assert.match(JSON.stringify(m.istekler[0].govde.system), /ENTIRELY IN TURKISH/);
  } finally { await m.kapat(); }
});

test("CLI: gecersiz anahtar -> cikis 3, stderr'de '✗ ...' ve '↳ cozum' + @@HATA; anahtarsiz -> cikis 2", async () => {
  const m = await sahteAnthropic({ durum: 401, tur: "authentication_error", mesaj: "invalid x-api-key" });
  try {
    Y.isOlustur("senaryotest-cli2", { baslik_en: "K", _not: "Konu", format: "short", hedefSaniye: 40 });
    const r = await cli("senaryo-claude.js", ["senaryotest-cli2"], { ANTHROPIC_API_KEY: "yanlis", ANTHROPIC_BASE_URL: m.url });
    assert.equal(r.kod, 3, r.err);
    assert.match(r.err, /✗ ANTHROPIC_API_KEY geçersiz/);
    assert.match(r.err, /↳ /);
    assert.match(r.err, /@@HATA \{"kod":"claude_anahtar"/);
    const r2 = await cli("senaryo-claude.js", ["senaryotest-cli2"], { ANTHROPIC_API_KEY: "" });
    assert.equal(r2.kod, 2);
    assert.match(r2.err, /ANTHROPIC_API_KEY yok/);
    const r3 = await cli("senaryo-claude.js", [], {});
    assert.equal(r3.kod, 2);
    assert.match(r3.err, /Kullanım/);
  } finally { await m.kapat(); }
});

test("CLI: --anahtar-test cikis kodu ve @@SONUC", async () => {
  const m = await sahteAnthropic({});
  try {
    const r = await cli("senaryo-claude.js", ["--anahtar-test"], { ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: m.url });
    assert.equal(r.kod, 0, r.err);
    assert.match(r.out, /@@SONUC \{"ok":true/);
    const r2 = await cli("senaryo-claude.js", ["--anahtar-test"], { ANTHROPIC_API_KEY: "" });
    assert.equal(r2.kod, 3);
  } finally { await m.kapat(); }
});

test("CLI: maliyet siniri -> cikis 7 (hic API istegi yok)", async () => {
  const m = await sahteAnthropic({ metin: "x" });
  try {
    Y.isOlustur("senaryotest-cli3", { baslik_en: "K", _not: "Konu", format: "long", hedefSaniye: 900, maliyetUstSinirUSD: 0.01 });
    const r = await cli("senaryo-claude.js", ["senaryotest-cli3"], { ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: m.url });
    assert.equal(r.kod, 7, r.err);
    assert.match(r.err, /Maliyet sınırı aşılacak/);
    assert.equal(m.istekler.length, 0);
  } finally { await m.kapat(); }
});
