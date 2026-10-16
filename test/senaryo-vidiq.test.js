// lib/vidiq.js testleri: yerel sahte MCP sunucusu (gercek vidIQ'ya ve krediye dokunmaz).
"use strict";
const Y = require("./senaryo-yardim");
const test = require("node:test");
const assert = require("node:assert/strict");
const { VidiqIstemci, test: anahtarTest, bakiye } = require("../lib/vidiq");

test("el sikisma + JSON yaniti + yapisal sonuc (structuredContent oncelikli)", async () => {
  const m = await Y.sahteMcp({ vidiq_echo: (arg) => ({ structured: { gelen: arg.x } }) });
  try {
    const v = new VidiqIstemci("anahtar-1", m.secenek);
    const s = await v.cagir("vidiq_echo", { x: 42 });
    assert.deepEqual(s, { gelen: 42 });
    const roller = m.cagrilar.map(c => c.govde.method);
    assert.deepEqual(roller, ["initialize", "notifications/initialized", "tools/call"]);
    assert.equal(m.cagrilar[0].basliklar.authorization, "Bearer anahtar-1");
    assert.equal(m.cagrilar[2].basliklar["mcp-session-id"], "oturum-1");     // oturum basligi tasinir
  } finally { await m.kapat(); }
});

test("SSE yaniti da okunur; duz metin JSON'a cevrilir", async () => {
  const m = await Y.sahteMcp({ a: () => ({ text: JSON.stringify({ durum: "tamam" }) }) }, { sse: true });
  try {
    const v = new VidiqIstemci("k", m.secenek);
    assert.deepEqual(await v.cagir("a", {}), { durum: "tamam" });
  } finally { await m.kapat(); }
});

test("isError -> OrtakHata(vidiq_ag, cikis 3); kredi mesaji vidiq_kredi", async () => {
  const m = await Y.sahteMcp({
    kotu: () => ({ isError: true, text: "Input validation error: topic too long" }),
    parasiz: () => ({ isError: true, text: "Insufficient credits for this operation" }),
    rpc: () => ({ rpcHata: "credit limit reached" }),
  });
  try {
    const v = new VidiqIstemci("k", m.secenek);
    await assert.rejects(v.cagir("kotu", {}), e => e.kod === "vidiq_ag" && e.cikis === 3 && /validation/i.test(e.message));
    await assert.rejects(v.cagir("parasiz", {}), e => e.kod === "vidiq_kredi" && e.cikis === 3);
    await assert.rejects(v.cagir("rpc", {}), e => e.kod === "vidiq_kredi" && e.cikis === 3);
  } finally { await m.kapat(); }
});

test("HTTP 401 -> vidiq_anahtar; 402 -> vidiq_kredi; 429/503 -> vidiq_ag", async () => {
  for (const [durum, kod] of [[401, "vidiq_anahtar"], [403, "vidiq_anahtar"], [402, "vidiq_kredi"], [429, "vidiq_ag"], [503, "vidiq_ag"]]) {
    const m = await Y.sahteMcp({}, { durum });
    try {
      const v = new VidiqIstemci("k", m.secenek);
      await assert.rejects(v.baslat(), e => e.kod === kod && e.cikis === 3, "HTTP " + durum);
    } finally { await m.kapat(); }
  }
});

test("zaman asimi -> vidiq_zaman_asimi (cikis 3), asili kalmaz", async () => {
  const m = await Y.sahteMcp({}, { gecikmeMs: 1500 });
  try {
    const v = new VidiqIstemci("k", Object.assign({}, m.secenek, { zamanAsimiMs: 150 }));
    const t0 = Date.now();
    await assert.rejects(v.baslat(), e => e.kod === "vidiq_zaman_asimi" && e.cikis === 3);
    assert.ok(Date.now() - t0 < 1400, "zaman asimi beklenenden gec devreye girdi");
  } finally { await m.kapat(); }
});

test("baglanti reddedilirse vidiq_ag (internet yok)", async () => {
  const m = await Y.sahteMcp({});
  const port = m.port;
  await m.kapat();
  const v = new VidiqIstemci("k", { https: require("http"), host: "127.0.0.1", port, bekle: async () => {} });
  await assert.rejects(v.baslat(), e => e.kod === "vidiq_ag" && e.cikis === 3 && /ulaşıl/.test(e.message));
});

