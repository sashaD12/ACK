import {
  clipPendingOn,
  clipsForThisPublish,
  DEFAULT_JOB_SETTINGS,
  type Clip,
  type Job,
  type Platform,
} from "@narezchik/shared";
import { config } from "../config.ts";
import { isTiktokConnected } from "../auth/tiktok.ts";
import { isYoutubeConnected } from "../auth/youtube.ts";
import { listJobs, readJob, writeJob } from "../jobs/store.ts";
import { publishClipToTiktok } from "./tiktok.ts";
import {
  fetchYoutubeStats,
  isYoutubeDailyLimitError,
  publishClipToYoutube,
  YOUTUBE_UPLOAD_LIMIT_ERROR,
  youtubePublishErrorMessage,
} from "./youtube.ts";

const YOUTUBE_STAGGER_MS = 12000;
const STATS_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const STATS_REFRESH_MS = 6 * 60 * 60 * 1000;

let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function setPlatformError(
  clip: Clip,
  platform: Platform,
  message: string | null
): void {
  if (platform === "youtube") {
    clip.youtubeError = message;
  } else {
    clip.tiktokError = message;
  }
  clip.publishError = null;
}

function scheduleField(platform: Platform): "scheduledYoutubeAt" | "scheduledTiktokAt" {
  return platform === "youtube" ? "scheduledYoutubeAt" : "scheduledTiktokAt";
}

function isDue(iso: string | null | undefined, now: number): boolean {
  if (!iso) {
    return false;
  }
  const stamp = Date.parse(iso);
  if (Number.isNaN(stamp)) {
    return false;
  }
  return stamp <= now;
}

async function publishDueForJob(job: Job, platform: Platform): Promise<boolean> {
  if (job.status === "publishing" || job.status === "downloading") {
    return false;
  }
  if (job.status !== "ready" && job.status !== "published") {
    return false;
  }
  const field = scheduleField(platform);
  const now = Date.now();
  const due = job.clips.filter(
    (clip) =>
      clipPendingOn(clip, platform) && isDue(clip[field], now)
  );
  if (due.length === 0) {
    return false;
  }
  const maxPerRun =
    job.settings.maxPublishPerRun ?? DEFAULT_JOB_SETTINGS.maxPublishPerRun;
  const batch = clipsForThisPublish(due, maxPerRun, platform);
  if (batch.length === 0) {
    return false;
  }

  const label = platform === "youtube" ? "YouTube" : "TikTok";
  job.status = "publishing";
  job.progress = `${label}: автопубликация ${batch.length} по расписанию`;
  await writeJob(job);

  const youtubeConnected =
    platform === "youtube" ? await isYoutubeConnected() : false;
  const tiktokConnected =
    platform === "tiktok" ? await isTiktokConnected() : false;
  let youtubeLimitReached = false;
  let youtubeUploads = 0;
  let uploaded = 0;
  const privacy =
    job.settings.youtubePrivacy ?? DEFAULT_JOB_SETTINGS.youtubePrivacy;

  for (const clip of batch) {
    const live = job.clips.find((item) => item.id === clip.id);
    if (!live) {
      continue;
    }
    setPlatformError(live, platform, null);
    if (platform === "youtube") {
      if (!youtubeConnected) {
        setPlatformError(live, platform, "YouTube не подключён");
      } else if (youtubeLimitReached) {
        setPlatformError(live, platform, YOUTUBE_UPLOAD_LIMIT_ERROR);
      } else {
        if (youtubeUploads > 0) {
          await sleep(YOUTUBE_STAGGER_MS);
        }
        try {
          live.youtubeVideoId = await publishClipToYoutube(
            job.id,
            live,
            privacy
          );
          live.youtubePublishedAt = new Date().toISOString();
          live.scheduledYoutubeAt = null;
          youtubeUploads += 1;
          uploaded += 1;
        } catch (error) {
          setPlatformError(live, platform, youtubePublishErrorMessage(error));
          if (isYoutubeDailyLimitError(error)) {
            youtubeLimitReached = true;
          }
        }
      }
    } else if (!config.tiktokClientKey || !config.tiktokClientSecret) {
      setPlatformError(
        live,
        platform,
        "TikTok API не настроен — скачайте ролик и вставьте caption вручную"
      );
    } else if (!tiktokConnected) {
      setPlatformError(live, platform, "TikTok не подключён");
    } else {
      try {
        live.tiktokPublishId = await publishClipToTiktok(job.id, live);
        live.scheduledTiktokAt = null;
        uploaded += 1;
      } catch (error) {
        setPlatformError(
          live,
          platform,
          error instanceof Error ? error.message : "TikTok upload failed"
        );
      }
    }
    await writeJob(job);
  }

  const leftover = job.clips.filter((clip) => clipPendingOn(clip, platform));
  const alreadyOut = job.clips.some(
    (clip) => clip.youtubeVideoId || clip.tiktokPublishId
  );
  job.status = alreadyOut || uploaded > 0 ? "published" : "ready";
  if (uploaded === 0) {
    job.progress = `${label}: автопубликация не удалась`;
  } else if (leftover.length > 0) {
    job.progress = `${label}: автопубликовано ${uploaded}. Ещё ${leftover.length} в очереди.`;
  } else {
    job.progress = `${label}: автопубликация завершена`;
  }
  await writeJob(job);
  return uploaded > 0;
}

