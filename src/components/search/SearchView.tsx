import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Disc3,
  Download,
  Heart,
  Loader2,
  Music2,
  Pause,
  Play,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react";

import type {
  DownloadRequest,
  SpotifyAlbumSummary,
  SpotifyArtistSummary,
  SpotifyCatalogTrack,
  SpotifySearchCatalog,
  Track,
} from "@/types";import { cn } from "@/lib/cn";
import { formatCount, formatTime } from "@/lib/format";
import {
  findLocalTrackForSpotify,
  isLossless,
} from "@/lib/spotifyMatch";
import {
  useTrackSorting,
  type TrackSortAccessors,
} from "@/hooks/useTrackSorting";
import { usePlayerStore } from "@/store/playerStore";
import { useDownloadStore } from "@/store/downloadStore";
import { useSpotifyCatalogStore } from "@/store/spotifyCatalogStore";
import { useToastStore } from "@/store/toastStore";
import { EqualizerBars } from "@/components/ui/EqualizerBars";
import { TrackRow } from "@/components/library/TrackRow";
import { SortDropdown } from "@/components/library/SortDropdown";
import {
  SpotifyAlbumCard,
  SpotifyArtwork,
} from "@/components/spotify/SpotifyCards";

type SearchMode = "library" | "spotify";

const spotifyTrackAccessors: TrackSortAccessors<SpotifyCatalogTrack> = {
  title: (track) => track.title,
  artist: (track) => track.artist,
  album: (track) => track.album,
  duration: (track) => track.durationMs,
  added: () => 0,
};

function downloadRequest(
  track: SpotifyCatalogTrack,
  releaseId?: string,
): DownloadRequest {
  return {
    releaseId: releaseId ?? `spotify-album-${track.albumId ?? track.id}`,
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    coverUrl: track.coverUrl,
    spotifyUrl: track.spotifyUrl,
  };
}

function SpotifyArtistCard({
  artist,
  onOpen,
}: {
  artist: SpotifyArtistSummary;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-w-0 flex-col items-center rounded-2xl border border-transparent p-2 text-center outline-none transition hover:border-white/[0.06] hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <SpotifyArtwork
        url={artist.imageUrl}
        rounded="rounded-full"
        className="aspect-square w-full max-w-[128px] shadow-[0_18px_40px_-18px_rgba(0,0,0,.9)] transition duration-300 group-hover:scale-[1.03]"
      />
      <span className="mt-2.5 block w-full truncate text-[12px] font-bold text-white/80 group-hover:text-white">
        {artist.name}
      </span>
      <span className="mt-0.5 block text-[9.5px] font-semibold uppercase tracking-[0.14em] text-white/25">
        Artist
      </span>
    </button>
  );
}

