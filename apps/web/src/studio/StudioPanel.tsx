import { useState, type FC, type FormEvent } from "react";
import {
  DEFAULT_STUDIO_SETTINGS,
  defaultStudioVoice,
  type Platform,
  type StudioSettings,
  type YoutubePrivacy,
} from "@narezchik/shared";
import { createStudioJob } from "./api";

interface StudioPanelProps {
  onCreated: (jobId: string) => void;
}

function togglePlatform(current: Platform[], platform: Platform): Platform[] {
  if (current.includes(platform)) {
    return current.filter((item) => item !== platform);
  }
  return [...current, platform];
}

export const StudioPanel: FC<StudioPanelProps> = ({ onCreated }) => {
  const [topic, setTopic] = useState("");
  const [settings, setSettings] = useState<StudioSettings>(DEFAULT_STUDIO_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const job = await createStudioJob(topic.trim(), settings);
      onCreated(job.id);
      setTopic("");
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Ошибка создания"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-xl"
    >
      <h2 className="text-lg font-semibold text-white">Faceless студия</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Тема политической новости → поиск в сторонних СМИ → сценарий голосом
        команды → озвучка и локальные визуалы. Нарезка не затрагивается.
      </p>
      <label className="mt-4 block text-sm text-zinc-300">
        Тема новости
        <textarea
          value={topic}
          rows={3}
          onChange={(event) => {
            setTopic(event.target.value);
          }}
          placeholder="Тема новости (система сама найдёт в СМИ)"
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-amber-400"
        />
      </label>
      <label className="mt-3 block text-sm text-zinc-300">
        Голос команды / тон
        <textarea
          value={settings.editorialStyle}
          rows={2}
          onChange={(event) => {
            setSettings({
              ...settings,
              editorialStyle: event.target.value,
            });
          }}
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-amber-400"
        />
      </label>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-sm text-zinc-300">
          Язык
          <select
            value={settings.language}
            onChange={(event) => {
              const language = event.target.value;
              setSettings({
                ...settings,
                language,
                voice: defaultStudioVoice(language),
              });
            }}
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="text-sm text-zinc-300">
          Длительность, сек
          <input
            type="number"
            min={20}
            max={60}
            value={settings.durationSec}
            onChange={(event) => {
              setSettings({
                ...settings,
                durationSec: Number(event.target.value),
              });
            }}
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
        </label>
        <label className="col-span-2 text-sm text-zinc-300">
          Голос (edge-tts)
          <input
            value={settings.voice}
            onChange={(event) => {
              setSettings({ ...settings, voice: event.target.value });
            }}
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
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
        <label className="text-sm text-zinc-300">
          YouTube privacy
          <select
            value={settings.youtubePrivacy}
            onChange={(event) => {
              setSettings({
                ...settings,
                youtubePrivacy: event.target.value as YoutubePrivacy,
              });
            }}
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          >
            <option value="public">public</option>
            <option value="unlisted">unlisted</option>
            <option value="private">private</option>
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm text-zinc-300">
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
      </div>
      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      <button
        type="submit"
        disabled={topic.trim().length < 3 || busy}
        className="mt-4 w-full rounded-xl bg-violet-400 px-4 py-2.5 font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Создаю..." : "Сгенерировать ролик"}
      </button>
    </form>
  );
};