test("anahtar yoksa OrtakHata(vidiq_anahtar, cikis 2)", () => {
  assert.throws(() => new VidiqIstemci(""), e => e.kod === "vidiq_anahtar" && e.cikis === 2);
});

test("isBekle: inprogress -> completed sonucu doner; ilerleme bildirilir", async () => {
  let n = 0;
  const m = await Y.sahteMcp({
    vidiq_job_poll: (arg) => {
      assert.equal(arg.mcpJobId, "is-7");
      n++;
      return { structured: n < 3 ? { status: "inprogress" } : { status: "completed", result: "SENARYO METNI" } };
    },
  });
  try {
    const v = new VidiqIstemci("k", m.secenek);
    const gor = [];
    assert.equal(await v.isBekle("is-7", { aralikSn: 1, onIlerleme: x => gor.push(x.gecenSn) }), "SENARYO METNI");
    assert.equal(n, 3);
    assert.deepEqual(gor, [1, 2]);
  } finally { await m.kapat(); }
});

test("isBekle: failed -> vidiq_uretim (iade bilgisi mesajda); sure dolarsa vidiq_zaman_asimi", async () => {
  let durum = "failed";
  const m = await Y.sahteMcp({
    vidiq_job_poll: () => ({ structured: durum === "failed" ? { status: "failed", errorCode: "BAD_SCRIPT", refunded: true } : { status: "inprogress" } }),
  });
  try {
    const v = new VidiqIstemci("k", m.secenek);
    await assert.rejects(v.isBekle("x", { aralikSn: 1 }), e => e.kod === "vidiq_uretim" && e.cikis === 3 && /iade edildi/.test(e.message));
    durum = "inprogress";
    await assert.rejects(v.isBekle("x", { maksSn: 3, aralikSn: 1 }), e => e.kod === "vidiq_zaman_asimi" && e.cikis === 3);
  } finally { await m.kapat(); }
});

test("test(): gecerli anahtar ok + kalan kredi; gecersiz anahtar ok:false ve ASLA firlatmaz", async () => {
  const m = await Y.sahteMcp({ vidiq_balance: () => ({ structured: { type: "limited", totalCredits: 1234 } }) });
  try {
    const t = await anahtarTest("k", m.secenek);
    assert.equal(t.ok, true);
    assert.match(t.mesaj, /1234/);
    assert.deepEqual(await anahtarTest("", m.secenek), { ok: false, mesaj: "anahtar girilmemiş" });
  } finally { await m.kapat(); }
  const kotu = await Y.sahteMcp({}, { durum: 401 });
  try {
    const t = await anahtarTest("yanlis", kotu.secenek);
    assert.equal(t.ok, false);
    assert.match(t.mesaj, /geçersiz/);
  } finally { await kotu.kapat(); }
});

test("bakiye(): totalCredits okunur, bilinmeyen bicimde kalan=null ve ham doner", async () => {
  const m = await Y.sahteMcp({ vidiq_balance: () => ({ structured: { type: "unlimited" } }) });
  try {
    const b = await bakiye("k", m.secenek);
    assert.equal(b.kalan, null);
    assert.deepEqual(b.ham, { type: "unlimited" });
  } finally { await m.kapat(); }
});

test("yapisalCikar(beklenen): structuredContent beklenen anahtari tasimiyorsa metindeki JSON secilir", async () => {
  const { yapisalCikar } = require("../lib/vidiq");
  const ham = { structuredContent: { icerik: "x" }, content: [{ type: "text", text: JSON.stringify({ mcpJobId: "j9", status: "inprogress" }) }] };
  assert.deepEqual(yapisalCikar(ham, ["mcpJobId"]), { mcpJobId: "j9", status: "inprogress" });
  assert.deepEqual(yapisalCikar(ham), { icerik: "x" });                        // beklenen yoksa varsayilan: structuredContent
  assert.deepEqual(yapisalCikar({ content: [{ type: "text", text: "duz metin" }] }), "duz metin");
  assert.equal(yapisalCikar(null), null);
  // isBekle de ayni secimi yapar
  const m = await Y.sahteMcp({ vidiq_job_poll: () => ({ structuredContent: { baska: 1 }, content: [{ type: "text", text: JSON.stringify({ status: "completed", result: "METIN" }) }] }) });
  try { assert.equal(await new VidiqIstemci("k", m.secenek).isBekle("a", { aralikSn: 1 }), "METIN"); } finally { await m.kapat(); }
});
