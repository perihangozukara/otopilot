// GO — manifest, uzlastirma, arsiv, atif, silinenler (lib/gorsel-manifest.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const yardim = require("./gorsel-yardim.js");
const ortak = require("../lib/ortak.js");
const man = require("../lib/gorsel-manifest.js");
const { lisansCoz } = require("../lib/gorsel-lisans.js");
const dogrula = require("../lib/gorsel-dogrula.js");

const FFMPEG = yardim.ffmpegVarMi();
const atla = !FFMPEG && "ffmpeg yok";
test.after(() => yardim.temizle());
const isYol = (is, ...p) => path.join(process.env.OTOMASYON_URETIM, is, ...p);
let _t = 40000;
const jpg = () => yardim.tekil(yardim.gorselUret("jpg", 1920, 1080), ++_t);
const planGirdi = (is, kanonik, ek) => Object.assign({ is, kanonik, ozet: ortak.paragrafOzeti(kanonik), dil: "en", yon: "yatay", kisa: false, log: () => {}, uyari: () => {} }, ek || {});

function aday(kaynak, ad, lisansKod, ek) {
  const l = kaynak === "wikimedia" ? lisansCoz("wikimedia", { kisaAd: lisansKod }) : lisansCoz(kaynak);
  return Object.assign({ kaynak, baslik: ad, atif: "Yazar " + ad, kaynakUrl: "https://k.test/" + encodeURIComponent(ad), indirmeUrl: "https://i.test/" + ad + ".jpg" }, l, ek || {});
}

test("planYukle: yeni plan HER paragrafi kapsar; kapsama bozuksa/senaryo degistiyse arsivlenir; yeniden=temizden", { skip: atla }, () => {
  const is = "man-plan";
  const kanonik = ortak.paragraflaraBol(yardim.senaryoUret(5, 30));
  yardim.isKur(is, { senaryo: kanonik.join("\n\n") });
  const p1 = man.planYukle(planGirdi(is, kanonik));
  assert.equal(p1.taze, true);
  assert.deepEqual([].concat(...p1.manifest.sahneler.map(s => s.paragraflar)), [0, 1, 2, 3, 4]);
  assert.ok(man.kapsiyorMu(p1.manifest, 5)); assert.ok(!man.kapsiyorMu(p1.manifest, 6));
  // bir sahneye gorsel yaz
  const S = p1.manifest.sahneler[0];
  man.klasorAta(man.yollar(is), S, "Albert Einstein");
  const buf = jpg();
  man.gorselYaz(man.yollar(is), S, buf, dogrula.dogrula(buf), aday("pexels", "e1"));
  man.manifestYaz(is, p1.manifest);
  assert.equal(S.klasor, "001-albert-einstein");
  assert.equal(S.gorseller[0].dosya, "001-albert-einstein/01.jpg");
  // ayni senaryo: devam (arsiv yok)
  const p2 = man.planYukle(planGirdi(is, kanonik));
  assert.equal(p2.taze, false); assert.equal(p2.arsiv, null);
  assert.equal(p2.manifest.sahneler[0].gorseller.length, 1);
  // senaryo degisti
  const p3 = man.planYukle(planGirdi(is, kanonik.concat(["yeni paragraf"]).slice(0, 4)));
  assert.equal(p3.taze, true); assert.ok(p3.arsiv && p3.arsiv.tasinan >= 1);
  assert.ok(fs.existsSync(path.join(p3.arsiv.hedef, "001-albert-einstein", "01.jpg")), "gorsel arsive tasinmis");
  assert.ok(fs.existsSync(path.join(p3.arsiv.hedef, "manifest.json")));
  assert.ok(!fs.existsSync(isYol(is, "Visuals", "001-albert-einstein")));
  assert.equal(man.sahneKlasorleri(isYol(is, "Visuals")).length, 0, "arsiv klasorleri (_eski-*) sahne klasoru sayilmaz");
});

