from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageEnhance, ImageOps

from ffmpeg_utils import ffmpeg_bin, run

WIDTH = 1080
HEIGHT = 1920
MOTION_STYLES = ("zoom_in", "pan_right", "pan_left", "drift")
MIN_BEAT_SEC = 2.0


def _seed_int(job_id: str, beat_index: int, query: str, text: str) -> int:
    raw = f"{job_id}|{beat_index}|{query}|{text}".encode("utf-8")
    return int(hashlib.sha256(raw).hexdigest()[:16], 16)


def beat_timeline(
    beats: list[dict[str, Any]],
    audio_duration: float,
) -> list[tuple[float, float, dict[str, Any]]]:
    if not beats:
        return []
    weight = sum(float(beat.get("seconds") or 1) for beat in beats) or 1.0
    scale = audio_duration / weight if audio_duration > 0 else 1.0
    cursor = 0.0
    timeline: list[tuple[float, float, dict[str, Any]]] = []
    for beat in beats:
        seconds = max(MIN_BEAT_SEC, float(beat.get("seconds") or 6) * scale)
        start = cursor
        end = min(audio_duration, cursor + seconds) if audio_duration > 0 else cursor + seconds
        if end <= start:
            break
        timeline.append((start, end, beat))
        cursor = end
        if audio_duration > 0 and cursor >= audio_duration:
            break
    return timeline


def _cover(image: Image.Image, width: int, height: int) -> Image.Image:
    ratio = max(width / image.width, height / image.height)
    new_w = max(width, int(image.width * ratio))
    new_h = max(height, int(image.height * ratio))
    resized = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = (new_w - width) // 2
    top = (new_h - height) // 2
    return resized.crop((left, top, left + width, top + height))


def _fallback_frame() -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), (16, 18, 22))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, HEIGHT // 3, WIDTH, HEIGHT), fill=(28, 32, 40))
    return image


def _photo_frame(photo_path: Path | None) -> Image.Image:
    if photo_path is None or not photo_path.exists():
        return _fallback_frame()
    try:
        with Image.open(photo_path) as opened:
            base = ImageOps.exif_transpose(opened).convert("RGB")
    except Exception:
        return _fallback_frame()

    frame = _cover(base, WIDTH, HEIGHT)
    frame = ImageEnhance.Contrast(frame).enhance(1.08)
    frame = ImageEnhance.Color(frame).enhance(1.05)
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((0, 0, WIDTH, 220), fill=(0, 0, 0, 110))
    draw.rectangle((0, HEIGHT - 520, WIDTH, HEIGHT), fill=(0, 0, 0, 150))
    composed = Image.alpha_composite(frame.convert("RGBA"), overlay)
    return composed.convert("RGB")


def _motion_filter(style: str, duration: float) -> str:
    move = max(duration, 0.4)
    if style == "zoom_in":
        return (
            "scale=1240:2204,"
            f"crop=1080:1920:min(in_w-1080\\,80*t/{move:.3f}):"
            f"min(in_h-1920\\,56*t/{move:.3f})"
        )
    if style == "pan_right":
        return (
            "scale=1220:2168,"
            f"crop=1080:1920:min(in_w-1080\\,120*t/{move:.3f}):(ih-1920)/2"
        )
    if style == "pan_left":
        return (
            "scale=1220:2168,"
            f"crop=1080:1920:max(0\\,in_w-1080-120*t/{move:.3f}):(ih-1920)/2"
        )
    return (
        "scale=1200:2133,"
        "crop=1080:1920:"
        f"min(in_w-1080\\,60*t/{move:.3f}):"
        "max(0\\,min(in_h-1920\\,(ih-1920)/2))"
    )


def generate_clip(
    output_path: Path,
    duration: float,
    job_id: str,
    beat_index: int,
    query: str,
    text: str,
    photo_path: Path | None = None,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    seed = _seed_int(job_id, beat_index, query, text)
    style = MOTION_STYLES[seed % len(MOTION_STYLES)]
    frame = _photo_frame(photo_path)
    frame_path = output_path.with_suffix(".png")
    frame.save(frame_path, quality=95)

    seconds = max(MIN_BEAT_SEC, duration)
    motion = _motion_filter(style, seconds)
    vf = f"{motion},eq=contrast=1.03:saturation=1.04,format=yuv420p"
    try:
        run(
            [
                ffmpeg_bin(),
                "-y",
                "-loop",
                "1",
                "-i",
                str(frame_path),
                "-t",
                f"{seconds:.3f}",
                "-vf",
                vf,
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "20",
                "-an",
                "-pix_fmt",
                "yuv420p",
                str(output_path),
            ]
        )
    except RuntimeError:
        run(
            [
                ffmpeg_bin(),
                "-y",
                "-loop",
                "1",
                "-i",
                str(frame_path),
                "-t",
                f"{seconds:.3f}",
                "-vf",
                f"{motion},format=yuv420p",
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "20",
                "-an",
                str(output_path),
            ]
        )
    try:
        frame_path.unlink()
    except OSError:
        pass


def prepare_visuals(
    beats: list[dict[str, Any]],
    assets_dir: Path,
    total_audio: float,
    job_id: str = "studio",
    photos: list[Path] | None = None,
) -> list[tuple[Path, float]]:
    assets_dir.mkdir(parents=True, exist_ok=True)
    photo_list = [path for path in (photos or []) if path.exists()]
    if not beats:
        path = assets_dir / "clip-00.mp4"
        seconds = max(total_audio, 8.0)
        photo = photo_list[0] if photo_list else None
        generate_clip(path, seconds, job_id, 0, "news", "news", photo)
        return [(path, seconds)]

    timeline = beat_timeline(beats, total_audio)
    prepared: list[tuple[Path, float]] = []
    for index, (start, end, beat) in enumerate(timeline):
        seconds = max(MIN_BEAT_SEC, end - start)
        query = str(beat.get("query") or "news")
        text = str(beat.get("text") or query)
        photo = photo_list[index % len(photo_list)] if photo_list else None
        out = assets_dir / f"clip-{index:02d}.mp4"
        generate_clip(out, seconds, job_id, index, query, text, photo)
        prepared.append((out, seconds))
    return prepared
