import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Clock3, Loader2, Play, Shuffle, Star } from "lucide-react";

import { formatCount, formatTimeLong } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useArtistGroups } from "@/hooks/useArtistGroups";
import { useCoverPalette } from "@/hooks/useCoverPalette";
import { useNavigation } from "@/hooks/useNavigation";
import { usePlayerStore } from "@/store/playerStore";
import { isArtistFollowed, useReleasesStore } from "@/store/releasesStore";
import { CoverArt } from "@/components/ui/CoverArt";
import { TrackRow } from "@/components/library/TrackRow";

export function ArtistDetailView() {
  const tracks = usePlayerStore((state) => state.tracks);
  const selectedArtistName = usePlayerStore(
    (state) => state.selectedArtistName,
  );
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const view = usePlayerStore((state) => state.view);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const setShuffle = usePlayerStore((state) => state.setShuffle);
  const { goBack, navigate } = useNavigation();

  const artists = useArtistGroups();
  const artist = useMemo(() => {
    const needle = selectedArtistName?.trim().toLocaleLowerCase();
    if (!needle) return null;
    return (
      artists.find(
        (item) => item.name.toLocaleLowerCase() === needle,
      ) ?? null
    );
  }, [artists, selectedArtistName]);

  const palette = useCoverPalette(
    artist?.coverUrl ?? null,
    artist?.name ?? "artist",
  );

  const releaseFeed = useReleasesStore((state) => state.feed);
  const followPending = useReleasesStore((state) => state.followPending);
  const setFollowing = useReleasesStore((state) => state.setFollowing);
  const followed = useMemo(
    () => isArtistFollowed(releaseFeed, artist?.name ?? ""),
    [artist?.name, releaseFeed],
  );

  useEffect(() => {
    if (view === "artist" && tracks.length > 0 && !artist) {
      navigate({ type: "artists" });
    }
  }, [artist, navigate, tracks.length, view]);

  if (!artist) return null;

  const totalMs = artist.tracks.reduce(
    (sum, track) => sum + track.durationMs,
    0,
  );

  const playAll = () => {
    if (artist.tracks.length === 0) return;
    setShuffle(false);
    void playTrack(artist.tracks[0], 0, artist.tracks);
  };

  const shuffleAll = () => {
    if (artist.tracks.length === 0) return;
    setShuffle(true);
    const start =
      artist.tracks[Math.floor(Math.random() * artist.tracks.length)];
    void playTrack(start, 0, artist.tracks);
  };

  const backToArtists = () => {
    const state = usePlayerStore.getState();
    const previous = state.history[state.currentIndex - 1];
    if (previous?.type === "artists") {
      goBack();
      return;
    }
    navigate({ type: "artists" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <header className="relative shrink-0 overflow-hidden px-6 pb-6 pt-5 lg:px-8">
          <div
            className="pointer-events-none absolute inset-0 opacity-80"
            style={{
              background: `radial-gradient(120% 100% at 14% 0%, ${palette.primary}38 0%, transparent 62%)`,
            }}
          />

          <button
            type="button"
            onClick={backToArtists}
            className="relative inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-[11px] font-semibold text-white/45 outline-none transition hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to artists
          </button>

          <div className="relative mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:gap-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
              className="shrink-0"
            >
              <CoverArt
                track={artist.coverTrack}
                className="aspect-square w-36 rounded-full shadow-[0_24px_60px_-18px_rgba(0,0,0,.85)] sm:w-44"
                iconClassName="h-10 w-10"
              />
            </motion.div>

            <div className="min-w-0 flex-1 pb-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent/80">
                Artist
              </p>
              <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, delay: 0.05, ease: [0.2, 0, 0, 1] }}
                className="mt-1.5 truncate font-display text-[36px] font-extrabold leading-[1.05] tracking-[-0.035em] text-white sm:text-[42px]"
                title={artist.name}
              >
                {artist.name}
              </motion.h1>
              <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-white/35">
                <span>{formatCount(artist.trackCount, "track")}</span>
                <span className="text-white/15">·</span>
                <span>{formatCount(artist.albumCount, "album")}</span>
                <span className="text-white/15">·</span>
                <span>{formatTimeLong(totalMs)}</span>
              </p>
            </div>
          </div>

          <div className="relative mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={playAll}
              className="flex h-9 items-center gap-2 rounded-full bg-accent px-5 text-[12px] font-bold text-black shadow-glow transition hover:brightness-110 active:scale-[0.98]"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Play all
            </button>
            <button
              type="button"
              onClick={shuffleAll}
              className="flex h-9 items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.05] px-4 text-[11.5px] font-semibold text-white/60 transition hover:bg-white/[0.09] hover:text-white active:scale-[0.98]"
            >
              <Shuffle className="h-3.5 w-3.5" />
              Shuffle
            </button>
            <button
              type="button"
              onClick={() => void setFollowing(artist.name, !followed)}
              disabled={followPending !== null}
              title={
                followed
                  ? `Unfollow ${artist.name} on Spotify`
                  : `Follow ${artist.name} on Spotify`
              }
              className={cn(
                "flex h-9 items-center gap-2 rounded-full border px-4 text-[11.5px] font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
                followed
                  ? "border-accent/30 bg-accent/10 text-accent hover:bg-accent/15"
                  : "border-white/[0.1] bg-white/[0.05] text-white/60 hover:bg-white/[0.09] hover:text-white",
              )}
            >
              {followPending === artist.name ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Star
                  className={cn("h-3.5 w-3.5", followed && "fill-current")}
                />
              )}
              {followed ? "Following" : "Follow"}
            </button>
          </div>
        </header>

        <div className="px-6 pb-8 lg:px-8">
          <div className="mb-1 flex h-8 items-center gap-3 border-b border-white/[0.06] px-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-white/20">
            <span className="w-7 text-center">#</span>
            <span className="flex-1">Title</span>
            <span className="hidden w-[26%] xl:block">Album</span>
            <span className="hidden w-[76px] text-center md:block">Format</span>
            <span className="w-11 text-right">
              <Clock3 className="ml-auto h-3 w-3" />
            </span>
            <span className="w-7" />
          </div>

          <div className="pb-2">
            {artist.tracks.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                index={index}
                active={currentTrack?.id === track.id}
                playing={isPlaying}
                onPlay={(item) => {
                  setShuffle(false);
                  void playTrack(item, 0, artist.tracks);
                }}
              />
            ))}
          </div>

          <p className="mt-4 text-center text-[10px] text-white/15">
            Double-click a track to play the artist from there · right-click for
            more
          </p>
        </div>
      </div>
    </div>
  );
}
