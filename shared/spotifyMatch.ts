/**
 * Shared Spotify ↔ local-library matcher.
 *
 * Spotify track titles routinely carry featured artists, explicit markers,
 * remaster notes and punctuation that local files do not. Artists are also
 * stored as one comma-separated string locally while Spotify returns an array.
 * Both sides are normalized before matching so availability does not depend on
 * tag formatting.
 */

import { areArtistsMatching, artistPhoneticKey } from "./translit.ts";

const FEAT_PATTERN =
  /\s*[([{]\s*(?:feat|ft|featuring|with)\.?\s+[^)\]}]*[)\]}]/gi;
const TRAILING_FEAT_PATTERN = /\s+(?:feat|ft|featuring)\.?\s+.*$/gi;
const VERSION_PATTERN =
  /\s*[([{]\s*(?:remaster(?:ed)?|remastered\s+\d{4}|live(?:\s+at\s+[^)\]}]*)?|official(?:\s+[^)\]}]*)?|bonus(?:\s+track)?|deluxe(?:\s+edition)?|explicit|clean|mono|stereo|radio\s+edit|extended(?:\s+mix)?|acoustic|instrumental)[^)\]}]*[)\]}]/gi;
const DASH_VERSION_PATTERN =
  /\s+-\s+(?:remaster(?:ed)?(?:\s+\d{4})?|live(?:\s+.*)?|official(?:\s+.*)?|bonus\s+track|radio\s+edit|extended\s+mix|acoustic(?:\s+version)?|instrumental(?:\s+version)?)\s*$/i;
const ARTIST_SEPARATOR =
  /\s*(?:,|;|\/|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\s+x\s+)\s*/i;

export interface SpotifyArtistCredit {
  name?: string | null;
}

export interface SpotifyTrackLike {
  id?: string | null;
  title?: string | null;
  name?: string | null;
  artist?: string | null;
  artists?: ReadonlyArray<string | SpotifyArtistCredit> | null;
  durationMs?: number;
}

export interface LocalTrackLike {
  id?: number | string | null;
  path: string;
  title: string;
  artist: string;
  durationMs?: number;
  spotifyTrackId?: string | null;
}

interface PreparedLocalTrack<T extends LocalTrackLike> {
  track: T;
  /** Original library order, so equal-duration candidates stay deterministic. */
  order: number;
  spotifyTrackId: string;
  titleKey: string;
  titlePhoneticKey: string;
  artistFull: string;
  artistPhonetic: string;
  artistTokens: string[];
}

