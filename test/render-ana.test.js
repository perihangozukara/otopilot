// video-yap.js (lib/render-ana.js) ENTEGRASYON testleri — gercek ffmpeg, sentetik is, dusuk cozunurluk
// (RENDER_OLCEK=0.25), ag yok, ucret yok. Her senaryo kendi is klasorunde.
//
// Kabul olcutleri (sozlesme 11): son kelimeden sonra >= CF ses var, anlatim bodyStart'ta basliyor,
// final .part'siz; Durdur simulasyonu sonrasi yeniden calisma temiz; kanal adinda ' : % ile render gecer;
// gorunum degisince cikti degisir (imza).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const fik = require("./render-fikstur");
const kok = fik.ortamKur();
const ffvar = fik.ffmpegVarMi();
const skip = !ffvar && "ffmpeg yok";

test.after(() => fik.temizle(kok));

const oku = (j, ...p) => JSON.parse(fs.readFileSync(path.join(j.dizin, ...p), "utf8"));
const konuYaz = (j, ek) => { const k = oku(j, "konu.json"); fs.writeFileSync(path.join(j.dizin, "konu.json"), JSON.stringify(Object.assign(k, ek), null, 2)); };
function partlar(dizin) {
  const out = [];
  (function yuru(d) {
    for (const g of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, g.name);
      if (g.isDirectory()) yuru(p); else if (/\.part(\.|$)/.test(g.name) || /\.\d+\.tmp$/.test(g.name)) out.push(p);
    }
  })(dizin);
  return out;
}
const sonuc = r => { const m = /@@SONUC (\{.*\})/.exec(r.stdout); return m ? JSON.parse(m[1]) : null; };
const uyarilar = r => Array.from(r.stdout.matchAll(/@@UYARI (.*)/g)).map(m => m[1]);
function sessizlik(dosya, esik) {
  const r = spawnSync(fik.FF(), ["-hide_banner", "-nostats", "-i", dosya, "-vn", "-af", "silencedetect=noise=" + (esik || -45) + "dB:d=0.2", "-f", "null", "NUL"], { encoding: "utf8", windowsHide: true });
  const baslar = Array.from(r.stderr.matchAll(/silence_start: (-?[\d.]+)/g)).map(m => parseFloat(m[1]));
  const biter = Array.from(r.stderr.matchAll(/silence_end: (-?[\d.]+)/g)).map(m => parseFloat(m[1]));
  return { baslar, biter };
}
// sesin bittigi an: sondaki sessizlik varsa onun basladigi an, yoksa dosya suresi
function sesBitisi(dosya) {
  const s = sessizlik(dosya), dur = fik.sureOlc(dosya), n = s.baslar.length;
  if (!n) return dur;
  if (n > s.biter.length) return s.baslar[n - 1];                       // sessizlik dosya sonuna kadar surdu
  return s.biter[n - 1] >= dur - 0.1 ? s.baslar[n - 1] : dur;           // son sessizlik EOF'te kapandiysa
}
const akisSuresi = (dosya, tur) => Number(execFileSync(fik.FP(), ["-v", "error", "-select_streams", tur, "-show_entries", "stream=duration", "-of", "csv=p=0", dosya], { windowsHide: true }).toString().trim());
const kareHash = (dosya, sn) => execFileSync(fik.FF(), ["-v", "error", "-ss", String(sn), "-i", dosya, "-frames:v", "1", "-f", "md5", "-"], { windowsHide: true }).toString().trim();

