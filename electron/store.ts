import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { CachedLyrics, LibraryData, TrackRecord } from "./types";

const EMPTY: LibraryData = {
  version: 1,
  tracks: [],
  lyrics: {},
  settings: {},
};

/**
 * Libraries written before file metadata existed (or by a partial scan) still
 * need the AIMP sort keys at runtime. Derive safe fallbacks on read.
 */
function normalizeTrack(track: TrackRecord): TrackRecord {
  return {
    ...track,
    fileName:
      typeof track.fileName === "string" && track.fileName.trim() !== ""
        ? track.fileName
        : path.basename(track.path),
    modifiedAt:
      Number.isFinite(track.modifiedAt) && track.modifiedAt > 0
        ? track.modifiedAt
        : 0,
  };
}

/**
 * Small JSON-backed library. SQLite is not required for a local-first player and
 * keeping the data in one file makes the Electron main process dependency-free.
 */
export class LibraryStore {
  private data: LibraryData;

  constructor(private readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.data = this.read();
  }

  private read(): LibraryData {
    if (!existsSync(this.file)) return structuredClone(EMPTY);
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<LibraryData>;
      return {
        version: 1,
        tracks: Array.isArray(parsed.tracks)
          ? parsed.tracks.map(normalizeTrack)
          : [],
        lyrics: parsed.lyrics && typeof parsed.lyrics === "object" ? parsed.lyrics : {},
        settings:
          parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {},
      };
    } catch (error) {
      console.error("[library] could not read library.json, starting empty:", error);
      return structuredClone(EMPTY);
    }
  }

  save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  getTracks(): TrackRecord[] {
    return [...this.data.tracks].sort((a, b) => {
      const byArtist = a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" });
      if (byArtist !== 0) return byArtist;
      const byAlbum = a.album.localeCompare(b.album, undefined, { sensitivity: "base" });
      if (byAlbum !== 0) return byAlbum;
      const byTrack = (a.trackNo ?? 0) - (b.trackNo ?? 0);
      if (byTrack !== 0) return byTrack;
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
  }

  getTrack(id: number): TrackRecord | undefined {
    return this.data.tracks.find((track) => track.id === id);
  }

  findByPath(filePath: string): TrackRecord | undefined {
    return this.data.tracks.find((track) => track.path === filePath);
  }

  /** Old library.json files predate the AIMP sort metadata. */
  getTracksMissingFileMetadata(): TrackRecord[] {
    return this.data.tracks.filter(
      (track) => !track.fileName || !(track.modifiedAt > 0),
    );
  }

  setFileMetadata(filePath: string, fileName: string, modifiedAt: number): void {
    const track = this.findByPath(filePath);
    if (!track) return;
    track.fileName = fileName;
    track.modifiedAt = modifiedAt;
  }

  upsertTrack(track: TrackRecord): "added" | "updated" {
    const index = this.data.tracks.findIndex((item) => item.path === track.path);
    if (index >= 0) {
      this.data.tracks[index] = track;
      return "updated";
    }
    this.data.tracks.push(track);
    return "added";
  }

  removeTrack(id: number): void {
    this.data.tracks = this.data.tracks.filter((track) => track.id !== id);
    delete this.data.lyrics[String(id)];
    this.save();
  }

  getLyrics(trackId: number): CachedLyrics[] {
    return this.data.lyrics[String(trackId)] ?? [];
  }

  setLyrics(trackId: number, lyrics: CachedLyrics[]): void {
    this.data.lyrics[String(trackId)] = lyrics;
    this.save();
  }

  clearLyrics(trackId: number): void {
    delete this.data.lyrics[String(trackId)];
    this.save();
  }

  getSetting(key: string): string | undefined {
    return this.data.settings[key];
  }

  setSetting(key: string, value: string): void {
    if (value.trim() === "") delete this.data.settings[key];
    else this.data.settings[key] = value;
    this.save();
  }
}
