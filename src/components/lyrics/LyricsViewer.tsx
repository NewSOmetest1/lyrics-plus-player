import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { motion } from "framer-motion";
import { CornerDownLeft, Search, X } from "lucide-react";
import type { LyricsMode, LyricLine } from "@/types";
import { activeLineIndex, ensureWordTimings } from "@/lib/lrc";
import {
  buildLyricRows,
  type LyricIntermissionRow,
  type LyricLineRow,
} from "@/lib/intermissions";
import { usePlayerStore } from "@/store/playerStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useTrackDelayStore } from "@/store/trackDelayStore";
import { useSmoothPosition } from "@/hooks/useSmoothPosition";
import { LyricsIntermissionDots } from "@/components/lyrics/LyricsIntermissionDots";
import { LyricsLine } from "@/components/lyrics/LyricsLine";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/cn";

const EASE = [0.2, 0, 0, 1] as const;

interface LyricsViewerProps {
  mode: LyricsMode;
}

export function LyricsViewer({ mode }: LyricsViewerProps) {
  const lines = usePlayerStore((state) => state.lyrics);
  const seek = usePlayerStore((state) => state.seek);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const position = useSmoothPosition();

  const align = useSettingsStore((state) => state.lyricsAlign);
  const fontSize = useSettingsStore((state) => state.lyricsSize);
  const opacity = useSettingsStore((state) => state.lyricsOpacity);
  const animated = useSettingsStore((state) => state.lyricsAnimated);
  const globalDelay = useSettingsStore((state) => state.lyricsOffset);
  const trackDelay = useTrackDelayStore((state) =>
    currentTrack ? state.delays[currentTrack.path] ?? 0 : 0,
  );
  const compactMode = useSettingsStore((state) => state.compactMode);
  const compactBefore = useSettingsStore((state) => state.compactBefore);
  const compactAfter = useSettingsStore((state) => state.compactAfter);
  const fadeBlur = useSettingsStore((state) => state.fadeBlur);
  const activeTextColor = useSettingsStore((state) => state.activeTextColor);
  const inactiveTextColor = useSettingsStore((state) => state.inactiveTextColor);

  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const intermissionRefs = useRef(new Map<string, HTMLDivElement>());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedResult, setSelectedResult] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // effectiveDelay = (settings.globalDelay || 0) + (trackCustomDelay || 0)
  // effectiveTime = currentTime - (effectiveDelay / 1000)
  // Positions are in milliseconds here, so the same formula is applied in ms.
  const effectiveDelay = (globalDelay || 0) + (trackDelay || 0);
  const displayPosition = position - effectiveDelay;

  // Karaoke must never depend on the provider supplying word tags. If a line
  // has only a line timestamp, estimate its word timings at render time too.
  const displayLines = useMemo(
    () => (mode === "karaoke" ? ensureWordTimings(lines) : lines),
    [lines, mode],
  );

  const rows = useMemo(() => buildLyricRows(displayLines), [displayLines]);

  const activeIndex = useMemo(
    () =>
      mode === "unsynced" ? -1 : activeLineIndex(displayLines, displayPosition),
    [displayLines, displayPosition, mode],
  );
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const activeIntermission = useMemo(() => {
    if (mode === "unsynced") return null;

    // Hard guard: never cover a line while its vocal is still running, even if
    // an intermission row is ever built with a too-early start time.
    const activeLine =
      activeIndex >= 0
        ? rows.find(
            (row): row is LyricLineRow =>
              row.kind === "line" && row.lineIndex === activeIndex,
          )
        : null;
    if (activeLine && displayPosition < activeLine.lineEndMs) return null;

    return (
      rows.find(
        (row): row is LyricIntermissionRow =>
          row.kind === "intermission" &&
          displayPosition >= row.startMs &&
          displayPosition < row.endMs,
      ) ?? null
    );
  }, [rows, displayPosition, mode, activeIndex]);
  const activeIntermissionId = activeIntermission?.id ?? null;
  const activeIntermissionIdRef = useRef(activeIntermissionId);
  activeIntermissionIdRef.current = activeIntermissionId;

  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!searchOpen || !needle) return [] as Array<{ line: LyricLine; index: number }>;
    return displayLines
      .map((line, index) => ({ line, index }))
      .filter((item) => item.line.text.toLowerCase().includes(needle));
  }, [displayLines, query, searchOpen]);

  useEffect(() => {
    setSelectedResult(0);
  }, [query]);

  useEffect(() => {
    const openSearch = () => {
      if (mode === "unsynced" || displayLines.length === 0) return;
      setSearchOpen(true);
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    window.addEventListener("lyricsplus:lyrics-search", openSearch);
    return () => window.removeEventListener("lyricsplus:lyrics-search", openSearch);
  }, [displayLines.length, mode]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
  }, []);

  const jumpToSearchResult = useCallback(
    (line: LyricLine) => {
      seek(line.time);
      closeSearch();
    },
    [closeSearch, seek],
  );

  /**
   * Keep the active lyrics row vertically centred inside the scroll container.
   * During an instrumental break the intermission row is the focus, so the
   * dots get the same smooth scroll treatment as a lyric line.
   */
  const centerActiveRow = useCallback(
    (
      index: number,
      intermissionId: string | null,
      behavior: ScrollBehavior,
    ) => {
      const container = containerRef.current;
      if (!container || mode === "unsynced") return;
      const element = intermissionId
        ? intermissionRefs.current.get(intermissionId)
        : lineRefs.current[index >= 0 ? index : 0];
      if (!element) return;
      const max = Math.max(0, container.scrollHeight - container.clientHeight);
      const top = Math.min(
        max,
        Math.max(
          0,
          element.offsetTop - container.clientHeight / 2 + element.offsetHeight / 2,
        ),
      );
      // Native smooth scroll can emit sub-pixel repeats; ignore no-op writes.
      if (Math.abs(container.scrollTop - top) < 1) return;
      container.scrollTo({ top, behavior });
    },
    [mode],
  );

  const visibleRows = useMemo(() => {
    if (!compactMode) return rows;
    const anchor = activeIndex >= 0 ? activeIndex : 0;
    const start = Math.max(0, anchor - compactBefore);
    const end = Math.min(displayLines.length - 1, anchor + compactAfter);
    return rows.filter((row) => {
      if (row.kind === "line") {
        return row.lineIndex >= start && row.lineIndex <= end;
      }
      if (row.id === activeIntermissionId) return true;
      return (
        (row.prevLineIndex >= start && row.prevLineIndex <= end) ||
        (row.nextLineIndex >= start && row.nextLineIndex <= end)
      );
    });
  }, [
    rows,
    compactMode,
    compactBefore,
    compactAfter,
    activeIndex,
    displayLines.length,
    activeIntermissionId,
  ]);

  const setLineRef = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const index = Number(element.dataset.index);
    if (Number.isFinite(index)) lineRefs.current[index] = element;
  }, []);

  const setIntermissionRef = useCallback(
    (id: string, element: HTMLDivElement | null) => {
      if (element) intermissionRefs.current.set(id, element);
      else intermissionRefs.current.delete(id);
    },
    [],
  );

  const activeRowKey = activeIntermissionId
    ? `intermission:${activeIntermissionId}`
    : `line:${activeIndex}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () =>
      setSize({ width: container.clientWidth, height: container.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const didCenterRef = useRef(false);
  const fontsCenteredRef = useRef(false);

  // Layout changes (resize, font, alignment) re-center instantly. Animating
  // here would restart the scroll and look like a jump.
  useLayoutEffect(() => {
    lineRefs.current.length = displayLines.length;
    if (mode === "unsynced") return;
    centerActiveRow(
      activeIndexRef.current,
      activeIntermissionIdRef.current,
      "auto",
    );
  }, [
    displayLines,
    mode,
    size.height,
    size.width,
    fontSize,
    align,
    compactMode,
    compactBefore,
    compactAfter,
    centerActiveRow,
  ]);

  // Playback-driven row changes are the only source of smooth scrolling. This
  // fires when a break starts (line -> dots) and when the next line arrives.
  useLayoutEffect(() => {
    if (mode === "unsynced") return;
    if (!didCenterRef.current) {
      didCenterRef.current = true;
      return;
    }
    centerActiveRow(
      activeIndex,
      activeIntermissionId,
      animated ? "smooth" : "auto",
    );
  }, [
    activeRowKey,
    activeIndex,
    activeIntermissionId,
    animated,
    centerActiveRow,
    mode,
  ]);

  // Fonts load once; re-centre once without hijacking later line changes.
  useEffect(() => {
    if (fontsCenteredRef.current || !document.fonts?.ready) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled || fontsCenteredRef.current) return;
      fontsCenteredRef.current = true;
      centerActiveRow(
        activeIndexRef.current,
        activeIntermissionIdRef.current,
        "auto",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [centerActiveRow]);

  const textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
  const themeVars = {
    "--lyrics-active": activeTextColor,
    "--lyrics-inactive": inactiveTextColor,
  } as CSSProperties;

  if (mode === "unsynced") {
    return (
      <div
        ref={containerRef}
        className="no-scrollbar h-full overflow-y-auto px-8 sm:px-12"
        style={{
          ...themeVars,
          opacity,
          maskImage:
            "linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)",
        }}
      >
        <div className="mx-auto max-w-[720px] py-10">
          {lines.map((line, index) => (
            <motion.p
              key={`${line.text}-${index}`}
              initial={animated ? { opacity: 0, y: 10 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.4,
                delay: animated ? Math.min(index * 0.02, 0.4) : 0,
                ease: EASE,
              }}
              className="py-2 font-lyrics font-medium leading-relaxed transition-colors hover:text-white/80"
              style={{
                fontSize: `${fontSize}px`,
                textAlign,
                color: "var(--lyrics-inactive)",
              }}
            >
              {line.text}
            </motion.p>
          ))}
          {lines.length === 0 && (
            <p className="py-20 text-center text-[13px] text-white/30">
              No unsynced lyrics available.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div
        ref={containerRef}
        className="lyrics-scroll no-scrollbar relative h-full overflow-y-auto overflow-x-hidden"
        style={{
          ...themeVars,
          opacity,
          maskImage:
            "linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)",
        }}
      >
        <div
          className="mx-auto flex w-[90%] max-w-[1100px] flex-col gap-[28px] px-4 sm:px-8"
          style={{ paddingTop: size.height / 2, paddingBottom: size.height / 2 }}
        >
          {visibleRows.map((row) => {
            if (row.kind === "intermission") {
              return (
                <LyricsIntermissionDots
                  key={row.key}
                  innerRef={(element) => setIntermissionRef(row.id, element)}
                  active={row.id === activeIntermissionId}
                  isPlaying={isPlaying}
                  remainingMs={
                    row.id === activeIntermissionId
                      ? Math.max(0, row.endMs - displayPosition)
                      : 0
                  }
                />
              );
            }

            const { line, lineIndex } = row;
            const lineActive =
              lineIndex === activeIndex && !activeIntermission;
            return (
              <LyricsLine
                key={row.key}
                line={line}
                index={lineIndex}
                active={lineActive}
                distance={activeIndex >= 0 ? Math.abs(lineIndex - activeIndex) : 0}
                positionMs={lineActive ? displayPosition : 0}
                mode={mode}
                onSeek={seek}
                innerRef={setLineRef}
                align={align}
                fontSize={fontSize}
                animated={animated}
                fadeBlur={fadeBlur}
                searchQuery={searchOpen ? query : undefined}
              />
            );
          })}
        </div>
      </div>

      {searchOpen && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-4">
          <div className="glass pointer-events-auto w-full max-w-[440px] overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
            <div className="flex items-center gap-2 px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-white/35" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeSearch();
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const result = searchResults[selectedResult] ?? searchResults[0];
                    if (result) jumpToSearchResult(result.line);
                    return;
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSelectedResult((current) =>
                      searchResults.length === 0
                        ? 0
                        : (current + 1) % searchResults.length,
                    );
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelectedResult((current) =>
                      searchResults.length === 0
                        ? 0
                        : (current - 1 + searchResults.length) % searchResults.length,
                    );
                  }
                }}
                placeholder="Search lyrics…"
                aria-label="Search lyrics"
                spellCheck={false}
                autoComplete="off"
                className="h-7 min-w-0 flex-1 bg-transparent text-[12.5px] text-white outline-none placeholder:text-white/25"
              />
              {query.trim() && (
                <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] font-semibold tabular-nums text-white/40">
                  {searchResults.length}
                </span>
              )}
              <button
                type="button"
                onClick={closeSearch}
                aria-label="Close lyrics search"
                className="shrink-0 rounded-md p-1 text-white/30 transition hover:bg-white/[0.06] hover:text-white/75"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {query.trim() ? (
              <div className="no-scrollbar max-h-[min(42vh,320px)] overflow-y-auto border-t border-white/[0.06] p-1.5">
                {searchResults.length > 0 ? (
                  searchResults.slice(0, 40).map(({ line, index }, resultIndex) => (
                    <button
                      key={`${line.time}-${index}`}
                      type="button"
                      onMouseEnter={() => setSelectedResult(resultIndex)}
                      onClick={() => jumpToSearchResult(line)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition",
                        resultIndex === selectedResult
                          ? "bg-white/[0.09]"
                          : "hover:bg-white/[0.05]",
                      )}
                    >
                      <span className="mt-px shrink-0 rounded bg-white/[0.06] px-1 py-0.5 text-[9px] font-semibold tabular-nums text-white/35">
                        {formatTime(line.time)}
                      </span>
                      <span className="line-clamp-2 min-w-0 flex-1 text-[11.5px] leading-snug text-white/70">
                        {line.text}
                      </span>
                      {resultIndex === selectedResult && (
                        <CornerDownLeft className="mt-0.5 h-3 w-3 shrink-0 text-white/25" />
                      )}
                    </button>
                  ))
                ) : (
                  <p className="px-2 py-4 text-center text-[11px] text-white/30">
                    No matching lines in this song.
                  </p>
                )}
              </div>
            ) : (
              <div className="border-t border-white/[0.06] px-3 py-2 text-[10px] text-white/25">
                Type a word or phrase. Enter jumps to the first match.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
