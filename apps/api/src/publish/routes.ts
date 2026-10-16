import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.ts";
import { isTiktokConnected } from "../auth/tiktok.ts";
import { isYoutubeConnected } from "../auth/youtube.ts";
import { readJob, writeJob } from "../jobs/store.ts";
import { publishClipToTiktok } from "./tiktok.ts";
import {
  isYoutubeDailyLimitError,
  publishClipToYoutube,
  YOUTUBE_UPLOAD_LIMIT_ERROR,
  youtubePublishErrorMessage,
} from "./youtube.ts";

interface PublishBody {
  clipIds?: string[];
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
      const selected =
        body.clipIds && body.clipIds.length > 0
          ? job.clips.filter((clip) => body.clipIds?.includes(clip.id))
          : job.clips;
      if (selected.length === 0) {
        return reply.code(400).send({ error: "No clips selected" });
      }

      job.status = "publishing";
      job.progress = "Публикую выбранные клипы";
      await writeJob(job);

      const youtubeConnected = await isYoutubeConnected();
      const tiktokConnected = await isTiktokConnected();
      let youtubeLimitReached = false;

      for (const clip of selected) {
        const live = job.clips.find((item) => item.id === clip.id);
        if (!live) {
          continue;
        }
        live.publishError = null;
        if (live.publishYoutube && !live.youtubeVideoId) {
          if (!youtubeConnected) {
            live.publishError = "YouTube не подключён";
          } else if (youtubeLimitReached) {
            live.publishError = YOUTUBE_UPLOAD_LIMIT_ERROR;
          } else {
            try {
              live.youtubeVideoId = await publishClipToYoutube(job.id, live);
            } catch (error) {
              live.publishError = youtubePublishErrorMessage(error);
              if (isYoutubeDailyLimitError(error)) {
                youtubeLimitReached = true;
              }
            }
          }
        }
        if (live.publishTiktok) {
          if (!config.tiktokClientKey || !config.tiktokClientSecret) {
            const extra = "TikTok API не настроен — скачайте ролик и вставьте caption вручную";
            live.publishError = live.publishError
              ? `${live.publishError}; ${extra}`
              : extra;
          } else if (!tiktokConnected) {
            const extra = "TikTok не подключён";
            live.publishError = live.publishError
              ? `${live.publishError}; ${extra}`
              : extra;
          } else {
            try {
              live.tiktokPublishId = await publishClipToTiktok(job.id, live);
            } catch (error) {
              const extra =
                error instanceof Error ? error.message : "TikTok upload failed";
              live.publishError = live.publishError
                ? `${live.publishError}; ${extra}`
                : extra;
            }
          }
        }
        await writeJob(job);
      }

      const published = job.clips.filter(
        (clip) => clip.youtubeVideoId || clip.tiktokPublishId
      );
      job.status = published.length > 0 ? "published" : "ready";
      job.progress =
        published.length > 0
          ? "Публикация завершена"
          : "Публикация не удалась, проверьте ошибки клипов";
      await writeJob(job);
      return job;
    }
  );
}
