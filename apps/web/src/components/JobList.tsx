import type { FC } from "react";
import type { Job } from "@narezchik/shared";

interface JobListProps {
  jobs: Job[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const statusLabel: Record<Job["status"], string> = {
  downloading: "Скачивание",
  queued: "В очереди",
  transcribing: "Транскрипт",
  clipping: "Хайлайты",
  rendering: "Рендер",
  ready: "Готово",
  publishing: "Публикация",
  published: "Опубликовано",
  failed: "Ошибка",
};

function displayName(job: Job): string {
  const raw = job.sourceName || job.sourceUrl || "Видео";
  if (!raw.startsWith("http")) {
    return raw;
  }
  try {
    const url = new URL(raw);
    const id = url.searchParams.get("v");
    if (id && url.hostname.includes("youtu")) {
      return `youtube.com/watch?v=${id}`;
    }
    return raw;
  } catch {
    return raw;
  }
}

export const JobList: FC<JobListProps> = ({ jobs, selectedId, onSelect }) => {
  if (jobs.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-800 p-6 text-sm text-zinc-500">
        Пока нет задач. Загрузите видео слева.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {jobs.map((job) => {
        const selected = job.id === selectedId;
        return (
          <button
            key={job.id}
            type="button"
            onClick={() => {
              onSelect(job.id);
            }}
            className={`w-full rounded-2xl border px-4 py-3 text-left ${
              selected
                ? "border-amber-400 bg-amber-400/10"
                : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="truncate font-medium text-zinc-100">
                {displayName(job)}
              </span>
              <span className="shrink-0 text-xs text-amber-300">
                {statusLabel[job.status]}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-zinc-400">{job.progress}</p>
          </button>
        );
      })}
    </div>
  );
};
