import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";

interface CommandSpec {
  command: string;
  args: string[];
}

export interface DownloadOptions {
  onProgress?: (message: string) => void;
}

const SOURCE_EXTS = [".mp4", ".mkv", ".webm", ".mov"];
const STALL_MS = 180_000;
const FORMAT =
  "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080][ext=mp4]/b";

function pidFilePath(jobDirectory: string): string {
  return path.join(jobDirectory, ".ytdlp.pid");
}

function killProcessTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
}

export function killJobDownload(jobDirectory: string): void {
  const file = pidFilePath(jobDirectory);
  if (!fs.existsSync(file)) {
    return;
  }
  const raw = fs.readFileSync(file, "utf8").trim();
  const pid = Number(raw);
  killProcessTree(pid);
  fs.rmSync(file, { force: true });
}

export function findDownloadedSource(jobDirectory: string): string | null {
  if (!fs.existsSync(jobDirectory)) {
    return null;
  }
  for (const ext of SOURCE_EXTS) {
    const candidate = path.join(jobDirectory, `source${ext}`);
    if (!fs.existsSync(candidate)) {
      continue;
    }
    const stat = fs.statSync(candidate);
    if (stat.size > 0) {
      return candidate;
    }
  }
  return null;
}

export function cleanIncompleteDownloads(jobDirectory: string): void {
  if (!fs.existsSync(jobDirectory)) {
    return;
  }
  const names = fs.readdirSync(jobDirectory);
  for (const name of names) {
    if (!name.startsWith("source.")) {
      continue;
    }
    if (/^source\.(mp4|mkv|webm|mov)$/i.test(name)) {
      continue;
    }
    fs.rmSync(path.join(jobDirectory, name), { force: true });
  }
}

function parseProgress(line: string): string | null {
  const percent = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
  if (percent) {
    const size = line.match(/of\s+~?\s*([0-9.]+[KMG]iB)/i);
    const speed = line.match(/at\s+([0-9.]+[KMG]iB\/s)/i);
    const eta = line.match(/ETA\s+([0-9:]+)/i);
    const parts = [`Скачиваю ${percent[1]}%`];
    if (size) {
      parts.push(`из ${size[1]}`);
    }
    if (speed) {
      parts.push(speed[1]);
    }
    if (eta) {
      parts.push(`осталось ${eta[1]}`);
    }
    return parts.join(" · ");
  }
  if (/\[Merger\]|Merging formats/i.test(line)) {
    return "Склеиваю видео и звук";
  }
  if (/Destination:/i.test(line)) {
    return "Сохраняю файл";
  }
  return null;
}

function runCommand(
  spec: CommandSpec,
  cwd: string,
  onProgress?: (message: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(spec.command, spec.args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    function finish(error: Error | null): void {
      if (settled) {
        return;
      }
      settled = true;
      if (stallTimer) {
        clearTimeout(stallTimer);
      }
      fs.rmSync(pidFilePath(cwd), { force: true });
      if (error) {
        reject(error);
        return;
      }
      resolve();
    }

    function bumpStall(): void {
      if (stallTimer) {
        clearTimeout(stallTimer);
      }
      stallTimer = setTimeout(() => {
        if (child.pid) {
          killProcessTree(child.pid);
        }
        finish(new Error("yt-dlp завис: нет прогресса больше 3 минут"));
      }, STALL_MS);
    }

    if (child.pid) {
      fs.writeFileSync(pidFilePath(cwd), String(child.pid), "utf8");
    }

    function onChunk(chunk: Buffer): void {
      bumpStall();
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 40_000) {
        stderr = stderr.slice(-20_000);
      }
      if (!onProgress) {
        return;
      }
      for (const line of text.split(/\r?\n/)) {
        const progress = parseProgress(line.trim());
        if (progress) {
          onProgress(progress);
        }
      }
    }

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    bumpStall();

    child.on("error", (error) => {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code === "ENOENT") {
        finish(
          new Error("yt-dlp не найден. Установите: python -m pip install yt-dlp")
        );
        return;
      }
      finish(error instanceof Error ? error : new Error(String(error)));
    });

    child.on("close", (code) => {
      if (code === 0) {
        finish(null);
        return;
      }
      finish(new Error(`yt-dlp exited with ${code}: ${stderr.trim()}`));
    });
  });
}

function ytdlpCommands(ytdlpArgs: string[]): CommandSpec[] {
  const commands: CommandSpec[] = [];
  const seen = new Set<string>();
  function add(command: string, args: string[]): void {
    const key = `${command}\0${args.join("\0")}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    commands.push({ command, args });
  }
  if (fs.existsSync(config.ytdlpPath)) {
    add(config.ytdlpPath, ytdlpArgs);
  }
  add("python", ["-m", "yt_dlp", ...ytdlpArgs]);
  add("yt-dlp", ytdlpArgs);
  return commands;
}

function ffmpegLocation(): string | null {
  if (fs.existsSync(config.ffmpegPath)) {
    return path.dirname(config.ffmpegPath);
  }
  return null;
}

export async function downloadSource(
  url: string,
  jobDirectory: string,
  options: DownloadOptions = {}
): Promise<string> {
  killJobDownload(jobDirectory);
  const existing = findDownloadedSource(jobDirectory);
  if (existing) {
    return existing;
  }
  cleanIncompleteDownloads(jobDirectory);

  const output = path.join(jobDirectory, "source.%(ext)s");
  const ytdlpArgs = [
    "--no-playlist",
    "--newline",
    "--retries",
    "10",
    "--fragment-retries",
    "10",
    "--concurrent-fragments",
    "8",
    "--socket-timeout",
    "30",
    "-f",
    FORMAT,
    "--merge-output-format",
    "mp4",
    "-o",
    output,
    url,
  ];
  if (process.platform === "win32") {
    ytdlpArgs.unshift("--windows-filenames");
  }
  const ffmpegDir = ffmpegLocation();
  if (ffmpegDir) {
    ytdlpArgs.unshift("--ffmpeg-location", ffmpegDir);
  }

  let lastError: unknown = null;
  for (const spec of ytdlpCommands(ytdlpArgs)) {
    try {
      await runCommand(spec, jobDirectory, options.onProgress);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes("yt-dlp не найден") &&
        !message.includes("ENOENT")
      ) {
        break;
      }
    }
  }
  if (lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  const downloaded = findDownloadedSource(jobDirectory);
  if (!downloaded) {
    throw new Error("yt-dlp завершился, но исходный файл не найден");
  }
  return downloaded;
}
