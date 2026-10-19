from __future__ import annotations

from pathlib import Path
from typing import Any

from ffmpeg_utils import extract_frame, ffmpeg_bin, probe_duration, run
from visuals import beat_timeline


def ass_time(seconds: float) -> str:
    total = max(0.0, seconds)
    hours = int(total // 3600)
    minutes = int((total % 3600) // 60)
    secs = total % 60
    return f"{hours}:{minutes:02d}:{secs:05.2f}"


def escape_ass(text: str) -> str:
    return (
        text.replace("\\", r"\\")
        .replace("{", r"\{")
        .replace("}", r"\}")
        .replace("\n", " ")
    )


def wrap_ass_line(text: str, width: int = 38) -> str:
    words = escape_ass((text or "").strip()).split()
    if not words:
        return ""
    lines: list[str] = []
    current = ""
    for word in words:
        trial = word if not current else f"{current} {word}"
        if len(trial) <= width:
            current = trial
            continue
        if current:
            lines.append(current)
        current = word
        if len(lines) >= 2:
            current = ""
            break
    if current and len(lines) < 2:
        lines.append(current)
    if not lines:
        return words[0][:width]
    if len(lines[-1]) > width:
        lines[-1] = lines[-1][: width - 1].rstrip() + "…"
    return "\\N".join(lines[:2])


def write_ass(
    path: Path,
    hook: str,
    beats: list[dict[str, Any]],
    audio_duration: float,
) -> None:
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 1
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,62,&H00FFFFFF,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,5,2,2,70,70,240,1
Style: Hook,Arial Black,70,&H0000E5FF,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,5,2,8,70,70,100,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    hook_text = wrap_ass_line((hook or "").strip()[:90], 34)
    if hook_text:
        lines.append(
            f"Dialogue: 1,{ass_time(0)},{ass_time(min(2.6, audio_duration))},Hook,,0,0,0,,{{\\fad(80,180)}}{hook_text}\n"
        )
    for start, end, beat in beat_timeline(beats, audio_duration):
        text = wrap_ass_line(str(beat.get("text") or "").strip()[:140], 38)
        if text and end > start:
            lines.append(
                f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{text}\n"
            )
    path.write_text("".join(lines), encoding="utf-8")


def render_studio_video(
    visuals: list[tuple[Path, float]],
    audio_path: Path,
    ass_path: Path,
    output_path: Path,
    thumb_path: Path,
    hook: str,
    beats: list[dict[str, Any]],
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    audio_duration = probe_duration(audio_path)
    if audio_duration <= 0.5:
        raise RuntimeError("Audio duration is too short")
    write_ass(ass_path, hook, beats, audio_duration)

    work = output_path.parent / "tmp_visuals"
    work.mkdir(parents=True, exist_ok=True)
    normalized: list[Path] = []
    remaining = audio_duration
    for index, (source, seconds) in enumerate(visuals):
        take = min(max(2.0, seconds), remaining + 0.5)
        if remaining <= 0.2:
            break
        target = work / f"norm-{index:02d}.mp4"
        run(
            [
                ffmpeg_bin(),
                "-y",
                "-stream_loop",
                "-1",
                "-i",
                str(source.resolve()),
                "-t",
                f"{take:.3f}",
                "-vf",
                "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                str(target),
            ]
        )
        normalized.append(target)
        remaining -= take

    if not normalized:
        raise RuntimeError("No visual segments")

    list_file = work / "concat.txt"
    lines: list[str] = []
    for path in normalized:
        escaped = path.resolve().as_posix().replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
    list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    concat_path = work / "concat.mp4"
    run(
        [
            ffmpeg_bin(),
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c",
            "copy",
            str(concat_path),
        ]
    )

    ass_name = ass_path.name
    run(
        [
            ffmpeg_bin(),
            "-y",
            "-i",
            str(concat_path.resolve()),
            "-i",
            str(audio_path.resolve()),
            "-t",
            f"{audio_duration:.3f}",
            "-vf",
            (
                f"ass={ass_name},"
                f"drawbox=x=0:y=ih-8:w=iw*t/{audio_duration:.3f}:h=8:color=0xFBBF24@0.9:t=fill,"
                "fade=t=in:st=0:d=0.12,"
                f"fade=t=out:st={max(0.2, audio_duration - 0.35):.3f}:d=0.35"
            ),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "20",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-shortest",
            "-movflags",
            "+faststart",
            "-pix_fmt",
            "yuv420p",
            str(output_path.resolve()),
        ],
        cwd=ass_path.parent,
    )
    extract_frame(output_path, min(1.0, audio_duration / 3), thumb_path)