test("tam render: zaman cizelgesi (anlatim bodyStart'ta, son kelimeden sonra >= CF ses), .part yok, yan ciktilar", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "r1", paragraf: 5, konu: { muzikSeviyesi: 0, intro: 1.5, outro: 3, geriSayim: 0, konuKarti: 0, gecisSure: 0.4 } });
  const r = await fik.betikCalistir("video-yap.js", ["r1"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const s = oku(j, "render-sonuc.json");
  assert.equal(s.surum, 1);
  assert.ok(Math.abs(s.anlatimBaslangicSn - 1.1) < 1e-6, "bodyStart = intro - 1*CF: " + s.anlatimBaslangicSn);
  const A = j.zParca.reduce((a, z) => a + z.sureSn, 0) + 4 * 0.35;
  assert.ok(Math.abs(s.anlatimBitisSn - (1.1 + A)) < 0.5, "anlatim bitisi " + s.anlatimBitisSn);
  assert.ok(Math.abs(s.sureSn - (s.anlatimBitisSn + 3)) < 0.1, "video suresi = anlatim bitisi + outro: " + s.sureSn);
  assert.equal(s.tmpSilindi, true);
  assert.deepEqual(partlar(j.dizin), [], ".part kalmamali");
  assert.ok(!fs.existsSync(path.join(j.dizin, "_tmp")), "_tmp silinmeli");
  const mp4 = path.join(j.dizin, "Videos", "r1.mp4");
  const sure = fik.sureOlc(mp4);
  assert.ok(Math.abs(sure - s.sureSn) < 0.1);
  // SES ZAMANLAMASI (yalniz anlatim: muzik 0)
  const ilk = sessizlik(path.join(j.dizin, "Voice", "parts", "000.mp3"));
  const cikti = sessizlik(mp4);
  const ilkSesBeklenen = 1.1 + (ilk.biter.length && ilk.baslar[0] <= 0.01 ? ilk.biter[0] : 0);
  const ilkSesGercek = cikti.biter.length ? cikti.biter[0] : 0;
  assert.ok(Math.abs(ilkSesGercek - ilkSesBeklenen) < 0.12, "ilk ses " + ilkSesGercek + " beklenen " + ilkSesBeklenen);
  const sonSesBitisParca = sesBitisi(path.join(j.dizin, "Voice", "parts", "004.mp3"));
  const sonSesBeklenen = 1.1 + j.zParca[4].baslangicSn + sonSesBitisParca;
  const sonSesGercek = sesBitisi(mp4);
  assert.ok(Math.abs(sonSesGercek - sonSesBeklenen) < 0.2, "son ses " + sonSesGercek + " beklenen " + sonSesBeklenen);
  // son kelimeden sonra en az CF (0.4) ses/goruntu var; ses videoyu kesmiyor
  assert.ok(sure - sonSesGercek >= 0.4, "son kelimeden sonra kalan " + (sure - sonSesGercek));
  assert.ok(akisSuresi(mp4, "a:0") >= sure - 0.1, "ses akisi video kadar uzun olmali");
  // yan ciktilar
  assert.ok(fs.existsSync(path.join(j.dizin, "altyazi.srt")) && fs.existsSync(path.join(j.dizin, "Videos", "r1.srt")));
  assert.equal(oku(j, "paragraflar.json").length, 5);
  const kapak = path.join(j.dizin, "Videos", "r1-kapak.jpg");
  assert.ok(fs.statSync(kapak).size > 1000 && fs.statSync(kapak).size <= 2 * 1024 * 1024);
  const y = oku(j, "yayin.json");
  assert.equal(y.surum, 1); assert.equal(y.kapak, "Videos/r1-kapak.jpg");
  assert.equal(y.uyum.sentetikSes, true);
  assert.match(y.uyum.beyanHatirlatma, /değiştirilmiş\/sentetik içerik/);
  assert.ok(y.atiflar.length >= 1 && y.atiflar[0].atifMetni.includes("—"));
  assert.ok(fs.existsSync(path.join(j.dizin, "YAYIN-PAKETI.md")) && fs.existsSync(path.join(j.dizin, "bolumler.txt")));
  // altyazi SRT: ilk satir bodyStart'ta
  assert.match(fs.readFileSync(path.join(j.dizin, "altyazi.srt"), "utf8"), /^1\n00:00:01,[01]\d\d --> /);
  // tekrar calistirma: degisiklik yok -> atlanir
  const r2 = await fik.betikCalistir("video-yap.js", ["r1"]);
  assert.equal(r2.kod, 0, r2.stdout + r2.stderr);
  assert.equal((sonuc(r2) || {}).atlandi, true, r2.stdout);
  const mtime = fs.statSync(mp4).mtimeMs;
  assert.equal(fs.statSync(mp4).mtimeMs, mtime);
});

