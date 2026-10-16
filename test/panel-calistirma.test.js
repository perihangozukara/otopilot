// Panel calistirici (gercek surec + sahte betikler): zincir, onay durağı, is kilidi 409, global slot, Durdur, yedek motor,
// durum.json, mutlak log numarasi, yetim surecler, bosta izleyici, kuyruk. Ucretli servise/aga dokunmaz.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const Y = require("./panel-yardim");

const bekle = ms => new Promise(r => setTimeout(r, ms));
const oku = (o, rel) => fs.readFileSync(path.join(o.uretim, rel), "utf8");
const cagrilar = (o, is) => { try { return oku(o, is + "/_cagrilar.txt").trim().split("\n"); } catch (e) { return []; } };
const durumDosyasi = (o, is) => JSON.parse(oku(o, is + "/durum.json"));
async function bekleKosul(fn, ms, aciklama) {
  const bas = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - bas > (ms || 10000)) throw new Error("zaman asimi: " + (aciklama || "")); await bekle(60); }
}
async function yeniIs(c, ek) { const r = await c.post("/api/yeni", Object.assign({ baslik: "Test video" }, ek || {})); assert.equal(r.durum, 200, r.metin); return r.json.ad; }
function anahtarYaz(o, icerik) { fs.writeFileSync(o.env, icerik); }

let ortam, panel, c;
test.before(async () => {
  ortam = Y.geciciOrtam("calis");
  anahtarYaz(ortam, "# kullanici yorumu\nANTHROPIC_API_KEY=sk-test-0000\n");
  panel = await Y.panelBaslat(ortam);
  c = panel.istemci;
});
test.after(async () => { if (panel) await panel.kapat(); if (ortam) ortam.temizle(); });

test("hepsi zinciri: senaryo -> ONAY DURAGI -> gorsel -> ses -> video; durum.json adimlari, mutlak log numarasi, log dosyasi", async () => {
  const ad = await yeniIs(c, { baslik: "Zincir testi" });
  const r = await c.post("/api/calistir", { tur: "hepsi", is: ad });
  assert.equal(r.durum, 200); assert.equal(r.json.is, ad);
  const id = r.json.id;
  let l = await c.bekle(id, ["onay_bekliyor", "bitti", "hata"]);
  assert.equal(l.durum, "onay_bekliyor", "senaryo bu kosuda uretildi: kullanici onayi beklenmeli");
  assert.equal(l.bitti, false);
  assert.deepEqual(cagrilar(ortam, ad).map(x => x.split(" ")[0]), ["senaryo-claude.js"], "onaydan once yalniz senaryo calismali");
  const cal = (await c.get("/api/calisanlar")).json;
  const k = cal.calisanlar.find(x => x.id === id);
  assert.ok(k, "onay bekleyen is calisanlar listesinde"); assert.equal(k.durum, "onay_bekliyor"); assert.equal(k.is, ad); assert.equal(k.adimToplam, 4);
  assert.equal(durumDosyasi(ortam, ad).son.durum, "onay_bekliyor");
  assert.equal(durumDosyasi(ortam, ad).adimlar[1].durum, "onay", "siradaki adim 'onay' isaretli");
  // onay beklerken ayni isin yeni zinciri 409
  let r2 = await c.post("/api/calistir", { tur: "hepsi", is: ad });
  assert.equal(r2.durum, 409); assert.equal(r2.json.kod, "onay_bekliyor");
  r2 = await c.post("/api/onayla", { is: "olmayan-is" }); assert.equal(r2.durum, 404);
  r2 = await c.post("/api/onayla", { is: ad });
  assert.equal(r2.durum, 200); assert.equal(r2.json.ok, true);
  l = await c.bekle(id, ["bitti", "hata"]);
  assert.equal(l.durum, "bitti", JSON.stringify(l.satirlar.slice(-4))); assert.equal(l.kod, 0); assert.equal(l.yuzde, 100); assert.equal(l.hata, null);
  assert.deepEqual(cagrilar(ortam, ad).map(x => x.split(" ")[0]), ["senaryo-claude.js", "gorsel-bul.js", "seslendir.js", "video-yap.js"]);
  const d = durumDosyasi(ortam, ad);
  assert.equal(d.surum, 1); assert.equal(d.is, ad); assert.equal(d.son.durum, "bitti"); assert.equal(d.son.kod, 0); assert.equal(d.son.hata, null); assert.ok(d.son.bitis);
  assert.deepEqual(d.adimlar.map(a => a.ad), ["senaryo", "gorsel", "ses", "video"]);
  assert.ok(d.adimlar.every(a => a.durum === "bitti" && a.kod === 0 && a.yuzde === 100 && a.baslangic && a.bitis));
  // mutlak, artan satir numaralari + ara parametresi
  const nler = l.satirlar.map(s => s.n);
  assert.deepEqual(nler, nler.slice().sort((a, b) => a - b)); assert.equal(new Set(nler).size, nler.length);
  assert.equal(l.sonN, nler[nler.length - 1]);
  const yarim = (await c.get("/api/log?id=" + id + "&ara=" + nler[3])).json;
  assert.equal(yarim.satirlar[0].n, nler[4]); assert.equal(yarim.kesildi, false);
  assert.ok(l.satirlar.every(s => typeof s.t === "string" && "tip" in s));
  assert.ok(l.satirlar.some(s => s.tip === "ok") && l.satirlar.some(s => s.tip === "cmd"));
  assert.ok(l.satirlar.every(s => !s.t.startsWith("@@")), "@@ satirlari ham metin olarak gosterilmez");
  // is listesi ozeti
  const liste = (await c.get("/api/isler")).json.isler.find(x => x.ad === ad);
  assert.equal(liste.durum, "bitti"); assert.equal(liste.senaryo, true); assert.equal(liste.gorsel, 1); assert.equal(liste.sesTamam, true); assert.equal(liste.sesParca, 2);
  // gunluk dosyasi
  await bekleKosul(() => fs.existsSync(path.join(ortam.uretim, ad, "_log")) && fs.readdirSync(path.join(ortam.uretim, ad, "_log")).length, 3000, "log dosyasi");
  const lf = fs.readdirSync(path.join(ortam.uretim, ad, "_log"))[0];
  assert.match(lf, /^\d{8}-\d{6}-hepsi\.log$/);
  await bekleKosul(() => /ZİNCİR TAMAM/.test(oku(ortam, ad + "/_log/" + lf)), 3000, "log icerigi");
  assert.equal(fs.existsSync(path.join(ortam.uretim, ad, ".kilit")), false);
});

