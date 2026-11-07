import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { StatsData, TrackStatsRecord } from "./types";

const EMPTY_STATS: StatsData = {
  version: 1,
  tracks: {},
};

function seconds(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  // A tenth of a second is precise enough and keeps stats.json readable.
  return Math.round(parsed * 10) / 10;
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
      return { version: 1, tracks };
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

  /** Credit one completed (or 25s+) listening session. */
  trackPlayed(trackPath: string, durationSec: number): TrackStatsRecord | null {
    if (typeof trackPath !== "string" || trackPath.trim() === "") return null;
    const existing = this.data.tracks[trackPath];
    const record: TrackStatsRecord = {
      playCount: (existing?.playCount ?? 0) + 1,
      totalListenTime: seconds((existing?.totalListenTime ?? 0) + seconds(durationSec)),
      lastPlayedTimestamp: Date.now(),
    };
    this.data.tracks[trackPath] = record;
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
    this.save();
    return { ...record };
  }
}
