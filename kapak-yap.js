// KAPAK (thumbnail) URETICI — en iyi gorsel + buyuk, konturlu baslik -> Videos/<is>-kapak.jpg
// Yatay 1280x720, dikey 1080x1920; en cok 2 MB. Baslik konu.json'daki baslik_en'dir.
// Kullanim: node kapak-yap.js <is>
// (video-yap.js bunu video sonunda kendisi de dener; basarisizsa videoyu bozmaz.)
"use strict";
const ortak = require("./lib/ortak");

async function main() {
  const { konum } = ortak.argumanCoz(process.argv.slice(2), { deger: [] });
  const is = konum[0];
  if (!is)
    throw new ortak.OrtakHata("girdi", "Kullanım: node kapak-yap.js <iş-adı>", { cikis: ortak.CIKIS.GIRDI, cozum: "İş adı zorunlu (uretim/ altındaki klasör adı)." });
  // Olmayan isi KILITLEMEDEN once reddet: kilitAl klasoru kendisi actigi icin yazim hatali bir ad hayalet is klasoru
  // (ve "basarili" cikis) uretiyordu.
  if (!require("fs").existsSync(ortak.isDizin(is)))
    throw new ortak.OrtakHata("is_yok", "İş bulunamadı: " + is, { cikis: ortak.CIKIS.GIRDI, cozum: "İş adını kontrol et ya da panelden yeni iş oluştur." });
  ortak.kilitAl(is, "kapak-yap");
  const { kapakUret } = require("./lib/render-kapak");
  const yol = await kapakUret(is);
  ortak.sonuc({ kapak: yol });
}

if (require.main === module) main().catch(ortak.bitir);
module.exports = { main };
