import type { StatsDayRecord } from "@/types";

/** Number of week columns in the year-long activity calendar. */
export const HEATMAP_WEEKS = 53;

export interface HeatmapDay {
  /** Local calendar key, `YYYY-MM-DD`. */
  key: string;
  date: Date;
  seconds: number;
  plays: number;
  future: boolean;
}

export interface HeatmapWeek {
  days: HeatmapDay[];
  /** Short month label shown above the week that starts a new month. */
  month: string | null;
}

export interface ListeningMemoryTrack {
  path: string;
  seconds: number;
}

export interface ListeningMemory {
  yearsAgo: number;
  year: number;
  date: Date;
  /** True when the history entry is exactly today's month and day. */
  exact: boolean;
  listenTime: number;
  plays: number;
  tracks: ListeningMemoryTrack[];
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

/** Monday-based week start, matching the calendar layout. */
export function startOfWeek(date: Date): Date {
  const value = startOfDay(date);
  const offset = (value.getDay() + 6) % 7;
  return addDays(value, -offset);
}

export function dateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatActivityDay(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatActivityDayShort(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Build the last `weeks` Monday-Sunday columns ending with the current week.
 * Future days in the current week are marked so the UI can hide them.
 */
export function buildHeatmap(
  days: Record<string, StatsDayRecord>,
  weeks = HEATMAP_WEEKS,
  today = new Date(),
): HeatmapWeek[] {
  const todayStart = startOfDay(today);
  const todayKey = dateKey(todayStart);
  const start = addDays(startOfWeek(todayStart), -(weeks - 1) * 7);
  const result: HeatmapWeek[] = [];

  for (let index = 0; index < weeks; index += 1) {
    const weekStart = addDays(start, index * 7);
    const weekDays = Array.from({ length: 7 }, (_, offset) => {
      const date = addDays(weekStart, offset);
      const key = dateKey(date);
      const record = days[key];
      return {
        key,
        date,
        seconds: record?.listenTime ?? 0,
        plays: record?.plays ?? 0,
        future: key > todayKey,
      };
    });

    let month: string | null = null;
    const firstOfMonth = weekDays.find((day) => day.date.getDate() === 1);
    if (firstOfMonth) {
      month = firstOfMonth.date.toLocaleDateString("en-US", {
        month: "short",
      });
    } else if (index === 0) {
      // Label the first column even when the range starts mid-month.
      month = weekDays[0].date.toLocaleDateString("en-US", {
        month: "short",
      });
    }

    result.push({ days: weekDays, month });
  }

  return result;
}

/** Four intensity buckets tuned for a normal day of listening. */
export function heatLevel(seconds: number): 0 | 1 | 2 | 3 | 4 {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const minutes = seconds / 60;
  if (minutes < 15) return 1;
  if (minutes < 45) return 2;
  if (minutes < 90) return 3;
  return 4;
}

/**
 * Find the closest listening day to today's month/day in each of the previous
 * years, within a three-day window. This keeps memories useful when the exact
 * date was quiet while avoiding wildly unrelated days.
 */
export function buildMemories(
  days: Record<string, StatsDayRecord>,
  today = new Date(),
  maxYears = 3,
): ListeningMemory[] {
  const memories: ListeningMemory[] = [];

  for (let yearsAgo = 1; yearsAgo <= maxYears; yearsAgo += 1) {
    const year = today.getFullYear() - yearsAgo;
    let best:
      | {
          date: Date;
          exact: boolean;
          distance: number;
          record: StatsDayRecord;
        }
      | null = null;

    for (let offset = -3; offset <= 3; offset += 1) {
      const candidate = new Date(
        year,
        today.getMonth(),
        today.getDate() + offset,
      );
      // Guard against dates rolling into the next month/year (e.g. Feb 29).
      if (candidate.getFullYear() !== year) continue;
      const key = dateKey(candidate);
      const record = days[key];
      if (!record || record.listenTime <= 0) continue;
      const distance = Math.abs(offset);
      if (!best || distance < best.distance) {
        best = {
          date: candidate,
          exact: offset === 0,
          distance,
          record,
        };
      }
    }

    if (!best) continue;
    const tracks = Object.entries(best.record.tracks ?? {})
      .filter(([, seconds]) => seconds > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([path, seconds]) => ({ path, seconds }));
    if (tracks.length === 0) continue;

    memories.push({
      yearsAgo,
      year,
      date: best.date,
      exact: best.exact,
      listenTime: best.record.listenTime,
      plays: best.record.plays,
      tracks,
    });
  }

  return memories;
}
