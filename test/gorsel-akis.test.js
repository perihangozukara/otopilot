// GO — gorsel-bul cekirdegi (lib/gorsel-akis.js): SAHTE INTERNET uzerinde bastan sona.
// Gercek kaynak istemcileri (lisans suzgeci, puanlama, dogrulama, manifest, atif) calisir; yalniz ag sahtelenir.
// Sentetik gorseller ffmpeg lavfi ile uretilir. Gercek .env / ucretli servis / ag KULLANILMAZ.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const yardim = require("./gorsel-yardim.js");
const ortak = require("../lib/ortak.js");
const ag = require("../lib/gorsel-ag.js");
const man = require("../lib/gorsel-manifest.js");
const { calistir } = require("../lib/gorsel-akis.js");

const FFMPEG = yardim.ffmpegVarMi();
const atla = !FFMPEG && "ffmpeg yok";
test.after(() => yardim.temizle());

// ------------------------------------------------------------------ sahte internet
function sahteAg(kaynaklar) {
  const resimler = new Map();
  const sayac = { gorsel: 0, json: 0 };
  const sorgular = [];
  const istekler = [];
  const json = async (url) => {
    sayac.json++;
    istekler.push(url);
    const u = new URL(url);
    const p = u.searchParams;
    const al = (ad, q) => { sorgular.push([ad, q]); const v = kaynaklar[ad] ? kaynaklar[ad](q) : []; if (v instanceof Error) throw v; return v; };
    if (u.hostname === "commons.wikimedia.org") return { query: { pages: al("wikimedia", p.get("gsrsearch").replace(/ filetype:bitmap$/, "")) } };
    if (u.hostname === "api.openverse.org") return { results: al("openverse", p.get("q")) };
    if (u.hostname === "api.pexels.com") return { photos: al("pexels", p.get("query")) };
    if (u.hostname === "pixabay.com") return { hits: al("pixabay", p.get("q")) };
    if (u.hostname === "images-api.nasa.gov") return { collection: { items: al("nasa", p.get("q")) } };
    throw new ag.AgHatasi("beklenmeyen adres: " + u.hostname, "adres");
  };
  const gorsel = async (url) => {
    sayac.gorsel++;
    const r = resimler.get(url);
    if (!r) throw new ag.AgHatasi("HTTP 404", 404);
    if (r instanceof Error) throw r;
    return { govde: r, durum: 200, basliklar: {} };
  };
  const getir = async (url) => ({ govde: Buffer.from(JSON.stringify(await json(url))) });
  getir.json = json; getir.gorsel = gorsel;
  return { getir, resimler, sayac, sorgular, istekler };
}

let _tohum = 1000;
const jpg = (en, boy) => yardim.tekil(yardim.gorselUret("jpg", en || 1920, boy || 1080), ++_tohum);

// Wikimedia sayfasi + gorselini kaydeder
function wiki(a, ad, o) {
  o = o || {};
  const en = o.en || 3000, boy = o.boy || 2000;
  const thumb = "https://upload.test/thumb/" + encodeURIComponent(ad) + ".jpg";
  a.resimler.set(thumb, o.govde || jpg(o.gercekEn || 1920, o.gercekBoy || 1080));
  return { pageid: ++_tohum, title: "File:" + ad + ".jpg",
    imageinfo: [{ thumburl: thumb, url: "https://upload.test/orig/" + encodeURIComponent(ad) + ".jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(ad),
      width: en, height: boy, thumbwidth: Math.min(en, 1920), thumbheight: Math.round(Math.min(en, 1920) * boy / en), mime: o.mime || "image/jpeg",
      extmetadata: { LicenseShortName: { value: o.lisans || "Public domain" }, Artist: { value: o.yazar || "Test Yazar" }, ImageDescription: { value: o.aciklama || "" } } }] };
}
const sirala = list => list.map((p, i) => Object.assign(p, { index: i + 1 }));

function bag(a, ek) {
  const log = [], uyarilar = [];
  return Object.assign({ getir: a.getir, bekle: yardim.uyku0, bekleKaynak: yardim.uyku0, aralik: {}, indirmeAra: 0, anahtarlar: { pexels: "", pixabay: "" },
    log: m => log.push(m), uyari: m => uyarilar.push(m), _log: log, _uyari: uyarilar }, ek || {});
}
const manifestOku = is => JSON.parse(fs.readFileSync(path.join(process.env.OTOMASYON_URETIM, is, "Visuals", "manifest.json"), "utf8"));
const isYol = (is, ...p) => path.join(process.env.OTOMASYON_URETIM, is, ...p);
const HAYVANLAR = ["bear", "wolf", "eagle", "fox", "deer", "owl"];
const senaryo6 = yardim.senaryoUret(6, 30);
const konu6 = { format: "long", sahneKelimeleri: HAYVANLAR.map(h => [h]) };

// bir hayvan icin tipik Commons sonucu: NC, harita, kucuk, kamu mali, CC BY, CC BY-SA
function hayvanKatalogu(a, q) {
  return sirala([
    wiki(a, q + " NC photo", { lisans: "CC BY-NC 4.0", aciklama: q }),
    wiki(a, "Map of " + q + " range", { aciklama: q }),
    wiki(a, q + " small", { en: 1000, boy: 700, aciklama: q }),
    wiki(a, q + " PD one", { lisans: "Public domain", aciklama: q + " in the wild" }),
    wiki(a, q + " BY one", { lisans: "CC BY 4.0", yazar: "Ayse Yilmaz", aciklama: q }),
  ]);
}

