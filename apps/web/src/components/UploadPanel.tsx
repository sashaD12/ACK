import { useState, type ChangeEvent, type FC, type FormEvent } from "react";
import { DEFAULT_JOB_SETTINGS, type JobSettings, type Platform } from "@narezchik/shared";
import { createJobFromFile, createJobFromUrl } from "../api";

interface UploadPanelProps {
  onCreated: (jobId: string) => void;
}

function togglePlatform(current: Platform[], platform: Platform): Platform[] {
  if (current.includes(platform)) {
    return current.filter((item) => item !== platform);
  }
  return [...current, platform];
}

export const UploadPanel: FC<UploadPanelProps> = ({ onCreated }) => {
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [settings, setSettings] = useState<JobSettings>(DEFAULT_JOB_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const job = file
        ? await createJobFromFile(file, settings)
        : await createJobFromUrl(sourceUrl.trim(), settings);
      onCreated(job.id);
      setFile(null);
      setSourceUrl("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Ошибка загрузки");
    } finally {
      setBusy(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
  }

  const canSubmit = Boolean(file) || sourceUrl.trim().length > 8;

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-xl"
    >
      <h2 className="text-lg font-semibold text-white">Новая нарезка</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Загрузите своё длинное видео или вставьте ссылку на свой ролик YouTube.
      </p>
      <label className="mt-4 block text-sm text-zinc-300">
        Файл
        <input
          type="file"
          accept="video/mp4,video/quicktime,video/x-matroska,.mp4,.mov,.mkv"
          onChange={onFileChange}
          className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-amber-400 file:px-3 file:py-1.5 file:font-semibold file:text-zinc-950"
        />
      </label>
      <label className="mt-3 block text-sm text-zinc-300">
        Или URL YouTube
        <input
          value={sourceUrl}
          onChange={(event) => {
            setSourceUrl(event.target.value);
          }}
          placeholder="https://www.youtube.com/watch?v=..."
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-amber-400"
        />
      </label>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-sm text-zinc-300">
          Мин. сек
          <input
            type="number"
            min={8}
            max={180}
            value={settings.clipMinDuration}
            onChange={(event) => {
              setSettings({
                ...settings,
                clipMinDuration: Number(event.target.value),
              });
            }}
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm text-zinc-300">
          Макс. сек
          <input
            type="number"
            min={10}
            max={180}
            value={settings.clipMaxDuration}
            onChange={(event) => {
              setSettings({
                ...settings,
                clipMaxDuration: Number(event.target.value),
              });
            }}
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm text-zinc-300">
          Клипов
          <input
            type="number"
            min={1}
            max={12}
            value={settings.maxClips}
            onChange={(event) => {
              setSettings({ ...settings, maxClips: Number(event.target.value) });
            }}
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm text-zinc-300">
          Язык
          <select
            value={settings.language}
            onChange={(event) => {
              setSettings({ ...settings, language: event.target.value });
            }}
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
            <option value="auto">Авто</option>
          </select>
        </label>
        <label className="text-sm text-zinc-300">
          Whisper
          <select
            value={settings.whisperModel}
            onChange={(event) => {
              setSettings({ ...settings, whisperModel: event.target.value });
            }}
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          >
            <option value="tiny">tiny — швидко</option>
            <option value="base">base — баланс</option>
            <option value="small">small — якісніше</option>
            <option value="medium">medium — повільно</option>
          </select>
        </label>
        <label className="text-sm text-zinc-300">
          Ollama модель
          <input
            value={settings.ollamaModel}
            onChange={(event) => {
              setSettings({ ...settings, ollamaModel: event.target.value });
            }}
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
        </label>
      </div>
      <div className="mt-3 flex gap-4 text-sm text-zinc-300">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.platforms.includes("youtube")}
            onChange={() => {
              setSettings({
                ...settings,
                platforms: togglePlatform(settings.platforms, "youtube"),
              });
            }}
          />
          YouTube Shorts
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.platforms.includes("tiktok")}
            onChange={() => {
              setSettings({
                ...settings,
                platforms: togglePlatform(settings.platforms, "tiktok"),
              });
            }}
          />
          TikTok
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.skipAds}
            onChange={(event) => {
              setSettings({ ...settings, skipAds: event.target.checked });
            }}
          />
          Вирізати рекламу автора
        </label>
      </div>
      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      <button
        type="submit"
        disabled={!canSubmit || busy}
        className="mt-4 w-full rounded-xl bg-amber-400 px-4 py-2.5 font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Загружаю..." : "Нарезать"}
      </button>
    </form>
  );
};
