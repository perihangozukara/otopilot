// Duzeltme turu 2 (render): kilitli final, --temiz, konu karti, altyazi 42 siniri, klip yedek kaydi,
// marka-yap rozeti/vurgusu/atomik ciktisi, vurgu rengi korumasi. Gercek ffmpeg (sentetik), ag yok, ucret yok.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync, execFileSync } = require("child_process");
const fik = require("./render-fikstur");
const kok = fik.ortamKur();
const ffvar = fik.ffmpegVarMi();
const skip = !ffvar && "ffmpeg yok";
const ortak = require("../lib/ortak");
const F = require("../lib/render-ffmpeg");
const KL = require("../lib/render-klip");
const AY = require("../lib/render-altyazi");
const A = require("../lib/render-ayar");

test.after(() => fik.temizle(kok));

const oku = (j, ...p) => JSON.parse(fs.readFileSync(path.join(j.dizin, ...p), "utf8"));
const konuYaz = (j, ek) => { const k = oku(j, "konu.json"); fs.writeFileSync(path.join(j.dizin, "konu.json"), JSON.stringify(Object.assign(k, ek), null, 2)); };
const sonuc = r => { const m = /@@SONUC (\{.*\})/.exec(r.stdout); return m ? JSON.parse(m[1]) : null; };
const goruntuBoyutu = f => JSON.parse(execFileSync(fik.FP(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", f], { windowsHide: true })).streams[0];
const kilitHatasi = kod => { const e = new Error("kilitli"); e.code = kod; return e; };
function kucukMp4(yol, sn) {
  fs.mkdirSync(path.dirname(yol), { recursive: true });
  fik.ff(["-f", "lavfi", "-i", "testsrc2=s=160x90:r=10:d=" + (sn || 1), "-c:v", "libx264", "-pix_fmt", "yuv420p", yol]);
}

// ----------------------------------------------------------------- B050: rozet
test("AYAR_VARSAYILAN.rozet bos (sabit 'VS' degil); rozetTuret: kanal adinin bas harfleri, sembol atlanir, Turkce buyuk harf", () => {
  assert.equal(ortak.AYAR_VARSAYILAN.rozet, "");
  assert.equal(ortak.ayarOku().rozet, "");
  const { rozetTuret } = require("../marka-yap");
  assert.equal(rozetTuret("Bob's Çılgın Bilim: 100% Gerçek", "tr"), "BÇB");
  assert.equal(rozetTuret("The Time Rift", "en"), "TTR");
  assert.equal(rozetTuret("zaman kırığı", "tr"), "ZK");
  assert.equal(rozetTuret("işık", "tr"), "İ");
  assert.equal(rozetTuret("Bob & Alice Show Extra", "en"), "BAS");
  assert.equal(rozetTuret("!!!", "en"), "!!");
  assert.equal(rozetTuret("", "en"), "K");
});

// ----------------------------------------------------------------- vurgu rengi korumasi (B050 / marka-yap:266)
test("bozuk vurguRenk (elle duzenlenmis ayar) filtre hattina girmez: konuBirlestir + ayarCoz varsayilana doner", () => {
  assert.equal(A.renkKodu("ff00aa"), "FF00AA");
  for (const kotu of ["zz:x=0", "6FD8F", "#6FD8FF", "6FD8FF,drawbox=1", 123456, null, undefined]) assert.equal(A.renkKodu(kotu), "6FD8FF", String(kotu));
  const e = ortak.konuBirlestir({ baslik_en: "T" }, Object.assign({}, ortak.AYAR_VARSAYILAN, { vurguRenk: "zz:x=0,drawbox=1" }), "t");
  assert.equal(e.vurguRenk, "6FD8FF");
  assert.equal(ortak.konuBirlestir({ baslik_en: "T" }, Object.assign({}, ortak.AYAR_VARSAYILAN, { vurguRenk: "ab12cd" }), "t").vurguRenk, "AB12CD");
  assert.equal(ortak.konuBirlestir({ baslik_en: "T", vurguRenk: "112233" }, Object.assign({}, ortak.AYAR_VARSAYILAN, { vurguRenk: "zz" }), "t").vurguRenk, "112233");
  const d = path.join(kok, "vr1"); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "konu.json"), JSON.stringify({ surum: 1, baslik_en: "T" }));
  const onceki = process.env.OTOMASYON_AYAR_DOSYASI;
  fs.writeFileSync(onceki, JSON.stringify({ vurguRenk: "x:y=1" }));
  try {
    const a = A.ayarCoz("vr1");
    assert.equal(a.vurgu, "0x6FD8FF"); assert.equal(a.vurguHex, "6FD8FF");
  } finally { fs.rmSync(onceki, { force: true }); }
});

// ----------------------------------------------------------------- altyazi 42 siniri
test("altyaziKur: 0.6 sn birlestirmesi de yatayda 42 karakteri asmaz (eskiden 64'e kadar birlesiyordu); dikeyde 40", () => {
  const paras = ["Wow that was really fast. Really quick it was now."];
  // hizli konusma: iki cumle 1 sn'de -> her biri ~0.5 sn (<0.6) -> komsuyla birlesmeye calisir (25+24 = 50 karakter: 42'yi asar, 64'e sigar)
  const ses = { N: 1, baslangic: [0], sure: [1.0], kelimeler: [{ no: 0, kelimeler: paras[0].split(" ").map((w, j, d) => ({ t: Math.round(j * 1000 / d.length), d: 100, w })) }] };
  assert.equal(AY.altyaziKur(paras, ses, 0, { stil: "cumle", dil: "en", yatayMaks: 64 }).length, 1, "duyarlilik: eski 64 sinirinda tek satira birlesir");
  const yatay = AY.altyaziKur(paras, ses, 0, { stil: "cumle", dil: "en" });
  assert.equal(yatay.length, 2);
  for (const c of yatay) assert.ok(c.metin.length <= AY.YATAY_MAKS, "yatay satir " + c.metin.length + ": " + c.metin);
  assert.equal(yatay.map(c => c.metin).join(" "), paras[0], "metin kaybolmaz");
  for (const o of [{ stil: "kelime" }, { dikey: true }]) {
    const dikey = AY.altyaziKur(paras, ses, 0, Object.assign({ dil: "en" }, o));
    for (const c of dikey) assert.ok(c.metin.length <= 40, "dikey satir " + c.metin.length + ": " + c.metin);
    assert.equal(dikey.map(c => c.metin).join(" "), paras[0]);
  }
});

// ----------------------------------------------------------------- kilitli hedef: partBitirBekle (saf, enjekte rename)
test("partBitirBekle: gecici kilit kalkinca yerlestirir; surekli kilitte cikti_kilitli + sonuc SAKLANIR (silinmez)", async () => {
  const d = path.join(kok, "pb1"); fs.mkdirSync(d, { recursive: true });
  const hedef = path.join(d, "v.mp4"), part = F.partYolu(hedef);
  fs.writeFileSync(part, "yeni-icerik"); fs.writeFileSync(hedef, "eski-icerik");
  let n = 0;
  await F.partBitirBekle(part, hedef, { kilitBeklemeSn: 5, yenidenAdlandir: (a, b) => { n++; if (n < 4) throw kilitHatasi("EBUSY"); fs.renameSync(a, b); } });
  assert.ok(n >= 4);
  assert.equal(fs.readFileSync(hedef, "utf8"), "yeni-icerik");
  assert.ok(!fs.existsSync(part));
  // surekli kilit, park yok: hata + yonlendirme DURUSTCE (sonuc saklanmadi)
  fs.writeFileSync(part, "yeni2");
  const t0 = Date.now();
  await assert.rejects(() => F.partBitirBekle(part, hedef, { kilitBeklemeSn: 0.4, yenidenAdlandir: () => { throw kilitHatasi("EPERM"); } }),
    e => e.kod === "cikti_kilitli" && !/saklandı/.test(e.cozum) && /v\.mp4/.test(e.cozum));
  assert.ok(Date.now() - t0 >= 350, "kilitBeklemeSn kadar beklemeli");
  // surekli kilit + park: bitmis dosya park klasorune alinir
  const park = { klasor: path.join(d, "park"), imza: "imza-1", beklenenSn: 1 };
  await assert.rejects(() => F.partBitirBekle(part, hedef, { kilitBeklemeSn: 0.2, park, yenidenAdlandir: () => { throw kilitHatasi("EBUSY"); } }),
    e => e.kod === "cikti_kilitli" && /saklandı/.test(e.cozum) && /yeniden kodlanmaz/.test(e.cozum));
  const b = F.bekleyenYolu(hedef, park.klasor);
  assert.equal(path.basename(b), "v.bekleyen.mp4");
  assert.equal(fs.readFileSync(b, "utf8"), "yeni2");
  assert.ok(!fs.existsSync(part), ".part kalmamali (bir sonraki calisma onu siler)");
  const m = JSON.parse(fs.readFileSync(b + ".json", "utf8"));
  assert.equal(m.surum, 1); assert.equal(m.imza, "imza-1");
  // kilit olmayan hata (ENOENT) beklemeden hemen, ayri kodla
  await assert.rejects(() => F.partBitirBekle(path.join(d, "yok.part.mp4"), path.join(d, "yok.mp4"), { kilitBeklemeSn: 5 }), e => e.kod === "cikti_yazilamadi");
});

test("uret + park: onceki calismadan kalan bekleyen sonuc AYNI imzada yeniden kodlanmadan yerlestirilir; farkli imzada silinip kodlanir", { skip }, async () => {
  const d = path.join(kok, "pb2"); fs.mkdirSync(d, { recursive: true });
  const hedef = path.join(d, "v.mp4"), park = { klasor: path.join(d, "park"), imza: "imza-A", beklenenSn: 1 };
  const b = F.bekleyenYolu(hedef, park.klasor);
  kucukMp4(b, 1);
  fs.writeFileSync(b + ".json", JSON.stringify({ surum: 1, imza: "imza-A", beklenenSn: 1, bayt: fs.statSync(b).size }));
  const bayt = fs.statSync(b).size;
  let kodlandi = false;
  await F.uret(hedef, () => { kodlandi = true; throw new Error("yeniden kodlanmamali"); }, { park });
  assert.equal(kodlandi, false);
  assert.equal(fs.statSync(hedef).size, bayt);
  assert.ok(!fs.existsSync(b) && !fs.existsSync(b + ".json"), "bekleyen temizlenmeli");
  // farkli imza: bayat sonuc kullanilmaz
  kucukMp4(b, 1);
  fs.writeFileSync(b + ".json", JSON.stringify({ surum: 1, imza: "imza-ESKI", beklenenSn: 1, bayt: fs.statSync(b).size }));
  await F.uret(hedef, K => { kodlandi = true; return ["-f", "lavfi", "-i", "testsrc2=s=320x180:r=10:d=1", ...K.ara]; }, { park });
  assert.equal(kodlandi, true, "imza farkliysa yeniden kodlanir");
  assert.ok(!fs.existsSync(b) && !fs.existsSync(b + ".json"));
  assert.ok(F.gecerliMi(hedef, 1, 0.3));
  // bozuk/yarim bekleyen dosya da kullanilmaz
  fs.writeFileSync(b, "yarim"); fs.writeFileSync(b + ".json", JSON.stringify({ surum: 1, imza: "imza-A", beklenenSn: 1, bayt: 5 }));
  kodlandi = false;
  await F.uret(hedef, K => { kodlandi = true; return ["-f", "lavfi", "-i", "testsrc2=s=320x180:r=10:d=1", ...K.ara]; }, { park });
  assert.equal(kodlandi, true);
});

// ----------------------------------------------------------------- GERCEK kilit (Windows): oynatici final'i acik tutuyor
function dosyaKilitle(yol) {
  return new Promise((coz, red) => {
    const kacisli = yol.replace(/'/g, "''");
    const c = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "$f=[System.IO.File]::Open('" + kacisli + "','Open','Read','Read'); [Console]::Out.WriteLine('KILITLI'); Start-Sleep -Seconds 900"], { windowsHide: true });
    let hazir = false;
    const t = setTimeout(() => { if (!hazir) { try { c.kill(); } catch (e) { /* bitmis */ } red(new Error("kilit alinamadi")); } }, 30000);
    c.stdout.on("data", d => { if (!hazir && /KILITLI/.test(String(d))) { hazir = true; clearTimeout(t); coz({ birak: () => { try { spawnSync("taskkill", ["/PID", String(c.pid), "/T", "/F"], { windowsHide: true }); } catch (e) { /* bitmis */ } } }); } });
    c.on("error", e => { clearTimeout(t); red(e); });
  });
}

