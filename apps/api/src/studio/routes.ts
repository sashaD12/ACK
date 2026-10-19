import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  DEFAULT_STUDIO_SETTINGS,
  defaultStudioVoice,
  studioPendingOn,
  type Platform,
  type StudioJob,
  type StudioSettings,
  type StudioScript,
  type YoutubePrivacy,
} from "@narezchik/shared";
import { config } from "../config.ts";
import { isTiktokConnected } from "../auth/tiktok.ts";
import { isYoutubeConnected } from "../auth/youtube.ts";
import {
  YOUTUBE_UPLOAD_LIMIT_ERROR,
} from "../publish/youtube.ts";
import {
  ensureStudioDirs,
  listStudioJobs,
  readStudioJob,
  resolveStudioPath,
  studioJobDir,
  writeStudioJob,
} from "./store.ts";
import {
  isYoutubeDailyLimitError,
  publishStudioToTiktok,
  publishStudioToYoutube,
  youtubePublishErrorMessage,
} from "./publish.ts";

interface CreateStudioBody {
  topic?: string;
  settings?: Partial<StudioSettings>;
}

interface PatchStudioBody {
  script?: Partial<StudioScript>;
  youtube?: Partial<StudioJob["youtube"]>;
  tiktok?: Partial<StudioJob["tiktok"]>;
  publishYoutube?: boolean;
  publishTiktok?: boolean;
}

interface PublishBody {
  platform?: Platform;
}

function normalizePrivacy(value: YoutubePrivacy | undefined): YoutubePrivacy {
  if (value === "public" || value === "unlisted" || value === "private") {
    return value;
  }
  return DEFAULT_STUDIO_SETTINGS.youtubePrivacy;
}

function mergeStudioSettings(
  input: Partial<StudioSettings> | undefined
): StudioSettings {
  const language = input?.language ?? DEFAULT_STUDIO_SETTINGS.language;
  const platforms: Platform[] =
    input?.platforms && input.platforms.length > 0
      ? input.platforms
      : DEFAULT_STUDIO_SETTINGS.platforms;
  const editorialStyle = String(
    input?.editorialStyle ?? DEFAULT_STUDIO_SETTINGS.editorialStyle
  ).trim();
  return {
    language,
    ollamaModel: input?.ollamaModel ?? config.ollamaModel,
    voice: input?.voice || defaultStudioVoice(language),
    durationSec: Math.max(
      20,
      Math.min(60, input?.durationSec ?? DEFAULT_STUDIO_SETTINGS.durationSec)
    ),
    platforms,
    maxPublishPerRun:
      input?.maxPublishPerRun ?? DEFAULT_STUDIO_SETTINGS.maxPublishPerRun,
    publishDelayHours:
      input?.publishDelayHours ?? DEFAULT_STUDIO_SETTINGS.publishDelayHours,
    youtubePrivacy: normalizePrivacy(input?.youtubePrivacy),
    editorialStyle:
      editorialStyle.length > 0
        ? editorialStyle.slice(0, 800)
        : DEFAULT_STUDIO_SETTINGS.editorialStyle,
  };
}

function isPlatform(value: string): value is Platform {
  return value === "youtube" || value === "tiktok";
}

