from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

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
    return "\n".join(lines[:4])


def _draw_hook(image: Image.Image, hook: str) -> Image.Image:
    canvas = image.convert("RGB")
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width, height = canvas.size
    draw.rectangle((0, int(height * 0.62), width, height), fill=(0, 0, 0, 160))
    font = _font(max(36, width // 18))
    wrapped = _wrap(draw, hook, font, width - 80)
    draw.multiline_text(
        (40, int(height * 0.68)),
        wrapped,
        font=font,
        fill=(255, 229, 0, 255),
        stroke_width=3,
        stroke_fill=(0, 0, 0, 255),
        spacing=8,
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
    points = [
        start + 0.4,
        start + max(0.5, (end - start) * 0.45),
        max(start, end - 0.6),
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
            score = _contrast(image)
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
