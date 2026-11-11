import { memo, useMemo, type RefObject } from "react";
import { Play, UserRound } from "lucide-react";

import type { ArtistGroup } from "@/types";
import { formatCount } from "@/lib/format";
import { useArtistGroups } from "@/hooks/useArtistGroups";
import { usePlayerStore } from "@/store/playerStore";
import { ArtistAvatar } from "@/components/artists/ArtistAvatar";
import { VirtualMediaGrid } from "@/components/library/VirtualMediaGrid";

/**
 * One card in a grid that can contain hundreds of artists. Kept out of the
 * animation loop: the parent only re-renders when the artist list changes, and
 * `memo` stops playback/UI updates from touching every card.
 */
const ArtistCard = memo(function ArtistCard({ artist }: { artist: ArtistGroup }) {
  const open = () => {
    usePlayerStore.getState().openArtist(artist.name);
  };

  const playShuffled = () => {
    if (artist.tracks.length === 0) return;
    const { playTrack, setShuffle } = usePlayerStore.getState();
    setShuffle(true);
    const start =
      artist.tracks[Math.floor(Math.random() * artist.tracks.length)];
    void playTrack(start, 0, artist.tracks);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${artist.name}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      className="artist-card lucid-glass-panel group relative min-w-0 cursor-pointer rounded-2xl p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <div className="relative">
        <ArtistAvatar
          name={artist.name}
          coverTrack={artist.coverTrack}
          className="artist-card-cover aspect-square w-full rounded-full"
          iconClassName="h-8 w-8"
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            playShuffled();
          }}
          aria-label={`Play ${artist.name} shuffled`}
          title="Play shuffled"
          className="absolute bottom-2 right-2 flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-accent text-black opacity-0 shadow-glow transition-all duration-[250ms] ease-out group-hover:translate-y-0 group-hover:opacity-100 hover:brightness-110 focus-visible:translate-y-0 focus-visible:opacity-100 active:scale-95"
        >
          <Play className="ml-0.5 h-4 w-4 fill-current" />
        </button>
      </div>

      <p className="mt-3 truncate text-[15px] font-bold text-white/90 transition-colors group-hover:text-white">
        {artist.name}
      </p>
      <p className="mt-0.5 truncate text-[13px] text-white/50">
        Artist <span className="text-white/20">•</span>{" "}
        {formatCount(artist.trackCount, "track")}
      </p>
    </div>
  );
});

export const ArtistGrid = memo(function ArtistGrid({
  query = "",
  scrollRef,
}: {
  query?: string;
  scrollRef: RefObject<HTMLDivElement>;
}) {
  // `useArtistGroups` already memoizes the aggregation by tracks reference, so
  // playback ticks, volume changes and other store updates never rebuild it.
  const artists = useArtistGroups();
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return artists;
    return artists.filter((artist) =>
      artist.name.toLocaleLowerCase().includes(needle),
    );
  }, [artists, query]);

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/25">
          {query.trim() ? "Search results" : "All artists"}
          <span className="ml-2 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] tracking-normal text-white/35">
            {filtered.length}
          </span>
        </p>
        <span className="text-[10px] text-white/20">
          Sorted by number of tracks
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-8 py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.05]">
            <UserRound className="h-6 w-6 text-white/30" />
          </span>
          <h2 className="mt-4 font-display text-[16px] font-bold text-white/80">
            {query.trim() ? `No artists match “${query.trim()}”` : "No artists yet"}
          </h2>
          <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-white/30">
            {query.trim()
              ? "Try a shorter name or clear the search field."
              : "Artists appear automatically after your first library scan."}
          </p>
        </div>
      ) : (
        <VirtualMediaGrid
          items={filtered}
          itemKey={(artist) => artist.name.toLocaleLowerCase()}
          scrollRef={scrollRef}
          layoutKey={query}
          cardExtraHeight={56}
          renderItem={(artist) => <ArtistCard artist={artist} />}
        />
      )}
    </div>
  );
});
