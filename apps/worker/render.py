from __future__ import annotations

from pathlib import Path

from ffmpeg_utils import ffmpeg_bin, run
from music import ensure_bed, music_offset

RENDER_STYLE = "montage-v1"


def _video_filter(
    crop_w: int,
    crop_h: int,
    crop_x: int,
    crop_y: int,
    duration: float,
    ass_relative: str,
    montage: bool,
    with_ass: bool,
) -> str:
    base = f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}"
    if montage:
        move = max(duration, 0.2)
        vf = (
            f"{base},"
            "scale=1188:2112:flags=lanczos,"
            f"crop=1080:1920:min(in_w-1080\\,108*t/{move:.3f}):(in_h-1920)/2,"
            "eq=contrast=1.08:saturation=1.16:gamma=0.98,"
            "unsharp=5:5:0.55:3:3:0.25,"
            f"drawbox=x=0:y=ih-10:w=iw*t/{move:.3f}:h=10:color=0xFBBF24@0.92:t=fill,"
            "fade=t=in:st=0:d=0.18,"
            f"fade=t=out:st={max(0.2, duration - 0.35):.3f}:d=0.35"
        )
    else:
        vf = f"{base},scale=1080:1920:flags=lanczos"
    if with_ass:
        vf = f"{vf},ass={ass_relative}"
    return vf


def _run_render(
    source_path: Path,
    output_path: Path,
    start: float,
    end: float,
    vf: str,
    cwd: Path,
    music_path: Path | None,
    clip_id: str,
    duration: float,
) -> None:
    args = [
        ffmpeg_bin(),
        "-y",
        "-ss",
        f"{start:.3f}",
        "-to",
        f"{end:.3f}",
        "-i",
        str(source_path.resolve()),
    ]
    if music_path is not None:
        args.extend(
            [
                "-stream_loop",
                "-1",
                "-ss",
                f"{music_offset(clip_id):.3f}",
                "-i",
                str(music_path.resolve()),
                "-t",
                f"{duration:.3f}",
                "-filter_complex",
                (
                    f"[0:v]{vf}[v];"
                    f"[1:a]atrim=0:{duration:.3f},asetpts=PTS-STARTPTS,volume=0.13,"
                    f"afade=t=in:st=0:d=0.5,afade=t=out:st={max(0.4, duration - 0.8):.3f}:d=0.8[bed];"
                    "[0:a]volume=1.08,highpass=f=70,afade=t=in:st=0:d=0.06,asplit=2[voice][sc];"
                    "[bed][sc]sidechaincompress=threshold=0.06:ratio=7:attack=25:release=280:makeup=2[ducked];"
                    "[voice][ducked]amix=inputs=2:duration=first:dropout_transition=2,alimiter=limit=0.95[a]"
                ),
                "-map",
                "[v]",
                "-map",
                "[a]",
            ]
        )
    else:
        args.extend(["-vf", vf])
    args.extend(
        [
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
            str(output_path.resolve()),
        ]
    )
    run(args, cwd=cwd)


def _run_render_simple_mix(
    source_path: Path,
    output_path: Path,
    start: float,
    end: float,
    vf: str,
    cwd: Path,
    music_path: Path,
    clip_id: str,
    duration: float,
) -> None:
    args = [
        ffmpeg_bin(),
        "-y",
        "-ss",
        f"{start:.3f}",
        "-to",
        f"{end:.3f}",
        "-i",
        str(source_path.resolve()),
        "-stream_loop",
        "-1",
        "-ss",
        f"{music_offset(clip_id):.3f}",
        "-i",
        str(music_path.resolve()),
        "-t",
        f"{duration:.3f}",
        "-filter_complex",
        (
            f"[0:v]{vf}[v];"
            f"[1:a]atrim=0:{duration:.3f},asetpts=PTS-STARTPTS,volume=0.12,"
            f"afade=t=in:st=0:d=0.5,afade=t=out:st={max(0.4, duration - 0.8):.3f}:d=0.8[bed];"
            "[0:a]volume=1.08,highpass=f=70[voice];"
            "[voice][bed]amix=inputs=2:duration=first:dropout_transition=2,alimiter=limit=0.95[a]"
        ),
        "-map",
        "[v]",
        "-map",
        "[a]",
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
        str(output_path.resolve()),
    ]
    run(args, cwd=cwd)


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
    clip_id: str = "clip",
    add_music: bool = True,
    montage: bool = True,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    duration = max(0.3, end - start)
    ass_relative = ass_path.name
    cwd = ass_path.parent
    music_path: Path | None = None
    if add_music:
        try:
            music_path = ensure_bed()
        except Exception:
            music_path = None
    attempts: list[tuple[bool, bool, Path | None]] = [
        (montage, True, music_path),
        (montage, True, None),
        (False, True, None),
        (False, False, None),
    ]
    last_error: Exception | None = None
    seen: set[tuple[bool, bool, str]] = set()
    for use_montage, with_ass, bed in attempts:
        key = (use_montage, with_ass, str(bed) if bed else "")
        if key in seen:
            continue
        seen.add(key)
        vf = _video_filter(
            crop_w,
            crop_h,
            crop_x,
            crop_y,
            duration,
            ass_relative,
            use_montage,
            with_ass,
        )
        try:
            if bed is not None:
                try:
                    _run_render(
                        source_path,
                        output_path,
                        start,
                        end,
                        vf,
                        cwd,
                        bed,
                        clip_id,
                        duration,
                    )
                    return
                except RuntimeError:
                    _run_render_simple_mix(
                        source_path,
                        output_path,
                        start,
                        end,
                        vf,
                        cwd,
                        bed,
                        clip_id,
                        duration,
                    )
                    return
            _run_render(
                source_path,
                output_path,
                start,
                end,
                vf,
                cwd,
                None,
                clip_id,
                duration,
            )
            return
        except Exception as error:
            last_error = error
            continue
    if last_error is not None:
        raise last_error
    raise RuntimeError("Clip render failed")
