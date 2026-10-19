import fs from "node:fs/promises";
import path from "node:path";
import type { StudioJob } from "@narezchik/shared";
import { paths } from "../config.ts";

export function studioJobDir(jobId: string): string {
  return path.join(paths.studioJobsDir, jobId);
}

export function studioJobFile(jobId: string): string {
  return path.join(studioJobDir(jobId), "job.json");
}

export async function ensureStudioDirs(): Promise<void> {
  await fs.mkdir(paths.studioJobsDir, { recursive: true });
}

export async function writeStudioJob(job: StudioJob): Promise<void> {
  const next: StudioJob = {
    ...job,
    updatedAt: new Date().toISOString(),
  };
  const dir = studioJobDir(job.id);
  await fs.mkdir(dir, { recursive: true });
  const file = studioJobFile(job.id);
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

export async function readStudioJob(jobId: string): Promise<StudioJob | null> {
  try {
    const raw = await fs.readFile(studioJobFile(jobId), "utf8");
    return JSON.parse(raw) as StudioJob;
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

export async function listStudioJobs(): Promise<StudioJob[]> {
  await ensureStudioDirs();
  const entries = await fs.readdir(paths.studioJobsDir, { withFileTypes: true });
  const jobs: StudioJob[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const job = await readStudioJob(entry.name);
    if (job) {
      jobs.push(job);
    }
  }
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return jobs;
}

export function resolveStudioPath(jobId: string, relativeFile: string): string {
  const base = path.resolve(studioJobDir(jobId));
  const target = path.resolve(base, relativeFile);
  if (!target.startsWith(base)) {
    throw new Error("Invalid path");
  }
  return target;
}
