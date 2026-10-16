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

export interface Clip {
  id: string;
  start: number;
  end: number;
  hook: string;
  reason: string;
  transcript: string;
  youtube: YoutubeMeta;
  tiktok: TiktokMeta;
  videoFile: string;
  thumbVerticalFile: string;
  thumbHorizontalFile: string;
  publishYoutube: boolean;
  publishTiktok: boolean;
  youtubeVideoId: string | null;
  tiktokPublishId: string | null;
  publishError: string | null;
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
  ytdlp: boolean;
  youtube: boolean;
  tiktok: boolean;
  youtubeConfigured: boolean;
  tiktokConfigured: boolean;
}

export const DEFAULT_JOB_SETTINGS: JobSettings = {
  clipMinDuration: 15,
  clipMaxDuration: 60,
  maxClips: 5,
  language: "ru",
  whisperModel: "base",
  ollamaModel: "qwen2.5:7b",
  platforms: ["youtube", "tiktok"],
  skipAds: true,
};

export function createJobId(): string {
  return crypto.randomUUID();
}

export function createClipId(index: number): string {
  return `clip-${String(index + 1).padStart(2, "0")}`;
}
