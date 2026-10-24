// Video klip destegi (klip-hazirla.js + video-yap.js): sahne klasorune konan mp4/mov/webm klipler sahne suresine
// kesilir/uzatilir; gorsel ve klip ayni videoda karisik kullanilabilir; yarim indirme atlanir; gorsel-bul klip modunda stok aramaz.
// Gercek ffmpeg, sentetik is, ag yok, ucret yok.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const fik = require("./render-fikstur");
const kok = fik.ortamKur();
const skip = !fik.ffmpegVarMi() && "ffmpeg yok";
const CPU = { VIDEO_KODEK: "cpu" };

test.after(() => fik.temizle(kok));

// hareketli test klibi (testsrc2 sayaci her karede degisir)
const klipYap = (hedef, sn, renk) => fik.ff(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=24:d=" + sn + (renk ? ",hue=h=" + renk : ""),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", hedef]);

function klipIsiKur(ad, konu) {
  const j = fik.isKur(kok, { ad, paragraf: 4, sahneBasina: 2, gorselBasina: 1, konu: Object.assign({ intro: 0, outro: 0, markaKose: 0, gecisSure: 0.4, muzikSeviyesi: 0, gecis: "fade", efekt: "zoom", renk: "yok" }, konu || {}) });
  fs.rmSync(path.join(j.dizin, "Visuals"), { recursive: true, force: true });          // stok gorsel yok: yalniz kendi kliplerimiz
  const kaynak = path.join(kok, ad + "-klipler");
  fs.mkdirSync(kaynak, { recursive: true });
  return { j, kaynak };
}
const kareSayisi = f => Number(require("child_process").execFileSync(fik.FP(), ["-v", "error", "-count_frames", "-select_streams", "v:0",
  "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", f], { windowsHide: true }).toString().trim());

test("klip-hazirla: paragraf basina sahne klasoru, --kaynak numarali dosyalari kopyalar, yarim indirmeyi atlar", { skip }, async () => {
  const { j, kaynak } = klipIsiKur("vk1");
  klipYap(path.join(kaynak, "01-orman.mp4"), 1);
  klipYap(path.join(kaynak, "2.mp4"), 1);
  fs.writeFileSync(path.join(kaynak, "03.mp4.crdownload"), "yarim");
  fs.writeFileSync(path.join(kaynak, "notlar.txt"), "x");
  const r = await fik.betikCalistir("klip-hazirla.js", ["vk1", "--kaynak", kaynak]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(j.dizin, "Visuals", "manifest.json"), "utf8"));
  assert.equal(m.klipModu, true);
  assert.deepEqual(m.sahneler.map(s => s.paragraflar), [[0], [1], [2], [3]]);
  assert.deepEqual(fs.readdirSync(path.join(j.dizin, "Visuals", m.sahneler[0].klasor)), ["01-orman.mp4"]);
  assert.deepEqual(fs.readdirSync(path.join(j.dizin, "Visuals", m.sahneler[1].klasor)), ["2.mp4"]);
  assert.equal(fs.readdirSync(path.join(j.dizin, "Visuals", m.sahneler[2].klasor)).length, 0, "yarim indirme kopyalanmamali");
  const liste = fs.readFileSync(path.join(j.dizin, "SAHNE-LISTESI.md"), "utf8");
  assert.match(liste, /\*\*boş\*\*/);
  assert.match(r.stdout, /2 sahne boş/);
  // gorsel-bul klip modunda stok aramaz (ag cagrisi yok)
  const g = await fik.betikCalistir("gorsel-bul.js", ["vk1"]);
  assert.equal(g.kod, 0, g.stdout + g.stderr);
  assert.match(g.stdout, /ATLANDI/);
  // ikinci calisma ayni senaryoda klasorleri bozmaz
  const r2 = await fik.betikCalistir("klip-hazirla.js", ["vk1"]);
  assert.equal(r2.kod, 0, r2.stdout + r2.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(j.dizin, "Visuals", "manifest.json"), "utf8")).sahneler.map(s => s.klasor), m.sahneler.map(s => s.klasor));
});

