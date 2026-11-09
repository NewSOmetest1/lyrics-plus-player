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
  spotifyTrackId: string;
  titleKey: string;
  titlePhoneticKey: string;
  artistFull: string;
  artistTokens: string[];
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

function artistSetsOverlap(
  spotifyTokens: string[],
  localTokens: string[],
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
  return artistSetsOverlap(
    spotifyArtistTokens(spotifyArtist),
    spotifyArtistTokens(localArtist),
  );
}

function prepareLocal<T extends LocalTrackLike>(
  track: T,
): PreparedLocalTrack<T> {
  return {
    track,
    spotifyTrackId: track.spotifyTrackId?.trim() ?? "",
    titleKey: spotifyKey(track.title),
    titlePhoneticKey: artistPhoneticKey(track.title),
    artistFull: spotifyKey(track.artist),
    artistTokens: spotifyArtistTokens(track.artist),
  };
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
 * Build a matcher for one library snapshot. Pre-normalizing the library keeps
 * per-row matching cheap across liked songs, search and album tracklists.
 */
export function createSpotifyTrackMatcher<T extends LocalTrackLike>(
  localTracks: readonly T[],
): (track: SpotifyTrackLike) => T | null {
  const prepared = localTracks.map(prepareLocal);

  return (track) => {
    const title = spotifyTitle(track);
    if (!title) return null;

    const spotifyId = track.id?.trim() ?? "";
    if (spotifyId) {
      const byId = prepared.find(
        (local) => local.spotifyTrackId === spotifyId,
      );
      if (byId) return byId.track;
    }

    const titleKey = spotifyKey(title);
    if (!titleKey) return null;
    const titlePhoneticKey = artistPhoneticKey(title);

    const artistValues = spotifyArtistValues(track);
    const spotifyTokens = [
      ...new Set(artistValues.flatMap(spotifyArtistTokens)),
    ];
    if (spotifyTokens.length === 0) return null;

    const matches = prepared.filter((local) => {
      const titleMatches =
        local.titleKey === titleKey ||
        (titlePhoneticKey !== "" &&
          local.titlePhoneticKey === titlePhoneticKey);
      if (titleMatches && artistSetsOverlap(spotifyTokens, local.artistTokens)) {
        return true;
      }
      return reversedTitleArtistMatch(titleKey, spotifyTokens, local);
    });

    return closestByDuration(matches, track.durationMs);
  };
}

/**
 * Return the local track that satisfies a Spotify track, or null when the
 * track is not on PC. Title and at least one artist credit must match.
 */
export function isSpotifyTrackOnPC<T extends LocalTrackLike>(
  track: SpotifyTrackLike,
  localTracks: readonly T[],
): T | null {
  return createSpotifyTrackMatcher(localTracks)(track);
}
