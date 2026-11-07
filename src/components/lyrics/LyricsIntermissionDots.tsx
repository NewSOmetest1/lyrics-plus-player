import { cn } from "@/lib/cn";

const COUNTDOWN_MS = 3_000;

interface LyricsIntermissionDotsProps {
  active: boolean;
  /** Playback is not advancing: freeze the wave and the countdown. */
  isPlaying: boolean;
  /** Milliseconds until the next sung line. */
  remainingMs: number;
  innerRef?: (element: HTMLDivElement | null) => void;
  className?: string;
}

/**
 * Three dots for an instrumental break. They breathe as a wave until the final
 * three seconds, then light up one by one as a 3-2-1 lead-in before the vocal
 * returns. Purely decorative, so assistive tech ignores the row.
 */
export function LyricsIntermissionDots({
  active,
  isPlaying,
  remainingMs,
  innerRef,
  className,
}: LyricsIntermissionDotsProps) {
  const counting = active && remainingMs > 0 && remainingMs <= COUNTDOWN_MS;
  const step = !counting ? -1 : remainingMs > 2_000 ? 0 : remainingMs > 1_000 ? 1 : 2;

  return (
    <div
      ref={innerRef}
      className={cn(
        "lyrics-intermission",
        !isPlaying && "is-paused",
        className,
      )}
      data-active={active ? "true" : "false"}
      data-counting={counting ? "true" : "false"}
      data-paused={!isPlaying ? "true" : "false"}
      aria-hidden="true"
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={`dot dot-${index + 1}`}
          data-lit={counting && index <= step ? "true" : "false"}
          data-current={counting && index === step ? "true" : "false"}
        />
      ))}
    </div>
  );
}
