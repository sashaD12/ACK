from __future__ import annotations

from pathlib import Path
from typing import Any


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


def words_in_range(
    words: list[dict[str, Any]],
    start: float,
    end: float,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for word in words:
        word_start = float(word["start"])
        word_end = float(word["end"])
        if word_end <= start or word_start >= end:
            continue
        selected.append(
            {
                "word": str(word["word"]),
                "start": max(start, word_start) - start,
                "end": min(end, word_end) - start,
            }
        )
    return selected


def write_ass(path: Path, words: list[dict[str, Any]]) -> None:
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,72,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,0,2,50,50,260,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    if not words:
        path.write_text("".join(lines), encoding="utf-8")
        return
    window = 6
    for index, word in enumerate(words):
        from_index = max(0, index - 2)
        to_index = min(len(words), from_index + window)
        parts: list[str] = []
        for cursor in range(from_index, to_index):
            token = escape_ass(str(words[cursor]["word"]))
            if cursor == index:
                parts.append(r"{\c&H00E5FF&\fs84}" + token + r"{\r}")
            else:
                parts.append(token)
        text = " ".join(parts)
        start = ass_time(float(word["start"]))
        end = ass_time(max(float(word["end"]), float(word["start"]) + 0.12))
        lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}\n")
    path.write_text("".join(lines), encoding="utf-8")
