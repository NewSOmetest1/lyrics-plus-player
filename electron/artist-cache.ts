import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type {
  SpotifyArtistCacheEntry,
  SpotifyArtistSummary,
} from "./types";

interface ArtistCacheFile {
  version: 1;
  entries: SpotifyArtistCacheEntry[];
}

const EMPTY: ArtistCacheFile = { version: 1, entries: [] };

/** Profiles are cheap to keep for a week; stale entries are still shown. */
export const ARTIST_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function sanitize(value: unknown): SpotifyArtistCacheEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!id || !name) return null;
  return {
    id,
    name,
    imageUrl:
      typeof record.imageUrl === "string" && record.imageUrl.trim()
        ? record.imageUrl
        : null,
    genres: Array.isArray(record.genres)
      ? record.genres.filter((genre): genre is string => typeof genre === "string")
      : [],
    followers:
      typeof record.followers === "number" && Number.isFinite(record.followers)
        ? record.followers
        : 0,
    monthlyListeners:
      typeof record.monthlyListeners === "number" &&
      Number.isFinite(record.monthlyListeners)
        ? record.monthlyListeners
        : 0,
    popularity:
      typeof record.popularity === "number" && Number.isFinite(record.popularity)
        ? record.popularity
        : 0,
    spotifyUrl:
      typeof record.spotifyUrl === "string"
        ? record.spotifyUrl
        : `https://open.spotify.com/artist/${id}`,
    fetchedAt:
      typeof record.fetchedAt === "number" && Number.isFinite(record.fetchedAt)
        ? record.fetchedAt
        : 0,
  };
}

/**
 * Persistent artist profiles so cards can render the real Spotify avatar on
 * the first frame after a restart, without waiting for another API roundtrip.
 */
export class ArtistCacheStore {
  private entries = new Map<string, SpotifyArtistCacheEntry>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(
        readFileSync(this.file, "utf8"),
      ) as Partial<ArtistCacheFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return;
      for (const value of parsed.entries) {
        const entry = sanitize(value);
        if (!entry) continue;
        this.entries.set(entry.id, entry);
      }
    } catch (error) {
      console.warn("[artist-cache] could not read artists.json:", error);
    }
  }

  private saveSoon(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 500);
  }

  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const data: ArtistCacheFile = {
      version: 1,
      entries: [...this.entries.values()],
    };
    try {
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify(data), "utf8");
      renameSync(temporary, this.file);
    } catch (error) {
      console.warn("[artist-cache] could not write artists.json:", error);
    }
  }

  remember(artist: SpotifyArtistSummary | null | undefined): void {
    if (!artist?.id || !artist.name) return;
    const entry: SpotifyArtistCacheEntry = {
      ...artist,
      fetchedAt: Date.now(),
    };
    this.entries.set(entry.id, entry);
    this.saveSoon();
  }

  getById(id: string | null | undefined): SpotifyArtistCacheEntry | null {
    if (!id) return null;
    return this.entries.get(id.trim()) ?? null;
  }

  getByName(name: string | null | undefined): SpotifyArtistCacheEntry | null {
    const needle = normalizeName(name ?? "");
    if (!needle) return null;
    for (const entry of this.entries.values()) {
      if (normalizeName(entry.name) === needle) return entry;
    }
    return null;
  }

  list(): SpotifyArtistCacheEntry[] {
    return [...this.entries.values()];
  }
}

export function isArtistCacheFresh(
  entry: SpotifyArtistCacheEntry | null,
): boolean {
  return Boolean(entry && Date.now() - entry.fetchedAt < ARTIST_CACHE_TTL_MS);
}
