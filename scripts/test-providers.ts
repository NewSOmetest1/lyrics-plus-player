/**
 * Provider smoke test for Lyrics+.
 *
 * Usage:
 *   npm run test:lyrics
 *
 * Mirrors the Electron provider pipeline:
 *  - LRCLIB 3-step search (exact → no duration → full-text + duration match)
 *  - Spotify sp_dc → hidden Electron BrowserWindow → Color Lyrics
 *  - Musixmatch autonomous app-mobile token → macro.subtitles.get
 *
 * Track: The Weeknd — Blinding Lights (Spotify id 0VjIjW4GlUZAMYd2vXMi3b).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const TRACK = {
  title: "Blinding Lights",
  artist: "The Weeknd",
  album: "After Hours",
  duration: 200,
  spotifyId: "0VjIjW4GlUZAMYd2vXMi3b",
};

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const color = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function paint(value: string, style: keyof typeof color): string {
  return `${color[style]}${value}${color.reset}`;
}

function configPath(): string {
  if (process.env.LYRICS_PLUS_CONFIG) return process.env.LYRICS_PLUS_CONFIG;
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "lyrics-plus-player", "library.json");
}

function readSettings(): Record<string, string> {
  const file = configPath();
  if (!existsSync(file)) {
    console.warn(paint(`Config not found: ${file}`, "yellow"));
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      settings?: Record<string, string>;
    };
    return parsed.settings ?? {};
  } catch (error) {
    console.warn(paint(`Could not read ${file}: ${String(error)}`, "yellow"));
    return {};
  }
}

function statusLabel(status: number | null): string {
  if (status === null) return paint("ERROR", "red");
  const names: Record<number, string> = {
    200: "OK",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    429: "Too Many Requests",
  };
  const text = `${status} ${names[status] ?? "Error"}`;
  if (status >= 200 && status < 300) return paint(text, "green");
  if (status === 429) return paint(text, "yellow");
  return paint(text, "red");
}

/* -------------------------------- cleaning -------------------------------- */

const FEAT_PATTERN = /\s*[([{]\s*(?:feat|ft|featuring|with)\.?\s+[^)\]}]*[)\]}]/gi;
const TRAILING_FEAT_PATTERN = /\s+(?:feat|ft|featuring)\.?\s+.*$/gi;
const VERSION_PATTERN =
  /\s*[([{]\s*(?:remaster(?:ed)?|remastered\s+\d{4}|live(?:\s+at\s+[^)\]}]*)?|official(?:\s+[^)\]}]*)?|bonus(?:\s+track)?|deluxe(?:\s+edition)?|explicit|clean|mono|stereo|radio\s+edit|extended(?:\s+mix)?|acoustic|instrumental)[^)\]}]*[)\]}]/gi;
const DASH_VERSION_PATTERN =
  /\s+-\s+(?:remaster(?:ed)?(?:\s+\d{4})?|live(?:\s+.*)?|official(?:\s+.*)?|bonus\s+track|radio\s+edit|extended\s+mix|acoustic(?:\s+version)?|instrumental(?:\s+version)?)\s*$/i;

function clean(value: string): string {
  return value
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
}

function cleanTrackTitle(title: string): string {
  return clean(title) || title.trim();
}

