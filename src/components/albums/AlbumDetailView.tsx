import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowLeft,
  Clock3,
  Disc3,
  Download,
  Heart,
  Loader2,
  Music2,
  Play,
  Sparkles,
} from "lucide-react";

import type {
  DownloadRequest,
  SpotifyAlbumCatalog,
  SpotifyCatalogTrack,
  Track,
} from "@/types";
import { cn } from "@/lib/cn";
import { formatCount, formatTime } from "@/lib/format";
import { findLocalTrackForSpotify } from "@/lib/spotifyMatch";
import { useCoverPalette } from "@/hooks/useCoverPalette";
import { useNavigation } from "@/hooks/useNavigation";
import { openArtistForAlbum } from "@/lib/navigationTargets";
import { usePlayerStore } from "@/store/playerStore";
import { useSpotifyCatalogStore } from "@/store/spotifyCatalogStore";
import { useDownloadStore } from "@/store/downloadStore";
import { usePlaylistStore } from "@/store/playlistStore";
import { useSpotifyLikedStore } from "@/store/spotifyLikedStore";
import { useToastStore } from "@/store/toastStore";
import { ArtistLinks } from "@/components/artists/ArtistLinks";
import { EqualizerBars } from "@/components/ui/EqualizerBars";
import {
  TrackStatusAction,
  type TrackDownloadState,
} from "@/components/ui/TrackStatusAction";
import { SpotifyArtwork } from "@/components/spotify/SpotifyCards";

const TRACK_GRID =
  "grid-cols-[24px_minmax(0,1fr)_112px_28px] md:grid-cols-[28px_minmax(0,2fr)_132px_28px_52px]";

