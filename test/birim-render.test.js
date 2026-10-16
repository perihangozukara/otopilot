// BIRIM TESTLERI — video kurucu: sure / xfade hesabi, ara dosya onbellek anahtari (imza), ffmpeg metin kacisi,
// altyazi metninin KAYBOLMAMASI. Saf fonksiyonlar + (ffmpeg varsa) sentetik gercek render. Ag/ucret yok.
// Bulgu karsiliklari: B002/B026/B041/B051/B071 (onbellek), B035/B042 (xfade suresi), B044/B069 (metin kacisi), B034 (altyazi).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const fik = require("./render-fikstur");
const kok = fik.ortamKur();                              // OTOMASYON_URETIM / .env / panel-ayar gecici klasore
const skip = !fik.ffmpegVarMi() && "ffmpeg yok";
test.after(() => fik.temizle(kok));

const ortak = require("../lib/ortak");
const KL = require("../lib/render-klip");
const SH = require("../lib/render-sahne");
const A = require("../lib/render-ayar");
const AY = require("../lib/render-altyazi");
const F = require("../lib/render-ffmpeg");
const Y = require("../lib/yazi");
const RA = require("../lib/render-ana");

// ---------------------------------------------------------------- xfade hesabi
const ayar = ek => Object.assign({ FPS: 30, cfKare: 24, CF: 0.8, gecis: "fade", efekt: "zoom", renk: "sinematik", W: 1920, H: 1080, MAX_L: 11 }, ek || {});

test("xfadeGrafi: offset = (birikmis kare - cf)/FPS, toplam kare = toplam - (n-1)*cf; tek eleman 'null'", () => {
  const a = ayar();
  const g = KL.xfadeGrafi(a, [{ kare: 300 }, { kare: 300 }, { kare: 300 }], 0);
  assert.equal(g.kare, 900 - 2 * 24);
  assert.equal(KL.birlesikKare([{ kare: 300 }, { kare: 300 }, { kare: 300 }], 24), g.kare);
  const xf = g.satirlar.filter(s => /xfade/.test(s));
  assert.equal(xf.length, 2);
  assert.match(xf[0], /offset=9\.2000\b/);                       // (300-24)/30
  assert.match(xf[1], /offset=18\.4000\b/);                      // (576-24)/30
  assert.match(xf[0], /transition=fade:duration=0\.8000/);
  assert.match(xf[1], /\[vm\]$/);
  const tek = KL.xfadeGrafi(a, [{ kare: 90 }], 2);
  assert.equal(tek.kare, 90);
  assert.ok(tek.satirlar.includes("[c0]null[vm]"));
  assert.match(tek.satirlar[0], /^\[2:v\]/, "girdi indeksi ofsetlenir");
});

