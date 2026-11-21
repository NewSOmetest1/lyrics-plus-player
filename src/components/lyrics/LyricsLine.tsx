import {
  Fragment,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { LyricLine, LyricWord, LyricsMode } from "@/types";
import type { LyricsAlign } from "@/store/settingsStore";
import { cn } from "@/lib/cn";

const EASE = [0.2, 0, 0, 1] as const;

/** Word motion starts a hair before the timestamp, like the line cursor. */
const MOTION_LEAD_MS = 24;
/** A word held longer than this is treated as a sustained note. */
const EMPHASIS_MIN_MS = 1_000;
/** Longer words would turn into a wall of independently moving letters. */
const EMPHASIS_MAX_UNITS = 12;
/** Inferred end for the last word before the next line or a long pause. */
const MOTION_MAX_WORD_MS = 1_600;

type CurvePoint = readonly [number, number];

/**
 * The same three envelopes the reference drives with springs: a small scale
 * dip that overshoots, a lift that peaks late, and a glow that flashes then
 * sustains. The spring is what makes them feel like a breath instead of a
 * linear keyframe.
 */
const SCALE_CURVE: readonly CurvePoint[] = [
  [0, 0.95],
  [0.7, 1.025],
  [1, 1],
];
const LIFT_CURVE: readonly CurvePoint[] = [
  [0, 1 / 100],
  [0.9, -(1 / 60)],
  [1, 0],
];
const GLOW_CURVE: readonly CurvePoint[] = [
  [0, 0],
  [0.15, 1],
  [0.6, 1],
  [1, 0],
];

/** Matches the idle CSS pose of `.lyrics-motion-unit`. */
const IDLE_SCALE = SCALE_CURVE[0][1];
const IDLE_LIFT = LIFT_CURVE[0][1];

interface SpringConfig {
  damping: number;
  frequency: number;
}

/** Under-damped, so each envelope overshoots a little before it settles. */
const SCALE_SPRING: SpringConfig = { damping: 0.6, frequency: 0.7 };
const LIFT_SPRING: SpringConfig = { damping: 0.4, frequency: 1.25 };
const GLOW_SPRING: SpringConfig = { damping: 0.5, frequency: 1 };

/**
 * Scripts where per-grapheme spans would break shaping or joining. Those
 * words keep one animated box per word instead.
 */
const COMPLEX_SCRIPT =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Thai}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Sinhala}]/u;

interface GraphemeSegment {
  segment: string;
}
interface SegmenterLike {
  segment(input: string): Iterable<GraphemeSegment>;
}

const graphemeSegmenter: SegmenterLike | null = (() => {
  try {
    const Segmenter = (
      Intl as unknown as {
        Segmenter?: new (
          locales?: string | string[],
          options?: { granularity: "grapheme" },
        ) => SegmenterLike;
      }
    ).Segmenter;
    return Segmenter
      ? new Segmenter(undefined, { granularity: "grapheme" })
      : null;
  } catch {
    return null;
  }
})();

