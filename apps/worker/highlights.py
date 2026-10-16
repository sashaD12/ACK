from __future__ import annotations

from typing import Any

from ads import clean_highlight
from ollama_client import generate_json
from transcribe import flatten_words, transcript_window


def numbered_transcript(transcript: dict[str, Any], limit: int = 18000) -> str:
    lines: list[str] = []
    for segment in transcript.get("segments") or []:
        text = str(segment.get("text") or "").strip()
        if not text:
            continue
        start = float(segment.get("start") or 0)
        end = float(segment.get("end") or 0)
        lines.append(f"[{start:.1f}-{end:.1f}] {text}")
    joined = "\n".join(lines)
    return joined[:limit]


def fallback_highlights(
    transcript: dict[str, Any],
    min_duration: float,
    max_duration: float,
    max_clips: int,
    ads: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    words = flatten_words(transcript)
    if not words:
        duration = float(transcript.get("duration") or 60)
        clips: list[dict[str, Any]] = []
        cursor = 0.0
        while cursor < duration - min_duration and len(clips) < max_clips:
            end = min(duration, cursor + max_duration)
            clips.append(
                {
                    "start": round(cursor, 2),
                    "end": round(end, 2),
                    "hook": "Смотри, что дальше",
                    "reason": "Равномерная нарезка без транскрипта",
                }
            )
            cursor += max_duration
        return _apply_ads(clips, ads, min_duration, max_clips)

    clips: list[dict[str, Any]] = []
    index = 0
    while index < len(words) and len(clips) < max_clips:
        start = float(words[index]["start"])
        end = start
        cursor = index
        while cursor < len(words):
            candidate_end = float(words[cursor]["end"])
            if candidate_end - start > max_duration:
                break
            end = candidate_end
            cursor += 1
        if end - start < min_duration:
            while cursor < len(words) and end - start < min_duration:
                end = float(words[cursor]["end"])
                cursor += 1
        text = transcript_window(words, start, end)
        hook = text[:80].strip() or "Смотри дальше"
        clips.append(
            {
                "start": round(start, 2),
                "end": round(end, 2),
                "hook": hook,
                "reason": "Автонарезка по длительности",
            }
        )
        index = max(cursor, index + 1)
    return _apply_ads(clips, ads, min_duration, max_clips)


def _apply_ads(
    clips: list[dict[str, Any]],
    ads: list[dict[str, Any]] | None,
    min_duration: float,
    max_clips: int,
) -> list[dict[str, Any]]:
    if not ads:
        return clips[:max_clips]
    cleaned: list[dict[str, Any]] = []
    for clip in clips:
        window = clean_highlight(float(clip["start"]), float(clip["end"]), ads, min_duration)
        if window is None:
            continue
        clip = dict(clip)
        clip["start"] = window[0]
        clip["end"] = window[1]
        cleaned.append(clip)
        if len(cleaned) >= max_clips:
            break
    return cleaned


def select_highlights(
    transcript: dict[str, Any],
    model: str,
    min_duration: float,
    max_duration: float,
    max_clips: int,
    ads: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    ad_note = ""
    if ads:
        parts = [f"{item['start']}-{item['end']}" for item in ads]
        ad_note = (
            "Не бери фрагменты, которые пересекаются с рекламой автора: "
            + ", ".join(parts)
            + ".\n"
        )
    prompt = (
        "Ты редактор вирусных роликов для TikTok и YouTube Shorts. "
        "По транскрипту длинного видео выбери самые цепляющие самодостаточные фрагменты.\n"
        f"Нужно от 3 до {max_clips} клипов длительностью от {min_duration} до {max_duration} секунд.\n"
        "У каждого клипа хук должен быть в первые 3 секунды. Клипы не должны сильно пересекаться.\n"
        f"{ad_note}"
        "Верни JSON вида {\"clips\":[{\"start\":12.3,\"end\":48.0,\"hook\":\"короткий хук\",\"reason\":\"почему вирусно\"}]}\n"
        "start и end — секунды из транскрипта. Язык хука — язык речи.\n\n"
        f"Транскрипт:\n{numbered_transcript(transcript)}"
    )
    try:
        payload = generate_json(model, prompt)
        raw_clips = payload.get("clips") if isinstance(payload, dict) else payload
        if not isinstance(raw_clips, list):
            return fallback_highlights(transcript, min_duration, max_duration, max_clips, ads)
        cleaned: list[dict[str, Any]] = []
        duration = float(transcript.get("duration") or 0)
        for item in raw_clips:
            if not isinstance(item, dict):
                continue
            start = float(item.get("start") or 0)
            end = float(item.get("end") or 0)
            if end <= start:
                continue
            length = end - start
            if length < min_duration:
                end = start + min_duration
            if length > max_duration + 8:
                end = start + max_duration
            if duration > 0:
                end = min(end, duration)
            cleaned.append(
                {
                    "start": round(max(0.0, start), 2),
                    "end": round(end, 2),
                    "hook": str(item.get("hook") or "Смотри это").strip()[:120],
                    "reason": str(item.get("reason") or "").strip()[:300],
                }
            )
        cleaned = _apply_ads(cleaned, ads, min_duration, max_clips)
        if cleaned:
            return cleaned
    except Exception:
        pass
    return fallback_highlights(transcript, min_duration, max_duration, max_clips, ads)