async function refreshStatsForJob(job: Job): Promise<boolean> {
  const now = Date.now();
  const targets = job.clips.filter((clip) => {
    if (!clip.youtubeVideoId) {
      return false;
    }
    const publishedAt = clip.youtubePublishedAt
      ? Date.parse(clip.youtubePublishedAt)
      : Date.parse(job.updatedAt);
    if (Number.isNaN(publishedAt) || now - publishedAt < STATS_MIN_AGE_MS) {
      return false;
    }
    const fetchedAt = clip.youtubeStats?.fetchedAt
      ? Date.parse(clip.youtubeStats.fetchedAt)
      : 0;
    return Number.isNaN(fetchedAt) || now - fetchedAt >= STATS_REFRESH_MS;
  });
  if (targets.length === 0) {
    return false;
  }
  try {
    const stats = await fetchYoutubeStats(
      targets.map((clip) => clip.youtubeVideoId as string)
    );
    let changed = false;
    for (const clip of job.clips) {
      if (!clip.youtubeVideoId) {
        continue;
      }
      const next = stats.get(clip.youtubeVideoId);
      if (!next) {
        continue;
      }
      clip.youtubeStats = next;
      changed = true;
    }
    if (changed) {
      await writeJob(job);
    }
    return changed;
  } catch {
    return false;
  }
}

export async function runPublishSchedulerTick(): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  try {
    const jobs = await listJobs();
    for (const listed of jobs) {
      let job = (await readJob(listed.id)) ?? listed;
      await publishDueForJob(job, "youtube");
      job = (await readJob(listed.id)) ?? job;
      await publishDueForJob(job, "tiktok");
      job = (await readJob(listed.id)) ?? job;
      await refreshStatsForJob(job);
    }
  } finally {
    running = false;
  }
}

export function startPublishScheduler(): void {
  void runPublishSchedulerTick();
  setInterval(() => {
    void runPublishSchedulerTick();
  }, 60_000);
}

export function scheduleDeferredClips(
  clips: Clip[],
  platform: Platform,
  delayHours: number,
  messagePrefix: string
): void {
  const hours = Math.max(1, delayHours);
  const when = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const field = scheduleField(platform);
  for (const clip of clips) {
    clip[field] = when;
    setPlatformError(
      clip,
      platform,
      `${messagePrefix} Запланировано на ${new Date(when).toLocaleString("ru-RU")}.`
    );
  }
}
