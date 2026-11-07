import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { TrackDelayData } from "./types";

const EMPTY_DELAYS: TrackDelayData = {
  version: 1,
  offsets: {},
};

const MIN_OFFSET_MS = -10_000;
const MAX_OFFSET_MS = 10_000;

function sanitizeOffset(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(MAX_OFFSET_MS, Math.max(MIN_OFFSET_MS, Math.round(parsed)));
}

function sanitizeOffsets(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const offsets: Record<string, number> = {};
  for (const [trackPath, rawOffset] of Object.entries(value)) {
    if (!trackPath) continue;
    const offset = sanitizeOffset(rawOffset);
    if (offset !== 0) offsets[trackPath] = offset;
  }
  return offsets;
}

/**
 * Manual karaoke calibration per track, stored next to library.json.
 * Paths are the keys so a delay follows the file even when its numeric id
 * changes after a rescan, and so moving a file simply drops the old entry.
 */
export class TrackDelayStore {
  private data: TrackDelayData;

  constructor(private readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    const existed = existsSync(this.file);
    this.data = this.read();
    // Keep the file discoverable for users before the first calibration.
    if (!existed) this.save();
  }

  private read(): TrackDelayData {
    if (!existsSync(this.file)) return structuredClone(EMPTY_DELAYS);
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<TrackDelayData>;
      return {
        version: 1,
        offsets: sanitizeOffsets(parsed.offsets),
      };
    } catch (error) {
      console.error("[track-delays] could not read track-delays.json, starting empty:", error);
      return structuredClone(EMPTY_DELAYS);
    }
  }

  save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  getAll(): Record<string, number> {
    return { ...this.data.offsets };
  }

  get(trackPath: string): number {
    return this.data.offsets[trackPath] ?? 0;
  }

  set(trackPath: string, offsetMs: unknown): number {
    if (typeof trackPath !== "string" || trackPath.trim() === "") return 0;
    const offset = sanitizeOffset(offsetMs);
    if (offset === 0) delete this.data.offsets[trackPath];
    else this.data.offsets[trackPath] = offset;
    this.save();
    return offset;
  }

  reset(trackPath: string): void {
    if (typeof trackPath !== "string" || !(trackPath in this.data.offsets)) return;
    delete this.data.offsets[trackPath];
    this.save();
  }

  resetAll(): void {
    this.data.offsets = {};
    this.save();
  }
}
