import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Clock3,
  Disc3,
  FolderPlus,
  HardDrive,
  Play,
  Search,
  Shuffle,
  Sparkles,
  X,
} from "lucide-react";
import type { LibrarySection, Track } from "@/types";
import { backend, isDesktop } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatCount, formatTime, formatTimeLong } from "@/lib/format";
import {
  TRACK_SORT_LABELS,
  TRACK_SORT_MODES,
  readTrackSortPreferences,
  sortTracks,
  writeTrackSortPreferences,
  type TrackSortMode,
} from "@/lib/trackSort";
import { usePlayerStore } from "@/store/playerStore";
import { useToastStore } from "@/store/toastStore";
import { useTrackMenuStore } from "@/store/contextMenuStore";
import { CoverArt } from "@/components/ui/CoverArt";
import { VirtualTrackList } from "@/components/library/VirtualTrackList";
import { LibraryFilterPills } from "@/components/library/LibraryFilterPills";
import { ArtistGrid } from "@/components/artists/ArtistGrid";
import { AlbumGrid } from "@/components/library/AlbumGrid";
import { PlaylistGrid } from "@/components/library/PlaylistGrid";

const SECTION_COPY: Record<
  LibrarySection,
  { eyebrow: string; title: string; description: string; placeholder: string }
> = {
  tracks: {
    eyebrow: "Local library",
    title: "Your Library",
    description:
      "Lossless files, embedded covers, and karaoke-ready lyrics — all local, all yours.",
    placeholder: "Search tracks, albums…",
  },
  albums: {
    eyebrow: "Your collection",
    title: "Albums",
    description:
      "Every record in your local library, grouped by artist and ready to play.",
    placeholder: "Search albums…",
  },
  artists: {
    eyebrow: "Your collection",
    title: "Artists",
    description:
      "Every performer in your library, ranked by how many tracks you own.",
    placeholder: "Search artists…",
  },
  playlists: {
    eyebrow: "Your collection",
    title: "Playlists",
    description:
      "Saved sets and mixes built from the tracks in your local library.",
    placeholder: "Search playlists…",
  },
};

function StatChip({
  icon: Icon,
  children,
}: {
  icon: typeof Disc3;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.035] px-2.5 py-1 text-[10.5px] font-medium text-white/40">
      <Icon className="h-3 w-3 text-white/30" />
      {children}
    </span>
  );
}

