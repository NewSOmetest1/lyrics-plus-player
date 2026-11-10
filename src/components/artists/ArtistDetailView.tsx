import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowLeft,
  Clock3,
  Disc3,
  Headphones,
  Loader2,
  Music2,
  Pause,
  Play,
  Shuffle,
  Sparkles,
  Star,
  UserRound,
} from "lucide-react";

import type {
  DownloadRequest,
  SpotifyAlbumSummary,
  SpotifyArtistCatalog,
  SpotifyCatalogTrack,
  Track,
} from "@/types";
import { cn } from "@/lib/cn";
import { formatCount, formatTime, formatTimeLong } from "@/lib/format";
import { findLocalTrackForSpotify } from "@/lib/spotifyMatch";
import { useArtistGroups } from "@/hooks/useArtistGroups";
import { useCoverPalette } from "@/hooks/useCoverPalette";
import { useNavigation } from "@/hooks/useNavigation";
import { usePlayerStore } from "@/store/playerStore";
import { isArtistFollowed, useReleasesStore } from "@/store/releasesStore";
import { useSpotifyCatalogStore } from "@/store/spotifyCatalogStore";
import { useDownloadStore } from "@/store/downloadStore";
import { useToastStore } from "@/store/toastStore";
import { CoverArt } from "@/components/ui/CoverArt";
import { EqualizerBars } from "@/components/ui/EqualizerBars";
import {
  TrackStatusAction,
  type TrackDownloadState,
} from "@/components/ui/TrackStatusAction";
import { TrackRow } from "@/components/library/TrackRow";
import { VirtualRowList } from "@/components/library/VirtualRowList";
import {
  SpotifyAlbumCard,
  SpotifyArtwork,
} from "@/components/spotify/SpotifyCards";

const LOCAL_ROW_HEIGHT = 58;
const POPULAR_ROW_HEIGHT = 52;

function downloadRequest(track: SpotifyCatalogTrack): DownloadRequest {
  return {
    releaseId: `spotify-album-${track.albumId ?? track.id}`,
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    coverUrl: track.coverUrl,
    spotifyUrl: track.spotifyUrl,
  };
}

function SectionHeading({
  icon,
  title,
  meta,
}: {
  icon: React.ReactNode;
  title: string;
  meta?: string;
}) {
  return (
    <div className="mb-2.5 flex items-end gap-2">
      <span className="text-accent/70">{icon}</span>
      <h2 className="font-display text-[18px] font-extrabold tracking-[-0.02em] text-white/85">
        {title}
      </h2>
      {meta && <span className="pb-0.5 text-[10px] text-white/25">{meta}</span>}
    </div>
  );
}

const PopularTrackRow = memo(function PopularTrackRow({
  track,
  local,
  index,
  active,
  playing,
  pending,
  onPlay,
  onPause,
  onDownload,
}: {
  track: SpotifyCatalogTrack;
  local: Track | null;
  index: number;
  active: boolean;
  playing: boolean;
  pending?: TrackDownloadState;
  onPlay: (track: Track) => void;
  onPause: () => void;
  onDownload: (track: SpotifyCatalogTrack) => void;
}) {
  return (
    <div
      role="row"
      tabIndex={local ? 0 : -1}
      onDoubleClick={() => {
        if (local) onPlay(local);
      }}
      onKeyDown={(event) => {
        if (local && event.key === "Enter") onPlay(local);
      }}
      className={cn(
        "group grid h-[52px] grid-cols-[26px_minmax(0,1fr)_112px_28px] items-center gap-3 rounded-xl px-2.5 outline-none transition-colors focus-visible:bg-white/[0.06] md:grid-cols-[26px_minmax(0,2.2fr)_minmax(0,1.4fr)_112px_28px]",
        active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]",
        !local && "opacity-80 hover:opacity-100",
      )}
    >
      <div className="relative flex w-[26px] items-center justify-center">
        {active && playing ? (
          <EqualizerBars
            playing
            className="h-3.5 justify-center transition-opacity group-hover:opacity-0"
          />
        ) : (
          <span
            className={cn(
              "text-[10.5px] tabular-nums transition-opacity group-hover:opacity-0",
              active ? "text-accent" : "text-white/25",
            )}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
        )}
        {local && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (active && playing) onPause();
              else if (local) onPlay(local);
            }}
            aria-label={
              active && playing ? `Pause ${track.title}` : `Play ${track.title}`
            }
            className="absolute flex h-6 w-6 items-center justify-center rounded-full text-white opacity-0 transition hover:scale-110 group-hover:opacity-100 focus-visible:opacity-100"
          >
            {active && playing ? (
              <Pause className="h-3 w-3 fill-current" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
          </button>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        <SpotifyArtwork
          url={track.coverUrl}
          rounded="rounded-md"
          className="h-8 w-8"
        />
        <div className="min-w-0">
          <p
            className={cn(
              "truncate text-[12px] font-semibold",
              active
                ? "text-accent"
                : local
                  ? "text-white/80 group-hover:text-white"
                  : "text-white/45",
            )}
          >
            {track.title}
          </p>
          <p className="mt-0.5 truncate text-[10.5px] text-white/30">
            {track.artist}
          </p>
        </div>
      </div>

      <span className="hidden min-w-0 truncate text-[11px] text-white/30 md:block">
        {track.album}
      </span>

      <div className="flex justify-end">
        <TrackStatusAction
          downloaded={Boolean(local)}
          format={local?.format ?? "FLAC"}
          pending={pending}
          onDownload={() => onDownload(track)}
        />
      </div>

      <span className="text-right text-[10.5px] tabular-nums text-white/25">
        {formatTime(local?.durationMs || track.durationMs)}
      </span>
    </div>
  );
});

