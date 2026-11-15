import type {
  SpotifyAlbumSummary,
  SpotifyCatalogTrack,
  Track,
} from "@/types";
import {
  isSpotifyTrackOnPC,
  spotifyArtistTokens,
  spotifyArtistTokensOverlap,
  spotifyKey,
} from "../../shared/spotifyMatch";

export {
  createSpotifyTrackMatcher,
  isSpotifyTrackOnPC,
  spotifyArtistTokens,
  spotifyArtistsOverlap,
  spotifyKey,
} from "../../shared/spotifyMatch";
export type {
  LocalTrackLike,
  SpotifyArtistCredit,
  SpotifyTrackLike,
} from "../../shared/spotifyMatch";

export interface SpotifyMatchInput {
  id?: string | null;
  title: string;
  artist: string;
  artists?: readonly string[];
  durationMs?: number;
}

/**
 * Find the local file for a Spotify track. Uses the shared fuzzy matcher:
 * cleaned titles, multi-artist intersection and reversed title/artist tags.
 */
export function findLocalTrack(
  tracks: readonly Track[],
  input: SpotifyMatchInput,
): Track | null {
  if (!input.title.trim()) return null;
  return isSpotifyTrackOnPC(
    {
      id: input.id,
      title: input.title,
      artist: input.artist,
      artists: input.artists,
      durationMs: input.durationMs,
    },
    tracks,
  );
}

export function findLocalTrackForSpotify(
  tracks: readonly Track[],
  track: SpotifyCatalogTrack,
): Track | null {
  return findLocalTrack(tracks, {
    id: track.id,
    title: track.title,
    artist: track.artist,
    artists: track.artists,
    durationMs: track.durationMs,
  });
}

export interface LocalAlbumStats {
  onPc: number;
  total: number;
  downloaded: boolean;
}

interface IndexedAlbumTrack {
  artistTokens: string[];
}

/**
 * Build a lookup for every local album. Discography pages run one stats check
 * per release card; without an index that is releases × library. Here the
 * library is normalized once and each release only scans its own track list.
 */
export function createLocalAlbumStatsLookup(
  tracks: readonly Track[],
): (album: SpotifyAlbumSummary) => LocalAlbumStats {
  const byAlbum = new Map<string, IndexedAlbumTrack[]>();

  for (const track of tracks) {
    const key = spotifyKey(track.album);
    const entry: IndexedAlbumTrack = {
      artistTokens: spotifyArtistTokens(track.artist),
    };
    const list = byAlbum.get(key);
    if (list) list.push(entry);
    else byAlbum.set(key, [entry]);
  }

  const statsCache = new WeakMap<SpotifyAlbumSummary, LocalAlbumStats>();

  return (album) => {
    const cached = statsCache.get(album);
    if (cached) return cached;

    const albumKey = spotifyKey(album.title);
    const candidates = byAlbum.get(albumKey) ?? [];
    const albumTokens = spotifyArtistTokens(album.artist);
    let onPc = 0;
    for (const candidate of candidates) {
      if (spotifyArtistTokensOverlap(albumTokens, candidate.artistTokens)) {
        onPc += 1;
      }
    }
    const total = album.totalTracks || onPc;
    const stats: LocalAlbumStats = {
      onPc,
      total,
      downloaded: total > 0 && onPc >= total,
    };
    statsCache.set(album, stats);
    return stats;
  };
}

const albumStatsCache = new WeakMap<
  readonly Track[],
  (album: SpotifyAlbumSummary) => LocalAlbumStats
>();

export function localAlbumStats(
  tracks: readonly Track[],
  album: SpotifyAlbumSummary,
): LocalAlbumStats {
  let lookup = albumStatsCache.get(tracks);
  if (!lookup) {
    lookup = createLocalAlbumStatsLookup(tracks);
    albumStatsCache.set(tracks, lookup);
  }
  return lookup(album);
}

export function isLossless(format: string): boolean {
  return ["FLAC", "WAV", "AIFF", "WAVPACK"].includes(format.toUpperCase());
}
