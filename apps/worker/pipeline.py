from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ads import detect_ads
from captions import words_in_range, write_ass
from crop import caption_margin_v, crop_for_clip, face_layout
from highlights import select_highlights
from job_io import jobs_dir, save_job, update_job
from metadata import generate_metadata
from render import RENDER_STYLE, render_clip
from thumbnail import make_thumbnails
from transcribe import flatten_words, transcribe_video, transcript_window


def clip_id(index: int) -> str:
    return f"clip-{str(index + 1).zfill(2)}"


def load_saved_json(path: Path) -> Any | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def clip_outputs_exist(clips_dir: Path, clip: dict[str, Any], cid: str) -> bool:
    video_name = Path(str(clip.get("videoFile") or f"clips/{cid}.mp4")).name
    thumb_v_name = Path(str(clip.get("thumbVerticalFile") or f"{cid}-thumb.jpg")).name
    thumb_h_name = Path(str(clip.get("thumbHorizontalFile") or f"{cid}-thumb-yt.jpg")).name
    video_path = clips_dir / video_name
    return (
        video_path.exists()
        and video_path.stat().st_size > 1024
        and (clips_dir / thumb_v_name).exists()
        and (clips_dir / thumb_h_name).exists()
    )


def reusable_clip(
    existing: list[dict[str, Any]],
    cid: str,
    start: float,
    end: float,
    clips_dir: Path,
) -> dict[str, Any] | None:
    for item in existing:
        try:
            same_range = (
                abs(float(item.get("start") or 0) - start) <= 0.25
                and abs(float(item.get("end") or 0) - end) <= 0.25
            )
        except (TypeError, ValueError):
            continue
        if not same_range:
            continue
        if item.get("renderStyle") != RENDER_STYLE:
            continue
        if clip_outputs_exist(clips_dir, item, cid):
            return item
    return None