test("final mp4 baska programda ACIKKEN: kodlama kaybolmaz; kilit kalkinca sonraki calisma yeniden kodlamadan yerlestirir (gercek kilit)", { skip: (process.platform !== "win32" && "yalniz Windows (paylasimsiz dosya kilidi)") || skip, timeout: 400000 }, async () => {
  const j = fik.isKur(kok, { ad: "k1", paragraf: 3, konu: { intro: 1, outro: 2, gecisSure: 0.4, renk: "sinematik" } });
  const mp4 = path.join(j.dizin, "Videos", "k1.mp4");
  let r = await fik.betikCalistir("video-yap.js", ["k1"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const eskiImza = oku(j, "render-sonuc.json").imza, eskiBayt = fs.statSync(mp4).size, eskiMtime = fs.statSync(mp4).mtimeMs;
  konuYaz(j, { renk: "siyahbeyaz" });                         // girdi degisti: yeniden kurulmali
  const kilit = await dosyaKilitle(mp4);
  try {
    r = await fik.betikCalistir("video-yap.js", ["k1"], { env: { RENDER_KILIT_BEKLEME_SN: "2" } });
    assert.equal(r.kod, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /yeniden adlandırılamadı/);
    assert.match(r.stderr, /bitmiş sonuç saklandı, yeniden kodlanmaz/);
    assert.equal(fs.statSync(mp4).mtimeMs, eskiMtime, "eski video degismemeli");
    assert.equal(fs.statSync(mp4).size, eskiBayt);
    const b = path.join(j.dizin, "_tmp", "k1.bekleyen.mp4");
    assert.ok(fs.existsSync(b) && fs.existsSync(b + ".json"), "bitmis sonuc _tmp'de saklanmali");
    assert.ok(!fs.existsSync(path.join(j.dizin, "Videos", "k1.part.mp4")));
  } finally { kilit.birak(); }
  await new Promise(c => setTimeout(c, 800));
  r = await fik.betikCalistir("video-yap.js", ["k1"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /yeniden kodlanmıyor/);
  assert.notEqual(oku(j, "render-sonuc.json").imza, eskiImza);
  assert.ok(fs.statSync(mp4).mtimeMs > eskiMtime, "yeni video yerlestirilmis olmali");
  assert.ok(!fs.existsSync(path.join(j.dizin, "_tmp")), "_tmp temizlenmeli");
  assert.ok(Math.abs(fik.sureOlc(mp4) - oku(j, "render-sonuc.json").sureSn) < 0.1);
});

// ----------------------------------------------------------------- --temiz tek basina yeniden kurar; konu karti yalniz gercek baslikta
test("--temiz tek basina: girdiler ayniyken de videoyu SIFIRDAN kurar ('video guncel' diye cikmaz); konu karti baslik yoksa cizilmez", { skip, timeout: 400000 }, async () => {
  const j = fik.isKur(kok, { ad: "t1", paragraf: 3, konu: { baslik_en: undefined, konuKarti: 2, intro: 1, outro: 2, gecisSure: 0.4 } });
  assert.ok(!("baslik_en" in oku(j, "konu.json")), "fikstur baslik yazmamali");
  let r = await fik.betikCalistir("video-yap.js", ["t1"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  let s = oku(j, "render-sonuc.json");
  assert.equal(s.parcalar.konuKartiSn, 0, "baslik yokken konu karti (is adi) cizilmemeli");
  assert.ok(Math.abs(s.anlatimBaslangicSn - 0.6) < 1e-6, "bodyStart = intro 1 sn - CF: " + s.anlatimBaslangicSn);
  const mp4 = path.join(j.dizin, "Videos", "t1.mp4");
  // degisiklik yok: atlanir
  r = await fik.betikCalistir("video-yap.js", ["t1"]);
  assert.equal((sonuc(r) || {}).atlandi, true, r.stdout);
  const mtime = fs.statSync(mp4).mtimeMs;
  // --temiz: atlanmaz
  r = await fik.betikCalistir("video-yap.js", ["t1", "--temiz"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.ok(!(sonuc(r) || {}).atlandi, "--temiz atlanmamali: " + r.stdout);
  assert.match(r.stdout, /--temiz: ara dosyalar silindi/);
  assert.match(r.stdout, /klipler: [1-9]\d* üretildi, 0 önbellekten/, "onbellek silindigi icin klipler yeniden uretilmeli");
  assert.ok(fs.statSync(mp4).mtimeMs > mtime);
  // gercek baslik varsa konu karti cizilir
  konuYaz(j, { baslik_en: "Gercek Baslik" });
  r = await fik.betikCalistir("video-yap.js", ["t1"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  s = oku(j, "render-sonuc.json");
  assert.equal(s.parcalar.konuKartiSn, 2);
  assert.ok(Math.abs(s.anlatimBaslangicSn - (1 + 2 - 2 * 0.4)) < 1e-6, "bodyStart = intro 1 + konu 2 - 2xCF: " + s.anlatimBaslangicSn);
});

// ----------------------------------------------------------------- klip yedek kaydi (render-klip.js:98)
test("klipleriUret: bozuk gorselin yerine konan klip sonraki calismada SESSIZ kalmaz; yedek gorsel degisirse yeniden denenir", async () => {
  const tmp = path.join(kok, "klip-yedek"); fs.mkdirSync(tmp, { recursive: true });
  const gA = path.join(tmp, "a.jpg"), gB = path.join(tmp, "b.jpg");
  fs.writeFileSync(gA, "bozuk"); fs.writeFileSync(gB, "saglam-1");
  const ayar = { FPS: 30, W: 320, H: 180, SW: 428, SH: 240, efekt: "zoom", renk: "yok", renkFiltresi: "null" };
  const planla = () => [
    { i: 0, ad: "001/01.jpg", yol: gA, kare: 30, dosya: path.join(tmp, "clip000-aaaaaaaa.mp4") },
    { i: 1, ad: "001/02.jpg", yol: gB, kare: 30, dosya: path.join(tmp, "clip001-bbbbbbbb.mp4") }];
  const asil = { uret: F.uret, gecerliMi: F.gecerliMi, paralellik: F.paralellik };
  const kodlanan = [];
  F.uret = async (hedef, kurucu) => {
    const argv = kurucu({ ara: [], son: [], gpu: false });
    const yol = argv[argv.indexOf("-i") + 1];
    if (fs.readFileSync(yol, "utf8") === "bozuk") throw new Error("Invalid data found when processing input");
    fs.writeFileSync(hedef, "klip");
    kodlanan.push(path.basename(hedef) + "<-" + path.basename(yol));
    return hedef;
  };
  F.gecerliMi = d => { try { return fs.statSync(d).size > 0; } catch (e) { return false; } };
  F.paralellik = () => ({ n: 2, bosGB: 8 });
  const kosu = async () => { const uyarilar = []; const r = await KL.klipleriUret(ayar, planla(), tmp, () => {}, m => uyarilar.push(m)); return { r, uyarilar }; };
  const bozukUyari = u => /Görsel 001\/01\.jpg bozuk, panelden sil \(yerine 001\/02\.jpg kullanıldı\)/.test(u);
  try {
    const k1 = await kosu();
    assert.ok(k1.uyarilar.some(bozukUyari), k1.uyarilar.join("\n"));
    assert.deepEqual(k1.r.yedeklenen, [{ ad: "001/01.jpg", yerine: "001/02.jpg" }]);
    assert.ok(kodlanan.includes("clip000-aaaaaaaa.mp4<-b.jpg"), "yedek gorselden uretilmeli: " + kodlanan);
    const kayit = JSON.parse(fs.readFileSync(path.join(tmp, "klip-yedekleri.json"), "utf8"));
    assert.equal(kayit.surum, 1); assert.equal(kayit.yedekler["clip000-aaaaaaaa.mp4"].yerine, "001/02.jpg");
    // 2. calisma: klipler onbellekten; yine de uyari tekrarlanir, hicbir sey yeniden kodlanmaz
    const sayi = kodlanan.length;
    const k2 = await kosu();
    assert.ok(k2.uyarilar.some(bozukUyari), "onbellekten gelen yedek klip icin uyari tekrarlanmali: " + k2.uyarilar.join("\n"));
    assert.equal(k2.r.onbellekten, 2); assert.equal(kodlanan.length, sayi);
    assert.deepEqual(k2.r.yedeklenen, [{ ad: "001/01.jpg", yerine: "001/02.jpg" }]);
    // yedek gorsel degisti: yedekten uretilmis klip artik gecersiz -> yeniden denenir (bozuk gorsel yine yedeklenir)
    fs.writeFileSync(gB, "saglam-2-farkli-boyut");
    const k3 = await kosu();
    assert.ok(kodlanan.length > sayi && kodlanan[kodlanan.length - 1] === "clip000-aaaaaaaa.mp4<-b.jpg", "yedek degisince klip yeniden uretilmeli: " + kodlanan);
    assert.ok(k3.uyarilar.some(bozukUyari));
    assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, "klip-yedekleri.json"), "utf8")).yedekler["clip000-aaaaaaaa.mp4"].yerine, "001/02.jpg");
    // bozuk gorsel duzeltilirse (planda artik yedek gerekmez) kayit temizlenir: klip bu kez kendi gorselinden uretilir
    fs.writeFileSync(gA, "artik-saglam");
    fs.rmSync(path.join(tmp, "clip000-aaaaaaaa.mp4"));        // gercek akista gorselin imzasi degisince klip adi da degisir
    const k4 = await kosu();
    assert.deepEqual(k4.r.yedeklenen, []);
    assert.ok(!k4.uyarilar.some(bozukUyari));
    assert.ok(!fs.existsSync(path.join(tmp, "klip-yedekleri.json")), "yedek kalmadiysa kayit dosyasi silinir");
  } finally { Object.assign(F, asil); }
});

test("GERCEK akis: basligi okunan ama cozulemeyen gorsel yedeklenir ve uyari _tmp onbellegiyle gelen sonraki calismalarda da cikar", { skip, timeout: 400000 }, async () => {
  const j = fik.isKur(kok, { ad: "y1", paragraf: 4, sahneBasina: 2, gorselBasina: 2, konu: { intro: 1, outro: 2, gecisSure: 0.4 } });
  // gecerli PNG basligi (ffprobe boyutu okur) ama IDAT verisi bozuk: sahne asamasindan gecer, klip kodlamada patlar
  const png = path.join(j.dizin, "Visuals", "002-sahne", "01.jpg");
  fik.ff(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=1", "-frames:v", "1", "-f", "image2", "-c:v", "png", png]);
  const b = fs.readFileSync(png), i = b.indexOf("IDAT");
  for (let k = i + 8; k < Math.min(b.length - 20, i + 4000); k++) b[k] ^= 0xA5;
  fs.writeFileSync(png, b);
  const bozukUyari = r => Array.from(r.stdout.matchAll(/@@UYARI (.*)/g)).map(m => m[1]).filter(u => /002-sahne\/01\.jpg bozuk, panelden sil \(yerine /.test(u));
  let r = await fik.betikCalistir("video-yap.js", ["y1", "--tut"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.equal(bozukUyari(r).length, 1, r.stdout);
  for (let n = 0; n < 2; n++) {
    r = await fik.betikCalistir("video-yap.js", ["y1", "--tut", "--yeniden"]);
    assert.equal(r.kod, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /klipler: 0 üretildi, \d+ önbellekten/, "klipler onbellekten gelmeli");
    assert.equal(bozukUyari(r).length, 1, "onbellekten gelen yedek klip icin uyari tekrarlanmali: " + r.stdout);
  }
  assert.ok(Object.keys(oku(j, "_tmp", "klip-yedekleri.json").yedekler).length === 1);
});

// ----------------------------------------------------------------- marka-yap (gercek ffmpeg)
function markaGorselleri() {
  const d = path.join(kok, "marka-g"); fs.mkdirSync(d, { recursive: true });
  for (let i = 1; i <= 4; i++) { const y = path.join(d, "g" + i + ".jpg"); if (!fs.existsSync(y)) fik.ff(["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=1", "-frames:v", "1", "-q:v", "3", y]); }
  return d;
}
const markaCalistir = (args, env) => fik.betikCalistir("marka-yap.js", args, { env: Object.assign({ MARKA_GORSEL: markaGorselleri() }, env || {}), zamanAsimiMs: 280000 });

test("marka-yap: rozet verilmeyince kanal adinin bas harfleri ('VS' DEGIL); --rozet ve panel rozeti onceliklidir; .part kalmaz", { skip, timeout: 600000 }, async () => {
  const cikis = path.join(kok, "marka-r1");
  let r = await markaCalistir(["Bob's Çılgın Bilim: 100% Gerçek", "Slogan", cikis, "--dil", "tr"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\(rozet BÇB\)/);
  assert.doesNotMatch(r.stdout, /rozet VS/);
  assert.deepEqual(fs.readdirSync(cikis).filter(a => /\.part(\.|$)|^\.tmp$/.test(a)), []);
  // panel ayari doluysa o
  fs.writeFileSync(process.env.OTOMASYON_AYAR_DOSYASI, JSON.stringify({ rozet: "XY" }));
  try {
    r = await markaCalistir(["Kanal Adi", "", path.join(kok, "marka-r2")]);
    assert.equal(r.kod, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\(rozet XY\)/);
    // bayrak panelden de onceliklidir
    r = await markaCalistir(["Kanal Adi", "", path.join(kok, "marka-r2"), "--rozet", "QQ"]);
    assert.match(r.stdout, /\(rozet QQ\)/);
  } finally { fs.rmSync(process.env.OTOMASYON_AYAR_DOSYASI, { force: true }); }
});

test("marka-yap: bozuk vurguRenk uyari + varsayilan (filtre bozulmaz); onceki kosudan kalan obur uzanti (png<->jpg) silinir", { skip, timeout: 600000 }, async () => {
  const cikis = path.join(kok, "marka-v1"); fs.mkdirSync(cikis, { recursive: true });
  for (const a of ["Banner 2560x1440.jpg", "Profile Picture 1024x1024.jpg"]) fs.writeFileSync(path.join(cikis, a), "bayat");
  fs.writeFileSync(process.env.OTOMASYON_AYAR_DOSYASI, JSON.stringify({ vurguRenk: "zz:x=0,drawbox=1" }));
  try {
    const r = await markaCalistir(["Kanal X", "Slogan", cikis]);
    assert.equal(r.kod, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /@@UYARI Panel ayarındaki vurgu rengi geçersiz/);
  } finally { fs.rmSync(process.env.OTOMASYON_AYAR_DOSYASI, { force: true }); }
  assert.deepEqual(fs.readdirSync(cikis).sort(), ["Banner 2560x1440.png", "Profile Picture 1024x1024.png", "_banner-guvenli-alan-kontrol.png"],
    "png sonucu varken eski jpg kalmamali");
  assert.deepEqual([goruntuBoyutu(path.join(cikis, "Banner 2560x1440.png")).width, goruntuBoyutu(path.join(cikis, "Profile Picture 1024x1024.png")).width], [2560, 1024]);
});

test("marka-yap: PNG siniri asilinca JPG'ye dusulur ve onceki kosudan kalan ayni adli PNG silinir", { skip, timeout: 600000 }, async () => {
  const gurultu = path.join(kok, "marka-gurultu"); fs.mkdirSync(gurultu, { recursive: true });
  for (let i = 1; i <= 4; i++) fik.ff(["-f", "lavfi", "-i", "nullsrc=s=1280x720:r=1,geq=random(1)*255:random(2)*255:random(3)*255", "-frames:v", "1", "-q:v", "2", path.join(gurultu, "n" + i + ".jpg")]);
  const cikis = path.join(kok, "marka-j1"); fs.mkdirSync(cikis, { recursive: true });
  fs.writeFileSync(path.join(cikis, "Banner 2560x1440.png"), "bayat-png");
  const r = await markaCalistir(["Kanal X", "Slogan", cikis], { MARKA_GORSEL: gurultu });
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const ad = fs.readdirSync(cikis);
  assert.ok(ad.includes("Banner 2560x1440.jpg") && !ad.includes("Banner 2560x1440.png"), ad.join(", "));
  assert.ok(fs.statSync(path.join(cikis, "Banner 2560x1440.jpg")).size <= 5.5 * 1024 * 1024 + 1);
  assert.deepEqual(ad.filter(a => /\.part(\.|$)/.test(a)), []);
});
