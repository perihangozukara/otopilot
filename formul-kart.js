// Formul kartlari — kozmik zemin uzerine sinematik denklem gorselleri. Tamamen yerel, bedava.
// Kullanim: node formul-kart.js <is-klasoru>
//
// Kartlar konu.json > "formuller" listesinden uretilir (senaryo motorlari bu listeyi URETMEZ; elle tanimlanir):
//   "formuller": [{ "n": "e-mc2", "ust": "Kütle-enerji", "ana": "E = mc²", "alt": "Einstein, 1905", "hedef": "003-einstein" }]
//   n      kart dosya adinin parcasi (harf, rakam, bosluk, tire, alt cizgi)
//   hedef  kartin konacagi SAHNE klasoru (Visuals/<hedef>); verilmezse Visuals/14-formuller
// Metin lib/yazi.js ile yazilir (textfile): ' : % \ karakterleri sorun cikarmaz, font platforma gore secilir,
// uzun formuller sigdirilir/satirlanir.
//
// Cikis kodlari: 0 tamam | 1 ffmpeg hatasi | 2 girdi (is yok, konu.json bozuk) | 6 kilit
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./lib/ortak");
const Y = require("./lib/yazi");
const KT = require("./lib/senaryo-kart");

const { OrtakHata, CIKIS } = ortak;
const BETIK = "formul-kart.js";
const W = 1920, H = 1080;

// Ana formul metninin yerlesimi. Dikey bolge: ust etiket y=330 (~46 punto), bolme cizgisi y=630, alt metin y=680;
// formul yalniz 400-615 araligina girebilir. Tek satira sigarsa 132 puntoya kadar tek satir (y=440); sigmazsa SATIR SAYISINA
// GORE punto ve satir araligi kuculur (2 satir 84 punto, 3 satir 66, 4 satir 50), boylece satirlar cizgiye/alt metne binmez.
// 4 satira da sigmayan metin (ayri genis karakterler) son satirin sonuna "…" konarak kesilir: kesildi=true.
const DUZENLER = [
  { n: 2, punto: 84, lh: 100, y0: 410 },
  { n: 3, punto: 66, lh: 78, y0: 396 },
  { n: 4, punto: 50, lh: 58, y0: 392 },
];
function anaYerlestir(ana) {
  const uzunluk = Array.from(ana).length;
  const tek = Y.sigdir(ana, W - 220, 132);
  if (tek >= 60) return { satirlar: [ana], punto: tek, lh: 0, y0: 440, golge: 5, kesildi: false };
  for (const d of DUZENLER) {
    const sigan = Math.floor((W - 220) / (d.punto * 0.52));
    const satirlar = Y.satirla(ana, Math.min(sigan, Math.ceil(uzunluk / d.n) + 2));
    if (satirlar.length <= d.n) return Object.assign({ satirlar, golge: 4, kesildi: false }, d);
  }
  const d = DUZENLER[DUZENLER.length - 1];
  const satirlar = Y.satirla(ana, Math.floor((W - 220) / (d.punto * 0.52))).slice(0, d.n);
  satirlar[d.n - 1] = Array.from(satirlar[d.n - 1]).slice(0, -1).join("") + "…";
  return Object.assign({ satirlar, golge: 4, kesildi: true }, d);
}

// Tek kartin filtre zinciri. renk: "0xRRGGBB". metinDizin: textfile'larin yazilacagi klasor.
function formulFiltresi(f, i, renk, metinDizin) {
  const parcalar = [];
  const ust = KT.metinDogrula(f.ust, "formuller[" + i + "].ust", 120);
  const ana = KT.metinDogrula(f.ana, "formuller[" + i + "].ana", 160);
  const alt = KT.metinDogrula(f.alt, "formuller[" + i + "].alt", 160);
  const golge = (d) => "shadowcolor=black:shadowx=" + d + ":shadowy=" + d;
  if (ust) parcalar.push(Y.drawtext({ font: "kalin", metin: ust, dizin: metinDizin, ad: "ust" + i,
    boyut: Y.sigdir(ust, W - 220, 46), renk, x: "(w-text_w)/2", y: 330, ekstra: golge(3) }));
  if (ana) {
    const yer = anaYerlestir(ana);
    yer.satirlar.forEach((s, k) => parcalar.push(Y.drawtext({ font: "sembol", metin: s, dizin: metinDizin,
      ad: yer.satirlar.length === 1 ? "ana" + i : "ana" + i + "-" + k,
      boyut: yer.satirlar.length === 1 ? yer.punto : Y.sigdir(s, W - 220, yer.punto), renk: "white",
      x: "(w-text_w)/2", y: yer.y0 + k * yer.lh, ekstra: golge(yer.golge) })));
  }
  parcalar.push("drawbox=x=(iw-620)/2:y=630:w=620:h=4:color=" + renk + "@0.85:t=fill");
  if (alt) parcalar.push(Y.drawtext({ font: "normal", metin: alt, dizin: metinDizin, ad: "alt" + i,
    boyut: Y.sigdir(alt, W - 220, 42), renk: "0xC8D4DE", x: "(w-text_w)/2", y: 680 }));
  return parcalar.join(",");
}

