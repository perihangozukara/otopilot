// lib/senaryo-claude-istemci.js — Claude API cagrilari icin ince sarmalayici.
//
// Hepsi tek yerden gecer: model secimi, akisli (stream) istek, zaman asimi, hata CEVIRISI
// (401/402-kredi/404-model/429/529 icin ayri Turkce mesaj) ve kullanim.json kaydi.
// Ag katmani ENJEKSIYONLA degistirilebilir: istemci = { messages: { stream(params, opt) } }.
// Testlerde sahte istemci ya da ANTHROPIC_BASE_URL ile yerel sahte sunucu kullanilir.
"use strict";
const ortak = require("./ortak");
const kullanim = require("./senaryo-kullanim");

const { OrtakHata, CIKIS } = ortak;

// output_config.effort bu model ailelerinde calisir; digerlerinde (ornegin haiku) 400 verir
const EFOR_DESTEKLI = /^claude-(?:opus-(?:4-[5-9]|[5-9])|sonnet-(?:4-6|[5-9])|fable|mythos)/;
const efortDestekler = model => EFOR_DESTEKLI.test(String(model || ""));

function sdkYukle() {
  let A;
  try { A = require("@anthropic-ai/sdk"); }
  catch (e) {
    throw new OrtakHata("bagimlilik_eksik", "Anthropic paketi (@anthropic-ai/sdk) kurulu değil.",
      { cikis: CIKIS.GIRDI, cozum: "Proje klasöründe 'npm install' çalıştır.", detay: e.message });
  }
  return A.default || A.Anthropic || A;
}

function claudeAnahtari() { return ortak.envOku("ANTHROPIC_API_KEY"); }

function istemciKur(anahtar, sec) {
  const s = sec || {};
  if (s.istemci) return s.istemci;
  const Anthropic = sdkYukle();
  return new Anthropic({ apiKey: anahtar, maxRetries: 2 });
}

// ---------------------------------------------------------------- hata cevirisi
const ozet = (e, n) => String((e && e.message) || e || "").replace(/\s+/g, " ").slice(0, n || 220);

function claudeHataCevir(e, model) {
  if (e instanceof OrtakHata) return e;
  const durum = e && e.status;
  const msg = ozet(e, 400);
  const ad = (e && e.name) || "";
  const d = { cikis: CIKIS.SERVIS, detay: msg };
  if (durum === 401)
    return new OrtakHata("claude_anahtar", "ANTHROPIC_API_KEY geçersiz (401).",
      Object.assign(d, { cozum: "Kaynaklar sekmesinden anahtarı yenile (console.anthropic.com/settings/keys)." }));
  if (durum === 402 || /credit balance|insufficient (?:credit|funds)|billing/i.test(msg))
    return new OrtakHata("claude_kredi", "Anthropic hesabında kredi bitti.",
      Object.assign(d, { cozum: "console.anthropic.com > Plans & Billing'den kredi yükle ya da vidIQ ile senaryo yaz." }));
  if (durum === 403)
    return new OrtakHata("claude_izin", "Anthropic bu isteğe izin vermedi (403): anahtarın bu modeli kullanma yetkisi olmayabilir.",
      Object.assign(d, { cozum: "Anahtarın yetkilerini ve ANTHROPIC_MODEL ayarını kontrol et." }));
  if (durum === 404)
    return new OrtakHata("claude_model", "Claude modeli bulunamadı: " + (model || "?") + ".",
      Object.assign(d, { cozum: "Kaynaklar sekmesinde ANTHROPIC_MODEL ayarını düzelt (örn. claude-opus-5) ya da boş bırak." }));
  if (durum === 429)
    return new OrtakHata("claude_limit", "Claude istek sınırına takıldı (429).",
      Object.assign(d, { cozum: "Birkaç dakika bekleyip tekrar dene." }));
  if (durum === 529 || durum === 503 || (durum >= 500 && durum < 600))
    return new OrtakHata("claude_yogun", "Claude şu an aşırı yüklü ya da yanıt vermiyor (" + durum + ").",
      Object.assign(d, { cozum: "Birkaç dakika sonra tekrar dene; sürerse vidIQ ile senaryo yaz." }));
  if (durum === 400)
    return new OrtakHata("claude_istek", "Claude isteği reddetti (400): " + ozet(e, 160),
      Object.assign(d, { cozum: "ANTHROPIC_MODEL ayarını ve konu metnini kontrol et." }));
  if (ad === "APIConnectionTimeoutError" || (e && e.zamanAsimi))
    return new OrtakHata("claude_zaman_asimi", "Claude yanıt vermedi (zaman aşımı).",
      Object.assign(d, { cozum: "İnternet bağlantını kontrol edip tekrar dene." }));
  if (ad === "APIConnectionError" || (e && ortak.hataCevir(e).kod === "internet_yok"))
    return new OrtakHata("claude_ag", "Anthropic'e ulaşılamadı. İnternet bağlantını kontrol et.",
      Object.assign(d, { cozum: "Bağlantı geri gelince tekrar dene." }));
  return new OrtakHata("claude_hata", "Claude çağrısı başarısız oldu: " + ozet(e, 160), { cikis: CIKIS.GENEL, detay: msg });
}