test("gorunum degisince cikti degisir (imza); silinen gorsel videoda kalmaz", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "r2", paragraf: 4, konu: { muzikSeviyesi: 0.3, intro: 1, outro: 2, gecisSure: 0.4, renk: "sinematik" } });
  const mp4 = path.join(j.dizin, "Videos", "r2.mp4");
  let r = await fik.betikCalistir("video-yap.js", ["r2", "--tut"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const imza1 = oku(j, "render-sonuc.json").imza;
  const h1 = kareHash(mp4, 6);
  const tmpAdlar1 = fs.readdirSync(path.join(j.dizin, "_tmp")).filter(a => /^clip/.test(a));
  assert.ok(tmpAdlar1.every(a => /^clip\d{3}-[0-9a-f]{8}\.mp4$/.test(a)), "imzali ad: " + tmpAdlar1.join());
  // renk degisti -> yeniden kurulmali, kare farkli, klip adlari farkli (eskiler silinmis)
  konuYaz(j, { renk: "siyahbeyaz" });
  r = await fik.betikCalistir("video-yap.js", ["r2", "--tut"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.ok(!(sonuc(r) || {}).atlandi, "renk degisince atlanmamali");
  assert.notEqual(oku(j, "render-sonuc.json").imza, imza1);
  assert.notEqual(kareHash(mp4, 6), h1, "yeni renk videoya yansimali");
  const tmpAdlar2 = fs.readdirSync(path.join(j.dizin, "_tmp")).filter(a => /^clip/.test(a));
  assert.ok(tmpAdlar2.every(a => !tmpAdlar1.includes(a)), "eski renkli klipler silinmeli/yeniden kullanilmamali");
  // bir gorsel silinirse (manifestten de) klip plani degisir ve video yeniden kurulur
  const imza2 = oku(j, "render-sonuc.json").imza;
  const m = oku(j, "Visuals", "manifest.json");
  const silinen = m.sahneler[0].gorseller.pop();
  fs.rmSync(path.join(j.dizin, "Visuals", silinen.dosya));
  fs.writeFileSync(path.join(j.dizin, "Visuals", "manifest.json"), JSON.stringify(m));
  r = await fik.betikCalistir("video-yap.js", ["r2"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.notEqual(oku(j, "render-sonuc.json").imza, imza2);
  assert.ok(!(sonuc(r) || {}).atlandi);
});

test("Durdur simulasyonu: yarim/bozuk ara dosyalar sonraki calismayi bozmaz", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "r3", paragraf: 6, sahneBasina: 1, gorselBasina: 2, konu: { muzikSeviyesi: 0.3, intro: 1, outro: 2, gecisSure: 0.4 } });
  let oldu = false;
  const r1 = await fik.betikCalistir("video-yap.js", ["r3", "--tut"], { cikti: (c, d) => {
    if (!oldu && /Klipler oluşturuluyor/.test(d)) {
      oldu = true;
      setTimeout(() => {
        try { if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(c.pid), "/T", "/F"], { windowsHide: true }); else c.kill("SIGKILL"); } catch (e) { /* bitmis */ }
      }, 700);
    }
  } });
  assert.ok(oldu);
  assert.notEqual(r1.kod, 0, "oldurulen surec 0 ile bitmemeli");
  assert.ok(!fs.existsSync(path.join(j.dizin, "Videos", "r3.mp4")), "yarim video 'hazir' gorunmemeli");
  // yarim kalmis ara dosya benzetimi (eski surumun biraktigi): .part, 0 bayt ve bozuk klip
  const tmp = path.join(j.dizin, "_tmp"); fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, "clip000-deadbeef.part.mp4"), "yarim");
  fs.writeFileSync(path.join(tmp, "clip001-cafebabe.mp4"), "");
  fs.writeFileSync(path.join(tmp, "clip002.mp4"), "bozuk icerik, ffprobe okuyamaz");
  fs.writeFileSync(path.join(tmp, "grp00.mp4"), "eski surumden kalma");
  await new Promise(r => setTimeout(r, 1500));             // olu surecin ffmpeg cocugu (varsa) bitsin
  const r2 = await fik.betikCalistir("video-yap.js", ["r3"]);
  assert.equal(r2.kod, 0, r2.stdout + r2.stderr);
  assert.deepEqual(partlar(j.dizin), []);
  assert.ok(fik.sureOlc(path.join(j.dizin, "Videos", "r3.mp4")) > 5);
  const s = oku(j, "render-sonuc.json");
  assert.ok(Math.abs(fik.sureOlc(path.join(j.dizin, "Videos", "r3.mp4")) - s.sureSn) < 0.1);
});

