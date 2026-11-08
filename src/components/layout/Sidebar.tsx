import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  BarChart3,
  Bell,
  Disc3,
  FolderPlus,
  Library,
  ListPlus,
  Mic2,
  Palette,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Upload,
  UserRound,
} from "lucide-react";
import type { Track } from "@/types";
import { isDesktop } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usePlayerStore } from "@/store/playerStore";
import { usePlaylistDialogStore } from "@/store/playlistDialogStore";
import { usePlaylistStore } from "@/store/playlistStore";
import { useLucidSettingsStore } from "@/store/lucidSettingsStore";
import {
  countUnseenReleases,
  useReleasesStore,
} from "@/store/releasesStore";
import { useToastStore } from "@/store/toastStore";
import { CoverArt } from "@/components/ui/CoverArt";
import { IconButton } from "@/components/ui/IconButton";
import { PlaylistCover } from "@/components/playlists/PlaylistCover";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { formatCount } from "@/lib/format";

interface AlbumGroup {
  key: string;
  album: string;
  artist: string;
  track: Track;
  count: number;
}

const navItems = [
  { id: "library", label: "Library", icon: Library },
  { id: "artists", label: "Artists", icon: UserRound },
  { id: "releases", label: "New Releases", icon: Bell },
  { id: "stats", label: "Stats", icon: BarChart3 },
  { id: "now-playing", label: "Now Playing", icon: Disc3 },
  { id: "search", label: "Search", icon: Search },
  { id: "karaoke", label: "Karaoke", icon: Mic2 },
] as const;

const fluidText =
  "origin-left overflow-hidden whitespace-nowrap transition-[opacity,transform,max-width] duration-200 ease-out-expo";
const fluidHidden =
  "pointer-events-none max-w-0 opacity-0 scale-90 -translate-x-2.5";

function AlbumCover({ track, size }: { track: Track; size: number }) {
  return (
    <span
      className="shrink-0 overflow-hidden rounded-lg transition-[width,height] duration-[250ms] ease-out-expo"
      style={{ width: size, height: size }}
    >
      <CoverArt
        track={track}
        className="h-full w-full rounded-lg"
        iconClassName="h-4 w-4"
      />
    </span>
  );
}