test("onay beklerken sahne duzenlemesi: tekli gorsel kosusu serbest; kosu surerken onayla 409 verir ama onay hakki KAYBOLMAZ", async () => {
  const ad = await yeniIs(c, { baslik: "Onay duzenleme" });
  const r = await c.post("/api/calistir", { tur: "hepsi", is: ad });
  assert.equal((await c.bekle(r.json.id, ["onay_bekliyor", "hata"])).durum, "onay_bekliyor");
  Y.ISE_YAZ(ortam, ad, { bekle: { "gorsel-bul.js": 1200 } });
  const g = await c.post("/api/calistir", { tur: "gorselSahne", is: ad, sahne: 1, ara: "yeni ifade" });
  assert.equal(g.durum, 200, "onay bekleyen islerde sahne yeniden arama serbest olmali");
  assert.match(cagrilar(ortam, ad).join("|") + "|", /senaryo-claude\.js/);
  await bekleKosul(() => cagrilar(ortam, ad).some(x => /--sahne 1 --ara yeni ifade/.test(x)), 5000, "sahne aramasi basladi");
  const o1 = await c.post("/api/onayla", { is: ad });
  assert.equal(o1.durum, 409); assert.equal(o1.json.kod, "is_calisiyor");
  assert.equal((await c.get("/api/calisanlar")).json.calisanlar.find(x => x.id === r.json.id).durum, "onay_bekliyor", "onay bekleyen kayit korunmali");
  await c.bekle(g.json.id, ["bitti", "hata"]);
  Y.ISE_YAZ(ortam, ad, {});
  const o2 = await c.post("/api/onayla", { is: ad });
  assert.equal(o2.durum, 200, o2.metin);
  assert.equal((await c.bekle(r.json.id, ["bitti", "hata"])).durum, "bitti");
  // diskteki son gunluk (panel yeniden baslamis olsa da okunabilir)
  const gun = (await c.get("/api/gunluk?is=" + ad + "&satir=5")).json;
  assert.match(gun.dosya, /^\d{8}-\d{6}-.*\.log$/); assert.ok(gun.satirlar.length >= 1 && gun.satirlar.length <= 5);
  assert.equal((await c.get("/api/gunluk?is=..")).durum, 400);
});

test("is kilidi: ayni is icin ikinci kosu 409 {kod:'is_calisiyor', id}; calisirken gorsel silinmez/arsivlenmez/temizlenmez", async () => {
  const ad = await yeniIs(c, { baslik: "Kilit testi" });
  Y.ISE_YAZ(ortam, ad, { bekle: { "gorsel-bul.js": 1500 } });
  const r1 = await c.post("/api/calistir", { tur: "gorsel", is: ad });
  assert.equal(r1.durum, 200);
  const r2 = await c.post("/api/calistir", { tur: "gorsel", is: ad });
  assert.equal(r2.durum, 409); assert.equal(r2.json.kod, "is_calisiyor"); assert.equal(r2.json.id, r1.json.id); assert.equal(typeof r2.json.hata, "string");
  assert.equal((await c.post("/api/calistir", { tur: "hepsi", is: ad })).json.kod, "is_calisiyor");
  assert.equal((await c.post("/api/gorsel-sil", { is: ad, sahne: "001-a", ad: "01.jpg" })).json.kod, "is_calisiyor");
  assert.equal((await c.post("/api/is-arsivle", { is: ad })).json.kod, "is_calisiyor");
  assert.equal((await c.post("/api/temizle", { is: ad, tur: "ara" })).json.kod, "is_calisiyor");
  const cal = (await c.get("/api/calisanlar")).json.calisanlar.find(x => x.is === ad);
  assert.equal(cal.durum, "calisiyor"); assert.equal(cal.tur, "gorsel"); assert.ok(cal.gecenSn >= 0);
  const l = await c.bekle(r1.json.id, ["bitti", "hata"]); assert.equal(l.durum, "bitti");
  // bitince yeniden baslatilabilir
  assert.equal((await c.post("/api/calistir", { tur: "gorsel", is: ad })).durum, 200);
  await bekleKosul(async () => !(await c.get("/api/calisanlar")).json.calisanlar.some(x => x.is === ad), 5000, "kosu bitisi");
});

