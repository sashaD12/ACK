import { useState, type FC } from "react";
import type { Clip, SystemStatus } from "@narezchik/shared";
import { mediaUrl, updateClip } from "../api";

interface ClipCardProps {
  jobId: string;
  clip: Clip;
  status: SystemStatus | null;
  onChange: (clip: Clip) => void;
}

export const ClipCard: FC<ClipCardProps> = ({ jobId, clip, status, onChange }) => {
  const [busy, setBusy] = useState(false);

  async function patch(
    next: Partial<Pick<Clip, "hook" | "youtube" | "tiktok" | "publishYoutube" | "publishTiktok">>
  ): Promise<void> {
    setBusy(true);
    try {
      const updated = await updateClip(jobId, clip.id, next);
      onChange(updated);
    } finally {
      setBusy(false);
    }
  }

  async function copyCaption(): Promise<void> {
    await navigator.clipboard.writeText(clip.tiktok.caption);
  }

  const videoSrc = mediaUrl(jobId, clip.videoFile);
  const thumbSrc = mediaUrl(jobId, clip.thumbVerticalFile);

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
            {clip.start.toFixed(1)}с — {clip.end.toFixed(1)}с · {clip.reason}
          </p>
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
              TikTok inbox: {clip.tiktokPublishId}
            </p>
          ) : null}
          {clip.publishError ? (
            <p className="text-xs text-red-400">{clip.publishError}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
};
