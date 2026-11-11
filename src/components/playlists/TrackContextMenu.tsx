import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  FolderPlus,
  Heart,
  ListMusic,
  ListPlus,
  Loader2,
  Play,
  Trash2,
} from "lucide-react";

import type { Playlist, Track } from "@/types";
import { isLikedPlaylist } from "@/types";
import { cn } from "@/lib/cn";
import { backend } from "@/lib/api";
import { useTrackMenuStore } from "@/store/contextMenuStore";
import { usePlaylistDialogStore } from "@/store/playlistDialogStore";
import { usePlaylistStore, useIsLiked } from "@/store/playlistStore";
import { usePlayerStore } from "@/store/playerStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useSpotifyLikedStore } from "@/store/spotifyLikedStore";
import { useToastStore } from "@/store/toastStore";

const MENU_WIDTH = 232;
const SUBMENU_WIDTH = 236;

function MenuItem({
  icon,
  label,
  onClick,
  danger,
  trailing,
  onMouseEnter,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  trailing?: React.ReactNode;
  onMouseEnter?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[11.5px] font-medium outline-none transition-colors focus-visible:bg-white/[0.09]",
        danger
          ? "text-rose-300/80 hover:bg-rose-400/[0.08] hover:text-rose-200"
          : "text-white/65 hover:bg-white/[0.07] hover:text-white",
      )}
    >
      <span className={cn("shrink-0", danger ? "text-rose-300/70" : "text-white/35")}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

