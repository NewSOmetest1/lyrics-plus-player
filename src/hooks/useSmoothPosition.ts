import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "@/store/playerStore";

/**
 * Interpolates the 100 ms backend position for karaoke highlighting at 10 Hz.
 *
 * The anchor is only moved when the backend position catches up or jumps
 * (seek / track change), so the karaoke sweep never stutters backwards between
 * IPC packets. No requestAnimationFrame loop: hidden windows must stay cheap.
 */
export function useSmoothPosition(): number {
  const positionMs = usePlayerStore((state) => state.positionMs);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const durationMs = usePlayerStore((state) => state.durationMs);
  const [smooth, setSmooth] = useState(positionMs);
  const anchor = useRef({ base: positionMs, at: performance.now() });

  useEffect(() => {
    const now = performance.now();
    if (!isPlaying) {
      anchor.current = { base: positionMs, at: now };
      setSmooth(positionMs);
      return;
    }

    const predicted = anchor.current.base + (now - anchor.current.at);
    const drift = positionMs - predicted;

    if (drift < -90 || drift > 260) {
      anchor.current = { base: positionMs, at: now };
      setSmooth(positionMs);
    } else {
      // Keep the interpolated (slightly ahead) value, but re-anchor to the
      // authoritative backend clock to avoid unbounded drift.
      anchor.current = { base: Math.max(positionMs, predicted), at: now };
    }
  }, [positionMs, isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      setSmooth(anchor.current.base);
      return;
    }

    let frame = 0;
    const tick = () => {
      const { base, at } = anchor.current;
      const next = base + (performance.now() - at);
      setSmooth(durationMs > 0 ? Math.min(next, durationMs) : next);
    };
    frame = window.setInterval(tick, 100);
    return () => window.clearInterval(frame);
  }, [isPlaying, durationMs]);

  return smooth;
}
