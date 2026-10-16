// PANEL: ON KONTROL + MALIYET GORUNURLUGU (SOZLESME 6.6: /api/onkontrol, /api/maliyet).
// Maliyet verisi her isin kullanim.json dosyasindan okunur (yazan: senaryo betikleri). Tahminler "tahmin"dir, fatura degil.
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./ortak");
const komutlar = require("./panel-komutlar");
const isler = require("./panel-isler");

const yerelTarih = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

function isAdlari() {
  try { return fs.readdirSync(ortak.uretimDizini(), { withFileTypes: true }).filter(d => d.isDirectory() && ortak.guvenliAd(d.name)).map(d => d.name); }
  catch (e) { return []; }
}
const kullanimOku = is => isler.jsonSessiz(path.join(ortak.uretimDizini(), is, "kullanim.json"), null);

// Bugun / bu ay / is basina toplamlar (USD ve kredi)
function toplamlar(simdi) {
  simdi = simdi || new Date();
  const bugun = yerelTarih(simdi), ay = bugun.slice(0, 7);
  const t = { bugunUSD: 0, ayUSD: 0, bugunKredi: 0, ayKredi: 0, isler: {} };
  for (const is of isAdlari()) {
    const k = kullanimOku(is);
    if (!k || !Array.isArray(k.kayitlar)) continue;
    let isUSD = 0, isKredi = 0;
    for (const r of k.kayitlar) {
      const z = new Date(r.zaman);
      if (isNaN(z.getTime())) continue;
      const g = yerelTarih(z);
      const usd = Number(r.usd) || 0, kredi = Number(r.kredi) || 0;
      isUSD += usd; isKredi += kredi;
      if (g === bugun) { t.bugunUSD += usd; t.bugunKredi += kredi; }
      if (g.slice(0, 7) === ay) { t.ayUSD += usd; t.ayKredi += kredi; }
    }
    t.isler[is] = { usd: isUSD, kredi: isKredi };
  }
  const y = x => Math.round(x * 10000) / 10000;
  t.bugunUSD = y(t.bugunUSD); t.ayUSD = y(t.ayUSD);
  return t;
}

// Tek senaryo icin kaba maliyet tahmini. giris/cikis token tahmini: 1 kelime ~ 1.4 token; ana hat + iddia gecisi payi %20
// ceviriUSD: ayni senaryonun altyazi cevirisi (altyazi-cevir.js, Claude): giris kelime*2+1500, cikis kelime*2 token (betikteki hesapla ayni)
function tahmin(hedefSn, dil, ayar) {
  const kelime = Math.max(30, hedefSn / 60 * ortak.kelimeHizi(dil));
  const model = (ayar && ayar.claudeModel) || "claude-opus-5";
  const f = (ayar && ayar.fiyat && ayar.fiyat[model]) || { giris: 5, cikis: 25 };
  const cikis = kelime * 1.4 * 1.2;
  const giris = 3500 + cikis * 0.8;
  const usd = Math.max(0.01, Math.round((giris * f.giris + cikis * f.cikis) / 1e6 * 100) / 100);
  const ceviriUSD = Math.max(0.01, Math.round(((kelime * 2 + 1500) * f.giris + kelime * 2 * f.cikis) / 1e6 * 100) / 100);
  return { usd, ceviriUSD, vidiqCagri: Math.max(1, Math.ceil(kelime / 700)), model, not: "tahmin" };
}