export function Sidebar({
  collapsed,
  width,
}: {
  collapsed: boolean;
  width: number;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [measuredWidth, setMeasuredWidth] = useState(width);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMenuPosition, setAddMenuPosition] = useState({ left: 12, top: 12 });
  const asideRef = useRef<HTMLElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const tracks = usePlayerStore((state) => state.tracks);
  const view = usePlayerStore((state) => state.view);
  const librarySection = usePlayerStore((state) => state.librarySection);
  const selectedPlaylistId = usePlayerStore((state) => state.selectedPlaylistId);
  const focusMode = usePlayerStore((state) => state.focusMode);
  const search = usePlayerStore((state) => state.search);
  const scanning = usePlayerStore((state) => state.scanning);

  const openPlaylist = usePlayerStore((state) => state.openPlaylist);
  const navigate = usePlayerStore((state) => state.navigate);
  const toggleFocus = usePlayerStore((state) => state.toggleFocus);
  const scan = usePlayerStore((state) => state.scan);
  const addMusicFolder = usePlayerStore((state) => state.addMusicFolder);

  const playlists = usePlaylistStore((state) => state.playlists);
  const importM3U = usePlaylistStore((state) => state.importM3U);
  const openCreatePlaylist = usePlaylistDialogStore((state) => state.openCreate);
  const openLucidDialog = useLucidSettingsStore((state) => state.openDialog);
  const releaseFeed = useReleasesStore((state) => state.feed);
  const seenReleaseIds = useReleasesStore((state) => state.seenReleaseIds);
  const newReleaseCount = useMemo(
    () => countUnseenReleases(releaseFeed, seenReleaseIds),
    [releaseFeed, seenReleaseIds],
  );

  useEffect(() => {
    const element = asideRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth != null) setMeasuredWidth(nextWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const compact = collapsed || measuredWidth < 180;
  const coverSize = compact ? 42 : 48;

  const trackByPath = useMemo(
    () => new Map(tracks.map((track) => [track.path, track])),
    [tracks],
  );

  const playlistTracks = (trackPaths: string[]) =>
    trackPaths
      .map((trackPath) => trackByPath.get(trackPath))
      .filter((track): track is Track => Boolean(track))
      .slice(0, 4);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addMenuOpen]);

  const toggleAddMenu = () => {
    if (addMenuOpen) {
      setAddMenuOpen(false);
      return;
    }
    const rect = addButtonRef.current?.getBoundingClientRect();
    const menuWidth = 208;
    const anchorRight = compact ? (rect?.right ?? 48) + 6 : rect?.right ?? 48;
    const left = compact
      ? Math.max(8, Math.min(anchorRight, window.innerWidth - menuWidth - 8))
      : Math.max(8, Math.min(anchorRight - menuWidth, window.innerWidth - menuWidth - 8));
    setAddMenuPosition({ left, top: (rect?.bottom ?? 48) + 6 });
    setAddMenuOpen(true);
  };

  const createPlaylist = () => {
    setAddMenuOpen(false);
    openCreatePlaylist();
  };

  const importPlaylist = async () => {
    setAddMenuOpen(false);
    const playlist = await importM3U();
    if (playlist) openPlaylist(playlist.id);
  };

  const albums = useMemo<AlbumGroup[]>(() => {
    const map = new Map<string, AlbumGroup>();
    for (const track of tracks) {
      const key = `${track.album}\u0000${track.artist}`;
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else
        map.set(key, {
          key,
          album: track.album,
          artist: track.artist,
          track,
          count: 1,
        });
    }
    return [...map.values()]
      .sort((a, b) => b.count - a.count || a.album.localeCompare(b.album))
      .slice(0, 7);
  }, [tracks]);

  const handleNav = (id: (typeof navItems)[number]["id"]) => {
    if (id === "library") {
      navigate({ type: "library", section: "tracks" });
      return;
    }
    if (id === "artists") {
      navigate({ type: "artists" });
      return;
    }
    if (id === "releases") {
      navigate({ type: "releases" });
      return;
    }
    if (id === "stats") {
      navigate({ type: "stats" });
      return;
    }
    if (id === "now-playing") {
      navigate({ type: "karaoke" });
      return;
    }
    if (id === "search") {
      navigate({ type: "search", query: "" });
      window.dispatchEvent(new CustomEvent("lyricsplus:focus-search"));
      return;
    }
    toggleFocus();
  };

  const isActive = (id: (typeof navItems)[number]["id"]) => {
    if (id === "library") {
      return view === "library" && librarySection !== "artists";
    }
    if (id === "artists") {
      return (
        view === "artist" ||
        (view === "library" && librarySection === "artists")
      );
    }
    if (id === "stats") return view === "stats";
    if (id === "releases") return view === "releases";
    if (id === "now-playing") return view === "player" && !focusMode;
    if (id === "karaoke") return focusMode;
    return false;
  };

  const pickFolder = async () => {
    try {
      if (!isDesktop) {
        useToastStore.getState().push({
          kind: "info",
          title: "Desktop folder picker",
          description: "The browser preview scans a simulated library. Run the desktop app to add folders.",
        });
        await scan([]);
        return;
      }
      await addMusicFolder();
    } catch (error) {
      useToastStore.getState().push({
        kind: "error",
        title: "Could not open folder picker",
        description: String(error),
      });
    }
  };

  return (
    <aside
      ref={asideRef}
      className="sidebar-content flex h-full w-full shrink-0 flex-col gap-2 overflow-hidden"
    >
      <nav
        className={cn(
          "sidebar-card lucid-glass-panel glass flex flex-col rounded-2xl transition-[padding] duration-[250ms] ease-out-expo",
          compact ? "items-center gap-1 p-2" : "p-2",
        )}
      >
        {navItems.map((item) => {
          const active = isActive(item.id);
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              title={compact ? item.label : undefined}
              aria-label={item.label}
              onClick={() => handleNav(item.id)}
              className={cn(
                "lucid-nav-item relative mx-auto flex items-center rounded-xl text-left text-[13px] font-medium outline-none transition-[color,background-color,width,height,padding,gap] duration-[250ms] ease-out-expo focus-visible:ring-2 focus-visible:ring-accent/60",
                compact
                  ? "lucid-nav-item-compact h-10 w-10 justify-center px-0 py-0"
                  : "w-full gap-3 px-3 py-2.5",
                active ? "text-white" : "text-white/45 hover:text-white/80",
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-xl bg-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,.05)]"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              )}
              <Icon
                className={cn(
                  "relative z-10 h-[17px] w-[17px] shrink-0 transition-colors duration-200",
                  active && "text-accent",
                )}
                strokeWidth={active ? 2.2 : 1.8}
              />
              <span
                aria-hidden={compact}
                className={cn(
                  "relative z-10 min-w-0 truncate",
                  fluidText,
                  compact ? "hidden" : "max-w-[150px] opacity-100 scale-100 translate-x-0",
                )}
              >
                {item.label}
              </span>
              {item.id === "releases" && newReleaseCount > 0 && (
                <span
                  aria-label={`${newReleaseCount} new release${
                    newReleaseCount === 1 ? "" : "s"
                  }`}
                  className={cn(
                    "z-10 shrink-0 rounded-full bg-accent font-bold text-black",
                    compact
                      ? "absolute right-1.5 top-1.5 h-1.5 w-1.5 ring-2 ring-[#0b0b0e]/80"
                      : "ml-auto min-w-[18px] px-1.5 py-0.5 text-center text-[9.5px] tabular-nums",
                  )}
                >
                  {compact ? "" : newReleaseCount > 99 ? "99+" : newReleaseCount}
                </span>
              )}
              {item.id === "karaoke" && (
                <span
                  aria-hidden={compact}
                  className={cn(
                    "relative z-10 shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-accent",
                    fluidText,
                    compact
                      ? "hidden"
                      : "ml-auto max-w-[40px] opacity-100 scale-100 translate-x-0",
                  )}
                >
                  Live
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-card lucid-glass-panel glass flex min-h-0 flex-1 flex-col rounded-2xl">
        <div
          className={cn(
            "flex shrink-0 items-center transition-[padding] duration-[250ms] ease-out-expo",
            compact
              ? "justify-center px-0 pb-1 pt-2"
              : "justify-between px-3.5 pb-2 pt-3.5",
          )}
        >
          <div
            aria-hidden={compact}
            className={cn(
              "flex min-w-0 items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35",
              fluidText,
              compact ? fluidHidden : "opacity-100 scale-100 translate-x-0",
            )}
          >
            <span>Your library</span>
            <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] tracking-normal text-white/35">
              {tracks.length}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              ref={addButtonRef}
              type="button"
              onClick={toggleAddMenu}
              title="Create playlist or import"
              aria-label="Create playlist or import"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white/35 outline-none transition hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <ListPlus className="h-3.5 w-3.5" />
            </button>
            <IconButton label="Scan a folder" size="sm" onClick={pickFolder} disabled={scanning}>
              <FolderPlus className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
          <button
            type="button"
            title={compact ? "All tracks" : undefined}
            aria-label="All tracks"
            onClick={() => {
              navigate({ type: "library", section: "tracks" });
            }}
            className={cn(
              "group flex w-full items-center rounded-xl text-left transition-[background-color,padding,gap] duration-[250ms] ease-out-expo",
              compact ? "justify-center gap-0 px-0 py-1.5" : "gap-2.5 px-2 py-2",
              view === "library" &&
                librarySection === "tracks" &&
                search === ""
                ? "bg-white/[0.05]"
                : "hover:bg-white/[0.04]",
            )}
          >
            <span
              className="flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-white/[0.12] to-white/[0.03] transition-[width,height] duration-[250ms] ease-out-expo"
              style={{ width: coverSize, height: coverSize }}
            >
              <Sparkles className="h-4 w-4 text-white/60" />
            </span>
            <span
              aria-hidden={compact}
              className={cn(
                "block min-w-0",
                fluidText,
                compact ? fluidHidden : "max-w-[210px] opacity-100 scale-100 translate-x-0",
              )}
            >
              <span className="block truncate text-[12.5px] font-semibold text-white/85">
                All tracks
              </span>
              <span className="block text-[10.5px] text-white/35">
                {formatCount(tracks.length, "track")}
              </span>
            </span>
          </button>

          <div
            className={cn(
              "my-2 h-px bg-white/[0.05] transition-[margin,width] duration-[250ms] ease-out-expo",
              compact ? "mx-auto w-8" : "mx-2",
            )}
          />

          {playlists.length > 0 && (
            <>
              {!compact && (
                <div className="flex items-center justify-between px-2 pb-1 pt-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-white/25">
                  <span>Playlists</span>
                  <span className="tabular-nums text-white/15">{playlists.length}</span>
                </div>
              )}
              {playlists.map((playlist) => {
                const active =
                  view === "playlist" && selectedPlaylistId === playlist.id;
                return (
                  <button
                    key={playlist.id}
                    type="button"
                    title={compact ? playlist.name : undefined}
                    aria-label={`${playlist.name} playlist`}
                    onClick={() => openPlaylist(playlist.id)}
                    className={cn(
                      "group flex w-full items-center rounded-xl text-left transition-[background-color,padding,gap] duration-[250ms] ease-out-expo",
                      compact
                        ? "justify-center gap-0 px-0 py-1.5"
                        : "gap-2.5 px-2 py-1.5",
                      active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]",
                    )}
                  >
                    <PlaylistCover
                      tracks={playlistTracks(playlist.trackPaths)}
                      size={coverSize}
                      className="rounded-lg"
                      iconClassName="h-4 w-4"
                    />
                    <span
                      aria-hidden={compact}
                      className={cn(
                        "min-w-0 flex-1",
                        fluidText,
                        compact
                          ? fluidHidden
                          : "max-w-[210px] opacity-100 scale-100 translate-x-0",
                      )}
                    >
                      <span className="block truncate text-[12px] font-medium text-white/75 group-hover:text-white">
                        {playlist.name}
                      </span>
                      <span className="block truncate text-[10.5px] text-white/30">
                        {formatCount(playlist.trackPaths.length, "track")}
                      </span>
                    </span>
                  </button>
                );
              })}
              <div
                className={cn(
                  "my-2 h-px bg-white/[0.05]",
                  compact ? "mx-auto w-8" : "mx-2",
                )}
              />
            </>
          )}

          {!compact && albums.length > 0 && (
            <div className="px-2 pb-1 pt-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-white/25">
              Albums
            </div>
          )}

          {albums.map((album) => {
            const active =
              search === album.album &&
              view === "library" &&
              librarySection === "tracks";
            return (
              <button
                key={album.key}
                type="button"
                title={compact ? `${album.album} — ${album.artist}` : undefined}
                aria-label={`${album.album} — ${album.artist}`}
                onClick={() => {
                  navigate({ type: "search", query: album.album });
                }}
                className={cn(
                  "group flex w-full items-center rounded-xl text-left transition-[background-color,padding,gap] duration-[250ms] ease-out-expo",
                  compact ? "justify-center gap-0 px-0 py-1.5" : "gap-2.5 px-2 py-1.5",
                  active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]",
                )}
              >
                <AlbumCover track={album.track} size={coverSize} />
                <span
                  aria-hidden={compact}
                  className={cn(
                    "min-w-0 flex-1",
                    fluidText,
                    compact ? fluidHidden : "max-w-[210px] opacity-100 scale-100 translate-x-0",
                  )}
                >
                  <span className="block truncate text-[12px] font-medium text-white/75 group-hover:text-white">
                    {album.album}
                  </span>
                  <span className="block truncate text-[10.5px] text-white/30">
                    {album.artist}
                  </span>
                </span>
                <span
                  aria-hidden={compact}
                  className={cn(
                    "shrink-0 text-[9.5px] tabular-nums text-white/20",
                    fluidText,
                    compact ? fluidHidden : "max-w-[32px] opacity-100 scale-100 translate-x-0",
                  )}
                >
                  {album.count}
                </span>
              </button>
            );
          })}

          {albums.length === 0 && (
            <p
              aria-hidden={compact}
              className={cn(
                "px-2 py-6 text-center text-[11px] leading-relaxed text-white/25 transition-opacity duration-200",
                compact && "pointer-events-none opacity-0",
              )}
            >
              Albums appear here after
              <br />
              your first library scan.
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-white/[0.06] px-2.5 pb-3 pt-2.5">
          <button
            type="button"
            title={compact ? (scanning ? "Scanning…" : "Add music folder") : undefined}
            aria-label={scanning ? "Scanning…" : "Add music folder"}
            onClick={pickFolder}
            disabled={scanning}
            className={cn(
              "flex w-full items-center justify-center rounded-xl bg-white/[0.06] font-semibold text-white/70 transition-[background-color,color,gap,padding] duration-[250ms] ease-out-expo hover:bg-white/[0.1] hover:text-white disabled:opacity-40",
              compact ? "gap-0 px-0 py-2.5" : "gap-2 py-2 text-[11.5px]",
            )}
          >
            <FolderPlus className="h-3.5 w-3.5 shrink-0" />
            <span
              aria-hidden={compact}
              className={cn(
                "min-w-0",
                fluidText,
                compact ? fluidHidden : "max-w-[150px] opacity-100 scale-100 translate-x-0",
              )}
            >
              {scanning ? "Scanning…" : "Add music folder"}
            </span>
          </button>
          <div
            className={cn(
              "flex rounded-xl transition-[padding,justify-content] duration-[250ms] ease-out-expo",
              compact
                ? "mx-auto mt-2 w-fit flex-col items-center gap-1 py-1"
                : "mt-1.5 items-center justify-end gap-1 px-1.5 py-1",
            )}
          >
            <IconButton
              label="Lucid Settings"
              size="sm"
              onClick={openLucidDialog}
            >
              <Palette className="h-3 w-3" />
            </IconButton>
            <IconButton label="Settings" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="h-3 w-3" />
            </IconButton>
            <IconButton
              label="Quick scan ~/Music"
              size="sm"
              onClick={() => void scan([])}
              disabled={scanning}
            >
              <RefreshCw className={cn("h-3 w-3", scanning && "animate-spin")} />
            </IconButton>
          </div>
        </div>
      </div>

      {addMenuOpen &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[140]"
              onPointerDown={() => setAddMenuOpen(false)}
            />
            <div
              role="menu"
              aria-label="Playlist actions"
              style={{ left: addMenuPosition.left, top: addMenuPosition.top }}
              className="dropdown-menu fixed z-[150] w-52 rounded-xl border border-white/10 bg-[#141419]/85 p-1 shadow-glass backdrop-blur-[20px]"
            >
              <button
                type="button"
                role="menuitem"
                onClick={createPlaylist}
                className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition hover:bg-white/[0.07]"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                  <ListPlus className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-semibold text-white/80">
                    Create playlist
                  </span>
                  <span className="block text-[9.5px] text-white/25">
                    Start an empty collection
                  </span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void importPlaylist()}
                className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition hover:bg-white/[0.07]"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-white/45">
                  <Upload className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-semibold text-white/80">
                    Import .m3u
                  </span>
                  <span className="block text-[9.5px] text-white/25">
                    Read paths from a playlist file
                  </span>
                </span>
              </button>
            </div>
          </>,
          document.body,
        )}

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </aside>
  );
}
