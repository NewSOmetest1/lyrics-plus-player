import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Gamepad2,
  GripVertical,
  Heart,
  KeyRound,
  Loader2,
  Minus,
  PlugZap,
  Plus,
  Palette,
  RefreshCw,
  RotateCcw,
  Sparkles,
  TextCursorInput,
  Trash2,
  X,
} from "lucide-react";

import { backend, isDesktop, type ProviderTestResult } from "@/lib/api";
import type { LyricsMode, MusicFolder } from "@/types";
import { usePlayerStore } from "@/store/playerStore";
import {
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  useSettingsStore,
  type LyricsAlign,
  type ProviderId,
} from "@/store/settingsStore";
import {
  formatTrackDelay,
  useTrackDelayStore,
} from "@/store/trackDelayStore";
import { useToastStore } from "@/store/toastStore";
import { useLucidSettingsStore } from "@/store/lucidSettingsStore";
import { useSpotifyLikedStore } from "@/store/spotifyLikedStore";
import { SpotifyAuthCard } from "@/components/settings/SpotifyAuthCard";
import { cn } from "@/lib/cn";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const EASE = [0.2, 0, 0, 1] as const;

const PROVIDER_META: Record<
  ProviderId,
  { name: string; description: string; badge: string }
> = {
  lrclib: {
    name: "LRCLIB",
    description: "Free open synced-lyrics database. Recommended.",
    badge: "lrclib.net",
  },
  spotify: {
    name: "Spotify",
    description: "Spotify Color Lyrics. Native login stores both sp_dc and sp_key.",
    badge: "sp_dc + sp_key",
  },
  musixmatch: {
    name: "Musixmatch",
    description: "App-mobile API with word-level richsync. Token handled automatically.",
    badge: "autonomous",
  },
  embedded: {
    name: "Embedded tags",
    description: "Read lyrics stored inside local FLAC / MP3 files.",
    badge: "local",
  },
};

const SYNC_MODE_META: Record<LyricsMode, { name: string; description: string }> = {
  karaoke: {
    name: "Karaoke",
    description: "Word-by-word highlight, estimated when only lines are timed",
  },
  synced: {
    name: "Synced",
    description: "Line-by-line highlight from any time-coded source",
  },
  unsynced: {
    name: "Unsynced",
    description: "Plain text without timing, used as the final fallback",
  },
};

async function runProviderTest(
  provider: "lrclib" | "spotify" | "musixmatch",
): Promise<ProviderTestResult | null> {
  const meta = PROVIDER_META[provider];
  try {
    const result = await backend.testProvider(provider);
    const lines = `${result.lines} line${result.lines === 1 ? "" : "s"}`;
    if (result.ok) {
      useToastStore.getState().push({
        kind: "success",
        title: `✓ ${meta.name} Connected (${lines} ${result.synced ? "synced" : "unsynced"})`,
        description: result.sample[0] ?? result.message,
      });
    } else {
      useToastStore.getState().push({
        kind: "error",
        title: `✕ ${meta.name} Error: ${result.statusText || "Failed"}`,
        description: result.message || `${lines} synced`,
      });
    }
    return result;
  } catch (error) {
    useToastStore.getState().push({
      kind: "error",
      title: `✕ ${meta.name} Test Error`,
      description: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function TestProviderButton({
  provider,
  busy,
  result,
  onTest,
  label = "Test",
}: {
  provider: "lrclib" | "spotify" | "musixmatch";
  busy: boolean;
  result?: "success" | "error" | null;
  onTest: () => void;
  label?: string;
}) {
  const meta = PROVIDER_META[provider];
  return (
    <button
      type="button"
      onClick={onTest}
      disabled={busy}
      data-test-result={busy ? "testing" : (result ?? "idle")}
      title={
        result === "success"
          ? `${meta.name}: last test passed`
          : result === "error"
            ? `${meta.name}: last test failed`
            : `Test ${meta.name} with Blinding Lights`
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[9.5px] font-semibold transition disabled:opacity-50",
        result === "success"
          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
          : result === "error"
            ? "border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/15"
            : "border-white/[0.08] bg-white/[0.04] text-white/45 hover:bg-white/[0.09] hover:text-white/80",
      )}
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : result === "success" ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : result === "error" ? (
        <X className="h-3 w-3" strokeWidth={3} />
      ) : (
        <PlugZap className="h-3 w-3" />
      )}
      {busy ? "Testing…" : label}
    </button>
  );
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-white/[0.06] px-5 py-4 last:border-b-0">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06] text-white/55">
          {icon}
        </span>
        <div>
          <h3 className="text-[12px] font-bold text-white">{title}</h3>
          <p className="text-[10.5px] text-white/30">{description}</p>
        </div>
      </div>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-white/55">{label}</span>
        <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white/60">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="range-input w-full"
        style={{ "--range-progress": `${percent}%` } as CSSProperties}
      />
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <span className="text-[11px] font-medium text-white/55">{label}</span>
        {description && <p className="text-[10px] text-white/25">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="toggle-switch shrink-0"
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  );
}

function Select<T extends string | number>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        value={value}
        onChange={(event) => {
          const raw = event.target.value;
          const next = options.find((option) => String(option.value) === raw);
          if (next) onChange(next.value);
        }}
        className="h-8 w-full appearance-none rounded-lg border border-white/[0.08] bg-white/[0.05] pl-2.5 pr-7 text-[11px] font-medium text-white/80 outline-none transition hover:bg-white/[0.08] focus:border-accent/40"
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)} className="bg-[#16161a]">
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-white/35" />
    </div>
  );
}

