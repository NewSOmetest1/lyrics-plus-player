import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { areArtistsMatching } from "../shared/translit";
import { spotifyKey } from "../shared/spotifyMatch";
import { probeMediaRange } from "./mediaProbe";
import type { PreviewLookup, PreviewPlaybackSource } from "./types";

const execFileAsync = promisify(execFile);

const REQUEST_TIMEOUT_MS = 12_000;
const YT_DLP_TIMEOUT_MS = 35_000;
/** Two range probes per URL absorb a single CDN connect timeout. */
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_ATTEMPTS = 2;
/** Deezer signs preview URLs for roughly 15 minutes. */
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const STREAM_TTL_MS = 15 * 60 * 1000;
/** SoundCloud HLS signatures are short-lived, often under 10 minutes. */
const SOUNDCLOUD_STREAM_TTL_MS = 4 * 60 * 1000;
const CACHE_LIMIT = 800;

const EMBED_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface CachedPreview {
  result: PreviewPlaybackSource | null;
  expiresAt: number;
}

const previewCache = new Map<string, CachedPreview>();
const streamCache = new Map<string, CachedPreview>();

function trim(value: unknown, limit = 300): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

/** Validate an IPC payload before it reaches network or process calls. */
export function normalizePreviewLookup(payload: unknown): PreviewLookup | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const trackId = trim(record.trackId, 80);
  const title = trim(record.title);
  const artist = trim(record.artist);
  if (!trackId && (!title || !artist)) return null;

  const artists = Array.isArray(record.artists)
    ? record.artists
        .map((value) => trim(value, 160))
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const durationMs =
    typeof record.durationMs === "number" && Number.isFinite(record.durationMs)
      ? Math.max(0, Math.round(record.durationMs))
      : undefined;
  const previewUrl = trim(record.previewUrl, 2_000);
  const album = trim(record.album);

  return {
    trackId: trackId || undefined,
    title,
    artist,
    artists: artists.length > 0 ? artists : undefined,
    album: album || undefined,
    durationMs,
    previewUrl: previewUrl.startsWith("https://") ? previewUrl : null,
    ...(record.force === true ? { force: true } : {}),
  };
}

function cacheKey(input: PreviewLookup): string {
  return [
    input.trackId ?? "",
    spotifyKey(input.title),
    spotifyKey(input.artist),
    input.durationMs ?? 0,
  ].join("\u0000");
}

function remember(
  cache: Map<string, CachedPreview>,
  key: string,
  result: PreviewPlaybackSource | null,
  ttl: number,
): void {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, { result, expiresAt: Date.now() + ttl });
}

function readCache(
  cache: Map<string, CachedPreview>,
  key: string,
): CachedPreview | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry;
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "User-Agent": EMBED_USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const text = await fetchText(url);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function splitArtists(value: string): string[] {
  return value
    .split(
      /\s*(?:,|;|\/|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\sx\s)\s*/i,
    )
    .map((name) => name.trim())
    .filter(Boolean);
}

function inputArtistNames(input: PreviewLookup): string[] {
  const names =
    input.artists && input.artists.length > 0
      ? [...input.artists]
      : splitArtists(input.artist);
  if (input.artist && !names.includes(input.artist)) names.push(input.artist);
  return names.map((name) => name.trim()).filter(Boolean);
}

function artistMatches(candidate: string, input: PreviewLookup): boolean {
  const artists = inputArtistNames(input);
  const candidateNames = splitArtists(candidate);
  if (artists.length === 0 || candidateNames.length === 0) return false;
  return artists.some((artist) =>
    candidateNames.some((name) => areArtistsMatching(artist, name)),
  );
}

function titleMatches(candidate: string, input: PreviewLookup): boolean {
  const candidateKey = spotifyKey(candidate);
  const wantedKey = spotifyKey(input.title);
  return Boolean(candidateKey && wantedKey && candidateKey === wantedKey);
}