test("farkli isler paralel kosabilir; video adimi GLOBAL tek slot: ikincisi 'sirada' bekler", async () => {
  const a = await yeniIs(c, { baslik: "Slot A" }), b = await yeniIs(c, { baslik: "Slot B" });
  Y.ISE_YAZ(ortam, a, { bekle: { "video-yap.js": 1500 } }); Y.ISE_YAZ(ortam, b, { bekle: { "video-yap.js": 300 } });
  const ra = await c.post("/api/calistir", { tur: "video", is: a });
  await bekleKosul(() => cagrilar(ortam, a).length === 1, 5000, "A basladi");
  const rb = await c.post("/api/calistir", { tur: "video", is: b });
  assert.equal(rb.durum, 200);
  const cal = (await c.get("/api/calisanlar")).json.calisanlar;
  assert.equal(cal.find(x => x.is === a).durum, "calisiyor");
  await bekleKosul(async () => (await c.get("/api/calisanlar")).json.calisanlar.find(x => x.is === b)?.durum === "sirada", 3000, "B sirada");
  assert.equal(cagrilar(ortam, b).length, 0, "ikinci video islemi slot bosalmadan baslamamali");
  assert.equal((await c.bekle(ra.json.id, ["bitti", "hata"])).durum, "bitti");
  assert.equal((await c.bekle(rb.json.id, ["bitti", "hata"])).durum, "bitti");
  assert.equal(cagrilar(ortam, b).length, 1);
});

test("zincir sayisi en cok 2: ucuncu zincir 'sirada' bekler, slot bosalinca kendiliginden baslar", async () => {
  const isler = [];
  for (const n of ["A", "B", "C"]) { const ad = await yeniIs(c, { baslik: "Zincir " + n, onay: { senaryo: false } }); isler.push(ad); Y.ISE_YAZ(ortam, ad, { bekle: { "senaryo-claude.js": 900 } }); }
  const idler = [];
  for (const ad of isler) idler.push((await c.post("/api/calistir", { tur: "hepsi", is: ad })).json.id);
  await bekleKosul(async () => { const k = (await c.get("/api/calisanlar")).json.calisanlar; return k.length === 3; }, 3000, "3 kayit");
  const cal = (await c.get("/api/calisanlar")).json.calisanlar;
  assert.deepEqual(cal.map(x => x.durum).sort(), ["calisiyor", "calisiyor", "sirada"]);
  for (const id of idler) assert.equal((await c.bekle(id, ["bitti", "hata"], 20000)).durum, "bitti");
});

test("Durdur: surec agaci oldurulur, .part dosyalari temizlenir, durum 'durduruldu'; sonra tekrar baslatilabilir", async () => {
  const ad = await yeniIs(c, { baslik: "Durdur testi" });
  Y.ISE_YAZ(ortam, ad, { bekle: { "seslendir.js": 20000 } });
  fs.writeFileSync(path.join(ortam.uretim, ad, "Voice", "SESLENDIRME-TAM-METIN.txt"), "Birinci paragraf yeterince uzun bir cumle olsun diye yaziliyor.\n\nIkinci paragraf.\n");
  const r = await c.post("/api/calistir", { tur: "ses", is: ad });
  const part = path.join(ortam.uretim, ad, "Videos", "yarim.part.mp4");
  await bekleKosul(() => fs.existsSync(part), 8000, "betik .part yazdi");
  const d = await c.post("/api/durdur", { id: r.json.id });
  assert.equal(d.json.ok, true);
  const l = await c.bekle(r.json.id, ["durduruldu", "bitti", "hata"], 10000);
  assert.equal(l.durum, "durduruldu"); assert.equal(l.iptal, true); assert.equal(l.bitti, true);
  assert.ok(l.satirlar.some(s => /DURDURULDU/.test(s.t)));
  await bekleKosul(() => !fs.existsSync(part), 4000, ".part temizlendi");
  assert.equal(durumDosyasi(ortam, ad).son.durum, "durduruldu");
  assert.equal((await c.post("/api/durdur", { id: r.json.id })).json.ok, false, "bitmis kosu tekrar durdurulamaz");
  Y.ISE_YAZ(ortam, ad, {});
  const r2 = await c.post("/api/calistir", { tur: "ses", is: ad });
  assert.equal(r2.durum, 200);
  assert.equal((await c.bekle(r2.json.id, ["bitti", "hata"])).durum, "bitti");
});

