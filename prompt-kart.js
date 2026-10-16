// Prompt / komut / skill kartlari — koyu terminal estetiginde, videoya gomulecek gorseller.
// Tamamen yerel, bedava. Kullanim: node prompt-kart.js <is-klasoru>
//
// Kartlar konu.json > "promptlar" listesinden uretilir (senaryo motorlari bu listeyi URETMEZ; elle tanimlanir):
//   "promptlar": [{ "baslik": "claude — terminal", "satirlar": ["$ claude", "> merhaba", "# yorum"], "alt": "kisa etiket", "hedef": "005-demo" }]
//   satir onekleri:  "$ " komut (yesil)   "#" yorum (gri)   ">" cikti (sari)   "[" etiket (vurgu rengi)
//   hedef            kartin konacagi SAHNE klasoru (Visuals/<hedef>); verilmezse Visuals/90-promptlar
// Uzun satirlar pencere genisligine gore SARILIR; cok satir olursa punto kucultulur; yine sigmazsa kesilir ("...").
// Metin lib/yazi.js ile yazilir (textfile): ' : % \ karakterleri sorun cikarmaz, font platforma gore secilir.
//
// Cikis kodlari: 0 tamam | 1 ffmpeg hatasi | 2 girdi (is yok, konu.json bozuk) | 6 kilit
"use strict";
const fs = require("fs");
const path = require("path");
const ortak = require("./lib/ortak");
const Y = require("./lib/yazi");
const KT = require("./lib/senaryo-kart");

const { OrtakHata, CIKIS } = ortak;
const BETIK = "prompt-kart.js";
const W = 1920, H = 1080;
const PAD = 130;                 // pencere kenar boslugu
const WIN_Y = 180, WIN_H = 760, BAR_H = 62;
const METIN_X = PAD + 56;
const GENISLIK = W - 2 * PAD - 112;     // satir icin kullanilabilir piksel
const KARE_ORANI = 0.6;                 // tek aralikli fontlarin ortalama karakter genisligi / punto (guvenli ust deger)

