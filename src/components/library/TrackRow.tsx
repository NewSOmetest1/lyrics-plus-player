import { memo, useState } from "react";
import { Heart, Play } from "lucide-react";
import type { Track } from "@/types";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { CoverArt } from "@/components/ui/CoverArt";
import { EqualizerBars } from "@/components/ui/EqualizerBars";
import { ArtistLinks } from "@/components/artists/ArtistLinks";
import { useTrackMenuStore } from "@/store/contextMenuStore";

interface TrackRowProps {
  track: Track;
  index: number;
  active: boolean;
  playing: boolean;
  onPlay: (track: Track) => void;
}

function formatBadge(format: string) {
  const lossless = ["FLAC", "WAV", "AIFF", "WAVPACK"].includes(format);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[5px] border px-1.5 py-0.5 text-[8.5px] font-bold tracking-[0.08em]",
        lossless
          ? "border-accent/25 bg-accent/10 text-accent/90"
          : "border-white/10 bg-white/[0.04] text-white/40",
      )}
    >
      {format}
    </span>
  );
}

export const TrackRow = memo(function TrackRow({
  track,
  index,
  active,
  playing,
  onPlay,
}: TrackRowProps) {
  const [liked, setLiked] = useState(false);

  return (
    <div
      className={cn(
        "track-row-lazy group relative flex h-[58px] items-center gap-3 rounded-xl px-2.5 text-left transition-colors duration-200",
        active ? "bg-white/[0.07]" : "hover:bg-white/[0.045]",
      )}
      onDoubleClick={() => onPlay(track)}
      onContextMenu={(event) => {
        event.preventDefault();
        useTrackMenuStore
          .getState()
          .openMenu(track, event.clientX, event.clientY);
      }}
    >
      <div className="relative flex w-7 shrink-0 items-center justify-center">
        {active && playing ? (
          <EqualizerBars playing className="h-4" />
        ) : (
          <>
            <span
              className={cn(
                "text-[11px] tabular-nums transition-opacity group-hover:opacity-0",
                active ? "text-accent" : "text-white/25",
              )}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <button
              type="button"
              onClick={() => onPlay(track)}
              aria-label={`Play ${track.title}`}
              className="absolute flex h-7 w-7 items-center justify-center rounded-full text-white opacity-0 transition hover:scale-110 group-hover:opacity-100"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
            </button>
          </>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          onClick={() => onPlay(track)}
          aria-label={`Play ${track.title}`}
          className="shrink-0 rounded-[7px] outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <CoverArt
            track={track}
            width={40}
            height={40}
            className="aspect-square h-10 w-10 shrink-0 rounded-[7px]"
            iconClassName="h-4 w-4"
            showInitials={false}
          />
        </button>
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onPlay(track)}
            className={cn(
              "block max-w-full truncate text-left text-[13px] font-semibold transition-colors",
              active ? "text-accent" : "text-white/85 group-hover:text-white",
            )}
          >
            {track.title}
          </button>
          <ArtistLinks
            artistString={track.artist}
            className="mt-0.5 block truncate text-[11px] text-white/35"
          />
        </div>
      </div>

      <div className="hidden w-[26%] min-w-0 shrink-0 xl:block">
        <span className="block truncate text-[11.5px] text-white/35">{track.album}</span>
      </div>

      <div className="hidden w-[76px] shrink-0 justify-center md:flex">
        {formatBadge(track.format)}
      </div>

      <div className="w-11 shrink-0 text-right text-[11px] tabular-nums text-white/30">
        {formatTime(track.durationMs)}
      </div>

      <button
        type="button"
        onClick={() => setLiked((value) => !value)}
        aria-label={liked ? "Remove from favourites" : "Add to favourites"}
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition",
          liked
            ? "text-rose-400 opacity-100"
            : "text-white/25 opacity-0 hover:text-white/70 group-hover:opacity-100",
        )}
      >
        <Heart className={cn("h-3.5 w-3.5", liked && "fill-current")} />
      </button>
    </div>
  );
});
