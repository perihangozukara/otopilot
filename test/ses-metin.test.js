// test/ses-metin.test.js — okunus hazirligi, kelime sayma, uzun metin bolme.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../lib/ses-metin.js");

const duz = (s, d, o) => M.metniHazirla(s, d, o, { xml: false });

test("Turkce: yuzde, ondalik, binlik, yil ve ek", () => {
  assert.equal(duz("Enflasyon %15 arttı, oran 3,5 ve 2.500 kişi.", "tr"),
    "Enflasyon yüzde on beş arttı, oran üç virgül beş ve iki bin beş yüz kişi.");
  assert.equal(duz("1923'te kuruldu; 15% zam.", "tr"), "bin dokuz yüz yirmi üçte kuruldu; yüzde on beş zam.");
  assert.equal(duz("1.250.000 ve 12,05 ve 0,5", "tr"), "bir milyon iki yüz elli bin ve on iki virgül sıfır beş ve sıfır virgül beş");
});

test("Turkce: sayi sozcukleri (bin, yuz, sifir)", () => {
  assert.equal(M.trSayi("0"), "sıfır");
  assert.equal(M.trSayi("1000"), "bin");
  assert.equal(M.trSayi("2000"), "iki bin");
  assert.equal(M.trSayi("100"), "yüz");
  assert.equal(M.trSayi("101"), "yüz bir");
  assert.equal(M.trSayi("1000000"), "bir milyon");
  assert.equal(M.trSayi("1" + "0".repeat(19)), null, "19 haneden uzun sayi rakam olarak kalir");
  assert.equal(M.trSira("21"), "yirmi birinci");
});

test("Turkce: birim, para, derece, kisaltma, tarih, sira", () => {
  assert.equal(duz("150 m², 300 km/s, 5 km, 20°C, $5 milyon", "tr"),
    "yüz elli metrekare, üç yüz kilometre bölü saniye, beş kilometre, yirmi santigrat derece, beş milyon dolar");
  assert.equal(duz("Dr. Ahmet, Prof. Ayşe, vs. ile vb. geldi.", "tr"), "doktor Ahmet, profesör Ayşe, vesaire ile ve benzeri geldi.");
  assert.equal(duz("Tarih 05.10.2026.", "tr"), "Tarih beş Ekim iki bin yirmi altı.");
  assert.equal(duz("3. dünya ve 19. yy. önemli", "tr"), "üçüncü dünya ve on dokuzuncu yüzyıl önemli");
  assert.equal(duz("MÖ 330'da", "tr"), "milattan önce üç yüz otuzda");
  assert.equal(duz("Tom & Jerry", "tr"), "Tom ve Jerry");
});

test("Ingilizce: yuzde, para, derece, birim, kisaltma", () => {
  assert.equal(duz("15% more, $5 million, 20°C, 150 m², 300 km/h, 1 km, 5 km", "en"),
    "15 percent more, 5 million dollars, 20 degrees Celsius, 150 square meters, 300 kilometers per hour, 1 kilometer, 5 kilometers");
  assert.equal(duz("Dr. Smith vs. Jones, e.g. this", "en"), "Doctor Smith versus Jones, for example this");
  assert.equal(duz("Nothing here, etc. And the end in the U.S.", "en"), "Nothing here, et cetera. And the end in the United States.");
  assert.equal(duz("The U.S. Army", "en"), "The United States Army", "U.S. ortada cumleyi bolmez");
  assert.equal(duz("Item No. 5", "en"), "Item number 5");
  assert.equal(duz("Fish & chips", "en"), "Fish and chips");
});

test("Ingilizce'de rakamlar oldugu gibi kalir (motor dogru okuyor)", () => {
  assert.equal(duz("In 1923, 2,500 people", "en"), "In 1923, 2,500 people");
});

test("cumle sonundaki nokta sayiya/paraya yapismaz", () => {
  assert.equal(duz("It costs $5.", "en"), "It costs 5 dollars.");
  assert.equal(duz("Sayı 5.", "tr"), "Sayı beş.");
});

test("XML kacisi: varsayilan kacisli, xml:false kacissiz", () => {
  assert.equal(M.metniHazirla("A & B <c> d", "en"), "A and B &lt;c&gt; d");
  assert.equal(M.metniHazirla("AT&T <b>", "en"), "AT&amp;T &lt;b&gt;");
  assert.equal(M.metniHazirla("AT&T <b>", "en", null, { xml: false }), "AT&T <b>");
});

