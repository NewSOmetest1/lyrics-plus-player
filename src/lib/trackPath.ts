/**
 * Match the desktop playlist store's path comparison in the renderer.
 * Kept in a tiny module so stores can share it without circular imports.
 */
export function normalizeTrackPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  const cleaned = normalized.replace(/\/\.\//g, "/");
  return cleaned.length > 1 ? cleaned.replace(/\/$/, "") : cleaned;
}

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

export function isSpotifyId(value: string | null | undefined): boolean {
  return Boolean(value && SPOTIFY_ID.test(value.trim()));
}

export function spotifyIdFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /\/track\/([A-Za-z0-9]{22})/.exec(value);
  return match?.[1] ?? null;
}
