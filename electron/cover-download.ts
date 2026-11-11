import { promises as fs } from "node:fs";
import path from "node:path";

import { app, dialog, nativeImage, shell, type BrowserWindow } from "electron";

import { coverFileNameFromUrl } from "./scanner";
import type {
  CoverDownloadRequest,
  CoverDownloadResult,
  CoverQuality,
  CoverTarget,
} from "./types";

const IMAGE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

const API_HEADERS = {
  "User-Agent":
    "LyricsPlus/0.1 (cover-download; https://github.com/NewSOmetest1/lyrics-plus-player)",
  Accept: "application/json",
};

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MIN_SIDE = 300;
const MATCH_THRESHOLD = 0.6;
const STRICT_MATCH_THRESHOLD = 0.88;
const MAX_TARGET_SIDE = 3_000;
const HASH_MAX_DISTANCE = 14;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SPOTIFY_ALBUM_IMAGE =
  /^(https:\/\/i\.scdn\.co\/image\/ab67616d0000)([0-9a-z]{4})([0-9a-z]+)$/i;

interface Candidate {
  buffer: Buffer;
  mime: string;
  extension: string;
  width: number;
  height: number;
  source: string;
  hash: bigint | null;
}

interface ItunesResult {
  collectionName?: string;
  artistName?: string;
  artworkUrl100?: string;
}

interface DeezerAlbum {
  title?: string;
  artist?: { name?: string };
  cover_xl?: string;
  md5_image?: string;
}

interface MusicBrainzRelease {
  id?: string;
  title?: string;
  score?: number;
  "artist-credit"?: Array<{
    name?: string;
    artist?: { name?: string };
  }>;
}

function coversFolder(): string {
  return path.join(app.getPath("home"), "Covers");
}

function displayPath(filePath: string): string {
  const home = app.getPath("home");
  if (filePath === home) return "~";
  if (filePath.startsWith(`${home}${path.sep}`)) {
    return `~${filePath.slice(home.length)}`;
  }
  return filePath;
}

function parseRequest(payload: unknown): CoverDownloadRequest {
  const value = payload as Partial<CoverDownloadRequest> | null;
  const target = value?.target as Partial<CoverTarget> | undefined;
  const quality = value?.quality;
  const allowed: CoverQuality[] = ["max", "spotify", "deezer", "640"];
  if (
    !target ||
    typeof target.album !== "string" ||
    typeof target.artist !== "string" ||
    !quality ||
    !allowed.includes(quality)
  ) {
    throw new Error("Некорректный запрос обложки.");
  }
  return {
    quality,
    saveAs: Boolean(value?.saveAs),
    target: {
      artist: target.artist.trim(),
      album: target.album.trim(),
      year: typeof target.year === "string" ? target.year : null,
      spotifyImageUrl:
        typeof target.spotifyImageUrl === "string"
          ? target.spotifyImageUrl
          : null,
      spotifyAlbumId:
        typeof target.spotifyAlbumId === "string"
          ? target.spotifyAlbumId
          : null,
      referenceCoverUrl:
        typeof target.referenceCoverUrl === "string"
          ? target.referenceCoverUrl
          : null,
    },
  };
}

function sniffImageMime(buffer: Buffer): string | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 6 && buffer.toString("ascii", 0, 3) === "GIF") {
    return "image/gif";
  }
  if (buffer.length >= 2 && buffer.toString("ascii", 0, 2) === "BM") {
    return "image/bmp";
  }
  return null;
}

function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    default:
      return "jpg";
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function averageHash(image: ReturnType<typeof nativeImage.createFromBuffer>): bigint | null {
  const resized = image.resize({ width: 8, height: 8, quality: "good" });
  const bitmap = resized.toBitmap();
  if (bitmap.length < 8 * 8 * 4) return null;
  const luminance: number[] = [];
  for (let index = 0; index < 64; index += 1) {
    const offset = index * 4;
    const blue = bitmap[offset] ?? 0;
    const green = bitmap[offset + 1] ?? 0;
    const red = bitmap[offset + 2] ?? 0;
    luminance.push(0.299 * red + 0.587 * green + 0.114 * blue);
  }
  const average =
    luminance.reduce((total, value) => total + value, 0) / luminance.length;
  let hash = 0n;
  for (let index = 0; index < luminance.length; index += 1) {
    if (luminance[index] >= average) hash |= 1n << BigInt(index);
  }
  return hash;
}