function durationMatches(
  candidateMs: number | undefined,
  input: PreviewLookup,
): boolean {
  if (!candidateMs || !input.durationMs) return true;
  return Math.abs(candidateMs - input.durationMs) <= 20_000;
}

function https(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.startsWith("https://") ? trimmed : null;
}

/**
 * The stream deck is a plain HTMLAudioElement with no HLS support. Only accept
 * progressive HTTPS media; manifests answer 403/CORS and must fall through to
 * the next provider instead of entering the queue as an unplayable URL.
 */
function directHttps(value: unknown): string | null {
  const url = https(value);
  if (!url) return null;
  if (url.includes("manifest.googlevideo.com")) return null;
  if (/\.m3u8(?:$|[?#])/i.test(url)) return null;
  return url;
}

/** Spotify embed HTML still exposes a 30-second audioPreview for most tracks. */
async function spotifyEmbedPreview(
  input: PreviewLookup,
): Promise<PreviewPlaybackSource | null> {
  const hint = https(input.previewUrl);
  if (hint) {
    return { url: hint, source: "spotify", kind: "preview", expiresAt: null };
  }

  const id = input.trackId ?? "";
  if (!/^[A-Za-z0-9]{5,40}$/.test(id)) return null;

  const html = await fetchText(`https://open.spotify.com/embed/track/${id}`);
  if (!html) return null;
  const match = /"audioPreview"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/.exec(html);
  const url = match?.[1]
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/");
  if (!url?.startsWith("https://")) return null;
  return { url, source: "spotify", kind: "preview", expiresAt: null };
}

interface DeezerTrack {
  id?: number;
  title?: string;
  duration?: number;
  preview?: string;
  artist?: { name?: string };
}

interface DeezerSearch {
  data?: DeezerTrack[];
}

/**
 * Deezer can return remasters, live edits and covers. Score title + artist +
 * duration the way the downloader does, so a query variant cannot silently
 * pick the wrong recording.
 */
function deezerScore(
  track: DeezerTrack,
  input: PreviewLookup,
  position: number,
): number {
  const key = spotifyKey(track.title ?? "");
  const wanted = spotifyKey(input.title);
  if (!key || !wanted) return 0;
  if (addsUnrequestedVariant(track.title ?? "", input.title)) return 0;
  const titleScore =
    key === wanted
      ? 100
      : tokenIncludes(key, wanted)
        ? 70
        : tokenIncludes(wanted, key)
          ? 50
          : 0;
  if (titleScore === 0) return 0;
  if (!artistMatches(track.artist?.name ?? "", input)) return 0;

  let score = titleScore + 35;
  const expectedSeconds = (input.durationMs ?? 0) / 1_000;
  if (
    expectedSeconds > 0 &&
    typeof track.duration === "number" &&
    track.duration > 0
  ) {
    const diff = Math.abs(track.duration - expectedSeconds);
    if (diff > 20) return 0;
    score += diff <= 3 ? 20 : diff <= 10 ? 10 : 0;
  }
  return score - position;
}

/**
 * Deezer's search is literal. A catalog title carrying "(Remastered 2011)" or
 * "(Radio Edit)" often only matches after version markers are stripped, so try
 * the plain title as a second query before falling back to iTunes/YouTube.
 */
function deezerQueries(input: PreviewLookup): string[] {
  const plainTitle = input.title
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const core = spotifyKey(input.title);
  const queries: string[] = [];
  if (input.artist) queries.push(`${input.artist} ${input.title}`);
  queries.push(input.title);
  if (core && core !== plainTitle) {
    if (input.artist) queries.push(`${input.artist} ${core}`);
    queries.push(core);
  }
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
}

async function deezerPreview(
  input: PreviewLookup,
): Promise<PreviewPlaybackSource | null> {
  if (!input.title || !input.artist) return null;
  const seen = new Set<string>();
  const scored: Array<{ track: DeezerTrack; score: number }> = [];
  let position = 0;

  for (const query of deezerQueries(input).slice(0, 3)) {
    const payload = await fetchJson<DeezerSearch>(
      `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=25`,
    );
    for (const track of payload?.data ?? []) {
      position += 1;
      const preview = https(track.preview);
      if (!preview) continue;
      const identity = track.id
        ? String(track.id)
        : `${spotifyKey(track.title ?? "")}|${spotifyKey(track.artist?.name ?? "")}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const score = deezerScore(track, input, position);
      if (score > 0) scored.push({ track, score });
    }
    // An exact title + artist hit cannot be beaten by a broader query.
    if (scored.some((item) => item.score >= 135)) break;
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const preview = https(best?.track.preview);
  if (!best || !preview) return null;
  return {
    url: preview,
    source: "deezer",
    kind: "preview",
    expiresAt: Date.now() + PREVIEW_TTL_MS,
  };
}

interface ItunesTrack {
  trackName?: string;
  artistName?: string;
  trackTimeMillis?: number;
  previewUrl?: string;
}

interface ItunesSearch {
  results?: ItunesTrack[];
}

async function itunesPreview(
  input: PreviewLookup,
): Promise<PreviewPlaybackSource | null> {
  if (!input.title || !input.artist) return null;
  const query = encodeURIComponent(`${input.artist} ${input.title}`);
  const payload = await fetchJson<ItunesSearch>(
    `https://itunes.apple.com/search?term=${query}&entity=song&limit=10`,
  );
  for (const track of payload?.results ?? []) {
    const preview = https(track.previewUrl);
    if (!preview) continue;
    if (!titleMatches(track.trackName ?? "", input)) continue;
    if (!artistMatches(track.artistName ?? "", input)) continue;
    if (!durationMatches(track.trackTimeMillis, input)) continue;
    return {
      url: preview,
      source: "itunes",
      kind: "preview",
      expiresAt: Date.now() + PREVIEW_TTL_MS,
    };
  }
  return null;
}

/**
 * Resolve a 30-second preview. Spotify embed first, then Deezer, then iTunes.
 * Every fallback is validated against the requested title and artist.
 */
export async function resolvePreviewTrack(
  input: PreviewLookup,
): Promise<PreviewPlaybackSource | null> {
  const key = cacheKey(input);
  const cached = readCache(previewCache, key);
  if (cached) return cached.result;

  let result: PreviewPlaybackSource | null = null;
  for (const resolver of [
    spotifyEmbedPreview,
    deezerPreview,
    itunesPreview,
  ]) {
    try {
      result = await resolver(input);
    } catch {
      result = null;
    }
    if (result) break;
  }

  remember(
    previewCache,
    key,
    result,
    result ? PREVIEW_TTL_MS : NEGATIVE_TTL_MS,
  );
  return result;
}

async function ytDlpDirectUrl(
  target: string,
  extraArgs: string[] = [],
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      process.env.YT_DLP_PATH?.trim() || "yt-dlp",
      [
        "-f",
        // Only progressive HTTPS audio. HLS formats are `m3u8_native` and
        // manifest.googlevideo.com URLs have no CORS headers, so the renderer
        // cannot play them. A broad `bestaudio/best` fallback silently selects
        // HLS when a client returns no progressive format; that URL then fails
        // a probe and wastes a whole extraction retry. Fail fast instead and
        // let the caller try another client/candidate.
        "bestaudio[protocol=https]/bestaudio[protocol=http]",
        "-g",
        "--no-playlist",
        "--no-warnings",
        "--no-progress",
        ...extraArgs,
        target,
      ],
      {
        timeout: YT_DLP_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8",
      },
    );
    const url = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => Boolean(directHttps(line)));
    return url ? directHttps(url) : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      throw new Error(
        "yt-dlp is not installed. Install it to use full-stream previews.",
      );
    }
    return null;
  }
}

