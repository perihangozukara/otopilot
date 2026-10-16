// PANEL ARAYUZU — "Toplu uret" gorunumu: konu listesini siraya ekle, kuyrugu izle/duraklat/iptal et.
// Uclar: POST /api/kuyruk/ekle {isler:[{baslik,nis,format,sureDk,dil,onaysiz}]}, GET /api/kuyruk, POST /api/kuyruk/iptal|duraklat|devam.
// Sunucu on kontrolu once TUM listeyi dogrular; hata varsa hicbir klasor acilmaz. Panel yeniden baslayinca kuyruk DURAKLATILMIS gelir.
(function () {
  "use strict";
  var P = window.P;
  var ui = {}, yoklayici = null, acik = false, gizleBitenler = true, tahminUSD = null;
  var KUYRUK_DURUM = { sirada: ["Sırada", "uyari"], calisiyor: ["Çalışıyor", "vurgu"], bitti: ["Bitti", "ok"], hata: ["Hata", "hata"], iptal: ["İptal", "soluk"] };

  function satirlariCoz() {
    return ui.liste.value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
      var i = s.indexOf("|"), b = (i >= 0 ? s.slice(0, i) : s).trim(), n = i >= 0 ? s.slice(i + 1).trim() : "";
      var o = { baslik: b, format: ui.format.value, dil: ui.dil.value };
      if (n) o.nis = n;
      var dk = Number(ui.sure.value); if (dk > 0) o.sureDk = dk;
      if (ui.onaysiz.girdi.checked) o.onaysiz = true;
      return o;
    });
  }
  function sayacCiz() {
    var n = satirlariCoz().length;
    ui.sayac.textContent = n ? n + " video eklenecek" + (tahminUSD !== null ? " · tahmini senaryo maliyeti ~$" + String(Math.round(tahminUSD * n * 100) / 100).replace(".", ",") + " (kaba tahmin)" : "") : "Liste boş";
    ui.ekle.disabled = !n;
  }
  async function ekle() {
    var isler = satirlariCoz();
    P.alanHatalari(ui.kok, []);
    if (!isler.length) return;
    ui.ekle.disabled = true;
    P.durumYaz(ui.durum, "bilgi", "Kontrol ediliyor ve sıraya ekleniyor…");
    try {
      var r = await P.api("/api/kuyruk/ekle", { isler: isler }, { zamanAsimi: 60000 });
      P.durumYaz(ui.durum, "ok", (r.eklenen ? r.eklenen.length : isler.length) + " video sıraya eklendi. " + (ui.onaysiz.girdi.checked ? "" : "Her biri senaryo hazır olunca onayını bekler; Videolar'dan onayla."));
      ui.liste.value = ""; P.kirli.delete("toplu"); sayacCiz();
      P.islerYenile().catch(function () { }); yukle();
    } catch (e) {
      var kutu = P.hataKutusu(e);
      if (e.sorunlar && e.sorunlar.some(function (s) { return s.kod === "anahtar_yok"; })) kutu.querySelector(".mesaj-govde").appendChild(P.dugme("Kaynaklar'a git", { kucuk: true, onclick: function () { P.git("kaynaklar"); } }));
      P.bos(ui.durum); ui.durum.appendChild(kutu);
    }
    sayacCiz();
  }

  var sonImza = "";
  function ciz(k) {
    var imza = JSON.stringify([k, gizleBitenler, P.calisan.liste.map(function (c) { return c.is + ":" + c.durum; })]);
    if (imza === sonImza) return;
    sonImza = imza;
    var ogeler = (k.ogeler || []).filter(function (x) { return !gizleBitenler || (x.durum !== "bitti" && x.durum !== "iptal"); });
    var calisan = (k.ogeler || []).some(function (x) { return x.durum === "calisiyor"; });
    var bekleyen = (k.ogeler || []).filter(function (x) { return x.durum === "sirada"; }).length;
    var uste = [];
    if (k.duraklatildi) uste.push(P.mesajKutusu("uyari", P.h("strong", null, "Kuyruk duraklatıldı."), " Sıradaki işler başlamaz (çalışanlar sürer). Panel yeniden başlayınca da kuyruk bu halde gelir; beklenmedik harcama olmasın diye kendiliğinden başlamaz. ",
      P.dugme("Kuyruğu başlat", { kucuk: true, tur: "birincil", ikon: "oynat", onclick: async function () { try { await P.api("/api/kuyruk/devam", {}); yukle(); } catch (e) { P.durumYaz(ui.kuyrukDurum, "hata", e); } } })));
    else if (calisan || bekleyen) uste.push(P.mesajKutusu("bilgi", (calisan ? "Kuyruk çalışıyor" : "Kuyruk hazır") + (bekleyen ? " · " + bekleyen + " iş sırada. " : ". "),
      P.dugme("Duraklat", { kucuk: true, tur: "hafif", ikon: "duraklat", onclick: async function () { try { await P.api("/api/kuyruk/duraklat", {}); yukle(); } catch (e) { P.durumYaz(ui.kuyrukDurum, "hata", e); } } })));
    var satirlar = ogeler.map(function (x) {
      var d = KUYRUK_DURUM[x.durum] || [x.durum, "soluk"];
      var canli = P.calisanBul(x.is);
      if (x.durum === "calisiyor" && canli && canli.durum === "onay_bekliyor") d = ["Onay bekliyor", "uyari"];
      var iptal = (x.durum === "sirada" || x.durum === "calisiyor") ? P.dugme("İptal", { kucuk: true, tur: "hafif", ikon: "kapat", onclick: async function () {
        var ok = await P.onayIste(ui.kuyrukDurum, { baslik: x.is + " iptal edilsin mi?", metin: x.durum === "calisiyor" ? "Çalışan işlem durdurulur; yarım dosyalar temizlenir, işi sonra Videolar'dan sürdürebilirsin." : "Bu iş kuyruktan çıkarılır.", evet: "İptal et", tehlikeli: true });
        if (!ok) return;
        try { await P.api("/api/kuyruk/iptal", { is: x.is }); yukle(); } catch (e) { P.durumYaz(ui.kuyrukDurum, "hata", e); }
      } }) : null;
      return P.h("li", { class: "kuyruk-satir k-" + x.durum },
        P.h("a", { href: "#/videolar/" + encodeURIComponent(x.is), class: "mono" }, x.is), P.rozet(d[0], d[1]),
        x.onaysiz ? P.rozet("onaysız", "uyari") : null,
        P.h("span", { class: "soluk" }, x.eklendi ? P.goreli(x.eklendi) : ""), x.hata ? P.h("span", { class: "kuyruk-hata" }, x.hata) : null, iptal);
    });
    P.degistir(ui.kuyrukGovde, uste,
      satirlar.length ? P.h("ul", { class: "kuyruk-listesi" }, satirlar) : P.h("p", { class: "soluk" }, (k.ogeler || []).length ? "Çalışan ya da bekleyen iş yok." : "Kuyruk boş."));
  }
  async function yukle() {
    try { ciz(await P.api("/api/kuyruk")); } catch (e) { P.durumYaz(ui.kuyrukGovde, "hata", e); }
  }

  P.gorunumKaydet("toplu", {
    baslik: "Toplu üret", ikon: "katmanlar",
    kur: function (kok) {
      ui.kok = kok;
      ui.liste = P.metinAlani({ id: "t-liste", rows: "8", "aria-label": "Video listesi", placeholder: "Her satıra bir video — «başlık | konu notu» biçiminde (konu notu isteğe bağlı):\nRoma İmparatorluğu neden çöktü | iç ve dış nedenler, para ve ordu\nBlack hole nedir\nKara delikler gerçekten ne yapar | Hawking radyasyonu" });
      ui.format = P.secim(Object.keys(P.FORMATLAR).map(function (k) { return [k, P.FORMATLAR[k].etiket]; }), "long", { id: "t-format" });
      ui.sure = P.girdi({ id: "t-sure", type: "number", step: "0.25", min: "0.25", max: "60", placeholder: "biçime göre", inputmode: "decimal" });
      ui.dil = P.secim(P.DILLER, (P.ayar && P.ayar.dil) || "en", { id: "t-dil" });
      ui.onaysiz = P.onayKutusu("Senaryo onayı için durma — gece boyu kendi başına çalışsın", false);
      ui.sayac = P.h("span", { class: "soluk" });
      ui.durum = P.h("div", { class: "durum-yeri", "aria-live": "polite" });
      ui.kuyrukDurum = P.h("div", { class: "durum-yeri" });
      ui.kuyrukGovde = P.h("div", { class: "kuyruk-govde" });
      ui.ekle = P.dugme("Sıraya ekle", { tur: "birincil", ikon: "arti", onclick: ekle, disabled: true });
      var gizle = P.onayKutusu("Biten ve iptal edilenleri gizle", true);
      gizle.girdi.addEventListener("change", function () { gizleBitenler = gizle.girdi.checked; sonImza = ""; yukle(); });
      ui.liste.addEventListener("input", function () { if (ui.liste.value.trim()) P.kirli.add("toplu"); else P.kirli.delete("toplu"); sayacCiz(); });
      [ui.format, ui.sure, ui.dil, ui.onaysiz.girdi].forEach(function (e) { e.addEventListener("input", sayacCiz); e.addEventListener("change", sayacCiz); });
      P.degistir(kok,
        P.sayfaBasligi("h-toplu", "Toplu üret", "Konu listesini sıraya koy; her biri senaryo → görsel → ses → video zincirinden geçer. En fazla 2 zincir aynı anda çalışır, video kurulumu sırayla yapılır."),
        P.bolum("Sıraya ekle", "Önce tüm liste doğrulanır; hata varsa hiçbir iş açılmaz.",
          P.alan("Videolar (satır başına bir tane)", ui.liste, { ipucu: "Başlıklar videonun başlığı olur. «|» işaretinden sonrası konu notudur." }),
          P.h("div", { class: "alan-izgara" }, P.alan("Biçim", ui.format), P.alan("Süre (dk, isteğe bağlı)", ui.sure), P.alan("Anlatım dili", ui.dil)),
          ui.onaysiz,
          P.h("p", { class: "ipucu" }, "Onay atlanırsa senaryo kontrol edilmeden ses ve video üretilir. Ücretli senaryo adımları yine çalışır; bu seçeneği yalnız ne istediğini biliyorsan işaretle."),
          P.h("div", { class: "satir" }, ui.ekle, ui.sayac), ui.durum),
        P.bolum("Kuyruk", "Panel yeniden başlayınca kuyruk duraklatılmış gelir; kuyruğu sen başlatırsın.",
          P.h("div", { class: "satir" }, gizle), ui.kuyrukDurum, ui.kuyrukGovde));
      sayacCiz();
    },
    ac: function () {
      acik = true;
      if (!yoklayici) yoklayici = P.yokla(async function () { if (acik) await yukle(); }, function () { return 3000; });
      else yoklayici.simdi();
      P.api("/api/onkontrol?tur=hepsi").then(function (r) { tahminUSD = r && r.maliyetTahmin ? r.maliyetTahmin.usd : null; sayacCiz(); }).catch(function () { });
    },
    birak: function () { acik = false; }
  });
})();