function hammingDistance(left: bigint, right: bigint): number {
  let value = left ^ right;
  let distance = 0;
  while (value !== 0n) {
    value &= value - 1n;
    distance += 1;
  }
  return distance;
}

async function fetchImage(
  url: string | null | undefined,
  source: string,
): Promise<Candidate | null> {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: IMAGE_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength < 1024 || buffer.byteLength > MAX_IMAGE_BYTES) {
      return null;
    }
    const mime = sniffImageMime(buffer);
    if (!mime) return null;
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    if (width < MIN_SIDE || height < MIN_SIDE) return null;
    return {
      buffer,
      mime,
      extension: extensionForMime(mime),
      width,
      height,
      source,
      hash: averageHash(image),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadReferenceHash(
  target: CoverTarget,
): Promise<bigint | null> {
  const fileName = coverFileNameFromUrl(target.referenceCoverUrl ?? null);
  if (!fileName) return null;
  const safeName = path.basename(fileName);
  if (!safeName || safeName !== fileName) return null;
  try {
    const filePath = path.join(app.getPath("userData"), "covers", safeName);
    const stat = await fs.stat(filePath);
    if (stat.size < 1024 || stat.size > MAX_IMAGE_BYTES) return null;
    const buffer = await fs.readFile(filePath);
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return null;
    return averageHash(image);
  } catch {
    return null;
  }
}

async function resolveReferenceHash(
  target: CoverTarget,
): Promise<bigint | null> {
  const local = await loadReferenceHash(target);
  if (local) return local;
  const spotify = await fetchImage(
    spotifyVariant(target.spotifyImageUrl, "b273"),
    "Spotify",
  );
  return spotify?.hash ?? null;
}

function hashDistance(
  candidate: Candidate,
  referenceHash: bigint | null,
): string {
  if (!candidate.hash || !referenceHash) return "n/a";
  return String(hammingDistance(candidate.hash, referenceHash));
}

function logCandidate(
  label: string,
  candidate: Candidate | null,
  referenceHash: bigint | null,
): void {
  if (!candidate) {
    console.log(`[covers] ${label}: none`);
    return;
  }
  console.log(
    `[covers] ${label}: ${candidate.source} ${candidate.width}x${candidate.height} ${candidate.buffer.byteLength}B hash=${hashDistance(candidate, referenceHash)}`,
  );
}

function artistSearchNames(value: string): string[] {
  const full = value.trim();
  if (!full) return [];
  const primary = full
    .split(/\s*(?:[,;]|\bfeat\.?\b|\bfeaturing\b)\s*/i)[0]
    ?.trim();
  return primary && primary !== full ? [full, primary] : [full];
}

function normalizeTitle(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/\s*[-–—]\s*(?:single|ep)\s*$/i, "")
    .replace(/\b(?:feat\.?|featuring)\b.*$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length >= 4 && right.includes(left)) return 0.82;
  if (right.length >= 4 && left.includes(right)) return 0.82;
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function matchScore(target: CoverTarget, title: string, artist: string): number {
  const titleScore = similarity(
    normalizeTitle(target.album),
    normalizeTitle(title),
  );
  if (titleScore === 0) return 0;
  const wantedArtist = normalizeTitle(target.artist);
  if (!wantedArtist) return titleScore;
  const foundArtist = normalizeTitle(artist);
  if (!foundArtist) return titleScore * 0.9;
  return titleScore * 0.8 + similarity(wantedArtist, foundArtist) * 0.2;
}

function spotifyVariant(
  url: string | null | undefined,
  size: "82c1" | "b273",
): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  const match = SPOTIFY_ALBUM_IMAGE.exec(trimmed);
  if (!match) return trimmed;
  return `${match[1]}${size}${match[3]}`;
}

function appleArtworkUrl(artworkUrl: string, size: string): string {
  return artworkUrl.replace(
    /\/\d+x\d+(?:bb|-\d+)?\.(jpg|jpeg|png|webp)$/i,
    `/${size}.$1`,
  );
}

