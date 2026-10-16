// lib/ortak.js — saf yardimcilar: yol guvenligi, paragraf bolme, slug, JSON hata konumu, .env, atomik yazma, argumanlar, hata cevirisi.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ortak = require("../lib/ortak");

const acilanlar = [];
function gecici() { const d = fs.mkdtempSync(path.join(os.tmpdir(), "ortak-test-")); acilanlar.push(d); return d; }
test.after(() => { for (const d of acilanlar) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* gecici klasor: sonra silinir */ } } });

test("guvenliAd: yalniz harf/rakam/tire/alt cizgi, ilk karakter harf-rakam, en cok 64", () => {
  for (const iyi of ["abc", "A1", "a-b_c", "001-time-travel", "x".repeat(64)]) assert.equal(ortak.guvenliAd(iyi), true, iyi);
  for (const kotu of ["", "..", ".", "a.b", "../x", "a/b", "a\\b", "-ab", "_ab", "a b", "x".repeat(65), "nul", "CON", "com1", null, undefined, 5, ["a"]])
    assert.equal(ortak.guvenliAd(kotu), false, String(kotu));
});

test("yolIcinde: path.relative ile; 'abc' ile 'abcd' karismaz, '..' kacisi reddedilir", () => {
  const t = path.join(os.tmpdir(), "taban");
  assert.equal(ortak.yolIcinde(t, path.join(t, "a", "b.txt")), true);
  assert.equal(ortak.yolIcinde(t, t), true);
  assert.equal(ortak.yolIcinde(t, t + "d"), false);
  assert.equal(ortak.yolIcinde(t, path.join(t, "..", "baska")), false);
  assert.equal(ortak.yolIcinde(t, path.join(t, "a", "..", "..", "x")), false);
  assert.equal(ortak.yolIcinde(t, path.join(t, "..yan")), true);       // adi '..' ile baslayan DOSYA iceridedir
});

test("isDizin: gecersiz adi OrtakHata ile reddeder", () => {
  assert.equal(ortak.isDizin("abc", "/x"), path.join("/x", "abc"));
  assert.throws(() => ortak.isDizin("../x"), e => e instanceof ortak.OrtakHata && e.kod === "gecersiz_is" && e.cikis === 2);
});

test("paragraflaraBol: \\r\\n, bos satir kalibi, bos paragraflar atilir", () => {
  assert.deepEqual(ortak.paragraflaraBol("a\r\n\r\nb\n \nc\n\n\n"), ["a", "b", "c"]);
  assert.deepEqual(ortak.paragraflaraBol(""), []);
  assert.deepEqual(ortak.paragraflaraBol("tek satir\nikinci satir ayni paragraf"), ["tek satir\nikinci satir ayni paragraf"]);
});

test("paragrafOzeti: NFC normallestirir, sirayi ve icerigi yansitir", () => {
  const a = ortak.paragrafOzeti(["Café", "x"]), b = ortak.paragrafOzeti(["Café", "x"]);
  assert.equal(a, b);
  assert.notEqual(a, ortak.paragrafOzeti(["x", "Café"]));
  assert.equal(a.length, 40);
  assert.equal(ortak.paragrafOzeti("a\n\nb"), ortak.paragrafOzeti(["a", "b"]));
});

test("slugla: Turkce -> ASCII, Latin disi -> n-<sha6>, uzunluk siniri", () => {
  assert.equal(ortak.slugla("Yapay Zekâ Neden Önemli?"), "yapay-zeka-neden-onemli");
  assert.equal(ortak.slugla("İstanbul'un Fethi: Şöyle"), "istanbul-un-fethi-soyle");
  assert.match(ortak.slugla("日本語"), /^n-[0-9a-f]{6}$/);
  assert.notEqual(ortak.slugla("日本語"), ortak.slugla("한국어"));
  assert.match(ortak.slugla("日本語 AI"), /^ai-[0-9a-f]{6}$/);
  assert.equal(ortak.slugla("a".repeat(100), { maks: 10 }).length, 10);
  assert.ok(ortak.guvenliAd(ortak.slugla("Çay & Kahve — %100 taze")));
});

test("jsonOku: yoksa varsayilan; bozuksa satir/sutun; BOM'u yutar", () => {
  const d = gecici();
  assert.equal(ortak.jsonOku(path.join(d, "yok.json"), 7), 7);
  const p = path.join(d, "b.json");
  fs.writeFileSync(p, '{\n "a": 1,\n "b": }');
  assert.throws(() => ortak.jsonOku(p), e => e.kod === "bozuk" && e.satir === 3 && e.sutun === 7 && e.cikis === 2 && /satır 3, sütun 7/.test(e.message));
  fs.writeFileSync(p, "");
  assert.throws(() => ortak.jsonOku(p), e => e.kod === "bozuk" && /boş/.test(e.message));
  fs.writeFileSync(p, "﻿" + JSON.stringify({ a: 1 }));
  assert.deepEqual(ortak.jsonOku(p), { a: 1 });
});

