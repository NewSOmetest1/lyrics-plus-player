import { createHash } from "node:crypto";
import { existsSync, promises as fs, writeFileSync } from "node:fs";
import path from "node:path";

import { nativeImage } from "electron";
import { parseFile } from "music-metadata";

import type { LibraryStore } from "./store";
import {
  artistKeys,
  parseTrackFileName,
} from "./track-names";
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

const PLACEHOLDER_TAG =
  /^(?:unknown(?: artist| album| title)?|unknown)$/i;

/** Treat writer placeholders as if the tag were absent. */
function realTag(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return PLACEHOLDER_TAG.test(trimmed) ? "" : trimmed;
}

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
    let extension = MIME_EXTENSION[mime] ?? "jpg";
    let data: Uint8Array = picture.data;

    // Embedded covers are often 16:9 (YouTube) or otherwise rectangular.
    // Center-crop to 1:1 before caching so the UI never stretches artwork.
    try {
      const image = nativeImage.createFromBuffer(Buffer.from(picture.data));
      if (!image.isEmpty()) {
        const size = image.getSize();
        if (size.width > 0 && size.height > 0 && size.width !== size.height) {
          const side = Math.min(size.width, size.height);
          const cropped = image.crop({
            x: Math.floor((size.width - side) / 2),
            y: Math.floor((size.height - side) / 2),
            width: side,
            height: side,
          });
          const png = mime === "image/png";
          data = png ? cropped.toPNG() : cropped.toJPEG(94);
          extension = png ? "png" : "jpg";
        }
      }
    } catch {
      // Unsupported image codec: keep the original bytes.
    }

    const digest = createHash("sha1").update(data).digest("hex").slice(0, 10);
    const fileName = `${id}-${digest}.${extension}`;
    const target = path.join(coversDir, fileName);
    if (!existsSync(target)) {
      writeFileSync(target, data);
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
  knownArtists: Set<string>,
): Promise<TrackRecord> {
  const canonicalPath = path.resolve(filePath);
  const stat = await fs.stat(canonicalPath);
  const metadata = await parseFile(canonicalPath, {
    duration: true,
    skipCovers: false,
  });
  const common = metadata.common;
  const format = metadata.format;
  const id = stableId(canonicalPath);
  const picture = common.picture?.[0];
  const cover = picture ? writeCover(coversDir, id, picture) : null;
  const fileBaseName = path.basename(
    canonicalPath,
    path.extname(canonicalPath),
  );
  const parsed = parseTrackFileName(fileBaseName, knownArtists);
  const taggedTitle = realTag(common.title);
  const taggedArtist = realTag(common.artist);
  const taggedAlbum = realTag(common.album);
  const title = taggedTitle || parsed.title || fileBaseName;
  const artist = taggedArtist || parsed.artist || "Unknown artist";
  // Tag-less single rips use the track name as the release name. Never leak
  // the "Unknown album" placeholder into the library UI.
  const album = taggedAlbum || parsed.title || title;
  const taggedAlbumArtist = realTag(common.albumartist);
  const albumArtist =
    taggedAlbumArtist || (artist === "Unknown artist" ? null : artist);

  const formatName = (format.container ?? path.extname(canonicalPath).slice(1))
    .split(",")[0]
    .toUpperCase();

  return {
    id,
    path: canonicalPath,
    title,
    artist,
    album,
    albumArtist,
    genre: common.genre?.length ? common.genre.join(", ") : null,
    year: common.year ?? null,
    trackNo: common.track.no ?? parsed.trackNo ?? null,
    durationMs: Math.round((format.duration ?? 0) * 1000),
    format: formatName,
    bitrate: format.bitrate ? Math.round(format.bitrate) : null,
    sampleRate: format.sampleRate ?? null,
    bitDepth: format.bitsPerSample ?? null,
    channels: format.numberOfChannels ?? null,
    fileSize: stat.size,
    fileName: path.basename(canonicalPath),
    modifiedAt: stat.mtimeMs,
    coverPath: cover,
    coverFullPath: cover,
    hasEmbeddedLyrics: Boolean(common.lyrics?.length),
    addedAt: previous?.addedAt ?? Date.now(),
  };
}

function libraryArtistNames(tracks: TrackRecord[]): Set<string> {
  const names = new Set<string>();
  for (const track of tracks) {
    for (const value of [track.artist, track.albumArtist]) {
      if (!value || value === "Unknown artist") continue;
      for (const key of artistKeys(value)) names.add(key);
    }
  }
  return names;
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
  const scannedTracks: TrackRecord[] = [];
  const knownArtists = libraryArtistNames(store.getTracks());
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
        const track = await readTrack(
          filePath,
          coversDir,
          previous,
          knownArtists,
        );
        scannedTracks.push(track);
        if (previous) updated += 1;
        else added += 1;
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

  // One entry per absolute file path. Existing entries from roots that were
  // not part of this scan survive only while their file still exists; stale
  // entries left behind by deleted files are dropped.
  const tracksMap = new Map<string, TrackRecord>();
  for (const existing of store.getTracks()) {
    const canonicalPath = path.resolve(existing.path);
    if (existsSync(canonicalPath)) {
      tracksMap.set(canonicalPath, { ...existing, path: canonicalPath });
    }
  }
  for (const track of scannedTracks) {
    const canonicalPath = path.resolve(track.path);
    tracksMap.set(canonicalPath, { ...track, path: canonicalPath });
  }
  const uniqueTracks = Array.from(tracksMap.values());
  store.replaceTracks(uniqueTracks);
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
