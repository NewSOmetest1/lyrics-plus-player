import type { Track } from "@/types";

export const TRACK_SORT_MODES = [
  "default",
  "title",
  "album",
  "album-track",
  "year-album",
  "year-album-track",
  "artist-year-album",
  "artist-year-album-track",
  "filename",
  "modified",
  "added",
  "duration",
  "shuffle",
] as const;

export type TrackSortMode = (typeof TRACK_SORT_MODES)[number];

/** AIMP's Russian labels, kept verbatim for the sort popup. */
export const TRACK_SORT_LABELS: Record<TrackSortMode, string> = {
  default: "По умолчанию",
  title: "Заголовку",
  album: "Альбому",
  "album-track": "Альбому / № трека",
  "year-album": "Году / Альбому",
  "year-album-track": "Году / Альбому / № трека",
  "artist-year-album": "Артисту / Году / Альбому",
  "artist-year-album-track": "Артисту / Году / Альбому / № трека",
  filename: "Имени файла",
  modified: "Дате изменения файла",
  added: "Дате добавления в плеер",
  duration: "Длительности",
  shuffle: "Перемешать",
};

export const SORT_MODE_STORAGE_KEY = "lyricsplus.trackSortMode";
export const SORT_REVERSE_STORAGE_KEY = "lyricsplus.trackSortReverse";

const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

function compareText(a: string | null | undefined, b: string | null | undefined): number {
  return collator.compare(a ?? "", b ?? "");
}

function fileName(track: Track): string {
  const explicit = track.fileName?.trim();
  if (explicit) return explicit;
  const parts = track.path.split(/[\\/]/);
  return parts[parts.length - 1] || track.path;
}

function modifiedAt(track: Track): number {
  return Number.isFinite(track.modifiedAt) && track.modifiedAt > 0
    ? track.modifiedAt
    : track.addedAt;
}

function yearValue(track: Track): number {
  return track.year && track.year > 0 ? track.year : Number.POSITIVE_INFINITY;
}

function trackNumber(track: Track): number {
  return track.trackNo && track.trackNo > 0
    ? track.trackNo
    : Number.POSITIVE_INFINITY;
}

function compareNumbers(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function compareTracks(a: Track, b: Track, mode: TrackSortMode, seed: number): number {
  switch (mode) {
    case "default":
      return 0;
    case "title":
      return compareText(a.title, b.title);
    case "album":
      return compareText(a.album, b.album);
    case "album-track":
      return (
        compareText(a.album, b.album) ||
        compareNumbers(trackNumber(a), trackNumber(b)) ||
        compareText(a.title, b.title)
      );
    case "year-album":
      return compareNumbers(yearValue(a), yearValue(b)) || compareText(a.album, b.album);
    case "year-album-track":
      return (
        compareNumbers(yearValue(a), yearValue(b)) ||
        compareText(a.album, b.album) ||
        compareNumbers(trackNumber(a), trackNumber(b)) ||
        compareText(a.title, b.title)
      );
    case "artist-year-album":
      return (
        compareText(a.artist, b.artist) ||
        compareNumbers(yearValue(a), yearValue(b)) ||
        compareText(a.album, b.album)
      );
    case "artist-year-album-track":
      return (
        compareText(a.artist, b.artist) ||
        compareNumbers(yearValue(a), yearValue(b)) ||
        compareText(a.album, b.album) ||
        compareNumbers(trackNumber(a), trackNumber(b)) ||
        compareText(a.title, b.title)
      );
    case "filename":
      return compareText(fileName(a), fileName(b));
    case "modified":
      return compareNumbers(modifiedAt(a), modifiedAt(b));
    case "added":
      // Newest additions first, per the AIMP menu wording.
      return compareNumbers(b.addedAt, a.addedAt);
    case "duration":
      return compareNumbers(a.durationMs, b.durationMs);
    case "shuffle":
      return compareNumbers(
        hashString(`${a.path}\u0000${seed}`),
        hashString(`${b.path}\u0000${seed}`),
      );
  }
}

/**
 * Sort a filtered track array. Runs in a useMemo in the library so the
 * 700-track list is rearranged instantly and handed to the virtual scroller.
 */
export function sortTracks(
  tracks: Track[],
  mode: TrackSortMode,
  reverse: boolean,
  shuffleSeed: number,
): Track[] {
  if (mode === "default") {
    return reverse ? [...tracks].reverse() : tracks;
  }
  const sorted = [...tracks].sort((a, b) => compareTracks(a, b, mode, shuffleSeed));
  return reverse ? sorted.reverse() : sorted;
}

export function isTrackSortMode(value: unknown): value is TrackSortMode {
  return (
    typeof value === "string" &&
    (TRACK_SORT_MODES as readonly string[]).includes(value)
  );
}

export function readTrackSortPreferences(): {
  mode: TrackSortMode;
  reverse: boolean;
} {
  try {
    const storedMode = window.localStorage.getItem(SORT_MODE_STORAGE_KEY);
    const storedReverse = window.localStorage.getItem(SORT_REVERSE_STORAGE_KEY);
    return {
      mode: isTrackSortMode(storedMode) ? storedMode : "default",
      reverse: storedReverse === "1",
    };
  } catch {
    return { mode: "default", reverse: false };
  }
}

export function writeTrackSortPreferences(
  mode: TrackSortMode,
  reverse: boolean,
): void {
  try {
    window.localStorage.setItem(SORT_MODE_STORAGE_KEY, mode);
    window.localStorage.setItem(SORT_REVERSE_STORAGE_KEY, reverse ? "1" : "0");
  } catch {
    // Persisting the sort choice is best-effort.
  }
}
