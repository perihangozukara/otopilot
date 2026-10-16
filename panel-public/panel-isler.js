// PANEL ARAYUZU — Videolar gorunumu: is listesi, "baslamadan once" kontrol listesi, is sayfasi cercevesi (durum seridi + sekmeler).
// Sekmeler ayri dosyalarda P.sekmeler'e kaydolur. Is sayfalari bellekte tutulur: baska ise gecince yazilmis metin kaybolmaz.
// Sunucu uclari: GET /api/isler, GET /api/is-detay?is=, GET /api/onkontrol, POST /api/ac, POST /api/is-arsivle.
(function () {
  "use strict";
  var P = window.P;
  P.isler = { liste: [], yuklendi: false, hata: false };
  P.sekmeler = [];                          // {sira, ad, etiket, ikon, yalnizVideo, kur(ctx) -> {kok, ac(), guncelle()}}
  P.yeniUyarilar = {};                      // is -> [{kod,mesaj}] (yeni is olusturulurken sunucunun verdigi uyarilar)
  var ADRE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  P.guvenliAd = function (s) { return typeof s === "string" && ADRE.test(s); };

  P.islerYenile = async function () {
    var r;
    try { r = await P.api("/api/isler"); }
    catch (e) {
      // ilk yukleme basarisizsa liste "Yukleniyor…" ile sonsuza dek asili kalmasin
      if (!P.isler.yuklendi && !P.isler.hata) { P.isler.hata = true; P.olay.yay("isler", P.isler); }
      throw e;
    }
    P.isler.hata = false;
    var t = Date.now();
    P.isler.liste = (r.isler || []).map(function (x) { x._t = t; return x; });         // is sayfasi, listeyle kendi detay verisinden hangisi taze ise onu kullanir
    P.isler.yuklendi = true;
    P.olay.yay("isler", P.isler);
  };
  P.isBul = function (ad) { var l = P.isler.liste; for (var i = 0; i < l.length; i++) if (l[i].ad === ad) return l[i]; return null; };

  // ---------------------------------------------------------------- baslamadan once kontrol listesi
  var ONKONTROL_AKSIYON = {
    anahtar_yok: ["Kaynaklar'a git", "kaynaklar"], gorsel_anahtar: ["Kaynaklar'a git", "kaynaklar"], disk: ["Disk bölümüne git", "kaynaklar"],
    maliyet: ["Maliyet sınırlarına git", "kaynaklar"], kanal_varsayilan: ["Kanal ayarına git", "kanal"]
  };
  // onkontrolKutusu({tur, is}) -> element; .yenile() ile tekrar sorgulanir
  P.onkontrolKutusu = function (o) {
    o = o || {};
    var kap = P.h("div", { class: "onkontrol" });
    function ciz(r) {
      var a = r.anahtarlar || {};
      var anahtar = function (ad, var_) { return P.h("span", { class: "iz " + (var_ ? "ok" : "yok") }, P.ikon(var_ ? "tamam" : "kapat"), ad + (var_ ? " var" : " yok")); };
      var sorunlar = (r.sorunlar || []).map(function (s) {
        var ak = ONKONTROL_AKSIYON[s.kod];
        return P.h("li", { class: "sorun s-" + s.seviye },
          P.ikon(s.seviye === "hata" ? "hata" : "uyari"),
          P.h("div", null, P.h("strong", null, s.mesaj), s.cozum ? P.h("div", { class: "soluk" }, s.cozum) : null),
          ak ? P.dugme(ak[0], { kucuk: true, tur: "hafif", onclick: function () { P.git(ak[1]); } }) : null);
      });
      var tah = r.maliyetTahmin;
      P.degistir(kap,
        P.h("div", { class: "iz-satir" }, anahtar("Claude", a.claude), anahtar("vidIQ", a.vidiq), anahtar("Pexels", a.pexels), anahtar("Pixabay", a.pixabay),
          r.diskBosGB !== null && r.diskBosGB !== undefined ? P.h("span", { class: "iz" }, P.ikon("disk"), r.diskBosGB + " GB boş") : null),
        sorunlar.length ? P.h("ul", { class: "sorunlar" }, sorunlar) : P.mesajKutusu("ok", "Başlamak için engel yok."),
        tah ? P.h("p", { class: "ipucu" }, "Senaryo yazımı için tahmini maliyet: ~$" + String(tah.usd).replace(".", ",") + (tah.vidiqCagri ? " · vidIQ ~" + tah.vidiqCagri + " çağrı" : "") + " (15 dakikalık video için kaba tahmin; fatura değildir).") : null);
    }
    async function yukle() {
      P.durumYaz(kap, "bilgi", "Kontrol ediliyor…");
      try { ciz(await P.api("/api/onkontrol?tur=" + encodeURIComponent(o.tur || "hepsi") + (o.is ? "&is=" + encodeURIComponent(o.is) : ""))); }
      catch (e) { P.durumYaz(kap, "hata", e); }
    }
    kap.yenile = yukle;
    yukle();
    return kap;
  };

  // ---------------------------------------------------------------- gorunum: liste kolonu
  var ui = {};
  var oturumlar = {};                    // is -> IsOturumu
  var aktifIs = null;
  var listeYoklayici = null, detayYoklayici = null;
  var arama = "";

  function izRozet(metin, tur, ikon) { return P.h("span", { class: "iz " + tur }, ikon ? P.ikon(ikon) : null, metin); }
  function listeSatiri(i) {
    var c = P.calisanBul(i.ad);
    var durum = c ? c.durum : i.durum;
    var f = P.FORMATLAR[i.format] || P.FORMATLAR.long;
    var izler = [];
    izler.push(izRozet("senaryo", i.senaryo ? "ok" : "yok", i.senaryo ? "tamam" : null));
    izler.push(izRozet(i.gorsel + " görsel", i.gorsel ? "ok" : "yok"));
    if (i.sesTamam) izler.push(izRozet("ses", "ok", "tamam"));
    else if (i.sesParca > 0) izler.push(izRozet("ses " + i.sesParca + "/" + i.sesBeklenen, "uyari", "uyari"));       // eksik ya da eski ses
    else izler.push(izRozet("ses", "yok"));
    if (i.video) izler.push(izRozet("video " + P.boyutYaz(i.video.mb), i.video.gecerli ? "ok" : "uyari", i.video.gecerli ? "tamam" : "uyari"));
    var yuzde = c && typeof c.yuzde === "number" ? Math.round(c.yuzde) : null;
    return P.h("li", null, P.h("button", { type: "button", class: "liste-satir" + (aktifIs === i.ad ? " secili" : ""), "data-is": i.ad, "aria-current": aktifIs === i.ad ? "true" : null,
      onclick: function () { P.git("videolar/" + i.ad); } },
      P.h("span", { class: "ls-baslik" }, i.baslik || i.ad),
      P.h("span", { class: "ls-meta" }, P.rozet(i.tip === "vs" ? "VS" : f.kisa, "soluk"), P.durumRozeti(durum), i.konuBozuk ? P.rozet("konu.json bozuk", "hata", "hata") : null,
        i.dakika ? P.h("span", { class: "soluk" }, "~" + i.dakika + " dk") : null),
      P.h("span", { class: "ls-izler" }, izler),
      yuzde !== null ? P.h("span", { class: "cubuk mini" }, P.h("span", { class: "cubuk-dolgu", style: { width: yuzde + "%" } })) : null));
  }
  var sonImza = "";
  function listeCiz() {
    if (!ui.liste) return;
    var l = P.isler.liste.filter(function (i) {
      if (!arama) return true;
      return (String(i.baslik || "") + " " + i.ad).toLowerCase().indexOf(arama) >= 0;
    });
    // imza satirda GORUNEN her alani icerir; yuklendi/hata/toplam iş sayısı da dahil: 0 iş varken "Yükleniyor…" ile
    // "Henüz video yok" çiziminin imzası aynı kalırsa ilk kullanım ekranı hiç güncellenmezdi
    var imza = JSON.stringify([aktifIs, arama, P.isler.yuklendi, P.isler.hata, P.isler.liste.length, l.map(function (i) {
      var c = P.calisanBul(i.ad);
      return [i.ad, i.baslik, i.tip, i.format, i.dil, i.dakika, i.durum, i.senaryo, i.gorsel, i.sesParca, i.sesBeklenen, i.sesTamam, i.video && [i.video.mb, i.video.gecerli], i.konuBozuk, c && [c.durum, Math.round(c.yuzde || 0)]];
    })]);
    if (imza === sonImza) return;
    sonImza = imza;
    var odak = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.is : null;
    P.bos(ui.liste);
    if (!P.isler.yuklendi) ui.liste.appendChild(P.h("li", { class: "bos-durum" }, P.isler.hata ? "Video listesi alınamadı; panelle bağlantı kurulamıyor. Bağlantı gelince kendiliğinden yenilenir." : "Yükleniyor…"));
    else if (!l.length) ui.liste.appendChild(P.h("li", { class: "bos-durum" }, P.isler.liste.length ? "Aramayla eşleşen video yok." : "Henüz video yok. «Yeni video» ile başla."));
    else l.forEach(function (i) { ui.liste.appendChild(listeSatiri(i)); });
    if (odak) { var b = ui.liste.querySelector('[data-is="' + odak.replace(/"/g, "") + '"]'); if (b) b.focus({ preventScroll: true }); }
    ui.sayac.textContent = P.isler.yuklendi ? P.isler.liste.length + " video" : "";
  }

  // ---------------------------------------------------------------- is oturumu (is sayfasi)
  function IsOturumu(is) {
    var ctx = this;
    ctx.is = is; ctx.detay = null; ctx.ozetVeri = null; ctx.ozetT = 0; ctx.etkin = false; ctx.sekmeNesne = {}; ctx.aktifSekme = null;
    ctx.kilitler = []; ctx.hata = null; ctx.sonBannerImza = ""; ctx.sonUyariImza = ""; ctx.yukleniyor = false;
    ctx.kok = P.h("div", { class: "detay", hidden: true });
    ctx.baslikAlani = P.h("header", { class: "detay-ust" });
    ctx.banner = P.h("div", { class: "banner-alani" });
    ctx.uyariAlani = P.h("div", { class: "uyari-alani" });
    ctx.sekmeSerit = P.h("div", { class: "sekmeler", role: "tablist", "aria-label": "İş bölümleri" });
    ctx.paneller = P.h("div", { class: "sekme-panelleri" });
    P.degistir(ctx.kok, ctx.baslikAlani, ctx.banner, ctx.uyariAlani, ctx.sekmeSerit, ctx.paneller);
  }
  IsOturumu.prototype.ozet = function () {
    var ctx = this, l = P.isBul(ctx.is);
    if (ctx.ozetVeri && (!l || ctx.ozetT >= (l._t || 0))) return ctx.ozetVeri;
    return l || ctx.ozetVeri;
  };
  IsOturumu.prototype.konu = function () { return this.detay ? this.detay.konu : null; };
  IsOturumu.prototype.durum = function () {
    var c = P.calisanBul(this.is), oz = this.ozet();
    return c ? c.durum : (oz ? oz.durum : "yeni");
  };
  IsOturumu.prototype.mesgul = function () { return P.mesgul(this.is); };
  IsOturumu.prototype.onay = function () { return P.onayBekliyor(this.is); };
  IsOturumu.prototype.vsMi = function () { var oz = this.ozet(); return !!(oz && oz.tip === "vs"); };
  // kilitle(el, "mesgul"|"hepsi", grup): is calisirken dugmeyi kapatir; grup verilirse topluca temizlenebilir
  IsOturumu.prototype.kilitle = function (el, kural, grup) { this.kilitler.push({ el: el, kural: kural || "mesgul", grup: grup || null }); this.kilitleriUygula(); return el; };
  // yeniden çizilen bölümler çizmeden önce kendi grubunu temizler: koparılmış (DOM'dan çıkmış) düğümler listede birikip
  // her çalışan-olayında boşuna dolaşılmasın
  IsOturumu.prototype.kilitTemizle = function (grup) { this.kilitler = this.kilitler.filter(function (k) { return k.grup !== grup; }); };
  IsOturumu.prototype.kilitleriUygula = function () {
    var busy = this.mesgul(), onay = this.onay();
    this.kilitler.forEach(function (k) {
      var kapali = busy || (k.kural === "hepsi" && onay);
      if (k.el.disabled !== kapali) k.el.disabled = kapali;
    });
  };
  IsOturumu.prototype.calistir = async function (tur, ek, yer) {
    var r = await P.calistir(tur, Object.assign({ is: this.is }, ek || {}), yer);
    this.yenile().catch(function () { });
    return r;
  };
  // onayli calistirma: satir ici onay -> calistir
  IsOturumu.prototype.onayliCalistir = async function (tur, ek, yer, onay) {
    var kap = yer || this.uyariAlani;
    var ok = await P.onayIste(kap, onay);
    if (!ok) return null;
    return this.calistir(tur, ek, yer);
  };
  IsOturumu.prototype.yenile = async function () {
    var ctx = this;
    if (ctx.yukleniyor) { ctx.tekrar = true; return; }          // devam eden istek eski veriyle donebilir: bitince bir kez daha sorgula
    ctx.yukleniyor = true;
    try {
      var d = await P.api("/api/is-detay?is=" + encodeURIComponent(ctx.is));
      ctx.detay = d; ctx.ozetVeri = d.ozet; ctx.ozetT = Date.now(); ctx.hata = null;
    } catch (e) { ctx.hata = e; }
    ctx.yukleniyor = false;
    ctx.ciz();
    if (ctx.tekrar) { ctx.tekrar = false; ctx.yenile().catch(function () { }); }
  };
  IsOturumu.prototype.sekmeAc = function (ad) { P.git("videolar/" + this.is + "/" + ad); };

  var UYARI_AKSIYON = {
    ses_eski: function (ctx) { return ["Seslendirmeyi yeniden yap", function (yer) { ctx.calistir("ses", { yeniden: true }, yer); }]; },
    gorsel_eski: function (ctx) { return ["Görselleri yenile", function (yer) { ctx.onayliCalistir("gorsel", { bastan: true }, yer, { baslik: "Görseller yenilensin mi?", metin: "Görseller yeni senaryoya göre baştan aranır; eskileri Visuals/_eski-… klasörüne taşınır. Elle sildiklerin bir daha gelmez.", evet: "Görselleri yenile" }); }]; },
    video_eski: function (ctx) { return ["Videoyu yeniden kur", function (yer) { ctx.calistir("video", {}, yer); }]; },
    konu_bozuk: function (ctx) { return ["Ham ayarları aç", function () { ctx.sekmeAc("ham"); }]; },
    hedef_sapma: function (ctx) { return ["Senaryoyu aç", function () { ctx.sekmeAc("senaryo"); }]; },
    disk_az: function () { return ["Disk bölümüne git", function () { P.git("kaynaklar"); }]; },
    kanal_varsayilan: function () { return ["Kanal ayarına git", function () { P.git("kanal"); }]; },
    sure_sinir: function (ctx) { return ["Süreyi ayarla", function () { ctx.sekmeAc("ham"); }]; }
  };

  // --- ust baslik + durum seridi + uyarilar (sekmelerden bagimsiz, her sekmede gorunur)
  IsOturumu.prototype.ciz = function () {
    var ctx = this, oz = ctx.ozet();
    // VS isi mi video isi mi sonradan anlasildiysa sekmeleri yeniden kur
    if (ctx.sekmeTanimlari && ctx.vsIleKuruldu !== ctx.vsMi() && ctx.aktifSekme) {
      var ad = ctx.aktifSekme;
      ctx.sekmeTanimlari = null; ctx.sekmeNesne = {};
      ctx.sekmeGoster(ad);
    }
    ctx.baslikCiz(oz);
    ctx.bannerCiz(oz);
    ctx.uyariCiz();
    ctx.kilitleriUygula();
    Object.keys(ctx.sekmeNesne).forEach(function (k) { var n = ctx.sekmeNesne[k]; if (n.guncelle) { try { n.guncelle(); } catch (e) { console.error(e); } } });
  };
  IsOturumu.prototype.baslikCiz = function (oz) {
    var ctx = this;
    var imza = JSON.stringify([oz && oz.baslik, oz && oz.format, oz && oz.dil, oz && oz.kelime, oz && oz.dakika, ctx.durum(), ctx.hata && ctx.hata.kod]);
    if (imza === ctx.sonBaslikImza) return;
    ctx.sonBaslikImza = imza;
    var f = oz ? (P.FORMATLAR[oz.format] || P.FORMATLAR.long) : null;
    var meta = [];
    if (oz) {
      meta.push(P.h("span", { class: "mono" }, ctx.is));
      meta.push(P.rozet(oz.tip === "vs" ? "VS" : f.kisa + " " + f.oran, "soluk"));
      if (oz.tip !== "vs") meta.push(P.rozet(P.dilAdi(oz.dil), "soluk"));
      if (oz.kelime) meta.push(P.h("span", { class: "soluk" }, P.sayi(oz.kelime) + " kelime · ~" + oz.dakika + " dk"));
      meta.push(P.durumRozeti(ctx.durum()));
    }
    var klasor = P.dugme("Klasörü aç", { ikon: "klasor", kucuk: true, tur: "hafif", title: "İşin klasörünü dosya yöneticisinde açar",
      onclick: async function () { try { await P.api("/api/ac", { is: ctx.is, klasor: "" }); } catch (e) { P.bildir(P.hataMetni(e) + (e.cozum ? " " + e.cozum : ""), "hata"); } } });
    var arsiv = P.dugme("Arşivle", { ikon: "arsiv", kucuk: true, tur: "hafif", title: "İş klasörünü _arsiv altına taşır (silmez)", onclick: function () { ctx.arsivle(); } });
    ctx.kilitler = ctx.kilitler.filter(function (k) { return k.grup !== "baslik"; });
    ctx.kilitle(arsiv, "mesgul", "baslik");
    P.degistir(ctx.baslikAlani,
      P.dugme("Videolar", { ikon: "sol", kucuk: true, tur: "hafif", sinif: "geri", onclick: function () { P.git("videolar"); } }),
      P.h("div", { class: "detay-baslik" }, P.h("h2", { tabindex: "-1" }, oz ? (oz.baslik || ctx.is) : ctx.is), P.h("div", { class: "meta" }, meta)),
      P.h("div", { class: "satir" }, klasor, arsiv));
    ctx.kilitleriUygula();
  };
  IsOturumu.prototype.arsivle = async function () {
    var ctx = this;
    var ok = await P.onayIste(ctx.uyariAlani, { baslik: "Bu iş arşivlensin mi?", metin: "İş klasörü uretim/_arsiv/ altına taşınır; hiçbir dosya silinmez. Listeden kalkar.", evet: "Arşivle" });
    if (!ok) return;
    try {
      await P.api("/api/is-arsivle", { is: ctx.is });
      P.bildir("İş arşivlendi.", "ok");
      delete oturumlar[ctx.is]; ctx.kok.remove();
      await P.islerYenile();
      P.git("videolar");
    } catch (e) { P.durumYaz(ctx.uyariAlani, "hata", e); }
  };

  // --- durum seridi
  IsOturumu.prototype.bannerCiz = function (oz) {
    var ctx = this, c = P.calisanBul(ctx.is), d = ctx.durum();
    var son = ctx.detay && ctx.detay.durum && ctx.detay.durum.son;
    var onayTuru = null;
    if (d === "onay_bekliyor") {
      var ad = ((ctx.detay && ctx.detay.durum && ctx.detay.durum.adimlar) || []).filter(function (a) { return a.durum === "onay"; })[0];
      onayTuru = ad && (ad.ad === "ses" || ad.ad === "kartlar" || ad.ad === "video") ? "gorsel" : "senaryo";
    }
    var sonHata = oz && oz.sonHata;
    var imza = JSON.stringify([d, c && [c.adim, c.adimNo, c.adimToplam, c.yetim, c.takildi, c.id], onayTuru, sonHata && sonHata.ozet, oz && oz.video && [oz.video.gecerli, oz.video.sureSn], ctx.hata && ctx.hata.kod,
      !!(ctx.detay && ctx.detay.dosyalar && ctx.detay.dosyalar.senaryoYarim),
      d === "onay_bekliyor" ? !!(ctx.detay && ctx.detay.durum) : null]);          // onay paneli kalan ücretli adımları durum.json'dan okur: detay gelince bir kez yeniden kurulur
    if (imza === ctx.sonBannerImza) { ctx.ilerlemeGuncelle(c); return; }
    ctx.sonBannerImza = imza;
    ctx.cubukEl = null;
    P.bos(ctx.banner);
    if (ctx.hata) {
      ctx.banner.appendChild(ctx.hata.durum === 404 ? P.mesajKutusu("hata", "Böyle bir iş yok (arşivlenmiş ya da silinmiş olabilir). ", P.dugme("Listeye dön", { kucuk: true, onclick: function () { P.git("videolar"); } })) : P.hataKutusu(ctx.hata));
      return;
    }
    if (d === "calisiyor" || d === "sirada") {
      // işlem yeni başlamış, çalışan kaydı henüz listede yoksa (c boş) türü günlük izleyicisinden al; hiç bilinmiyorsa etiket yazma
      var iz = P.izleDurumu(), turAdi = c ? P.turEtiketi(c.tur) : (iz.is === ctx.is && iz.tur && !iz.bitti ? P.turEtiketi(iz.tur) : "");
      var adimMetni =c ? (c.adimToplam > 1 ? "Adım " + c.adimNo + "/" + c.adimToplam + " — " + c.adim : (c.adim || P.turEtiketi(c.tur))) : "";
      ctx.cubukEl = P.h("div", { class: "cubuk", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": "İlerleme" }, P.h("div", { class: "cubuk-dolgu" }));
      ctx.yuzdeEl = P.h("span", { class: "mono" });
      var durdur = P.dugme("Durdur", { ikon: "durdur", tur: "tehlike", kucuk: true, onclick: function () { P.durdur(c ? c.id : "y-" + ctx.is); } });
      var gunluk = P.dugme("Günlüğü göster", { ikon: "terminal", kucuk: true, tur: "hafif", onclick: function () { if (c && !c.yetim) P.izleBaslat(c.id, { is: ctx.is, tur: c.tur }); else P.gunlukGoster(ctx.is); P.dockAc(true); } });
      ctx.banner.appendChild(P.h("div", { class: "banner b-calisiyor", role: "status" },
        P.h("div", { class: "banner-ust" }, P.ikon(d === "sirada" ? "saat" : "yukleniyor", d === "sirada" ? "" : "don"),
          P.h("div", { class: "banner-metin" }, P.h("strong", null, d === "sirada" ? "Sırada" : c && c.yetim ? "Önceki oturumdan kalan işlem çalışıyor" : "Çalışıyor" + (turAdi ? " — " + turAdi : "")),
            P.h("div", { class: "soluk" }, d === "sirada" ? "Başka bir ağır işlem (video/ses) bitince başlayacak." : adimMetni + (c && c.takildi ? " · uzun süredir çıktı yok, takılmış olabilir" : ""))),
          P.h("div", { class: "satir" }, durdur, c && c.yetim ? null : gunluk)),
        d === "sirada" ? null : P.h("div", { class: "cubuk-satir" }, ctx.cubukEl, ctx.yuzdeEl)));
      ctx.ilerlemeGuncelle(c);
      return;
    }
    if (d === "onay_bekliyor") { ctx.banner.appendChild(ctx.onayPaneli(onayTuru)); return; }
    if (d === "hata") {
      var h = sonHata || (son && son.hata) || { ozet: "Son işlem başarısız oldu.", cozum: "Günlüğe bak, düzeltip tekrar dene." };
      var ic = [P.h("strong", null, "Son işlem hatayla durdu"), P.h("p", null, h.ozet)];
      if (h.cozum) ic.push(P.h("p", { class: "cozum" }, P.ikon("ok-sag"), h.cozum));
      if (h.detay) ic.push(P.h("details", null, P.h("summary", null, "Teknik ayrıntı"), P.h("pre", null, String(h.detay))));
      var yarimVar = !!(ctx.detay && ctx.detay.dosyalar && ctx.detay.dosyalar.senaryoYarim);
      // devam ederken de önkontrol + ücretli adım onayı çalışır (kontrolluBaslat); onay/hata kutusu bannerın kendisini silmesin diye ayrı yerde
      var devamYer = P.h("div", { class: "durum-yeri", "aria-live": "polite" });
      ic.push(P.h("div", { class: "satir" },
        P.dugme("Kaldığı yerden devam et", { tur: "birincil", kucuk: true, ikon: "oynat", onclick: function () { P.kontrolluBaslat(ctx, devamYer, "hepsi", {}, {}); } }),
        yarimVar ? P.dugme("Yarım senaryoyu gözden geçir", { kucuk: true, tur: "hafif", ikon: "kalem", onclick: function () { ctx.sekmeAc("senaryo"); } }) : null,
        P.dugme("Günlüğü göster", { kucuk: true, tur: "hafif", ikon: "terminal", onclick: function () { P.gunlukGoster(ctx.is); } })), devamYer);
      ctx.banner.appendChild(P.mesajKutusu("hata", ic));
      return;
    }
    if (d === "durduruldu") {
      var yarim = sonHata && sonHata.kod === "panel_kapandi" ? sonHata.ozet : "İşlem durduruldu; yarım kalan dosyalar temizlendi.";
      var devamYer2 = P.h("div", { class: "durum-yeri", "aria-live": "polite" });
      ctx.banner.appendChild(P.mesajKutusu("bilgi", P.h("strong", null, yarim), " Kaldığı yerden devam edebilirsin. ",
        P.dugme("Devam et", { kucuk: true, tur: "birincil", onclick: function () { P.kontrolluBaslat(ctx, devamYer2, "hepsi", {}, {}); } }), devamYer2));
      return;
    }
    if (d === "bitti" && oz && oz.video && !oz.video.gecerli) {
      ctx.banner.appendChild(P.mesajKutusu("uyari", P.h("strong", null, "İşlem tamamlandı ama video dosyası geçerli görünmüyor."), " Videoyu yeniden kur (gerekirse «Temiz kur»u işaretle)."));
      return;
    }
    if (d === "bitti" && oz && oz.video && oz.video.gecerli) {
      ctx.banner.appendChild(P.mesajKutusu("ok", P.h("strong", null, "Video hazır"), " — " + (oz.video.sureSn ? P.sureYaz(oz.video.sureSn) + " · " : "") + P.boyutYaz(oz.video.mb) + " ",
        P.dugme("Oynat", { kucuk: true, ikon: "oynat", onclick: function () { ctx.sekmeAc("uretim"); setTimeout(function () { var v = ctx.kok.querySelector("video"); if (v) { v.scrollIntoView({ block: "center" }); v.focus(); } }, 120); } })));
    }
  };
  IsOturumu.prototype.ilerlemeGuncelle = function (c) {
    if (!this.cubukEl) return;
    var y = c && typeof c.yuzde === "number" ? Math.max(0, Math.min(100, Math.round(c.yuzde))) : null;
    this.cubukEl.firstChild.style.width = (y || 0) + "%";
    this.cubukEl.setAttribute("aria-valuenow", String(y || 0));
    this.yuzdeEl.textContent = y !== null ? "%" + y : "…";
  };
  // onay duragi: senaryo ya da gorsel
  IsOturumu.prototype.onayPaneli = function (tur) {
    var ctx = this, oz = ctx.ozet() || {};
    var ozet = P.h("div", { class: "onay-ozet soluk" }, "Özet yükleniyor…");
    var yer = P.h("div", { class: "durum-yeri" });
    var onaylaDugme = P.dugme("Onayla ve devam et", { tur: "birincil", ikon: "tamam", onclick: async function () {
      var kirli = P.kirli.has("senaryo:" + ctx.is) || P.kirli.has("altyazi:" + ctx.is);
      if (kirli && tur === "senaryo") {
        var s = ctx.sekmeNesne.senaryo;
        if (s && s.kaydet) { var ok = await s.kaydet(yer); if (!ok) return; }
      }
      onaylaDugme.disabled = true;
      var ok2 = await P.onayla(ctx.is, yer);
      if (!ok2) onaylaDugme.disabled = false; else ctx.yenile().catch(function () { });
    } });
    var duzenle = P.dugme(tur === "senaryo" ? "Senaryoyu düzenle" : "Sahneleri gözden geçir", { tur: "hafif", ikon: tur === "senaryo" ? "kalem" : "gorsel", onclick: function () { ctx.sekmeAc(tur === "senaryo" ? "senaryo" : "sahneler"); } });
    var durdur = P.dugme("Durdur", { tur: "hafif", ikon: "durdur", onclick: function () { var c = P.calisanBul(ctx.is); if (c) P.durdur(c.id); } });
    // canlı kayıt yoksa (panel yeniden başlamış, onay durum.json'dan geliyor) durdurulacak süreç de yoktur: düğme gösterilmez
    var canli = !!P.calisanBul(ctx.is);
    durdur.hidden = !canli;
    var kalanAdimlar = ((ctx.detay && ctx.detay.durum && ctx.detay.durum.adimlar) || []).filter(function (a) { return a.durum === "bekliyor" || a.durum === "onay"; });
    var ucretliKalan = kalanAdimlar.filter(function (a) { return a.ad === "ceviri" || a.ad === "baslik" || a.ad === "baslik-on"; });
    var kutu = P.h("div", { class: "banner b-onay", role: "group", "aria-label": "Onay bekleniyor" },
      P.h("div", { class: "banner-ust" }, P.ikon("duraklat"), P.h("div", { class: "banner-metin" },
        P.h("strong", null, tur === "senaryo" ? "Senaryo hazır — gözden geçirip onayla" : "Görseller hazır — gözden geçirip onayla"),
        P.h("div", { class: "soluk" }, "Zincir burada durdu; sen onaylayana kadar ses ve video üretilmez (ücretli adım tekrarlanmaz)."),
        canli ? null : P.h("div", { class: "soluk" }, "Panel yeniden başladığı için bu onay önceki oturumdan kaldı. Onaylarsan kalan adımlar baştan kurulur; güncel olanlar atlanır."),
        ucretliKalan.length ? P.h("div", { class: "soluk" }, "Onaylayınca ücretli adım da çalışır: " + ucretliKalan.map(function (a) { return a.etiket || a.ad; }).join(", ") + ".") : null)),
      ozet, P.h("div", { class: "satir" }, onaylaDugme, duzenle, durdur), yer);
    if (tur === "senaryo") {
      Promise.all([P.api("/api/dosya?is=" + encodeURIComponent(ctx.is) + "&tur=senaryo"), P.api("/api/dosya?is=" + encodeURIComponent(ctx.is) + "&tur=iddia").catch(function () { return null; })]).then(function (r) {
        var metin = r[0].icerik || "", ps = P.paragraflar(metin), dil = (ctx.konu() && ctx.konu().dil) || (oz && oz.dil) || "en";
        var kel = P.kelimeSay(metin), id = r[1] && r[1].json && r[1].json.ozet;
        P.degistir(ozet, P.h("div", null, P.sayi(kel) + " kelime · " + ps.length + " paragraf · ~" + (kel / P.kelimeHizi(dil)).toFixed(1).replace(".", ",") + " dk konuşma"),
          id && id.toplam ? P.h("div", null, id.toplam + " iddia çıkarıldı, " + (id.dusukGuven || 0) + " tanesi düşük güvenli — Senaryo sekmesinde «İddia raporu»na bak.") : null,
          ps.length ? P.h("blockquote", null, P.kisalt(ps[0], 260)) : null);
      }).catch(function (e) { P.degistir(ozet, P.hataKutusu(e)); });
    } else P.degistir(ozet, P.h("div", null, (oz.sahne || 0) + " sahne · " + (oz.gorsel || 0) + " görsel bulundu. Yanlış görselleri Sahneler sekmesinden silip yeniden arayabilirsin."));
    return kutu;
  };
  IsOturumu.prototype.uyariCiz = function () {
    var ctx = this;
    // /api/yeni yanıtındaki uyarılar yalnız is-detay yanıtı gelene kadar (anlık geri bildirim) gösterilir; sonra sunucunun güncel
    // listesi esas alınır. Aksi halde düzeltilen uyarı (ör. kanal adı) oturum boyunca ekranda kalırdı.
    if (ctx.detay) delete P.yeniUyarilar[ctx.is];
    var liste = ((ctx.detay && ctx.detay.uyarilar) || []).concat(ctx.detay ? [] : (P.yeniUyarilar[ctx.is] || []));
    var imza = JSON.stringify(liste);
    if (imza === ctx.sonUyariImza) return;
    ctx.sonUyariImza = imza;
    // acik onay kutusu varsa dokunma
    if (P.$(".onay-kutu", ctx.uyariAlani)) { ctx.sonUyariImza = ""; return; }
    P.bos(ctx.uyariAlani);
    var goruldu = {};
    liste.forEach(function (u) {
      if (goruldu[u.kod]) return; goruldu[u.kod] = 1;          // ayni tur uyari (ör. kanal_varsayilan) bir kez gosterilir
      var ak = UYARI_AKSIYON[u.kod] ? UYARI_AKSIYON[u.kod](ctx) : null;
      var yer = P.h("div", { class: "durum-yeri" });
      var kutu = P.mesajKutusu("uyari", P.h("span", null, u.mesaj + " "),
        ak ? P.dugme(ak[0], { kucuk: true, tur: "hafif", onclick: function () { ak[1](yer); } }) : null);
      ctx.uyariAlani.appendChild(P.h("div", { class: "uyari-satiri" }, kutu, yer));
    });
  };

  // --- sekmeler
  IsOturumu.prototype.sekmeleriKur = function () {
    var ctx = this;
    P.bos(ctx.sekmeSerit); P.bos(ctx.paneller);
    var vs = ctx.vsMi();
    ctx.vsIleKuruldu = vs;
    ctx.kilitler = ctx.kilitler.filter(function (k) { return k.grup === "baslik"; });
    ctx.sekmePaneli = {};
    ctx.sekmeTanimlari = P.sekmeler.filter(function (s) { return !(vs && s.yalnizVideo); }).sort(function (a, b) { return a.sira - b.sira; });
    ctx.sekmeTanimlari.forEach(function (s) {
      var id = "sk-" + ctx.is + "-" + s.ad;
      var d = P.h("button", { type: "button", role: "tab", id: id, "aria-selected": "false", "aria-controls": id + "-p", tabindex: "-1", "data-sekme": s.ad,
        onclick: function () { ctx.sekmeAc(s.ad); },
        onkeydown: function (e) { ctx.sekmeTusu(e, s.ad); } }, P.ikon(s.ikon), P.h("span", null, s.etiket));
      var p = P.h("div", { role: "tabpanel", id: id + "-p", "aria-labelledby": id, class: "sekme-paneli", hidden: true, tabindex: "-1" });
      ctx.sekmePaneli[s.ad] = p;
      ctx.sekmeSerit.appendChild(d); ctx.paneller.appendChild(p);
    });
  };
  IsOturumu.prototype.sekmeTusu = function (e, ad) {
    var l = this.sekmeTanimlari.map(function (s) { return s.ad; }), i = l.indexOf(ad), y = -1;
    if (e.key === "ArrowRight") y = (i + 1) % l.length; else if (e.key === "ArrowLeft") y = (i - 1 + l.length) % l.length;
    else if (e.key === "Home") y = 0; else if (e.key === "End") y = l.length - 1;
    if (y < 0) return;
    e.preventDefault();
    var b = P.$('[data-sekme="' + l[y] + '"]', this.sekmeSerit); if (b) { b.focus(); }
  };
  IsOturumu.prototype.sekmeGoster = function (ad) {
    var ctx = this;
    if (!ctx.sekmeTanimlari) ctx.sekmeleriKur();
    var tanim = ctx.sekmeTanimlari.filter(function (s) { return s.ad === ad; })[0] || ctx.sekmeTanimlari[0];
    if (!tanim) return;
    ad = tanim.ad;
    ctx.sekmeTanimlari.forEach(function (s) {
      var sec = s.ad === ad, d = P.$('[data-sekme="' + s.ad + '"]', ctx.sekmeSerit), p = ctx.sekmePaneli[s.ad];
      d.setAttribute("aria-selected", sec ? "true" : "false"); d.tabIndex = sec ? 0 : -1; p.hidden = !sec;
    });
    ctx.aktifSekme = ad;
    var p = ctx.sekmePaneli[ad];
    if (!ctx.sekmeNesne[ad]) {
      var n = tanim.kur(ctx);
      ctx.sekmeNesne[ad] = n; p.appendChild(n.kok);
      if (n.guncelle) { try { n.guncelle(); } catch (e) { console.error(e); } }
    }
    if (ctx.sekmeNesne[ad].ac) { try { ctx.sekmeNesne[ad].ac(); } catch (e) { console.error(e); } }
    ctx.kilitleriUygula();
  };
  var gorunumAcik = false;
  P.olay.dinle("calisanlar", function () { Object.keys(oturumlar).forEach(function (k) { oturumlar[k].kilitleriUygula(); }); listeCiz(); var a = oturumlar[aktifIs]; if (a && gorunumAcik) a.yenile().catch(function () { }); });
  // her calisanlar yoklamasinda (2 sn) acik isin ilerleme cubugunu gunceller; yapi degismediyse seridi yeniden cizmez
  P.olay.dinle("calisan-tazele", function () { var a = oturumlar[aktifIs]; if (a && gorunumAcik) a.ilerlemeGuncelle(P.calisanBul(a.is)); });
  P.olay.dinle("is-bitti", function (o) {
    P.islerYenile().catch(function () { });
    var c = o && oturumlar[o.is]; if (c) c.yenile().catch(function () { });
  });

  // ---------------------------------------------------------------- gorunum: kur/ac
  function detayGoster(is, sekme) {
    aktifIs = is;
    var ctx = oturumlar[is];
    if (!ctx) {
      ctx = oturumlar[is] = new IsOturumu(is);
      ui.detayKok.appendChild(ctx.kok);
      var l = P.isBul(is);
      if (l) { ctx.ozetVeri = l; ctx.ozetT = Date.now(); }
      ctx.ciz();
      ctx.yenile().catch(function () { });
      // bellek: en fazla 6 acik is sayfasi
      var adlar = Object.keys(oturumlar);
      if (adlar.length > 6) {
        adlar.filter(function (a) { return a !== is && !P.kirli.has("senaryo:" + a) && !P.kirli.has("altyazi:" + a) && !P.kirli.has("ham:" + a) && !P.kirli.has("gorunum:" + a) && !P.kirli.has("ses:" + a); })
          .slice(0, adlar.length - 6).forEach(function (a) { oturumlar[a].kok.remove(); delete oturumlar[a]; });
      }
    }
    Object.keys(oturumlar).forEach(function (k) { oturumlar[k].kok.hidden = k !== is; oturumlar[k].etkin = k === is; });
    ui.hosgeldin.hidden = true; ui.yeniForm.hidden = true;
    ctx.sekmeGoster(sekme || "uretim");
    return ctx;
  }
  P.isOturumu = function (is) { return oturumlar[is] || null; };

  function kolonDurumu(detayAcik) { ui.cift.classList.toggle("detay-acik", !!detayAcik); }

  var kayit = {
    baslik: "Videolar", ikon: "liste",
    kur: function (kok) {
      ui.sayac = P.h("span", { class: "soluk" });
      ui.arama = P.girdi({ type: "search", placeholder: "Videolarda ara…", "aria-label": "Videolarda ara", class: "arama", oninput: function (e) { arama = e.target.value.trim().toLowerCase(); listeCiz(); } });
      ui.liste = P.h("ul", { class: "liste", role: "list" });
      // "_yeni": is adlari harf/rakamla basladigi icin ayni adli bir isle cakisamaz
      var yeniBtn = P.dugme("Yeni video", { ikon: "arti", tur: "birincil", onclick: function () { P.git("videolar/_yeni"); } });
      var listeKolon = P.h("aside", { class: "liste-kolon", "aria-label": "Video listesi" },
        P.h("div", { class: "liste-ust" }, P.h("h1", { tabindex: "-1", id: "h-videolar" }, "Videolar"), ui.sayac),
        P.h("div", { class: "liste-araclar" }, yeniBtn, ui.arama),
        ui.liste);
      ui.hosgeldin = P.h("div", { class: "hosgeldin" });
      ui.yeniForm = P.h("div", { class: "yeni-form-kok", hidden: true });
      ui.detayKok = P.h("div", { class: "detay-kok" }, ui.hosgeldin, ui.yeniForm);
      ui.cift = P.h("div", { class: "cift" }, listeKolon, P.h("div", { class: "detay-kolon" }, ui.detayKok));
      kok.appendChild(ui.cift);
      // yoklayicilar yalniz gorunum acikken calisir
    },
    ac: function (parcalar) {
      var p0 = parcalar[0], p1 = parcalar[1];
      var ilkAcilis = !listeYoklayici;
      if (ilkAcilis) {
        // yoklayıcılar yalnız Videolar görünümü açıkken ağa çıkar (Kaynaklar/Trend'deyken /api/isler boşuna çağrılmaz)
        listeYoklayici = P.yokla(function () { return gorunumAcik ? P.islerYenile() : null; }, function () { return P.calisan.liste.some(function (c) { return c.durum === "calisiyor"; }) ? 3000 : 6000; });
        P.olay.dinle("isler", listeCiz);
        detayYoklayici = P.yokla(async function () { var a = oturumlar[aktifIs]; if (a && a.etkin && gorunumAcik) await a.yenile(); }, function () { var a = oturumlar[aktifIs]; return a && a.mesgul() ? 3500 : 12000; });
      }
      gorunumAcik = true;
      if (!ilkAcilis) { listeYoklayici.simdi(); if (detayYoklayici) detayYoklayici.simdi(); }          // başka görünümden dönünce liste/detay hemen tazelensin
      if (p0 === "_yeni") {
        aktifIs = null;
        Object.keys(oturumlar).forEach(function (k) { oturumlar[k].kok.hidden = true; oturumlar[k].etkin = false; });
        ui.hosgeldin.hidden = true; ui.yeniForm.hidden = false;
        if (!ui.yeniForm.firstChild && P.yeniFormuKur) ui.yeniForm.appendChild(P.yeniFormuKur());
        if (P.yeniFormuAc) P.yeniFormuAc(P.rota().parcalar.slice(1));
        kolonDurumu(true);
      } else if (p0 && P.guvenliAd(p0)) {
        detayGoster(p0, p1);
        kolonDurumu(true);
      } else {
        aktifIs = null;
        Object.keys(oturumlar).forEach(function (k) { oturumlar[k].kok.hidden = true; oturumlar[k].etkin = false; });
        ui.yeniForm.hidden = true; ui.hosgeldin.hidden = false;
        if (!ui.hosgeldin.firstChild) hosgeldinKur();
        else { var kk = P.$(".onkontrol", ui.hosgeldin); if (kk && kk.yenile) kk.yenile(); }          // anahtar/disk durumu guncel kalsin
        kolonDurumu(false);
      }
      listeCiz();
    },
    birak: function () { gorunumAcik = false; },
    // odak hedefi: acik isin/yeni formun/karsilamanin basligi, yoksa liste basligi
    odak: function () {
      return P.$(".detay:not([hidden]) .detay-baslik h2", ui.cift) || (!ui.yeniForm.hidden ? P.$("h2", ui.yeniForm) : null) || (!ui.hosgeldin.hidden ? P.$("h2", ui.hosgeldin) : null) || P.$("h1", ui.cift);
    }
  };
  function hosgeldinKur() {
    P.degistir(ui.hosgeldin,
      P.h("header", { class: "sayfa-baslik" }, P.h("div", null, P.h("h2", { tabindex: "-1" }, "Konudan bitmiş videoya"), P.h("p", { class: "soluk" }, "Konuyu yaz; senaryo, görseller, seslendirme ve video sırayla hazırlanır. Senaryoyu onaylayana kadar ses ve video üretilmez."))),
      P.bolum("Başlamadan önce", "Anahtarlar, disk ve maliyet kontrolü.", P.onkontrolKutusu({ tur: "hepsi" })),
      P.bolum("Nasıl çalışır", null, P.h("ol", { class: "adim-listesi" },
        P.h("li", null, P.h("strong", null, "Konu ve başlık."), " Dil, ses ve süreyi seç; istersen kaynak metin ver."),
        P.h("li", null, P.h("strong", null, "Senaryo."), " Claude ya da vidIQ yazar (ya da sen yapıştırırsın); onay için durur."),
        P.h("li", null, P.h("strong", null, "Görseller ve ses."), " Ücretsiz kaynaklardan görsel bulunur; metin seslendirilir."),
        P.h("li", null, P.h("strong", null, "Video ve yayın paketi."), " Kapak, açıklama, bölümler ve görsel atıfları hazırlanır."))),
      P.h("div", { class: "satir" }, P.dugme("Yeni video oluştur", { ikon: "arti", tur: "birincil", onclick: function () { P.git("videolar/_yeni"); } })));
  }
  P.gorunumKaydet("videolar", kayit);
})();
