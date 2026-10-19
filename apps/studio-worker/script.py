from __future__ import annotations

from typing import Any

from news import sources_brief
from ollama_client import generate_json


def fallback_script(
    topic: str,
    duration_sec: float,
    language: str,
    sources: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    hook = topic.strip()[:70] or "Смотри дальше"
    beat_count = max(3, min(6, int(duration_sec // 7)))
    per = round(duration_sec / beat_count, 1)
    beats: list[dict[str, Any]] = []
    source_bits = [
        str(item.get("title") or "").strip()
        for item in (sources or [])
        if str(item.get("title") or "").strip()
    ]
    moods = ("urgent", "briefing", "map", "numbers")
    for index in range(beat_count):
        mood = moods[index % len(moods)]
        if language == "en":
            bit = source_bits[index] if index < len(source_bits) else f"{topic}. Point {index + 1}."
            query = f"{mood} political news"
        else:
            bit = source_bits[index] if index < len(source_bits) else f"{topic}. Факт {index + 1}."
            query = f"{mood} политика новость"
        short = bit.split(".")[0].strip()[:72] or bit[:72]
        beats.append({"text": short, "seconds": per, "query": query})
    script = " ".join(item["text"] for item in beats)
    media_names = [
        str(item.get("source") or "").strip()
        for item in (sources or [])
        if str(item.get("source") or "").strip()
    ]
    unique_media = list(dict.fromkeys(media_names))[:6]
    materials = ", ".join(unique_media) if unique_media else "открытые СМИ"
    return {
        "hook": hook,
        "script": script,
        "beats": beats,
        "youtube": {
            "title": hook[:70],
            "description": f"{script[:400]}\n\nПо материалам: {materials}\n\n#Shorts",
            "tags": ["shorts", "news", "politics"],
        },
        "tiktok": {
            "caption": f"{hook} #shorts #news #politics",
        },
    }


def write_script(
    topic: str,
    model: str,
    duration_sec: float,
    language: str,
    job_id: str,
    sources: list[dict[str, Any]] | None = None,
    editorial_style: str = "",
) -> dict[str, Any]:
    lang_note = "English" if language == "en" else "русский"
    source_list = sources or []
    dossier = sources_brief(source_list) if source_list else "Источники не найдены."
    media_names = [
        str(item.get("source") or "").strip()
        for item in source_list
        if str(item.get("source") or "").strip()
    ]
    unique_media = list(dict.fromkeys(media_names))[:8]
    materials = ", ".join(unique_media) if unique_media else "открытые СМИ"
    style = (
        editorial_style.strip()
        or "Политический faceless Shorts: коротко, жёстко, по делу."
    )
    prompt = (
        "Ты автор политических faceless Shorts для команды.\n"
        f"Тема новости: {topic}\n"
        f"Длительность около {duration_sec:.0f} секунд. Язык озвучки: {lang_note}.\n"
        f"Seed: {job_id[:8]}\n"
        f"Голос/тон команды: {style}\n"
        "Правила:\n"
        "- Опирайся ТОЛЬКО на факты из блока источников ниже.\n"
        "- Не выдумывай цифры, цитаты, должности и события, которых нет в источниках.\n"
        "- Если источников мало — говори осторожно, без домыслов.\n"
        "- Хук в первой фразе про новость. Без «всем привет», «подписывайтесь».\n"
        "- Подача — голос нашей команды; факты — из сторонних СМИ.\n"
        "Верни JSON:\n"
        "{\"hook\":\"...\",\"script\":\"полный текст для озвучки\",\"beats\":"
        "[{\"text\":\"короткая фраза на экран\",\"seconds\":6,\"query\":\"urgent briefing map\"}],"
        "\"youtube\":{\"title\":\"...\",\"description\":\"...\",\"tags\":[\"a\"]},\"tiktok\":{\"caption\":\"...\"}}\n"
        "beats 3-6, сумма seconds ≈ длительности.\n"
        "text в beats — короткая экранная фраза до ~70 символов, не абзац.\n"
        "query начинается с mood: urgent|briefing|map|numbers + 2-3 слова.\n"
        "title до 70 символов, без #Shorts. description 1-2 предложения + "
        f"обязательно строка «По материалам: {materials}» и #Shorts.\n\n"
        f"ИСТОЧНИКИ:\n{dossier}"
    )
    try:
        payload = generate_json(model, prompt)
        if not isinstance(payload, dict):
            return fallback_script(topic, duration_sec, language, source_list)
        beats_raw = payload.get("beats") or []
        beats: list[dict[str, Any]] = []
        if isinstance(beats_raw, list):
            for item in beats_raw:
                if not isinstance(item, dict):
                    continue
                text = str(item.get("text") or "").strip()
                if not text:
                    continue
                seconds = float(item.get("seconds") or 6)
                query = str(item.get("query") or "briefing news").strip()
                beats.append(
                    {
                        "text": text[:72],
                        "seconds": max(3.0, min(15.0, seconds)),
                        "query": query[:80],
                    }
                )
        if len(beats) < 2:
            return fallback_script(topic, duration_sec, language, source_list)
        hook = str(payload.get("hook") or topic).strip()[:70]
        script = str(payload.get("script") or " ".join(b["text"] for b in beats)).strip()
        youtube = payload.get("youtube") if isinstance(payload.get("youtube"), dict) else {}
        tiktok = payload.get("tiktok") if isinstance(payload.get("tiktok"), dict) else {}
        title = str(youtube.get("title") or hook)[:100]
        description = str(youtube.get("description") or script)
        if "По материалам:" not in description and "Sources:" not in description:
            description = f"{description.strip()}\n\nПо материалам: {materials}"
        if "#Shorts" not in description and "#shorts" not in description:
            description = f"{description.strip()}\n\n#Shorts"
        tags_raw = youtube.get("tags") or []
        tags = [str(tag).strip() for tag in tags_raw if str(tag).strip()][:15]
        caption = str(tiktok.get("caption") or f"{hook} #shorts #news")[:2200]
        return {
            "hook": hook,
            "script": script,
            "beats": beats,
            "youtube": {
                "title": title,
                "description": description[:5000],
                "tags": tags or ["shorts", "news", "politics"],
            },
            "tiktok": {"caption": caption},
        }
    except Exception:
        return fallback_script(topic, duration_sec, language, source_list)
