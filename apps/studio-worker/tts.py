from __future__ import annotations

import asyncio
from pathlib import Path


async def _synthesize(text: str, voice: str, output_path: Path) -> None:
    import edge_tts

    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(str(output_path))


def synthesize_voice(text: str, voice: str, output_path: Path) -> None:
    clean = " ".join(text.split()).strip()
    if not clean:
        raise RuntimeError("Empty script for TTS")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    voices = [voice]
    if voice.startswith("ru-"):
        voices.extend(["ru-RU-SvetlanaNeural", "ru-RU-DmitryNeural"])
    elif voice.startswith("en-"):
        voices.extend(["en-US-JennyNeural", "en-US-GuyNeural"])
    seen: set[str] = set()
    last_error: Exception | None = None
    for candidate in voices:
        if candidate in seen:
            continue
        seen.add(candidate)
        try:
            asyncio.run(_synthesize(clean, candidate, output_path))
            if output_path.exists() and output_path.stat().st_size > 1000:
                return
        except Exception as error:
            last_error = error
            continue
    if last_error is not None:
        raise RuntimeError(str(last_error)) from last_error
    raise RuntimeError("TTS produced empty audio")
