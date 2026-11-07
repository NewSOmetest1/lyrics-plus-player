import { useEffect, useMemo, useState } from "react";
import { Music2 } from "lucide-react";
import type { Track } from "@/types";
import { coverUrl } from "@/lib/api";
import { cn } from "@/lib/cn";
import { paletteFromHash } from "@/lib/colors";
import { initials } from "@/lib/format";

interface CoverArtProps {
  track: Track | null;
  full?: boolean;
  className?: string;
  iconClassName?: string;
  showInitials?: boolean;
  /** Intrinsic dimensions for the <img>; CSS controls the rendered size. */
  width?: number;
  height?: number;
}

export function CoverArt({
  track,
  full = false,
  className,
  iconClassName,
  showInitials = true,
  width,
  height,
}: CoverArtProps) {
  const url = useMemo(() => coverUrl(track, full), [track, full]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  const palette = useMemo(
    () => paletteFromHash(track ? `${track.title}${track.album}${track.artist}` : "lyricsplus"),
    [track],
  );
  const usable = Boolean(url) && !failed;

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden bg-white/[0.04]",
        className,
      )}
      style={
        usable
          ? undefined
          : {
              background: `linear-gradient(140deg, ${palette.primary} 0%, ${palette.secondary} 58%, #101014 100%)`,
            }
      }
    >
      {usable ? (
        <img
          src={url ?? undefined}
          alt={track ? `${track.title} cover` : "Cover art"}
          width={width}
          height={height}
          className="h-full w-full object-cover"
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          {showInitials && track ? (
            <span className="select-none font-display text-[clamp(0.8rem,1.6vw,2rem)] font-extrabold tracking-tight text-white/90 drop-shadow-lg">
              {initials(track.title)}
            </span>
          ) : (
            <Music2 className={cn("h-1/3 w-1/3 text-white/70", iconClassName)} />
          )}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10" />
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-t from-black/20 via-transparent to-white/[0.04]" />
    </div>
  );
}
