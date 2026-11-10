import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Clock3,
  Download,
  Heart,
  ListMusic,
  Loader2,
  MoreHorizontal,
  Music2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";

import type { DownloadRequest, Playlist, SpotifyLikedTrack, Track } from "@/types";
import { LIKED_PLAYLIST_ID, isLikedPlaylist } from "@/types";
import { cn } from "@/lib/cn";
import { formatCount, formatTime, formatTimeLong } from "@/lib/format";
import { coverPaletteUrl } from "@/lib/api";
import { useCoverPalette } from "@/hooks/useCoverPalette";
import { usePlayerStore } from "@/store/playerStore";
import { usePlaylistStore } from "@/store/playlistStore";
import { useDownloadStore } from "@/store/downloadStore";
import { usePlaylistDialogStore } from "@/store/playlistDialogStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useSpotifyLikedStore } from "@/store/spotifyLikedStore";
import { useTrackMenuStore } from "@/store/contextMenuStore";
import { useToastStore } from "@/store/toastStore";
import {
  useTrackSorting,
  type TrackSortAccessors,
} from "@/hooks/useTrackSorting";
import { CoverArt } from "@/components/ui/CoverArt";
import { EqualizerBars } from "@/components/ui/EqualizerBars";
import { ArtistLinks } from "@/components/artists/ArtistLinks";
import { PlaylistCover } from "@/components/playlists/PlaylistCover";
import { SortDropdown } from "@/components/library/SortDropdown";
import { VirtualRowList } from "@/components/library/VirtualRowList";

const PLAYLIST_ROW_HEIGHT = 54;

const PlaylistTrackRow = memo(function PlaylistTrackRow({
  playlist,
  track,
  index,
  active,
  playing,
  onPlay,
  onPause,
  onRemove,
}: {
  playlist: Playlist;
  track: Track;
  index: number;
  active: boolean;
  playing: boolean;
  onPlay: (track: Track) => void;
  onPause: () => void;
  onRemove: (track: Track) => void;
}) {
  const openMenu = useTrackMenuStore((state) => state.openMenu);

  return (
    <div
      role="row"
      tabIndex={0}
      onDoubleClick={() => onPlay(track)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onPlay(track);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu(track, event.clientX, event.clientY, {
          id: playlist.id,
          name: playlist.name,
        });
      }}
      className={cn(
        "group grid h-[54px] cursor-default grid-cols-[26px_minmax(0,1fr)_52px_26px] items-center gap-3 rounded-xl px-2.5 outline-none transition-colors focus-visible:bg-white/[0.06] md:grid-cols-[26px_minmax(0,2.2fr)_minmax(0,1.4fr)_52px_26px]",
        active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]",
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
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (active && playing) onPause();
            else onPlay(track);
          }}
          aria-label={
            active && playing ? `Pause ${track.title}` : `Play ${track.title}`
          }
          title={
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
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        <CoverArt
          track={track}
          className="h-8 w-8 shrink-0 rounded-md"
          iconClassName="h-3.5 w-3.5"
          showInitials={false}
        />
        <div className="min-w-0">
          <p
            className={cn(
              "truncate text-[12px] font-semibold",
              active ? "text-accent" : "text-white/80 group-hover:text-white",
            )}
          >
            {track.title}
          </p>
          <ArtistLinks
            artistString={track.artist}
            className="mt-0.5 block truncate text-[10.5px] text-white/30"
          />
        </div>
      </div>

      <span className="hidden min-w-0 truncate text-[11px] text-white/30 md:block">
        {track.album}
      </span>

      <span className="text-right text-[10.5px] tabular-nums text-white/30">
        {formatTime(track.durationMs)}
      </span>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove(track);
        }}
        aria-label={`Remove ${track.title} from playlist`}
        title="Remove from playlist"
        className="flex h-6 w-6 items-center justify-center rounded-full text-white/20 opacity-0 transition hover:bg-white/10 hover:text-white/75 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});

const SPOTIFY_ROW_GRID =
  "grid-cols-[26px_minmax(0,1fr)_70px_26px] md:grid-cols-[26px_minmax(0,2.2fr)_minmax(0,1.4fr)_76px_26px]";

