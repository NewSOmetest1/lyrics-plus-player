import { Fragment } from "react";

import { cn } from "@/lib/cn";
import { splitArtistNames } from "@/lib/artists";
import { usePlayerStore } from "@/store/playerStore";

interface ArtistLinksProps {
  artistString: string;
  className?: string;
}

/**
 * Render every performer as a separate artist link while keeping the compact
 * "A, B" text shape used across the player and library.
 */
export function ArtistLinks({ artistString, className }: ArtistLinksProps) {
  const artists = splitArtistNames(artistString);
  if (artists.length === 0) return null;

  return (
    <span className={cn("inline", className)}>
      {artists.map((artist, index) => (
        <Fragment key={`${artist}-${index}`}>
          {index > 0 && ", "}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              usePlayerStore.getState().openArtist(artist);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            aria-label={`Open artist ${artist}`}
            title={`Open ${artist}`}
            className="inline cursor-pointer rounded-sm text-inherit transition-colors duration-150 hover:text-white hover:underline focus-visible:text-white focus-visible:underline focus-visible:outline-none"
          >
            {artist}
          </button>
        </Fragment>
      ))}
    </span>
  );
}
