import { memo, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { LyricsMode, LyricLine } from "@/types";
import type { LyricsAlign } from "@/store/settingsStore";
import { cn } from "@/lib/cn";

const EASE = [0.2, 0, 0, 1] as const;

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
        className="rounded-[3px] bg-accent/30 text-inherit shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

interface LyricsLineProps {
  line: LyricLine;
  index: number;
  active: boolean;
  distance?: number;
  positionMs: number;
  mode: LyricsMode;
  onSeek: (time: number) => void;
  innerRef?: (element: HTMLDivElement | null) => void;
  align?: LyricsAlign;
  fontSize?: number;
  animated?: boolean;
  fadeBlur?: boolean;
  searchQuery?: string;
}

export const LyricsLine = memo(
  function LyricsLine({
    line,
    index,
    active,
    distance = 0,
    positionMs,
    mode,
    onSeek,
    innerRef,
    align = "center",
    fontSize = 36,
    animated = true,
    fadeBlur = true,
    searchQuery,
  }: LyricsLineProps) {
    const karaoke = mode === "karaoke";
    const centered = align === "center";
    const right = align === "right";
    const blur = blurFor(distance, active, fadeBlur);

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
            "group relative block w-full outline-none focus-visible:ring-1 focus-visible:ring-accent/50",
            centered ? "text-center" : right ? "text-right" : "text-left",
          )}
          animate={{
            filter: animated && blur ? `blur(${blur}px)` : "blur(0px)",
          }}
          transition={{ duration: animated ? 0.25 : 0, ease: EASE }}
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
            data-active={active ? "true" : "false"}
            className={cn(
              "lyrics-line block break-words font-lyrics",
              active && "karaoke-active",
            )}
            style={{ fontSize: `${fontSize}px` }}
          >
            {karaoke && line.words.length > 0
              ? line.words.map((word, wordIndex) => (
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
              : highlightText(line.text, searchQuery)}
          </span>
        </motion.button>
      </motion.div>
    );
  },
  (previous, next) => {
    if (previous.line !== next.line) return false;
    if (previous.active !== next.active) return false;
    if (previous.mode !== next.mode) return false;
    if (previous.index !== next.index) return false;
    if (previous.align !== next.align) return false;
    if (previous.fontSize !== next.fontSize) return false;
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