test("hata: zincir durur, durum.json ve log 'hata' nesnesi tasir (kod/ozet/cozum); sonraki adimlar CALISMAZ", async () => {
  const ad = await yeniIs(c, { baslik: "Hata testi", onay: { senaryo: false } });
  Y.ISE_YAZ(ortam, ad, { hata: { "seslendir.js": 4 } });
  const r = await c.post("/api/calistir", { tur: "hepsi", is: ad });
  const l = await c.bekle(r.json.id, ["bitti", "hata", "onay_bekliyor"]);
  assert.equal(l.durum, "hata"); assert.equal(l.kod, 4); assert.equal(l.bitti, true);
  assert.deepEqual(l.hata, { kod: "sahte", ozet: "seslendir.js sahte hata verdi", cozum: "sahte cozum", detay: l.hata.detay });
  assert.deepEqual(cagrilar(ortam, ad).map(x => x.split(" ")[0]), ["senaryo-claude.js", "gorsel-bul.js", "seslendir.js"]);
  const d = durumDosyasi(ortam, ad);
  assert.equal(d.son.durum, "hata"); assert.equal(d.son.hata.kod, "sahte");
  assert.deepEqual(d.adimlar.map(a => a.durum), ["bitti", "bitti", "hata", "bekliyor"]);
  assert.ok(l.satirlar.some(s => s.tip === "err" && /HATA/.test(s.t)));
  assert.equal((await c.get("/api/isler")).json.isler.find(x => x.ad === ad).sonHata.kod, "sahte");
  assert.equal(fs.existsSync(path.join(ortam.uretim, ad, ".kilit")), false);
  // hata sonrasi tekrar denenebilir (kilit kalmadi)
  Y.ISE_YAZ(ortam, ad, {});
  const r2 = await c.post("/api/calistir", { tur: "hepsi", is: ad });
  assert.equal((await c.bekle(r2.json.id, ["bitti", "hata"])).durum, "bitti");
});

test("sifirdan farkli cikis kodlari Turkce acikla: kod 3/5/7 ve ham metin cevirisi", async () => {
  const ad = await yeniIs(c, { baslik: "Kod testi", onay: { senaryo: false } });
  // @@HATA yok, yalniz stderr metni: hataCevir devreye girer (ffmpeg yok)
  fs.writeFileSync(path.join(ortam.betik, "gorsel-bul.js"), "console.error('Error: spawn ffmpeg ENOENT'); process.exit(1);\n");
  try {
    Y.ISE_YAZ(ortam, ad, {});
    const r = await c.post("/api/calistir", { tur: "gorsel", is: ad });
    const l = await c.bekle(r.json.id, ["hata", "bitti"]);
    assert.equal(l.durum, "hata"); assert.equal(l.hata.kod, "ffmpeg_yok"); assert.match(l.hata.ozet, /ffmpeg/); assert.ok(l.hata.cozum);
    fs.writeFileSync(path.join(ortam.betik, "gorsel-bul.js"), "process.exit(7);\n");
    const r2 = await c.post("/api/calistir", { tur: "gorsel", is: ad });
    const l2 = await c.bekle(r2.json.id, ["hata", "bitti"]);
    assert.equal(l2.hata.kod, "maliyet"); assert.equal(l2.kod, 7);
    fs.writeFileSync(path.join(ortam.betik, "gorsel-bul.js"), "process.exit(5);\n");
    const r3 = await c.post("/api/calistir", { tur: "gorsel", is: ad });
    assert.equal((await c.bekle(r3.json.id, ["hata", "bitti"])).hata.kod, "disk_dolu");
  } finally { fs.writeFileSync(path.join(ortam.betik, "gorsel-bul.js"), fs.readFileSync(path.join(ortam.betik, "video-yap.js"))); }
});

test("senaryo yedek motoru: Claude servis hatasi (kod 3) verirse vidIQ denenir ve zincir surer; yedek yoksa zincir durur", async () => {
  anahtarYaz(ortam, "ANTHROPIC_API_KEY=sk-test\nVIDIQ_KEY=vq-test\n");
  const ad = await yeniIs(c, { baslik: "Yedek testi", onay: { senaryo: false } });
  Y.ISE_YAZ(ortam, ad, { hata: { "senaryo-claude.js": 3, "baslik-analiz.js": 1 } });
  const r = await c.post("/api/calistir", { tur: "hepsi", is: ad });
  const l = await c.bekle(r.json.id, ["bitti", "hata"], 20000);
  assert.equal(l.durum, "bitti", JSON.stringify(l.hata) + JSON.stringify(l.satirlar.slice(-6)));
  const c1 = cagrilar(ortam, ad).map(x => x.split(" ")[0]);
  assert.deepEqual(c1.slice(0, 3), ["baslik-analiz.js", "senaryo-claude.js", "senaryo-yaz.js"], "baslik-on (istege bagli, hata) -> claude (3) -> vidIQ yedek");
  assert.ok(l.satirlar.some(s => /yedek motor/.test(s.t)));
  assert.ok(l.satirlar.some(s => /isteğe bağlı adım/.test(s.t)), "istege bagli adim hatasi zinciri durdurmaz, uyari yazar");
  const d = durumDosyasi(ortam, ad);
  assert.equal(d.adimlar.find(a => a.ad === "baslik-on").durum, "hata");
  assert.equal(d.adimlar.find(a => a.ad === "senaryo").durum, "bitti");
  assert.equal(d.adimlar.find(a => a.ad === "video").durum, "bitti");
  // yalniz Claude anahtari: yedek yok, kod 3 zinciri durdurur
  anahtarYaz(ortam, "ANTHROPIC_API_KEY=sk-test\n");
  const ad2 = await yeniIs(c, { baslik: "Yedeksiz", onay: { senaryo: false } });
  Y.ISE_YAZ(ortam, ad2, { hata: { "senaryo-claude.js": 3 } });
  const r2 = await c.post("/api/calistir", { tur: "hepsi", is: ad2 });
  const l2 = await c.bekle(r2.json.id, ["bitti", "hata"]);
  assert.equal(l2.durum, "hata"); assert.equal(l2.kod, 3);
  assert.deepEqual(cagrilar(ortam, ad2).map(x => x.split(" ")[0]), ["senaryo-claude.js"]);
  anahtarYaz(ortam, "# kullanici yorumu\nANTHROPIC_API_KEY=sk-test-0000\n");
});