test("bozuk onbellekteki klip (yari kesilmis) ffprobe ile yakalanir ve yeniden uretilir", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "r4", paragraf: 4, konu: { intro: 1, outro: 2, gecisSure: 0.4 } });
  let r = await fik.betikCalistir("video-yap.js", ["r4", "--tut"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const tmp = path.join(j.dizin, "_tmp");
  const klip = fs.readdirSync(tmp).filter(a => /^clip\d+-/.test(a))[0];
  const yol = path.join(tmp, klip);
  const boyut = fs.statSync(yol).size;
  fs.truncateSync(yol, Math.floor(boyut / 2));              // yari kes
  r = await fik.betikCalistir("video-yap.js", ["r4", "--tut", "--yeniden"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /klipler: [1-9]\d* üretildi/);
  assert.ok(fs.statSync(yol).size >= boyut * 0.9, "bozuk klip yeniden uretilmeli");
});

test("kanal adi / slogan / baslik ozel karakterli (' : % \\) render'i bozmaz; marka kosesi, konu karti, geri sayim", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "r5", paragraf: 4, konu: { kanal: "Bob's: 100% \\ Facts", slogan: "Bilim: Basitçe 'x' 50%", baslik_en: "100% Fun: Bob's \\ Guide; \"quoted\"",
    geriSayim: 5, intro: 3, konuKarti: 2, outro: 4, markaKose: 2, gecisSure: 0.8, outroMetni: { baslik: "ABONE: OL %100", alt: "BİLDİRİM'LERİ AÇ", altSlogan: "Her hafta: yeni 'video'" } } });
  const r = await fik.betikCalistir("video-yap.js", ["r5"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const s = oku(j, "render-sonuc.json");
  // bodyStart = (5 + 3 + 2) - 3 x 0.8 = 7.6 ; video = bodyStart + anlatim + outro
  assert.ok(Math.abs(s.anlatimBaslangicSn - 7.6) < 1e-6, String(s.anlatimBaslangicSn));
  assert.ok(Math.abs(s.sureSn - (s.anlatimBitisSn + 4)) < 0.1, s.sureSn + " vs " + s.anlatimBitisSn);
  assert.equal(s.parcalar.geriSayimSn, 5);
  assert.ok(fs.existsSync(path.join(kok, "_onbellek")), "geri sayim ortak onbellekte");
  assert.deepEqual(partlar(j.dizin), []);
  assert.deepEqual(uyarilar(r).filter(u => /bozuk|tutarsız/.test(u)), []);
});

test("Reels/TikTok (outro yok): son kelime kesilmez, 0.6 sn kuyruk kalir", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "r6", paragraf: 4, konu: { format: "reels", aspect: "9:16", intro: 1.5, outro: 0, konuKarti: 0, geriSayim: 0, gecisSure: 0.4, muzikSeviyesi: 0 } });
  const r = await fik.betikCalistir("video-yap.js", ["r6"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const s = oku(j, "render-sonuc.json");
  assert.ok(Math.abs(s.sureSn - (s.anlatimBitisSn + 0.6)) < 0.1, s.sureSn + " vs " + s.anlatimBitisSn);
  assert.ok(s.yukseklik > s.genislik, "dikey");
  const mp4 = path.join(j.dizin, "Videos", "r6.mp4");
  assert.ok(s.sureSn - sesBitisi(mp4) >= 0.4, "son kelimeden sonra >= CF");
});

test("onizleme: dusuk cozunurluklu kisa video, final mp4 / render-sonuc yazilmaz", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "r7", paragraf: 5, konu: { intro: 1, outro: 3, gecisSure: 0.4 } });
  const r = await fik.betikCalistir("video-yap.js", ["r7", "--onizleme=6"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const p = path.join(j.dizin, "Videos", "r7-onizleme.mp4");
  assert.ok(fs.existsSync(p));
  const d = fik.sureOlc(p);
  assert.ok(d <= 6.2 && d > 4, "onizleme suresi " + d);
  assert.ok(!fs.existsSync(path.join(j.dizin, "Videos", "r7.mp4")));
  assert.ok(!fs.existsSync(path.join(j.dizin, "render-sonuc.json")));
  assert.ok(!fs.existsSync(path.join(j.dizin, "_tmp-onizleme")));
});

