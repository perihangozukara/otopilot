// AG GUVENLIGI — "bu adres yerel/ozel agda mi?" karari (SSRF savunmasi). Sifir bagimlilik.
// Kullanan: lib/gorsel-ag.js (gorsel indirme). video-indirici/server.js ayni algoritmanin KENDI kopyasini tasir
// (indirici otomasyon klasoru disina tek basina kopyalanabilsin diye); iki kopya testle ayni tabloya baglidir.
//
// Neden bu kadar ayrintili: eskiden yalniz 127/10/192.168/169.254/172.16-31 ve "localhost" bakiliyordu. Su biçimler gecerdi:
//   [::ffff:127.0.0.1] (IPv6'da gomulu IPv4), [::7f00:1], NAT64/6to4, "localhost." (sondaki nokta), tek etiketli adlar
//   (http://router/ -> arama son ekiyle yerel makine), 100.64/10 (CGNAT), 198.18/15, 192.0.0/24, coklu yayin/ayrilmis aralıklar.
// Alan adinin yerel adrese COZULMESI (localtest.me, 127.0.0.1.nip.io) ayrica adYerelCozuluyorMu ile denetlenir.
"use strict";
const dns = require("dns");

// IPv4 yerel / ozel / ayrilmis mi? (c = ucuncu bayt; yalniz /24'luk test aglari icin)
function ipv4Yerel(a, b, c) {
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

// IPv6 metnini 8 adet 16 bitlik sayiya cozer (:: kisaltmasi ve sondaki a.b.c.d dahil); gecersizse null
function ipv6Coz(s) {
  let a = s;
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (v4) {
    const n = v4.slice(1).map(Number);
    if (n.some(x => x > 255)) return null;
    a = a.slice(0, v4.index) + ((n[0] << 8) | n[1]).toString(16) + ":" + ((n[2] << 8) | n[3]).toString(16);
  }
  const i = a.indexOf("::");
  let parcalar;
  if (i >= 0) {
    if (a.indexOf("::", i + 1) >= 0) return null;
    const bas = a.slice(0, i) ? a.slice(0, i).split(":") : [];
    const son = a.slice(i + 2) ? a.slice(i + 2).split(":") : [];
    if (bas.length + son.length > 7) return null;
    parcalar = bas.concat(new Array(8 - bas.length - son.length).fill("0"), son);
  } else parcalar = a.split(":");
  if (parcalar.length !== 8 || parcalar.some(p => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parcalar.map(p => parseInt(p, 16));
}

// IPv6 yerel mi? IPv4'u icinde tasiyan bicimler (::ffff:a.b.c.d, NAT64, 6to4) gomulu IPv4'e gore karar verir
function ipv6Yerel(g) {
  const sifir = (...k) => k.every(i => g[i] === 0);
  const v4 = (ust, alt) => ipv4Yerel(ust >> 8, ust & 255, alt >> 8);
  if (sifir(0, 1, 2, 3, 4, 5, 6) && (g[7] === 0 || g[7] === 1)) return true;                  // :: ve ::1
  if (sifir(0, 1, 2, 3, 4) && g[5] === 0xffff) return v4(g[6], g[7]);                          // IPv4-eslemeli ::ffff:a.b.c.d
  if (sifir(0, 1, 2, 3, 4, 5)) return true;                                                    // IPv4-uyumlu ::a.b.c.d (kullanimdan kalkti)
  if (g[0] === 0x64 && g[1] === 0xff9b) return sifir(2, 3, 4, 5) ? v4(g[6], g[7]) : true;      // NAT64 64:ff9b::/96 (+ yerel kullanim /48)
  if (g[0] === 0x2002) return v4(g[1], g[2]);                                                  // 6to4
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true;                          // Teredo, dokumantasyon
  if (g[0] === 0x100 && sifir(1, 2, 3)) return true;                                           // 100::/64 (discard)
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00;
}

const YEREL_SONEKLER = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".intranet"];
// host: URL.hostname (IPv6 koseli olabilir) ya da ham ad/IP. Gecersiz/bos -> true (guvenli taraf).
function yerelAdresMi(h) {
  let a = String(h == null ? "" : h).trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (a.includes("%")) return true;                              // IPv6 bolge kimligi (fe80::1%eth0)
  a = a.replace(/\.+$/, "");                                     // 'localhost.' ve '127.0.0.1.' mutlak alan adlari ayni adrestir
  if (!a) return true;
  if (a.includes(":")) { const g = ipv6Coz(a); return g ? ipv6Yerel(g) : true; }
  // 127.1, 0x7f.1, 2130706433, 0177.0.0.1 gibi kisaltmali bicimleri URL cozucu tek bicime (a.b.c.d) indirir
  try { a = new URL("http://" + a + "/").hostname.replace(/\.+$/, ""); } catch (e) { return true; }
  if (a.startsWith("[")) { const g = ipv6Coz(a.slice(1, -1)); return g ? ipv6Yerel(g) : true; }
  if (a === "localhost" || YEREL_SONEKLER.some(s => a.endsWith(s))) return true;
  // tek etiketli ad (http://router/): isletim sisteminin arama son eki yerel agdaki bir makineye cozer
  if (!a.includes(".")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  return m ? ipv4Yerel(Number(m[1]), Number(m[2]), Number(m[3])) : false;
}

// "fake-ip" DNS modu (Clash, Surge, Shadowrocket... proxy/VPN uygulamalari): her alan adi 198.18.0.0/15'e cozulur ve baglanti
// proxy uzerinden gercek sunucuya gider. Cozulen adresin bu aralikta olmasi yerel aga gidildigini gostermez; engellenirse bu
// uygulamalari kullananda TUM gorsel/API istekleri "yerel ag adresine cozulen ad" diye reddedilirdi. Yalniz DNS'ten cozulen
// adreste yoksayilir; 198.18.x.x'in dogrudan IP olarak yazilmasi (yerelAdresMi) hala engellidir.
const fakeIpMi = adres => /^198\.(18|19)\.\d{1,3}\.\d{1,3}$/.test(String(adres || "").trim());

// Alan adi yerel bir adrese cozuluyor mu? Yalniz POZITIF sonuc engeller (cozumleme basarisizsa istegi yapan taraf kendi hatasini verir).
// 60 sn onbellek (cevrimdisi iken her istek beklemesin). Sinir: ad sonradan baska adrese cozulurse (DNS rebinding) yakalanmaz.
const ONBELLEK = new Map();
async function adYerelCozuluyorMu(host, secenek) {
  const cozucu = (secenek && secenek.dns) || dns.promises;
  const a = String(host || "").replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
  if (!a || a.includes(":") || /^[\d.]+$/.test(a)) return false;               // IP degeri: yerelAdresMi zaten baktı
  const e = ONBELLEK.get(a);
  if (e && Date.now() - e.t < 60000 && !(secenek && secenek.dns)) return e.yerel;
  let yerel = false, zaman = null;
  try {
    const adresler = await Promise.race([cozucu.lookup(a, { all: true }), new Promise((_, red) => { zaman = setTimeout(() => red(new Error("dns zaman aşımı")), 3000); })]);
    yerel = adresler.some(x => !fakeIpMi(x.address) && yerelAdresMi(x.address));
  } catch (err) { yerel = false; } finally { clearTimeout(zaman); }
  if (!(secenek && secenek.dns)) { if (ONBELLEK.size > 500) ONBELLEK.clear(); ONBELLEK.set(a, { t: Date.now(), yerel }); }
  return yerel;
}

module.exports = { yerelAdresMi, ipv4Yerel, ipv6Coz, ipv6Yerel, adYerelCozuluyorMu, fakeIpMi };
