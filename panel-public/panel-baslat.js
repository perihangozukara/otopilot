// PANEL ARAYUZU — baslangic: menu, gunluk cubugu, ilk veri, yonlendirme.
// Sayfa yenilenince: calisan islere /api/calisanlar ile yeniden baglanilir (panel-calisma.js), adres cubugundaki #/videolar/<is>/<sekme> geri yuklenir.
(function () {
  "use strict";
  var P = window.P;

  // beklenmeyen arayuz hatalari sessiz kalmasin (ama ag hatalari zaten ayrica gosteriliyor)
  var sonHata = 0;
  function arayuzHatasi(m) {
    console.error(m);
    var simdi = Date.now(); if (simdi - sonHata < 4000) return; sonHata = simdi;
    P.bildir("Arayüzde beklenmeyen bir hata oluştu; sorun sürerse sayfayı yenile.", "hata");
  }
  window.addEventListener("error", function (e) { arayuzHatasi(e.error || e.message); });
  window.addEventListener("unhandledrejection", function (e) { if (e.reason && e.reason.name === "ApiHata") return; arayuzHatasi(e.reason); });

  async function baslat() {
    P.menuKur();
    var atla = document.getElementById("atla");
    if (atla) atla.addEventListener("click", function (e) { e.preventDefault(); var a = document.getElementById("ana"); if (a) a.focus(); });
    window.addEventListener("hashchange", function () { P.rotaUygula(true); });
    P.calismaBaslat();
    await Promise.all([P.ayarYukle().catch(function () { }), P.ozellikYukle()]);
    if (!location.hash || location.hash === "#") history.replaceState(null, "", "#/videolar");
    P.rotaUygula(false);
    P.islerYenile().catch(function () { });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", baslat); else baslat();
})();
