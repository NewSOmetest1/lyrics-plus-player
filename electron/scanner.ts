import { createHash } from "node:crypto";
import { existsSync, promises as fs, readFileSync, writeFileSync } from "node:fs";
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

/**
 * Bump when tag/cover extraction changes. Unchanged files are then re-read
 * once instead of reusing the previous record. Missing value means this is the
 * first build that knows about the marker; current records are still reusable.
 */
const SCANNER_VERSION = "2";
const SCANNER_VERSION_KEY = "scanner_version";

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

const COVER_CARD_SIDE = 384;
const COVER_DISPLAY_SIDE = 1280;
const COVER_JPEG_QUALITY = 88;
const COVER_HASH_LENGTH = 12;

const COVER_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
};

interface CoverVariants {
  /** Small variant for rows, grids and the player bar. */
  card: string;
  /** Large variant for the hero artwork, ambient background and MPRIS. */
  display: string;
}

function encodeCover(
  image: ReturnType<typeof nativeImage.createFromBuffer>,
  side: number,
  keepAlpha: boolean,
): { data: Buffer; extension: string } {
  const size = image.getSize();
  const largest = Math.max(size.width, size.height);
  const resized =
    largest > side
      ? image.resize({
          width: Math.max(1, Math.round((size.width * side) / largest)),
          height: Math.max(1, Math.round((size.height * side) / largest)),
          quality: "good",
        })
      : image;
  return keepAlpha
    ? { data: resized.toPNG(), extension: "png" }
    : { data: resized.toJPEG(COVER_JPEG_QUALITY), extension: "jpg" };
}

function coverHasAlpha(
  image: ReturnType<typeof nativeImage.createFromBuffer>,
): boolean {
  try {
    const bitmap = image.toBitmap();
    for (let index = 3; index < bitmap.length; index += 4) {
      if (bitmap[index] < 255) return true;
    }
  } catch {
    // If the bitmap cannot be inspected, fall back to opaque JPEG.
  }
  return false;
}

function prepareCoverImage(picture: {
  format: string;
  data: Uint8Array;
}): {
  image: ReturnType<typeof nativeImage.createFromBuffer>;
  alpha: boolean;
} | null {
  const mime = picture.format.split(";")[0].trim().toLowerCase();
  const image = nativeImage.createFromBuffer(Buffer.from(picture.data));
  if (image.isEmpty()) return null;

  const size = image.getSize();
  if (size.width <= 0 || size.height <= 0) return null;

  // Embedded covers are often 16:9 (YouTube) or otherwise rectangular.
  // Center-crop to 1:1 before caching so the UI never stretches artwork.
  const cropped =
    size.width === size.height
      ? image
      : image.crop({
          x: Math.floor((size.width - Math.min(size.width, size.height)) / 2),
          y: Math.floor((size.height - Math.min(size.width, size.height)) / 2),
          width: Math.min(size.width, size.height),
          height: Math.min(size.width, size.height),
        });

  const alpha =
    (mime === "image/png" || mime === "image/webp") &&
    coverHasAlpha(cropped);
  return { image: cropped, alpha };
}

/** Content-addressed file name: identical artwork is stored exactly once. */
function writeCoverBytes(
  coversDir: string,
  data: Uint8Array,
  extension: string,
): string {
  const digest = createHash("sha1")
    .update(data)
    .digest("hex")
    .slice(0, COVER_HASH_LENGTH);
  const fileName = `${digest}.${extension}`;
  const target = path.join(coversDir, fileName);
  if (!existsSync(target)) writeFileSync(target, data);
  return coverUrl(fileName);
}

function writeCover(
  coversDir: string,
  picture: { format: string; data: Uint8Array },
): CoverVariants | null {
  try {
    const prepared = prepareCoverImage(picture);
    if (!prepared) {
      // Unsupported image codec: keep the original bytes, but still dedupe.
      const mime = picture.format.split(";")[0].trim().toLowerCase();
      const extension = MIME_EXTENSION[mime] ?? "jpg";
      const url = writeCoverBytes(coversDir, picture.data, extension);
      return { card: url, display: url };
    }

    const cardData = encodeCover(
      prepared.image,
      COVER_CARD_SIDE,
      prepared.alpha,
    );
    const card = writeCoverBytes(
      coversDir,
      cardData.data,
      cardData.extension,
    );

    if (prepared.image.getSize().width <= COVER_CARD_SIDE) {
      return { card, display: card };
    }

    const displayData = encodeCover(
      prepared.image,
      COVER_DISPLAY_SIDE,
      prepared.alpha,
    );
    return {
      card,
      display: writeCoverBytes(
        coversDir,
        displayData.data,
        displayData.extension,
      ),
    };
  } catch (error) {
    console.error("[scanner] could not write cover:", error);
    return null;
  }
}