function deezerBaseUrl(album: DeezerAlbum): string | null {
  const cover = album.cover_xl?.trim();
  if (cover) {
    const match =
      /^(https:\/\/cdn-images\.dzcdn\.net\/images\/cover\/[0-9a-f]+)\/[^/]+$/i.exec(
        cover,
      );
    if (match) return match[1];
  }
  const md5 = album.md5_image?.trim();
  if (md5 && /^[0-9a-f]+$/i.test(md5)) {
    return `https://cdn-images.dzcdn.net/images/cover/${md5}`;
  }
  return null;
}

interface ItunesMatch {
  url: string;
  score: number;
}

async function fetchItunesMatches(
  target: CoverTarget,
  artist: string,
  entity: "album" | "song",
  country: string,
  minScore: number,
): Promise<ItunesMatch[]> {
  const endpoint = new URL("https://itunes.apple.com/search");
  endpoint.searchParams.set("term", `${artist} ${target.album}`.trim());
  endpoint.searchParams.set("entity", entity);
  endpoint.searchParams.set("limit", entity === "album" ? "25" : "50");
  endpoint.searchParams.set("country", country);
  try {
    const response = await fetchWithTimeout(
      endpoint.toString(),
      { headers: API_HEADERS },
      9_000,
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as { results?: ItunesResult[] };
    const matches: ItunesMatch[] = [];
    for (const item of payload.results ?? []) {
      if (!item.artworkUrl100 || !item.collectionName) continue;
      const score = matchScore(
        target,
        item.collectionName,
        item.artistName ?? "",
      );
      if (score >= minScore) {
        matches.push({ url: item.artworkUrl100, score });
      }
    }
    return matches;
  } catch {
    return [];
  }
}

async function searchItunes(
  target: CoverTarget,
  minScore = MATCH_THRESHOLD,
): Promise<ItunesMatch[]> {
  if (!target.artist && !target.album) return [];
  const ranked: ItunesMatch[] = [];
  const hasExact = (items: ItunesMatch[]) =>
    items.some((item) => item.score >= 0.99);

  const artists = target.artist ? artistSearchNames(target.artist) : [""];
  for (const artist of artists) {
    for (const country of ["US", "UA"]) {
      const matches = await fetchItunesMatches(
        target,
        artist,
        "album",
        country,
        minScore,
      );
      ranked.push(...matches);
      if (hasExact(matches)) break;
    }
    if (hasExact(ranked)) break;
    // iTunes' album search sometimes misses small releases even though the
    // tracks are indexed. A song search exposes their collection artwork.
    for (const country of ["US", "UA"]) {
      const matches = await fetchItunesMatches(
        target,
        artist,
        "song",
        country,
        minScore,
      );
      ranked.push(...matches);
      if (hasExact(matches)) break;
    }
    if (hasExact(ranked)) break;
  }

  const seen = new Set<string>();
  return ranked
    .sort((left, right) => right.score - left.score)
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .slice(0, 4);
}

async function resolveApple(
  target: CoverTarget,
  referenceHash: bigint | null,
  minScore = MATCH_THRESHOLD,
): Promise<Candidate | null> {
  const artworkUrls = await searchItunes(target, minScore);
  let best: Candidate | null = null;
  for (const match of artworkUrls) {
    let candidate: Candidate | null = null;
    for (const size of ["3000x3000-999", "3000x3000bb", "1400x1400bb"]) {
      candidate = await fetchImage(
        appleArtworkUrl(match.url, size),
        "Apple Music",
      );
      if (candidate) break;
    }
    if (!candidate) continue;
    if (!sameArtwork(candidate, referenceHash)) {
      logCandidate("Apple rejected", candidate, referenceHash);
      continue;
    }
    if (
      !best ||
      candidate.width * candidate.height > best.width * best.height
    ) {
      best = candidate;
    }
    if (best.width >= MAX_TARGET_SIDE) return best;
  }
  return best;
}

interface DeezerMatch {
  base: string;
  score: number;
}

async function fetchDeezerMatches(
  target: CoverTarget,
  artist: string,
  minScore: number,
): Promise<DeezerMatch[]> {
  const endpoint = new URL("https://api.deezer.com/search/album");
  endpoint.searchParams.set("q", `${artist} ${target.album}`.trim());
  endpoint.searchParams.set("limit", "12");
  try {
    const response = await fetchWithTimeout(
      endpoint.toString(),
      { headers: API_HEADERS },
      9_000,
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: DeezerAlbum[] };
    return (payload.data ?? [])
      .map((album) => ({
        base: deezerBaseUrl(album),
        score: matchScore(target, album.title ?? "", album.artist?.name ?? ""),
      }))
      .filter(
        (item): item is DeezerMatch =>
          Boolean(item.base) && item.score >= minScore,
      );
  } catch {
    return [];
  }
}

async function searchDeezer(
  target: CoverTarget,
  minScore = MATCH_THRESHOLD,
): Promise<DeezerMatch[]> {
  if (!target.artist && !target.album) return [];
  const ranked: DeezerMatch[] = [];
  const artists = target.artist ? artistSearchNames(target.artist) : [""];
  for (const artist of artists) {
    const matches = await fetchDeezerMatches(target, artist, minScore);
    ranked.push(...matches);
    if (matches.some((item) => item.score >= 0.99)) break;
  }
  const seen = new Set<string>();
  return ranked
    .sort((left, right) => right.score - left.score)
    .filter((item) => {
      if (seen.has(item.base)) return false;
      seen.add(item.base);
      return true;
    })
    .slice(0, 2);
}

async function resolveDeezer(
  target: CoverTarget,
  referenceHash: bigint | null,
  minScore = MATCH_THRESHOLD,
): Promise<Candidate | null> {
  const albums = await searchDeezer(target, minScore);
  for (const album of albums) {
    for (const size of [
      "1500x1500-000000-100-0-0.png",
      "1400x1400-000000-100-0-0.png",
      "1200x1200-000000-100-0-0.png",
      "1000x1000-000000-80-0-0.jpg",
    ]) {
      const candidate = await fetchImage(`${album.base}/${size}`, "Deezer");
      if (!candidate) continue;
      if (!sameArtwork(candidate, referenceHash)) {
        logCandidate("Deezer rejected", candidate, referenceHash);
        break;
      }
      return candidate;
    }
  }
  return null;
}

let lastMusicBrainzAt = 0;

async function musicBrainzFetch(url: string): Promise<Response | null> {
  const wait = 1_100 - (Date.now() - lastMusicBrainzAt);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastMusicBrainzAt = Date.now();
  try {
    const response = await fetchWithTimeout(
      url,
      { headers: API_HEADERS },
      9_000,
    );
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

interface MusicBrainzMatch {
  id: string;
  score: number;
}

async function searchMusicBrainz(
  target: CoverTarget,
  artist: string,
  minScore: number,
): Promise<MusicBrainzMatch[]> {
  const endpoint = new URL("https://musicbrainz.org/ws/2/release/");
  const release = target.album.replace(/["\\]/g, " ").trim();
  const credit = artist.replace(/["\\]/g, " ").trim();
  const query = credit
    ? `release:"${release}" AND artist:"${credit}"`
    : `release:"${release}"`;
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("fmt", "json");
  endpoint.searchParams.set("limit", "10");
  const response = await musicBrainzFetch(endpoint.toString());
  if (!response) return [];
  let releases: MusicBrainzRelease[] = [];
  try {
    const payload = (await response.json()) as {
      releases?: MusicBrainzRelease[];
    };
    releases = payload.releases ?? [];
  } catch {
    return [];
  }
  return releases
    .map((item) => {
      const foundArtist = (item["artist-credit"] ?? [])
        .map((entry) => entry.name ?? entry.artist?.name ?? "")
        .join(", ");
      return {
        id: item.id,
        score: matchScore(target, item.title ?? "", foundArtist),
      };
    })
    .filter(
      (item): item is MusicBrainzMatch =>
        Boolean(item.id) && item.score >= minScore,
    );
}

async function resolveCoverArtArchive(
  target: CoverTarget,
  referenceHash: bigint | null,
  minScore = MATCH_THRESHOLD,
): Promise<Candidate | null> {
  if (!target.album) return null;
  const ranked: MusicBrainzMatch[] = [];
  const artists = target.artist ? artistSearchNames(target.artist) : [""];
  for (const artist of artists) {
    const matches = await searchMusicBrainz(target, artist, minScore);
    ranked.push(...matches);
    if (matches.some((item) => item.score >= 0.99)) break;
  }
  const seen = new Set<string>();
  const sorted = ranked
    .sort((left, right) => right.score - left.score)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  for (const release of sorted.slice(0, 2)) {
    const candidate = await fetchImage(
      `https://coverartarchive.org/release/${release.id}/front`,
      "Cover Art Archive",
    );
    if (!candidate) continue;
    if (!sameArtwork(candidate, referenceHash)) {
      logCandidate("Cover Art Archive rejected", candidate, referenceHash);
      continue;
    }
    return candidate;
  }
  return null;
}

function sameArtwork(
  candidate: Candidate,
  referenceHash: bigint | null,
): boolean {
  if (!referenceHash || !candidate.hash) return true;
  return hammingDistance(candidate.hash, referenceHash) <= HASH_MAX_DISTANCE;
}

function pickBest(candidates: Candidate[]): Candidate | null {
  return (
    [...candidates].sort(
      (left, right) =>
        right.width * right.height - left.width * left.height ||
        right.buffer.byteLength - left.buffer.byteLength,
    )[0] ?? null
  );
}

async function resolveMax(target: CoverTarget): Promise<Candidate | null> {
  console.log(
    `[covers] resolve max: ${target.artist} — ${target.album}${target.year ? ` (${target.year})` : ""}`,
  );
  const localReference = await loadReferenceHash(target);
  const minScore =
    localReference || target.spotifyImageUrl
      ? MATCH_THRESHOLD
      : STRICT_MATCH_THRESHOLD;

  const [spotify, apple] = await Promise.all([
    fetchImage(spotifyVariant(target.spotifyImageUrl, "82c1"), "Spotify"),
    resolveApple(target, localReference, minScore),
  ]);
  const referenceHash = spotify?.hash ?? localReference;
  logCandidate("Spotify", spotify, referenceHash);

  const candidates: Candidate[] = [];
  if (spotify) candidates.push(spotify);
  if (apple) {
    if (sameArtwork(apple, referenceHash)) {
      logCandidate("Apple", apple, referenceHash);
      candidates.push(apple);
    } else {
      logCandidate("Apple rejected", apple, referenceHash);
    }
  } else {
    logCandidate("Apple", null, referenceHash);
  }

  let best = pickBest(candidates);
  if (best && best.width >= MAX_TARGET_SIDE) return best;

  const tasks: Array<Promise<Candidate | null>> = [];
  if (!best || best.width < 1_500) {
    tasks.push(resolveDeezer(target, referenceHash, minScore));
  }
  tasks.push(resolveCoverArtArchive(target, referenceHash, minScore));
  const extra = await Promise.all(tasks);
  for (const candidate of extra) {
    if (!candidate) continue;
    if (sameArtwork(candidate, referenceHash)) {
      logCandidate("additional", candidate, referenceHash);
      candidates.push(candidate);
    } else {
      logCandidate("additional rejected", candidate, referenceHash);
    }
  }

  best = pickBest(candidates);
  logCandidate("selected", best, referenceHash);
  return best;
}

async function resolveCandidate(
  request: CoverDownloadRequest,
): Promise<Candidate> {
  const { target, quality } = request;
  let candidate: Candidate | null = null;

  if (quality === "spotify") {
    candidate = await fetchImage(
      spotifyVariant(target.spotifyImageUrl, "82c1"),
      "Spotify",
    );
    if (!candidate) {
      candidate = await fetchImage(target.spotifyImageUrl, "Spotify");
    }
  } else if (quality === "deezer") {
    const referenceHash = await resolveReferenceHash(target);
    const minScore = referenceHash
      ? MATCH_THRESHOLD
      : STRICT_MATCH_THRESHOLD;
    candidate = await resolveDeezer(target, referenceHash, minScore);
  } else if (quality === "640") {
    candidate = await fetchImage(target.spotifyImageUrl, "Spotify");
    if (!candidate) {
      candidate = await fetchImage(
        spotifyVariant(target.spotifyImageUrl, "b273"),
        "Spotify",
      );
    }
    if (!candidate) {
      const referenceHash = await resolveReferenceHash(target);
      const minScore = referenceHash
        ? MATCH_THRESHOLD
        : STRICT_MATCH_THRESHOLD;
      candidate = await resolveDeezer(target, referenceHash, minScore);
    }
  } else {
    candidate = await resolveMax(target);
  }

  if (!candidate) {
    throw new Error(
      `Не удалось найти обложку для «${target.artist} — ${target.album}».`,
    );
  }
  return candidate;
}

function sanitizeFileName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned || "Unknown";
}

function truncateUtf8(value: string, maxBytes: number): string {
  const characters = [...value];
  while (
    characters.length > 0 &&
    Buffer.byteLength(characters.join(""), "utf8") > maxBytes
  ) {
    characters.pop();
  }
  return characters.join("");
}

function buildFileName(
  target: CoverTarget,
  width: number,
  height: number,
  extension: string,
): string {
  const artist = sanitizeFileName(target.artist || "Unknown artist");
  const album = sanitizeFileName(target.album || "Unknown album");
  const year = target.year?.match(/\d{4}/)?.[0];
  const parts = [`${artist} - ${album}`];
  if (year) parts.push(`[${year}]`);
  parts.push(`[${width}x${height}]`);
  return `${truncateUtf8(parts.join(" "), 220)}.${extension}`;
}

async function uniquePath(filePath: string): Promise<string> {
  const extension = path.extname(filePath);
  const stem = filePath.slice(0, filePath.length - extension.length);
  let candidate = filePath;
  for (let index = 2; index < 1_000; index += 1) {
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
    candidate = `${stem} (${index})${extension}`;
  }
  return `${stem} (${Date.now()})${extension}`;
}

function ensureExtension(filePath: string, extension: string): string {
  const current = path.extname(filePath).toLowerCase();
  const wanted = `.${extension}`;
  if (!current) return `${filePath}${wanted}`;
  if (current === wanted) return filePath;
  if (
    (extension === "jpg" && (current === ".jpeg" || current === ".jfif")) ||
    (extension === "png" && current === ".png")
  ) {
    return filePath;
  }
  if (/^\.(?:jpe?g|jfif|png|webp|gif|bmp)$/i.test(current)) {
    return `${filePath.slice(0, filePath.length - current.length)}${wanted}`;
  }
  return `${filePath}${wanted}`;
}

export async function downloadCover(
  payload: unknown,
  window: BrowserWindow | null,
): Promise<CoverDownloadResult> {
  const request = parseRequest(payload);
  const candidate = await resolveCandidate(request);
  const folder = coversFolder();
  await fs.mkdir(folder, { recursive: true });

  const fileName = buildFileName(
    request.target,
    candidate.width,
    candidate.height,
    candidate.extension,
  );
  let destination = await uniquePath(path.join(folder, fileName));

  if (request.saveAs) {
    const options: Electron.SaveDialogOptions = {
      title: "Сохранить обложку",
      buttonLabel: "Сохранить",
      defaultPath: destination,
      filters: [
        {
          name:
            candidate.extension === "png"
              ? "PNG image"
              : candidate.extension === "webp"
                ? "WebP image"
                : "JPEG image",
          extensions: [candidate.extension],
        },
      ],
    };
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return {
        canceled: true,
        path: null,
        displayPath: null,
        folder: displayPath(folder),
        width: candidate.width,
        height: candidate.height,
        source: candidate.source,
        bytes: candidate.buffer.byteLength,
      };
    }
    destination = ensureExtension(result.filePath, candidate.extension);
  }

  await fs.writeFile(destination, candidate.buffer);
  return {
    canceled: false,
    path: destination,
    displayPath: displayPath(destination),
    folder: displayPath(folder),
    width: candidate.width,
    height: candidate.height,
    source: candidate.source,
    bytes: candidate.buffer.byteLength,
  };
}

export async function openCoversFolder(): Promise<string> {
  const folder = coversFolder();
  await fs.mkdir(folder, { recursive: true });
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
  return displayPath(folder);
}