export function LibraryView() {
  const tracks = usePlayerStore((state) => state.tracks);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const search = usePlayerStore((state) => state.search);
  const librarySection = usePlayerStore((state) => state.librarySection);
  const navigate = usePlayerStore((state) => state.navigate);
  const scanning = usePlayerStore((state) => state.scanning);
  const scanProgress = usePlayerStore((state) => state.scanProgress);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const setSearch = usePlayerStore((state) => state.setSearch);
  const scan = usePlayerStore((state) => state.scan);
  const openMenu = useTrackMenuStore((state) => state.openMenu);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const [sortState, setSortState] = useState(readTrackSortPreferences);
  const [shuffleSeed, setShuffleSeed] = useState(() => Date.now() >>> 0);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortMenuPosition, setSortMenuPosition] = useState({
    left: 12,
    top: 12,
    width: 268,
    maxHeight: 460,
  });
  const sortSignature = `${sortState.mode}:${sortState.reverse ? 1 : 0}:${
    sortState.mode === "shuffle" ? shuffleSeed : 0
  }`;

  const playFromList = useCallback((track: Track) => {
    void usePlayerStore.getState().playTrack(track);
  }, []);

  useEffect(() => {
    const focusSearch = () => {
      window.setTimeout(() => inputRef.current?.focus(), 80);
    };
    window.addEventListener("lyricsplus:focus-search", focusSearch);
    return () => window.removeEventListener("lyricsplus:focus-search", focusSearch);
  }, []);

  useEffect(() => {
    if (!sortMenuOpen) return;
    const close = () => setSortMenuOpen(false);
    const scroller = scrollRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    scroller?.addEventListener("scroll", close, { passive: true });
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
      scroller?.removeEventListener("scroll", close);
    };
  }, [sortMenuOpen]);

  useEffect(() => {
    if (librarySection !== "tracks") return;
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = 0;
  }, [sortSignature, librarySection]);

  const stats = useMemo(() => {
    const albums = new Set(tracks.map((track) => `${track.album}\u0000${track.artist}`));
    const lossless = tracks.filter((track) =>
      ["FLAC", "WAV", "AIFF", "WAVPACK"].includes(track.format),
    ).length;
    const totalMs = tracks.reduce((sum, track) => sum + track.durationMs, 0);
    return { albums: albums.size, lossless, totalMs };
  }, [tracks]);

  const recent = useMemo(() => {
    const seen = new Set<string>();
    return [...tracks]
      .sort((a, b) => b.addedAt - a.addedAt)
      .filter((track) => {
        const key = `${track.album}\u0000${track.artist}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);
  }, [tracks]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return tracks;
    return tracks.filter((track) =>
      [track.title, track.artist, track.album, track.format, track.genre ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [tracks, search]);

  const sortedTracks = useMemo(
    () =>
      sortTracks(
        filtered,
        sortState.mode,
        sortState.reverse,
        shuffleSeed,
      ),
    [filtered, sortState.mode, sortState.reverse, shuffleSeed],
  );

  const setSortMode = (mode: TrackSortMode) => {
    if (mode === "shuffle") {
      setShuffleSeed((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
    }
    setSortState((previous) => {
      const next = { ...previous, mode };
      writeTrackSortPreferences(next.mode, next.reverse);
      return next;
    });
    setSortMenuOpen(false);
  };

  const toggleSortReverse = () => {
    setSortState((previous) => {
      const next = { ...previous, reverse: !previous.reverse };
      writeTrackSortPreferences(next.mode, next.reverse);
      return next;
    });
  };

  const toggleSortMenu = () => {
    if (sortMenuOpen) {
      setSortMenuOpen(false);
      return;
    }
    const rect = sortButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 268;
    const left = Math.max(
      8,
      Math.min(rect.right - width, window.innerWidth - width - 8),
    );
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openAbove = spaceBelow < 430 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      220,
      Math.min(520, openAbove ? spaceAbove : spaceBelow),
    );
    const top = openAbove
      ? Math.max(8, rect.top - maxHeight - 6)
      : rect.bottom + 6;
    setSortMenuPosition({ left, top, width, maxHeight });
    setSortMenuOpen(true);
  };

  const addFolder = async () => {
    try {
      const folder = await backend.pickFolder();
      if (folder) {
        await scan([folder]);
      } else if (!isDesktop) {
        useToastStore.getState().push({
          kind: "info",
          title: "Browser preview",
          description: "Folder picking is available in the desktop app.",
        });
        await scan([]);
      }
    } catch (error) {
      useToastStore.getState().push({
        kind: "error",
        title: "Could not open folder picker",
        description: String(error),
      });
    }
  };

  const progressPercent =
    scanProgress && scanProgress.total > 0
      ? Math.round((scanProgress.current / scanProgress.total) * 100)
      : 0;
  const copy = SECTION_COPY[librarySection];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-6 pb-4 pt-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent/80">
              {copy.eyebrow}
            </p>
            <h1 className="mt-1 font-display text-[32px] font-extrabold leading-tight tracking-[-0.03em] text-white lg:text-[38px]">
              {copy.title}
            </h1>
            <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-white/35">
              {copy.description}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label className="group relative hidden sm:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/25" />
              <input
                ref={inputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy.placeholder}
                className="h-9 w-[230px] rounded-full border border-white/[0.08] bg-white/[0.04] pl-9 pr-8 text-[12px] text-white placeholder:text-white/25 outline-none transition focus:border-accent/40 focus:bg-white/[0.06]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-white/30 hover:text-white"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <button
              type="button"
              onClick={addFolder}
              disabled={scanning}
              className="flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[12px] font-bold text-black shadow-glow transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              Add folder
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <StatChip icon={Sparkles}>{formatCount(tracks.length, "track")}</StatChip>
          <StatChip icon={Disc3}>{formatCount(stats.albums, "album")}</StatChip>
          <StatChip icon={HardDrive}>{stats.lossless} lossless</StatChip>
          <StatChip icon={Clock3}>{formatTimeLong(stats.totalMs)}</StatChip>
          {!isDesktop && (
            <span className="ml-auto rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-2.5 py-1 text-[10px] text-amber-200/70">
              Demo library · run the desktop app for real files
            </span>
          )}
        </div>

        <div className="mt-4">
          <LibraryFilterPills
            active={librarySection}
            onSelect={(section) => {
              if (section === "artists") {
                if (librarySection !== "artists") navigate({ type: "artists" });
                return;
              }
              const query = section === librarySection ? search : "";
              navigate({
                type: "library",
                section,
                query: query || undefined,
              });
            }}
          />
        </div>

        {scanning && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-4 overflow-hidden"
          >
            <div className="rounded-xl border border-accent/15 bg-accent/[0.06] px-4 py-3">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-accent/90">Scanning library…</span>
                <span className="tabular-nums text-white/35">
                  {scanProgress?.current ?? 0} / {scanProgress?.total ?? "—"}
                </span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                <motion.div
                  className="h-full rounded-full bg-accent"
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                />
              </div>
              <p className="mt-1.5 truncate text-[10px] text-white/30">
                {scanProgress?.file ?? "Reading tags and covers…"}
              </p>
            </div>
          </motion.div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto"
      >
        {librarySection === "artists" ? (
          <ArtistGrid query={search} />
        ) : librarySection === "albums" ? (
          <AlbumGrid query={search} />
        ) : librarySection === "playlists" ? (
          <PlaylistGrid query={search} />
        ) : (
          <div className="px-6 pb-6 lg:px-8">
        {tracks.length === 0 ? (
          <div className="flex h-full min-h-[360px] items-center justify-center">
            <div className="glass max-w-md rounded-3xl p-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent/25 to-accent/5">
                <FolderPlus className="h-7 w-7 text-accent" />
              </div>
              <h2 className="mt-5 font-display text-xl font-bold text-white">
                Bring your music home
              </h2>
              <p className="mt-2 text-[12.5px] leading-relaxed text-white/35">
                Point Lyrics+ at a folder with FLAC, MP3, OPUS or WAV files. We read
                tags, artwork and embedded lyrics locally.
              </p>
              <button
                type="button"
                onClick={addFolder}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[12px] font-bold text-black shadow-glow transition hover:brightness-110"
              >
                <FolderPlus className="h-4 w-4" />
                Scan a folder
              </button>
            </div>
          </div>
        ) : (
          <>
            {!search && recent.length > 0 && (
              <section className="mb-7">
                <div className="mb-3 flex items-end justify-between">
                  <h2 className="font-display text-[15px] font-bold tracking-tight text-white/85">
                    Recently added
                  </h2>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-white/25">
                    {stats.albums} albums
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                  {recent.map((track, index) => {
                    const active = currentTrack?.id === track.id;
                    return (
                      <motion.button
                        key={track.id}
                        type="button"
                        onClick={() => void playTrack(track)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          openMenu(track, event.clientX, event.clientY);
                        }}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, delay: index * 0.045, ease: [0.2, 0, 0, 1] }}
                        whileHover={{ y: -3 }}
                        className="group min-w-0 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-2 text-left transition-colors hover:border-white/[0.12] hover:bg-white/[0.05]"
                      >
                        <div className="relative">
                          <CoverArt
                            track={track}
                            className="aspect-square w-full rounded-xl"
                            iconClassName="h-8 w-8"
                          />
                          <span
                            className={cn(
                              "absolute bottom-2 right-2 flex h-9 w-9 translate-y-1 items-center justify-center rounded-full bg-accent text-black opacity-0 shadow-glow transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100",
                              active && "translate-y-0 opacity-100",
                            )}
                          >
                            <Play className="ml-0.5 h-4 w-4 fill-current" />
                          </span>
                          {active && (
                            <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.12em] text-accent backdrop-blur-md">
                              {isPlaying ? "Playing" : "Paused"}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 truncate text-[12px] font-semibold text-white/85 group-hover:text-white">
                          {track.album}
                        </p>
                        <p className="mt-0.5 truncate text-[10.5px] text-white/30">
                          {track.artist}
                        </p>
                      </motion.button>
                    );
                  })}
                </div>
              </section>
            )}

            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-[15px] font-bold tracking-tight text-white/85">
                  {search ? "Search results" : "All tracks"}
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white/25">
                    {formatCount(filtered.length, "track")}
                    {search && (
                      <>
                        {" "}for <span className="text-white/45">“{search}”</span>
                      </>
                    )}
                  </span>
                  <div className="flex h-8 items-stretch overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
                    <button
                      ref={sortButtonRef}
                      type="button"
                      onClick={toggleSortMenu}
                      aria-haspopup="menu"
                      aria-expanded={sortMenuOpen}
                      title={`Sort by: ${TRACK_SORT_LABELS[sortState.mode]}`}
                      className={cn(
                        "flex items-center gap-1.5 pl-3 pr-2.5 text-[10.5px] font-semibold outline-none transition hover:bg-white/[0.06] hover:text-white focus-visible:bg-white/[0.08]",
                        sortState.mode === "default"
                          ? "text-white/45"
                          : "text-white/75",
                      )}
                    >
                      <ArrowUpDown className="h-3.5 w-3.5 text-white/40" />
                      Sort by...
                    </button>
                    <span
                      aria-hidden
                      className="my-1.5 w-px shrink-0 bg-white/[0.09]"
                    />
                    <button
                      type="button"
                      onClick={toggleSortReverse}
                      aria-label={
                        sortState.reverse
                          ? "Sort ascending"
                          : "Sort descending"
                      }
                      aria-pressed={sortState.reverse}
                      title={
                        sortState.reverse
                          ? "Descending order · click for ascending"
                          : "Ascending order · click for descending"
                      }
                      className={cn(
                        "flex w-8 items-center justify-center outline-none transition hover:bg-white/[0.06] focus-visible:bg-white/[0.08]",
                        sortState.reverse
                          ? "text-accent"
                          : "text-white/45 hover:text-white/80",
                      )}
                    >
                      {sortState.reverse ? (
                        <ArrowDown className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowUp className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

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

              {filtered.length === 0 ? (
                <div className="py-16 text-center">
                  <Search className="mx-auto h-6 w-6 text-white/20" />
                  <p className="mt-3 text-[13px] font-medium text-white/45">
                    No tracks match “{search}”
                  </p>
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="mt-3 text-[11px] font-semibold text-accent hover:underline"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <div className="pb-2">
                  <VirtualTrackList
                    tracks={sortedTracks}
                    currentTrackId={currentTrack?.id ?? null}
                    playing={isPlaying}
                    onPlay={playFromList}
                    scrollRef={scrollRef}
                    layoutKey={`${scanning ? "scanning" : "ready"}:${
                      !search && recent.length > 0 ? "recent" : "plain"
                    }:${sortSignature}`}
                  />
                </div>
              )}
            </section>

            <p className="mt-4 text-center text-[10px] text-white/15">
              {formatTime(stats.totalMs)} of lossless audio · click any row to start karaoke
            </p>
          </>
        )}
          </div>
        )}
      </div>

      {sortMenuOpen &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[140]"
              onPointerDown={() => setSortMenuOpen(false)}
            />
            <div
              role="menu"
              aria-label="Track sorting"
              style={{
                left: sortMenuPosition.left,
                top: sortMenuPosition.top,
                width: sortMenuPosition.width,
                maxHeight: sortMenuPosition.maxHeight,
              }}
              className="dropdown-menu fixed z-[150] flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#141419]/90 shadow-glass backdrop-blur-[20px]"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-3 py-2">
                <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/30">
                  Sort by...
                </span>
                <span className="text-[9px] text-white/20">
                  AIMP order
                </span>
              </div>

              <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-1">
                {TRACK_SORT_MODES.map((mode) => {
                  const selected = sortState.mode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => setSortMode(mode)}
                      className={cn(
                        "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[11.5px] font-medium outline-none transition-colors focus-visible:bg-white/[0.08]",
                        selected
                          ? "bg-white/[0.07] text-white"
                          : "text-white/55 hover:bg-white/[0.06] hover:text-white/90",
                      )}
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {selected ? (
                          <Check className="h-3.5 w-3.5 text-accent" />
                        ) : (
                          <span className="h-1 w-1 rounded-full bg-white/15" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {TRACK_SORT_LABELS[mode]}
                      </span>
                      {mode === "shuffle" && (
                        <Shuffle className="h-3 w-3 shrink-0 text-white/25" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="shrink-0 border-t border-white/[0.07] p-1">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={sortState.reverse}
                  onClick={toggleSortReverse}
                  className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[11.5px] font-semibold text-white/70 outline-none transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:bg-white/[0.08]"
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors",
                      sortState.reverse
                        ? "border-accent bg-accent text-black"
                        : "border-white/20 bg-white/[0.03]",
                    )}
                  >
                    {sortState.reverse && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    Reverse order
                  </span>
                  {sortState.reverse ? (
                    <ArrowDown className="h-3.5 w-3.5 shrink-0 text-accent" />
                  ) : (
                    <ArrowUp className="h-3.5 w-3.5 shrink-0 text-white/25" />
                  )}
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
