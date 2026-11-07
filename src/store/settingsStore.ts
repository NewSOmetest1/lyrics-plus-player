import { create } from "zustand";

import { backend } from "@/lib/api";
import type { LyricsMode } from "@/types";
import { normalizeLyricsMode } from "@/types";

export type LyricsAlign = "left" | "center" | "right";

export type ProviderId = "lrclib" | "spotify" | "musixmatch" | "embedded";

export interface ProviderSetting {
  id: ProviderId;
  enabled: boolean;
}

export interface SyncModeSetting {
  id: LyricsMode;
  enabled: boolean;
}

export interface ClientSettings {
  /** Global lyrics timing offset in milliseconds. Positive = later. */
  lyricsOffset: number;
  /** Active-line font size in px. */
  lyricsSize: number;
  lyricsAlign: LyricsAlign;
  /** Overall opacity of the lyrics text, 0.35 – 1. */
  lyricsOpacity: number;
  lyricsAnimated: boolean;

  compactMode: boolean;
  compactBefore: number;
  compactAfter: number;
  fadeBlur: boolean;

  /** Blend the end of the current track into the next one. */
  crossfadeEnabled: boolean;
  /** Crossfade length in seconds, 0 – 6. */
  crossfadeDuration: number;

  ambientColorful: boolean;
  noiseOverlay: boolean;
  uiGlow: number;

  activeTextColor: string;
  inactiveTextColor: string;
  /** "auto" follows the cover palette. */
  accentColor: string;

  providers: ProviderSetting[];
  /** Priority used when loaded lyrics support more than one display mode. */
  syncModes: SyncModeSetting[];
}

export const DEFAULT_SETTINGS: ClientSettings = {
  lyricsOffset: 0,
  lyricsSize: 36,
  lyricsAlign: "center",
  lyricsOpacity: 1,
  lyricsAnimated: true,
  compactMode: false,
  compactBefore: 2,
  compactAfter: 2,
  fadeBlur: true,
  crossfadeEnabled: false,
  crossfadeDuration: 3,
  ambientColorful: true,
  noiseOverlay: true,
  uiGlow: 1,
  activeTextColor: "#ffffff",
  inactiveTextColor: "#ffffff",
  accentColor: "auto",
  providers: [
    { id: "lrclib", enabled: true },
    { id: "spotify", enabled: false },
    { id: "musixmatch", enabled: false },
    { id: "embedded", enabled: true },
  ],
  syncModes: [
    { id: "karaoke", enabled: true },
    { id: "synced", enabled: true },
    { id: "unsynced", enabled: true },
  ],
};

export const SETTINGS_LIMITS = {
  lyricsOffset: { min: -2000, max: 2000, step: 10 },
  lyricsSize: { min: 32, max: 64, step: 1 },
  lyricsOpacity: { min: 0.35, max: 1, step: 0.05 },
  uiGlow: { min: 0, max: 1, step: 0.05 },
  compactBefore: { min: 1, max: 5, step: 1 },
  compactAfter: { min: 1, max: 5, step: 1 },
  crossfadeDuration: { min: 0, max: 6, step: 1 },
} as const;

const KEYS: Record<Exclude<keyof ClientSettings, "providers" | "syncModes">, string> = {
  lyricsOffset: "lyrics_offset",
  lyricsSize: "lyrics_size",
  lyricsAlign: "lyrics_align",
  lyricsOpacity: "lyrics_opacity",
  lyricsAnimated: "lyrics_animated",
  compactMode: "lyrics_compact",
  compactBefore: "lyrics_compact_before",
  compactAfter: "lyrics_compact_after",
  fadeBlur: "lyrics_fade_blur",
  crossfadeEnabled: "playback_crossfade",
  crossfadeDuration: "playback_crossfade_duration",
  ambientColorful: "ui_ambient_colorful",
  noiseOverlay: "ui_noise",
  uiGlow: "ui_glow",
  activeTextColor: "lyrics_color_active",
  inactiveTextColor: "lyrics_color_inactive",
  accentColor: "ui_accent",
};

const PROVIDERS_KEY = "lyrics_providers";
const SYNC_MODES_KEY = "lyrics_sync_modes";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function persist(key: string, value: string): Promise<void> {
  try {
    await backend.setSetting(key, value);
  } catch {
    // Browser preview has no persistence layer.
  }
}

