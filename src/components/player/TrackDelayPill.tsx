import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Minus, Plus, RotateCcw, Timer } from "lucide-react";

import { usePlayerStore } from "@/store/playerStore";
import {
  TRACK_DELAY_SHIFT_STEP,
  TRACK_DELAY_STEP,
  formatTrackDelay,
  useTrackDelayStore,
} from "@/store/trackDelayStore";
import { cn } from "@/lib/cn";
import { HEADER_BADGE_CLASS } from "@/components/player/headerBadge";

/**
 * Compact per-track delay pill for the karaoke header. Click or hover reveals
 * the micro controls; the pill itself stays quiet until the track is manually
 * calibrated.
 */
export function TrackDelayPill() {
  const track = usePlayerStore((state) => state.currentTrack);
  const trackKey = track?.path ?? null;
  const offsetMs = useTrackDelayStore((state) =>
    trackKey ? state.delays[trackKey] ?? 0 : 0,
  );
  const adjustDelay = useTrackDelayStore((state) => state.adjustDelay);
  const resetTrack = useTrackDelayStore((state) => state.resetTrack);

  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const custom = offsetMs !== 0;

  useEffect(() => {
    setExpanded(false);
  }, [trackKey]);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setExpanded(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [expanded]);

  const step = (event: ReactMouseEvent<HTMLButtonElement>, direction: -1 | 1) => {
    if (!trackKey) return;
    const delta = event.shiftKey ? TRACK_DELAY_SHIFT_STEP : TRACK_DELAY_STEP;
    adjustDelay(trackKey, direction * delta);
  };

  return (
    <div ref={containerRef} className={cn(HEADER_BADGE_CLASS, "group gap-0 overflow-hidden")}>
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        onAuxClick={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          if (trackKey) resetTrack(trackKey);
          setExpanded(false);
        }}
        onMouseDown={(event) => {
          // Stop Chromium's middle-click autoscroll before the reset fires.
          if (event.button === 1) event.preventDefault();
        }}
        disabled={!trackKey}
        aria-expanded={expanded}
        aria-label={`Track delay ${formatTrackDelay(offsetMs)}. Click to adjust, middle-click to reset.`}
        title="Track delay — click or hover for ±100 ms (Shift ±500 ms), middle-click to reset. Hotkeys: [ and ]"
        className={cn(
          "flex h-full items-center gap-1.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40 disabled:pointer-events-none disabled:opacity-40",
          expanded ? "pr-1" : "pr-0",
        )}
      >
        <Timer className="h-3 w-3 shrink-0" />
        <span className="whitespace-nowrap tabular-nums">
          {formatTrackDelay(offsetMs)}
        </span>
      </button>

      <div
        className={cn(
          "flex items-center overflow-hidden transition-all duration-200",
          expanded
            ? "max-w-[92px] opacity-100"
            : "max-w-0 opacity-0 group-hover:max-w-[92px] group-hover:opacity-100 group-focus-within:max-w-[92px] group-focus-within:opacity-100",
        )}
      >
        <span aria-hidden className="h-3 w-px shrink-0 bg-current opacity-15" />
        <button
          type="button"
          onClick={(event) => step(event, -1)}
          aria-label="Decrease track delay by 100 milliseconds"
          title="Decrease by 100 ms (Shift: 500 ms)"
          className="flex h-5 w-5 items-center justify-center opacity-70 transition hover:bg-white/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40"
        >
          <Minus className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(event) => step(event, 1)}
          aria-label="Increase track delay by 100 milliseconds"
          title="Increase by 100 ms (Shift: 500 ms)"
          className="flex h-5 w-5 items-center justify-center opacity-70 transition hover:bg-white/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40"
        >
          <Plus className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (trackKey) resetTrack(trackKey);
            setExpanded(false);
          }}
          disabled={!custom}
          aria-label="Reset this track's delay"
          title="Reset this track to 0 ms"
          className="mr-1 flex h-5 w-5 items-center justify-center opacity-60 transition hover:bg-white/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40 disabled:pointer-events-none disabled:opacity-25"
        >
          <RotateCcw className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  );
}
