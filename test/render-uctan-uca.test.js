// UCTAN UCA render dogrulamasinda bulunan hatalarin kalici regresyon testleri (gercek ffmpeg, sentetik is, ag yok, ucret yok):
//   * renk: ara dosyalar ve final BT.709 SINIRLI aralik yuv420p (JPEG kaynakli klip "yuvj420p/tam aralik" cikiyor, PNG kaynakli
//     kart etiketsiz kaliyor, xfade grubu yuv444p'ye gidiyordu)
//   * ara dosyanin ICI bozuk (ffprobe sureyi okur, kare verisi bozuk): is kendiliginden onarilir, elle _tmp silmek gerekmez
//   * videoya gomulen altyazida ters egik cizgi / <i> etiketi duz yazi olarak cizilir (libass'ta ozel anlam tasiyordu);
//     kullaniciya giden altyazi.srt temiz kalir
//   * is kokundeki olu surece ait yarim atomik yazma (<dosya>.<pid>.tmp) temizlenir
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const fik = require("./render-fikstur");
const kok = fik.ortamKur();
const skip = !fik.ffmpegVarMi() && "ffmpeg yok";

test.after(() => fik.temizle(kok));

const oku = (j, ...p) => JSON.parse(fs.readFileSync(path.join(j.dizin, ...p), "utf8"));
const probe = f => {
  const j = JSON.parse(execFileSync(fik.FP(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt,color_range,color_space,color_primaries,color_transfer", "-of", "json", f], { windowsHide: true }).toString());
  return j.streams[0];
};
const CPU = { VIDEO_KODEK: "cpu" };         // testler GPU baskisindan (baska surecler) etkilenmesin

test("renk: klipler, gruplar, kartlar ve final yuv420p / BT.709 / SINIRLI aralik (JPEG ve PNG kaynak birlikte)", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "u1", paragraf: 4, sahneBasina: 2, gorselBasina: 2, konu: { intro: 1, outro: 2, gecisSure: 0.4, muzikSeviyesi: 0 } });
  // bir gorselin ICERIGINI PNG yap (uzanti .jpg kalir; dogrulama imza/ffprobe ile): ayni videoda JPEG + PNG kaynak
  const jpg = path.join(j.dizin, "Visuals", "001-sahne", "01.jpg");
  fik.ff(["-i", jpg, "-c:v", "png", "-f", "image2", jpg + ".png"]);
  fs.renameSync(jpg + ".png", jpg);
  const r = await fik.betikCalistir("video-yap.js", ["u1", "--tut"], { env: CPU });
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const tmp = path.join(j.dizin, "_tmp");
  const ara = fs.readdirSync(tmp).filter(a => /\.mp4$/.test(a));
  assert.ok(ara.some(a => /^clip/.test(a)) && ara.some(a => /^grp/.test(a)) && ara.some(a => /^aa-intro/.test(a)) && ara.some(a => /^zz-outro/.test(a)), ara.join());
  for (const a of ara) {
    const p = probe(path.join(tmp, a));
    assert.deepEqual([p.pix_fmt, p.color_range, p.color_space, p.color_primaries, p.color_transfer], ["yuv420p", "tv", "bt709", "bt709", "bt709"], a + " " + JSON.stringify(p));
  }
  const f = probe(path.join(j.dizin, "Videos", "u1.mp4"));
  assert.deepEqual([f.pix_fmt, f.color_range, f.color_space], ["yuv420p", "tv", "bt709"], "final: " + JSON.stringify(f));
});

