// GORSEL ARAMA KELIMESI CIKARIMI VE SAHNE PLANI (GO grubu) — saf fonksiyonlar, ag/dosya YOK.
//
// Oncelik (gorsel-akis.js): konu.sahneKelimeleri[sahne-1] > Voice/gorsel-aramalari.json > BU DOSYADAKI otomatik cikarim.
// Otomatik cikarim yalnizca YEDEKTIR; soyut paragraflarda sinirlidir, yine de:
//   - Unicode duyarlidir (Turkce/aksanli harfler atilmaz), Ingilizce + Turkce durak sozcukler
//   - cumle basi buyuk harfi ozel isim saymaz ("Imagine Einstein" -> "Einstein")
//   - buyuk harfli kisaltmalari (NASA, CERN, GPT) yakalar
//   - komsu icerik kelimelerinden ikili ifade kurar ("black hole", "polar bear")
"use strict";

// ---------------------------------------------------------------- durak sozcukler
const DURAK_EN = new Set(("a an the and or but if then than that this these those of in on at to for from by with " +
  "as is are was were be been being have has had do does did will would can could should may might must shall " +
  "it its it's we our us you your they their them he she his her i me my not no nor so such very more most " +
  "much many some any all both each few other another same own just also too only even still yet about into " +
  "over under again further once here there when where why how what which who whom while because before after " +
  "above below between through during against among within without across behind beyond upon since until " +
  "one two three first second next last new old good great big small long short high low right left thing " +
  "things something anything everything nothing someone anyone everyone way ways time times year years day days " +
  "make makes made making take takes took taken get gets got getting go goes going gone come comes came " +
  "know knows knew known think thinks thought see sees saw seen look looks looked want wants wanted " +
  "say says said tell tells told give gives gave given find finds found use uses used using " +
  "really actually basically simply literally probably maybe perhaps almost always never often sometimes " +
  "let lets like likes liked well back down out up off now today tomorrow yesterday " +
  "need needs needed later earlier soon forever whenever whatever anyway ahead ago away " +
  // soyut kelimeler: gorsel aramada ise yaramaz
  "moment moments people person story stories part parts half kind sort lot bit " +
  "end ends start starts side sides point points case cases fact facts idea ideas reason reasons " +
  "result results example examples number numbers group groups level levels area areas place places " +
  "life lives work works word words name names form forms line lines order orders state states " +
  "change changes question questions answer answers problem problems chance chances " +
  "sense senses truth kinds amount amounts piece pieces set sets step steps stage stages " +
  "difference differences matter matters issue issues topic subject feeling feelings " +
  "everybody nobody somebody anybody others rest whole entire actual real true false " +
  "begin begins began begun happen happens happened turn turns turned keep keeps kept " +
  "become becomes became put puts seem seems seemed leave leaves bring brings brought " +
  "call calls called working try tries tried ask asks asked show shows showed shown " +
  "mean means meant feel feels felt run runs ran stop stops stopped talk talks talked " +
  "believe believes hear hears heard hold holds held remember remembers write writes wrote " +
  "understand understands sit sits stand stands lose loses lost pay pays paid meet meets met " +
  "week weeks month months hour hours minute minutes seconds " +
  "tonight morning evening night already ever " +
  "little large huge tiny enough far near close early late fast slow hard easy simple " +
  "important different possible impossible available able likely unlikely certain sure " +
  "usually rarely mostly nearly exactly quite rather pretty fairly somewhat entirely completely " +
  "every either neither everywhere anywhere somewhere elsewhere however therefore moreover " +
  "instead besides otherwise meanwhile although though unless whether around throughout"
  ).split(/\s+/));