function SearchTrackRow({
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
  pending: boolean;
  onPlay: () => void;
  onPause: () => void;
  onDownload: () => void;
}) {
  return (
    <div
      role="row"
      tabIndex={local ? 0 : -1}
      onDoubleClick={() => {
        if (local) onPlay();
      }}
      onKeyDown={(event) => {
        if (local && event.key === "Enter") onPlay();
      }}
      className={cn(
        "group grid h-[52px] grid-cols-[26px_minmax(0,1fr)_84px_26px] items-center gap-3 rounded-xl px-2.5 outline-none transition-colors focus-visible:bg-white/[0.06] md:grid-cols-[26px_minmax(0,2.2fr)_minmax(0,1.4fr)_84px_26px]",
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
              else onPlay();
            }}
            aria-label={active && playing ? `Pause ${track.title}` : `Play ${track.title}`}
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
        {local ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.08em]",
              isLossless(local.format)
                ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300/85"
                : "border-accent/20 bg-accent/[0.08] text-accent/80",
            )}
            title={`${local.format} · ${formatTime(local.durationMs)}`}
          >
            <Check className="h-2.5 w-2.5" />
            {local.format}
          </span>
        ) : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDownload();
            }}
            disabled={pending}
            className="inline-flex h-6 items-center gap-1 rounded-full border border-white/[0.1] bg-white/[0.04] px-2 text-[9.5px] font-semibold text-white/55 transition hover:border-accent/30 hover:bg-accent/[0.1] hover:text-accent disabled:pointer-events-none disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            Download
          </button>
        )}
      </div>

      <span className="text-right text-[10.5px] tabular-nums text-white/25">
        {formatTime(local?.durationMs || track.durationMs)}
      </span>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  meta,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  meta?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-accent/70">{icon}</span>
        <h2 className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-white/85">
          {title}
        </h2>
        {meta && <span className="text-[10px] text-white/25">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

export function SearchView() {
  const search = usePlayerStore((state) => state.search);
  const setSearch = usePlayerStore((state) => state.setSearch);
  const openArtist = usePlayerStore((state) => state.openArtist);
  const openAlbum = usePlayerStore((state) => state.openAlbum);
  const tracks = usePlayerStore((state) => state.tracks);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const togglePlay = usePlayerStore((state) => state.togglePlay);

  const searchSpotify = useSpotifyCatalogStore((state) => state.search);
  const loadAlbumTracks = useSpotifyCatalogStore(
    (state) => state.loadAlbumTracks,
  );
  const downloadTasks = useDownloadStore((state) => state.tasks);

  const [mode, setMode] = useState<SearchMode>("library");
  const [debounced, setDebounced] = useState(search);
  const [spotify, setSpotify] = useState<SpotifySearchCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [albumPending, setAlbumPending] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const focus = () => {
      window.setTimeout(() => inputRef.current?.focus(), 80);
    };
    window.addEventListener("lyricsplus:focus-search", focus);
    return () => window.removeEventListener("lyricsplus:focus-search", focus);
  }, []);

  useEffect(() => {
    setDebounced(search);
    const timer = window.setTimeout(() => setDebounced(search), 320);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (mode !== "spotify") return;
    const query = debounced.trim();
    if (query.length < 2) {
      setSpotify(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void searchSpotify(query)
      .then((result) => {
        if (!cancelled) setSpotify(result);
      })
      .catch((cause) => {
        if (cancelled) return;
        setSpotify(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, mode, searchSpotify]);

  const libraryTracks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return [];
    return tracks.filter((track) =>
      [track.title, track.artist, track.album, track.format]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [search, tracks]);

  const librarySort = useTrackSorting(libraryTracks, {
    storageKey: "lyricsplus.sort.search.library",
  });
  const spotifySort = useTrackSorting(spotify?.tracks ?? [], {
    storageKey: "lyricsplus.sort.search.spotify",
    accessors: spotifyTrackAccessors,
  });

  const pendingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of downloadTasks) {
      if (task.status === "queued" || task.status === "downloading") {
        ids.add(task.trackId);
      }
    }
    return ids;
  }, [downloadTasks]);

  const libraryMatches = useMemo(
    () =>
      new Map(
        (spotify?.tracks ?? []).map((track) => [
          track.id,
          findLocalTrackForSpotify(tracks, track),
        ]),
      ),
    [spotify?.tracks, tracks],
  );

  const queueTracks = async (
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
      items.map((track) => downloadRequest(track, releaseId)),
    );
    useToastStore.getState().push({
      kind: "success",
      title: `Queued ${items.length} track${items.length === 1 ? "" : "s"}`,
      description: label,
    });
  };

  const downloadTrack = (track: SpotifyCatalogTrack) => {
    const match = findLocalTrackForSpotify(tracks, track);
    if (match) {
      useToastStore.getState().push({
        kind: "info",
        title: "Already in your library",
        description: `${match.title} · ${match.format}`,
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
  };

  const downloadAlbum = async (album: SpotifyAlbumSummary) => {
    if (albumPending) return;
    setAlbumPending(album.id);
    try {
      const albumTracks = await loadAlbumTracks(album.id, {
        artist: album.artist,
        album: album.title,
        coverUrl: album.coverUrl,
      });
      const missing = albumTracks.filter(
        (track) => !findLocalTrackForSpotify(tracks, track),
      );
      await queueTracks(
        missing,
        `spotify-album-${album.id}`,
        `${album.artist} · ${album.title}`,
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

  const openArtistResult = (artist: SpotifyArtistSummary) => {
    openArtist(artist.name, artist.id);
  };

  const showSpotifyEmpty =
    mode === "spotify" &&
    !loading &&
    spotify &&
    spotify.artists.length === 0 &&
    spotify.albums.length === 0 &&
    spotify.tracks.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <header className="relative shrink-0 overflow-hidden px-6 pb-5 pt-7 lg:px-8">
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background:
                "radial-gradient(120% 90% at 12% 0%, rgba(69,10,245,.22) 0%, transparent 62%)",
            }}
          />
          <div className="relative">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent/80">
              Discover
            </p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-[32px] font-extrabold leading-tight tracking-[-0.03em] text-white lg:text-[38px]">
                  Search
                </h1>
                <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-white/35">
                  Find songs on your PC or across the entire Spotify catalog.
                </p>
              </div>
              <div className="flex rounded-full border border-white/[0.08] bg-white/[0.035] p-1">
                {(
                  [
                    { id: "library", label: "In Library", icon: Heart },
                    { id: "spotify", label: "In Spotify", icon: Sparkles },
                  ] as const
                ).map((option) => {
                  const active = mode === option.id;
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setMode(option.id)}
                      className={cn(
                        "flex h-7 items-center gap-1.5 rounded-full px-3 text-[10.5px] font-bold transition",
                        active
                          ? "bg-accent text-black shadow-glow"
                          : "text-white/40 hover:text-white/75",
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="group relative mt-5 block">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
              <input
                ref={inputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={
                  mode === "library"
                    ? "Search your local library…"
                    : "Search artists, albums and tracks on Spotify…"
                }
                className="h-11 w-full rounded-2xl border border-white/[0.08] bg-white/[0.04] pl-11 pr-12 text-[13px] text-white placeholder:text-white/25 outline-none transition focus:border-accent/40 focus:bg-white/[0.06] focus:shadow-[0_0_0_3px_rgba(184,255,79,.06)]"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[9px] font-bold uppercase tracking-[0.15em] text-white/20">
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : mode === "library" ? (
                  `${libraryTracks.length} found`
                ) : (
                  "Spotify"
                )}
              </span>
            </label>
          </div>
        </header>

        <div className="px-6 pb-8 lg:px-8">
          {mode === "library" ? (
            !search.trim() ? (
              <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-8 py-10 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.05] text-white/35">
                  <Search className="h-6 w-6" />
                </span>
                <h2 className="mt-4 font-display text-[16px] font-bold text-white/80">
                  Search your library
                </h2>
                <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-white/30">
                  Type a title, artist, album or format. Switch to In Spotify to
                  discover music that is not on this PC yet.
                </p>
              </div>
            ) : libraryTracks.length === 0 ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-8 py-10 text-center">
                <Music2 className="h-6 w-6 text-white/25" />
                <h2 className="mt-3 font-display text-[15px] font-bold text-white/70">
                  Nothing in your library
                </h2>
                <p className="mt-1.5 text-[11.5px] text-white/30">
                  Try In Spotify to search the global catalog.
                </p>
                <button
                  type="button"
                  onClick={() => setMode("spotify")}
                  className="mt-4 rounded-full border border-[#8e8ee8]/30 bg-[#450af5]/20 px-4 py-2 text-[11px] font-semibold text-[#d8c8ff] transition hover:bg-[#450af5]/30 hover:text-white"
                >
                  Search Spotify
                </button>
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[10.5px] font-semibold text-white/30">
                    {formatCount(libraryTracks.length, "local track")}
                  </p>
                  <SortDropdown
                    mode={librarySort.mode}
                    reverse={librarySort.reverse}
                    onModeChange={librarySort.setMode}
                    onReverseChange={librarySort.setReverse}
                  />
                </div>
                <div className="mb-1 flex h-8 items-center gap-3 border-b border-white/[0.06] px-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-white/20">
                  <span className="w-7 text-center">#</span>
                  <span className="flex-1">Title</span>
                  <span className="hidden w-[26%] xl:block">Album</span>
                  <span className="hidden w-[76px] text-center md:block">
                    Format
                  </span>
                  <span className="w-11 text-right">Time</span>
                  <span className="w-7" />
                </div>
                {librarySort.items.map((track, index) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    index={index}
                    active={currentTrack?.id === track.id}
                    playing={isPlaying}
                    onPlay={(item) => {
                      void playTrack(item);
                    }}
                  />
                ))}
              </>
            )
          ) : !debounced.trim() || debounced.trim().length < 2 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-8 py-10 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#450af5]/20 text-[#c9bcff]">
                <Sparkles className="h-6 w-6" />
              </span>
              <h2 className="mt-4 font-display text-[16px] font-bold text-white/80">
                Search the Spotify catalog
              </h2>
              <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-white/30">
                Type at least two characters. Downloaded matches play
                instantly from your PC; missing tracks can be queued.
              </p>
            </div>
          ) : loading && !spotify ? (
            <div className="flex min-h-[280px] items-center justify-center">
              <div className="flex items-center gap-2.5 text-[12px] text-white/35">
                <Loader2 className="h-4 w-4 animate-spin text-accent/70" />
                Searching Spotify…
              </div>
            </div>
          ) : error ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-rose-400/15 bg-rose-400/[0.03] px-8 py-10 text-center">
              <Disc3 className="h-6 w-6 text-rose-300/70" />
              <h2 className="mt-3 font-display text-[15px] font-bold text-white/70">
                Spotify search failed
              </h2>
              <p className="mt-1.5 max-w-md text-[11.5px] leading-relaxed text-white/30">
                {error}
              </p>
              <button
                type="button"
                onClick={() => {
                  setDebounced(`${debounced} `);
                  window.setTimeout(() => setDebounced(debounced), 20);
                }}
                className="mt-4 rounded-full border border-white/[0.1] bg-white/[0.05] px-4 py-2 text-[11px] font-semibold text-white/60 transition hover:bg-white/[0.09] hover:text-white"
              >
                Try again
              </button>
            </div>
          ) : spotify ? (
            <div className="space-y-8">
              {spotify.warnings.length > 0 && (
                <p className="rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-3 py-2 text-[10.5px] leading-relaxed text-amber-200/55">
                  {spotify.warnings[0]}
                </p>
              )}

              {showSpotifyEmpty ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-8 py-10 text-center">
                  <Search className="h-6 w-6 text-white/25" />
                  <h2 className="mt-3 font-display text-[15px] font-bold text-white/70">
                    No Spotify results
                  </h2>
                  <p className="mt-1.5 text-[11.5px] text-white/30">
                    Try a different spelling or a shorter query.
                  </p>
                </div>
              ) : null}

              {spotify.artists.length > 0 && (
                <section>
                  <SectionHeading
                    icon={<UserRound className="h-4 w-4" />}
                    title="Artists"
                    meta={`${spotify.artists.length}`}
                  />
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {spotify.artists.map((artist) => (
                      <SpotifyArtistCard
                        key={artist.id}
                        artist={artist}
                        onOpen={() => openArtistResult(artist)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {spotify.albums.length > 0 && (
                <section>
                  <SectionHeading
                    icon={<Disc3 className="h-4 w-4" />}
                    title="Albums"
                    meta={`${spotify.albums.length}`}
                  />
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                    {spotify.albums.map((album) => (
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

              {spotify.tracks.length > 0 && (
                <section>
                  <SectionHeading
                    icon={<Music2 className="h-4 w-4" />}
                    title="Tracks"
                    meta={`${spotify.tracks.length}`}
                  >
                    <SortDropdown
                      mode={spotifySort.mode}
                      reverse={spotifySort.reverse}
                      onModeChange={spotifySort.setMode}
                      onReverseChange={spotifySort.setReverse}
                    />
                  </SectionHeading>
                  <div className="mb-1 grid h-8 grid-cols-[26px_minmax(0,1fr)_84px_26px] items-center gap-3 border-b border-white/[0.06] px-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-white/20 md:grid-cols-[26px_minmax(0,2.2fr)_minmax(0,1.4fr)_84px_26px]">
                    <span className="text-center">#</span>
                    <span>Title</span>
                    <span className="hidden md:block">Album</span>
                    <span className="flex justify-end">Status</span>
                    <span className="text-right">Time</span>
                  </div>
                  {spotifySort.items.map((track, index) => {
                    const local = libraryMatches.get(track.id) ?? null;
                    const active = Boolean(
                      local &&
                        (currentTrack?.id === local.id ||
                          currentTrack?.path === local.path),
                    );
                    return (
                      <SearchTrackRow
                        key={track.id}
                        track={track}
                        local={local}
                        index={index}
                        active={active}
                        playing={isPlaying}
                        pending={pendingIds.has(track.id)}
                        onPlay={() => {
                          if (!local) return;
                          void playTrack(local);
                        }}
                        onPause={() => void togglePlay()}
                        onDownload={() => downloadTrack(track)}
                      />
                    );
                  })}
                </section>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
