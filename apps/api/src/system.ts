import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SystemStatus, WorkerHeartbeat } from "@narezchik/shared";
import { isTiktokConnected } from "./auth/tiktok.ts";
import { isYoutubeConnected } from "./auth/youtube.ts";
import { config, paths } from "./config.ts";
import { readJsonFile } from "./auth/tokens.ts";

const execFileAsync = promisify(execFile);

async function canRun(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function isOllamaUp(): Promise<boolean> {
  try {
    const response = await fetch(`${config.ollamaHost}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function isWorkerAlive(): Promise<boolean> {
  const heartbeat = await readJsonFile<WorkerHeartbeat>(paths.heartbeatFile);
  if (!heartbeat) {
    return false;
  }
  const age = Date.now() - new Date(heartbeat.updatedAt).getTime();
  return age < 45_000;
}

async function isYtdlpAvailable(): Promise<boolean> {
  if (await canRun(config.ytdlpPath, ["--version"])) {
    return true;
  }
  return canRun("python", ["-m", "yt_dlp", "--version"]);
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const [ffmpeg, ollama, worker, ytdlp, youtube, tiktok] = await Promise.all([
    canRun(config.ffmpegPath, ["-version"]),
    isOllamaUp(),
    isWorkerAlive(),
    isYtdlpAvailable(),
    isYoutubeConnected(),
    isTiktokConnected(),
  ]);
  return {
    ffmpeg,
    ollama,
    worker,
    ytdlp,
    youtube,
    tiktok,
    youtubeConfigured: Boolean(config.googleClientId && config.googleClientSecret),
    tiktokConfigured: Boolean(config.tiktokClientKey && config.tiktokClientSecret),
  };
}
