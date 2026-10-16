// GORSEL BULMA AKISI (GO grubu) — gorsel-bul.js'in cekirdegi. Sozlesme bolum 3.
//
//   senaryo -> kanonik paragraflar -> sahneler (kisa paragraflar komsuyla birlesir, HICBIRI dusmez)
//   her sahne: arama ifadeleri (elle > gorsel-aramalari.json > otomatik) -> 5 kaynak paralel -> LISANS suzgeci
//              -> ALAKA puani (+ kara liste, yon/oran, silinenler, tekrar onleme) -> indir -> DOGRULA (sihirli bayt,
//              25 MB, gercek cozunurluk) -> Visuals/<NNN-kelime>/NN.jpg + manifest.json + ATIF.txt
//   artimli: manifest senaryoyla eslesiyorsa yeterli sahneye dokunmaz, eksigi doldurur; senaryo degistiyse eski
//            klasorleri Visuals/_eski-<damga>/ altina tasir (arsivler SILINMEZ; --arsiv-temizle acik onayla en yeni 2'yi
//            birakir); --yeniden temizden baslar; bozuk manifestte klasorler diskten sahnelere yeniden baglanir
//   --sahne N --ara: yalniz o sahne; eski gorseller kenara alinir, yeni arama yetmezse GERI KONUR (sahne bosalmaz)
//   basarisizlik: hic gorsel yok / sahnelerin <%70'i dolu / toplam <6 -> exit 4 (kaynaklar hic yanit vermediyse 3)
// Ag, kaynak istemcileri, uretici ve bekleme `bag` ile enjekte edilebilir (testler gercek aga CIKMAZ).
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./ortak.js");
const ag = require("./gorsel-ag.js");
const sorgu = require("./gorsel-sorgu.js");
const puanModul = require("./gorsel-puan.js");
const { dogrula } = require("./gorsel-dogrula.js");
const indirModul = require("./gorsel-indir.js");
const man = require("./gorsel-manifest.js");
const { lisansCoz } = require("./gorsel-lisans.js");
const { KaynakYonetici, ADLAR } = require("./gorsel-kaynak.js");

const OrtakHata = ortak.OrtakHata;
const uyku = ms => new Promise(r => setTimeout(r, ms));
// Pexels locale kodlari (yalnizca otomatik cikarilan, senaryo dilindeki aramalarda kullanilir)
const LOCALE = { tr: "tr-TR", en: "en-US", es: "es-ES", de: "de-DE", fr: "fr-FR", it: "it-IT", pt: "pt-BR", ru: "ru-RU",
  nl: "nl-NL", pl: "pl-PL", ja: "ja-JP", ko: "ko-KR" };

const kisalt = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

// ---------------------------------------------------------------- --sahne yeniden aramasi: kenara al / geri yukle
// Mevcut gorseller _eski-<damga>/<klasor>/ altina TASINIR (silinmez). Yeni arama yeterli gorsel getirmezse geri konur:
// yazim hatali --ara sahneyi bosaltmasin. -> {dizin, kayitlar:[{kayit, ad}], aramalar, kullanilanArama, durum}
function sahneyiKenaraAl(P, s, damga, gorulenSha) {
  const dizin = path.join(P.VIS, "_eski-" + damga, s.klasor);
  fs.mkdirSync(dizin, { recursive: true });
  const kayitlar = [], kalan = [];
  for (const g of s.gorseller) {
    const kaynak = path.resolve(P.VIS, String(g.dosya || ""));
    if (!ortak.yolIcinde(P.VIS, kaynak)) { kalan.push(g); continue; }
    // ayni saniyede ikinci yeniden arama ayni arsiv klasorunu kullanir: var olan arsiv dosyasinin UZERINE yazma (rename Windows'ta ezer)
    const uz = path.extname(kaynak);
    let hedef = path.join(dizin, path.basename(kaynak));
    for (let k = 2; fs.existsSync(hedef) && k < 1000; k++) hedef = path.join(dizin, path.basename(kaynak, uz) + "-" + k + uz);
    try { fs.renameSync(kaynak, hedef); kayitlar.push({ kayit: g, ad: path.basename(hedef) }); }
    catch (e) { if (e.code !== "ENOENT") kalan.push(g); }         // dosya zaten yoksa kayit duser; tasinamayan sahnede kalir
  }
  s.gorseller = kalan;
  for (const it of kayitlar) if (it.kayit.sha1) gorulenSha.delete(it.kayit.sha1);
  return { dizin, kayitlar, aramalar: s.aramalar.slice(), kullanilanArama: s.kullanilanArama, durum: s.durum };
}

