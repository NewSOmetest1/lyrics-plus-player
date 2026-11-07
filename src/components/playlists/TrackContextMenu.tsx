import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  FolderPlus,
  Heart,
  ListMusic,
  ListPlus,
  Play,
  Trash2,
} from "lucide-react";

import type { Playlist } from "@/types";
import { cn } from "@/lib/cn";
import { useTrackMenuStore } from "@/store/contextMenuStore";
import { usePlaylistDialogStore } from "@/store/playlistDialogStore";
import { usePlaylistStore } from "@/store/playlistStore";
import { usePlayerStore } from "@/store/playerStore";
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
  const ensureLiked = usePlaylistStore((state) => state.ensureLiked);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const openCreate = usePlaylistDialogStore((state) => state.openCreate);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [submenuOpen, setSubmenuOpen] = useState(false);

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

  const addToLiked = async () => {
    close();
    const liked = await ensureLiked();
    if (!liked) return;
    const result = await addTrack(liked.id, track.path);
    if (result) toastAdded(liked, result.changed);
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

  const submenuSide =
    position.left + MENU_WIDTH + SUBMENU_WIDTH + 12 > window.innerWidth
      ? "right"
      : "left";

  return createPortal(
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
                    {playlists.length === 0 ? (
                      <p className="px-2.5 py-2 text-[10.5px] leading-relaxed text-white/25">
                        No playlists yet.
                      </p>
                    ) : (
                      playlists.map((playlist) => (
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
            icon={<Heart className="h-3.5 w-3.5" />}
            label="Add to Liked Songs"
            onClick={() => void addToLiked()}
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
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