function splitGraphemes(text: string): string[] {
  if (!graphemeSegmenter) return Array.from(text);
  return Array.from(graphemeSegmenter.segment(text), (item) => item.segment);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

/** Piecewise smooth interpolation through the same peaks as the reference. */
function sampleCurve(points: readonly CurvePoint[], progress: number): number {
  const value = clamp01(progress);
  if (value <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    const [endTime, endValue] = points[index];
    if (value <= endTime) {
      const [startTime, startValue] = points[index - 1];
      const span = Math.max(endTime - startTime, 0.000001);
      return startValue + (endValue - startValue) * smoothstep((value - startTime) / span);
    }
  }
  return points[points.length - 1][1];
}

/** Blur is capped, so most distant lines keep identical metrics. */
function blurFor(distance: number, active: boolean, fadeBlur: boolean): number {
  if (active || !fadeBlur) return 0;
  return Math.max(0.5, Math.min(2.5, distance * 0.5));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Highlight every query token inside a line or karaoke word. */
function highlightText(text: string, query?: string): ReactNode {
  const trimmed = query?.trim();
  if (!trimmed) return text;
  const tokens = [...new Set(trimmed.split(/\s+/).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (tokens.length === 0) return text;
  const parts = text.split(new RegExp(`(${tokens.join("|")})`, "gi"));
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark
        key={`${part}-${index}`}
        className="rounded-[3px] bg-accent/30 text-inherit shadow-[0_0_0_1px_var(--lyric-highlight-ring)]"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

interface MotionUnit {
  refIndex: number;
  text: string;
  /** Letter slice inside the word, in 0..1 units. */
  start: number;
  duration: number;
  /** Glow keeps running until the end of the word, not just the slice. */
  glowDuration: number;
}

type MotionSegment =
  | { kind: "space"; text: string }
  | { kind: "unit"; unit: MotionUnit };

interface MotionWord {
  start: number;
  end: number;
  emphasis: boolean;
  /**
   * Edge whitespace is kept outside the word box. A space at the edge of an
   * inline-block is trimmed by the browser, which visually merges words.
   */
  leading: string;
  trailing: string;
  units: MotionUnit[];
  segments: MotionSegment[];
}

/**
 * The source data often carries only a start time per word. Use the next
 * word, the line end and a hard cap so a trailing word does not keep pulsing
 * through an instrumental gap.
 */
function wordEndMs(line: LyricLine, words: LyricWord[], index: number): number {
  const word = words[index];
  if (!word) return 0;
  const explicit =
    word.duration && word.duration > 0
      ? word.time + word.duration
      : Number.POSITIVE_INFINITY;
  const next = words[index + 1];
  const nextStart =
    next && next.time > word.time ? next.time : Number.POSITIVE_INFINITY;
  const lineEnd =
    line.endTime > word.time ? line.endTime : Number.POSITIVE_INFINITY;
  const end = Math.min(
    explicit,
    nextStart,
    lineEnd,
    word.time + MOTION_MAX_WORD_MS,
  );
  return Math.max(word.time + 120, Number.isFinite(end) ? end : word.time + 600);
}

function buildMotionWords(line: LyricLine): MotionWord[] {
  let refIndex = 0;

  return line.words.map((word, wordIndex) => {
    const start = word.time;
    const end = wordEndMs(line, line.words, wordIndex);
    const graphemes = splitGraphemes(word.text);
    const visible = graphemes.filter((grapheme) => grapheme.trim().length > 0);
    const emphasis =
      end - start >= EMPHASIS_MIN_MS &&
      visible.length > 0 &&
      visible.length <= EMPHASIS_MAX_UNITS &&
      !COMPLEX_SCRIPT.test(word.text);

    const units: MotionUnit[] = [];
    const segments: MotionSegment[] = [];
    const glyphs = graphemes.filter((grapheme) => grapheme.trim().length > 0);
    const slice = glyphs.length > 0 ? 1 / glyphs.length : 1;

    if (emphasis) {
      let pendingSpace = "";
      for (const grapheme of graphemes) {
        if (grapheme.trim().length === 0) {
          pendingSpace += grapheme;
          continue;
        }
        if (pendingSpace) {
          segments.push({ kind: "space", text: pendingSpace });
          pendingSpace = "";
        }
        const start = units.length * slice;
        const unit: MotionUnit = {
          refIndex: refIndex++,
          text: grapheme,
          start,
          duration: slice,
          glowDuration: 1 - start,
        };
        units.push(unit);
        segments.push({ kind: "unit", unit });
      }
      if (pendingSpace) segments.push({ kind: "space", text: pendingSpace });
    } else {
      for (const part of word.text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          segments.push({ kind: "space", text: part });
          continue;
        }
        const unit: MotionUnit = {
          refIndex: refIndex++,
          text: part,
          start: 0,
          duration: 1,
          glowDuration: 1,
        };
        units.push(unit);
        segments.push({ kind: "unit", unit });
      }
    }

    let leading = "";
    let trailing = "";
    const first = segments[0];
    if (first?.kind === "space") {
      leading = first.text;
      segments.shift();
    }
    const last = segments[segments.length - 1];
    if (last?.kind === "space") {
      trailing = last.text;
      segments.pop();
    }

    return { start, end, emphasis, leading, trailing, units, segments };
  });
}

interface SpringValue {
  position: number;
  velocity: number;
}

interface UnitTargets {
  scale: number;
  lift: number;
  glow: number;
  /** Moving front of the gradient fill, in percent. */
  fill: number;
}

interface UnitSprings {
  scale: SpringValue;
  lift: SpringValue;
  glow: SpringValue;
}

function springAt(position: number): SpringValue {
  return { position, velocity: 0 };
}

/**
 * The reference builds every idle syllable with its springs already resting
 * in the idle pose. When the line becomes active it only retargets them, so
 * the first word grows out of that pose instead of snapping to a mid-word
 * target. A word that is already finished starts settled instead.
 */
function initialSprings(swept: boolean, emphasis: boolean): UnitSprings {
  if (swept) {
    return {
      scale: springAt(1),
      lift: springAt(0),
      glow: springAt(0),
    };
  }
  return {
    scale: springAt(IDLE_SCALE),
    lift: springAt(emphasis ? IDLE_LIFT * 2 : IDLE_LIFT),
    glow: springAt(0),
  };
}

/**
 * Closed-form damped spring step. The envelopes are under-damped, so they
 * overshoot softly instead of easing straight to the keyframe.
 */
function stepSpring(
  spring: SpringValue,
  target: number,
  deltaTime: number,
  config: SpringConfig,
): void {
  if (deltaTime <= 0) return;
  const omega = config.frequency * Math.PI * 2;
  const zeta = config.damping;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * deltaTime);
  const cos = Math.cos(damped * deltaTime);
  const sin = Math.sin(damped * deltaTime);
  const offset = spring.position - target;

  const nextPosition =
    target +
    decay *
      (offset * cos +
        ((spring.velocity + zeta * omega * offset) / damped) * sin);
  const nextVelocity =
    decay *
    (spring.velocity * cos -
      ((zeta * omega * spring.velocity + omega * omega * offset) / damped) *
        sin);

  spring.position = nextPosition;
  spring.velocity = nextVelocity;

  if (
    Math.abs(nextPosition - target) < 0.0004 &&
    Math.abs(nextVelocity) < 0.002
  ) {
    spring.position = target;
    spring.velocity = 0;
  }
}

function motionTargets(
  progress: number,
  glowProgress: number,
  emphasis: boolean,
): UnitTargets {
  return {
    scale: sampleCurve(SCALE_CURVE, progress),
    lift: sampleCurve(LIFT_CURVE, progress) * (emphasis ? 2 : 1),
    glow: sampleCurve(GLOW_CURVE, glowProgress),
    fill: -20 + 120 * progress,
  };
}

interface LyricMotionOptions {
  active: boolean;
  enabled: boolean;
  isPlaying: boolean;
  positionMs: number;
  words: MotionWord[];
  targetRef: { readonly current: HTMLSpanElement | null };
}

/**
 * Imperative 60 Hz pass for the active line only. Each unit keeps its own
 * spring for scale, lift and glow, while the gradient front follows the
 * letter's own progress. That is what turns a sustained word into a wave
 * instead of a single pulsing block.
 */
function useLyricMotion({
  active,
  enabled,
  isPlaying,
  positionMs,
  words,
  targetRef,
}: LyricMotionOptions): void {
  const positionRef = useRef(positionMs);
  const playingRef = useRef(isPlaying);
  const anchorRef = useRef({ value: positionMs, at: 0 });

  useLayoutEffect(() => {
    positionRef.current = positionMs;
    playingRef.current = isPlaying;
    anchorRef.current = { value: positionMs, at: performance.now() };
  }, [positionMs, isPlaying]);

  useLayoutEffect(() => {
    if (!active || !enabled) return;
    const target = targetRef.current;
    if (!target || words.length === 0) return;

    const elements = new Map<number, HTMLElement>();
    target.querySelectorAll<HTMLElement>("[data-lyric-unit]").forEach((element) => {
      const index = Number(element.dataset.lyricUnit);
      if (Number.isFinite(index)) elements.set(index, element);
    });
    if (elements.size === 0) return;

    const wordElements = new Map<number, HTMLElement>();
    target.querySelectorAll<HTMLElement>("[data-lyric-word]").forEach((element) => {
      const index = Number(element.dataset.lyricWord);
      if (Number.isFinite(index)) wordElements.set(index, element);
    });

    const springs = new Map<number, UnitSprings>();
    const wordSprings = new Map<number, UnitSprings>();
    const written = new Map<number, string>();
    const wordWritten = new Map<number, string>();

    const apply = (position: number, deltaTime: number) => {
      const time = position + MOTION_LEAD_MS;

      for (const [wordIndex, word] of words.entries()) {
        const duration = Math.max(word.end - word.start, 1);
        const wordProgress = clamp01((time - word.start) / duration);
        // Letters start later than a linear split: the reference eases the
        // word progress first, then walks the letter windows.
        const easedWord = Math.sin((wordProgress * Math.PI) / 2);
        const swept = time >= word.end;

        /*
         * The reference moves the syllable container and its letters
         * separately, so the two transforms compound. Recreate that here:
         * the word gets the calm envelope, each letter the doubled one.
         */
        if (word.emphasis) {
          const wordElement = wordElements.get(wordIndex);
          if (wordElement) {
            const wordTargets = motionTargets(
              wordProgress,
              wordProgress,
              false,
            );
            let springsForWord = wordSprings.get(wordIndex);
            if (!springsForWord) {
              springsForWord = initialSprings(swept, false);
              wordSprings.set(wordIndex, springsForWord);
            }
            stepSpring(
              springsForWord.scale,
              wordTargets.scale,
              deltaTime,
              SCALE_SPRING,
            );
            stepSpring(
              springsForWord.lift,
              wordTargets.lift,
              deltaTime,
              LIFT_SPRING,
            );

            const wordScale = springsForWord.scale.position.toFixed(4);
            const wordLift = springsForWord.lift.position.toFixed(4);
            const wordSnapshot = `${wordScale}|${wordLift}`;
            if (wordWritten.get(wordIndex) !== wordSnapshot) {
              wordElement.style.setProperty("--word-s", wordScale);
              wordElement.style.setProperty("--word-y", wordLift);
              wordWritten.set(wordIndex, wordSnapshot);
            }
          }
        }

        for (const unit of word.units) {
          const progress = word.emphasis
            ? clamp01((easedWord - unit.start) / unit.duration)
            : wordProgress;
          const glowProgress = word.emphasis
            ? clamp01((easedWord - unit.start) / unit.glowDuration)
            : wordProgress;
          const targets = motionTargets(progress, glowProgress, word.emphasis);

          let unitSprings = springs.get(unit.refIndex);
          if (!unitSprings) {
            unitSprings = initialSprings(swept, word.emphasis);
            springs.set(unit.refIndex, unitSprings);
          }

          const element = elements.get(unit.refIndex);
          if (!element) continue;

          stepSpring(unitSprings.scale, targets.scale, deltaTime, SCALE_SPRING);
          stepSpring(unitSprings.lift, targets.lift, deltaTime, LIFT_SPRING);
          stepSpring(unitSprings.glow, targets.glow, deltaTime, GLOW_SPRING);

          const scale = unitSprings.scale.position.toFixed(4);
          const lift = unitSprings.lift.position.toFixed(4);
          // Springs overshoot; alpha and blur percentages cannot.
          const glow = clamp01(unitSprings.glow.position).toFixed(3);
          const fill = targets.fill.toFixed(1);
          const snapshot = `${scale}|${lift}|${glow}|${fill}`;
          if (written.get(unit.refIndex) === snapshot) continue;

          element.style.setProperty("--lyric-s", scale);
          element.style.setProperty("--lyric-y", lift);
          element.style.setProperty("--lyric-g", glow);
          element.style.setProperty("--lyric-p", fill);
          written.set(unit.refIndex, snapshot);
        }
      }
    };

    let frame = 0;
    let previousFrame = performance.now();
    const tick = (now: number) => {
      // A hidden window can produce a multi-second delta; clamp it so the
      // springs do not explode when playback comes back.
      const deltaTime = Math.min(0.05, Math.max(0, (now - previousFrame) / 1000));
      previousFrame = now;

      const anchor = anchorRef.current;
      const elapsed =
        anchor.at === 0
          ? 0
          : Math.min(180, Math.max(0, now - anchor.at));
      apply(
        playingRef.current ? anchor.value + elapsed : positionRef.current,
        deltaTime,
      );
      frame = requestAnimationFrame(tick);
    };

    apply(positionRef.current, 0);
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      for (const element of elements.values()) {
        element.style.removeProperty("--lyric-s");
        element.style.removeProperty("--lyric-y");
        element.style.removeProperty("--lyric-g");
        element.style.removeProperty("--lyric-p");
      }
      for (const element of wordElements.values()) {
        element.style.removeProperty("--word-s");
        element.style.removeProperty("--word-y");
      }
    };
  }, [active, enabled, targetRef, words]);
}

interface LyricsLineProps {
  line: LyricLine;
  index: number;
  active: boolean;
  /** The row is above the current position and has already been sung. */
  sung?: boolean;
  isPlaying: boolean;
  distance?: number;
  positionMs: number;
  mode: LyricsMode;
  onSeek: (time: number) => void;
  innerRef?: (element: HTMLDivElement | null) => void;
  align?: LyricsAlign;
  animated?: boolean;
  fadeBlur?: boolean;
  searchQuery?: string;
}

export const LyricsLine = memo(
  function LyricsLine({
    line,
    index,
    active,
    sung = false,
    isPlaying,
    distance = 0,
    positionMs,
    mode,
    onSeek,
    innerRef,
    align = "center",
    animated = true,
    fadeBlur = true,
    searchQuery,
  }: LyricsLineProps) {
    const karaoke = mode === "karaoke";
    const centered = align === "center";
    const right = align === "right";
    const blur = blurFor(distance, active, fadeBlur);
    const reducedMotion = useReducedMotion();
    const textRef = useRef<HTMLSpanElement>(null);

    const searchActive = Boolean(searchQuery?.trim());
    const motionEnabled =
      karaoke &&
      animated &&
      !reducedMotion &&
      !searchActive &&
      line.words.length > 0;

    const motionWords = useMemo(
      () => (motionEnabled ? buildMotionWords(line) : []),
      [line, motionEnabled],
    );

    useLyricMotion({
      active,
      enabled: motionEnabled,
      isPlaying,
      positionMs,
      words: motionWords,
      targetRef: textRef,
    });

    return (
      <motion.div
        ref={innerRef}
        data-index={index}
        initial={animated ? { opacity: 0, y: 18, filter: "blur(6px)" } : false}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{
          duration: animated ? 0.42 : 0,
          delay: animated ? Math.min(index * 0.028, 0.48) : 0,
          ease: EASE,
        }}
        style={{ contain: "layout" }}
      >
        <motion.button
          type="button"
          onClick={() => onSeek(line.time)}
          aria-current={active ? "true" : undefined}
          className={cn(
            "group relative block w-full outline-none",
            centered ? "text-center" : right ? "text-right" : "text-left",
          )}
          animate={{
            filter: animated && blur ? `blur(${blur}px)` : "blur(0px)",
          }}
          transition={{ duration: animated ? 0.1 : 0, ease: EASE }}
        >
          {!centered && (
            <motion.span
              aria-hidden
              className={cn(
                "absolute top-1/2 h-[1.15em] w-[2px] -translate-y-1/2 rounded-full bg-accent",
                right ? "-right-[18px]" : "-left-[18px]",
              )}
              animate={{
                opacity: active ? 1 : 0,
                scaleY: active ? 1 : 0.25,
              }}
              transition={{ duration: animated ? 0.28 : 0, ease: EASE }}
              style={{ boxShadow: "0 0 12px var(--accent-glow)" }}
            />
          )}

          <span
            ref={textRef}
            data-active={active ? "true" : "false"}
            data-sung={sung ? "true" : undefined}
            data-karaoke={karaoke ? "true" : undefined}
            style={{
              transformOrigin: centered
                ? "center center"
                : right
                  ? "right center"
                  : "left center",
            }}
            className={cn(
              "lyrics-line block break-words font-lyrics",
              active && "karaoke-active",
            )}
          >
            {motionEnabled ? (
              motionWords.map((word, wordIndex) => (
                <Fragment key={`w${wordIndex}-${word.start}`}>
                  {word.leading}
                  {word.units.length > 0 && (
                    <span
                      className={word.emphasis ? "lyrics-motion-word" : undefined}
                      data-emphasis={word.emphasis ? "true" : undefined}
                      data-lyric-word={word.emphasis ? wordIndex : undefined}
                    >
                      {word.segments.map((segment, segmentIndex) =>
                        segment.kind === "space" ? (
                          <span key={`s${segmentIndex}`}>{segment.text}</span>
                        ) : (
                          <span
                            key={`u${segment.unit.refIndex}`}
                            data-lyric-unit={segment.unit.refIndex}
                            className="lyrics-motion-unit"
                          >
                            {segment.unit.text}
                          </span>
                        ),
                      )}
                    </span>
                  )}
                  {word.trailing}
                </Fragment>
              ))
            ) : karaoke && line.words.length > 0 ? (
              line.words.map((word, wordIndex) => (
                <span
                  key={`${word.time}-${wordIndex}`}
                  className="transition-opacity duration-150 ease-linear"
                  style={
                    active
                      ? { opacity: positionMs + 20 >= word.time ? 1 : 0.34 }
                      : undefined
                  }
                >
                  {highlightText(word.text, searchQuery)}
                </span>
              ))
            ) : (
              highlightText(line.text, searchQuery)
            )}
          </span>
        </motion.button>
      </motion.div>
    );
  },
  (previous, next) => {
    if (previous.line !== next.line) return false;
    if (previous.active !== next.active) return false;
    if (previous.sung !== next.sung) return false;
    if (previous.isPlaying !== next.isPlaying) return false;
    if (previous.mode !== next.mode) return false;
    if (previous.index !== next.index) return false;
    if (previous.align !== next.align) return false;
    if (previous.animated !== next.animated) return false;
    if (previous.searchQuery !== next.searchQuery) return false;
    // Ignore distance changes that do not change the capped blur value.
    if (
      blurFor(previous.distance ?? 0, previous.active, previous.fadeBlur ?? true) !==
      blurFor(next.distance ?? 0, next.active, next.fadeBlur ?? true)
    ) {
      return false;
    }
    if (next.active && previous.positionMs !== next.positionMs) return false;
    return true;
  },
);
