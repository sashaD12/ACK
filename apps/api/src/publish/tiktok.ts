import fs from "node:fs/promises";
import type { Clip } from "@narezchik/shared";
import { getTiktokTokens } from "../auth/tiktok.ts";
import { resolveJobPath } from "../jobs/store.ts";

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
          chunk_size: videoSize,
          total_chunk_count: 1,
        },
      }),
    }
  );
  const initJson = (await initResponse.json()) as TiktokInitResponse;
  if (!initJson.data?.upload_url || !initJson.data.publish_id) {
    const message = initJson.error?.message ?? "TikTok init upload failed";
    throw new Error(message);
  }
  const file = await fs.readFile(videoPath);
  const uploadResponse = await fetch(initJson.data.upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(videoSize),
      "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
    },
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(`TikTok upload failed with ${uploadResponse.status}`);
  }
  return initJson.data.publish_id;
}
