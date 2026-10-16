// lib/panel-toplu.js — toplu uretimin alt surec izleyicisi (B009): cikti gelmeyen (takilmis) cocuk oldurulur, is "HATA-<asama>" sayilir,
// seri sonraki ise gecer. Normal yol bozulmamali. Sahte betikler + sentetik ffmpeg videosu; ag/ucretli servis yok.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const toplu = require("../lib/panel-toplu");

const ffmpegVar = (() => { try { return spawnSync("ffmpeg", ["-version"], { timeout: 8000 }).status === 0; } catch (e) { return false; } })();
const canliMi = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const bekle = ms => new Promise(r => setTimeout(r, ms));

// slug "takili" ile baslayan isin seslendirmesi sessizce askida kalir (pid dosyaya yazilir); digerleri hizla biter.
const SAHTE = {
  "seslendir.js": `
const fs=require("fs"),path=require("path");
const slug=process.argv[2], U=process.env.OTOMASYON_URETIM;
if(/^takili/.test(slug)){ fs.writeFileSync(path.join(U,slug,"pid.txt"),String(process.pid)); console.log("basladi"); setInterval(()=>{},1000); }
else { console.log("@@SONUC {\\"tamam\\":true}"); }
`,
  "gorsel-bul.js": `
const fs=require("fs"),path=require("path");
const slug=process.argv[2], U=process.env.OTOMASYON_URETIM;
const d=path.join(U,slug,"Visuals","001-a"); fs.mkdirSync(d,{recursive:true});
for(let i=1;i<=6;i++) fs.writeFileSync(path.join(d,"0"+i+".jpg"),"x");
`,
  "video-yap.js": `
const fs=require("fs"),path=require("path"),{spawnSync}=require("child_process");
const slug=process.argv[2], U=process.env.OTOMASYON_URETIM;
const v=path.join(U,slug,"Videos"); fs.mkdirSync(v,{recursive:true});
const r=spawnSync("ffmpeg",["-y","-loglevel","error","-f","lavfi","-i","color=c=black:s=64x64:d=1:r=10","-pix_fmt","yuv420p",path.join(v,slug+".mp4")]);
process.exit(r.status===0?0:1);
`,
};
function ortamKur() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "panel-toplu-"));
  const betik = path.join(d, "betikler"), uretim = path.join(d, "uretim");
  fs.mkdirSync(betik, { recursive: true }); fs.mkdirSync(uretim, { recursive: true });
  for (const [ad, kod] of Object.entries(SAHTE)) fs.writeFileSync(path.join(betik, ad), kod);
  const onceki = ["OTOMASYON_URETIM", "OTOMASYON_AYAR_DOSYASI", "OTOMASYON_ENV_DOSYASI"].map(k => [k, process.env[k]]);
  process.env.OTOMASYON_URETIM = uretim;
  process.env.OTOMASYON_AYAR_DOSYASI = path.join(d, "panel-ayar.json");
  process.env.OTOMASYON_ENV_DOSYASI = path.join(d, ".env");
  fs.writeFileSync(process.env.OTOMASYON_ENV_DOSYASI, "");
  return { d, betik, uretim, geri() {
    for (const [k, v] of onceki) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* gecici */ }
  } };
}
const manifestYaz = (o, slugs) => {
  const p = path.join(o.d, "manifest.json");
  fs.writeFileSync(p, JSON.stringify(slugs.map(s => ({ slug: s, baslik_en: s, paragraflar: ["Bu bir deneme paragrafidir ve yeterince uzun bir cumleden olusur."] }))));
  return p;
};

