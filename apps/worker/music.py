from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

from job_io import data_dir

SAMPLE_RATE = 44100
BED_SECONDS = 96.0


def music_dir() -> Path:
    path = data_dir() / "music"
    path.mkdir(parents=True, exist_ok=True)
    return path


def bed_path() -> Path:
    return music_dir() / "bed.wav"


def _chord_tone(time: np.ndarray, freq: float, amp: float) -> np.ndarray:
    vibrato = freq * (1.0 + 0.0035 * np.sin(2.0 * np.pi * 0.18 * time))
    pad = np.sin(2.0 * np.pi * vibrato * time)
    fifth = np.sin(2.0 * np.pi * vibrato * 1.5 * time) * 0.28
    return amp * (pad + fifth)


def generate_bed(path: Path | None = None) -> Path:
    output = path or bed_path()
    if output.exists() and output.stat().st_size > 10_000:
        return output
    time = np.arange(int(SAMPLE_RATE * BED_SECONDS), dtype=np.float64) / SAMPLE_RATE
    chords = np.array(
        [
            [220.00, 261.63, 329.63],
            [174.61, 220.00, 261.63],
            [196.00, 246.94, 311.13],
            [164.81, 220.00, 246.94],
        ],
        dtype=np.float64,
    )
    bar = 4.0
    wave_out = np.zeros_like(time)
    for index, freq in enumerate(chords.reshape(-1)):
        amp = 0.11 if index % 3 == 0 else 0.07
        wave_out += _chord_tone(time, float(freq), amp)
    chord_index = np.floor(time / bar).astype(np.int32) % len(chords)
    pulse = np.zeros_like(time)
    for index, chord in enumerate(chords):
        mask = chord_index == index
        env = 0.5 + 0.5 * np.sin(2.0 * np.pi * (0.25 / bar) * time)
        pulse[mask] += 0.05 * env[mask] * np.sin(2.0 * np.pi * chord[0] * 2.0 * time[mask])
    noise = np.random.default_rng(11).normal(0.0, 0.018, time.shape)
    kernel = np.ones(420, dtype=np.float64) / 420.0
    noise = np.convolve(noise, kernel, mode="same")
    mixed = wave_out + pulse + noise
    fade = np.ones_like(mixed)
    fade_len = int(SAMPLE_RATE * 0.8)
    fade[:fade_len] = np.linspace(0.0, 1.0, fade_len)
    fade[-fade_len:] = np.linspace(1.0, 0.0, fade_len)
    mixed *= fade
    peak = float(np.max(np.abs(mixed))) or 1.0
    samples = np.clip(mixed / peak * 0.38, -1.0, 1.0)
    stereo = np.column_stack([samples, samples * 0.96])
    pcm = (stereo * 32767.0).astype(np.int16)
    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(pcm.tobytes())
    return output


def ensure_bed() -> Path:
    return generate_bed()


def music_offset(clip_id: str) -> float:
    total = sum(ord(char) for char in clip_id)
    return float(total % 41)
