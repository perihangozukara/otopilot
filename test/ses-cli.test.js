// test/ses-cli.test.js — seslendir.js KOMUT SATIRI uctan uca (ag YOK): sahte Piper yurutulebiliri ile.
// Gercek .env'e dokunulmaz (OTOMASYON_ENV_DOSYASI); is klasorleri uretim/_test-ses-*/ altinda.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync, spawn } = require("child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./ses-sahte.js");

const ortam = S.ortamiYalitla();
const uretim = S.testUretimi();
const testF = S.ffmpegTesti(test);          // ffmpeg yoksa (CI) atlanir
test.after(() => { uretim.temizle(); ortam.temizle(); });

const SESLENDIR = path.join(S.KOK, "seslendir.js");
const SAHTE_PIPER = path.join(__dirname, "ses-sahte-piper.js");
const SAHTE_MODEL = path.join(ortam.dizin, "tr_TR-sahte-medium.onnx");
fs.writeFileSync(SAHTE_MODEL, "");           // piper modeli var mi diye bakilir; icerigi sahte piper'a lazim degil
const PAR = ["First paragraph of the command line test.", "Second paragraph goes right here.", "Third and final paragraph of this run."];

const env = ek => Object.assign({}, process.env, {
  OTOMASYON_URETIM: uretim.taban, OTOMASYON_ENV_DOSYASI: ortam.envDosyasi, OTOMASYON_AYAR_DOSYASI: path.join(ortam.dizin, "yok.json"),
  PIPER_YOL: SAHTE_PIPER, PIPER_MODEL: SAHTE_MODEL,
}, ek || {});
const calistir = (args, ek) => spawnSync(process.execPath, [SESLENDIR, ...args], { env: env(ek), encoding: "utf8", timeout: 120000 });
// @@ILERLEME / @@SONUC satirlari JSON; @@UYARI duz metin (ayrica listelenir)
const protokol = cikti => Object.fromEntries(cikti.split(/\r?\n/).filter(l => /^@@(ILERLEME|SONUC) /.test(l)).map(l => {
  const i = l.indexOf(" "); return [l.slice(2, i), JSON.parse(l.slice(i + 1))]; }));

let sayac = 0;
const yeniIs = (par, konu) => {
  const ad = "cli" + (++sayac);
  const dizin = S.isOlustur(uretim.taban, ad, par);
  if (konu) fs.writeFileSync(path.join(dizin, "konu.json"), typeof konu === "string" ? konu : JSON.stringify(konu));
  return { ad, dizin };
};

testF("CLI: piper ile tam kosu, @@SONUC ve cikis 0; ikinci kosu atlanir; --yeniden zorlar", () => {
  const { ad, dizin } = yeniIs(PAR, { baslik_en: "Test", hedefSaniye: 15 });
  const r1 = calistir([ad, "--motor", "piper"]);
  assert.equal(r1.status, 0, r1.stderr + r1.stdout);
  const p1 = protokol(r1.stdout);
  assert.equal(p1.SONUC.paragrafSayisi, 3);
  assert.equal(p1.SONUC.motor, "piper");
  assert.equal(p1.SONUC.ses, "tr_TR-sahte-medium");
  assert.ok(p1.ILERLEME && p1.ILERLEME.asama === "ses" && p1.ILERLEME.yuzde === 100);
  assert.ok(!/\r/.test(r1.stdout), "\\r ile ilerleme basilmamali");
  assert.ok(!/^\.+$/m.test(r1.stdout), "nokta nokta ilerleme yasak");
  const z = JSON.parse(fs.readFileSync(path.join(dizin, "Voice", "zamanlama.json"), "utf8"));
  assert.equal(z.paragrafSayisi, 3);
  assert.equal(z.motor, "piper");
  assert.equal(z.hedefSn, 15);
  assert.ok(!fs.existsSync(path.join(dizin, ".kilit")), "kilit birakilmali");

  const r2 = calistir([ad, "--motor", "piper"]);
  assert.equal(r2.status, 0, r2.stderr);
  assert.deepEqual(protokol(r2.stdout).SONUC, { atlandi: true, neden: "ses güncel" });

  const r3 = calistir([ad, "--motor", "piper", "--yeniden"]);
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(protokol(r3.stdout).SONUC.paragrafSayisi, 3);
});