interface SpotifyLikedRowData {
  item: SpotifyLikedTrack;
  track: Track | null;
}

const spotifyRowAccessors: TrackSortAccessors<SpotifyLikedRowData> = {
  title: (row) => row.item.title,
  artist: (row) => row.item.artist,
  album: (row) => row.item.album,
  duration: (row) => row.track?.durationMs || row.item.durationMs,
  added: (row) => row.item.addedAt,
};

function downloadRequest(item: SpotifyLikedTrack): DownloadRequest {
  return {
    releaseId: "spotify-liked",
    trackId: item.id,
    title: item.title,
    artist: item.artist,
    album: item.album,
    coverUrl: item.coverUrl,
    spotifyUrl: item.spotifyUrl,
  };
}

function SpotifyLikedCover({
  item,
  muted,
}: {
  item: SpotifyLikedTrack;
  muted: boolean;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [item.coverUrl]);

  return (
    <div
      className={cn(
        "relative isolate h-8 w-8 shrink-0 overflow-hidden rounded-md bg-white/[0.04]",
        muted && "opacity-45 grayscale",
      )}
    >
      {item.coverUrl && !failed ? (
        <img
          src={item.coverUrl}
          alt={`${item.title} cover`}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#450af5]/70 to-[#8e8ee8]/60">
          <Music2 className="h-3.5 w-3.5 text-white/70" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10" />
    </div>
  );
}

const SpotifyLikedRow = memo(function SpotifyLikedRow({
  item,
  track,
  index,
  active,
  playing,
  onPlay,
  onPause,
  onDownload,
  onUnlike,
}: {
  item: SpotifyLikedTrack;
  track: Track | null;
  index: number;
  active: boolean;
  playing: boolean;
  onPlay: (track: Track) => void;
  onPause: () => void;
  onDownload: (item: SpotifyLikedTrack) => void;
  onUnlike: (item: SpotifyLikedTrack) => void;
}) {
  const downloaded = Boolean(track);

  return (
    <div
      role="row"
      tabIndex={downloaded ? 0 : -1}
      onDoubleClick={() => {
        if (track) onPlay(track);
      }}
      onKeyDown={(event) => {
        if (track && event.key === "Enter") onPlay(track);
      }}
      className={cn(
        "group grid h-[54px] items-center gap-3 rounded-xl px-2.5 outline-none transition-colors focus-visible:bg-white/[0.06]",
        SPOTIFY_ROW_GRID,
        active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]",
        !downloaded && "opacity-75 hover:opacity-90",
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
        {downloaded && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (active && playing) onPause();
              else if (track) onPlay(track);
            }}
            aria-label={
              active && playing
                ? `Pause ${item.title}`
                : `Play ${item.title}`
            }
            title={
              active && playing
                ? `Pause ${item.title}`
                : `Play ${item.title}`
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
        <SpotifyLikedCover item={item} muted={!downloaded} />
        <div className="min-w-0">
          <p
            className={cn(
              "truncate text-[12px] font-semibold",
              active
                ? "text-accent"
                : downloaded
                  ? "text-white/80 group-hover:text-white"
                  : "text-white/40",
            )}
          >
            {item.title}
          </p>
          <p className="mt-0.5 truncate text-[10.5px] text-white/30">
            {item.artist}
          </p>
        </div>
      </div>

      <span className="hidden min-w-0 truncate text-[11px] text-white/30 md:block">
        {item.album}
      </span>

      <div className="flex justify-end">
        {downloaded && track ? (
          <span className="text-right text-[10.5px] tabular-nums text-white/30">
            {formatTime(track.durationMs || item.durationMs)}
          </span>
        ) : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDownload(item);
            }}
            className="inline-flex h-6 items-center gap-1 rounded-full border border-white/[0.1] bg-white/[0.04] px-2 text-[9.5px] font-semibold text-white/55 transition hover:border-accent/30 hover:bg-accent/[0.1] hover:text-accent"
          >
            <Download className="h-3 w-3" />
            Download FLAC
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onUnlike(item);
        }}
        aria-label={`Remove ${item.title} from Liked Songs`}
        title="Remove from Liked Songs"
        className="flex h-6 w-6 items-center justify-center rounded-full text-[#b49bff] opacity-80 transition hover:scale-110 hover:text-[#d8c8ff] group-hover:opacity-100"
      >
        <Heart className="h-3.5 w-3.5 fill-current" />
      </button>
    </div>
  );
});

