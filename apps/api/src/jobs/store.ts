import fs from "node:fs/promises";
import path from "node:path";
import type { Job } from "@narezchik/shared";
import { paths } from "../config.ts";

export function jobDir(jobId: string): string {
  return path.join(paths.jobsDir, jobId);
}

export function jobFile(jobId: string): string {
  return path.join(jobDir(jobId), "job.json");
}

export async function ensureDataDirs(): Promise<void> {
  await fs.mkdir(paths.jobsDir, { recursive: true });
  await fs.mkdir(paths.authDir, { recursive: true });
  await fs.mkdir(paths.studioJobsDir, { recursive: true });
}

export async function writeJob(job: Job): Promise<void> {
  const next: Job = {
    ...job,
    updatedAt: new Date().toISOString(),
  };
  const dir = jobDir(job.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, "clips"), { recursive: true });
  const file = jobFile(job.id);
  const tmp = `${file}.tmp`;
  const body = JSON.stringify(next, null, 2);
  await fs.writeFile(tmp, body, "utf8");
  try {
    await fs.rename(tmp, file);
  } catch {
    await fs.writeFile(file, body, "utf8");
    await fs.rm(tmp, { force: true });
  }
}

export async function readJob(jobId: string): Promise<Job | null> {
  try {
    const raw = await fs.readFile(jobFile(jobId), "utf8");
    return JSON.parse(raw) as Job;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function listJobs(): Promise<Job[]> {
  await ensureDataDirs();
  const entries = await fs.readdir(paths.jobsDir, { withFileTypes: true });
  const jobs: Job[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const job = await readJob(entry.name);
    if (job) {
      jobs.push(job);
    }
  }
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return jobs;
}

export function resolveJobPath(jobId: string, relativeFile: string): string {
  const base = path.resolve(jobDir(jobId));
  const target = path.resolve(base, relativeFile);
  if (!target.startsWith(base)) {
    throw new Error("Invalid path");
  }
  return target;
}
