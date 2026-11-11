import { Heart, ListMusic } from "lucide-react";

import type { Track } from "@/types";
import { LIKED_PLAYLIST_GRADIENT } from "@/types";
import { cn } from "@/lib/cn";
import { CoverArt } from "@/components/ui/CoverArt";

export function PlaylistCover({
  tracks,
  liked = false,
  size,
  className,
  iconClassName,
}: {
  tracks: Track[];
  liked?: boolean;
  size?: number;
  className?: string;
  iconClassName?: string;
}) {
  const cells = Array.from({ length: 4 }, (_, index) => tracks[index] ?? null);

  return (
    <span
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-lg bg-[#15151b] shadow-[inset_0_0_0_1px_rgba(255,255,255,.05)]",
        className,
      )}
      style={size ? { width: size, height: size } : undefined}
    >
      {liked ? (
        <span
          className="flex h-full w-full items-center justify-center"
          style={{ background: LIKED_PLAYLIST_GRADIENT }}
        >
          <Heart
            className="h-1/2 w-1/2 text-white drop-shadow-[0_6px_18px_rgba(0,0,0,.35)]"
            fill="currentColor"
            strokeWidth={1.4}
          />
        </span>
      ) : tracks.length === 0 ? (
        <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/25 via-accent/[0.06] to-white/[0.02]">
          <ListMusic
            className={cn("h-1/3 w-1/3 text-accent/75", iconClassName)}
            strokeWidth={1.8}
          />
        </span>
      ) : (
        <span className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px">
          {cells.map((track, index) =>
            track ? (
              <CoverArt
                key={`${track.id}-${index}`}
                track={track}
                className="h-full w-full min-h-0 rounded-none"
                iconClassName="h-2.5 w-2.5"
                showInitials={false}
                coverMenu={false}
              />
            ) : (
              <span
                key={`empty-${index}`}
                className="block h-full w-full bg-gradient-to-br from-white/[0.055] via-white/[0.025] to-transparent"
              />
            ),
          )}
        </span>
      )}
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/[0.08]" />
    </span>
  );
}
