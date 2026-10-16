from __future__ import annotations

import json
import os
import re
from typing import Any

import requests


def ollama_host() -> str:
    return os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")


def extract_json(text: str) -> Any:
    stripped = text.strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", stripped)
    if fenced:
        stripped = fenced.group(1).strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        start_obj = stripped.find("{")
        start_arr = stripped.find("[")
        starts = [index for index in (start_obj, start_arr) if index >= 0]
        if not starts:
            raise
        start = min(starts)
        end_obj = stripped.rfind("}")
        end_arr = stripped.rfind("]")
        end = max(end_obj, end_arr)
        if end <= start:
            raise
        return json.loads(stripped[start : end + 1])


def generate_json(model: str, prompt: str, timeout: int = 180) -> Any:
    response = requests.post(
        f"{ollama_host()}/api/generate",
        json={
            "model": model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "options": {
                "temperature": 0.4,
            },
        },
        timeout=timeout,
    )
    response.raise_for_status()
    payload = response.json()
    text = str(payload.get("response") or "")
    return extract_json(text)
