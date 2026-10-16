// lib/render-altyazi.js testleri: cumle sonu (kisaltmalar), parcalama, kelime zamanlari, en az 0.6 sn, sayi uyusmazligi.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const fik = require("./render-fikstur");
const kok = fik.ortamKur();
const AY = require("../lib/render-altyazi");

test.after(() => fik.temizle(kok));

test("cumleSonuMu: Dr./U.S./J. kisaltmalari cumle sonu degil, gercek cumle sonu evet", () => {
  for (const k of ["Dr.", "Mr.", "Mrs.", "Prof.", "St.", "vs.", "etc.", "e.g.", "i.e.", "U.S.", "U.K.", "No.", "Jr.", "Sr.", "Inc.", "Ltd.", "J."])
    assert.equal(AY.cumleSonuMu(k, "en"), false, k);
  for (const k of ["moved.", "why?", "wow!", "end.\"", "end.)", "done…"])
    assert.equal(AY.cumleSonuMu(k, "en"), true, k);
  for (const k of ["Dr.", "Prof.", "Doç.", "vb.", "vs.", "bkz."]) assert.equal(AY.cumleSonuMu(k, "tr"), false, k);
  assert.equal(AY.cumleSonuMu("3.", "tr"), false);       // sira sayisi
  assert.equal(AY.cumleSonuMu("1923.", "en"), true);
  assert.equal(AY.cumleSonuMu("bitti.", "tr"), true);
});

test("parcala (yatay): her parca <= 42 karakter, cumle sonunda biter, Dr. ortada bolunmez", () => {
  const w = "Dr. Smith explained the idea in plain words, and nobody in the room moved. Then he left the building quickly.".split(" ");
  const r = AY.parcala(w, { stil: "cumle", dil: "en" });
  const metinler = r.map(x => w.slice(x.bas, x.son + 1).join(" "));
  for (const m of metinler) assert.ok(m.length <= 42, m);
  assert.ok(!metinler.some(m => m.endsWith("Dr.")), "Dr. cumle sonu sayildi: " + JSON.stringify(metinler));
  assert.ok(metinler.some(m => m.endsWith("moved.")));
  assert.equal(metinler.join(" "), w.join(" "));
});

test("parcala (dikey): 2-4 kelime, tek kelime artmaz, cumle sonunda biter", () => {
  const w = "The first paragraph opens the story with a strong hook and a clear promise today.".split(" ");
  const r = AY.parcala(w, { stil: "kelime", dil: "en" });
  const say = r.map(x => x.son - x.bas + 1);
  for (const s of say) assert.ok(s >= 1 && s <= 4, JSON.stringify(say));
  assert.ok(say.filter(s => s === 1).length === 0, "tek kelimelik parca: " + JSON.stringify(say));
  assert.equal(r.map(x => w.slice(x.bas, x.son + 1).join(" ")).join(" "), w.join(" "));
});

function sahteSes(sureler, bosluk, kelimeSayilari) {
  const baslangic = []; let t = 0;
  sureler.forEach((s, i) => { baslangic.push(t); t += s + bosluk; });
  const kel = sureler.map((s, i) => ({ no: i, kelimeler: Array.from({ length: kelimeSayilari[i] }, (_, j) => ({ t: Math.round(j * s * 1000 / kelimeSayilari[i]), d: 100, w: "w" + j })) }));
  return { N: sureler.length, baslangic, sure: sureler, kelimeler: kel };
}