function parseNumber(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseProviders(value: string | null): ProviderSetting[] {
  if (!value) return DEFAULT_SETTINGS.providers;
  try {
    const parsed = JSON.parse(value) as Array<{ id?: string; enabled?: boolean }>;
    if (!Array.isArray(parsed)) return DEFAULT_SETTINGS.providers;
    const known = new Set<string>(DEFAULT_SETTINGS.providers.map((item) => item.id));
    const valid = parsed
      .filter((item) => item && typeof item.id === "string" && known.has(item.id))
      .map((item) => ({ id: item.id as ProviderId, enabled: Boolean(item.enabled) }));
    const seen = new Set(valid.map((item) => item.id));
    for (const fallback of DEFAULT_SETTINGS.providers) {
      if (!seen.has(fallback.id)) valid.push({ ...fallback });
    }
    return valid;
  } catch {
    return DEFAULT_SETTINGS.providers;
  }
}

function parseSyncModes(value: string | null): SyncModeSetting[] {
  if (!value) return DEFAULT_SETTINGS.syncModes;
  try {
    const parsed = JSON.parse(value) as Array<{ id?: string; enabled?: boolean }>;
    if (!Array.isArray(parsed)) return DEFAULT_SETTINGS.syncModes;
    const valid: SyncModeSetting[] = [];
    for (const item of parsed) {
      if (!item || typeof item.id !== "string") continue;
      const id = normalizeLyricsMode(item.id);
      if (!id || valid.some((entry) => entry.id === id)) continue;
      valid.push({ id, enabled: Boolean(item.enabled) });
    }
    for (const fallback of DEFAULT_SETTINGS.syncModes) {
      if (!valid.some((item) => item.id === fallback.id)) {
        valid.push({ ...fallback });
      }
    }
    return valid;
  } catch {
    return DEFAULT_SETTINGS.syncModes;
  }
}

function buildPatch(patch: Partial<ClientSettings>): Partial<ClientSettings> {
  const next: Partial<ClientSettings> = { ...patch };
  if (patch.lyricsOffset !== undefined)
    next.lyricsOffset = clamp(
      Math.round(patch.lyricsOffset),
      SETTINGS_LIMITS.lyricsOffset.min,
      SETTINGS_LIMITS.lyricsOffset.max,
    );
  if (patch.lyricsSize !== undefined)
    next.lyricsSize = clamp(
      Math.round(patch.lyricsSize),
      SETTINGS_LIMITS.lyricsSize.min,
      SETTINGS_LIMITS.lyricsSize.max,
    );
  if (patch.lyricsOpacity !== undefined)
    next.lyricsOpacity = clamp(
      patch.lyricsOpacity,
      SETTINGS_LIMITS.lyricsOpacity.min,
      SETTINGS_LIMITS.lyricsOpacity.max,
    );
  if (patch.uiGlow !== undefined)
    next.uiGlow = clamp(patch.uiGlow, SETTINGS_LIMITS.uiGlow.min, SETTINGS_LIMITS.uiGlow.max);
  if (patch.compactBefore !== undefined)
    next.compactBefore = clamp(
      Math.round(patch.compactBefore),
      SETTINGS_LIMITS.compactBefore.min,
      SETTINGS_LIMITS.compactBefore.max,
    );
  if (patch.compactAfter !== undefined)
    next.compactAfter = clamp(
      Math.round(patch.compactAfter),
      SETTINGS_LIMITS.compactAfter.min,
      SETTINGS_LIMITS.compactAfter.max,
    );
  if (patch.crossfadeDuration !== undefined)
    next.crossfadeDuration = clamp(
      Math.round(patch.crossfadeDuration),
      SETTINGS_LIMITS.crossfadeDuration.min,
      SETTINGS_LIMITS.crossfadeDuration.max,
    );
  return next;
}

interface SettingsState extends ClientSettings {
  loaded: boolean;
  init: () => Promise<void>;
  update: (patch: Partial<ClientSettings>) => void;
  moveProvider: (id: ProviderId, direction: -1 | 1) => void;
  moveSyncMode: (id: LyricsMode, direction: -1 | 1) => void;
  reset: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,

  init: async () => {
    const values = await Promise.all(
      (Object.keys(KEYS) as Array<keyof typeof KEYS>).map((field) =>
        backend.getSetting(KEYS[field]),
      ),
    );
    const raw: Record<string, string | null> = {};
    (Object.keys(KEYS) as Array<keyof typeof KEYS>).forEach((field, index) => {
      raw[field] = values[index];
    });
    const providers = parseProviders(await backend.getSetting(PROVIDERS_KEY));
    const syncModes = parseSyncModes(await backend.getSetting(SYNC_MODES_KEY));

    set({
      lyricsOffset: clamp(
        Math.round(parseNumber(raw.lyricsOffset, DEFAULT_SETTINGS.lyricsOffset)),
        SETTINGS_LIMITS.lyricsOffset.min,
        SETTINGS_LIMITS.lyricsOffset.max,
      ),
      lyricsSize: clamp(
        Math.round(parseNumber(raw.lyricsSize, DEFAULT_SETTINGS.lyricsSize)),
        SETTINGS_LIMITS.lyricsSize.min,
        SETTINGS_LIMITS.lyricsSize.max,
      ),
      lyricsAlign:
        raw.lyricsAlign === "left" || raw.lyricsAlign === "right"
          ? raw.lyricsAlign
          : "center",
      lyricsOpacity: clamp(
        parseNumber(raw.lyricsOpacity, DEFAULT_SETTINGS.lyricsOpacity),
        SETTINGS_LIMITS.lyricsOpacity.min,
        SETTINGS_LIMITS.lyricsOpacity.max,
      ),
      lyricsAnimated: raw.lyricsAnimated !== "0",
      compactMode: raw.compactMode === "1",
      compactBefore: clamp(
        Math.round(parseNumber(raw.compactBefore, DEFAULT_SETTINGS.compactBefore)),
        SETTINGS_LIMITS.compactBefore.min,
        SETTINGS_LIMITS.compactBefore.max,
      ),
      compactAfter: clamp(
        Math.round(parseNumber(raw.compactAfter, DEFAULT_SETTINGS.compactAfter)),
        SETTINGS_LIMITS.compactAfter.min,
        SETTINGS_LIMITS.compactAfter.max,
      ),
      fadeBlur: raw.fadeBlur !== "0",
      crossfadeEnabled: raw.crossfadeEnabled === "1",
      crossfadeDuration: clamp(
        Math.round(
          parseNumber(raw.crossfadeDuration, DEFAULT_SETTINGS.crossfadeDuration),
        ),
        SETTINGS_LIMITS.crossfadeDuration.min,
        SETTINGS_LIMITS.crossfadeDuration.max,
      ),
      ambientColorful: raw.ambientColorful !== "0",
      noiseOverlay: raw.noiseOverlay !== "0",
      uiGlow: clamp(
        parseNumber(raw.uiGlow, DEFAULT_SETTINGS.uiGlow),
        SETTINGS_LIMITS.uiGlow.min,
        SETTINGS_LIMITS.uiGlow.max,
      ),
      activeTextColor: raw.activeTextColor || DEFAULT_SETTINGS.activeTextColor,
      inactiveTextColor: raw.inactiveTextColor || DEFAULT_SETTINGS.inactiveTextColor,
      accentColor: raw.accentColor || DEFAULT_SETTINGS.accentColor,
      providers,
      syncModes,
      loaded: true,
    });
  },

  update: (patch) => {
    const next = buildPatch(patch);
    set(next as Partial<SettingsState>);

    if (next.providers) void persist(PROVIDERS_KEY, JSON.stringify(next.providers));
    if (next.syncModes) void persist(SYNC_MODES_KEY, JSON.stringify(next.syncModes));
    const entries = Object.entries(next) as Array<
      [Exclude<keyof ClientSettings, "providers" | "syncModes">, unknown]
    >;
    for (const [field, value] of entries) {
      if (!(field in KEYS)) continue;
      const key = KEYS[field];
      const serialized =
        typeof value === "boolean" ? (value ? "1" : "0") : String(value);
      void persist(key, serialized);
    }
  },

  moveProvider: (id, direction) => {
    const providers = [...get().providers];
    const index = providers.findIndex((provider) => provider.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= providers.length) return;
    [providers[index], providers[target]] = [providers[target], providers[index]];
    set({ providers });
    void persist(PROVIDERS_KEY, JSON.stringify(providers));
  },

  moveSyncMode: (id, direction) => {
    const syncModes = [...get().syncModes];
    const normalized = normalizeLyricsMode(id);
    const index = syncModes.findIndex((mode) => mode.id === normalized);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= syncModes.length) return;
    [syncModes[index], syncModes[target]] = [syncModes[target], syncModes[index]];
    set({ syncModes });
    void persist(SYNC_MODES_KEY, JSON.stringify(syncModes));
  },

  reset: async () => {
    set({ ...DEFAULT_SETTINGS });
    await Promise.all([
      ...(Object.keys(KEYS) as Array<keyof typeof KEYS>).map((field) => {
        const value = DEFAULT_SETTINGS[field];
        return persist(
          KEYS[field],
          typeof value === "boolean" ? (value ? "1" : "0") : String(value),
        );
      }),
      persist(PROVIDERS_KEY, JSON.stringify(DEFAULT_SETTINGS.providers)),
      persist(SYNC_MODES_KEY, JSON.stringify(DEFAULT_SETTINGS.syncModes)),
    ]);
  },
}));