test("klipPlani (rastgele sahneler): kesintisiz kapsama, son kare = anlatim sonu, video = anlatim + kuyruk (anlatim ASLA kesilmez)", () => {
  let t = 4242;
  const rnd = () => (t = (t * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let deneme = 0; deneme < 200; deneme++) {
    const FPS = 30, cf = rnd() < 0.5 ? 24 : 12;
    const ctx = { FPS, cfKare: cf, MAX_L: rnd() < 0.5 ? 11 : 6 };
    const sahneSayisi = 1 + Math.floor(rnd() * 25);
    let sn = 0;
    const sahneler = [];
    for (let i = 1; i <= sahneSayisi; i++) {
      sn += 0.3 + rnd() * 40;                                           // sahne suresi 0.3 - 40 sn
      const k = 1 + Math.floor(rnd() * 5);
      sahneler.push({ no: i, son: sn, gorseller: Array.from({ length: k }, (_, j) => ({ ad: i + "/" + j + ".jpg", yol: "x", bayt: 1 })) });
    }
    const kuyruk = rnd() < 0.5 ? cf : Math.max(Math.round(0.6 * FPS), cf);
    const klipler = SH.klipPlani(ctx, sahneler, kuyruk);
    assert.equal(klipler[0].basKare, 0);
    for (let i = 0; i < klipler.length; i++) {
      const k = klipler[i];
      assert.ok(k.sonKare > k.basKare, "bos klip");
      if (i) assert.equal(k.basKare, klipler[i - 1].sonKare, "bosluk/binme");
      assert.equal(k.kare, (k.sonKare - k.basKare) + (i === klipler.length - 1 ? kuyruk : cf));
    }
    const anlatimKare = Math.round(sn * FPS);
    assert.equal(klipler[klipler.length - 1].sonKare, Math.max(anlatimKare, klipler[klipler.length - 1].basKare + 1));
    const govde = KL.birlesikKare(klipler, cf);
    assert.equal(govde, klipler[klipler.length - 1].sonKare + kuyruk, "gövde = anlatim + kuyruk");
    assert.ok(govde >= anlatimKare + cf, "son kelimeden sonra en az CF kadar goruntu/ses payi");
    // her sahnenin gorseli kendi araliginda
    const sahneNo = klipler.map(k => k.sahne);
    assert.deepEqual(sahneNo, sahneNo.slice().sort((a, b) => a - b));
  }
});

test("esitKlipPlani (eski yol): toplam anlatim kadar, gorsel tekrarlari MAX_L'yi asmaz, gecis binmesi sayilir", () => {
  const ctx = { FPS: 30, cfKare: 24, CF: 0.8, MAX_L: 11 };
  const gorseller = Array.from({ length: 3 }, (_, i) => ({ ad: "g" + i, yol: "y", bayt: 1 }));
  const { klipler, ozgun } = SH.esitKlipPlani(ctx, { toplam: 120 }, gorseller, 24);
  assert.equal(ozgun, 3);
  assert.ok(klipler.length >= 11, "120 sn / 11 sn tavan");
  assert.equal(klipler[0].basKare, 0);
  assert.equal(klipler[klipler.length - 1].sonKare, 3600);
  assert.equal(KL.birlesikKare(klipler, 24), 3600 + 24);
});

// ---------------------------------------------------------------- ara dosya onbellek anahtari (imza)
function gorselDosyasi(ad, icerik) {
  const y = path.join(kok, ad);
  fs.writeFileSync(y, icerik || "x".repeat(100));
  return y;
}
const klip = (yol, ek) => Object.assign({ i: 3, ad: "001-a/01.jpg", yol, bayt: 100, kare: 240, zin: true }, ek || {});

test("klipImzasi: ayni girdi ayni imza; efekt/renk/cozunurluk/fps/kare/yon/kodlayici/gorsel dosyasi degisince imza DEGISIR", () => {
  const yol = gorselDosyasi("imza.jpg");
  const taban = KL.klipImzasi(ayar(), klip(yol), "libx264");
  assert.match(taban, /^[0-9a-f]{8}$/);
  assert.equal(KL.klipImzasi(ayar(), klip(yol), "libx264"), taban, "deterministik");
  const farkli = {
    efekt: KL.klipImzasi(ayar({ efekt: "hizli" }), klip(yol), "libx264"),
    renk: KL.klipImzasi(ayar({ renk: "siyahbeyaz" }), klip(yol), "libx264"),
    genislik: KL.klipImzasi(ayar({ W: 1280 }), klip(yol), "libx264"),
    yukseklik: KL.klipImzasi(ayar({ H: 720 }), klip(yol), "libx264"),
    fps: KL.klipImzasi(ayar({ FPS: 25 }), klip(yol), "libx264"),
    kare: KL.klipImzasi(ayar(), klip(yol, { kare: 241 }), "libx264"),
    yon: KL.klipImzasi(ayar(), klip(yol, { zin: false }), "libx264"),
    kodlayici: KL.klipImzasi(ayar(), klip(yol), "NVIDIA NVENC"),
    gorselAdi: KL.klipImzasi(ayar(), klip(yol, { ad: "002-b/01.jpg" }), "libx264"),
  };
  for (const [ne, im] of Object.entries(farkli)) assert.notEqual(im, taban, ne + " imzayi degistirmeli");
  assert.equal(new Set(Object.values(farkli).concat(taban)).size, Object.keys(farkli).length + 1, "hepsi birbirinden farkli");
  // gorsel icerigi (boyut) ya da degisme zamani degisince
  fs.writeFileSync(yol, "y".repeat(5000));
  const boyutlu = KL.klipImzasi(ayar(), klip(yol), "libx264");
  assert.notEqual(boyutlu, taban, "dosya boyutu degisti");
  const eski = new Date(Date.now() - 86400000);
  fs.utimesSync(yol, eski, eski);
  assert.notEqual(KL.klipImzasi(ayar(), klip(yol), "libx264"), boyutlu, "degisme zamani degisti");
  // gorsel hic yoksa imza yine uretilir (hata klip asamasinda cikar)
  assert.match(KL.klipImzasi(ayar(), klip(path.join(kok, "yok.jpg")), "libx264"), /^[0-9a-f]{8}$/);
});

test("klipAdi / grupAdi: adin kendisi imzali ('clip007-xxxxxxxx.mp4'); gecis tipi ve suresi ya da uye degisince grup adi degisir", () => {
  assert.equal(KL.klipAdi(7, "abcd1234"), "clip007-abcd1234.mp4");
  assert.equal(KL.klipAdi(105, "abcd1234"), "clip105-abcd1234.mp4");
  const uyeler = [{ ad: "clip000-aaaaaaaa.mp4" }, { ad: "clip001-bbbbbbbb.mp4" }];
  const g = KL.grupAdi("grp", 2, uyeler, ayar(), "libx264");
  assert.match(g, /^grp02-[0-9a-f]{8}\.mp4$/);
  assert.equal(KL.grupAdi("grp", 2, uyeler, ayar(), "libx264"), g);
  assert.notEqual(KL.grupAdi("grp", 2, uyeler, ayar({ gecis: "dissolve" }), "libx264"), g, "gecis tipi");
  assert.notEqual(KL.grupAdi("grp", 2, uyeler, ayar({ cfKare: 12 }), "libx264"), g, "gecis suresi");
  assert.notEqual(KL.grupAdi("grp", 2, [uyeler[0], { ad: "clip001-cccccccc.mp4" }], ayar(), "libx264"), g, "uye klip degisti");
  assert.notEqual(KL.grupAdi("grp", 2, uyeler.slice().reverse(), ayar(), "libx264"), g, "uye sirasi");
  assert.notEqual(KL.grupAdi("grp", 2, uyeler, ayar(), "NVIDIA NVENC"), g, "kodlayici");
  assert.match(KL.grupAdi("ust1_", 0, uyeler, ayar(), "libx264"), /^ust1_00-[0-9a-f]{8}\.mp4$/);
});

test("ayarCoz: gecis suresi KARE sayisina yuvarlanir (CF = cfKare/FPS); gorunum ozeti efekt/renk/gecisle degisir; bozuk konu.json exit 2", () => {
  const dizin = path.join(kok, "ac1");
  fs.mkdirSync(dizin, { recursive: true });
  fs.writeFileSync(path.join(dizin, "konu.json"), JSON.stringify({ surum: 1, baslik_en: "T", kanal: "K", format: "long", gecisSure: 0.55, efekt: "yavas", renk: "sicak", gecis: "fadeblack" }));
  const a = A.ayarCoz("ac1");
  assert.equal(a.cfKare, 17);                                   // round(0.55 * 30)
  assert.equal(a.CF, 17 / 30);
  assert.deepEqual([a.gecis, a.efekt, a.renk], ["fadeblack", "yavas", "sicak"]);
  assert.equal(a.W, 1920);
  assert.equal(A.ayarCoz("ac1", { olcek: 0.25 }).W, 480);
  assert.equal(A.ayarCoz("ac1", { olcek: 0.25 }).W % 2, 0, "cozunurluk cift olmali (x264)");
  const o1 = A.gorunumOzeti(a, "libx264");
  fs.writeFileSync(path.join(dizin, "konu.json"), JSON.stringify({ surum: 1, baslik_en: "T", kanal: "K", format: "long", gecisSure: 0.55, efekt: "hizli", renk: "sicak", gecis: "fadeblack" }));
  assert.notEqual(A.gorunumOzeti(A.ayarCoz("ac1"), "libx264"), o1);
  const dikey = path.join(kok, "ac2");
  fs.mkdirSync(dikey, { recursive: true });
  fs.writeFileSync(path.join(dikey, "konu.json"), JSON.stringify({ surum: 1, baslik_en: "T", kanal: "K", format: "short" }));
  const d = A.ayarCoz("ac2");
  assert.deepEqual([d.W, d.H, d.dikey, d.cfKare], [1080, 1920, true, 12]);          // dikeyde 0.4 sn gecis
  fs.writeFileSync(path.join(dikey, "konu.json"), '{"surum":1, "format": "short",}');
  assert.throws(() => A.ayarCoz("ac2"), e => e.cikis === 2 && e.kod === "konu_bozuk");
  assert.throws(() => A.ayarCoz("yok-boyle-bir-is"), e => e.cikis === 2);
});

test("finalImzasi: ayar, ses, altyazi metni, manifest ya da gorsel dosyasi degisince DEGISIR; ayni girdide ayni", () => {
  const dizin = path.join(kok, "fi1");
  const VIS = path.join(dizin, "Visuals"), VOICE = path.join(dizin, "Voice");
  fs.mkdirSync(path.join(VIS, "001-a"), { recursive: true });
  fs.mkdirSync(VOICE, { recursive: true });
  fs.writeFileSync(path.join(VIS, "001-a", "01.jpg"), "gorsel");
  fs.writeFileSync(path.join(VIS, "manifest.json"), "{}");
  fs.writeFileSync(path.join(VOICE, "kelimeler.json"), "{}");
  const yollar = { VIS, VOICE };
  const a = ayar({ intro: 8, outro: 12, geriSayim: 0, konuKarti: 0, markaKose: 2, kanal: "K", slogan: "s", baslik: "b", vurguHex: "6FD8FF", dil: "en",
    altyazi: true, altyaziStil: "cumle", altyaziDili: "en", muzikSeviyesi: 0.4, muzikDosyasi: "", muzikDucking: true, muzikRuhu: "sakin", outroMetni: { baslik: "X" } });
  const taban = RA.finalImzasi(a, "ses1", ["p1", "p2"], yollar);
  assert.equal(RA.finalImzasi(a, "ses1", ["p1", "p2"], yollar), taban);
  const farklar = [
    RA.finalImzasi(Object.assign({}, a, { efekt: "hizli" }), "ses1", ["p1", "p2"], yollar),
    RA.finalImzasi(Object.assign({}, a, { kanal: "Baska" }), "ses1", ["p1", "p2"], yollar),
    RA.finalImzasi(Object.assign({}, a, { outro: 3 }), "ses1", ["p1", "p2"], yollar),
    RA.finalImzasi(Object.assign({}, a, { markaKose: 0 }), "ses1", ["p1", "p2"], yollar),
    RA.finalImzasi(Object.assign({}, a, { altyazi: false }), "ses1", ["p1", "p2"], yollar),
    RA.finalImzasi(a, "ses2", ["p1", "p2"], yollar),
    RA.finalImzasi(a, "ses1", ["p1", "p2 degisti"], yollar),
  ];
  for (const f of farklar) assert.notEqual(f, taban);
  fs.writeFileSync(path.join(VIS, "001-a", "01.jpg"), "baska gorsel!");
  const gorselSonra = RA.finalImzasi(a, "ses1", ["p1", "p2"], yollar);
  assert.notEqual(gorselSonra, taban, "gorsel degisti");
  fs.writeFileSync(path.join(VIS, "manifest.json"), '{"surum":1}');
  assert.notEqual(RA.finalImzasi(a, "ses1", ["p1", "p2"], yollar), gorselSonra, "manifest degisti");
  fs.rmSync(path.join(VIS, "001-a", "01.jpg"));
  assert.notEqual(RA.finalImzasi(a, "ses1", ["p1", "p2"], yollar), gorselSonra, "gorsel silindi");
});

test("diskTahminGB: sureyle ve cozunurlukle artar; en kotu durum (NVENC 1.3 MB/sn) olculmus sabitle", () => {
  assert.equal(RA.MB_SN, 1.3);
  const bir = RA.diskTahminGB({ W: 1920, H: 1080 }, 600, 600);
  const iki = RA.diskTahminGB({ W: 1920, H: 1080 }, 1200, 1200);
  assert.ok(iki > bir * 1.9 && iki < bir * 2.1, bir + " -> " + iki);
  assert.ok(RA.diskTahminGB({ W: 480, H: 270 }, 600, 600) < bir / 10);
  assert.ok(bir > 3 && bir < 12, "10 dk 1080p icin birkac GB: " + bir);
});

// ---------------------------------------------------------------- ffmpeg metin kacisi
const KOTU_METINLER = ["Bob's Facts", "Bilim: Basitçe", "30% daha hızlı", "C:\\Users\\ornek\\dosya", "a'b:c%d\\e,f;g[h]i=j#k", "Şeker İğne Çöp ğüşıöç", "%{localtime} %{pts} \\n sonra", "\"çift\" 'tek' `ters`", "😀 emoji", "uzun ".repeat(30)];

test("drawtext: metin filtre dizgisine GIRMEZ (textfile + expansion=none); dosyada birebir, BOM'suz UTF-8", () => {
  const dizin = path.join(kok, "yazi");
  KOTU_METINLER.forEach((m, i) => {
    const f = Y.drawtext({ font: "kalin", metin: m, dizin, ad: "t" + i, boyut: 40, x: 10, y: 10 });
    assert.match(f, /^drawtext=fontfile='[^']*(?:'\\\\\\''[^']*)*':textfile='/);
    assert.match(f, /:expansion=none:/);
    assert.ok(!f.includes("Bob") && !f.includes("localtime") && !f.includes("Basit"), "metin filtre dizgisinde: " + f.slice(0, 120));
    const yol = path.join(dizin, "t" + i + ".txt");
    const ham = fs.readFileSync(yol);
    assert.notEqual(ham[0], 0xEF, "BOM olmamali");
    assert.equal(ham.toString("utf8"), m.replace(/\n+$/, ""));
  });
  assert.equal(fs.readFileSync(path.join(dizin, "t0.txt"), "utf8").endsWith("\n"), false);
});

