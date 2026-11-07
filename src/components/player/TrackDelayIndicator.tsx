import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Timer } from "lucide-react";

import {
  TRACK_DELAY_EVENT,
  formatTrackDelay,
} from "@/store/trackDelayStore";

const EASE = [0.2, 0, 0, 1] as const;
const VISIBLE_MS = 1400;

/**
 * Centered micro-indicator for the [ and ] calibration hotkeys.
 * It lives inside the karaoke view and never blocks pointer interaction.
 */
export function TrackDelayIndicator() {
  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<number>).detail;
      if (!Number.isFinite(detail)) return;
      setOffsetMs(Math.round(detail));
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        setOffsetMs(null);
        hideTimer.current = null;
      }, VISIBLE_MS);
    };

    window.addEventListener(TRACK_DELAY_EVENT, show);
    return () => {
      window.removeEventListener(TRACK_DELAY_EVENT, show);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-6"
    >
      <AnimatePresence>
        {offsetMs !== null && (
          <motion.div
            key="track-delay-indicator"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="glass flex items-center gap-2 rounded-full border border-accent/25 bg-black/35 px-4 py-2 shadow-2xl backdrop-blur-xl"
          >
            <Timer className="h-3.5 w-3.5 text-accent" />
            <span className="text-[12px] font-medium text-white/75">
              Track delay:
            </span>
            <span className="text-[13px] font-bold tabular-nums text-accent">
              {formatTrackDelay(offsetMs)}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
