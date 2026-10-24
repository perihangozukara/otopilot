"""Selected VoxCPM2 voice profile -> Otopilot Voice/hazir/NNN.wav."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
from pathlib import Path


def paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text.lstrip("\ufeff")) if p.strip()]


def text_hash(items: list[str]) -> str:
    canonical = "\n\n".join(unicodedata.normalize("NFC", p) for p in items)
    return hashlib.sha1(canonical.encode("utf-8")).hexdigest()


def apply_okunus(text: str, okunus: dict[str, str]) -> str:
    # Same rule as lib/ses-metin.js okunusUygula: word boundary, case-sensitive, longest key first.
    for key in sorted((k for k in okunus if k and isinstance(okunus[k], str)), key=len, reverse=True)[:200]:
        text = re.sub(r"(?<![\w])" + re.escape(key) + r"(?![\w])", lambda _m, v=okunus[key]: v, text)
    return text


def okunus_hash(okunus: dict[str, str]) -> str:
    return hashlib.sha1(json.dumps(okunus, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def existing_matches(out: Path, digest: str, count: int, okunus_digest: str, sentence_gap: float) -> bool:
    try:
        meta = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
        if meta.get("text_sha1") != digest or meta.get("paragraph_count") != count:
            return False
        # Eski üretim (yalnız ses tarifi, cümle esi yok) güncel sayılmaz.
        if meta.get("mode") != "reference_continuation" or meta.get("sentence_gap") != sentence_gap:
            return False
        if meta.get("okunus_sha1", okunus_hash({})) != okunus_digest:
            return False
        for i in range(1, count + 1):
            p = out / f"{i:03d}.wav"
            if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest() != meta["files"][i - 1]["sha256"]:
                return False
        return len(meta.get("files", [])) == count
    except (OSError, ValueError, KeyError, TypeError):
        return False


def trim_edges(wav, np, sr: int):
    win = max(1, int(0.02 * sr))
    n = len(wav) // win
    if not n:
        return wav
    rms = np.sqrt((wav[:n * win].reshape(n, win) ** 2).mean(axis=1))
    active = np.where(rms > 10 ** (-40 / 20))[0]
    if not len(active):
        return wav
    return wav[max(0, active[0] * win - int(0.03 * sr)):min(len(wav), (active[-1] + 1) * win + int(0.06 * sr))]


def split_sentences(text: str) -> list[str]:
    # Her cümle ayrı üretilir; aralarına sessizlik (cümle esi) konur.
    return [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text.strip()) if s.strip()]


def word_times(sentence: str, start: float, end: float) -> list[dict]:
    # Cümlenin süresini kelimelere harf sayısına göre böler (ms, paragraf başına göre).
    words = sentence.split()
    total = sum(len(w) + 1 for w in words) or 1
    span, acc, result = max(0.0, end - start), 0, []
    for w in words:
        result.append({"t": round((start + span * acc / total) * 1000),
                       "d": round(span * (len(w) + 1) / total * 1000), "w": w})
        acc += len(w) + 1
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--metin", required=True, type=Path)
    ap.add_argument("--cikti", required=True, type=Path)
    ap.add_argument("--referans", required=True, type=Path)
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--yeniden", action="store_true")
    ap.add_argument("--okunus", type=Path, help="konu.json okunus sözlüğü (JSON); yalnız ses metnine uygulanır")
    ap.add_argument("--cumle-es", type=float, default=0.6, help="cümleler arası sessizlik (sn)")
    args = ap.parse_args()
    if not 0 <= args.cumle_es <= 3:
        raise SystemExit("--cumle-es 0 ile 3 sn arasında olmalı.")

    items = paragraphs(args.metin.read_text(encoding="utf-8"))
    if not items:
        raise SystemExit("Seslendirilecek paragraf yok.")
    okunus = json.loads(args.okunus.read_text(encoding="utf-8")) if args.okunus else {}
    if not isinstance(okunus, dict):
        raise SystemExit("Okunuş sözlüğü bir JSON nesnesi olmalı.")
    okunus_digest = okunus_hash(okunus)
    digest = text_hash(items)
    out = args.cikti.resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists() and existing_matches(out, digest, len(items), okunus_digest, args.cumle_es) and not args.yeniden:
        print(f"VoxCPM2 sesleri güncel ({len(items)} paragraf); üretim atlandı.", flush=True)
        return 0
    if out.exists() and not args.yeniden:
        raise SystemExit("Voice/hazir içeriği metinle eşleşmiyor. Yeniden üretmek için --yeniden ekle.")

    ref = args.referans.resolve()
    if not ref.is_file():
        raise SystemExit(f"Seçilen referans WAV bulunamadı: {ref}")
    ref_meta_path = ref.with_suffix(".json")
    if not ref_meta_path.is_file():
        raise SystemExit(f"Referans sesin metin kaydı bulunamadı: {ref_meta_path}")
    ref_meta = json.loads(ref_meta_path.read_text(encoding="utf-8"))
    voice_design = ref_meta.get("voice_design")
    if not isinstance(voice_design, str) or not voice_design.strip():
        raise SystemExit("Seçili ses profilinin tasarım tarifi boş.")
    ref_text = ref_meta.get("text")
    if not isinstance(ref_text, str) or not ref_text.strip():
        raise SystemExit("Referans sesin okunan metni (.json 'text') boş; devam modu için gerekli.")
    # Devam modu: model kayıtlı sesi ve metnini duyar, her cümleyi o konuşmanın devamı gibi okur (duygu ve ton korunur).
    prompt_text = apply_okunus(" ".join(ref_text.split()), okunus)

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    import numpy as np
    import soundfile as sf
    import torch
    from voxcpm import VoxCPM

    tmp = Path(tempfile.mkdtemp(prefix="hazir.tmp-", dir=out.parent))
    try:
        model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False)
        sr = model.tts_model.sample_rate
        files = []
        gap = np.zeros(int(round(args.cumle_es * sr)), dtype=np.float32)
        for i, original in enumerate(items, 1):
            raw = tmp / f"{i:03d}.ham.wav"
            target = tmp / f"{i:03d}.wav"
            sentences = split_sentences(" ".join(original.splitlines()))
            parts, words, sentence_meta, pos = [], [], [], 0
            for j, sentence in enumerate(sentences, 1):
                # Previously verified for one word on VoxCPM2; applied only to that word.
                tts_text = re.sub(r"(?i)nüshasında", "nüs" + chr(0x200C) + "hasında", apply_okunus(sentence, okunus))
                print(f"VoxCPM2: paragraf {i}/{len(items)}, cümle {j}/{len(sentences)}", flush=True)
                torch.manual_seed(1)
                # Peri 24.10.2026'da 4 denemeden bunu seçti: ses tarifli tek cümle bazen bozuk ve duygusuz çıkıyordu.
                wav = model.generate(text=tts_text, reference_wav_path=str(ref),
                                     prompt_wav_path=str(ref), prompt_text=prompt_text,
                                     cfg_value=2.5, inference_timesteps=15).astype(np.float32)
                wav = trim_edges(wav, np, sr)
                if parts:
                    parts.append(gap)
                    pos += len(gap)
                start = pos / sr
                parts.append(wav)
                pos += len(wav)
                end = pos / sr
                sentence_meta.append({"text": sentence, "start": round(start, 3), "end": round(end, 3)})
                words.extend(word_times(sentence, start, end))
            sf.write(raw, np.concatenate(parts), sr)
            subprocess.run([
                args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw),
                "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "pcm_s24le", str(target),
            ], check=True)
            raw.unlink()
            files.append({"name": target.name, "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                          "sentences": sentence_meta, "words": words})
        ref_sha = hashlib.sha256(ref.read_bytes()).hexdigest()
        (tmp / "manifest.json").write_text(json.dumps({
            "version": 2, "model": "openbmb/VoxCPM2", "voice": ref.stem,
            "mode": "reference_continuation", "sentence_gap": args.cumle_es,
            "reference": str(ref), "reference_sha256": ref_sha, "voice_design": voice_design,
            "text_sha1": digest, "okunus_sha1": okunus_digest, "okunus": okunus,
            "paragraph_count": len(items), "cfg_value": 2.5,
            "inference_timesteps": 15, "seed": 1,
            "normalization": "loudnorm=I=-16:TP=-1.5:LRA=11; 48 kHz; 24-bit PCM",
            "pronunciation_fixes": ["nüshasında: U+200C after s (only when present)"], "files": files,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        # Eski sesler silinmez: Voice/eski/hazir-<zaman>/ altına taşınır.
        backup = None
        if out.exists():
            backup = out.parent / "eski" / ("hazir-" + time.strftime("%Y%m%d-%H%M%S"))
            backup.parent.mkdir(parents=True, exist_ok=True)
            os.replace(out, backup)
        try:
            os.replace(tmp, out)
        except Exception:
            if backup and backup.exists() and not out.exists():
                os.replace(backup, out)
            raise
        if backup:
            print(f"Eski sesler taşındı: {backup}", flush=True)
        print(f"Hazır: {len(items)} WAV -> {out}", flush=True)
        return 0
    finally:
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as exc:
        print(f"ffmpeg WAV normalizasyonunda hata verdi (kod {exc.returncode}).", file=sys.stderr)
        sys.exit(1)