// Sahnede en az `hedefSayi` gorsel olana dek eski gorselleri (kendi sirasiyla) geri koyar; Infinity = hepsini. Yeni aramada
// ayni icerik (sha1) zaten geldiyse eskisi atlanir. Arsiv klasoru bosalirsa kaldirilir. -> geri konan sayi
function sahneyiGeriYukle(P, s, yedek, hedefSayi, gorulenSha) {
  const var_ = new Set(s.gorseller.map(g => g.sha1).filter(Boolean));
  let geri = 0;
  for (const it of yedek.kayitlar) {
    if (it.geri) continue;
    if (s.gorseller.length >= hedefSayi) break;
    if (it.kayit.sha1 && var_.has(it.kayit.sha1)) continue;
    try {
      man.gorselGeriKoy(P, s, path.join(yedek.dizin, it.ad), it.kayit);
      it.geri = true; geri++;
      if (it.kayit.sha1) { gorulenSha.add(it.kayit.sha1); var_.add(it.kayit.sha1); }
    } catch (e) { /* tasinamayan gorsel arsivde kalir */ }
  }
  try { fs.rmdirSync(yedek.dizin); fs.rmdirSync(path.dirname(yedek.dizin)); } catch (e) { /* bos degil: baska sahne/gorsel arsivde */ }
  return geri;
}

// ---------------------------------------------------------------- arama ifadeleri
// -> {liste:[...], kaynak:"elle"|"claude"|"otomatik", aiIstem:""}
function aramalariBelirle(info, baglam) {
  const { konu, aramalarHarita, otomatik } = baglam;
  const s = info.s;
  const elle = Array.isArray(konu.sahneKelimeleri) ? konu.sahneKelimeleri[s.no - 1] : null;
  const elleListe = elle == null ? [] : (Array.isArray(elle) ? elle : [elle]).map(x => String(x).trim()).filter(Boolean);
  if (elleListe.length) return { liste: elleListe.slice(0, 8), kaynak: "elle", aiIstem: "" };

  if (aramalarHarita) {
    // sahnenin paragraflarinin listeleri BIRLESTIRILIR: once her paragrafin 1. ifadesi, sonra 2.'leri (her paragraf temsil edilsin)
    const listeler = s.paragraflar.map(i => (aramalarHarita.get(i) || { aramalar: [] }).aramalar);
    const birlesik = [];
    const en = Math.max(0, ...listeler.map(l => l.length));
    for (let k = 0; k < en; k++) for (const l of listeler) if (l[k] && !birlesik.includes(l[k])) birlesik.push(l[k]);
    const aiIstem = s.paragraflar.map(i => (aramalarHarita.get(i) || {}).uret).find(Boolean) || "";
    if (birlesik.length || aiIstem) {
      return { liste: birlesik.length ? birlesik.slice(0, 8) : otomatik(info), kaynak: birlesik.length ? "claude" : "otomatik", aiIstem };
    }
  }
  return { liste: otomatik(info), kaynak: "otomatik", aiIstem: "" };
}

