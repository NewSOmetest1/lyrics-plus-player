import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { BrowserWindow, session } from "electron";
import { parseFile } from "music-metadata";

import * as spotifyAuth from "./spotify-auth.cjs";
import type { LibraryStore } from "./store";
import type { CachedLyrics, LyricsPayload, TrackRecord } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const LRC_PATTERN = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/;

type ProviderId = "lrclib" | "spotify" | "musixmatch" | "embedded";

interface ProviderSetting {
  id: ProviderId;
  enabled: boolean;
}

const DEFAULT_PROVIDERS: ProviderSetting[] = [
  { id: "lrclib", enabled: true },
  { id: "spotify", enabled: false },
  { id: "musixmatch", enabled: false },
  { id: "embedded", enabled: true },
];

function isSynced(content: string): boolean {
  return LRC_PATTERN.test(content);
}

function buildPayload(
  trackId: number,
  source: string,
  content: string,
  instrumental = false,
): LyricsPayload {
  return {
    trackId,
    source,
    synced: !instrumental && isSynced(content),
    content,
    lineCount: instrumental
      ? 0
      : content.split("\n").filter((line) => line.trim().length > 0).length,
    instrumental,
  };
}

function cache(store: LibraryStore, track: TrackRecord, source: string, content: string): void {
  const entry: CachedLyrics = {
    source,
    synced: isSynced(content),
    content,
    fetchedAt: Date.now(),
  };
  const existing = store.getLyrics(track.id).filter((item) => item.source !== source);
  store.setLyrics(track.id, [entry, ...existing]);
}

function sidecarPath(filePath: string): string {
  return path.join(
    path.dirname(filePath),
    `${path.basename(filePath, path.extname(filePath))}.lrc`,
  );
}

function parseProviders(store: LibraryStore): ProviderSetting[] {
  const raw = store.getSetting("lyrics_providers");
  if (!raw) return DEFAULT_PROVIDERS;
  try {
    const parsed = JSON.parse(raw) as ProviderSetting[];
    if (!Array.isArray(parsed)) return DEFAULT_PROVIDERS;
    const known = new Set(DEFAULT_PROVIDERS.map((provider) => provider.id));
    const valid = parsed
      .filter((item) => item && known.has(item.id))
      .map((item) => ({ id: item.id, enabled: Boolean(item.enabled) }));
    const seen = new Set(valid.map((item) => item.id));
    for (const fallback of DEFAULT_PROVIDERS) {
      if (!seen.has(fallback.id)) valid.push({ ...fallback });
    }
    return valid;
  } catch {
    return DEFAULT_PROVIDERS;
  }
}

