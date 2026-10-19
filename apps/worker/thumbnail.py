from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from crop import detect_face_xy
from ffmpeg_utils import extract_frame


def _cover(image: Image.Image, width: int, height: int) -> Image.Image:
    ratio = max(width / image.width, height / image.height)
    new_w = max(width, int(image.width * ratio))
    new_h = max(height, int(image.height * ratio))
    resized = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = (new_w - width) // 2
    top = (new_h - height) // 2
    return resized.crop((left, top, left + width, top + height))


def _contrast(image: Image.Image) -> float:
    gray = np.array(image.convert("L"), dtype=np.float32)
    return float(gray.std())


def _font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> str:
    words = text.split()
    if not words:
        return ""
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        trial = f"{current} {word}"
        if draw.textlength(trial, font=font) <= max_width:
            current = trial
            continue
        lines.append(current)
        current = word
    lines.append(current)
    return "\n".join(lines[:3])


def _frame_score(image: Image.Image, frame_path: Path, early_bonus: float) -> float:
    contrast = _contrast(image)
    score = contrast
    face = detect_face_xy(frame_path)
    if face is not None:
        score += 45.0
        _x, y = face
        if 0.22 <= y <= 0.55:
            score += 18.0
    score += early_bonus
    return score


def _draw_hook(image: Image.Image, hook: str) -> Image.Image:
    canvas = image.convert("RGB")
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width, height = canvas.size
    draw.rectangle((0, 0, width, int(height * 0.34)), fill=(0, 0, 0, 150))
    font = _font(max(42, width // 15))
    wrapped = _wrap(draw, hook, font, width - 72)
    draw.multiline_text(
        (36, int(height * 0.08)),
        wrapped,
        font=font,
        fill=(255, 229, 0, 255),
        stroke_width=4,
        stroke_fill=(0, 0, 0, 255),
        spacing=10,
    )
    return Image.alpha_composite(canvas.convert("RGBA"), overlay).convert("RGB")


def make_thumbnails(
    source_path: Path,
    start: float,
    end: float,
    hook: str,
    vertical_path: Path,
    horizontal_path: Path,
) -> None:
    span = max(0.4, end - start)
    points = [
        start + min(0.7, span * 0.08),
        start + min(1.4, span * 0.18),
        start + span * 0.35,
        start + span * 0.55,
        max(start, end - 0.8),
    ]
    tmp_dir = source_path.parent / "tmp_frames"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    best_image: Image.Image | None = None
    best_score = -1.0
    for index, seconds in enumerate(points):
        frame_path = tmp_dir / f"thumb-{index}.jpg"
        try:
            extract_frame(source_path, seconds, frame_path)
            image = Image.open(frame_path).convert("RGB")
            early_bonus = max(0.0, 16.0 - index * 3.5)
            score = _frame_score(image, frame_path, early_bonus)
            if score > best_score:
                best_score = score
                best_image = image
        except Exception:
            continue
    if best_image is None:
        raise RuntimeError("Could not extract thumbnail frames")
    vertical = _cover(best_image.copy(), 1080, 1920)
    hooked = _draw_hook(vertical, hook)
    hooked.save(vertical_path, quality=92)
    horizontal = hooked.resize((1280, 720))
    horizontal.save(horizontal_path, quality=90)