async function ana(argv, secenek) {
  secenek = secenek || {};
  const { konum } = ortak.argumanCoz(argv, {});
  const is = konum[0];
  if (!is) throw new OrtakHata("arguman", "Kullanım: node formul-kart.js <is-adi>", { cikis: CIKIS.GIRDI });
  const dizin = ortak.isDizin(is);
  if (!fs.existsSync(dizin)) throw new OrtakHata("is_yok", "İş bulunamadı: " + is, { cikis: CIKIS.GIRDI });
  ortak.kilitAl(is, BETIK);
  try { return await uret(is, dizin, secenek); } finally { ortak.kilitBirak(is); }
}

async function uret(is, dizin, secenek) {
  const konu = ortak.konuEtkin(is);
  if (!konu) throw new OrtakHata("konu_yok", "konu.json yok: " + is, { cikis: CIKIS.GIRDI });
  const liste = Array.isArray(konu.formuller) ? konu.formuller : [];
  if (!liste.length) { console.log("konu.json içinde 'formuller' yok; formül kartı üretilmedi."); ortak.sonuc({ kart: 0 }); return { kart: 0 }; }

  const VIS = path.join(dizin, "Visuals");
  const ff = secenek.ffmpeg || require("./ff-yol").ffmpeg;
  const renk = KT.accent(konu);
  const bg = KT.arkaPlanBul(VIS, ["14-formuller"]);
  const gecici = KT.geciciDizin(is, "kart");
  let uretilen = 0;
  try {
    liste.forEach((f, i) => {
      const hedef = f.hedef !== undefined ? KT.adDogrula(f.hedef, "formuller[" + i + "].hedef") : "14-formuller";
      const n = f.n !== undefined ? KT.adDogrula(f.n, "formuller[" + i + "].n") : String(i + 1);
      const klasor = path.join(VIS, hedef);
      if (!ortak.yolIcinde(VIS, klasor)) throw new OrtakHata("konu_gecersiz", "formuller[" + i + "].hedef Visuals klasörünün dışına çıkıyor.", { cikis: CIKIS.GIRDI });
      if (f.hedef === undefined && i === 0)
        ortak.uyari("Formül kartlarına 'hedef' (sahne klasörü) verilmedi: kartlar Visuals/14-formuller'e yazılıyor; video kurulurken 14. sahneye (yoksa ondan önceki en yakın sahneye) eklenir. Tam yer için 'hedef' ver.");
      fs.mkdirSync(klasor, { recursive: true });
      const cikti = path.join(klasor, "90-formul-" + n + ".jpg");
      if (f.ana && typeof f.ana === "string" && anaYerlestir(f.ana).kesildi)
        ortak.uyari("formuller[" + i + "].ana kartın 4 satırına sığmadı, sonu kesildi. Formülü kısalt.");
      const dt = formulFiltresi(f, i, renk, gecici);
      if (bg) KT.karePng(ff, ["-i", bg], "scale=" + W + ":" + H + ":force_original_aspect_ratio=increase,crop=" + W + ":" + H +
        ",eq=brightness=-0.30:contrast=1.05,boxblur=10:1," + dt, cikti);
      else KT.karePng(ff, ["-f", "lavfi", "-i", "color=c=0x04060B:s=" + W + "x" + H], dt, cikti);
      uretilen++;
      ortak.ilerleme("kart", (i + 1) / liste.length * 100, { n: i + 1, toplam: liste.length });
    });
  } finally { KT.geciciTemizle(gecici); }

  console.log(uretilen + " formül kartı üretildi → Visuals/");
  ortak.sonuc({ kart: uretilen });
  return { kart: uretilen };
}

module.exports = { ana, formulFiltresi, anaYerlestir };

if (require.main === module) ana(process.argv.slice(2)).catch(ortak.bitir);