// Zincirde altyazi cevirisi (altyazi-cevir.js → Claude anahtari + para) gerekecek mi? Betigin KENDI atlama kararinin aynisi:
// diller ayniysa ya da Voice/ALTYAZI-XX.txt var, senaryoyla ayni paragraf sayisinda ve senaryodan yeniyse ceviri yapilmaz (anahtar da
// aranmaz). Senaryo bu kosuda (yeniden) yazilacaksa eski ceviri bayat kalacagindan ceviri kesin gerekir.
function ceviriGerekliMi(is, dil, altyaziDili, senaryoYazilacak) {
  if (typeof dil !== "string" || typeof altyaziDili !== "string" || !altyaziDili || altyaziDili === dil) return false;
  if (senaryoYazilacak || !is || !ortak.guvenliAd(is)) return true;
  try {
    const voice = path.join(ortak.uretimDizini(), is, "Voice");
    const kaynak = path.join(voice, "SESLENDIRME-TAM-METIN.txt"), hedef = path.join(voice, "ALTYAZI-" + altyaziDili.toUpperCase() + ".txt");
    if (!fs.existsSync(kaynak) || !fs.existsSync(hedef)) return true;
    const guncel = fs.statSync(hedef).mtimeMs >= fs.statSync(kaynak).mtimeMs;
    const ayniSayi = ortak.paragraflaraBol(fs.readFileSync(hedef, "utf8")).length === ortak.paragraflaraBol(fs.readFileSync(kaynak, "utf8")).length;
    return !(guncel && ayniSayi);
  } catch (e) { return true; }
}
// Henuz acilmamis bir isin (istek govdesi) etkin dili/altyazi dili: panel-yeni-is.girdiDogrula ile ayni varsayilanlar
function yeniGirdiDilleri(b, ayar) {
  b = ortak.duzNesne(b) ? b : {};
  const dil = typeof b.dil === "string" && b.dil ? b.dil : ((ayar && ayar.dil) || "en");
  const alt = typeof b.altyaziDili === "string" && b.altyaziDili ? b.altyaziDili : dil;
  return { dil, alt };
}

// Ozet ekran verisi. vidiqBakiye: disaridan (agdan) verilir ya da null.
function maliyetOzeti(ayar, vidiqBakiye) {
  const t = toplamlar();
  const m = (ayar && ayar.maliyet) || {};
  return {
    claude: { bugunUSD: t.bugunUSD, ayUSD: t.ayUSD, limit: { gunlukUSD: m.gunlukUSD != null ? m.gunlukUSD : null, aylikUSD: m.aylikUSD != null ? m.aylikUSD : null, isBasinaUSD: m.isBasinaUSD != null ? m.isBasinaUSD : null } },
    vidiq: { bakiye: vidiqBakiye != null ? vidiqBakiye : null, bugunKredi: t.bugunKredi, ayKredi: t.ayKredi },
    tahmin: tahmin(900, ayar && ayar.dil || "en", ayar), isler: t.isler,
  };
}

