import type { LyricLine, LyricWord } from "@/types";

/** An intro longer than this before the first line gets a lead-in marker. */
export const INTERMISSION_INTRO_MS = 4_000;
/** Only a pure instrumental tail this long is worth showing dots for. */
export const INTERMISSION_SILENCE_MS = 4_000;

/**
 * Vocal length fallback for a line with line-level timings only. Singing is
 * never faster than this; the extra tail covers the last word and breath.
 */
const MIN_VOCAL_MS = 3_000;
const VOCAL_MS_PER_WORD = 420;
const VOCAL_TAIL_MS = 800;
/** Last-resort length of a word when the source has no word duration. */
const DEFAULT_WORD_MS = 400;

export interface LyricLineRow {
  kind: "line";
  key: string;
  line: LyricLine;
  lineIndex: number;
  /** Estimated moment when the vocal for this line ends. */
  lineEndMs: number;
}

export interface LyricIntermissionRow {
  kind: "intermission";
  key: string;
  id: string;
  intro: boolean;
  prevLineIndex: number;
  nextLineIndex: number;
  /** First moment the lyrics go quiet and the dots should appear. */
  startMs: number;
  /** Timestamp of the next sung line; the dots collapse here. */
  endMs: number;
}

export type LyricRow = LyricLineRow | LyricIntermissionRow;

/** True when a word carries real timings rather than an even spread. */
function isTimedWord(word: LyricWord): boolean {
  return !word.estimated;
}

function wordEndMs(word: LyricWord): number {
  return word.time + (word.duration ?? DEFAULT_WORD_MS);
}

/**
 * Moment when the singer finishes the line. Enhanced LRC word timings are the
 * source of truth. Plain LRC / Spotify line-synced lyrics have no word timings
 * of their own; the player-generated word spread covers the entire gap to the
 * next line, so duration is estimated from the number of words instead. The
 * estimate is deliberately slow: vocals must physically fit before an
 * intermission is allowed to start.
 */
export function lineEndTime(line: LyricLine): number {
  const timedWords = line.words.filter(isTimedWord);

  if (timedWords.length > 0) {
    return wordEndMs(timedWords[timedWords.length - 1]);
  }

  const wordCount = line.text.split(/\s+/).filter(Boolean).length;
  const estimatedVocalMs = Math.max(
    MIN_VOCAL_MS,
    wordCount * VOCAL_MS_PER_WORD + VOCAL_TAIL_MS,
  );
  return line.time + estimatedVocalMs;
}

/**
 * Build the lyric timeline with intermission rows inside genuinely
 * instrumental gaps and before a slow intro. Dots start only after the vocal
 * ends; a gap with less than 4 s of pure silence gets no dots at all. Rows
 * carry line indices so compact mode and scroll centring can keep using the
 * same line coordinates as the player store.
 */
export function buildLyricRows(
  lines: LyricLine[],
  options: { introMs?: number } = {},
): LyricRow[] {
  const introMs = options.introMs ?? INTERMISSION_INTRO_MS;
  const rows: LyricRow[] = [];
  const first = lines[0];

  if (first && first.time > introMs) {
    rows.push({
      kind: "intermission",
      key: "intermission-intro",
      id: "intro",
      intro: true,
      prevLineIndex: -1,
      nextLineIndex: 0,
      startMs: 0,
      endMs: first.time,
    });
  }

  lines.forEach((line, lineIndex) => {
    const next = lines[lineIndex + 1];
    const lineEndMs = next ? lineEndTime(line) : line.endTime;

    rows.push({
      kind: "line",
      key: `line-${lineIndex}-${line.time}`,
      line,
      lineIndex,
      lineEndMs,
    });

    if (!next) return;
    if (next.time - lineEndMs < INTERMISSION_SILENCE_MS) return;

    rows.push({
      kind: "intermission",
      key: `intermission-${lineIndex}`,
      id: `${lineIndex}-${lineIndex + 1}`,
      intro: false,
      prevLineIndex: lineIndex,
      nextLineIndex: lineIndex + 1,
      startMs: lineEndMs,
      endMs: next.time,
    });
  });

  return rows;
}