export function PlaylistView() {
  const playlists = usePlaylistStore((state) => state.playlists);
  const loaded = usePlaylistStore((state) => state.loaded);
  const removePlaylist = usePlaylistStore((state) => state.remove);
  const removeTrack = usePlaylistStore((state) => state.removeTrack);
  const exportM3U = usePlaylistStore((state) => state.exportM3U);

  const selectedPlaylistId = usePlayerStore((state) => state.selectedPlaylistId);
  const tracks = usePlayerStore((state) => state.tracks);
  const view = usePlayerStore((state) => state.view);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const setShuffle = usePlayerStore((state) => state.setShuffle);
  const navigate = usePlayerStore((state) => state.navigate);

  const likedSongsSource = useSettingsStore((state) => state.likedSongsSource);
  const spotifySnapshot = useSpotifyLikedStore((state) => state.snapshot);
  const spotifyLoaded = useSpotifyLikedStore((state) => state.loaded);
  const spotifySyncing = useSpotifyLikedStore((state) => state.syncing);
  const syncSpotify = useSpotifyLikedStore((state) => state.sync);
  const setSpotifyLiked = useSpotifyLikedStore((state) => state.setLiked);

  const openRename = usePlaylistDialogStore((state) => state.openRename);

  const [optionsOpen, setOptionsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const optionsRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const playlist = playlists.find((item) => item.id === selectedPlaylistId) ?? null;
  const liked = isLikedPlaylist(playlist);
  const spotifyMode = liked && likedSongsSource === "spotify";

  // Pull Spotify-side changes when Liked Songs is opened and the mirror is
  // older than a few minutes. Silent, with a retry guard so a rate-limited
  // sync does not loop while the page stays mounted.
  const lastAutoSyncRef = useRef(0);
  useEffect(() => {
    if (!spotifyMode || !spotifyLoaded) return;
    const fetchedAt = spotifySnapshot?.fetchedAt ?? 0;
    if (fetchedAt && Date.now() - fetchedAt < 5 * 60 * 1000) return;
    if (spotifySyncing) return;
    if (Date.now() - lastAutoSyncRef.current < 60 * 1000) return;
    lastAutoSyncRef.current = Date.now();
    void syncSpotify(true);
  }, [
    spotifyMode,
    spotifyLoaded,
    spotifySnapshot?.fetchedAt,
    spotifySyncing,
    syncSpotify,
  ]);

  const resolvedTracks = useMemo(() => {
    if (!playlist) return [];
    const byPath = new Map(tracks.map((track) => [track.path, track]));
    return playlist.trackPaths
      .map((trackPath) => byPath.get(trackPath))
      .filter((track): track is Track => Boolean(track));
  }, [playlist, tracks]);

  const spotifyRows = useMemo(() => {
    if (!spotifyMode || !spotifySnapshot) return [];
    const byPath = new Map(tracks.map((track) => [track.path, track]));
    return spotifySnapshot.items.map((item) => ({
      item,
      track: item.localPath ? (byPath.get(item.localPath) ?? null) : null,
    }));
  }, [spotifyMode, spotifySnapshot, tracks]);

  const playlistSort = useTrackSorting(resolvedTracks, {
    storageKey: liked
      ? "lyricsplus.sort.liked"
      : "lyricsplus.sort.playlist",
  });
  const spotifySort = useTrackSorting(spotifyRows, {
    storageKey: "lyricsplus.sort.liked",
    accessors: spotifyRowAccessors,
  });

  const sortedTracks = playlistSort.items;
  const sortedSpotifyRows = spotifySort.items;

  const spotifyPlayable = useMemo(
    () =>
      sortedSpotifyRows
        .map((row) => row.track)
        .filter((track): track is Track => Boolean(track)),
    [sortedSpotifyRows],
  );

  const displayTracks = spotifyMode ? spotifyPlayable : sortedTracks;
  const activeSort = spotifyMode ? spotifySort : playlistSort;
  const missing = playlist ? playlist.trackPaths.length - resolvedTracks.length : 0;
  const totalMs = displayTracks.reduce((sum, track) => sum + track.durationMs, 0);
  const palette = useCoverPalette(
    coverPaletteUrl(displayTracks[0] ?? null),
    playlist?.name ?? "playlist",
  );

  const pausePlayback = useCallback(() => void togglePlay(), [togglePlay]);

  const playFromPlaylist = useCallback(
    (track: Track) => {
      setShuffle(false);
      void playTrack(track, 0, sortedTracks);
    },
    [playTrack, setShuffle, sortedTracks],
  );

  const playFromSpotifyLiked = useCallback(
    (track: Track) => {
      setShuffle(false);
      void playTrack(track, 0, spotifyPlayable);
    },
    [playTrack, setShuffle, spotifyPlayable],
  );

  const downloadLikedTrack = useCallback(async (item: SpotifyLikedTrack) => {
    await useDownloadStore.getState().start([downloadRequest(item)]);
    useToastStore.getState().push({
      kind: "success",
      title: "Download queued",
      description: `${item.artist} · ${item.title}`,
    });
  }, []);

  const unlikeLikedTrack = useCallback(
    async (item: SpotifyLikedTrack) => {
      if (item.localPath) {
        await removeTrack(LIKED_PLAYLIST_ID, item.localPath);
      }
      await setSpotifyLiked(item.id, false, {
        title: item.title,
        artist: item.artist,
        album: item.album,
        durationMs: item.durationMs,
        coverUrl: item.coverUrl,
        spotifyUrl: item.spotifyUrl,
      });
    },
    [removeTrack, setSpotifyLiked],
  );

  const removeFromPlaylist = useCallback(
    async (track: Track) => {
      if (!playlist) return;
      const result = await removeTrack(playlist.id, track.path);
      if (result?.changed) {
        useToastStore.getState().push({
          kind: "success",
          title: "Removed from playlist",
          description: track.title,
        });
      }
    },
    [playlist, removeTrack],
  );

  useEffect(() => {
    if (!loaded) return;
    if (view === "playlist" && !playlist) {
      navigate({ type: "library", section: "playlists" });
    }
  }, [loaded, navigate, playlist, view]);

  useEffect(() => {
    setOptionsOpen(false);
    setConfirmDelete(false);
  }, [selectedPlaylistId]);

  useEffect(() => {
    if (!optionsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!optionsRef.current?.contains(event.target as Node)) setOptionsOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [optionsOpen]);

  if (!playlist) return null;

  const playAll = () => {
    if (displayTracks.length === 0) return;
    setShuffle(false);
    void playTrack(displayTracks[0], 0, displayTracks);
  };

  const shuffleAll = () => {
    if (displayTracks.length === 0) return;
    setShuffle(true);
    const index = Math.floor(Math.random() * displayTracks.length);
    void playTrack(displayTracks[index], 0, displayTracks);
  };

  const downloadMissing = async () => {
    const items = (spotifySnapshot?.items ?? []).filter(
      (item) => !item.isDownloaded,
    );
    if (items.length === 0) {
      useToastStore.getState().push({
        kind: "info",
        title: "All liked songs are downloaded",
        description: "Every Spotify liked track is already in your library.",
      });
      return;
    }
    await useDownloadStore.getState().start(items.map(downloadRequest));
    useToastStore.getState().push({
      kind: "success",
      title: `Queued ${items.length} download${items.length === 1 ? "" : "s"}`,
      description: "Missing liked songs will appear after they finish.",
    });
  };

  const deletePlaylist = async () => {
    setConfirmDelete(false);
    const removed = await removePlaylist(playlist.id);
    if (removed) {
      useToastStore.getState().push({
        kind: "success",
        title: "Playlist deleted",
        description: playlist.name,
      });
      navigate({ type: "library", section: "playlists" });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto"
      >
        <header className="relative shrink-0 overflow-hidden px-6 pb-5 pt-7 lg:px-8">
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background: `radial-gradient(120% 90% at 12% 0%, ${palette.primary}2e 0%, transparent 62%)`,
            }}
          />
          <div className="relative">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent/80">
              Playlist
            </p>

            <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end">
              <PlaylistCover
                tracks={displayTracks.slice(0, 4)}
                liked={liked}
                className="h-36 w-36 rounded-2xl shadow-[0_24px_60px_-18px_rgba(0,0,0,.85)] sm:h-44 sm:w-44"
                iconClassName="h-12 w-12"
              />
              <div className="min-w-0 flex-1 pb-1">
                <button
                  type="button"
                  onClick={() => {
                    if (!liked) openRename(playlist);
                  }}
                  disabled={liked}
                  className="group flex max-w-full items-center gap-2 text-left disabled:cursor-default"
                  title={liked ? undefined : "Rename playlist"}
                >
                  <h1 className="min-w-0 truncate font-display text-[30px] font-extrabold leading-tight tracking-[-0.03em] text-white sm:text-[38px]">
                    {playlist.name}
                  </h1>
                  {!liked && (
                    <Pencil className="h-4 w-4 shrink-0 text-white/20 opacity-0 transition group-hover:opacity-100" />
                  )}
                </button>
                {playlist.description && (
                  <p className="mt-1.5 max-w-xl truncate text-[12px] text-white/40">
                    {playlist.description}
                  </p>
                )}
                <p className="mt-2 text-[11px] text-white/35">
                  {spotifyMode ? (
                    <>
                      {spotifySnapshot?.total ?? 0} tracks
                      <span className="mx-1.5 text-white/15">·</span>
                      {spotifySnapshot?.downloaded ?? 0} on PC
                      <span className="mx-1.5 text-white/15">·</span>
                      <span
                        className={cn(
                          (spotifySnapshot?.missing ?? 0) > 0 &&
                            "text-amber-200/60",
                        )}
                      >
                        {spotifySnapshot?.missing ?? 0} missing
                      </span>
                    </>
                  ) : liked ? (
                    <>
                      {playlist.trackPaths.length}{" "}
                      {playlist.trackPaths.length === 1 ? "song" : "songs"}
                      <span className="mx-1.5 text-white/15">·</span>
                      {formatTimeLong(totalMs)}
                    </>
                  ) : (
                    <>
                      {formatCount(playlist.trackPaths.length, "track")}
                      <span className="mx-1.5 text-white/15">·</span>
                      {formatTimeLong(totalMs)}
                      {missing > 0 && (
                        <>
                          <span className="mx-1.5 text-white/15">·</span>
                          <span className="text-amber-200/60">
                            {missing} missing from library
                          </span>
                        </>
                      )}
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={playAll}
                disabled={displayTracks.length === 0}
                className="flex h-9 items-center gap-2 rounded-full bg-accent px-5 text-[12px] font-bold text-black shadow-glow transition hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Play
              </button>
              <button
                type="button"
                onClick={shuffleAll}
                disabled={displayTracks.length === 0}
                className="flex h-9 items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.05] px-4 text-[11.5px] font-semibold text-white/60 transition hover:bg-white/[0.09] hover:text-white disabled:pointer-events-none disabled:opacity-40"
              >
                <Shuffle className="h-3.5 w-3.5" />
                Shuffle
              </button>

              <SortDropdown
                mode={activeSort.mode}
                reverse={activeSort.reverse}
                onModeChange={activeSort.setMode}
                onReverseChange={activeSort.setReverse}
                align="left"
              />

              {spotifyMode && (
                <>
                  <button
                    type="button"
                    onClick={() => void downloadMissing()}
                    disabled={
                      spotifySyncing ||
                      !spotifySnapshot ||
                      spotifySnapshot.missing === 0
                    }
                    className="flex h-9 items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.05] px-4 text-[11.5px] font-semibold text-white/60 transition hover:bg-white/[0.09] hover:text-white disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download Missing
                  </button>
                  <button
                    type="button"
                    onClick={() => void syncSpotify()}
                    disabled={spotifySyncing}
                    className="flex h-9 items-center gap-2 rounded-full border border-[#8e8ee8]/30 bg-[#450af5]/15 px-4 text-[11.5px] font-semibold text-[#c9bcff] transition hover:bg-[#450af5]/25 hover:text-white disabled:pointer-events-none disabled:opacity-50"
                  >
                    {spotifySyncing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {spotifySyncing ? "Syncing…" : "Sync with Spotify"}
                  </button>
                </>
              )}

              {!spotifyMode && (
                <div ref={optionsRef} className="relative">
                <button
                  type="button"
                  onClick={() => setOptionsOpen((value) => !value)}
                  aria-label="Playlist options"
                  title="Playlist options"
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.05] text-white/45 transition hover:bg-white/[0.09] hover:text-white",
                    optionsOpen && "bg-white/[0.1] text-white",
                  )}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                <AnimatePresence>
                  {optionsOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -3, scale: 0.98 }}
                      transition={{ duration: 0.14 }}
                      className="dropdown-menu absolute left-0 top-full z-30 mt-1.5 w-52 rounded-xl border border-white/10 bg-[#141419]/85 p-1 shadow-glass backdrop-blur-[20px]"
                      role="menu"
                    >
                      {!liked && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOptionsOpen(false);
                            openRename(playlist);
                          }}
                          className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[11.5px] font-medium text-white/65 transition hover:bg-white/[0.07] hover:text-white"
                        >
                          <Pencil className="h-3.5 w-3.5 text-white/35" />
                          Rename playlist
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOptionsOpen(false);
                          void exportM3U(playlist.id);
                        }}
                        className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[11.5px] font-medium text-white/65 transition hover:bg-white/[0.07] hover:text-white"
                      >
                        <Download className="h-3.5 w-3.5 text-white/35" />
                        Export as .m3u
                      </button>
                      {!liked && (
                        <>
                          <div className="my-1 h-px bg-white/[0.07]" />
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOptionsOpen(false);
                              setConfirmDelete(true);
                            }}
                            className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[11.5px] font-medium text-rose-300/80 transition hover:bg-rose-400/[0.08] hover:text-rose-200"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete playlist
                          </button>
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              )}
            </div>
          </div>
        </header>

        <div className="px-6 pb-8 lg:px-8">
          {spotifyMode ? (
            spotifyRows.length === 0 ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-8 py-10 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#450af5]/20 text-[#c9bcff]">
                  <Heart className="h-6 w-6 fill-current" />
                </span>
                <h2 className="mt-4 font-display text-[16px] font-bold text-white/80">
                  {spotifySnapshot
                    ? "No liked songs found"
                    : "Sync your Spotify liked songs"}
                </h2>
                <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-white/30">
                  {spotifySnapshot
                    ? "The signed-in Spotify account has no liked tracks yet."
                    : "Pull your Spotify liked songs and match them to files in your local library."}
                </p>
                <button
                  type="button"
                  onClick={() => void syncSpotify()}
                  disabled={spotifySyncing}
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#8e8ee8]/30 bg-[#450af5]/20 px-4 py-2 text-[11px] font-semibold text-[#d8c8ff] transition hover:bg-[#450af5]/30 hover:text-white disabled:pointer-events-none disabled:opacity-50"
                >
                  {spotifySyncing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {spotifySyncing ? "Syncing…" : "Sync with Spotify"}
                </button>
              </div>
            ) : (
              <>
                <div
                  className={cn(
                    "mb-1 grid h-8 items-center gap-3 border-b border-white/[0.06] px-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-white/20",
                    SPOTIFY_ROW_GRID,
                  )}
                >
                  <span className="text-center">#</span>
                  <span>Title</span>
                  <span className="hidden md:block">Album</span>
                  <span className="flex justify-end">
                    <Clock3 className="h-3 w-3" />
                  </span>
                  <span />
                </div>

                <VirtualRowList
                  count={sortedSpotifyRows.length}
                  rowHeight={PLAYLIST_ROW_HEIGHT}
                  scrollRef={scrollRef}
                  layoutKey={`spotify:${playlist.id}:${sortedSpotifyRows.length}:${spotifySort.mode}:${spotifySort.reverse}`}
                  getKey={(index) => {
                    const row = sortedSpotifyRows[index];
                    return `${row.item.id}-${index}`;
                  }}
                  renderRow={(index) => {
                    const { item, track } = sortedSpotifyRows[index];
                    const active = Boolean(
                      track &&
                        (currentTrack?.id === track.id ||
                          currentTrack?.path === track.path),
                    );
                    return (
                      <SpotifyLikedRow
                        item={item}
                        track={track}
                        index={index}
                        active={active}
                        playing={isPlaying}
                        onPlay={playFromSpotifyLiked}
                        onPause={pausePlayback}
                        onDownload={downloadLikedTrack}
                        onUnlike={unlikeLikedTrack}
                      />
                    );
                  }}
                />
              </>
            )
          ) : resolvedTracks.length === 0 ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-8 py-10 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.05]">
                <ListMusic className="h-6 w-6 text-white/30" />
              </span>
              <h2 className="mt-4 font-display text-[16px] font-bold text-white/80">
                No tracks in this playlist
              </h2>
              <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-white/30">
                Right-click any track and choose “Add to playlist”, or import an M3U file
                from the library header.
              </p>
              <button
                type="button"
                onClick={() => navigate({ type: "library", section: "tracks" })}
                className="mt-4 rounded-full border border-white/[0.1] bg-white/[0.05] px-4 py-2 text-[11px] font-semibold text-white/60 transition hover:bg-white/[0.09] hover:text-white"
              >
                Browse library
              </button>
            </div>
          ) : (
            <>
              <div className="mb-1 grid h-8 grid-cols-[26px_minmax(0,1fr)_52px_26px] items-center gap-3 border-b border-white/[0.06] px-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-white/20 md:grid-cols-[26px_minmax(0,2.2fr)_minmax(0,1.4fr)_52px_26px]">
                <span className="text-center">#</span>
                <span>Title</span>
                <span className="hidden md:block">Album</span>
                <span className="flex justify-end">
                  <Clock3 className="h-3 w-3" />
                </span>
                <span />
              </div>

              <VirtualRowList
                count={sortedTracks.length}
                rowHeight={PLAYLIST_ROW_HEIGHT}
                scrollRef={scrollRef}
                layoutKey={`local:${playlist.id}:${sortedTracks.length}:${playlistSort.mode}:${playlistSort.reverse}`}
                getKey={(index) => `${sortedTracks[index].id}-${index}`}
                renderRow={(index) => {
                  const track = sortedTracks[index];
                  return (
                    <PlaylistTrackRow
                      playlist={playlist}
                      track={track}
                      index={index}
                      active={currentTrack?.id === track.id}
                      playing={isPlaying}
                      onPlay={playFromPlaylist}
                      onPause={pausePlayback}
                      onRemove={removeFromPlaylist}
                    />
                  );
                }}
              />
            </>
          )}

          {(spotifyMode ? spotifyRows.length > 0 : resolvedTracks.length > 0) && (
            <p className="mt-4 text-center text-[10px] text-white/15">
              {spotifyMode
                ? "Downloaded liked songs play from your library · missing tracks can be queued above"
                : "Double-click a track to play the playlist from there · right-click for more"}
            </p>
          )}
        </div>
      </div>

      {createPortal(
        <AnimatePresence>
          {confirmDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[175] flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) setConfirmDelete(false);
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="delete-playlist-title"
                className="settings-modal w-full max-w-[380px] rounded-2xl p-5"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-400/10 text-rose-300">
                    <Trash2 className="h-4 w-4" />
                  </span>
                  <h2
                    id="delete-playlist-title"
                    className="text-[14px] font-bold text-white"
                  >
                    Delete playlist?
                  </h2>
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-white/40">
                  “{playlist.name}” will be removed. The audio files stay untouched.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="h-8 rounded-full px-3.5 text-[11.5px] font-semibold text-white/40 transition hover:bg-white/[0.06] hover:text-white/75"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void deletePlaylist()}
                    className="h-8 rounded-full bg-rose-400/90 px-4 text-[11.5px] font-bold text-black transition hover:bg-rose-300"
                  >
                    Delete
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