test("altyaziKur: kelime zamanindan kurulur, bodyStart eklenir, en az 0.6 sn, ust uste binmez", () => {
  const paras = ["One two three four five six seven eight nine ten.", "Hi."];
  const ses = sahteSes([5.0, 0.4], 0.35, [10, 1]);
  const cues = AY.altyaziKur(paras, ses, 7.6, { stil: "cumle", dil: "en" });
  assert.ok(cues.length >= 2);
  assert.ok(Math.abs(cues[0].bas - 7.6) < 0.001, "ilk satir bodyStart'ta baslamali: " + cues[0].bas);
  for (const c of cues) assert.ok(c.son - c.bas >= 0.59, "cok kisa satir: " + JSON.stringify(c));
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].bas >= cues[i - 1].son - 1e-6, "ust uste biniyor: " + i);
  // ikinci paragraf ('Hi.' 0.4 sn) en az 0.6 sn gorunur
  const son = cues[cues.length - 1];
  assert.equal(son.metin, "Hi.");
  assert.ok(son.son - son.bas >= 0.59);
});

test("altyaziKur: okunan kelime sayisi farkliysa (okunus sozlugu) orantili eslenir; zaman yoksa karakter orani", () => {
  const paras = ["Alpha beta gamma delta epsilon zeta eta theta iota kappa."];
  // okunan metinde 20 kelime var (2x): ozgun kelime j -> okunan 2j
  const ses = sahteSes([10.0], 0.35, [20]);
  const cues = AY.altyaziKur(paras, ses, 0, { stil: "cumle", dil: "en" });
  assert.ok(cues.length >= 2);
  // ikinci parcanin baslangici ~ ozgun kelime 6'nin orantili zamani (okunan 12. kelime = 6.0 sn)
  const ikinci = cues[1];
  assert.ok(ikinci.bas > 4 && ikinci.bas < 8, "ikinci parca zamani " + ikinci.bas);
  const zamansiz = { N: 1, baslangic: [0], sure: [10], kelimeler: null };
  const c2 = AY.altyaziKur(paras, zamansiz, 0, { stil: "cumle", dil: "en" });
  assert.ok(c2.length >= 2 && c2[0].bas === 0 && c2[c2.length - 1].son <= 10.0001);
});

test("srtMetni: SRT bicimi (numara, zaman, metin)", () => {
  const s = AY.srtMetni([{ bas: 1.1, son: 3.6094, metin: "Merhaba" }, { bas: 3.7, son: 5, metin: "Dünya" }]);
  assert.match(s, /^1\n00:00:01,100 --> 00:00:03,609\nMerhaba\n\n2\n00:00:03,700 --> 00:00:05,000\nDünya\n$/);
  assert.equal(AY.srtZaman(3725.5), "01:02:05,500");
});

test("altyaziMetni: ALTYAZI-XX.txt paragraf sayisi farkliysa cikis 4 (sessiz kayma yok)", () => {
  const d = path.join(kok, "aty"); fs.mkdirSync(path.join(d, "Voice"), { recursive: true });
  fs.writeFileSync(path.join(d, "Voice", "ALTYAZI-TR.txt"), "Bir\n\nİki\n");
  const kanon = ["one", "two", "three"];
  assert.throws(() => AY.altyaziMetni({ is: "aty", dizin: d, dil: "en", altyaziDili: "tr" }, kanon),
    e => e.kod === "altyazi_sayi" && e.cikis === 4);
  fs.writeFileSync(path.join(d, "Voice", "ALTYAZI-TR.txt"), "Bir\n\nİki\n\nÜç\n");
  const r = AY.altyaziMetni({ is: "aty", dizin: d, dil: "en", altyaziDili: "tr" }, kanon);
  assert.deepEqual(r.paragraflar, ["Bir", "İki", "Üç"]);
  // dosya yoksa (altyaziDili != dil) cikis 2
  fs.rmSync(path.join(d, "Voice", "ALTYAZI-TR.txt"));
  assert.throws(() => AY.altyaziMetni({ is: "aty", dizin: d, dil: "en", altyaziDili: "tr" }, kanon), e => e.kod === "altyazi_yok" && e.cikis === 2);
  // altyaziDili == dil -> seslendirme metni
  assert.deepEqual(AY.altyaziMetni({ is: "aty", dizin: d, dil: "en", altyaziDili: "en" }, kanon).paragraflar, kanon);
});
