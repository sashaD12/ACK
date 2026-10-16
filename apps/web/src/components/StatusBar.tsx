import type { FC } from "react";
import type { SystemStatus } from "@narezchik/shared";
import { disconnectTiktok, disconnectYoutube } from "../api";

interface StatusBarProps {
  status: SystemStatus | null;
  onRefresh: () => void;
}

interface DotProps {
  ok: boolean;
  label: string;
}

const StatusDot: FC<DotProps> = ({ ok, label }) => {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
      <span
        className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-zinc-600"}`}
      />
      {label}
    </span>
  );
};

export const StatusBar: FC<StatusBarProps> = ({ status, onRefresh }) => {
  if (!status) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusDot ok={status.ffmpeg} label="FFmpeg" />
      <StatusDot ok={status.ytdlp} label="yt-dlp" />
      <StatusDot ok={status.ollama} label="Ollama" />
      <StatusDot ok={status.worker} label="Воркер" />
      {status.youtube ? (
        <button
          type="button"
          className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs text-red-200"
          onClick={() => {
            void disconnectYoutube().then(onRefresh);
          }}
        >
          YouTube подключён
        </button>
      ) : status.youtubeConfigured ? (
        <a
          href="/api/auth/youtube"
          className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:border-amber-400 hover:text-amber-300"
        >
          Подключить YouTube
        </a>
      ) : (
        <span className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-500">
          YouTube: нет ключей
        </span>
      )}
      {status.tiktok ? (
        <button
          type="button"
          className="rounded-full border border-pink-500/40 bg-pink-500/10 px-3 py-1 text-xs text-pink-200"
          onClick={() => {
            void disconnectTiktok().then(onRefresh);
          }}
        >
          TikTok подключён
        </button>
      ) : status.tiktokConfigured ? (
        <a
          href="/api/auth/tiktok"
          className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:border-amber-400 hover:text-amber-300"
        >
          Подключить TikTok
        </a>
      ) : (
        <span className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-500">
          TikTok: скачивание вручную
        </span>
      )}
    </div>
  );
};
