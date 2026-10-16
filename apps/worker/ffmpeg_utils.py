from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


def ffmpeg_bin() -> str:
    return os.environ.get("FFMPEG_PATH", "ffmpeg")


def ffprobe_bin() -> str:
    configured = os.environ.get("FFPROBE_PATH")
    if configured:
        return configured
    ffmpeg = ffmpeg_bin()
    if ffmpeg.lower().endswith("ffmpeg.exe"):
        return ffmpeg[:-len("ffmpeg.exe")] + "ffprobe.exe"
    if ffmpeg.endswith("ffmpeg"):
        return ffmpeg[:-len("ffmpeg")] + "ffprobe"
    return "ffprobe"


def run(args: list[str], cwd: Path | None = None) -> None:
    result = subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"Command failed: {' '.join(args)}")


def probe_size(video_path: Path) -> tuple[int, int, float]:
    result = subprocess.run(
        [
            ffprobe_bin(),
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,duration",
            "-of",
            "json",
            str(video_path),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffprobe failed")
    payload = json.loads(result.stdout)
    streams = payload.get("streams") or []
    if not streams:
        raise RuntimeError("No video stream")
    stream = streams[0]
    width = int(stream["width"])
    height = int(stream["height"])
    duration = float(stream.get("duration") or 0)
    if duration <= 0:
        format_result = subprocess.run(
            [
                ffprobe_bin(),
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(video_path),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        format_payload = json.loads(format_result.stdout or "{}")
        duration = float(format_payload.get("format", {}).get("duration") or 0)
    return width, height, duration


def extract_frame(video_path: Path, seconds: float, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            ffmpeg_bin(),
            "-y",
            "-ss",
            f"{seconds:.3f}",
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(output_path),
        ]
    )
