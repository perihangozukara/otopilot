// BIRIM TESTLERI — metin okunusa hazirlama ve seslendirme: yeniden deneme, paragraf DUSMEME, eski parca temizligi.
// Edge agi SAHTELENIR (test/ses-sahte.js); ses gercek ffmpeg lavfi sentetigi. Bulgu karsiliklari: B005, B031, B032, B033, B040.
"use strict";
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const S = require("./ses-sahte.js");

const ortam = S.ortamiYalitla();
const uretim = S.testUretimi();
const testF = S.ffmpegTesti(test);
const ortak = require("../lib/ortak.js");
const U = require("../lib/ses-uret.js");
const M = require("../lib/ses-metin.js");
const MM = require("../lib/ses-motor.js");

test.after(() => { uretim.temizle(); ortam.temizle(); });

// ---------------------------------------------------------------- metin okunusa hazirlama (ffmpeg gerekmez)
const hazir = (m, d, o) => M.metniHazirla(m, d, o || {}, { xml: false });

test("metniHazirla (tr): yuzde, ondalik, binlik, yil eki, birim, derece, kisaltma, tarih, sira sayisi", () => {
  assert.equal(hazir("Büyüme %15 oldu", "tr"), "Büyüme yüzde on beş oldu");
  assert.equal(hazir("3,5 milyon kişi", "tr"), "üç virgül beş milyon kişi");
  assert.equal(hazir("2.500 metre", "tr"), "iki bin beş yüz metre");
  assert.match(hazir("1923'te kuruldu", "tr"), /^bin dokuz yüz yirmi üçte kuruldu$/);
  assert.equal(hazir("5 km yürüdü", "tr"), "beş kilometre yürüdü");
  assert.equal(hazir("25°C", "tr"), "yirmi beş santigrat derece");
  assert.equal(hazir("Dr. Ali geldi", "tr"), "doktor Ali geldi");
  assert.equal(hazir("05.10.2026 tarihinde", "tr"), "beş Ekim iki bin yirmi altı tarihinde");
  assert.equal(hazir("3. dünya savaşı", "tr"), "üçüncü dünya savaşı");
  assert.equal(hazir("1.250.000 TL", "tr"), "bir milyon iki yüz elli bin lira");
});

test("metniHazirla: RAKAMA BITISIK birimler de cevrilir ('120m²', '90km/sa', '300km/s'; eskiden oldugu gibi kaliyordu)", () => {
  assert.equal(hazir("Daire 120m² ve 90km/sa hız", "tr"), "Daire yüz yirmi metrekare ve doksan kilometre bölü saat hız");
  assert.equal(hazir("300km/s, 2m³, 5km², 7cm³", "tr"), "üç yüz kilometre bölü saniye, iki metreküp, beş kilometrekare, yedi santimetreküp");
  assert.equal(hazir("A 120m² flat at 50km/h and 10m/s, 60mph", "en"),
    "A 120 square meters flat at 50 kilometers per hour and 10 meters per second, 60 miles per hour");
  // bosluklu yazim ayni sonucu verir
  assert.equal(hazir("120 m² 90 km/sa", "tr"), "yüz yirmi metrekare doksan kilometre bölü saat");
  // baska bir birimin parcasi DEGISMEZ
  assert.equal(hazir("dm² ve kam/sa", "tr"), "dm² ve kam/sa");
});

test("metniHazirla (en): yuzde, para, birim, kisaltma; rakamlar oldugu gibi; cumle sonundaki nokta sayiya yapismaz", () => {
  assert.equal(hazir("Profit grew 15% in 2023", "en"), "Profit grew 15 percent in 2023");
  assert.equal(hazir("It cost $5 million", "en"), "It cost 5 million dollars");
  assert.equal(hazir("Pay $5.", "en"), "Pay 5 dollars.");
  assert.equal(hazir("It weighs 3.5 kg", "en"), "It weighs 3.5 kilograms");
  assert.equal(hazir("Dr. Smith, e.g. in the U.K. today", "en"), "Doctor Smith, for example in the United Kingdom today");
  assert.equal(hazir("Tom & Jerry", "en"), "Tom and Jerry");
});

