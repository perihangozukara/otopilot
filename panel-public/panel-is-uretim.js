// PANEL ARAYUZU — is sayfasi / "Uretim" sekmesi: adimlar, Uret/Devam/Bastan, tek tek adimlar, oynatici, indirme, disk.
// Uclar: POST /api/calistir {tur,is,...}, GET /api/onkontrol, GET /video/<is>, GET /indir/<is>/<tur>, POST /api/temizle, POST /api/ac.
// Kural: is calisirken ayni isin dugmeleri kilitlenir (ctx.kilitle); sunucu zaten 409 doner, burada onceden engellenir.
(function () {
  "use strict";
  var P = window.P;

  var ADIM_IKON = { bekliyor: "daire", calisiyor: "yukleniyor", bitti: "tamam", atlandi: "cizgi", hata: "hata", iptal: "durdur", onay: "duraklat" };
  var ADIM_METIN = { bekliyor: "bekliyor", calisiyor: "çalışıyor", bitti: "bitti", atlandi: "atlandı (güncel)", hata: "hata", iptal: "iptal edildi", onay: "onay bekliyor" };

  function motorAdi(a) {
    var m = (P.ayar && P.ayar.senaryoMotoru) || "otomatik";
    if (m === "claude") return a.claude ? "Claude" : null;
    if (m === "vidiq") return a.vidiq ? "vidIQ" : null;
    return a.claude ? "Claude" : a.vidiq ? "vidIQ" : null;
  }

  // on kontrol (anahtar/disk/maliyet) -> gerekirse satir ici onay -> calistir. Hatali on kontrolde BASLATMAZ.
  // opt: {ucretli, zorunluOnay, baslik, metin, evet, tehlikeli}
  P.kontrolluBaslat = async function (ctx, yer, tur, ek, opt) {
    opt = opt || {};
    P.durumYaz(yer, null);
    var r;
    try { r = await P.api("/api/onkontrol?tur=" + encodeURIComponent(tur) + "&is=" + encodeURIComponent(ctx.is)); }
    catch (e) { P.durumYaz(yer, "hata", e); return null; }
    var hatalar = r.sorunlar.filter(function (s) { return s.seviye === "hata"; });
    // yalniz sonucu etkileyen uyarilar onay ister (Pexels anahtari yok gibi bilgi notlari karsilama ekraninda zaten gorunur)
    var uyarilar = r.sorunlar.filter(function (s) { return s.seviye !== "hata" && s.kod !== "gorsel_anahtar"; });
    if (hatalar.length) {
      var gec = hatalar.some(function (s) { return s.kod === "anahtar_yok" || s.kod === "maliyet" || s.kod === "disk"; });
      P.bos(yer);
      yer.appendChild(P.mesajKutusu("hata", P.h("strong", null, "Başlatılamadı"),
        P.h("ul", null, hatalar.map(function (s) { return P.h("li", null, s.mesaj, s.cozum ? P.h("span", { class: "soluk" }, " — " + s.cozum) : null); })),
        gec ? P.dugme("Kaynaklar'a git", { kucuk: true, onclick: function () { P.git("kaynaklar"); } }) : null));
      return null;
    }
    // Zincirde (hepsi/devam) ücretli adımları sunucu söyler: senaryo VAR olsa bile vidIQ anahtarı tanımlıysa başlık adımları
    // kredi harcayabilir; kullanıcı bunu haber almadan başlamamalı. Tek tek adımlarda opt.ucretli (P.UCRETLI) belirler.
    var zincirTuru = tur === "hepsi" || tur === "devam";
    var adimUcret = zincirTuru && Array.isArray(r.ucretliAdimlar) ? r.ucretliAdimlar : [];
    var ucretli = !!opt.ucretli || adimUcret.length > 0;
    if (ucretli || uyarilar.length || opt.zorunluOnay) {
      var metin = [];
      if (adimUcret.length) {
        var tahUSD = r.maliyetTahmin && r.maliyetTahmin.usd;
        metin.push(P.h("p", null, "Bu çalıştırma ücretli adım içeriyor (kredi / para harcar):"),
          P.h("ul", null, adimUcret.map(function (a) {
            var tah = a.ad === "senaryo" && a.saglayici === "Claude" && tahUSD ? " — tahmini ~$" + String(tahUSD).replace(".", ",")
              : a.ad === "senaryo" && a.saglayici === "vidIQ" && r.maliyetTahmin ? " — tahmini ~" + r.maliyetTahmin.vidiqCagri + " vidIQ çağrısı" : "";
            return P.h("li", null, a.etiket + " (" + a.saglayici + ")" + tah, a.istegeBagli ? P.h("span", { class: "soluk" }, " — isteğe bağlı" + (a.not ? "; " + a.not : "")) : (a.not ? P.h("span", { class: "soluk" }, " — " + a.not) : null));
          })),
          P.h("p", { class: "soluk" }, "Tahminler kabadır, fatura değildir. İstemezsen Vazgeç'e bas."));
      } else if (ucretli) {
        var m = motorAdi(r.anahtarlar || {});
        var vid = m === "vidIQ";
        metin.push(P.h("p", null, "Bu adım ücretlidir" + (m ? " (" + m + ")" : "") + ". " + (vid ? "Tahmini kullanım: ~" + r.maliyetTahmin.vidiqCagri + " vidIQ çağrısı (kredi harcar)" : "Tahmini maliyet: ~$" + String(r.maliyetTahmin.usd).replace(".", ",")) +
          " — kaba tahmin, fatura değildir."));
      }
      if (opt.metin) metin.push(P.h("p", null, opt.metin));
      if (uyarilar.length) metin.push(P.h("ul", null, uyarilar.map(function (s) { return P.h("li", null, s.mesaj); })));
      var ok = await P.onayIste(yer, { baslik: opt.baslik || "Başlatılsın mı?", metin: metin, evet: opt.evet || "Başlat", tehlikeli: !!opt.tehlikeli });
      if (!ok) return null;
    }
    return ctx.calistir(tur, ek || {}, yer);
  };
  // senaryo yazdirma (ucretli): mevcut metin varsa uzerine yazma onayi + zaman damgali yedek bilgisi
  P.senaryoYaz = function (ctx, yer) {
    var oz = ctx.ozet() || {};
    return P.kontrolluBaslat(ctx, yer, "senaryo", oz.senaryo ? { onay: true } : {}, { ucretli: true, zorunluOnay: !!oz.senaryo, tehlikeli: !!oz.senaryo,
      baslik: oz.senaryo ? "Mevcut senaryonun üzerine yazılsın mı?" : "Senaryo yazılsın mı?",
      metin: oz.senaryo ? "Eski metin Voice/yedek/ klasörüne zaman damgalı kopyalanır, silinmez; yenisi onun yerine geçer." : null, evet: oz.senaryo ? "Yeniden yaz" : "Yaz" });
  };

  function kur(ctx) {
    var vs = ctx.vsMi();
    var yer = P.h("div", { class: "durum-yeri", "aria-live": "polite" });
    var adimYeri = P.h("div", { class: "adim-yeri" });
    var kilitNotu = P.h("p", { class: "ipucu kilit-notu", hidden: true }, "Bu iş çalışırken düğmeler kapalı; bitince açılır.");
    var ciktiYeri = P.h("div", { class: "cikti-yeri" });
    var diskYeri = P.h("div", { class: "disk-yeri" });
    var uretDugme, devamEtiket = null;
    var kosullu = {};                      // konu.json'a göre gösterilen düğmeler: ceviri, portreler, formuller, promptlar
    var temiz =P.onayKutusu("Temiz kur — ara dosyaları silip videoyu baştan kodla", false);
    var tut = P.onayKutusu("Ara dosyaları sakla — sonraki kurulum hızlı olur, diskte yer tutar", false);

    function kontrolluBaslat(tur, ek, opt) { return P.kontrolluBaslat(ctx, yer, tur, ek, opt); }
    function adimDugmesi(etiket, ikon, tur, ek, opt) {
      opt = opt || {};
      var b = P.dugme(etiket, { ikon: ikon, tur: "hafif", title: opt.title, onclick: function () {
        if (opt.ozel) return opt.ozel();
        return kontrolluBaslat(tur, typeof ek === "function" ? ek() : ek, { ucretli: !!P.UCRETLI[tur] });
      } });
      if (P.UCRETLI[tur]) b.appendChild(P.rozet("ücretli", "uyari"));
      ctx.kilitle(b, "mesgul");
      return b;
    }

    // ---------------- "Uret" bolumu
    function uretBolumu() {
      if (vs) {
        var vsBtn = P.dugme("VS videosunu üret", { tur: "birincil", ikon: "oynat", onclick: function () { kontrolluBaslat("vsHepsi", {}, {}); } });
        ctx.kilitle(vsBtn, "hepsi");
        return P.bolum("Üret", "Karşılaştırma tanımı (vs-tanim.json) okunur; görseller çekilir ve video kurulur.",
          P.h("div", { class: "satir" }, vsBtn), yer, kilitNotu);
      }
      uretDugme = P.dugme("Üret", { tur: "birincil", ikon: "oynat", onclick: function () {
        var oz = ctx.ozet() || {};
        kontrolluBaslat("hepsi", { temiz: temiz.girdi.checked || undefined, tut: tut.girdi.checked || undefined }, { ucretli: !oz.senaryo });
      } });
      devamEtiket = uretDugme.querySelector("span");
      ctx.kilitle(uretDugme, "hepsi");
      var bastan = P.dugme("Baştan yap…", { tur: "hafif", ikon: "tekrar", title: "Görsel, ses ve videoyu sıfırdan üretir", onclick: function () {
        kontrolluBaslat("hepsi", { bastan: true, temiz: temiz.girdi.checked || undefined, tut: tut.girdi.checked || undefined },
          { baslik: "Baştan yapılsın mı?", metin: "Görseller, ses ve video sıfırdan üretilir (eski görsel klasörleri Visuals/_eski-… altına taşınır; elle sildiklerin bir daha gelmez). Senaryo yeniden YAZILMAZ — ücretli adım tekrarlanmaz.", evet: "Baştan yap", zorunluOnay: true, tehlikeli: true });
      } });
      ctx.kilitle(bastan, "hepsi");
      return P.bolum("Üret", "Senaryo → görseller → ses → video sırayla yapılır. Güncel olan adımlar atlanır, yani her tıklama kaldığı yerden devam eder.",
        P.h("div", { class: "satir" }, uretDugme, bastan),
        P.h("div", { class: "yigin secenekler" }, temiz, tut),
        yer, kilitNotu);
    }

    // ---------------- tek tek adimlar
    function adimlarBolumu() {
      if (vs) {
        return P.bolum("Adım adım", null, P.h("div", { class: "dugme-grubu" },
          adimDugmesi("VS kur (veri + görsel)", "gorsel", "vsKur", {}), adimDugmesi("Görselleri düzelt", "gorsel", "vsDuzelt", {}), adimDugmesi("VS videosu", "film", "vsYap", {})));
      }
      // Bu sekme iş sayfası açılır açılmaz kurulur; o an konu.json henüz gelmemiş olabilir (ctx.konu() boş). Koşullu düğmeler bu
      // yüzden HER ZAMAN yaratılır ve guncelle() konu gelince/değişince gösterir-gizler (yoksa ilk açılışta hiç çıkmazlardı).
      var g1 = [
        adimDugmesi("Senaryo yaz", "kalem", "senaryo", {}, { ozel: function () { return P.senaryoYaz(ctx, yer); } }),
        adimDugmesi("Başlık puanı", "yildiz", "baslikOn", {}, { title: "Başlığı puanlar, alternatif önerir (senaryodan önce)" }),
        adimDugmesi("Başlık ve etiket analizi", "yildiz", "baslik", {})
      ];
      kosullu.ceviri = adimDugmesi("Altyazıyı çevir", "dil", "ceviri", {}, { title: "Altyazı dili anlatım dilinden farklıysa altyazıyı çevirir" });
      g1.push(kosullu.ceviri);
      var g2 = [
        adimDugmesi("Görselleri bul", "gorsel", "gorsel", {}),
        adimDugmesi("Görselleri baştan bul", "tekrar", "gorsel", { bastan: true }, { ozel: function () {
          kontrolluBaslat("gorsel", { bastan: true }, { baslik: "Görseller baştan aransın mı?", metin: "Eski sahne klasörleri Visuals/_eski-… altına taşınır. Elle sildiklerin bir daha gelmez.", evet: "Baştan ara", zorunluOnay: true });
        } }),
        adimDugmesi("NASA'dan ekle", "gorsel", "nasa", { adet: 12 }, { title: "Kozmik konularda NASA arşivinden 12 görsel ekler (atıfsız, kamu malı)" }),
        adimDugmesi("AI ile üret", "gorsel", "gorselUret", {}, { title: "Senaryoda «uret:» işaretli sahneler için görsel üretir" }),
        adimDugmesi("AI ile tüm sahneleri üret", "gorsel", "gorselUret", { hepsi: true }, { title: "Her sahne için yapay zekâ görseli üretir (uzun sürebilir; üretilenler manifestte «yapay zekâ» diye işaretlenir)" })
      ];
      kosullu.portreler = adimDugmesi("Portreler", "gorsel", "portre", {});
      kosullu.formuller = adimDugmesi("Formül kartları", "gorsel", "formul", {});
      kosullu.promptlar = adimDugmesi("Prompt kartları", "gorsel", "prompt", {});
      g2.push(kosullu.portreler, kosullu.formuller, kosullu.promptlar);
      var g3 = [
        adimDugmesi("Seslendir", "ses", "ses", {}),
        adimDugmesi("Seslendirmeyi yeniden yap", "tekrar", "ses", { yeniden: true }, { title: "Mevcut ses parçalarını atıp tümünü yeniden üretir" }),
        adimDugmesi("Önizleme (kısa, düşük çözünürlük)", "film", "onizleme", {}, { title: "İlk ~25 sn'yi hızlıca kurar" }),
        adimDugmesi("Videoyu kur", "film", "video", function () { return { temiz: temiz.girdi.checked || undefined, tut: tut.girdi.checked || undefined }; })
      ];
      var g4 = [
        adimDugmesi("Kapak resmi", "gorsel", "kapak", {}),
        adimDugmesi("Yayın paketi", "yayin", "yayin", {}),
        adimDugmesi("Videodan Shorts çıkar", "film", "shortsKes", { adet: 3 }, { title: "Bitmiş uzun videodan 3 kısa kesit üretir" })
      ];
      var grup = function (b, ic) { return P.h("div", { class: "dugme-grubu-blok" }, P.h("h4", null, b), P.h("div", { class: "dugme-grubu" }, ic)); };
      return P.bolum("Adım adım", "Bir adım hata verdiyse yalnız onu tekrar çalıştır. Önizleme çıktısı Videos klasörüne yazılır (Videos/<iş>-onizleme.mp4).",
        grup("Metin", g1), grup("Görseller", g2), grup("Ses ve video", g3), grup("Yayın ve yeniden kullanım", g4));
    }

    // ---------------- adim listesi (durum.json)
    var sonAdimImza = "";
    function adimlariCiz() {
      var d = ctx.detay && ctx.detay.durum;
      var imza = JSON.stringify(d ? [d.son && [d.son.id, d.son.durum], (d.adimlar || []).map(function (a) { return [a.ad, a.durum, a.yuzde, a.ozet]; })] : null);
      if (imza === sonAdimImza) return;
      sonAdimImza = imza;
      if (!d || !d.adimlar || !d.adimlar.length) { P.degistir(adimYeri, P.h("p", { class: "soluk" }, "Bu iş henüz çalıştırılmadı.")); return; }
      var son = d.son || {};
      P.degistir(adimYeri,
        P.h("p", { class: "soluk" }, "Son çalıştırma: " + P.turEtiketi(son.tur) + (son.baslangic ? " · " + P.goreli(son.baslangic) : "") + (son.durum ? " · " + (P.DURUMLAR[son.durum] ? P.DURUMLAR[son.durum][0] : son.durum) : "")),
        P.h("ol", { class: "adimlar" }, d.adimlar.map(function (a) {
          return P.h("li", { class: "adim a-" + a.durum },
            P.ikon(ADIM_IKON[a.durum] || "daire", a.durum === "calisiyor" ? "don" : ""),
            P.h("span", { class: "adim-ad" }, a.etiket || a.ad, a.istegeBagli ? P.h("span", { class: "soluk" }, " (isteğe bağlı)") : null),
            P.h("span", { class: "soluk" }, (ADIM_METIN[a.durum] || a.durum) + (a.durum === "calisiyor" && typeof a.yuzde === "number" ? " · %" + Math.round(a.yuzde) : "") + (a.ozet && a.durum === "calisiyor" ? " · " + a.ozet : "")));
        })));
    }

    // ---------------- cikti: oynatici + indirme
    var sonCiktiImza = "";
    var shortsYer = P.h("div", { class: "shorts-yer" });
    // Shorts kesme ciktilari (uretim/<is>/Shorts/): liste + oynatici + indirme. /api/shorts, /shorts/<is>/<dosya>
    async function shortsCiz(adet) {
      if (!adet) { P.bos(shortsYer); return; }
      var r;
      try { r = await P.api("/api/shorts?is=" + encodeURIComponent(ctx.is)); } catch (e) { P.durumYaz(shortsYer, "hata", e); return; }
      var l = r.shorts || [];
      if (!l.length) { P.bos(shortsYer); return; }
      P.degistir(shortsYer, P.h("h4", null, "Shorts kesitleri (" + l.length + ")"),
        P.h("div", { class: "shorts-izgara" }, l.map(function (x) {
          var ad = encodeURIComponent(x.ad), yol = "/shorts/" + encodeURIComponent(ctx.is) + "/" + ad;
          return P.h("figure", { class: "shorts-kart" },
            P.h("video", { controls: true, preload: "none", playsinline: true, class: "oynatici dikey", "aria-label": "Shorts: " + x.ad, src: yol }),
            P.h("figcaption", null, P.h("span", { class: "mono" }, x.ad), " · " + P.boyutYaz(x.mb) + " ",
              P.baglanti("İndir", yol + "?indir=1", { indir: true, kucuk: true, tur: "hafif", ikon: "indir" })));
        })));
    }
    function ciktiCiz() {
      var oz = ctx.ozet(), d = ctx.detay;
      if (!oz) return;
      var dos = (d && d.dosyalar) || {};
      var v = oz.video;
      var son = d && d.durum && d.durum.son;
      // son.bitis: her calismadan sonra degisir; boylece yeniden uretilen onizleme/Shorts oynaticilari tazelenir
      var imza = JSON.stringify([v && [v.mb, v.sureSn, v.gecerli], oz.kapak, dos.srt, dos.yayin, dos.bolumler, dos.atif, dos.baslik, dos.onizleme, dos.shorts, son && son.bitis, oz.guncelleme && v ? 1 : 0]);
      if (imza === sonCiktiImza) return;
      sonCiktiImza = imza;
      shortsCiz(dos.shorts);
      var ic = [];
      if (v && v.gecerli) {
        var video = P.h("video", { controls: true, preload: "metadata", playsinline: true, tabindex: "0", class: "oynatici", "aria-label": "Üretilen video", src: "/video/" + encodeURIComponent(ctx.is) + "?v=" + v.mb + "-" + (v.sureSn || 0) });
        if (oz.kapak) video.setAttribute("poster", "/indir/" + encodeURIComponent(ctx.is) + "/kapak?v=" + v.mb);
        ic.push(video, P.h("p", { class: "soluk" }, "Video: " + (v.sureSn ? P.sureYaz(v.sureSn) + " · " : "") + P.boyutYaz(v.mb) + " · tarayıcıda oynatılır, dosya bilgisayarında kalır."));
      } else if (v) {
        ic.push(P.mesajKutusu("uyari", "Video dosyası var ama oynatılamıyor ya da yarım görünüyor. «Videoyu kur» ile yeniden üret (gerekirse «Temiz kur»u işaretle)."));
      } else ic.push(P.h("p", { class: "soluk" }, "Henüz video yok."));
      if (dos.onizleme) {
        ic.push(P.h("h4", null, "Önizleme"),
          P.h("video", { controls: true, preload: "none", playsinline: true, class: "oynatici", "aria-label": "Önizleme videosu (düşük çözünürlük)", src: "/video/" + encodeURIComponent(ctx.is) + "/onizleme" }),
          P.h("p", { class: "soluk" }, "Önizleme: ilk saniyeler, düşük çözünürlük — görünümü beğenmeden tam videoyu kurma."));
      }
      var ind = [];
      var baglanti = function (etiket, tur, ikon) { return P.baglanti(etiket, "/indir/" + encodeURIComponent(ctx.is) + "/" + tur, { indir: true, kucuk: true, tur: "hafif", ikon: ikon || "indir" }); };
      if (v && v.gecerli) ind.push(baglanti("Videoyu indir (mp4)", "video"));
      if (dos.srt) ind.push(baglanti("Altyazı (srt)", "srt"));
      if (dos.onizleme) ind.push(baglanti("Önizleme (mp4)", "onizleme"));
      if (oz.kapak) ind.push(baglanti("Kapak (jpg)", "kapak"));
      if (dos.yayin) ind.push(baglanti("Yayın paketi (md)", "yayin"));
      if (dos.bolumler) ind.push(baglanti("Bölümler (txt)", "bolumler"));
      if (dos.atif) ind.push(baglanti("Görsel atıfları (txt)", "atif"));
      if (dos.baslik) ind.push(baglanti("Başlık ve etiketler (md)", "baslik"));
      ind.push(P.dugme("Videos klasörünü aç", { kucuk: true, tur: "hafif", ikon: "klasor", title: "Önizleme ve Shorts çıktıları da burada",
        onclick: async function () { try { await P.api("/api/ac", { is: ctx.is, klasor: "video" }); } catch (e) { P.bildir(P.hataMetni(e) + (e.cozum ? " " + e.cozum : ""), "hata"); } } }));
      ic.push(P.h("div", { class: "satir" }, ind));
      P.degistir(ciktiYeri, ic);
    }

    // ---------------- disk
    var sonDiskImza = "";
    function diskCiz() {
      var oz = ctx.ozet(); if (!oz) return;
      var imza = oz.tmpMB + "|" + oz.toplamMB; if (imza === sonDiskImza) return; sonDiskImza = imza;
      var yerD = P.h("div", { class: "durum-yeri" });
      var tmp = Number(oz.tmpMB) || 0;
      var temizle = P.dugme("Ara dosyaları temizle" + (tmp ? " (" + P.boyutYaz(tmp) + ")" : ""), { kucuk: true, tur: "hafif", ikon: "sil", disabled: !tmp, onclick: async function () {
        var ok = await P.onayIste(yerD, { baslik: "Ara dosyalar silinsin mi?", metin: "Yalnız _tmp klasörü silinir (video kliplerinin ara kopyaları). Senaryo, görsel, ses ve final video kalır; sonraki video kurulumu biraz daha uzun sürer.", evet: "Temizle" });
        if (!ok) return;
        try { var r = await P.api("/api/temizle", { is: ctx.is, tur: "ara" }); P.bildir(P.boyutYaz(r.serbestMB) + " yer açıldı.", "ok"); ctx.yenile().catch(function () { }); }
        catch (e) { P.durumYaz(yerD, "hata", e); }
      } });
      ctx.kilitler = ctx.kilitler.filter(function (k) { return k.grup !== "disk"; });
      ctx.kilitle(temizle, "mesgul", "disk");
      P.degistir(diskYeri, P.h("p", null, "Toplam " + P.boyutYaz(oz.toplamMB || 0) + " · ara dosyalar " + P.boyutYaz(tmp) + (tmp > 500 ? " — temizlemek disk açar" : "")),
        P.h("div", { class: "satir" }, temizle), yerD);
    }

    function kosulluDugmeler(oz) {
      var kn = ctx.konu() || {}, dil = kn.dil || (oz && oz.dil) || null;
      var dolu = function (a) { return Array.isArray(a) && a.length > 0; };
      var goster = {
        ceviri: !!(kn.altyaziDili && dil && kn.altyaziDili !== dil),
        portreler: dolu(kn.portreler), formuller: dolu(kn.formuller), promptlar: dolu(kn.promptlar)
      };
      Object.keys(kosullu).forEach(function (k) { if (kosullu[k].hidden === goster[k]) kosullu[k].hidden = !goster[k]; });
    }
    function guncelle() {
      var oz = ctx.ozet();
      kosulluDugmeler(oz);
      if (uretDugme && devamEtiket && oz) {
        var yeni = !oz.senaryo && !oz.gorsel && !oz.sesParca && !oz.video;
        devamEtiket.textContent = yeni ? "Üret" : (oz.video && oz.video.gecerli ? "Güncelle / eksikleri tamamla" : "Kaldığı yerden devam et");
      }
      kilitNotu.hidden = !ctx.mesgul();
      adimlariCiz(); ciktiCiz(); diskCiz();
      ctx.kilitleriUygula();
    }

    var kok = P.h("div", { class: "sekme-icerik" },
      uretBolumu(),
      P.bolum("Durum ve adımlar", null, adimYeri),
      adimlarBolumu(),
      P.bolum("Çıktı", "Videoyu izle, dosyaları indir. «Klasörü aç» yalnızca dosyaların bulunduğu klasörü açar.", ciktiYeri, shortsYer),
      P.bolum("Disk", "Ara dosyalar render sırasında oluşur; iş bitince güvenle silinebilir.", diskYeri));
    return { kok: kok, guncelle: guncelle, ac: guncelle };
  }

  P.sekmeler.push({ sira: 1, ad: "uretim", etiket: "Üretim", ikon: "film", kur: kur });
})();
