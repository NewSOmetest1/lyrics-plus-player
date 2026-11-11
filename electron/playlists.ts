import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Playlist } from "./types";

interface PlaylistData {
  version: 1;
  playlists: Playlist[];
}

const EMPTY: PlaylistData = { version: 1, playlists: [] };

export const LIKED_PLAYLIST_ID = "liked-songs";
export const LIKED_PLAYLIST_NAME = "Liked Songs";
export const LIKED_PLAYLIST_DESCRIPTION = "Your favorite tracks";

export interface PlaylistCreateInput {
  id?: string;
  name: string;
  description?: string;
  trackPaths?: string[];
}

export interface PlaylistUpdateInput {
  name?: string;
  description?: string;
  trackPaths?: string[];
}

function normalizePath(value: string): string {
  return path.normalize(value);
}

function uniquePaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of paths) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const normalized = normalizePath(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/** Resolve one M3U entry to an absolute local path, skipping streams/comments. */
export function resolveM3UPath(value: string, baseDir: string): string | null {
  const raw = value.trim();
  if (!raw || raw.startsWith("#")) return null;
  if (/^(https?|ftp):/i.test(raw)) return null;
  try {
    if (raw.startsWith("file://")) {
      return normalizePath(fileURLToPath(raw));
    }
  } catch {
    return null;
  }
  return normalizePath(path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw));
}