test("ara klibin ICI bozulursa (ffprobe gecerli sanir) is kendiliginden onarilir: uyari + exit 0", { skip, timeout: 300000 }, async () => {
  const j = fik.isKur(kok, { ad: "u2", paragraf: 4, sahneBasina: 2, gorselBasina: 2, konu: { intro: 1, outro: 2, gecisSure: 0.4, muzikSeviyesi: 0, gecis: "fade" } });
  let r = await fik.betikCalistir("video-yap.js", ["u2", "--tut"], { env: CPU });
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  const tmp = path.join(j.dizin, "_tmp");
  const klip = path.join(tmp, fs.readdirSync(tmp).filter(a => /^clip\d+-.*\.mp4$/.test(a)).sort()[1]);
  const orj = fs.readFileSync(klip);
  let bozuldu = false;
  for (const son of [0.8, 0.7, 0.6, 0.5, 0.4]) {         // moov saglam, kare verisi bozuk
    const b = Buffer.from(orj);
    require("crypto").randomFillSync(b, Math.floor(b.length * 0.04), Math.floor(b.length * son) - Math.floor(b.length * 0.04));
    fs.writeFileSync(klip, b);
    if (spawnSync(fik.FP(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", klip], { windowsHide: true }).status === 0) { bozuldu = true; break; }
  }
  assert.ok(bozuldu, "ffprobe'un okuyabildigi ama icerigi bozuk klip uretilemedi");
  const k = oku(j, "konu.json"); k.gecis = "wipeleft";    // gruplar yeniden kurulacak: bozuk klibi okuyacaklar
  fs.writeFileSync(path.join(j.dizin, "konu.json"), JSON.stringify(k, null, 2));
  r = await fik.betikCalistir("video-yap.js", ["u2", "--tut"], { env: CPU });
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /@@UYARI Ara dosya bozuk çıktı ve silindi: clip\d+-[0-9a-f]{8}\.mp4/);
  assert.ok(fik.sureOlc(path.join(j.dizin, "Videos", "u2.mp4")) > 5);
  const g = require("../lib/render-ffmpeg");
  assert.equal(await g.tamDogrula(path.join(tmp, fs.readdirSync(tmp).filter(a => /^clip\d+-.*\.mp4$/.test(a)).sort()[1])), true, "yeniden uretilen klip saglam");
});

test("libassKacis: ters egik cizgi ve <i> etiketi videoda DUZ YAZI olarak cizilir (gercek libass); kullanici SRT'si temiz", { skip }, () => {
  const AY = require("../lib/render-altyazi");
  const ham = "C:\\new\\folder\\Nsoft <i>x</i>";
  const kacis = AY.libassKacis(ham);
  assert.notEqual(kacis, ham);
  assert.equal(kacis.replace(/\u200b/g, ""), ham, "yalniz gorunmez karakter eklenir");
  assert.equal(AY.libassKacis("3 < 5 > 2 a\\b"), "3 < 5 > 2 a\\\u200bb", "'<' sonrasi bosluk/rakam: etiket degil, dokunulmaz");
  const d = path.join(kok, "libass"); fs.mkdirSync(d, { recursive: true });
  const satirSayisi = metin => {
    fs.writeFileSync(path.join(d, "t.srt"), "1\n00:00:00,000 --> 00:00:03,000\n" + metin + "\n");
    const b = execFileSync(fik.FF(), ["-v", "error", "-f", "lavfi", "-i", "color=c=0x303030:s=960x240:d=2", "-vf",
      "subtitles=t.srt:force_style='FontName=Arial,Fontsize=22,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,MarginV=40',format=gray",
      "-ss", "1", "-frames:v", "1", "-f", "rawvideo", "pipe:1"], { cwd: d, windowsHide: true, maxBuffer: 1 << 24 });
    // beyaz yazi iceren satir bantlari: ardisik satirlar bir "kume"
    let kume = 0, icinde = false;
    for (let y = 0; y < 240; y++) {
      let var_ = false;
      for (let x = 0; x < 960 && !var_; x++) if (b[y * 960 + x] > 200) var_ = true;
      if (var_ && !icinde) kume++;
      icinde = var_;
    }
    return kume;
  };
  // ham metinde \N yeni satir yaratir (2 satir), kacisli metin tek satir kalir
  assert.equal(satirSayisi(ham), 2, "kontrol: kacissiz metin libass'ta iki satira bolunuyor");
  assert.equal(satirSayisi(kacis), 1, "kacisli metin tek satir");
});

test("video-yap: gomulu altyazi kopyasi _tmp'de kacisli; altyazi.srt ve Videos/<is>.srt temiz; kokteki olu surec .tmp'si silinir", { skip }, async () => {
  const j = fik.isKur(kok, { ad: "u3", paragraf: 3, konu: { intro: 1, outro: 2, gecisSure: 0.4, muzikSeviyesi: 0 } });
  const metinYol = path.join(j.dizin, "Voice", "SESLENDIRME-TAM-METIN.txt");
  // metin degisirse zamanlama.json eskir: ozeti yeniden yaz
  const paragraflar = fs.readFileSync(metinYol, "utf8").trim().split(/\n\n/);
  paragraflar[0] += " Yol C:\\new\\folder ve <i>etiket</i> var.";
  fs.writeFileSync(metinYol, paragraflar.join("\n\n") + "\n");
  const z = oku(j, "Voice", "zamanlama.json"), ortak = require("../lib/ortak");
  z.metinOzeti = ortak.paragrafOzeti(paragraflar);
  fs.writeFileSync(path.join(j.dizin, "Voice", "zamanlama.json"), JSON.stringify(z, null, 2));
  const olu = path.join(j.dizin, "altyazi.srt.99999999.tmp");
  fs.writeFileSync(olu, "yarim kalan yazma");
  const r = await fik.betikCalistir("video-yap.js", ["u3", "--tut"], { env: CPU });
  assert.equal(r.kod, 0, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(olu), "olu surecin yarim .tmp dosyasi silinmeli");
  const temiz = fs.readFileSync(path.join(j.dizin, "altyazi.srt"), "utf8");
  assert.ok(temiz.includes("C:\\new\\folder") && temiz.includes("<i>etiket</i>") && !temiz.includes("\u200b"), "kullanici SRT'si ozgun/temiz");
  assert.equal(fs.readFileSync(path.join(j.dizin, "Videos", "u3.srt"), "utf8"), temiz);
  const gomme = fs.readFileSync(path.join(j.dizin, "_tmp", "altyazi-gomme.srt"), "utf8");
  assert.ok(gomme.includes("C:\\\u200bnew\\\u200bfolder") && gomme.includes("<\u200bi>etiket<\u200b/i>"), "gomulen kopya kacisli");
});

test("cok genis BUYUK HARFLI outro basligi karta sigar (sabit 0.55 orani tasiriyordu)", { skip, timeout: 180000 }, async () => {
  const j = fik.isKur(kok, { ad: "u4", paragraf: 2, konu: { intro: 0, outro: 3, gecisSure: 0.4, muzikSeviyesi: 0, outroMetni: { baslik: "ABONE OL VE BİLDİRİMLERİ AÇ", alt: "BİLDİRİMLERİ AÇMAYI UNUTMA LÜTFEN", altSlogan: "x" } } });
  {
    const A = require("../lib/render-ayar"), K = require("../lib/render-kartlar");
    const ayar = A.ayarCoz("u4", {});
    const tmp = path.join(j.dizin, "_tmp-kart"); fs.mkdirSync(tmp, { recursive: true });
    await K.outroUret(ayar, tmp, path.join(tmp, "outro.mp4"));
    // 1920 genislikte kenar sutunlari (ilk/son 4 px) bos kalmali: yazi karttan tasmiyor
    const b = execFileSync(fik.FF(), ["-v", "error", "-ss", "1.2", "-i", path.join(tmp, "outro.mp4"), "-frames:v", "1", "-vf", "format=gray", "-f", "rawvideo", "pipe:1"], { maxBuffer: 1 << 26, windowsHide: true });
    const W = 1920, H = 1080;
    let tasan = 0;
    for (let y = 0; y < H; y++) for (const x of [0, 1, 2, 3, W - 4, W - 3, W - 2, W - 1]) if (b[y * W + x] > 120) tasan++;
    assert.equal(tasan, 0, "yazi kart kenarina tasmis (" + tasan + " parlak piksel)");
  }
});
