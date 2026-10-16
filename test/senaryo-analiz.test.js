// baslik-analiz.js, trend-ara.js, viral-analiz.js, performans.js testleri: yerel SAHTE vidIQ MCP sunucusu.
"use strict";
const Y = require("./senaryo-yardim");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ortak = require("../lib/ortak");
const BA = require("../baslik-analiz");
const TA = require("../trend-ara");
const VA = require("../viral-analiz");
const PE = require("../performans");
const R = require("../lib/senaryo-rapor");
process.env.VIDIQ_KEY = "test-vidiq";

let sayac = 0;
const yeniIs = (konu) => { const ad = "senaryotest-a" + (++sayac); Y.isOlustur(ad, konu); return ad; };
const raporDizin = (k) => path.join(process.env.OTOMASYON_RAPOR_KOKU, k);

async function calistir(modul, argv, araclar, mcpSec) {
  const m = await Y.sahteMcp(Object.assign({ vidiq_balance: () => ({ structured: { type: "limited", totalCredits: 500 } }) }, araclar), mcpSec);
  try {
    const cikti = [];
    const r = await Y.sessiz(async (c) => { try { return await modul.ana(argv, { vidiqSecenek: m.secenek }); } finally { cikti.push(...c); } });
    return { r, cagrilar: m.cagrilar.filter(c => c.govde.method === "tools/call").map(c => ({ ad: c.govde.params.name, arg: c.govde.params.arguments })), cikti };
  } finally { await m.kapat(); }
}
const calisanAdlar = c => c.cagrilar.map(x => x.ad).filter(a => a !== "vidiq_balance");

// ================================================================ baslik-analiz
const BASLIK_ARACLARI = (kelimeler) => ({
  vidiq_score_title: () => ({ structured: { score: 42 } }),
  vidiq_generate_titles: () => ({ structured: { titles: [{ title: "Orta baslik", score: 61 }, { title: "En iyi baslik", score: 88 }, "Duz metin baslik"] } }),
  vidiq_keyword_research: (arg) => ({ structured: { relatedKeywords: (kelimeler || (() => []))(arg) } }),
});

test("baslik-analiz --on: yalniz puan + alternatif (etiket YOK), puana gore sirali, dusuk puan uyarisi", async () => {
  const ad = yeniIs({ baslik_en: "Roman Empire Collapse", _not: "Rome fell", format: "long", dil: "en" });
  const c = await calistir(BA, [ad, "--on"], BASLIK_ARACLARI());
  assert.deepEqual(calisanAdlar(c), ["vidiq_score_title", "vidiq_generate_titles"]);
  const j = Y.jsonOku(Y.URETIM, ad, "baslik.json");
  assert.equal(j.surum, 1);
  assert.equal(j.dil, "en");
  assert.deepEqual(j.mevcut, { baslik: "Roman Empire Collapse", puan: 42 });
  assert.deepEqual(j.alternatifler.map(a => a.baslik), ["En iyi baslik", "Orta baslik", "Duz metin baslik"]);
  assert.equal(j.alternatifler[0].puan, 88);
  assert.deepEqual(j.anahtarKelimeler, []);
  assert.deepEqual(j.etiketler, []);
  assert.ok(c.cikti.some(x => /@@UYARI Başlık puanı düşük \(42\).*En iyi baslik/.test(x)));
  assert.match(Y.oku(Y.URETIM, ad, "BASLIK-VE-ETIKETLER.md"), /\| 88 \| En iyi baslik \|/);
  assert.equal(c.cagrilar.find(x => x.ad === "vidiq_score_title").arg.type, "long");
  const k = Y.jsonOku(Y.URETIM, ad, "kullanim.json");
  assert.equal(k.kayitlar[0].saglayici, "vidiq");
  assert.ok(!fs.existsSync(path.join(Y.URETIM, ad, "konu.json.tmp")));
  assert.equal(Y.jsonOku(Y.URETIM, ad, "konu.json").baslik_en, "Roman Empire Collapse", "konu.json'a dokunulmaz");
});