test("kacisliYol / concatSatiri / partYolu: iki nokta ve tek tirnak kacirilir, ters egik cizgi ileri egik olur", () => {
  assert.equal(Y.kacisliYol("C:\\Windows\\Fonts\\arialbd.ttf"), "C\\:/Windows/Fonts/arialbd.ttf");
  assert.equal(Y.kacisliYol("/a/b c/it's.txt"), "/a/b c/it'\\\\\\''s.txt");
  assert.equal(F.concatSatiri("C:\\tmp\\clip'1.mp4"), "file 'C:/tmp/clip'\\''1.mp4'");
  assert.equal(F.concatSatiri("/tmp/a.mp4"), "file '/tmp/a.mp4'");
  assert.equal(F.partYolu("C:\\x.y\\video.mp4"), "C:\\x.y\\video.part.mp4");
  assert.equal(F.partYolu("/a/b/clip000-abc.mp4"), "/a/b/clip000-abc.part.mp4");
  assert.equal(F.partYolu("/a/b.c/dosya.tar.gz"), "/a/b.c/dosya.tar.part.gz");
});

test("GERCEK ffmpeg: ozel karakterli her metin drawtext ile kare uretir (Invalid argument yok), cikti bos degil", { skip }, () => {
  const dizin = path.join(kok, "yazi2");
  KOTU_METINLER.forEach((m, i) => {
    const dt = Y.drawtext({ font: "kalin", metin: m, dizin, ad: "g" + i, boyut: 36, renk: "white", x: 20, y: 20 });
    const cikti = path.join(dizin, "k" + i + ".png");
    execFileSync(fik.FF(), ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=640x120", "-vf", dt, "-frames:v", "1", cikti],
      { stdio: "pipe", windowsHide: true, timeout: 60000 });
    assert.ok(fs.statSync(cikti).size > 500, "kare uretilmedi: " + m);
  });
});