test("metniHazirla: XML kacisi yalniz varsayilan modda; kontrol karakterleri ve BOM temizlenir; okunus sozlugu kelime sinirli", () => {
  const xml = M.metniHazirla("AT&T <b>x</b> 5 < 6", "en", {});
  assert.doesNotMatch(xml, /<|>/);
  assert.match(xml, /AT&amp;T &lt;b&gt;x&lt;\/b&gt; 5 &lt; 6/);
  const gizli = String.fromCharCode(0, 0x200B);                      // NUL + sifir genislikli bosluk: kaynakta gorunmez karakter durmasin
  assert.equal(M.metniHazirla(["a" + gizli.charAt(0) + "b" + gizli.charAt(1) + "c", "", "d"].join(String.fromCharCode(10)), "en", {}, { xml: false }), "abc d");
  assert.equal(M.bomAt(String.fromCharCode(0xFEFF) + "merhaba"), "merhaba");
  assert.equal(hazir("The GPU and GPUs and GPU-2", "en", { GPU: "G P U", "GPU-2": "G P U two" }), "The G P U and GPUs and G P U two");
  assert.equal(hazir("5 apples", "xx"), "5 apples", "bilinmeyen dilde yalniz okunus + XML");
});

test("uzunMetniBol: her parca <= maks (virgul konumu maks'ta olsa bile), metin kaybolmaz, cumle sinirinda bolunur", () => {
  for (const maks of [40, 80, 100, 1500]) {
    const cumle = "alpha beta gamma delta, epsilon zeta eta theta, iota kappa lambda mu";
    const uzun = (cumle + ". ").repeat(80).trim();
    const p = M.uzunMetniBol(uzun, maks);
    assert.ok(p.every(x => x.length <= maks), "maks " + maks + ": " + Math.max(...p.map(x => x.length)));
    assert.equal(p.join(" ").replace(/\s+/g, " "), uzun.replace(/\s+/g, " "));
  }
  // virgul TAM maks konumunda (eski hata: parca maks+1 karakter oluyordu)
  const metin = "x".repeat(99) + ", " + "y".repeat(50);
  const p = M.uzunMetniBol(metin, 100);
  assert.ok(p.every(x => x.length <= 100), p.map(x => x.length).join());
  assert.equal(p.join(" "), metin);
  assert.deepEqual(M.uzunMetniBol("kisa metin", 100), ["kisa metin"]);
  // tek kelime maks'tan uzunsa sert kesilir (sonsuz donguye girmez)
  assert.ok(M.uzunMetniBol("z".repeat(250), 100).every(x => x.length <= 100));
});

test("metniHazirla: uzun rakam/virgul dizisi ustel yavaslamaz (eski hata: 32 bin karakter 8+ sn, 64 bin dakikalarca)", () => {
  for (const [ad, metin] of [["virgullu liste", "1,1,1,1,".repeat(5000) + "x"], ["tek rakam dizisi", "1".repeat(40000) + "m"], ["ondalik liste", "12.5 ".repeat(8000)]]) {
    for (const dil of ["tr", "en"]) {
      const bas = Date.now();
      M.metniHazirla(metin, dil, {});
      assert.ok(Date.now() - bas < 1500, ad + " " + dil + ": " + (Date.now() - bas) + " ms");
    }
  }
  // sinirli sayi uzunlugu gercek sayilari bozmaz
  assert.equal(hazir("12.345.678.901 km", "tr"), "on iki milyar üç yüz kırk beş milyon altı yüz yetmiş sekiz bin dokuz yüz bir kilometre");
});

test("kelimeSay / hazirlikOzeti: kurala gore surum degisince eski sesler 'guncel degil' sayilir", () => {
  assert.equal(M.kelimeSay("a -- b & … c"), 3);
  assert.equal(M.HAZIRLIK_SURUMU >= 2, true, "birim cevirisi kurali degisti: surum artirilmis olmali");
  assert.equal(M.hazirlikOzeti({ GPU: "G P U" }), M.hazirlikOzeti({ GPU: "G P U" }));
  assert.notEqual(M.hazirlikOzeti({ GPU: "G P U" }), M.hazirlikOzeti({ GPU: "jee pe yu" }));
});

