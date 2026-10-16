// PANEL ARAYUZU — is sayfasi / "Yayin" sekmesi: kapak, baslik ve etiketler, yayin paketi, bolumler, atiflar, uyum kontrolu, yayin durumu.
// Uclar: GET /api/dosya?tur=yayin|baslik|atif|bolumler, POST /api/baslik-sec, POST /api/yayin-isaretle, GET /api/performans, /indir/<is>/kapak.
// Otomatik YouTube yukleme YOKTUR (sozlesme K5): paket hazirlanir, yukleme ve yayina alma kullanicinin kapisidir.
(function () {
  "use strict";
  var P = window.P;

  function satir(etiket, govde, kopya) {
    return P.h("div", { class: "yayin-satir" }, P.h("div", { class: "yayin-ust" }, P.h("h4", null, etiket), kopya || null), govde);
  }
  function salt(metin, rows) { return P.metinAlani({ rows: String(rows || 5), readonly: true, deger: metin || "", "aria-label": "Salt okunur metin" }); }

  function kur(ctx) {
    var kapakYer = P.h("div", { class: "kapak-yer" });
    var baslikYer = P.h("div", { class: "baslik-yer" });
    var paketYer = P.h("div", { class: "paket-yer" });
    var uyumYer = P.h("div", { class: "uyum-yer" });
    var durumYer = P.h("div", { class: "durum-yeri", "aria-live": "polite" });
    var genel = P.h("div", { class: "durum-yeri", "aria-live": "polite" });
    var isaretYer = P.h("div", { class: "durum-yeri" });
    var kayitliDurum = P.h("div", { class: "iz-satir" });
    var sonKapak = null;

    // ---------------- kapak
    function kapakCiz() {
      var oz = ctx.ozet() || {};
      var imza = oz.kapak + "|" + (oz.video && oz.video.mb) + "|" + (oz.guncelleme || 0);
      if (imza === sonKapak) return; sonKapak = imza;
      var uret = P.dugme(oz.kapak ? "Kapağı yeniden üret" : "Kapak üret", { tur: "hafif", ikon: "gorsel", onclick: function () { ctx.calistir("kapak", {}, genel); } });
      ctx.kilitler = ctx.kilitler.filter(function (k) { return k.grup !== "kapak"; });
      ctx.kilitle(uret, "mesgul", "kapak");
      P.degistir(kapakYer,
        oz.kapak ? P.h("img", { class: "kapak-onizleme", src: "/indir/" + encodeURIComponent(ctx.is) + "/kapak?v=" + Date.now(), alt: "Üretilen kapak resmi" }) : P.h("p", { class: "soluk" }, "Henüz kapak yok. En yüksek çözünürlüklü görsel ve başlıkla otomatik üretilir."),
        P.h("div", { class: "satir" }, uret, oz.kapak ? P.baglanti("Kapağı indir (jpg)", "/indir/" + encodeURIComponent(ctx.is) + "/kapak", { indir: true, kucuk: true, tur: "hafif", ikon: "indir" }) : null));
    }

    // ---------------- baslik ve etiketler
    async function baslikYukle() {
      var r;
      try { r = await P.api("/api/dosya?is=" + encodeURIComponent(ctx.is) + "&tur=baslik"); } catch (e) { P.durumYaz(baslikYer, "hata", e); return; }
      var j = r.json;
      ctx.kilitTemizle("yayin-baslik");            // bu bölüm her açılışta/iş bitişinde yeniden çizilir: önceki düğümlerin kilitleri atılır
      var calistir = P.h("div", { class: "satir" },
        (function () { var b = P.dugme("Başlık analizi çalıştır", { tur: "hafif", ikon: "yildiz", onclick: function () { P.kontrolluBaslat(ctx, genel, "baslik", {}, { ucretli: true }); } }); b.appendChild(P.rozet("ücretli", "uyari")); ctx.kilitle(b, "mesgul", "yayin-baslik"); return b; })());
      if (!j) {
        P.degistir(baslikYer, P.h("p", { class: "soluk" }, "Henüz başlık analizi yok. vidIQ anahtarın varsa analiz başlığı puanlar, alternatifler ve etiketler önerir."), calistir);
        return;
      }
      var secimYer = P.h("div", { class: "durum-yeri" });
      var alt = (j.alternatifler || []).map(function (a) {
        var sec = P.dugme("Bu başlığı seç", { kucuk: true, tur: "hafif", ikon: "tamam", onclick: async function () {
          try { await P.api("/api/baslik-sec", { is: ctx.is, baslik: a.baslik }); P.bildir("Başlık güncellendi: " + P.kisalt(a.baslik, 60), "ok"); ctx.yenile().catch(function () { }); P.islerYenile().catch(function () { }); P.olay.yay("konu-degisti", { is: ctx.is, kaynak: "baslik" }); }
          catch (e) { P.durumYaz(secimYer, "hata", e); }
        } });
        ctx.kilitle(sec, "mesgul", "yayin-baslik");
        return P.h("li", { class: "baslik-secenek" }, P.h("span", { class: "baslik-metin" }, a.baslik), typeof a.puan === "number" ? P.rozet("puan " + a.puan, a.puan >= 70 ? "ok" : "soluk") : null, sec, P.kopyaDugmesi("Kopyala", a.baslik));
      });
      var etiketler = Array.isArray(j.etiketler) ? j.etiketler : [];
      var kelimeler = (j.anahtarKelimeler || []).slice(0, 12);
      P.degistir(baslikYer,
        j.mevcut ? P.h("p", null, P.h("strong", null, "Mevcut: "), j.mevcut.baslik, typeof j.mevcut.puan === "number" ? " " : null, typeof j.mevcut.puan === "number" ? P.rozet("puan " + j.mevcut.puan, j.mevcut.puan >= 70 ? "ok" : "uyari") : null) : null,
        alt.length ? P.h("ul", { class: "baslik-secenekler" }, alt) : P.h("p", { class: "soluk" }, "Alternatif başlık önerilmedi."),
        secimYer,
        etiketler.length ? satir("Etiketler (" + etiketler.length + ")", P.h("div", { class: "etiket-satiri" }, etiketler.map(function (e) { return P.h("span", { class: "chip pasif" }, e); })), P.kopyaDugmesi("Virgülle kopyala", etiketler.join(", "))) : null,
        kelimeler.length ? satir("Anahtar kelimeler", P.h("ul", { class: "anahtar-kelimeler" }, kelimeler.map(function (k) {
          return P.h("li", null, P.h("strong", null, k.kelime), P.h("span", { class: "soluk" }, " · hacim " + (k.hacim != null ? k.hacim : "—") + " · rekabet " + (k.rekabet != null ? k.rekabet : "—") + " · skor " + (k.skor != null ? k.skor : "—")));
        }))) : null,
        j.tarih ? P.h("p", { class: "soluk" }, "Analiz tarihi: " + P.tarihYaz(j.tarih)) : null,
        calistir);
    }

    // ---------------- yayin paketi + uyum
    async function paketYukle() {
      var r;
      try { r = await P.api("/api/dosya?is=" + encodeURIComponent(ctx.is) + "&tur=yayin"); } catch (e) { P.durumYaz(paketYer, "hata", e); return; }
      var j = r.json;
      var uret = P.dugme(j ? "Yayın paketini yeniden üret" : "Yayın paketi üret", { tur: j ? "hafif" : "birincil", ikon: "yayin", onclick: function () { ctx.calistir("yayin", {}, genel); } });
      ctx.kilitler = ctx.kilitler.filter(function (k) { return k.grup !== "paket"; });
      ctx.kilitle(uret, "mesgul", "paket");
      if (!j) {
        P.degistir(paketYer, P.h("p", { class: "soluk" }, "Henüz yayın paketi yok. Video kurulunca otomatik oluşur; elle de üretebilirsin. Açıklama, bölümler (chapters), görsel atıfları ve etiketler tek yerde toplanır."), P.h("div", { class: "satir" }, uret));
        uyumCiz(null);
        return;
      }
      var bolumMetni = (j.bolumler || []).map(function (b) { return b.zaman + " " + b.baslik; }).join("\n");
      var atifMetni = (j.atiflar || []).map(function (a) { return a.atifMetni || ""; }).filter(Boolean).join("\n");
      var etiketler = j.etiketler || [];
      P.degistir(paketYer,
        j.baslik ? satir("Başlık", P.h("p", { class: "yayin-baslik" }, j.baslik), P.kopyaDugmesi("Kopyala", j.baslik)) : null,
        j.aciklama ? satir("Açıklama", salt(j.aciklama, 8), P.kopyaDugmesi("Kopyala", j.aciklama)) : null,
        etiketler.length ? satir("Etiketler", P.h("div", { class: "etiket-satiri" }, etiketler.map(function (e) { return P.h("span", { class: "chip pasif" }, e); })), P.kopyaDugmesi("Virgülle kopyala", etiketler.join(", "))) : null,
        (j.hashtagler || []).length ? satir("Hashtagler", P.h("p", null, j.hashtagler.join(" ")), P.kopyaDugmesi("Kopyala", j.hashtagler.join(" "))) : null,
        bolumMetni ? satir("Bölümler (YouTube chapters)", salt(bolumMetni, Math.min(10, j.bolumler.length + 1)), P.kopyaDugmesi("Kopyala", bolumMetni)) : null,
        atifMetni ? satir("Görsel atıfları — açıklamaya yapıştır", salt(atifMetni, Math.min(8, (j.atiflar || []).length + 1)), P.kopyaDugmesi("Kopyala", atifMetni)) : null,
        P.h("div", { class: "satir" }, uret, P.baglanti("Paketi indir (md)", "/indir/" + encodeURIComponent(ctx.is) + "/yayin", { indir: true, kucuk: true, tur: "hafif", ikon: "indir" })),
        j.tarih ? P.h("p", { class: "soluk" }, "Paket tarihi: " + P.tarihYaz(j.tarih)) : null);
      uyumCiz(j);
    }
    function uyumCiz(j) {
      var u = j && j.uyum;
      var madde = function (acik, metin) { return P.h("li", { class: "uyum-madde " + (acik ? "var" : "yok") }, P.ikon(acik ? "uyari" : "tamam"), metin); };
      var ic = [];
      if (u) {
        ic.push(P.h("ul", { class: "uyum-liste" },
          madde(u.sentetikSes !== false, "Anlatım sentetik (yapay) ses."),
          madde(!!u.sentetikGorsel, u.sentetikGorsel ? "Yapay zekâ ile üretilmiş görsel var." : "Yapay zekâ görseli kullanılmamış."),
          madde(!!u.yapayZekaMetin, u.yapayZekaMetin ? "Metin yapay zekâ ile yazılmış." : "Metin elle yazılmış / yapay zekâ kullanılmamış."),
          madde(!!u.atifGerekli, u.atifGerekli ? "Atıf gerektiren görsel var — açıklamaya atıfları ekle." : "Atıf gerektiren görsel yok.")));
        if (u.beyanHatirlatma) ic.push(P.mesajKutusu("uyari", P.h("strong", null, "Yükleme sırasında: "), u.beyanHatirlatma));
        (u.uyarilar || []).forEach(function (x) { ic.push(P.mesajKutusu("uyari", x)); });
      } else ic.push(P.h("p", { class: "soluk" }, "Yayın paketi üretilince bu video için işaretlenecek maddeler burada görünür."));
      ic.push(P.h("ul", { class: "uyum-notlari" },
        P.h("li", null, "YouTube Studio'da gerçekçi yapay görsel/ses varsa «değiştirilmiş veya sentetik içerik» kutusunu işaretle."),
        P.h("li", null, "Her videoda aynı intro, müzik ve kapanış kullanmak «özgün olmayan / toplu üretilmiş içerik» riski taşır: Görünüm'de geçiş, efekt, renk ve müziği «Otomatik» bırak, Ses ve dil'e kendi katkını ekle."),
        P.h("li", null, "Başkasının videosunu izinsiz yeniden yüklemek telif ihlalidir; yalnız kendi ya da izinli içeriği kullan."),
        P.h("li", null, "Kuralların güncel metni için YouTube Yardım'a bak; bu liste hukuki tavsiye değildir.")));
      P.degistir(uyumYer, ic);
    }

    // ---------------- yayin durumu
    var platform = P.secim([["youtube", "YouTube"], ["instagram", "Instagram"], ["tiktok", "TikTok"]], "youtube", { id: P.yeniId("y") });
    var durum = P.secim([["hazir", "Hazır (henüz yüklenmedi)"], ["planli", "Planlandı"], ["yuklendi", "Yüklendi"]], "yuklendi", { id: P.yeniId("y") });
    var adres = P.girdi({ type: "url", placeholder: "https://youtu.be/…  (isteğe bağlı)", id: P.yeniId("y"), maxlength: "500" });
    function durumCiz(o) {
      var pl = (o && o.platformlar) || {};
      var anahtarlar = Object.keys(pl);
      P.degistir(kayitliDurum, anahtarlar.length ? anahtarlar.map(function (k) {
        var x = pl[k];
        return P.h("span", { class: "iz " + (x.durum === "yuklendi" ? "ok" : "uyari") }, P.ikon(x.durum === "yuklendi" ? "tamam" : "saat"), k + ": " + ({ hazir: "hazır", planli: "planlı", yuklendi: "yüklendi" }[x.durum] || x.durum), x.url ? P.h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer" }, " bağlantı") : null);
      }) : null);
    }
    var isaretle = P.dugme("İşaretle", { tur: "hafif", ikon: "tamam", onclick: async function () {
      var g = { is: ctx.is, platform: platform.value, durum: durum.value };
      if (adres.value.trim()) g.url = adres.value.trim();
      try { var r = await P.api("/api/yayin-isaretle", g); durumCiz(r.yayin); P.durumYaz(isaretYer, "ok", "Kaydedildi."); }
      catch (e) { P.durumYaz(isaretYer, "hata", e); }
    } });
    var perfBtn = P.dugme("Performans verisini çek", { tur: "hafif", ikon: "trend", title: "vidIQ'dan izlenme sayısını okur (YouTube bağlantısı işaretlenmiş olmalı)", onclick: function () { P.kontrolluBaslat(ctx, genel, "performans", {}, { ucretli: true }); } });
    ctx.kilitle(perfBtn, "mesgul");

    function guncelle() { kapakCiz(); }
    var yuklendi = false;
    // daha once isaretlenen yayin durumu (yayin-durum.json): sekme acilinca okunur, yalniz isaretleyince degil
    async function durumYukle() {
      try { var r = await P.api("/api/dosya?is=" + encodeURIComponent(ctx.is) + "&tur=yayinDurum"); durumCiz(r.json); }
      catch (e) { P.durumYaz(durumYer, "hata", e); }
    }
    function ac() {
      kapakCiz();
      baslikYukle(); paketYukle(); durumYukle();
      yuklendi = true;
    }
    P.olay.dinle("is-bitti", function (o) { if (o && o.is === ctx.is && yuklendi && document.body.contains(kapakYer)) { sonKapak = null; kapakCiz(); baslikYukle(); paketYukle(); } });
    var kok = P.h("div", { class: "sekme-icerik" },
      P.bolum("Kapak", "1280×720 (dikeyde 1080×1920), 2 MB altı JPG.", kapakYer, genel),
      P.bolum("Başlık ve etiketler", "Başlık puanı ve alternatifler vidIQ ile üretilir. Beğendiğin başlığı seçince işin başlığı güncellenir.", baslikYer),
      P.bolum("Yayın paketi", "Açıklama, bölümler, etiketler ve atıflar — YouTube'a yüklerken kopyala-yapıştır.", paketYer),
      P.bolum("Yayın öncesi uyum kontrolü", "Yüklemeden önce gözden geçir.", uyumYer),
      P.bolum("Yayın durumu", "Panel yükleme yapmaz; videoyu kendin yüklersin. Yüklediğini buradan işaretle.",
        P.h("div", { class: "alan-izgara" }, P.alan("Platform", platform), P.alan("Durum", durum), P.alan("Adres", adres)),
        P.h("div", { class: "satir" }, isaretle, perfBtn), isaretYer, kayitliDurum, durumYer));
    return { kok: kok, ac: ac, guncelle: guncelle };
  }
  P.sekmeler.push({ sira: 6, ad: "yayin", etiket: "Yayın", ikon: "yayin", yalnizVideo: true, kur: kur });
})();