function downloadRequest(
  track: SpotifyCatalogTrack,
  albumId: string,
): DownloadRequest {
  return {
    releaseId: `spotify-album-${albumId}`,
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

export function AlbumDetailView() {
  const albumId = usePlayerStore((state) => state.selectedAlbumId);
  const selectedAlbumArtist = usePlayerStore(
    (state) => state.selectedAlbumArtist,
  );
  const selectedAlbumTitle = usePlayerStore(
    (state) => state.selectedAlbumTitle,
  );
  const selectedAlbumCoverUrl = usePlayerStore(
    (state) => state.selectedAlbumCoverUrl,
  );
  const selectedAlbumReleaseDate = usePlayerStore(
    (state) => state.selectedAlbumReleaseDate,
  );
  const selectedAlbumTotalTracks = usePlayerStore(
    (state) => state.selectedAlbumTotalTracks,
  );
  const focusTrackId = usePlayerStore((state) => state.focusTrackId);
  const focusTrackTitle = usePlayerStore((state) => state.focusTrackTitle);
  const tracks = usePlayerStore((state) => state.tracks);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const setShuffle = usePlayerStore((state) => state.setShuffle);
  const openArtist = usePlayerStore((state) => state.openArtist);
  const navigate = usePlayerStore((state) => state.navigate);
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

  const loadAlbum = useSpotifyCatalogStore((state) => state.loadAlbum);
  const likedIds = useSpotifyLikedStore((state) => state.likedIds);

  const { canGoBack, goBack } = useNavigation();

  const [catalog, setCatalog] = useState<SpotifyAlbumCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [highlightTrack, setHighlightTrack] = useState<string | null>(null);
  const trackRowRefs = useRef(new Map<string, HTMLDivElement>());

  const fallbackArtist = selectedAlbumArtist?.trim() ?? "";
  const fallbackTitle = selectedAlbumTitle?.trim() ?? "";

  useEffect(() => {
    if (!albumId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const data = await loadAlbum(albumId, {
          artist: fallbackArtist || undefined,
          album: fallbackTitle || undefined,
          coverUrl: selectedAlbumCoverUrl,
          releaseDate: selectedAlbumReleaseDate || undefined,
          totalTracks: selectedAlbumTotalTracks || undefined,
        });
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
    albumId,
    fallbackArtist,
    fallbackTitle,
    loadAlbum,
    reloadKey,
    selectedAlbumCoverUrl,
    selectedAlbumReleaseDate,
    selectedAlbumTotalTracks,
  ]);

  const album = useMemo(
    () =>
      catalog?.album ?? {
        id: albumId ?? "",
        title: fallbackTitle || "Album",
        artist: fallbackArtist,
        artists: fallbackArtist
          ? fallbackArtist
              .split(",")
              .map((name) => name.trim())
              .filter(Boolean)
          : [],
        releaseDate: selectedAlbumReleaseDate ?? "",
        releaseDatePrecision: "year" as const,
        coverUrl: selectedAlbumCoverUrl,
        spotifyUrl: albumId
          ? `https://open.spotify.com/album/${albumId}`
          : "",
        totalTracks: selectedAlbumTotalTracks,
        type: "ALBUM",
      },
    [
      albumId,
      catalog,
      fallbackArtist,
      fallbackTitle,
      selectedAlbumCoverUrl,
      selectedAlbumReleaseDate,
      selectedAlbumTotalTracks,
    ],
  );

  const albumTracks = catalog?.tracks ?? [];

  const rows = useMemo(
    () =>
      albumTracks.map((track) => ({
        track,
        local: findLocalTrackForSpotify(tracks, track),
      })),
    [albumTracks, tracks],
  );

  const onPc = rows.filter((row) => row.local).length;
  const totalTracks = album.totalTracks || albumTracks.length || onPc;

  useEffect(() => {
    if (!focusTrackId && !focusTrackTitle) return;
    if (rows.length === 0) return;
    const wantedTitle = focusTrackTitle?.trim().toLocaleLowerCase() ?? "";
    const target =
      rows.find(
        (row) => focusTrackId && row.track.id === focusTrackId,
      ) ??
      (wantedTitle
        ? rows.find(
            (row) =>
              row.track.title.trim().toLocaleLowerCase() === wantedTitle,
          )
        : undefined);
    if (!target) return;
    setHighlightTrack(target.track.id);
    const frame = requestAnimationFrame(() => {
      trackRowRefs.current
        .get(target.track.id)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusTrackId, focusTrackTitle, rows]);

  useEffect(() => {
    if (!highlightTrack) return;
    const clear = () => setHighlightTrack(null);
    window.addEventListener("pointerdown", clear);
    return () => window.removeEventListener("pointerdown", clear);
  }, [highlightTrack]);

  const localQueue = useMemo(() => {
    const seen = new Set<string>();
    const queue: Track[] = [];
    for (const row of rows) {
      if (!row.local || seen.has(row.local.path)) continue;
      seen.add(row.local.path);
      queue.push(row.local);
    }
    return queue;
  }, [rows]);

  const missingTracks = useMemo(
    () => rows.filter((row) => !row.local).map((row) => row.track),
    [rows],
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

  const palette = useCoverPalette(
    album.coverUrl,
    `${album.artist} ${album.title}`,
  );

  const playLocal = () => {
    if (localQueue.length === 0) return;
    setShuffle(false);
    void playTrack(localQueue[0]!, 0, localQueue);
  };

  const playRow = (local: Track) => {
    if (currentTrack?.path === local.path && isPlaying) {
      void togglePlay();
      return;
    }
    setShuffle(false);
    void playTrack(local, 0, localQueue.length > 0 ? localQueue : [local]);
  };

  const revealTrack = (trackId: string) => {
    setHighlightTrack(trackId);
    requestAnimationFrame(() => {
      trackRowRefs.current
        .get(trackId)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const back = () => {
    if (canGoBack) {
      goBack();
      return;
    }
    if (album.artist) {
      openArtist(album.artist.split(",")[0]?.trim() || album.artist);
      return;
    }
    navigate({ type: "artists" });
  };

  const queueDownload = async (
    items: SpotifyCatalogTrack[],
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
    try {
      await useDownloadStore
        .getState()
        .start(items.map((track) => downloadRequest(track, album.id)));
      useToastStore.getState().push({
        kind: "success",
        title: `Queued ${items.length} track${items.length === 1 ? "" : "s"}`,
        description: label,
      });
    } catch (cause) {
      useToastStore.getState().push({
        kind: "error",
        title: "Could not queue download",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  const isTrackLiked = (trackId: string) => likedIds.has(trackId);

  const toggleLiked = (
    track: SpotifyCatalogTrack,
    local: Track | null,
  ) => {
    const next = !isTrackLiked(track.id);
    void usePlaylistStore.getState().setLike({
      trackId: track.id,
      liked: next,
      localPath: local?.path ?? null,
      spotify: true,
      title: track.title,
      input: {
        title: track.title,
        artist: track.artist,
        album: track.album,
        durationMs: track.durationMs,
        coverUrl: track.coverUrl,
        spotifyUrl: track.spotifyUrl,
        localPath: local?.path ?? null,
      },
    });
  };

  const year = album.releaseDate.slice(0, 4);
  const hasTracks = rows.length > 0;

  if (!albumId) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-white/35">
        Album not found.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
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
              <SpotifyArtwork
                url={album.coverUrl}
                cover={{
                  artist: album.artist,
                  album: album.title,
                  year: album.releaseDate
                    ? album.releaseDate.slice(0, 4)
                    : null,
                  spotifyImageUrl: album.coverUrl,
                  spotifyAlbumId: album.id,
                }}
                rounded="rounded-2xl"
                className="aspect-square w-40 shadow-[0_24px_60px_-18px_rgba(0,0,0,.85)] sm:w-48"
              />
            </motion.div>

            <div className="min-w-0 flex-1 pb-1">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-accent/80">
                <Sparkles className="h-3 w-3" />
                {album.type || "Album"}
              </p>
              <motion.button
                type="button"
                onClick={() =>
                  openArtistForAlbum(album.artist, {
                    id: album.id,
                    title: album.title,
                  })
                }
                title={`Open ${album.artist || "artist"}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.32,
                  delay: 0.05,
                  ease: [0.2, 0, 0, 1],
                }}
                className="mt-1.5 block max-w-full truncate text-left font-display text-[32px] font-extrabold leading-[1.05] tracking-[-0.035em] text-white transition hover:text-accent/90 sm:text-[40px]"
              >
                {album.title}
              </motion.button>

              <p className="mt-1.5 min-w-0 truncate text-[13px] font-semibold text-white/55">
                {album.artist ? (
                  <ArtistLinks artistString={album.artist} />
                ) : (
                  "Unknown artist"
                )}
              </p>

              <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-white/35">
                <span>{year || "—"}</span>
                <span className="text-white/15">·</span>
                <span>{formatCount(totalTracks, "track")}</span>
                <span className="text-white/15">·</span>
                <span>{onPc} on PC</span>
              </p>
            </div>
          </div>

          <div className="relative mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={playLocal}
              disabled={localQueue.length === 0}
              className="flex h-9 items-center gap-2 rounded-full bg-accent px-5 text-[12px] font-bold text-black shadow-glow transition hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Play Local
            </button>
            <button
              type="button"
              onClick={() =>
                void queueDownload(
                  missingTracks,
                  `${album.artist || "Album"} · ${album.title}`,
                )
              }
              disabled={
                missingTracks.length === 0 || (loading && !hasTracks)
              }
              title={
                missingTracks.length === 0
                  ? "All album tracks are already on PC"
                  : `Download ${missingTracks.length} missing track${missingTracks.length === 1 ? "" : "s"}`
              }
              className="flex h-9 items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.05] px-4 text-[11.5px] font-semibold text-white/60 transition hover:bg-white/[0.09] hover:text-white active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              {loading && !hasTracks ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Download Album FLAC
            </button>
          </div>
        </header>

        <div className="px-6 pb-8 lg:px-8">
          {error && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-3.5 py-2.5">
              <p className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-amber-200/60">
                Spotify album is unavailable: {error}
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

          <section>
            <SectionHeading
              icon={<Disc3 className="h-4 w-4" />}
              title="Tracklist"
              meta={
                hasTracks
                  ? `${onPc}/${totalTracks} on PC`
                  : loading
                    ? "Loading…"
                    : undefined
              }
            />

            <div
              className={cn(
                "mb-1 grid h-8 items-center gap-3 border-b border-white/[0.06] px-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-white/20",
                TRACK_GRID,
              )}
            >
              <span className="text-center">#</span>
              <span>Title</span>
              <span className="text-right md:text-left">Status</span>
              <span />
              <span className="hidden text-right md:block">
                <Clock3 className="ml-auto h-3 w-3" />
              </span>
            </div>

            {loading && !hasTracks ? (
              <div className="flex min-h-[180px] flex-col items-center justify-center gap-2.5 text-[11.5px] text-white/30">
                <Loader2 className="h-4 w-4 animate-spin text-accent/60" />
                Loading album tracks…
              </div>
            ) : !hasTracks ? (
              <div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-8 py-10 text-center">
                <Music2 className="h-6 w-6 text-white/25" />
                <h3 className="mt-3 font-display text-[15px] font-bold text-white/70">
                  No tracks found
                </h3>
                <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-white/30">
                  Spotify did not return a tracklist for this album.
                </p>
              </div>
            ) : (
              <div className="pb-2">
                {rows.map(({ track, local }, index) => {
                  const active = Boolean(
                    local &&
                      (currentTrack?.id === local.id ||
                        currentTrack?.path === local.path),
                  );
                  const pending = pendingById.get(track.id);
                  const liked = isTrackLiked(track.id);

                  return (
                    <div
                      key={`${track.id}-${index}`}
                      ref={(node) => {
                        if (node) trackRowRefs.current.set(track.id, node);
                        else trackRowRefs.current.delete(track.id);
                      }}
                      role="row"
                      tabIndex={local ? 0 : -1}
                      onClick={() => {
                        if (local) playRow(local);
                      }}
                      onKeyDown={(event) => {
                        if (local && event.key === "Enter") playRow(local);
                      }}
                      className={cn(
                        "group grid min-h-[52px] items-center gap-3 rounded-xl px-2.5 outline-none transition-colors",
                        TRACK_GRID,
                        highlightTrack === track.id
                          ? "bg-accent/[0.09] ring-1 ring-inset ring-accent/45"
                          : active
                            ? "bg-white/[0.06]"
                            : "hover:bg-white/[0.04]",
                        local
                          ? "cursor-pointer focus-visible:bg-white/[0.06]"
                          : "cursor-default",
                      )}
                    >
                      <div className="flex w-[24px] items-center justify-center md:w-[28px]">
                        {active && isPlaying ? (
                          <EqualizerBars playing className="h-3.5" />
                        ) : (
                          <span
                            className={cn(
                              "text-[10.5px] tabular-nums",
                              active ? "text-accent" : "text-white/25",
                            )}
                          >
                            {String(track.trackNumber || index + 1).padStart(
                              2,
                              "0",
                            )}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            revealTrack(track.id);
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
                          title={track.title}
                          className={cn(
                            "block max-w-full truncate text-left text-[12.5px] font-semibold transition-colors hover:underline hover:decoration-white/20 hover:underline-offset-2",
                            active
                              ? "text-accent"
                              : local
                                ? "text-white/80 group-hover:text-white"
                                : "text-white/45",
                          )}
                        >
                          {track.title}
                        </button>
                        <p className="mt-0.5 truncate text-[10.5px] text-white/30">
                          {track.artist}
                          <span className="md:hidden">
                            <span className="mx-1 text-white/15">·</span>
                            {formatTime(track.durationMs)}
                          </span>
                        </p>
                      </div>

                      <div className="flex justify-end md:justify-start">
                        <TrackStatusAction
                          downloaded={Boolean(local)}
                          format={local?.format ?? "FLAC"}
                          pending={pending}
                          onDownload={() =>
                            void queueDownload(
                              [track],
                              `${track.artist} · ${track.title}`,
                            )
                          }
                        />
                      </div>

                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleLiked(track, local);
                          }}
                          aria-pressed={liked}
                          aria-label={
                            liked
                              ? `Remove ${track.title} from Liked Songs`
                              : `Add ${track.title} to Liked Songs`
                          }
                          title={
                            liked
                              ? "Remove from Spotify Liked Songs"
                              : "Add to Spotify Liked Songs"
                          }
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full transition hover:scale-110 disabled:pointer-events-none disabled:opacity-50",
                            liked
                              ? "text-[#b49bff] hover:text-[#d8c8ff]"
                              : "text-white/25 hover:text-white/60",
                          )}
                        >
                          <Heart
                            className={cn(
                              "h-3.5 w-3.5",
                              liked && "fill-current",
                            )}
                          />
                        </button>
                      </div>

                      <span className="hidden text-right text-[10.5px] tabular-nums text-white/25 md:block">
                        {formatTime(track.durationMs)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