test("seslendirme guncel degilse render baslamaz: exit 4 + Turkce mesaj, video olusmaz", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "r8", paragraf: 3 });
  fs.appendFileSync(path.join(j.dizin, "Voice", "SESLENDIRME-TAM-METIN.txt"), "\nBir paragraf daha eklendi.\n");
  const r = await fik.betikCalistir("video-yap.js", ["r8"]);
  assert.equal(r.kod, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /✗ Seslendirme güncel değil: seslendirmeyi yeniden yap/);
  assert.ok(!fs.existsSync(path.join(j.dizin, "Videos", "r8.mp4")));
});

test("bozuk konu.json: sessizce varsayilana dusulmez, exit 2 + satir/sutun", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "r9", paragraf: 2 });
  fs.writeFileSync(path.join(j.dizin, "konu.json"), '{\n  "format": "long",\n  "kanal": "X",,\n}\n');
  const r = await fik.betikCalistir("video-yap.js", ["r9"]);
  assert.equal(r.kod, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /✗ konu\.json bozuk \(satır \d+, sütun \d+\)/);
  assert.ok(!fs.existsSync(path.join(j.dizin, "Videos", "r9.mp4")));
});

test("altyazi dosyasi paragraf sayisi farkliysa exit 4 (sessiz kayma yok); eksikse exit 2", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "r10", paragraf: 3, konu: { altyaziDili: "tr" } });
  let r = await fik.betikCalistir("video-yap.js", ["r10"]);
  assert.equal(r.kod, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /Altyazı dosyası yok/);
  fs.writeFileSync(path.join(j.dizin, "Voice", "ALTYAZI-TR.txt"), "Bir\n\nİki\n");
  r = await fik.betikCalistir("video-yap.js", ["r10"]);
  assert.equal(r.kod, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /paragraf sayısı/);
});

test("bozuk gorsel atlanir ve uyarilir; yeterli gorsel kaliyorsa video uretilir", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "r11", paragraf: 4, gorselBasina: 2, konu: { intro: 1, outro: 2, gecisSure: 0.4 } });
  fs.writeFileSync(path.join(j.dizin, "Visuals", "002-sahne", "02.jpg"), "<html>429</html>".repeat(30));
  const r = await fik.betikCalistir("video-yap.js", ["r11"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.ok(uyarilar(r).some(u => /002-sahne\/02\.jpg bozuk, panelden sil/.test(u)), uyarilar(r).join("\n"));
  assert.ok(fs.existsSync(path.join(j.dizin, "Videos", "r11.mp4")));
});

test("iki es zamanli render ayni iste: ikincisi exit 6 (kilit)", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "r12", paragraf: 4, konu: { intro: 1, outro: 2, gecisSure: 0.4 } });
  let ikinci = null;
  const birinci = await fik.betikCalistir("video-yap.js", ["r12"], { cikti: (c, d) => {
    if (!ikinci && /KODLAYICI/.test(d)) ikinci = fik.betikCalistir("video-yap.js", ["r12"]);
  } });
  const r2 = await ikinci;
  assert.equal(birinci.kod, 0, birinci.stdout + birinci.stderr);
  assert.equal(r2.kod, 6, r2.stdout + r2.stderr);
  assert.match(r2.stderr, /zaten çalışıyor/);
  void j;
});