/** Media probes must not reject a valid source over a plain HTML error page. */
function isMediaType(type: string): boolean {
  return !type || type.startsWith("audio/") || type.startsWith("video/");
}

/** A transient CDN hiccup is not a broken URL; retry the range once. */
async function probeRange(
  url: string,
  range: string,
): Promise<{ ok: boolean; type: string; total: number } | null> {
  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
    const probe = await probeMediaRange(url, range, PROBE_TIMEOUT_MS);
    if (probe) return probe;
  }
  return null;
}

/**
 * Some yt-dlp URLs answer the first range request and then return 403 for the
 * rest of the file. Chromium reports that as `MEDIA_ELEMENT_ERROR: Format
 * error`, so probe both the head and the tail before handing a URL to the
 * player. A throttled URL must fall through to the next candidate.
 */
async function playableMediaUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  const head = await probeRange(url, "bytes=0-1023");
  if (!head?.ok || !isMediaType(head.type)) return null;
  if (!Number.isFinite(head.total) || head.total <= 0) return url;

  const start = Math.max(0, head.total - 65_536);
  const tail = await probeRange(url, `bytes=${start}-${head.total - 1}`);
  if (!tail?.ok || !isMediaType(tail.type)) return null;
  return url;
}

interface YtSearchEntry {
  id?: string;
  title?: string;
  duration?: number;
  url?: string;
  uploader?: string;
  channel?: string;
}