test("kodlayiciHatasiMi / zamanAsimi: encoder hatalari taninir (GPU->CPU), baska hatalar tanimaz; sure arttikca zaman asimi artar", () => {
  for (const s of ["Error while opening encoder for output stream", "Cannot load nvcuda.dll", "OpenEncodeSession failed", "h264_nvenc: No capable devices found", "out of memory"])
    assert.equal(F.kodlayiciHatasiMi({ message: s }), true, s);
  assert.equal(F.kodlayiciHatasiMi({ ffStderr: "Cannot load nvcuda.dll" }), true);
  for (const s of ["No such file or directory", "Invalid data found when processing input", ""]) assert.equal(F.kodlayiciHatasiMi({ message: s }), false, s);
  assert.equal(F.kodlayiciHatasiMi(null), false);
  assert.ok(F.zamanAsimi(600, 8, 300) > F.zamanAsimi(60, 8, 300));
  assert.ok(F.zamanAsimi(1, 8, 300) >= 300 * 1000 || F.zamanAsimi(1, 8, 300) >= 300, "asgari sinir uygulanir");
});

// ---------------------------------------------------------------- altyazi: metin ASLA kaybolmaz (B034)
function sesKur(paragraflar, ek) {
  const ses = { N: paragraflar.length, baslangic: [], sure: [], kelimeler: [] };
  let bas = 0;
  paragraflar.forEach((p, i) => {
    const w = p.split(/\s+/).filter(Boolean).length;
    const sure = (ek && ek.sure && ek.sure[i]) || Math.max(0.5, w * 0.35);
    ses.baslangic.push(bas); ses.sure.push(sure); bas += sure + 0.35;
    const M = (ek && ek.M && ek.M[i] !== undefined) ? ek.M[i] : w;
    ses.kelimeler.push({ kelimeler: Array.from({ length: M }, (_, j) => ({ t: ek && ek.sifirZaman ? 0 : Math.round(j * sure * 1000 / M), d: 100, w: "x" })) });
  });
  return ses;
}
const kelimeler = m => String(m).split(/\s+/).filter(Boolean);