// ------------------------------------------------------------------ 1) temel akis
test("temel akis: manifest + 001-bear klasorleri + lisans/atif; NC/harita/kucuk gorsel ASLA girmez; ssha1/boyut DOSYADAN", { skip: atla }, async () => {
  const is = "akis-temel";
  yardim.isKur(is, { senaryo: senaryo6, konu: konu6 });
  const a = sahteAg({ wikimedia: q => hayvanKatalogu(a, q) });
  const b = bag(a);
  const r = await calistir({ is }, b);
  const m = manifestOku(is);

  // sozlesme alanlari
  assert.equal(m.surum, 1);
  assert.equal(m.kaynakSenaryoSha1, ortak.paragrafOzeti(ortak.paragraflaraBol(senaryo6)));
  assert.equal(m.dil, "en"); assert.equal(m.hedefYon, "yatay");
  assert.equal(m.sahneler.length, 6);
  assert.deepEqual([].concat(...m.sahneler.map(s => s.paragraflar)), [0, 1, 2, 3, 4, 5], "her paragraf tam bir sahnede");
  m.sahneler.forEach((s, i) => {
    assert.equal(s.no, i + 1);
    assert.match(s.klasor, new RegExp("^00" + (i + 1) + "-" + HAYVANLAR[i] + "$"));
    assert.ok(["tamam", "eksik", "uretilen", "doldurma"].includes(s.durum));
    assert.equal(s.durum, "tamam");
    assert.equal(s.gorseller.length, 2, "adet 2");
    assert.deepEqual(s.aramalar, [HAYVANLAR[i]]);
    assert.equal(s.kullanilanArama, HAYVANLAR[i]);
    for (const g of s.gorseller) {
      assert.ok(fs.existsSync(isYol(is, "Visuals", g.dosya)), "dosya diskte: " + g.dosya);
      assert.match(g.dosya, /^\d{3}-[a-z]+\/\d\d\.jpg$/);
      assert.deepEqual([g.en, g.boy], [1920, 1080], "API 3000x2000 dedi ama GERCEK boyut dosyadan okunmali");
      assert.equal(g.bayt, fs.statSync(isYol(is, "Visuals", g.dosya)).size);
      assert.match(g.sha1, /^[0-9a-f]{40}$/);
      assert.equal(g.kaynak, "wikimedia");
      assert.match(g.kaynakUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      assert.ok(g.indirmeUrl.startsWith("https://upload.test/thumb/"));
      assert.ok(["pdm", "cc0", "by"].includes(g.lisansKodu), "yalniz PD/CC0/BY: " + g.lisansKodu);
      assert.ok(!/NC|Map of|small/i.test(g.baslik), "elenen gorsel girdi: " + g.baslik);
    }
  });
  assert.equal(m.toplamGorsel, 12);
  assert.deepEqual(m.kaynakHatalari, {});
  // ATIF.txt: yalniz CC BY satirlari, baslik satiri
  const atif = fs.readFileSync(isYol(is, "ATIF.txt"), "utf8").trim().split("\n");
  assert.equal(atif[0], "Görsel kaynakları / Image credits:");
  assert.ok(atif.length >= 2);
  for (const l of atif.slice(1)) assert.match(l, /^".+" — .+ — CC BY 4\.0 — https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  assert.ok(!atif.join("\n").includes("NC photo"));
  assert.equal(r.sonuc.indirilen, 12);
  assert.ok(!r.sonuc.atlandi);
});

// ------------------------------------------------------------------ 2) alaka > dosya boyutu
test("secim ALAKAYLA yapilir: sirada 1. olan, 37. siradaki dev dosyadan once gelir", { skip: atla }, async () => {
  const is = "akis-alaka";
  yardim.isKur(is, { senaryo: yardim.senaryoUret(1, 30), konu: { sahneKelimeleri: [["polar bear"]], format: "long" } });
  const a = sahteAg({ wikimedia: q => {
    const l = [wiki(a, "polar bear on ice", { en: 1500, boy: 1000, aciklama: "polar bear", lisans: "CC0" })];
    for (let i = 0; i < 20; i++) l.push(wiki(a, "arctic sunset landscape " + i, { en: 9000, boy: 6000, aciklama: "sunset", lisans: "CC0" }));
    l.push(wiki(a, "polar bear cub", { en: 1400, boy: 930, aciklama: "polar bear", lisans: "CC0" }));
    return sirala(l);
  } });
  await calistir({ is }, bag(a));
  const m = manifestOku(is);
  const adlar = m.sahneler[0].gorseller.map(g => g.baslik);
  assert.deepEqual(adlar.sort(), ["polar bear cub", "polar bear on ice"]);
});

// ------------------------------------------------------------------ 3) bozuk indirmeler
test("indirme dogrulamasi: HTML sayfasi, kucuk cozunurluk, 25 MB ustu, 404 atilir; sonraki gecerli aday alinir", { skip: atla }, async () => {
  const is = "akis-bozuk";
  yardim.isKur(is, { senaryo: yardim.senaryoUret(1, 30), konu: { sahneKelimeleri: [["bear"]], format: "long" } });
  const a = sahteAg({ wikimedia: q => {
    const l = [
      wiki(a, "bear html", { govde: yardim.htmlSayfasi(), lisans: "CC0", aciklama: "bear" }),
      wiki(a, "bear tiny", { gercekEn: 640, gercekBoy: 360, lisans: "CC0", aciklama: "bear" }),
      wiki(a, "bear huge", { lisans: "CC0", aciklama: "bear" }),
      wiki(a, "bear dead", { lisans: "CC0", aciklama: "bear" }),
      wiki(a, "bear tall", { gercekEn: 1280, gercekBoy: 3600, lisans: "CC0", aciklama: "bear" }),      // API 3000x2000 dedi, gercekte cok dikey
      wiki(a, "bear good one", { lisans: "CC0", aciklama: "bear" }),
      wiki(a, "bear good two", { lisans: "CC0", aciklama: "bear" }),
    ];
    a.resimler.set(l[2].imageinfo[0].thumburl, new ag.AgHatasi("Dosya çok büyük (31 MB).", "cok_buyuk"));
    a.resimler.delete(l[3].imageinfo[0].thumburl);
    a.resimler.delete(l[3].imageinfo[0].url);
    return sirala(l);
  } });
  await calistir({ is }, bag(a));
  const m = manifestOku(is);
  assert.deepEqual(m.sahneler[0].gorseller.map(g => g.baslik).sort(), ["bear good one", "bear good two"]);
  for (const g of m.sahneler[0].gorseller) assert.equal(dogrulaDosya(is, g.dosya), "jpg");
});
function dogrulaDosya(is, goreli) { return require("../lib/gorsel-dogrula.js").dogrula(fs.readFileSync(isYol(is, "Visuals", goreli)), {}).tur; }

// ------------------------------------------------------------------ 4) tekrar onleme + silinenler
test("ayni gorsel iki sahnede cikmaz (yalniz INDIRILENLER isaretlenir); silinenler.json URL ve sha1 ile dislanir", { skip: atla }, async () => {
  const is = "akis-tekrar";
  yardim.isKur(is, { senaryo: yardim.senaryoUret(2, 30), konu: { sahneKelimeleri: [["bear"], ["bear"]], format: "long" } });
  const a = sahteAg({ wikimedia: () => sayfalar });
  const sayfalar = [];
  for (let i = 1; i <= 7; i++) sayfalar.push(wiki(a, "bear shot " + i, { lisans: "CC0", aciklama: "bear" }));
  sirala(sayfalar);
  const silinenUrl = sayfalar[0].imageinfo[0].descriptionurl;
  const silinenSha = require("../lib/gorsel-dogrula.js").dogrula(a.resimler.get(sayfalar[1].imageinfo[0].thumburl)).sha1;
  fs.writeFileSync(isYol(is, "silinenler.json"), JSON.stringify({ surum: 1, silinenler: [
    { sahne: "001-bear", ad: "01.jpg", kaynakUrl: silinenUrl, sha1: "", zaman: "2026-10-05T00:00:00Z" },
    { sahne: "001-bear", ad: "02.jpg", kaynakUrl: "", sha1: silinenSha, zaman: "2026-10-05T00:00:00Z" },
  ] }));
  await calistir({ is }, bag(a));
  const m = manifestOku(is);
  const hepsi = [].concat(...m.sahneler.map(s => s.gorseller));
  const adlar = hepsi.map(g => g.baslik);
  assert.equal(new Set(adlar).size, adlar.length, "ayni gorsel iki kez kullanilmis: " + adlar);
  assert.ok(!adlar.includes("bear shot 1"), "URL ile silinen geri geldi");
  assert.ok(!adlar.includes("bear shot 2"), "sha1 ile silinen geri geldi");
  assert.equal(m.sahneler[0].gorseller.length + m.sahneler[1].gorseller.length, 4, "kalan 5 gorselden 4'u iki sahneye dagitilir");
  assert.ok(m.sahneler.every(s => s.gorseller.length === 2));
});

// ------------------------------------------------------------------ 5) artimli calisma
test("ARTIMLI: ikinci calisma dokunmaz (atlandi, ag cagrisi yok); gorsel silinince yalniz eksik sahne dolar; senaryo degisince _eski-<damga>/", { skip: atla }, async () => {
  const is = "akis-artimli";
  yardim.isKur(is, { senaryo: senaryo6, konu: konu6 });
  const a = sahteAg({ wikimedia: q => hayvanKatalogu(a, q) });
  await calistir({ is }, bag(a));
  const ilk = manifestOku(is);
  const gorselOnce = a.sayac.gorsel, jsonOnce = a.sayac.json;

  // 2. calisma: hicbir sey degismedi
  const r2 = await calistir({ is }, bag(a));
  assert.equal(r2.sonuc.atlandi, true); assert.equal(r2.sonuc.neden, "görseller güncel");
  assert.equal(a.sayac.gorsel, gorselOnce, "yeni indirme olmamali"); assert.equal(a.sayac.json, jsonOnce, "yeni arama olmamali");
  assert.deepEqual(manifestOku(is).sahneler.map(s => s.gorseller.map(g => g.sha1)), ilk.sahneler.map(s => s.gorseller.map(g => g.sha1)));

  // kullanici 3. sahnenin TUM gorsellerini siler (panel dosyayi + kaydi siler ve silinenler.json'a yazar)
  const hedef = ilk.sahneler[2];
  const silinenler = [];
  for (const g of hedef.gorseller) { fs.unlinkSync(isYol(is, "Visuals", g.dosya)); silinenler.push({ sahne: hedef.klasor, ad: path.basename(g.dosya), kaynakUrl: g.kaynakUrl, sha1: g.sha1, zaman: new Date().toISOString() }); }
  hedef.gorseller = [];
  fs.writeFileSync(isYol(is, "Visuals", "manifest.json"), JSON.stringify(ilk, null, 2));
  fs.writeFileSync(isYol(is, "silinenler.json"), JSON.stringify({ surum: 1, silinenler }));
  const r3 = await calistir({ is }, bag(a));
  const m3 = manifestOku(is);
  assert.equal(r3.sonuc.indirilen, 2, "yalniz eksik sahne dolmali");
  assert.equal(m3.sahneler[2].gorseller.length, 2);
  for (const g of m3.sahneler[2].gorseller) assert.ok(!silinenler.some(s => s.kaynakUrl === g.kaynakUrl || s.sha1 === g.sha1), "silinen gorsel geri geldi");
  assert.deepEqual(m3.sahneler.filter((s, i) => i !== 2).map(s => s.gorseller.map(g => g.sha1)), ilk.sahneler.filter((s, i) => i !== 2).map(s => s.gorseller.map(g => g.sha1)), "diger sahnelere dokunulmamali");
  assert.equal(m3.sahneler[2].klasor, hedef.klasor, "klasor adi korunur");

  // senaryo degisti: eski klasorler Visuals/_eski-<damga>/ altina, yeni manifest
  fs.writeFileSync(isYol(is, "Voice", "SESLENDIRME-TAM-METIN.txt"), yardim.senaryoUret(6, 31) + " ek", "utf8");
  await calistir({ is }, bag(a));
  const eskiler = fs.readdirSync(isYol(is, "Visuals")).filter(x => /^_eski-/.test(x));
  assert.equal(eskiler.length, 1);
  const eskiIcerik = fs.readdirSync(isYol(is, "Visuals", eskiler[0]));
  assert.ok(eskiIcerik.includes("001-bear") && eskiIcerik.includes("manifest.json"), String(eskiIcerik));
  const m4 = manifestOku(is);
  assert.equal(m4.kaynakSenaryoSha1, ortak.paragrafOzeti(ortak.paragraflaraBol(fs.readFileSync(isYol(is, "Voice", "SESLENDIRME-TAM-METIN.txt"), "utf8"))));
  // yeni sahne klasorleri tek tek var, eski ile karisik degil
  assert.deepEqual(man.sahneKlasorleri(isYol(is, "Visuals")).length, 6);

  // --yeniden: temizden baslar (2. ve 3. arsiv). Arsivler KENDILIGINDEN SILINMEZ (kullanicinin ayiklayip sakladigi set olabilir)
  await calistir({ is, yeniden: true }, bag(a));
  const b4 = bag(a);
  await calistir({ is, yeniden: true }, b4);
  const arsivler = () => fs.readdirSync(isYol(is, "Visuals")).filter(x => /^_eski-/.test(x));
  assert.equal(arsivler().length, 3, "hicbir arsiv otomatik silinmemeli");
  assert.ok(!b4._uyari.some(m => /siliniyor/.test(m)));
  // acik onay (--arsiv-temizle): en yeni 2 arsiv kalir, silinenler SILMEDEN ONCE uyariyla bildirilir
  const b5 = bag(a);
  await calistir({ is, arsivTemizle: true }, b5);
  assert.equal(arsivler().length, 2, "--arsiv-temizle son 2 arsivi birakir");
  assert.ok(b5._uyari.some(m => /Eski arşiv siliniyor \(--arsiv-temizle/.test(m)));
});

// ------------------------------------------------------------------ 6) hata cikis kodlari
test("Hic gorsel inmezse HATA (exit 4); kaynaklara ulasilamazsa exit 3; sahnelerin <%70'i doluysa exit 4; manifest yine yazilir", { skip: atla }, async () => {
  // a) kaynaklar sonuc vermiyor
  yardim.isKur("akis-bos", { senaryo: senaryo6, konu: konu6 });
  const a1 = sahteAg({});
  await assert.rejects(() => calistir({ is: "akis-bos" }, bag(a1)), e => e.kod === "gorsel_yok" && e.cikis === 4 && /Hiç görsel indirilemedi/.test(e.message) && !!e.cozum);
  assert.ok(fs.existsSync(isYol("akis-bos", "Visuals", "manifest.json")), "manifest yazilmis olmali");

  // b) ag yok
  yardim.isKur("akis-ag", { senaryo: senaryo6, konu: konu6 });
  const hata = new ag.AgHatasi("HTTP 502", 502);
  const a2 = sahteAg({ wikimedia: () => hata, openverse: () => hata, nasa: () => hata });
  await assert.rejects(() => calistir({ is: "akis-ag" }, bag(a2)), e => e.kod === "gorsel_yok" && e.cikis === 3);

  // c) yalniz ilk iki hayvan icin gorsel var -> 2/6 dolu
  yardim.isKur("akis-az", { senaryo: senaryo6, konu: konu6 });
  const a3 = sahteAg({ wikimedia: q => (["bear", "wolf"].includes(q) ? hayvanKatalogu(a3, q) : []) });
  await assert.rejects(() => calistir({ is: "akis-az" }, bag(a3)), e => e.kod === "gorsel_az" && e.cikis === 4 && /%33/.test(e.message));
  const m = manifestOku("akis-az");
  assert.equal(m.sahneler.filter(s => s.gorseller.length).length, 2);
  assert.equal(m.sahneler[5].durum, "eksik");
});

// ------------------------------------------------------------------ 7) lisans + OPENVERSE
test("lisans: Openverse NC/ND ELENIR, CC BY-SA icin uyari, CC0 > CC BY > CC BY-SA sirasi; istek license_type tasir", { skip: atla }, async () => {
  const is = "akis-lisans";
  yardim.isKur(is, { senaryo: yardim.senaryoUret(1, 30), konu: { sahneKelimeleri: [["lighthouse"]], format: "long" } });
  let liste = [];
  const a = sahteAg({ openverse: () => liste });
  const ov = (id, baslik, lisans, v) => { const url = "https://flickr.test/" + id + ".jpg"; a.resimler.set(url, jpg()); return { url, title: baslik, license: lisans, license_version: v || "2.0", creator: "Yaratici " + id, foreign_landing_url: "https://flickr.test/p/" + id, width: 2400, height: 1600, tags: [{ name: "lighthouse" }] }; };
  liste = [ov("nc", "lighthouse NC", "by-nc"), ov("nd", "lighthouse ND", "by-nd"), ov("sa", "lighthouse SA", "by-sa", "3.0"), ov("by", "lighthouse BY", "by", "4.0"), ov("cc0", "lighthouse CC0", "cc0", "1.0")];
  await calistir({ is }, bag(a));
  assert.ok(a.istekler.some(u => /license_type=commercial%2Cmodification|license_type=commercial,modification/.test(u)), "istek license_type tasimali");
  const m = manifestOku(is);
  const g = m.sahneler[0].gorseller;
  assert.deepEqual(g.map(x => x.lisansKodu).sort(), ["by", "cc0"], "CC0 + CC BY secilir (BY-SA'dan once); NC/ND hic gelmez");
  assert.ok(!JSON.stringify(m).includes("flickr.test/nc") && !JSON.stringify(m).includes("flickr.test/nd"));
  const atif = fs.readFileSync(isYol(is, "ATIF.txt"), "utf8");
  assert.match(atif, /CC BY 4\.0/); assert.ok(!/CC0/.test(atif));
  // BY-SA tek basina kalirsa kullanilir ve manifestte uyari olur
  const is2 = "akis-lisans-sa";
  yardim.isKur(is2, { senaryo: yardim.senaryoUret(1, 30), konu: { sahneKelimeleri: [["lighthouse"]], format: "long" } });
  liste = [liste[2], ov("sa2", "lighthouse SA two", "by-sa", "3.0")];
  const ag3 = sahteAg({ openverse: () => liste });
  for (const [k, v] of a.resimler) ag3.resimler.set(k, v);
  await calistir({ is: is2 }, bag(ag3));
  const m2 = manifestOku(is2);
  assert.equal(m2.sahneler[0].gorseller[0].lisansKodu, "by-sa");
  assert.ok(m2.sahneler[0].gorseller[0].uyari && m2.uyarilar.length === 1, "BY-SA icin manifest uyarisi");
  assert.match(fs.readFileSync(isYol(is2, "ATIF.txt"), "utf8"), /CC BY-SA 3\.0/);
});

test("Pexels: atif satiri ATIF.txt'ye girer; anahtar yoksa Pexels hic sorgulanmaz; kullanici Authorization'i ag'a gider", { skip: atla }, async () => {
  const is = "akis-pexels";
  yardim.isKur(is, { senaryo: yardim.senaryoUret(1, 30), konu: { sahneKelimeleri: [["tea"]], format: "long" } });
  let fotolar = [];
  const a2 = sahteAg({ pexels: () => fotolar });
  const foto = (id) => { const o = "https://images.pexels.test/" + id + ".jpeg"; a2.resimler.set(o + "?auto=compress&cs=tinysrgb&w=2560", jpg()); return { id, width: 4000, height: 2600, url: "https://www.pexels.com/photo/tea-cup-" + id + "/", photographer: "Fotografci " + id, alt: "a cup of tea", src: { original: o } }; };
  fotolar = [foto(1), foto(2), foto(3)];
  const b = bag(a2, { anahtarlar: { pexels: "TEST-ANAHTAR", pixabay: "" } });
  await calistir({ is }, b);
  const m = manifestOku(is);
  assert.equal(m.sahneler[0].gorseller.length, 2);
  assert.ok(m.sahneler[0].gorseller.every(g => g.kaynak === "pexels" && g.lisansKodu === "pexels" && /Fotografci/.test(g.atif)));
  const atif = fs.readFileSync(isYol(is, "ATIF.txt"), "utf8").trim().split("\n");
  assert.equal(atif.length, 3);
  assert.match(atif[1], /^"a cup of tea" — Fotografci \d — Pexels License — https:\/\/www\.pexels\.com\/photo\/tea-cup-\d\/$/);
  // anahtar yok: Pexels sorgulanmaz
  const a3 = sahteAg({ pexels: () => { throw new Error("cagrilmamali"); }, wikimedia: () => [] });
  await assert.rejects(() => calistir({ is: "akis-pexels", yeniden: true }, bag(a3)), e => e.kod === "gorsel_yok");
  assert.ok(!a3.sorgular.some(s => s[0] === "pexels"));
});

// ------------------------------------------------------------------ 8) 120 sahne siralama
test("120 sahne: 3 haneli klasorler, SAYISAL sira (sahne 100, sahne 11'den once gelmez), manifest kapsami eksiksiz", { skip: atla }, async () => {
  const is = "akis-120";
  const senaryo = yardim.senaryoUret(120, 30);
  yardim.isKur(is, { senaryo, konu: { format: "long" } });
  let n = 0;
  const a = sahteAg({ wikimedia: q => { const l = []; for (let i = 0; i < 6; i++) l.push(wiki(a, "x " + q + " " + (++n), { lisans: "CC0", aciklama: q })); return sirala(l); } });
  await calistir({ is }, bag(a));
  const m = manifestOku(is);
  assert.equal(m.sahneler.length, 120);
  assert.deepEqual([].concat(...m.sahneler.map(s => s.paragraflar)), Array.from({ length: 120 }, (_, i) => i));
  const klasorler = man.sahneKlasorleri(isYol(is, "Visuals"));
  assert.equal(klasorler.length, 120);
  assert.deepEqual(klasorler.map(k => parseInt(k, 10)), Array.from({ length: 120 }, (_, i) => i + 1));
  assert.match(klasorler[99], /^100-/); assert.match(klasorler[10], /^011-/);
  // duz (harf sirali) okuma "100-x"i "11-x"ten once verirdi; sayisal siralama bunu duzeltir
  const duz = fs.readdirSync(isYol(is, "Visuals")).filter(x => /^\d/.test(x)).sort();
  assert.ok(duz.indexOf(klasorler[99]) < duz.indexOf(klasorler[10]) || /^\d{3}-/.test(klasorler[10]), "3 haneli adlarda harf sirasi da dogru");
  assert.ok(m.toplamGorsel >= 120, "her sahnede en az 1 gorsel: " + m.toplamGorsel);
  assert.ok(m.sahneler.every(s => s.gorseller.length >= 1), "bos sahne var");
});

// ------------------------------------------------------------------ 9) arama oncelik zinciri
test("arama oncelikleri: sahneKelimeleri > gorsel-aramalari.json (paragraflar birlesir) > otomatik; eski json yok sayilir; dil=tr Pexels locale", { skip: atla }, async () => {
  const is = "akis-oncelik";
  const senaryo = yardim.senaryoUret(3, 14);                     // 14 kelime: kisa -> paragraflar komsuyla birlesir
  const kanonik = ortak.paragraflaraBol(senaryo);
  yardim.isKur(is, { senaryo, konu: { format: "long", sahneKelimeleri: [["elle kelime"]] } });
  fs.writeFileSync(isYol(is, "Voice", "gorsel-aramalari.json"), JSON.stringify({ surum: 1, kaynakSenaryoSha1: ortak.paragrafOzeti(kanonik), uretici: "claude", paragraflar: [
    { no: 0, aramalar: ["claude bir", "claude iki"] }, { no: 1, aramalar: ["claude uc"] }, { no: 2, aramalar: ["claude dort"] } ] }));
  const a = sahteAg({ wikimedia: () => [] });
  const b = bag(a);
  await assert.rejects(() => calistir({ is }, b), e => e.kod === "gorsel_yok");
  const sorgularW = a.sorgular.filter(s => s[0] === "wikimedia").map(s => s[1]);
  assert.deepEqual(sorgularW.slice(0, 1), ["elle kelime"], "1. sahne: sahneKelimeleri");
  assert.ok(!sorgularW.some(q => /^claude/.test(q)) || sorgularW.indexOf("elle kelime") === 0);

  // sahneKelimeleri yok -> claude listesi, paragraflar birlesik: 0'in 1. + 1'in 1. + ...
  yardim.isKur(is, { senaryo, konu: { format: "long" } });
  const a2 = sahteAg({ wikimedia: () => [] });
  await assert.rejects(() => calistir({ is, yeniden: true }, bag(a2)), e => e.kod === "gorsel_yok");
  const q2 = a2.sorgular.filter(s => s[0] === "wikimedia").map(s => s[1]);
  assert.equal(q2[0], "claude bir"); assert.ok(q2.includes("claude uc") || q2.includes("claude iki"));

  // senaryo sonradan degisti -> json ESKI sayilir, otomatik
  fs.writeFileSync(isYol(is, "Voice", "SESLENDIRME-TAM-METIN.txt"), senaryo + "\n\nSon paragraf Einstein Einstein Einstein ek metin burada devam eder yine de.", "utf8");
  const a3 = sahteAg({ wikimedia: () => [] });
  const b3 = bag(a3);
  await assert.rejects(() => calistir({ is }, b3), e => e.kod === "gorsel_yok");
  assert.ok(!a3.sorgular.some(s => /^claude/.test(s[1])), "eski aramalar kullanilmamali");
  assert.ok(b3._uyari.some(m => /güncel senaryoya ait değil/.test(m)));

  // Turkce otomatik cikarim: Pexels locale=tr-TR
  const is2 = "akis-tr";
  yardim.isKur(is2, { senaryo: "İstanbul Boğazı çok güzeldi ve Galata Kulesi manzarayı izliyordu bugün sabah erken saatlerde herkes uyanıktı.", konu: { format: "long", dil: "tr", ses: "tr-TR-AhmetNeural" } });
  const a4 = sahteAg({ pexels: () => [] });
  await assert.rejects(() => calistir({ is: is2 }, bag(a4, { anahtarlar: { pexels: "k", pixabay: "" } })), e => e.kod === "gorsel_yok");
  assert.ok(a4.istekler.some(u => /api\.pexels\.com/.test(u) && /locale=tr-TR/.test(u)), "otomatik Turkce arama: locale=tr-TR");
  assert.ok(a4.sorgular.some(s => s[0] === "pexels" && /İstanbul|Galata/.test(s[1])), "Turkce ozel isim aranmali: " + JSON.stringify(a4.sorgular.slice(0, 4)));
});

// ------------------------------------------------------------------ 10) sahne bazli yeniden arama
test("--sahne N --ara: yalniz o sahne, eski gorseller _eski-<damga>/ altina tasinir, yeni arama kaydedilir", { skip: atla }, async () => {
  const is = "akis-sahne";
  yardim.isKur(is, { senaryo: senaryo6, konu: konu6 });
  const a = sahteAg({ wikimedia: q => hayvanKatalogu(a, q) });
  await calistir({ is }, bag(a));
  const once = manifestOku(is);
  // kullanicinin yeniden aradigi (begenmedigi) eski gorseller tekrar secilmez: farkli ifade, farkli adaylar
  // (ayni ifade ayni adaylari verirse hicbir sey bulunamaz -> eski gorseller GERI KONUR; bkz test/gorsel-duzeltme.test.js)
  await calistir({ is, sahne: 2, ara: "gray wolf" }, bag(a, {}));
  const sonra = manifestOku(is);
  assert.equal(sonra.sahneler[1].aramalar[0], "gray wolf");
  assert.equal(sonra.sahneler[1].gorseller.length, 2);
  assert.ok(sonra.sahneler[1].gorseller.every(g => /^gray wolf /.test(g.baslik)), "yeni aramanin gorselleri");
  for (const i of [0, 2, 3, 4, 5]) assert.deepEqual(sonra.sahneler[i].gorseller.map(g => g.sha1), once.sahneler[i].gorseller.map(g => g.sha1), "diger sahneler degismemeli: " + i);
  const eski = fs.readdirSync(isYol(is, "Visuals")).find(x => /^_eski-/.test(x));
  assert.ok(eski, "eski gorseller arsivlenmis olmali");
  assert.equal(fs.readdirSync(isYol(is, "Visuals", eski, once.sahneler[1].klasor)).length, 2);
  // hatali kullanim
  await assert.rejects(() => calistir({ is, ara: "x" }, bag(a)), e => e.cikis === 2);
  await assert.rejects(() => calistir({ is, sahne: 99 }, bag(a)), e => e.cikis === 2 && /Sahne 99 yok/.test(e.message));
});

// ------------------------------------------------------------------ 11) NASA oncelik
test("uzay konusunda NASA, Pexels'ten ONCE ve havuz doluluguna bakmadan devreye girer; NASA atif listesine girmez", { skip: atla }, async () => {
  const is = "akis-nasa";
  const metin = "The galaxy spins around a black hole while a planet orbits a distant star near the nebula and the galaxy glows brightly tonight.";
  yardim.isKur(is, { senaryo: metin, konu: { format: "long", sahneKelimeleri: [["spiral galaxy"]] } });
  let nasaListe = [], pexListe = [];
  const a2 = sahteAg({ nasa: () => nasaListe, pexels: () => pexListe });
  const nasaOge = (id) => { const taban = "https://images-assets.nasa.gov/image/" + id + "/" + id; a2.resimler.set(taban + "~orig.jpg", jpg(4000, 3000)); return { data: [{ title: "Spiral galaxy " + id, description: "galaxy", nasa_id: id, keywords: ["galaxy"], photographer: "NASA" }], links: [{ href: taban + "~thumb.jpg" }] }; };
  const pex = (id) => { const o = "https://images.pexels.test/" + id + ".jpeg"; a2.resimler.set(o + "?auto=compress&cs=tinysrgb&w=2560", jpg()); return { id, width: 4000, height: 2600, url: "https://www.pexels.com/photo/spiral-galaxy-" + id + "/", photographer: "F" + id, alt: "spiral galaxy photo", src: { original: o } }; };
  nasaListe = [nasaOge("N1"), nasaOge("N2"), nasaOge("N3")];
  pexListe = [pex(1), pex(2), pex(3), pex(4)];
  await calistir({ is }, bag(a2, { anahtarlar: { pexels: "k", pixabay: "" } }));
  const m = manifestOku(is);
  assert.ok(a2.sorgular.some(s => s[0] === "nasa"), "NASA sorgulanmali");
  const kaynaklar = m.sahneler[0].gorseller.map(g => g.kaynak);
  assert.deepEqual(kaynaklar, ["nasa", "nasa"], "NASA ilk iki sirada (pexels havuzu dolu olsa da)");
  assert.equal(m.sahneler[0].gorseller[0].lisansKodu, "nasa");
  assert.ok(m.sahneler[0].gorseller[0].en >= 4000, "NASA boyutu dosyadan");
  assert.ok(!fs.existsSync(isYol(is, "ATIF.txt")), "yalniz NASA: atif listesi bos -> ATIF.txt yok");
});

// ------------------------------------------------------------------ 12) AI uretimi
test("uret: isareti AI gorseli uretir (uretAdet varsayilan 2, farkli plan/aci), manifestte kaynak 'uretim' + istem; AI olmazsa stok aramaya duser", { skip: atla }, async () => {
  const is = "akis-ai";
  yardim.isKur(is, { senaryo: yardim.senaryoUret(2, 30), konu: { format: "long", sahneKelimeleri: [["uret: a lattice of light"], ["uret: neural network"]] } });
  const a = sahteAg({ wikimedia: q => [wiki(a, "neural network photo", { lisans: "CC0", aciklama: "neural network" })] });
  const istemler = [];
  let cagri = 0;
  const uretici = require("../gorsel-uret.js");
  const sahteUretici = Object.assign({}, uretici, {
    async uretBir(istem, en, boy, tohum) {
      istemler.push(istem);
      cagri++;
      if (/neural/.test(istem)) throw new Error("Pollinations: HTTP 502");
      return { govde: jpg(1280, 720), servis: "Pollinations" };
    },
  });
  const b = bag(a, { uretici: sahteUretici });
  await assert.rejects(() => calistir({ is }, b), e => e.kod === "gorsel_az" || e.kod === "gorsel_yok");   // 2. sahne stokta da yok
  const m = manifestOku(is);
  const s1 = m.sahneler[0];
  assert.equal(s1.gorseller.length, 2, "uretAdet varsayilan 2");
  assert.match(s1.klasor, /^001-uretilen$/);
  assert.equal(s1.durum, "uretilen");
  for (const g of s1.gorseller) { assert.equal(g.kaynak, "uretim"); assert.equal(g.lisansKodu, "ai"); assert.match(g.istem, /lattice of light/); assert.equal(g.atifGerekli, false); }
  assert.notEqual(s1.gorseller[0].istem, s1.gorseller[1].istem, "istemler cesitlendirilmis olmali (aci/plan)");
  assert.deepEqual([s1.gorseller[0].en, s1.gorseller[0].boy], [1280, 720]);
  assert.ok(!fs.existsSync(isYol(is, "ATIF.txt")) || !/uretim|lattice/.test(fs.readFileSync(isYol(is, "ATIF.txt"), "utf8")));
  // 2. sahne: AI 502 verdi -> stok aramaya dusuldu (CC0 gorsel 1 adet)
  assert.ok(istemler.some(i => /neural/.test(i)));
  assert.equal(m.sahneler[1].gorseller.length, 1);
  assert.equal(m.sahneler[1].gorseller[0].kaynak, "wikimedia");
  assert.ok(b._log.some(l => /AI görsel üretimi başarısız/.test(l)), "AI hatasi GORUNUR olmali");
});

test("SN'nin gorsel-aramalari.json 'uret' istemi: stok yetmezse AI yedegi; --uretme ile kapatilir", { skip: atla }, async () => {
  const is = "akis-ai-yedek";
  const senaryo = yardim.senaryoUret(1, 30);
  yardim.isKur(is, { senaryo, konu: { format: "long" } });
  fs.writeFileSync(isYol(is, "Voice", "gorsel-aramalari.json"), JSON.stringify({ surum: 1, kaynakSenaryoSha1: ortak.paragrafOzeti(ortak.paragraflaraBol(senaryo)), uretici: "claude",
    paragraflar: [{ no: 0, aramalar: ["quantum entanglement"], uret: "two glowing particles linked by light" }] }));
  const a = sahteAg({});
  let cagri = 0;
  const sahteUretici = Object.assign({}, require("../gorsel-uret.js"), { async uretBir() { cagri++; return { govde: jpg(1280, 720), servis: "x" }; } });
  await calistir({ is }, bag(a, { uretici: sahteUretici }));
  assert.equal(cagri, 2);
  assert.equal(manifestOku(is).sahneler[0].durum, "uretilen");
  await assert.rejects(() => calistir({ is, yeniden: true, uretme: true }, bag(a, { uretici: sahteUretici })), e => e.kod === "gorsel_yok");
  assert.equal(cagri, 2, "--uretme: AI cagrilmamali");
});

// ------------------------------------------------------------------ 13) girdi hatalari
test("girdi hatalari: senaryo yok / bozuk konu.json / gecersiz is adi -> exit 2; kaynak hatalari manifestte kaynak bazli", { skip: atla }, async () => {
  yardim.isKur("akis-sensiz", { senaryo: "kisa", konu: {} });
  await assert.rejects(() => calistir({ is: "akis-sensiz" }, bag(sahteAg({}))), e => e.kod === "senaryo_yok" && e.cikis === 2);
  yardim.isKur("akis-konubozuk", { senaryo: senaryo6, konu: '{"format": "long",, }' });
  await assert.rejects(() => calistir({ is: "akis-konubozuk" }, bag(sahteAg({}))), e => e.kod === "konu_bozuk" && e.cikis === 2 && e.satir >= 1);
  await assert.rejects(() => calistir({ is: "../etc" }, bag(sahteAg({}))), e => e.cikis === 2);
  await assert.rejects(() => calistir({ is: "olmayan-is" }, bag(sahteAg({}))), e => e.kod === "is_yok" && e.cikis === 2);

  // kaynak hatalari sessiz yutulmaz: Wikimedia 500, Openverse 429
  yardim.isKur("akis-hata", { senaryo: senaryo6, konu: konu6 });
  const a = sahteAg({ wikimedia: q => { if (q === "bear") return hayvanKatalogu(a, q); return new ag.AgHatasi("HTTP 500", 500); }, openverse: () => new ag.AgHatasi("HTTP 429", 429, { bekleSn: 3600 }) });
  const b = bag(a);
  await assert.rejects(() => calistir({ is: "akis-hata" }, b), e => ["gorsel_az", "gorsel_yok"].includes(e.kod));
  const m = manifestOku("akis-hata");
  assert.match(m.kaynakHatalari.openverse, /^kapali \(.*429/);
  assert.ok(m.kaynakHatalari.wikimedia >= 1 || /kapali/.test(String(m.kaynakHatalari.wikimedia)));
  assert.ok(b._log.some(l => /Openverse/.test(l)) && b._log.some(l => /Wikimedia/.test(l)), "hatalar loga yazilmali");
  assert.ok(b._uyari.some(m2 => /Openverse kapatıldı/.test(m2)));
});
