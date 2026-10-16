// Guvenlik saldiri turu (2026-10-06) regresyon testleri: bulunan acik ve saglamlik hatalari tekrar etmesin.
// (Host/Origin/jeton/yol kacisi testleri panel-guvenlik.test.js'te; burada yalniz bu turda bulunanlar.)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Y = require("./panel-yardim");
const guvenlik = require("../lib/panel-guvenlik");
const komutlar = require("../lib/panel-komutlar");

let ortam, panel, c;
test.before(async () => {
  ortam = Y.geciciOrtam("saldiri");
  panel = await Y.panelBaslat(ortam);
  c = panel.istemci;
});
test.after(async () => { if (panel) await panel.kapat(); if (ortam) ortam.temizle(); });

const yeniIs = async (baslik, ek) => { const r = await c.post("/api/yeni", Object.assign({ baslik }, ek || {})); assert.equal(r.durum, 200, r.metin); return r.json.ad; };

test("CSP: script-src 'unsafe-inline' YOK; enjekte edilen tek betik SHA-256 ozetiyle tanınır; object-src ve form-action kapalı", async () => {
  const csp = guvenlik.CSP;
  assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe-inline|unsafe-eval/);
  assert.match(csp, /object-src 'none'/); assert.match(csp, /form-action 'none'/); assert.match(csp, /frame-ancestors 'none'/);
  const r = await c.get("/", { jetonsuz: true });
  const betikler = [...r.metin.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(betikler.length, 1, "sayfada yalniz enjekte edilen sarmalayici satir ici betik olmali");
  const ozet = "'sha256-" + require("crypto").createHash("sha256").update(betikler[0], "utf8").digest("base64") + "'";
  assert.ok(r.baslik["content-security-policy"].includes(ozet), "yanit CSP'si sarmalayicinin ozetini icermeli");
  // sayfada satir ici olay isleyicisi / javascript: adresi yok (CSP bunlari zaten engeller)
  assert.doesNotMatch(r.metin, /\son[a-z]+\s*=\s*["']|href\s*=\s*["']javascript:/i);
});

test("Sec-Fetch-Site: baska siteden gelen GET /api ve medya istekleri reddedilir; ayni kaynak ve sayfa gezintisi serbest", async () => {
  for (const sfs of ["cross-site", "same-site"]) {
    assert.equal((await c.get("/api/ozellikler", { baslik: { "Sec-Fetch-Site": sfs } })).json.kod, "origin", sfs);
    assert.equal((await c.get("/video/x", { cerezli: true, baslik: { "Sec-Fetch-Site": sfs } })).json.kod, "origin", sfs + " medya");
    assert.equal((await c.get("/", { jetonsuz: true, baslik: { "Sec-Fetch-Site": sfs, "Sec-Fetch-Mode": "navigate" } })).durum, 200, sfs + " sayfa gezintisi");
  }
  for (const sfs of ["same-origin", "none"]) assert.equal((await c.get("/api/ozellikler", { baslik: { "Sec-Fetch-Site": sfs } })).durum, 200, sfs);
});

test("nesne govdeli alanlar ({toString:'x'} String()/Number()/RegExp.test'i patlatir) 500 degil 4xx verir; sunucu ayakta", async () => {
  const zehir = [{ toString: "x" }, { valueOf: "x" }, { toString: 1, valueOf: 1 }];
  const ad = await yeniIs("zehir testi");
  for (const z of zehir) {
    const denemeler = [
      ["/api/calistir", { tur: z, is: ad }], ["/api/ses-testi", { dil: z }], ["/api/ses-testi", { ses: z }], ["/api/yeni", { baslik: "x", sureDk: z }],
      ["/api/yayin-isaretle", { is: ad, platform: z, durum: "hazir" }], ["/api/ac", { is: ad, klasor: z }], ["/api/gorunum", { is: ad, kanal: z }],
      ["/api/vs-yeni", { baslik: "v", ad: z, ust: { ad: "A", ara: "a" }, alt: { ad: "B", ara: "b" }, olculer: [{ ad: "o", ustDeger: 1, ustMetin: "1", altDeger: 2, altMetin: "2", kazanan: "alt" }], kazanan: "alt" }],
      ["/api/vs-yeni", { baslik: "v", ust: { ad: "A", ara: "a", renk: z }, alt: { ad: "B", ara: "b" }, olculer: [{ ad: "o", ustDeger: 1, ustMetin: "1", altDeger: 2, altMetin: "2", kazanan: "alt" }], kazanan: "alt" }],
      ["/api/ayarlar", { fiyat: { "claude-opus-5": { giris: z, cikis: 1 } } }], ["/api/anahtarlar", { sil: [z] }], ["/api/anahtarlar", { ayarla: { PEXELS_KEY: z } }],
    ];
    for (const [yol, govde] of denemeler) {
      const r = await c.post(yol, govde);
      // 5xx olmamali (nesne alan ya reddedilir ya da yok sayilip islem gecerli girdiyle surer: ornegin vs-yeni ad nesne ise baslik kullanilir)
      assert.ok(r.durum >= 200 && r.durum < 500, yol + " " + JSON.stringify(govde).slice(0, 80) + " -> " + r.durum + " " + r.metin.slice(0, 100));
      assert.doesNotMatch(r.metin, /\bat [A-Za-z.<>]+ \(|\.js:\d+/);
    }
  }
  assert.equal((await c.get("/api/ozellikler")).durum, 200);
});

test("tekTur: '-' ile baslayan konu/kanal/slogan/ara betige bayrak olarak gidemez (arguman enjeksiyonu)", () => {
  const ctx = { ayar: { kanal: "KANALIM", slogan: "" }, anahtarVar: () => true, senaryoVar: () => false, konuHam: () => ({}), uretim: ortam.uretim };
  for (const [tur, b] of [["trend", { konu: "--min" }], ["viral", { konu: "-x" }], ["markaYap", { kanal: "--rozet", slogan: "" }], ["markaYap", { kanal: "K", slogan: "--alt-metin" }], ["gorselSahne", { is: "ornek", sahne: 1, ara: "--sahne" }]])
    assert.throws(() => komutlar.tekTur(tur, b, ctx), e => e.durum === 400, tur);
  assert.doesNotThrow(() => komutlar.tekTur("trend", { konu: "uzay yolculugu" }, ctx));
  // nesne degerler String()/Number()'i patlatmaz: yok sayilir (konu bos, min varsayilan)
  const t = komutlar.tekTur("trend", { konu: { toString: "x" }, min: { valueOf: "x" }, dil: { toString: "x" }, platform: { toString: "x" } }, ctx);
  assert.deepEqual(t[0].komutlar[0].argv.slice(0, 5), ["", "--dil", "en", "--min", "200000"]);
});

test(".env degerinde NUL / sekme / U+2028-2029 gibi kontrol karakterleri reddedilir (satir enjeksiyonu ve silinemeyen satir)", async () => {
  fs.writeFileSync(ortam.env, "# yorum\nPEXELS_KEY=eski-deger-1234\n");
  const once = fs.readFileSync(ortam.env, "utf8");
  for (const v of ["a\u0000b", "a\tb", "a" + String.fromCharCode(0x2028) + "EVIL=1", "a" + String.fromCharCode(0x2029) + "EVIL=1", "a\u007fb", "a\nEVIL=1", "a\rEVIL=1"]) {
    const r = await c.post("/api/anahtarlar", { ayarla: { PEXELS_KEY: v } });
    assert.equal(r.durum, 400, JSON.stringify(v));
  }
  assert.equal(fs.readFileSync(ortam.env, "utf8"), once, ".env hic degismemeli");
  assert.equal((await c.post("/api/anahtarlar", { ayarla: { PEXELS_KEY: "yeni-deger-5678" } })).durum, 200);
  assert.equal((await c.post("/api/anahtarlar", { sil: ["PEXELS_KEY"] })).durum, 200);
  assert.doesNotMatch(fs.readFileSync(ortam.env, "utf8"), /PEXELS_KEY/);
});

test("yayin-isaretle: tirnak/bosluk/kimlik bilgili adres reddedilir, adres normallestirilerek saklanir", async () => {
  const ad = await yeniIs("yayin url testi");
  for (const u of ['https://youtu.be/abcdefghijk"onmouseover="x', "https://a.com/a b", "http://u:p@a.com/", "https://a.com/\u0000", "https://a.com/<b>", "javascript:alert(1)", "https://"]) {
    assert.equal((await c.post("/api/yayin-isaretle", { is: ad, platform: "youtube", durum: "hazir", url: u })).durum, 400, JSON.stringify(u));
  }
  const r = await c.post("/api/yayin-isaretle", { is: ad, platform: "youtube", durum: "yuklendi", url: "https://youtu.be/abcdefghijk" });
  assert.equal(r.durum, 200); assert.equal(r.json.yayin.platformlar.youtube.url, "https://youtu.be/abcdefghijk"); assert.equal(r.json.yayin.platformlar.youtube.videoId, "abcdefghijk");
});

test("kuyruk/ekle: ortada ad cakismasi olursa bu cagrida acilan klasorler geri alinir (yarim liste kalmaz), 409 doner", async () => {
  fs.writeFileSync(ortam.env, "ANTHROPIC_API_KEY=sk-ant-test-0000000000\n");           // on kontrol (anahtar) gecsin; ag testi kapali
  const var_ = await yeniIs("zaten var", { ad: "zaten-var" });
  const once = fs.readdirSync(ortam.uretim).sort().join(",");
  const r = await c.post("/api/kuyruk/ekle", { isler: [{ baslik: "birinci", ad: "yeni-birinci" }, { baslik: "ikinci", ad: var_ }] });
  assert.equal(r.durum, 409, r.metin);
  assert.equal(fs.readdirSync(ortam.uretim).sort().join(","), once, "yeni-birinci klasoru geri alinmali");
  const k = (await c.get("/api/kuyruk")).json;
  assert.ok(!k.ogeler.some(x => x.is === "yeni-birinci"), "kuyrukta yarim kayit olmamali");
});

test("PIPER_YOL: adinda 'piper' gecmeyen programlar (cmd.exe, node.exe ...) reddedilir — anlatim metni programin stdin'ine gittigi icin komut calistirma yolu olurdu", async () => {
  const cmd = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
  for (const yol of [process.execPath, ...(fs.existsSync(cmd) ? [cmd] : [])]) {
    const r = await c.post("/api/anahtarlar", { ayarla: { PIPER_YOL: yol } });
    assert.equal(r.durum, 400, yol); assert.match(r.json.hata, /piper/);
  }
  const ok = path.join(ortam.kok, "benim-piper-sarmalayici.cmd");
  fs.writeFileSync(ok, "@echo off\r\n");
  assert.equal((await c.post("/api/anahtarlar", { ayarla: { PIPER_YOL: ok } })).durum, 200);
  assert.equal((await c.post("/api/anahtarlar", { sil: ["PIPER_YOL"] })).durum, 200);
});

test("konu.json muzikDosyasi yalniz ses uzantili; ayar fiyat alanlari sayi olmali", async () => {
  const ad = await yeniIs("muzik uzanti");
  const oku = async () => JSON.parse((await c.get("/api/dosya?is=" + ad + "&tur=konu")).json.icerik);
  const k = await oku();
  for (const m of ["x.txt", "liste.m3u8", "paket.ffconcat", "belge.docx"]) {
    const r = await c.post("/api/dosya?is=" + ad + "&tur=konu", { icerik: Object.assign({}, k, { muzikDosyasi: m }) });
    assert.equal(r.durum, 400, m); assert.equal(r.json.kod, "konu_gecersiz");
  }
  assert.equal((await c.post("/api/dosya?is=" + ad + "&tur=konu", { icerik: Object.assign({}, k, { muzikDosyasi: "muzik/sakin.MP3" }) })).durum, 200);
  assert.equal((await c.post("/api/ayarlar", { fiyat: { "claude-opus-5": { giris: "5", cikis: 25 } } })).durum, 400, "metin sayi sayilmaz");
  assert.equal((await c.post("/api/ayarlar", { fiyat: { "claude-opus-5": { giris: 5, cikis: 25 } } })).durum, 200);
});
