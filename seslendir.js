// Seslendirme: senaryodan paragraf basina ses (mp3) + kelime/sure zamanlamasi uretir.
//
// Kullanim:
//   node seslendir.js <is> [ses] [hiz]            senaryoyu seslendir
//   node seslendir.js <is> --yeniden              guncel olsa bile bastan uret
//   node seslendir.js <is> --motor edge|azure|piper|otomatik
//   node seslendir.js --test <cikti.mp3> [--ses X] [--metin "..."] [--motor M]    5 sn ornek
//
// Ses, hiz, dil ve okunus konu.json'dan okunur; komut satiri onu ezer ("ses": "tr-TR-AhmetNeural",
// "sesHizi": "+7%", "dil": "tr", "okunus": {"GPU": "G P U"}, "sesMotoru": "otomatik").
// Motorlar: edge (varsayilan, ucretsiz, RESMI DEGIL), azure (resmi, anahtar ister), piper (yerel).
// "otomatik": Edge dener; paragraf dusurursa TUM is siradaki motorla bastan yapilir.
//
// Girdi : uretim/<is>/Voice/SESLENDIRME-TAM-METIN.txt
// Cikti : Voice/parts/NNN.mp3, Voice/kelimeler.json, Voice/zamanlama.json   (ayrinti: lib/ses-uret.js)
// Cikis : 0 basari/atlandi · 2 girdi/yapilandirma · 3 dis servis · 4 paragraf dustu · 5 disk · 6 kilit
//
// NOT: Bu arac yapay (sentetik) ses uretir. YouTube'da gercekci sentetik ses/gorsel varsa
// Studio'daki "degistirilmis/sentetik icerik" kutusunu isaretlemek gerekir.
"use strict";
const fs = require("fs");
const ortak = require("./lib/ortak.js");
const { seslendir, ornekUret } = require("./lib/ses-uret.js");

async function ana(argv) {
  const { konum, bayrak } = ortak.argumanCoz(argv, {
    deger: ["test", "ses", "metin", "motor", "hiz", "dil"], mantik: ["yeniden"],
  });

  // ---- 5 sn ornek ----
  if (bayrak.test !== undefined) {
    if (bayrak.test === true || !String(bayrak.test).trim())
      throw new ortak.OrtakHata("arguman", "--test için çıktı dosyası gerekli.", { cikis: 2, cozum: "Örnek: node seslendir.js --test ornek.mp3 --ses tr-TR-AhmetNeural" });
    const ayar = ortak.ayarOku();
    const r = await ornekUret({
      cikti: String(bayrak.test), ses: typeof bayrak.ses === "string" ? bayrak.ses : undefined,
      metin: typeof bayrak.metin === "string" ? bayrak.metin : undefined,
      motorSecimi: typeof bayrak.motor === "string" ? bayrak.motor : "otomatik",
      hiz: typeof bayrak.hiz === "string" ? bayrak.hiz : ayar.sesHizi,
      dil: typeof bayrak.dil === "string" ? bayrak.dil : undefined,
    });
    ortak.sonuc(r);
    return;
  }

  const is = konum[0];
  if (!is) throw new ortak.OrtakHata("arguman", "İş adı verilmedi.", { cikis: 2, cozum: "Kullanım: node seslendir.js <iş> [ses] [hız]" });
  const dizin = ortak.isDizin(is);                          // gecersiz ad -> OrtakHata (exit 2)
  if (!fs.existsSync(dizin))
    throw new ortak.OrtakHata("is_yok", "İş bulunamadı: " + is, { cikis: 2, cozum: "Önce panelden yeni iş aç (ya da node yeni-is.js)." });

  ortak.kilitAl(is, "seslendir");                           // ayni ise ikinci kosu: exit 6
  try {
    // konu.json bozuksa konuEtkin OrtakHata atar (exit 2); betik varsayilana DUSMEZ.
    const konu = ortak.konuEtkin(is);
    const ayar = ortak.ayarOku();
    const k = konu || { dil: ayar.dil, ses: ayar.ses, sesHizi: ayar.sesHizi, sesMotoru: "otomatik", okunus: {}, hedefSaniye: null, format: "long" };

    // komut satiri > konu.json. Komut satirindan FARKLI bir ses verilirse dil de o sesin onekinden cikar.
    const ses = typeof bayrak.ses === "string" ? bayrak.ses : (konum[1] || k.ses);
    const hiz = typeof bayrak.hiz === "string" ? bayrak.hiz : (konum[2] || k.sesHizi);
    let dil = k.dil;
    if (ses !== k.ses && /^[a-z]{2}[-_]/i.test(ses)) dil = ses.slice(0, 2).toLowerCase();
    if (typeof bayrak.dil === "string") dil = bayrak.dil;
    if (!/^[+-]\d{1,2}%$/.test(String(hiz)))
      throw new ortak.OrtakHata("hiz_gecersiz", "Ses hızı geçersiz: " + hiz, { cikis: 2, cozum: "+7% ya da -10% gibi yaz." });

    const r = await seslendir({
      dizin, ses, hiz, dil,
      motorSecimi: typeof bayrak.motor === "string" ? bayrak.motor : (k.sesMotoru || "otomatik"),
      okunus: k.okunus || {}, yeniden: !!bayrak.yeniden, hedefSn: k.hedefSaniye,
      teknikMaxSn: k.format && k.format !== "long" ? ortak.formatSiniri(k.format).teknikMaxSn : null,
    });
    if (r.atlandi) ortak.sonuc({ atlandi: true, neden: r.neden });
    else ortak.sonuc({ paragrafSayisi: r.paragrafSayisi, toplamSn: r.toplamSn, motor: r.motor, ses: r.ses,
                       hedefSn: r.hedefSn, sapmaYuzde: r.sapmaYuzde });
  } finally {
    ortak.kilitBirak(is);
  }
}

module.exports = { ana };

if (require.main === module) {
  require("./lib/ses-koruma.js").kur();       // yakalanmamis hata: ham yigin izi yerine Turkce tek satir
  ana(process.argv.slice(2)).then(() => {
    // Acik websocket kalirsa surec kapanmayabilir: temiz bitiste bir sure sonra zorla kapat.
    const t = setTimeout(() => process.exit(0), 1500);
    if (t.unref) t.unref();
  }).catch(ortak.bitir);
}
