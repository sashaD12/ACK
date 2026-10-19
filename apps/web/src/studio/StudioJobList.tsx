import type { FC } from "react";
import type { StudioJob } from "@narezchik/shared";

interface StudioJobListProps {
  jobs: StudioJob[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const STATUS_LABEL: Record<StudioJob["status"], string> = {
  queued: "В очереди",
  researching: "СМИ",
  writing: "Сценарий",
  voicing: "Озвучка",
  fetching: "Визуал",
  generating: "Генерация",
  rendering: "Рендер",
  ready: "Готово",
  publishing: "Публикация",
  published: "Опубликовано",
  failed: "Ошибка",
};

export const StudioJobList: FC<StudioJobListProps> = ({
  jobs,
  selectedId,
  onSelect,
}) => {
  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800 p-4 text-sm text-zinc-500">
        Студийных роликов пока нет.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {jobs.map((job) => {
        const active = job.id === selectedId;
        return (
          <button
            key={job.id}
            type="button"
            onClick={() => {
              onSelect(job.id);
            }}
            className={`w-full rounded-xl border px-3 py-3 text-left transition ${
              active
                ? "border-violet-400/60 bg-violet-400/10"
                : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
            }`}
          >
            <p className="truncate text-sm font-medium text-zinc-100">
              {job.topic}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {STATUS_LABEL[job.status]} · {job.progress}
            </p>
          </button>
        );
      })}
    </div>
  );
};