// ---------------------------------------------------------------- seslendirme (sahte Edge)
let sayac = 0;
const yeniIs = p => S.isOlustur(uretim.taban, "birimses" + (++sayac), p);
const log = [], uyarilar = [];
const sessiz = { log: m => log.push(m), uyari: m => uyarilar.push(m), ilerleme: () => {} };
const oku = (dizin, ad) => JSON.parse(fs.readFileSync(path.join(dizin, "Voice", ad), "utf8"));
const partlar = dizin => { try { return fs.readdirSync(path.join(dizin, "Voice", "parts")).sort(); } catch (e) { return []; } };
const PAR = Array.from({ length: 6 }, (_, i) => "Paragraph number " + (i + 1) + " says something quite different from the others here.");

const calistir = (dizin, ek, sahte, ayar) => U.seslendir(Object.assign({
  dizin, ses: "en-US-ChristopherNeural", hiz: "+7%", dil: "en", motorSecimi: "edge", okunus: {},
  env: () => "", enjekte: { msedge: sahte }, ayar: S.hizliAyar(ayar), ...sessiz,
}, ek || {}));

testF("bir paragraf denemeler tukenince dusmez: cikis 4, 'Paragraf 3' yazar, zamanlama.json YAZILMAZ, eski ses bozulmaz", async () => {
  const dizin = yeniIs(PAR.slice(0, 4));
  await calistir(dizin, {}, S.sahteEdge());
  const eskiZam = fs.readFileSync(path.join(dizin, "Voice", "zamanlama.json"), "utf8");
  const eskiParcalar = partlar(dizin);
  assert.equal(eskiParcalar.length, 4);

  // senaryoyu degistir (3. paragraf yeni) ve o paragrafi hep dusur
  const yeni = PAR.slice(0, 4).slice();
  yeni[2] = "A brand new third paragraph that the service refuses to read aloud.";
  fs.writeFileSync(path.join(dizin, "Voice", "SESLENDIRME-TAM-METIN.txt"), yeni.join("\n\n") + "\n");
  const sahte = S.sahteEdge((no, metin) => (/brand new third/.test(metin) ? "hata" : "tam"));
  await assert.rejects(() => calistir(dizin, {}, sahte), e => {
    assert.ok(e instanceof ortak.OrtakHata);
    assert.equal(e.cikis, 4);
    assert.match(e.message, /^Paragraf 3 seslendirilemedi$/);
    return true;
  });
  const bu = sahte.durum.istekler.filter(i => /brand new third/.test(i.metin)).length;
  assert.equal(bu, 5, "5 deneme yapilmali (eskiden 3 deneme + sessiz atlama)");
  assert.equal(fs.readFileSync(path.join(dizin, "Voice", "zamanlama.json"), "utf8"), eskiZam, "eski zamanlama.json degismemeli");
  assert.deepEqual(partlar(dizin), eskiParcalar, "eski parts klasoru bozulmamali");
});

testF("gecici hatalar: kesik ses (kelime <%70) ve asili baglanti yeniden denenir; her denemede YENI baglanti + setMetadata", async () => {
  const dizin = yeniIs(PAR.slice(0, 3));
  const sahte = S.sahteEdge((no, metin) => {
    if (!/number 2 /.test(metin)) return "tam";
    const kacinci = sahte.durum.istekler.filter(i => /number 2 /.test(i.metin)).length;
    return kacinci === 1 ? "kesik" : kacinci === 2 ? "asili" : kacinci === 3 ? "hata" : "tam";
  });
  const r = await calistir(dizin, {}, sahte, { zamanAsimiMs: 700 });       // yuklu makinede sahte sentez (ffmpeg) yavaslasa da 'tam' deneme asilmasin
  assert.equal(r.atlandi, false);
  assert.equal(r.paragrafSayisi, 3);
  assert.ok(sahte.durum.baglanti >= 4, "her yeniden denemede yeni baglanti: " + sahte.durum.baglanti);
  assert.ok(sahte.durum.setMetadata >= sahte.durum.baglanti - 1);
  const z = oku(dizin, "zamanlama.json");
  assert.deepEqual(z.paragraflar.map(p => p.no), [0, 1, 2]);
  const k = oku(dizin, "kelimeler.json");
  for (const p of k.paragraflar) assert.ok(p.kelimeler.length >= 0.7 * PAR[p.no].split(/\s+/).length, "kesik ses kabul edilmemeli");
});

