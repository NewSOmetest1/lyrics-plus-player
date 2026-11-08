/**
 * Filename fallbacks for files that carry no artist/title tags.
 *
 * Two common download conventions are supported:
 *   `Title - Artist`      (most Spotify grabbers)
 *   `01. Artist - Title`  (numbered rips)
 *
 * A known artist from the existing library disambiguates the unnumbered case.
 */

const TRACK_NUMBER_PREFIX =
  /^\s*(?:\(?(\d{1,3})\)?[.)]\s+|\d{1,3}\s*[-–—]\s+)/;
const NAME_SEPARATOR = /\s+[-–—]\s+/;
const ARTIST_SPLIT = /\s*(?:,|&|;|\bfeat\.?\b|\bft\.?\b)\s*/i;

export interface ParsedTrackName {
  title: string;
  artist: string | null;
  trackNo: number | null;
}

export function normalizeArtistKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function artistKeys(value: string): string[] {
  const parts = value.split(ARTIST_SPLIT);
  const keys = new Set<string>();
  for (const part of [value, ...parts]) {
    const key = normalizeArtistKey(part);
    if (key) keys.add(key);
  }
  return [...keys];
}

export function isKnownArtist(
  value: string,
  knownArtists: Set<string>,
): boolean {
  return artistKeys(value).some((key) => knownArtists.has(key));
}

export function parseTrackFileName(
  fileBaseName: string,
  knownArtists: Set<string>,
): ParsedTrackName {
  const cleaned = fileBaseName.normalize("NFC").trim();
  const prefix = TRACK_NUMBER_PREFIX.exec(cleaned);
  const trackNo = prefix
    ? Number.parseInt(prefix[1] ?? prefix[0], 10) || null
    : null;
  const name = prefix ? cleaned.slice(prefix[0].length).trim() : cleaned;
  const parts = name.split(NAME_SEPARATOR).map((part) => part.trim());
  if (parts.length < 2 || !parts[0] || !parts[parts.length - 1]) {
    return { title: name || cleaned, artist: null, trackNo };
  }

  const firstArtist = parts[0];
  const firstTitle = parts.slice(1).join(" - ");
  const lastArtist = parts[parts.length - 1];
  const lastTitle = parts.slice(0, -1).join(" - ");
  const leftKnown = isKnownArtist(firstArtist, knownArtists);
  const rightKnown = isKnownArtist(lastArtist, knownArtists);

  if (leftKnown && !rightKnown) {
    return { title: firstTitle, artist: firstArtist, trackNo };
  }
  if (rightKnown && !leftKnown) {
    return { title: lastTitle, artist: lastArtist, trackNo };
  }
  if (prefix) {
    return { title: firstTitle, artist: firstArtist, trackNo };
  }
  return { title: lastTitle, artist: lastArtist, trackNo };
}
