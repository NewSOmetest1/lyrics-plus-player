import { cn } from "@/lib/cn";

interface EqualizerBarsProps {
  playing: boolean;
  className?: string;
  /** Number of bars. Defaults to the four-bar mark used across lists. */
  bars?: number;
}

export function EqualizerBars({ playing, className, bars = 4 }: EqualizerBarsProps) {
  return (
    <span className={cn("eq-bars", playing && "is-playing", className)} aria-hidden>
      {Array.from({ length: bars }, (_, index) => (
        <span key={index} />
      ))}
    </span>
  );
}