function normalize(value: string): string {
  return cleanTrackTitle(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tracksMatch(
  expectedTitle: string,
  expectedArtist: string,
  actualTitle: string,
  actualArtist: string,
): boolean {
  const title = normalize(expectedTitle);
  const actual = normalize(actualTitle);
  if (!title || !actual) return false;
  if (!(actual === title || actual.includes(title) || title.includes(actual))) return false;
  const artist = normalize(expectedArtist);
  const actualArt = normalize(actualArtist);
  if (!artist || !actualArt) return true;
  return (
    actualArt === artist ||
    actualArt.includes(artist) ||
    artist.includes(actualArt) ||
    actualArt.split(" ").some((part) => part.length > 2 && artist.includes(part))
  );
}

/* -------------------------------- helpers --------------------------------- */

function stripTimestamps(line: string): string {
  return line
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, "")
    .trim();
}

function sampleLines(content: string, count = 2): string[] {
  return content
    .split(/\r?\n/)
    .map(stripTimestamps)
    .filter(Boolean)
    .slice(0, count);
}

function lineCount(content: string): number {
  return content.split(/\r?\n/).filter((line) => line.trim()).length;
}

function isSynced(content: string): boolean {
  return /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(content);
}

function printSamples(samples: string[]): void {
  if (samples.length === 0) {
    console.log(paint("  └─ no sample lines", "dim"));
    return;
  }
  for (const line of samples) {
    console.log(paint(`  │ ${line}`, "dim"));
  }
}

/* --------------------------------- LRCLIB --------------------------------- */

interface LrclibRecord {
  trackName?: string;
  artistName?: string;
  duration?: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

const LRCLIB_HEADERS = { "User-Agent": USER_AGENT, Accept: "application/json" };

async function lrclibGet(params: Record<string, string>): Promise<LrclibRecord | null> {
  const response = await fetch(`https://lrclib.net/api/get?${new URLSearchParams(params)}`, {
    headers: LRCLIB_HEADERS,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  return (await response.json()) as LrclibRecord;
}

function lrclibContent(record: LrclibRecord | null): string | null {
  if (!record) return null;
  return record.syncedLyrics?.trim() || record.plainLyrics?.trim() || null;
}

async function testLrclib(): Promise<boolean> {
  console.log(paint("\n[LRCLIB]", "bold"));
  const title = cleanTrackTitle(TRACK.title);
  const artist = cleanTrackTitle(TRACK.artist);
  let status = 404;
  let content: string | null = null;
  let step = "";

  try {
    const exact = await lrclibGet({
      artist_name: TRACK.artist,
      track_name: TRACK.title,
      duration: String(TRACK.duration),
    });
    content = lrclibContent(exact);
    step = "step 1 — exact + duration";

    if (!content) {
      const loose = await lrclibGet({ artist_name: artist, track_name: title });
      content = lrclibContent(loose);
      step = "step 2 — cleaned names, no duration";
    }

    if (!content) {
      const query = new URLSearchParams({ q: `${artist} ${title}` });
      const search = await fetch(`https://lrclib.net/api/search?${query}`, {
        headers: LRCLIB_HEADERS,
        signal: AbortSignal.timeout(12_000),
      });
      status = search.status;
      if (search.ok) {
        const records = (await search.json()) as LrclibRecord[];
        const within = records
          .filter((record) => record.syncedLyrics?.trim())
          .filter(
            (record) =>
              Number.isFinite(record.duration) &&
              Math.abs((record.duration ?? 0) - TRACK.duration) <= 5,
          )
          .sort(
            (a, b) =>
              Math.abs((a.duration ?? 0) - TRACK.duration) -
              Math.abs((b.duration ?? 0) - TRACK.duration),
          );
        content =
          lrclibContent(within[0] ?? null) ??
          lrclibContent(records.find((record) => record.syncedLyrics?.trim()) ?? null);
        step = "step 3 — full-text search";
      }
    }

    if (content) status = 200;
    console.log(`  Status:        ${statusLabel(status)}`);
    console.log(`  Strategy:      ${paint(step || "no result", "dim")}`);
    if (!content) {
      console.log(paint("  └─ no lyrics after all three steps", "red"));
      return false;
    }
    const synced = isSynced(content);
    console.log(`  Lines:         ${lineCount(content)}`);
    console.log(`  Synced:        ${synced ? paint("yes", "green") : paint("no", "yellow")}`);
    console.log("  First 2:");
    printSamples(sampleLines(content));
    return true;
  } catch (error) {
    console.log(paint("  Status:        ERROR", "red"));
    console.log(paint(`  └─ ${error instanceof Error ? error.message : String(error)}`, "red"));
    return false;
  }
}

/* -------------------------------- Spotify --------------------------------- */

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_BIN = createRequire(import.meta.url)("electron") as string;

function spotifyExplanation(status: number): string {
  switch (status) {
    case 401:
      return "401 Unauthorized — sp_dc is invalid or expired. Paste a fresh cookie.";
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

/**
 * Token is obtained inside Electron: a hidden BrowserWindow holds the sp_dc
 * cookie and the page's own Authorization header is captured. Plain fetch to
 * get_access_token is blocked by Cloudflare with 403.
 */
async function spotifyToken(spDc: string): Promise<{
  token: string | null;
  status: number | null;
  message?: string;
}> {
  if (!spDc) return { token: null, status: null, message: "sp_dc cookie is missing" };

  const helper = path.join(SCRIPT_DIR, "spotify-token-electron.cjs");
  try {
    return await new Promise((resolve) => {
      const child = spawn(String(ELECTRON_BIN), ["--no-sandbox", helper], {
        env: { ...process.env, SPOTIFY_SP_DC: spDc },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const done = (result: {
        token: string | null;
        status: number | null;
        message?: string;
      }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        done({ token: null, status: null, message: "Electron auth window timed out." });
      }, 35_000);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        done({
          token: null,
          status: null,
          message: `Cannot start Electron: ${error.message}`,
        });
      });
      child.on("close", () => {
        const line = stdout
          .split(/\r?\n/)
          .find((entry) => entry.startsWith("SPOTIFY_TOKEN_RESULT="));
        if (!line) {
          done({
            token: null,
            status: null,
            message: `Electron helper produced no result. ${stderr.slice(-200).trim()}`,
          });
          return;
        }
        try {
          done(JSON.parse(line.slice("SPOTIFY_TOKEN_RESULT=".length)));
        } catch {
          done({ token: null, status: null, message: "Bad Electron helper output." });
        }
      });
    });
  } catch (error) {
    return {
      token: null,
      status: null,
      message: `Electron token bridge failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function testSpotify(spDc: string): Promise<boolean> {
  console.log(paint("\n[Spotify]", "bold"));
  if (!spDc) {
    console.log(paint("  Token:         missing sp_dc", "red"));
    console.log(paint("  └─ save the cookie in Settings → Providers first", "red"));
    return false;
  }
  console.log(`  sp_dc:         ${paint(`present (${spDc.length} chars)`, "green")}`);
  console.log(`  Auth:          ${paint("Electron hidden window", "cyan")}`);

  const auth = await spotifyToken(spDc);
  console.log(`  Token status:  ${statusLabel(auth.status)}`);
  if (!auth.token) {
    console.log(paint(`  └─ ${auth.message ?? "could not obtain access token"}`, "red"));
    return false;
  }

  try {
    const response = await fetch(
      `https://spclient.wg.spotify.com/color-lyrics/v2/track/${TRACK.spotifyId}?format=json&vocalRemoval=false&market=from_token`,
      {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "User-Agent": USER_AGENT,
          "app-platform": "WebPlayer",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(12_000),
      },
    );
    console.log(`  Lyrics status: ${statusLabel(response.status)}`);
    if (!response.ok) {
      console.log(paint(`  └─ ${spotifyExplanation(response.status)}`, "red"));
      return false;
    }
    const payload = (await response.json()) as {
      lyrics?: {
        syncType?: string;
        lines?: Array<{ startTimeMs?: string | number; words?: string }>;
      };
    };
    const lines = payload.lyrics?.lines ?? [];
    const words = lines.map((line) => (line.words ?? "").trim()).filter(Boolean);
    console.log(`  Sync type:     ${paint(payload.lyrics?.syncType ?? "UNKNOWN", "cyan")}`);
    console.log(`  Lines:         ${words.length}`);
    console.log("  First 2:");
    printSamples(words.slice(0, 2));
    return words.length > 0;
  } catch (error) {
    console.log(paint("  Lyrics status: ERROR", "red"));
    console.log(paint(`  └─ ${error instanceof Error ? error.message : String(error)}`, "red"));
    return false;
  }
}

/* ------------------------------- Musixmatch ------------------------------- */

const MM_BASE = "https://apic-appmobile.musixmatch.com/ws/1.1";
const MM_APP_ID = "mac-ios-v2.0";
const MM_HEADERS = {
  Host: "apic-appmobile.musixmatch.com",
  "X-Cookie": "x-mxm-token-guid=",
  "x-mxm-app-version": "10.1.1",
  "X-User-Agent": "Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive",
  Accept: "application/json",
};

let mmToken: string | null = null;
let mmFallbackToken: string | null = null;

function tokenCacheFile(): string {
  return path.join(path.dirname(configPath()), "musixmatch-token.json");
}

function readTokenCache(): string | null {
  try {
    const file = tokenCacheFile();
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { user_token?: string };
    return parsed.user_token?.trim() || null;
  } catch {
    return null;
  }
}

function writeTokenCache(token: string): void {
  try {
    writeFileSync(tokenCacheFile(), JSON.stringify({ user_token: token, savedAt: Date.now() }));
  } catch {
    // best-effort cache
  }
}

async function musixmatchToken(force = false): Promise<string | null> {
  if (!force && (mmToken || mmFallbackToken)) return mmToken || mmFallbackToken;
  const response = await fetch(`${MM_BASE}/token.get?app_id=${MM_APP_ID}`, {
    headers: MM_HEADERS,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return mmFallbackToken;
  const payload = (await response.json()) as {
    message?: {
      header?: { status_code?: number; hint?: string };
      body?: { user_token?: string };
    };
  };
  const token = payload.message?.body?.user_token?.trim() || null;
  if (token) {
    mmToken = token;
    writeTokenCache(token);
    return token;
  }
  const hint = payload.message?.header?.hint;
  console.log(
    paint(
      `  └─ token.get returned ${payload.message?.header?.status_code ?? "?"}${hint ? ` (${hint})` : ""} — using cached token`,
      "yellow",
    ),
  );
  return mmFallbackToken;
}

interface MmAttempt {
  content: string | null;
  httpStatus: number | null;
  code: number | null;
  message?: string;
  matchedTitle?: string;
  matchedArtist?: string;
  wordLevel?: boolean;
}

function formatLrcTime(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const centis = Math.floor((safe * 100) % 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

function subtitleToLrc(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as Array<{
      text?: string;
      time?: { total?: number };
    }>;
    if (!Array.isArray(parsed)) return null;
    const lines = parsed
      .filter((line) => typeof line?.time?.total === "number")
      .map((line) => `[${formatLrcTime(line.time?.total ?? 0)}]${(line.text ?? "").trim()}`);
    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

function richsyncToLrc(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as Array<{
      ts?: number;
      l?: Array<{ c?: string; o?: number }>;
    }>;
    if (!Array.isArray(parsed)) return null;
    const lines: string[] = [];
    for (const line of parsed) {
      const start = Number(line.ts ?? 0);
      const words = (line.l ?? []).filter((word) => typeof word?.c === "string");
      if (words.length === 0) continue;
      const tags = words
        .map(
          (word) =>
            `<${formatLrcTime(start + Number(word.o ?? 0))}>${word.c ?? ""}`,
        )
        .join("");
      lines.push(`[${formatLrcTime(start)}]${tags}`);
    }
    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

async function musixmatchSubtitle(token: string): Promise<MmAttempt> {
  const title = cleanTrackTitle(TRACK.title);
  const artist = cleanTrackTitle(TRACK.artist);
  const params = new URLSearchParams({
    format: "json",
    namespace: "lyrics_richsynched",
    subtitle_format: "mxm",
    app_id: MM_APP_ID,
    q_track: title,
    q_artist: artist,
    q_artists: artist,
    q_album: TRACK.album,
    q_duration: String(TRACK.duration),
    f_subtitle_length: String(TRACK.duration),
    usertoken: token,
    optional_calls: "track.richsync",
    richsync_compact_type: "words",
  });

  const response = await fetch(`${MM_BASE}/macro.subtitles.get?${params}`, {
    headers: MM_HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    return { content: null, httpStatus: response.status, code: response.status };
  }

  const payload = (await response.json()) as {
    message?: {
      header?: { status_code?: number };
      body?: {
        macro_calls?: Record<string, any>;
        macro_result?: { subtitles?: { subtitle_list?: Array<{ subtitle?: { subtitle_body?: string } }> } };
      };
    };
  };
  const code = payload.message?.header?.status_code ?? null;
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

  const richLrc = richBody ? richsyncToLrc(richBody) : null;
  const content = richLrc ?? (subtitleBody ? subtitleToLrc(subtitleBody) : null);

  const attempt: MmAttempt = {
    content,
    httpStatus: response.status,
    code,
    matchedTitle: matched?.track_name,
    matchedArtist: matched?.artist_name,
    wordLevel: Boolean(richLrc),
  };

  if (matched?.track_name || matched?.artist_name) {
    if (
      !tracksMatch(title, artist, matched.track_name ?? "", matched.artist_name ?? "")
    ) {
      attempt.content = null;
      attempt.httpStatus = 404;
      attempt.message = `Matched a different track: ${matched.artist_name ?? "?"} — ${matched.track_name ?? "?"}`;
    }
  }
  if (!attempt.content && !attempt.message) {
    attempt.message =
      code === 200 ? "No subtitle for this track" : `status code ${code ?? "unknown"}`;
    attempt.httpStatus = 404;
  }
  return attempt;
}

async function testMusixmatch(): Promise<boolean> {
  console.log(paint("\n[Musixmatch]", "bold"));
  try {
    const cached = mmToken || mmFallbackToken;
    if (cached) {
      console.log(
        `  Token:         ${paint(`cached (${cached.length} chars)`, "green")}`,
      );
    } else {
      console.log(`  Token:         ${paint("requesting anonymous app-mobile token…", "dim")}`);
    }
    let token = await musixmatchToken();
    if (!token) {
      console.log(paint("  Token status:  could not obtain token", "red"));
      return false;
    }
    if (!cached) {
      console.log(`  Token:         ${paint(`present (${token.length} chars)`, "green")}`);
    }

    let attempt = await musixmatchSubtitle(token);
    if (attempt.code === 401 || attempt.httpStatus === 401) {
      token = await musixmatchToken(true);
      if (token) attempt = await musixmatchSubtitle(token);
    }

    console.log(`  API status:    ${statusLabel(attempt.httpStatus)}`);
    if (attempt.matchedTitle || attempt.matchedArtist) {
      console.log(
        `  Matched:       ${paint(`${attempt.matchedArtist ?? "?"} — ${attempt.matchedTitle ?? "?"}`, "dim")}`,
      );
    }
    if (!attempt.content) {
      console.log(paint(`  └─ ${attempt.message ?? `no subtitle (code ${attempt.code ?? "unknown"})`}`, "red"));
      return false;
    }
    console.log(`  Lines:         ${lineCount(attempt.content)}`);
    console.log(`  Synced:        ${isSynced(attempt.content) ? paint("yes", "green") : paint("no", "yellow")}`);
    console.log(
      `  Word timings:  ${attempt.wordLevel ? paint("yes (karaoke)", "green") : paint("no", "dim")}`,
    );
    console.log("  First 2:");
    printSamples(sampleLines(attempt.content));
    return true;
  } catch (error) {
    console.log(paint("  API status:    ERROR", "red"));
    console.log(paint(`  └─ ${error instanceof Error ? error.message : String(error)}`, "red"));
    return false;
  }
}

/* ---------------------------------- main ---------------------------------- */

async function main(): Promise<void> {
  const settings = readSettings();
  const spDc = process.env.SPOTIFY_SP_DC?.trim() || settings.spotify_sp_dc?.trim() || "";
  mmFallbackToken =
    process.env.MUSIXMATCH_USER_TOKEN?.trim() ||
    settings.musixmatch_user_token?.trim() ||
    settings.musixmatch_token?.trim() ||
    settings.musixmatch_api_key?.trim() ||
    readTokenCache();

  console.log(paint("\nLyrics+ provider smoke test", "bold"));
  console.log(paint("────────────────────────────────────────────", "dim"));
  console.log(`  Track:   ${paint(`${TRACK.artist} — ${TRACK.title}`, "cyan")}`);
  console.log(`  Spotify: ${paint(TRACK.spotifyId, "dim")} · ${TRACK.duration}s`);
  console.log(`  Config:  ${paint(configPath(), "dim")}`);

  const lrclibOk = await testLrclib();
  const spotifyOk = await testSpotify(spDc);
  const musixmatchOk = await testMusixmatch();

  console.log(paint("\nSummary", "bold"));
  console.log(paint("────────────────────────────────────────────", "dim"));
  console.log(`  LRCLIB:      ${lrclibOk ? paint("PASS", "green") : paint("FAIL", "red")}`);
  console.log(`  Spotify:     ${spotifyOk ? paint("PASS", "green") : paint("FAIL", "red")}`);
  console.log(`  Musixmatch:  ${musixmatchOk ? paint("PASS", "green") : paint("FAIL", "red")}`);

  const passed = [lrclibOk, spotifyOk, musixmatchOk].filter(Boolean).length;
  console.log(`\n  ${passed}/3 providers returned lyrics. ${paint("Done.", "dim")}\n`);
}

void main();
