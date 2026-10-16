// Gruplar arasi sozlesme testi: GERCEK gorsel-bul (sahte internet) + GERCEK seslendir (sahte Edge) -> GERCEK video-yap.
// Hicbiri elle yazilmis fikstur kullanmaz: Visuals/manifest.json'u gorsel-bul, Voice/zamanlama.json + kelimeler.json'u
// seslendir yazar; video-yap bunlari okur. Boylece "yazan grup ile okuyan grup ayni bicimi mi konusuyor" olculur.
// Ag sahte, ses/gorsel sentetik (ffmpeg lavfi), ucretli servis yok, gercek .env/ayar dosyasina dokunulmaz.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const yardim = require("./gorsel-yardim.js");          // ortami uretim/_test-gorsel-<pid>'e yalitlar
const sesYardim = require("./ses-sahte.js");
const fik = require("./render-fikstur.js");
const ortak = require("../lib/ortak.js");
const ag = require("../lib/gorsel-ag.js");
const { calistir: gorselBul } = require("../lib/gorsel-akis.js");
const { seslendir } = require("../lib/ses-uret.js");

const atla = (!yardim.ffmpegVarMi() || !sesYardim.ffmpegVar) && "ffmpeg yok";
test.after(() => yardim.temizle());

// ------------------------------------------------------------------ sahte internet (yalniz Wikimedia)
let _tohum = 5000;
function sahteAg(katalog) {
  const resimler = new Map();
  const json = async url => {
    const u = new URL(url);
    if (u.hostname === "commons.wikimedia.org") return { query: { pages: katalog(u.searchParams.get("gsrsearch").replace(/ filetype:bitmap$/, ""), resimler) } };
    if (["api.openverse.org", "api.pexels.com", "pixabay.com", "images-api.nasa.gov"].includes(u.hostname)) return u.hostname === "api.openverse.org" ? { results: [] } : u.hostname === "images-api.nasa.gov" ? { collection: { items: [] } } : {};
    throw new ag.AgHatasi("beklenmeyen adres: " + u.hostname, "adres");
  };
  const gorsel = async url => { const r = resimler.get(url); if (!r) throw new ag.AgHatasi("HTTP 404", 404); return { govde: r, durum: 200, basliklar: {} }; };
  const getir = async url => ({ govde: Buffer.from(JSON.stringify(await json(url))) });
  getir.json = json; getir.gorsel = gorsel;
  return { getir, resimler };
}
function wiki(resimler, ad, o) {
  o = o || {};
  const thumb = "https://upload.test/thumb/" + encodeURIComponent(ad) + ".jpg";
  resimler.set(thumb, yardim.tekil(yardim.gorselUret("jpg", 1920, 1080), ++_tohum));
  return { pageid: ++_tohum, title: "File:" + ad + ".jpg", index: 0,
    imageinfo: [{ thumburl: thumb, url: "https://upload.test/orig/" + encodeURIComponent(ad) + ".jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(ad),
      width: 3000, height: 2000, thumbwidth: 1920, thumbheight: 1280, mime: "image/jpeg",
      extmetadata: { LicenseShortName: { value: o.lisans || "CC BY 4.0" }, Artist: { value: o.yazar || "Test Yazar" }, ImageDescription: { value: o.aciklama || "" } } }] };
}
const katalog = (q, resimler) => ["one", "two", "three", "four"].map((s, i) => Object.assign(wiki(resimler, q + " " + s, { aciklama: q, lisans: "CC BY 4.0", yazar: "Yazar " + i }), { index: i + 1 }));

const PARAGRAFLAR = [
  "The bear wakes up slowly as the first light reaches the cold river valley.",
  "Nearby a wolf pack moves between the trees and watches every shadow carefully.",
  "A fox crosses the frozen field and stops to listen for any small sound.",
  "Dr. Smith counted one hundred and twenty three animals in the whole valley.",
  "The river keeps flowing while the seasons turn and the snow slowly melts.",
  "At the end of the day the valley falls quiet and the stars come out again.",
];

