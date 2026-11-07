import { create } from "zustand";

import { backend } from "@/lib/api";

/** Fine calibration step for the header pill. */
export const TRACK_DELAY_STEP = 100;
/** Shift-click step for fast calibration. */
export const TRACK_DELAY_SHIFT_STEP = 500;
const TRACK_DELAY_LIMIT_MS = 10_000;

export const TRACK_DELAY_EVENT = "lyricsplus:track-delay";

function clampDelay(value: number): number {
  return Math.min(
    TRACK_DELAY_LIMIT_MS,
    Math.max(-TRACK_DELAY_LIMIT_MS, Math.round(value)),
  );
}

function sanitizeDelays(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const delays: Record<string, number> = {};
  for (const [trackKey, rawOffset] of Object.entries(value)) {
    if (!trackKey) continue;
    const parsed = typeof rawOffset === "number" ? rawOffset : Number(rawOffset);
    if (!Number.isFinite(parsed)) continue;
    const offset = clampDelay(parsed);
    if (offset !== 0) delays[trackKey] = offset;
  }
  return delays;
}

/** `+200 ms`, `-200 ms`, `0 ms`. */
export function formatTrackDelay(offsetMs: number, unit = "ms"): string {
  const rounded = Math.round(offsetMs);
  return `${rounded > 0 ? "+" : ""}${rounded} ${unit}`;
}

/** Show the centered micro-indicator used by the karaoke hotkeys. */
export function announceTrackDelay(offsetMs: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<number>(TRACK_DELAY_EVENT, { detail: Math.round(offsetMs) }),
  );
}

interface TrackDelayState {
  /** `track.path -> offsetMs`. A missing entry means 0 ms. */
  delays: Record<string, number>;
  loaded: boolean;
  init: () => Promise<void>;
  offsetFor: (trackKey: string | null | undefined) => number;
  setDelay: (trackKey: string, offsetMs: number) => number;
  adjustDelay: (trackKey: string, deltaMs: number) => number;
  resetTrack: (trackKey: string) => void;
  resetAll: () => void;
}

let initPromise: Promise<void> | null = null;

/**
 * Per-track karaoke calibration. Offsets are persisted in track-delays.json by
 * the Electron main process, keyed by the absolute track path so the value
 * follows the current track automatically on every song change.
 */
export const useTrackDelayStore = create<TrackDelayState>((set, get) => ({
  delays: {},
  loaded: false,

  init: () => {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const delays = await backend.getTrackDelays();
        // Merge: a very fast user adjustment must not be erased by hydration.
        set((state) => ({
          delays: { ...sanitizeDelays(delays), ...state.delays },
          loaded: true,
        }));
      } catch {
        set({ loaded: true });
      }
    })();
    return initPromise;
  },

  offsetFor: (trackKey) =>
    trackKey ? get().delays[trackKey] ?? 0 : 0,

  setDelay: (trackKey, offsetMs) => {
    if (!trackKey || !Number.isFinite(offsetMs)) return 0;
    const value = clampDelay(offsetMs);
    set((state) => {
      const delays = { ...state.delays };
      if (value === 0) delete delays[trackKey];
      else delays[trackKey] = value;
      return { delays };
    });
    void backend.setTrackDelay(trackKey, value).catch(() => undefined);
    return value;
  },

  adjustDelay: (trackKey, deltaMs) =>
    get().setDelay(trackKey, get().offsetFor(trackKey) + deltaMs),

  resetTrack: (trackKey) => {
    if (!trackKey) return;
    set((state) => {
      if (!(trackKey in state.delays)) return state;
      const delays = { ...state.delays };
      delete delays[trackKey];
      return { delays };
    });
    void backend.resetTrackDelay(trackKey).catch(() => undefined);
  },

  resetAll: () => {
    set({ delays: {} });
    void backend.resetAllTrackDelays().catch(() => undefined);
  },
}));
