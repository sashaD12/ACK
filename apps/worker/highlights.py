from __future__ import annotations

import re
from typing import Any

from ads import clean_highlight
from ollama_client import generate_json
from transcribe import flatten_words, transcript_window

SENTENCE_END = (".", "!", "?", "…")
HOOK_MARKERS = (
    "почему",
    "зачем",
    "как так",
    "на самом деле",
    "правда",
    "никто",
    "сенсац",
    "шок",
    "срочно",
    "признал",
    "провал",
    "разоблач",
    "секрет",
    "главное",
    "вот почему",
    "оказ",
    "смотри",
    "внимание",
    "скандал",
    "обман",
    "цифр",
    "процент",
    "миллион",
    "breaking",
    "actually",
    "nobody",
    "secret",
    "wait",
)
DEAD_MARKERS = (
    "подписыв",
    "лайк",
    "колокольчик",
    "ссылка в описании",
    "посилання в описі",
    "всем привет",
    "всем здравств",
    "до новых",
    "спасибо за просмотр",
    "мои книги",
    "магазин",
    "промокод",
    "реклама",
    "ставьте",
    "ставте",
    "на канале",
)


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


def cut_times(words: list[dict[str, Any]]) -> list[float]:
    if not words:
        return []
    times = [float(words[0]["start"])]
    for index in range(1, len(words)):
        prev = words[index - 1]
        current = words[index]
        gap = float(current["start"]) - float(prev["end"])
        token = str(prev.get("word") or "").strip()
        if gap >= 0.32 or token.endswith(SENTENCE_END):
            times.append(float(current["start"]))
    times.append(float(words[-1]["end"]))
    unique: list[float] = []
    for stamp in times:
        if not unique or abs(unique[-1] - stamp) > 0.08:
            unique.append(stamp)
    return unique


def nearest_cut(times: list[float], target: float) -> float:
    if not times:
        return target
    return min(times, key=lambda stamp: abs(stamp - target))


def first_hook(text: str) -> str:
    clean = " ".join(text.split()).strip()
    if not clean:
        return "Смотри дальше"
    for separator in (". ", "! ", "? ", "… "):
        if separator in clean[:140]:
            clean = clean.split(separator, 1)[0]
            break
    return clean[:80].strip()


def opening_has_punch(text: str) -> bool:
    head = text.lower()[:220]
    if "?" in head or "!" in head:
        return True
    return any(marker in head for marker in HOOK_MARKERS)


def score_window(
    text: str,
    start: float,
    end: float,
    total: float,
    hook: str = "",
) -> float:
    length = end - start
    blob = f"{hook} {text}".lower()
    score = 40.0
    if 18 <= length <= 180:
        score += 28
    elif 15 <= length < 18:
        score += 14
    elif length > 200:
        score -= 24
    elif length > 180:
        score -= 10
    if start < 18:
        score -= 12
    if total > 0 and end > total - 25:
        score -= 10
    head = blob[:220]
    score += 8 * sum(1 for marker in HOOK_MARKERS if marker in head)
    score -= 14 * sum(1 for marker in DEAD_MARKERS if marker in blob)
    tokens = [token for token in text.split() if len(token) > 2]
    if len(tokens) < 12:
        score -= 15
    unique = len({token.lower() for token in tokens})
    if tokens:
        score += min(12.0, unique / len(tokens) * 12)
    if "?" in head or "!" in head:
        score += 6
    if opening_has_punch(text[:180] if text else ""):
        score += 12
    else:
        score -= 8
    return round(score, 2)


def overlap_ratio(left: dict[str, Any], right: dict[str, Any]) -> float:
    inter = max(
        0.0,
        min(float(left["end"]), float(right["end"]))
        - max(float(left["start"]), float(right["start"])),
    )
    length = min(
        float(left["end"]) - float(left["start"]),
        float(right["end"]) - float(right["start"]),
    )
    if length <= 0:
        return 0.0
    return inter / length


def hook_tokens(text: str) -> set[str]:
    parts = re.findall(r"[a-zA-Zа-яА-ЯёЁіїєґ0-9]{3,}", (text or "").lower())
    return set(parts)


