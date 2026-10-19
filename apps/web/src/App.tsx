import { useEffect, useState, type FC } from "react";
import type { Job, StudioJob, SystemStatus } from "@narezchik/shared";
import { fetchJob, fetchJobs, fetchStatus } from "./api";
import { JobDetail } from "./components/JobDetail";
import { JobList } from "./components/JobList";
import { StatusBar } from "./components/StatusBar";
import { UploadPanel } from "./components/UploadPanel";
import { fetchStudioJob, fetchStudioJobs } from "./studio/api";
import { StudioJobDetail } from "./studio/StudioJobDetail";
import { StudioJobList } from "./studio/StudioJobList";
import { StudioPanel } from "./studio/StudioPanel";

type AppTab = "clipper" | "studio";

export const App: FC = () => {
  const [tab, setTab] = useState<AppTab>("clipper");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [studioJobs, setStudioJobs] = useState<StudioJob[]>([]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedStudioId, setSelectedStudioId] = useState<string | null>(null);
  const [selectedStudioJob, setSelectedStudioJob] = useState<StudioJob | null>(
    null
  );

  async function refreshStatus(): Promise<void> {
    setStatus(await fetchStatus());
  }

  async function refreshJobs(): Promise<void> {
    const next = await fetchJobs();
    setJobs(next);
  }

  async function refreshStudioJobs(): Promise<void> {
    const next = await fetchStudioJobs();
    setStudioJobs(next);
  }

  useEffect(() => {
    void refreshStatus();
    void refreshJobs();
    void refreshStudioJobs();
    const timer = window.setInterval(() => {
      void refreshStatus();
      void refreshJobs();
      void refreshStudioJobs();
    }, 2500);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const tiktokAuth = new URLSearchParams(window.location.search).get("tiktok");
  const tiktokReason = new URLSearchParams(window.location.search).get("reason");

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

  useEffect(() => {
    if (!selectedStudioId) {
      setSelectedStudioJob(null);
      return;
    }
    const fromList =
      studioJobs.find((job) => job.id === selectedStudioId) ?? null;
    if (fromList) {
      setSelectedStudioJob(fromList);
    }
    void fetchStudioJob(selectedStudioId).then(setSelectedStudioJob);
  }, [selectedStudioId, studioJobs]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1c1917,_#09090b_45%)]">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400">
              Shorts factory
            </p>
            <h1 className="mt-1 text-3xl font-extrabold text-white">Нарезачка</h1>
            <p className="mt-1 max-w-xl text-sm text-zinc-400">
              Нарезка длинных видео и отдельная faceless-студия уникального
              контента — в одном интерфейсе, разными воркерами.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setTab("clipper");
                }}
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                  tab === "clipper"
                    ? "bg-amber-400 text-zinc-950"
                    : "border border-zinc-700 text-zinc-300"
                }`}
              >
                Нарезка
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("studio");
                }}
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                  tab === "studio"
                    ? "bg-violet-400 text-zinc-950"
                    : "border border-zinc-700 text-zinc-300"
                }`}
              >
                Студия
              </button>
            </div>
          </div>
          <StatusBar status={status} onRefresh={() => void refreshStatus()} />
        </header>
        {!status?.worker ? (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            Воркер нарезки не запущен.{" "}
            <code>python apps/worker/main.py</code>
          </div>
        ) : null}
        {!status?.studioWorker ? (
          <div className="mb-4 rounded-xl border border-violet-500/30 bg-violet-400/10 px-4 py-3 text-sm text-violet-200">
            Студийный воркер не запущен.{" "}
            <code>python apps/studio-worker/main.py</code>
          </div>
        ) : null}
        {tiktokAuth === "error" ? (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            TikTok не подключился{tiktokReason ? `: ${tiktokReason}` : "."}
          </div>
        ) : null}
        {!status?.ollama ? (
          <div className="mb-6 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
            Ollama недоступна. Установите Ollama и выполните{" "}
            <code>ollama pull qwen2.5:7b</code>.
          </div>
        ) : null}
        {tab === "clipper" ? (
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
                onReloadJob={(jobId) => {
                  void fetchJob(jobId).then((job) => {
                    setSelectedJob(job);
                    setJobs((current) =>
                      current.map((item) => (item.id === job.id ? job : item))
                    );
                  });
                }}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-zinc-500">
                Выберите задачу нарезки, чтобы править клипы и публиковать.
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
            <div className="space-y-4">
              <StudioPanel
                onCreated={(id) => {
                  setSelectedStudioId(id);
                  void refreshStudioJobs();
                }}
              />
              <StudioJobList
                jobs={studioJobs}
                selectedId={selectedStudioId}
                onSelect={setSelectedStudioId}
              />
            </div>
            {selectedStudioJob ? (
              <StudioJobDetail
                job={selectedStudioJob}
                status={status}
                onJobChange={(job) => {
                  setSelectedStudioJob(job);
                  setStudioJobs((current) =>
                    current.map((item) => (item.id === job.id ? job : item))
                  );
                }}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-zinc-500">
                Выберите студийную задачу или создайте новую по теме/факту.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