// ---------------------------------------------------------------- ana akis
async function calistir(o, bag) {
  bag = bag || {};
  const is = o.is;
  const log = bag.log || (m => console.log(m));
  const uyari = bag.uyari || ortak.uyari;
  const bekle = bag.bekle || uyku;
  const P = man.yollar(is);                                   // gecersiz is adi -> OrtakHata (exit 2)
  if (!fs.existsSync(P.BASE)) throw new OrtakHata("is_yok", "İş bulunamadı: " + is, { cikis: ortak.CIKIS.GIRDI, cozum: "İş adını kontrol et ya da panelden yeni iş aç." });
  if (o.ara && !o.sahne) throw new OrtakHata("arguman", "--ara için --sahne <no> de verilmeli.", { cikis: ortak.CIKIS.GIRDI, cozum: 'Örnek: node gorsel-bul.js ' + is + ' --sahne 3 --ara "polar bear"' });

  ortak.kilitAl(is, "gorsel-bul");
  const konu = ortak.konuEtkin(is) || {};                     // bozuksa OrtakHata konu_bozuk (exit 2): sessizce varsayilana dusme
  const dil = String(konu.dil || "en").toLowerCase();
  const dikey = konu.dikey !== undefined ? !!konu.dikey : (konu.aspect === "9:16" || ["short", "reels", "tiktok"].includes(konu.format));
  const yon = dikey ? "dikey" : "yatay";

  const sen = man.senaryoOku(is);
  if (sen.metin.length < 50)
    throw new OrtakHata("senaryo_yok", "Senaryo yok ya da çok kısa; görsel aranamaz.", { cikis: ortak.CIKIS.GIRDI,
      cozum: "Önce senaryoyu yaz (panelde Senaryo adımı) ya da Voice/SESLENDIRME-TAM-METIN.txt dosyasını doldur." });
  ortak.diskKontrol(P.BASE, 1);

  const ayar = ortak.ayarOku();
  const ortamBekle = ortak.envOku("GORSEL_LIMIT_BEKLE_SN");          // .env'e ya da ortama yazilabilir (gece toplu isi icin: 3600)
  const limitBekleSn = o.limitBekleSn !== undefined ? o.limitBekleSn
    : (ortamBekle && Number.isFinite(Number(ortamBekle)) && Number(ortamBekle) >= 0 ? Number(ortamBekle) : 30);
  const getir = bag.getir || ag.istemciYap({ limitBekleSn });
  const anahtarlar = bag.anahtarlar || { pexels: ortak.envOku("PEXELS_KEY"), pixabay: ortak.envOku("PIXABAY_KEY") };
  const yonetici = bag.yonetici || new KaynakYonetici({ getir, anahtarlar, etkin: ayar.kaynaklar, istemciler: bag.istemciler, log, uyari, bekle: bag.bekleKaynak, aralik: bag.aralik });
  if (yonetici.tumuKapaliMi())
    throw new OrtakHata("kaynak_yok", "Hiçbir görsel kaynağı açık değil.", { cikis: ortak.CIKIS.GIRDI,
      cozum: "Panel > Kaynaklar sekmesinden en az bir kaynağı aç (Wikimedia, Openverse ve NASA anahtar istemez)." });

  // ---- plan / manifest
  const pl = man.planYukle({ is, kanonik: sen.paragraflar, ozet: sen.ozet, dil, yon, kisa: dikey, yeniden: !!o.yeniden, log, uyari });
  if (o.arsivTemizle) man.arsivleriTemizle(P.VIS, uyari);        // yalniz kullanici --arsiv-temizle dediyse (acik onay)
  const M = pl.manifest;
  M.dil = dil; M.hedefYon = yon;
  const damga = ortak.damga();

  const sahneler = M.sahneler.filter(s => s.paragraflar.length).map(s => {
    const metin = s.paragraflar.map(i => sen.paragraflar[i]).join(" ");
    return { s, metin, kelime: sorgu.kelimeSay(metin) };
  });
  const kelimeHizi = ortak.kelimeHizi(dil);
  const adetler = sorgu.sahneAdetleri(sahneler, { kelimeHizi, kisa: dikey });
  const hamKelime = sen.metin.split(/\s+/).filter(Boolean).length;
  const sure = hamKelime / kelimeHizi * 60;

  // ---- otomatik cikarim baglami (yalnizca yedek)
  const kucuk = sorgu.kucukSozluk(sen.metin, dil);
  const genelSayim = {};
  for (const w of sorgu.kelimeler(sen.metin, dil)) genelSayim[w] = (genelSayim[w] || 0) + 1;
  const toplamKelime = Object.values(genelSayim).reduce((a, b) => a + b, 0) || 1;
  const paragrafta = {};
  for (const x of sahneler) for (const w of new Set(sorgu.kelimeler(x.metin, dil))) paragrafta[w] = (paragrafta[w] || 0) + 1;
  const capa = sorgu.genelCapa(sen.metin, sahneler.map(x => x.metin), { dil, kucuk });
  const kozmik = sorgu.kozmikMi(sen.metin);
  const aramalarHarita = man.aramalariOku(is, sen.ozet, uyari);
  const ikiliGenel = sorgu.ikiliSayimlari(sen.metin, dil);
  const otomatik = info => {
    const l = sorgu.ifadeCikar(info.metin, { dil, genelSayim, toplamKelime, capa, paragrafta, kucuk, ikiliGenel });
    if (!l.length) l.push(capa[0] || "abstract");
    return l;
  };
  const baglam = { konu, aramalarHarita, otomatik };

  // sahne basina arama listesi + hedef gorsel adedi ("uret:" sahnelerinde hedef = uretAdet)
  const uretAdeti = Math.max(1, Math.min(6, Number(konu.uretAdet) || 2));
  const arHarita = new Map(), adetHarita = new Map();
  sahneler.forEach((x, i) => {
    const ar = aramalariBelirle(x, baglam);
    arHarita.set(x.s.no, ar);
    adetHarita.set(x.s.no, /^uret:/i.test(ar.liste[0]) ? uretAdeti : adetler[i]);
  });
  const hedefToplam = [...adetHarita.values()].reduce((a, b) => a + b, 0);

  // ---- tekrar onleme / silinenler
  const silinen = man.silinenleriOku(is, uyari);
  const gorulenUrl = new Set(), gorulenSha = new Set();
  const redUrl = new Set();                                     // bu calismada icerigi uygunsuz cikan adaylar: sahne basina yeniden indirilmez
  for (const s of M.sahneler) for (const g of s.gorseller) {
    if (g.indirmeUrl) gorulenUrl.add(puanModul.kanonikUrl(g.indirmeUrl));
    if (g.kaynakUrl) gorulenUrl.add(puanModul.kanonikUrl(g.kaynakUrl));
    if (g.sha1) gorulenSha.add(g.sha1);
  }

  log("senaryo   : " + sahneler.length + " sahne (" + sen.paragraflar.length + " paragraf) · " + hamKelime + " kelime · ~" +
      Math.floor(sure / 60) + " dk " + Math.round(sure % 60) + " sn · dil " + dil + " · " + yon);
  log("hedef     : ~" + hedefToplam + " görsel (sahne başına 2–14)");
  log("konu çapa : " + (capa.join(" · ") || "-"));
  log("kaynaklar : " + (yonetici.aktifler().map(a => ADLAR[a]).join(" + ") || "(hiçbiri açık)") +
      (kozmik ? "  [uzay konusu: NASA öncelikli]" : ""));
  log("");

  const hedefSahneler = o.sahne ? sahneler.filter(x => x.s.no === o.sahne) : sahneler;
  if (o.sahne && !hedefSahneler.length)
    throw new OrtakHata("sahne_yok", "Sahne " + o.sahne + " yok (1–" + sahneler.length + " arası).", { cikis: ortak.CIKIS.GIRDI });

  const sayac = { indirilen: 0, atlanan: 0, ai: 0 };
  const kaynakGelen = {};
  const reddedilenToplam = {};
  const indirmeHata = {};                                       // kaynak -> ardisik indirme hatasi
  let uretici = null;
  const ureticiAl = () => { if (!uretici) uretici = bag.uretici || require("../gorsel-uret.js"); return uretici; };

  // ---- aday listesini puanla / ele
  const adaylariPuanla = (adaylar, q, aramaDili, kozSahne, elenme, ek) => {
    const sorguTok = puanModul.sorguTokenleri(q, aramaDili);
    const cikti = [];
    for (const a of adaylar) {
      const k1 = puanModul.kanonikUrl(a.indirmeUrl || a.url), k2 = puanModul.kanonikUrl(a.kaynakUrl);
      let neden = null;
      if (gorulenUrl.has(k1) || (k2 && gorulenUrl.has(k2))) neden = "başka sahnede kullanıldı";
      else if (silinen.url.has(k1) || (k2 && silinen.url.has(k2))) neden = "daha önce silinmiş";
      let r = { puan: 0, elendi: neden };
      if (!neden) r = puanModul.puanla(a, Object.assign({ sorgu: q, sorguTok, aramaDili, yon, siraLimiti: 40, kozmik: kozSahne }, ek || {}));
      if (r.elendi) { const t = r.elendi.split(":")[0]; elenme[t] = (elenme[t] || 0) + 1; continue; }
      cikti.push(Object.assign({}, a, { puan: r.puan, aramaIfadesi: a.aramaIfadesi || q }));
    }
    return cikti;
  };

  // ---- bir arama listesiyle havuz kur, en alakali adaylari indir -> eklenen sayi
  const havuzdanDoldur = async (s, info, liste, kac, secenek) => {
    const aramaDili = secenek.aramaDili;
    const locale = aramaDili !== "en" ? LOCALE[aramaDili] : undefined;
    const havuz = new Map();
    const elenme = {}, reddedilen = {};
    const denenenler = [];
    let gecerli = 0;
    const azami = secenek.azamiSorgu;
    for (const q of liste) {
      if (denenenler.length >= azami) break;
      if (denenenler.includes(q)) continue;
      if (yonetici.tumuKapaliMi()) break;
      denenenler.push(q);
      const kozSahne = kozmik && sorgu.kozmikSahneMi(info.metin + " " + q);
      const ham = await yonetici.hepsindeAra(q, { yon, locale }, kozSahne ? {} : { haric: ["nasa"] });
      for (const a of adaylariPuanla(ham, q, aramaDili, kozSahne, elenme)) {
        const key = puanModul.kanonikUrl(a.indirmeUrl || a.url);
        const var_ = havuz.get(key);
        if (!var_ || a.puan > var_.puan) havuz.set(key, a);
      }
      gecerli = havuz.size;
      if (denenenler.length >= secenek.minSorgu && gecerli >= kac * 2) break;
    }
    const sirali = [...havuz.values()].sort((a, b) => b.puan - a.puan);
    const r = await indirModul.adaylardanIndir({ P, S: s, adaylar: sirali, kac, getir, gorulenUrl, gorulenSha, silinen, reddedilen, redUrl,
      indirmeHata, bekle, aralikMs: bag.indirmeAra !== undefined ? bag.indirmeAra : 200, klasorIfade: secenek.klasorIfade,
      oranSiniri: indirModul.ORAN_SINIRI[yon],
      klasorAta: (S, ifade) => man.klasorAta(P, S, ifade) });
    for (const [k, v] of Object.entries(r.kaynaklar)) { kaynakGelen[k] = (kaynakGelen[k] || 0) + v; sayac.indirilen += v; }
    for (const [k, v] of Object.entries(reddedilen)) reddedilenToplam[k] = (reddedilenToplam[k] || 0) + v;
    return { eklenen: r.eklenen, ilkArama: r.ilkArama, denenenler, elenme, reddedilen, havuzBoyu: sirali.length };
  };

  // ---- AI uretimi (uret: isaretli sahneler ya da stok yetmezse SN'nin uret istemi)
  const aiUret = async (s, istemMetni, kac) => {
    const u = ureticiAl();
    const istemTaban = u.istemKur(istemMetni, konu.uretStil);
    const en = dikey ? 768 : 1280, boy = dikey ? 1344 : 720;
    const lis = lisansCoz("uretim");
    let n = 0;
    for (let k = 0; k < kac; k++) {
      const istem = u.istemCesitle ? u.istemCesitle(istemTaban, k) : istemTaban;
      try {
        const r = await u.uretBir(istem, en, boy, s.no * 100 + k + 1, false, { log });
        const v = dogrula(r.govde, { minUzunKenar: 1024, maksBayt: ag.MAKS_GORSEL_BAYT });
        if (!v.tamam) { log("    ! AI görseli geçersiz: " + v.neden); continue; }
        if (gorulenSha.has(v.sha1)) continue;
        man.klasorAta(P, s, "uretilen");
        man.gorselYaz(P, s, r.govde, v, Object.assign({ kaynak: "uretim", baslik: kisalt(istemMetni, 120), istem: istem, atif: "", kaynakUrl: "", indirmeUrl: "" }, lis));
        gorulenSha.add(v.sha1);
        kaynakGelen.uretim = (kaynakGelen.uretim || 0) + 1;
        sayac.indirilen++; sayac.ai++; n++;
      } catch (e) {
        log("    ! AI görsel üretimi başarısız: " + ag.hataOzeti(e) + (e && e.message && typeof e.kod !== "number" ? " — " + kisalt(e.message, 80) : ""));
      }
      await bekle(300);
    }
    return n;
  };

  // ---- sahne sahne
  let sira = 0;
  let hedefYeni = 0, hedefGeriAlindi = false;                   // --sahne: yeni aramada kac gorsel geldi / eski gorseller geri mi konuldu
  for (const info of hedefSahneler) {
    const s = info.s;
    const zorla = !!o.sahne;
    let ar = arHarita.get(s.no);
    if (zorla && o.ara) ar = { liste: [String(o.ara).trim()], kaynak: "elle", aiIstem: "" };
    const uretMi = /^uret:/i.test(ar.liste[0]);
    const adet = uretMi ? uretAdeti : adetler[sahneler.indexOf(info)];
    adetHarita.set(s.no, adet);
    const gerekli = Math.min(adet, 2);
    sira++;
    ortak.ilerleme("gorsel", (sira - 1) / hedefSahneler.length * 100, { n: sira, toplam: hedefSahneler.length });

    if (!zorla && man.sahneYeterliMi(s, adet)) {
      sayac.atlanan++;
      s.durum = man.durumHesapla(s, adet);
      continue;
    }
    // yeniden arama: mevcut gorseller silinmez, _eski-<damga>/<klasor>/ altina tasinir; yeni arama yetmezse geri konur
    let kenar = null;
    if (zorla && s.gorseller.length) {
      kenar = sahneyiKenaraAl(P, s, damga, gorulenSha);
      log("  sahne " + s.no + ": eski görseller Visuals/_eski-" + damga + "/" + s.klasor + " altına taşındı");
    }
    const oncekiKalan = s.gorseller.length;                     // tasinamayip sahnede kalan eski gorseller 'yeni' sayilmaz

    s.aramalar = ar.liste.slice();
    const aramaDili = ar.kaynak === "otomatik" ? dil : "en";
    let eklenen = 0, kullanilan = null, sonRapor = null, doldurmaKullanildi = false;
    const kisaAdi = uretMi ? "uretilen" : ar.liste[0];
    man.klasorAta(P, s, kisaAdi);                               // klasor adi ilk arama ifadesinden: 003-polar-bear
    const etiket = s.klasor.padEnd(26);

    try {
      if (uretMi) {
        const kac = Math.max(1, adet - s.gorseller.length);
        if (!o.uretme) eklenen += await aiUret(s, ar.liste[0], kac);
        kullanilan = ar.liste[0];
        log("  " + etiket + " [AI üretimi] " + eklenen + " görsel");
        if (eklenen < gerekli) {
          log("    AI görseli yetmedi; stok aramaya geçiliyor");
          const yedek = ar.liste.slice(1).concat([ar.liste[0].replace(/^uret:\s*/i, "").split(/\s+/).slice(0, 6).join(" ")]).filter(Boolean);
          sonRapor = await havuzdanDoldur(s, info, yedek, adet - s.gorseller.length, { aramaDili: "en", azamiSorgu: 3, minSorgu: 1, klasorIfade: kisaAdi });
          eklenen += sonRapor.eklenen;
        }
      } else {
        const minSorgu = ar.kaynak === "claude" ? Math.min(ar.liste.length, Math.min(s.paragraflar.length, 3)) : 1;
        const azami = ar.kaynak === "otomatik" ? 6 : 4;
        sonRapor = await havuzdanDoldur(s, info, ar.liste, adet - s.gorseller.length, { aramaDili, azamiSorgu: azami, minSorgu, klasorIfade: kisaAdi });
        eklenen += sonRapor.eklenen;
        kullanilan = sonRapor.ilkArama;

        // yetmediyse: genel konu capasiyla doldur. Kullanici --ara ile KENDI ifadesini verdiyse doldurulmaz: bulunamayan
        // aramanin yerine alakasiz 'genel konu' gorseli koymak yerine eski gorseller geri konur (asagida)
        if (!(zorla && o.ara) && s.gorseller.length < gerekli && capa.length && !yonetici.tumuKapaliMi()) {
          const dold = [capa.slice(0, 2).join(" "), capa[0]].filter((x, i, a) => x && a.indexOf(x) === i);
          const r2 = await havuzdanDoldur(s, info, dold, gerekli - s.gorseller.length, { aramaDili: dil, azamiSorgu: 2, minSorgu: 1, klasorIfade: kisaAdi });
          if (r2.eklenen) { doldurmaKullanildi = true; eklenen += r2.eklenen; kullanilan = kullanilan || r2.ilkArama; }
        }
        // hala yetmediyse ve SN bir AI istemi verdiyse: uret
        if (s.gorseller.length < gerekli && ar.aiIstem && !o.uretme) {
          log("    stok görsel yetmedi; yapay zekâ istemi kullanılıyor");
          const kac = Math.max(1, Math.min(uretAdeti, gerekli - s.gorseller.length));
          eklenen += await aiUret(s, ar.aiIstem, kac);
        }
      }
    } catch (e) {
      // beklenmeyen hata (ENOSPC vb.): kenara alinan eski gorseller sahnede kalsin, sonra hatayi ilet
      if (kenar) { sahneyiGeriYukle(P, s, kenar, Infinity, gorulenSha); man.manifestYaz(is, M); }
      throw e;
    }

    const yeniGelen = s.gorseller.length - oncekiKalan;
    let geriAlindi = false;
    if (kenar) {
      if (yeniGelen === 0) {
        // yeni aramada hic gorsel gelmedi: islemi tamamen geri al (sahne eskisi gibi kalir)
        sahneyiGeriYukle(P, s, kenar, Infinity, gorulenSha);
        s.aramalar = kenar.aramalar; s.kullanilanArama = kenar.kullanilanArama; s.durum = kenar.durum;
        geriAlindi = true;
        log("  sahne " + s.no + ": yeni aramada görsel bulunamadı; eski görseller geri konuldu");
      } else if (s.gorseller.length < gerekli) {
        // yeni arama yetersiz kaldi: sahne 'eksik' duruma dusmesin diye eski gorsellerden tamamla
        const geri = sahneyiGeriYukle(P, s, kenar, gerekli, gorulenSha);
        if (geri) uyari("Sahne " + s.no + ": yeni aramada yalnızca " + yeniGelen + " görsel bulundu; eski görsellerden " + geri + " tanesi geri konuldu.");
      }
    }
    if (zorla) { hedefYeni = yeniGelen; hedefGeriAlindi = geriAlindi; }

    if (!geriAlindi) {
      s.kullanilanArama = kullanilan || s.kullanilanArama || null;
      s.durum = doldurmaKullanildi ? "doldurma" : "tamam";
    }
    s.durum = man.durumHesapla(s, adet);                        // eksik | tamam | uretilen | doldurma

    if (!uretMi) {
      log("  " + etiket + ' "' + kisalt(kullanilan || ar.liste[0], 40) + '" → ' + s.gorseller.length + " görsel" +
          (eklenen ? " (+" + eklenen + ")" : "") + (doldurmaKullanildi ? " [genel konu görseli eklendi]" : ""));
    }
    if (s.gorseller.length < gerekli) {
      log("     ⚠ yetersiz — denenen: " + ar.liste.join(" / "));
      if (sonRapor) {
        const nedenler = Object.assign({}, sonRapor.elenme, sonRapor.reddedilen);
        const m = Object.entries(nedenler).map(([k, v]) => k + " " + v).join(", ");
        if (m) log("       elenenler: " + m + (sonRapor.havuzBoyu ? "" : " (hiç aday gelmedi)"));
      }
    }
    man.manifestYaz(is, Object.assign(M, { kaynakHatalari: yonetici.kaynakHatalari() }));      // her sahnede: yarida kalsa devam edilir

    if (yonetici.tumuKapaliMi()) {
      log("  ! Tüm görsel kaynakları kapandı; arama durduruluyor (kalan sahneler sonraki çalıştırmada doldurulur).");
      break;
    }
  }
  ortak.ilerleme("gorsel", 100, { n: hedefSahneler.length, toplam: hedefSahneler.length });

  // ---- sonuc / manifest / atif
  for (const x of sahneler) x.s.durum = man.durumHesapla(x.s, adetHarita.get(x.s.no));
  M.kaynakHatalari = yonetici.kaynakHatalari();
  M.uyarilar = man.uyariListesi(M);
  man.manifestYaz(is, M);
  const atifSayisi = man.atifYaz(is, M);

  const dolu = sahneler.filter(x => x.s.gorseller.length > 0).length;
  const toplam = man.toplamGorsel(M);
  const ozet = yonetici.ozetMetni(man.kaynakSayaclari(M));
  log("");
  log("✓ " + sayac.indirilen + " görsel indirildi" + (sayac.atlanan ? " (" + sayac.atlanan + " sahne zaten tamamdı)" : "") +
      " · toplam " + toplam + " görsel · " + dolu + "/" + sahneler.length + " sahne dolu");
  log("kaynaklar : " + ozet);
  if (atifSayisi) log("atıf      : " + atifSayisi + " görsel için atıf gerekli/önerilen → ATIF.txt (YouTube açıklamasına yapıştır)");
  const reds = Object.entries(reddedilenToplam).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k + " " + v);
  if (reds.length) log("reddedilen: " + reds.join(", "));
  for (const u of M.uyarilar) uyari(u);

  // ---- basari olcutleri
  if (!o.sahne) {
    const yuzde = sahneler.length ? Math.round(dolu / sahneler.length * 100) : 0;
    const altSinir = Math.min(6, hedefToplam);
    const kaynakOlu = Object.keys(yonetici.durum).every(a => yonetici.durum[a].devreDisi || yonetici.durum[a].basarili === 0);
    const kaynakHata = Object.values(yonetici.durum).some(d => d.hata > 0);
    const cikis = toplam === 0 && kaynakOlu && kaynakHata ? ortak.CIKIS.SERVIS : ortak.CIKIS.YETERSIZ;
    const cozumOrtak = "Bağlantını ve Kaynaklar sekmesindeki anahtarları kontrol et; olmazsa konu.json içinde sahneKelimeleri ile arama kelimelerini elle yaz. Adım kaldığı yerden devam eder.";
    if (toplam === 0)
      throw new OrtakHata("gorsel_yok", "Hiç görsel indirilemedi (" + (kaynakOlu && kaynakHata ? "kaynaklara ulaşılamadı" : "aramalar sonuç vermedi veya hepsi elendi") + ").",
        { cikis, cozum: cozumOrtak, detay: yonetici.kaynakHatalari() });
    if (yuzde < 70)
      throw new OrtakHata("gorsel_az", "Sahnelerin yalnızca %" + yuzde + "'i görselle dolu (" + dolu + "/" + sahneler.length + ").",
        { cikis: ortak.CIKIS.YETERSIZ, cozum: cozumOrtak, detay: yonetici.kaynakHatalari() });
    if (toplam < altSinir)
      throw new OrtakHata("gorsel_az", "Toplam görsel sayısı çok az (" + toplam + "; en az " + altSinir + " gerekli).",
        { cikis: ortak.CIKIS.YETERSIZ, cozum: cozumOrtak, detay: yonetici.kaynakHatalari() });
    if (toplam < Math.round(hedefToplam * 0.5)) uyari("Görsel hedefin yarısından az geldi (" + toplam + "/" + hedefToplam + "); sahne arama kelimelerini somutlaştırmak sonucu iyileştirir.");
  } else if (!hedefYeni) {
    // yeni aramada hic gorsel gelmedi (eski gorseller varsa yukarida geri konuldu: sahne bozulmadi)
    throw new OrtakHata("gorsel_yok", "Sahne " + o.sahne + (o.ara ? " için \"" + o.ara + "\" aramasında" : " için") + " yeni görsel bulunamadı" +
      (hedefGeriAlindi ? "; mevcut görseller korundu" : "") + ".",
      { cikis: ortak.CIKIS.YETERSIZ, cozum: "Farklı bir arama ifadesi dene: --sahne " + o.sahne + ' --ara "..."' });
  }

  const sonuc = { sahne: sahneler.length, gorsel: toplam, indirilen: sayac.indirilen, kaynaklar: man.kaynakSayaclari(M) };
  // hicbir sey yapilmadi: her sahne zaten yeterliydi -> PA adimi "atlandi" isaretler (idempotans)
  if (sayac.indirilen === 0 && !pl.arsiv && sayac.atlanan === hedefSahneler.length) { sonuc.atlandi = true; sonuc.neden = "görseller güncel"; }
  ortak.sonuc(sonuc);
  return { manifest: M, sayac, kaynakGelen, sonuc };
}

module.exports = { calistir, aramalariBelirle, LOCALE };