test("cesitlilik: gecis/efekt/renk verilmemisse is adina gore secilir (deterministik), kapaliysa varsayilan", () => {
  const A = require("../lib/render-ayar");
  const mk = (ad, ek) => { const d = path.join(kok, ad); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "konu.json"), JSON.stringify(Object.assign({ surum: 1, baslik_en: "T" }, ek))); return A.ayarCoz(ad); };
  const a1 = mk("cesit-a", {}), a2 = mk("cesit-a", {});
  assert.deepEqual(a1.secimler, a2.secimler);
  assert.equal(a1.secimler.otomatik.gecis, true);
  const farkli = new Set(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"].map(ad => JSON.stringify(mk(ad, {}).secimler.gecis + mk(ad, {}).secimler.renk)));
  assert.ok(farkli.size >= 3, "farkli islerde farkli secimler beklenir: " + farkli.size);
  const kapali = mk("cesit-k", { cesitlilik: false });
  assert.equal(kapali.gecis, "fade"); assert.equal(kapali.efekt, "zoom"); assert.equal(kapali.renk, "sinematik"); assert.equal(kapali.muzikRuhu, "sakin");
  const verilmis = mk("cesit-v", { gecis: "wipeleft", renk: "sicak" });
  assert.equal(verilmis.gecis, "wipeleft"); assert.equal(verilmis.renk, "sicak"); assert.equal(verilmis.secimler.otomatik.gecis, false);
  // gecis suresi kare sayisina yuvarlanir
  assert.equal(mk("cesit-g", { gecisSure: 0.55 }).cfKare, Math.round(0.55 * 30));
});

test("GPU kodlayici hatasi: ayni adim CPU ile tekrarlanir (render ortasinda da calisir)", { skip }, async () => {
  const F = require("../lib/render-ffmpeg");
  const K0 = F.kodekler();
  const d = path.join(kok, "gpu-t"); fs.mkdirSync(d, { recursive: true });
  const cikti = path.join(d, "o.mp4");
  let deneme = 0;
  // GPU aciksa ilk denemede kasitli gecersiz nvenc secenegi (kodlayici hatasi uretir); CPU'da dogrudan basarili
  await F.uret(cikti, K => { deneme++; return ["-f", "lavfi", "-i", "testsrc2=s=160x90:r=10:d=1",
    ...(K.gpu ? ["-c:v", "h264_nvenc", "-preset", "gecersiz_onayar_xyz"] : K.ara)]; }, { etiket: "gpu-test" });
  assert.ok(fik.sureOlc(cikti) > 0.5);
  if (K0.gpu) { assert.equal(deneme, 2, "GPU hatasi sonrasi bir kez tekrar"); assert.equal(F.gpuAcikMi(), false, "GPU kapatilmali"); }
  else assert.equal(deneme, 1);
});

test("ffmpeg zaman asimi: takilan adim oldurulur ve Turkce hata verir", { skip }, async () => {
  const F = require("../lib/render-ffmpeg");
  await assert.rejects(() => F.calistir(["-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30", "-t", "100000", "-f", "null", F.NULL_CIHAZ], { etiket: "takili", zamanAsimiMs: 1500 }),
    e => e.kod === "ffmpeg_zaman_asimi" && /(saniyede|dakikada) bitmedi/.test(e.message));
});

test("cok sahne (105 sahne / 105 klip): 3 haneli klasorler, ust grup kademesi, sure kare-kesin kalir", { skip, timeout: 900000 }, async () => {
  const j = fik.isKur(kok, { ad: "r13", paragraf: 105, sahneBasina: 1, gorselBasina: 1, ton: true,
    konu: { intro: 1.5, outro: 3, gecisSure: 0.4, muzikSeviyesi: 0.3, cesitlilik: false } });
  const r = await fik.betikCalistir("video-yap.js", ["r13", "--tut"], { zamanAsimiMs: 840000 });
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SAHNE: 105 sahne, 105 görsel -> 105 klip/);
  assert.match(r.stdout, /ara kademe 1:/, "10'dan fazla parca: ust gruplar kurulmali");
  const tmp = fs.readdirSync(path.join(j.dizin, "_tmp"));
  assert.ok(tmp.some(a => /^ust1_\d\d-[0-9a-f]{8}\.mp4$/.test(a)), tmp.join());
  const s = oku(j, "render-sonuc.json");
  const mp4 = path.join(j.dizin, "Videos", "r13.mp4");
  // 105 klip + 14+ birlesim: sure anlatim bitisi + outro'dan kare-kesin sapmamali (<= 3 kare)
  assert.ok(Math.abs(fik.sureOlc(mp4) - (s.anlatimBitisSn + 3)) < 0.1, fik.sureOlc(mp4) + " vs " + (s.anlatimBitisSn + 3));
  assert.ok(Math.abs(s.anlatimBaslangicSn - 1.1) < 1e-6);
  // sahne numarasi 100+ olan paragraflar da dogru zamanda: son paragraf baslangici anlatim bitisine yakin
  assert.ok(s.paragrafBaslangic.length === 105 && s.paragrafBaslangic[104] < s.anlatimBitisSn && s.paragrafBaslangic[104] > s.paragrafBaslangic[99]);
  for (let i = 1; i < 105; i++) assert.ok(s.paragrafBaslangic[i] > s.paragrafBaslangic[i - 1]);
  assert.deepEqual(partlar(j.dizin), []);
});