test("jsonCoz: hata mesaji TURKCE (V8'in Ingilizce metni kullaniciya sizmaz), ham metin detay'da kalir", () => {
  const dene = (metin, beklenen) => assert.throws(() => ortak.jsonCoz(metin, "konu.json"), e => {
    assert.equal(e.kod, "bozuk");
    assert.ok(!/Unexpected|Expected|in JSON|position \d+/.test(e.message), "Ingilizce V8 metni sizdi: " + e.message);
    assert.match(e.message, beklenen);
    assert.ok(typeof e.detay === "string" && e.detay.length > 0, "ham V8 mesaji detay'da");
    return true;
  });
  dene('{ "a": 1 "b": 2 }', /virgül eksik olabilir/);
  dene('{"a":1,}', /çift tırnak içinde/);
  dene('{"a":"x', /tırnak kapanmamış/);
  dene('[1,2', /bekleniyordu/);
  dene('{"a":1} x', /fazladan karakter/);
  dene('{"a" 1}', /':' bekleniyordu/);
  dene('{"a":}', /beklenmeyen karakter '\}'/);
});

test("atomikYaz: kismi dosya birakmaz, ustune yazar, .tmp kalmaz", () => {
  const d = gecici();
  const p = path.join(d, "alt", "x.json");
  ortak.atomikJsonYaz(p, { a: 1 });
  assert.equal(fs.readFileSync(p, "utf8"), '{\n  "a": 1\n}\n');
  ortak.atomikYaz(p, "yeni");
  assert.equal(fs.readFileSync(p, "utf8"), "yeni");
  assert.deepEqual(fs.readdirSync(path.dirname(p)), ["x.json"]);
});

test("env: envYaz yorum ve bilinmeyen satirlari korur, CRLF'i korur, silme ve deger denetimi", () => {
  const d = gecici();
  const f = path.join(d, ".env");
  const once = process.env.OTOMASYON_ENV_DOSYASI;
  process.env.OTOMASYON_ENV_DOSYASI = f;
  try {
    fs.writeFileSync(f, "# yorum\r\nA=1\r\nUNSPLASH_KEY=eski\r\nB=2\r\n");
    ortak.envYaz({ ayarla: { A: "9", C: "3" }, sil: ["B"] });
    assert.equal(fs.readFileSync(f, "utf8"), "# yorum\r\nA=9\r\nUNSPLASH_KEY=eski\r\nC=3\r\n");
    assert.equal(ortak.envOku("A"), "9");
    assert.equal(ortak.envOku("YOK_BOYLE_BIR_ANAHTAR"), "");
    assert.deepEqual(Object.keys(ortak.envHepsi()).sort(), ["A", "C", "UNSPLASH_KEY"]);
    assert.throws(() => ortak.envYaz({ ayarla: { A: "x\nB=evil" } }), e => e.kod === "env_deger");
    assert.throws(() => ortak.envYaz({ ayarla: { "kucuk ad": "x" } }), e => e.kod === "env_ad");
    assert.equal(ortak.envOku("A"), "9", "reddedilen yazma dosyayi bozmamali");
  } finally { if (once === undefined) delete process.env.OTOMASYON_ENV_DOSYASI; else process.env.OTOMASYON_ENV_DOSYASI = once; }
});

test("argumanCoz: konumsal, --ad deger, --ad=deger, mantik bayragi", () => {
  const r = ortak.argumanCoz(["is-1", "--sahne", "3", "--ara", "bir iki", "--yeniden", "--onizleme=25", "son"], { deger: ["sahne", "ara"] });
  assert.deepEqual(r.konum, ["is-1", "son"]);
  assert.deepEqual(r.bayrak, { sahne: "3", ara: "bir iki", yeniden: true, onizleme: "25" });
  assert.deepEqual(ortak.argumanCoz(["--", "--x"], {}).konum, ["--x"]);
});

test("kelimeHizi / formatSiniri / varsayilanSes", () => {
  assert.equal(ortak.kelimeHizi("en"), 151);
  assert.equal(ortak.kelimeHizi("tr"), 113);
  assert.equal(ortak.kelimeHizi("de"), 140);
  assert.deepEqual(ortak.formatSiniri("short"), { oneriSn: 40, teknikMaxSn: 180, dikey: true });
  assert.equal(ortak.formatSiniri("reels").teknikMaxSn, 1200);
  assert.equal(ortak.formatSiniri("tiktok").teknikMaxSn, 600);
  assert.equal(ortak.formatSiniri("long").dikey, false);
  assert.equal(ortak.varsayilanSes("tr"), "tr-TR-AhmetNeural");
  assert.equal(ortak.varsayilanSes("xx"), "en-US-ChristopherNeural");
});

