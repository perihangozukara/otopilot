/*
 * toplu-uret.cjs — senaryo manifestinden TOPLU Shorts uretir.
 * Iki serit: [hazirlik] seslendir -> gorsel-bul (sirali, API nezaketi)
 *            [render]   hazirligi biten is GPU'da render edilir
 *
 * Kullanim: node toplu-uret.cjs <senaryolar.json>
 * Manifest: [{ "slug":"021-ornek", "baslik_en":"...", "paragraflar":["...", ...] }, ...]
 *       ya: { "kanal":"KANAL ADI", "varsayilan":{ "ses":"...", "dil":"tr" }, "isler":[ ... ] }
 *   Oge basina istege bagli: kanal, ses, sesHizi, dil, hedefSaniye, format.
 *   Kanal onceligi: oge > manifest "varsayilan" > manifest koku > panel-ayar.json.
 *
 * Dayanikli: yarim kalan kosudan devam eder; var olan konu.json ve dolu senaryolar EZILMEZ;
 * "bitti" = mp4 var + .part yok + sure okunabiliyor; hata varsa cikis kodu 1;
 * tam gunluk uretim/_toplu-<tarih>.log dosyasina yazilir. Cekirdek: lib/panel-toplu.js
 */
'use strict';
require('./lib/panel-toplu.js').cli('short', 'toplu-uret.cjs');
