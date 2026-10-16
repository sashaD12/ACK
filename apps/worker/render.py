from __future__ import annotations

from pathlib import Path

from ffmpeg_utils import ffmpeg_bin, run


def render_clip(
    source_path: Path,
    output_path: Path,
    start: float,
    end: float,
    crop_w: int,
    crop_h: int,
    crop_x: int,
    crop_y: int,
    ass_path: Path,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ass_relative = ass_path.name
    vf = (
        f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},"
        "scale=1080:1920:flags=lanczos,"
        f"ass={ass_relative}"
    )
    args = [
        ffmpeg_bin(),
        "-y",
        "-ss",
        f"{start:.3f}",
        "-to",
        f"{end:.3f}",
        "-i",
        str(source_path),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "21",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        "-pix_fmt",
        "yuv420p",
        str(output_path),
    ]
    try:
        run(args, cwd=ass_path.parent)
    except RuntimeError:
        args[args.index("-vf") + 1] = f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale=1080:1920:flags=lanczos"
        run(args, cwd=ass_path.parent)