def hook_similarity(left: str, right: str) -> float:
    a = hook_tokens(left)
    b = hook_tokens(right)
    if not a or not b:
        return 0.0
    return len(a & b) / float(max(len(a), len(b)))


def snap_window(
    start: float,
    end: float,
    cuts: list[float],
    min_duration: float,
    max_duration: float,
    total: float,
) -> tuple[float, float] | None:
    snapped_start = max(0.0, nearest_cut(cuts, start) if cuts else start)
    snapped_end = nearest_cut(cuts, end) if cuts else end
    if snapped_end - snapped_start < min_duration:
        snapped_end = min(total, snapped_start + min_duration)
        snapped_end = nearest_cut(cuts, snapped_end) if cuts else snapped_end
        if snapped_end - snapped_start < min_duration:
            snapped_end = min(total, snapped_start + min_duration)
    if snapped_end - snapped_start > max_duration:
        snapped_end = nearest_cut(cuts, snapped_start + max_duration) if cuts else snapped_start + max_duration
        if snapped_end - snapped_start > max_duration + 1.2:
            snapped_end = snapped_start + max_duration
    snapped_end = min(snapped_end, total if total > 0 else snapped_end)
    if snapped_end - snapped_start < max(8.0, min_duration * 0.7):
        return None
    return round(snapped_start, 2), round(snapped_end, 2)


def align_start_to_hook(
    words: list[dict[str, Any]],
    start: float,
    end: float,
    cuts: list[float],
    min_duration: float,
    max_duration: float,
    total: float,
) -> tuple[float, float]:
    head = transcript_window(words, start, min(end, start + 2.0))
    if opening_has_punch(head):
        return start, end
    search_until = min(end - min_duration * 0.85, start + 14.0)
    if search_until <= start:
        return start, end
    candidates = [stamp for stamp in cuts if start - 0.05 <= stamp <= search_until + 0.05]
    if not candidates:
        candidates = [start + offset for offset in (1.0, 2.0, 3.5, 5.0, 7.0) if start + offset < search_until]
    best: tuple[float, float] | None = None
    best_score = -1.0
    for candidate_start in candidates:
        snapped = snap_window(
            candidate_start,
            end,
            cuts,
            min_duration,
            max_duration,
            total,
        )
        if snapped is None:
            continue
        open_text = transcript_window(words, snapped[0], min(snapped[1], snapped[0] + 2.0))
        if not opening_has_punch(open_text):
            continue
        text = transcript_window(words, snapped[0], snapped[1])
        score = score_window(text, snapped[0], snapped[1], total, first_hook(text))
        if score > best_score:
            best_score = score
            best = snapped
    if best is None:
        return start, end
    return best


def pick_best(candidates: list[dict[str, Any]], max_clips: int) -> list[dict[str, Any]]:
    ordered = sorted(candidates, key=lambda item: -float(item.get("score") or 0))
    picked: list[dict[str, Any]] = []
    for item in ordered:
        too_close = False
        for current in picked:
            mid_a = (float(item["start"]) + float(item["end"])) / 2
            mid_b = (float(current["start"]) + float(current["end"])) / 2
            if overlap_ratio(item, current) > 0.16 or abs(mid_a - mid_b) < 10:
                too_close = True
                break
            if hook_similarity(str(item.get("hook") or ""), str(current.get("hook") or "")) > 0.55:
                too_close = True
                break
            thesis_a = hook_tokens(str(item.get("hook") or "") + " " + str(item.get("reason") or ""))
            thesis_b = hook_tokens(str(current.get("hook") or "") + " " + str(current.get("reason") or ""))
            if thesis_a and thesis_b and len(thesis_a & thesis_b) / float(max(len(thesis_a), len(thesis_b))) > 0.62:
                too_close = True
                break
        if too_close:
            continue
        picked.append(item)
        if len(picked) >= max_clips:
            break
    picked.sort(key=lambda item: -float(item.get("score") or 0))
    if not picked:
        return []
    best_score = float(picked[0].get("score") or 0)
    floor = min(55.0, best_score * 0.5)
    strong = [picked[0]]
    for item in picked[1:]:
        if float(item.get("score") or 0) >= floor:
            strong.append(item)
    return strong