/** YouTube auto-generates "<artist> - Topic" channels for label uploads. */
function topicArtist(entry: YtSearchEntry): string {
  const channel = entry.channel ?? entry.uploader ?? "";
  return /\s*-\s*topic\s*$/i.test(channel)
    ? channel.replace(/\s*-\s*topic\s*$/i, "").trim()
    : "";
}

function tokenIncludes(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  return haystack === needle || ` ${haystack} `.includes(` ${needle} `);
}

/**
 * A stream must not silently become an instrumental, slowed or live version.
 * Variant words are allowed only when the requested title already asks for one.
 */
const VARIANT_TOKENS = [
  "instrumental",
  "slowed",
  "reverb",
  "nightcore",
  "sped up",
  "speed up",
  "remix",
  "cover",
  "karaoke",
  "live",
  "concert",
  "8d",
  "bass boosted",
  "mashup",
  "acapella",
  "a cappella",
  "demo",
];

function addsUnrequestedVariant(candidateText: string, wantedText: string): boolean {
  // spotifyKey strips "(Live)"/"(Instrumental)" as version tags, so variant
  // detection needs the raw title. Otherwise the variant filter never sees the
  // very words it is supposed to reject.
  const candidateKey = variantKey(candidateText);
  const wantedKey = variantKey(wantedText);
  const paddedCandidate = ` ${candidateKey} `;
  const paddedWanted = ` ${wantedKey} `;
  return VARIANT_TOKENS.some(
    (token) =>
      paddedCandidate.includes(` ${token} `) &&
      !paddedWanted.includes(` ${token} `),
  );
}

/** Lowercase/punctuation-fold a raw title without stripping version tags. */
function variantKey(value: string): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/gi, "е")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function ytDlpSearchEntries(
  query: string,
  prefix = "ytsearch6",
): Promise<YtSearchEntry[]> {
  try {
    const { stdout } = await execFileAsync(
      process.env.YT_DLP_PATH?.trim() || "yt-dlp",
      [
        "-J",
        "--flat-playlist",
        "--no-warnings",
        `${prefix}:${query}`,
      ],
      {
        timeout: YT_DLP_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8",
      },
    );
    const payload = JSON.parse(stdout) as { entries?: YtSearchEntry[] };
    return Array.isArray(payload.entries) ? payload.entries : [];
  } catch {
    return [];
  }
}

/**
 * Rank search results instead of trusting the first hit. Flat search metadata
 * carries the channel, so the artist can be matched there even when the video
 * title is just the song name. Duration breaks ties between versions. Playback
 * validation can reject the top candidate, so keep the whole ranked list for
 * retries.
 */
