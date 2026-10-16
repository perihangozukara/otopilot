// VIDEO KURUCU — gorseller + seslendirme + altyazi -> bitmis mp4
// Kademeli: 1) her gorsel -> klip  2) klipler -> gruplar (gecisli)  3) gruplar -> final (+altyazi+ses)
// Tamamen yerel ffmpeg. Kredi harcamaz.
//
// Kullanim: node video-yap.js <is-klasoru> [--yeniden] [--temiz] [--tut] [--onizleme[=SN]]
//   --yeniden     girdiler degismemis olsa da videoyu yeniden kur
//   --temiz       ara dosyalari (onbellek) en bastan sil ve videoyu SIFIRDAN kur (girdiler ayni olsa bile atlamaz)
//   --tut         basarida ara dosyalari (_tmp) silme
//   --onizleme    dusuk cozunurluklu kisa onizleme (varsayilan 25 sn): Videos/<is>-onizleme.mp4
//
// Asil is lib/render-*.js icinde (test edilebilir); burasi komut satiri kabugu.
"use strict";
const ortak = require("./lib/ortak");

async function main() {
  const { konum, bayrak } = ortak.argumanCoz(process.argv.slice(2), { deger: [] });
  const is = konum[0];
  if (!is)
    throw new ortak.OrtakHata("girdi", "Kullanım: node video-yap.js <iş-adı> [--yeniden] [--temiz] [--tut] [--onizleme[=sn]]", {
      cikis: ortak.CIKIS.GIRDI, cozum: "İş adı zorunlu (uretim/ altındaki klasör adı)." });
  const { render } = require("./lib/render-ana");
  await render(is, { yeniden: !!bayrak.yeniden, temiz: !!bayrak.temiz, tut: !!bayrak.tut, onizleme: bayrak.onizleme });
}

if (require.main === module) main().catch(ortak.bitir);
module.exports = { main };
