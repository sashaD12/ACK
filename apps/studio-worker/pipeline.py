from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ffmpeg_utils import probe_duration
from job_io import save_job, studio_jobs_dir, update_job
from media_fetch import collect_media_urls, download_media_pack
from news import research_topic
from render import render_studio_video
from script import write_script
from tts import synthesize_voice
from visuals import prepare_visuals


def process_studio_job(job: dict[str, Any]) -> None:
    job_id = str(job["id"])
    directory = studio_jobs_dir() / job_id
    directory.mkdir(parents=True, exist_ok=True)
    settings = job.get("settings") or {}
    topic = str(job.get("topic") or "").strip()
    language = str(settings.get("language") or "ru")
    model = str(settings.get("ollamaModel") or "qwen2.5:7b")
    voice = str(settings.get("voice") or "ru-RU-DmitryNeural")
    duration_sec = float(settings.get("durationSec") or 35)
    platforms = settings.get("platforms") or ["youtube", "tiktok"]
    editorial_style = str(settings.get("editorialStyle") or "").strip()

    update_job(
        job,
        status="researching",
        progress="Ищу свежие материалы в сторонних СМИ",
        error=None,
    )
    sources = research_topic(topic, language=language)
    job["sources"] = sources
    (directory / "sources.json").write_text(
        json.dumps(sources, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if sources:
        progress_write = f"Пишу сценарий по {len(sources)} источникам"
    else:
        progress_write = "Источники не найдены — пишу сценарий осторожно по теме"
    update_job(job, status="writing", progress=progress_write, sources=sources)
    payload = write_script(
        topic,
        model,
        duration_sec,
        language,
        job_id,
        sources=sources,
        editorial_style=editorial_style,
    )
    script = {
        "hook": payload["hook"],
        "script": payload["script"],
        "beats": payload["beats"],
    }
    job["script"] = script
    job["youtube"] = payload["youtube"]
    job["tiktok"] = payload["tiktok"]
    save_job(job)

    update_job(job, status="voicing", progress="Озвучиваю сценарий (TTS)")
    audio_path = directory / "voice.mp3"
    synthesize_voice(str(script["script"]), voice, audio_path)
    audio_duration = probe_duration(audio_path)
    job["audioFile"] = "voice.mp3"
    save_job(job)

    update_job(job, status="generating", progress="Собираю реальные кадры из СМИ и стоков")
    assets_dir = directory / "assets"
    media_urls = collect_media_urls(
        topic,
        sources,
        list(script.get("beats") or []),
        language=language,
    )
    photos = download_media_pack(media_urls, assets_dir, max_files=8, topic=topic)
    if photos:
        progress_visuals = f"Монтирую {len(photos)} реальных кадров"
    else:
        progress_visuals = "Кадры не скачались — собираю ролик с запасным фоном"
    update_job(job, status="generating", progress=progress_visuals)
    visuals = prepare_visuals(
        list(script.get("beats") or []),
        assets_dir,
        audio_duration,
        job_id=job_id,
        photos=photos,
    )

    update_job(job, status="rendering", progress="Собираю вертикальный ролик")
    ass_path = directory / "captions.ass"
    video_path = directory / "final.mp4"
    thumb_path = directory / "thumb.jpg"
    render_studio_video(
        visuals,
        audio_path,
        ass_path,
        video_path,
        thumb_path,
        str(script.get("hook") or topic),
        list(script.get("beats") or []),
    )

    job["videoFile"] = "final.mp4"
    job["thumbFile"] = "thumb.jpg"
    job["publishYoutube"] = "youtube" in platforms
    job["publishTiktok"] = "tiktok" in platforms
    update_job(
        job,
        status="ready",
        progress="Студия: ролик готов",
        videoFile="final.mp4",
        thumbFile="thumb.jpg",
        audioFile="voice.mp3",
        sources=sources,
        error=None,
    )
