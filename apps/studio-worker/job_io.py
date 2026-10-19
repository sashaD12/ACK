from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    raw = os.environ.get("DATA_DIR", "./data")
    path = Path(raw)
    if not path.is_absolute():
        path = repo_root() / path
    return path


def studio_jobs_dir() -> Path:
    return data_dir() / "studio" / "jobs"


def heartbeat_file() -> Path:
    return data_dir() / "studio-worker-heartbeat.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        raw = path.read_text(encoding="utf-8")
        if not raw.strip():
            return None
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError):
        return None
    if isinstance(data, dict):
        return data
    return None


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(payload, ensure_ascii=False, indent=2)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        handle.write(encoded)
    try:
        tmp.replace(path)
    except PermissionError:
        path.write_text(encoded, encoding="utf-8")
        try:
            tmp.unlink()
        except OSError:
            pass


def write_heartbeat() -> None:
    write_json(
        heartbeat_file(),
        {
            "pid": os.getpid(),
            "updatedAt": now_iso(),
        },
    )


def job_path(job_id: str) -> Path:
    return studio_jobs_dir() / job_id / "job.json"


def load_job(job_id: str) -> dict[str, Any] | None:
    return read_json(job_path(job_id))


def save_job(job: dict[str, Any]) -> None:
    job["updatedAt"] = now_iso()
    write_json(job_path(str(job["id"])), job)


def update_job(job: dict[str, Any], **fields: Any) -> dict[str, Any]:
    job.update(fields)
    save_job(job)
    return job


RECOVERABLE = {
    "queued",
    "researching",
    "writing",
    "voicing",
    "fetching",
    "generating",
    "rendering",
}


def list_queued_jobs() -> list[dict[str, Any]]:
    root = studio_jobs_dir()
    if not root.exists():
        return []
    queued: list[dict[str, Any]] = []
    for entry in root.iterdir():
        if not entry.is_dir():
            continue
        job = read_json(entry / "job.json")
        if not job or job.get("status") not in RECOVERABLE:
            continue
        queued.append(job)
    rank = {
        "rendering": 0,
        "generating": 1,
        "fetching": 1,
        "voicing": 2,
        "writing": 3,
        "researching": 4,
        "queued": 5,
    }
    queued.sort(
        key=lambda item: (
            rank.get(str(item.get("status")), 9),
            str(item.get("updatedAt") or ""),
        )
    )
    return queued