test("baslik-analiz tam: --on sonucu yeniden kullanilir (kredi harcanmaz), alakasiz tohum atlanir, etiketler 500 karakteri asmaz", async () => {
  const ad = yeniIs({ baslik_en: "Roman Empire Collapse", _not: "Rome fell", format: "long", dil: "en" });
  fs.writeFileSync(path.join(Y.URETIM, ad, "Voice", "SESLENDIRME-TAM-METIN.txt"), "The empire collapsed after generations of decline. Emperors fought legions across the empire. ".repeat(5));
  await calistir(BA, [ad, "--on"], BASLIK_ARACLARI());
  const uzun = Array.from({ length: 40 }, (_, i) => ({ keyword: "empire collapse tag number " + i, searchVolume: 10 + i, competition: 5, score: 50 }));
  let tohumlar = [];
  const c = await calistir(BA, [ad], BASLIK_ARACLARI(arg => {
    tohumlar.push(arg.keyword);
    // ilk tohum: konuyla alakasiz trend listesi; sonraki: alakali
    return tohumlar.length === 1 ? [{ keyword: "taylor swift concert" }, { keyword: "viral dance" }, { keyword: "funny cats" }] : uzun;
  }));
  assert.deepEqual(calisanAdlar(c).filter(a => a !== "vidiq_keyword_research"), [], "puan/alternatif tekrar istenmemeli");
  assert.ok(tohumlar.length >= 2, "alakasiz liste atlanip sonraki tohum denenmeli");
  const j = Y.jsonOku(Y.URETIM, ad, "baslik.json");
  assert.equal(j.tohum, tohumlar[1]);
  assert.equal(j.anahtarKelimeler.length, 25);
  assert.ok(j.etiketler.join(", ").length <= 500);
  assert.ok(j.etiketler.length >= 10);
  assert.equal(j.alternatifler.length, 3, "on modun alternatifleri korunur");
  // --on tekrar calisinca eski kelimeler silinmez
  await calistir(BA, [ad, "--on", "--yeniden"], BASLIK_ARACLARI());
  assert.ok(Y.jsonOku(Y.URETIM, ad, "baslik.json").etiketler.length >= 10);
});

test("baslik-analiz Turkce: Turkce tohum elenmez, language=tr ve country=TR gider; Ingilizce videoda Turkce konu notu tohum olmaz", async () => {
  const ad = yeniIs({ baslik_en: "Yapay zekâ gelecekte nasıl çalışacak", _not: "yapay zekâ ve gelecek", format: "long", dil: "tr" });
  const c = await calistir(BA, [ad], BASLIK_ARACLARI(arg => [{ keyword: "yapay zeka gelecek" }, { keyword: "zekâ çalışma" }]));
  const t = c.cagrilar.find(x => x.ad === "vidiq_generate_titles");
  assert.equal(t.arg.language, "tr");
  const k = c.cagrilar.find(x => x.ad === "vidiq_keyword_research");
  assert.equal(k.arg.country, "TR");
  assert.match(k.arg.keyword, /yapay|zekâ|gelecekte/);
  // sozcuk: dile gore durak listesi
  assert.deepEqual(BA.sozcuk("Bu bir deneme ve çok güzel", "tr"), ["deneme", "güzel"]);
  assert.deepEqual(BA.sozcuk("This is a great test", "en"), ["great", "test"]);
  const en = BA.tohumlariKur("Rome", "", "Roma düşüşü çok ilginç", "en");
  assert.ok(!en.tohumlar.some(t => /roma|düşüşü/i.test(t) && /[çğıöşü]/i.test(t)));
});

test("baslik-analiz: anahtar yok -> cikis 2; vidIQ anahtari gecersiz -> cikis 3", async () => {
  const ad = yeniIs({ baslik_en: "X", _not: "k", format: "long" });
  const eski = process.env.VIDIQ_KEY; delete process.env.VIDIQ_KEY;
  try { await assert.rejects(Y.sessiz(() => BA.ana([ad], {})), e => e.kod === "vidiq_anahtar" && e.cikis === 2); }
  finally { process.env.VIDIQ_KEY = eski; }
  const m = await Y.sahteMcp({}, { durum: 401 });
  try { await assert.rejects(Y.sessiz(() => BA.ana([ad], { vidiqSecenek: m.secenek })), e => e.kod === "vidiq_anahtar" && e.cikis === 3); }
  finally { await m.kapat(); }
});