test("atla: betik @@SONUC atlandi dondururse adim 'atlandi' isaretlenir ve zincir sürer", async () => {
  const ad = await yeniIs(c, { baslik: "Atla testi", onay: { senaryo: false } });
  Y.ISE_YAZ(ortam, ad, { atla: { "gorsel-bul.js": true } });
  const r = await c.post("/api/calistir", { tur: "hepsi", is: ad });
  const l = await c.bekle(r.json.id, ["bitti", "hata"]);
  assert.equal(l.durum, "bitti");
  const d = durumDosyasi(ortam, ad);
  assert.equal(d.adimlar.find(a => a.ad === "gorsel").durum, "atlandi");
  assert.ok(l.satirlar.some(s => /atlandı/.test(s.t)));
});

test("senaryo dolu: ucretli senaryo adimi zincire girmez; 'senaryo' turu 409 senaryo_var, onay:true ile gecer; bastan senaryoyu yeniden yazmaz", async () => {
  const ad = await yeniIs(c, { baslik: "Dolu senaryo" });
  fs.writeFileSync(path.join(ortam.uretim, ad, "Voice", "SESLENDIRME-TAM-METIN.txt"), "Zaten yazilmis bir senaryo metni; elli karakterden uzun olmali, evet uzun.\n");
  let r = await c.post("/api/calistir", { tur: "senaryo", is: ad });
  assert.equal(r.durum, 409); assert.equal(r.json.kod, "senaryo_var"); assert.ok(r.json.cozum);
  r = await c.post("/api/calistir", { tur: "hepsi", is: ad, bastan: true });
  const l = await c.bekle(r.json.id, ["bitti", "hata", "onay_bekliyor"]);
  assert.equal(l.durum, "bitti", "senaryo uretilmedigi icin onay duragi yok");
  const cg = cagrilar(ortam, ad);
  assert.deepEqual(cg.map(x => x.split(" ")[0]), ["gorsel-bul.js", "seslendir.js", "video-yap.js"]);
  assert.ok(cg.every(x => /--yeniden/.test(x)), "bastan:true -> gorsel/ses/video --yeniden alir: " + cg.join(" | "));
  r = await c.post("/api/calistir", { tur: "senaryo", is: ad, onay: true });
  assert.equal(r.durum, 200);
  assert.equal((await c.bekle(r.json.id, ["bitti", "hata"])).durum, "bitti");
});

test("onkontrol: anahtarsiz /api/yeni uret:true 400 anahtar_yok ve KLASOR ACILMAZ; yeni anahtarla acilir ve zincir baslar", async () => {
  anahtarYaz(ortam, "");
  const once = fs.readdirSync(ortam.uretim).length;
  let r = await c.post("/api/yeni", { baslik: "Anahtarsiz", uret: true });
  assert.equal(r.durum, 400); assert.equal(r.json.kod, "anahtar_yok"); assert.ok(Array.isArray(r.json.sorunlar) && r.json.sorunlar.some(s => s.kod === "anahtar_yok"));
  assert.equal(fs.readdirSync(ortam.uretim).length, once, "geride bos is birakilmamali");
  const on = (await c.get("/api/onkontrol?tur=hepsi")).json;
  assert.equal(on.ok, false); assert.equal(on.anahtarlar.claude, false); assert.equal(on.anahtarlar.vidiq, false);
  assert.equal(typeof on.diskBosGB, "number"); assert.equal(on.maliyetTahmin.not, "tahmin");
  // anahtari panelden ekle (otomatik test kapali ortamda test:{})
  r = await c.post("/api/anahtarlar", { ayarla: { ANTHROPIC_API_KEY: "sk-yeni-1234" } });
  assert.equal(r.durum, 200); assert.equal(r.json.ok, true);
  r = await c.post("/api/yeni", { baslik: "Anahtarli", uret: true, onay: { senaryo: false } });
  assert.equal(r.durum, 200); assert.ok(r.json.id);
  assert.equal((await c.bekle(r.json.id, ["bitti", "hata"])).durum, "bitti");
  anahtarYaz(ortam, "# kullanici yorumu\nANTHROPIC_API_KEY=sk-test-0000\n");
});