export function parseM3U(content: string, baseDir: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const line of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const resolved = resolveM3UPath(line, baseDir);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

export function playlistNameFromM3U(content: string, filePath: string): string {
  const clean = content.replace(/^\uFEFF/, "");
  const named = clean.match(/^#PLAYLIST:(.+)$/im)?.[1]?.trim();
  if (named) return named;
  return path.basename(filePath, path.extname(filePath)).trim() || "Imported playlist";
}

export function serializeM3U(playlist: Playlist): string {
  const lines = ["#EXTM3U", `#PLAYLIST:${playlist.name}`];
  for (const trackPath of playlist.trackPaths) {
    lines.push(`#EXTINF:-1,${path.basename(trackPath)}`, trackPath);
  }
  return `${lines.join("\n")}\n`;
}

export function defaultM3UFileName(name: string): string {
  const safe = name
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${safe || "playlist"}.m3u`;
}

export class PlaylistStore {
  private data: PlaylistData;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.data = this.read();
    this.ensureLiked();
    if (!existsSync(file)) this.save();
  }

  private read(): PlaylistData {
    if (!existsSync(this.file)) return structuredClone(EMPTY);
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as {
        playlists?: unknown;
      };
      const playlists = Array.isArray(parsed.playlists)
        ? parsed.playlists
            .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
            .map((item) => ({
              id: typeof item.id === "string" ? item.id : randomUUID(),
              name:
                typeof item.name === "string" && item.name.trim()
                  ? item.name.trim()
                  : "Untitled playlist",
              description:
                typeof item.description === "string" && item.description.trim()
                  ? item.description.trim()
                  : undefined,
              trackPaths: uniquePaths(item.trackPaths),
              createdAt:
                typeof item.createdAt === "number" ? item.createdAt : Date.now(),
              updatedAt:
                typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
            }))
        : [];
      return { version: 1, playlists };
    } catch (error) {
      console.error("[playlists] could not read playlists.json, starting empty:", error);
      return structuredClone(EMPTY);
    }
  }

  save(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.write();
  }

  /** Coalesce rapid heart clicks into one playlists.json write. */
  saveSoon(delayMs = 400): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.write();
    }, delayMs);
  }

  flush(): void {
    if (this.saveTimer === null) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.write();
  }

  private write(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  /**
   * Liked Songs is a system playlist: it keeps a fixed id so UI hearts can
   * resolve it without name lookups, including after older versions stored it
   * with a generated UUID.
   */
  ensureLiked(): Playlist {
    const byId = this.get(LIKED_PLAYLIST_ID);
    if (byId) {
      let changed = false;
      if (byId.name !== LIKED_PLAYLIST_NAME) {
        byId.name = LIKED_PLAYLIST_NAME;
        changed = true;
      }
      if (!byId.description?.trim()) {
        byId.description = LIKED_PLAYLIST_DESCRIPTION;
        changed = true;
      }
      if (changed) {
        byId.updatedAt = Date.now();
        this.save();
      }
      return structuredClone(byId);
    }

    const byName = this.data.playlists.find(
      (playlist) => playlist.name.trim().toLowerCase() === "liked songs",
    );
    if (byName) {
      byName.id = LIKED_PLAYLIST_ID;
      byName.name = LIKED_PLAYLIST_NAME;
      if (!byName.description?.trim()) {
        byName.description = LIKED_PLAYLIST_DESCRIPTION;
      }
      byName.updatedAt = Date.now();
      this.save();
      return structuredClone(byName);
    }

    return this.create({
      id: LIKED_PLAYLIST_ID,
      name: LIKED_PLAYLIST_NAME,
      description: LIKED_PLAYLIST_DESCRIPTION,
    });
  }

  getAll(): Playlist[] {
    return [...this.data.playlists].sort((a, b) => {
      if (a.id === LIKED_PLAYLIST_ID) return -1;
      if (b.id === LIKED_PLAYLIST_ID) return 1;
      return b.updatedAt - a.updatedAt;
    });
  }

  get(id: string): Playlist | undefined {
    return this.data.playlists.find((playlist) => playlist.id === id);
  }

  create(input: PlaylistCreateInput): Playlist {
    const now = Date.now();
    const requestedId = input.id?.trim();
    if (requestedId && this.get(requestedId)) {
      throw new Error(`Playlist id already exists: ${requestedId}`);
    }
    const playlist: Playlist = {
      id: requestedId || randomUUID(),
      name: input.name?.trim() || "Untitled playlist",
      description: input.description?.trim() || undefined,
      trackPaths: uniquePaths(input.trackPaths ?? []),
      createdAt: now,
      updatedAt: now,
    };
    this.data.playlists.push(playlist);
    this.save();
    return structuredClone(playlist);
  }

  update(id: string, input: PlaylistUpdateInput): Playlist {
    const playlist = this.get(id);
    if (!playlist) throw new Error("Playlist not found");
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error("Playlist name cannot be empty");
      playlist.name = name;
    }
    if (input.description !== undefined) {
      playlist.description = input.description.trim() || undefined;
    }
    if (input.trackPaths !== undefined) {
      playlist.trackPaths = uniquePaths(input.trackPaths);
    }
    playlist.updatedAt = Date.now();
    this.save();
    return structuredClone(playlist);
  }

  delete(id: string): boolean {
    if (id === LIKED_PLAYLIST_ID) {
      throw new Error("Liked Songs cannot be deleted");
    }
    const before = this.data.playlists.length;
    this.data.playlists = this.data.playlists.filter((playlist) => playlist.id !== id);
    if (this.data.playlists.length === before) return false;
    this.save();
    return true;
  }

  addTrack(playlistId: string, trackPath: string): { playlist: Playlist; added: boolean } {
    const playlist = this.get(playlistId);
    if (!playlist) throw new Error("Playlist not found");
    const trimmed = trackPath.trim();
    if (!trimmed) throw new Error("Track path cannot be empty");
    const next = normalizePath(trimmed);
    if (playlist.trackPaths.some((item) => normalizePath(item) === next)) {
      return { playlist: structuredClone(playlist), added: false };
    }
    playlist.trackPaths.push(next);
    playlist.updatedAt = Date.now();
    this.save();
    return { playlist: structuredClone(playlist), added: true };
  }

  removeTrack(
    playlistId: string,
    trackPath: string,
  ): { playlist: Playlist; removed: boolean } {
    const playlist = this.get(playlistId);
    if (!playlist) throw new Error("Playlist not found");
    const target = normalizePath(trackPath.trim());
    const next = playlist.trackPaths.filter((item) => normalizePath(item) !== target);
    if (next.length === playlist.trackPaths.length) {
      return { playlist: structuredClone(playlist), removed: false };
    }
    playlist.trackPaths = next;
    playlist.updatedAt = Date.now();
    this.save();
    return { playlist: structuredClone(playlist), removed: true };
  }

  /**
   * Likes are applied to memory immediately and written with a short debounce.
   * The renderer already updated its optimistic state, so this call only has to
   * keep Liked Songs durable without blocking the heart animation.
   */
  setLikedTrack(
    trackPath: string,
    liked: boolean,
  ): { playlist: Playlist; changed: boolean } {
    const trimmed = trackPath.trim();
    if (!trimmed) throw new Error("Track path cannot be empty");
    const playlist = this.get(LIKED_PLAYLIST_ID) ?? this.ensureLiked();
    const target = normalizePath(trimmed);
    const exists = playlist.trackPaths.some(
      (item) => normalizePath(item) === target,
    );
    if (liked === exists) {
      return { playlist: structuredClone(playlist), changed: false };
    }
    if (liked) {
      playlist.trackPaths.unshift(target);
    } else {
      playlist.trackPaths = playlist.trackPaths.filter(
        (item) => normalizePath(item) !== target,
      );
    }
    playlist.updatedAt = Date.now();
    this.saveSoon();
    return { playlist: structuredClone(playlist), changed: true };
  }
}
