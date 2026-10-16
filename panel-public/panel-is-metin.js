// PANEL ARAYUZU — is sayfasi / "Senaryo" ve "Ham ayarlar" sekmeleri.
// Uclar: GET|POST /api/dosya?is=&tur=senaryo|altyazi|kaynakmetin|konu, GET /api/dosya?tur=iddia.
// Kural (taslak koruma): yazilmis metin ASLA otomatik ezilmez. Diskteki metin degisirse (ornegin Senaryo yaz bitince)
// editor temizse sessizce yenilenir; kirliyse "diskte degisti" uyarisi cikar ve kullanici secer. Kirli editor sayfadan cikarken uyarir.
(function () {
  "use strict";
  var P = window.P;

  // textarea degeri satir sonlarini LF'ye cevirir. Diskten gelen metin (Notepad'de duzenlenmis CRLF'li senaryo/ayar) ayni bicime
  // getirilmeden "orijinal" diye tutulursa, dokunulmamis editor acilir acilmaz "kaydedilmedi" sayilir ve cikis uyarisi kurulur.
  function lf(s) { return String(s == null ? "" : s).replace(/\r\n?/g, "\n"); }

  // metin editoru: {kok, ta, yukle(zorla), kaydet(yer)->Promise<bool>, kirliMi(), metin()}
  function editor(ctx, o) {
    var anahtar = o.anahtar + ":" + ctx.is;
    var ta = P.metinAlani({ rows: String(o.rows || 18), id: P.yeniId("ed"), placeholder: o.placeholder || "", "aria-label": o.etiket, class: o.mono ? "mono-alan" : "" });
    var durum = P.h("div", { class: "durum-yeri", "aria-live": "polite" });
    var sayac = P.h("span", { class: "soluk" });
    var kirliRozet = P.rozet("kaydedilmedi", "uyari", "kalem"); kirliRozet.hidden = true;
    var cakisma = P.h("div", { class: "durum-yeri" });
    var st = { orijinal: "", yuklendi: false };
    var kaydetBtn = P.dugme("Kaydet", { tur: "birincil", ikon: "tamam", onclick: function () { kaydet(durum); }, title: "Ctrl+S" });
    var yenileBtn = P.dugme("Diskten yeniden yükle", { tur: "hafif", ikon: "yenile", onclick: async function () {
      if (kirliMi()) { var ok = await P.onayIste(durum, { baslik: "Yazdıkların atılsın mı?", metin: "Kaydedilmemiş değişiklikler silinir, diskteki metin yüklenir.", evet: "Diskten yükle", tehlikeli: true }); if (!ok) return; }
      yukle(true);
    } });
    var ek = P.h("span", { class: "satir-ek" });

    function kirliMi() { return st.yuklendi && ta.value !== st.orijinal; }
    function isaretle() {
      var k = kirliMi();
      if (k) P.kirli.add(anahtar); else P.kirli.delete(anahtar);
      kirliRozet.hidden = !k;
      sayacCiz();
    }
    function sayacCiz() { sayac.textContent = o.sayac ? o.sayac(ta.value) : ""; if (o.degisti) o.degisti(ta.value); }
    function url() { return "/api/dosya?is=" + encodeURIComponent(ctx.is) + "&tur=" + o.tur; }
    async function yukle(zorla) {
      var r;
      try { r = await P.api(url()); } catch (e) { P.durumYaz(durum, "hata", e); return; }
      if (o.yanit) o.yanit(r);
      var icerik = lf(r.icerik);
      if (!st.yuklendi || zorla || !kirliMi()) {
        if (ta.value !== icerik) ta.value = icerik;
        st.orijinal = ta.value; st.yuklendi = true; P.bos(cakisma);
      } else if (icerik !== st.orijinal) {
        P.degistir(cakisma, P.mesajKutusu("uyari", P.h("strong", null, "Diskteki metin sen yazarken değişti."), " Yazdıklarını korudum. ",
          P.dugme("Diskten yükle (yazdıklarım silinsin)", { kucuk: true, tur: "hafif", onclick: function () { yukle(true); } }),
          P.dugme("Benimkini koru", { kucuk: true, tur: "hafif", onclick: function () { st.orijinal = icerik; P.bos(cakisma); isaretle(); } })));
      }
      isaretle();
    }
    async function kaydet(yer) {
      yer = yer || durum;
      try {
        await P.api(url(), { icerik: ta.value });
        st.orijinal = ta.value; st.yuklendi = true; isaretle();
        P.durumYaz(yer, "ok", "Kaydedildi (" + new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) + ")." + (o.yedekNotu ? " " + o.yedekNotu : ""));
        if (o.sonra) o.sonra();
        P.islerYenile().catch(function () { });
        ctx.yenile().catch(function () { });
        return true;
      } catch (e) { P.durumYaz(yer, "hata", e); return false; }
    }
    ta.addEventListener("input", isaretle);
    ta.addEventListener("keydown", function (e) { if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) { e.preventDefault(); kaydet(durum); } });
    var kok = P.h("div", { class: "editor" }, ta, P.h("div", { class: "editor-alt" }, sayac, kirliRozet), cakisma,
      P.h("div", { class: "satir" }, kaydetBtn, yenileBtn, ek), durum);
    return { kok: kok, ta: ta, yukle: yukle, kaydet: kaydet, kirliMi: kirliMi, metin: function () { return ta.value; }, ek: ek, durum: durum, sayacCiz: sayacCiz,
      dugmeler: [kaydetBtn, yenileBtn] };
  }

  // textarea'da n. paragrafin basina git
  function paragrafaGit(ta, n) {
    var m, re = /\n\s*\n/g, bas = [0], v = ta.value.replace(/\r\n/g, "\n");
    var lead = v.length - v.replace(/^\s+/, "").length;
    bas[0] = lead;
    while ((m = re.exec(v)) !== null) { bas.push(m.index + m[0].length); }
    var i = Math.max(0, Math.min(bas.length - 1, n));
    ta.focus();
    ta.setSelectionRange(bas[i], bas[i]);
    var satir = v.slice(0, bas[i]).split("\n").length;
    ta.scrollTop = Math.max(0, (satir - 3) * 22);
  }

  // ---------------------------------------------------------------- Senaryo sekmesi
  function senaryoKur(ctx) {
    var konuDil = function () { var k = ctx.konu() || {}; var oz = ctx.ozet() || {}; return k.dil || oz.dil || "en"; };
    var hedefSn = function () { var k = ctx.konu() || {}; var oz = ctx.ozet() || {}; return typeof k.hedefSaniye === "number" ? k.hedefSaniye : typeof k.hedefDakika === "number" ? k.hedefDakika * 60 : (P.FORMATLAR[oz.format || "long"] || P.FORMATLAR.long).varsSn; };
    var uyumNotu = P.h("div", { class: "durum-yeri" });
    var senaryo = editor(ctx, { tur: "senaryo", anahtar: "senaryo", etiket: "Senaryo (seslendirme metni)", rows: 20, placeholder: "Seslendirme metnini buraya yaz ya da yapıştır. Paragrafları boş satırla ayır.",
      yedekNotu: "Eski metin Voice/yedek/ içinde saklandı.",
      sayac: function (m) {
        var kel = P.kelimeSay(m), ps = P.paragrafSay(m), dk = kel / P.kelimeHizi(konuDil());
        return kel ? P.sayi(kel) + " kelime · " + ps + " paragraf · ~" + dk.toFixed(1).replace(".", ",") + " dk konuşma (hedef " + (hedefSn() / 60).toFixed(1).replace(".", ",") + " dk)" : "Henüz senaryo yok";
      },
      degisti: function (m) {
        var kel = P.kelimeSay(m), hedef = hedefSn() / 60 * P.kelimeHizi(konuDil());
        if (kel > 40 && hedef > 0) {
          var oran = kel / hedef;
          P.degistir(uyumNotu, oran < 0.8 ? P.mesajKutusu("uyari", "Metin hedef süreden belirgin kısa (hedefin %" + Math.round(oran * 100) + "'i). Daha uzun bir video istiyorsan metni genişlet.")
            : oran > 1.25 ? P.mesajKutusu("uyari", "Metin hedef süreden uzun (hedefin %" + Math.round(oran * 100) + "'i). Video planladığından uzun çıkar.") : null);
        } else P.bos(uyumNotu);
        altyaziKontrol();
      }
    });
    var yazDugme = P.dugme("Yapay zekâyla yaz…", { tur: "hafif", ikon: "kalem", title: "Claude ya da vidIQ ile yeniden yazar (ücretli); eski metin yedeklenir", onclick: function () { if (P.senaryoYaz) P.senaryoYaz(ctx, senaryo.durum); } });
    ctx.kilitle(yazDugme, "mesgul");
    senaryo.ek.appendChild(yazDugme);

    // Senaryo motoru hedef sureye ulasamayinca (cikis 4) metni SESLENDIRME-TAM-METIN-yarim.txt'ye kaydeder: ucretli cagri
    // boşa gitmesin. Burada gosterilir; kullanici editore alip duzenler/kaydeder ya da yok sayar.
    var yarimYer = P.h("div", { class: "durum-yeri" });
    var sonYarim = null;
    async function yarimYukle() {
      var r;
      try { r = await P.api("/api/dosya?is=" + encodeURIComponent(ctx.is) + "&tur=senaryoyarim"); } catch (e) { P.durumYaz(yarimYer, "hata", e); return; }
      var metin = r.icerik || "";
      if (metin.trim().length < 50) { P.bos(yarimYer); return; }
      var kel = P.kelimeSay(metin), ps = P.paragrafSay(metin);
      var al = P.dugme("Editöre al", { kucuk: true, tur: "birincil", ikon: "kalem", onclick: async function () {
        if (senaryo.kirliMi()) {
          var ok = await P.onayIste(yarimYer, { baslik: "Editördeki metin değişsin mi?", metin: "Kaydedilmemiş yazdıkların yarım metinle değiştirilir.", evet: "Değiştir", tehlikeli: true });
          if (!ok) return;
        }
        senaryo.ta.value = metin;
        senaryo.ta.dispatchEvent(new Event("input", { bubbles: true }));
        P.bildir("Yarım metin editöre alındı. Gözden geçirip Kaydet'e bas.", "bilgi");
        senaryo.ta.focus();
      } });
      P.degistir(yarimYer, P.mesajKutusu("uyari", P.h("strong", null, "Önceki yazım hedef süreye ulaşamadı; yarım metin saklandı."),
        " " + P.sayi(kel) + " kelime · " + ps + " paragraf. Yazım ücretliydi, bu yüzden metin boşa gitmedi: gözden geçirip senaryo olarak kaydedebilir ya da ayrıntıyı (konu notu / kaynak metin) artırıp yeniden yazdırabilirsin. ", al));
    }

    var altyaziNot = P.h("div", { class: "durum-yeri" });
    var altyaziKapali = false;
    var altyazi = editor(ctx, { tur: "altyazi", anahtar: "altyazi", etiket: "Çeviri altyazısı", rows: 10, placeholder: "İsteğe bağlı. Paragraf sayısı senaryoyla AYNI olmalı; farklıysa render durur.",
      sayac: function (m) { return m.trim() ? P.paragrafSay(m) + " paragraf" : "boş"; }, degisti: function () { altyaziKontrol(); },
      // altyazi dili = anlatim dili ise ayri ceviri dosyasi yoktur (sunucu kullanilmiyor:true der): kutuyu kapat, nedenini soyle
      yanit: function (r) {
        var kapali = !!(r && r.kullanilmiyor);
        altyazi.ta.disabled = kapali;
        altyazi.dugmeler.forEach(function (d) { d.disabled = kapali; });
        if (kapali) { altyaziKapali = true; P.degistir(altyaziNot, P.mesajKutusu("bilgi", r.mesaj || "Bu işte ayrı bir çeviri altyazısı kullanılmıyor.")); }
        else if (altyaziKapali) { altyaziKapali = false; P.bos(altyaziNot); }
      } });
    function altyaziKontrol() {
      if (altyaziKapali) return;
      var a = altyazi.metin().trim(), s = senaryo.metin().trim();
      if (!a || !s) { P.bos(altyaziNot); return; }
      var n1 = P.paragrafSay(s), n2 = P.paragrafSay(a);
      P.degistir(altyaziNot, n1 !== n2 ? P.mesajKutusu("hata", "Senaryoda " + n1 + ", altyazıda " + n2 + " paragraf var. Eşit olmazsa video kurulumu durur (altyazı kaymasın diye).") : P.mesajKutusu("ok", "Paragraf sayıları eşit (" + n1 + ")."));
    }
    var kaynak = editor(ctx, { tur: "kaynakmetin", anahtar: "kaynak", etiket: "Kaynak / araştırma metni", rows: 8, placeholder: "İsteğe bağlı. Doluysa senaryo yalnız bu kaynaktaki ve yaygın bilinen bilgilere dayanır; emin olmadığı rakamı yuvarlar.",
      sayac: function (m) { return m.trim() ? P.sayi(m.length) + " / 20.000 karakter" : "boş"; } });

    // --- iddia raporu
    var iddiaYer = P.h("div", { class: "iddia-yer" });
    var iddiaVeri = null, filtre = "dusuk";
    var GUVEN = { yuksek: ["yüksek", "ok"], orta: ["orta", "soluk"], dusuk: ["düşük", "hata"], kaynaksiz: ["kaynaksız", "uyari"] };
    function iddiaCiz() {
      if (!iddiaVeri) return;
      var j = iddiaVeri.json;
      if (!j || !Array.isArray(j.iddialar)) {
        P.degistir(iddiaYer, P.h("p", { class: "soluk" }, "Henüz iddia raporu yok. Senaryo yazılırken otomatik çıkarılır; elle yazdığın senaryo için «Senaryo yaz» sonrası oluşur."),
          iddiaVeri.icerik ? P.h("details", null, P.h("summary", null, "Ham rapor"), P.h("pre", null, iddiaVeri.icerik)) : null);
        return;
      }
      var liste = j.iddialar.filter(function (x) { return filtre === "hepsi" || x.guven === "dusuk" || x.guven === "kaynaksiz"; });
      var sec = P.secim([["dusuk", "Yalnız düşük güvenli ve kaynaksız"], ["hepsi", "Hepsi"]], filtre, { "aria-label": "İddia filtresi", onchange: function (e) { filtre = e.target.value; iddiaCiz(); } });
      P.degistir(iddiaYer,
        P.h("p", null, (j.ozet ? j.ozet.toplam + " iddia · " + (j.ozet.dusukGuven || 0) + " düşük güvenli" : j.iddialar.length + " iddia") + (j.tarih ? " · " + P.tarihYaz(j.tarih) : "") + (j.uretici ? " · " + j.uretici : "")),
        P.h("p", { class: "ipucu" }, "Bunlar modelin kendi güven tahminidir; kontrol listesi olarak kullan. Rakam, tarih ve özel isimleri yayına almadan önce kaynaktan doğrula."),
        sec,
        liste.length ? P.h("ol", { class: "iddialar" }, liste.map(function (x) {
          var g = GUVEN[x.guven] || [x.guven || "?", "soluk"];
          return P.h("li", null, P.h("div", { class: "iddia-ust" }, P.rozet(g[0], g[1]), P.rozet(x.tur || "", "soluk"),
            P.dugme("Paragraf " + (Number(x.paragraf) + 1), { kucuk: true, tur: "hafif", onclick: function () { paragrafaGit(senaryo.ta, Number(x.paragraf) || 0); } })),
            P.h("p", { class: "iddia-metin" }, x.metin), x.not ? P.h("p", { class: "soluk" }, x.not) : null);
        })) : P.h("p", { class: "soluk" }, "Bu filtreyle gösterilecek iddia yok."));
    }
    async function iddiaYukle() {
      try { iddiaVeri = await P.api("/api/dosya?is=" + encodeURIComponent(ctx.is) + "&tur=iddia"); iddiaCiz(); }
      catch (e) { P.durumYaz(iddiaYer, "hata", e); }
    }

    var kok = P.h("div", { class: "sekme-icerik" },
      P.bolum("Senaryo", "Seslendirilecek metin. Paragraflar boş satırla ayrılır; her paragraf bir sahne grubuna denk gelir. Yazdıkların kaydedene kadar tarayıcıda durur, hiçbir şey seni uyarmadan ezilmez.", yarimYer, senaryo.kok, uyumNotu),
      P.bolum("İddia raporu", "Metindeki rakam, tarih, isim ve olayların kontrol listesi.", iddiaYer),
      P.bolum("Kaynak metin", "Senaryo motoruna verilen araştırma/kaynak metni (konu.json → arastirma).", kaynak.kok),
      P.bolum("Çeviri altyazısı", "Altyazı dili anlatım dilinden farklıysa kullanılır. «Altyazıyı çevir» adımı bunu otomatik doldurur.", altyazi.kok, altyaziNot));
    var yuklendi = false;
    P.olay.dinle("is-bitti", function (o) { if (o && o.is === ctx.is && document.body.contains(kok)) { senaryo.yukle(false); altyazi.yukle(false); iddiaYukle(); } });
    function ac() {
      senaryo.yukle(false); iddiaYukle();
      if (!yuklendi) { yuklendi = true; altyazi.yukle(false); kaynak.yukle(false); }
    }
    // ceviri altyazisi dosyasi konu.json'daki dil/altyaziDili'ne baglidir: Ses ve dil sekmesinden ya da Ham ayarlardan degisirse
    // editorun "kullanilmiyor" durumu eski kalmasin diye sunucuya yeniden sorulur (ilk gelen konuda sormaya gerek yok: ac() zaten sordu)
    var sonDilImza = null;
    function guncelle() {
      senaryo.sayacCiz();
      var kn = ctx.konu();
      if (kn) {
        var dilImza = (kn.dil || "") + "|" + (kn.altyaziDili || "");
        if (sonDilImza !== null && dilImza !== sonDilImza && yuklendi) altyazi.yukle(false);
        sonDilImza = dilImza;
      }
      var v = !!(ctx.detay && ctx.detay.dosyalar && ctx.detay.dosyalar.senaryoYarim);
      if (v !== sonYarim) { sonYarim = v; if (v) yarimYukle(); else P.bos(yarimYer); }
    }
    return { kok: kok, ac: ac, guncelle: guncelle, kaydet: senaryo.kaydet, editor: senaryo };
  }
  P.sekmeler.push({ sira: 2, ad: "senaryo", etiket: "Senaryo", ikon: "metin", yalnizVideo: true, kur: senaryoKur });

  // ---------------------------------------------------------------- Ham ayarlar sekmesi (konu.json)
  function konumBul(metin, satir, sutun) {
    var l = metin.split("\n"), p = 0;
    for (var i = 0; i < Math.min(satir - 1, l.length); i++) p += l[i].length + 1;
    return Math.min(metin.length, p + Math.max(0, (sutun || 1) - 1));
  }
  function hamKur(ctx) {
    var anahtar = "ham:" + ctx.is;
    var ta = P.metinAlani({ rows: "24", id: P.yeniId("ham"), "aria-label": "konu.json içeriği", class: "mono-alan", spellcheck: "false" });
    var durum = P.h("div", { class: "durum-yeri", "aria-live": "polite" });
    var cakisma = P.h("div", { class: "durum-yeri" });
    var st = { orijinal: "", yuklendi: false };
    var rozet = P.rozet("kaydedilmedi", "uyari", "kalem"); rozet.hidden = true;
    function kirliMi() { return st.yuklendi && ta.value !== st.orijinal; }
    function isaretle() { var k = kirliMi(); if (k) P.kirli.add(anahtar); else P.kirli.delete(anahtar); rozet.hidden = !k; }
    async function yukle(zorla) {
      try {
        var r = await P.api("/api/dosya?is=" + encodeURIComponent(ctx.is) + "&tur=konu");
        var icerik = lf(r.icerik);
        if (!st.yuklendi || zorla || !kirliMi()) { if (ta.value !== icerik) ta.value = icerik; st.orijinal = ta.value; st.yuklendi = true; P.bos(cakisma); }
        else if (icerik !== st.orijinal) P.degistir(cakisma, P.mesajKutusu("uyari", "Ayarlar başka bir yerden (Görünüm / Ses sekmesi) değişti. ",
          P.dugme("Diskten yükle (yazdıklarım silinsin)", { kucuk: true, tur: "hafif", onclick: function () { yukle(true); } })));
        isaretle();
      } catch (e) { P.durumYaz(durum, "hata", e); }
    }
    async function kaydet() {
      var metin = ta.value;
      try {
        var r = await P.api("/api/dosya?is=" + encodeURIComponent(ctx.is) + "&tur=konu", { icerik: metin });
        st.orijinal = metin; isaretle();
        var ic = ["Kaydedildi. Önceki hâli konu.json.bak olarak yedeklendi."];
        P.degistir(durum, P.mesajKutusu("ok", ic, r.uyarilar && r.uyarilar.length ? P.h("ul", null, r.uyarilar.map(function (u) { return P.h("li", null, P.h("code", null, u.alan), " — " + u.mesaj); })) : null));
        P.olay.yay("konu-degisti", { is: ctx.is, kaynak: "ham" });
        P.islerYenile().catch(function () { }); ctx.yenile().catch(function () { });
      } catch (e) {
        P.durumYaz(durum, "hata", e);
        if (e.satir) { ta.focus(); var p = konumBul(metin, e.satir, e.sutun); ta.setSelectionRange(p, Math.min(metin.length, p + 1)); }
      }
    }
    var duzenBtn = P.dugme("JSON'u düzenle (biçimlendir)", { tur: "hafif", ikon: "metin", onclick: function () {
      try { ta.value = JSON.stringify(JSON.parse(ta.value), null, 2) + "\n"; isaretle(); P.bos(durum); }
      catch (e) { P.durumYaz(durum, "hata", "JSON biçimlendirilemedi: " + e.message + " — önce hatayı düzelt."); }
    } });
    ta.addEventListener("input", isaretle);
    ta.addEventListener("keydown", function (e) { if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) { e.preventDefault(); kaydet(); } });
    P.olay.dinle("konu-degisti", function (o) { if (o && o.is === ctx.is && o.kaynak !== "ham" && document.body.contains(ta)) yukle(false); });
    var kok = P.h("div", { class: "sekme-icerik" },
      P.bolum("konu.json", "Bu işin tüm ayarları. Hatalı JSON kaydedilmez; her kayıttan önce konu.json.bak yedeği alınır. Alanların listesi proje klasöründeki KONU-JSON.md dosyasında.",
        P.h("div", { class: "editor" }, ta, P.h("div", { class: "editor-alt" }, rozet),
          cakisma, P.h("div", { class: "satir" }, P.dugme("Kaydet", { tur: "birincil", ikon: "tamam", onclick: kaydet, title: "Ctrl+S" }), duzenBtn,
            P.dugme("Diskten yeniden yükle", { tur: "hafif", ikon: "yenile", onclick: async function () {
              if (kirliMi()) { var ok = await P.onayIste(durum, { baslik: "Yazdıkların atılsın mı?", metin: "Kaydedilmemiş değişiklikler silinir, diskteki ayarlar yüklenir.", evet: "Diskten yükle", tehlikeli: true }); if (!ok) return; }
              yukle(true);
            } })), durum)));
    return { kok: kok, ac: function () { yukle(false); }, guncelle: function () { } };
  }
  P.sekmeler.push({ sira: 7, ad: "ham", etiket: "Ham ayarlar", ikon: "ayar", yalnizVideo: true, kur: hamKur });
})();
