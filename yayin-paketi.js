// YAYIN PAKETI — aciklama, bolumler (chapters), atiflar, etiketler, uyum hatirlatmalari.
// Cikti (uretim/<is>/): YAYIN-PAKETI.md (insan icin), yayin.json (makine icin), bolumler.txt.
// Kullanim: node yayin-paketi.js <is>
// (video-yap.js bunu video sonunda kendisi de dener; basarisizsa videoyu bozmaz.)
"use strict";
const ortak = require("./lib/ortak");

async function main() {
  const { konum } = ortak.argumanCoz(process.argv.slice(2), { deger: [] });
  const is = konum[0];
  if (!is)
    throw new ortak.OrtakHata("girdi", "Kullanım: node yayin-paketi.js <iş-adı>", { cikis: ortak.CIKIS.GIRDI, cozum: "İş adı zorunlu (uretim/ altındaki klasör adı)." });
  // Olmayan isi KILITLEMEDEN once reddet: kilitAl klasoru kendisi actigi icin yazim hatali bir ad hayalet is klasoru
  // (ve "basarili" cikis) uretiyordu.
  if (!require("fs").existsSync(ortak.isDizin(is)))
    throw new ortak.OrtakHata("is_yok", "İş bulunamadı: " + is, { cikis: ortak.CIKIS.GIRDI, cozum: "İş adını kontrol et ya da panelden yeni iş oluştur." });
  ortak.kilitAl(is, "yayin-paketi");
  const { yayinPaketiUret } = require("./lib/render-yayin");
  const y = yayinPaketiUret(is);
  ortak.sonuc({ bolum: y.bolumler.length, atif: y.atiflar.length, etiket: y.etiketler.length, yayin: "yayin.json" });
}

if (require.main === module) main().catch(ortak.bitir);
module.exports = { main };