export function TrackContextMenu() {
  const open = useTrackMenuStore((state) => state.open);
  const track = useTrackMenuStore((state) => state.track);
  const x = useTrackMenuStore((state) => state.x);
  const y = useTrackMenuStore((state) => state.y);
  const playlistId = useTrackMenuStore((state) => state.playlistId);
  const playlistName = useTrackMenuStore((state) => state.playlistName);
  const close = useTrackMenuStore((state) => state.close);

  const playlists = usePlaylistStore((state) => state.playlists);
  const addTrack = usePlaylistStore((state) => state.addTrack);
  const removeTrack = usePlaylistStore((state) => state.removeTrack);
  const toggleLike = usePlaylistStore((state) => state.toggleLike);
  const localLiked = useIsLiked(track?.path);
  const likedSongsSource = useSettingsStore((state) => state.likedSongsSource);
  const spotifyItem = useSpotifyLikedStore((state) =>
    state.itemForPath(track?.path),
  );
  const spotifyLiked = useSpotifyLikedStore((state) =>
    spotifyItem ? state.likedIds.has(spotifyItem.id) : false,
  );
  const liked =
    localLiked || (likedSongsSource === "spotify" && spotifyLiked);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const openCreate = usePlaylistDialogStore((state) => state.openCreate);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Track | null>(null);
  const [deleting, setDeleting] = useState(false);

  useLayoutEffect(() => {
    if (!open) return;
    const height = menuRef.current?.offsetHeight ?? 260;
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [open, x, y, playlistId, playlists.length]);

  useEffect(() => {
    if (!open) {
      setSubmenuOpen(false);
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  if (!track) return null;

  const customPlaylists = playlists.filter(
    (playlist) => !isLikedPlaylist(playlist),
  );

  const toastAdded = (playlist: Playlist, changed: boolean) => {
    useToastStore.getState().push({
      kind: changed ? "success" : "info",
      title: changed
        ? `Added to "${playlist.name}"`
        : `Already in "${playlist.name}"`,
      description: changed ? track.title : undefined,
    });
  };

  const addToPlaylist = async (playlist: Playlist) => {
    close();
    const result = await addTrack(playlist.id, track.path);
    if (result) toastAdded(playlist, result.changed);
  };

  const toggleLiked = async () => {
    close();
    await toggleLike(track);
  };

  const removeFromPlaylist = async () => {
    if (!playlistId) return;
    close();
    const result = await removeTrack(playlistId, track.path);
    if (result?.changed) {
      useToastStore.getState().push({
        kind: "success",
        title: "Removed from playlist",
        description: `${track.title}${playlistName ? ` · ${playlistName}` : ""}`,
      });
    }
  };

  const deleteFile = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    try {
      const player = usePlayerStore.getState();
      const current = player.currentTrack;
      if (
        current &&
        (current.id === target.id || current.path === target.path)
      ) {
        await backend.stop();
        usePlayerStore.setState({
          currentTrack: null,
          isPlaying: false,
          positionMs: 0,
          durationMs: 0,
        });
      }

      const result = await backend.deleteTrackFile(target.id);
      await usePlayerStore.getState().refreshLibrary();
      usePlayerStore.setState((state) => {
        const playbackQueue = state.playbackQueue.filter(
          (item) => item.id !== target.id,
        );
        return {
          playbackQueue,
          queueIndex: Math.max(
            0,
            Math.min(state.queueIndex, playbackQueue.length - 1),
          ),
        };
      });

      useToastStore.getState().push({
        kind: "success",
        title: result.fileMissing
          ? "Removed from library"
          : "Deleted from device",
        description: result.fileMissing
          ? `${target.title} · file was already missing`
          : `${target.title} · ${target.artist}`,
      });
      setDeleteTarget(null);
    } catch (error) {
      useToastStore.getState().push({
        kind: "error",
        title: "Could not delete file",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDeleting(false);
    }
  };

  const submenuSide =
    position.left + MENU_WIDTH + SUBMENU_WIDTH + 12 > window.innerWidth
      ? "right"
      : "left";

  return createPortal(
    <>
      <AnimatePresence>
        {open && (
        <motion.div
          key="track-context-menu"
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
          style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
          className="context-menu fixed z-[170] rounded-xl border border-white/10 bg-[#141419]/85 p-1 shadow-glass backdrop-blur-[20px]"
          role="menu"
          aria-label={`Track actions for ${track.title}`}
          onContextMenu={(event) => event.preventDefault()}
        >
          <MenuItem
            icon={<Play className="h-3.5 w-3.5" />}
            label="Play now"
            onClick={() => {
              close();
              void playTrack(track);
            }}
          />
          <MenuItem
            icon={<ListPlus className="h-3.5 w-3.5" />}
            label="Add to queue"
            onClick={() => {
              close();
              addToQueue(track);
            }}
          />

          <div
            className="relative"
            onMouseEnter={() => setSubmenuOpen(true)}
            onMouseLeave={() => setSubmenuOpen(false)}
          >
            <MenuItem
              icon={<ListMusic className="h-3.5 w-3.5" />}
              label="Add to playlist"
              onClick={() => setSubmenuOpen((value) => !value)}
              trailing={
                <ChevronRight
                  className={cn(
                    "h-3 w-3 shrink-0 text-white/25 transition-transform",
                    submenuOpen && "translate-x-0.5",
                  )}
                />
              }
            />

            <AnimatePresence>
              {submenuOpen && (
                <motion.div
                  initial={{ opacity: 0, x: submenuSide === "left" ? -4 : 4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  style={{ width: SUBMENU_WIDTH }}
                  className={cn(
                    "context-menu absolute top-0 z-10 rounded-xl border border-white/10 bg-[#16161c]/92 p-1 shadow-glass backdrop-blur-[20px]",
                    submenuSide === "left" ? "left-full ml-1" : "right-full mr-1",
                  )}
                  role="menu"
                >
                  <div className="max-h-[224px] overflow-y-auto">
                    {customPlaylists.length === 0 ? (
                      <p className="px-2.5 py-2 text-[10.5px] leading-relaxed text-white/25">
                        No playlists yet.
                      </p>
                    ) : (
                      customPlaylists.map((playlist) => (
                        <button
                          key={playlist.id}
                          type="button"
                          role="menuitem"
                          onClick={() => void addToPlaylist(playlist)}
                          className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[11px] font-medium text-white/65 transition-colors hover:bg-white/[0.07] hover:text-white"
                        >
                          <ListMusic className="h-3.5 w-3.5 shrink-0 text-white/30" />
                          <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                          <span className="text-[9px] tabular-nums text-white/20">
                            {playlist.trackPaths.length}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="my-1 h-px bg-white/[0.07]" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      openCreate(track.path);
                    }}
                    className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[11px] font-semibold text-accent/90 transition-colors hover:bg-white/[0.07]"
                  >
                    <FolderPlus className="h-3.5 w-3.5 shrink-0" />
                    New playlist
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="my-1 h-px bg-white/[0.07]" />

          <MenuItem
            icon={
              <Heart
                className={cn("h-3.5 w-3.5", liked && "fill-current")}
              />
            }
            label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
            danger={liked}
            onClick={() => void toggleLiked()}
          />

          {playlistId && (
            <>
              <div className="my-1 h-px bg-white/[0.07]" />
              <MenuItem
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label="Remove from this playlist"
                danger
                onClick={() => void removeFromPlaylist()}
              />
            </>
          )}

          <div className="my-1 h-px bg-white/[0.07]" />
          <MenuItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Delete file from device"
            danger
            onClick={() => {
              const target = track;
              close();
              setDeleteTarget(target);
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>

    <AnimatePresence>
      {deleteTarget && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[175] flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !deleting) {
              setDeleteTarget(null);
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-track-file-title"
            className="settings-modal w-full max-w-[400px] rounded-2xl p-5"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-400/10 text-rose-300">
                <Trash2 className="h-4 w-4" />
              </span>
              <h2
                id="delete-track-file-title"
                className="text-[14px] font-bold text-white"
              >
                Delete file from device?
              </h2>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-white/40">
              “{deleteTarget.title}”
              {deleteTarget.artist ? ` · ${deleteTarget.artist}` : ""} will be
              permanently deleted from disk and removed from your library. This
              cannot be undone.
            </p>
            <p
              className="mt-2 truncate text-[10px] text-white/20"
              title={deleteTarget.path}
            >
              {deleteTarget.path}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="h-8 rounded-full px-3.5 text-[11.5px] font-semibold text-white/40 transition hover:bg-white/[0.06] hover:text-white/75 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteFile()}
                disabled={deleting}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-rose-400/90 px-4 text-[11.5px] font-bold text-black transition hover:bg-rose-300 disabled:opacity-60"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete file
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>,
    document.body,
  );
}
