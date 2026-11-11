import { promises as fs, unlinkSync } from "node:fs";
import path from "node:path";

/** Hard ceiling for `userData/covers`. */
export const MAX_CACHE_BYTES = 500 * 1024 * 1024;
/** Size the cache is reduced to after crossing the ceiling. */
export const TARGET_CACHE_BYTES = 420 * 1024 * 1024;

export interface CoverPruneResult {
  /** Bytes on disk before the prune. */
  totalSize: number;
  /** Bytes left after the prune. */
  remainingSize: number;
  deleted: number;
  deletedBytes: number;
}

interface CoverEntry {
  filePath: string;
  size: number;
  lastUsed: number;
}

const inFlight = new Map<string, Promise<CoverPruneResult>>();

/**
 * Mark a cover as recently used. Non-blocking: failures are ignored because a
 * missing file only means the prune already removed it.
 */
export function touchCoverAccess(filePath: string): void {
  const now = new Date();
  void fs.utimes(filePath, now, now).catch(() => undefined);
}

/**
 * Keep the cover cache under `MAX_CACHE_BYTES` by deleting the least recently
 * used files first until it shrinks to `TARGET_CACHE_BYTES`.
 *
 * Concurrent calls for the same directory share one run, so a library scan and
 * a download finishing together cannot scan the directory twice.
 */
export function pruneCoversCache(dir: string): Promise<CoverPruneResult> {
  const key = path.resolve(dir);
  const running = inFlight.get(key);
  if (running) return running;
  const task = pruneCoversCacheNow(key).finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

async function pruneCoversCacheNow(dir: string): Promise<CoverPruneResult> {
  const empty: CoverPruneResult = {
    totalSize: 0,
    remainingSize: 0,
    deleted: 0,
    deletedBytes: 0,
  };

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return empty;
  }

  const files: CoverEntry[] = [];
  let totalSize = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(dir, entry.name);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      totalSize += stat.size;
      files.push({
        filePath,
        size: stat.size,
        // atime is refreshed by touchCoverAccess(). Fall back to mtime for
        // filesystems mounted with noatime.
        lastUsed: Math.max(stat.atimeMs, stat.mtimeMs) || stat.mtimeMs,
      });
    } catch {
      // Removed between readdir and stat: nothing to account for.
    }
  }

  if (totalSize <= MAX_CACHE_BYTES) {
    return { ...empty, totalSize, remainingSize: totalSize };
  }

  files.sort((a, b) => a.lastUsed - b.lastUsed);

  let deleted = 0;
  let deletedBytes = 0;
  for (const file of files) {
    if (totalSize <= TARGET_CACHE_BYTES) break;
    try {
      unlinkSync(file.filePath);
      totalSize -= file.size;
      deleted += 1;
      deletedBytes += file.size;
    } catch {
      // Already gone or read-only: leave it out of the deletion count.
    }
  }

  return {
    totalSize: totalSize + deletedBytes,
    remainingSize: totalSize,
    deleted,
    deletedBytes,
  };
}