// ================================================================ trend-ara
const VIDEOLAR = [
  { videoTitle: "AI agents explained", videoId: "AAAAAAAAAAA", viewCount: 1200000, vph: 5400.4, videoDuration: 38, subscriberCount: 25000, channelTitle: "Kanal Bir" },
  { videoTitle: "Why GPUs matter", videoId: "BBBBBBBBBBB", viewCount: 90000, vph: 410, videoDuration: 55, subscriberCount: 8000, channelTitle: "Kanal Iki" },
];
const IG_TT_MD = [
  "## Instagram", "", "[Cold open reel](https://www.instagram.com/reel/XYZ123/) 2.4M views, hook: ticking clock", "",
  "## TikTok", "", "[Shock number first](https://www.tiktok.com/@kullanici/video/7000000000000000001) 800K views", "",
].join("\n");
const TREND_ARACLARI = () => ({
  vidiq_trending_videos: (arg) => ({ structured: { videos: arg.videoFormat === "short" ? VIDEOLAR : [] } }),
  vidiq_instagram_tiktok_outlier_search: () => ({ text: IG_TT_MD }),
});

test("trend-ara --platform yt: Instagram/TikTok araci HIC cagrilmaz; md+json sozlesmeye uygun yazilir", async () => {
  const c = await calistir(TA, ["AI agents", "--platform", "yt", "--dil", "tr", "--min", "500000", "--siki"], TREND_ARACLARI());
  assert.deepEqual(calisanAdlar(c), ["vidiq_trending_videos", "vidiq_trending_videos"]);
  const ilk = c.cagrilar.find(x => x.ad === "vidiq_trending_videos");
  assert.equal(ilk.arg.videoTitleLanguage, "tr");
  assert.equal(ilk.arg.requireAllTitleTerms, true);
  assert.equal(ilk.arg.titleQuery, "AI agents");
  const md = fs.readdirSync(raporDizin("trend")).filter(x => x.endsWith(".md"));
  const js = fs.readdirSync(raporDizin("trend")).filter(x => x.endsWith(".json"));
  const slug = ortak.slugla("AI agents", { maks: 40 });
  assert.ok(md.some(x => x.endsWith("-" + slug + ".md")), md.join(","));
  const j = JSON.parse(fs.readFileSync(path.join(raporDizin("trend"), js.find(x => x.endsWith("-" + slug + ".json"))), "utf8"));
  assert.equal(j.surum, 1);
  assert.equal(j.tur, "trend");
  assert.equal(j.platform, "yt");
  assert.equal(j.dil, "tr");
  assert.equal(j.satirlar.length, 2);
  assert.deepEqual(j.satirlar[0], { platform: "youtube-short", baslik: "AI agents explained", url: "https://www.youtube.com/shorts/AAAAAAAAAAA",
    izlenme: 1200000, vph: 5400.4, sureSn: 38, abone: 25000, kanal: "Kanal Bir", hook: null });
  const rapor = fs.readFileSync(path.join(raporDizin("trend"), md.find(x => x.endsWith("-" + slug + ".md"))), "utf8");
  assert.ok(!/Instagram \+ TikTok/.test(rapor));
  assert.match(rapor, /Uzun video[\s\S]*Bu eşikte sonuç yok/);              // bos bolum NEDEN bos oldugunu soyler
  assert.match(rapor, /telif ihlalidir/);
  assert.ok(!/aynı hook yapısı|aynı ses/i.test(rapor), "kanitsiz hukum yok");
});

