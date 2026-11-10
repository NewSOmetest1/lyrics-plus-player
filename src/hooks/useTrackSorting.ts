import { useCallback, useMemo, useState } from "react";

export const TRACK_SORT_KEYS = [
  "default",
  "title",
  "artist",
  "album",
  "duration",
  "added",
] as const;

export type TrackSortKey = (typeof TRACK_SORT_KEYS)[number];

export const TRACK_SORT_OPTIONS: ReadonlyArray<{
  id: TrackSortKey;
  label: string;
}> = [
  { id: "default", label: "Default" },
  { id: "title", label: "Title (A–Z)" },
  { id: "artist", label: "Artist (A–Z)" },
  { id: "album", label: "Album (A–Z)" },
  { id: "duration", label: "Duration" },
  { id: "added", label: "Date Added / Liked" },
];

export interface TrackSortAccessors<T> {
  title: (item: T) => string;
  artist: (item: T) => string;
  album: (item: T) => string;
  duration: (item: T) => number;
  added: (item: T) => number;
}

const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

function isSortKey(value: unknown): value is TrackSortKey {
  return (
    typeof value === "string" &&
    (TRACK_SORT_KEYS as readonly string[]).includes(value)
  );
}

interface StoredSort {
  mode: TrackSortKey;
  reverse: boolean;
}

function readStoredSort(storageKey: string): StoredSort {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "{}",
    ) as { mode?: unknown; reverse?: unknown };
    return {
      mode: isSortKey(parsed.mode) ? parsed.mode : "default",
      reverse: parsed.reverse === true,
    };
  } catch {
    return { mode: "default", reverse: false };
  }
}

function writeStoredSort(storageKey: string, value: StoredSort): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Persistence is best-effort; sorting still works in memory.
  }
}

interface SortableTrackShape {
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  addedAt: number;
}

const trackAccessors: TrackSortAccessors<SortableTrackShape> = {
  title: (track) => track.title,
  artist: (track) => track.artist,
  album: (track) => track.album,
  duration: (track) => track.durationMs,
  added: (track) => track.addedAt,
};

function compare<T>(
  a: T,
  b: T,
  mode: Exclude<TrackSortKey, "default">,
  accessors: TrackSortAccessors<T>,
): number {
  switch (mode) {
    case "title":
      return collator.compare(accessors.title(a), accessors.title(b));
    case "artist":
      return (
        collator.compare(accessors.artist(a), accessors.artist(b)) ||
        collator.compare(accessors.title(a), accessors.title(b))
      );
    case "album":
      return (
        collator.compare(accessors.album(a), accessors.album(b)) ||
        collator.compare(accessors.title(a), accessors.title(b))
      );
    case "duration":
      return accessors.duration(a) - accessors.duration(b);
    case "added": {
      const aAdded = accessors.added(a);
      const bAdded = accessors.added(b);
      // Spotify's desktop cache has no add dates (0). Keep those rows after
      // dated ones so a fresh app like always lands on top of the dated list.
      if (aAdded <= 0 && bAdded <= 0) return 0;
      if (aAdded <= 0) return 1;
      if (bAdded <= 0) return -1;
      return bAdded - aAdded;
    }
  }
}

/**
 * Reusable in-memory track sorter for playlists, Liked Songs and search.
 *
 * Pass a stable accessor object when sorting rows that wrap a track instead of
 * being a bare `Track`. Preferences persist per surface so every screen keeps
 * its own sort without changing the library's AIMP sort.
 */
export function useTrackSorting<T>(
  items: readonly T[],
  options: {
    storageKey: string;
    accessors?: TrackSortAccessors<T>;
  },
) {
  const { storageKey, accessors } = options;
  const [state, setState] = useState<StoredSort>(() =>
    readStoredSort(storageKey),
  );

  const defaultAccessors = trackAccessors as unknown as TrackSortAccessors<T>;
  const resolvedAccessors = accessors ?? defaultAccessors;

  const sorted = useMemo(() => {
    const mode = state.mode;
    if (mode === "default") {
      return state.reverse ? [...items].reverse() : [...items];
    }
    const next = [...items].sort((a, b) =>
      compare(a, b, mode, resolvedAccessors),
    );
    if (!state.reverse) return next;
    if (mode !== "added") return next.reverse();
    // Reversing a date sort must not float undated Spotify rows above a
    // track that was just liked; reverse only the rows that have a date.
    const dated: T[] = [];
    const undated: T[] = [];
    for (const item of next) {
      if (resolvedAccessors.added(item) > 0) dated.push(item);
      else undated.push(item);
    }
    return [...dated.reverse(), ...undated.reverse()];
  }, [items, resolvedAccessors, state.mode, state.reverse]);

  const setMode = useCallback(
    (mode: TrackSortKey) => {
      setState((previous) => {
        const next = { ...previous, mode };
        writeStoredSort(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const setReverse = useCallback(
    (reverse: boolean) => {
      setState((previous) => {
        const next = { ...previous, reverse };
        writeStoredSort(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  return {
    items: sorted,
    mode: state.mode,
    reverse: state.reverse,
    setMode,
    setReverse,
  };
}
