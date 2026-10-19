from __future__ import annotations

from typing import Any

from ollama_client import generate_json


def fallback_metadata(text: str, hook: str) -> dict[str, Any]:
    clean = (hook or text or "Новый клип").strip()
    title = clean[:70]
    tags = ["shorts", "tiktok", "viral", "нарезка"]
    for token in text.replace(",", " ").split():
        token = token.strip("#").lower()
        if len(token) >= 4 and token.isalpha() and token not in tags:
            tags.append(token)
        if len(tags) >= 12:
            break
    caption = f"{title} {' '.join(f'#{tag}' for tag in tags[:8])}"
    return {
        "youtube": {
            "title": title,
            "description": f"{text[:500].strip()}\n\n#Shorts #shorts",
            "tags": tags[:15],
        },
        "tiktok": {
            "caption": caption[:2200],
        },
    }


def generate_metadata(
    model: str,
    text: str,
    hook: str,
    used_titles: list[str] | None = None,
) -> dict[str, Any]:
    used = used_titles or []
    avoid = ""
    if used:
        avoid = "Не повторяй эти title: " + " | ".join(used[:8]) + ".\n"
    prompt = (
        "Ты автор описаний для вирусных Shorts и TikTok. "
        "По тексту клипа сделай метаданные.\n"
        "Верни JSON: {\"youtube\":{\"title\":\"...\",\"description\":\"...\",\"tags\":[\"a\",\"b\"]},\"tiktok\":{\"caption\":\"...\"}}\n"
        "title до 70 символов, любопытный хук, без кавычек и без #Shorts в title. "
        "Первые слова title должны совпадать с тем, что зритель слышит в первые 3 секунды. "
        "Каждый title должен быть уникальным по смыслу. "
        "description 1-2 предложения + хештеги и обязательно #Shorts. "
        "tags 8-15 слов. tiktok.caption — 1 предложение и 5-8 хештегов. Язык как в тексте.\n"
        f"{avoid}"
        f"Хук: {hook}\nТекст клипа:\n{text[:4000]}"
    )
    try:
        payload = generate_json(model, prompt)
        youtube = payload.get("youtube") if isinstance(payload, dict) else None
        tiktok = payload.get("tiktok") if isinstance(payload, dict) else None
        if not isinstance(youtube, dict) or not isinstance(tiktok, dict):
            return fallback_metadata(text, hook)
        tags_raw = youtube.get("tags") or []
        tags = [str(tag).strip() for tag in tags_raw if str(tag).strip()]
        title = str(youtube.get("title") or hook or "Клип")[:100]
        lower_used = {item.lower() for item in used}
        if title.lower() in lower_used and hook:
            title = hook[:70]
        description = str(youtube.get("description") or text)
        if "#Shorts" not in description and "#shorts" not in description:
            description = f"{description.strip()}\n\n#Shorts"
        caption = str(tiktok.get("caption") or title)
        return {
            "youtube": {
                "title": title,
                "description": description[:5000],
                "tags": tags[:15] or ["shorts"],
            },
            "tiktok": {
                "caption": caption[:2200],
            },
        }
    except Exception:
        return fallback_metadata(text, hook)