test("trend-ara --platform ig / tt: YouTube cagrilmaz; yalniz secilen platformun bolumu ve satirlari", async () => {
  const ig = await calistir(TA, ["konu x", "--platform", "ig"], TREND_ARACLARI());
  assert.deepEqual(calisanAdlar(ig), ["vidiq_instagram_tiktok_outlier_search"]);
  const slug = ortak.slugla("konu x", { maks: 40 });
  const j = JSON.parse(fs.readFileSync(path.join(raporDizin("trend"), fs.readdirSync(raporDizin("trend")).find(x => x.endsWith("-" + slug + ".json"))), "utf8"));
  assert.ok(j.satirlar.length >= 1 && j.satirlar.every(s => s.platform === "instagram"));
  assert.equal(j.satirlar[0].url, "https://www.instagram.com/reel/XYZ123/");
  assert.equal(j.satirlar[0].izlenme, 2400000);
  const md = fs.readFileSync(path.join(raporDizin("trend"), fs.readdirSync(raporDizin("trend")).find(x => x.endsWith("-" + slug + ".md"))), "utf8");
  assert.match(md, /Cold open reel/);
  assert.ok(!/Shock number first/.test(md), "TikTok bolumu --platform ig'de gorunmemeli");
  const tt = await calistir(TA, ["konu y", "--platform", "tt"], TREND_ARACLARI());
  const slug2 = ortak.slugla("konu y", { maks: 40 });
  const j2 = JSON.parse(fs.readFileSync(path.join(raporDizin("trend"), fs.readdirSync(raporDizin("trend")).find(x => x.endsWith("-" + slug2 + ".json"))), "utf8"));
  assert.ok(j2.satirlar.every(s => s.platform === "tiktok") && j2.satirlar.length >= 1);
  assert.deepEqual(calisanAdlar(tt), ["vidiq_instagram_tiktok_outlier_search"]);
});

test("trend-ara hepsi: uc cagri; Latin disi konu adi ayni gun eskisinin ustune yazmaz; Turkce harf slug'da korunur", async () => {
  const c = await calistir(TA, ["yapay zekâ", "--dil", "tr"], TREND_ARACLARI());
  assert.equal(calisanAdlar(c).length, 3);
  assert.ok(fs.readdirSync(raporDizin("trend")).some(x => /-yapay-zeka\.md$/.test(x)));
  await calistir(TA, ["人工知能"], TREND_ARACLARI());
  await calistir(TA, ["机器学习"], TREND_ARACLARI());
  const n = fs.readdirSync(raporDizin("trend")).filter(x => /-n-[0-9a-f]{6}\.md$/.test(x));
  assert.equal(n.length, 2, "iki farkli Latin disi konu iki ayri dosya uretmeli");
});

test("trend-ara: tum cagrilar hata verirse cikis 3; anahtar gecersizse hemen cikis 3; anahtar yoksa 2; kismi hata raporu bozmaz", async () => {
  await assert.rejects(calistir(TA, ["hata"], { vidiq_trending_videos: () => ({ isError: true, text: "boom" }), vidiq_instagram_tiktok_outlier_search: () => ({ isError: true, text: "boom" }) }),
    e => e.cikis === 3);
  const m = await Y.sahteMcp({}, { durum: 401 });
  try { await assert.rejects(Y.sessiz(() => TA.ana(["x"], { vidiqSecenek: m.secenek })), e => e.kod === "vidiq_anahtar" && e.cikis === 3); } finally { await m.kapat(); }
  const eski = process.env.VIDIQ_KEY; delete process.env.VIDIQ_KEY;
  try { await assert.rejects(Y.sessiz(() => TA.ana(["x"], {})), e => e.cikis === 2); } finally { process.env.VIDIQ_KEY = eski; }
  const kismi = await calistir(TA, ["kismi"], { vidiq_trending_videos: () => ({ isError: true, text: "boom" }), vidiq_instagram_tiktok_outlier_search: () => ({ text: IG_TT_MD }) });
  assert.ok(kismi.cikti.some(x => /@@UYARI Bir bölüm alınamadı/.test(x)));
  await assert.rejects(Y.sessiz(() => TA.ana(["x", "--platform", "yok"], {})), e => e.cikis === 2);
});