test("kontrol karakterleri, sifir genislikli isaret ve satir sonlari temizlenir", () => {
  const sifirGenislik = String.fromCharCode(0x200B, 0x2060, 0xFEFF);
  assert.equal(duz("a\u0000b" + sifirGenislik + "c\nd\r\ne", "en"), "abc d e");
  assert.equal(M.bomAt(String.fromCharCode(0xFEFF) + "metin"), "metin");
  assert.equal(M.bomAt("metin"), "metin");
  assert.equal(M.bomAt(null), "");
});

test("ZWNJ (U+200C) ve ZWJ (U+200D) SILINMEZ: Farsca/Arapca/Hintce'de birlesim isaretidir", () => {
  const zwnj = String.fromCharCode(0x200C), zwj = String.fromCharCode(0x200D);
  const fa = "می" + zwnj + "خواهم", hi = "क" + zwj + "ष";
  assert.equal(duz(fa, "fa"), fa);
  assert.equal(duz(hi, "hi"), hi);
  assert.equal(duz("a" + String.fromCharCode(0x200B) + "b", "fa"), "ab", "U+200B yine silinir");
});

test("Turkce: 'saat' baglaminda nokta/iki nokta ayracli saat ondalik sayilmaz", () => {
  assert.equal(duz("Saat 14.30'da toplantı var.", "tr"), "Saat on dört otuzda toplantı var.");
  assert.equal(duz("saat 9:05'te kalk", "tr"), "saat dokuz sıfır beşte kalk");
  assert.equal(duz("SAAT 14.00 gibi", "tr"), "SAAT on dört gibi", ":00 dakikasi okunmaz");
  assert.equal(duz("saat 23.59.", "tr"), "saat yirmi üç elli dokuz.");
  assert.equal(duz("saat 24.30", "tr"), "saat yirmi dört virgül otuz", "gecersiz saat: ondalik kalir");
  assert.equal(duz("Pi 3.14 ve 14.30 değeri", "tr"), "Pi üç virgül on dört ve on dört virgül otuz değeri", "baglamsiz ondalik bozulmaz");
});

test("Turkce: basinda sifir olan sayi (007, 0212) rakam rakam okunur; 0 ve 0,5 etkilenmez", () => {
  assert.equal(duz("007 numarası", "tr"), "sıfır sıfır yedi numarası");
  assert.equal(duz("0212 aranır", "tr"), "sıfır iki bir iki aranır");
  assert.equal(duz("0,5 ve 0 ve 10", "tr"), "sıfır virgül beş ve sıfır ve on");
  assert.equal(duz("007 agent", "en"), "007 agent", "Ingilizce rakamlar oldugu gibi kalir");
});

test("Ispanyolca: birim, para, derece, kisaltma, numara isareti", () => {
  assert.equal(duz("120 m², 1 km, 5 km, 90 km/h, 20°C", "es"),
    "120 metros cuadrados, 1 kilómetro, 5 kilómetros, 90 kilómetros por hora, 20 grados Celsius");
  assert.equal(duz("Dr. García y Sra. López, etc. Luego sigue.", "es"), "doctor García y señora López, etcétera. Luego sigue.");
  assert.equal(duz("En 330 a. C. nació; en 44 d. C. murió.", "es"), "En 330 antes de Cristo nació; en 44 después de Cristo murió.");
  assert.equal(duz("nº 5 y N.º 7", "es"), "número 5 y número 7");
  assert.equal(duz("$5 millones, $1, 10€, 50%", "es"), "5 millones de dólares, 1 dólar, 10 euros, 50 por ciento");
  assert.equal(duz("$5 mil", "es"), "5 mil dólares", "'mil' icin 'de' gerekmez");
});

test("Almanca: birim, para, derece, kisaltma", () => {
  assert.equal(duz("120 m², 5 km, 300 km/h, 20°C, 3 kg", "de"),
    "120 Quadratmeter, 5 Kilometer, 300 Kilometer pro Stunde, 20 Grad Celsius, 3 Kilogramm");
  assert.equal(duz("ca. 50 Mio. Menschen, z. B. in Nr. 5, usw. Dann Ende. Dr. Müller.", "de"),
    "circa 50 Millionen Menschen, zum Beispiel in Nummer 5, und so weiter. Dann Ende. Doktor Müller.");
  assert.equal(duz("44 v. Chr. und 79 n. Chr.", "de"), "44 vor Christus und 79 nach Christus.", "cumle sonundaki nokta geri konur");
  assert.equal(duz("$5 Millionen, 10 €", "de"), "5 Millionen Dollar, 10 Euro");
  assert.equal(duz("ca. Haus", "de"), "ca. Haus", "'ca.' yalniz rakamdan once acilir");
});