const IS = "zincir-test";
const isYol = (...p) => path.join(process.env.OTOMASYON_URETIM, IS, ...p);
const json = (...p) => JSON.parse(fs.readFileSync(isYol(...p), "utf8"));
const NEFES = [];

test("gorsel-bul -> seslendir -> video-yap: manifest ve zamanlama.json gercekten okunur, sahne esleme/atif/altyazi/kapak/yayin paketi tutarli", { skip: atla, timeout: 400000 }, async () => {
  yardim.isKur(IS, { senaryo: PARAGRAFLAR.join("\n\n") + "\n", konu: { surum: 1, baslik_en: "Zincir Testi", kanal: "TEST KANAL", slogan: "slogan", format: "long", dil: "en",
    geriSayim: 0, intro: 1.5, konuKarti: 0, outro: 3, gecisSure: 0.4, cesitlilik: false, muzikSeviyesi: 0.4,
    sahneKelimeleri: [["bear"], ["wolf"], ["fox"], ["scientist"], ["river"], ["stars"]] } });

  // 1) GORSEL (gercek akis, sahte internet)
  const a = sahteAg(katalog);
  const g = await gorselBul({ is: IS }, { getir: a.getir, bekle: yardim.uyku0, bekleKaynak: yardim.uyku0, aralik: {}, indirmeAra: 0, anahtarlar: { pexels: "", pixabay: "" }, log: () => {}, uyari: m => NEFES.push(m) });
  assert.ok(g.sonuc.gorsel >= 6, "gorsel bulundu: " + JSON.stringify(g.sonuc));
  const man = json("Visuals", "manifest.json");
  assert.deepEqual([].concat(...man.sahneler.map(s => s.paragraflar)), [0, 1, 2, 3, 4, 5], "manifest her paragrafi tam bir sahneye yerlestirir");

  // 2) SES (gercek cekirdek, sahte Edge)
  const sahte = sesYardim.sahteEdge();
  const ses = await seslendir({ dizin: isYol(), ses: "en-US-ChristopherNeural", hiz: "+7%", dil: "en", motorSecimi: "edge", okunus: {}, hedefSn: 23,
    env: () => "", enjekte: { msedge: sahte }, ayar: sesYardim.hizliAyar(), log: () => {}, uyari: m => NEFES.push(m), ilerleme: () => {} });
  assert.equal(ses.atlandi, false);
  const zam = json("Voice", "zamanlama.json");
  assert.equal(zam.paragrafSayisi, 6);
  assert.equal(zam.metinOzeti, ortak.paragrafOzeti(PARAGRAFLAR));
  assert.equal(zam.bosluk, 0.35);

  // 3) VIDEO (gercek video-yap, alt surec; cozunurluk 1/4)
  const r = await fik.betikCalistir("video-yap.js", [IS], { env: { RENDER_OLCEK: "0.25" } });
  assert.equal(r.kod, 0, "video-yap cikis kodu: " + r.stderr + r.stdout.slice(-1500));
  assert.match(r.stdout, new RegExp("SAHNE: " + man.sahneler.length + " sahne"), "manifest modu kullanildi (eski yola dusmedi)");
  assert.ok(!/manifest\.json (yok|geçersiz|okunamadı)|paragraf bölümlemesi senaryoyla uyuşmuyor/.test(r.stdout), "manifest uyarisi yok:\n" + r.stdout);
  assert.ok(!/zamanlama\.json yok \(eski iş\)/.test(r.stdout), "zamanlama.json okundu (eski yola dusmedi)");

  const mp4 = isYol("Videos", IS + ".mp4");
  assert.ok(fs.existsSync(mp4));
  assert.equal(fs.readdirSync(isYol("Videos")).filter(x => /\.part/.test(x)).length, 0, ".part kalmamali");
  const sonuc = json("render-sonuc.json");
  const sureMp4 = fik.sureOlc(mp4);
  assert.ok(Math.abs(sonuc.sureSn - sureMp4) < 0.1, "render-sonuc sure = gercek sure");
  assert.equal(sonuc.boyutBayt, fs.statSync(mp4).size);

  // zaman cizelgesi: anlatim bodyStart'ta baslar ve zamanlama.json'daki sure kadar surer
  assert.ok(Math.abs(sonuc.anlatimBaslangicSn - (1.5 - 0.4)) < 0.1, "anlatim intro bindirmesinden sonra baslar: " + sonuc.anlatimBaslangicSn);
  assert.ok(Math.abs((sonuc.anlatimBitisSn - sonuc.anlatimBaslangicSn) - zam.toplamSn) < 0.1, "anlatim suresi zamanlama.json ile ayni");
  assert.equal(sonuc.paragrafBaslangic.length, 6);
  zam.paragraflar.forEach((p, i) => assert.ok(Math.abs(sonuc.paragrafBaslangic[i] - (sonuc.anlatimBaslangicSn + p.baslangicSn)) < 0.05, "paragraf " + i + " baslangici"));
  assert.ok(sureMp4 >= sonuc.anlatimBitisSn + 3 - 0.2, "son sozden sonra outro kadar video var");

  // altyazi: kelimeler.json'dan, video suresini asmaz
  const srt = fs.readFileSync(isYol("altyazi.srt"), "utf8");
  assert.ok(srt.trim().split(/\n\n/).length >= 6, "en az paragraf sayisi kadar altyazi");
  assert.ok(fs.existsSync(isYol("Videos", IS + ".srt")));

  // yayin paketi: atiflar MANIFESTTEN, ATIF.txt ile ayni satirlar
  const yayin = json("yayin.json");
  const atifSatirlari = fs.readFileSync(isYol("ATIF.txt"), "utf8").trim().split("\n").slice(1);
  assert.ok(atifSatirlari.length > 0, "CC BY gorsel var: ATIF.txt dolu");
  assert.deepEqual(yayin.atiflar.map(x => x.atifMetni).sort(), atifSatirlari.slice().sort(), "yayin.json atiflari ile ATIF.txt ayni");
  assert.equal(yayin.uyum.atifGerekli, true);
  assert.ok(fs.existsSync(isYol("Videos", IS + "-kapak.jpg")), "kapak uretildi");
  assert.ok(fs.existsSync(isYol("YAYIN-PAKETI.md")));

  // ikinci kosu: hicbir sey degismedi -> atlanir
  const r2 = await fik.betikCalistir("video-yap.js", [IS], { env: { RENDER_OLCEK: "0.25" } });
  assert.equal(r2.kod, 0);
  assert.match(r2.stdout, /@@SONUC \{"atlandi":true/);

  // 4) MANIFEST DISI GORSELLER (elle atilan + kart klasoru): sessizce atlanmaz, videoya girer ve uyarilir
  const sahne3 = man.sahneler[2].klasor;
  const ornek = fs.readdirSync(isYol("Visuals", sahne3)).find(x => /\.jpe?g$/i.test(x));
  fs.copyFileSync(isYol("Visuals", sahne3, ornek), isYol("Visuals", sahne3, "90-formul-elle.jpg"));
  fs.mkdirSync(isYol("Visuals", "90-promptlar"), { recursive: true });
  fs.copyFileSync(isYol("Visuals", sahne3, ornek), isYol("Visuals", "90-promptlar", "95-prompt-01.jpg"));
  const r3 = await fik.betikCalistir("video-yap.js", [IS], { env: { RENDER_OLCEK: "0.25" } });
  assert.equal(r3.kod, 0, r3.stderr + r3.stdout.slice(-1200));
  assert.ok(!/@@SONUC \{"atlandi":true/.test(r3.stdout), "gorsel degisti: yeniden kurulmali");
  assert.match(r3.stdout, new RegExp("Sahne 3 \\(" + sahne3 + "\\): manifestte kayıtlı olmayan 1 görsel"));
  assert.match(r3.stdout, new RegExp("Visuals/90-promptlar manifestte sahne değil: 1 görsel Sahne " + man.sahneler.length));
  const sonuc3 = json("render-sonuc.json");
  assert.ok(sonuc3.imza !== sonuc.imza);
  assert.ok(sonuc3.uyarilar.some(u => /90-promptlar/.test(u)));
});
