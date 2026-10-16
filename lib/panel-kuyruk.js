// PANEL: TOPLU URETIM KUYRUGU — uretim/_kuyruk.json (SOZLESME 6.3).
// Sunucu yeniden baslayinca kuyruk DURAKLATILMIS yuklenir: beklenmedik kredi harcamasi olmasin.
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./ortak");
const { HttpHata } = require("./panel-http");
const yeniIs = require("./panel-yeni-is");

function kuyrukOlustur(cfg) {
  const calistirici = cfg.calistirici;
  const dosya = () => path.join(ortak.uretimDizini(), "_kuyruk.json");
  let durum = { surum: 1, duraklatildi: false, ogeler: [] };
  let yuklu = false;

  function yukle() {
    let o = null, varMi = false;
    try { varMi = fs.existsSync(dosya()); o = ortak.jsonOku(dosya(), null); } catch (e) { o = null; }
    if (o && ortak.duzNesne(o) && Array.isArray(o.ogeler)) {
      durum = { surum: 1, duraklatildi: true, ogeler: o.ogeler.filter(x => x && typeof x.is === "string") };
      // onceki panelin yarim biraktigi isler siraya geri doner (betikler idempotent: kaldigi yerden surer)
      for (const x of durum.ogeler) if (x.durum === "calisiyor") { x.durum = "sirada"; x.runId = null; }
    } else durum = { surum: 1, duraklatildi: varMi ? true : false, ogeler: [] };
    yuklu = true;
    kaydet();
  }
  function kaydet() {
    try { ortak.atomikJsonYaz(dosya(), { surum: 1, duraklatildi: durum.duraklatildi, ogeler: durum.ogeler.map(x => ({ id: x.id, is: x.is, tur: x.tur, eklendi: x.eklendi, durum: x.durum, hata: x.hata || null, onaysiz: !!x.onaysiz })) }); }
    catch (e) { /* disk dolu: bellekteki kuyruk calismaya devam eder */ }
  }
  const aktifSayi = () => durum.ogeler.filter(x => {
    if (x.durum !== "calisiyor") return false;
    const k = x.runId && calistirici.kayitlar.get(x.runId);
    return !k || k.durum === "calisiyor" || k.durum === "sirada";
  }).length;

  function tick() {
    if (!yuklu) yukle();
    if (durum.duraklatildi) return;
    while (aktifSayi() < calistirici.T.zincirMax) {
      const x = durum.ogeler.find(o => o.durum === "sirada");
      if (!x) break;
      try {
        const r = calistirici.baslat("hepsi", { is: x.is }, { onaysiz: x.onaysiz === true, kuyrukId: x.id });
        x.durum = "calisiyor"; x.runId = r.id; x.hata = null;
      } catch (e) {
        x.durum = "hata"; x.hata = e && (e.hata || e.message) || "başlatılamadı";
      }
      kaydet();
    }
    kaydet();
  }
  calistirici.dinle(k => {
    if (!k.kuyrukId) return;
    const x = durum.ogeler.find(o => o.id === k.kuyrukId);
    if (!x) return;
    x.durum = k.durum === "bitti" ? "bitti" : k.durum === "durduruldu" ? "iptal" : "hata";
    x.hata = k.hata ? k.hata.ozet : null;
    kaydet(); tick();
  });

  const liste = () => { if (!yuklu) yukle(); return { surum: 1, duraklatildi: durum.duraklatildi, ogeler: durum.ogeler.map(x => ({ id: x.id, is: x.is, tur: x.tur, eklendi: x.eklendi, durum: x.durum, hata: x.hata || null, onaysiz: !!x.onaysiz })) }; };

  // isler: [{baslik,nis,format,sureDk,dil?,ad?,onaysiz?, ...yeni-is alanlari}]. Once HEPSI dogrulanir; hata varsa hicbir klasor acilmaz.
  function ekle(isListesi, onkontrol) {
    if (!yuklu) yukle();
    if (!Array.isArray(isListesi) || !isListesi.length) throw new HttpHata(400, "bos_liste", "Eklenecek iş listesi boş.");
    if (isListesi.length > 100) throw new HttpHata(400, "cok_is", "Tek seferde en çok 100 iş eklenebilir.");
    const ayar = ortak.ayarOku();
    const sorunlar = [];
    isListesi.forEach((g, i) => {
      if (!ortak.duzNesne(g)) return sorunlar.push({ sira: i + 1, mesaj: "iş bir nesne olmalı" });
      const { hatalar } = yeniIs.girdiDogrula(g, ayar);
      for (const h of hatalar) sorunlar.push({ sira: i + 1, alan: h.alan, mesaj: h.mesaj });
    });
    if (sorunlar.length) throw new HttpHata(400, "girdi", "Listede geçersiz iş var: " + sorunlar.slice(0, 3).map(s => (s.sira) + ". iş — " + s.mesaj).join("; "), { sorunlar });
    if (onkontrol) onkontrol();                          // anahtar/disk/maliyet: hata varsa firlatir, klasor acilmaz
    const eklenen = [], acilan = [];
    try {
      for (const g of isListesi) {
        const r = yeniIs.yeniIs(g, { ayar });
        acilan.push(r.dizin);
        const x = { id: "k" + Date.now().toString(36) + eklenen.length, is: r.ad, tur: "hepsi", eklendi: new Date().toISOString(), durum: "sirada", hata: null, onaysiz: g.onaysiz === true, runId: null };
        durum.ogeler.push(x); eklenen.push({ id: x.id, is: r.ad });
      }
    } catch (e) {
      // ortada patladi (ad cakismasi, disk dolu ...): bu cagrida acilan klasorleri ve kuyruk kayitlarini geri al, yarim liste kalmasin
      for (const d of acilan) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e2) {} }
      const adlar = new Set(eklenen.map(x => x.id));
      durum.ogeler = durum.ogeler.filter(x => !adlar.has(x.id));
      if (e instanceof yeniIs.GirdiHatasi) throw new HttpHata(e.durum || 400, e.kod, e.message, { alanlar: e.alanlar });
      throw e;
    }
    kaydet(); tick();
    return eklenen;
  }
  function iptal(is) {
    if (!yuklu) yukle();
    const x = durum.ogeler.find(o => o.is === is && (o.durum === "sirada" || o.durum === "calisiyor"));
    if (!x) throw new HttpHata(404, "kuyruk_yok", "Bu iş kuyrukta bekliyor ya da çalışıyor değil.");
    if (x.durum === "calisiyor" && x.runId) calistirici.durdur(x.runId);
    x.durum = "iptal"; kaydet(); tick();
    return true;
  }
  function duraklat() { if (!yuklu) yukle(); durum.duraklatildi = true; kaydet(); }
  function devam() { if (!yuklu) yukle(); durum.duraklatildi = false; kaydet(); tick(); }

  return { yukle, liste, ekle, iptal, duraklat, devam, tick };
}

module.exports = { kuyrukOlustur };
