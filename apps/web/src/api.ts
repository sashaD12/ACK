import type { Clip, Job, JobSettings, SystemStatus } from "@narezchik/shared";

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        message = payload.error;
      }
    } catch {
      message = await response.text();
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function mediaUrl(jobId: string, relativeFile: string): string {
  return `/api/media/${jobId}/${relativeFile}`;
}

export async function fetchStatus(): Promise<SystemStatus> {
  const response = await fetch("/api/status");
  return parseResponse<SystemStatus>(response);
}

export async function fetchJobs(): Promise<Job[]> {
  const response = await fetch("/api/jobs");
  return parseResponse<Job[]>(response);
}

export async function fetchJob(id: string): Promise<Job> {
  const response = await fetch(`/api/jobs/${id}`);
  return parseResponse<Job>(response);
}

export async function createJobFromFile(
  file: File,
  settings: JobSettings
): Promise<Job> {
  const form = new FormData();
  form.append("file", file);
  form.append("settings", JSON.stringify(settings));
  const response = await fetch("/api/jobs", {
    method: "POST",
    body: form,
  });
  return parseResponse<Job>(response);
}

export async function createJobFromUrl(
  sourceUrl: string,
  settings: JobSettings
): Promise<Job> {
  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sourceUrl, settings }),
  });
  return parseResponse<Job>(response);
}

export async function updateClip(
  jobId: string,
  clipId: string,
  patch: Partial<
    Pick<Clip, "hook" | "youtube" | "tiktok" | "publishYoutube" | "publishTiktok">
  >
): Promise<Clip> {
  const response = await fetch(`/api/jobs/${jobId}/clips/${clipId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  return parseResponse<Clip>(response);
}

export async function publishJob(jobId: string, clipIds: string[]): Promise<Job> {
  const response = await fetch(`/api/jobs/${jobId}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ clipIds }),
  });
  return parseResponse<Job>(response);
}

export async function disconnectYoutube(): Promise<void> {
  await fetch("/api/auth/youtube/disconnect", { method: "POST" });
}

export async function disconnectTiktok(): Promise<void> {
  await fetch("/api/auth/tiktok/disconnect", { method: "POST" });
}