test("maliyet sinirlari: panel-ayar'daki gunluk limit asilacaksa calistir 400 'maliyet'; /api/maliyet kullanim.json'dan toplar", async () => {
  const ad = await yeniIs(c, { baslik: "Maliyet testi" });
  const simdi = new Date().toISOString();
  fs.writeFileSync(path.join(ortam.uretim, ad, "kullanim.json"), JSON.stringify({ surum: 1, kayitlar: [
    { zaman: simdi, betik: "senaryo-claude.js", saglayici: "anthropic", model: "claude-opus-5", giris: 1, cikis: 1, kredi: 0, usd: 0.5 },
    { zaman: simdi, betik: "baslik-analiz.js", saglayici: "vidiq", model: "", giris: 0, cikis: 0, kredi: 12, usd: 0 },
    { zaman: "2020-01-01T00:00:00.000Z", betik: "x", saglayici: "anthropic", usd: 9 }], toplamUSD: 9.5, toplamKredi: 12 }));
  let m = (await c.get("/api/maliyet")).json;
  assert.equal(m.claude.bugunUSD, 0.5); assert.equal(m.claude.ayUSD, 0.5); assert.equal(m.vidiq.bugunKredi, 12); assert.equal(m.tahmin.not, "tahmin");
  assert.deepEqual(m.claude.limit, { gunlukUSD: null, aylikUSD: null, isBasinaUSD: null });
  let r = await c.post("/api/ayarlar", { maliyet: { gunlukUSD: 0.55 } });
  assert.equal(r.durum, 200);
  r = await c.post("/api/calistir", { tur: "hepsi", is: ad });
  assert.equal(r.durum, 400); assert.equal(r.json.kod, "maliyet"); assert.match(r.json.hata, /Günlük/);
  r = await c.post("/api/yeni", { baslik: "Limitli", uret: true });
  assert.equal(r.json.kod, "maliyet");
  r = await c.post("/api/ayarlar", { maliyet: { gunlukUSD: null, isBasinaUSD: 0.5 } });
  r = await c.post("/api/calistir", { tur: "hepsi", is: ad });
  assert.equal(r.json.kod, "maliyet", "is basina sinir");
  await c.post("/api/ayarlar", { maliyet: { isBasinaUSD: null } });
  assert.equal((await c.get("/api/onkontrol?tur=hepsi&is=" + ad)).json.ok, true);
});

test("kuyruk: toplu ekleme (once dogrulama), iki serit, duraklat/devam, iptal; hatali listede hicbir klasor acilmaz", async () => {
  const once = fs.readdirSync(ortam.uretim).length;
  let r = await c.post("/api/kuyruk/ekle", { isler: [{ baslik: "iyi" }, { baslik: "", format: "mp4" }] });
  assert.equal(r.durum, 400); assert.equal(r.json.kod, "girdi"); assert.ok(r.json.sorunlar.length >= 1);
  r = await c.post("/api/kuyruk/ekle", { isler: [] }); assert.equal(r.durum, 400);
  assert.equal(fs.readdirSync(ortam.uretim).length, once);
  anahtarYaz(ortam, "");
  r = await c.post("/api/kuyruk/ekle", { isler: [{ baslik: "anahtarsiz" }] });
  assert.equal(r.durum, 400); assert.equal(r.json.kod, "anahtar_yok");
  assert.equal(fs.readdirSync(ortam.uretim).length, once, "on kontrol hatasinda klasor acilmaz");
  anahtarYaz(ortam, "ANTHROPIC_API_KEY=sk-test\n");
  await c.post("/api/kuyruk/duraklat");
  r = await c.post("/api/kuyruk/ekle", { isler: [{ baslik: "Kuyruk bir", onaysiz: true }, { baslik: "Kuyruk iki", onaysiz: true }, { baslik: "Kuyruk uc", onaysiz: true }] });
  assert.equal(r.durum, 200); assert.equal(r.json.eklenen.length, 3);
  const k = (await c.get("/api/kuyruk")).json;
  assert.equal(k.surum, 1); assert.equal(k.duraklatildi, true);
  assert.ok(k.ogeler.filter(x => x.durum === "sirada").length >= 3);
  await bekle(400);
  assert.equal(cagrilar(ortam, r.json.eklenen[0].is).length, 0, "duraklatilmis kuyruk islem baslatmamali");
  const iptalAd = r.json.eklenen[2].is;
  assert.equal((await c.post("/api/kuyruk/iptal", { is: iptalAd })).durum, 200);
  assert.equal((await c.post("/api/kuyruk/iptal", { is: iptalAd })).durum, 404);
  await c.post("/api/kuyruk/devam");
  for (const e of r.json.eklenen.slice(0, 2))
    await bekleKosul(async () => (await c.get("/api/kuyruk")).json.ogeler.find(x => x.is === e.is)?.durum === "bitti", 20000, e.is + " bitti");
  const son = (await c.get("/api/kuyruk")).json.ogeler;
  assert.equal(son.find(x => x.is === iptalAd).durum, "iptal");
  assert.equal(cagrilar(ortam, iptalAd).length, 0, "iptal edilen is calismamali");
  assert.equal(durumDosyasi(ortam, r.json.eklenen[0].is).son.durum, "bitti");
  assert.deepEqual((await c.get("/api/calisanlar")).json.kuyruk, []);
  anahtarYaz(ortam, "# kullanici yorumu\nANTHROPIC_API_KEY=sk-test-0000\n");
});

