import type {
  SpotifyAlbumSummary,
  SpotifyCatalogTrack,
  Track,
} from "@/types";
import {
  isSpotifyTrackOnPC,
  spotifyArtistsOverlap,
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

export function localAlbumStats(
  tracks: readonly Track[],
  album: SpotifyAlbumSummary,
): LocalAlbumStats {
  const albumKey = spotifyKey(album.title);
  const onPc = tracks.filter(
    (track) =>
      spotifyKey(track.album) === albumKey &&
      spotifyArtistsOverlap(album.artist, track.artist),
  ).length;
  const total = album.totalTracks || onPc;
  return {
    onPc,
    total,
    downloaded: total > 0 && onPc >= total,
  };
}

export function isLossless(format: string): boolean {
  return ["FLAC", "WAV", "AIFF", "WAVPACK"].includes(format.toUpperCase());
}