test("video-yap: kisa klip (son kare tutulur), uzun klip (kesilir), gorsel ve klip karisik; sure anlatima esit", { skip, timeout: 300000 }, async () => {
  const { j, kaynak } = klipIsiKur("vk2");
  klipYap(path.join(kaynak, "01.mp4"), 0.6);                  // paragraftan cok kisa
  klipYap(path.join(kaynak, "02.mov"), 12, 90);              // paragraftan uzun
  fik.ff(["-f", "lavfi", "-i", "mandelbrot=s=1280x720:r=1", "-frames:v", "1", "-q:v", "3", path.join(kaynak, "03.jpg")]);
  klipYap(path.join(kaynak, "04.webm".replace("webm", "mp4")), 2, 200);
  let r = await fik.betikCalistir("klip-hazirla.js", ["vk2", "--kaynak", kaynak]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  r = await fik.betikCalistir("video-yap.js", ["vk2", "--tut"], { env: CPU });
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /4 sahne, 4 görsel -> 4 klip/);
  const final = path.join(j.dizin, "Videos", "vk2.mp4");
  const D = fik.sureOlc(final);
  assert.ok(Math.abs(D - (j.toplam + 0.6)) < 0.25, "video " + D + " sn, anlatım " + j.toplam + " sn (+0.6 kuyruk)");
  // her klip tam kare sayisinda (kisa klip tpad ile uzadi, uzun klip kesildi)
  const tmp = path.join(j.dizin, "_tmp");
  const klipler = fs.readdirSync(tmp).filter(a => /^clip\d+-.*\.mp4$/.test(a)).sort();
  assert.equal(klipler.length, 4, klipler.join());
  for (const k of klipler) assert.ok(kareSayisi(path.join(tmp, k)) > 30, k);
  assert.doesNotMatch(r.stdout + r.stderr, /bozuk/);
});

test("klipUzat: dongu ve yavaslat kisa klibi sahne suresine yayar; gecersiz deger konu.json hatasi verir", { skip, timeout: 300000 }, async () => {
  for (const kip of ["dongu", "yavaslat"]) {
    const ad = "vk3" + kip;
    const { j, kaynak } = klipIsiKur(ad, { klipUzat: kip });
    for (const n of ["01", "02", "03", "04"]) klipYap(path.join(kaynak, n + ".mp4"), 0.8);
    let r = await fik.betikCalistir("klip-hazirla.js", [ad, "--kaynak", kaynak]);
    assert.equal(r.kod, 0, r.stdout + r.stderr);
    r = await fik.betikCalistir("video-yap.js", [ad], { env: CPU });
    assert.equal(r.kod, 0, kip + ": " + r.stdout + r.stderr);
    assert.ok(Math.abs(fik.sureOlc(path.join(j.dizin, "Videos", ad + ".mp4")) - (j.toplam + 0.6)) < 0.25, kip);
  }
  const ortak = require("../lib/ortak");
  assert.equal(ortak.konuDogrula({ klipUzat: "dondur" }).gecerli, true);
  assert.equal(ortak.konuDogrula({ klipUzat: "geri" }).gecerli, false);
});

test("klip modunda olmayan iste stok gorsel varsa klip-hazirla --yeniden olmadan gecmez", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "vk4", paragraf: 2, sahneBasina: 1, gorselBasina: 1 });
  let r = await fik.betikCalistir("klip-hazirla.js", ["vk4"]);
  assert.equal(r.kod, 2, r.stdout + r.stderr);
  r = await fik.betikCalistir("klip-hazirla.js", ["vk4", "--yeniden"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  // eski stok gorsel klasorleri numarasiyla korunur, icindeki gorseller videoya girer
  const m = JSON.parse(fs.readFileSync(path.join(j.dizin, "Visuals", "manifest.json"), "utf8"));
  assert.deepEqual(m.sahneler.map(s => s.klasor), ["001-sahne", "002-sahne"]);
});