interface PreparedLocalIndex<T extends LocalTrackLike> {
  bySpotifyId: Map<string, PreparedLocalTrack<T>[]>;
  byTitleKey: Map<string, PreparedLocalTrack<T>[]>;
  byTitlePhonetic: Map<string, PreparedLocalTrack<T>[]>;
  byArtistKey: Map<string, PreparedLocalTrack<T>[]>;
  byArtistPhonetic: Map<string, PreparedLocalTrack<T>[]>;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Normalize a track or artist name for comparison: strips featured credits,
 * version tags, quotes, punctuation, accents and casing.
 */
export function spotifyKey(value: string): string {
  // Decompose before punctuation stripping: a decomposed "й" is "и" plus a
  // combining breve, which the non-letter class would otherwise turn into a
  // space ("саи т").
  const source = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC");
  const cleaned = compact(
    source
      .replace(FEAT_PATTERN, " ")
      .replace(TRAILING_FEAT_PATTERN, " ")
      .replace(VERSION_PATTERN, " ")
      .replace(DASH_VERSION_PATTERN, " ")
      .replace(/[“”"'`´‘’«»]/g, "")
      .replace(/ё/gi, "е")
      .replace(/[^\p{L}\p{N}]+/gu, " "),
  );
  return compact((cleaned || source).toLocaleLowerCase());
}

/** Split any Spotify/local artist string into normalized artist tokens. */
export function spotifyArtistTokens(value: string): string[] {
  return value
    .split(ARTIST_SEPARATOR)
    .map(spotifyKey)
    .filter(Boolean);
}

function creditNames(
  artists: ReadonlyArray<string | SpotifyArtistCredit> | null | undefined,
): string[] {
  return (artists ?? [])
    .map((artist) =>
      typeof artist === "string" ? artist : (artist?.name ?? ""),
    )
    .map((name) => name.trim())
    .filter(Boolean);
}

export function spotifyArtistTokensOverlap(
  spotifyTokens: readonly string[],
  localTokens: readonly string[],
): boolean {
  if (spotifyTokens.length === 0 || localTokens.length === 0) return false;
  return spotifyTokens.some((spotifyArtist) =>
    localTokens.some((localArtist) =>
      areArtistsMatching(spotifyArtist, localArtist),
    ),
  );
}

/** Any shared artist credit counts as a match, including featured guests. */
export function spotifyArtistsOverlap(
  spotifyArtist: string,
  localArtist: string,
): boolean {
  return spotifyArtistTokensOverlap(
    spotifyArtistTokens(spotifyArtist),
    spotifyArtistTokens(localArtist),
  );
}

function prepareLocal<T extends LocalTrackLike>(
  track: T,
  order: number,
): PreparedLocalTrack<T> {
  return {
    track,
    order,
    spotifyTrackId: track.spotifyTrackId?.trim() ?? "",
    titleKey: spotifyKey(track.title),
    titlePhoneticKey: artistPhoneticKey(track.title),
    artistFull: spotifyKey(track.artist),
    artistPhonetic: artistPhoneticKey(track.artist),
    artistTokens: spotifyArtistTokens(track.artist),
  };
}

function pushIndex<T extends LocalTrackLike>(
  map: Map<string, PreparedLocalTrack<T>[]>,
  key: string,
  item: PreparedLocalTrack<T>,
): void {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(item);
  else map.set(key, [item]);
}

function addIndexed<T extends LocalTrackLike>(
  target: Set<PreparedLocalTrack<T>>,
  list: PreparedLocalTrack<T>[] | undefined,
): void {
  if (!list) return;
  for (const item of list) target.add(item);
}

function spotifyTitle(track: SpotifyTrackLike): string {
  return String(track.title ?? track.name ?? "").trim();
}

function spotifyArtistValues(track: SpotifyTrackLike): string[] {
  const names = creditNames(track.artists);
  const combined = String(track.artist ?? "").trim();
  if (combined && !names.includes(combined)) names.push(combined);
  return names;
}

function reversedTitleArtistMatch(
  spotifyTitleKey: string,
  spotifyTokens: string[],
  local: PreparedLocalTrack<LocalTrackLike>,
): boolean {
  if (!areArtistsMatching(local.artistFull, spotifyTitleKey)) return false;
  return spotifyTokens.some((artist) =>
    areArtistsMatching(artist, local.titleKey),
  );
}

function closestByDuration<T extends LocalTrackLike>(
  candidates: PreparedLocalTrack<T>[],
  durationMs: number | undefined,
): T | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1 || !durationMs || durationMs <= 0) {
    return candidates[0]!.track;
  }
  return [...candidates]
    .sort(
      (a, b) =>
        Math.abs((a.track.durationMs ?? 0) - durationMs) -
        Math.abs((b.track.durationMs ?? 0) - durationMs),
    )[0]!.track;
}

/**
 * Build a matcher for one library snapshot. The library is indexed by Spotify
 * id, normalized title, phonetic title and reversed artist/title keys, so a
 * lookup only compares the handful of candidates that can actually match.
 */
export function createSpotifyTrackMatcher<T extends LocalTrackLike>(
  localTracks: readonly T[],
): (track: SpotifyTrackLike) => T | null {
  const index: PreparedLocalIndex<T> = {
    bySpotifyId: new Map(),
    byTitleKey: new Map(),
    byTitlePhonetic: new Map(),
    byArtistKey: new Map(),
    byArtistPhonetic: new Map(),
  };

  localTracks.forEach((track, order) => {
    const prepared = prepareLocal(track, order);
    pushIndex(index.bySpotifyId, prepared.spotifyTrackId, prepared);
    pushIndex(index.byTitleKey, prepared.titleKey, prepared);
    pushIndex(index.byTitlePhonetic, prepared.titlePhoneticKey, prepared);
    pushIndex(index.byArtistKey, prepared.artistFull, prepared);
    pushIndex(index.byArtistPhonetic, prepared.artistPhonetic, prepared);
  });

  return (track) => {
    const title = spotifyTitle(track);
    if (!title) return null;

    const spotifyId = track.id?.trim() ?? "";
    if (spotifyId) {
      const byId = index.bySpotifyId.get(spotifyId);
      if (byId && byId.length > 0) return byId[0]!.track;
    }

    const titleKey = spotifyKey(title);
    if (!titleKey) return null;
    const titlePhoneticKey = artistPhoneticKey(title);

    const artistValues = spotifyArtistValues(track);
    const spotifyTokens = [
      ...new Set(artistValues.flatMap(spotifyArtistTokens)),
    ];
    if (spotifyTokens.length === 0) return null;

    const candidates = new Set<PreparedLocalTrack<T>>();
    addIndexed(candidates, index.byTitleKey.get(titleKey));
    addIndexed(candidates, index.byTitlePhonetic.get(titlePhoneticKey));
    // Reversed tags: the local artist is the Spotify title.
    addIndexed(candidates, index.byArtistKey.get(titleKey));
    addIndexed(candidates, index.byArtistPhonetic.get(titlePhoneticKey));

    const matches = [...candidates]
      .filter((local) => {
        const titleMatches =
          local.titleKey === titleKey ||
          (titlePhoneticKey !== "" &&
            local.titlePhoneticKey === titlePhoneticKey);
        if (
          titleMatches &&
          spotifyArtistTokensOverlap(spotifyTokens, local.artistTokens)
        ) {
          return true;
        }
        return reversedTitleArtistMatch(titleKey, spotifyTokens, local);
      })
      .sort((a, b) => a.order - b.order);

    return closestByDuration(matches, track.durationMs);
  };
}

type SpotifyMatcher = (track: SpotifyTrackLike) => LocalTrackLike | null;
const matcherCache = new WeakMap<readonly LocalTrackLike[], SpotifyMatcher>();

/**
 * Return the local track that satisfies a Spotify track, or null when the
 * track is not on PC. Title and at least one artist credit must match.
 *
 * The matcher is cached per library array: callers often check a whole
 * tracklist or run in a render loop, and rebuilding the index each time is
 * the difference between one pass and one pass per row.
 */
export function isSpotifyTrackOnPC<T extends LocalTrackLike>(
  track: SpotifyTrackLike,
  localTracks: readonly T[],
): T | null {
  let matcher = matcherCache.get(localTracks);
  if (!matcher) {
    matcher = createSpotifyTrackMatcher(localTracks) as SpotifyMatcher;
    matcherCache.set(localTracks, matcher);
  }
  return matcher(track) as T | null;
}
