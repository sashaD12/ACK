import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { google } from "googleapis";
import type { StudioJob, YoutubePrivacy } from "@narezchik/shared";
import { getYoutubeAuth } from "../auth/youtube.ts";
import { getTiktokTokens } from "../auth/tiktok.ts";
import {
  isYoutubeDailyLimitError,
  youtubePublishErrorMessage,
} from "../publish/youtube.ts";
import { resolveStudioPath } from "./store.ts";

const TIKTOK_MIN_CHUNK_BYTES = 5 * 1024 * 1024;
const TIKTOK_MAX_CHUNK_BYTES = 64 * 1024 * 1024;

function normalizePrivacy(value: YoutubePrivacy | undefined): YoutubePrivacy {
  if (value === "unlisted" || value === "private" || value === "public") {
    return value;
  }
  return "public";
}

export async function publishStudioToYoutube(job: StudioJob): Promise<string> {
  if (!job.videoFile) {
    throw new Error("Studio video is missing");
  }
  const auth = await getYoutubeAuth();
  if (!auth) {
    throw new Error("YouTube is not connected");
  }
  const youtube = google.youtube({ version: "v3", auth });
  const videoPath = resolveStudioPath(job.id, job.videoFile);
  const description = job.youtube.description.includes("#Shorts")
    ? job.youtube.description
    : `${job.youtube.description}\n\n#Shorts`;
  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: job.youtube.title.slice(0, 100),
        description,
        tags: job.youtube.tags,
        categoryId: "22",
      },
      status: {
        privacyStatus: normalizePrivacy(job.settings.youtubePrivacy),
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

function planTiktokChunks(videoSize: number): {
  chunkSize: number;
  totalChunkCount: number;
} {
  if (videoSize <= TIKTOK_MAX_CHUNK_BYTES) {
    return {
      chunkSize: videoSize,
      totalChunkCount: 1,
    };
  }
  let chunkSize = TIKTOK_MAX_CHUNK_BYTES;
  if (Math.floor(videoSize / chunkSize) < 2) {
    chunkSize = Math.floor(videoSize / 2);
  }
  if (chunkSize < TIKTOK_MIN_CHUNK_BYTES) {
    chunkSize = TIKTOK_MIN_CHUNK_BYTES;
  }
  return {
    chunkSize,
    totalChunkCount: Math.floor(videoSize / chunkSize),
  };
}

async function uploadTiktokChunks(
  uploadUrl: string,
  videoPath: string,
  videoSize: number,
  plan: { chunkSize: number; totalChunkCount: number }
): Promise<void> {
  const file = await fsPromises.open(videoPath, "r");
  try {
    let offset = 0;
    for (let index = 0; index < plan.totalChunkCount; index += 1) {
      const isLast = index === plan.totalChunkCount - 1;
      const end = isLast ? videoSize : offset + plan.chunkSize;
      const length = end - offset;
      const chunk = Buffer.alloc(length);
      await file.read(chunk, 0, length, offset);
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(length),
          "Content-Range": `bytes ${offset}-${end - 1}/${videoSize}`,
        },
        body: chunk,
      });
      const expectedStatus = isLast ? 201 : 206;
      if (response.status !== expectedStatus) {
        throw new Error(`TikTok upload failed with ${response.status}`);
      }
      offset = end;
    }
  } finally {
    await file.close();
  }
}

export async function publishStudioToTiktok(job: StudioJob): Promise<string> {
  if (!job.videoFile) {
    throw new Error("Studio video is missing");
  }
  const tokens = await getTiktokTokens();
  if (!tokens) {
    throw new Error("TikTok is not connected");
  }
  const videoPath = resolveStudioPath(job.id, job.videoFile);
  const stat = await fsPromises.stat(videoPath);
  const videoSize = stat.size;
  const plan = planTiktokChunks(videoSize);
  const initResponse = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        source_info: {
          source: "FILE_UPLOAD",
          video_size: videoSize,
          chunk_size: plan.chunkSize,
          total_chunk_count: plan.totalChunkCount,
        },
      }),
    }
  );
  const initJson = (await initResponse.json()) as {
    error?: { message?: string };
    data?: { publish_id: string; upload_url: string };
  };
  if (!initJson.data?.upload_url || !initJson.data.publish_id) {
    throw new Error(initJson.error?.message ?? "TikTok init upload failed");
  }
  await uploadTiktokChunks(initJson.data.upload_url, videoPath, videoSize, plan);
  return initJson.data.publish_id;
}

export { isYoutubeDailyLimitError, youtubePublishErrorMessage };
