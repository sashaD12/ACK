from __future__ import annotations

from pathlib import Path

import numpy as np
import requests
from PIL import Image

from ffmpeg_utils import extract_frame, probe_size
from job_io import data_dir

FACE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"
)

_detector = None


def face_model_path() -> Path:
    path = data_dir() / "models" / "blaze_face_short_range.tflite"
    if path.exists() and path.stat().st_size > 0:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    response = requests.get(FACE_MODEL_URL, timeout=120)
    response.raise_for_status()
    path.write_bytes(response.content)
    return path


def _get_detector():
    global _detector
    if _detector is not None:
        return _detector
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import FaceDetector, FaceDetectorOptions

    options = FaceDetectorOptions(
        base_options=BaseOptions(model_asset_path=str(face_model_path())),
        min_detection_confidence=0.4,
    )
    _detector = FaceDetector.create_from_options(options)
    return _detector


def _detect_face_x(image_path: Path) -> float | None:
    try:
        detector = _get_detector()
        import mediapipe as mp

        image = Image.open(image_path).convert("RGB")
        rgb = np.ascontiguousarray(image, dtype=np.uint8)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = detector.detect(mp_image)
        detections = result.detections or []
        if not detections:
            return None
        width = image.width
        best = max(
            detections,
            key=lambda item: (
                item.bounding_box.width * item.bounding_box.height
                if item.bounding_box
                else 0
            ),
        )
        box = best.bounding_box
        if box is None or width <= 0:
            return None
        center = box.origin_x + box.width / 2
        return min(1.0, max(0.0, float(center) / float(width)))
    except Exception:
        return None


def face_center_ratio(source_path: Path, start: float, end: float) -> float:
    samples = 8
    duration = max(0.1, end - start)
    xs: list[float] = []
    tmp_dir = source_path.parent / "tmp_frames"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    for index in range(samples):
        seconds = start + duration * (index + 0.5) / samples
        frame_path = tmp_dir / f"face-{index}.jpg"
        try:
            extract_frame(source_path, seconds, frame_path)
            center = _detect_face_x(frame_path)
            if center is not None:
                xs.append(min(1.0, max(0.0, center)))
        except Exception:
            continue
    if not xs:
        return 0.5
    xs.sort()
    return xs[len(xs) // 2]


def compute_crop(
    width: int,
    height: int,
    center_x_ratio: float,
) -> tuple[int, int, int, int]:
    target_aspect = 9 / 16
    source_aspect = width / height if height else 1
    if source_aspect > target_aspect:
        crop_h = height if height % 2 == 0 else height - 1
        crop_w = int(crop_h * target_aspect)
        if crop_w % 2:
            crop_w -= 1
        max_x = max(0, width - crop_w)
        x = int(center_x_ratio * width - crop_w / 2)
        x = max(0, min(max_x, x))
        if x % 2:
            x = max(0, x - 1)
        return crop_w, crop_h, x, 0
    crop_w = width if width % 2 == 0 else width - 1
    crop_h = int(crop_w / target_aspect)
    if crop_h % 2:
        crop_h -= 1
    max_y = max(0, height - crop_h)
    y = max(0, min(max_y, (height - crop_h) // 2))
    if y % 2:
        y = max(0, y - 1)
    return crop_w, crop_h, 0, y


def crop_for_clip(source_path: Path, start: float, end: float) -> tuple[int, int, int, int]:
    width, height, _duration = probe_size(source_path)
    center = face_center_ratio(source_path, start, end)
    return compute_crop(width, height, center)
