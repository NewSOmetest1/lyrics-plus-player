import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type {
  StatsData,
  StatsDayRecord,
  TrackStatsRecord,
} from "./types";

const EMPTY_STATS: StatsData = {
  version: 2,
  tracks: {},
  days: {},
};

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function seconds(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  // A tenth of a second is precise enough and keeps stats.json readable.
  return Math.round(parsed * 10) / 10;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Calendar day in the user's local timezone, not UTC. */
function dateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function emptyDay(): StatsDayRecord {
  return { listenTime: 0, plays: 0, tracks: {} };
}

function sanitizeRecord(value: unknown): TrackStatsRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<TrackStatsRecord>;
  return {
    playCount: Math.max(0, Math.floor(Number(record.playCount) || 0)),
    totalListenTime: Math.max(0, seconds(record.totalListenTime)),
    lastPlayedTimestamp: Math.max(0, Number(record.lastPlayedTimestamp) || 0),
  };
}

function sanitizeDay(value: unknown): StatsDayRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<StatsDayRecord>;
  const tracks: Record<string, number> = {};
  if (record.tracks && typeof record.tracks === "object") {
    for (const [trackPath, amount] of Object.entries(record.tracks)) {
      if (!trackPath) continue;
      const listenTime = seconds(amount);
      if (listenTime > 0) tracks[trackPath] = listenTime;
    }
  }
  const listenTime = seconds(record.listenTime);
  const plays = Math.max(0, Math.floor(Number(record.plays) || 0));
  if (listenTime <= 0 && plays <= 0 && Object.keys(tracks).length === 0) {
    return null;
  }
  return { listenTime, plays, tracks };
}

/**
 * Older stats files only stored all-time totals. Fold each track's last-known
 * totals into the day of its last play so the calendar is not empty after the
 * update. New listening is then recorded day by day.
 */
function backfillDays(data: StatsData): void {
  for (const [trackPath, record] of Object.entries(data.tracks)) {
    if (record.lastPlayedTimestamp <= 0) continue;
    const key = dateKey(record.lastPlayedTimestamp);
    const day = (data.days[key] ??= emptyDay());
    day.listenTime = seconds(day.listenTime + record.totalListenTime);
    day.plays += record.playCount;
    day.tracks[trackPath] = seconds(
      (day.tracks[trackPath] ?? 0) + record.totalListenTime,
    );
  }
}

/**
 * Personal listening analytics, persisted next to library.json. Paths are the
 * keys so a track keeps its history even when the stable numeric id changes
 * after the file is moved (and re-scanned).
 */
export class StatsStore {
  private data: StatsData;

  constructor(private readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    const existed = existsSync(this.file);
    this.data = this.read();
    // The stats screen expects stats.json to exist even before the first play.
    if (!existed) this.save();
  }

  private read(): StatsData {
    if (!existsSync(this.file)) return structuredClone(EMPTY_STATS);
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<StatsData>;
      const tracks: Record<string, TrackStatsRecord> = {};
      if (parsed.tracks && typeof parsed.tracks === "object") {
        for (const [trackPath, value] of Object.entries(parsed.tracks)) {
          if (!trackPath) continue;
          const record = sanitizeRecord(value);
          if (record) tracks[trackPath] = record;
        }
      }

      const days: Record<string, StatsDayRecord> = {};
      const hasDailyBuckets =
        parsed.days !== undefined && parsed.days !== null;
      if (hasDailyBuckets && typeof parsed.days === "object") {
        for (const [key, value] of Object.entries(parsed.days)) {
          if (!DAY_KEY_PATTERN.test(key)) continue;
          const day = sanitizeDay(value);
          if (day) days[key] = day;
        }
      }

      const data: StatsData = { version: 2, tracks, days };
      // A missing `days` field means the file predates daily history.
      if (!hasDailyBuckets) backfillDays(data);
      return data;
    } catch (error) {
      console.error("[stats] could not read stats.json, starting empty:", error);
      return structuredClone(EMPTY_STATS);
    }
  }

  save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  get(): StatsData {
    return structuredClone(this.data);
  }

  /** Add listening time to the current local calendar day. */
  private creditDay(trackPath: string, durationSec: number, play: boolean): void {
    const delta = seconds(durationSec);
    if (delta <= 0 && !play) return;
    const key = dateKey(Date.now());
    const day = (this.data.days[key] ??= emptyDay());
    if (play) day.plays += 1;
    if (delta > 0) {
      day.listenTime = seconds(day.listenTime + delta);
      day.tracks[trackPath] = seconds((day.tracks[trackPath] ?? 0) + delta);
    }
  }

  /** Credit one completed (or 25s+) listening session. */
  trackPlayed(trackPath: string, durationSec: number): TrackStatsRecord | null {
    if (typeof trackPath !== "string" || trackPath.trim() === "") return null;
    const delta = seconds(durationSec);
    const existing = this.data.tracks[trackPath];
    const record: TrackStatsRecord = {
      playCount: (existing?.playCount ?? 0) + 1,
      totalListenTime: seconds((existing?.totalListenTime ?? 0) + delta),
      lastPlayedTimestamp: Date.now(),
    };
    this.data.tracks[trackPath] = record;
    this.creditDay(trackPath, delta, true);
    this.save();
    return { ...record };
  }

  /**
   * Add listening time without crediting another play. Used for the remainder
   * of a long session after the 25 second play has already been counted.
   */
  addListenTime(trackPath: string, durationSec: number): TrackStatsRecord | null {
    if (typeof trackPath !== "string" || trackPath.trim() === "") return null;
    const existing = this.data.tracks[trackPath];
    if (!existing) return null;
    const delta = seconds(durationSec);
    if (delta <= 0) return { ...existing };

    const record: TrackStatsRecord = {
      ...existing,
      totalListenTime: seconds(existing.totalListenTime + delta),
    };
    this.data.tracks[trackPath] = record;
    this.creditDay(trackPath, delta, false);
    this.save();
    return { ...record };
  }
}
