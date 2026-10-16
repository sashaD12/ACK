from __future__ import annotations

import os
import site
import sys
import types
import wave
from pathlib import Path
from typing import Any

import numpy as np

from ffmpeg_utils import ffmpeg_bin, probe_size, run

_models: dict[str, Any] = {}
_cuda_broken = False


def _stub_pyav() -> None:
    if "av" in sys.modules:
        return
    dummy = types.ModuleType("av")
    dummy.audio = types.ModuleType("av.audio")
    dummy.audio.resampler = types.ModuleType("av.audio.resampler")
    sys.modules["av"] = dummy
    sys.modules["av.audio"] = dummy.audio
    sys.modules["av.audio.resampler"] = dummy.audio.resampler


def extract_wav(source_path: Path, wav_path: Path) -> None:
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            ffmpeg_bin(),
            "-y",
            "-i",
            str(source_path),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(wav_path),
        ]
    )


def load_wav(wav_path: Path) -> np.ndarray:
    with wave.open(str(wav_path), "rb") as handle:
        frames = handle.readframes(handle.getnframes())
        audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    return audio


def setup_cuda_dlls() -> None:
    folders = [
        "nvidia/cublas/bin",
        "nvidia/cuda_runtime/bin",
        "nvidia/cuda_nvrtc/bin",
    ]
    roots = [Path(site.getusersitepackages())]
    roots.extend(Path(item) for item in site.getsitepackages())
    for root in roots:
        for folder in folders:
            path = root / folder
            if not path.is_dir():
                continue
            os.environ["PATH"] = str(path) + os.pathsep + os.environ.get("PATH", "")
            if hasattr(os, "add_dll_directory"):
                os.add_dll_directory(str(path))


def whisper_device() -> tuple[str, str]:
    if _cuda_broken:
        return "cpu", "int8"
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def get_whisper_model(model_name: str):
    device, compute_type = whisper_device()
    cache_key = f"{device}:{compute_type}:{model_name}"
    cached = _models.get(cache_key)
    if cached is not None:
        return cached, device
    setup_cuda_dlls()
    _stub_pyav()
    from faster_whisper.transcribe import WhisperModel

    print(
        f"Loading Whisper {model_name} on {device} ({compute_type})",
        flush=True,
    )
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    _models[cache_key] = model
    return model, device


def _run_whisper(
    model: Any,
    audio: np.ndarray,
    language: str,
    duration: float,
) -> dict[str, Any]:
    whisper_language = None if language in ("auto", "", "detect") else language
    segments_iter, info = model.transcribe(
        audio,
        language=whisper_language,
        word_timestamps=True,
        vad_filter=True,
        beam_size=1,
        best_of=1,
        condition_on_previous_text=False,
    )
    segments: list[dict[str, Any]] = []
    for segment in segments_iter:
        words: list[dict[str, Any]] = []
        for word in segment.words or []:
            words.append(
                {
                    "word": word.word.strip(),
                    "start": float(word.start),
                    "end": float(word.end),
                }
            )
        segments.append(
            {
                "start": float(segment.start),
                "end": float(segment.end),
                "text": segment.text.strip(),
                "words": words,
            }
        )
    return {
        "language": info.language or language or "ru",
        "duration": float(info.duration or duration or 0),
        "segments": segments,
    }


def transcribe_video(
    source_path: Path,
    language: str,
    model_name: str,
) -> dict[str, Any]:
    global _cuda_broken
    _width, _height, duration = probe_size(source_path)
    wav_path = source_path.parent / "audio.wav"
    if not wav_path.exists():
        extract_wav(source_path, wav_path)
    audio = load_wav(wav_path)
    try:
        model, _device = get_whisper_model(model_name)
        return _run_whisper(model, audio, language, duration)
    except Exception as error:
        message = str(error).lower()
        cuda_failed = "cublas" in message or "cuda" in message or "cudnn" in message
        if not cuda_failed:
            raise RuntimeError(f"Не удалось загрузить Whisper: {error}") from error
        print(f"CUDA Whisper failed ({error}), falling back to CPU", flush=True)
        _cuda_broken = True
        model, _device = get_whisper_model(model_name)
        return _run_whisper(model, audio, language, duration)


def flatten_words(transcript: dict[str, Any]) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for segment in transcript.get("segments") or []:
        segment_words = segment.get("words") or []
        if segment_words:
            words.extend(segment_words)
            continue
        text = str(segment.get("text") or "").strip()
        if text:
            words.append(
                {
                    "word": text,
                    "start": float(segment.get("start") or 0),
                    "end": float(segment.get("end") or 0),
                }
            )
    return [word for word in words if word.get("word")]


def transcript_window(
    words: list[dict[str, Any]],
    start: float,
    end: float,
) -> str:
    parts = [
        str(word["word"])
        for word in words
        if float(word["start"]) >= start - 0.05 and float(word["end"]) <= end + 0.05
    ]
    return " ".join(parts).strip()
