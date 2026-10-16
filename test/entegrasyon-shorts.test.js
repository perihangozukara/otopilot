// Panelin "Videodan Shorts cikar" zinciri GERCEK betiklerle: panelin gonderdigi bicimde kesit-bul.cjs --otomatik, sonra shorts-kes.cjs.
// Girdi: Voice/zamanlama.json (fikstur) + render-sonuc.json (video-yap'in yazdigi alanlarla) + sentetik uzun mp4 (ffmpeg lavfi).
// Gercek video-yap bu testin konusu degil (entegrasyon-zincir.test.js onu gercek ciktilarla dener); burada sorulan:
// panelin komut dizisi (lib/panel-komutlar.js) betiklerin kabul ettigi argumanlarla birebir uyusuyor mu ve cikti dikey mi.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const fik = require("./render-fikstur.js");
const komutlar = require("../lib/panel-komutlar.js");

const atla = !fik.ffmpegVarMi() && "ffmpeg yok";
const kok = fik.ortamKur();
test.after(() => fik.temizle(kok));

test("panel shortsKes komutlari (kesit-bul.cjs --otomatik + shorts-kes.cjs) uzun videoda 9:16 kesitler uretir", { skip: atla, timeout: 300000 }, async () => {
  const k = fik.isKur(kok, { ad: "shorts-zinciri", paragraf: 60, sahneBasina: 6, gorselBasina: 1, ton: true, genislik: 640, yukseklik: 360,
    konu: { intro: 1, outro: 2, geriSayim: 0, konuKarti: 0 } });
  const ad = k.ad, dizin = path.join(kok, ad);
  const toplam = Math.ceil(k.toplam + 3);
  // uzun video (gercek video-yap ciktisi gibi: ses akisli); render-sonuc.json'daki alanlar video-yap'in yazdiklariyla ayni
  fs.mkdirSync(path.join(dizin, "Videos"), { recursive: true });
  fik.ff(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=10:d=" + toplam, "-f", "lavfi", "-i", "sine=frequency=300:duration=" + toplam,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dizin, "Videos", ad + ".mp4")]);
  const bodyStart = 0.6;
  const zam = JSON.parse(fs.readFileSync(path.join(dizin, "Voice", "zamanlama.json"), "utf8"));
  fs.writeFileSync(path.join(dizin, "render-sonuc.json"), JSON.stringify({ surum: 1, is: ad, video: "Videos/" + ad + ".mp4", sureSn: toplam,
    anlatimBaslangicSn: bodyStart, anlatimBitisSn: bodyStart + zam.toplamSn, paragrafBaslangic: zam.paragraflar.map(p => Math.round((bodyStart + p.baslangicSn) * 1000) / 1000) }, null, 2));

  // panelin urettigi komut dizisinin kendisi calistirilir: arguman uyumu burada olculur
  const adim = komutlar.tekTur("shortsKes", { is: ad, adet: 3 }, { ayar: {}, uretim: kok, anahtarVar: () => false, senaryoVar: () => true, konuHam: () => ({}) })[0];
  assert.deepEqual(adim.komutlar.map(c => c.betik), ["kesit-bul.cjs", "shorts-kes.cjs"]);
  for (const c of adim.komutlar) {
    const r = await fik.betikCalistir(c.betik, c.argv);
    assert.equal(r.kod, 0, c.betik + " " + c.argv.join(" ") + "\n" + r.stderr + r.stdout.slice(-1500));
  }
  const kesitler = JSON.parse(fs.readFileSync(path.join(dizin, "kesitler.json"), "utf8"));
  assert.equal(kesitler.length, 3);
  const dosyalar = fs.readdirSync(path.join(dizin, "Shorts")).filter(x => x.endsWith(".mp4") && !/\.part/.test(x));
  assert.equal(dosyalar.length, 3, "uc kesit uretildi: " + dosyalar);
  kesitler.forEach(s => {
    assert.ok(s.bas >= bodyStart - 0.3, "kesit anlatimdan en fazla 0,25 sn onceden baslar (yumusak giris): " + s.bas);
    assert.ok(s.bas + s.sure <= toplam + 0.01, "kesit videoyu asmaz");
    assert.ok(s.sure >= 25 && s.sure <= 55.5, "sure min-max araliginda: " + s.sure);
  });
  for (const d of dosyalar) {
    const bilgi = execFileSync(fik.FP(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path.join(dizin, "Shorts", d)], { windowsHide: true }).toString().trim();
    assert.equal(bilgi, "1080,1920", d + " dikey olmali");
  }
  // panel ayni klasoru listeler
  const { shortsListesi } = require("../lib/panel-isler.js");
  assert.deepEqual(shortsListesi(ad).map(x => x.ad), dosyalar.sort());
});
