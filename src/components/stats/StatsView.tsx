import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Clock3,
  Crown,
  Music2,
  Play,
  RefreshCw,
  Sparkles,
  Trophy,
} from "lucide-react";

import type { StatsData, StatsTrackEntry, Track } from "@/types";
import { backend } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatListenDuration, formatTime } from "@/lib/format";
import { splitArtistNames } from "@/lib/artists";
import { usePlayerStore } from "@/store/playerStore";
import { useToastStore } from "@/store/toastStore";
import { useTrackMenuStore } from "@/store/contextMenuStore";
import { CoverArt } from "@/components/ui/CoverArt";
import { EqualizerBars } from "@/components/ui/EqualizerBars";
import { ArtistLinks } from "@/components/artists/ArtistLinks";

interface TopArtist {
  name: string;
  plays: number;
  listenTime: number;
  coverTrack: Track;
}

function playsLabel(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "play" : "plays"}`;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  accent,
  delay,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
  delay: number;
}) {
  return (
    <div
      className={cn(
        "lucid-glass-panel group relative overflow-hidden rounded-2xl p-4 transition-transform duration-300 hover:-translate-y-0.5 sm:p-5",
        accent && "border-accent/20",
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full blur-2xl transition-opacity duration-300",
          accent
            ? "bg-accent/20 opacity-80 group-hover:opacity-100"
            : "bg-white/[0.05] opacity-50 group-hover:opacity-80",
        )}
      />
      <div className="relative flex items-center gap-2">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
            accent
              ? "bg-accent text-black shadow-glow"
              : "bg-white/[0.06] text-white/50",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-white/35">
          {label}
        </span>
      </div>
      <p
        className={cn(
          "relative mt-3 truncate font-display text-[26px] font-extrabold leading-none tracking-[-0.03em] text-white sm:text-[30px]",
          accent && "text-accent",
        )}
        title={value}
      >
        {value}
      </p>
      <p className="relative mt-1.5 truncate text-[10.5px] text-white/30">
        {detail}
      </p>
    </div>
  );
}

function ArtistCard({ artist, rank }: { artist: TopArtist; rank: number }) {
  const openArtist = usePlayerStore((state) => state.openArtist);

  return (
    <button
      type="button"
      onClick={() => openArtist(artist.name)}
      className="lucid-glass-panel group relative min-w-0 rounded-2xl p-3 text-center transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      title={`Open ${artist.name}`}
    >
      <span
        className={cn(
          "absolute left-2.5 top-2.5 z-10 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-extrabold tabular-nums",
          rank === 1
            ? "bg-accent text-black shadow-glow"
            : "bg-black/45 text-white/45 backdrop-blur-md",
        )}
      >
        {rank}
      </span>
      <div className="relative mx-auto w-[72px] max-w-full">
        <CoverArt
          track={artist.coverTrack}
          width={256}
          height={256}
          className="aspect-square w-full rounded-full"
          iconClassName="h-6 w-6"
          showInitials={false}
        />
        {rank === 1 && (
          <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-black ring-4 ring-[#101014]">
            <Crown className="h-3 w-3" />
          </span>
        )}
      </div>
      <p className="mt-2.5 truncate text-[12px] font-bold text-white/85 transition-colors group-hover:text-white">
        {artist.name}
      </p>
      <p className="mt-0.5 truncate text-[10px] text-white/30">
        {playsLabel(artist.plays)}
        <span className="px-1 text-white/15">•</span>
        {formatListenDuration(artist.listenTime)}
      </p>
    </button>
  );
}

export function StatsView() {
  const tracks = usePlayerStore((state) => state.tracks);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const openMenu = useTrackMenuStore((state) => state.openMenu);

  const [stats, setStats] = useState<StatsData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (announce = false) => {
    setRefreshing(true);
    try {
      const data = await backend.getStats();
      setStats(data);
    } catch (error) {
      if (announce) {
        useToastStore.getState().push({
          kind: "error",
          title: "Could not load listening stats",
          description: String(error),
        });
      }
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trackByPath = useMemo(
    () => new Map(tracks.map((track) => [track.path, track])),
    [tracks],
  );

  const entries = useMemo<StatsTrackEntry[]>(() => {
    if (!stats) return [];
    const result: StatsTrackEntry[] = [];
    for (const [trackPath, record] of Object.entries(stats.tracks)) {
      const track = trackByPath.get(trackPath);
      if (!track || record.playCount <= 0) continue;
      result.push({ ...record, track });
    }
    return result;
  }, [stats, trackByPath]);

  const totals = useMemo(() => {
    let listenTime = 0;
    let plays = 0;
    for (const entry of entries) {
      listenTime += entry.totalListenTime;
      plays += entry.playCount;
    }
    return { listenTime, plays };
  }, [entries]);

  const topArtists = useMemo<TopArtist[]>(() => {
    const buckets = new Map<
      string,
      {
        name: string;
        plays: number;
        listenTime: number;
        coverTrack: Track;
      }
    >();

    for (const entry of entries) {
      const names = splitArtistNames(entry.track.artist);
      const artists = names.length > 0 ? names : ["Unknown artist"];
      for (const name of artists) {
        const key = name.toLocaleLowerCase();
        const existing = buckets.get(key);
        if (existing) {
          existing.plays += entry.playCount;
          existing.listenTime += entry.totalListenTime;
          if (
            !existing.coverTrack.coverPath &&
            entry.track.coverPath
          ) {
            existing.coverTrack = entry.track;
          }
        } else {
          buckets.set(key, {
            name,
            plays: entry.playCount,
            listenTime: entry.totalListenTime,
            coverTrack: entry.track,
          });
        }
      }
    }

    return [...buckets.values()]
      .sort(
        (a, b) =>
          b.listenTime - a.listenTime ||
          b.plays - a.plays ||
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      )
      .slice(0, 5);
  }, [entries]);

  const topTracks = useMemo(
    () =>
      [...entries]
        .sort(
          (a, b) =>
            b.playCount - a.playCount ||
            b.totalListenTime - a.totalListenTime ||
            a.track.title.localeCompare(b.track.title, undefined, {
              sensitivity: "base",
            }),
        )
        .slice(0, 10),
    [entries],
  );

  const topQueue = useMemo(
    () =>
      [...entries]
        .sort(
          (a, b) =>
            b.playCount - a.playCount ||
            b.totalListenTime - a.totalListenTime ||
            a.track.title.localeCompare(b.track.title, undefined, {
              sensitivity: "base",
            }),
        )
        .map((entry) => entry.track),
    [entries],
  );

  const favourite = topArtists[0] ?? null;
  const hasStats = entries.length > 0;

  const playTopQueue = () => {
    if (topQueue.length === 0) return;
    void playTrack(topQueue[0], 0, topQueue);
  };

  const playEntry = (entry: StatsTrackEntry) => {
    void playTrack(entry.track, 0, topQueue);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-accent/80">
              <BarChart3 className="h-3 w-3" />
              Personal analytics
            </p>
            <h1 className="mt-1 font-display text-[32px] font-extrabold leading-tight tracking-[-0.03em] text-white lg:text-[38px]">
              Listening Stats
            </h1>
            <p className="mt-1.5 max-w-lg text-[12.5px] leading-relaxed text-white/35">
              Time the music actually played. A listen counts after 25 seconds
              or when the track ends.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3.5 text-[11.5px] font-semibold text-white/55 outline-none transition hover:border-white/[0.15] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
            title="Refresh stats"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
            Refresh
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <MetricCard
            icon={Clock3}
            label="Total Time"
            value={formatListenDuration(totals.listenTime)}
            detail="actual listening time"
            accent={totals.listenTime > 0}
            delay={0}
          />
          <MetricCard
            icon={Music2}
            label="Tracks Played"
            value={totals.plays.toLocaleString("en-US")}
            detail={
              totals.plays > 0
                ? `${playsLabel(totals.plays)} all time`
                : "Stats appear after the first 25 seconds"
            }
            delay={45}
          />
          <MetricCard
            icon={Crown}
            label="Top Artist"
            value={favourite?.name ?? "None yet"}
            detail={
              favourite
                ? `${playsLabel(favourite.plays)} · ${formatListenDuration(favourite.listenTime)}`
                : "Listen to tracks to find your favourite"
            }
            accent={Boolean(favourite)}
            delay={90}
          />
        </div>

        <section className="mt-7">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-display text-[16px] font-bold tracking-tight text-white/90">
                Top Artists
              </h2>
              <p className="mt-0.5 text-[10.5px] text-white/25">
                Top 5 by total listening time
              </p>
            </div>
            <span className="text-[10px] uppercase tracking-[0.16em] text-white/20">
              {hasStats ? "Your favourites" : "Empty for now"}
            </span>
          </div>

          {topArtists.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {topArtists.map((artist, index) => (
                <ArtistCard
                  key={artist.name.toLocaleLowerCase()}
                  artist={artist}
                  rank={index + 1}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[148px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-8 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.05]">
                <Music2 className="h-5 w-5 text-white/25" />
              </span>
              <p className="mt-3 text-[12.5px] font-semibold text-white/55">
                Your top artists will appear here
              </p>
              <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-white/25">
                Listen for more than 25 seconds and the player will build your
                personal stats.
              </p>
            </div>
          )}
        </section>

        <section className="mt-7">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-display text-[16px] font-bold tracking-tight text-white/90">
                <Trophy className="h-4 w-4 text-accent" />
                Most Played
              </h2>
              <p className="mt-0.5 text-[10.5px] text-white/25">
                Top 10 tracks · double-click to play
              </p>
            </div>
            <button
              type="button"
              onClick={playTopQueue}
              disabled={topQueue.length === 0}
              className="flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[11.5px] font-bold text-black shadow-glow transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Play "All-Time Top" playlist
            </button>
          </div>

          <div className="lucid-glass-panel overflow-hidden rounded-2xl">
            <div className="grid grid-cols-[28px_minmax(0,1fr)_76px] items-center gap-3 border-b border-white/[0.06] px-3 py-2.5 text-[9px] font-bold uppercase tracking-[0.16em] text-white/20 md:grid-cols-[28px_minmax(0,1fr)_86px_74px]">
              <span className="text-center">#</span>
              <span>Track</span>
              <span className="text-right">Plays</span>
              <span className="hidden text-right md:block">Time</span>
            </div>

            {topTracks.length > 0 ? (
              <div className="p-1.5">
                {topTracks.map((entry, index) => {
                  const active = currentTrack?.id === entry.track.id;
                  return (
                    <div
                      key={entry.track.id}
                      role="button"
                      tabIndex={0}
                      onDoubleClick={() => playEntry(entry)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") playEntry(entry);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openMenu(
                          entry.track,
                          event.clientX,
                          event.clientY,
                        );
                      }}
                      className={cn(
                        "group grid h-[54px] cursor-default grid-cols-[28px_minmax(0,1fr)_76px] items-center gap-3 rounded-xl px-1.5 outline-none transition-colors focus-visible:bg-white/[0.06] md:grid-cols-[28px_minmax(0,1fr)_86px_74px]",
                        active
                          ? "bg-white/[0.07]"
                          : "hover:bg-white/[0.045]",
                      )}
                    >
                      <span className="relative flex h-7 w-7 items-center justify-center">
                        {active && isPlaying ? (
                          <EqualizerBars
                            playing
                            className="h-3.5 justify-center"
                          />
                        ) : (
                          <span
                            className={cn(
                              "text-[10.5px] font-bold tabular-nums transition-opacity group-hover:opacity-0",
                              index === 0
                                ? "text-accent"
                                : index < 3
                                  ? "text-white/55"
                                  : "text-white/25",
                            )}
                          >
                            {String(index + 1).padStart(2, "0")}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            playEntry(entry);
                          }}
                          aria-label={`Play ${entry.track.title}`}
                          className="absolute flex h-7 w-7 items-center justify-center rounded-full text-white opacity-0 transition hover:scale-110 group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <Play className="h-3.5 w-3.5 fill-current" />
                        </button>
                      </span>

                      <div className="flex min-w-0 items-center gap-2.5">
                        <CoverArt
                          track={entry.track}
                          className="h-9 w-9 shrink-0 rounded-lg"
                          iconClassName="h-3.5 w-3.5"
                          showInitials={false}
                        />
                        <div className="min-w-0">
                          <p
                            className={cn(
                              "truncate text-[12.5px] font-semibold",
                              active
                                ? "text-accent"
                                : "text-white/85 group-hover:text-white",
                            )}
                          >
                            {entry.track.title}
                          </p>
                          <ArtistLinks
                            artistString={entry.track.artist}
                            className="mt-0.5 block truncate text-[10.5px] text-white/30"
                          />
                        </div>
                      </div>

                      <span className="flex justify-end">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9.5px] font-bold tabular-nums",
                            index === 0
                              ? "bg-accent-soft text-accent"
                              : "bg-white/[0.055] text-white/45",
                          )}
                        >
                          {index === 0 && (
                            <Sparkles className="h-2.5 w-2.5" />
                          )}
                          {playsLabel(entry.playCount)}
                        </span>
                      </span>

                      <span className="hidden text-right text-[10.5px] tabular-nums text-white/30 md:block">
                        {formatListenDuration(entry.totalListenTime)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-[190px] flex-col items-center justify-center px-6 py-10 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05]">
                  <Trophy className="h-5 w-5 text-white/25" />
                </span>
                <p className="mt-3 text-[12.5px] font-semibold text-white/55">
                  No ranking yet
                </p>
                <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-white/25">
                  The first track enters the chart after 25 seconds of listening
                  or a full play.
                </p>
              </div>
            )}
          </div>
        </section>

        {!loaded && (
          <p className="mt-5 text-center text-[10.5px] text-white/25">
            Loading stats…
          </p>
        )}

        <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[10px] text-white/15">
          <Clock3 className="h-3 w-3" />
          {formatTime(totals.listenTime * 1000)} of total listening · data
          stored locally
        </p>
      </div>
    </div>
  );
}
