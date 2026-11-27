import type {
  CachedLyrics,
  LyricsSearchResult,
  TrackRecord,
} from "./types";

const LRC_TIME_TAG = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TIME_TAG = /<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g;
const METADATA_TAG = /^\[(ar|ti|al|by|offset|length|re|ve|au|tool):/i;
const SECTION_TAG =
  /^\[(verse|chorus|bridge|intro|outro|pre[- ]?chorus|hook|refrain|instrumental|solo)[^\]]*\]$/i;

export interface SearchableLyricLine {
  text: string;
  timeMs: number | null;
}

function toMilliseconds(minutes: string, seconds: string, fraction?: string): number {
  const fractionMs = fraction ? Number(fraction.padEnd(3, "0")) : 0;
  return (Number(minutes) * 60 + Number(seconds)) * 1000 + fractionMs;
}

function timestampOf(line: string): number | null {
  const match = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/.exec(line);
  if (!match) return null;
  return toMilliseconds(match[1], match[2], match[3]);
}

/**
 * Convert cached LRC or plain lyrics into the lines a user actually sees.
 * Section headers, metadata and empty lines must not produce search results.
 */
export function parseSearchableLyrics(content: string): SearchableLyricLine[] {
  const lines: SearchableLyricLine[] = [];

  for (const sourceLine of content.split(/\r?\n/)) {
    const timeMs = timestampOf(sourceLine.trimStart());
    const text = sourceLine
      .replace(LRC_TIME_TAG, "")
      .replace(WORD_TIME_TAG, "")
      .replace(/\s+/g, " ")
      .trim();

    if (
      !text ||
      METADATA_TAG.test(text) ||
      SECTION_TAG.test(text) ||
      /^\[[^\]]*\]$/.test(text)
    ) {
      continue;
    }

    lines.push({ text, timeMs });
  }

  return lines;
}

interface LineMatch {
  line: SearchableLyricLine;
  matchStart: number;
  matchCount: number;
}

function findLineMatch(
  lines: SearchableLyricLine[],
  needle: string,
): LineMatch | null {
  let best: LineMatch | null = null;

  for (const line of lines) {
    const haystack = line.text.toLocaleLowerCase();
    let from = 0;
    let first = -1;
    let count = 0;

    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      if (first < 0) first = at;
      count += 1;
      from = at + Math.max(1, needle.length);
    }

    if (first < 0) continue;
    if (!best || count > best.matchCount) {
      best = { line, matchStart: first, matchCount: count };
    }
  }

  return best;
}

/**
 * Search every cached lyric source and return one best line per track.
 * Synced entries win over plain ones so a click can seek to an exact timestamp.
 */
export function searchCachedLyrics(
  tracks: TrackRecord[],
  lyrics: Record<string, CachedLyrics[]>,
  query: string,
  limit = 50,
): LyricsSearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2) return [];

  const results: Array<LyricsSearchResult & { score: number }> = [];

  for (const track of tracks) {
    const entries = lyrics[String(track.id)];
    if (!entries || entries.length === 0) continue;

    let best: (LyricsSearchResult & { score: number }) | null = null;

    for (const entry of entries) {
      const lines = parseSearchableLyrics(entry.content);
      const match = findLineMatch(lines, needle);
      if (!match) continue;

      const synced =
        entry.synced || lines.some((line) => line.timeMs !== null);
      const score =
        (synced ? 1_000_000 : 0) +
        match.matchCount * 100 +
        (match.line.timeMs !== null ? 10 : 0);

      if (best && score <= best.score) continue;

      best = {
        track,
        source: entry.source,
        synced,
        lineText: match.line.text,
        lineTimeMs: match.line.timeMs,
        matchStart: match.matchStart,
        matchLength: needle.length,
        matchCount: match.matchCount,
        score,
      };
    }

    if (best) results.push(best);
  }

  results.sort(
    (a, b) =>
      b.score - a.score ||
      a.track.artist.localeCompare(b.track.artist, undefined, {
        sensitivity: "base",
      }) ||
      a.track.title.localeCompare(b.track.title, undefined, {
        sensitivity: "base",
      }),
  );

  const bounded = Math.max(1, Math.min(100, Math.trunc(limit) || 50));
  return results.slice(0, bounded).map(({ score: _score, ...result }) => result);
}
