from __future__ import annotations

import sys
import threading
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from job_io import list_queued_jobs, update_job, write_heartbeat
from pipeline import process_job


def load_dotenv() -> None:
    for candidate in (ROOT.parents[1] / ".env", ROOT.parents[1] / ".env.example"):
        if not candidate.exists():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            if key and key not in __import__("os").environ:
                __import__("os").environ[key] = value.strip().strip('"').strip("'")
        if candidate.name == ".env":
            break


def heartbeat_loop() -> None:
    while True:
        try:
            write_heartbeat()
        except Exception:
            traceback.print_exc()
        time.sleep(2)


def main() -> None:
    load_dotenv()
    thread = threading.Thread(target=heartbeat_loop, daemon=True)
    thread.start()
    print("Narezchik worker started", flush=True)
    while True:
        queued = list_queued_jobs()
        if not queued:
            time.sleep(2)
            continue
        job = queued[0]
        try:
            print(f"claim {job.get('id')} status={job.get('status')}", flush=True)
            update_job(job, progress="Воркер взял задачу")
            process_job(job)
        except FileNotFoundError as error:
            update_job(
                job,
                status="queued",
                progress="Жду исходное видео",
                error=None,
            )
            print(str(error), flush=True)
            time.sleep(3)
        except Exception as error:
            traceback.print_exc()
            update_job(
                job,
                status="failed",
                progress="Ошибка обработки",
                error=str(error),
            )
        time.sleep(1)


if __name__ == "__main__":
    main()