function rankYoutubeEntries(
  entries: YtSearchEntry[],
  input: PreviewLookup,
): YtSearchEntry[] {
  const wanted = spotifyKey(input.title);
  const expectedSeconds = (input.durationMs ?? 0) / 1_000;
  const scored: Array<{ entry: YtSearchEntry; score: number }> = [];

  entries.forEach((entry, position) => {
    const title = entry.title ?? "";
    if (!title || !wanted) return;
    const key = spotifyKey(title);
    if (addsUnrequestedVariant(title, input.title)) return;
    const titleScore =
      key === wanted
        ? 100
        : tokenIncludes(key, wanted)
          ? 70
          : tokenIncludes(wanted, key)
            ? 50
            : 0;
    if (titleScore === 0) return;

    let score = titleScore;
    const topic = topicArtist(entry);
    if (artistMatches(title, input) || artistMatches(topic, input)) {
      score += 35;
    }
    // An official "Artist - Topic" upload is the label master, not a repost.
    if (topic && artistMatches(topic, input)) score += 15;
    if (
      expectedSeconds > 0 &&
      typeof entry.duration === "number" &&
      entry.duration > 0
    ) {
      const diff = Math.abs(entry.duration - expectedSeconds);
      // A full album, live set or unrelated video is not a usable full track.
      if (diff > 90) return;
      score += diff <= 5 ? 45 : diff <= 20 ? 30 : diff <= 60 ? 5 : 0;
    }
    score -= position * 2;
    scored.push({ entry, score });
  });

  scored.sort((a, b) => b.score - a.score);
  const ranked: YtSearchEntry[] = [];
  const seen = new Set<string>();
  for (const { entry } of scored) {
    const id = entry.id ?? entry.url ?? "";
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    ranked.push(entry);
  }

  if (ranked.length === 0) {
    // The fallback rescues results whose title is too noisy to score, but it
    // must still refuse live/instrumental edits the caller did not ask for.
    const fallback = entries.find(
      (entry) => !addsUnrequestedVariant(entry.title ?? "", input.title),
    );
    if (!fallback) return ranked;
    if (
      expectedSeconds > 0 &&
      typeof fallback.duration === "number" &&
      fallback.duration > 0 &&
      Math.abs(fallback.duration - expectedSeconds) > 20
    ) {
      return ranked;
    }
    ranked.push(fallback);
  }
  return ranked;
}

/**
 * Resolve and validate candidates in rank order. yt-dlp can hand out a URL
 * that serves the first ranges and then answers 403 near the end;
 * `playableMediaUrl` rejects it and the next result is tried. Distinct search
 * results are tried before repeating one: an extraction costs ~4-5 s, and a
 * second upload is usually a better bet than re-extracting the same video.
 */
async function playableCandidateUrl(
  entries: YtSearchEntry[],
  extraArgs: string[],
  limit = 3,
): Promise<string | null> {
  const targets = entries
    .slice(0, limit)
    .map(entryTarget)
    .filter((target): target is string => Boolean(target));

  for (const target of targets) {
    const playable = await playableMediaUrl(
      await ytDlpDirectUrl(target, extraArgs),
    );
    if (playable) return playable;
  }

  // One second chance for the best-ranked result. YouTube intermittently
  // returns an HLS-only player response; a fresh extraction can flip it back
  // to progressive audio.
  const first = targets[0];
  if (!first) return null;
  return playableMediaUrl(await ytDlpDirectUrl(first, extraArgs));
}

/**
 * SoundCloud exposes 30-second previews for some tracks. A "full stream" must
 * not silently become one of those, so reject candidates whose duration is far
 * from the catalog track.
 */
