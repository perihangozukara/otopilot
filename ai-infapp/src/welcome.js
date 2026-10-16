'use strict';

/**
 * KARSILAMA EKRANI
 *
 * Otomasyon ilk kez acildiginda bir kez gosterilir, sonra bir daha cikmaz.
 * Amaci: karakteri yaratmadan once "ne ureteceksin" sorusuna veri
 * bulabilecegi bir yer gostermek.
 *
 * ONEMLI: bu ekran otomasyonu ENGELLEMEZ. Tek tikla gecilir, hicbir ozellik
 * kilitli degildir, hicbir yere kayit gerekmez. Ucuncu taraf onerisi, reklam ya da
 * yonlendirme linki ICERMEZ.
 */

const WELCOME = {
  id: 'hosgeldin',
  title: 'Hos geldin - once bu arac ne yapiyor',
  body: [
    // DIKKAT: burada "gorseli uretir" YAZMAZ. Onceki surumde oyle yaziyordu ve
    // README'nin en kalin uyarisiyla ("bu otomasyon gorselin kendisini
    // URETMEZ") dogrudan celisiyordu. Ilk ekranda soylenen sey, urunun
    // temel kuraliyla ayni olmali.
    'Ai Infapp sifirdan sanal bir insan yaratir ve kimligini kilitler: yuzu, hayati, sehri, rutini. Sonra ondan is istersin - "kahve reklami yap", "sokakta kombin cekimi" - ve her karede AYNI kisiyi uretecek prompt\'u kurar.',
    'GORSELI KENDISI URETMEZ ve stok gorsel icermez. Gorsel her zaman senin bagladigin API\'den gelir; varsayilan Pollinations ucretsiz ve anahtarsizdir.',
    'Ayrica iki panel daha var ve ikisi de yapay zeka GEREKTIRMEZ: Etsy POD (baskiya hazir tasarim + listeleme metni + listeleme gorseli) ve Reklam/Grafik Tasarim.',
    'Kurulum sirasi ve neyin zorunlu neyin istege bagli oldugu README\'de yaziyor. Su an hicbir sey ayarlamadan devam edebilirsin.',
  ],
  button: 'Anladim, basla',
};

module.exports = { WELCOME };
