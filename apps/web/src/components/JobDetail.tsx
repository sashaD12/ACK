import { useMemo, useState, type FC } from "react";
import type { Clip, Job, SystemStatus } from "@narezchik/shared";
import { publishJob } from "../api";
import { ClipCard } from "./ClipCard";

interface JobDetailProps {
  job: Job;
  status: SystemStatus | null;
  onJobChange: (job: Job) => void;
}

export const JobDetail: FC<JobDetailProps> = ({ job, status, onJobChange }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedIds = useMemo(
    () =>
      job.clips
        .filter((clip) => clip.publishYoutube || clip.publishTiktok)
        .map((clip) => clip.id),
    [job.clips]
  );

  function handleClipChange(next: Clip): void {
    onJobChange({
      ...job,
      clips: job.clips.map((clip) => (clip.id === next.id ? next : clip)),
    });
  }

  async function handlePublish(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const updated = await publishJob(job.id, selectedIds);
      onJobChange(updated);
    } catch (publishError) {
      setError(
        publishError instanceof Error ? publishError.message : "Ошибка публикации"
      );
    } finally {
      setBusy(false);
    }
  }

  const canPublish = job.status === "ready" || job.status === "published";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold break-all">{job.sourceName}</h2>
          <p className="text-sm text-zinc-400">{job.progress}</p>
          {job.error ? <p className="mt-1 text-sm text-red-400">{job.error}</p> : null}
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
        <button
          type="button"
          disabled={!canPublish || selectedIds.length === 0 || busy}
          onClick={() => {
            void handlePublish();
          }}
          className="rounded-xl bg-emerald-400 px-4 py-2 font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Публикую..." : `Опубликовать выбранные (${selectedIds.length})`}
        </button>
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
            onChange={handleClipChange}
          />
        ))
      )}
    </section>
  );
};
