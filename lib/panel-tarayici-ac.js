// Panel sunucusu gercekten cevap verince tarayiciyi BIR KEZ acar (PANEL.bat kullanir).
// Eskiden "start /b node panel.js" + 3 sn bekleme vardi: sunucu gec acilirsa kullanici "baglanamadi" goruyordu.
// Kullanim: node lib/panel-tarayici-ac.js <port>
"use strict";
const http = require("http");
const { spawn } = require("child_process");

const port = Number(process.argv[2]) || 4173;
const url = "http://localhost:" + port;
const bas = Date.now();

function dene() {
  const r = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1500 }, res => {
    res.resume();
    if (res.statusCode === 200) return ac();
    sonraki();
  });
  r.on("timeout", () => { r.destroy(); sonraki(); });
  r.on("error", sonraki);
}
function sonraki() {
  if (Date.now() - bas > 60000) process.exit(1);          // panel acilmadi: sessizce vazgec, PANEL.bat zaten hatayi gosterir
  setTimeout(dene, 400);
}
function ac() {
  let komut, arg;
  if (process.platform === "win32") { komut = "cmd.exe"; arg = ["/c", "start", "", url]; }
  else if (process.platform === "darwin") { komut = "open"; arg = [url]; }
  else { komut = "xdg-open"; arg = [url]; }
  try {
    const p = spawn(komut, arg, { detached: true, stdio: "ignore", windowsHide: true });
    p.on("error", () => process.exit(0));
    p.unref();
  } catch (e) { /* tarayici acilamadiysa kullanici adresi elle acar */ }
  setTimeout(() => process.exit(0), 500);
}
dene();
