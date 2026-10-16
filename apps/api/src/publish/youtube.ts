import fs from "node:fs";
import { google } from "googleapis";
import type { Clip } from "@narezchik/shared";
import { getYoutubeAuth } from "../auth/youtube.ts";
import { resolveJobPath } from "../jobs/store.ts";

export const YOUTUBE_UPLOAD_LIMIT_ERROR =
  "YouTube: дневной лимит загрузок канала исчерпан. Уже залитые ролики на месте — остальные опубликуйте завтра.";

interface YoutubeApiErrorBody {
  error?: {
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

function readYoutubeApiError(error: unknown): { reason: string; message: string } {
  if (typeof error !== "object" || error === null) {
    return { reason: "", message: "YouTube upload failed" };
  }
  const record = error as {
    message?: string;
    response?: { data?: YoutubeApiErrorBody };
  };
  const body = record.response?.data?.error;
  const reason = body?.errors?.[0]?.reason ?? "";
  const message =
    body?.message ??
    (typeof record.message === "string" ? record.message : "YouTube upload failed");
  return { reason, message };
}

export function isYoutubeDailyLimitError(error: unknown): boolean {
  const parsed = readYoutubeApiError(error);
  return (
    parsed.reason === "uploadLimitExceeded" ||
    parsed.message.includes("exceeded the number of videos")
  );
}

export function youtubePublishErrorMessage(error: unknown): string {
  if (isYoutubeDailyLimitError(error)) {
    return YOUTUBE_UPLOAD_LIMIT_ERROR;
  }
  const parsed = readYoutubeApiError(error);
  if (parsed.reason === "quotaExceeded") {
    return "YouTube API: квота Google Cloud на сегодня исчерпана. Подождите до завтра.";
  }
  return parsed.message;
}

export async function publishClipToYoutube(
  jobId: string,
  clip: Clip
): Promise<string> {
  const auth = await getYoutubeAuth();
  if (!auth) {
    throw new Error("YouTube is not connected");
  }
  const youtube = google.youtube({ version: "v3", auth });
  const videoPath = resolveJobPath(jobId, clip.videoFile);
  const description = clip.youtube.description.includes("#Shorts")
    ? clip.youtube.description
    : `${clip.youtube.description}\n\n#Shorts`;
  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: clip.youtube.title.slice(0, 100),
        description,
        tags: clip.youtube.tags,
        categoryId: "22",
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  });
  const videoId = response.data.id;
  if (!videoId) {
    throw new Error("YouTube did not return a video id");
  }
  return videoId;
}