export function ArtistDetailView() {
  const tracks = usePlayerStore((state) => state.tracks);
  const selectedArtistName = usePlayerStore(
    (state) => state.selectedArtistName,
  );
  const selectedSpotifyArtistId = usePlayerStore(
    (state) => state.selectedArtistSpotifyId,
  );
  const openAlbum = usePlayerStore((state) => state.openAlbum);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const setShuffle = usePlayerStore((state) => state.setShuffle);
  const { goBack, navigate, canGoBack } = useNavigation();

  const releaseFeed = useReleasesStore((state) => state.feed);
  const followPending = useReleasesStore((state) => state.followPending);
  const setFollowing = useReleasesStore((state) => state.setFollowing);
  const loadArtist = useSpotifyCatalogStore((state) => state.loadArtist);
  const loadAlbumTracks = useSpotifyCatalogStore(
    (state) => state.loadAlbumTracks,
  );
  const resolveArtist = useSpotifyCatalogStore((state) => state.resolveArtist);
  // Percentage and speed changes belong to the download drawer. This view only
  // needs the active task set, which changes on status transitions.
  const pendingDownloads = useDownloadStore(
    useShallow((state) => {
      const entries: string[] = [];
      for (const task of state.tasks) {
        if (task.status === "queued" || task.status === "downloading") {
          entries.push(`${task.trackId}\u0000${task.status}`);
        }
      }
      return entries.sort();
    }),
  );

  const artists = useArtistGroups();
  const localArtist = useMemo(() => {
    const needle = selectedArtistName?.trim().toLocaleLowerCase();
    if (!needle) return null;
    return (
      artists.find((item) => item.name.toLocaleLowerCase() === needle) ?? null
    );
  }, [artists, selectedArtistName]);

  const artistName =
    localArtist?.name ?? selectedSpotifyArtistId
      ? localArtist?.name ?? selectedArtistName ?? ""
      : selectedArtistName ?? "";

  const followedArtistId = useMemo(() => {
    const needle = artistName.trim().toLocaleLowerCase();
    if (!needle) return "";
    return (
      releaseFeed.artists.find(
        (artist) =>
          artist.name.trim().toLocaleLowerCase() === needle ||
          artist.localName?.trim().toLocaleLowerCase() === needle,
      )?.id ?? ""
    );
  }, [artistName, releaseFeed.artists]);

  const [catalog, setCatalog] = useState<SpotifyArtistCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [albumPending, setAlbumPending] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!artistName) return;
    let cancelled = false;
    setCatalog(null);
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        let artistId = selectedSpotifyArtistId || followedArtistId;
        if (!artistId) {
          const resolved = await resolveArtist(artistName);
          artistId = resolved?.id ?? "";
        }
        if (!artistId) {
          throw new Error(
            "Spotify could not find this artist in the global catalog.",
          );
        }
        const data = await loadArtist(artistId, artistName);
        if (!cancelled) setCatalog(data);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    artistName,
    followedArtistId,
    loadArtist,
    reloadKey,
    resolveArtist,
    selectedSpotifyArtistId,
  ]);

  const palette = useCoverPalette(
    catalog?.artist.imageUrl ?? localArtist?.coverUrl ?? null,
    artistName || "artist",
  );

  const profile = catalog?.artist ?? null;
  const localTracks = localArtist?.tracks ?? [];
  const popularTracks = catalog?.topTracks ?? [];
  const albums = catalog?.albums ?? [];

  const popularMatches = useMemo(() => {
    const matches = new Map<string, Track | null>();
    for (const track of popularTracks) {
      matches.set(track.id, findLocalTrackForSpotify(tracks, track));
    }
    return matches;
  }, [popularTracks, tracks]);

  const popularLocal = useMemo(
    () =>
      popularTracks
        .map((track) => popularMatches.get(track.id) ?? null)
        .filter((track): track is Track => Boolean(track)),
    [popularMatches, popularTracks],
  );

  const pendingById = useMemo(() => {
    const pending = new Map<string, TrackDownloadState>();
    for (const entry of pendingDownloads) {
      const separator = entry.indexOf("\u0000");
      pending.set(
        entry.slice(0, separator),
        entry.slice(separator + 1) as TrackDownloadState,
      );
    }
    return pending;
  }, [pendingDownloads]);

  const followed = useMemo(
    () => isArtistFollowed(releaseFeed, artistName),
    [artistName, releaseFeed],
  );

  const totalMs = localTracks.reduce(
    (sum, track) => sum + track.durationMs,
    0,
  );

  const playAll = () => {
    if (localTracks.length === 0) return;
    setShuffle(false);
    void playTrack(localTracks[0], 0, localTracks);
  };

  const shuffleAll = () => {
    if (localTracks.length === 0) return;
    setShuffle(true);
    const start =
      localTracks[Math.floor(Math.random() * localTracks.length)];
    void playTrack(start, 0, localTracks);
  };

  const back = () => {
    if (canGoBack) {
      goBack();
      return;
    }
    navigate({ type: "search", query: artistName });
  };

  const queueTracks = useCallback(async (
    items: SpotifyCatalogTrack[],
    releaseId: string,
    label: string,
  ) => {
    if (items.length === 0) {
      useToastStore.getState().push({
        kind: "info",
        title: "Everything is already on PC",
        description: label,
      });
      return;
    }
    await useDownloadStore.getState().start(
      items.map((track) => ({ ...downloadRequest(track), releaseId })),
    );
    useToastStore.getState().push({
      kind: "success",
      title: `Queued ${items.length} track${items.length === 1 ? "" : "s"}`,
      description: label,
    });
  }, []);

  const downloadTrack = useCallback((track: SpotifyCatalogTrack) => {
    const local = findLocalTrackForSpotify(tracks, track);
    if (local) {
      useToastStore.getState().push({
        kind: "info",
        title: "Already in your library",
        description: `${local.title} · ${local.format}`,
      });
      return;
    }
    void queueTracks(
      [track],
      `spotify-track-${track.id}`,
      `${track.artist} · ${track.title}`,
    ).catch((cause) => {
      useToastStore.getState().push({
        kind: "error",
        title: "Could not queue download",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    });
  }, [queueTracks, tracks]);

  const pausePlayback = useCallback(() => void togglePlay(), [togglePlay]);

  const playLocalTrack = useCallback(
    (track: Track) => {
      setShuffle(false);
      void playTrack(track, 0, localTracks);
    },
    [localTracks, playTrack, setShuffle],
  );

  const playPopularTrack = useCallback(
    (track: Track) => {
      setShuffle(false);
      void playTrack(track, 0, popularLocal);
    },
    [playTrack, popularLocal, setShuffle],
  );

  const downloadAlbum = async (album: SpotifyAlbumSummary) => {
    if (albumPending) return;
    setAlbumPending(album.id);
    try {
      const albumTracks = await loadAlbumTracks(album.id, {
        artist: album.artist || artistName,
        album: album.title,
        coverUrl: album.coverUrl,
      });
      const missing = albumTracks.filter(
        (track) => !findLocalTrackForSpotify(tracks, track),
      );
      await queueTracks(
        missing,
        `spotify-album-${album.id}`,
        `${album.artist || artistName} · ${album.title}`,
      );
    } catch (cause) {
      useToastStore.getState().push({
        kind: "error",
        title: "Could not load album",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setAlbumPending(null);
    }
  };

  const listenersLabel = profile?.monthlyListeners
    ? formatCount(profile.monthlyListeners, "monthly listener")
    : profile?.followers
      ? formatCount(profile.followers, "follower")
      : localArtist
        ? formatCount(localArtist.trackCount, "track")
        : "";

  const hasContent =
    localTracks.length > 0 ||
    popularTracks.length > 0 ||
    albums.length > 0 ||
    loading;

  const empty = !loading && !localTracks.length && !catalog;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto"
      >
        <header className="relative shrink-0 overflow-hidden px-6 pb-6 pt-5 lg:px-8">
          <div
            className="pointer-events-none absolute inset-0 opacity-80"
            style={{
              background: `radial-gradient(120% 100% at 14% 0%, ${palette.primary}38 0%, transparent 62%)`,
            }}
          />

          <button
            type="button"
            onClick={back}
            className="relative inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-[11px] font-semibold text-white/45 outline-none transition hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>

          <div className="relative mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:gap-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
              className="shrink-0"
            >
              {profile?.imageUrl ? (
                <SpotifyArtwork
                  url={profile.imageUrl}
                  rounded="rounded-full"
                  className="aspect-square w-36 shadow-[0_24px_60px_-18px_rgba(0,0,0,.85)] sm:w-44"
                />
              ) : localArtist ? (
                <CoverArt
                  track={localArtist.coverTrack}
                  className="aspect-square w-36 rounded-full shadow-[0_24px_60px_-18px_rgba(0,0,0,.85)] sm:w-44"
                  iconClassName="h-10 w-10"
                />
              ) : (
                <div className="flex aspect-square w-36 items-center justify-center rounded-full bg-gradient-to-br from-[#450af5]/60 to-[#8e8ee8]/40 shadow-[0_24px_60px_-18px_rgba(0,0,0,.85)] sm:w-44">
                  <UserRound className="h-12 w-12 text-white/60" />
                </div>
              )}
            </motion.div>

            <div className="min-w-0 flex-1 pb-1">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-accent/80">
                <Sparkles className="h-3 w-3" />
                Artist
              </p>
              <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, delay: 0.05, ease: [0.2, 0, 0, 1] }}
                className="mt-1.5 truncate font-display text-[36px] font-extrabold leading-[1.05] tracking-[-0.035em] text-white sm:text-[42px]"
                title={artistName}
              >
                {profile?.name || artistName}
              </motion.h1>

              {profile && profile.genres.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profile.genres.slice(0, 4).map((genre) => (
                    <span
                      key={genre}
                      className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold capitalize text-white/40"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              )}

              <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-white/35">
                {listenersLabel && (
                  <span className="inline-flex items-center gap-1">
                    <Headphones className="h-3 w-3 text-white/25" />
                    {listenersLabel}
                  </span>
                )}
                {localArtist && (
                  <>
                    <span className="text-white/15">·</span>
                    <span>{formatCount(localArtist.trackCount, "track")}</span>
                    <span className="text-white/15">·</span>
                    <span>{formatTimeLong(totalMs)} on PC</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="relative mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={playAll}
              disabled={localTracks.length === 0}
              className="flex h-9 items-center gap-2 rounded-full bg-accent px-5 text-[12px] font-bold text-black shadow-glow transition hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Play Local
            </button>
            <button
              type="button"
              onClick={shuffleAll}
              disabled={localTracks.length === 0}
              className="flex h-9 items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.05] px-4 text-[11.5px] font-semibold text-white/60 transition hover:bg-white/[0.09] hover:text-white active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              <Shuffle className="h-3.5 w-3.5" />
              Shuffle
            </button>
            <button
              type="button"
              onClick={() => void setFollowing(artistName, !followed)}
              disabled={followPending !== null || !artistName}
              title={
                followed
                  ? `Unfollow ${artistName} on Spotify`
                  : `Follow ${artistName} on Spotify`
              }
              className={cn(
                "flex h-9 items-center gap-2 rounded-full border px-4 text-[11.5px] font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
                followed
                  ? "border-accent/30 bg-accent/10 text-accent hover:bg-accent/15"
                  : "border-white/[0.1] bg-white/[0.05] text-white/60 hover:bg-white/[0.09] hover:text-white",
              )}
            >
              {followPending === artistName ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Star className={cn("h-3.5 w-3.5", followed && "fill-current")} />
              )}
              {followed ? "Following" : "Follow"}
            </button>
          </div>
        </header>

        <div className="space-y-8 px-6 pb-8 lg:px-8">
          {error && !catalog && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-3.5 py-2.5">
              <p className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-amber-200/60">
                Spotify catalog is unavailable: {error}
              </p>
              <button
                type="button"
                onClick={() => setReloadKey((value) => value + 1)}
                className="rounded-full border border-white/[0.1] bg-white/[0.05] px-3 py-1 text-[10px] font-semibold text-white/55 transition hover:bg-white/[0.09] hover:text-white"
              >
                Retry
              </button>
            </div>
          )}

          {localTracks.length > 0 && (
            <section>
              <SectionHeading
                icon={<Disc3 className="h-4 w-4" />}
                title="On Your PC"
                meta={formatCount(localTracks.length, "track")}
              />
              <div className="mb-1 flex h-8 items-center gap-3 border-b border-white/[0.06] px-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-white/20">
                <span className="w-7 text-center">#</span>
                <span className="flex-1">Title</span>
                <span className="hidden w-[26%] xl:block">Album</span>
                <span className="hidden w-[76px] text-center md:block">
                  Format
                </span>
                <span className="w-11 text-right">
                  <Clock3 className="ml-auto h-3 w-3" />
                </span>
                <span className="w-7" />
              </div>
              <div className="pb-2">
                <VirtualRowList
                  count={localTracks.length}
                  rowHeight={LOCAL_ROW_HEIGHT}
                  scrollRef={scrollRef}
                  layoutKey={`${artistName}:local:${localTracks.length}:${catalog ? "catalog" : "local"}:${error ? 1 : 0}`}
                  getKey={(index) => localTracks[index].id}
                  renderRow={(index) => {
                    const track = localTracks[index];
                    return (
                      <TrackRow
                        track={track}
                        index={index}
                        active={currentTrack?.id === track.id}
                        playing={isPlaying}
                        onPlay={playLocalTrack}
                      />
                    );
                  }}
                />
              </div>
            </section>
          )}

          {popularTracks.length > 0 && (
            <section>
              <SectionHeading
                icon={<Music2 className="h-4 w-4" />}
                title="Popular on Spotify"
                meta={`Top ${popularTracks.length}`}
              />
              <div className="mb-1 grid h-8 grid-cols-[26px_minmax(0,1fr)_112px_28px] items-center gap-3 border-b border-white/[0.06] px-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-white/20 md:grid-cols-[26px_minmax(0,2.2fr)_minmax(0,1.4fr)_112px_28px]">
                <span className="text-center">#</span>
                <span>Title</span>
                <span className="hidden md:block">Album</span>
                <span className="flex justify-end">Status</span>
                <span className="text-right">Time</span>
              </div>
              <VirtualRowList
                count={popularTracks.length}
                rowHeight={POPULAR_ROW_HEIGHT}
                scrollRef={scrollRef}
                layoutKey={`${artistName}:popular:${localTracks.length}:${popularTracks.length}:${catalog ? "catalog" : "local"}:${error ? 1 : 0}`}
                getKey={(index) => popularTracks[index].id}
                renderRow={(index) => {
                  const track = popularTracks[index];
                  const local = popularMatches.get(track.id) ?? null;
                  const active = Boolean(
                    local &&
                      (currentTrack?.id === local.id ||
                        currentTrack?.path === local.path),
                  );
                  return (
                    <PopularTrackRow
                      track={track}
                      local={local}
                      index={index}
                      active={active}
                      playing={isPlaying}
                      pending={pendingById.get(track.id)}
                      onPlay={playPopularTrack}
                      onPause={pausePlayback}
                      onDownload={downloadTrack}
                    />
                  );
                }}
              />
            </section>
          )}

          {albums.length > 0 && (
            <section>
              <SectionHeading
                icon={<Disc3 className="h-4 w-4" />}
                title="Discography"
                meta={formatCount(albums.length, "release")}
              />
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                {albums.map((album) => (
                  <SpotifyAlbumCard
                    key={album.id}
                    album={album}
                    tracks={tracks}
                    downloading={albumPending === album.id}
                    onDownload={() => void downloadAlbum(album)}
                    onOpen={() => openAlbum(album)}
                  />
                ))}
              </div>
            </section>
          )}

          {loading && !catalog && (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-2.5 text-[11.5px] text-white/30">
              <Loader2 className="h-4 w-4 animate-spin text-accent/60" />
              Loading Spotify catalog…
            </div>
          )}

          {empty && !error && (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-8 py-10 text-center">
              <UserRound className="h-6 w-6 text-white/25" />
              <h2 className="mt-3 font-display text-[15px] font-bold text-white/70">
                Artist not found
              </h2>
              <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-white/30">
                No local tracks or Spotify profile matched “{artistName}”.
              </p>
              <button
                type="button"
                onClick={() => setReloadKey((value) => value + 1)}
                className="mt-4 rounded-full border border-white/[0.1] bg-white/[0.05] px-4 py-2 text-[11px] font-semibold text-white/60 transition hover:bg-white/[0.09] hover:text-white"
              >
                Try again
              </button>
            </div>
          )}

          {!hasContent && !empty && !error && (
            <div className="flex min-h-[180px] items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-accent/60" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