testF("CLI: konu.json'daki sesMotoru ve okunus kullanilir; konu yoksa varsayilanlarla calisir", () => {
  const { ad, dizin } = yeniIs(["Enflasyon %15 oldu ve 3,5 puan arttı."], { baslik_en: "T", dil: "tr", ses: "tr-TR-AhmetNeural", sesMotoru: "piper", okunus: { oldu: "gerçekleşti" } });
  const r = calistir([ad]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const k = JSON.parse(fs.readFileSync(path.join(dizin, "Voice", "kelimeler.json"), "utf8"));
  assert.equal(k.dil, "tr");
  assert.equal(k.paragraflar[0].okunanMetin, "Enflasyon yüzde on beş gerçekleşti ve üç virgül beş puan arttı.");
  assert.equal(k.paragraflar[0].metinDegisti, true);

  const yok = yeniIs(PAR);               // konu.json yok
  const r2 = calistir([yok.ad, "--motor", "piper"]);
  assert.equal(r2.status, 0, r2.stderr);
});

testF("CLI: --test 5 sn ornek uretir ve @@SONUC {dosya,sureSn,motor} basar", () => {
  const cikti = path.join(ortam.dizin, "ornek", "ses.mp3");
  const r = calistir(["--test", cikti, "--ses", "tr-TR-AhmetNeural", "--motor", "piper"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const s = protokol(r.stdout).SONUC;
  assert.equal(s.motor, "piper");
  assert.equal(path.resolve(s.dosya), path.resolve(cikti));
  assert.ok(s.sureSn > 0.5);
  assert.ok(fs.existsSync(cikti));
  const r2 = calistir(["--test"]);
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /✗ --test için çıktı dosyası gerekli/);
});

testF("CLI hata kodlari: arguman yok 2, is yok 2, senaryo yok 2, bozuk konu.json 2, gecersiz hiz 2", () => {
  const a = calistir([]);
  assert.equal(a.status, 2);
  assert.match(a.stderr, /✗ İş adı verilmedi/);

  const b = calistir(["olmayan-is-adi"]);
  assert.equal(b.status, 2);
  assert.match(b.stderr, /✗ İş bulunamadı/);

  const c = yeniIs(null);
  const rc = calistir([c.ad, "--motor", "piper"]);
  assert.equal(rc.status, 2);
  assert.match(rc.stderr, /✗ Seslendirilecek senaryo yok/);
  assert.match(rc.stderr, /↳ /);
  assert.ok(/@@HATA/.test(rc.stderr));

  const d = yeniIs(PAR, '{"baslik_en": "x",\n  "ses": }');
  const rd = calistir([d.ad, "--motor", "piper"]);
  assert.equal(rd.status, 2);
  assert.match(rd.stderr, /✗ konu\.json bozuk \(satır 2, sütun/);

  const e = yeniIs(PAR);
  const re = calistir([e.ad, "en-US-ChristopherNeural", "hizli", "--motor", "piper"]);
  assert.equal(re.status, 2);
  assert.match(re.stderr, /Ses hızı geçersiz/);

  const f = yeniIs(PAR);
  const rf = calistir([f.ad, "--motor", "elevenlabs"]);
  assert.equal(rf.status, 2);
  assert.match(rf.stderr, /Bilinmeyen ses motoru/);

  const g = calistir(["..\\kotu"]);
  assert.equal(g.status, 2);
  assert.match(g.stderr, /Geçersiz iş adı/);
});

testF("CLI: gecersiz ses adi (Edge) ag kullanilmadan cikis 2 ve anlasilir mesaj verir", () => {
  const { ad, dizin } = yeniIs(PAR);
  const r = calistir([ad, "--ses", "kotu ses adi!", "--motor", "edge"]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /✗ Geçersiz ses adı: 'kotu ses adi!'/);
  assert.ok(!fs.existsSync(path.join(dizin, "Voice", "zamanlama.json")));
});

testF("CLI: acik motor hazir degilse (Azure anahtari yok) cikis 2 ve cozum onerisi", () => {
  const { ad } = yeniIs(PAR);
  const r = calistir([ad, "--motor", "azure"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /'azure' ses motoru kullanılamıyor: AZURE_SPEECH_KEY/);
});

testF("CLI: paragraf seslendirilemezse cikis 4 ve '✗ Paragraf N seslendirilemedi' (sessizce atlanmaz)", () => {
  // PIPER_HATA: sahte piper exit 3 verir -> gecici hata sayilir, denemeler tukenir.
  // Bekleme sureleri ortak ayarla degistirilemedigi icin cekirdek dogrudan hizli ayarla cagrilir.
  const { ad } = yeniIs(["PIPER_HATA bu paragraf hep basarisiz olur."]);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ["-e", `
    process.env.OTOMASYON_URETIM=${JSON.stringify(uretim.taban)};
    const S = require(${JSON.stringify(path.join(__dirname, "ses-sahte.js"))});
    const U = require(${JSON.stringify(path.join(S.KOK, "lib", "ses-uret.js"))});
    const ortak = require(${JSON.stringify(path.join(S.KOK, "lib", "ortak.js"))});
    U.seslendir({dizin: ortak.isDizin(${JSON.stringify(ad)}), ses:"en-US-ChristopherNeural", hiz:"+0%", dil:"en", motorSecimi:"piper", okunus:{},
      env: a=>({PIPER_YOL:${JSON.stringify(SAHTE_PIPER)},PIPER_MODEL:${JSON.stringify(SAHTE_MODEL)}})[a]||"", ayar: S.hizliAyar({denemeSayisi:2}), log(){}, uyari(){}, ilerleme(){}})
      .catch(ortak.bitir);
  `], { env: env(), encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /✗ Paragraf 1 seslendirilemedi/);
  assert.ok(Date.now() - t0 < 30000);
});

testF("DURDUR simulasyonu: surec ortasinda oldurulur -> eski ses bozulmaz, sonraki kosu temiz devam eder", async () => {
  const par = Array.from({ length: 10 }, (_, i) => "Paragraph number " + (i + 1) + " says something short.");
  const { ad, dizin } = yeniIs(par);
  // ilk saglam kosu (eski ses)
  assert.equal(calistir([ad, "--motor", "piper"]).status, 0);
  const eskiZam = fs.readFileSync(path.join(dizin, "Voice", "zamanlama.json"), "utf8");
  const eskiParcalar = fs.readdirSync(path.join(dizin, "Voice", "parts")).sort();

  // metni degistir ve yavas motorla baslat; ortasinda sert oldur (taskkill /F benzeri)
  fs.writeFileSync(path.join(dizin, "Voice", "SESLENDIRME-TAM-METIN.txt"), par.map(p => p.replace("says", "tells")).join("\n\n"));
  const cocuk = spawn(process.execPath, [SESLENDIR, ad, "--motor", "piper"], { env: env({ SAHTE_PIPER_GECIKME_MS: "400" }), stdio: ["ignore", "pipe", "pipe"] });
  const sinir = Date.now() + 90000;            // makine yukluyse bile sonsuza dek beklemesin
  await new Promise(coz => {
    const bekle = setInterval(() => {
      const meta = path.join(dizin, "Voice", "parts.tmp", "_meta");
      const yeterli = fs.existsSync(meta) && fs.readdirSync(meta).filter(f => /\.json$/.test(f)).length >= 3;
      if (yeterli || Date.now() > sinir) { clearInterval(bekle); coz(); }
    }, 50);
  });
  cocuk.kill("SIGKILL");
  await new Promise(coz => cocuk.on("exit", coz));

  assert.equal(fs.readFileSync(path.join(dizin, "Voice", "zamanlama.json"), "utf8"), eskiZam, "olunce eski zamanlama korunur");
  assert.deepEqual(fs.readdirSync(path.join(dizin, "Voice", "parts")).sort(), eskiParcalar, "eski parts degismez");
  assert.ok(fs.existsSync(path.join(dizin, "Voice", "parts.tmp")), "yarim is tmp'de kalir");

  // yeniden calistir: bayat kilit temizlenir, yarim isten devam eder, sonuc temiz
  const r = calistir([ad, "--motor", "piper"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /\d+ paragraf önceki koşudan alındı/);
  const z = JSON.parse(fs.readFileSync(path.join(dizin, "Voice", "zamanlama.json"), "utf8"));
  assert.equal(z.paragrafSayisi, 10);
  assert.notEqual(fs.readFileSync(path.join(dizin, "Voice", "zamanlama.json"), "utf8"), eskiZam);
  assert.ok(!fs.existsSync(path.join(dizin, "Voice", "parts.tmp")));
  assert.deepEqual(fs.readdirSync(path.join(dizin, "Voice", "parts")).filter(f => !/^\d{3}\.mp3$/.test(f)), [], "parts'ta yalniz NNN.mp3 olmali");
});

testF("CLI: ayni is zaten calisiyorsa (canli kilit) cikis 6", async () => {
  const { ad, dizin } = yeniIs(PAR);
  const uyuyan = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 30000)"], { stdio: "ignore" });
  try {
    fs.writeFileSync(path.join(dizin, ".kilit"), JSON.stringify({ pid: uyuyan.pid, baslangic: new Date().toISOString(), komut: "baska" }));
    const r = calistir([ad, "--motor", "piper"]);
    assert.equal(r.status, 6);
    assert.match(r.stderr, /✗ Bu iş zaten çalışıyor/);
    assert.ok(!fs.existsSync(path.join(dizin, "Voice", "zamanlama.json")));
  } finally { uyuyan.kill(); }
});
