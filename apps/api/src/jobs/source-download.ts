import path from "node:path";
import type { Job } from "@narezchik/shared";
import { downloadSource, findDownloadedSource } from "../download.ts";
import { jobDir, listJobs, readJob, writeJob } from "./store.ts";

const inflight = new Map<string, Promise<void>>();
const writeChains = new Map<string, Promise<void>>();

async function patchJob(
  jobId: string,
  mutate: (job: Job) => boolean | void
): Promise<void> {
  const previous = writeChains.get(jobId) ?? Promise.resolve();
  const next = previous
    .catch(() => {
      return;
    })
    .then(async () => {
      const latest = await readJob(jobId);
      if (!latest) {
        return;
      }
      const result = mutate(latest);
      if (result === false) {
        return;
      }
      await writeJob(latest);
    });
  writeChains.set(jobId, next);
  await next;
}

async function runSourceDownload(job: Job): Promise<void> {
  const dir = jobDir(job.id);
  const current = await readJob(job.id);
  if (!current || !current.sourceUrl || current.status !== "downloading") {
    return;
  }

  const already = findDownloadedSource(dir);
  if (already) {
    await patchJob(job.id, (latest) => {
      latest.sourcePath = path.basename(already);
      latest.status = "queued";
      latest.progress = "Видео скачано, в очереди";
      latest.error = null;
    });
    return;
  }

  try {
    let lastProgressAt = 0;
    const sourcePath = await downloadSource(current.sourceUrl, dir, {
      onProgress: (message) => {
        const now = Date.now();
        if (now - lastProgressAt < 750) {
          return;
        }
        lastProgressAt = now;
        void patchJob(job.id, (latest) => {
          if (latest.status !== "downloading") {
            return false;
          }
          latest.progress = message;
        });
      },
    });
    await patchJob(job.id, (latest) => {
      latest.sourcePath = path.basename(sourcePath);
      latest.status = "queued";
      latest.progress = "Видео скачано, в очереди";
      latest.error = null;
    });
  } catch (error) {
    await patchJob(job.id, (latest) => {
      latest.status = "failed";
      latest.error =
        error instanceof Error ? error.message : "Не удалось скачать видео";
      latest.progress = "Ошибка скачивания";
    });
  }
}

export function startSourceDownload(job: Job): Promise<void> {
  const existing = inflight.get(job.id);
  if (existing) {
    return existing;
  }
  const run = runSourceDownload(job).finally(() => {
    inflight.delete(job.id);
  });
  inflight.set(job.id, run);
  return run;
}

export async function resumeStuckDownloads(): Promise<void> {
  const jobs = await listJobs();
  for (const job of jobs) {
    if (job.status !== "downloading" || !job.sourceUrl) {
      continue;
    }
    void startSourceDownload(job);
  }
}
