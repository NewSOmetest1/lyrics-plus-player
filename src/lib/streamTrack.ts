import type {
  ReleaseRecord,
  ReleaseTrack,
  SpotifyCatalogTrack,
  Track,
} from "@/types";
import { backend } from "@/lib/api";

export type StreamMode = "full" | "preview";

interface StreamSourceInput {
  spotifyId: string;
  title: string;
  artist: string;
  artists?: string[];
  album: string;
  albumArtist?: string | null;
  coverUrl: string | null;
  durationMs: number;
  previewUrl?: string | null;
  releaseId?: string;
  trackNo?: number | null;
}

/**
 * A queued stream row carries metadata only. Its media URL is resolved right
 * before playback so a whole album queue does not block on six yt-dlp calls.
 */
export function streamTrack(
  input: StreamSourceInput,
  mode: StreamMode,
): Track {
  const spotifyId = input.spotifyId.trim();
  return {
    id: `stream:${spotifyId || input.title}`,
    path: "",
    title: input.title,
    artist: input.artist,
    album: input.album,
    albumArtist: input.albumArtist ?? input.artist,
    spotifyTrackId: spotifyId || null,
    genre: null,
    year: null,
    trackNo: input.trackNo ?? null,
    durationMs: Math.max(0, input.durationMs),
    format: mode === "preview" ? "PREVIEW" : "STREAM",
    bitrate: null,
    sampleRate: null,
    bitDepth: null,
    channels: null,
    fileSize: 0,
    fileName: "",
    modifiedAt: 0,
    coverPath: input.coverUrl,
    coverFullPath: input.coverUrl,
    coverPalettePath: input.coverUrl,
    hasEmbeddedLyrics: false,
    addedAt: Date.now(),
    isStream: true,
    streamType: mode,
    streamSource: null,
    streamExpiresAt: null,
    streamLookup: {
      trackId: spotifyId || undefined,
      title: input.title,
      artist: input.artist,
      artists: input.artists,
      album: input.album || undefined,
      durationMs: Math.max(0, input.durationMs) || undefined,
      previewUrl: input.previewUrl ?? null,
    },
    streamReleaseId:
      input.releaseId ??
      (spotifyId ? `spotify-track-${spotifyId}` : "spotify-stream"),
    streamSpotifyId: spotifyId || undefined,
  };
}

export function streamTrackFromCatalog(
  track: SpotifyCatalogTrack,
  mode: StreamMode,
  releaseId?: string,
): Track {
  return streamTrack(
    {
      spotifyId: track.id,
      title: track.title,
      artist: track.artist,
      artists: track.artists,
      album: track.album,
      coverUrl: track.coverUrl,
      durationMs: track.durationMs,
      releaseId:
        releaseId ??
        (track.albumId
          ? `spotify-album-${track.albumId}`
          : `spotify-track-${track.id}`),
      trackNo: track.trackNumber,
    },
    mode,
  );
}

export function streamQueueFromCatalog(
  tracks: SpotifyCatalogTrack[],
  mode: StreamMode,
  releaseId?: string,
): Track[] {
  return tracks.map((track) => streamTrackFromCatalog(track, mode, releaseId));
}

export function streamTrackFromRelease(
  track: ReleaseTrack,
  release: ReleaseRecord,
  mode: StreamMode,
): Track {
  return streamTrack(
    {
      spotifyId: track.id,
      title: track.title,
      artist: track.artist || release.artist,
      artists: [track.artist || release.artist],
      album: release.title,
      albumArtist: release.artist,
      coverUrl: release.coverUrl,
      durationMs: track.durationMs,
      previewUrl: track.previewUrl ?? release.previewUrl,
      releaseId: release.id,
      trackNo: track.trackNumber,
    },
    mode,
  );
}

export function streamQueueFromRelease(
  release: ReleaseRecord,
  mode: StreamMode,
): Track[] {
  return release.tracks.map((track) =>
    streamTrackFromRelease(track, release, mode),
  );
}

function isExpired(track: Track): boolean {
  if (!track.path) return true;
  return Boolean(track.streamExpiresAt && track.streamExpiresAt <= Date.now() + 5_000);
}

/**
 * Resolve the actual HTTPS media URL for a stream row. The returned copy keeps
 * the same id so the queue/current-track selection stays stable.
 */
export async function resolveStreamTrack(
  track: Track,
  force = false,
): Promise<Track> {
  if (!track.isStream || (!force && !isExpired(track))) return track;

  const baseLookup = track.streamLookup ?? {
    trackId: track.spotifyTrackId ?? undefined,
    title: track.title,
    artist: track.artist,
    album: track.album || undefined,
    durationMs: track.durationMs || undefined,
  };
  const lookup = force ? { ...baseLookup, force: true } : baseLookup;

  if (track.streamType === "preview") {
    const resolved = await backend.resolvePreviewSource(lookup);
    if (!resolved) throw new Error("No preview source is available.");
    return {
      ...track,
      path: resolved.url,
      streamSource: resolved.source,
      streamExpiresAt: resolved.expiresAt,
    };
  }

  const resolved = await backend.resolveFullStream(lookup);
  return {
    ...track,
    path: resolved.url,
    streamSource: resolved.source,
    streamExpiresAt: resolved.expiresAt,
  };
}
