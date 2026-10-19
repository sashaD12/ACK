import { useState, type FC } from "react";
import {
  studioPendingOn,
  type Platform,
  type StudioJob,
  type SystemStatus,
} from "@narezchik/shared";
import { publishStudioJob, studioMediaUrl, updateStudioJob } from "./api";

interface StudioJobDetailProps {
  job: StudioJob;
  status: SystemStatus | null;
  onJobChange: (job: StudioJob) => void;
}

export const StudioJobDetail: FC<StudioJobDetailProps> = ({
  job,
  status,
  onJobChange,
}) => {
  const [busyPlatform, setBusyPlatform] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function patch(
    next: Partial<
      Pick<
        StudioJob,
        "script" | "youtube" | "tiktok" | "publishYoutube" | "publishTiktok"
      >
    >
  ): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateStudioJob(job.id, next);
      onJobChange(updated);
    } catch (patchError) {
      setError(
        patchError instanceof Error ? patchError.message : "Не удалось сохранить"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(platform: Platform): Promise<void> {
    setBusyPlatform(platform);
    setError(null);
    try {
      const updated = await publishStudioJob(job.id, platform);
      onJobChange(updated);
    } catch (publishError) {
      setError(
        publishError instanceof Error ? publishError.message : "Ошибка публикации"
      );
    } finally {
      setBusyPlatform(null);
    }
  }

  const canPublish = job.status === "ready" || job.status === "published";
  const videoSrc = job.videoFile ? studioMediaUrl(job.id, job.videoFile) : null;
  const thumbSrc = job.thumbFile ? studioMediaUrl(job.id, job.thumbFile) : null;
  const busy = busyPlatform !== null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold break-words">{job.topic}</h2>
          <p className="text-sm text-zinc-400">{job.progress}</p>
          {job.error ? <p className="mt-1 text-sm text-red-400">{job.error}</p> : null}
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={!canPublish || !studioPendingOn(job, "youtube") || busy}
            onClick={() => {
              void handlePublish("youtube");
            }}
            className="rounded-xl bg-red-500 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyPlatform === "youtube"
              ? "Публикую на YouTube..."
              : "Опубликовать на YouTube"}
          </button>
          <button
            type="button"
            disabled={!canPublish || !studioPendingOn(job, "tiktok") || busy}
            onClick={() => {
              void handlePublish("tiktok");
            }}
            className="rounded-xl bg-cyan-300 px-4 py-2 font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyPlatform === "tiktok"
              ? "Публикую в TikTok..."
              : "Опубликовать в TikTok"}
          </button>
        </div>
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {(job.sources ?? []).length > 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Источники СМИ ({job.sources.length})
          </p>
          <ul className="mt-2 space-y-2">
            {job.sources.slice(0, 8).map((source) => (
              <li key={source.url} className="text-sm text-zinc-300">
                <span className="text-zinc-500">{source.source}: </span>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-violet-300 hover:underline"
                >
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : job.status === "researching" ? (
        <p className="text-sm text-zinc-500">Ищу материалы в сторонних СМИ…</p>
      ) : null}
      {!job.videoFile ? (
        <div className="rounded-2xl border border-zinc-800 p-8 text-sm text-zinc-500">
          {job.status === "failed"
            ? job.error ?? "Студия упала. Проверьте Ollama, edge-tts и FFmpeg."
            : "Ролик появится после генерации."}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <div>
            <video
              controls
              poster={thumbSrc ?? undefined}
              src={videoSrc ?? undefined}
              className="aspect-[9/16] w-full rounded-xl bg-black object-cover"
            />
            {videoSrc ? (
              <a
                href={`${videoSrc}?download=1`}
                download="studio.mp4"
                className="mt-2 inline-block rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:border-amber-400"
              >
                Скачать mp4
              </a>
            ) : null}
          </div>
          <div className="space-y-3">
            <label className="block text-xs text-zinc-400">
              Хук
              <input
                defaultValue={job.script?.hook ?? ""}
                disabled={saving || !job.script}
                onBlur={(event) => {
                  if (!job.script || event.target.value === job.script.hook) {
                    return;
                  }
                  void patch({
                    script: { ...job.script, hook: event.target.value },
                  });
                }}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Сценарий
              <textarea
                defaultValue={job.script?.script ?? ""}
                disabled={saving || !job.script}
                rows={5}
                onBlur={(event) => {
                  if (!job.script || event.target.value === job.script.script) {
                    return;
                  }
                  void patch({
                    script: { ...job.script, script: event.target.value },
                  });
                }}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              YouTube title
              <input
                defaultValue={job.youtube.title}
                disabled={saving}
                onBlur={(event) => {
                  if (event.target.value !== job.youtube.title) {
                    void patch({
                      youtube: { ...job.youtube, title: event.target.value },
                    });
                  }
                }}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              TikTok caption
              <textarea
                defaultValue={job.tiktok.caption}
                disabled={saving}
                rows={3}
                onBlur={(event) => {
                  if (event.target.value !== job.tiktok.caption) {
                    void patch({
                      tiktok: { ...job.tiktok, caption: event.target.value },
                    });
                  }
                }}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
            </label>
            <p className="text-xs text-zinc-500">
              TikTok inbox: подпись API не передаёт — скопируйте caption после
              загрузки.
            </p>
            <div className="flex flex-wrap gap-4 text-sm text-zinc-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={job.publishYoutube}
                  onChange={(event) => {
                    void patch({ publishYoutube: event.target.checked });
                  }}
                />
                YouTube
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={job.publishTiktok}
                  onChange={(event) => {
                    void patch({ publishTiktok: event.target.checked });
                  }}
                />
                TikTok
              </label>
            </div>
            {!status?.tiktokConfigured && job.publishTiktok ? (
              <p className="text-xs text-amber-300">
                TikTok API не настроен: скачайте ролик вручную.
              </p>
            ) : null}
            {job.youtubeVideoId ? (
              <p className="text-xs text-emerald-400">
                YouTube: https://youtube.com/shorts/{job.youtubeVideoId}
              </p>
            ) : null}
            {job.tiktokPublishId ? (
              <p className="text-xs text-emerald-400">
                TikTok inbox: {job.tiktokPublishId}
              </p>
            ) : null}
            {job.youtubeError ? (
              <p className="text-xs text-red-400">YouTube: {job.youtubeError}</p>
            ) : null}
            {job.tiktokError ? (
              <p className="text-xs text-red-400">TikTok: {job.tiktokError}</p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
};
