// lib/senaryo-prompt.js — Claude icin istem (prompt) uretici. vidIQ yolu da brief'ini buradan kurar.
//
// Istemler Ingilizce yazilir (modelden en iyi verimi veren dil); CIKTI dili `dil` ile belirlenir.
// Kural: dogruluk (kaynak bagimli, emin olmadigini yuvarla/cekimser soyle), tur sablonu
// (belgesel/reklam/haber-spor/egitim/hikaye/tanitim), kanal sesi, sahibin kisisel bakisi,
// uzun videoda 60-90 sn'de yeniden-kanca, dikey videoda ilk 2 sn kancasi.
"use strict";
const S = require("./senaryo-ortak");

const TUR_AD = {
  belgesel: "documentary and explainer", reklam: "promotional ad", "haber-spor": "news and sports",
  egitim: "educational", hikaye: "storytelling", tanitim: "product, place or service introduction",
};

const TUR_YAPI = {
  belgesel: "origins and background, then the mechanism and concrete specifics, then consequences and honest objections, then where it leads",
  reklam: "a concrete problem the viewer feels, then the product or service as the answer, then proof taken only from the source, then a clear call to action",
  "haber-spor": "the lead (what happened, to whom, when, where), then context and the key numbers, then reactions and what it means, then what happens next",
  egitim: "what the viewer will be able to do afterwards, then the idea step by step with one concrete example per step, then common mistakes, then a one-paragraph takeaway",
  hikaye: "setup with a person or place the viewer can picture, rising tension, a turn, the climax, and a resolution that lands on a feeling",
  tanitim: "what it is and who it is for, then what makes it different with concrete features and benefits, then how it works or what using it looks like, then a warm invitation",
};

const TUR_KAPANIS = {
  belgesel: "End on an idea, not a summary. No \"in conclusion\".",
  reklam: "End on one clear, specific call to action that fits the source (what to do next). No hype words, no invented offers.",
  "haber-spor": "End on what to watch for next. Stay neutral; attribute claims to who made them.",
  egitim: "End with the single takeaway the viewer should remember. A short recap is allowed here and nowhere else.",
  hikaye: "End on an image or a feeling, not a moral lecture.",
  tanitim: "End with a warm, concrete invitation to try or visit. No invented offers.",
};

// Gercek veri istenen turler: uydurma fiyat/indirim/istatistik YASAK
const KAYNAK_SIKI = new Set(["reklam", "tanitim"]);

const turOku = b => (TUR_AD[b.tur] ? b.tur : "belgesel");

const GORSEL_KURALI = [
  "Visual search phrases (<gorseller>): for EVERY paragraph give 2-3 phrases a person would type into a stock-photo or archive site to find a real photo for that scene.",
  "- Always in English (those sites are indexed in English) even when the narration is not; keep proper names as people know them.",
  "- Concrete and photographable: a named person with a year (\"Albert Einstein 1921\"), a place, an object, an animal, an event. Most specific first, a broader fallback last.",
  "- Never abstract words alone (\"paradox\", \"energy\", \"success\"): turn the idea into something visible (\"tangled headphone cable\").",
  "- Acronyms and names stay as written (NASA, CERN, GPU).",
  "- Add \"uret\" only when the scene cannot be photographed at all (an abstract concept, a hypothetical): one short English image-generation prompt with no text inside the image.",
].join("\n");

const CIKTI_BICIMI = (ozetIste) => [
  "Reply in exactly this format and nothing else:",
  "<anlatim>",
  "paragraph one",
  "",
  "paragraph two",
  "</anlatim>",
  "<gorseller>",
  "[{\"p\":1,\"ara\":[\"phrase one\",\"phrase two\"]},{\"p\":2,\"ara\":[\"phrase one\",\"phrase two\"],\"uret\":\"optional\"}]",
  "</gorseller>",
].concat(ozetIste ? ["<ozet>2-3 sentence YouTube description in the video's language</ozet>"] : []).join("\n");

