import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { CachedLyrics, LibraryData, TrackFileDeleteResult, TrackRecord } from "./types";

const EMPTY: LibraryData = {
  version: 1,
  tracks: [],
  musicFolders: [],
  lyrics: {},
  settings: {},
};

/** Compare paths the way the host filesystem does. */
function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function normalizeMusicFolders(folders: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const folder of folders) {
    if (typeof folder !== "string" || folder.trim() === "") continue;
    const resolved = path.resolve(folder);
    const key = pathKey(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

/** True when filePath is the folder itself or lives below it. */
function isPathInside(filePath: string, folderPath: string): boolean {
  const file = path.resolve(filePath);
  const folder = path.resolve(folderPath);
  if (process.platform === "win32") {
    const normalizedFile = file.toLowerCase();
    const normalizedFolder = folder.toLowerCase();
    return (
      normalizedFile === normalizedFolder ||
      normalizedFile.startsWith(`${normalizedFolder}${path.sep}`)
    );
  }
  return file === folder || file.startsWith(`${folder}${path.sep}`);
}

/**
 * Libraries created before source management stored only tracks. Seed the
 * source list with the directories those files already live in, so the first
 * Settings visit reflects reality instead of an empty list.
 */
function deriveMusicFolders(tracks: TrackRecord[]): string[] {
  const directories = normalizeMusicFolders(
    tracks.map((track) => path.dirname(track.path)),
  ).sort((a, b) => a.length - b.length);

  // Keep only the outermost directories so a nested album folder is not
  // reported as a second source next to its parent.
  const roots: string[] = [];
  for (const directory of directories) {
    if (roots.some((root) => isPathInside(directory, root))) continue;
    roots.push(directory);
  }
  return roots;
}

/**
 * Libraries written before file metadata existed (or by a partial scan) still
 * need the AIMP sort keys at runtime. Derive safe fallbacks on read.
 */
function normalizeTrack(track: TrackRecord): TrackRecord {
  const canonicalPath = path.resolve(track.path);
  return {
    ...track,
    path: canonicalPath,
    fileName:
      typeof track.fileName === "string" && track.fileName.trim() !== ""
        ? track.fileName
        : path.basename(canonicalPath),
    modifiedAt:
      Number.isFinite(track.modifiedAt) && track.modifiedAt > 0
        ? track.modifiedAt
        : 0,
  };
}

/**
 * One file must appear exactly once in the library. Keeping the map keyed by
 * the resolved absolute path also collapses historical entries written with
 * different relative spellings of the same file.
 */
function dedupeTracks(tracks: TrackRecord[]): TrackRecord[] {
  const byPath = new Map<string, TrackRecord>();
  for (const track of tracks) {
    const normalized = normalizeTrack(track);
    byPath.set(normalized.path, normalized);
  }
  return [...byPath.values()];
}

/**
 * Small JSON-backed library. SQLite is not required for a local-first player and
 * keeping the data in one file makes the Electron main process dependency-free.
 */
const SETTINGS_SAVE_DELAY_MS = 300;

export class LibraryStore {
  private data: LibraryData;
  private revision = 0;
  private migratedFolders = false;
  private readonly settingsFile: string;
  private settingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private settingsDirty = false;

  constructor(private readonly file: string) {
    this.settingsFile = path.join(path.dirname(file), "settings.json");
    mkdirSync(path.dirname(file), { recursive: true });
    this.data = this.read();
    // Persist the one-time legacy migration so the next launch reads the
    // source list instead of deriving it again.
    if (this.migratedFolders) this.save();
    // Keep settings out of the 1.7 MB library rewrites on every slider tick.
    // settings.json is authoritative when present; library.json remains a
    // backward-compatible fallback for older builds.
    if (!existsSync(this.settingsFile) && Object.keys(this.data.settings).length > 0) {
      this.writeSettingsFile();
    }
  }

  private readSettingsFile(): Record<string, string> | null {
    if (!existsSync(this.settingsFile)) return null;
    try {
      const parsed = JSON.parse(
        readFileSync(this.settingsFile, "utf8"),
      ) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      const settings: Record<string, string> = {};
      for (const [key, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (typeof value === "string") settings[key] = value;
      }
      return settings;
    } catch (error) {
      console.error(
        "[library] could not read settings.json, falling back to library.json:",
        error,
      );
      return null;
    }
  }

  private writeSettingsFile(): void {
    const tmp = `${this.settingsFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data.settings));
    renameSync(tmp, this.settingsFile);
  }

  private scheduleSettingsSave(): void {
    this.settingsDirty = true;
    if (this.settingsSaveTimer !== null) clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = setTimeout(() => {
      this.settingsSaveTimer = null;
      this.flushPendingSettings();
    }, SETTINGS_SAVE_DELAY_MS);
  }

  /** Write coalesced settings immediately (called on quit and before scans). */
  flushPendingSettings(): void {
    if (this.settingsSaveTimer !== null) {
      clearTimeout(this.settingsSaveTimer);
      this.settingsSaveTimer = null;
    }
    if (!this.settingsDirty) return;
    this.settingsDirty = false;
    try {
      this.writeSettingsFile();
    } catch (error) {
      this.settingsDirty = true;
      console.error("[library] could not persist settings:", error);
    }
  }

  private read(): LibraryData {
    if (!existsSync(this.file)) return structuredClone(EMPTY);
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<LibraryData>;
      const tracks = Array.isArray(parsed.tracks)
        ? dedupeTracks(parsed.tracks)
        : [];
      this.migratedFolders =
        !Array.isArray(parsed.musicFolders) && tracks.length > 0;
      const externalSettings = this.readSettingsFile();
      return {
        version: 1,
        tracks,
        // An absent key means a pre-folder-management library; derive once.
        // An explicit empty array is respected so removing every source sticks.
        musicFolders: Array.isArray(parsed.musicFolders)
          ? normalizeMusicFolders(parsed.musicFolders)
          : deriveMusicFolders(tracks),
        lyrics: parsed.lyrics && typeof parsed.lyrics === "object" ? parsed.lyrics : {},
        settings:
          externalSettings ??
          (parsed.settings && typeof parsed.settings === "object"
            ? parsed.settings
            : {}),
      };
    } catch (error) {
      console.error("[library] could not read library.json, starting empty:", error);
      return structuredClone(EMPTY);
    }
  }

  save(): void {
    this.revision += 1;
    // Enforce the path invariant on every write, not only during a scan.
    this.data.tracks = dedupeTracks(this.data.tracks);
    this.data.musicFolders = normalizeMusicFolders(
      Array.isArray(this.data.musicFolders) ? this.data.musicFolders : [],
    );
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
    // A structural save may race with a pending settings write. Flush now so
    // settings.json cannot keep an older value than library.json.
    this.flushPendingSettings();
  }

  /** Replace the library with a path-deduplicated snapshot. */
  replaceTracks(tracks: TrackRecord[]): void {
    this.revision += 1;
    this.data.tracks = dedupeTracks(tracks);
  }

  getRevision(): number {
    return this.revision;
  }

  /** Drop entries whose files no longer exist on disk. */
  pruneMissingTracks(): number {
    const before = this.data.tracks.length;
    this.data.tracks = this.data.tracks.filter((track) =>
      existsSync(track.path),
    );
    return before - this.data.tracks.length;
  }

  getMusicFolders(): string[] {
    return [...this.data.musicFolders];
  }

  hasMusicFolder(folderPath: string): boolean {
    const key = pathKey(folderPath);
    return this.data.musicFolders.some((folder) => pathKey(folder) === key);
  }

  /** Add a source folder. Returns false when it was already tracked. */
  addMusicFolder(folderPath: string): boolean {
    if (this.hasMusicFolder(folderPath)) return false;
    this.data.musicFolders.push(path.resolve(folderPath));
    this.save();
    return true;
  }

  countTracksInFolder(folderPath: string): number {
    return this.data.tracks.reduce(
      (count, track) => count + (isPathInside(track.path, folderPath) ? 1 : 0),
      0,
    );
  }

  /**
   * Detach a source and delete every track below it, including cached lyrics.
   * Files on disk are never touched.
   */
  removeMusicFolder(folderPath: string): number {
    const key = pathKey(folderPath);
    this.data.musicFolders = this.data.musicFolders.filter(
      (folder) => pathKey(folder) !== key,
    );

    const removed = this.data.tracks.filter((track) =>
      isPathInside(track.path, folderPath),
    );
    if (removed.length > 0) {
      this.data.tracks = this.data.tracks.filter(
        (track) => !isPathInside(track.path, folderPath),
      );
      for (const track of removed) delete this.data.lyrics[String(track.id)];
    }

    this.save();
    return removed.length;
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
    const canonicalPath = path.resolve(filePath);
    return this.data.tracks.find((track) => track.path === canonicalPath);
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

  /**
   * Point a track at regenerated cover variants without touching the rest of
   * the record. Used by the background cover migration.
   */
  setTrackCoverPaths(
    trackId: number,
    coverPath: string | null,
    coverFullPath: string | null,
    coverPalettePath?: string | null,
  ): void {
    const track = this.getTrack(trackId);
    if (!track) return;
    track.coverPath = coverPath;
    track.coverFullPath = coverFullPath;
    if (coverPalettePath !== undefined) {
      track.coverPalettePath = coverPalettePath;
    }
  }

  upsertTrack(track: TrackRecord): "added" | "updated" {
    const normalized = normalizeTrack(track);
    const index = this.data.tracks.findIndex(
      (item) => item.path === normalized.path,
    );
    if (index >= 0) {
      this.data.tracks[index] = normalized;
      return "updated";
    }
    this.data.tracks.push(normalized);
    return "added";
  }

  removeTrack(id: number): void {
    this.data.tracks = this.data.tracks.filter((track) => track.id !== id);
    delete this.data.lyrics[String(id)];
    this.save();
  }

  /**
   * Permanently delete a track's audio file and drop its library record.
   * Only paths inside a configured music folder are allowed, so a bad
   * renderer id can never unlink an arbitrary file on disk.
   */
  async deleteTrackFile(id: number): Promise<TrackFileDeleteResult> {
    const track = this.getTrack(id);
    if (!track) throw new Error("Track is not in the library.");
    const filePath = path.resolve(track.path);
    const allowed = this.data.musicFolders.some((folder) =>
      isPathInside(filePath, folder),
    );
    if (!allowed) {
      throw new Error("Refusing to delete a file outside the music folders.");
    }

    let fileMissing = false;
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") fileMissing = true;
      else throw error;
    }

    this.removeTrack(id);
    return { path: filePath, title: track.title, fileMissing };
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
    this.scheduleSettingsSave();
  }
}