/** Extract a stored cover file name from a media://covers URL. */
export function coverFileNameFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "media:" || url.hostname !== "covers") return null;
    return url.searchParams.get("file");
  } catch {
    return null;
  }
}

/** New content-addressed names have no track id prefix. */
export function isCoverVariantFileName(name: string): boolean {
  return /^[0-9a-f]{12}\.(?:jpg|png)$/i.test(name);
}

/**
 * Build card/display variants from an existing cached cover. Used by the
 * background migration for libraries created before variants existed.
 */
export function ensureCoverVariantsFromFile(
  coversDir: string,
  fileName: string,
): CoverVariants | null {
  const safeName = path.basename(fileName);
  const source = path.join(coversDir, safeName);
  if (!existsSync(source)) return null;
  try {
    const extension = path.extname(safeName).slice(1).toLowerCase();
    const format = COVER_MIME_BY_EXTENSION[extension] ?? "image/jpeg";
    return writeCover(coversDir, { format, data: readFileSync(source) });
  } catch (error) {
    console.error("[scanner] could not migrate cover:", safeName, error);
    return null;
  }
}

/**
 * Metadata parsing is cheap, but decoding and re-encoding the embedded cover
 * is not: a full rescan of a large library can occupy the main process for
 * tens of seconds. When the file bytes are unchanged the previous record
 * already has every derived field, so reuse it as-is.
 */
function isUnchangedTrack(
  previous: TrackRecord,
  stat: { mtimeMs: number; size: number },
  filePath: string,
  coversDir: string,
): boolean {
  if (
    previous.modifiedAt !== stat.mtimeMs ||
    previous.fileSize !== stat.size ||
    previous.fileName !== path.basename(filePath) ||
    previous.durationMs <= 0
  ) {
    return false;
  }
  for (const value of [previous.coverPath, previous.coverFullPath]) {
    const fileName = coverFileNameFromUrl(value);
    if (fileName && !existsSync(path.join(coversDir, fileName))) return false;
  }
  return true;
}

async function readTrack(
  filePath: string,
  coversDir: string,
  previous: TrackRecord | undefined,
  knownArtists: Set<string>,
  reuseUnchanged: boolean,
): Promise<TrackRecord> {
  const canonicalPath = path.resolve(filePath);
  const stat = await fs.stat(canonicalPath);
  if (
    previous &&
    reuseUnchanged &&
    isUnchangedTrack(previous, stat, filePath, coversDir)
  ) {
    return { ...previous, path: canonicalPath };
  }
  const metadata = await parseFile(canonicalPath, {
    duration: true,
    skipCovers: false,
  });
  const common = metadata.common;
  const format = metadata.format;
  const id = stableId(canonicalPath);
  const picture = common.picture?.[0];
  const cover = picture ? writeCover(coversDir, picture) : null;
  // Keep the pre-migration original as the palette source so ambient/header
  // accents stay byte-for-byte identical to the old full-size sampling.
  const previousCoverFile = coverFileNameFromUrl(previous?.coverPath ?? null);
  const artworkUnchanged =
    Boolean(previous) &&
    previous!.modifiedAt === stat.mtimeMs &&
    previous!.fileSize === stat.size;
  const coverPalettePath = artworkUnchanged
    ? previous!.coverPalettePath ??
      (previousCoverFile && !isCoverVariantFileName(previousCoverFile)
        ? previous!.coverPath
        : null) ??
      cover?.display ??
      null
    : cover?.display ?? null;
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
    coverPath: cover?.card ?? null,
    coverFullPath: cover?.display ?? null,
    coverPalettePath,
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
  // Reuse unchanged records only while the extraction logic that produced them
  // is current. After a scanner upgrade every file is re-read exactly once.
  const storedScannerVersion = store.getSetting(SCANNER_VERSION_KEY);
  const reuseUnchanged =
    storedScannerVersion === undefined ||
    storedScannerVersion === SCANNER_VERSION;
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
          reuseUnchanged,
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
  store.setSetting(SCANNER_VERSION_KEY, SCANNER_VERSION);
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
