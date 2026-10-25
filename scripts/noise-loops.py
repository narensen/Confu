#!/usr/bin/env python3
"""Turn the noise recordings in assets/noise/ into the reader's sound loops.

  python3 scripts/noise-loops.py            # every *_Noise.* file in assets/noise/
  python3 scripts/noise-loops.py --ffmpeg /path/to/ffmpeg

Each recording becomes public/noise/<Name>.mp3 (e.g. White_Noise.mp3): a
60-second stretch from the middle, its end cross-faded into its start so it
loops without a seam, levelled to the same loudness as the others, at
192 kbps (about 1.4 MB). The originals stay out of git (they're large).
"""

import argparse
import shutil
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "noise"
OUT = ROOT / "public" / "noise"
RATE = 44100
LOOP = 60.0  # seconds
FADE = 3.0  # cross-fade, seconds
TARGET_RMS = 10 ** (-20 / 20)  # -20 dBFS, the same for every colour


def find_ffmpeg(given: str | None) -> str:
    for candidate in [given, shutil.which("ffmpeg"), str(ROOT / "marketing/studio/node_modules/ffmpeg-static/ffmpeg")]:
        if candidate and Path(candidate).exists():
            return candidate
    raise SystemExit("ffmpeg not found: install it or pass --ffmpeg")


def decode(ffmpeg: str, path: Path) -> np.ndarray:
    raw = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(RATE), "-"],
        check=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).copy()


def make_loop(audio: np.ndarray) -> np.ndarray:
    n, fade = int(LOOP * RATE), int(FADE * RATE)
    if len(audio) < n + fade:
        raise SystemExit(f"recording is shorter than {LOOP + FADE:.0f} s")
    # From the middle, away from any fade-in or fade-out.
    start = (len(audio) - n - fade) // 2
    seg = audio[start : start + n + fade]
    out = seg[:n].copy()
    t = np.linspace(0, 1, fade, endpoint=False)[:, None]
    # Equal-power: noise halves are uncorrelated, so this keeps the level steady.
    out[:fade] = seg[:fade] * np.sqrt(t) + seg[n : n + fade] * np.sqrt(1 - t)
    rms = np.sqrt(np.mean(out**2))
    out *= TARGET_RMS / max(rms, 1e-9)
    peak = np.max(np.abs(out))
    if peak > 0.95:
        out *= 0.95 / peak
    return out


def encode(ffmpeg: str, audio: np.ndarray, path: Path) -> None:
    subprocess.run(
        [ffmpeg, "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(RATE), "-i", "-", "-c:a", "libmp3lame", "-b:a", "192k", str(path)],
        input=audio.astype("<f4").tobytes(),
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg")
    ffmpeg = find_ffmpeg(parser.parse_args().ffmpeg)
    OUT.mkdir(parents=True, exist_ok=True)
    sources = sorted(p for p in SRC.glob("*_Noise.*") if p.suffix.lower() in {".mp3", ".wav", ".flac", ".m4a", ".ogg"})
    if not sources:
        raise SystemExit(f"no *_Noise recordings in {SRC}")
    for src in sources:
        dest = OUT / f"{src.stem}.mp3"
        encode(ffmpeg, make_loop(decode(ffmpeg, src)), dest)
        print(f"{src.name} -> {dest.relative_to(ROOT)} ({dest.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