const DURAK_TR = new Set(("ve bir bu şu o için ile de da ki mi mı mu mü gibi kadar çok daha en ama fakat ancak çünkü " +
  "olarak olan oldu olur olmuş olacak olduğu olduğunu olması olmak olması var yok ben sen biz siz onlar bunu şunu onu " +
  "bunlar şunlar her hiç bütün tüm sonra önce şimdi artık hem ya veya yani ne nasıl neden niye kim hangi nerede nereye " +
  "üzerinde içinde arasında göre karşı rağmen hâlâ hala bile sadece yalnızca belki zaten bazı birçok birkaç başka diğer " +
  "öyle böyle şöyle kendi kendisi bizim sizin onların benim senin onun bunun şunun üzere dolayı sanki hep hemen çoğu " +
  "pek fazla az eğer ise değil değildir gerek gerçekten aslında özellikle tabii tabi evet hayır peki işte şey şeyler " +
  "zaman kez kere defa yıl gün hafta ay saat dakika oluyor oluyordu yapıyor yapmak yaptı yapılan eder etti etmek edilen " +
  "gelen geldi gelir gidiyor gitti verir verdi aldı alır alan bulunan söyledi dedi diyor diye demek görünce gördü görür " +
  "bilir bildi biliyor istiyor istedi sonunda başında ortasında içindeki dışında altında önünde arkasında yanında " +
  "bunlardan bundan şundan ondan sonrasında öncesinde sırasında ayrıca üstelik yine tekrar sürekli genellikle " +
  "muhtemelen belli hatta oysa halbuki mesela örneğin sonuç neredeyse tam hiçbir herkes kimse biri bazen çoğu " +
  "olmadan olsa olsun olabilir olabilirdi olduğunda olursa dün bugün yarın gece sabah akşam").split(/\s+/));

// Cumle basinda buyuk yazilir ama ozel isim DEGILDIR (DURAK'ta olmayanlar)
const CUMLE_BASI_EN = new Set(("imagine picture consider suppose meet welcome think look watch listen wait notice " +
  "remember maybe perhaps meanwhile however instead finally stay try ask tell say come go see stop wait " +
  "yes okay sometimes nobody everyone someone everything nothing something anything somewhere tonight").split(/\s+/));

// Kisaltma gibi gorunen ama anlam tasimayan buyuk harf dizileri
const KISALTMA_KARA = new Set(["OK", "AM", "PM", "VS", "NO", "SO", "OR", "IT", "IS", "IF", "IN", "ON", "AT", "TO", "OF",
  "BY", "AS", "AN", "BE", "DO", "GO", "HE", "ME", "MY", "WE", "US", "ALL", "THE", "AND", "BUT", "FOR", "NOT", "YOU",
  "ARE", "WAS", "HAS", "HAD", "CAN", "NOW", "NEW", "ONE", "TWO", "BIR", "VE", "BU"]);

const kucukHarf = (s, dil) => (dil === "tr" ? String(s).toLocaleLowerCase("tr") : String(s).toLowerCase());
const durakMi = (w, dil) => DURAK_EN.has(w) || (dil === "tr" && DURAK_TR.has(w));

// Aksan/Turkce karakterleri sadelestirir (karsilastirma icin): "Şeker" ~ "seker"
function katla(s) {
  return String(s).normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/İ/g, "i").toLowerCase();
}