test("toplu: cikti gelmeyen (takilmis) alt surec bosta esiginde OLDURULUR, is HATA-ses sayilir, seri sonraki ise gecer", { skip: !ffmpegVar && "ffmpeg yok" }, async () => {
  const o = ortamKur();
  try {
    const log = [];
    const bas = Date.now();
    const r = await toplu.toplu({ profil: "short", manifest: manifestYaz(o, ["takili-bir", "saglam-iki"]), betikDizini: o.betik, uretim: o.uretim,
      cikti: m => log.push(m), bekleMs: 50, bostaOldurSn: 1, kontrolMs: 100 });
    assert.ok(Date.now() - bas < 25000, "seri sonsuza dek beklememeli");
    assert.equal(r.durum["takili-bir"], "HATA-ses", JSON.stringify(r.durum));
    assert.deepEqual(r.hata, ["takili-bir"]);
    assert.equal(r.durum["saglam-iki"], "BITTI", "sonraki is etkilenmemeli: " + JSON.stringify(r.durum));
    assert.deepEqual(r.bitenler, ["saglam-iki"]);
    assert.match(log.join("\n"), /çıktı yok|çıktı yok; takılmış/);
    // takilan cocuk gercekten oldu (yetim kalmadi)
    const pid = Number(fs.readFileSync(path.join(o.uretim, "takili-bir", "pid.txt"), "utf8"));
    for (let i = 0; i < 40 && canliMi(pid); i++) await bekle(100);
    assert.equal(canliMi(pid), false, "takilan alt surec oldurulmeli");
    // tam cikti gunluge yazildi
    const g = fs.readdirSync(o.uretim).find(x => /^_toplu-.*\.log$/.test(x));
    assert.ok(g && /takili-bir ses ÇIKTISI/.test(fs.readFileSync(path.join(o.uretim, g), "utf8")));
  } finally { o.geri(); }
});

test("toplu: normal yol bozulmadi — hizli biten isler seslendir → gorsel → video ile BITTI sayilir, sayac dogrulanmis videoyla artar", { skip: !ffmpegVar && "ffmpeg yok" }, async () => {
  const o = ortamKur();
  try {
    const r = await toplu.toplu({ profil: "short", manifest: manifestYaz(o, ["bir-a", "iki-b"]), betikDizini: o.betik, uretim: o.uretim, cikti: () => { }, bekleMs: 50 });
    assert.deepEqual(r.hata, []);
    assert.deepEqual(r.bitenler.sort(), ["bir-a", "iki-b"]);
    assert.equal(r.durum["bir-a"], "BITTI");
    assert.ok(fs.existsSync(path.join(o.uretim, "bir-a", "Videos", "bir-a.mp4")));
  } finally { o.geri(); }
});

test("toplu: gorsel-bul'un sessiz 429 beklemesi (GORSEL_LIMIT_BEKLE_SN) bosta esiginin altinda kalir — bekleyen cocuk 'takildi' sayilip oldurulmez", { skip: !ffmpegVar && "ffmpeg yok" }, async () => {
  // gorsel-bul 2 sn sessiz bekler; bosta esigi 1 sn ama GORSEL_LIMIT_BEKLE_SN=5 → esik 5+600 sn'ye cikar
  const o = ortamKur();
  const onceki = process.env.GORSEL_LIMIT_BEKLE_SN;
  process.env.GORSEL_LIMIT_BEKLE_SN = "5";
  try {
    fs.writeFileSync(path.join(o.betik, "gorsel-bul.js"), SAHTE["gorsel-bul.js"].replace('for(let i=1', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2000);for(let i=1'));
    const r = await toplu.toplu({ profil: "short", manifest: manifestYaz(o, ["sessiz-bekler"]), betikDizini: o.betik, uretim: o.uretim, cikti: () => { }, bekleMs: 50, bostaOldurSn: 1, kontrolMs: 100 });
    assert.deepEqual(r.hata, [], JSON.stringify(r.durum));
    assert.deepEqual(r.bitenler, ["sessiz-bekler"]);
  } finally {
    if (onceki === undefined) delete process.env.GORSEL_LIMIT_BEKLE_SN; else process.env.GORSEL_LIMIT_BEKLE_SN = onceki;
    o.geri();
  }
});
