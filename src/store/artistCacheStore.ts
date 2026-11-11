import { create } from "zustand";

import { backend } from "@/lib/api";
import type {
  SpotifyArtistCacheEntry,
  SpotifyArtistSummary,
} from "@/types";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const inFlight = new Map<string, Promise<SpotifyArtistCacheEntry | null>>();

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function isFresh(entry: SpotifyArtistCacheEntry | null | undefined): boolean {
  return Boolean(entry && Date.now() - entry.fetchedAt < TTL_MS);
}

function indexEntries(entries: SpotifyArtistCacheEntry[]) {
  const byId: Record<string, SpotifyArtistCacheEntry> = {};
  const byName: Record<string, SpotifyArtistCacheEntry> = {};
  for (const entry of entries) {
    if (!entry.id || !entry.name) continue;
    byId[entry.id] = entry;
    byName[normalizeName(entry.name)] = entry;
  }
  return { byId, byName };
}

interface ArtistCacheState {
  byId: Record<string, SpotifyArtistCacheEntry>;
  byName: Record<string, SpotifyArtistCacheEntry>;
  loaded: boolean;

  hydrate: () => Promise<void>;
  remember: (artist: SpotifyArtistSummary | null | undefined) => void;
  entryFor: (
    name?: string | null,
    id?: string | null,
  ) => SpotifyArtistCacheEntry | null;
  /** Cached entry immediately; refreshes stale profiles in the background. */
  resolve: (options: {
    name?: string | null;
    id?: string | null;
    revalidate?: boolean;
  }) => Promise<SpotifyArtistCacheEntry | null>;
}

export const useArtistCacheStore = create<ArtistCacheState>((set, get) => ({
  byId: {},
  byName: {},
  loaded: false,

  hydrate: async () => {
    try {
      const entries = await backend.getSpotifyArtistCache();
      set({ ...indexEntries(entries), loaded: true });
    } catch (error) {
      console.warn("[artist-cache] hydrate failed:", error);
      set({ loaded: true });
    }
  },

  remember: (artist) => {
    if (!artist?.id || !artist.name) return;
    const entry: SpotifyArtistCacheEntry = {
      ...artist,
      fetchedAt: Date.now(),
    };
    set((state) => ({
      byId: { ...state.byId, [entry.id]: entry },
      byName: { ...state.byName, [normalizeName(entry.name)]: entry },
    }));
  },

  entryFor: (name, id) => {
    const state = get();
    if (id && state.byId[id]) return state.byId[id];
    const key = normalizeName(name ?? "");
    return key ? (state.byName[key] ?? null) : null;
  },

  resolve: async ({ name, id, revalidate = false }) => {
    const state = get();
    const cached = state.entryFor(name, id);
    if (cached && isFresh(cached) && !revalidate) return cached;

    const key = id?.trim() || `name:${normalizeName(name ?? "")}`;
    if (!key || key === "name:") return cached;
    const running = inFlight.get(key);
    if (running) return running;

    const request = (async () => {
      try {
        const catalog = await backend.getSpotifyArtist(id?.trim() ?? "", name?.trim());
        const artist = catalog.artist;
        if (artist?.id) get().remember(artist);
        return artist?.id
          ? (get().entryFor(artist.name, artist.id) ?? cached)
          : cached;
      } catch (error) {
        console.warn("[artist-cache] profile refresh failed:", error);
        return cached;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, request);
    return request;
  },
}));
