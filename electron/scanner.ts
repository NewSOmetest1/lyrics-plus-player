import { createHash } from "node:crypto";
import { existsSync, promises as fs, writeFileSync } from "node:fs";
import path from "node:path";

import { parseFile } from "music-metadata";

import type { LibraryStore } from "./store";
import type { ScanProgress, ScanSummary, TrackRecord } from "./types";

const AUDIO_EXTENSIONS = new Set([
  ".flac",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".oga",
  ".opus",
  ".wav",
  ".aiff",
  ".aif",
  ".wv",
  ".alac",
]);

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".cache",
  ".local",
  ".config",
  "target",
  "dist",
  "dist-electron",
]);

const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

export function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** 52-bit FNV-1a — stable across runs and safe for JSON/JS numbers. */
export function stableId(filePath: string): number {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(filePath)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return Number(hash & 0x000fffffffffffffn);
}

function coverUrl(fileName: string): string {
  return `media://covers/?file=${encodeURIComponent(fileName)}`;
}

async function walk(root: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      await walk(full, out);
    } else if (entry.isFile() && isAudioFile(entry.name)) {
      out.push(full);
    }
  }
}

function writeCover(
  coversDir: string,
  id: number,
  picture: { format: string; data: Uint8Array },
): string | null {
  try {
    const mime = picture.format.split(";")[0].trim().toLowerCase();
    const extension = MIME_EXTENSION[mime] ?? "jpg";
    const digest = createHash("sha1").update(picture.data).digest("hex").slice(0, 10);
    const fileName = `${id}-${digest}.${extension}`;
    const target = path.join(coversDir, fileName);
    if (!existsSync(target)) {
      writeFileSync(target, picture.data);
    }
    return coverUrl(fileName);
  } catch (error) {
    console.error("[scanner] could not write cover:", error);
    return null;
  }
}

async function readTrack(
  filePath: string,
  coversDir: string,
  previous: TrackRecord | undefined,
): Promise<TrackRecord> {
  const stat = await fs.stat(filePath);
  const metadata = await parseFile(filePath, { duration: true, skipCovers: false });
  const common = metadata.common;
  const format = metadata.format;
  const id = stableId(filePath);
  const picture = common.picture?.[0];
  const cover = picture ? writeCover(coversDir, id, picture) : null;

  const formatName = (format.container ?? path.extname(filePath).slice(1))
    .split(",")[0]
    .toUpperCase();

  return {
    id,
    path: filePath,
    title: common.title?.trim() || path.basename(filePath, path.extname(filePath)),
    artist: common.artist?.trim() || "Unknown artist",
    album: common.album?.trim() || "Unknown album",
    albumArtist: common.albumartist?.trim() || null,
    genre: common.genre?.length ? common.genre.join(", ") : null,
    year: common.year ?? null,
    trackNo: common.track.no ?? null,
    durationMs: Math.round((format.duration ?? 0) * 1000),
    format: formatName,
    bitrate: format.bitrate ? Math.round(format.bitrate) : null,
    sampleRate: format.sampleRate ?? null,
    bitDepth: format.bitsPerSample ?? null,
    channels: format.numberOfChannels ?? null,
    fileSize: stat.size,
    fileName: path.basename(filePath),
    modifiedAt: stat.mtimeMs,
    coverPath: cover,
    coverFullPath: cover,
    hasEmbeddedLyrics: Boolean(common.lyrics?.length),
    addedAt: previous?.addedAt ?? Date.now(),
  };
}

export async function scanLibrary(
  store: LibraryStore,
  coversDir: string,
  roots: string[],
  onProgress: (progress: ScanProgress) => void,
): Promise<ScanSummary> {
  const started = Date.now();
  const files: string[] = [];
  for (const root of roots) {
    const resolved = path.resolve(root);
    if (!existsSync(resolved)) continue;
    const stat = await fs.stat(resolved);
    if (stat.isFile() && isAudioFile(resolved)) files.push(resolved);
    else if (stat.isDirectory()) await walk(resolved, files);
  }

  const unique = [...new Set(files)];
  const total = unique.length;
  let current = 0;
  let added = 0;
  let updated = 0;
  const errors: string[] = [];
  let cursor = 0;

  const nextIndex = (): number | null => {
    if (cursor >= unique.length) return null;
    const index = cursor;
    cursor += 1;
    return index;
  };

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex();
      if (index === null) return;
      const filePath = unique[index];
      try {
        const previous = store.findByPath(filePath);
        const track = await readTrack(filePath, coversDir, previous);
        if (store.upsertTrack(track) === "added") added += 1;
        else updated += 1;
      } catch (error) {
        if (errors.length < 20) {
          errors.push(`${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
        }
      } finally {
        current += 1;
        onProgress({ current, total, file: filePath });
      }
    }
  };

  const concurrency = Math.min(4, Math.max(1, total));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  store.save();

  return {
    scanned: total,
    added,
    updated,
    errors,
    durationMs: Date.now() - started,
  };
}

export function defaultMusicDir(): string {
  const home = process.env.HOME ?? "";
  const music = path.join(home, "Music");
  return existsSync(music) ? music : home;
}
