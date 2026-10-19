export type JobStatus =
  | "downloading"
  | "queued"
  | "transcribing"
  | "clipping"
  | "rendering"
  | "ready"
  | "publishing"
  | "published"
  | "failed";

export type Platform = "youtube" | "tiktok";

export type YoutubePrivacy = "public" | "unlisted" | "private";

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words: WordTimestamp[];
}

export interface Transcript {
  language: string;
  duration: number;
  segments: TranscriptSegment[];
}

export interface YoutubeMeta {
  title: string;
  description: string;
  tags: string[];
}

export interface TiktokMeta {
  caption: string;
}

export interface ClipStats {
  views: number;
  likes: number;
  comments: number;
  fetchedAt: string;
}

export interface Clip {
  id: string;
  start: number;
  end: number;
  hook: string;
  reason: string;
  transcript: string;
  score: number;
  renderStyle: string | null;
  youtube: YoutubeMeta;
  tiktok: TiktokMeta;
  videoFile: string;
  thumbVerticalFile: string;
  thumbHorizontalFile: string;
  publishYoutube: boolean;
  publishTiktok: boolean;
  youtubeVideoId: string | null;
  tiktokPublishId: string | null;
  youtubeError?: string | null;
  tiktokError?: string | null;
  publishError: string | null;
  scheduledYoutubeAt?: string | null;
  scheduledTiktokAt?: string | null;
  youtubePublishedAt?: string | null;
  youtubeStats?: ClipStats | null;
}

export interface AdSegment {
  start: number;
  end: number;
  reason: string;
}

export interface JobSettings {
  clipMinDuration: number;
  clipMaxDuration: number;
  maxClips: number;
  language: string;
  whisperModel: string;
  ollamaModel: string;
  platforms: Platform[];
  skipAds: boolean;
  addMusic: boolean;
  montage: boolean;
  maxPublishPerRun: number;
  publishDelayHours: number;
  youtubePrivacy: YoutubePrivacy;
}

export interface Job {
  id: string;
  status: JobStatus;
  progress: string;
  createdAt: string;
  updatedAt: string;
  sourcePath: string;
  sourceName: string;
  sourceUrl: string | null;
  settings: JobSettings;
  clips: Clip[];
  ads: AdSegment[];
  error: string | null;
}

export interface WorkerHeartbeat {
  pid: number;
  updatedAt: string;
}

export interface SystemStatus {
  ffmpeg: boolean;
  ollama: boolean;
  worker: boolean;
  studioWorker: boolean;
  ytdlp: boolean;
  youtube: boolean;
  tiktok: boolean;
  youtubeConfigured: boolean;
  tiktokConfigured: boolean;
}

export type StudioJobStatus =
  | "queued"
  | "researching"
  | "writing"
  | "voicing"
  | "fetching"
  | "generating"
  | "rendering"
  | "ready"
  | "publishing"
  | "published"
  | "failed";

export interface StudioBeat {
  text: string;
  seconds: number;
  query: string;
}

export interface StudioScript {
  hook: string;
  script: string;
  beats: StudioBeat[];
}

export interface StudioNewsSource {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  snippet: string;
  imageUrl: string | null;
}

export interface StudioSettings {
  language: string;
  ollamaModel: string;
  voice: string;
  durationSec: number;
  platforms: Platform[];
  maxPublishPerRun: number;
  publishDelayHours: number;
  youtubePrivacy: YoutubePrivacy;
  editorialStyle: string;
}

export interface StudioJob {
  id: string;
  status: StudioJobStatus;
  progress: string;
  createdAt: string;
  updatedAt: string;
  topic: string;
  settings: StudioSettings;
  sources: StudioNewsSource[];
  script: StudioScript | null;
  audioFile: string | null;
  videoFile: string | null;
  thumbFile: string | null;
  youtube: YoutubeMeta;
  tiktok: TiktokMeta;
  publishYoutube: boolean;
  publishTiktok: boolean;
  youtubeVideoId: string | null;
  tiktokPublishId: string | null;
  youtubeError: string | null;
  tiktokError: string | null;
  scheduledYoutubeAt: string | null;
  scheduledTiktokAt: string | null;
  youtubePublishedAt: string | null;
  error: string | null;
}

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  language: "ru",
  ollamaModel: "qwen2.5:7b",
  voice: "ru-RU-DmitryNeural",
  durationSec: 35,
  platforms: ["youtube", "tiktok"],
  maxPublishPerRun: 1,
  publishDelayHours: 4,
  youtubePrivacy: "public",
  editorialStyle:
    "Политический faceless Shorts: коротко, жёстко, по делу. Факты из СМИ, подача голосом нашей команды, без клише и воды.",
};

export function studioPendingOn(job: StudioJob, platform: Platform): boolean {
  if (platform === "youtube") {
    return job.publishYoutube && !job.youtubeVideoId;
  }
  return job.publishTiktok && !job.tiktokPublishId;
}

export function defaultStudioVoice(language: string): string {
  if (language === "en") {
    return "en-US-GuyNeural";
  }
  return "ru-RU-DmitryNeural";
}

export const DEFAULT_JOB_SETTINGS: JobSettings = {
  clipMinDuration: 18,
  clipMaxDuration: 180,
  maxClips: 12,
  language: "ru",
  whisperModel: "small",
  ollamaModel: "qwen2.5:7b",
  platforms: ["youtube", "tiktok"],
  skipAds: true,
  addMusic: false,
  montage: true,
  maxPublishPerRun: 2,
  publishDelayHours: 4,
  youtubePrivacy: "public",
};

export function clipPendingOn(clip: Clip, platform: Platform): boolean {
  if (platform === "youtube") {
    return clip.publishYoutube && !clip.youtubeVideoId;
  }
  return clip.publishTiktok && !clip.tiktokPublishId;
}

export function pendingPublishClips(clips: Clip[], platform?: Platform): Clip[] {
  return clips.filter((clip) => {
    if (platform) {
      return clipPendingOn(clip, platform);
    }
    return clipPendingOn(clip, "youtube") || clipPendingOn(clip, "tiktok");
  });
}

export function clipsForThisPublish(
  clips: Clip[],
  maxPerRun: number,
  platform?: Platform
): Clip[] {
  const limit = Math.max(1, maxPerRun);
  return [...pendingPublishClips(clips, platform)]
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, limit);
}

export function createJobId(): string {
  return crypto.randomUUID();
}

export function createStudioJobId(): string {
  return crypto.randomUUID();
}

export function createClipId(index: number): string {
  return `clip-${String(index + 1).padStart(2, "0")}`;
}

export function formatScheduleLabel(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
