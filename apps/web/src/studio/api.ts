import type {
  Platform,
  StudioJob,
  StudioSettings,
} from "@narezchik/shared";

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

export function studioMediaUrl(jobId: string, relativeFile: string): string {
  return `/api/media/studio/${jobId}/${relativeFile}`;
}

export async function fetchStudioJobs(): Promise<StudioJob[]> {
  const response = await fetch("/api/studio/jobs");
  return parseResponse<StudioJob[]>(response);
}

export async function fetchStudioJob(id: string): Promise<StudioJob> {
  const response = await fetch(`/api/studio/jobs/${id}`);
  return parseResponse<StudioJob>(response);
}

export async function createStudioJob(
  topic: string,
  settings: StudioSettings
): Promise<StudioJob> {
  const response = await fetch("/api/studio/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ topic, settings }),
  });
  return parseResponse<StudioJob>(response);
}

export async function updateStudioJob(
  jobId: string,
  patch: Partial<
    Pick<
      StudioJob,
      "script" | "youtube" | "tiktok" | "publishYoutube" | "publishTiktok"
    >
  >
): Promise<StudioJob> {
  const response = await fetch(`/api/studio/jobs/${jobId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  return parseResponse<StudioJob>(response);
}

export async function publishStudioJob(
  jobId: string,
  platform: Platform
): Promise<StudioJob> {
  const response = await fetch(`/api/studio/jobs/${jobId}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ platform }),
  });
  return parseResponse<StudioJob>(response);
}