// Baslamadan once kontrol listesi. girdi: {tur, is, b?, ayar?, anahtarVar?}. -> {ok, sorunlar, anahtarlar, diskBosGB, maliyetTahmin}
function onkontrol(g) {
  const ayar = g.ayar || ortak.ayarOku();
  const anahtarVar = g.anahtarVar || (ad => !!ortak.envOku(ad));
  const tur = g.tur || "hepsi", is = g.is || null;
  const sorunlar = [];
  const anahtarlar = { claude: anahtarVar("ANTHROPIC_API_KEY"), vidiq: anahtarVar("VIDIQ_KEY"), pexels: anahtarVar("PEXELS_KEY"), pixabay: anahtarVar("PIXABAY_KEY") };
  const bos = ortak.diskBosGB(ortak.uretimDizini());
  const esik = typeof ayar.diskEsikGB === "number" ? ayar.diskEsikGB : 5;
  let konu = null, etkin = null;
  if (is && ortak.guvenliAd(is)) {
    try { konu = ortak.konuHam(is); if (konu) etkin = ortak.konuBirlestir(konu, ayar, is); }
    catch (e) { sorunlar.push({ kod: "konu_bozuk", seviye: "hata", mesaj: e.message, cozum: "Panelde Ham ayarlar kutusunu aç ve JSON'u düzelt." }); }
  }
  const zincir = tur === "hepsi" || tur === "devam";
  const senaryoMetni = zincir && is && ortak.guvenliAd(is) ? isler.oku(path.join(ortak.uretimDizini(), is, "Voice", "SESLENDIRME-TAM-METIN.txt")).trim() : "";
  const senaryoYok = zincir && (!is || senaryoMetni.length < 50);
  // Altyazi cevirisi (Claude): tek is icin konu.json'dan ya da (henuz acilmamis isse) istek govdesinden; toplu eklemede girdiler listesinden.
  // Zincirde altyaziDili != dil ise 'ceviri' adimi eklenir ve Claude anahtari ister; onceden bakilmazsa senaryo uretilip onaylandiktan SONRA
  // altyazi-cevir.js anahtar yok diye (cikis 2) duserdi. Betigin kendi atlama kararinin aynisi (ceviri guncelse anahtar aranmaz).
  const yeniD = yeniGirdiDilleri(g.b, ayar);
  const dilEtkin = etkin ? etkin.dil : yeniD.dil, altEtkin = etkin ? etkin.altyaziDili : yeniD.alt;
  let ceviriAdet = 0;
  if (zincir || tur === "ceviri") {
    if (Array.isArray(g.girdiler)) ceviriAdet = g.girdiler.filter(x => { const d = yeniGirdiDilleri(x, ayar); return ceviriGerekliMi(null, d.dil, d.alt, true); }).length;
    else ceviriAdet = ceviriGerekliMi(is, dilEtkin, altEtkin, senaryoYok) ? 1 : 0;
  }
  if (senaryoYok && !komutlar.senaryoMotoru(ayar, anahtarVar))
    sorunlar.push({ kod: "anahtar_yok", seviye: "hata", mesaj: "Senaryo yazmak için Claude veya vidIQ anahtarı gerekir; ya da senaryoyu kendin yazıp Senaryo kutusuna yapıştır.",
      cozum: "Kaynaklar sekmesinden Anthropic (Claude) ya da vidIQ anahtarı gir." });
  if (komutlar.SENARYO_YAZAN.has(tur) && !komutlar.senaryoMotoru(ayar, anahtarVar))
    sorunlar.push({ kod: "anahtar_yok", seviye: "hata", mesaj: "Senaryo yazmak için Claude veya vidIQ anahtarı gerekir.", cozum: "Kaynaklar sekmesinden bir anahtar gir." });
  if (["baslik", "baslikOn", "trend", "viral", "performans"].includes(tur) && !anahtarlar.vidiq)
    sorunlar.push({ kod: "anahtar_yok", seviye: "hata", mesaj: "Bu işlem için vidIQ anahtarı gerekir.", cozum: "Kaynaklar sekmesinden vidIQ anahtarını gir." });
  if (ceviriAdet > 0 && !anahtarlar.claude)
    sorunlar.push({ kod: "anahtar_yok", seviye: "hata", mesaj: "Altyazı çevirisi için Anthropic (Claude) anahtarı gerekir (altyazı dili anlatım dilinden farklı).",
      cozum: "Kaynaklar sekmesinden Claude anahtarını gir ya da altyazı dilini anlatım diliyle aynı yap." });
  if (komutlar.DISK_GEREKLI.has(tur) && bos !== null && bos < esik)
    sorunlar.push({ kod: "disk", seviye: "hata", mesaj: "Diskte yalnızca " + bos + " GB boş yer var; en az " + esik + " GB gerekli.", cozum: "Disk alanı aç (Disk bölümünden ara dosyaları temizle)." });
  const hedefSn = etkin ? etkin.hedefSaniye : 900, dil = dilEtkin;
  const tah = tahmin(hedefSn, dil, ayar);
  const adet = Math.max(1, Math.floor(Number(g.adet)) || 1);          // toplu eklemede her is icin ayri harcama
  // Bu islemde ODENECEK kisim: senaryo yazimi (zincirde yalniz yazilacaksa; tek 'ceviri' isinde hic) + gerekiyorsa altyazi cevirisi.
  const senaryoPay = zincir ? (senaryoYok ? tah.usd : 0) : (tur === "ceviri" ? 0 : tah.usd);
  const ceviriPay = tah.ceviriUSD * ceviriAdet;
  // maliyet limitleri (panel-ayar)
  const ucretli = zincir ? (senaryoYok || ceviriAdet > 0)
    : tur === "ceviri" ? ceviriAdet > 0
    : ["senaryo", "senaryoV", "baslik", "baslikOn", "trend", "viral", "performans"].includes(tur);
  const tahUSD = Math.round((ucretli ? senaryoPay * adet + ceviriPay : tah.usd * adet) * 100) / 100;
  if (ucretli) {
    const m = ayar.maliyet || {}, t = toplamlar();
    if (m.gunlukUSD != null && t.bugunUSD + (anahtarlar.claude ? tahUSD : 0) > m.gunlukUSD)
      sorunlar.push({ kod: "maliyet", seviye: "hata", mesaj: "Günlük harcama sınırı aşılacak (bugün $" + t.bugunUSD.toFixed(2) + ", sınır $" + m.gunlukUSD + ").", cozum: "Ayarlardan günlük sınırı yükselt ya da yarını bekle." });
    if (m.aylikUSD != null && t.ayUSD + (anahtarlar.claude ? tahUSD : 0) > m.aylikUSD)
      sorunlar.push({ kod: "maliyet", seviye: "hata", mesaj: "Aylık harcama sınırı aşılacak (bu ay $" + t.ayUSD.toFixed(2) + ", sınır $" + m.aylikUSD + ").", cozum: "Ayarlardan aylık sınırı yükselt." });
    const isSinir = etkin && typeof etkin.maliyetUstSinirUSD === "number" ? etkin.maliyetUstSinirUSD : (m.isBasinaUSD != null ? m.isBasinaUSD : null);
    if (isSinir != null && is) {
      const harcanan = (t.isler[is] && t.isler[is].usd) || 0;
      if (harcanan + (anahtarlar.claude ? senaryoPay + ceviriPay : 0) > isSinir)       // isBasina: tek isin harcamasi
        sorunlar.push({ kod: "maliyet", seviye: "hata", mesaj: "Bu iş için maliyet sınırı aşılacak (harcanan $" + harcanan.toFixed(2) + ", sınır $" + isSinir + ").", cozum: "Sınırı yükselt ya da işi küçült." });
    }
  }
  // "hepsi" zincirinin ücretli adımları: arayüz başlatmadan önce tek satır onayda bunları sayar. Zincir (lib/panel-komutlar.js
  // zincirAdimlari) ile aynı koşulları izler: vidIQ anahtarı varsa başlık adımları senaryo VAR olsa bile eklenir (isteğe bağlı ama
  // kredi harcar; betik sonucu güncelse harcamaz), senaryo yoksa yazım, altyazı dili farklıysa Claude çevirisi.
  const ucretliAdimlar = [];
  if (zincir) {
    const et = ad => komutlar.ADIM_ETIKET[ad] || ad;
    if (anahtarlar.vidiq) ucretliAdimlar.push({ ad: "baslik-on", etiket: et("baslik-on"), saglayici: "vidIQ", istegeBagli: true, not: "sonuç zaten güncelse kredi harcanmaz" });
    if (senaryoYok) {
      const m = komutlar.senaryoMotoru(ayar, anahtarVar);
      if (m) ucretliAdimlar.push({ ad: "senaryo", etiket: et("senaryo"), saglayici: m.betik === "senaryo-claude.js" ? "Claude" : "vidIQ", istegeBagli: false, not: null });
    }
    if (ceviriAdet > 0 && !Array.isArray(g.girdiler))      // yeni is (konu.json henuz yok) icin de: dil/altyaziDili istek govdesinden
      ucretliAdimlar.push({ ad: "ceviri", etiket: et("ceviri"), saglayici: "Claude", istegeBagli: false, not: null });
    if (anahtarlar.vidiq) ucretliAdimlar.push({ ad: "baslik", etiket: et("baslik"), saglayici: "vidIQ", istegeBagli: true, not: "sonuç zaten güncelse kredi harcanmaz" });
  }
  if (zincir && !anahtarlar.pexels && !anahtarlar.pixabay)
    sorunlar.push({ kod: "gorsel_anahtar", seviye: "uyari", mesaj: "Pexels/Pixabay anahtarı yok; görseller yalnızca Wikimedia, Openverse ve NASA'dan gelir (kalite/isabet düşebilir).", cozum: "İsteğe bağlı: Kaynaklar sekmesinden ücretsiz bir Pexels anahtarı gir." });
  if (etkin && etkin.kanal === "KANALIM")
    sorunlar.push({ kod: "kanal_varsayilan", seviye: "uyari", mesaj: "Kanal adı hâlâ KANALIM; videoda bu yazı çıkar.", cozum: "Kanal ayarından kanal adını gir." });
  return { ok: !sorunlar.some(s => s.seviye === "hata"), sorunlar, anahtarlar, diskBosGB: bos, ucretliAdimlar,
    maliyetTahmin: { usd: tahUSD, vidiqCagri: tah.vidiqCagri * adet, not: "tahmin" } };
}

module.exports = { toplamlar, tahmin, maliyetOzeti, onkontrol, kullanimOku };
