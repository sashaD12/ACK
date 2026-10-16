from __future__ import annotations

from typing import Any

from ollama_client import generate_json

AD_MARKERS = (
    "реклама",
    "спонсор",
    "спонсори",
    "интеграция",
    "інтеграція",
    "промокод",
    "промо-код",
    "промо код",
    "promo code",
    "sponsored",
    "sponsor",
    "партнер выпуска",
    "партнер випуску",
    "при поддержке",
    "за підтримки",
    "ссылка в описании",
    "посилання в описі",
    "скидка по промо",
    "используй промокод",
    "використай промокод",
    "рекламная пауза",
    "блок реклами",
    "на правах рекламы",
    "на правах реклами",
)


def _norm(text: str) -> str:
    return " ".join(text.lower().replace("ё", "е").split())


def _is_ad_text(text: str) -> bool:
    haystack = _norm(text)
    return any(marker in haystack for marker in AD_MARKERS)


def merge_ranges(ranges: list[dict[str, Any]], pad: float = 0.8, join_gap: float = 8.0) -> list[dict[str, Any]]:
    if not ranges:
        return []
    ordered = sorted(ranges, key=lambda item: float(item["start"]))
    merged: list[dict[str, Any]] = [dict(ordered[0])]
    for item in ordered[1:]:
        current = merged[-1]
        if float(item["start"]) <= float(current["end"]) + join_gap:
            current["end"] = max(float(current["end"]), float(item["end"]))
            reason = str(current.get("reason") or "")
            extra = str(item.get("reason") or "")
            if extra and extra not in reason:
                current["reason"] = f"{reason}; {extra}".strip("; ")
            continue
        merged.append(dict(item))
    cleaned: list[dict[str, Any]] = []
    for item in merged:
        start = max(0.0, float(item["start"]) - pad)
        end = float(item["end"]) + pad
        if end - start < 1.5:
            continue
        cleaned.append(
            {
                "start": round(start, 2),
                "end": round(end, 2),
                "reason": str(item.get("reason") or "Реклама автора"),
            }
        )
    return cleaned


def keyword_ads(transcript: dict[str, Any]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for segment in transcript.get("segments") or []:
        text = str(segment.get("text") or "").strip()
        if not text or not _is_ad_text(text):
            continue
        found.append(
            {
                "start": float(segment.get("start") or 0),
                "end": float(segment.get("end") or 0),
                "reason": text[:140],
            }
        )
    return merge_ranges(found)


def llm_ads(transcript: dict[str, Any], model: str) -> list[dict[str, Any]]:
    from highlights import numbered_transcript

    prompt = (
        "Найди в транскрипте авторскую рекламу внутри ролика: спонсорские интеграции, "
        "промокоды, блоки со словом реклама, продажа своего курса/бота если это явная реклама, "
        "партнерские вставки. Не помечай обычный контент и случайные упоминания брендов.\n"
        "Верни JSON {\"ads\":[{\"start\":12.0,\"end\":48.5,\"reason\":\"промокод спонсора\"}]}. "
        "Если рекламы нет — {\"ads\":[]}. start/end в секундах из транскрипта.\n\n"
        f"Транскрипт:\n{numbered_transcript(transcript)}"
    )
    payload = generate_json(model, prompt)
    raw = payload.get("ads") if isinstance(payload, dict) else payload
    if not isinstance(raw, list):
        return []
    found: list[dict[str, Any]] = []
    duration = float(transcript.get("duration") or 0)
    for item in raw:
        if not isinstance(item, dict):
            continue
        start = float(item.get("start") or 0)
        end = float(item.get("end") or 0)
        if end <= start:
            continue
        if duration > 0:
            end = min(end, duration)
        found.append(
            {
                "start": max(0.0, start),
                "end": end,
                "reason": str(item.get("reason") or "Реклама автора")[:200],
            }
        )
    return merge_ranges(found)


def detect_ads(transcript: dict[str, Any], model: str) -> list[dict[str, Any]]:
    found = keyword_ads(transcript)
    try:
        found.extend(llm_ads(transcript, model))
    except Exception:
        pass
    return merge_ranges(found)


def overlaps(start: float, end: float, ads: list[dict[str, Any]]) -> bool:
    for ad in ads:
        if start < float(ad["end"]) and float(ad["start"]) < end:
            return True
    return False


def subtract_ads(start: float, end: float, ads: list[dict[str, Any]]) -> list[tuple[float, float]]:
    pieces = [(start, end)]
    for ad in ads:
        ad_start = float(ad["start"])
        ad_end = float(ad["end"])
        next_pieces: list[tuple[float, float]] = []
        for piece_start, piece_end in pieces:
            if piece_end <= ad_start or piece_start >= ad_end:
                next_pieces.append((piece_start, piece_end))
                continue
            if piece_start < ad_start:
                next_pieces.append((piece_start, ad_start))
            if piece_end > ad_end:
                next_pieces.append((ad_end, piece_end))
        pieces = next_pieces
    return [(round(a, 2), round(b, 2)) for a, b in pieces if b - a >= 1]


def clean_highlight(
    start: float,
    end: float,
    ads: list[dict[str, Any]],
    min_duration: float,
) -> tuple[float, float] | None:
    if not ads:
        return (start, end)
    pieces = subtract_ads(start, end, ads)
    if not pieces:
        return None
    best = max(pieces, key=lambda item: item[1] - item[0])
    if best[1] - best[0] < min_duration:
        return None
    return best