test("bosta izleyici: cikti vermeyen surec belirlenen surede sonlandirilir ve 'takildi' hatasi verilir", async () => {
  const o2 = Y.geciciOrtam("bosta");
  fs.writeFileSync(o2.env, "ANTHROPIC_API_KEY=sk-test\n");
  const p2 = await Y.panelBaslat(o2, { env: { PANEL_BOSTA_UYARI_SN: "1", PANEL_BOSTA_OLDUR_SN: "3", PANEL_VIDEO_BOSTA_OLDUR_SN: "3", PANEL_KONTROL_MS: "200" } });
  try {
    const c2 = p2.istemci;
    const ad = (await c2.post("/api/yeni", { baslik: "Takili" })).json.ad;
    Y.ISE_YAZ(o2, ad, { sessiz: { "gorsel-bul.js": true } });
    const r = await c2.post("/api/calistir", { tur: "gorsel", is: ad });
    const l = await c2.bekle(r.json.id, ["hata", "bitti", "durduruldu"], 15000);
    assert.equal(l.durum, "hata"); assert.equal(l.hata.kod, "takildi");
    assert.ok(l.satirlar.some(s => /takılmış olabilir/.test(s.t)), "once uyari satiri");
    assert.ok(l.satirlar.some(s => /sonlandırılıyor/.test(s.t)));
  } finally { await p2.kapat(); o2.temizle(); }
});

test("bosta izleyici: satir sonu olmadan ('\\r' ile ustune yazan) surekli cikti veren surec 'takildi' SAYILMAZ ve oldurulmez", async () => {
  const o2 = Y.geciciOrtam("cr");
  fs.writeFileSync(o2.env, "ANTHROPIC_API_KEY=sk-test\n");
  // 9 x 0.4 sn = 3.6 sn boyunca yalniz '\r' ile ilerleme yazar (satir sonu yok); olduruldu esigi 2 sn
  fs.writeFileSync(path.join(o2.betik, "gorsel-bul.js"),
    'let i=0;const t=setInterval(()=>{process.stdout.write("klip "+(++i)+"/9\\r");if(i>=9){clearInterval(t);console.log("");console.log("@@SONUC {\\"tamam\\":true}");}},400);');
  const p2 = await Y.panelBaslat(o2, { env: { PANEL_BOSTA_UYARI_SN: "1", PANEL_BOSTA_OLDUR_SN: "2", PANEL_VIDEO_BOSTA_OLDUR_SN: "2", PANEL_KONTROL_MS: "200" } });
  try {
    const c2 = p2.istemci;
    const ad = (await c2.post("/api/yeni", { baslik: "Canli ilerleme" })).json.ad;
    const r = await c2.post("/api/calistir", { tur: "gorsel", is: ad });
    const l = await c2.bekle(r.json.id, ["hata", "bitti", "durduruldu"], 15000);
    assert.equal(l.durum, "bitti", JSON.stringify(l.hata));
    assert.ok(!l.satirlar.some(s => /takılmış olabilir|sonlandırılıyor/.test(s.t)), "cikti geldigi surece takildi uyarisi yok");
  } finally { await p2.kapat(); o2.temizle(); }
});

test("baslangic taramasi: canli pid'li .kilit 'yetim' olarak listelenir ve durdurulabilir; olu pid'li kilit ve yarim durum.json temizlenir", async () => {
  const o2 = Y.geciciOrtam("yetim");
  const yetim = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
  try {
    const mk = (is, kilit, durum) => {
      fs.mkdirSync(path.join(o2.uretim, is, "Voice"), { recursive: true }); fs.mkdirSync(path.join(o2.uretim, is, "Videos"), { recursive: true });
      fs.writeFileSync(path.join(o2.uretim, is, "konu.json"), JSON.stringify({ baslik_en: is }));
      if (kilit) fs.writeFileSync(path.join(o2.uretim, is, ".kilit"), JSON.stringify(kilit));
      if (durum) fs.writeFileSync(path.join(o2.uretim, is, "durum.json"), JSON.stringify(durum));
      fs.writeFileSync(path.join(o2.uretim, is, "Videos", "x.part.mp4"), "yarim");
    };
    mk("canli", { pid: yetim.pid, baslangic: new Date().toISOString(), komut: "video-yap.js" }, null);
    mk("olu", { pid: 2147480000, baslangic: "x", komut: "video-yap.js" }, { surum: 1, is: "olu", son: { tur: "hepsi", id: "r1", durum: "calisiyor", baslangic: "x", bitis: null, kod: null, hata: null }, adimlar: [{ ad: "video", durum: "calisiyor" }] });
    const p2 = await Y.panelBaslat(o2);
    try {
      const c2 = p2.istemci;
      const cal = (await c2.get("/api/calisanlar")).json.calisanlar;
      const y = cal.find(x => x.is === "canli");
      assert.ok(y && y.yetim === true && y.durum === "calisiyor", JSON.stringify(cal));
      assert.equal(cal.find(x => x.is === "olu"), undefined);
      assert.equal(fs.existsSync(path.join(o2.uretim, "olu", ".kilit")), false, "olu pid'in kilidi silinmeli");
      assert.equal(fs.existsSync(path.join(o2.uretim, "olu", "Videos", "x.part.mp4")), false, "yarim .part temizlenmeli");
      assert.equal(JSON.parse(fs.readFileSync(path.join(o2.uretim, "olu", "durum.json"), "utf8")).son.durum, "durduruldu");
      assert.equal(JSON.parse(fs.readFileSync(path.join(o2.uretim, "olu", "durum.json"), "utf8")).son.hata.kod, "panel_kapandi");
      assert.equal(fs.existsSync(path.join(o2.uretim, "canli", "Videos", "x.part.mp4")), true, "canli sureclerin dosyalarina dokunulmaz");
      // yetim olan ise yeni kosu 409
      const r = await c2.post("/api/calistir", { tur: "gorsel", is: "canli" });
      assert.equal(r.durum, 409); assert.equal(r.json.kod, "is_calisiyor"); assert.equal(r.json.id, "y-canli");
      const d = await c2.post("/api/durdur", { id: "y-canli" });
      assert.equal(d.json.ok, true);
      await bekleKosul(() => yetim.exitCode !== null || yetim.signalCode !== null, 6000, "yetim surec olmeli");
      await bekleKosul(async () => !(await c2.get("/api/calisanlar")).json.calisanlar.some(x => x.is === "canli"), 4000, "yetim listeden duser");
    } finally { await p2.kapat(); }
  } finally { try { yetim.kill(); } catch (e) {} o2.temizle(); }
});