function rankSoundcloudEntries(
  entries: YtSearchEntry[],
  input: PreviewLookup,
): YtSearchEntry[] {
  const wanted = spotifyKey(input.title);
  const expectedSeconds = (input.durationMs ?? 0) / 1_000;
  const scored: Array<{ entry: YtSearchEntry; score: number }> = [];

  entries.forEach((entry, position) => {
    const title = entry.title ?? "";
    if (!title || !wanted) return;
    const key = spotifyKey(title);
    if (addsUnrequestedVariant(title, input.title)) return;
    const titleScore =
      key === wanted
        ? 100
        : tokenIncludes(key, wanted)
          ? 70
          : tokenIncludes(wanted, key)
            ? 50
            : 0;
    if (titleScore === 0) return;
    if (
      expectedSeconds > 0 &&
      typeof entry.duration === "number" &&
      entry.duration > 0 &&
      Math.abs(entry.duration - expectedSeconds) > 30
    ) {
      return;
    }

    let score = titleScore;
    if (artistMatches(entry.uploader ?? title, input)) score += 35;
    if (
      expectedSeconds > 0 &&
      typeof entry.duration === "number" &&
      entry.duration > 0
    ) {
      const diff = Math.abs(entry.duration - expectedSeconds);
      score += diff <= 5 ? 45 : diff <= 15 ? 30 : 5;
    }
    score -= position * 2;
    scored.push({ entry, score });
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ entry }) => entry);
}

function entryTarget(entry: YtSearchEntry | null): string | null {
  if (!entry) return null;
  if (entry.url?.startsWith("https://")) return entry.url;
  if (entry.id) return `https://www.youtube.com/watch?v=${entry.id}`;
  return null;
}

/**
 * Direct full-track stream through yt-dlp. Only the resolved URL is returned:
 * no media file is written to disk.
 */
export async function resolveFullStream(
  input: PreviewLookup,
): Promise<PreviewPlaybackSource> {
  const key = `stream\u0000${cacheKey(input)}`;
  const cached = input.force ? null : readCache(streamCache, key);
  if (cached?.result) return cached.result;

  if (!input.title || !input.artist) {
    throw new Error("A title and artist are required for full streaming.");
  }

  const query = `${input.artist} ${input.title}`;
  const youtubeArgs = [
    // web_embedded is the only client that currently returns progressive
    // audio URLs the renderer can play. android/android_vr/mweb hand out URLs
    // that answer 403, and the default web client does too. A multi-client
    // list also takes ~1 s longer because yt-dlp fetches every player response.
    "--extractor-args",
    "youtube:player_client=web_embedded",
  ];
  const entries = await ytDlpSearchEntries(query);
  const youtubeUrl = await playableCandidateUrl(
    rankYoutubeEntries(entries, input),
    youtubeArgs,
    3,
  );

  if (youtubeUrl) {
    const result: PreviewPlaybackSource = {
      url: youtubeUrl,
      source: "youtube",
      kind: "full",
      expiresAt: Date.now() + STREAM_TTL_MS,
    };
    remember(streamCache, key, result, STREAM_TTL_MS);
    return result;
  }

  const soundcloudEntries = await ytDlpSearchEntries(query, "scsearch5");
  const soundcloudUrl = await playableCandidateUrl(
    rankSoundcloudEntries(soundcloudEntries, input),
    [],
    1,
  );
  if (soundcloudUrl) {
    const result: PreviewPlaybackSource = {
      url: soundcloudUrl,
      source: "soundcloud",
      kind: "full",
      expiresAt: Date.now() + SOUNDCLOUD_STREAM_TTL_MS,
    };
    remember(streamCache, key, result, SOUNDCLOUD_STREAM_TTL_MS);
    return result;
  }

  throw new Error(
    "Full stream is unavailable: yt-dlp could not find a playable source.",
  );
}

/**
 * Internals exercised by `scripts/test-youtube.cjs`. Kept in one object so the
 * production surface stays limited to `resolveFullStream`.
 */
export const previewTestUtils = {
  rankYoutubeEntries,
  rankSoundcloudEntries,
  addsUnrequestedVariant,
  directHttps,
  probeMediaRange,
};