export function registerStudioRoutes(app: FastifyInstance): void {
  app.get("/api/studio/jobs", async () => {
    return listStudioJobs();
  });

  app.get(
    "/api/studio/jobs/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { id: string };
      const job = await readStudioJob(params.id);
      if (!job) {
        return reply.code(404).send({ error: "Studio job not found" });
      }
      return job;
    }
  );

  app.post("/api/studio/jobs", async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureStudioDirs();
    const body = (request.body ?? {}) as CreateStudioBody;
    const topic = String(body.topic || "").trim();
    if (topic.length < 3) {
      return reply.code(400).send({ error: "Укажите тему новости" });
    }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const settings = mergeStudioSettings(body.settings);
    await fs.mkdir(studioJobDir(id), { recursive: true });
    const job: StudioJob = {
      id,
      status: "queued",
      progress: "В очереди студии",
      createdAt,
      updatedAt: createdAt,
      topic,
      settings,
      sources: [],
      script: null,
      audioFile: null,
      videoFile: null,
      thumbFile: null,
      youtube: {
        title: topic.slice(0, 70),
        description: `${topic}\n\n#Shorts`,
        tags: ["shorts", "news", "politics"],
      },
      tiktok: {
        caption: topic.slice(0, 200),
      },
      publishYoutube: settings.platforms.includes("youtube"),
      publishTiktok: settings.platforms.includes("tiktok"),
      youtubeVideoId: null,
      tiktokPublishId: null,
      youtubeError: null,
      tiktokError: null,
      scheduledYoutubeAt: null,
      scheduledTiktokAt: null,
      youtubePublishedAt: null,
      error: null,
    };
    await writeStudioJob(job);
    return reply.code(201).send(job);
  });

  app.patch(
    "/api/studio/jobs/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { id: string };
      const job = await readStudioJob(params.id);
      if (!job) {
        return reply.code(404).send({ error: "Studio job not found" });
      }
      const body = (request.body ?? {}) as PatchStudioBody;
      if (body.script && job.script) {
        job.script = {
          ...job.script,
          ...body.script,
          beats: body.script.beats ?? job.script.beats,
        };
      }
      if (body.youtube) {
        job.youtube = {
          ...job.youtube,
          ...body.youtube,
          tags: body.youtube.tags ?? job.youtube.tags,
        };
      }
      if (body.tiktok) {
        job.tiktok = {
          ...job.tiktok,
          ...body.tiktok,
        };
      }
      if (typeof body.publishYoutube === "boolean") {
        job.publishYoutube = body.publishYoutube;
      }
      if (typeof body.publishTiktok === "boolean") {
        job.publishTiktok = body.publishTiktok;
      }
      await writeStudioJob(job);
      return job;
    }
  );

  app.post(
    "/api/studio/jobs/:id/publish",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { id: string };
      const job = await readStudioJob(params.id);
      if (!job) {
        return reply.code(404).send({ error: "Studio job not found" });
      }
      if (job.status !== "ready" && job.status !== "published") {
        return reply.code(409).send({ error: "Studio job is not ready" });
      }
      if (!job.videoFile) {
        return reply.code(400).send({ error: "Нет готового видео" });
      }
      const body = (request.body ?? {}) as PublishBody;
      if (!body.platform || !isPlatform(body.platform)) {
        return reply.code(400).send({ error: "Укажите платформу: youtube или tiktok" });
      }
      const platform = body.platform;
      if (!studioPendingOn(job, platform)) {
        return reply.code(400).send({ error: "Нечего публиковать на эту платформу" });
      }

      const label = platform === "youtube" ? "YouTube" : "TikTok";
      job.status = "publishing";
      job.progress = `${label}: публикую студийный ролик`;
      await writeStudioJob(job);

      if (platform === "youtube") {
        job.youtubeError = null;
        if (!(await isYoutubeConnected())) {
          job.youtubeError = "YouTube не подключён";
        } else {
          try {
            job.youtubeVideoId = await publishStudioToYoutube(job);
            job.youtubePublishedAt = new Date().toISOString();
            job.scheduledYoutubeAt = null;
          } catch (error) {
            job.youtubeError = youtubePublishErrorMessage(error);
            if (isYoutubeDailyLimitError(error)) {
              job.youtubeError = YOUTUBE_UPLOAD_LIMIT_ERROR;
            }
          }
        }
      } else if (!config.tiktokClientKey || !config.tiktokClientSecret) {
        job.tiktokError =
          "TikTok API не настроен — скачайте ролик и вставьте caption вручную";
      } else if (!(await isTiktokConnected())) {
        job.tiktokError = "TikTok не подключён";
      } else {
        job.tiktokError = null;
        try {
          job.tiktokPublishId = await publishStudioToTiktok(job);
          job.scheduledTiktokAt = null;
        } catch (error) {
          job.tiktokError =
            error instanceof Error ? error.message : "TikTok upload failed";
        }
      }

      const uploaded =
        (platform === "youtube" && Boolean(job.youtubeVideoId)) ||
        (platform === "tiktok" && Boolean(job.tiktokPublishId));
      const alreadyOut = Boolean(job.youtubeVideoId || job.tiktokPublishId);
      job.status = alreadyOut || uploaded ? "published" : "ready";
      job.progress = uploaded
        ? `${label}: публикация завершена`
        : `${label}: публикация не удалась`;
      await writeStudioJob(job);
      return job;
    }
  );

  app.get(
    "/api/media/studio/:id/:file",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { id: string; file: string };
      const job = await readStudioJob(params.id);
      if (!job) {
        return reply.code(404).send({ error: "Studio job not found" });
      }
      try {
        const absolute = resolveStudioPath(params.id, params.file);
        await fs.access(absolute);
        const ext = path.extname(absolute).toLowerCase();
        const types: Record<string, string> = {
          ".mp4": "video/mp4",
          ".mp3": "audio/mpeg",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".json": "application/json",
        };
        reply.header("Content-Type", types[ext] ?? "application/octet-stream");
        const query = request.query as { download?: string };
        if (query.download === "1") {
          reply.header(
            "Content-Disposition",
            `attachment; filename="${params.file}"`
          );
        }
        return reply.send(createReadStream(absolute));
      } catch {
        return reply.code(404).send({ error: "File not found" });
      }
    }
  );
}