// ---------------------------------------------------------------- sistem istemi
// b: {tur, dil, dilAdi, kisa, format, hedefKelime, hedefSn, kelimeHizi, kanal, ton, kanalSesi,
//     kisiselKatki, arastirma, trend}
function sistemPromptu(b) {
  const tur = turOku(b);
  const L = b.dilAdi || "English";
  const s = [];
  s.push("You write narration scripts for faceless " + (b.kisa ? "vertical short-form" : TUR_AD[tur]) + " videos.");
  s.push("");
  s.push("The text you produce is read aloud by a text-to-speech voice over still images.");
  s.push("There is no presenter and no camera. Therefore:");
  s.push("- Output ONLY the spoken words, inside the tags requested. Nothing else.");
  s.push("- No scene headings, no [B-ROLL] notes, no timestamps, no speaker labels,");
  s.push("  no markdown headers, no bold, no bullet points, no stage directions.");
  s.push("- Plain paragraphs separated by a blank line. Each paragraph is one scene: one visual idea" +
    (b.kisa ? "." : ", about 25-40 seconds spoken (roughly 60-100 words)."));
  s.push("- Write ENTIRELY IN " + L.toUpperCase() + ". Every word is spoken aloud in " + L +
    ". Write the way a native " + L + " narrator speaks, not like a translation.");
  if (S.bosluksuzDilMi(b.dil))
    s.push("- LENGTH UNIT: " + L + " is written without spaces between words. Wherever this prompt gives a length in words, count 1 word as " +
      S.KARAKTER_PER_KELIME + " characters of " + L + " text (for example 100 words = " + Math.round(100 * S.KARAKTER_PER_KELIME) + " characters).");
  s.push("");
  s.push("Craft rules:");
  s.push("- Every claim must be true. Use only facts from the SOURCE MATERIAL (when given) or widely established facts.");
  s.push("  If you are not sure of a number, date, name or quote, round it, hedge it (\"about\", \"roughly\", \"according to\")");
  s.push("  or leave it out. State contested points as contested. Never invent studies, quotes, people, events or statistics.");
  if (KAYNAK_SIKI.has(tur))
    s.push("  For this kind of video use ONLY facts, names, prices and claims that appear in the TOPIC or SOURCE MATERIAL; " +
      "never invent prices, discounts, ratings, awards or testimonials. If a detail is missing, stay general.");
  s.push("- Prefer specifics over adjectives: numbers, names, dates, mechanisms.");
  s.push("- Easy to read aloud: no parentheses, no semicolons, no symbols (%, &, degree signs), no abbreviations the voice would mangle.");
  s.push("  Write numbers the way a narrator would say them in " + L + " (years stay as years).");
  s.push("- No greeting, no channel introduction, no \"like and subscribe\": the video already has its own intro and end card.");

  if (b.kisa) {
    s.push("");
    s.push("Vertical short-form rules (" + (S.PLATFORM_ADI[b.format] || "Shorts") + "):");
    s.push("- The hook lands in the first 2 seconds: the first sentence is at most 10 words and states the most surprising fact, number or tension.");
    s.push("  Never open with a greeting, \"Did you know\", \"Imagine\" or any warm-up.");
    s.push("- Every sentence (8-14 words) must add something new: a fact, an image or a turn. A new piece of information every 3-4 seconds. No filler, no recap.");
    s.push("- Short paragraphs: 1-2 sentences each, one beat per paragraph. Each paragraph becomes one on-screen scene and captions appear word by word.");
    s.push("- Finish on a turn or a line that makes the viewer replay or comment. No \"follow for more\".");
    s.push("- HARD LIMIT: at most " + b.hedefKelime + " words in total (about " + b.hedefSn + " seconds spoken at ~" + b.kelimeHizi +
      " words per minute). Count your words. A script over the limit is a failed script.");
  } else {
    s.push("- Open with a concrete hook in the first two sentences: a specific image, number or tension. Never open with \"In this video\", \"Welcome\" or \"Have you ever\".");
    s.push("- Vary sentence length. Short sentences land hard; use them at turns.");
    s.push("- Keep viewers watching: every 60-90 seconds give a fresh reason to stay (a new question, a surprising turn or a higher stake),");
    s.push("  and close each part on an open loop that the next part pays off.");
    s.push("- " + TUR_KAPANIS[tur]);
  }

  if (b.ton) s.push("", "TONE: " + String(b.ton).slice(0, 300));
  const ks = b.kanalSesi || {};
  if (ks.tarif || ks.ornekParagraf) {
    s.push("", "CHANNEL VOICE (match this style; never copy its content):");
    if (ks.tarif) s.push("Description: " + ks.tarif);
    if (ks.ornekParagraf) s.push("Example paragraph: " + ks.ornekParagraf);
  }
  if (b.kanal && b.kanal !== "KANALIM") s.push("", "The channel is called \"" + b.kanal + "\". Do not say the channel name in the narration.");
  if (b.kisiselKatki) {
    s.push("", "AUTHOR'S OWN PERSPECTIVE (the channel owner's view). Weave it in as the narrator's own take, in the author's voice,");
    s.push("once in the middle and once near the end. Do not invent further personal anecdotes:");
    s.push(String(b.kisiselKatki).slice(0, 1500));
  }
  if (b.trend) s.push("", "STRUCTURE REFERENCE (patterns of videos that are working right now; imitate the structure and pacing, never the content):", b.trend);
  if (b.arastirma) {
    s.push("", "SOURCE MATERIAL (provided by the author; treat it as the primary source; do not contradict it; facts outside it only if widely established):");
    s.push("<kaynak>", String(b.arastirma).slice(0, 20000), "</kaynak>");
  }
  return s.join("\n");
}