test("klipTamOynat + ortamSesi: klip anlatimdan uzunsa kesilmez, sahneye sessizlik eklenir; anlatim bitince klibin kendi sesi duyulur", { skip, timeout: 300000 }, async () => {
  const { j, kaynak } = klipIsiKur("vk5", { klipTamOynat: true, ortamSesi: 0.5, klipUzat: "yavaslat" });
  const sesliKlip = (hedef, sn) => fik.ff(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=24:d=" + sn, "-f", "lavfi", "-i", "sine=frequency=440:duration=" + sn,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-c:a", "aac", "-shortest", hedef]);
  sesliKlip(path.join(kaynak, "01.mp4"), 8);                 // paragraftan cok uzun: kesilmemeli
  sesliKlip(path.join(kaynak, "02.mp4"), 8);
  klipYap(path.join(kaynak, "03.mp4"), 0.8);                 // kisa ve sessiz: eski davranis (yavaslat), ortam izine girmez
  klipYap(path.join(kaynak, "04.mp4"), 0.8);
  let r = await fik.betikCalistir("klip-hazirla.js", ["vk5", "--kaynak", kaynak]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  r = await fik.betikCalistir("video-yap.js", ["vk5", "--tut"], { env: CPU });
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /KLİP TAM OYNAT: 2 sahnede/);
  assert.match(r.stdout, /ORTAM SESİ: 2 klibin/);
  const sonuc = JSON.parse(fs.readFileSync(path.join(j.dizin, "render-sonuc.json"), "utf8"));
  const pb = sonuc.paragrafBaslangic;
  // sahne 1 = paragraf 0: klip 8 sn tam oynar, paragraf 1 en erken 8 sn'de (+ paragraf arasi bosluk) baslar
  assert.ok(pb[1] - pb[0] >= 8 - 0.05, "paragraf 1 başlangıcı " + pb[1]);
  assert.ok(pb[2] - pb[1] >= 8 - 0.05, "paragraf 2 başlangıcı " + pb[2]);
  // paragraf 2-3 arasina ek yok (kisa klip): normal bosluk
  assert.ok(Math.abs((pb[3] - pb[2]) - (j.zParca[2].sureSn + j.bosluk)) < 0.1, "paragraf 3 kaymamalı");
  // 8 sn'lik klipler kesilmeden kendi sahnelerinde oynar (ek sessizlik sonraki sahneye kaymaz)
  const tmp = path.join(j.dizin, "_tmp");
  const klipDosya = fs.readdirSync(tmp).filter(a => /^clip\d+-.*\.mp4$/.test(a)).sort();
  assert.equal(klipDosya.length, 4, klipDosya.join());
  for (const k of klipDosya.slice(0, 2)) assert.ok(kareSayisi(path.join(tmp, k)) >= 8 * 24 - 2, k + " kesilmiş");
  assert.ok(kareSayisi(path.join(tmp, klipDosya[2])) < 8 * 24, "kısa klibin sahnesi uzamamalı");
  const final = path.join(j.dizin, "Videos", "vk5.mp4");
  const D = fik.sureOlc(final);
  const ek = (8 - j.zParca[0].sureSn) + (8 - j.bosluk - j.zParca[1].sureSn);      // sahne 1 ve 2'ye eklenen sessizlik
  assert.ok(Math.abs(D - (j.toplam + ek + 0.6)) < 0.3, "video " + D + " sn, beklenen " + (j.toplam + ek + 0.6).toFixed(2) + " sn");
  // anlatim bittikten sonra, klip suresince (sessizlik eklenen yer) ortam sesi duyulmali
  const bas = pb[0] + j.zParca[0].sureSn + 0.8, son = pb[1] - 0.8;
  assert.ok(son - bas > 1, "ölçüm aralığı yeterli değil");
  const cikti = require("child_process").spawnSync(fik.FF(), ["-hide_banner", "-ss", bas.toFixed(2), "-t", (son - bas).toFixed(2), "-i", final,
    "-vn", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8", windowsHide: true });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(cikti.stderr);
  assert.ok(m && Number(m[1]) > -45, "anlatım sonrası ortam sesi çok kısık: " + (m && m[1]));
  const ortak = require("../lib/ortak");
  assert.equal(ortak.konuDogrula({ klipTamOynat: true, ortamSesi: 0.5 }).gecerli, true);
  assert.equal(ortak.konuDogrula({ klipTamOynat: "evet" }).gecerli, false);
  assert.equal(ortak.konuDogrula({ ortamSesi: 2 }).gecerli, false);
});