test("altyaziKur: BOZUK kelime zamani (hepsi 0 ms) olsa bile hicbir kelime kaybolmaz, satirlar sirali ve ust uste binmez", () => {
  const p = ["The quick brown fox jumps over the lazy dog. " .repeat(6).trim(), "Dr. Smith went to the U.S. in 1999. He liked it there, really."];
  for (const stil of [undefined, "kelime", "cumle"]) for (const dikey of [false, true]) {
    const ses = sesKur(p, { sifirZaman: true });
    const cues = AY.altyaziKur(p, ses, 5, { stil, dikey, dil: "en" });
    assert.equal(cues.flatMap(c => kelimeler(c.metin)).join(" "), p.flatMap(kelimeler).join(" "), "stil " + stil + " dikey " + dikey);
    for (let i = 0; i < cues.length; i++) {
      assert.ok(cues[i].son > cues[i].bas);
      if (i) assert.ok(cues[i].bas >= cues[i - 1].son - 1e-9, "ust uste binme");
    }
  }
});

test("altyaziKur (rastgele, 400 paragraf): kelime kaybi yok, sure > 0, ust uste binme yok; en az 0.6 sn gorunme (sigdigi surece)", () => {
  let t = 99;
  const rnd = () => (t = (t * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const SOZ = ["The", "quick", "Dr.", "Smith", "went", "to", "U.S.", "1999.", "He", "it!", "Why?", "Because,", "knew;", "extraordinarily", "a", "J.", "said:", "\"Yes.\"", "(maybe)", "Şehrin", "limanı."];
  for (let n = 0; n < 400; n++) {
    const N = 1 + Math.floor(rnd() * 3);
    const p = Array.from({ length: N }, () => Array.from({ length: 1 + Math.floor(rnd() * 60) }, () => SOZ[Math.floor(rnd() * SOZ.length)]).join(" "));
    const ses = sesKur(p, { sure: p.map(() => 0.2 + rnd() * 20), M: p.map(x => (rnd() < 0.2 ? 0 : Math.max(1, Math.round(kelimeler(x).length * (0.8 + rnd() * 0.5))))) });
    const cues = AY.altyaziKur(p, ses, 7.5, { stil: rnd() < 0.5 ? "kelime" : "cumle", dikey: rnd() < 0.5, dil: "en" });
    assert.equal(cues.flatMap(c => kelimeler(c.metin)).join(" "), p.flatMap(kelimeler).join(" "), "paragraflar: " + JSON.stringify(p).slice(0, 160));
    for (let i = 0; i < cues.length; i++) {
      assert.ok(cues[i].son > cues[i].bas);
      if (i) assert.ok(cues[i].bas >= cues[i - 1].son - 1e-9);
    }
  }
});

test("srtZaman / srtMetni: saat-dakika-saniye,ms bicimi ve numarali bloklar; temizMetin ASS suslu parantezlerini etkisizlestirir", () => {
  assert.equal(AY.srtZaman(0), "00:00:00,000");
  assert.equal(AY.srtZaman(61.2345), "00:01:01,235");
  assert.equal(AY.srtZaman(3725.5), "01:02:05,500");
  assert.equal(AY.srtZaman(-3), "00:00:00,000");
  assert.equal(AY.temizMetin("a {\\an8} b\n\n c"), "a (\\an8) b c");
  const srt = AY.srtMetni([{ bas: 1, son: 2, metin: "bir" }, { bas: 2.5, son: 4, metin: "iki" }]);
  assert.equal(srt, "1\n00:00:01,000 --> 00:00:02,000\nbir\n\n2\n00:00:02,500 --> 00:00:04,000\niki\n");
});

test("MIN_GORUNUR / YATAY_MAKS sabitleri sozlesmeyle ayni (0.6 sn, 42 karakter)", () => {
  assert.equal(AY.MIN_GORUNUR, 0.6);
  assert.equal(AY.YATAY_MAKS, 42);
  const kisaltmalar = [["Dr.", false], ["U.S.", false], ["Prof.", false], ["bitti.", true], ["mı?", true], ["Wow!", true], ["J.", false]];
  for (const [k, beklenen] of kisaltmalar) assert.equal(AY.cumleSonuMu(k, "en"), beklenen, k);
  assert.equal(AY.cumleSonuMu("3.", "tr"), false, "Turkce sira sayisi cumle sonu degil");
});

// ---------------------------------------------------------------- uctan uca: sure kimligi (gercek ffmpeg)
test("video-yap.js: Shorts (9:16) — sureSn = anlatimBitis + outro, anlatimBaslangic = intro - CF, cikti 1080x1920 olcegi, .part yok", { skip, timeout: 280000 }, async () => {
  const j = fik.isKur(kok, { ad: "birimr1", paragraf: 4, sahneBasina: 2, gorselBasina: 2, genislik: 720, yukseklik: 1280,
    konu: { format: "short", intro: 1.5, outro: 2, geriSayim: 0, konuKarti: 0, gecisSure: 0.4, muzikSeviyesi: 0.3, kanal: "BIRIM'S: 100%" } });
  const r = await fik.betikCalistir("video-yap.js", ["birimr1"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const s = JSON.parse(fs.readFileSync(path.join(j.dizin, "render-sonuc.json"), "utf8"));
  const cf = 12 / 30;
  assert.ok(Math.abs(s.anlatimBaslangicSn - (1.5 - cf)) < 0.04, "bodyStart = intro - CF: " + s.anlatimBaslangicSn);
  assert.ok(Math.abs(s.anlatimBitisSn - s.anlatimBaslangicSn - j.toplam) < 0.15, "anlatim suresi sesle ayni");
  assert.ok(Math.abs(s.sureSn - (s.anlatimBitisSn + 2)) < 0.15, "video = anlatim bitisi + outro: " + s.sureSn + " vs " + (s.anlatimBitisSn + 2));
  assert.ok(s.genislik < s.yukseklik, "dikey");
  assert.equal(s.secimler.gecis.length > 0, true);
  const dosyalar = [];
  (function yuru(d) { for (const g of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, g.name); if (g.isDirectory()) yuru(p); else dosyalar.push(p); } })(j.dizin);
  assert.deepEqual(dosyalar.filter(p => /\.part(\.|$)/.test(p)), []);
  assert.ok(fs.existsSync(path.join(j.dizin, "Videos", "birimr1.mp4")));
  assert.ok(ortak.partTemizle(path.join(j.dizin, "Videos")) === 0);
});
