// test/ses-edge-gercek-cocuk.js — GERCEK msedge-tts kutuphanesi + yerel ws sahte sunucu (test DEGIL, cocuk surec).
//
// ses-edge-gercek.test.js bunu ayri surecte calistirir: kutuphane iptal edilmis bir istege gec kare
// alirsa yakalanmamis istisna firlatir ve SUREC OLUR; bunu ayni surecte test etmek mumkun degil.
// Yalniz 127.0.0.1'e baglanir (Microsoft'a ag cagrisi YOK): MsEdgeTTS.getSynthUrl yerel adrese cevrilir.
//
// Kullanim: node ses-edge-gercek-cocuk.js <ilk-yanit-gecikmesi-ms> [zaman-asimi-ms]
//   Cikis 0 + "TAMAM" -> senaryo gecti ; baska -> cokme / dogrulama hatasi
"use strict";
const path = require("path");
const assert = require("node:assert/strict");
const { MsEdgeTTS } = require("msedge-tts");           // gercek kutuphane
// ws, msedge-tts'in KENDI bagimliligidir (package.json'a eklenmez): onun yanindan cozulur, ayni surum kullanilir.
const { WebSocketServer } = require(require.resolve("ws", { paths: [path.dirname(require.resolve("msedge-tts"))] }));
const edge = require("../lib/ses-motor-edge.js");

const GECIKME = Number(process.argv[2] || 1200);
const ZAMAN_ASIMI = Number(process.argv[3] || 400);

(async () => {
  const sunucu = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise(r => sunucu.on("listening", r));
  const port = sunucu.address().port;
  MsEdgeTTS.getSynthUrl = async () => "ws://127.0.0.1:" + port + "/";

  let istekNo = 0;
  sunucu.on("connection", ws => {
    ws.on("message", veri => {
      const m = veri.toString();
      const k = /X-RequestId:(\w+)/.exec(m);
      if (!m.includes("Path:ssml") || !k) return;
      const id = k[1], no = ++istekNo;
      setTimeout(() => {
        const yolla = (x, ikili) => { try { if (ws.readyState === 1) ws.send(x, { binary: !!ikili }); } catch (e) { /* istemci gitti */ } };
        const baslik = yol => "X-RequestId:" + id + "\r\nContent-Type:application/json; charset=utf-8\r\nPath:" + yol + "\r\n\r\n";
        yolla(baslik("turn.start") + "{}");
        yolla(baslik("audio.metadata") + JSON.stringify({ Metadata: [{ Type: "WordBoundary",
          Data: { Offset: 0, Duration: 3000000, text: { Text: "Merhaba", Length: 7, BoundaryType: "WordBoundary" } } }] }));
        yolla(Buffer.concat([Buffer.from("X-RequestId:" + id + "\r\nContent-Type:audio/mpeg\r\nX-StreamId:1\r\nPath:audio\r\n"),
                             Buffer.from("SAHTE-MP3-VERISI")]), true);
        yolla(baslik("turn.end") + "{}");
      }, no === 1 ? GECIKME : 20);
    });
  });

  const motor = edge.olustur({ ses: "tr-TR-AhmetNeural", hiz: "+0%" });

  // 1) ilk istek yavas: zaman asimi iptali. Sunucu SONRADAN kare yollar; kutuphane cokmemeli.
  const ac = new AbortController();
  const zaman = setTimeout(() => ac.abort(new Error("zaman aşımı (test)")), ZAMAN_ASIMI);
  let hata = null;
  try { await motor.sentez("Merhaba dünya", { sinyal: ac.signal }); } catch (e) { hata = e; }
  clearTimeout(zaman);
  assert.ok(hata, "zaman aşımında sentez reddedilmeli");
  assert.match(String(hata.message), /zaman aşımı/);

  await new Promise(r => setTimeout(r, GECIKME + 1200));    // sunucunun gec kareleri icin yeterli sure

  // 2) ayni motor, yeni baglantiyla normal calismali
  await motor.sifirla();
  const r = await motor.sentez("Merhaba", {});
  assert.equal(r.kelimeler.length, 1);
  assert.equal(r.kelimeler[0].w, "Merhaba");
  assert.ok(r.buf.length > 0);

  motor.kapat();
  sunucu.close();
  console.log("TAMAM");
  process.exit(0);
})().catch(e => { console.error("BASARISIZ: " + (e && e.stack || e)); process.exit(1); });