test("diskleUzlastir: dosyasi silinen kayit dusulur, kaydi olmayan dosya 'elle' kaydi alir (boyut/sha1 dosyadan)", { skip: atla }, () => {
  const is = "man-uzlas";
  const kanonik = ortak.paragraflaraBol(yardim.senaryoUret(3, 30));
  yardim.isKur(is, { senaryo: kanonik.join("\n\n") });
  const P = man.yollar(is);
  const pl = man.planYukle(planGirdi(is, kanonik));
  const S = pl.manifest.sahneler[0];
  man.klasorAta(P, S, "bear");
  for (const ad of ["a", "b"]) { const b = jpg(); man.gorselYaz(P, S, b, dogrula.dogrula(b), aday("pexels", ad)); }
  man.manifestYaz(is, pl.manifest);
  fs.unlinkSync(isYol(is, "Visuals", S.klasor, "01.jpg"));                          // kullanici elle sildi
  const elle = jpg(); fs.writeFileSync(isYol(is, "Visuals", S.klasor, "07.jpg"), elle);   // kullanici elle ekledi
  fs.writeFileSync(isYol(is, "Visuals", S.klasor, "not.txt"), "gorsel degil");
  fs.writeFileSync(isYol(is, "Visuals", S.klasor, "02.jpg.123.tmp"), "yarim");
  const p2 = man.planYukle(planGirdi(is, kanonik));
  const s = p2.manifest.sahneler[0];
  assert.deepEqual(s.gorseller.map(g => path.basename(g.dosya)), ["02.jpg", "07.jpg"], "sayisal sira");
  const g7 = s.gorseller[1];
  assert.equal(g7.kaynak, "elle"); assert.equal(g7.lisansKodu, "bilinmiyor"); assert.deepEqual([g7.en, g7.boy], [1920, 1080]);
  assert.equal(g7.sha1, dogrula.dogrula(elle).sha1); assert.equal(g7.atifGerekli, false);
  assert.equal(man.sonrakiNo(isYol(is, "Visuals", S.klasor)), 8);
});

test("manifestOku: bozuk JSON yedeklenip yeniden kurulur; ust surum geri dusus; guvenli olmayan klasor adi sifirlanir", { skip: atla }, () => {
  const is = "man-bozuk";
  const kanonik = ortak.paragraflaraBol(yardim.senaryoUret(2, 30));
  yardim.isKur(is, { senaryo: kanonik.join("\n\n") });
  fs.mkdirSync(isYol(is, "Visuals"), { recursive: true });
  fs.writeFileSync(isYol(is, "Visuals", "manifest.json"), '{ "surum": 1, "sahneler": [ ');
  const uy = [];
  assert.equal(man.manifestOku(is, m => uy.push(m)), null);
  assert.ok(uy.some(m => /bozuktu/.test(m)));
  assert.ok(fs.readdirSync(isYol(is, "Visuals")).some(x => /^manifest\.bozuk-/.test(x)));
  assert.ok(!fs.existsSync(isYol(is, "Visuals", "manifest.json")));

  fs.writeFileSync(isYol(is, "Visuals", "manifest.json"), JSON.stringify({ surum: 99, sahneler: [] }));
  assert.equal(man.manifestOku(is, m => uy.push(m)), null);
  assert.ok(uy.some(m => /üst sürümde/.test(m)));

  fs.writeFileSync(isYol(is, "Visuals", "manifest.json"), JSON.stringify({ surum: 1, sahneler: [{ no: 1, klasor: "../../kacis", paragraflar: [0], gorseller: [{ dosya: "../x.jpg" }] }, { no: 2, klasor: "002-iyi", paragraflar: [1] }] }));
  const m = man.manifestOku(is);
  assert.equal(m.sahneler[0].klasor, ""); assert.deepEqual(m.sahneler[0].gorseller, []);
  assert.equal(m.sahneler[1].klasor, "002-iyi"); assert.deepEqual(m.sahneler[1].gorseller, []); assert.deepEqual(m.sahneler[1].aramalar, []);
});

test("arsiv: ayni saniyede iki arsiv birbirine karismaz; arsivler KENDILIGINDEN SILINMEZ (birikince uyari); arsivleriTemizle acik onayla son 2'yi birakir", () => {
  const is = "man-arsiv";
  yardim.isKur(is, {});
  const VIS = isYol(is, "Visuals");
  const sahne = i => { fs.mkdirSync(path.join(VIS, "001-x"), { recursive: true }); fs.writeFileSync(path.join(VIS, "001-x", "01.jpg"), "v" + i); };
  const hedefler = [], uyarilar = [];
  for (let i = 0; i < 4; i++) { sahne(i); const r = man.eskiyeTasi(VIS, "20261005-120000", m => uyarilar.push(m)); hedefler.push(r.hedef); }
  assert.equal(new Set(hedefler).size, 4, "ayni saniyedeki arsivler ayri klasor");
  const arsivler = () => fs.readdirSync(VIS).filter(x => /^_eski-/.test(x)).map(x => path.join(VIS, x)).sort();
  assert.equal(arsivler().length, 4, "hicbir arsiv kendiliginden silinmemeli");
  for (let i = 0; i < 4; i++) assert.equal(fs.readFileSync(path.join(hedefler[i], "001-x", "01.jpg"), "utf8"), "v" + i);
  // 3'ten fazla arsiv birikince UYARI verilir (silme yok)
  assert.equal(uyarilar.length, 1, "yalniz 4. arsivde uyari: " + uyarilar.join("|"));
  assert.match(uyarilar[0], /4 eski arşiv birikti.*otomatik silinmez.*--arsiv-temizle/);
  // acik onay: en yeni 2 kalir, silinenler silmeden ONCE uyariyla bildirilir
  const u2 = [];
  const silinen = man.arsivleriTemizle(VIS, m => u2.push(m));
  assert.equal(silinen.length, 2);
  assert.equal(u2.length, 2); assert.ok(u2.every(m => /siliniyor/.test(m)));
  const kalan = arsivler();
  assert.equal(kalan.length, 2, "yalniz son 2 arsiv");
  assert.ok(kalan.includes(hedefler[3]), "en yeni arsiv silinmemeli");
  assert.ok(kalan.includes(hedefler[2]), "bir onceki arsiv tutulmali");
  assert.deepEqual(man.arsivleriTemizle(VIS), [], "ikinci temizlik bir sey silmez");
});

