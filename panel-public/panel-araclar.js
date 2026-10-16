// PANEL ARAYUZU — "Araclar" gorunumu: VS karsilastirma videosu tanimi + video indirici ve Ai Infapp baslatma.
// Uclar: POST /api/vs-yeni {baslik,ad,ust,alt,olculer,kazanan,sonuc,sonuc2} -> vs-tanim.json, POST /api/calistir {tur:"vsHepsi"}, POST /api/indirici/baslat ve POST /api/aiinfapp/baslat -> {ok,port}.
// Sunucu dogrulama hatalari {alanlar:[{alan:"ust.ad"|"olculer[0].ustDeger"|...}]} ile gelir; ayni adlar data-alan olarak isaretlidir.
(function () {
  "use strict";
  var P = window.P;
  var ui = {}, olcuSatirlari = [];
  var MAKS_OLCU = 8;

  // ---------------------------------------------------------------- ayri pencerede acilan yerel araclar (video indirici, Ai Infapp)
  // Ikisi de kendi sunucusu olan alt klasordur; panel dugmeyle baslatir, sunucu portunu doner, arac yeni pencerede acilir.
  var aciliyor = {};      // ozellik -> baslatma istegi suruyor: cift tik / ust dugme + Araclar dugmesi ikinci pencere ve ikinci istek acmasin
  async function aracAc(arac, yer) {
    var oz = P.ozellikler && P.ozellikler[arac.ozellik];
    if (oz && oz.var === false) { if (yer) P.durumYaz(yer, "hata", arac.ad + " bu kurulumda yok."); else P.bildir(arac.ad + " bu kurulumda yok.", "hata"); return; }
    if (aciliyor[arac.ozellik]) return;
    aciliyor[arac.ozellik] = true;
    // pencereyi tiklama aninda ve senkron ac (acilir pencere engelleyicisi); sonra yonlendir
    var w = window.open("", "_blank");
    try {
      var r = await P.api(arac.uc, {}, { zamanAsimi: 30000 });
      if (w) { try { w.opener = null; } catch (e) { /* yoksay */ } w.location.href = "http://localhost:" + r.port; }
      else if (yer) P.durumYaz(yer, "bilgi", P.h("span", null, "Tarayıcı yeni pencereyi engelledi. Şu adresi aç: ", P.h("a", { href: "http://localhost:" + r.port, target: "_blank", rel: "noopener noreferrer" }, "http://localhost:" + r.port)));
    } catch (e) {
      if (w) w.close();
      if (yer) P.durumYaz(yer, "hata", e); else P.bildir(P.hataMetni(e), "hata");
    } finally { aciliyor[arac.ozellik] = false; }
  }
  P.indiriciAc = function (yer) { return aracAc({ ozellik: "indirici", ad: "Video indirici", uc: "/api/indirici/baslat" }, yer); };
  P.aiInfappAc = function (yer) { return aracAc({ ozellik: "aiinfapp", ad: "Ai Infapp", uc: "/api/aiinfapp/baslat" }, yer); };

  // ---------------------------------------------------------------- VS formu
  function renkAlani(onek, varsayilan) {
    var g = P.girdi({ maxlength: "7", placeholder: varsayilan, class: "mono-alan", "data-alan": onek + ".renk", "aria-label": "Renk (6 haneli, # yok)", deger: varsayilan });
    var sec = P.h("input", { type: "color", class: "renk-sec", "aria-label": "Renk seç", value: "#" + varsayilan });
    sec.addEventListener("input", function () { g.value = sec.value.replace("#", "").toUpperCase(); });
    g.addEventListener("input", function () { var v = g.value.replace("#", ""); if (/^[0-9A-Fa-f]{6}$/.test(v)) sec.value = "#" + v; });
    return { girdi: g, sec: sec, kok: P.h("div", { class: "satir" }, g, sec) };
  }
  function taraf(onek, etiket, renk) {
    var t = { onek: onek };
    t.ad = P.girdi({ "data-alan": onek + ".ad", maxlength: "40", placeholder: "örn. Lion" });
    t.renk = renkAlani(onek, renk);
    t.ara = P.girdi({ "data-alan": onek + ".ara", maxlength: "80", placeholder: "görsel arama kelimesi, örn. lion" });
    t.zorunlu = P.girdi({ "data-alan": onek + ".zorunlu", placeholder: "virgülle ayır, en çok 6 (isteğe bağlı)" });
    t.sorgular = P.girdi({ "data-alan": onek + ".sorgular", placeholder: "yedek arama ifadeleri, virgülle (isteğe bağlı)" });
    t.kok = P.h("fieldset", { class: "taraf" }, P.h("legend", null, etiket),
      P.alan("Ad", t.ad), P.alan("Renk", t.renk.girdi, { ipucu: null }), P.h("div", { class: "alan" }, t.renk.sec),
      P.alan("Görsel arama kelimesi", t.ara), P.alan("Fotoğrafta geçmesi gereken kelimeler", t.zorunlu, { ipucu: "Yanlış hayvan/nesne çıkmasın diye süzgeç." }), P.alan("Yedek aramalar", t.sorgular));
    return t;
  }
  function virgulle(girdi) { return girdi.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean); }
  function tarafVeri(t) {
    var o = { ad: t.ad.value.trim(), ara: t.ara.value.trim() };
    var r = t.renk.girdi.value.trim().replace("#", ""); if (r) o.renk = r;
    var z = virgulle(t.zorunlu), s = virgulle(t.sorgular);
    if (z.length) o.zorunlu = z; if (s.length) o.sorgular = s;
    return o;
  }
  function olcuSatiri(i) {
    var o = { };
    var p = "olculer[" + i + "]";
    o.ad = P.girdi({ "data-alan": p + ".ad", maxlength: "24", "aria-label": "Ölçü " + (i + 1) + " adı", placeholder: "örn. Hız" });
    o.ustDeger = P.girdi({ "data-alan": p + ".ustDeger", type: "number", min: "0", step: "any", "aria-label": "Ölçü " + (i + 1) + " üst değer", inputmode: "decimal" });
    o.ustMetin = P.girdi({ "data-alan": p + ".ustMetin", maxlength: "24", "aria-label": "Ölçü " + (i + 1) + " üst ekran metni", placeholder: "50 km/s" });
    o.altDeger = P.girdi({ "data-alan": p + ".altDeger", type: "number", min: "0", step: "any", "aria-label": "Ölçü " + (i + 1) + " alt değer", inputmode: "decimal" });
    o.altMetin = P.girdi({ "data-alan": p + ".altMetin", maxlength: "24", "aria-label": "Ölçü " + (i + 1) + " alt ekran metni", placeholder: "70 km/s" });
    o.kazanan = P.secim([["ust", "Üst kazanır"], ["alt", "Alt kazanır"]], "ust", { "data-alan": p + ".kazanan", "aria-label": "Ölçü " + (i + 1) + " kazananı" });
    o.not = P.girdi({ "data-alan": p + ".not", maxlength: "80", "aria-label": "Ölçü " + (i + 1) + " notu", placeholder: "not (isteğe bağlı)" });
    return o;
  }
  function olculeriCiz() {
    P.degistir(ui.olcuListe, olcuSatirlari.map(function (o, i) {
      var sil = P.dugme("Sil", { kucuk: true, tur: "hafif", ikon: "sil", aria: "Ölçü " + (i + 1) + " satırını sil", disabled: olcuSatirlari.length <= 1, onclick: function () { olcuSatirlari.splice(i, 1); yenidenNumarala(); olculeriCiz(); } });
      return P.h("fieldset", { class: "olcu" }, P.h("legend", null, "Ölçü " + (i + 1)),
        P.h("div", { class: "alan-izgara" }, P.alan("Ad", o.ad), P.alan("Üst değer", o.ustDeger), P.alan("Üst metin", o.ustMetin), P.alan("Alt değer", o.altDeger), P.alan("Alt metin", o.altMetin), P.alan("Kazanan", o.kazanan), P.alan("Not", o.not)),
        P.h("div", { class: "satir" }, sil));
    }));
    ui.olcuEkle.disabled = olcuSatirlari.length >= MAKS_OLCU;
  }
  function yenidenNumarala() {
    olcuSatirlari.forEach(function (o, i) {
      var p = "olculer[" + i + "]";
      Object.keys(o).forEach(function (k) { o[k].setAttribute("data-alan", p + "." + k); });
    });
  }
  async function kaydet(uret) {
    var g = {
      baslik: ui.baslik.value.trim(), ust: tarafVeri(ui.ust), alt: tarafVeri(ui.alt), kazanan: ui.kazanan.value,
      olculer: olcuSatirlari.map(function (o) {
        var x = { ad: o.ad.value.trim(), ustDeger: Number(String(o.ustDeger.value).replace(",", ".")), ustMetin: o.ustMetin.value.trim(), altDeger: Number(String(o.altDeger.value).replace(",", ".")), altMetin: o.altMetin.value.trim(), kazanan: o.kazanan.value };
        if (o.not.value.trim()) x.not = o.not.value.trim();
        if (o.ustDeger.value.trim() === "" || !isFinite(x.ustDeger)) x.ustDeger = -1;       // sunucu "0 ve ustu sayi" hatasi versin
        if (o.altDeger.value.trim() === "" || !isFinite(x.altDeger)) x.altDeger = -1;
        return x;
      })
    };
    if (ui.ad.value.trim()) g.ad = ui.ad.value.trim();
    if (ui.sonuc.value.trim()) g.sonuc = ui.sonuc.value.trim();
    if (ui.sonuc2.value.trim()) g.sonuc2 = ui.sonuc2.value.trim();
    P.alanHatalari(ui.kok, []);
    [ui.kaydetBtn, ui.uretBtn].forEach(function (b) { b.disabled = true; });
    try {
      var r = await P.api("/api/vs-yeni", g);
      P.kirli.delete("vs");
      P.durumYaz(ui.durum, "ok", "VS tanımı kaydedildi: " + r.ad);
      await P.islerYenile().catch(function () { });
      if (uret) { var c = await P.calistir("vsHepsi", { is: r.ad }, ui.durum); if (c) { P.git("videolar/" + r.ad); } }
      else P.git("videolar/" + r.ad);
    } catch (e) {
      P.durumYaz(ui.durum, "hata", e);
      if (e.alanlar) P.alanHatalari(ui.kok, e.alanlar.map(function (a) { return { alan: a.alan, mesaj: a.mesaj }; }));
    }
    [ui.kaydetBtn, ui.uretBtn].forEach(function (b) { b.disabled = false; });
  }

  P.gorunumKaydet("araclar", {
    baslik: "Araçlar", ikon: "arac",
    kur: function (kok) {
      ui.kok = kok;
      ui.baslik = P.girdi({ id: "vs-baslik", maxlength: "120", "data-alan": "baslik", placeholder: "örn. LION vs TIGER — WHO WINS?" });
      ui.ad = P.girdi({ id: "vs-ad", maxlength: "48", "data-alan": "ad", placeholder: "boşsa başlıktan türetilir" });
      ui.ust = taraf("ust", "Üst taraf", "3BE07A"); ui.alt = taraf("alt", "Alt taraf", "FF6B6B");
      ui.kazanan = P.secim([["ust", "Genel kazanan: üst taraf"], ["alt", "Genel kazanan: alt taraf"]], "ust", { id: "vs-kazanan", "data-alan": "kazanan" });
      ui.sonuc = P.girdi({ id: "vs-sonuc", maxlength: "120", "data-alan": "sonuc", placeholder: "sonuç cümlesi (isteğe bağlı)" });
      ui.sonuc2 = P.girdi({ id: "vs-sonuc2", maxlength: "120", "data-alan": "sonuc2", placeholder: "ikinci satır (isteğe bağlı)" });
      ui.olcuListe = P.h("div", { class: "olcu-listesi" });
      ui.olcuEkle = P.dugme("Ölçü ekle", { tur: "hafif", ikon: "arti", onclick: function () { olcuSatirlari.push(olcuSatiri(olcuSatirlari.length)); olculeriCiz(); var son = ui.olcuListe.lastChild; if (son) { var f = son.querySelector("input"); if (f) f.focus(); } } });
      ui.durum = P.h("div", { class: "durum-yeri", "aria-live": "polite" });
      ui.kaydetBtn = P.dugme("Yalnız kaydet", { tur: "hafif", onclick: function () { kaydet(false); } });
      ui.uretBtn = P.dugme("Kaydet ve üret", { tur: "birincil", ikon: "oynat", onclick: function () { kaydet(true); } });
      ui.indirici = P.h("div", { class: "durum-yeri", "aria-live": "polite" });
      ui.aiInfapp = P.h("div", { class: "durum-yeri", "aria-live": "polite" });
      olcuSatirlari.push(olcuSatiri(0)); olculeriCiz();
      kok.addEventListener("input", function () { P.kirli.add("vs"); });
      var indirBtn = P.dugme("Video indiriciyi aç", { tur: "hafif", ikon: "indir", onclick: function () { P.indiriciAc(ui.indirici); } });
      var ssBtn = P.dugme("Ai Infapp'i aç", { tur: "hafif", ikon: "kisi", onclick: function () { P.aiInfappAc(ui.aiInfapp); } });
      P.degistir(kok,
        P.sayfaBasligi("h-araclar", "Araçlar", "Karşılaştırma (VS) videosu, video indirici ve Ai Infapp burada. Shorts kesme, kapak ve yayın paketi gibi araçlar her videonun kendi sayfasında."),
        P.bolum("VS karşılaştırma videosu", "İki tarafı ölçülerle karşılaştıran dikey kısa video. Aynı adlı bir VS işi varsa tanımı değiştirilir. Görseller ücretsiz kaynaklardan çekilir.",
          P.h("div", { class: "alan-izgara" }, P.alan("Başlık", ui.baslik), P.alan("İş adı", ui.ad)),
          P.h("div", { class: "taraflar" }, ui.ust.kok, ui.alt.kok)),
        P.bolum("Ölçüler", "En az 1, en çok " + MAKS_OLCU + ". Değerler sayıdır (çubuk oranı için); metin ekranda görünen yazıdır.", ui.olcuListe, P.h("div", { class: "satir" }, ui.olcuEkle)),
        P.bolum("Sonuç", null, P.h("div", { class: "alan-izgara" }, P.alan("Genel kazanan", ui.kazanan), P.alan("Sonuç", ui.sonuc), P.alan("İkinci satır", ui.sonuc2)),
          P.h("div", { class: "satir" }, ui.uretBtn, ui.kaydetBtn), ui.durum),
        P.bolum("Video indirici", "Link yapıştırıp indirir (YouTube, TikTok, X, Instagram) ve viral Keşfet akışı sunar. Ayrı bir pencerede çalışır. Yalnızca kendi içeriğin ya da yeniden kullanma iznin olan içerikler için kullan; başkasının videosunu izinsiz yeniden yüklemek telif ihlalidir.",
          P.h("div", { class: "satir" }, indirBtn), ui.indirici),
        P.bolum("Ai Infapp", "Karakter oluşturup kilitler (kimliği her istemde sabit tutar; yüz tutarlılığı bağladığın sağlayıcıya bağlıdır), fotoroman, Etsy baskı tasarımı ve reklam görseli hazırlar. Ayrı bir pencerede, bu bilgisayarda çalışır; fotoğraf karelerini senin bağladığın görsel üretim API'sinden alır (varsayılan: ücretsiz Pollinations).",
          P.h("div", { class: "satir" }, ssBtn), ui.aiInfapp));
    },
    ac: function () { }
  });
})();