// ================================================================ viral-analiz
test("viral-analiz: kosullu hukumler, bos abone listesinde cokmez ('InfinityM' yok), JSON sozlesmesi, Turkce harfli slug", async () => {
  const videolar = Array.from({ length: 4 }, (_, i) => ({ videoTitle: "Aynı konsept video " + i, videoId: "VVVVVVVVVV" + i, viewCount: 12e6 + i, videoDuration: 12 + i,
    subscriberCount: i === 0 ? 8000 : 0, channelTitle: "K" + i, engagementRate: 0.004, mainCategory: "Education" }));
  const c = await calistir(VA, ["yapay zekâ", "en", "5000000"], { vidiq_outliers: () => ({ structured: { videos: videolar } }) });
  const arg = c.cagrilar.find(x => x.ad === "vidiq_outliers").arg;
  assert.equal(arg.contentType, "short");
  assert.equal(arg.minViews, 5000000);
  const md = fs.readFileSync(path.join(raporDizin("viral-analiz"), fs.readdirSync(raporDizin("viral-analiz")).find(x => /-yapay-zeka\.md$/.test(x))), "utf8");
  assert.ok(!/Infinity/.test(md));
  assert.ok(!/neredeyse önemsiz|Kimse kimsenin|aynı ses/i.test(md), "veriden bagimsiz hukum yazilmamali");
  assert.match(md, /telif ihlalidir/);
  assert.match(md, /Benzer başlık yapısı 4 videoda/);
  assert.match(md, /Düşük: bu videolar/);                                 // etkilesim verisi dusuk -> kosullu uyari
  const js = JSON.parse(fs.readFileSync(path.join(raporDizin("viral-analiz"), fs.readdirSync(raporDizin("viral-analiz")).find(x => /-yapay-zeka\.json$/.test(x))), "utf8"));
  assert.equal(js.tur, "viral");
  assert.equal(js.satirlar.length, 4);
  assert.equal(js.satirlar[0].platform, "youtube-short");
  // hic abone verisi yoksa da cokmez
  const sifir = await calistir(VA, ["abonesiz"], { vidiq_outliers: () => ({ structured: { videos: videolar.map(v => Object.assign({}, v, { subscriberCount: 0, engagementRate: undefined })) } }) });
  assert.ok(sifir.r.rapor);
  const md2 = fs.readFileSync(sifir.r.rapor.md, "utf8");
  assert.match(md2, /abone bilgisi yok/);
});

test("viral-analiz: Ingilizce disi dilde yalniz uzun video istenir (vidIQ siniri); bos sonuc cikis 0 ve dosya yazmaz; hata -> cikis 3", async () => {
  const c = await calistir(VA, ["", "tr", "1000"], { vidiq_outliers: () => ({ structured: { videos: [{ videoTitle: "Uzun video", videoId: "LLLLLLLLLLL", viewCount: 5000, videoDuration: 600, subscriberCount: 100, channelTitle: "K" }] } }) });
  assert.equal(c.cagrilar.find(x => x.ad === "vidiq_outliers").arg.contentType, "long");
  assert.ok(c.cikti.some(x => /@@UYARI.*yalnızca uzun video/.test(x)));
  const once = fs.readdirSync(raporDizin("viral-analiz")).length;
  const bos = await calistir(VA, ["hic yok"], { vidiq_outliers: () => ({ structured: { videos: [] } }) });
  assert.equal(bos.r.bos, true);
  assert.equal(fs.readdirSync(raporDizin("viral-analiz")).length, once);
  await assert.rejects(calistir(VA, ["x"], { vidiq_outliers: () => ({ isError: true, text: "Insufficient credits" }) }), e => e.kod === "vidiq_kredi" && e.cikis === 3);
});