testF("ust uste 3 paragraf dusunce servis kapali sayilir: kalan paragraflar denenmez, cikis 4 ve cozum bunu soyler", async () => {
  const dizin = yeniIs(PAR);
  const sahte = S.sahteEdge(() => "hata");
  await assert.rejects(() => calistir(dizin, {}, sahte), e => {
    assert.equal(e.cikis, 4);
    assert.match(e.message, /Paragraf 1, 2, 3 seslendirilemedi/);
    assert.match(e.cozum, /Servis yanıt vermiyor/);
    return true;
  });
  assert.equal(sahte.durum.istekler.length, 15, "3 paragraf x 5 deneme; kalan 3 paragraf hic denenmez");
  assert.deepEqual(partlar(dizin), []);
  assert.equal(fs.existsSync(path.join(dizin, "Voice", "zamanlama.json")), false);
});

testF("senaryo kisalinca ESKI parca kalmaz (006.mp3 yeni videonun sonuna girmez); parts.tmp artigi yok", async () => {
  const dizin = yeniIs(PAR);
  await calistir(dizin, {}, S.sahteEdge());
  assert.equal(partlar(dizin).length, 6);
  fs.writeFileSync(path.join(dizin, "Voice", "SESLENDIRME-TAM-METIN.txt"), PAR.slice(0, 3).join("\n\n") + "\n");
  await calistir(dizin, {}, S.sahteEdge());
  assert.deepEqual(partlar(dizin), ["000.mp3", "001.mp3", "002.mp3"]);
  assert.equal(oku(dizin, "zamanlama.json").paragrafSayisi, 3);
  assert.equal(fs.existsSync(path.join(dizin, "Voice", "parts.tmp")), false);
  assert.equal(fs.existsSync(path.join(dizin, "Voice", "parts.eski")), false);
});

testF("guncelse atla (ag cagrisi yok); --yeniden zorlar; metin ya da hiz degisince yeniden uretir", async () => {
  const dizin = yeniIs(PAR.slice(0, 3));
  const ilk = S.sahteEdge();
  await calistir(dizin, {}, ilk);
  const adet = ilk.durum.istekler.length;
  assert.equal(adet, 3);
  const atla = await calistir(dizin, {}, ilk);
  assert.deepEqual([atla.atlandi, atla.neden], [true, "ses güncel"]);
  assert.equal(ilk.durum.istekler.length, adet, "atlanan kosuda servis cagrilmamali");
  const zorla = await calistir(dizin, { yeniden: true }, ilk);
  assert.equal(zorla.atlandi, false);
  assert.equal(ilk.durum.istekler.length, adet * 2);
  const hizli = await calistir(dizin, { hiz: "+20%" }, ilk);
  assert.equal(hizli.atlandi, false, "hiz degisti");
});

testF("okunus YALNIZ TTS'e gider: SSML'e kacisli ve hazirlanmis metin, kelimeler.json okunanMetin + metinDegisti, senaryo dosyasi OZGUN kalir", async () => {
  const ozgun = ["Büyüme %15 oldu ve alan 120m² idi.", "AT&T <b>x</b> 5 < 6 and the GPU."];
  const dizin = yeniIs(ozgun);
  const sahte = S.sahteEdge();
  await calistir(dizin, { dil: "tr", ses: "tr-TR-AhmetNeural", okunus: { GPU: "G P U" } }, sahte);
  const gonderilen = sahte.durum.istekler.map(i => i.metin);
  assert.match(gonderilen[0], /yüzde on beş oldu ve alan yüz yirmi metrekare idi\./);
  assert.match(gonderilen[1], /AT&amp;T &lt;b&gt;x&lt;\/b&gt; beş &lt; altı and the G P U/);     // Türkçede rakamlar sözcüğe çevrilir
  assert.ok(gonderilen.every(g => !/<b>|%15|120m²/.test(g)));
  const k = oku(dizin, "kelimeler.json");
  assert.equal(k.paragraflar[0].metinDegisti, true);
  assert.match(k.paragraflar[0].okunanMetin, /yüzde on beş/);
  assert.equal(fs.readFileSync(path.join(dizin, "Voice", "SESLENDIRME-TAM-METIN.txt"), "utf8"), ozgun.join("\n\n") + "\n");
});

