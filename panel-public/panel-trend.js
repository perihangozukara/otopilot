// PANEL ARAYUZU — "Trendler" gorunumu: trend/viral arama, rapor listesi ve tablosu, "Bu konuda video yap", performans ozeti.
// Uclar: POST /api/calistir {tur:"trend"|"viral"|"performans"}, GET /api/raporlar?tur=, GET /api/rapor?tur=&ad= -> {md,json}, GET /api/performans.
// Rapor json: {surum,tur,tarih,konu,dil,platform,satirlar:[{platform,baslik,url,izlenme,vph,sureSn,abone,kanal,hook}]}
(function () {
  "use strict";
  var P = window.P;
  var ui = {}, raporTuru = "trend", acikRapor = null;
  var PLATFORM_ETIKET = { "youtube-short": "YouTube Shorts", "youtube-long": "YouTube uzun", instagram: "Instagram", tiktok: "TikTok" };
  var PLATFORM_FORMAT = { "youtube-short": "short", "youtube-long": "long", instagram: "reels", tiktok: "tiktok" };

  var guvenliUrl = function (u) { return typeof u === "string" && /^https?:\/\//i.test(u) ? u : null; };
  var kisa = function (n) { n = Number(n); if (!isFinite(n)) return "—"; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(".", ",") + " Mn" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(".", ",") + " B" : String(Math.round(n)); };

  async function aramaBaslat(tur) {
    var g = { konu: ui.konu.value.trim(), dil: ui.dil.value };
    if (tur === "trend") { g.min = Number(ui.min.value) || 200000; g.platform = ui.platform.value; if (ui.siki.girdi.checked) g.siki = true; }
    else g.min = 10000000;
    P.durumYaz(ui.durum, null);
    var r;
    try { r = await P.api("/api/onkontrol?tur=" + tur); } catch (e) { P.durumYaz(ui.durum, "hata", e); return; }
    var hata = r.sorunlar.filter(function (s) { return s.seviye === "hata"; });
    if (hata.length) {
      P.bos(ui.durum);
      ui.durum.appendChild(P.mesajKutusu("hata", P.h("strong", null, "Başlatılamadı"), P.h("ul", null, hata.map(function (s) { return P.h("li", null, s.mesaj, s.cozum ? P.h("span", { class: "soluk" }, " — " + s.cozum) : null); })),
        P.dugme("Kaynaklar'a git", { kucuk: true, onclick: function () { P.git("kaynaklar"); } })));
      return;
    }
    var ok = await P.onayIste(ui.durum, { baslik: "Arama başlatılsın mı?", metin: "vidIQ kredisi harcar (ücretli). " + (tur === "viral" ? "Bu haftanın viral kısa videoları aranır." : "Seçtiğin platformlarda trend videolar aranır; yalnız seçili platform sorgulanır."), evet: "Ara" });
    if (!ok) return;
    var c = await P.calistir(tur, g, ui.durum);
    if (c) { raporTuru = tur; P.bildir("Arama başladı; bitince rapor burada açılır.", "bilgi"); }
  }

  // ---------------------------------------------------------------- rapor listesi + gosterim
  async function listeYukle() {
    try {
      var l = await P.api("/api/raporlar?tur=" + raporTuru);
      P.degistir(ui.liste, l.length ? l.slice(0, 40).map(function (x) {
        return P.h("li", null, P.h("button", { type: "button", class: "liste-satir" + (acikRapor === x.ad ? " secili" : ""), onclick: function () { raporAc(x.ad); } },
          P.h("span", { class: "ls-baslik" }, x.ad), P.h("span", { class: "soluk" }, P.tarihYaz(x.tarih))));
      }) : P.h("li", { class: "bos-durum" }, "Henüz " + (raporTuru === "viral" ? "viral" : "trend") + " raporu yok."));
      return l;
    } catch (e) { P.durumYaz(ui.liste, "hata", e); return []; }
  }
  async function raporAc(ad) {
    acikRapor = ad;
    P.durumYaz(ui.rapor, "bilgi", "Rapor yükleniyor…");
    try {
      var r = await P.api("/api/rapor?tur=" + raporTuru + "&ad=" + encodeURIComponent(ad));
      raporCiz(r, ad);
      listeYukle();
    } catch (e) { P.durumYaz(ui.rapor, "hata", e); }
  }
  function raporCiz(r, ad) {
    var j = r.json, ic = [];
    var md = P.h("details", null, P.h("summary", null, "Ham rapor (metin)"), P.h("pre", { class: "rapor-md" }, r.md || ""));
    if (j && Array.isArray(j.satirlar)) {
      var platformlar = {}; j.satirlar.forEach(function (s) { platformlar[s.platform] = 1; });
      var filtre = P.secim([["", "Tüm platformlar"]].concat(Object.keys(platformlar).map(function (k) { return [k, PLATFORM_ETIKET[k] || k]; })), "", { "aria-label": "Platform filtresi" });
      var govde = P.h("div", { class: "trend-satirlar" });
      var ciz = function () {
        var f = filtre.value;
        var s = j.satirlar.filter(function (x) { return !f || x.platform === f; }).slice().sort(function (a, b) { return (Number(b.izlenme) || 0) - (Number(a.izlenme) || 0); });
        P.degistir(govde, s.length ? s.map(function (x) {
          var url = guvenliUrl(x.url);
          return P.h("article", { class: "trend-satir" },
            P.h("div", { class: "trend-ust" }, P.rozet(PLATFORM_ETIKET[x.platform] || x.platform || "?", "soluk"),
              url ? P.h("a", { href: url, target: "_blank", rel: "noopener noreferrer", class: "trend-baslik" }, x.baslik || url) : P.h("span", { class: "trend-baslik" }, x.baslik || "(başlıksız)")),
            P.h("div", { class: "soluk" }, [x.kanal ? x.kanal : null, x.izlenme != null ? kisa(x.izlenme) + " izlenme" : null, x.vph != null ? kisa(x.vph) + "/saat" : null, x.sureSn ? P.sureYaz(x.sureSn) : null, x.abone != null ? kisa(x.abone) + " abone" : null].filter(Boolean).join(" · ")),
            x.hook ? P.h("p", { class: "trend-hook" }, P.h("strong", null, "İlk 3 sn: "), x.hook) : null,
            P.dugme("Bu konuda video yap", { kucuk: true, tur: "hafif", ikon: "arti", onclick: function () {
              // trendRapor: raporun hook ve süre kalıpları senaryo istemine örnek yapı olarak girer (konu.json _trendRapor)
              P.yeniVideoYap({ baslik: x.baslik || "", nis: (j.konu ? j.konu + " — " : "") + (x.baslik || ""), dil: j.dil || undefined, format: PLATFORM_FORMAT[x.platform] || "long",
                trendRapor: (raporTuru === "viral" ? "viral-analiz/" : "trend/") + ad + ".json" });
            } }));
        }) : P.h("p", { class: "soluk" }, "Bu filtreyle satır yok."));
      };
      filtre.addEventListener("change", ciz);
      ic.push(P.h("p", null, P.h("strong", null, j.konu ? "«" + j.konu + "»" : "Genel trend"), " · " + (j.dil || "") + " · " + (j.platform || "") + " · " + P.tarihYaz(j.tarih) + " · " + j.satirlar.length + " satır"),
        P.h("p", { class: "ipucu" }, "Kalıbı ve konuyu ilham al; başkasının başlığını ya da içeriğini aynen kopyalama, kendi anlatımınla işle."),
        j.satirlar.length ? filtre : null, govde);
      ciz();
    } else ic.push(P.h("p", { class: "soluk" }, "Bu rapor yapılandırılmış veri içermiyor; metni aşağıda."));
    ic.push(md);
    P.degistir(ui.rapor, ic);
  }

  // ---------------------------------------------------------------- performans
  async function performansYukle() {
    try {
      var r = await P.api("/api/performans");
      P.degistir(ui.perf,
        r.isler && r.isler.length ? P.h("ul", { class: "perf-liste" }, r.isler.map(function (x) {
          return P.h("li", null, P.h("a", { href: "#/videolar/" + encodeURIComponent(x.is), class: "mono" }, x.is), P.h("span", null, P.sayi(x.izlenme) + " izlenme"), P.h("span", { class: "soluk" }, x.sureSn ? P.sureYaz(x.sureSn) : "süre bilinmiyor"));
        })) : P.h("p", { class: "soluk" }, "Henüz performans verisi yok. Videoyu YouTube'a yükleyip adresini işin Yayın sekmesinde işaretle, sonra veriyi çek."),
        r.oneri ? P.mesajKutusu("bilgi", r.oneri) : null);
    } catch (e) { P.durumYaz(ui.perf, "hata", e); }
  }

  P.olay.dinle("is-bitti", function (o) {
    if (!o || (o.tur !== "trend" && o.tur !== "viral" && o.tur !== "performans")) return;
    if (o.tur === "performans") { performansYukle(); return; }
    raporTuru = o.tur; if (ui.tur) ui.tur.value = o.tur;
    if (o.durum !== "bitti") return;
    listeYukle().then(function (l) { if (l && l.length) raporAc(l[0].ad); });
  });

  P.gorunumKaydet("trend", {
    baslik: "Trendler", ikon: "trend",
    kur: function (kok) {
      ui.konu = P.girdi({ id: "tr-konu", placeholder: "örn. animal comparison — boş bırakırsan genel trend gelir", maxlength: "200" });
      ui.dil = P.secim(P.DILLER, (P.ayar && P.ayar.dil) || "en", { id: "tr-dil" });
      ui.platform = P.secim([["hepsi", "Üçü birden"], ["yt", "Yalnız YouTube"], ["ig", "Yalnız Instagram"], ["tt", "Yalnız TikTok"]], "hepsi", { id: "tr-platform" });
      ui.min = P.girdi({ id: "tr-min", type: "number", min: "0", step: "10000", deger: "200000", inputmode: "numeric" });
      ui.siki = P.onayKutusu("Sıkı eşleşme — YouTube'da başlığın tüm kelimeleri geçsin (dar konularda aç)", false);
      ui.durum = P.h("div", { class: "durum-yeri", "aria-live": "polite" });
      ui.liste = P.h("ul", { class: "liste kucuk-liste", role: "list" });
      ui.rapor = P.h("div", { class: "rapor-yer" });
      ui.perf = P.h("div", { class: "perf-yer" });
      ui.tur = P.secim([["trend", "Trend raporları"], ["viral", "Viral analizler"]], "trend", { "aria-label": "Rapor türü", onchange: function (e) { raporTuru = e.target.value; acikRapor = null; P.bos(ui.rapor); listeYukle(); } });
      P.degistir(kok,
        P.sayfaBasligi("h-trend", "Trendler", "Konu fikri bul: YouTube'da şu an hızla izlenenler, Instagram ve TikTok'ta hesabının ortalamasını çok aşanlar."),
        P.bolum("Trend ara", "vidIQ ile arar (ücretli). Yalnız seçtiğin platform sorgulanır, diğerleri için kredi harcanmaz.",
          P.alan("Konu", ui.konu),
          P.h("div", { class: "alan-izgara" }, P.alan("Dil", ui.dil), P.alan("Platform", ui.platform), P.alan("Instagram/TikTok izlenme eşiği", ui.min)),
          ui.siki,
          P.h("div", { class: "satir" },
            P.dugme("Trend ara", { tur: "birincil", ikon: "trend", onclick: function () { aramaBaslat("trend"); } }),
            P.dugme("Bu haftanın viral Shorts'ları", { tur: "hafif", ikon: "ates", onclick: function () { aramaBaslat("viral"); } })),
          ui.durum),
        P.bolum("Raporlar", "En yeni rapor arama bitince otomatik açılır. Her satırdan yeni video başlatabilirsin.",
          P.h("div", { class: "cift-kucuk" }, P.h("div", null, ui.tur, ui.liste), ui.rapor)),
        P.bolum("Performans", "Yayınladığın videoların izlenme sayısı; hangi sürenin işe yaradığına dair kaba bir öneri çıkarır.",
          ui.perf, P.h("div", { class: "satir" }, P.dugme("Tüm videoların performansını çek", { tur: "hafif", ikon: "yenile", onclick: async function () {
            var ok = await P.onayIste(ui.perf, { baslik: "Performans verisi çekilsin mi?", metin: "vidIQ'dan, yayınlandı olarak işaretlenmiş her video için veri okunur (ücretli).", evet: "Çek" });
            if (ok) P.calistir("performans", {}, ui.perf);
          } }))));
    },
    ac: function () { listeYukle(); performansYukle(); }
  });
})();