def process_job(job: dict[str, Any]) -> None:
    job_id = str(job["id"])
    directory = jobs_dir() / job_id
    source_path = directory / str(job.get("sourcePath") or "source.mp4")
    if not source_path.exists():
        matches = list(directory.glob("source.*"))
        if not matches:
            raise FileNotFoundError("Source video not found")
        source_path = matches[0]
        job["sourcePath"] = source_path.name

    settings = job.get("settings") or {}
    language = str(settings.get("language") or "ru")
    whisper_model = str(settings.get("whisperModel") or "small")
    ollama_model = str(settings.get("ollamaModel") or "qwen2.5:7b")
    min_duration = float(settings.get("clipMinDuration") or 18)
    max_duration = float(settings.get("clipMaxDuration") or 180)
    max_clips = int(settings.get("maxClips") or 12)
    platforms = settings.get("platforms") or ["youtube", "tiktok"]
    skip_ads = settings.get("skipAds")
    if skip_ads is None:
        skip_ads = True
    add_music = settings.get("addMusic")
    if add_music is None:
        add_music = False
    montage = settings.get("montage")
    if montage is None:
        montage = True
    max_publish = int(settings.get("maxPublishPerRun") or 2)

    transcript_path = directory / "transcript.json"
    saved_transcript = load_saved_json(transcript_path)
    if isinstance(saved_transcript, dict) and saved_transcript.get("segments"):
        transcript = saved_transcript
        print(f"[{job_id}] transcript exists, skip Whisper", flush=True)
    else:
        update_job(job, status="transcribing", progress="Распознаю речь (Whisper)", error=None)
        transcript = transcribe_video(source_path, language, whisper_model)
        save_job(job)
        transcript_path.write_text(
            json.dumps(transcript, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    ads: list[dict[str, Any]] = []
    ads_path = directory / "ads.json"
    if skip_ads:
        saved_ads = load_saved_json(ads_path)
        if isinstance(saved_ads, list):
            ads = saved_ads
            job["ads"] = ads
            print(f"[{job_id}] ads exist, skip detect", flush=True)
        else:
            update_job(job, status="clipping", progress="Ищу рекламу автора")
            ads = detect_ads(transcript, ollama_model)
            job["ads"] = ads
            save_job(job)
            ads_path.write_text(
                json.dumps(ads, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
    highlights_path = directory / "highlights.json"
    saved_highlights = load_saved_json(highlights_path)
    highlights_ok = (
        isinstance(saved_highlights, list)
        and bool(saved_highlights)
        and all(
            isinstance(item, dict) and "score" in item for item in saved_highlights
        )
    )
    if highlights_ok:
        highlights = saved_highlights
        print(f"[{job_id}] highlights exist, skip Ollama", flush=True)
    else:
        update_job(
            job,
            status="clipping",
            progress="Ищу хайлайты без рекламы" if ads else "Ищу хайлайты через Ollama",
        )
        highlights = select_highlights(
            transcript,
            ollama_model,
            min_duration,
            max_duration,
            max_clips,
            ads,
        )
        highlights_path.write_text(
            json.dumps(highlights, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    words = flatten_words(transcript)
    clips_dir = directory / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    existing_clips = [item for item in (job.get("clips") or []) if isinstance(item, dict)]
    clips: list[dict[str, Any]] = []
    used_titles: list[str] = []
    total = len(highlights)
    for index, highlight in enumerate(highlights):
        start = float(highlight["start"])
        end = float(highlight["end"])
        cid = clip_id(index)
        update_job(
            job,
            status="rendering",
            progress=f"Рендерю клип {index + 1}/{total}",
        )
        ready = reusable_clip(existing_clips, cid, start, end, clips_dir)
        if ready is not None:
            ready = dict(ready)
            ready["score"] = float(highlight.get("score") or ready.get("score") or 0)
            ready["renderStyle"] = RENDER_STYLE
            title = str((ready.get("youtube") or {}).get("title") or "")
            if title:
                used_titles.append(title)
            clips.append(ready)
            job["clips"] = clips
            save_job(job)
            print(f"[{job_id}] skip {cid}, already rendered", flush=True)
            continue
        print(f"[{job_id}] render {cid} {start:.1f}-{end:.1f}", flush=True)
        text = transcript_window(words, start, end)
        hook = str(highlight.get("hook") or text[:80] or "Клип")
        meta = generate_metadata(ollama_model, text, hook, used_titles)
        used_titles.append(str(meta["youtube"]["title"]))
        _face_x, face_y = face_layout(source_path, start, end)
        ass_path = clips_dir / f"{cid}.ass"
        write_ass(
            ass_path,
            words_in_range(words, start, end),
            hook,
            margin_v=caption_margin_v(face_y),
        )
        crop_w, crop_h, crop_x, crop_y = crop_for_clip(source_path, start, end)
        video_name = f"{cid}.mp4"
        thumb_v = f"{cid}-thumb.jpg"
        thumb_h = f"{cid}-thumb-yt.jpg"
        video_path = clips_dir / video_name
        render_clip(
            source_path,
            video_path,
            start,
            end,
            crop_w,
            crop_h,
            crop_x,
            crop_y,
            ass_path,
            clip_id=cid,
            add_music=bool(add_music),
            montage=bool(montage),
        )
        make_thumbnails(
            video_path,
            0.2,
            max(0.4, end - start - 0.2),
            hook,
            clips_dir / thumb_v,
            clips_dir / thumb_h,
        )
        clips.append(
            {
                "id": cid,
                "start": start,
                "end": end,
                "hook": hook,
                "reason": str(highlight.get("reason") or ""),
                "transcript": text,
                "score": float(highlight.get("score") or 0),
                "renderStyle": RENDER_STYLE,
                "youtube": meta["youtube"],
                "tiktok": meta["tiktok"],
                "videoFile": f"clips/{video_name}",
                "thumbVerticalFile": f"clips/{thumb_v}",
                "thumbHorizontalFile": f"clips/{thumb_h}",
                "publishYoutube": False,
                "publishTiktok": False,
                "youtubeVideoId": None,
                "tiktokPublishId": None,
                "youtubeError": None,
                "tiktokError": None,
                "publishError": None,
                "scheduledYoutubeAt": None,
                "scheduledTiktokAt": None,
                "youtubePublishedAt": None,
                "youtubeStats": None,
            }
        )
        job["clips"] = clips
        save_job(job)

    ranked = sorted(
        range(len(clips)),
        key=lambda index: -float(clips[index].get("score") or 0),
    )
    selected = set(ranked[: max(1, max_publish)])
    for index, clip in enumerate(clips):
        is_top = index in selected
        clip["publishYoutube"] = is_top and "youtube" in platforms
        clip["publishTiktok"] = is_top and "tiktok" in platforms
        if clip.get("score") is None:
            clip["score"] = 0
        if "renderStyle" not in clip:
            clip["renderStyle"] = RENDER_STYLE

    update_job(
        job,
        status="ready",
        progress=f"Готово: {len(clips)} клипов, к публикации {len(selected)}",
        clips=clips,
        error=None,
    )
