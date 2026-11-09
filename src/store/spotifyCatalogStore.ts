import { create } from "zustand";

import { backend } from "@/lib/api";
import type {
  SpotifyAlbumCatalog,
  SpotifyAlbumSummary,
  SpotifyArtistCatalog,
  SpotifyArtistSummary,
  SpotifyCatalogTrack,
  SpotifySearchCatalog,
} from "@/types";

const CACHE_MS = 10 * 60 * 1000;

interface CacheEntry<T> {
  at: number;
  value: T;
}

function fresh<T>(entry: CacheEntry<T> | undefined): T | null {
  if (!entry) return null;
  return Date.now() - entry.at < CACHE_MS ? entry.value : null;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

interface SpotifyCatalogState {
  searchCache: Record<string, CacheEntry<SpotifySearchCatalog>>;
  artistCache: Record<string, CacheEntry<SpotifyArtistCatalog>>;
  albumCache: Record<string, CacheEntry<SpotifyCatalogTrack[]>>;
  albumDetailsCache: Record<string, CacheEntry<SpotifyAlbumCatalog>>;
  artistNameCache: Record<string, SpotifyArtistSummary | null>;

  search: (query: string) => Promise<SpotifySearchCatalog>;
  loadArtist: (
    artistId: string,
    fallbackName?: string,
  ) => Promise<SpotifyArtistCatalog>;
  loadAlbum: (
    albumId: string,
    fallback?: {
      artist?: string;
      album?: string;
      coverUrl?: string | null;
      releaseDate?: string;
      totalTracks?: number;
    },
  ) => Promise<SpotifyAlbumCatalog>;
  loadAlbumTracks: (
    albumId: string,
    fallback?: { artist?: string; album?: string; coverUrl?: string | null },
  ) => Promise<SpotifyCatalogTrack[]>;
  resolveArtist: (name: string) => Promise<SpotifyArtistSummary | null>;
  albumFor: (album: SpotifyAlbumSummary) => void;
}

export const useSpotifyCatalogStore = create<SpotifyCatalogState>((set, get) => ({
  searchCache: {},
  artistCache: {},
  albumCache: {},
  albumDetailsCache: {},
  artistNameCache: {},

  search: async (query) => {
    const key = normalize(query);
    const cached = fresh(get().searchCache[key]);
    if (cached) return cached;
    const value = await backend.searchSpotify(query);
    set((state) => ({
      searchCache: { ...state.searchCache, [key]: { at: Date.now(), value } },
    }));
    return value;
  },

  loadArtist: async (artistId, fallbackName) => {
    const key = artistId.trim() || `name:${normalize(fallbackName ?? "")}`;
    const cached = fresh(get().artistCache[key]);
    if (cached) return cached;
    const value = await backend.getSpotifyArtist(artistId, fallbackName);
    set((state) => ({
      artistCache: { ...state.artistCache, [key]: { at: Date.now(), value } },
    }));
    return value;
  },

  loadAlbum: async (albumId, fallback) => {
    const key = albumId.trim();
    const cached = fresh(get().albumDetailsCache[key]);
    if (cached) return cached;
    const value = await backend.getSpotifyAlbum(key, fallback);
    set((state) => ({
      albumDetailsCache: {
        ...state.albumDetailsCache,
        [key]: { at: Date.now(), value },
      },
    }));
    return value;
  },

  loadAlbumTracks: async (albumId, fallback) => {
    const key = albumId.trim();
    const cached = fresh(get().albumCache[key]);
    if (cached) return cached;
    const value = await backend.getSpotifyAlbumTracks(albumId, fallback);
    set((state) => ({
      albumCache: { ...state.albumCache, [key]: { at: Date.now(), value } },
    }));
    return value;
  },

  resolveArtist: async (name) => {
    const key = normalize(name);
    if (key in get().artistNameCache) {
      return get().artistNameCache[key] ?? null;
    }
    const value = await backend.resolveSpotifyArtist(name);
    set((state) => ({
      artistNameCache: { ...state.artistNameCache, [key]: value },
    }));
    return value;
  },

  albumFor: () => {
    // Kept as a tiny compatibility hook for views that only need a refresh.
  },
}));