// ================================================================ performans
test("performans: videoId/baglanti bulma, yayin-durum bicimlerinden bagimsiz", () => {
  assert.equal(PE.idCoz("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3"), "dQw4w9WgXcQ");
  assert.equal(PE.idCoz("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(PE.idCoz("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(PE.idCoz("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(PE.idCoz("bu id degil"), null);
  assert.equal(PE.videoIdBul({ platform: "youtube", durum: "yuklendi", videoId: "dQw4w9WgXcQ" }).id, "dQw4w9WgXcQ");
  assert.equal(PE.videoIdBul({ platformlar: { youtube: { durum: "yuklendi", url: "https://youtu.be/dQw4w9WgXcQ" }, tiktok: { url: "https://tiktok.com/x" } } }).id, "dQw4w9WgXcQ");
  assert.equal(PE.videoIdBul({ platformlar: [{ platform: "youtube", durum: "hazir", videoId: "dQw4w9WgXcQ" }] }).yukluDegil, true);
  assert.equal(PE.videoIdBul({ platformlar: [{ platform: "tiktok", url: "https://t.co/x" }] }).id, null);
});

test("performans --is: vidiq_video_stats'tan son nokta performans.json'a yazilir; --hepsi yuklenmemis isleri atlar; videosuz --is cikis 2", async () => {
  const ad = yeniIs({ baslik_en: "P", _not: "k", format: "long" });
  fs.writeFileSync(path.join(Y.URETIM, ad, "yayin-durum.json"), JSON.stringify({ surum: 1, platformlar: { youtube: { durum: "yuklendi", videoId: "dQw4w9WgXcQ" } } }));
  const stats = { vidiq_video_stats: () => ({ structured: { stats: [
    { timestamp: "2026-10-01T00:00:00Z", views: 100, likes: 5, comments: 1 }, { timestamp: "2026-10-03T00:00:00Z", views: 450, likes: 20, comments: 4 } ] } }) };
  const c = await calistir(PE, ["--is", ad], stats);
  const arg = c.cagrilar.find(x => x.ad === "vidiq_video_stats").arg;
  assert.equal(arg.videoId, "dQw4w9WgXcQ");
  assert.equal(arg.granularity, "daily");
  const p = Y.jsonOku(Y.URETIM, ad, "performans.json");
  assert.equal(p.surum, 1);
  assert.equal(p.kaynak, "vidiq");
  assert.equal(p.izlenme, 450);
  assert.equal(p.begeni, 20);
  assert.equal(p.yorum, 4);
  assert.equal(p.ham.noktaSayisi, 2);

  const ad2 = yeniIs({ baslik_en: "Q", _not: "k", format: "long" });
  fs.writeFileSync(path.join(Y.URETIM, ad2, "yayin-durum.json"), JSON.stringify({ platformlar: [{ platform: "youtube", durum: "hazir", videoId: "dQw4w9WgXcQ" }] }));
  const hepsi = await calistir(PE, ["--hepsi"], stats);
  assert.equal(hepsi.r.guncellenen, 1);
  assert.equal(hepsi.r.isler[0].is, ad);
  assert.ok(!fs.existsSync(path.join(Y.URETIM, ad2, "performans.json")));
  await assert.rejects(calistir(PE, ["--is", ad2], stats), e => e.kod === "video_yok" && e.cikis === 2);
  await assert.rejects(Y.sessiz(() => PE.ana([], {})), e => e.cikis === 2);
});

test("trend-ara: panelin cagri bicimi (bos konu + --dil + --min + --platform) konu vermeden genel trend arar", async () => {
  const c = await calistir(TA, ["", "--dil", "tr", "--min", "300000", "--platform", "yt"], TREND_ARACLARI());
  const ilk = c.cagrilar.find(x => x.ad === "vidiq_trending_videos");
  assert.equal(ilk.arg.titleQuery, undefined, "bos konuda titleQuery gonderilmemeli");
  assert.equal(ilk.arg.videoTitleLanguage, "tr");
  assert.ok(fs.readdirSync(raporDizin("trend")).some(x => /-genel\.md$/.test(x)));
});

// ---- CLI (ayri surec): gercek cikis kodlari ve konsol protokolu ----
const { spawn } = require("child_process");
function cli(betik, args, env) {
  return new Promise(coz => {
    const p = spawn(process.execPath, [path.join(__dirname, "..", betik), ...args], { cwd: path.join(__dirname, ".."), env: Object.assign({}, process.env, env) });
    let out = "", err = "";
    p.stdout.on("data", c => out += c); p.stderr.on("data", c => err += c);
    p.on("close", kod => coz({ kod, out, err }));
  });
}

test("CLI trend-ara.js --platform yt (ayri surec, sahte MCP): cikis 0, @@SONUC, rapor dosyalari", async () => {
  const m = await Y.sahteMcp(Object.assign({ vidiq_balance: () => ({ structured: { totalCredits: 100 } }) }, TREND_ARACLARI()));
  try {
    const r = await cli("trend-ara.js", ["cli konusu", "--platform", "yt"], { VIDIQ_KEY: "k", OTOMASYON_VIDIQ_URL: "http://127.0.0.1:" + m.port + "/mcp" });
    assert.equal(r.kod, 0, r.err + r.out);
    assert.match(r.out, /@@SONUC \{.*"platform":"yt"/);
    assert.match(r.out, /vidIQ kredisi/);
    assert.ok(fs.readdirSync(raporDizin("trend")).some(x => x.endsWith("-cli-konusu.json")));
    assert.ok(!m.cagrilar.some(c => c.govde.params && c.govde.params.name === "vidiq_instagram_tiktok_outlier_search"));
  } finally { await m.kapat(); }
});

test("CLI baslik-analiz.js / viral-analiz.js: gecersiz vidIQ anahtari -> cikis 3 ve Turkce cozum satiri; anahtar yok -> cikis 2", async () => {
  const m = await Y.sahteMcp({}, { durum: 401 });
  try {
    const ad = yeniIs({ baslik_en: "C", _not: "k", format: "long" });
    const env = { VIDIQ_KEY: "yanlis", OTOMASYON_VIDIQ_URL: "http://127.0.0.1:" + m.port + "/mcp" };
    const r = await cli("baslik-analiz.js", [ad, "--on"], env);
    assert.equal(r.kod, 3, r.err);
    assert.match(r.err, /✗ vidIQ anahtarı kabul edilmedi/);
    assert.match(r.err, /↳ Panel > Kaynaklar/);
    const v = await cli("viral-analiz.js", ["", "en", "1000"], env);
    assert.equal(v.kod, 3, v.err);
    const yok = await cli("viral-analiz.js", [], { VIDIQ_KEY: "" });
    assert.equal(yok.kod, 2);
  } finally { await m.kapat(); }
});

test("baslik-analiz tam: ayni baslik icin guncel baslik.json varsa tekrar kredi harcanmaz (@@SONUC atlandi); senaryo sonradan degistiyse yeniden calisir", async () => {
  const ad = yeniIs({ baslik_en: "Same Title", _not: "k", format: "long", dil: "en" });
  fs.writeFileSync(path.join(Y.URETIM, ad, "Voice", "SESLENDIRME-TAM-METIN.txt"), "The same title explained in a long script about titles and tags. ".repeat(10));
  const kelimeler = () => [{ keyword: "same title tips", searchVolume: 5 }, { keyword: "title tags", searchVolume: 4 }];
  await calistir(BA, [ad], BASLIK_ARACLARI(kelimeler));
  const ikinci = await calistir(BA, [ad], BASLIK_ARACLARI(kelimeler));
  assert.equal(ikinci.r.atlandi, true);
  assert.deepEqual(calisanAdlar(ikinci), []);
  // senaryo daha yeni: yeniden calisir (kelime araştırması), puan/alternatif eski sonuctan alinir
  const yol = path.join(Y.URETIM, ad, "Voice", "SESLENDIRME-TAM-METIN.txt");
  const gelecek = new Date(Date.now() + 60000);
  fs.utimesSync(yol, gelecek, gelecek);
  const ucuncu = await calistir(BA, [ad], BASLIK_ARACLARI(kelimeler));
  assert.ok(calisanAdlar(ucuncu).includes("vidiq_keyword_research"));
  const zorla = await calistir(BA, [ad, "--yeniden"], BASLIK_ARACLARI(kelimeler));
  assert.ok(calisanAdlar(zorla).includes("vidiq_score_title"));
});