test("atif: yalniz CC BY/BY-SA/Pexels (+ lisansi tanimsiz Commons), kaynakUrl'e gore tekil, tirnak/satir sonu temizlenir; bos ise dosya silinir", () => {
  const is = "man-atif";
  yardim.isKur(is, {});
  const M = { sahneler: [
    { gorseller: [aday("wikimedia", 'Bir "alintili" baslik\nikinci satir', "CC BY 4.0"), aday("wikimedia", "PD gorsel", "Public domain"), aday("pexels", "kahve")] },
    { gorseller: [aday("wikimedia", 'Bir "alintili" baslik\nikinci satir', "CC BY 4.0"), aday("nasa", "galaksi"), aday("wikimedia", "SA gorsel", "CC BY-SA 3.0"), aday("pixabay", "kedi")] },
  ] };
  const satirlar = man.atifSatirlari(M);
  assert.equal(satirlar.length, 3, "tekil BY + Pexels + BY-SA: " + satirlar.join("|"));
  assert.ok(satirlar.every(s => !/\n/.test(s)));
  assert.match(satirlar[0], /^"Bir 'alintili' baslik ikinci satir" — Yazar .+ — CC BY 4\.0 — https:\/\/k\.test\//);
  assert.equal(man.atifYaz(is, M), 3);
  const metin = fs.readFileSync(isYol(is, "ATIF.txt"), "utf8");
  assert.ok(metin.startsWith("Görsel kaynakları / Image credits:\n"));
  assert.equal(man.atifYaz(is, { sahneler: [{ gorseller: [aday("nasa", "x"), aday("pixabay", "y")] }] }), 0);
  assert.ok(!fs.existsSync(isYol(is, "ATIF.txt")), "atif gerekmiyorsa dosya kalmaz");
});

test("silinenleriOku: URL ve sha1 kumeleri; bozuk dosya uyari verip bos doner; yoksa bos", () => {
  const is = "man-silinen";
  yardim.isKur(is, {});
  assert.equal(man.silinenleriOku(is).url.size, 0);
  fs.writeFileSync(isYol(is, "silinenler.json"), JSON.stringify({ surum: 1, silinenler: [{ sahne: "001-x", ad: "01.jpg", kaynakUrl: "https://K.test/A/?x=1", sha1: "ABCDEF", zaman: "z" }, null, { kaynakUrl: "" }] }));
  const s = man.silinenleriOku(is);
  assert.ok(s.url.has("https://k.test/a")); assert.ok(s.sha1.has("abcdef"));
  fs.writeFileSync(isYol(is, "silinenler.json"), "{ bozuk");
  const uy = [];
  const b = man.silinenleriOku(is, m => uy.push(m));
  assert.equal(b.url.size, 0); assert.ok(uy.length === 1);
});

test("aramalariOku: senaryo ozeti uyusmazsa null (+uyari); paragraf baslarina gore harita; uret istemi", () => {
  const is = "man-arama";
  const kanonik = ["birinci paragraf", "ikinci paragraf"];
  yardim.isKur(is, {});
  assert.equal(man.aramalariOku(is, ortak.paragrafOzeti(kanonik)), null, "dosya yok");
  fs.writeFileSync(isYol(is, "Voice", "gorsel-aramalari.json"), JSON.stringify({ surum: 1, kaynakSenaryoSha1: ortak.paragrafOzeti(kanonik), uretici: "claude",
    paragraflar: [{ no: 0, aramalar: [" bear ", "wolf", ""] }, { no: 1, aramalar: [], uret: " glowing orb " }, { no: "x" }] }));
  const h = man.aramalariOku(is, ortak.paragrafOzeti(kanonik));
  assert.deepEqual(h.get(0).aramalar, ["bear", "wolf"]); assert.equal(h.get(1).uret, "glowing orb"); assert.equal(h.size, 2);
  const uy = [];
  assert.equal(man.aramalariOku(is, "baska-ozet", m => uy.push(m)), null);
  assert.equal(uy.length, 1);
});
