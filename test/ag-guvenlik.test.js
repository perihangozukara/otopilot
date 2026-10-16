// Guvenlik saldiri turu (2026-10-06): lib/ag-guvenlik.js — SSRF "yerel adres mi?" karari ve gorsel indirmeye baglanmasi.
// video-indirici/server.js ayni algoritmanin kopyasini tasir; iki kopya ayni tabloyu vermeli.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const ag = require("../lib/ag-guvenlik");
const gorselAg = require("../lib/gorsel-ag");

const YEREL = [
  "localhost", "LOCALHOST", "localhost.", "foo.localhost", "foo.localhost.", "127.0.0.1", "127.0.0.1.", "127.1", "0x7f000001", "0177.0.0.1", "2130706433", "0.0.0.0", "0",
  "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "198.18.0.1", "192.0.0.1", "192.0.2.1", "224.0.0.1", "255.255.255.255",
  "::", "::1", "[::1]", "::ffff:127.0.0.1", "[::ffff:7f00:1]", "[::ffff:a9fe:a9fe]", "[::ffff:10.0.0.1]", "::127.0.0.1", "::7f00:1", "[64:ff9b::7f00:1]", "[2002:7f00:1::]", "fe80::1", "fe80::1%eth0", "fd00::1", "fc00::1", "ff02::1", "2001:db8::1",
  "foo.local", "foo.local.", "db.internal", "metadata.google.internal.", "nas.lan", "x.home.arpa", "router", "intranet", "", "   ", "bozuk host adi",
];
const GENEL = ["pexels.com", "commons.wikimedia.org", "upload.wikimedia.org", "8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1", "198.17.0.1", "198.20.0.1", "192.0.1.1",
  "[2606:4700:4700::1111]", "2a00:1450:4001::200e", "::ffff:8.8.8.8", "xn--bcher-kva.example"];

test("yerelAdresMi: yerel/ozel/ayrilmis her biçim yakalanir, herkese acik adresler gecer", () => {
  for (const h of YEREL) assert.equal(ag.yerelAdresMi(h), true, JSON.stringify(h));
  for (const h of GENEL) assert.equal(ag.yerelAdresMi(h), false, h);
  assert.equal(ag.yerelAdresMi(null), true); assert.equal(ag.yerelAdresMi(undefined), true);
});

test("adYerelCozuluyorMu: yerel adrese cozulen ad engellenir; cozulemezse/acikca cozulurse engellenmez", async () => {
  const sahte = { lookup: async ad => { if (ad === "yerel.ornek") return [{ address: "127.0.0.1", family: 4 }]; if (ad === "karisik.ornek") return [{ address: "8.8.8.8", family: 4 }, { address: "::ffff:10.0.0.1", family: 6 }]; if (ad === "acik.ornek") return [{ address: "93.184.216.34", family: 4 }]; throw new Error("ENOTFOUND"); } };
  assert.equal(await ag.adYerelCozuluyorMu("yerel.ornek", { dns: sahte }), true);
  assert.equal(await ag.adYerelCozuluyorMu("karisik.ornek", { dns: sahte }), true);
  assert.equal(await ag.adYerelCozuluyorMu("acik.ornek", { dns: sahte }), false);
  assert.equal(await ag.adYerelCozuluyorMu("yok.ornek", { dns: sahte }), false);
  assert.equal(await ag.adYerelCozuluyorMu("8.8.8.8", { dns: sahte }), false, "IP degeri DNS'e gitmez");
  assert.equal(await ag.adYerelCozuluyorMu("[::1]", { dns: sahte }), false, "IP degeri DNS'e gitmez");
});

test("gorsel-ag.tekIstek: IPv6'da gomulu IPv4, sondaki nokta, tek etiketli ad ve CGNAT 'yerel_adres' ile reddedilir (ag cagrisi yapilmaz)", async () => {
  for (const u of ["http://[::ffff:127.0.0.1]:4399/x", "http://[::7f00:1]/x", "http://localhost./x", "http://router/x", "http://100.64.0.1/x", "http://[64:ff9b::7f00:1]/x", "http://127.1/x", "http://169.254.169.254/latest"])
    await assert.rejects(() => gorselAg.tekIstek(u, {}, 0), e => e.kod === "yerel_adres", u);
  await assert.rejects(() => gorselAg.tekIstek("ftp://example.test/x", {}, 0), e => e.kod === "adres");
});
