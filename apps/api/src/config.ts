import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    return fallback;
  }
  return value;
}

export const config = {
  port: Number(envString("PORT", "3001")),
  repoRoot,
  dataDir: path.resolve(repoRoot, envString("DATA_DIR", "./data")),
  webOrigin: envString("WEB_ORIGIN", "http://localhost:5173"),
  ollamaHost: envString("OLLAMA_HOST", "http://localhost:11434"),
  ollamaModel: envString("OLLAMA_MODEL", "qwen2.5:7b"),
  ffmpegPath: envString("FFMPEG_PATH", "ffmpeg"),
  ytdlpPath: envString("YTDLP_PATH", "yt-dlp"),
  googleClientId: envString("GOOGLE_CLIENT_ID", ""),
  googleClientSecret: envString("GOOGLE_CLIENT_SECRET", ""),
  googleRedirectUri: envString(
    "GOOGLE_REDIRECT_URI",
    "http://localhost:3001/api/auth/youtube/callback"
  ),
  tiktokClientKey: envString("TIKTOK_CLIENT_KEY", ""),
  tiktokClientSecret: envString("TIKTOK_CLIENT_SECRET", ""),
  tiktokRedirectUri: envString(
    "TIKTOK_REDIRECT_URI",
    "http://localhost:3001/api/auth/tiktok/callback"
  ),
};

export const paths = {
  jobsDir: path.join(config.dataDir, "jobs"),
  authDir: path.join(config.dataDir, "auth"),
  heartbeatFile: path.join(config.dataDir, "worker-heartbeat.json"),
  youtubeTokenFile: path.join(config.dataDir, "auth", "youtube.json"),
  tiktokTokenFile: path.join(config.dataDir, "auth", "tiktok.json"),
};