testF("1500 karakteri asan paragraf cumle sinirinda bolunur, tek parca olarak birlestirilir (numaralama kaymaz)", async () => {
  const cumleler = Array.from({ length: 36 }, (_, i) => "Sentence number " + (i + 1) + " keeps the paragraph growing steadily.");
  const dizin = yeniIs([cumleler.join(" "), "A short second paragraph."]);
  const sahte = S.sahteEdge();
  await calistir(dizin, {}, sahte);
  const istekler = sahte.durum.istekler.map(i => i.metin);
  assert.ok(istekler.length >= 3, "uzun paragraf bolunmeli: " + istekler.length);
  assert.ok(istekler.every(m => m.length <= 1500), "her istek <= 1500: " + Math.max(...istekler.map(m => m.length)));
  assert.deepEqual(partlar(dizin), ["000.mp3", "001.mp3"]);
  const z = oku(dizin, "zamanlama.json");
  assert.equal(z.paragraflar[0].kelimeSayisi, cumleler.join(" ").split(/\s+/).length);
});

// ---------------------------------------------------------------- komut satiri (alt surec; ag yok)
function seslendirCli(args) {
  const env = Object.assign({}, process.env, { OTOMASYON_URETIM: uretim.taban, OTOMASYON_ENV_DOSYASI: ortam.envDosyasi,
    OTOMASYON_AYAR_DOSYASI: path.join(ortam.dizin, "panel-ayar.json") });
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "seslendir.js"), ...args], { env, encoding: "utf8", timeout: 60000, windowsHide: true });
  return { kod: r.status, out: r.stdout, err: r.stderr };
}

test("seslendir.js CLI: arguman yoksa, is yoksa ya da hiz gecersizse cikis 2 ve Turkce '✗' satiri", () => {
  const a = seslendirCli([]);
  assert.equal(a.kod, 2);
  assert.match(a.err, /✗ /);
  const b = seslendirCli(["olmayan-is-adi"]);
  assert.equal(b.kod, 2);
  assert.match(b.err, /İş bulunamadı/);
  const dizin = yeniIs(["Tek paragraf yeterince uzun bir cumle olsun."]);
  const c = seslendirCli([path.basename(dizin), "en-US-ChristopherNeural", "hizli"]);
  assert.equal(c.kod, 2);
  assert.match(c.err, /Ses hızı geçersiz/);
  const d = seslendirCli(["../disari"]);
  assert.equal(d.kod, 2, "gecersiz is adi (yol kacisi) reddedilir");
  assert.equal(seslendirCli(["--test"]).kod, 2, "--test icin cikti dosyasi sart");
});

test("seslendir.js CLI: bos senaryoda cikis 2, '✗' satiri ve cozum onerisi", () => {
  const dizin = yeniIs(null);
  fs.writeFileSync(path.join(dizin, "Voice", "SESLENDIRME-TAM-METIN.txt"), "\n\n   \n");
  const r = seslendirCli([path.basename(dizin)]);
  assert.equal(r.kod, 2);
  assert.match(r.err, /✗ Seslendirilecek senaryo yok/);
  assert.match(r.err, /↳/);
});

test("ses motoru politikasi sabitleri: >=5 deneme, 2/5/10/20 sn, 45 sn zaman asimi, %70 kelime orani, 1500 karakter", () => {
  assert.equal(MM.VARSAYILAN.denemeSayisi >= 5, true);
  assert.deepEqual(MM.VARSAYILAN.bekleme, [2000, 5000, 10000, 20000]);
  assert.equal(MM.VARSAYILAN.zamanAsimiMs, 45000);
  assert.equal(MM.VARSAYILAN.kelimeOrani, 0.7);
  assert.equal(MM.VARSAYILAN.maksKarakter, 1500);
  assert.equal(U.BOSLUK, 0.35);
  assert.equal(ortak.kelimeHizi("tr"), 113);
});
