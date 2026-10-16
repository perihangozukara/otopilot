// PANEL ARAYUZU — calisan isler, gunluk cubugu (dock), ilerleme, durdur/onayla, sayfa yenilenince yeniden baglanma.
// Sunucu uclari: GET /api/calisanlar, GET /api/log?id=&ara=N, GET /api/gunluk?is=, POST /api/calistir|durdur|onayla.
// Gunluk satirlari sunucuda artan mutlak `n` ile numaralanir; istemci son n'yi tutar (kirpma donmaya yol acmaz).
(function () {
  "use strict";
  var P = window.P;
  var MAKS_SATIR = 700;                       // DOM'da en cok bu kadar satir kalir (uzun islerde donma olmasin)
  P.calisan = { liste: [], kuyruk: [], yuklendi: false };

  var izle = yeniIzle();
  var ui = {};
  var zamanlayici = null;

  function yeniIzle() { return { id: null, is: null, tur: null, sonN: 0, bitti: false, kayip: false, yetim: false, statik: false, durum: null, yuzde: null, adim: "", adimNo: 0, adimToplam: 0, takildi: false, hata: null, etiket: "" }; }

  // ---------------------------------------------------------------- yardimcilar (diger modullerin kullandigi)
  P.calisanBul = function (is) {
    var l = P.calisan.liste;
    for (var i = 0; i < l.length; i++) if (l[i].is === is) return l[i];
    return null;
  };
  P.mesgul = function (is) { var c = P.calisanBul(is); return !!c && (c.durum === "calisiyor" || c.durum === "sirada"); };
  P.onayBekliyor = function (is) { var c = P.calisanBul(is); return !!c && c.durum === "onay_bekliyor"; };
  P.izleDurumu = function () { return Object.assign({}, izle); };

  var CALISAN_ETIKET = { hepsi: "Tüm zincir", devam: "Tüm zincir", senaryo: "Senaryo", senaryoV: "Senaryo (vidIQ)", baslikOn: "Başlık puanı", baslik: "Başlık analizi", ceviri: "Altyazı çevirisi",
    gorsel: "Görseller", gorselSahne: "Sahne görseli", gorselUret: "Yapay zekâ görsel", nasa: "NASA görselleri", portre: "Portreler", formul: "Formül kartı", prompt: "Prompt kartı",
    ses: "Seslendirme", video: "Video", onizleme: "Önizleme", kapak: "Kapak", yayin: "Yayın paketi", shortsKes: "Shorts kesme", vsKur: "VS kurulumu", vsDuzelt: "VS düzeltme", vsYap: "VS videosu",
    vsHepsi: "VS (hepsi)", markaYap: "Kanal görselleri", trend: "Trend arama", viral: "Viral analiz", performans: "Performans", yetim: "Önceki oturum" };
  P.turEtiketi = function (t) { return CALISAN_ETIKET[t] || t; };

  // ---------------------------------------------------------------- calisanlar yoklamasi
  var ilkYukleme = true;
  P.calisanlariYenile = async function () {
    var r = await P.api("/api/calisanlar");
    var onceki = P.calisan.liste.map(function (c) { return c.id + ":" + c.durum; }).join("|");
    P.calisan.liste = r.calisanlar || [];
    P.calisan.kuyruk = r.kuyruk || [];
    P.calisan.yuklendi = true;
    var simdi = P.calisan.liste.map(function (c) { return c.id + ":" + c.durum; }).join("|");
    if (izle.yetim && !P.calisan.liste.some(function (c) { return c.yetim && c.is === izle.is; })) yetimBitti();
    chipleriCiz();
    ustDugme();
    P.olay.yay("calisan-tazele", P.calisan);
    if (ilkYukleme) { ilkYukleme = false; otomatikBaglan(); }
    else if (!izle.id && !izle.statik) otomatikBaglan(true);
    if (onceki !== simdi) P.olay.yay("calisanlar", P.calisan);
    // izlenen is listeden dustuyse ve log hala "calisiyor" sanıyorsa tek seferlik sorgu gerekir
    if (izle.id && !izle.bitti && !izle.yetim && !P.calisan.liste.some(function (c) { return c.id === izle.id; })) sorgula(true);
  };
  function otomatikBaglan(sessiz) {
    var l = P.calisan.liste.filter(function (c) { return !c.yetim && c.durum !== "onay_bekliyor"; });
    if (!l.length) return;
    var rota = P.rota();
    var secili = rota.gorunum === "videolar" ? rota.parcalar[0] : null;
    var c = l.filter(function (x) { return x.is === secili; })[0] || l[0];
    P.izleBaslat(c.id, { is: c.is, tur: c.tur }, { acma: sessiz });
  }
  P.calisanYoklayici = function () {
    return P.yokla(P.calisanlariYenile, function () { return P.calisan.liste.some(function (c) { return c.durum === "calisiyor" || c.durum === "sirada"; }) ? 2000 : 6000; });
  };

  // ---------------------------------------------------------------- calistir / durdur / onayla
  P.calistir = async function (tur, govde, yer) {
    try {
      var r = await P.api("/api/calistir", Object.assign({ tur: tur }, govde || {}));
      P.izleBaslat(r.id, { is: r.is || (govde && govde.is), tur: tur });
      P.calisanlariYenile().catch(function () { });
      return r;
    } catch (e) {
      if (e.kod === "is_calisiyor" && e.id) {
        P.izleBaslat(e.id, { is: govde && govde.is, tur: tur });
        P.bildir("Bu iş zaten çalışıyor — çalışan işlem izleniyor.", "uyari");
        return null;
      }
      if (yer) P.durumYaz(yer, "hata", e); else P.bildir(P.hataMetni(e), "hata");
      return null;
    }
  };
  P.durdur = async function (id) {
    try {
      await P.api("/api/durdur", { id: id });
      P.bildir("Durdurma isteği gönderildi.", "bilgi");
      P.calisanlariYenile().catch(function () { });
      if (izle.id === id) tickZamanla(300);
    } catch (e) { P.bildir(P.hataMetni(e), "hata"); }
  };
  P.onayla = async function (is, yer) {
    try {
      var r = await P.api("/api/onayla", { is: is });
      if (r && r.id) P.izleBaslat(r.id, { is: is, tur: "hepsi" });
      P.calisanlariYenile().catch(function () { });
      return true;
    } catch (e) { if (yer) P.durumYaz(yer, "hata", e); else P.bildir(P.hataMetni(e), "hata"); return false; }
  };

  // ---------------------------------------------------------------- gunluk cubugu
  function dockKur() {
    var dock = document.getElementById("dock");
    ui.dock = dock;
    ui.ac = P.h("button", { type: "button", class: "dock-ac", "aria-expanded": "false", "aria-controls": "dock-govde", onclick: function () { P.dockAc(ui.govde.hidden); } },
      P.ikon("terminal"), P.h("span", { class: "dock-baslik" }, "Günlük"), P.h("span", { class: "dock-ozet soluk" }, "çalışan işlem yok"), P.ikon("yukari", "dock-ok"));
    ui.chipler = P.h("div", { class: "dock-isler", role: "group", "aria-label": "Çalışan işlemler" });
    ui.durdur = P.dugme("Durdur", { ikon: "durdur", tur: "tehlike", kucuk: true, onclick: function () { P.durdur(izle.yetim ? "y-" + izle.is : izle.id); } });
    ui.durdur.hidden = true;
    ui.temizle = P.dugme("Ekranı temizle", { kucuk: true, tur: "hafif", onclick: function () { P.bos(ui.log); } });
    ui.tam = P.dugme("Son günlüğü yükle", { kucuk: true, tur: "hafif", ikon: "metin", onclick: function () { if (izle.is) P.gunlukGoster(izle.is); } });
    ui.cubuk = P.h("div", { class: "cubuk", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": "İşlem ilerlemesi" }, P.h("div", { class: "cubuk-dolgu" }));
    ui.dolgu = ui.cubuk.firstChild;
    ui.durumMetni = P.h("div", { class: "dock-durum" });
    ui.durumSr = P.h("div", { class: "sr", role: "status" });          // ekran okuyucuya yalniz durum DEGISINCE bildirilir (yuzde ve satir akisi okunmaz)
    ui.hata = P.h("div", { class: "dock-hata" });
    ui.log = P.h("div", { class: "log", role: "log", "aria-live": "off", "aria-label": "İşlem günlüğü (kaydırılabilir)", tabindex: "0" });
    ui.govde = P.h("div", { class: "dock-govde", id: "dock-govde", hidden: true },
      P.h("div", { class: "dock-bilgi" }, ui.durumMetni, ui.durumSr, P.h("div", { class: "satir" }, ui.tam, ui.temizle, ui.durdur)), ui.hata, ui.log);
    P.degistir(dock, P.h("div", { class: "dock-ust" }, ui.ac, ui.chipler), ui.cubuk, ui.govde);
    ui.cubuk.hidden = true;
    ui.log.appendChild(P.h("div", { class: "ls ls-ipucu" }, "Çalışan işlem yok. Bir işlem başlatınca günlük burada akar; çalışan işlere sayfayı yenilesen de geri bağlanılır."));
    P.dockAc(!!P.depo.oku("dockAcik", false), true);
  }
  P.dockAc = function (ac, sessiz) {
    ui.govde.hidden = !ac;
    ui.ac.setAttribute("aria-expanded", ac ? "true" : "false");
    ui.dock.classList.toggle("acik", !!ac);
    if (!sessiz) P.depo.yaz("dockAcik", !!ac);
    if (ac) kaydir(true);
  };
  function ustDugme() {
    var b = document.getElementById("ust-calisan"); if (!b) return;
    var n = P.calisan.liste.filter(function (c) { return c.durum === "calisiyor" || c.durum === "sirada"; }).length;
    var onay = P.calisan.liste.filter(function (c) { return c.durum === "onay_bekliyor"; }).length;
    b.hidden = !(n || onay);
    P.degistir(b, P.ikon(n ? "yukleniyor" : "duraklat", n ? "don" : ""),
      P.h("span", null, n ? n + " işlem çalışıyor" : onay + " iş onay bekliyor"));
    b.className = "btn kucuk " + (n ? "hafif" : "uyari-btn");
  }
  // Çipler anahtarla eşlenir ve yoklamada YERİNDE güncellenir (yeniden yaratılmaz): klavyeyle çipe gelen kullanıcının odağı
  // her 2-6 sn'lik yoklamada DOM'dan düşüp gövdeye (BODY) geçmesin. Çıkan çip odaktaysa odak günlük düğmesine taşınır.
  var chipHarita = {}, chipKuyruk = null;
  function chipleriCiz() {
    var l = P.calisan.liste, gorulen = {}, hedef = [];
    l.forEach(function (c) {
      var anahtar = c.yetim ? "y-" + c.is : c.id;
      gorulen[anahtar] = true;
      var b = chipHarita[anahtar];
      if (!b) {
        b = P.h("button", { type: "button", class: "chip" }, P.h("b"), P.h("span"));
        b.addEventListener("click", function () { var k = b._c; if (k.yetim) { yetimGoster(k); } else P.izleBaslat(k.id, { is: k.is, tur: k.tur }); P.dockAc(true); });
        chipHarita[anahtar] = b;
      }
      b._c = c;                                  // tıklama her zaman en güncel kaydı kullanır
      var secili = (c.yetim ? izle.yetim && izle.is === c.is : izle.id === c.id);
      var yuzde = typeof c.yuzde === "number" ? " %" + Math.round(c.yuzde) : "";
      var durum = c.durum === "sirada" ? " · sırada" : c.durum === "onay_bekliyor" ? " · onay bekliyor" : c.yetim ? " · bağlantısız" : "";
      var sinif = "chip" + (secili ? " secili" : "");
      if (b.className !== sinif) b.className = sinif;
      b.setAttribute("aria-pressed", secili ? "true" : "false");
      var baslik = P.turEtiketi(c.tur) + (c.adim ? " — " + c.adim : "");
      if (b.title !== baslik) b.title = baslik;
      var ad = P.kisalt(c.is || P.turEtiketi(c.tur), 22), ek = " " + P.turEtiketi(c.tur) + yuzde + durum;
      if (b.firstChild.textContent !== ad) b.firstChild.textContent = ad;
      if (b.lastChild.textContent !== ek) b.lastChild.textContent = ek;
      hedef.push(b);
    });
    Object.keys(chipHarita).forEach(function (k) {
      if (gorulen[k]) return;
      var b = chipHarita[k];
      if (document.activeElement === b && ui.ac) ui.ac.focus({ preventScroll: true });
      b.remove(); delete chipHarita[k];
    });
    var bekleyen = P.calisan.kuyruk.filter(function (k) { return k.durum === "sirada"; }).length;
    if (bekleyen) {
      if (!chipKuyruk) chipKuyruk = P.h("span", { class: "chip pasif" });
      chipKuyruk.textContent = bekleyen + " iş kuyrukta";
      hedef.push(chipKuyruk);
    } else if (chipKuyruk && chipKuyruk.parentNode) chipKuyruk.remove();
    // yalnız yeri değişen/yeni düğümler taşınır; yerinde duranlara (odaktaki çip dahil) dokunulmaz
    hedef.forEach(function (el, i) { if (ui.chipler.children[i] !== el) ui.chipler.insertBefore(el, ui.chipler.children[i] || null); });
  }
  function yetimGoster(c) {
    izle = yeniIzle(); izle.is = c.is; izle.yetim = true; izle.tur = "yetim"; izle.durum = "calisiyor"; izle.etiket = c.is;
    P.bos(ui.log); P.bos(ui.hata);
    P.gunlukYukle(c.is, true);
    arayuzGuncelle();
  }
  // Önceki oturumdan kalan süreç bitti: izleme durumu "yetim"de takılı kalmasın (Durdur düğmesi ve "çalışıyor" metni kalkar),
  // süreç dosya yazmış olabileceği için açık iş sayfaları ve liste de tazelenir.
  function yetimBitti() {
    var is = izle.is;
    izle.yetim = false; izle.bitti = true; izle.yetimSonlandi = true; izle.durum = null;
    P.degistir(ui.hata, P.mesajKutusu("bilgi", "Önceki panel oturumundan kalan işlem sona erdi. ",
      is ? P.dugme("Son günlüğü göster", { kucuk: true, onclick: function () { P.gunlukGoster(is); } }) : null));
    arayuzGuncelle(); chipleriCiz();
    P.olay.yay("is-bitti", { is: is, id: "y-" + is, durum: null, tur: "yetim" });
  }

  // ---------------------------------------------------------------- izleme
  // izleBaslat(id, {is, tur}, {acma:true => dock'u acma})
  P.izleBaslat = function (id, o, ek) {
    o = o || {};
    if (String(id).indexOf("y-") === 0) { yetimGoster({ is: String(id).slice(2) }); if (!(ek && ek.acma)) P.dockAc(true); return; }
    if (izle.id === id && !izle.bitti) { if (!(ek && ek.acma)) P.dockAc(true); return; }
    clearTimeout(zamanlayici);
    izle = yeniIzle(); izle.id = id; izle.is = o.is || null; izle.tur = o.tur || null; izle.etiket = (o.is ? o.is + " · " : "") + P.turEtiketi(o.tur);
    P.bos(ui.log); P.bos(ui.hata);
    if (!(ek && ek.acma)) P.dockAc(true);
    arayuzGuncelle();
    chipleriCiz();
    sorgula(false);
  };
  function tickZamanla(ms) { clearTimeout(zamanlayici); zamanlayici = setTimeout(function () { sorgula(false); }, ms); }
  async function sorgula(tek) {
    var kimlik = izle.id; if (!kimlik || izle.bitti) return;
    var r;
    try { r = await P.api("/api/log?id=" + encodeURIComponent(kimlik) + "&ara=" + izle.sonN); }
    catch (e) {
      if (kimlik !== izle.id) return;
      if (e.durum === 404) { kayipOldu(); return; }
      if (!tek) tickZamanla(2500);
      return;
    }
    if (kimlik !== izle.id) return;
    uygula(r);
    if (r.bitti) bittiIsle(r); else if (!tek) tickZamanla(document.hidden ? 5000 : 1000);
  }
  function satirEkle(kap, s) {
    kap.appendChild(P.h("div", { class: "ls" + (s.tip ? " ls-" + s.tip : "") }, s.t));
  }
  function kaydir(zorla) {
    if (!ui.log || ui.govde.hidden) return;
    var y = ui.log;
    if (zorla || y.scrollHeight - y.scrollTop - y.clientHeight < 60) y.scrollTop = y.scrollHeight;
  }
  function uygula(r) {
    // kullanici en alttaysa yeni satirlarla birlikte alta kay (karar EKLEMEDEN ONCE verilir; buyuk toplu ekleme sonrasi olcmek yanlis olur)
    var altta = ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 60;
    if (r.kesildi) satirEkle(ui.log, { t: "… bazı satırlar panel belleğine sığmadı (günlük dosyasında duruyor)", tip: "uyari" });
    if (r.satirlar && r.satirlar.length) {
      var f = document.createDocumentFragment();
      r.satirlar.forEach(function (s) { satirEkle(f, s); });
      ui.log.appendChild(f);
      var fazla = ui.log.children.length - MAKS_SATIR;
      if (fazla > 0) {
        for (var i = 0; i < fazla; i++) ui.log.removeChild(ui.log.firstChild);
        if (!izle.kirpildi) { izle.kirpildi = true; ui.log.insertBefore(P.h("div", { class: "ls ls-uyari" }, "… eski satırlar ekrandan kaldırıldı (tamamı işin _log klasöründe)"), ui.log.firstChild); }
      }
      if (altta) ui.log.scrollTop = ui.log.scrollHeight;
    }
    izle.sonN = r.sonN != null ? r.sonN : izle.sonN;
    izle.durum = r.durum; izle.yuzde = r.yuzde; izle.adim = r.adim || ""; izle.adimNo = r.adimNo || 0; izle.adimToplam = r.adimToplam || 0;
    izle.takildi = !!r.takildi; izle.hata = r.hata || null; izle.is = r.is || izle.is; izle.tur = r.tur || izle.tur;
    izle.etiket = (izle.is ? izle.is + " · " : "") + P.turEtiketi(izle.tur);
    arayuzGuncelle();
  }
  function bittiIsle(r) {
    izle.bitti = true;
    arayuzGuncelle();
    P.calisanlariYenile().catch(function () { });
    P.olay.yay("is-bitti", { is: izle.is, id: izle.id, durum: r.durum, kod: r.kod, hata: r.hata, tur: izle.tur });
    if (r.durum === "bitti") P.bildir((izle.is ? izle.is + ": " : "") + P.turEtiketi(izle.tur) + " tamamlandı.", "ok");
    else if (r.durum === "hata") P.bildir((izle.is ? izle.is + ": " : "") + (r.hata ? r.hata.ozet : "işlem başarısız oldu."), "hata");
    else if (r.durum === "durduruldu") P.bildir((izle.is ? izle.is + ": " : "") + "işlem durduruldu.", "bilgi");
  }
  function kayipOldu() {
    izle.bitti = true; izle.kayip = true; izle.durum = null;
    P.degistir(ui.hata, P.mesajKutusu("uyari", "Bu işlemin canlı kaydı panelde bulunamadı (panel yeniden başlamış olabilir). ",
      izle.is ? P.dugme("Son günlüğü göster", { kucuk: true, onclick: function () { P.gunlukGoster(izle.is); } }) : null));
    arayuzGuncelle();
    P.calisanlariYenile().catch(function () { });
  }

  // diskteki son gunluk (panel yeniden baslamis olsa da okunur)
  P.gunlukYukle = async function (is, yetim) {
    try {
      var r = await P.api("/api/gunluk?is=" + encodeURIComponent(is) + "&satir=400");
      P.bos(ui.log);
      if (!r.dosya) { satirEkle(ui.log, { t: "Bu iş için kayıtlı günlük yok.", tip: "uyari" }); return; }
      if (r.kesildi) satirEkle(ui.log, { t: "… günlüğün başı gösterilmiyor (yalnız son 400 satır)", tip: "uyari" });
      var f = document.createDocumentFragment();
      r.satirlar.forEach(function (s) { satirEkle(f, { t: s.t, tip: /^\s*✗/.test(s.t) ? "err" : /^\s*✓/.test(s.t) ? "ok" : /^\s*▶/.test(s.t) ? "cmd" : /^\s*⚠/.test(s.t) ? "uyari" : null }); });
      ui.log.appendChild(f);
      if (!yetim) izle.etiket = is + " · son günlük (" + r.dosya + ")";
      arayuzGuncelle(); kaydir(true);
    } catch (e) { P.degistir(ui.hata, P.hataKutusu(e)); }
  };
  P.gunlukGoster = function (is) {
    clearTimeout(zamanlayici);
    izle = yeniIzle(); izle.is = is; izle.statik = true; izle.bitti = true; izle.etiket = is + " · son günlük";
    P.bos(ui.hata);
    P.dockAc(true);
    P.gunlukYukle(is, false);
    arayuzGuncelle(); chipleriCiz();
  };

  function durumMetni() {
    if (izle.statik) return "Kayıtlı günlük (canlı değil)";
    if (izle.yetimSonlandi) return "Önceki oturumdan kalan işlem sona erdi";
    if (izle.yetim) return "Önceki panel oturumundan kalan bir işlem çalışıyor — canlı izlenemez, durdurulabilir.";
    if (!izle.id) return "";
    var adim = izle.adimToplam > 1 ? "Adım " + izle.adimNo + "/" + izle.adimToplam + " — " + izle.adim : (izle.adim || P.turEtiketi(izle.tur));
    switch (izle.durum) {
      case "calisiyor": return adim;
      case "sirada": return "Sırada — başka bir ağır işlemin bitmesi bekleniyor";
      case "onay_bekliyor": return "Onayını bekliyor";
      case "bitti": return "Tamamlandı";
      case "hata": return "Hatayla durdu" + (izle.adim ? " — " + izle.adim : "");
      case "durduruldu": return "Durduruldu";
      default: return izle.kayip ? "Canlı kayıt yok" : "Bağlanıyor…";
    }
  }
  function arayuzGuncelle() {
    var calisiyor = !!izle.id && !izle.bitti;
    ui.durdur.hidden = !(calisiyor || izle.yetim);
    ui.tam.hidden = !izle.is || izle.statik;
    var yuzde = typeof izle.yuzde === "number" ? Math.max(0, Math.min(100, Math.round(izle.yuzde))) : null;
    ui.cubuk.hidden = !(calisiyor && yuzde !== null) && !(izle.durum === "bitti" && yuzde !== null);
    ui.dolgu.style.width = (yuzde || 0) + "%";
    ui.cubuk.setAttribute("aria-valuenow", String(yuzde || 0));
    ui.cubuk.classList.toggle("hata", izle.durum === "hata");
    var metin = durumMetni();
    var sr = (izle.etiket ? izle.etiket + ": " : "") + metin;
    if (ui.srSon !== sr) { ui.srSon = sr; ui.durumSr.textContent = sr; }
    ui.durumMetni.textContent = (izle.etiket ? izle.etiket + " — " : "") + metin + (yuzde !== null ? " · %" + yuzde : "") + (izle.takildi ? " · takılmış olabilir" : "");
    var ozet = ui.ac.querySelector(".dock-ozet");
    ozet.textContent = izle.etiket ? P.kisalt(izle.etiket + (metin ? " — " + metin : "") + (yuzde !== null ? " · %" + yuzde : ""), 70) : "çalışan işlem yok";
    ui.ac.classList.toggle("hata", izle.durum === "hata");
    // hata kutusu (canli): yalnız hata varsa
    if (izle.hata) {
      var h = izle.hata, ic = [P.h("strong", null, h.ozet)];
      if (h.cozum) ic.push(P.h("p", { class: "cozum" }, P.ikon("ok-sag"), h.cozum));
      if (h.detay) ic.push(P.h("details", null, P.h("summary", null, "Teknik ayrıntı"), P.h("pre", null, String(h.detay))));
      P.degistir(ui.hata, P.mesajKutusu("hata", ic));
    } else if (izle.takildi && !izle.bitti) {
      P.degistir(ui.hata, P.mesajKutusu("uyari", "Uzun süredir çıktı gelmiyor — takılmış olabilir. Beklemek istemiyorsan Durdur'a bas; iş kaldığı yerden devam eder."));
    } else if (!izle.kayip && !izle.yetimSonlandi && !izle.hata) P.bos(ui.hata);
  }

  P.calismaBaslat = function () {
    dockKur();
    var ust = document.getElementById("ust-calisan");
    if (ust) ust.addEventListener("click", function () { P.dockAc(true); var ilk = ui.chipler.querySelector("button"); if (ilk) ilk.focus(); });
    chipleriCiz();
    P.calisanYoklayici();
  };
})();