function ColorControl({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
}) {
  const isVar = value.startsWith("rgba") || value.startsWith("rgb");
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-medium text-white/55">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value.startsWith("#") ? value : fallback}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-9 cursor-pointer rounded-md border border-white/10 bg-transparent p-0.5"
          aria-label={label}
        />
        <button
          type="button"
          onClick={() => onChange(fallback)}
          className="rounded-md bg-white/[0.05] px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-white/35 transition hover:bg-white/[0.08] hover:text-white/60"
        >
          auto
        </button>
      </div>
      {isVar && <span className="sr-only">rgba</span>}
    </div>
  );
}

function DiscordPresenceField({ open }: { open: boolean }) {
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void backend
      .getSetting("discord_client_id")
      .then((stored) => {
        if (active) setValue(stored ?? "");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open]);

  const save = async () => {
    if (!isDesktop) {
      useToastStore.getState().push({
        kind: "info",
        title: "Desktop app only",
        description: "Discord RPC is provided by the Electron main process.",
      });
      return;
    }
    setSaving(true);
    try {
      await backend.setSetting("discord_client_id", value.trim());
      useToastStore.getState().push({
        kind: "success",
        title: value.trim()
          ? "Discord Rich Presence enabled"
          : "Discord Rich Presence disabled",
        description: value.trim()
          ? "Keep the Discord desktop app running to see your status."
          : "The application id was cleared.",
      });
    } catch (error) {
      useToastStore.getState().push({
        kind: "error",
        title: "Could not save Discord application id",
        description: String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="text-[11px] font-semibold text-white/70">Discord application id</p>
      <p className="mt-1 text-[10px] leading-relaxed text-white/25">
        Create an app at discord.com/developers/applications and paste its
        Application ID. Leave empty to disable. The Discord desktop client must be
        running.
      </p>
      <div className="mt-2 flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <input
            type={revealed ? "text" : "password"}
            value={value}
            onChange={(event) => setValue(event.target.value.trim())}
            placeholder="e.g. 123456789012345678"
            inputMode="numeric"
            spellCheck={false}
            autoComplete="off"
            className="h-8 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] pl-2.5 pr-8 text-[11px] tabular-nums text-white placeholder:text-white/25 outline-none transition focus:border-accent/40 focus:bg-white/[0.06]"
          />
          <button
            type="button"
            onClick={() => setRevealed((shown) => !shown)}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/30 transition hover:text-white/70"
            aria-label={
              revealed
                ? "Hide Discord application id"
                : "Show Discord application id"
            }
            title={revealed ? "Hide" : "Show"}
          >
            {revealed ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="shrink-0 rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-[10.5px] font-bold text-black transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function PathField({
  label,
  description,
  value,
  placeholder,
  onChange,
  onBrowse,
}: {
  label: string;
  description: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onBrowse?: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="text-[11px] font-semibold text-white/70">{label}</p>
      <p className="mt-0.5 text-[10px] leading-relaxed text-white/25">
        {description}
      </p>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className="h-8 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 font-mono text-[10.5px] text-white placeholder:text-white/20 outline-none transition focus:border-accent/40 focus:bg-white/[0.06]"
        />
        {onBrowse && (
          <button
            type="button"
            onClick={onBrowse}
            title="Choose folder"
            aria-label={`Choose ${label}`}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 text-[10px] font-semibold text-white/55 transition hover:bg-white/[0.08] hover:text-white"
          >
            <FolderOpen className="h-3 w-3" />
            Browse
          </button>
        )}
      </div>
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const settings = useSettingsStore();
  const spotifyLiked = useSpotifyLikedStore();
  const update = settings.update;
  const moveProvider = settings.moveProvider;
  const moveSyncMode = settings.moveSyncMode;
  const reset = settings.reset;

  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const addMusicFolder = usePlayerStore((state) => state.addMusicFolder);
  const removeMusicFolder = usePlayerStore((state) => state.removeMusicFolder);
  const rescanMusicFolders = usePlayerStore((state) => state.rescanMusicFolders);
  const trackDelays = useTrackDelayStore((state) => state.delays);
  const resetAllTrackDelays = useTrackDelayStore((state) => state.resetAll);
  const currentTrackDelay = currentTrack
    ? trackDelays[currentTrack.path] ?? 0
    : 0;
  const hasTrackCalibrations = Object.keys(trackDelays).length > 0;

  const [tab, setTab] = useState<
    "display" | "providers" | "downloader" | "folders"
  >("display");
  const [folders, setFolders] = useState<MusicFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [folderAction, setFolderAction] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<ProviderId | null>(null);
  const [testResults, setTestResults] = useState<
    Partial<Record<ProviderId, "success" | "error">>
  >({});

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setTab("display");
    setTestingProvider(null);
    setTestResults({});
  }, [open]);

  useEffect(() => {
    if (!open || tab !== "folders") return;
    let active = true;
    setFoldersLoading(true);
    backend
      .getMusicFolders()
      .then((list) => {
        if (active) setFolders(list);
      })
      .catch((error) => {
        if (!active) return;
        useToastStore.getState().push({
          kind: "error",
          title: "Could not load music folders",
          description: String(error),
        });
      })
      .finally(() => {
        if (active) setFoldersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, tab]);

  const resetAll = async () => {
    await reset();
    useToastStore.getState().push({
      kind: "info",
      title: "Settings reset",
      description: "Lyrics, interface and provider settings are back to defaults.",
    });
  };

  const resetTrackCalibrations = () => {
    if (!hasTrackCalibrations) return;
    resetAllTrackDelays();
    useToastStore.getState().push({
      kind: "info",
      title: "Track offsets reset",
      description: "All per-track delays are back to 0 ms.",
    });
  };

  const handleAddFolder = async () => {
    if (folderAction) return;
    setFolderAction("add");
    try {
      const result = await addMusicFolder();
      if (result) setFolders(result.folders);
    } finally {
      setFolderAction(null);
    }
  };

  const handleRemoveFolder = async (folderPath: string) => {
    if (folderAction) return;
    setFolderAction(folderPath);
    try {
      const result = await removeMusicFolder(folderPath);
      if (result) setFolders(result.folders);
    } finally {
      setFolderAction(null);
    }
  };

  const handleRescanFolders = async () => {
    if (folderAction) return;
    setFolderAction("rescan");
    try {
      const result = await rescanMusicFolders();
      if (result) setFolders(result.folders);
    } finally {
      setFolderAction(null);
    }
  };

  const testProviderById = async (provider: ProviderId) => {
    if (provider === "embedded") return;
    if (!isDesktop) {
      useToastStore.getState().push({
        kind: "info",
        title: "Desktop app only",
        description: "Provider test needs the Electron main process.",
      });
      return;
    }
    setTestingProvider(provider);
    setTestResults((current) => {
      const next = { ...current };
      delete next[provider];
      return next;
    });
    try {
      const result = await runProviderTest(provider);
      setTestResults((current) => ({
        ...current,
        [provider]: result?.ok ? "success" : "error",
      }));
    } catch (error) {
      setTestResults((current) => ({ ...current, [provider]: "error" }));
      useToastStore.getState().push({
        kind: "error",
        title: `✕ ${PROVIDER_META[provider].name} Test Error`,
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTestingProvider(null);
    }
  };

  const offsetStep = (delta: number) =>
    update({ lyricsOffset: settings.lyricsOffset + delta });

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[999] flex items-center justify-center bg-black/[0.65] p-6"
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          <button
            type="button"
            aria-label="Close settings"
            className="absolute inset-0 z-0 cursor-default"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={{ duration: 0.24, ease: EASE }}
            className="glass settings-modal relative z-10 flex max-h-[min(90vh,820px)] w-full max-w-[560px] flex-col overflow-hidden border border-white/10 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
              <div>
                <h2 className="font-display text-[16px] font-bold tracking-tight text-white">
                  Options & Providers
                </h2>
                <p className="text-[11px] text-white/35">
                  Lucid appearance, lyric timing and sources
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1 text-white/35 transition hover:bg-white/[0.06] hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex gap-1 border-b border-white/[0.06] px-4 py-2">
              {(
                [
                  { id: "display", label: "Lyrics & Display", icon: TextCursorInput },
                  { id: "providers", label: "Providers", icon: KeyRound },
                  { id: "folders", label: "Music Folders", icon: FolderOpen },
                  { id: "downloader", label: "Downloader", icon: Download },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition",
                    tab === item.id
                      ? "bg-white/[0.08] text-white"
                      : "text-white/35 hover:bg-white/[0.04] hover:text-white/70",
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {tab === "display" ? (
                <>
                  <Section
                    icon={<TextCursorInput className="h-3.5 w-3.5" />}
                    title="Lyrics timing"
                    description="Global delay and karaoke font"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="text-[11px] font-medium text-white/55">
                          Global delay
                        </span>
                        <p className="text-[10px] text-white/25">
                          Positive values show lyrics later
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => offsetStep(-100)}
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-white/55 transition hover:bg-white/[0.1] hover:text-white"
                          aria-label="Decrease delay"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <input
                          type="number"
                          min={SETTINGS_LIMITS.lyricsOffset.min}
                          max={SETTINGS_LIMITS.lyricsOffset.max}
                          step={10}
                          value={settings.lyricsOffset}
                          onChange={(event) =>
                            update({ lyricsOffset: Number(event.target.value) })
                          }
                          className="h-7 w-[74px] appearance-none rounded-md border border-white/[0.08] bg-white/[0.05] px-2 text-center text-[11px] font-semibold tabular-nums text-white outline-none [appearance:textfield] focus:border-accent/40 [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <span className="text-[10px] text-white/30">ms</span>
                        <button
                          type="button"
                          onClick={() => offsetStep(100)}
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-white/55 transition hover:bg-white/[0.1] hover:text-white"
                          aria-label="Increase delay"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-white/55">
                          Current track offset:{" "}
                          <span className="font-semibold tabular-nums text-white/85">
                            {formatTrackDelay(currentTrackDelay)}
                          </span>
                        </p>
                        <p className="mt-0.5 truncate text-[10px] text-white/25">
                          {currentTrack
                            ? `${currentTrack.title} — Saved individually per track`
                            : "No track selected — the offset will apply to the current song"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={resetTrackCalibrations}
                        disabled={!hasTrackCalibrations}
                        className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[10px] font-semibold text-white/55 transition hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:pointer-events-none disabled:opacity-35"
                      >
                        Reset all track offsets
                      </button>
                    </div>

                    <SliderRow
                      label="Karaoke font size"
                      value={settings.lyricsSize}
                      min={SETTINGS_LIMITS.lyricsSize.min}
                      max={SETTINGS_LIMITS.lyricsSize.max}
                      step={SETTINGS_LIMITS.lyricsSize.step}
                      format={(value) => `${value} px`}
                      onChange={(value) => update({ lyricsSize: value })}
                    />

                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-medium text-white/55">
                        Alignment
                      </span>
                      <div className="flex gap-1 rounded-lg bg-white/[0.06] p-1">
                        {(
                          [
                            { value: "left", icon: AlignLeft },
                            { value: "center", icon: AlignCenter },
                            { value: "right", icon: AlignRight },
                          ] as Array<{ value: LyricsAlign; icon: typeof AlignLeft }>
                        ).map((option) => {
                          const selected = settings.lyricsAlign === option.value;
                          return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => update({ lyricsAlign: option.value })}
                            aria-pressed={selected}
                            className={cn(
                              "rounded-md px-3 py-1.5 transition-all duration-200",
                              selected
                                ? "bg-[var(--accent)] text-black shadow-[0_0_14px_var(--accent-glow)]"
                                : "text-white/40 hover:bg-white/[0.06] hover:text-white/75",
                            )}
                            aria-label={option.value}
                          >
                            <option.icon className="h-3.5 w-3.5" />
                          </button>
                          );
                        })}
                      </div>
                    </div>

                    <Toggle
                      label="Smooth line animation"
                      description="Animate active line and scroll"
                      checked={settings.lyricsAnimated}
                      onChange={(value) => update({ lyricsAnimated: value })}
                    />

                    <SliderRow
                      label="Transparency"
                      value={settings.lyricsOpacity}
                      min={SETTINGS_LIMITS.lyricsOpacity.min}
                      max={SETTINGS_LIMITS.lyricsOpacity.max}
                      step={SETTINGS_LIMITS.lyricsOpacity.step}
                      format={(value) => `${Math.round(value * 100)}%`}
                      onChange={(value) => update({ lyricsOpacity: value })}
                    />
                  </Section>

                  <Section
                    icon={<ArrowUp className="h-3.5 w-3.5" />}
                    title="Sync mode priority"
                    description="The first enabled mode wins; karaoke estimates word timing when a track only has line sync"
                  >
                    <div className="space-y-1.5">
                      {settings.syncModes.map((syncMode, index) => {
                        const meta = SYNC_MODE_META[syncMode.id];
                        const enabledCount = settings.syncModes.filter(
                          (mode) => mode.enabled,
                        ).length;
                        return (
                          <div
                            key={syncMode.id}
                            className={cn(
                              "flex items-center gap-2 rounded-xl border px-2.5 py-2 transition",
                              syncMode.enabled
                                ? "border-white/[0.08] bg-white/[0.04]"
                                : "border-white/[0.04] bg-white/[0.015]",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                if (syncMode.enabled && enabledCount <= 1) return;
                                update({
                                  syncModes: settings.syncModes.map((mode) =>
                                    mode.id === syncMode.id
                                      ? { ...mode, enabled: !mode.enabled }
                                      : mode,
                                  ),
                                });
                              }}
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition",
                                syncMode.enabled
                                  ? "border-[var(--accent)] bg-[var(--accent)] text-black"
                                  : "border-white/20 bg-white/[0.04]",
                                syncMode.enabled &&
                                  enabledCount <= 1 &&
                                  "cursor-not-allowed opacity-70",
                              )}
                              aria-label={`Enable ${meta.name}`}
                              aria-pressed={syncMode.enabled}
                            >
                              {syncMode.enabled && <Check className="h-2.5 w-2.5" />}
                            </button>
                            <span className="w-5 shrink-0 text-center text-[10px] font-bold tabular-nums text-white/25">
                              {index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <span className="block text-[11.5px] font-semibold uppercase tracking-[0.08em] text-white/80">
                                {meta.name}
                              </span>
                              <p className="truncate text-[10px] text-white/30">
                                {meta.description}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-col">
                              <button
                                type="button"
                                disabled={index === 0}
                                onClick={() => moveSyncMode(syncMode.id, -1)}
                                className="rounded p-0.5 text-white/30 transition hover:bg-white/[0.06] hover:text-white/70 disabled:pointer-events-none disabled:opacity-20"
                                aria-label={`Move ${meta.name} up`}
                              >
                                <ArrowUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                disabled={index === settings.syncModes.length - 1}
                                onClick={() => moveSyncMode(syncMode.id, 1)}
                                className="rounded p-0.5 text-white/30 transition hover:bg-white/[0.06] hover:text-white/70 disabled:pointer-events-none disabled:opacity-20"
                                aria-label={`Move ${meta.name} down`}
                              >
                                <ArrowDown className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] leading-relaxed text-white/25">
                      Karaoke works with any timed lyrics: missing word timings are
                      estimated from each line. Disable it to keep clean line-by-line
                      highlighting even when word data exists.
                    </p>
                  </Section>

                  <Section
                    icon={<AudioLines className="h-3.5 w-3.5" />}
                    title="Playback"
                    description="Blend tracks together with the Web Audio engine"
                  >
                    <Toggle
                      label="Enable crossfade"
                      description="Fade the old track out while the next one fades in"
                      checked={settings.crossfadeEnabled}
                      onChange={(value) => update({ crossfadeEnabled: value })}
                    />
                    <div
                      className={cn(
                        "transition-opacity duration-200",
                        !settings.crossfadeEnabled && "pointer-events-none opacity-40",
                      )}
                    >
                      <SliderRow
                        label="Crossfade duration"
                        value={settings.crossfadeDuration}
                        min={SETTINGS_LIMITS.crossfadeDuration.min}
                        max={SETTINGS_LIMITS.crossfadeDuration.max}
                        step={SETTINGS_LIMITS.crossfadeDuration.step}
                        format={(value) => `${value} s`}
                        onChange={(value) => update({ crossfadeDuration: value })}
                      />
                    </div>
                    <p className="text-[10px] leading-relaxed text-white/25">
                      Automatic transitions start the next track a little before the
                      current one ends, so both decks overlap for the chosen duration.
                    </p>
                  </Section>

                  <Section
                    icon={<GripVertical className="h-3.5 w-3.5" />}
                    title="Compact synced mode"
                    description="Limit the visible lyrics window"
                  >
                    <Toggle
                      label="Compact mode"
                      description="Show only nearby lines around the active one"
                      checked={settings.compactMode}
                      onChange={(value) => update({ compactMode: value })}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-medium text-white/55">
                          Lines before
                        </span>
                        <Select
                          value={settings.compactBefore}
                          options={[1, 2, 3, 4, 5].map((value) => ({
                            value,
                            label: String(value),
                          }))}
                          onChange={(value) => update({ compactBefore: value })}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-medium text-white/55">
                          Lines after
                        </span>
                        <Select
                          value={settings.compactAfter}
                          options={[1, 2, 3, 4, 5].map((value) => ({
                            value,
                            label: String(value),
                          }))}
                          onChange={(value) => update({ compactAfter: value })}
                        />
                      </label>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-[5px] border transition",
                          settings.fadeBlur
                            ? "border-[var(--accent)] bg-[var(--accent)] text-black"
                            : "border-white/20 bg-white/[0.04]",
                        )}
                      >
                        {settings.fadeBlur && <Check className="h-2.5 w-2.5" />}
                      </span>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={settings.fadeBlur}
                        onChange={(event) => update({ fadeBlur: event.target.checked })}
                      />
                      <span className="text-[11px] font-medium text-white/55">
                        Fade-out blur on distant lines
                      </span>
                    </label>
                  </Section>

                  <Section
                    icon={<Sparkles className="h-3.5 w-3.5" />}
                    title="Visuals"
                    description="Ambient background and lyric palette"
                  >
                    <Toggle
                      label="Colorful ambient background"
                      description="Follow the current cover colors"
                      checked={settings.ambientColorful}
                      onChange={(value) => update({ ambientColorful: value })}
                    />
                    <Toggle
                      label="Noise overlay"
                      description="Subtle film grain over the canvas"
                      checked={settings.noiseOverlay}
                      onChange={(value) => update({ noiseOverlay: value })}
                    />
                    <SliderRow
                      label="Ambient intensity"
                      value={settings.uiGlow}
                      min={SETTINGS_LIMITS.uiGlow.min}
                      max={SETTINGS_LIMITS.uiGlow.max}
                      step={SETTINGS_LIMITS.uiGlow.step}
                      format={(value) => `${Math.round(value * 100)}%`}
                      onChange={(value) => update({ uiGlow: value })}
                    />
                    <div className="space-y-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <ColorControl
                        label="Active text"
                        value={settings.activeTextColor}
                        fallback={DEFAULT_SETTINGS.activeTextColor}
                        onChange={(value) => update({ activeTextColor: value })}
                      />
                      <ColorControl
                        label="Inactive text"
                        value={settings.inactiveTextColor}
                        fallback={DEFAULT_SETTINGS.inactiveTextColor}
                        onChange={(value) => update({ inactiveTextColor: value })}
                      />
                      <ColorControl
                        label="Accent color"
                        value={settings.accentColor}
                        fallback={DEFAULT_SETTINGS.accentColor === "auto" ? "#f5a524" : DEFAULT_SETTINGS.accentColor}
                        onChange={(value) => update({ accentColor: value })}
                      />
                      <button
                        type="button"
                        onClick={() => update({ accentColor: "auto" })}
                        className="text-[10px] font-medium text-white/35 transition hover:text-white/60"
                      >
                        Follow cover palette
                      </button>
                    </div>
                  </Section>
                </>
              ) : tab === "folders" ? (
                <>
                  <Section
                    icon={<FolderOpen className="h-3.5 w-3.5" />}
                    title="Music folders"
                    description="Sources scanned into your local library"
                  >
                    <div className="flex items-center justify-between text-[10px] font-medium text-white/30">
                      <span>
                        {folders.length} active{" "}
                        {folders.length === 1 ? "source" : "sources"}
                      </span>
                      <span className="tabular-nums">
                        {folders
                          .reduce(
                            (total, folder) => total + folder.trackCount,
                            0,
                          )
                          .toLocaleString()}{" "}
                        tracks indexed
                      </span>
                    </div>

                    {foldersLoading ? (
                      <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-[10.5px] text-white/35">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading sources…
                      </div>
                    ) : folders.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/[0.09] bg-white/[0.015] px-4 py-5 text-center">
                        <FolderOpen className="mx-auto h-6 w-6 text-white/20" />
                        <p className="mt-2 text-[11px] font-semibold text-white/55">
                          No music folders yet
                        </p>
                        <p className="mt-0.5 text-[10px] text-white/25">
                          Add a folder and its tracks will appear in your
                          library.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {folders.map((folder) => {
                          const busy = folderAction === folder.path;
                          const disabled = !isDesktop || Boolean(folderAction);
                          return (
                            <div
                              key={folder.path}
                              className={cn(
                                "group flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition",
                                busy
                                  ? "border-red-400/25 bg-red-500/[0.06]"
                                  : "border-white/[0.07] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.05]",
                              )}
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                                <FolderOpen className="h-4 w-4" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p
                                  className="truncate text-[11px] font-semibold text-white/80"
                                  title={folder.path}
                                >
                                  {folder.path}
                                </p>
                                <p className="text-[10px] tabular-nums text-white/30">
                                  {folder.trackCount.toLocaleString()}{" "}
                                  {folder.trackCount === 1 ? "track" : "tracks"}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleRemoveFolder(folder.path)
                                }
                                disabled={disabled}
                                title={`Remove ${folder.path} from the library`}
                                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-red-400/20 bg-red-500/[0.08] px-2 py-1.5 text-[10px] font-semibold text-red-300 transition hover:border-red-400/35 hover:bg-red-500/15 hover:text-red-200 disabled:pointer-events-none disabled:opacity-40"
                              >
                                {busy ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                                Remove
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleAddFolder()}
                        disabled={!isDesktop || Boolean(folderAction)}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-2 text-[11px] font-bold text-black shadow-[0_0_18px_var(--accent-glow)] transition hover:brightness-110 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40"
                      >
                        {folderAction === "add" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                        Add Music Folder
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRescanFolders()}
                        disabled={
                          !isDesktop ||
                          Boolean(folderAction) ||
                          folders.length === 0
                        }
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 py-2 text-[11px] font-semibold text-white/60 transition hover:border-accent/30 hover:bg-white/[0.08] hover:text-white disabled:pointer-events-none disabled:opacity-40"
                      >
                        {folderAction === "rescan" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Rescan Library
                      </button>
                    </div>

                    <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                      <p className="text-[10px] leading-relaxed text-white/25">
                        Removing a source detaches it from Lyrics+ and deletes
                        its tracks from the library immediately. Audio files on
                        disk are never deleted.
                      </p>
                      {!isDesktop && (
                        <p className="mt-1 text-[10px] font-medium text-amber-300/70">
                          Folder management is available in the desktop app.
                        </p>
                      )}
                    </div>
                  </Section>
                </>
              ) : tab === "downloader" ? (
                <>
                  <Section
                    icon={<Download className="h-3.5 w-3.5" />}
                    title="External downloader"
                    description="Python script, interpreter and destination folder"
                  >
                    <div className="space-y-2.5">
                      <PathField
                        label="Python / Venv Path"
                        description="Interpreter used to run the script. A virtualenv interpreter is fine."
                        value={settings.downloaderPythonPath}
                        placeholder="python3"
                        onChange={(value) =>
                          update({ downloaderPythonPath: value })
                        }
                      />
                      <PathField
                        label="Downloader Script Path"
                        description="Path to a custom Python script that accepts a download queue file."
                        value={settings.downloaderScriptPath}
                        placeholder="/path/to/downloader.py"
                        onChange={(value) =>
                          update({ downloaderScriptPath: value })
                        }
                      />
                      <PathField
                        label="Music Directory"
                        description="Where downloaded audio files are written."
                        value={settings.downloaderMusicDir}
                        placeholder="~/Music"
                        onChange={(value) =>
                          update({ downloaderMusicDir: value })
                        }
                        onBrowse={() => {
                          void backend
                            .pickFolder()
                            .then((folder) => {
                              if (folder) {
                                update({ downloaderMusicDir: folder });
                              }
                            })
                            .catch(() => undefined);
                        }}
                      />
                    </div>

                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <p className="text-[10px] leading-relaxed text-white/30">
                        The script receives a text file with the queued links,
                        downloads audio into the music directory and reports
                        progress on stdout. Finished files trigger a library
                        rescan. Python dependencies must be installed for the
                        selected interpreter.
                      </p>
                    </div>
                  </Section>
                </>
              ) : (
                <>
                <Section
                  icon={<KeyRound className="h-3.5 w-3.5" />}
                  title="Lyrics providers"
                  description="Checked providers are queried top to bottom"
                >
                  <div className="space-y-1.5">
                    {settings.providers.map((provider, index) => {
                      const meta = PROVIDER_META[provider.id];
                      return (
                        <div
                          key={provider.id}
                          className={cn(
                            "flex items-center gap-2 rounded-xl border px-2.5 py-2 transition",
                            provider.enabled
                              ? "border-white/[0.08] bg-white/[0.04]"
                              : "border-white/[0.04] bg-white/[0.015]",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              update({
                                providers: settings.providers.map((item) =>
                                  item.id === provider.id
                                    ? { ...item, enabled: !item.enabled }
                                    : item,
                                ),
                              })
                            }
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition",
                              provider.enabled
                                ? "border-[var(--accent)] bg-[var(--accent)] text-black"
                                : "border-white/20 bg-white/[0.04]",
                            )}
                            aria-label={`Toggle ${meta.name}`}
                          >
                            {provider.enabled && <Check className="h-2.5 w-2.5" />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11.5px] font-semibold text-white/80">
                                {meta.name}
                              </span>
                              <span className="rounded bg-white/[0.06] px-1 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-white/30">
                                {meta.badge}
                              </span>
                            </div>
                            <p className="truncate text-[10px] text-white/30">
                              {meta.description}
                            </p>
                          </div>
                          {provider.id !== "embedded" && (
                            <TestProviderButton
                              provider={provider.id}
                              busy={testingProvider === provider.id}
                              result={testResults[provider.id]}
                              onTest={() => void testProviderById(provider.id)}
                            />
                          )}
                          <div className="flex shrink-0 flex-col">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => moveProvider(provider.id, -1)}
                              className="rounded p-0.5 text-white/30 transition hover:bg-white/[0.06] hover:text-white/70 disabled:pointer-events-none disabled:opacity-20"
                              aria-label={`Move ${meta.name} up`}
                            >
                              <ArrowUp className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              disabled={index === settings.providers.length - 1}
                              onClick={() => moveProvider(provider.id, 1)}
                              className="rounded p-0.5 text-white/30 transition hover:bg-white/[0.06] hover:text-white/70 disabled:pointer-events-none disabled:opacity-20"
                              aria-label={`Move ${meta.name} down`}
                            >
                              <ArrowDown className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <SpotifyAuthCard open={open} />

                  <Section
                    icon={<Heart className="h-3.5 w-3.5" />}
                    title="Liked Songs"
                    description="Choose the source for the Liked Songs playlist"
                  >
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          {
                            id: "local",
                            label: "Local",
                            description: "Only tracks liked inside this player",
                          },
                          {
                            id: "spotify",
                            label: "Spotify Synced",
                            description: "Mirror my Spotify Liked Songs",
                          },
                        ] as const
                      ).map((option) => {
                        const active = settings.likedSongsSource === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() =>
                              update({ likedSongsSource: option.id })
                            }
                            className={cn(
                              "rounded-xl border px-3 py-2.5 text-left transition",
                              active
                                ? "border-accent/40 bg-accent/[0.08]"
                                : "border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06]",
                            )}
                          >
                            <span
                              className={cn(
                                "flex items-center gap-1.5 text-[11.5px] font-bold",
                                active ? "text-accent" : "text-white/70",
                              )}
                            >
                              {active && <Check className="h-3 w-3" />}
                              {option.label}
                            </span>
                            <span className="mt-1 block text-[10px] text-white/30">
                              {option.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {settings.likedSongsSource === "spotify" && (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-white/65">
                            {spotifyLiked.syncing
                              ? "Syncing with Spotify…"
                              : spotifyLiked.snapshot
                                ? `${spotifyLiked.snapshot.total} tracks · ${spotifyLiked.snapshot.downloaded} on PC · ${spotifyLiked.snapshot.missing} missing`
                                : "Not synced yet"}
                          </p>
                          <p className="mt-1 text-[10px] leading-relaxed text-white/25">
                            Downloaded matches play from your library. Missing
                            tracks can be downloaded from the Liked Songs page.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void spotifyLiked.sync()}
                          disabled={spotifyLiked.syncing || !isDesktop}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-[10px] font-semibold text-white/60 transition hover:bg-white/[0.09] hover:text-white disabled:pointer-events-none disabled:opacity-40"
                        >
                          {spotifyLiked.syncing ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                          Sync with Spotify
                        </button>
                      </div>
                    )}
                  </Section>

                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-white/70">
                          Musixmatch app-mobile token
                        </p>
                        <p className="mt-1 text-[10px] leading-relaxed text-white/25">
                          Fetched automatically, cached on disk, and refreshed on 401 — no
                          account or API key needed. Existing tokens are reused when available.
                        </p>
                      </div>
                      <TestProviderButton
                        provider="musixmatch"
                        busy={testingProvider === "musixmatch"}
                        result={testResults.musixmatch}
                        onTest={() => void testProviderById("musixmatch")}
                        label="Test Connection"
                      />
                    </div>
                  </div>
                </Section>

                <Section
                  icon={<Gamepad2 className="h-3.5 w-3.5" />}
                  title="Discord Rich Presence"
                  description="Share the current song in your Discord status"
                >
                  <DiscordPresenceField open={open} />
                </Section>
                </>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-5 py-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    useLucidSettingsStore.getState().openDialog();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)]"
                >
                  <Palette className="h-3 w-3" />
                  Lucid appearance
                </button>
                <button
                  type="button"
                  onClick={() => void resetAll()}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-white/35 transition hover:bg-white/[0.05] hover:text-white/70"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset all
                </button>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-white/[0.08] px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-white/[0.12] active:scale-[0.98]"
              >
                Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
