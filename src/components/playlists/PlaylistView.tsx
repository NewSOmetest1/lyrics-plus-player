import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Clock3,
  Download,
  ListMusic,
  MoreHorizontal,
  Pencil,
  Play,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";

import type { Playlist, Track } from "@/types";
import { cn } from "@/lib/cn";
import { formatCount, formatTime, formatTimeLong } from "@/lib/format";
import { coverUrl } from "@/lib/api";
import { useCoverPalette } from "@/hooks/useCoverPalette";
import { usePlayerStore } from "@/store/playerStore";
import { usePlaylistStore } from "@/store/playlistStore";
import { usePlaylistDialogStore } from "@/store/playlistDialogStore";
import { useTrackMenuStore } from "@/store/contextMenuStore";
import { useToastStore } from "@/store/toastStore";
import { CoverArt } from "@/components/ui/CoverArt";
import { EqualizerBars } from "@/components/ui/EqualizerBars";
import { ArtistLinks } from "@/components/artists/ArtistLinks";
import { PlaylistCover } from "@/components/playlists/PlaylistCover";

function PlaylistTrackRow({
  playlist,
  track,
  index,
  active,
  playing,
  onPlay,
  onRemove,
}: {
  playlist: Playlist;
  track: Track;
  index: number;
  active: boolean;
  playing: boolean;
  onPlay: () => void;
  onRemove: () => void;
}) {
  const openMenu = useTrackMenuStore((state) => state.openMenu);

  return (
    <div
      role="row"
      tabIndex={0}
      onDoubleClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === "Enter") onPlay();
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
      <span className="flex w-[26px] items-center justify-center text-[10.5px] tabular-nums text-white/25">
        {active && playing ? (
          <EqualizerBars playing className="h-3.5 justify-center" />
        ) : (
          String(index + 1).padStart(2, "0")
        )}
      </span>

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
          onRemove();
        }}
        aria-label={`Remove ${track.title} from playlist`}
        title="Remove from playlist"
        className="flex h-6 w-6 items-center justify-center rounded-full text-white/20 opacity-0 transition hover:bg-white/10 hover:text-white/75 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

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
  const setShuffle = usePlayerStore((state) => state.setShuffle);
  const navigate = usePlayerStore((state) => state.navigate);

  const openRename = usePlaylistDialogStore((state) => state.openRename);

  const [optionsOpen, setOptionsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const optionsRef = useRef<HTMLDivElement | null>(null);

  const playlist = playlists.find((item) => item.id === selectedPlaylistId) ?? null;

  const resolvedTracks = useMemo(() => {
    if (!playlist) return [];
    const byPath = new Map(tracks.map((track) => [track.path, track]));
    return playlist.trackPaths
      .map((trackPath) => byPath.get(trackPath))
      .filter((track): track is Track => Boolean(track));
  }, [playlist, tracks]);

  const missing = playlist ? playlist.trackPaths.length - resolvedTracks.length : 0;
  const totalMs = resolvedTracks.reduce((sum, track) => sum + track.durationMs, 0);
  const palette = useCoverPalette(
    coverUrl(resolvedTracks[0] ?? null, true),
    playlist?.name ?? "playlist",
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
    if (resolvedTracks.length === 0) return;
    setShuffle(false);
    void playTrack(resolvedTracks[0], 0, resolvedTracks);
  };

  const shuffleAll = () => {
    if (resolvedTracks.length === 0) return;
    setShuffle(true);
    const index = Math.floor(Math.random() * resolvedTracks.length);
    void playTrack(resolvedTracks[index], 0, resolvedTracks);
  };

  const handleRemoveTrack = async (track: Track) => {
    const result = await removeTrack(playlist.id, track.path);
    if (result?.changed) {
      useToastStore.getState().push({
        kind: "success",
        title: "Removed from playlist",
        description: track.title,
      });
    }
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
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
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
                tracks={resolvedTracks.slice(0, 4)}
                className="h-36 w-36 rounded-2xl shadow-[0_24px_60px_-18px_rgba(0,0,0,.85)] sm:h-44 sm:w-44"
                iconClassName="h-12 w-12"
              />
              <div className="min-w-0 flex-1 pb-1">
                <button
                  type="button"
                  onClick={() => openRename(playlist)}
                  className="group flex max-w-full items-center gap-2 text-left"
                  title="Rename playlist"
                >
                  <h1 className="min-w-0 truncate font-display text-[30px] font-extrabold leading-tight tracking-[-0.03em] text-white sm:text-[38px]">
                    {playlist.name}
                  </h1>
                  <Pencil className="h-4 w-4 shrink-0 text-white/20 opacity-0 transition group-hover:opacity-100" />
                </button>
                {playlist.description && (
                  <p className="mt-1.5 max-w-xl truncate text-[12px] text-white/40">
                    {playlist.description}
                  </p>
                )}
                <p className="mt-2 text-[11px] text-white/35">
                  {formatCount(playlist.trackPaths.length, "track")}
                  <span className="mx-1.5 text-white/15">·</span>
                  {formatTimeLong(totalMs)}
                  {missing > 0 && (
                    <>
                      <span className="mx-1.5 text-white/15">·</span>
                      <span className="text-amber-200/60">{missing} missing from library</span>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={playAll}
                disabled={resolvedTracks.length === 0}
                className="flex h-9 items-center gap-2 rounded-full bg-accent px-5 text-[12px] font-bold text-black shadow-glow transition hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Play
              </button>
              <button
                type="button"
                onClick={shuffleAll}
                disabled={resolvedTracks.length === 0}
                className="flex h-9 items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.05] px-4 text-[11.5px] font-semibold text-white/60 transition hover:bg-white/[0.09] hover:text-white disabled:pointer-events-none disabled:opacity-40"
              >
                <Shuffle className="h-3.5 w-3.5" />
                Shuffle
              </button>

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
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </header>

        <div className="px-6 pb-8 lg:px-8">
          {resolvedTracks.length === 0 ? (
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

              {resolvedTracks.map((track, index) => {
                const active = currentTrack?.id === track.id;
                return (
                  <PlaylistTrackRow
                    key={`${track.id}-${index}`}
                    playlist={playlist}
                    track={track}
                    index={index}
                    active={active}
                    playing={isPlaying}
                    onPlay={() => {
                      setShuffle(false);
                      void playTrack(track, 0, resolvedTracks);
                    }}
                    onRemove={() => void handleRemoveTrack(track)}
                  />
                );
              })}
            </>
          )}

          {resolvedTracks.length > 0 && (
            <p className="mt-4 text-center text-[10px] text-white/15">
              Double-click a track to play the playlist from there · right-click for more
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