// ---------------------------------------------------------------- kelime ayiklama
function temizKelime(w, dil) {
  let x = w.replace(/^['’-]+|['’-]+$/g, "");
  if (dil === "tr") x = x.replace(/['’]\p{L}{1,5}$/u, "");        // İstanbul'da -> istanbul
  else x = x.replace(/['’]s$/, "");                              // Einstein's -> einstein
  return x;
}

// Icerik kelimeleri (sirasi korunur, tekrarlar korunur)
function kelimeler(metin, dil) {
  return kucukHarf(metin, dil)
    .replace(/[^\p{L}\p{N}\s'’-]/gu, " ")
    .split(/\s+/)
    .map(w => temizKelime(w, dil))
    .filter(w => w.length > 2 && !durakMi(w, dil) && !/^\p{N}+$/u.test(w));
}

// Ozel isimler: "Cristiano Ronaldo", "Tower of London", "NASA". Cumle basindaki sıradan kelimeyi saymaz.
const BAGLAC = "(?:of|de|da|di|del|della|van|von|der|den|la|le|al|bin|el)";
const BUYUK = "\\p{Lu}\\p{Ll}{2,}(?:-\\p{Lu}\\p{Ll}+)?";
const RE_OZEL = new RegExp("([.!?…]\\s+|[\"“”]\\s*|\\n\\s*)?(" + BUYUK + "(?:\\s+(?:" + BAGLAC + "\\s+)?" + BUYUK + ")*)", "gu");
const RE_KISALTMA = /(?<![\p{L}\p{N}])\p{Lu}{2,6}(?![\p{L}\p{N}])/gu;

// kucuk: tum senaryoda KUCUK harfle gecen kelimelerin kumesi ("imagine" kucuk gecmisse cumle basindaki Imagine ozel isim degildir)
function ozelIsimler(paragraf, secenek) {
  const o = secenek || {};
  const dil = o.dil || "en";
  const kucuk = o.kucuk || new Set();
  const siradan = w => {
    const k = kucukHarf(w, dil);
    return durakMi(k, dil) || CUMLE_BASI_EN.has(k) || kucuk.has(k);
  };
  const bulunan = [];
  const metin = String(paragraf);
  let m;
  RE_OZEL.lastIndex = 0;
  while ((m = RE_OZEL.exec(metin)) !== null) {
    const cumleBasi = m.index === 0 || !!m[1];
    const kelimeler_ = m[2].split(/\s+/);
    // Cumle basindaki siradan kelimeyi at ("Imagine Einstein" -> "Einstein", "But Today" -> "")
    // Cumle basindaki tek kelime senaryoda hic kucuk harfle gecmiyorsa ("Einstein was...") ozel isim sayilir.
    if (cumleBasi) {
      while (kelimeler_.length && (siradan(kelimeler_[0]) || BAGLAC_TEST.test(kelimeler_[0]))) kelimeler_.shift();
    }
    if (!kelimeler_.length) continue;
    const ifade = kelimeler_.join(" ");
    if (durakMi(kucukHarf(ifade, dil), dil)) continue;
    bulunan.push(ifade);
  }
  RE_KISALTMA.lastIndex = 0;
  while ((m = RE_KISALTMA.exec(metin)) !== null) if (!KISALTMA_KARA.has(m[0])) bulunan.push(m[0]);
  return [...new Set(bulunan)];
}
const BAGLAC_TEST = new RegExp("^" + BAGLAC + "$");

// Senaryoda KUCUK harfle gecen kelimeler (ozelIsimler icin)
function kucukSozluk(senaryo, dil) {
  const k = new Set();
  const re = /(?<![\p{L}\p{N}])\p{Ll}[\p{L}'’-]{2,}/gu;
  let m;
  while ((m = re.exec(String(senaryo))) !== null) k.add(kucukHarf(temizKelime(m[0], dil), dil));
  return k;
}

// ---------------------------------------------------------------- senaryo capasi
// Tum senaryonun genel konusu: her sahne icin garanti yedek arama.
function genelCapa(senaryo, paragraflar, secenek) {
  const o = secenek || {};
  const dil = o.dil || "en";
  const sayim = {}, paragrafta = {};
  for (const w of kelimeler(senaryo, dil)) sayim[w] = (sayim[w] || 0) + 1;
  for (const p of paragraflar)
    for (const w of new Set(kelimeler(p, dil))) paragrafta[w] = (paragrafta[w] || 0) + 1;

  // Konuyu temsil eden kelime = EN COK PARAGRAFTA gecen kelime (tek seferlik nadir kelime degil).
  const sirali = Object.keys(sayim)
    .sort((a, b) => (paragrafta[b] - paragrafta[a]) || (sayim[b] - sayim[a]) || a.localeCompare(b));

  const capa = [];
  // en cok paragrafta gecen ozel isim
  const ozelSayim = new Map();
  const kucuk = o.kucuk || kucukSozluk(senaryo, dil);
  for (const p of paragraflar)
    for (const n of ozelIsimler(p, { dil, kucuk })) ozelSayim.set(n, (ozelSayim.get(n) || 0) + 1);
  const ozelSirali = [...ozelSayim.entries()].sort((a, b) => b[1] - a[1]);
  if (ozelSirali.length) capa.push(ozelSirali[0][0]);
  for (const w of sirali) {
    if (capa.length >= 3) break;
    if (paragrafta[w] < 2 && capa.length) break;              // tek paragrafta gecen kelime capa olamaz
    if (!katla(capa.join(" ")).includes(katla(w))) capa.push(w);
  }
  return capa;
}

// Yan yana iki icerik kelimesi ("black hole") -> kac kez gectigi. Senaryo boyunca tekrar eden ikili ifade
// gercek bir kavramdir ("polar bear"); bir kez gecen rastgele komsu kelimeler degildir.
function ikiliSayimlari(metin, dil) {
  const ham = kucukHarf(metin, dil).replace(/[^\p{L}\p{N}\s'’-]/gu, " ").split(/\s+/).filter(Boolean)
    .map(w => { const t = temizKelime(w, dil); return t.length > 2 && !durakMi(t, dil) && !/^\p{N}+$/u.test(t) ? t : null; });
  const sayim = new Map();
  for (let i = 0; i + 1 < ham.length; i++) {
    if (ham[i] && ham[i + 1] && ham[i] !== ham[i + 1]) {
      const a = ham[i] + " " + ham[i + 1];
      sayim.set(a, (sayim.get(a) || 0) + 1);
    }
  }
  return sayim;
}

// ---------------------------------------------------------------- paragraf icin arama ifadeleri
// Dondurur: en iyiden en genele sirali, tekil ifade listesi.
// baglam: {genelSayim, toplamKelime, capa, paragrafta, dil, kucuk, ikiliGenel}
function ifadeCikar(paragraf, baglam) {
  const b = baglam || {};
  const dil = b.dil || "en";
  const genelSayim = b.genelSayim || {};
  const paragrafta = b.paragrafta || {};
  const toplamKelime = b.toplamKelime || 1000;
  const capa = b.capa || [];

  const k = kelimeler(paragraf, dil);
  const yerel = {};
  for (const w of k) yerel[w] = (yerel[w] || 0) + 1;
  const puan = w => (yerel[w] || 0) * Math.log(toplamKelime / (genelSayim[w] || 1) + 1);

  // Metinde SADECE BIR KEZ gecen kelime konuyu temsil etmez; konu kelimeleri tekrar eder.
  const tumTekil = [...new Set(k)].sort((x, y) => puan(y) - puan(x));
  const tekrarEden = tumTekil.filter(w => (paragrafta[w] || 0) >= 2 || (genelSayim[w] || 0) >= 3);
  const tekil = tekrarEden.length ? tekrarEden : tumTekil;
  const ozel = ozelIsimler(paragraf, { dil, kucuk: b.kucuk });

  // Ikili ifadeler: yan yana iki icerik kelimesi ("black hole"); senaryoda tekrar edenler one gecer
  const ikili = ikiliSayimlari(paragraf, dil);
  const genelIkili = b.ikiliGenel || new Map();
  const ikiliPuan = x => {
    const [x1, x2] = x.split(" ");
    return puan(x1) + puan(x2) + 2.5 * Math.min(4, (genelIkili.get(x) || 1) - 1) + (ikili.get(x) - 1);
  };
  const ikiliSirali = [...ikili.keys()].sort((x, y) => ikiliPuan(y) - ikiliPuan(x));

  const capaMetin = capa.slice(0, 2).join(" ");
  // SIRA ONEMLI: paragrafin KENDI kelimesi once; capa yalnizca yedek.
  const aday = [];
  ozel.slice(0, 2).forEach(o => aday.push(o));               // 1. ozel isimler — en degerli
  if (ikiliSirali[0]) aday.push(ikiliSirali[0]);              // 2. en iyi ikili ifade ("polar bear"): tek kelimeden daha belirgin
  if (tekil[0]) aday.push(tekil[0]);                          // 3. paragrafin en ayirt edici kelimesi
  if (tekil[1]) aday.push(tekil[1]);                          // 4. ikinci kelime
  // 5. konu + kelime: yalnizca konu adi bu paragrafta da geciyorsa (cok konulu senaryoda alakasiz birlesim uretmesin)
  if (capa[0] && tekil[0] && !katla(capa[0]).includes(katla(tekil[0])) && katla(paragraf).includes(katla(capa[0])))
    aday.push(capa[0] + " " + tekil[0]);
  if (capaMetin) aday.push(capaMetin);                        // 6. garanti yedek: genel konu
  if (capa[0]) aday.push(capa[0]);

  // buyuk/kucuk harf farkiyla tekrar eden ifadeler ("Ronaldo", "ronaldo") bir kez
  const goruldu = new Set(), son = [];
  for (const x of aday.filter(Boolean).map(y => y.trim()).filter(y => y.length >= 3)) {
    const k = katla(x);
    if (!goruldu.has(k)) { goruldu.add(k); son.push(x); }
  }
  return son;
}

// ---------------------------------------------------------------- kozmik konu tespiti (NASA icin)
const KOZMIK_GUCLU = /(?<![\p{L}\p{N}])(nebula|galax(?:y|ies)|cosmos|cosmic|quasar|supernova|astronaut\w*|astronomy|spacecraft|interstellar|spacetime|black holes?|solar system|milky way|nasa|hubble|telescope|orbit|planets?|asteroids?|comets?|neutron stars?|galaksi\w*|gezegen\w*|kara delik\w*|evren\w*|astronot\w*|teleskop\w*|yörünge\w*|kuyruklu yıldız\w*|asteroit\w*)(?![\p{L}\p{N}])/giu;
const KOZMIK_GENIS = /(?<![\p{L}\p{N}])(nebula|galax\w*|cosmos|cosmic|quasar|supernova|astronaut\w*|astronom\w*|spacecraft|interstellar|spacetime|space-time|black holes?|solar system|milky way|nasa|hubble|telescope|orbit\w*|planets?|asteroids?|comets?|neutron stars?|stars?|moon|mars|jupiter|saturn|venus|mercury|universe|space station|rocket|satellite|galaksi\w*|gezegen\w*|kara delik\w*|evren\w*|yıldız\w*|astronot\w*|teleskop\w*|yörünge\w*|asteroit\w*|roket\w*|uydu\w*|güneş sistemi)(?![\p{L}\p{N}])/iu;

// "space" tek basina yetmez: futbol metnindeki "half second of space" NASA'yi tetikliyordu.
function kozmikMi(senaryo) {
  const v = String(senaryo).match(KOZMIK_GUCLU);
  return !!v && v.length >= 3;
}
const kozmikSahneMi = metin => KOZMIK_GENIS.test(String(metin));

// ---------------------------------------------------------------- sahne plani
const kelimeSay = m => String(m).split(/\s+/).filter(Boolean).length;

// Kanonik paragraflari sahnelere toplar. Kisa paragraflar KOMSUYLA birlesir (dusmez):
// her sahne ~10 sn (kisa videoda ~6 sn) anlatim tasimali. HER paragraf tam bir sahnede.
//   -> [{no:1, paragraflar:[0,1], metin, kelime}]
function sahnePlan(paragraflar, secenek) {
  const o = secenek || {};
  const MIN = o.kisa ? 14 : 22;
  const sahneler = [];
  paragraflar.forEach((p, idx) => {
    const k = kelimeSay(p);
    const son = sahneler[sahneler.length - 1];
    if (son && son.kelime < MIN) { son.paragraflar.push(idx); son.metin += " " + p; son.kelime += k; }
    else sahneler.push({ paragraflar: [idx], metin: p, kelime: k });
  });
  // kisa kalan son sahne bir oncekine katilir
  if (sahneler.length > 1 && sahneler[sahneler.length - 1].kelime < MIN) {
    const son = sahneler.pop(), onceki = sahneler[sahneler.length - 1];
    onceki.paragraflar.push(...son.paragraflar); onceki.metin += " " + son.metin; onceki.kelime += son.kelime;
  }
  sahneler.forEach((s, i) => { s.no = i + 1; });
  return sahneler;
}

// Bir sahnede kac gorsel olsun: ~8 sn'de bir (kisa videoda ~6 sn), 2-14 arasi.
// Toplam 160'i asmasin diye (cok uzun videolar) oransal kisilir.
function sahneAdetleri(sahneler, secenek) {
  const o = secenek || {};
  const hiz = o.kelimeHizi || 151;
  const aralik = o.kisa ? 6 : 8;
  const adet = sahneler.map(s => Math.max(2, Math.min(14, Math.ceil((s.kelime / hiz * 60) / aralik))));
  const toplam = adet.reduce((a, b) => a + b, 0);
  const TAVAN = o.tavan || 160;
  if (toplam > TAVAN) {
    // cok uzun videoda sahne basina taban 1'e iner (yoksa 100+ sahnede 2'ser gorsel tavani asar)
    const taban = sahneler.length * 2 > TAVAN ? 1 : 2;
    const oran = TAVAN / toplam;
    for (let i = 0; i < adet.length; i++) adet[i] = Math.max(taban, Math.round(adet[i] * oran));
  }
  return adet;
}

// "Albert Einstein" -> "albert-einstein" (klasor adi icin, <=24 karakter, ASCII)
function klasorSlug(ifade) {
  const s = katla(ifade).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "");
  return s || "sahne";
}
const sahneKlasorAdi = (no, ifade) => String(no).padStart(3, "0") + "-" + klasorSlug(ifade);

module.exports = {
  DURAK_EN, DURAK_TR, kelimeler, ozelIsimler, kucukSozluk, genelCapa, ifadeCikar, ikiliSayimlari,
  kozmikMi, kozmikSahneMi, sahnePlan, sahneAdetleri, klasorSlug, sahneKlasorAdi, katla, kelimeSay, durakMi, kucukHarf,
};
