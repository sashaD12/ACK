import fs from "node:fs/promises";
import type { Clip } from "@narezchik/shared";
import { getTiktokTokens } from "../auth/tiktok.ts";
import { resolveJobPath } from "../jobs/store.ts";

const TIKTOK_MIN_CHUNK_BYTES = 5 * 1024 * 1024;
const TIKTOK_MAX_CHUNK_BYTES = 64 * 1024 * 1024;

interface TiktokChunkPlan {
  chunkSize: number;
  totalChunkCount: number;
}

interface TiktokInitResponse {
  error?: {
    code: string;
    message: string;
  };
  data?: {
    publish_id: string;
    upload_url: string;
  };
}

function planTiktokChunks(videoSize: number): TiktokChunkPlan {
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
  plan: TiktokChunkPlan
): Promise<void> {
  const file = await fs.open(videoPath, "r");
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

export async function publishClipToTiktok(
  jobId: string,
  clip: Clip
): Promise<string> {
  const tokens = await getTiktokTokens();
  if (!tokens) {
    throw new Error("TikTok is not connected");
  }
  const videoPath = resolveJobPath(jobId, clip.videoFile);
  const stat = await fs.stat(videoPath);
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
  const initJson = (await initResponse.json()) as TiktokInitResponse;
  if (!initJson.data?.upload_url || !initJson.data.publish_id) {
    const message = initJson.error?.message ?? "TikTok init upload failed";
    throw new Error(message);
  }
  await uploadTiktokChunks(initJson.data.upload_url, videoPath, videoSize, plan);
  return initJson.data.publish_id;
}