test("muzik: her ruh dikisiz dongu uretir (akorlar ortusur, sifira inen nefes yok)", { skip }, async () => {
  const M = require("../lib/render-muzik");
  const F = require("../lib/render-ffmpeg");
  const d = path.join(kok, "muzik-t"); fs.mkdirSync(d, { recursive: true });
  for (const [ruh, r] of Object.entries(M.RUHLAR)) {
    const yol = await M.sentetikDongu(ruh, d);
    const beklenen = r.akorlar.length * r.akorSn;
    assert.ok(Math.abs(fik.sureOlc(yol) - beklenen) < 0.05, ruh + " dongu suresi " + fik.sureOlc(yol) + " beklenen " + beklenen);
    // dongu dikisi ve her akor gecisi (akorSn katlari) sessizlige inmemeli: her 0.3 sn'lik pencere -40 dB ustunde
    const olc = async (a) => {
      const x = await F.olc(["-ss", String(a), "-t", "0.3", "-i", yol, "-af", "volumedetect", "-f", "null", F.NULL_CIHAZ]);
      return parseFloat(/mean_volume: (-?[\d.]+) dB/.exec(x.stderr)[1]);
    };
    const noktalar = [0, beklenen - 0.3];
    for (let i = 1; i < r.akorlar.length; i++) noktalar.push(i * r.akorSn - 0.15);
    for (const a of noktalar) assert.ok(await olc(a) > -40, ruh + " @" + a.toFixed(1) + " sn: sessizlige iniyor");
  }
});

test("muzikDosyasi: kullanicinin dosyasi tum video boyunca dongulenir; yoksa render baslamadan exit 2", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "r14", paragraf: 4, konu: { intro: 1, outro: 2, gecisSure: 0.4, muzikSeviyesi: 0.5 } });
  const muzik = path.join(j.dizin, "benim-muzigim.wav");
  fik.ff(["-f", "lavfi", "-i", "sine=frequency=330:duration=3", "-ac", "2", muzik]);          // 3 sn: video boyunca dongulenmeli
  konuYaz(j, { muzikDosyasi: muzik });
  const r = await fik.betikCalistir("video-yap.js", ["r14"]);
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /MÜZİK: kullanıcı dosyası \(benim-muzigim\.wav, döngülenir\)/);
  const s = oku(j, "render-sonuc.json");
  const mp4 = path.join(j.dizin, "Videos", "r14.mp4");
  assert.ok(s.sureSn > 12, "video muzik dosyasindan uzun olmali: " + s.sureSn);
  // son anlatim saniyelerinde de muzik/ses var (dosya 3 sn'de bitip susmadi): outro oncesi pencere sessiz degil
  const x = spawnSync(fik.FF(), ["-hide_banner", "-nostats", "-ss", String(s.sureSn - 4), "-t", "1", "-i", mp4, "-vn", "-af", "volumedetect", "-f", "null", "NUL"], { encoding: "utf8", windowsHide: true });
  assert.ok(parseFloat(/mean_volume: (-?[\d.]+) dB/.exec(x.stderr)[1]) > -50);
  // dosya yok: pahali is baslamadan hata
  konuYaz(j, { muzikDosyasi: path.join(j.dizin, "yok.mp3") });
  const r2 = await fik.betikCalistir("video-yap.js", ["r14", "--yeniden"]);
  assert.equal(r2.kod, 2, r2.stdout + r2.stderr);
  assert.match(r2.stderr, /✗ Müzik dosyası bulunamadı/);
  assert.ok(!/Klipler oluşturuluyor/.test(r2.stdout), "klip uretimine hic gecilmemeli");
});
