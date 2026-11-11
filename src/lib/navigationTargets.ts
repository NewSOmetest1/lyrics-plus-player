import type {
  SpotifyAlbumSummary,
  SpotifyCatalogTrack,
  SpotifyLikedTrack,
  Track,
} from "@/types";
import { splitArtistNames } from "@/lib/artists";
import { usePlayerStore } from "@/store/playerStore";
import { useSpotifyCatalogStore } from "@/store/spotifyCatalogStore";

/** Open the artist page, optionally revealing one album in the discography. */
export function openArtistForAlbum(
  artistString: string,
  album?: { id?: string | null; title?: string | null },
): boolean {
  const artist =
    splitArtistNames(artistString)[0]?.trim() || artistString.trim();
  if (!artist) return false;
  usePlayerStore.getState().openArtist(artist, undefined, {
    albumId: album?.id ?? undefined,
    albumTitle: album?.title ?? undefined,
  });
  return true;
}

/** Spotify catalog rows already carry an album id, so navigation is instant. */
export function openCatalogTrackAlbum(
  track: SpotifyCatalogTrack,
  fallback?: () => void,
): boolean {
  if (!track.albumId) {
    fallback?.();
    return false;
  }
  usePlayerStore.getState().navigate({
    type: "album-detail",
    albumId: track.albumId,
    artistName: track.artist,
    albumTitle: track.album,
    coverUrl: track.coverUrl,
    focusTrackId: track.id,
    focusTrackTitle: track.title,
  });
  return true;
}

/** Local rows have no album id, so resolve artist + album through search. */
export async function openLocalTrackAlbum(
  track: Track,
  fallback?: () => void,
): Promise<boolean> {
  const albumTitle = track.album?.trim();
  if (!albumTitle) {
    fallback?.();
    return false;
  }
  const artist = track.albumArtist?.trim() || track.artist?.trim() || "";
  const album = await useSpotifyCatalogStore
    .getState()
    .resolveAlbum(artist, albumTitle);
  if (!album) {
    fallback?.();
    return false;
  }
  usePlayerStore.getState().openAlbum(album, {
    trackTitle: track.title,
  });
  return true;
}

export async function openLikedTrackAlbum(
  item: SpotifyLikedTrack,
  fallback?: () => void,
): Promise<boolean> {
  const album = await useSpotifyCatalogStore
    .getState()
    .resolveAlbum(item.artist, item.album);
  if (!album) {
    fallback?.();
    return false;
  }
  usePlayerStore.getState().openAlbum(album, {
    trackTitle: item.title,
  });
  return true;
}

export function openAlbumArtist(
  album: SpotifyAlbumSummary | { artist?: string; artists?: string[]; title?: string; id?: string },
): boolean {
  const artistString = album.artist || (album.artists ?? []).join(", ");
  return openArtistForAlbum(artistString, {
    id: "id" in album ? album.id : undefined,
    title: album.title,
  });
}