test("hataCevir: sik hatalari Turkce ozetler, ham ayrintiyi detay'a koyar", () => {
  const k = (e) => ortak.hataCevir(e).kod;
  assert.equal(k(new Error("spawn ffmpeg ENOENT")), "ffmpeg_yok");
  assert.equal(k("ENOSPC: no space left on device"), "disk_dolu");
  assert.equal(k("Error: 401 invalid x-api-key"), "anahtar_gecersiz");
  assert.equal(k({ status: 402, message: "x" }), "kredi_bitti");
  assert.equal(k({ status: 429, message: "x" }), "limit");
  assert.equal(k("getaddrinfo ENOTFOUND api.anthropic.com"), "internet_yok");
  assert.equal(k("[h264_nvenc] Error while opening encoder"), "kodlayici");
  assert.equal(k("Invalid data found when processing input"), "bozuk_gorsel");
  assert.equal(k("Cannot find module '@anthropic-ai/sdk'"), "bagimlilik_eksik");
  assert.equal(k("bilinmeyen sacma bir sey"), "genel");
  const c = ortak.hataCevir("ENOSPC xyz");
  assert.ok(c.ozet && c.cozum && c.detay);
  assert.equal(ortak.hataCevir(new ortak.OrtakHata("kilit", "Bu iş zaten çalışıyor.", { cozum: "bekle" })).cozum, "bekle");
});

test("OrtakHata: new ile ve new'suz, Error'dan turer, varsayilan mesaj", () => {
  const a = new ortak.OrtakHata("disk_dolu", { cikis: 5 });
  assert.equal(a.cikis, 5); assert.ok(a instanceof Error); assert.match(a.message, /Diskte/);
  const b = ortak.OrtakHata("x", "mesaj", { cikis: 3, satir: 2, sutun: 4 });
  assert.ok(b instanceof ortak.OrtakHata); assert.equal(b.satir, 2); assert.equal(b.kod, "x");
});

test("CIKIS sozlesmedeki sayilari tasir", () => {
  assert.equal(ortak.CIKIS.GIRDI, 2); assert.equal(ortak.CIKIS.SERVIS, 3); assert.equal(ortak.CIKIS.YETERSIZ, 4);
  assert.equal(ortak.CIKIS.DISK, 5); assert.equal(ortak.CIKIS.KILIT, 6); assert.equal(ortak.CIKIS.MALIYET, 7);
});

test("partTemizle: .part, .part.mp4, .<pid>.tmp ve _tmp icindeki 0 baytlilari siler; digerlerine dokunmaz", () => {
  const d = gecici();
  const yaz = (rel, icerik) => { const p = path.join(d, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, icerik); return p; };
  const sil = [yaz("Videos/a.part.mp4", "x"), yaz("_tmp/clip001.part", "x"), yaz("durum.json.1234.tmp", "x"), yaz("_tmp/bos.mp4", "")];
  const kalan = [yaz("Videos/a.mp4", "x"), yaz("_tmp/iyi.mp4", "x"), yaz("Voice/bos.txt", "")];
  assert.equal(ortak.partTemizle(d), 4);
  for (const p of sil) assert.equal(fs.existsSync(p), false, p);
  for (const p of kalan) assert.equal(fs.existsSync(p), true, p);
});

test("kilitAl/kilitBirak: ayni surec tekrar alabilir, canli baska sahip exit-6 hatasi, olu pid bayat sayilir", () => {
  const d = gecici();
  const once = process.env.OTOMASYON_URETIM;
  process.env.OTOMASYON_URETIM = d;
  try {
    fs.mkdirSync(path.join(d, "is1"), { recursive: true });
    const kilit = path.join(d, "is1", ".kilit");
    // olu bir pid (cok buyuk) -> bayat, alinabilir
    fs.writeFileSync(kilit, JSON.stringify({ pid: 2147480000, baslangic: "x", komut: "eski" }));
    ortak.kilitAl("is1", "test");
    assert.equal(JSON.parse(fs.readFileSync(kilit, "utf8")).pid, process.pid);
    ortak.kilitAl("is1", "test");                       // ic ice: sorun yok
    ortak.kilitBirak("is1");
    assert.equal(fs.existsSync(kilit), false);
    // canli baska sahip: bizim ebeveynimiz DEGIL (ebeveynin kilidi cocuk icin serbesttir), kendi baslattigimiz canli bir surec
    const { spawn } = require("child_process");
    const c = spawn(process.execPath, ["-e", "setTimeout(()=>{},4000)"], { stdio: "ignore" });
    try {
      fs.writeFileSync(kilit, JSON.stringify({ pid: c.pid, baslangic: "x", komut: "baska" }));
      assert.throws(() => ortak.kilitAl("is1", "test"), e => e.kod === "kilit" && e.cikis === 6);
    } finally { c.kill(); }
  } finally { if (once === undefined) delete process.env.OTOMASYON_URETIM; else process.env.OTOMASYON_URETIM = once; }
});

test("diskBosGB / diskKontrol", () => {
  const d = gecici();
  const b = ortak.diskBosGB(d);
  assert.ok(b === null || b > 0);
  assert.throws(() => ortak.diskKontrol(d, 1e9), e => e.kod === "disk_az" && e.cikis === 5);
  assert.ok(ortak.diskKontrol(d, 0).minGB === 0);
  assert.ok(ortak.diskBosGB(path.join(d, "olmayan", "alt")) !== undefined);   // var olan ust klasore bakar
});
