import { useState, type FC } from "react";
import {
  formatScheduleLabel,
  type Clip,
  type Platform,
  type SystemStatus,
} from "@narezchik/shared";
import { mediaUrl, publishJob, updateClip } from "../api";

interface ClipCardProps {
  jobId: string;
  clip: Clip;
  status: SystemStatus | null;
  canPublish: boolean;
  onChange: (clip: Clip) => void;
  onJobChange: (jobId: string) => void;
}

export const ClipCard: FC<ClipCardProps> = ({
  jobId,
  clip,
  status,
  canPublish,
  onChange,
  onJobChange,
}) => {
  const [busy, setBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(
    next: Partial<
      Pick<Clip, "hook" | "youtube" | "tiktok" | "publishYoutube" | "publishTiktok">
    >
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateClip(jobId, clip.id, next);
      onChange(updated);
    } catch (patchError) {
      setError(
        patchError instanceof Error ? patchError.message : "Не удалось сохранить"
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyCaption(): Promise<void> {
    await navigator.clipboard.writeText(clip.tiktok.caption);
  }

  async function publishOne(platform: Platform): Promise<void> {
    setPublishBusy(platform);
    setError(null);
    try {
      await publishJob(jobId, [clip.id], platform);
      onJobChange(jobId);
    } catch (publishError) {
      setError(
        publishError instanceof Error ? publishError.message : "Ошибка публикации"
      );
    } finally {
      setPublishBusy(null);
    }
  }

  const videoSrc = mediaUrl(jobId, clip.videoFile);
  const thumbSrc = mediaUrl(jobId, clip.thumbVerticalFile);
  const youtubeSchedule = formatScheduleLabel(clip.scheduledYoutubeAt);
  const tiktokSchedule = formatScheduleLabel(clip.scheduledTiktokAt);
  const canYoutube =
    canPublish &&
    clip.publishYoutube &&
    !clip.youtubeVideoId &&
    publishBusy === null;
  const canTiktok =
    canPublish &&
    clip.publishTiktok &&
    !clip.tiktokPublishId &&
    publishBusy === null;

  return (
    <article className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/80">
      <div className="grid gap-4 p-4 lg:grid-cols-[220px_1fr]">
        <div>
          <video
            controls
            poster={thumbSrc}
            src={videoSrc}
            className="aspect-[9/16] w-full rounded-xl bg-black object-cover"
          />
          <p className="mt-2 text-xs text-zinc-500">
            {(clip.end - clip.start).toFixed(0)}с · {clip.start.toFixed(1)}–
            {clip.end.toFixed(1)}с · хук {Math.round(clip.score ?? 0)}
          </p>
          <p className="text-xs text-zinc-500">{clip.reason}</p>
          {clip.publishYoutube && !clip.youtubeVideoId ? (
            <p className="mt-1 text-xs font-medium text-red-300">
              {youtubeSchedule
                ? `YouTube: ${youtubeSchedule}`
                : "YouTube в очереди"}
            </p>
          ) : null}
          {clip.publishTiktok && !clip.tiktokPublishId ? (
            <p className="mt-1 text-xs font-medium text-cyan-300">
              {tiktokSchedule
                ? `TikTok: ${tiktokSchedule}`
                : "TikTok в очереди"}
            </p>
          ) : null}
          {!clip.publishYoutube && !clip.publishTiktok ? (
            <p className="mt-1 text-xs text-zinc-500">Запас — выложить позже</p>
          ) : null}
          {clip.youtubeStats ? (
            <p className="mt-2 text-xs text-emerald-300">
              YT: {clip.youtubeStats.views} просм. · {clip.youtubeStats.likes}{" "}
              лайк · {clip.youtubeStats.comments} комм.
            </p>
          ) : null}
        </div>
        <div className="space-y-3">
          <label className="block text-xs text-zinc-400">
            Хук
            <input
              defaultValue={clip.hook}
              disabled={busy}
              onBlur={(event) => {
                if (event.target.value !== clip.hook) {
                  void patch({ hook: event.target.value });
                }
              }}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            YouTube title
            <input
              defaultValue={clip.youtube.title}
              disabled={busy}
              onBlur={(event) => {
                if (event.target.value !== clip.youtube.title) {
                  void patch({
                    youtube: { ...clip.youtube, title: event.target.value },
                  });
                }
              }}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            YouTube description
            <textarea
              defaultValue={clip.youtube.description}
              disabled={busy}
              rows={3}
              onBlur={(event) => {
                if (event.target.value !== clip.youtube.description) {
                  void patch({
                    youtube: { ...clip.youtube, description: event.target.value },
                  });
                }
              }}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            Теги через запятую
            <input
              defaultValue={clip.youtube.tags.join(", ")}
              disabled={busy}
              onBlur={(event) => {
                const tags = event.target.value
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter((tag) => tag.length > 0);
                void patch({ youtube: { ...clip.youtube, tags } });
              }}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            TikTok caption
            <textarea
              defaultValue={clip.tiktok.caption}
              disabled={busy}
              rows={3}
              onBlur={(event) => {
                if (event.target.value !== clip.tiktok.caption) {
                  void patch({
                    tiktok: { ...clip.tiktok, caption: event.target.value },
                  });
                }
              }}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
          <p className="text-xs text-zinc-500">
            TikTok inbox: подпись API не передаёт — скопируйте caption и дожмите
            в приложении после загрузки.
          </p>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2 text-zinc-300">
              <input
                type="checkbox"
                checked={clip.publishYoutube}
                onChange={(event) => {
                  void patch({ publishYoutube: event.target.checked });
                }}
              />
              YouTube
            </label>
            <label className="flex items-center gap-2 text-zinc-300">
              <input
                type="checkbox"
                checked={clip.publishTiktok}
                onChange={(event) => {
                  void patch({ publishTiktok: event.target.checked });
                }}
              />
              TikTok
            </label>
            <a
              href={`${videoSrc}?download=1`}
              download={`${clip.id}.mp4`}
              className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:border-amber-400"
            >
              Скачать mp4
            </a>
            <button
              type="button"
              onClick={() => {
                void copyCaption();
              }}
              className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:border-amber-400"
            >
              Копировать caption
            </button>
            <button
              type="button"
              disabled={!canYoutube}
              onClick={() => {
                void publishOne("youtube");
              }}
              className="rounded-lg border border-red-500/50 px-3 py-1 text-xs text-red-200 hover:border-red-400 disabled:opacity-40"
            >
              {publishBusy === "youtube" ? "YouTube..." : "Только YouTube"}
            </button>
            <button
              type="button"
              disabled={!canTiktok}
              onClick={() => {
                void publishOne("tiktok");
              }}
              className="rounded-lg border border-cyan-500/50 px-3 py-1 text-xs text-cyan-200 hover:border-cyan-400 disabled:opacity-40"
            >
              {publishBusy === "tiktok" ? "TikTok..." : "Только TikTok"}
            </button>
          </div>
          {!status?.tiktokConfigured && clip.publishTiktok ? (
            <p className="text-xs text-amber-300">
              TikTok API не настроен: скачайте ролик и вставьте caption вручную.
            </p>
          ) : null}
          {clip.youtubeVideoId ? (
            <p className="text-xs text-emerald-400">
              YouTube: https://youtube.com/shorts/{clip.youtubeVideoId}
            </p>
          ) : null}
          {clip.tiktokPublishId ? (
            <p className="text-xs text-emerald-400">
              TikTok inbox: {clip.tiktokPublishId} — откройте приложение и
              добавьте caption.
            </p>
          ) : null}
          {error ? <p className="text-xs text-red-400">{error}</p> : null}
          {clip.youtubeError ? (
            <p className="text-xs text-red-400">YouTube: {clip.youtubeError}</p>
          ) : null}
          {clip.tiktokError ? (
            <p className="text-xs text-red-400">TikTok: {clip.tiktokError}</p>
          ) : null}
          {!clip.youtubeError && !clip.tiktokError && clip.publishError ? (
            <p className="text-xs text-red-400">{clip.publishError}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
};
