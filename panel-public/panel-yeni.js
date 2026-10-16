// PANEL ARAYUZU — "Yeni video" formu. POST /api/yeni {baslik,nis,format,sureDk,dil,ses,sesHizi,altyaziDili,tur,ton,kaynakMetin,kisiselKatki,kanal,slogan,acilisStili,onay,uret,ad}
// Sunucu uret:true ise ONCE on kontrol yapar; basarisizsa klasor acilmaz (400 {kod, hata, cozum, sorunlar}).
// Yazilan metin sessionStorage'a taslak olarak kaydedilir; gorunum degisse/sayfa yenilense kaybolmaz.
(function () {
  "use strict";
  var P = window.P;
  P.yeniOnDoldur = null;               // {baslik, nis, dil, format} — trend raporundan "Bu konuda video yap"
  var form = null;                     // {kok, doldur(o), ...}
  var TASLAK = "yeniTaslak";

  function kur() {
    var ayar = P.ayar || {};
    var dokunuldu = {};
    var alanlar = {};
    var durumYer = P.h("div", { class: "durum-yeri", "aria-live": "polite" });

    // --- alanlar
    alanlar.nis = P.metinAlani({ id: "y-nis", rows: "5", "data-alan": "nis", maxlength: "5000",
      placeholder: "Ne anlatılsın? Bir iki cümle yeter. Örnekler:\n• Roma İmparatorluğu neden çöktü\n• Bir kafe zinciri için reklam videosu — sabah kahvesi, taze çekirdek\n• Yapay zekânın hastalıklara tedavi bulması" });
    alanlar.baslik = P.girdi({ id: "y-baslik", "data-alan": "baslik", maxlength: "300", placeholder: "Videoda ve YouTube'da görünecek başlık" });
    alanlar.format = P.secim(Object.keys(P.FORMATLAR).map(function (k) { return [k, P.FORMATLAR[k].etiket + " — " + P.FORMATLAR[k].oran]; }), "long", { id: "y-format", "data-alan": "format" });
    alanlar.sure = P.girdi({ id: "y-sure", type: "number", step: "0.25", min: "0.25", max: "60", "data-alan": "sureDk" });
    alanlar.dil = P.secim(P.DILLER, ayar.dil || "en", { id: "y-dil", "data-alan": "dil" });
    alanlar.hiz = P.secim(P.SES_HIZLARI.map(function (x) { return [x, x === "+0%" ? "Normal (+0%)" : x]; }), ayar.sesHizi || "+7%", { id: "y-hiz", "data-alan": "sesHizi" });
    alanlar.altyazi = P.secim(P.DILLER, ayar.dil || "en", { id: "y-altyazi", "data-alan": "altyaziDili" });
    alanlar.tur = P.secim(P.TURLER, ayar.tur || "belgesel", { id: "y-tur", "data-alan": "tur" });
    alanlar.ton = P.girdi({ id: "y-ton", "data-alan": "ton", maxlength: "200", placeholder: "örn. ciddi ve sakin · esprili · heyecanlı", deger: ayar.ton || "" });
    alanlar.kaynak = P.metinAlani({ id: "y-kaynak", rows: "5", "data-alan": "kaynakMetin", maxlength: "20000", placeholder: "İsteğe bağlı: elindeki makale, not ya da veri. Doluysa senaryo yalnız bu kaynaktaki ve yaygın bilinen bilgilere dayanır; emin olmadığı rakamı yuvarlar." });
    alanlar.katki = P.metinAlani({ id: "y-katki", rows: "3", "data-alan": "kisiselKatki", maxlength: "1500", placeholder: "İsteğe bağlı: senin bakışın, yorumun, deneyimin — senaryoya kendi sesin olarak işlenir." });
    alanlar.kanal = P.girdi({ id: "y-kanal", "data-alan": "kanal", maxlength: "60", placeholder: ayar.kanal || "KANALIM" });
    alanlar.slogan = P.girdi({ id: "y-slogan", "data-alan": "slogan", maxlength: "120", placeholder: ayar.slogan || "(boş)" });
    alanlar.ad = P.girdi({ id: "y-ad", "data-alan": "ad", maxlength: "120", placeholder: "boşsa başlıktan otomatik" });
    var onaySenaryo = P.onayKutusu("Senaryo hazır olunca dur ve onayımı bekle (önerilen)", !(ayar.onay && ayar.onay.senaryo === false));
    var onayGorsel = P.onayKutusu("Görseller bulununca da dur ve onayımı bekle", !!(ayar.onay && ayar.onay.gorsel));
    var hizli = P.h("input", { type: "radio", name: "y-acilis", value: "hizli", id: "y-acilis-h", checked: true });
    var sinematik = P.h("input", { type: "radio", name: "y-acilis", value: "sinematik", id: "y-acilis-s" });
    var acilisUyari = P.h("div", { class: "durum-yeri" });
    var acilisKutusu = P.h("fieldset", { class: "alan secenekler" }, P.h("legend", null, "Açılış stili (yalnız uzun video)"),
      P.h("label", { class: "onay" }, hizli, P.h("span", null, "Hızlı — anlatım ilk saniyede başlar, kanal adı alt köşede kısa görünür (önerilen)")),
      P.h("label", { class: "onay" }, sinematik, P.h("span", null, "Sinematik — 5 sn geri sayım + 10 sn intro + 3 sn konu kartı")),
      acilisUyari);
    var sesSel = P.h("select", { id: "y-ses", "data-alan": "ses" });
    var sesDiger = P.girdi({ id: "y-ses-diger", "data-alan": "ses", placeholder: "örn. en-US-AriaNeural", hidden: true, "aria-label": "Ses adı" });
    var sureNot = P.h("div", { class: "ipucu" });
    var kelimeNot = P.h("div", { class: "ipucu" });
    // trend/viral raporundan gelen referans: senaryo istemine hook ve sure kaliplari ornek yapi olarak girer (konu.json _trendRapor)
    var trendRapor = null;
    var trendNotu = P.h("div", { class: "durum-yeri" });
    function trendNotuCiz() {
      P.degistir(trendNotu, trendRapor ? P.mesajKutusu("bilgi", P.h("strong", null, "Trend referansı: "), P.h("span", { class: "mono" }, trendRapor),
        " — raporun açılış kalıpları ve süreleri senaryoya örnek yapı olarak verilir (başkasının metni kopyalanmaz). ",
        P.dugme("Kaldır", { kucuk: true, tur: "hafif", onclick: function () { trendRapor = null; trendNotuCiz(); taslakKaydet(); } })) : null);
    }
    var sureAlan = P.alan("Süre (dakika)", alanlar.sure);
    sureAlan.appendChild(sureNot);
    var sesAlan = P.alan("Ses", sesSel);
    sesAlan.appendChild(sesDiger);
    var kanalUyari = P.h("div", { class: "durum-yeri" });

    function sesDoldur(dil, secili) {
      P.bos(sesSel);
      var liste = P.SESLER[dil] || [];
      liste.forEach(function (s) { sesSel.appendChild(P.h("option", { value: s }, s.replace(/Neural$/, ""))); });
      sesSel.appendChild(P.h("option", { value: "__diger" }, "Başka ses adı yaz…"));
      if (secili && liste.indexOf(secili) >= 0) { sesSel.value = secili; sesDiger.hidden = true; }
      else if (secili) { sesSel.value = "__diger"; sesDiger.value = secili; sesDiger.hidden = false; }
      else { sesSel.value = liste[0] || "__diger"; sesDiger.hidden = sesSel.value !== "__diger"; }
    }
    function sesDeger() { return sesSel.value === "__diger" ? sesDiger.value.trim() : sesSel.value; }
    function varsayilanSes(dil) { var a = ayar.ses || ""; return a.toLowerCase().indexOf(dil + "-") === 0 ? a : P.varsayilanSes(dil); }

    function bicimGuncelle() {
      var f = alanlar.format.value, bilgi = P.FORMATLAR[f];
      if (!dokunuldu.sure) alanlar.sure.value = String(Math.round(bilgi.varsSn / 60 * 100) / 100);
      var dk = Number(alanlar.sure.value) || 0, sn = dk * 60, dil = alanlar.dil.value;
      // uyarı simgesi sistem emojisi değil, panelin kendi SVG ikonu (her sistemde aynı görünür)
      P.degistir(sureNot, bilgi.not, bilgi.teknikMax && sn > bilgi.teknikMax ? P.h("span", { class: "ipucu-uyari" }, P.ikon("uyari"), "Seçtiğin süre bu biçimin teknik sınırını (" + bilgi.teknikMax + " sn) aşıyor.") : null);
      kelimeNot.textContent = dk ? "≈ " + P.sayi(Math.round(dk * P.kelimeHizi(dil))) + " kelime (" + P.dilAdi(dil) + " için dakikada ~" + P.kelimeHizi(dil) + ")" : "";
      acilisKutusu.hidden = f !== "long";
      var sin = sinematik.checked && f === "long";
      P.degistir(acilisUyari, sin ? P.mesajKutusu("uyari", "İlk söz yaklaşık 18 saniye sonra gelir; izleyici en çok bu ilk saniyelerde ayrılır. Emin değilsen Hızlı'yı seç.") : null);
    }
    function kanalKontrol() {
      var k = alanlar.kanal.value.trim() || (P.ayar && P.ayar.kanal) || "KANALIM";
      P.degistir(kanalUyari, k === "KANALIM" ? P.mesajKutusu("uyari", "Kanal adı hâlâ KANALIM; videoda bu yazı çıkar. ", P.dugme("Kanal ayarına git", { kucuk: true, tur: "hafif", onclick: function () { P.git("kanal"); } })) : null);
    }

    alanlar.format.addEventListener("change", bicimGuncelle);
    alanlar.sure.addEventListener("input", function () { dokunuldu.sure = true; bicimGuncelle(); });
    alanlar.dil.addEventListener("change", function () {
      var dil = alanlar.dil.value;
      if (!dokunuldu.ses) sesDoldur(dil, varsayilanSes(dil)); else sesDoldur(dil, null);
      if (!dokunuldu.altyazi) alanlar.altyazi.value = dil;
      bicimGuncelle();
    });
    alanlar.altyazi.addEventListener("change", function () { dokunuldu.altyazi = true; });
    sesSel.addEventListener("change", function () { dokunuldu.ses = true; sesDiger.hidden = sesSel.value !== "__diger"; if (!sesDiger.hidden) sesDiger.focus(); });
    hizli.addEventListener("change", bicimGuncelle); sinematik.addEventListener("change", bicimGuncelle);
    alanlar.kanal.addEventListener("input", kanalKontrol);

    // --- taslak (sessionStorage)
    var kayitZ = null;
    function topla() {
      var f = alanlar.format.value;
      return { nis: alanlar.nis.value, baslik: alanlar.baslik.value, format: f, sure: alanlar.sure.value, sureDokunuldu: !!dokunuldu.sure, dil: alanlar.dil.value, ses: sesDeger(), sesDokunuldu: !!dokunuldu.ses,
        hiz: alanlar.hiz.value, altyazi: alanlar.altyazi.value, altyaziDokunuldu: !!dokunuldu.altyazi, tur: alanlar.tur.value, ton: alanlar.ton.value, kaynak: alanlar.kaynak.value, katki: alanlar.katki.value,
        kanal: alanlar.kanal.value, slogan: alanlar.slogan.value, ad: alanlar.ad.value, acilis: sinematik.checked ? "sinematik" : "hizli", onaySenaryo: onaySenaryo.girdi.checked, onayGorsel: onayGorsel.girdi.checked,
        trendRapor: trendRapor };
    }
    function kirliMi() { return !!(alanlar.nis.value.trim() || alanlar.baslik.value.trim() || alanlar.kaynak.value.trim() || alanlar.katki.value.trim()); }
    function taslakKaydet() {
      clearTimeout(kayitZ);
      kayitZ = setTimeout(function () {
        // taslak sessionStorage'a yazilir; sayfa yenilense de geri gelir, bu yuzden cikis uyarisi (P.kirli) gerekmez
        if (kirliMi()) P.depo.yaz(TASLAK, topla()); else P.depo.sil(TASLAK);
      }, 300);
    }
    function doldur(t) {
      if (!t) return;
      if (t.nis != null) alanlar.nis.value = t.nis;
      if (t.baslik != null) alanlar.baslik.value = t.baslik;
      if (t.format && P.FORMATLAR[t.format]) alanlar.format.value = t.format;
      dokunuldu.sure = !!t.sureDokunuldu; if (t.sure) alanlar.sure.value = t.sure;
      if (t.dil) alanlar.dil.value = t.dil;
      dokunuldu.ses = !!t.sesDokunuldu; sesDoldur(alanlar.dil.value, t.ses || varsayilanSes(alanlar.dil.value));
      if (t.hiz) alanlar.hiz.value = t.hiz;
      dokunuldu.altyazi = !!t.altyaziDokunuldu; alanlar.altyazi.value = t.altyazi || alanlar.dil.value;
      if (t.tur) alanlar.tur.value = t.tur;
      if (t.ton != null) alanlar.ton.value = t.ton;
      if (t.kaynak != null) alanlar.kaynak.value = t.kaynak;
      if (t.katki != null) alanlar.katki.value = t.katki;
      if (t.kanal != null) alanlar.kanal.value = t.kanal;
      if (t.slogan != null) alanlar.slogan.value = t.slogan;
      if (t.ad != null) alanlar.ad.value = t.ad;
      (t.acilis === "sinematik" ? sinematik : hizli).checked = true;
      if (t.onaySenaryo !== undefined) onaySenaryo.girdi.checked = !!t.onaySenaryo;
      if (t.onayGorsel !== undefined) onayGorsel.girdi.checked = !!t.onayGorsel;
      if (t.trendRapor !== undefined) trendRapor = t.trendRapor || null;
      bicimGuncelle(); kanalKontrol(); trendNotuCiz();
    }

    // --- gonder
    var butonlar = [];
    function govde(uret) {
      var f = alanlar.format.value;
      var g = { baslik: alanlar.baslik.value.trim(), format: f, dil: alanlar.dil.value, ses: sesDeger(), sesHizi: alanlar.hiz.value, altyaziDili: alanlar.altyazi.value, tur: alanlar.tur.value,
        onay: { senaryo: onaySenaryo.girdi.checked, gorsel: onayGorsel.girdi.checked }, acilisStili: sinematik.checked ? "sinematik" : "hizli", uret: !!uret };
      var dk = Number(alanlar.sure.value); if (dk > 0) g.sureDk = dk;
      if (trendRapor) g.trendRapor = trendRapor;
      [["nis", alanlar.nis], ["ton", alanlar.ton], ["kaynakMetin", alanlar.kaynak], ["kisiselKatki", alanlar.katki], ["kanal", alanlar.kanal], ["slogan", alanlar.slogan], ["ad", alanlar.ad]].forEach(function (x) {
        var v = x[1].value.trim(); if (v) g[x[0]] = v;
      });
      return g;
    }
    async function gonder(uret) {
      P.durumYaz(durumYer, null); P.alanHatalari(kok, []);
      var g = govde(uret);
      if (!g.baslik) { P.alanHatalari(kok, [{ alan: "baslik", mesaj: "Başlık gerekli." }]); P.durumYaz(durumYer, "hata", "Başlık gerekli."); return; }
      if (g.ses === "" ) { P.alanHatalari(kok, [{ alan: "ses", mesaj: "Ses adı gerekli." }]); return; }
      butonlar.forEach(function (b) { b.disabled = true; });
      P.durumYaz(durumYer, "bilgi", uret ? "Kontrol ediliyor ve iş açılıyor…" : "İş açılıyor…");
      try {
        var r = await P.api("/api/yeni", g, { zamanAsimi: 40000 });
        P.depo.sil(TASLAK);
        ["nis", "baslik", "kaynak", "katki", "ad"].forEach(function (k) { alanlar[k].value = ""; });
        trendRapor = null; trendNotuCiz();
        dokunuldu = {}; bicimGuncelle();
        P.yeniUyarilar[r.ad] = r.uyarilar || [];
        await P.islerYenile().catch(function () { });
        P.git("videolar/" + r.ad);
        if (r.id) P.izleBaslat(r.id, { is: r.ad, tur: "hepsi" });
        P.durumYaz(durumYer, null);
        P.bildir(uret ? "İş açıldı ve üretim başladı." : "İş oluşturuldu.", "ok");
      } catch (e) {
        if (e.alanlar && e.alanlar.length) P.alanHatalari(kok, e.alanlar);
        var kutu = P.hataKutusu(e);
        if (e.sorunlar && e.sorunlar.some(function (s) { return s.kod === "anahtar_yok"; })) kutu.querySelector(".mesaj-govde").appendChild(P.dugme("Kaynaklar'a git", { kucuk: true, onclick: function () { P.git("kaynaklar"); } }));
        P.bos(durumYer); durumYer.appendChild(kutu);
      }
      butonlar.forEach(function (b) { b.disabled = false; });
    }
    var uretBtn = P.dugme("Üret", { tur: "birincil", ikon: "oynat", onclick: function () { gonder(true); } });
    var olusturBtn = P.dugme("Yalnız oluştur", { tur: "hafif", onclick: function () { gonder(false); }, title: "İşi açar ama üretimi başlatmaz; ayarları düzenledikten sonra üretirsin" });
    var vazgecBtn = P.dugme("Vazgeç", { tur: "hafif", onclick: function () { P.git("videolar"); } });
    butonlar.push(uretBtn, olusturBtn);

    var kok = P.h("div", { class: "yeni-form" },
      P.h("header", { class: "sayfa-baslik" }, P.h("div", null, P.h("h2", { tabindex: "-1" }, "Yeni video"), P.h("p", { class: "soluk" }, "Konuyu ve ayarları seç. Senaryo hazır olunca onayını bekler; ses ve video ondan sonra üretilir."))),
      P.bolum("Başlamadan önce", "Eksik anahtar ya da yetersiz disk varsa burada görünür.", P.onkontrolKutusu({ tur: "hepsi" })),
      P.bolum("Konu", "Ne hakkında? Başlık videoda ve yayında kullanılır.",
        P.alan("Konu / ne anlatılsın?", alanlar.nis, { ipucu: "Boş bırakırsan yalnızca başlıktan yazılır." }), P.alan("Video başlığı", alanlar.baslik)),
      P.bolum("Biçim ve süre", null,
        P.h("div", { class: "alan-izgara" }, P.alan("Biçim", alanlar.format), sureAlan),
        kelimeNot, acilisKutusu),
      P.bolum("Dil ve ses", "Anlatım dili senaryonun yazılacağı dildir; ses ve hız seslendirmeyi belirler.",
        P.h("div", { class: "alan-izgara" }, P.alan("Anlatım dili", alanlar.dil), sesAlan, P.alan("Konuşma hızı", alanlar.hiz),
          P.alan("Altyazı dili", alanlar.altyazi, { ipucu: "Anlatım dilinden farklıysa çeviri adımı eklenir (Claude anahtarı gerekir)." }))),
      P.bolum("Üslup ve içerik", "Tür ve ton senaryonun yapısını belirler.",
        P.h("div", { class: "alan-izgara" }, P.alan("Tür", alanlar.tur), P.alan("Ton", alanlar.ton)),
        P.alan("Kaynak / araştırma metni", alanlar.kaynak), P.alan("Kendi katkın", alanlar.katki), trendNotu),
      P.bolum("Kanal", "Boş bırakırsan Kanal ekranındaki ayar kullanılır.",
        P.h("div", { class: "alan-izgara" }, P.alan("Kanal adı", alanlar.kanal), P.alan("Slogan", alanlar.slogan)), kanalUyari,
        P.h("details", { class: "gelismis" }, P.h("summary", null, "Gelişmiş"), P.alan("Klasör adı", alanlar.ad, { ipucu: "Boşsa başlıktan türetilir; aynı ad varsa sona sayı eklenir." }))),
      P.bolum("Onay ve başlatma", null,
        P.h("div", { class: "yigin" }, onaySenaryo, onayGorsel),
        P.h("p", { class: "ipucu" }, "Üret: senaryoyu Claude ya da vidIQ yazar (ücretli; tahmini maliyet yukarıdaki kontrol listesinde). Senaryoyu elle yazmayı seçersen «Yalnız oluştur»a bas, sonra Senaryo sekmesine yapıştır."),
        P.h("div", { class: "satir" }, uretBtn, olusturBtn, vazgecBtn), durumYer));
    kok.addEventListener("input", taslakKaydet); kok.addEventListener("change", taslakKaydet);

    // ilk doldurma: taslak > varsayilan
    sesDoldur(alanlar.dil.value, varsayilanSes(alanlar.dil.value));
    var t = P.depo.oku(TASLAK, null);
    if (t) doldur(t); else bicimGuncelle();
    kanalKontrol();
    form = { kok: kok, doldur: function (o) {
      var mevcut = topla(); var t2 = Object.assign({}, mevcut, o);
      doldur(t2); taslakKaydet(); alanlar.baslik.focus();
    }, odak: function () { alanlar.baslik.focus(); }, yenileKontrol: function () { var k = P.$(".onkontrol", kok); if (k && k.yenile) k.yenile(); } };
    return kok;
  }

  P.yeniFormuKur = function () { return kur(); };
  P.yeniFormuAc = function () {
    if (!form) return;
    if (P.yeniOnDoldur) { var o = P.yeniOnDoldur; P.yeniOnDoldur = null; form.doldur(o); }
    form.yenileKontrol();
  };
  // trend raporundan: P.yeniVideoYap({baslik, nis, dil, format})
  P.yeniVideoYap = function (o) { P.yeniOnDoldur = o || {}; P.git("videolar/_yeni"); };
})();
