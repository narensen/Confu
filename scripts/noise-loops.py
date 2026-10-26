#!/usr/bin/env python3
"""Turn the noise recordings in assets/noise/ into the reader's sound loops.

  python3 scripts/noise-loops.py            # every *_Noise.* file in assets/noise/
  python3 scripts/noise-loops.py --ffmpeg /path/to/ffmpeg
  python3 scripts/noise-loops.py --white    # make White_Noise.mp3 (no recording needed)

Each recording becomes public/noise/<Name>.mp3 (e.g. White_Noise.mp3): a
60-second stretch from the middle, its end cross-faded into its start so it
loops without a seam, levelled to the same loudness as the others, at
192 kbps (about 1.4 MB). The originals stay out of git (they're large).

A recording can be hours long: only a few minutes around its middle are read.
Without a white-noise recording, --white makes one directly (white noise is
random signal), softened above 8 kHz so it's an even hiss, not a harsh one.
"""

import argparse
import re
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


def duration(ffmpeg: str, path: Path) -> float | None:
    info = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", info)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else None


def decode(ffmpeg: str, path: Path) -> np.ndarray:
    # A long recording (hours of it) is read only around its middle: decoding
    # all of it would take gigabytes of memory for the one minute we keep.
    total = duration(ffmpeg, path)
    want = LOOP + FADE + 2
    window = ["-ss", f"{(total - want) / 2:.2f}", "-t", f"{want:.2f}"] if total and total > want * 4 else []
    raw = subprocess.run(
        [ffmpeg, "-v", "error", *window, "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(RATE), "-"],
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
    return level(out)


def level(out: np.ndarray) -> np.ndarray:
    out = out * TARGET_RMS / max(np.sqrt(np.mean(out**2)), 1e-9)
    peak = np.max(np.abs(out))
    return out * (0.95 / peak) if peak > 0.95 else out


def synth_white(seed: int = 7) -> np.ndarray:
    # Random phases on a shaped spectrum: flat (white) to 8 kHz, then a gentle
    # 6 dB/octave roll-off; nothing below 20 Hz. The inverse FFT of a spectrum
    # is periodic, so the loop has no seam at all. Each channel is independent.
    n = int(LOOP * RATE)
    rng = np.random.default_rng(seed)
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    mag = (freqs > 20) / np.sqrt(1 + (freqs / 8000) ** 2)
    chans = [np.fft.irfft(mag * np.exp(2j * np.pi * rng.random(len(freqs))), n) for _ in range(2)]
    return level(np.stack(chans, axis=1)).astype(np.float32)


def encode(ffmpeg: str, audio: np.ndarray, path: Path) -> None:
    subprocess.run(
        [ffmpeg, "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(RATE), "-i", "-", "-c:a", "libmp3lame", "-b:a", "192k", str(path)],
        input=audio.astype("<f4").tobytes(),
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg")
    parser.add_argument("--white", action="store_true", help="make White_Noise.mp3 without a recording")
    args = parser.parse_args()
    ffmpeg = find_ffmpeg(args.ffmpeg)
    OUT.mkdir(parents=True, exist_ok=True)
    if args.white:
        dest = OUT / "White_Noise.mp3"
        encode(ffmpeg, synth_white(), dest)
        print(f"white noise -> {dest.relative_to(ROOT)} ({dest.stat().st_size / 1e6:.1f} MB)")
        return
    sources = sorted(p for p in SRC.glob("*_Noise.*") if p.suffix.lower() in {".mp3", ".wav", ".flac", ".m4a", ".ogg"})
    if not sources:
        raise SystemExit(f"no *_Noise recordings in {SRC}")
    for src in sources:
        dest = OUT / f"{src.stem}.mp3"
        encode(ffmpeg, make_loop(decode(ffmpeg, src)), dest)
        print(f"{src.name} -> {dest.relative_to(ROOT)} ({dest.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
