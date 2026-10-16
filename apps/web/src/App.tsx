import { useEffect, useState, type FC } from "react";
import type { Job, SystemStatus } from "@narezchik/shared";
import { fetchJob, fetchJobs, fetchStatus } from "./api";
import { JobDetail } from "./components/JobDetail";
import { JobList } from "./components/JobList";
import { StatusBar } from "./components/StatusBar";
import { UploadPanel } from "./components/UploadPanel";

export const App: FC = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  async function refreshStatus(): Promise<void> {
    setStatus(await fetchStatus());
  }

  async function refreshJobs(): Promise<void> {
    const next = await fetchJobs();
    setJobs(next);
  }

  useEffect(() => {
    void refreshStatus();
    void refreshJobs();
    const timer = window.setInterval(() => {
      void refreshStatus();
      void refreshJobs();
    }, 2500);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedJob(null);
      return;
    }
    const fromList = jobs.find((job) => job.id === selectedId) ?? null;
    if (fromList) {
      setSelectedJob(fromList);
    }
    void fetchJob(selectedId).then(setSelectedJob);
  }, [selectedId, jobs]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1c1917,_#09090b_45%)]">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400">
              Shorts factory
            </p>
            <h1 className="mt-1 text-3xl font-extrabold text-white">Нарезачка</h1>
            <p className="mt-1 max-w-xl text-sm text-zinc-400">
              Локальный нарезчик: Whisper находит речь, Ollama выбирает хуки,
              FFmpeg собирает вертикальные ролики с субтитрами, тегами и превью.
            </p>
          </div>
          <StatusBar status={status} onRefresh={() => void refreshStatus()} />
        </header>
        {!status?.worker ? (
          <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            Воркер не запущен. В отдельном терминале:{" "}
            <code>python apps/worker/main.py</code>
          </div>
        ) : null}
        {!status?.ollama ? (
          <div className="mb-6 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
            Ollama недоступна. Установите Ollama и выполните{" "}
            <code>ollama pull qwen2.5:7b</code>. Без неё воркер сделает простую
            нарезку по таймингам.
          </div>
        ) : null}
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="space-y-4">
            <UploadPanel
              onCreated={(id) => {
                setSelectedId(id);
                void refreshJobs();
              }}
            />
            <JobList
              jobs={jobs}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
          {selectedJob ? (
            <JobDetail
              job={selectedJob}
              status={status}
              onJobChange={(job) => {
                setSelectedJob(job);
                setJobs((current) =>
                  current.map((item) => (item.id === job.id ? job : item))
                );
              }}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-zinc-500">
              Выберите задачу, чтобы править клипы и публиковать.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