// ---------------------------------------------------------------- istekler
const ust = b => ["TOPIC: " + b.konuNotu, "TITLE: " + b.baslik, "LANGUAGE: " + b.dilAdi];

// Kisa video ya da tek atista yazilan (4 dk alti) video
function tekAtisIstegi(b) {
  const tur = turOku(b);
  if (b.kisa) {
    const paragraf = Math.max(3, Math.round(b.hedefKelime / 18));
    return ust(b).concat([
      "",
      "Write the narration for a " + (S.PLATFORM_ADI[b.format] || "YouTube Shorts") + " video of about " + b.hedefSn + " seconds.",
      "Target about " + b.hedefKelime + " words in about " + paragraf + " short paragraphs. Never exceed " + b.hedefKelime + " words.",
      "",
      // kisa videoda da her paragraf bir sahnedir: arama ifadeleri Ingilizce/fotografa cekilebilir olmali (yoksa Turkce/soyut
      // ifadeler stok sitelerde isabet bulamaz)
      GORSEL_KURALI,
      "",
      CIKTI_BICIMI(true),
    ]).join("\n");
  }
  return ust(b).concat([
    "",
    "Write the complete narration script for a video of about " + b.hedefDk.toFixed(1) + " minutes.",
    "LENGTH: " + b.hedefKelime + " words MINIMUM. This is the most important requirement: a shorter script is a failed script.",
    "Write the full length; do not summarise, do not stop early, do not write an outline.",
    "Structure it as roughly " + Math.max(3, Math.round(b.hedefKelime / 85)) + " paragraphs that move the argument forward: " + TUR_YAPI[tur] + ".",
    "Bring real detail: names, numbers, dates, examples.",
    "",
    GORSEL_KURALI,
    "",
    CIKTI_BICIMI(true),
  ]).join("\n");
}

// Uzun video, 1. adim: ana hat (JSON)
function anaHatIstegi(b, n) {
  const tur = turOku(b);
  const kelimeBasi = Math.round(b.hedefKelime / n);
  return ust(b).concat([
    "",
    "Plan the video before it is written. It runs about " + b.hedefDk.toFixed(1) + " minutes (" + b.hedefKelime + " spoken words).",
    "Split it into exactly " + n + " parts, in this order of ideas: " + TUR_YAPI[tur] + ".",
    "Part 1 contains the hook; the last part closes the video. Each part must be able to carry about " + kelimeBasi +
      " words of NEW material; no part repeats another.",
    "",
    "Return ONLY a JSON object, no markdown fence, in exactly this shape:",
    "{\"ozet\":\"2-3 sentence YouTube description in " + b.dilAdi + "\",",
    " \"bolumler\":[{\"ad\":\"chapter title in " + b.dilAdi + ", max 8 words\",",
    "   \"ozet\":\"1-2 sentences in English: what this part covers and which fact or example carries it\",",
    "   \"acik_dongu\":\"the unanswered question or tension at the end of this part that pulls the viewer into the next one (empty for the last part)\"}]}",
  ]).join("\n");
}

