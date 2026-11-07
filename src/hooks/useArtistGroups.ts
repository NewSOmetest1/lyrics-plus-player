import { useMemo } from "react";

import { buildArtistGroups } from "@/lib/artists";
import type { ArtistGroup, Track } from "@/types";
import { usePlayerStore } from "@/store/playerStore";

/**
 * Library arrays are replaced immutably, so the last aggregation can be reused
 * across route transitions (Artists → artist → back) without rebuilding the
 * ~300 artist buckets.
 */
let cachedTracks: Track[] | null = null;
let cachedArtists: ArtistGroup[] | null = null;

function getArtistGroups(tracks: Track[]): ArtistGroup[] {
  if (cachedTracks === tracks && cachedArtists) return cachedArtists;
  cachedTracks = tracks;
  cachedArtists = buildArtistGroups(tracks);
  return cachedArtists;
}

/** Unique artists aggregated from the whole local library. */
export function useArtistGroups() {
  const tracks = usePlayerStore((state) => state.tracks);
  return useMemo(() => getArtistGroups(tracks), [tracks]);
}
