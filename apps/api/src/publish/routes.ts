import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  clipPendingOn,
  clipsForThisPublish,
  DEFAULT_JOB_SETTINGS,
  type Clip,
  type Platform,
} from "@narezchik/shared";
import { config } from "../config.ts";
import { isTiktokConnected } from "../auth/tiktok.ts";
import { isYoutubeConnected } from "../auth/youtube.ts";
import { listJobs, readJob, writeJob } from "../jobs/store.ts";
import { scheduleDeferredClips } from "./scheduler.ts";
import { publishClipToTiktok } from "./tiktok.ts";
import {
  fetchYoutubeStats,
  isYoutubeDailyLimitError,
  publishClipToYoutube,
  YOUTUBE_UPLOAD_LIMIT_ERROR,
  youtubePublishErrorMessage,
} from "./youtube.ts";

interface PublishBody {
  clipIds?: string[];
  platform?: Platform;
}

const YOUTUBE_STAGGER_MS = 12000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPlatform(value: string): value is Platform {
  return value === "youtube" || value === "tiktok";
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

export function registerPublishRoutes(app: FastifyInstance): void {
  app.post(
    "/api/jobs/:id/publish",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { id: string };
      const job = await readJob(params.id);
      if (!job) {
        return reply.code(404).send({ error: "Job not found" });
      }
      if (job.status !== "ready" && job.status !== "published") {
        return reply.code(409).send({ error: "Job is not ready to publish" });
      }
      const body = (request.body ?? {}) as PublishBody;
      if (!body.platform || !isPlatform(body.platform)) {
        return reply.code(400).send({ error: "Укажите платформу: youtube или tiktok" });
      }
      const platform = body.platform;
      const selected =
        body.clipIds && body.clipIds.length > 0
          ? job.clips.filter((clip) => body.clipIds?.includes(clip.id))
          : job.clips.filter((clip) =>
              platform === "youtube" ? clip.publishYoutube : clip.publishTiktok
            );
      const pending = selected.filter((clip) => clipPendingOn(clip, platform));
      if (pending.length === 0) {
        return reply
          .code(400)
          .send({ error: "Нет клипов для этой платформы" });
      }

      const maxPerRun =
        job.settings.maxPublishPerRun ?? DEFAULT_JOB_SETTINGS.maxPublishPerRun;
      const delayHours =
        job.settings.publishDelayHours ?? DEFAULT_JOB_SETTINGS.publishDelayHours;
      const privacy =
        job.settings.youtubePrivacy ?? DEFAULT_JOB_SETTINGS.youtubePrivacy;
      const batch = clipsForThisPublish(pending, maxPerRun, platform);
      const batchIds = new Set(batch.map((clip) => clip.id));
      const deferred = pending.filter((clip) => !batchIds.has(clip.id));
      const label = platform === "youtube" ? "YouTube" : "TikTok";

      job.status = "publishing";
      job.progress =
        deferred.length > 0
          ? `${label}: публикую ${batch.length} из ${pending.length} — остальные через ${delayHours}ч`
          : `${label}: публикую ${batch.length} клипов`;
      await writeJob(job);

      const youtubeConnected =
        platform === "youtube" ? await isYoutubeConnected() : false;
      const tiktokConnected =
        platform === "tiktok" ? await isTiktokConnected() : false;
      let youtubeLimitReached = false;
      let youtubeUploads = 0;
      let uploaded = 0;

      if (deferred.length > 0) {
        scheduleDeferredClips(
          deferred
            .map((clip) => job.clips.find((item) => item.id === clip.id))
            .filter((clip): clip is Clip => Boolean(clip)),
          platform,
          delayHours,
          `Отложено: за раз не больше ${maxPerRun} роликов на ${label}.`
        );
        await writeJob(job);
      }

      for (const clip of batch) {
        const live = job.clips.find((item) => item.id === clip.id);
        if (!live) {
          continue;
        }
        setPlatformError(live, platform, null);
        if (platform === "youtube") {
          live.scheduledYoutubeAt = null;
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
          live.scheduledTiktokAt = null;
          setPlatformError(
            live,
            platform,
            "TikTok API не настроен — скачайте ролик и вставьте caption вручную"
          );
        } else if (!tiktokConnected) {
          live.scheduledTiktokAt = null;
          setPlatformError(live, platform, "TikTok не подключён");
        } else {
          live.scheduledTiktokAt = null;
          try {
            live.tiktokPublishId = await publishClipToTiktok(job.id, live);
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

      const alreadyOut = job.clips.some(
        (clip) => clip.youtubeVideoId || clip.tiktokPublishId
      );
      const leftover = job.clips.filter((clip) => clipPendingOn(clip, platform));
      job.status = alreadyOut || uploaded > 0 ? "published" : "ready";
      if (uploaded === 0) {
        job.progress = `${label}: публикация не удалась, проверьте ошибки клипов`;
      } else if (leftover.length > 0) {
        job.progress = `${label}: опубликовано ${uploaded}. Ещё ${leftover.length} по расписанию через ~${delayHours}ч.`;
      } else {
        job.progress = `${label}: публикация завершена`;
      }
      await writeJob(job);
      return job;
    }
  );

  app.post(
    "/api/jobs/:id/stats",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { id: string };
      const job = await readJob(params.id);
      if (!job) {
        return reply.code(404).send({ error: "Job not found" });
      }
      const ids = job.clips
        .map((clip) => clip.youtubeVideoId)
        .filter((id): id is string => Boolean(id));
      if (ids.length === 0) {
        return reply.code(400).send({ error: "Нет опубликованных YouTube клипов" });
      }
      try {
        const stats = await fetchYoutubeStats(ids);
        for (const clip of job.clips) {
          if (!clip.youtubeVideoId) {
            continue;
          }
          const next = stats.get(clip.youtubeVideoId);
          if (next) {
            clip.youtubeStats = next;
          }
        }
        await writeJob(job);
        return job;
      } catch (error) {
        return reply.code(400).send({
          error:
            error instanceof Error
              ? error.message
              : "Не удалось получить статистику YouTube",
        });
      }
    }
  );

  app.post("/api/stats/refresh", async (_request, reply) => {
    const jobs = await listJobs();
    let updated = 0;
    for (const job of jobs) {
      const ids = job.clips
        .map((clip) => clip.youtubeVideoId)
        .filter((id): id is string => Boolean(id));
      if (ids.length === 0) {
        continue;
      }
      try {
        const stats = await fetchYoutubeStats(ids);
        let changed = false;
        for (const clip of job.clips) {
          if (!clip.youtubeVideoId) {
            continue;
          }
          const next = stats.get(clip.youtubeVideoId);
          if (next) {
            clip.youtubeStats = next;
            changed = true;
          }
        }
        if (changed) {
          await writeJob(job);
          updated += 1;
        }
      } catch {
        continue;
      }
    }
    return reply.send({ updated });
  });
}