// ---------------------------------------------------------------- ana cagri
// o: {is, betik, anahtar, istemci?, model, sistem, istek, maksToken, effort, onMetin, zamanAsimiMs, not}
// Donus: {metin, durum, giris, cikis, usd, kesik}
async function claudeIste(o) {
  const model = o.model || kullanim.modelSec();
  const params = {
    model, max_tokens: o.maksToken || 16000,
    system: o.sistem, messages: [{ role: "user", content: o.istek }],
  };
  if (o.effort && efortDestekler(model)) params.output_config = { effort: o.effort };

  const ist = istemciKur(o.anahtar || claudeAnahtari(), o);
  const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
  let zamanAsti = false;
  const sure = o.zamanAsimiMs > 0 ? o.zamanAsimiMs : 10 * 60 * 1000;
  let zamanlayici = null;
  // SDK abort sinyaline uyar; uymayan (sahte/eski) istemcide de asili kalmasin diye Promise.race
  const zamanAsimiSozu = new Promise((coz, red) => {
    zamanlayici = setTimeout(() => { zamanAsti = true; if (ac) ac.abort(); red(new Error("zaman aşımı")); }, sure);
  });
  let sonuc;
  try {
    const akis = ist.messages.stream(params, ac ? { signal: ac.signal } : undefined);
    if (o.onMetin && typeof akis.on === "function") akis.on("text", t => o.onMetin(t));
    sonuc = await Promise.race([akis.finalMessage(), zamanAsimiSozu]);
  } catch (e) {
    if (zamanAsti) e = Object.assign(new Error("zaman aşımı"), { zamanAsimi: true });
    throw claudeHataCevir(e, model);
  } finally { clearTimeout(zamanlayici); }

  const bloklar = Array.isArray(sonuc && sonuc.content) ? sonuc.content : [];
  const metin = bloklar.filter(b => b && b.type === "text").map(b => b.text || "").join("");
  const u = (sonuc && sonuc.usage) || {};
  const yeniGiris = u.input_tokens || 0, yazma = u.cache_creation_input_tokens || 0, okuma = u.cache_read_input_tokens || 0;
  const giris = yeniGiris + yazma + okuma;
  const cikis = u.output_tokens || 0;
  const usd = Math.round(kullanim.usdHesapla(model, yeniGiris, cikis, { yazma, okuma }) * 1e6) / 1e6;
  if (o.is) {
    try {
      kullanim.kullanimEkle(o.is, { betik: o.betik || "", saglayici: "anthropic", model, giris, cikis, kredi: 0, usd, not: o.not || "" });
    } catch (e) { /* kayit yazilamadiysa isi bozma; bos disk zaten baska yerde yakalanir */ }
  }
  if (sonuc && sonuc.stop_reason === "refusal")
    throw new OrtakHata("claude_ret", "Claude bu konuyu reddetti.", { cikis: CIKIS.YETERSIZ,
      cozum: "Konuyu farklı ifade edip tekrar dene ya da vidIQ ile yaz.",
      detay: sonuc.stop_details || null });
  return { metin, durum: (sonuc && sonuc.stop_reason) || "", giris, cikis, usd, kesik: !!(sonuc && sonuc.stop_reason === "max_tokens"), model };
}

// ucretsiz anahtar testi: modeller listesi (token harcamaz). Asla firlatmaz.
async function anahtarTest(anahtar, sec) {
  if (!anahtar) return { ok: false, mesaj: "anahtar girilmemiş" };
  try {
    const ist = istemciKur(anahtar, sec);
    if (!ist.models || typeof ist.models.list !== "function") return { ok: false, mesaj: "SDK modeller listesini desteklemiyor" };
    await ist.models.list({ limit: 1 });
    return { ok: true, mesaj: "çalışıyor — Claude hazır (model: " + kullanim.modelSec() + ")" };
  } catch (e) {
    const c = claudeHataCevir(e, kullanim.modelSec());
    return { ok: false, mesaj: c.message };
  }
}

module.exports = { efortDestekler, istemciKur, claudeAnahtari, claudeHataCevir, claudeIste, anahtarTest };