function syncedTagToLrc(syncText: Array<{ text: string; timestamp?: number }>): string | null {
  const lines = syncText
    .filter((line) => line.text.trim().length > 0)
    .map((line) => {
      const ms = Math.max(0, line.timestamp ?? 0);
      const minutes = Math.floor(ms / 60_000);
      const seconds = Math.floor((ms % 60_000) / 1000);
      const centis = Math.floor((ms % 1000) / 10);
      return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}] ${line.text.trim()}`;
    });
  return lines.length > 0 ? lines.join("\n") : null;
}

async function embeddedLyrics(filePath: string): Promise<string | null> {
  try {
    const metadata = await parseFile(filePath, { duration: false, skipCovers: true });
    const tags = metadata.common.lyrics ?? [];
    for (const tag of tags) {
      const synced = syncedTagToLrc(tag.syncText ?? []);
      if (synced) return synced;
      if (tag.text?.trim()) return tag.text.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------- */
/* Track-name normalization (ported from Spicetify Lyrics Plus)               */
/* ------------------------------------------------------------------------- */

export interface CleanTrack {
  title: string;
  artist: string;
}

const FEAT_PATTERN = /\s*[([{]\s*(?:feat|ft|featuring|with)\.?\s+[^)\]}]*[)\]}]/gi;
const TRAILING_FEAT_PATTERN = /\s+(?:feat|ft|featuring)\.?\s+.*$/gi;
const VERSION_PATTERN =
  /\s*[([{]\s*(?:remaster(?:ed)?|remastered\s+\d{4}|live(?:\s+at\s+[^)\]}]*)?|official(?:\s+[^)\]}]*)?|bonus(?:\s+track)?|deluxe(?:\s+edition)?|explicit|clean|mono|stereo|radio\s+edit|extended(?:\s+mix)?|acoustic|instrumental)[^)\]}]*[)\]}]/gi;
const DASH_VERSION_PATTERN =
  /\s+-\s+(?:remaster(?:ed)?(?:\s+\d{4})?|live(?:\s+.*)?|official(?:\s+.*)?|bonus\s+track|radio\s+edit|extended\s+mix|acoustic(?:\s+version)?|instrumental(?:\s+version)?)\s*$/i;

/**
 * Cleans a track title / artist for provider search.
 * Removes features, version tags and excess punctuation while keeping the
 * meaningful words. Returns both cleaned values because artists can carry the
 * same noise (e.g. "Artist feat. Other").
 */
export function cleanTrackTitle(title: string, artist = ""): CleanTrack {
  const clean = (value: string): string =>
    value
      .replace(FEAT_PATTERN, " ")
      .replace(TRAILING_FEAT_PATTERN, " ")
      .replace(VERSION_PATTERN, " ")
      .replace(DASH_VERSION_PATTERN, " ")
      .replace(/[“”"'`´]/g, "")
      .replace(/[^\p{L}\p{N}\s&'-]/gu, " ")
      .replace(/\s*-\s*$/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .replace(/^[-,.]+|[-,.]+$/g, "")
      .trim();

  return {
    title: clean(title) || title.trim(),
    artist: clean(artist),
  };
}

export function normalizeForMatch(value: string): string {
  return cleanTrackTitle(value)
    .title.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tracksMatch(expectedTitle: string, expectedArtist: string, actualTitle: string, actualArtist: string): boolean {
  const title = normalizeForMatch(expectedTitle);
  const actual = normalizeForMatch(actualTitle);
  if (!title || !actual) return false;
  const titleOk = actual === title || actual.includes(title) || title.includes(actual);
  if (!titleOk) return false;
  const artist = normalizeForMatch(expectedArtist);
  const actualArt = normalizeForMatch(actualArtist);
  if (!artist || !actualArt) return true;
  return (
    actualArt === artist ||
    actualArt.includes(artist) ||
    artist.includes(actualArt) ||
    actualArt.split(" ").some((part) => part.length > 2 && artist.includes(part))
  );
}

/* ------------------------------------------------------------------------- */
/* LRCLIB — three-step search with duration matching                          */
/* ------------------------------------------------------------------------- */

interface LrclibRecord {
  trackName?: string;
  artistName?: string;
  duration?: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

const LRCLIB_HEADERS = { "User-Agent": USER_AGENT, Accept: "application/json" };
const LRCLIB_TIMEOUT = 9_000;

function trackDurationSeconds(track: TrackRecord): number | null {
  const seconds = Math.round((track.durationMs ?? 0) / 1000);
  return seconds > 0 ? seconds : null;
}

async function lrclibGet(params: Record<string, string>): Promise<LrclibRecord | null> {
  const query = new URLSearchParams(params);
  const response = await fetch(`https://lrclib.net/api/get?${query.toString()}`, {
    headers: LRCLIB_HEADERS,
    signal: AbortSignal.timeout(LRCLIB_TIMEOUT),
  });
  if (!response.ok) return null;
  return (await response.json()) as LrclibRecord;
}

function lrclibRecordToResult(
  record: LrclibRecord | null,
): { content: string; instrumental: boolean } | null {
  if (!record) return null;
  if (record.instrumental) return { content: "", instrumental: true };
  const synced = record.syncedLyrics?.trim();
  if (synced) return { content: synced, instrumental: false };
  const plain = record.plainLyrics?.trim();
  if (plain) return { content: plain, instrumental: false };
  return null;
}

async function fetchLrclib(
  track: TrackRecord,
): Promise<{ content: string; instrumental: boolean } | null> {
  const cleaned = cleanTrackTitle(track.title, track.artist);
  const duration = trackDurationSeconds(track);

  try {
    // Step 1: exact metadata match, including duration.
    if (duration !== null) {
      const exact = await lrclibGet({
        artist_name: track.artist || cleaned.artist,
        track_name: track.title,
        duration: String(duration),
      });
      const result = lrclibRecordToResult(exact);
      if (result) return result;
    }

    // Step 2: same request without duration, using cleaned names.
    const loose = await lrclibGet({
      artist_name: cleaned.artist || track.artist,
      track_name: cleaned.title,
    });
    const looseResult = lrclibRecordToResult(loose);
    if (looseResult) return looseResult;

    // Step 3: full-text search, pick closest duration with synced lyrics.
    const query = new URLSearchParams({
      q: [cleaned.artist, cleaned.title].filter(Boolean).join(" "),
    });
    const searchResponse = await fetch(
      `https://lrclib.net/api/search?${query.toString()}`,
      { headers: LRCLIB_HEADERS, signal: AbortSignal.timeout(LRCLIB_TIMEOUT) },
    );
    if (!searchResponse.ok) return null;
    const records = (await searchResponse.json()) as LrclibRecord[];
    if (!Array.isArray(records) || records.length === 0) return null;

    const withLyrics = records.filter(
      (record) => record.syncedLyrics?.trim() || record.plainLyrics?.trim(),
    );
    const candidate =
      duration === null
        ? withLyrics.find((record) => record.syncedLyrics?.trim()) ?? withLyrics[0]
        : [...withLyrics]
            .filter((record) =>
              Number.isFinite(record.duration)
                ? Math.abs((record.duration ?? 0) - duration) <= 5
                : false,
            )
            .sort(
              (a, b) =>
                Math.abs((a.duration ?? 0) - duration) - Math.abs((b.duration ?? 0) - duration),
            )
            .find((record) => record.syncedLyrics?.trim()) ??
          withLyrics
            .filter((record) => record.syncedLyrics?.trim())
            .sort(
              (a, b) =>
                Math.abs((a.duration ?? 0) - duration) - Math.abs((b.duration ?? 0) - duration),
            )[0] ??
          withLyrics[0];

    return lrclibRecordToResult(candidate ?? null);
  } catch (error) {
    console.warn("[lyrics] LRCLIB failed:", error);
    return null;
  }
}

function spotifyToLrc(
  lines: Array<{ startTimeMs?: string | number; words?: string }>,
): string | null {
  const converted = lines
    .map((line) => {
      const ms = Number(line.startTimeMs ?? 0);
      const text = (line.words ?? "").trim();
      if (!text) return null;
      const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
      const minutes = Math.floor(safe / 60_000);
      const seconds = Math.floor((safe % 60_000) / 1000);
      const centis = Math.floor((safe % 1000) / 10);
      return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}] ${text}`;
    })
    .filter((line): line is string => Boolean(line));
  return converted.length > 0 ? converted.join("\n") : null;
}

interface SpotifyTokenResult {
  token: string | null;
  status: number | null;
  message?: string;
}

function spotifyAccessToken(
  spDc: string,
  spKey: string,
  force = false,
): Promise<SpotifyTokenResult> {
  // Token is captured by a hidden BrowserWindow: the plain HTTP endpoint is
  // protected by Cloudflare/TOTP and returns 403 for ordinary fetch calls.
  return spotifyAuth.getSpotifyAccessToken(
    { BrowserWindow, session },
    spDc,
    spKey,
    force,
  );
}

function spotifyCookieHeader(spDc: string, spKey: string): string {
  return spotifyAuth.cookieHeader(spDc, spKey);
}

function spotifyStatusMessage(status: number): string {
  switch (status) {
    case 401:
      return "401 Unauthorized — sp_dc/sp_key cookies are invalid or expired. Log in again.";
    case 403:
      return "403 Forbidden — expired cookie, region restriction, or Spotify Free account limit.";
    case 404:
      return "404 Not Found — Spotify has no lyrics for this track.";
    case 429:
      return "429 Too Many Requests — Spotify rate limit. Try again later.";
    default:
      return `Spotify request failed with HTTP ${status}`;
  }
}

const spotifyTrackIdCache = new Map<string, string>();
const spotifyTrackMissCache = new Map<string, number>();
const SPOTIFY_ID_CACHE_LIMIT = 500;
const SPOTIFY_MISS_TTL = 10 * 60 * 1000;
const SPOTIFY_ID_SETTING = "spotify_track_ids";
let spotifyIdCacheStore: LibraryStore | null = null;

function spotifyCacheKeyPart(value: string): string {
  return cleanTrackTitle(value)
    .title.toLocaleLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function spotifyTrackKey(title: string, artist: string): string {
  const cleaned = cleanTrackTitle(title, artist);
  return `${spotifyCacheKeyPart(cleaned.artist)}|${spotifyCacheKeyPart(cleaned.title)}`;
}

/**
 * `artist + title -> spotify id` is persisted in library.json. A track that was
 * resolved once never triggers another Spotify search, so rate limits cannot
 * break playback of an already-known track.
 */
function loadSpotifyIdCache(store: LibraryStore): void {
  if (spotifyIdCacheStore === store) return;
  spotifyIdCacheStore = store;
  spotifyTrackIdCache.clear();
  try {
    const raw = store.getSetting(SPOTIFY_ID_SETTING);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      const [, title] = key.split("|");
      if (!title?.trim()) continue;
      if (typeof value === "string" && value.trim()) {
        spotifyTrackIdCache.set(key, value.trim());
      }
    }
  } catch (error) {
    console.warn("[lyrics] could not read Spotify id cache:", error);
  }
}

function persistSpotifyIdCache(store: LibraryStore): void {
  try {
    store.setSetting(SPOTIFY_ID_SETTING, JSON.stringify(Object.fromEntries(spotifyTrackIdCache)));
  } catch (error) {
    console.warn("[lyrics] could not persist Spotify id cache:", error);
  }
}

function cacheSpotifyTrackId(store: LibraryStore, key: string, trackId: string): void {
  loadSpotifyIdCache(store);
  if (spotifyTrackIdCache.size >= SPOTIFY_ID_CACHE_LIMIT) {
    const oldest = spotifyTrackIdCache.keys().next().value;
    if (oldest !== undefined) spotifyTrackIdCache.delete(oldest);
  }
  spotifyTrackIdCache.set(key, trackId);
  spotifyTrackMissCache.delete(key);
  persistSpotifyIdCache(store);
}

function cacheSpotifyMiss(key: string): void {
  if (spotifyTrackMissCache.size >= SPOTIFY_ID_CACHE_LIMIT) {
    const oldest = spotifyTrackMissCache.keys().next().value;
    if (oldest !== undefined) spotifyTrackMissCache.delete(oldest);
  }
  spotifyTrackMissCache.set(key, Date.now() + SPOTIFY_MISS_TTL);
}

interface SpotifySearchTrack {
  id?: string;
  name?: string;
  duration_ms?: number;
  artists?: Array<{ name?: string }>;
}

interface SpotifySearchResult {
  id: string | null;
  failed: boolean;
  status?: number;
}

async function spotifySearchTrackId(
  token: string,
  spDc: string,
  spKey: string,
  query: string,
  limit: number,
  durationMs: number,
): Promise<SpotifySearchResult> {
  const url = `https://api.spotify.com/v1/search?${new URLSearchParams({
    q: query,
    type: "track",
    limit: String(limit),
  })}`;
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Cookie: spotifyCookieHeader(spDc, spKey),
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      console.warn(
        `[lyrics] Spotify search failed for "${query}":`,
        error instanceof Error ? error.message : String(error),
      );
      return { id: null, failed: true };
    }

    if (response.status !== 429 || attempt > 0) break;

    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1_200;
    if (waitMs > 3_000) {
      // Long rate limits are handled by the web-player fallback instead of
      // freezing playback for the whole Retry-After window.
      console.warn(
        `[lyrics] Spotify 429 for "${query}" (retry-after ${retryAfter || "unknown"}s), using fallback`,
      );
      break;
    }
    console.warn(`[lyrics] Spotify 429 for "${query}", retrying in ${waitMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  if (!response?.ok) {
    const status = response?.status ?? null;
    console.warn(`[lyrics] Spotify search HTTP ${status ?? "network error"} for "${query}"`);
    return { id: null, failed: true, status: status ?? undefined };
  }

  const payload = (await response.json()) as {
    tracks?: { items?: SpotifySearchTrack[] };
  };
  const items = (payload.tracks?.items ?? []).filter(
    (item): item is SpotifySearchTrack & { id: string } => Boolean(item?.id),
  );
  if (items.length === 0) return { id: null, failed: false };

  const knownDuration = durationMs > 0;
  const scored = items.map((item) => ({
    item,
    diff:
      knownDuration && typeof item.duration_ms === "number"
        ? Math.abs(item.duration_ms - durationMs)
        : null,
  }));

  const within = scored.filter(({ diff }) => diff !== null && diff <= 10_000);
  if (within.length > 0) {
    within.sort((a, b) => (a.diff ?? 0) - (b.diff ?? 0));
    return { id: within[0].item.id, failed: false };
  }

  // Without a usable duration, trust the best search result.
  if (!knownDuration || scored.every(({ diff }) => diff === null)) {
    return { id: scored[0]?.item.id ?? null, failed: false };
  }

  return { id: null, failed: false };
}

function pickWebSpotifyTrackId(
  rows: spotifyAuth.SpotifyWebTrack[],
  track: TrackRecord,
): string | null {
  if (rows.length === 0) return null;
  const cleaned = cleanTrackTitle(track.title, track.artist);
  const artist = cleaned.artist || track.artist;
  const matching = rows.filter((row) =>
    tracksMatch(cleaned.title, artist, row.title, row.artist),
  );
  return (matching[0] ?? rows[0])?.id ?? null;
}

async function spotifyWebSearchTrackId(
  spDc: string,
  spKey: string,
  query: string,
  track: TrackRecord,
): Promise<string | null> {
  if (!spDc || !spKey) return null;
  try {
    const rows = await spotifyAuth.searchSpotifyTracksViaWeb(
      { BrowserWindow, session },
      spDc,
      spKey,
      query,
    );
    return pickWebSpotifyTrackId(rows, track);
  } catch (error) {
    console.warn(
      "[lyrics] Spotify web search failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

async function resolveSpotifyTrackId(
  token: string,
  spDc: string,
  spKey: string,
  track: TrackRecord,
  store: LibraryStore,
): Promise<string | null> {
  const direct = track.spotifyTrackId?.trim();
  if (direct) return direct;

  const key = spotifyTrackKey(track.title, track.artist);
  loadSpotifyIdCache(store);
  const cached = spotifyTrackIdCache.get(key);
  if (cached) return cached;
  const missUntil = spotifyTrackMissCache.get(key);
  if (missUntil && Date.now() < missUntil) return null;

  const cleaned = cleanTrackTitle(track.title, track.artist);
  const artist = cleaned.artist || track.artist;
  const exactQuery = `track:${cleaned.title} artist:${artist}`;
  const looseQuery = `${artist} ${cleaned.title}`;

  // Exact field search first, then the same query through the web player.
  // The public API can return 429 for web-player tokens while the web
  // player's own partner API keeps working.
  let result = await spotifySearchTrackId(
    token,
    spDc,
    spKey,
    exactQuery,
    3,
    track.durationMs,
  );
  let trackId = result.id;
  if (!trackId) {
    trackId = await spotifyWebSearchTrackId(spDc, spKey, exactQuery, track);
  }

  // Fallback to a loose free-text search.
  if (!trackId) {
    result = await spotifySearchTrackId(
      token,
      spDc,
      spKey,
      looseQuery,
      5,
      track.durationMs,
    );
    trackId = result.id;
    if (!trackId) {
      trackId = await spotifyWebSearchTrackId(spDc, spKey, looseQuery, track);
    }
  }

  if (trackId) {
    cacheSpotifyTrackId(store, key, trackId);
    console.info(`[lyrics] Spotify match: ${artist} — ${cleaned.title} -> ${trackId}`);
  } else {
    cacheSpotifyMiss(key);
    console.info(`[lyrics] Spotify match not found: ${artist} — ${cleaned.title}`);
  }
  return trackId;
}

async function fetchSpotify(
  track: TrackRecord,
  spDc: string,
  spKey: string,
  store: LibraryStore,
): Promise<string | null> {
  if (!spDc || !spKey) return null;
  const auth = await spotifyAccessToken(spDc, spKey);
  if (!auth.token) return null;
  const token = auth.token;

  try {
    const trackId = await resolveSpotifyTrackId(token, spDc, spKey, track, store);
    if (!trackId) return null;

    const lyricsResponse = await fetch(
      `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&vocalRemoval=false&market=from_token`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Cookie: spotifyCookieHeader(spDc, spKey),
          "User-Agent": USER_AGENT,
          "app-platform": "WebPlayer",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(9_000),
      },
    );
    if (!lyricsResponse.ok) return null;
    const payload = (await lyricsResponse.json()) as {
      lyrics?: {
        syncType?: string;
        lines?: Array<{ startTimeMs?: string | number; words?: string }>;
      };
    };
    const lines = payload.lyrics?.lines ?? [];
    if (payload.lyrics?.syncType === "UNSYNCED") {
      const plain = lines
        .map((line) => (line.words ?? "").trim())
        .filter(Boolean)
        .join("\n");
      return plain || null;
    }
    return spotifyToLrc(lines);
  } catch (error) {
    console.warn("[lyrics] Spotify failed:", error);
    return null;
  }
}

/* ------------------------------------------------------------------------- */
/* Musixmatch — autonomous app-mobile client (Spicetify-compatible)           */
/* ------------------------------------------------------------------------- */

const MUSIXMATCH_BASE = "https://apic-appmobile.musixmatch.com/ws/1.1";
const MUSIXMATCH_APP_ID = "mac-ios-v2.0";
const MUSIXMATCH_HEADERS: Record<string, string> = {
  Host: "apic-appmobile.musixmatch.com",
  "X-Cookie": "x-mxm-token-guid=",
  "x-mxm-app-version": "10.1.1",
  "X-User-Agent":
    "Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive",
  Accept: "application/json",
};

let cachedMusixmatchToken: string | null = null;

async function musixmatchUserToken(force = false): Promise<string | null> {
  if (!force && cachedMusixmatchToken) return cachedMusixmatchToken;
  try {
    const response = await fetch(
      `${MUSIXMATCH_BASE}/token.get?app_id=${MUSIXMATCH_APP_ID}`,
      { headers: MUSIXMATCH_HEADERS, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) {
      console.warn("[lyrics] Musixmatch token HTTP", response.status);
      return null;
    }
    const payload = (await response.json()) as {
      message?: {
        header?: { status_code?: number; hint?: string };
        body?: { user_token?: string };
      };
    };
    const token = payload.message?.body?.user_token?.trim();
    if (!token) {
      const header = payload.message?.header;
      console.warn(
        "[lyrics] Musixmatch token unavailable",
        header?.status_code ?? "unknown",
        header?.hint ?? "",
      );
      return null;
    }
    cachedMusixmatchToken = token;
    return token;
  } catch (error) {
    console.warn("[lyrics] Musixmatch token failed:", error);
    return null;
  }
}

function formatLrcTime(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const centis = Math.floor((safe * 100) % 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

interface MusixmatchAttempt {
  content: string | null;
  status: number | null;
  code: number | null;
  message?: string;
  wordLevel?: boolean;
}

interface MusixmatchSubtitleBody {
  text?: string;
  time?: { total?: number };
}

interface MusixmatchRichsyncLine {
  ts?: number;
  te?: number;
  l?: Array<{ c?: string; o?: number }>;
}

interface MusixmatchMacroCall {
  message?: {
    header?: { status_code?: number };
    body?: {
      track?: {
        track_name?: string;
        artist_name?: string;
        instrumental?: number;
        has_subtitles?: number;
        has_richsync?: number;
      };
      subtitle?: { subtitle_body?: string };
      subtitle_list?: Array<{ subtitle?: { subtitle_body?: string } }>;
      richsync?: { richsync_body?: string };
    };
  };
}

function musixmatchSubtitleToLrc(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as MusixmatchSubtitleBody[];
    if (!Array.isArray(parsed)) return null;
    const lines = parsed
      .filter((line) => typeof line?.time?.total === "number")
      .map((line) => `[${formatLrcTime(line.time?.total ?? 0)}]${(line.text ?? "").trim()}`);
    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

/**
 * Richsync carries per-word offsets. Convert it to enhanced LRC so the
 * renderer's karaoke sweep uses the real word timings.
 */
function musixmatchRichsyncToLrc(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as MusixmatchRichsyncLine[];
    if (!Array.isArray(parsed)) return null;
    const lines: string[] = [];
    for (const line of parsed) {
      const start = Number(line.ts ?? 0);
      const words = (line.l ?? []).filter((word) => word && typeof word.c === "string");
      if (words.length === 0) continue;
      const tags = words
        .map((word) => {
          const absolute = start + Number(word.o ?? 0);
          return `<${formatLrcTime(absolute)}>${word.c ?? ""}`;
        })
        .join("");
      lines.push(`[${formatLrcTime(start)}]${tags}`);
    }
    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

async function musixmatchSubtitle(
  track: TrackRecord,
  token: string,
): Promise<MusixmatchAttempt> {
  const cleaned = cleanTrackTitle(track.title, track.artist);
  const duration = trackDurationSeconds(track);
  const query = new URLSearchParams({
    format: "json",
    namespace: "lyrics_richsynched",
    subtitle_format: "mxm",
    app_id: MUSIXMATCH_APP_ID,
    q_track: cleaned.title,
    q_artist: cleaned.artist || track.artist,
    q_artists: cleaned.artist || track.artist,
    q_album: track.album,
    q_duration: String(duration ?? ""),
    f_subtitle_length: String(duration ?? ""),
    usertoken: token,
    optional_calls: "track.richsync",
    richsync_compact_type: "words",
  });

  try {
    const response = await fetch(
      `${MUSIXMATCH_BASE}/macro.subtitles.get?${query.toString()}`,
      { headers: MUSIXMATCH_HEADERS, signal: AbortSignal.timeout(12_000) },
    );
    if (!response.ok) {
      return {
        content: null,
        status: response.status,
        code: response.status,
        message: response.status === 401 ? "401 Unauthorized — token expired." : undefined,
      };
    }

    const payload = (await response.json()) as {
      message?: {
        header?: { status_code?: number };
        body?: {
          macro_calls?: Record<string, MusixmatchMacroCall>;
          macro_result?: {
            subtitles?: { subtitle_list?: Array<{ subtitle?: { subtitle_body?: string } }> };
          };
        };
      };
    };
    const code = payload.message?.header?.status_code ?? null;
    if (code === 401) {
      return { content: null, status: 401, code, message: "401 Unauthorized — token expired." };
    }

    const macro = payload.message?.body?.macro_calls ?? {};
    const matched = macro["matcher.track.get"]?.message?.body?.track;
    const subtitlesCall = macro["track.subtitles.get"]?.message?.body;
    const list =
      subtitlesCall?.subtitle_list ??
      payload.message?.body?.macro_result?.subtitles?.subtitle_list;
    const subtitleBody =
      list?.[0]?.subtitle?.subtitle_body?.trim() ||
      subtitlesCall?.subtitle?.subtitle_body?.trim() ||
      "";
    const richBody =
      macro["track.richsync.get"]?.message?.body?.richsync?.richsync_body?.trim() || "";

    if (matched?.track_name || matched?.artist_name) {
      const expectedTitle = cleaned.title || track.title;
      const expectedArtist = cleaned.artist || track.artist;
      if (
        !tracksMatch(
          expectedTitle,
          expectedArtist,
          matched.track_name ?? "",
          matched.artist_name ?? "",
        )
      ) {
        return {
          content: null,
          status: 404,
          code,
          message: `Musixmatch matched a different track (${matched.artist_name ?? "?"} — ${matched.track_name ?? "?"}).`,
        };
      }
    }

    if (matched?.instrumental) {
      return { content: null, status: 200, code, message: "Instrumental track" };
    }

    const richLrc = richBody ? musixmatchRichsyncToLrc(richBody) : null;
    if (richLrc) {
      return { content: richLrc, status: response.status, code, wordLevel: true };
    }

    const subtitleLrc = subtitleBody ? musixmatchSubtitleToLrc(subtitleBody) : null;
    if (subtitleLrc) {
      return { content: subtitleLrc, status: response.status, code, wordLevel: false };
    }

    return {
      content: null,
      status: 404,
      code,
      message:
        code === 200
          ? "Musixmatch has no subtitle for this track."
          : `Musixmatch returned status code ${code ?? "unknown"}.`,
    };
  } catch (error) {
    return {
      content: null,
      status: null,
      code: null,
      message: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export interface MusixmatchFetchResult {
  content: string | null;
  instrumental: boolean;
  status: number | null;
  code: number | null;
  message?: string;
  wordLevel?: boolean;
}

async function fetchMusixmatch(
  track: TrackRecord,
  store?: LibraryStore,
): Promise<MusixmatchFetchResult> {
  const storedToken =
    store?.getSetting("musixmatch_user_token")?.trim() ||
    store?.getSetting("musixmatch_token")?.trim() ||
    store?.getSetting("musixmatch_api_key")?.trim() ||
    process.env.MUSIXMATCH_API_KEY?.trim() ||
    null;
  let token = cachedMusixmatchToken || storedToken || (await musixmatchUserToken());
  if (!token) {
    return {
      content: null,
      instrumental: false,
      status: null,
      code: null,
      message: "Could not obtain an anonymous Musixmatch token.",
    };
  }

  let attempt = await musixmatchSubtitle(track, token);

  // Expired token: drop the cache, fetch a fresh one, retry exactly once.
  if (attempt.code === 401 || attempt.status === 401) {
    cachedMusixmatchToken = null;
    const refreshed = await musixmatchUserToken(true);
    if (refreshed) {
      token = refreshed;
      attempt = await musixmatchSubtitle(track, token);
    }
  }

  if (attempt.content) {
    cachedMusixmatchToken = token;
    try {
      store?.setSetting("musixmatch_user_token", token);
    } catch {
      // cache persistence is best-effort
    }
  }

  return {
    content: attempt.content,
    instrumental: attempt.message === "Instrumental track",
    status: attempt.status,
    code: attempt.code,
    message: attempt.message,
    wordLevel: attempt.wordLevel,
  };
}

/** Exposed for diagnostics: returns the anonymous token (or null). */
export function musixmatchTokenForTest(): Promise<string | null> {
  return musixmatchUserToken();
}

async function runProvider(
  id: ProviderId,
  store: LibraryStore,
  track: TrackRecord,
): Promise<{ content: string; instrumental: boolean } | null> {
  switch (id) {
    case "lrclib":
      return fetchLrclib(track);
    case "spotify": {
      const spDc = store.getSetting("spotify_sp_dc")?.trim() ?? "";
      const spKey = store.getSetting("spotify_sp_key")?.trim() ?? "";
      const content = await fetchSpotify(track, spDc, spKey, store);
      return content ? { content, instrumental: false } : null;
    }
    case "musixmatch": {
      const result = await fetchMusixmatch(track, store);
      return result.content ? { content: result.content, instrumental: result.instrumental } : null;
    }
    case "embedded": {
      const content = await embeddedLyrics(track.path);
      return content ? { content, instrumental: false } : null;
    }
    default:
      return null;
  }
}

export async function resolveLyrics(
  store: LibraryStore,
  track: TrackRecord,
  force: boolean,
): Promise<LyricsPayload> {
  if (!force) {
    const cached = store.getLyrics(track.id);
    const best = cached.find((item) => item.synced) ?? cached[0];
    if (best) return buildPayload(track.id, "cache", best.content);
  }

  const lrcPath = sidecarPath(track.path);
  if (existsSync(lrcPath)) {
    try {
      const content = readFileSync(lrcPath, "utf8").trim();
      if (content) {
        cache(store, track, "local", content);
        return buildPayload(track.id, "local", content);
      }
    } catch {
      // ignore unreadable sidecar
    }
  }

  // A plain-text result from a higher-priority provider must not hide synced
  // lyrics from a lower-priority one. Keep the first plain result as a
  // fallback and keep looking for timestamps.
  let fallback: { provider: string; content: string } | null = null;

  for (const provider of parseProviders(store)) {
    if (!provider.enabled) continue;
    const result = await runProvider(provider.id, store, track);
    if (!result) continue;
    if (result.instrumental) {
      return buildPayload(track.id, provider.id, "", true);
    }
    if (result.content) {
      const payload = buildPayload(track.id, provider.id, result.content);
      if (payload.synced) {
        cache(store, track, provider.id, result.content);
        return payload;
      }
      if (!fallback) {
        fallback = { provider: provider.id, content: result.content };
      }
    }
  }

  if (fallback) {
    cache(store, track, fallback.provider, fallback.content);
    return buildPayload(track.id, fallback.provider, fallback.content);
  }

  throw new Error("No lyrics found");
}

/* ------------------------------------------------------------------------- */
/* Provider diagnostics (Settings → Test Connection + scripts/test-providers) */
/* ------------------------------------------------------------------------- */

export type TestProviderId = "lrclib" | "spotify" | "musixmatch";

export interface ProviderTestResult {
  provider: TestProviderId;
  ok: boolean;
  status: number | null;
  statusText: string;
  code?: number | null;
  lines: number;
  synced: boolean;
  syncType?: string;
  sample: string[];
  message: string;
}

export const PROVIDER_TEST_TRACK = {
  title: "Blinding Lights",
  artist: "The Weeknd",
  album: "After Hours",
  durationSeconds: 200,
  spotifyId: "0VjIjW4GlUZAMYd2vXMi3b",
} as const;

function statusText(status: number | null): string {
  if (status === null) return "ERROR";
  const names: Record<number, string> = {
    200: "OK",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    429: "Too Many Requests",
  };
  return `${status} ${names[status] ?? "Error"}`;
}

function sampleLines(content: string, count = 2): string[] {
  return content
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\[[^\]]*\]\s*/, "")
        .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, "")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, count);
}

function resultBase(provider: TestProviderId): ProviderTestResult {
  return {
    provider,
    ok: false,
    status: null,
    statusText: "ERROR",
    lines: 0,
    synced: false,
    sample: [],
    message: "",
  };
}

function diagnosticsTrack(): TrackRecord {
  return {
    id: -1,
    path: "",
    title: PROVIDER_TEST_TRACK.title,
    artist: PROVIDER_TEST_TRACK.artist,
    album: PROVIDER_TEST_TRACK.album,
    albumArtist: null,
    genre: null,
    year: null,
    trackNo: null,
    durationMs: PROVIDER_TEST_TRACK.durationSeconds * 1000,
    format: "mp3",
    bitrate: null,
    sampleRate: null,
    bitDepth: null,
    channels: null,
    fileSize: 0,
    fileName: "",
    modifiedAt: 0,
    coverPath: null,
    coverFullPath: null,
    hasEmbeddedLyrics: false,
    addedAt: 0,
  };
}

async function testLrclib(): Promise<ProviderTestResult> {
  const result = resultBase("lrclib");
  try {
    const found = await fetchLrclib(diagnosticsTrack());
    result.status = found ? 200 : 404;
    result.statusText = statusText(result.status);
    if (!found) {
      result.message = "LRCLIB has no match for this track after all three search steps.";
      return result;
    }
    if (found.instrumental) {
      result.ok = true;
      result.message = "Instrumental track";
      return result;
    }
    result.ok = true;
    result.lines = found.content.split(/\r?\n/).filter((line) => line.trim()).length;
    result.synced = isSynced(found.content);
    result.sample = sampleLines(found.content);
    result.message = `LRCLIB found ${result.lines} lines (3-step fallback)`;
    return result;
  } catch (error) {
    result.message = `Network error: ${error instanceof Error ? error.message : String(error)}`;
    return result;
  }
}

async function testSpotify(
  spDc: string,
  spKey: string,
): Promise<ProviderTestResult> {
  const result = resultBase("spotify");
  if (!spDc || !spKey) {
    result.message =
      "sp_dc and sp_key cookies are both required. Log in with Spotify in Settings → Providers.";
    return result;
  }

  const auth = await spotifyAccessToken(spDc, spKey);
  result.status = auth.status;
  result.statusText = statusText(auth.status);
  if (!auth.token) {
    result.message = auth.message ?? spotifyStatusMessage(auth.status ?? 0);
    return result;
  }

  try {
    const response = await fetch(
      `https://spclient.wg.spotify.com/color-lyrics/v2/track/${PROVIDER_TEST_TRACK.spotifyId}?format=json&vocalRemoval=false&market=from_token`,
      {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          Cookie: spotifyCookieHeader(spDc, spKey),
          "User-Agent": USER_AGENT,
          "app-platform": "WebPlayer",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(9_000),
      },
    );
    result.status = response.status;
    result.statusText = statusText(response.status);
    if (!response.ok) {
      result.message = spotifyStatusMessage(response.status);
      return result;
    }
    const payload = (await response.json()) as {
      lyrics?: {
        syncType?: string;
        lines?: Array<{ startTimeMs?: string | number; words?: string }>;
      };
    };
    const lines = payload.lyrics?.lines ?? [];
    const content = lines.map((line) => (line.words ?? "").trim()).filter(Boolean);
    if (content.length === 0) {
      result.message = "Spotify responded 200 but returned no lyric lines";
      return result;
    }
    result.ok = true;
    result.lines = content.length;
    result.synced = payload.lyrics?.syncType !== "UNSYNCED";
    result.syncType = payload.lyrics?.syncType ?? "UNKNOWN";
    result.sample = content.slice(0, 2);
    result.message = `Spotify returned ${result.syncType}`;
    return result;
  } catch (error) {
    result.message = `Network error: ${error instanceof Error ? error.message : String(error)}`;
    return result;
  }
}

async function testMusixmatch(store: LibraryStore): Promise<ProviderTestResult> {
  const result = resultBase("musixmatch");
  try {
    const attempt = await fetchMusixmatch(diagnosticsTrack(), store);
    result.status = attempt.status;
    result.code = attempt.code;
    result.statusText = statusText(attempt.status);
    if (!attempt.content) {
      result.message =
        attempt.message ?? "Musixmatch returned no subtitle for this track.";
      return result;
    }
    result.ok = true;
    result.lines = attempt.content.split(/\r?\n/).filter((line) => line.trim()).length;
    result.synced = isSynced(attempt.content);
    result.sample = sampleLines(attempt.content);
    result.message = attempt.wordLevel
      ? `Musixmatch found ${result.lines} lines with word-level karaoke`
      : `Musixmatch found ${result.lines} lines (autonomous token)`;
    return result;
  } catch (error) {
    result.message = `Network error: ${error instanceof Error ? error.message : String(error)}`;
    return result;
  }
}

export interface ProviderCredentials {
  spDc?: string;
  spKey?: string;
}

export async function testProvider(
  store: LibraryStore,
  provider: TestProviderId,
  credentials?: ProviderCredentials,
): Promise<ProviderTestResult> {
  switch (provider) {
    case "lrclib":
      return testLrclib();
    case "spotify":
      return testSpotify(
        credentials?.spDc !== undefined
          ? credentials.spDc.trim()
          : (store.getSetting("spotify_sp_dc")?.trim() ?? ""),
        credentials?.spKey !== undefined
          ? credentials.spKey.trim()
          : (store.getSetting("spotify_sp_key")?.trim() ?? ""),
      );
    case "musixmatch":
      return testMusixmatch(store);
    default:
      throw new Error(`Unknown provider: ${String(provider)}`);
  }
}