test("kuyruk yeniden baslayinca DURAKLATILMIS yuklenir; yarim kalan isler siraya geri doner; devam ile surer", async () => {
  const o2 = Y.geciciOrtam("kuyruk2");
  fs.writeFileSync(o2.env, "ANTHROPIC_API_KEY=sk-test\n");
  for (const is of ["q1", "q2"]) {
    fs.mkdirSync(path.join(o2.uretim, is, "Voice"), { recursive: true });
    fs.writeFileSync(path.join(o2.uretim, is, "konu.json"), JSON.stringify({ baslik_en: is, onay: { senaryo: false } }));
    fs.writeFileSync(path.join(o2.uretim, is, "Voice", "SESLENDIRME-TAM-METIN.txt"), "Hazir bir senaryo metni; elli karakterden uzun olsun diye biraz daha yaziyorum.\n");
  }
  fs.writeFileSync(path.join(o2.uretim, "_kuyruk.json"), JSON.stringify({ surum: 1, duraklatildi: false, ogeler: [
    { id: "k1", is: "q1", tur: "hepsi", eklendi: "x", durum: "calisiyor", hata: null, onaysiz: true }, { id: "k2", is: "q2", tur: "hepsi", eklendi: "x", durum: "sirada", hata: null, onaysiz: true }] }));
  const p2 = await Y.panelBaslat(o2);
  try {
    const c2 = p2.istemci;
    const k = (await c2.get("/api/kuyruk")).json;
    assert.equal(k.duraklatildi, true, "beklenmedik kredi harcamasi olmasin diye");
    assert.deepEqual(k.ogeler.map(x => x.durum), ["sirada", "sirada"]);
    await bekle(500);
    assert.equal(fs.existsSync(path.join(o2.uretim, "q1", "_cagrilar.txt")), false);
    assert.equal((await c2.post("/api/kuyruk/devam")).durum, 200);
    await bekleKosul(async () => (await c2.get("/api/kuyruk")).json.ogeler.every(x => x.durum === "bitti"), 20000, "kuyruk bitti");
    assert.equal(JSON.parse(fs.readFileSync(path.join(o2.uretim, "_kuyruk.json"), "utf8")).duraklatildi, false);
  } finally { await p2.kapat(); o2.temizle(); }
});

test("panel kapaninca onay bekleyen is: durum.json 'onay_bekliyor' ise onayla kalan adimlari yeniden kurar", async () => {
  const o2 = Y.geciciOrtam("onay2");
  fs.writeFileSync(o2.env, "ANTHROPIC_API_KEY=sk-test\n");
  const p1 = await Y.panelBaslat(o2);
  let ad;
  try {
    ad = (await p1.istemci.post("/api/yeni", { baslik: "Onay yeniden" })).json.ad;
    const r = await p1.istemci.post("/api/calistir", { tur: "hepsi", is: ad });
    assert.equal((await p1.istemci.bekle(r.json.id, ["onay_bekliyor", "hata"])).durum, "onay_bekliyor");
  } finally { await p1.kapat(); }
  const p2 = await Y.panelBaslat(o2);
  try {
    const c2 = p2.istemci;
    assert.equal(JSON.parse(fs.readFileSync(path.join(o2.uretim, ad, "durum.json"), "utf8")).son.durum, "onay_bekliyor");
    const r = await c2.post("/api/onayla", { is: ad });
    assert.equal(r.durum, 200, r.metin);
    const l = await c2.bekle(r.json.id, ["bitti", "hata"]);
    assert.equal(l.durum, "bitti");
    assert.deepEqual(cagrilar(o2, ad).map(x => x.split(" ")[0]), ["senaryo-claude.js", "gorsel-bul.js", "seslendir.js", "video-yap.js"]);
  } finally { await p2.kapat(); o2.temizle(); }
});
