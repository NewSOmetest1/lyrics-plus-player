import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";

interface ProgressBarProps {
  positionMs: number;
  durationMs: number;
  onSeek: (positionMs: number) => void;
  compact?: boolean;
}

export function ProgressBar({
  positionMs,
  durationMs,
  onSeek,
  compact = false,
}: ProgressBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; ms: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const duration = Math.max(durationMs, 1);
  const percent = Math.min(100, Math.max(0, (positionMs / duration) * 100));

  const compute = (clientX: number) => {
    const element = barRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return { ratio, ms: ratio * durationMs, x: ratio * rect.width };
  };

  return (
    <div className="flex w-full items-center gap-2.5">
      <span className="w-10 shrink-0 text-right font-mono text-[11px] leading-none tabular-nums text-white/60">
        {formatTime(positionMs)}
      </span>

      <div
        ref={barRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs)}
        aria-valuenow={Math.round(positionMs)}
        tabIndex={0}
        className={cn(
          "group/progress relative flex-1 cursor-pointer touch-none outline-none focus-visible:ring-1 focus-visible:ring-accent/60",
          compact ? "h-2" : "h-4",
        )}
        onPointerDown={(event) => {
          event.preventDefault();
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = compute(event.clientX);
          if (point) {
            setHover({ x: point.x, ms: point.ms });
            onSeek(point.ms);
          }
        }}
        onPointerMove={(event) => {
          const point = compute(event.clientX);
          if (!point) return;
          setHover({ x: point.x, ms: point.ms });
          if (dragging) onSeek(point.ms);
        }}
        onPointerUp={(event) => {
          setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => setDragging(false)}
        onPointerLeave={() => {
          if (!dragging) setHover(null);
        }}
      >
        <div className="lucid-progress-track absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-[2px] bg-white/[0.12]">
          <div
            className="h-full rounded-[2px] bg-white/80 transition-[background-color] duration-200 group-hover/progress:bg-accent"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div
          className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${percent}%` }}
        >
          <div className="h-1 w-1 rounded-full bg-white/80 shadow-[0_0_6px_rgba(255,255,255,.35)] transition-[transform,background-color] duration-150 ease-out group-hover/progress:scale-[2.5] group-hover/progress:bg-white group-focus-visible/progress:scale-[2.5]" />
        </div>

        {hover && (
          <div
            className="pointer-events-none absolute bottom-full z-20 mb-1 -translate-x-1/2 rounded-md border border-white/10 bg-[#18181f]/95 px-2 py-1 text-[9.5px] font-semibold tabular-nums text-white/85 shadow-xl backdrop-blur"
            style={{ left: `${hover.x}px` }}
          >
            {formatTime(hover.ms)}
            <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-white/10 bg-[#18181f]" />
          </div>
        )}
      </div>

      <span className="w-10 shrink-0 font-mono text-[11px] leading-none tabular-nums text-white/60">
        {formatTime(durationMs)}
      </span>
    </div>
  );
}