test("Fransizca: birim (tekil/cogul), para, derece, kisaltma, numara isareti", () => {
  assert.equal(duz("120 m², 1 km, 1,5 km, 2,5 km, 90 km/h, 20°C", "fr"),
    "120 mètres carrés, 1 kilomètre, 1,5 kilomètre, 2,5 kilomètres, 90 kilomètres par heure, 20 degrés Celsius");
  assert.equal(duz("Dr. Dupont et M. Martin, Mme Durand.", "fr"), "docteur Dupont et monsieur Martin, madame Durand.");
  assert.equal(duz("En 44 av. J.-C. n° 5, etc. Ensuite.", "fr"), "En 44 avant Jésus-Christ numéro 5, et cetera. Ensuite.");
  assert.equal(duz("5 millions $, $5 millions, 5 €, 3$", "fr"), "5 millions $, 5 millions de dollars, 5 euros, 3 dollars");
  assert.equal(duz("la lettre M. est suivie", "fr"), "la lettre M. est suivie", "'M.' yalniz buyuk harfli addan once monsieur olur");
});

test("es/de/fr: sayilar rakam olarak kalir, XML kacisi calisir", () => {
  assert.equal(duz("In 1923, 2.500 Menschen", "de"), "In 1923, 2.500 Menschen");
  assert.equal(M.metniHazirla("Tom & Jerry <b>", "es"), "Tom y Jerry &lt;b&gt;");
});

test("hazirlik surumu 3: kural degisikligi eski sesleri 'guncel degil' yapar", () => {
  assert.equal(M.HAZIRLIK_SURUMU, 3);
});

test("okunus sozlugu: kelime siniri, buyuk/kucuk duyarli, uzun anahtar once", () => {
  assert.equal(duz("The GPU and GPUs and GPU-2.", "en", { GPU: "G P U" }), "The G P U and GPUs and G P U-2.");
  assert.equal(duz("The GPU-2 chip", "en", { GPU: "G P U", "GPU-2": "G P U two" }), "The G P U two chip");
  assert.equal(duz("c++ ve C++", "tr", { "C++": "si plus plus" }), "c++ ve si plus plus");
  assert.equal(duz("no change", "en", {}), "no change");
});

test("bilinmeyen dilde yalniz okunus + XML kacisi", () => {
  assert.equal(M.metniHazirla("Hallo 50% & <b>", "de"), "Hallo 50 Prozent und &lt;b&gt;");
  assert.equal(M.metniHazirla("Konnichiwa 50%", "ja"), "Konnichiwa 50%");
});

test("kelimeSay: yalniz harf/rakam iceren parcalar", () => {
  assert.equal(M.kelimeSay("Hello, world — 5 ... &"), 3);
  assert.equal(M.kelimeSay(""), 0);
  assert.equal(M.kelimeSay(null), 0);
});

test("uzunMetniBol: kisa metin tek parca, uzun metin cumle sinirinda", () => {
  assert.deepEqual(M.uzunMetniBol("Kısa metin.", 1500), ["Kısa metin."]);
  const uzun = "Bu bir cümle. ".repeat(300).trim();
  const parcalar = M.uzunMetniBol(uzun, 1500);
  assert.ok(parcalar.length >= 3);
  for (const p of parcalar) {
    assert.ok(p.length <= 1500, "parca siniri asmamali: " + p.length);
    assert.ok(p.endsWith("."), "cumle ortasinda bolunmemeli");
  }
  assert.equal(parcalar.join(" "), uzun, "birlestirince ozgun metin elde edilmeli");
});

test("uzunMetniBol: tek cumle siniri asarsa virgulde, sonra bosluktan bolunur", () => {
  const cumle = ("kelime ".repeat(40) + ", ").repeat(10);          // ~2800 karakter, nokta yok
  const parcalar = M.uzunMetniBol(cumle, 1000);
  assert.ok(parcalar.length >= 3);
  for (const p of parcalar) assert.ok(p.length <= 1000);
  assert.equal(M.uzunMetniBol("x".repeat(3000), 1000).every(p => p.length <= 1000), true, "bosluksuz metin de bolunur");
});

test("hazirlikOzeti: sozluk ya da surum degisince degisir, sira onemsiz", () => {
  assert.equal(M.hazirlikOzeti({ a: "1", b: "2" }), M.hazirlikOzeti({ b: "2", a: "1" }));
  assert.notEqual(M.hazirlikOzeti({ a: "1" }), M.hazirlikOzeti({ a: "2" }));
  assert.equal(M.hazirlikOzeti(null), M.hazirlikOzeti({}));
});
