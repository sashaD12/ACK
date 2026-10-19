import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  DEFAULT_JOB_SETTINGS,
  type Clip,
  type Job,
  type JobSettings,
  type Platform,
  type YoutubePrivacy,
} from "@narezchik/shared";
import { config } from "../config.ts";
import {
  ensureDataDirs,
  jobDir,
  listJobs,
  readJob,
  resolveJobPath,
  writeJob,
} from "./store.ts";
import { startSourceDownload } from "./source-download.ts";

interface CreateJobBody {
  sourceUrl?: string;
  settings?: Partial<JobSettings>;
}

interface ClipPatch {
  hook?: string;
  youtube?: Partial<Clip["youtube"]>;
  tiktok?: Partial<Clip["tiktok"]>;
  publishYoutube?: boolean;
  publishTiktok?: boolean;
}

function normalizePrivacy(value: YoutubePrivacy | undefined): YoutubePrivacy {
  if (value === "public" || value === "unlisted" || value === "private") {
    return value;
  }
  return DEFAULT_JOB_SETTINGS.youtubePrivacy;
}

function mergeSettings(input: Partial<JobSettings> | undefined): JobSettings {
  const platforms: Platform[] =
    input?.platforms && input.platforms.length > 0
      ? input.platforms
      : DEFAULT_JOB_SETTINGS.platforms;
  return {
    clipMinDuration: input?.clipMinDuration ?? DEFAULT_JOB_SETTINGS.clipMinDuration,
    clipMaxDuration: input?.clipMaxDuration ?? DEFAULT_JOB_SETTINGS.clipMaxDuration,
    maxClips: input?.maxClips ?? DEFAULT_JOB_SETTINGS.maxClips,
    language: input?.language ?? DEFAULT_JOB_SETTINGS.language,
    whisperModel: input?.whisperModel ?? DEFAULT_JOB_SETTINGS.whisperModel,
    ollamaModel: input?.ollamaModel ?? config.ollamaModel,
    platforms,
    skipAds: input?.skipAds ?? DEFAULT_JOB_SETTINGS.skipAds,
    addMusic: input?.addMusic ?? DEFAULT_JOB_SETTINGS.addMusic,
    montage: input?.montage ?? DEFAULT_JOB_SETTINGS.montage,
    maxPublishPerRun:
      input?.maxPublishPerRun ?? DEFAULT_JOB_SETTINGS.maxPublishPerRun,
    publishDelayHours:
      input?.publishDelayHours ?? DEFAULT_JOB_SETTINGS.publishDelayHours,
    youtubePrivacy: normalizePrivacy(input?.youtubePrivacy),
  };
}

function fieldString(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return fieldString(raw[0]);
  }
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    const value = (raw as { value: unknown }).value;
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function parseSettingsField(value: unknown): Partial<JobSettings> | undefined {
  const text = fieldString(value);
  if (!text || text.length === 0) {
    return undefined;
  }
  return JSON.parse(text) as Partial<JobSettings>;
}

export function registerJobRoutes(app: FastifyInstance): void {
  app.get("/api/jobs", async () => {
    return listJobs();
  });

  app.get(
    "/api/jobs/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { id: string };
      const job = await readJob(params.id);
      if (!job) {
        return reply.code(404).send({ error: "Job not found" });
      }
      return job;
    }
  );

  app.post("/api/jobs", async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureDataDirs();
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const dir = jobDir(id);
    await fs.mkdir(path.join(dir, "clips"), { recursive: true });

    const contentType = request.headers["content-type"] ?? "";
    let sourceUrl: string | null = null;
    let sourceName = "source.mp4";
    let settings = mergeSettings(undefined);

    if (contentType.includes("multipart/form-data")) {
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: "Video file or sourceUrl is required" });
      }
      const fields = data.fields as Record<string, unknown>;
      const urlField = fieldString(fields.sourceUrl);
      settings = mergeSettings(parseSettingsField(fields.settings));
      if (urlField && urlField.length > 0) {
        sourceUrl = urlField;
        sourceName = urlField;
      } else {
        sourceName = data.filename || "source.mp4";
        const ext = path.extname(sourceName) || ".mp4";
        const sourcePath = path.join(dir, `source${ext}`);
        await pipeline(data.file, createWriteStream(sourcePath));
        const job: Job = {
          id,
          status: "queued",
          progress: "Файл загружен, в очереди",
          createdAt,
          updatedAt: createdAt,
          sourcePath: path.basename(sourcePath),
          sourceName,
          sourceUrl: null,
          settings,
          clips: [],
          ads: [],
          error: null,
        };
        await writeJob(job);
        return reply.code(201).send(job);
      }
    } else {
      const body = request.body as CreateJobBody;
      settings = mergeSettings(body.settings);
      sourceUrl = body.sourceUrl ?? null;
      sourceName = body.sourceUrl ?? "source.mp4";
    }

    if (!sourceUrl) {
      return reply.code(400).send({ error: "Video file or sourceUrl is required" });
    }

    const pending: Job = {
      id,
      status: "downloading",
      progress: "Скачиваю исходное видео",
      createdAt,
      updatedAt: createdAt,
      sourcePath: "source.mp4",
      sourceName,
      sourceUrl,
      settings,
      clips: [],
      ads: [],
      error: null,
    };
    await writeJob(pending);
    void startSourceDownload(pending);
    return reply.code(201).send(pending);
  });

  app.patch(
    "/api/jobs/:id/clips/:clipId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { id: string; clipId: string };
      const job = await readJob(params.id);
      if (!job) {
        return reply.code(404).send({ error: "Job not found" });
      }
      const body = request.body as ClipPatch;
      const index = job.clips.findIndex((clip) => clip.id === params.clipId);
      if (index < 0) {
        return reply.code(404).send({ error: "Clip not found" });
      }
      const current = job.clips[index];
      job.clips[index] = {
        ...current,
        hook: body.hook ?? current.hook,
        youtube: {
          ...current.youtube,
          ...body.youtube,
          tags: body.youtube?.tags ?? current.youtube.tags,
        },
        tiktok: {
          ...current.tiktok,
          ...body.tiktok,
        },
        publishYoutube: body.publishYoutube ?? current.publishYoutube,
        publishTiktok: body.publishTiktok ?? current.publishTiktok,
      };
      await writeJob(job);
      return job.clips[index];
    }
  );

  app.get(
    "/api/media/:id/clips/:file",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { id: string; file: string };
      const job = await readJob(params.id);
      if (!job) {
        return reply.code(404).send({ error: "Job not found" });
      }
      const relative = `clips/${params.file}`;
      try {
        const absolute = resolveJobPath(params.id, relative);
        await fs.access(absolute);
        const ext = path.extname(absolute).toLowerCase();
        const types: Record<string, string> = {
          ".mp4": "video/mp4",
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
