import { useMemo, useState, type CSSProperties } from "react";
import { CalendarDays, History, Music2 } from "lucide-react";

import type { StatsDayRecord, Track } from "@/types";
import { cn } from "@/lib/cn";
import { formatListenDuration } from "@/lib/format";
import {
  buildHeatmap,
  buildMemories,
  formatActivityDay,
  formatActivityDayShort,
  heatLevel,
  HEATMAP_WEEKS,
  type HeatmapDay,
  type ListeningMemory,
} from "@/lib/statsActivity";
import { CoverArt } from "@/components/ui/CoverArt";
import { ArtistLinks } from "@/components/artists/ArtistLinks";

const LEVEL_OPACITY = [0, 22, 40, 60, 84] as const;
const WEEKDAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""] as const;

function playsLabel(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "play" : "plays"}`;
}

function levelStyle(level: 0 | 1 | 2 | 3 | 4): CSSProperties | undefined {
  if (level === 0) return undefined;
  return {
    backgroundColor: `color-mix(in srgb, var(--accent) ${LEVEL_OPACITY[level]}%, transparent)`,
  };
}

function HeatmapCell({
  day,
  onHover,
}: {
  day: HeatmapDay;
  onHover: (day: HeatmapDay | null) => void;
}) {
  const level = heatLevel(day.seconds);
  const label =
    day.seconds > 0
      ? `${formatActivityDay(day.date)} · ${formatListenDuration(day.seconds)} · ${playsLabel(day.plays)}`
      : `${formatActivityDay(day.date)} · no listening`;

  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      onMouseEnter={() => onHover(day)}
      onMouseLeave={() => onHover(null)}
      style={levelStyle(level)}
      className={cn(
        "h-[11px] w-[11px] shrink-0 rounded-[3px] transition-[background-color,transform,box-shadow] duration-150",
        level === 0 && "bg-white/[0.055]",
        day.future && "invisible",
        !day.future &&
          "hover:z-10 hover:scale-110 hover:ring-1 hover:ring-white/50",
      )}
    />
  );
}

export function ListeningActivity({
  days,
  trackByPath,
  onPlay,
}: {
  days: Record<string, StatsDayRecord>;
  trackByPath: Map<string, Track>;
  onPlay: (track: Track) => void;
}) {
  const [today] = useState(() => new Date());
  const [hovered, setHovered] = useState<HeatmapDay | null>(null);

  const weeks = useMemo(
    () => buildHeatmap(days, HEATMAP_WEEKS, today),
    [days, today],
  );

  const summary = useMemo(() => {
    let totalSeconds = 0;
    let activeDays = 0;
    let best: HeatmapDay | null = null;
    for (const week of weeks) {
      for (const day of week.days) {
        if (day.future) continue;
        totalSeconds += day.seconds;
        if (day.seconds > 0) activeDays += 1;
        if (!best || day.seconds > best.seconds) best = day;
      }
    }
    return { totalSeconds, activeDays, best };
  }, [weeks]);

  const memoryCards = useMemo(() => {
    const memories = buildMemories(days, today);
    const cards: Array<
      ListeningMemory & {
        resolved: Array<{ track: Track; seconds: number }>;
      }
    > = [];

    for (const memory of memories) {
      const resolved = memory.tracks.flatMap((entry) => {
        const track = trackByPath.get(entry.path);
        return track ? [{ track, seconds: entry.seconds }] : [];
      });
      if (resolved.length > 0) cards.push({ ...memory, resolved });
    }

    return cards;
  }, [days, today, trackByPath]);

  return (
    <>
      <section className="mt-7">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-display text-[16px] font-bold tracking-tight text-white/90">
              <CalendarDays className="h-4 w-4 text-accent" />
              Listening Activity
            </h2>
            <p className="mt-0.5 text-[10.5px] text-white/25">
              Your last 12 months of actual listening time
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold text-white/55">
              {formatListenDuration(summary.totalSeconds)}
            </p>
            <p className="text-[9.5px] text-white/25">
              {summary.activeDays} active{" "}
              {summary.activeDays === 1 ? "day" : "days"}
            </p>
          </div>
        </div>

        <div className="lucid-glass-panel rounded-2xl p-4 sm:p-5">
          <div className="flex gap-2">
            <div className="flex shrink-0 flex-col gap-[3px] pt-[13px] pr-1 text-right text-[8.5px] font-medium leading-[11px] text-white/20">
              {WEEKDAY_LABELS.map((label, index) => (
                <span key={index} className="h-[11px]">
                  {label}
                </span>
              ))}
            </div>

            <div className="no-scrollbar min-w-0 flex-1 overflow-x-auto pb-1">
              <div className="w-max">
                <div className="flex gap-[3px]">
                  {weeks.map((week, index) => (
                    <span
                      key={index}
                      className="relative h-[13px] w-[11px] shrink-0"
                    >
                      {week.month && (
                        <span className="absolute left-0 top-0 whitespace-nowrap text-[8.5px] font-medium leading-[13px] text-white/20">
                          {week.month}
                        </span>
                      )}
                    </span>
                  ))}
                </div>

                <div className="flex gap-[3px]">
                  {weeks.map((week, index) => (
                    <div key={index} className="flex flex-col gap-[3px]">
                      {week.days.map((day) => (
                        <HeatmapCell
                          key={day.key}
                          day={day}
                          onHover={setHovered}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-h-[15px] min-w-0 items-center gap-1.5 text-[10px] text-white/35">
              <CalendarDays className="h-3 w-3 shrink-0 text-white/20" />
              {hovered ? (
                <span className="truncate">
                  <span className="font-semibold text-white/65">
                    {formatActivityDay(hovered.date)}
                  </span>
                  <span className="px-1.5 text-white/15">·</span>
                  {hovered.seconds > 0
                    ? `${formatListenDuration(hovered.seconds)} · ${playsLabel(hovered.plays)}`
                    : "No listening"}
                </span>
              ) : (
                <span>
                  {summary.activeDays > 0
                    ? "Hover a day to see listening time"
                    : "Play a track to start your calendar"}
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5 text-[9px] text-white/25">
              <span>Less</span>
              {([0, 1, 2, 3, 4] as const).map((level) => (
                <span
                  key={level}
                  style={levelStyle(level)}
                  className={cn(
                    "h-[9px] w-[9px] rounded-[2px]",
                    level === 0 && "bg-white/[0.055]",
                  )}
                />
              ))}
              <span>More</span>
            </div>
          </div>

          {summary.best && summary.best.seconds > 0 && (
            <p className="mt-2 text-[9.5px] text-white/20">
              Best day:{" "}
              <span className="text-white/35">
                {formatActivityDayShort(summary.best.date)}
              </span>{" "}
              · {formatListenDuration(summary.best.seconds)}
            </p>
          )}
        </div>
      </section>

      <section className="mt-7">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-display text-[16px] font-bold tracking-tight text-white/90">
              <History className="h-4 w-4 text-accent" />
              On This Day
            </h2>
            <p className="mt-0.5 text-[10.5px] text-white/25">
              Music you were listening to around this date in previous years
            </p>
          </div>
          <span className="text-[10px] uppercase tracking-[0.16em] text-white/20">
            {memoryCards.length > 0
              ? `${memoryCards.length} ${memoryCards.length === 1 ? "memory" : "memories"}`
              : "Building history"}
          </span>
        </div>

        {memoryCards.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {memoryCards.map((memory) => (
              <div
                key={memory.year}
                className="lucid-glass-panel rounded-2xl p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-accent">
                    <History className="h-2.5 w-2.5" />
                    {memory.yearsAgo === 1
                      ? "1 year ago"
                      : `${memory.yearsAgo} years ago`}
                  </span>
                  <span
                    className="truncate text-[9.5px] text-white/25"
                    title={formatActivityDay(memory.date)}
                  >
                    {memory.exact
                      ? "On this day"
                      : `Around ${formatActivityDayShort(memory.date)}`}
                  </span>
                </div>

                <div className="mt-2.5 space-y-0.5">
                  {memory.resolved.map(({ track, seconds }) => (
                    <div
                      key={track.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onPlay(track)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") onPlay(track);
                      }}
                      className="group flex h-11 cursor-default items-center gap-2.5 rounded-lg px-1.5 outline-none transition-colors hover:bg-white/[0.05] focus-visible:bg-white/[0.06]"
                      title={`Play ${track.title}`}
                    >
                      <CoverArt
                        track={track}
                        className="h-8 w-8 shrink-0 rounded-md"
                        iconClassName="h-3 w-3"
                        showInitials={false}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11.5px] font-semibold text-white/80 transition-colors group-hover:text-white">
                          {track.title}
                        </p>
                        <ArtistLinks
                          artistString={track.artist}
                          className="mt-0.5 block truncate text-[9.5px] text-white/30"
                        />
                      </div>
                      <span className="shrink-0 text-[9px] tabular-nums text-white/20">
                        {formatListenDuration(seconds)}
                      </span>
                    </div>
                  ))}
                </div>

                <p className="mt-2.5 border-t border-white/[0.05] pt-2 text-[9.5px] text-white/20">
                  {playsLabel(memory.plays)} ·{" "}
                  {formatListenDuration(memory.listenTime)} listened
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="lucid-glass-panel flex min-h-[120px] flex-col items-center justify-center rounded-2xl px-6 py-7 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.05]">
              <Music2 className="h-4 w-4 text-white/25" />
            </span>
            <p className="mt-3 text-[12px] font-semibold text-white/55">
              No memories from previous years yet
            </p>
            <p className="mt-1 max-w-sm text-[10.5px] leading-relaxed text-white/25">
              Keep listening — this date will bring the music back once your
              history is old enough.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
