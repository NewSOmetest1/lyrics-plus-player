import type { LyricLine, LyricWord } from "@/types";

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const OFFSET_TAG = /\[offset:\s*([+-]?\d+)\s*\]/i;
const METADATA_TAG = /^\[(ar|ti|al|by|offset|length|re|ve|au|tool):/i;
const SECTION_TAG =
  /^\[(verse|chorus|bridge|intro|outro|pre[- ]?chorus|hook|refrain|instrumental|solo)[^\]]*\]$/i;

/** True when the file carries enhanced-LRC word timings (`<mm:ss.xx>`). */
export function hasWordTimings(content: string): boolean {
  WORD_TAG.lastIndex = 0;
  return WORD_TAG.test(content);
}

function toMs(minutes: string, seconds: string, fraction?: string): number {
  const fractionMs = fraction ? Number(fraction.padEnd(3, "0")) : 0;
  return (Number(minutes) * 60 + Number(seconds)) * 1000 + fractionMs;
}

/**
 * Parse standard and enhanced LRC.
 *
 * Word timings come from enhanced tags (`<mm:ss.xx>`) when present. Otherwise
 * they are distributed across the line by character weight, which gives the
 * signature karaoke sweep even for plain `[mm:ss.xx]` files.
 */
export function parseLrc(content: string): LyricLine[] {
  const offsetMatch = content.match(OFFSET_TAG);
  const offset = offsetMatch ? Number(offsetMatch[1]) : 0;

  type RawLine = { time: number; text: string };
  const raw: RawLine[] = [];

  for (const sourceLine of content.split(/\r?\n/)) {
    const line = sourceLine.trimEnd();
    if (!line) continue;

    const timestamps: number[] = [];
    let lastTagEnd = 0;
    TIME_TAG.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TIME_TAG.exec(line)) !== null) {
      timestamps.push(toMs(match[1], match[2], match[3]));
      lastTagEnd = match.index + match[0].length;
    }

    if (timestamps.length === 0) continue;
    const text = line.slice(lastTagEnd).trim();
    for (const timestamp of timestamps) {
      raw.push({ time: Math.max(0, timestamp + offset), text });
    }
  }

  if (raw.length === 0) return [];
  raw.sort((a, b) => a.time - b.time);

  // Compute the end of every line from the next line (including empty lines,
  // which are often used as instrumental gaps in LRC files).
  const timed = raw.map((line, index) => {
    const next = raw.slice(index + 1).find((candidate) => candidate.time > line.time);
    const endTime = next ? next.time : line.time + 5_000;
    return { ...line, endTime: Math.max(endTime, line.time + 500) };
  });

  return timed
    .filter((line) => line.text.length > 0)
    .map((line) => {
      const { words, text } = parseWords(line.text, line.time, line.endTime);
      return {
        time: line.time,
        endTime: line.endTime,
        text,
        words,
      };
    });
}

/**
 * Guarantee word timings for every synced line. Plain LRC and Spotify
 * LINE_SYNCED carry only line timestamps, so the line duration is distributed
 * across its words by character weight. This powers pseudo-karaoke everywhere.
 */
export function ensureWordTimings(lines: LyricLine[]): LyricLine[] {
  return lines.map((line, index) => {
    if (line.words.length > 0 || line.text.trim().length === 0) return line;

    const next = lines
      .slice(index + 1)
      .find((candidate) => candidate.time > line.time);
    const endTime =
      line.endTime > line.time
        ? line.endTime
        : next
          ? next.time
          : line.time + 3_500;

    return {
      ...line,
      endTime: Math.max(endTime, line.time + 500),
      words: estimateWords(line.text, line.time, endTime),
    };
  });
}

export function parsePlainLyrics(content: string): LyricLine[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !METADATA_TAG.test(line) &&
        !SECTION_TAG.test(line) &&
        !/^\[[^\]]*\]$/.test(line),
    )
    .map((text) => ({ time: 0, endTime: 0, text, words: [] }));
}

function parseWords(
  rawText: string,
  start: number,
  end: number,
): { text: string; words: LyricWord[] } {
  const tagged: LyricWord[] = [];
  const matches: { index: number; end: number; time: number }[] = [];

  WORD_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_TAG.exec(rawText)) !== null) {
    matches.push({
      index: match.index,
      end: match.index + match[0].length,
      time: toMs(match[1], match[2], match[3]),
    });
  }

  if (matches.length > 0) {
    const prefix = rawText.slice(0, matches[0].index);
    if (prefix.trim()) {
      tagged.push({ time: start, text: prefix });
    }
    matches.forEach((tag, index) => {
      const next = matches[index + 1];
      const text = rawText.slice(tag.end, next ? next.index : rawText.length);
      if (text.length > 0) {
        tagged.push({ time: tag.time, text });
      }
    });
    const text = tagged
      .map((word) => word.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      return { text, words: tagged };
    }
  }

  const text = rawText.replace(WORD_TAG, "").replace(/\s+/g, " ").trim();
  return { text, words: estimateWords(text, start, end) };
}

/**
 * Spread word timings over the line using character length as weight. This is
 * what makes plain LRC files still feel like real karaoke.
 */
function estimateWords(text: string, start: number, end: number): LyricWord[] {
  const tokens = text.match(/\S+\s*/g);
  if (!tokens || tokens.length === 0) return [];
  if (tokens.length === 1) {
    return [{ time: start, text: tokens[0], estimated: true }];
  }

  const totalWeight = tokens.reduce((sum, token) => sum + token.length, 0);
  const duration = Math.max(end - start, 700);
  let elapsed = 0;

  return tokens.map((token) => {
    const time = start + (elapsed / totalWeight) * duration;
    elapsed += token.length;
    return { time: Math.round(time), text: token, estimated: true };
  });
}

/** Index of the last line whose timestamp is <= position. */
export function activeLineIndex(lines: LyricLine[], positionMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  const target = positionMs + 24;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= target) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

export function lineProgress(line: LyricLine, positionMs: number): number {
  const span = Math.max(line.endTime - line.time, 1);
  return Math.min(1, Math.max(0, (positionMs - line.time) / span));
}