// Ana hat cevabini ayristirir. Gecersizse null. n: istenen bolum sayisi.
function planCoz(metin, n) {
  let ham = String(metin || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const ilk = ham.indexOf("{"), son = ham.lastIndexOf("}");
  if (ilk < 0 || son <= ilk) return null;
  let j;
  try { j = JSON.parse(ham.slice(ilk, son + 1)); } catch (e) { return null; }
  if (!j || !Array.isArray(j.bolumler)) return null;
  const bolumler = j.bolumler
    .filter(x => x && typeof x === "object" && String(x.ad || "").trim())
    .map(x => ({
      ad: String(x.ad).replace(/\s+/g, " ").trim().slice(0, 100),
      ozet: String(x.ozet || "").replace(/\s+/g, " ").trim().slice(0, 400),
      acikDongu: String(x.acik_dongu || x.acikDongu || "").replace(/\s+/g, " ").trim().slice(0, 300),
    }));
  // model sayiyi tutturamadiysa: en az yarisi ve en cok iki kati kabul, aksi halde gecersiz
  if (bolumler.length < Math.max(2, Math.ceil(n / 2)) || bolumler.length > n * 2) return null;
  return { ozet: String(j.ozet || "").replace(/\s+/g, " ").trim().slice(0, 600), bolumler };
}

// Uzun video, 2. adim: i. bolum (0-tabanli). onceki: [{ad, ozet}] yazilmis bolumler, sonMetin: bir onceki bolumun son paragraflari
function bolumIstegi(b, plan, i, kelime, sonMetin) {
  const n = plan.bolumler.length;
  const bol = plan.bolumler[i];
  const paragraf = Math.max(1, Math.round(kelime / 80));
  const r = ust(b).concat(["", "FULL OUTLINE:"]);
  plan.bolumler.forEach((x, k) => r.push((k + 1) + ". " + x.ad + " - " + x.ozet));
  if (i > 0) {
    r.push("", "ALREADY WRITTEN (do not repeat any of it):");
    for (let k = 0; k < i; k++) r.push((k + 1) + ". " + plan.bolumler[k].ad + " - " + plan.bolumler[k].ozet);
    if (sonMetin) r.push("", "END OF THE PREVIOUS PART (for continuity only; do not repeat):", sonMetin);
  }
  r.push("", "NOW WRITE PART " + (i + 1) + " OF " + n + ": \"" + bol.ad + "\"", "Cover: " + bol.ozet,
    "Length: about " + kelime + " words (between " + Math.round(kelime * 0.85) + " and " + Math.round(kelime * 1.15) +
    ") in about " + paragraf + " paragraph" + (paragraf > 1 ? "s" : "") + ".");
  if (i === 0)
    r.push("This part opens the video: start with the hook (a concrete image, number or tension). No greeting, no \"in this video\".");
  else
    r.push("Continue seamlessly from the previous part: no greeting, no recap, no \"welcome back\", no new introduction of the topic.");
  if (i < n - 1)
    r.push("Close this part on an open loop" + (bol.acikDongu ? ": " + bol.acikDongu : "") + ". Do NOT conclude the video.");
  else
    r.push("This is the last part: pay off the open loops and close the video. No \"in conclusion\", no call to subscribe.");
  if (kelime >= 150) r.push("Around the middle of this part place a fresh question or turn (re-hook).");
  r.push("", GORSEL_KURALI, "", CIKTI_BICIMI(false));
  return r.join("\n");
}

// Esik altinda kalinca: eksik kelimeyi govdeye ekleyen "devam et" turu
function devamIstegi(b, mevcutMetin, mevcutKelime, eksikKelime) {
  return ust(b).concat([
    "",
    "The narration below is " + mevcutKelime + " words, but the video needs at least " + b.hedefKelime + " words.",
    "Write about " + eksikKelime + " NEW words of additional paragraphs that deepen the body of the video: new concrete facts, mechanisms,",
    "examples, objections or consequences that are NOT yet covered. Do not repeat anything. They will be inserted just before the closing",
    "paragraphs, so do not conclude, do not greet and keep the same voice and language.",
    "",
    "CURRENT SCRIPT:",
    "<anlatim>",
    mevcutMetin,
    "</anlatim>",
    "",
    GORSEL_KURALI,
    "",
    CIKTI_BICIMI(false),
  ]).join("\n");
}

// Bolum sayisi: ~70 sn / bolum, 3..24 arasi
const bolumSayisi = hedefSn => Math.max(3, Math.min(24, Math.round(hedefSn / 70)));

// vidIQ icin brief (concept alani): dil, tur, parca kurallari (ek), ton, kanal sesi, kanal, kisisel katki, trend referansi.
// Claude sistem istemiyle (sistemPromptu) AYNI girdileri okur; vidIQ tek bir alan aldigi icin ozet halde yazilir.
// SIRA bilincli: zorunlu kurallar ve `ek` (parca/kanca kurallari) basta; secenekli bloklar sonda ve sinirli uzunlukta,
// alan kesilirse (kisaltilmis yeniden deneme) kesilen yer secenekli bloklarin sonu olur.
function vidiqBrief(b, ek) {
  const tur = turOku(b);
  const L = b.dilAdi || "English";
  const bir = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const p = [];
  p.push("Faceless, narration-only " + (b.kisa ? "vertical short-form " : "") + "video. No presenter, no talking head, no camera directions.");
  p.push("Spoken narration ONLY: it will be read aloud by a text-to-speech voice over still images.");
  p.push("Do not write scene headings, b-roll notes, timestamps, speaker labels, greetings or calls to subscribe.");
  p.push("WRITE ENTIRELY IN " + L.toUpperCase() + ": every word is spoken aloud in " + L + ".");
  p.push("Plain paragraphs of spoken " + L + ", separated by blank lines.");
  if (S.bosluksuzDilMi(b.dil))
    p.push("Length unit: " + L + " has no spaces between words, so 1 word counts as " + S.KARAKTER_PER_KELIME + " characters wherever a length is given in words.");
  p.push("Every claim must be true; if unsure about a number, date, name or quote, round it, hedge it or leave it out. Never invent facts.");
  if (b.kisa) {
    p.push("The first sentence (max 10 words) is the hook. Every sentence adds a new fact. Never exceed " + b.hedefKelime + " words in total.");
  } else {
    p.push("Structure: " + TUR_YAPI[tur] + ". Re-hook every 60-90 seconds and close each part on an open loop.");
  }
  if (ek) p.push(ek);
  if (b.ton) p.push("Tone: " + bir(b.ton, 200) + ".");
  const ks = b.kanalSesi || {};
  if (ks.tarif || ks.ornekParagraf)
    p.push("CHANNEL VOICE (match this style; never copy its content):" + (ks.tarif ? " Description: " + bir(ks.tarif, 500) : "") +
      (ks.ornekParagraf ? " Example paragraph: " + bir(ks.ornekParagraf, 800) : ""));
  if (b.kanal && b.kanal !== "KANALIM") p.push("The channel is called \"" + bir(b.kanal, 80) + "\". Do not say the channel name in the narration.");
  if (b.kisiselKatki) p.push("Author's own perspective to weave in once in the middle and once near the end (in the author's voice, no invented anecdotes): " + bir(b.kisiselKatki, 800));
  if (b.trend) p.push("STRUCTURE REFERENCE (patterns of videos that are working right now; imitate the structure and pacing, never the content): " + bir(b.trend, 700));
  return p.join(" ");
}

module.exports = { TUR_AD, TUR_YAPI, GORSEL_KURALI, sistemPromptu, tekAtisIstegi, anaHatIstegi, planCoz, bolumIstegi,
  devamIstegi, bolumSayisi, vidiqBrief };