// Satirlari pencereye gore yerlestirir: once 32 punto, sigmazsa 28, o da yetmezse keser.
// Donus: {punto, lh, satirlar:[{metin, tip}]} ; tip: komut|yorum|cikti|etiket|normal
function yerlestir(satirlar) {
  const tipi = ln => /^\$ /.test(ln) ? "komut" : /^#/.test(ln) ? "yorum" : /^>/.test(ln) ? "cikti" : /^\[/.test(ln) ? "etiket" : "normal";
  const dene = (punto, lh) => {
    const maksKar = Math.floor(GENISLIK / (punto * KARE_ORANI));
    const maksSatir = Math.floor((WIN_H - BAR_H - 46 - 36) / lh);
    const cikti = [];
    for (const ln of satirlar) {
      const tip = tipi(ln);
      if (!String(ln).trim()) { cikti.push({ metin: "", tip }); continue; }
      satirlarla(String(ln), maksKar).forEach((parca, k) => cikti.push({ metin: k ? "  " + parca : parca, tip }));
    }
    return { punto, lh, maksSatir, satirlar: cikti };
  };
  let d = dene(32, 46);
  if (d.satirlar.length > d.maksSatir) d = dene(28, 40);
  d.kesildi = false;
  if (d.satirlar.length > d.maksSatir) {
    d.satirlar = d.satirlar.slice(0, d.maksSatir);
    d.satirlar[d.maksSatir - 1] = { metin: "...", tip: "yorum" };
    d.kesildi = true;
  }
  return d;
}
// Satir sarma: bastaki "$ " / "> " oneki korunur, bosluklar normallestirilmez (kod girintisi bozulmasin)
function satirlarla(ln, maks) {
  if (Array.from(ln).length <= maks) return [ln];
  const onek = (ln.match(/^(?:\$ |> |# )/) || [""])[0];
  const parcalar = Y.satirla(ln.slice(onek.length), maks - onek.length);
  return parcalar.map((p, k) => (k === 0 ? onek : " ".repeat(onek.length)) + p);
}

const RENK = { komut: "0x7CE38B", yorum: "0x6E7B8B", cikti: "0xFFD479", normal: "0xE6EDF3" };

// Tek kartin filtre zinciri
function kartFiltresi(p, i, vurgu, metinDizin) {
  const baslik = KT.metinDogrula(p.baslik, "promptlar[" + i + "].baslik", 160);
  const alt = KT.metinDogrula(p.alt, "promptlar[" + i + "].alt", 160);
  const satirlar = Array.isArray(p.satirlar) ? p.satirlar : [];
  satirlar.forEach((s, k) => KT.metinDogrula(s, "promptlar[" + i + "].satirlar[" + k + "]", 400));
  const yer = yerlestir(satirlar);
  const startY = WIN_Y + BAR_H + 46;
  const f = [];
  // pencere govdesi + baslik cubugu + alt cizgi
  f.push("drawbox=x=" + PAD + ":y=" + WIN_Y + ":w=" + (W - 2 * PAD) + ":h=" + WIN_H + ":color=0x0B1017@0.94:t=fill");
  f.push("drawbox=x=" + PAD + ":y=" + WIN_Y + ":w=" + (W - 2 * PAD) + ":h=" + BAR_H + ":color=0x161D28@1.0:t=fill");
  f.push("drawbox=x=" + PAD + ":y=" + (WIN_Y + WIN_H - 3) + ":w=" + (W - 2 * PAD) + ":h=3:color=" + vurgu + "@0.9:t=fill");
  // pencere noktalari
  ["0xFF5F57", "0xFEBC2E", "0x28C840"].forEach((c, k) =>
    f.push("drawbox=x=" + (PAD + 34 + k * 30) + ":y=" + (WIN_Y + BAR_H / 2 - 7) + ":w=14:h=14:color=" + c + "@0.9:t=fill"));
  // baslik cubugu metni
  if (baslik) f.push(Y.drawtext({ font: "mono-kalin", metin: baslik, dizin: metinDizin, ad: "baslik" + i,
    boyut: Y.sigdir(baslik, W - 2 * PAD - 180, 30, KARE_ORANI), renk: "0x9FE6FF", x: PAD + 140, y: WIN_Y + BAR_H / 2 - 16 }));
  // satirlar
  yer.satirlar.forEach((s, k) => {
    if (!s.metin) return;
    const kalin = s.tip === "komut" || s.tip === "etiket";
    f.push(Y.drawtext({ font: kalin ? "mono-kalin" : "mono", metin: s.metin, dizin: metinDizin, ad: "s" + i + "-" + k,
      boyut: yer.punto, renk: s.tip === "etiket" ? vurgu : RENK[s.tip] || RENK.normal, x: METIN_X, y: startY + k * yer.lh }));
  });
  // alt etiket
  if (alt) f.push(Y.drawtext({ font: "kalin", metin: alt, dizin: metinDizin, ad: "alt" + i,
    boyut: Y.sigdir(alt, W - 200, 30), renk: "0x8A97A6", x: "(w-text_w)/2", y: WIN_Y + WIN_H + 34 }));
  return { filtre: f.join(","), kesildi: yer.kesildi };
}

async function ana(argv, secenek) {
  secenek = secenek || {};
  const { konum } = ortak.argumanCoz(argv, {});
  const is = konum[0];
  if (!is) throw new OrtakHata("arguman", "Kullanım: node prompt-kart.js <is-adi>", { cikis: CIKIS.GIRDI });
  const dizin = ortak.isDizin(is);
  if (!fs.existsSync(dizin)) throw new OrtakHata("is_yok", "İş bulunamadı: " + is, { cikis: CIKIS.GIRDI });
  ortak.kilitAl(is, BETIK);
  try { return await uret(is, dizin, secenek); } finally { ortak.kilitBirak(is); }
}

async function uret(is, dizin, secenek) {
  const konu = ortak.konuEtkin(is);
  if (!konu) throw new OrtakHata("konu_yok", "konu.json yok: " + is, { cikis: CIKIS.GIRDI });
  const liste = Array.isArray(konu.promptlar) ? konu.promptlar : [];
  if (!liste.length) { console.log("konu.json içinde 'promptlar' yok; prompt kartı üretilmedi."); ortak.sonuc({ kart: 0 }); return { kart: 0 }; }

  const VIS = path.join(dizin, "Visuals");
  const ff = secenek.ffmpeg || require("./ff-yol").ffmpeg;
  const vurgu = KT.accent(konu);
  const gecici = KT.geciciDizin(is, "kart");
  let uretilen = 0;
  try {
    liste.forEach((p, i) => {
      const hedef = p.hedef !== undefined ? KT.adDogrula(p.hedef, "promptlar[" + i + "].hedef") : "90-promptlar";
      const klasor = path.join(VIS, hedef);
      if (!ortak.yolIcinde(VIS, klasor)) throw new OrtakHata("konu_gecersiz", "promptlar[" + i + "].hedef Visuals klasörünün dışına çıkıyor.", { cikis: CIKIS.GIRDI });
      if (p.hedef === undefined && i === 0)
        ortak.uyari("Prompt kartlarına 'hedef' (sahne klasörü) verilmedi: kartlar Visuals/90-promptlar'a yazılıyor; video kurulurken en son sahneye eklenir. Tam yer için 'hedef' ver.");
      fs.mkdirSync(klasor, { recursive: true });
      const cikti = path.join(klasor, "95-prompt-" + String(i + 1).padStart(2, "0") + ".jpg");
      const k = kartFiltresi(p, i, vurgu, gecici);
      if (k.kesildi) ortak.uyari("promptlar[" + i + "]: satırlar pencereye sığmadı, sonu kesildi.");
      KT.karePng(ff, ["-f", "lavfi", "-i", "color=c=0x04060B:s=" + W + "x" + H], "format=rgb24," + k.filtre, cikti);
      uretilen++;
      ortak.ilerleme("kart", (i + 1) / liste.length * 100, { n: i + 1, toplam: liste.length });
    });
  } finally { KT.geciciTemizle(gecici); }

  console.log(uretilen + " prompt kartı üretildi → Visuals/");
  ortak.sonuc({ kart: uretilen });
  return { kart: uretilen };
}

module.exports = { ana, yerlestir, kartFiltresi };

if (require.main === module) ana(process.argv.slice(2)).catch(ortak.bitir);