def candidate_from_window(
    words: list[dict[str, Any]],
    start: float,
    end: float,
    total: float,
    reason: str,
    bonus: float = 0.0,
) -> dict[str, Any] | None:
    text = transcript_window(words, start, end)
    hook = first_hook(text)
    score = score_window(text, start, end, total, hook) + bonus
    if score < 18:
        return None
    return {
        "start": round(start, 2),
        "end": round(end, 2),
        "hook": hook,
        "reason": reason,
        "score": round(score, 2),
    }


def scored_candidates(
    transcript: dict[str, Any],
    min_duration: float,
    max_duration: float,
    ads: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    words = flatten_words(transcript)
    total = float(transcript.get("duration") or 0)
    if not words:
        return []
    cuts = cut_times(words)
    targets = [20.0, 32.0, 45.0, 60.0, 90.0, 120.0, 150.0, 180.0]
    targets = [item for item in targets if item <= max_duration + 0.5]
    if max_duration >= 20 and max_duration not in targets:
        targets.append(max_duration)
    targets = sorted(set(targets))
    found: list[dict[str, Any]] = []
    for start in cuts[:-1]:
        for target in targets:
            raw_end = start + target
            if total > 0 and raw_end > total:
                continue
            snapped = snap_window(start, raw_end, cuts, min_duration, max_duration, total)
            if snapped is None:
                continue
            window = snapped
            if ads:
                cleaned = clean_highlight(window[0], window[1], ads, min_duration)
                if cleaned is None:
                    continue
                window = cleaned
            aligned = align_start_to_hook(
                words,
                window[0],
                window[1],
                cuts,
                min_duration,
                max_duration,
                total,
            )
            item = candidate_from_window(
                words,
                aligned[0],
                aligned[1],
                total,
                "Ударный кусок по хуку и паузе",
            )
            if item is not None:
                found.append(item)
    return found


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
        length = max_duration
        while cursor < duration - min_duration and len(clips) < max_clips:
            end = min(duration, cursor + length)
            clips.append(
                {
                    "start": round(cursor, 2),
                    "end": round(end, 2),
                    "hook": "Смотри, что дальше",
                    "reason": "Равномерная нарезка без транскрипта",
                    "score": 20.0,
                }
            )
            cursor += length + 12.0
        return clips[:max_clips]
    candidates = scored_candidates(transcript, min_duration, max_duration, ads)
    picked = pick_best(candidates, max_clips)
    if picked:
        return polish_highlights(picked, transcript, min_duration, max_duration, ads)
    return _apply_ads(
        [
            {
                "start": round(float(words[0]["start"]), 2),
                "end": round(
                    min(
                        float(words[-1]["end"]),
                        float(words[0]["start"]) + max_duration,
                    ),
                    2,
                ),
                "hook": first_hook(transcript_window(words, float(words[0]["start"]), float(words[-1]["end"]))),
                "reason": "Запасной клип",
                "score": 25.0,
            }
        ],
        ads,
        min_duration,
        max_clips,
    )


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
        item = dict(clip)
        item["start"] = window[0]
        item["end"] = window[1]
        cleaned.append(item)
        if len(cleaned) >= max_clips:
            break
    return cleaned


def polish_highlights(
    clips: list[dict[str, Any]],
    transcript: dict[str, Any],
    min_duration: float,
    max_duration: float,
    ads: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    words = flatten_words(transcript)
    cuts = cut_times(words)
    total = float(transcript.get("duration") or 0)
    polished: list[dict[str, Any]] = []
    for clip in clips:
        start = float(clip["start"])
        end = float(clip["end"])
        aligned = align_start_to_hook(
            words,
            start,
            end,
            cuts,
            min_duration,
            max_duration,
            total,
        )
        if ads:
            cleaned = clean_highlight(aligned[0], aligned[1], ads, min_duration)
            if cleaned is None:
                continue
            aligned = cleaned
        text = transcript_window(words, aligned[0], aligned[1])
        hook = str(clip.get("hook") or first_hook(text)).strip()[:120] or first_hook(text)
        score = score_window(text, aligned[0], aligned[1], total, hook)
        if float(clip.get("score") or 0) > score:
            score = float(clip.get("score") or 0)
        polished.append(
            {
                "start": round(aligned[0], 2),
                "end": round(aligned[1], 2),
                "hook": hook,
                "reason": str(clip.get("reason") or "Хук из речи").strip()[:300],
                "score": round(score, 2),
            }
        )
    return pick_best(polished, len(polished) or 1) if polished else []


def select_highlights(
    transcript: dict[str, Any],
    model: str,
    min_duration: float,
    max_duration: float,
    max_clips: int,
    ads: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    words = flatten_words(transcript)
    cuts = cut_times(words)
    total = float(transcript.get("duration") or 0)
    ad_note = ""
    if ads:
        parts = [f"{item['start']}-{item['end']}" for item in ads]
        ad_note = (
            "Не бери фрагменты, которые пересекаются с рекламой автора: "
            + ", ".join(parts)
            + ".\n"
        )
    prompt = (
        "Ты монтажёр вирусных Shorts. Выбери САМОСТОЯТЕЛЬНЫЕ ударные куски, не нарезку подряд.\n"
        f"Нужно от 1 до {max_clips} лучших клипов, лучше 2-3 сильных, чем много слабых.\n"
        f"Длительность {min_duration:.0f}-{max_duration:.0f} секунд. Хук обязан быть в первой фразе: "
        "вопрос, конфликт, цифра, признание или неожиданный факт.\n"
        "start — ровно начало ударной фразы, зритель должен услышать хук в первые 1.5 секунды.\n"
        "Не бери приветствие, рекламу, призыв подписаться, середину мысли, концовку «ставьте лайк».\n"
        "Клипы из разных частей видео, разные тезисы, пересечение меньше 10%.\n"
        f"{ad_note}"
        "Верни JSON {\"clips\":[{\"start\":12.3,\"end\":41.0,\"hook\":\"короткий хук\",\"reason\":\"почему свайпнут\",\"score\":80}]}\n"
        "hook до 70 символов, как заголовок шортса. Язык хука — язык речи.\n\n"
        f"Транскрипт:\n{numbered_transcript(transcript)}"
    )
    llm_clips: list[dict[str, Any]] = []
    try:
        payload = generate_json(model, prompt)
        raw_clips = payload.get("clips") if isinstance(payload, dict) else payload
        if isinstance(raw_clips, list):
            for item in raw_clips:
                if not isinstance(item, dict):
                    continue
                start = float(item.get("start") or 0)
                end = float(item.get("end") or 0)
                if end <= start:
                    continue
                snapped = snap_window(start, end, cuts, min_duration, max_duration, total)
                if snapped is None:
                    continue
                window = snapped
                if ads:
                    cleaned = clean_highlight(window[0], window[1], ads, min_duration)
                    if cleaned is None:
                        continue
                    window = cleaned
                aligned = align_start_to_hook(
                    words,
                    window[0],
                    window[1],
                    cuts,
                    min_duration,
                    max_duration,
                    total,
                )
                text = transcript_window(words, aligned[0], aligned[1])
                hook = str(item.get("hook") or first_hook(text)).strip()[:120]
                reason = str(item.get("reason") or "Хук из речи").strip()[:300]
                score = score_window(text, aligned[0], aligned[1], total, hook) + 10
                llm_clips.append(
                    {
                        "start": aligned[0],
                        "end": aligned[1],
                        "hook": hook or first_hook(text),
                        "reason": reason,
                        "score": round(score, 2),
                    }
                )
    except Exception:
        llm_clips = []
    local = scored_candidates(transcript, min_duration, max_duration, ads)
    merged = pick_best(llm_clips + local, max_clips)
    if merged:
        polished = polish_highlights(
            merged,
            transcript,
            min_duration,
            max_duration,
            ads,
        )
        if polished:
            return polished
        return merged
    return fallback_highlights(transcript, min_duration, max_duration, max_clips, ads)
