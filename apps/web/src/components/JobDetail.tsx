import { useMemo, useState, type FC } from "react";
import {
  clipPendingOn,
  clipsForThisPublish,
  DEFAULT_JOB_SETTINGS,
  type Clip,
  type Job,
  type Platform,
  type SystemStatus,
} from "@narezchik/shared";
import { publishJob, refreshJobStats } from "../api";
import { ClipCard } from "./ClipCard";

interface JobDetailProps {
  job: Job;
  status: SystemStatus | null;
  onJobChange: (job: Job) => void;
  onReloadJob: (jobId: string) => void;
}

export const JobDetail: FC<JobDetailProps> = ({
  job,
  status,
  onJobChange,
  onReloadJob,
}) => {
  const [busyPlatform, setBusyPlatform] = useState<Platform | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const youtubeIds = useMemo(
    () =>
      job.clips
        .filter((clip) => clipPendingOn(clip, "youtube"))
        .map((clip) => clip.id),
    [job.clips]
  );
  const tiktokIds = useMemo(
    () =>
      job.clips
        .filter((clip) => clipPendingOn(clip, "tiktok"))
        .map((clip) => clip.id),
    [job.clips]
  );

  function handleClipChange(next: Clip): void {
    onJobChange({
      ...job,
      clips: job.clips.map((clip) => (clip.id === next.id ? next : clip)),
    });
  }

  async function handlePublish(platform: Platform, clipIds: string[]): Promise<void> {
    setBusyPlatform(platform);
    setError(null);
    try {
      const updated = await publishJob(job.id, clipIds, platform);
      onJobChange(updated);
    } catch (publishError) {
      setError(
        publishError instanceof Error ? publishError.message : "Ошибка публикации"
      );
    } finally {
      setBusyPlatform(null);
    }
  }

  async function handleStats(): Promise<void> {
    setStatsBusy(true);
    setError(null);
    try {
      const updated = await refreshJobStats(job.id);
      onJobChange(updated);
    } catch (statsError) {
      setError(
        statsError instanceof Error ? statsError.message : "Ошибка статистики"
      );
    } finally {
      setStatsBusy(false);
    }
  }

  const maxPerRun =
    job.settings.maxPublishPerRun ?? DEFAULT_JOB_SETTINGS.maxPublishPerRun;
  const delayHours =
    job.settings.publishDelayHours ?? DEFAULT_JOB_SETTINGS.publishDelayHours;
  const youtubeBatch = clipsForThisPublish(job.clips, maxPerRun, "youtube");
  const tiktokBatch = clipsForThisPublish(job.clips, maxPerRun, "tiktok");
  const canPublish = job.status === "ready" || job.status === "published";
  const busy = busyPlatform !== null;
  const hasYoutubeIds = job.clips.some((clip) => Boolean(clip.youtubeVideoId));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold break-all">{job.sourceName}</h2>
          <p className="text-sm text-zinc-400">{job.progress}</p>
          {job.error ? <p className="mt-1 text-sm text-red-400">{job.error}</p> : null}
          {job.clips.length > 0 ? (
            <p className="mt-1 text-xs text-zinc-500">
              YouTube и TikTok отдельно. За раз до {maxPerRun} роликов, остальные
              уйдут через {delayHours} ч по расписанию.
            </p>
          ) : null}
          {(job.ads ?? []).length > 0 ? (
            <p className="mt-1 text-xs text-zinc-500">
              Вирізано рекламу автора:{" "}
              {(job.ads ?? [])
                .map(
                  (ad) =>
                    `${Math.floor(ad.start / 60)}:${String(Math.floor(ad.start % 60)).padStart(2, "0")}–${Math.floor(ad.end / 60)}:${String(Math.floor(ad.end % 60)).padStart(2, "0")}`
                )
                .join(", ")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={!canPublish || youtubeBatch.length === 0 || busy}
            onClick={() => {
              void handlePublish("youtube", youtubeIds);
            }}
            className="rounded-xl bg-red-500 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyPlatform === "youtube"
              ? "Публикую на YouTube..."
              : `Опубликовать на YouTube (${youtubeBatch.length}${
                  youtubeIds.length > youtubeBatch.length
                    ? ` из ${youtubeIds.length}`
                    : ""
                })`}
          </button>
          <button
            type="button"
            disabled={!canPublish || tiktokBatch.length === 0 || busy}
            onClick={() => {
              void handlePublish("tiktok", tiktokIds);
            }}
            className="rounded-xl bg-cyan-300 px-4 py-2 font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyPlatform === "tiktok"
              ? "Публикую в TikTok..."
              : `Опубликовать в TikTok (${tiktokBatch.length}${
                  tiktokIds.length > tiktokBatch.length
                    ? ` из ${tiktokIds.length}`
                    : ""
                })`}
          </button>
          <button
            type="button"
            disabled={!hasYoutubeIds || statsBusy}
            onClick={() => {
              void handleStats();
            }}
            className="rounded-xl border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {statsBusy ? "Тяну статистику..." : "Обновить статистику YouTube"}
          </button>
        </div>
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {job.clips.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 p-8 text-sm text-zinc-500">
          {job.status === "failed"
            ? job.error ?? "Задача упала. Проверьте FFmpeg, Ollama и воркер."
            : job.status === "downloading"
              ? job.progress
              : "Клипы появятся после обработки."}
        </div>
      ) : (
        job.clips.map((clip) => (
          <ClipCard
            key={clip.id}
            jobId={job.id}
            clip={clip}
            status={status}
            canPublish={canPublish}
            onChange={handleClipChange}
            onJobChange={onReloadJob}
          />
        ))
      )}
    </section>
  );
};
