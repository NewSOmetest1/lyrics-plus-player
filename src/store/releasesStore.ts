import { create } from "zustand";

import { backend } from "@/lib/api";
import type { ReleaseFeed } from "@/types";
import { useToastStore } from "@/store/toastStore";

export const EMPTY_RELEASE_FEED: ReleaseFeed = {
  version: 1,
  artists: [],
  releases: [],
  lastSyncedAt: null,
  lastSyncWarnings: [],
  authenticated: false,
};

export function normalizeArtistName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function isArtistFollowed(
  feed: ReleaseFeed,
  artistName: string,
): boolean {
  const target = normalizeArtistName(artistName);
  return feed.artists.some(
    (artist) =>
      normalizeArtistName(artist.localName ?? artist.name) === target ||
      normalizeArtistName(artist.name) === target,
  );
}

export function countNewReleases(feed: ReleaseFeed): number {
  return feed.releases.reduce(
    (total, release) => total + (release.isDownloaded ? 0 : 1),
    0,
  );
}

/** Count releases the user has not opened in New Releases yet. */
export function countUnseenReleases(
  feed: ReleaseFeed,
  seenReleaseIds: readonly string[],
): number {
  const seen = new Set(seenReleaseIds);
  return feed.releases.reduce(
    (total, release) => total + (seen.has(release.id) ? 0 : 1),
    0,
  );
}

const FRESH_MS = 15 * 60 * 1000;
const SEEN_RELEASES_KEY = "lyricsplus.releases.seen";
const SEEN_RELEASES_LIMIT = 3000;
let initPromise: Promise<void> | null = null;

function readSeenReleaseIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(SEEN_RELEASES_KEY) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const value of parsed) {
      if (typeof value !== "string" || !value || seen.has(value)) continue;
      seen.add(value);
      ids.push(value);
    }
    return ids.slice(0, SEEN_RELEASES_LIMIT);
  } catch {
    return [];
  }
}

function writeSeenReleaseIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEEN_RELEASES_KEY, JSON.stringify(ids));
  } catch {
    // Storage can be unavailable; keep the state in memory for this session.
  }
}

interface ReleasesState {
  feed: ReleaseFeed;
  loading: boolean;
  syncing: boolean;
  followPending: string | null;
  initialized: boolean;
  seenReleaseIds: string[];
  init: () => Promise<void>;
  sync: (silent?: boolean) => Promise<void>;
  ensureFresh: () => Promise<void>;
  setFollowing: (name: string, following: boolean) => Promise<void>;
  applyFeed: (feed: ReleaseFeed) => void;
  refresh: () => Promise<void>;
  markReleasesSeen: (ids: readonly string[]) => void;
}

export const useReleasesStore = create<ReleasesState>((set, get) => ({
  feed: EMPTY_RELEASE_FEED,
  loading: true,
  syncing: false,
  followPending: null,
  initialized: false,
  seenReleaseIds: readSeenReleaseIds(),

  init: async () => {
    if (get().initialized) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const feed = await backend.getReleaseFeed();
        set({ feed, loading: false, initialized: true });
      } catch (error) {
        set({ loading: false, initialized: true });
        console.error("[releases] initial load failed:", error);
      }
    })();
    return initPromise;
  },

  sync: async (silent = false) => {
    if (get().syncing) return;
    set({ syncing: true });
    try {
      const feed = await backend.syncReleases();
      set({ feed, syncing: false, loading: false, initialized: true });
      if (!silent) {
        const fresh = countNewReleases(feed);
        useToastStore.getState().push({
          kind: "success",
          title: "Spotify sync complete",
          description: `${feed.releases.length} release${
            feed.releases.length === 1 ? "" : "s"
          } · ${fresh} new${
            feed.lastSyncWarnings.length > 0
              ? ` · ${feed.lastSyncWarnings.length} warning${
                  feed.lastSyncWarnings.length === 1 ? "" : "s"
                }`
              : ""
          }`,
        });
      }
    } catch (error) {
      set({ syncing: false });
      useToastStore.getState().push({
        kind: "error",
        title: "Could not sync New Releases",
        description:
          error instanceof Error ? error.message : String(error),
      });
    }
  },

  ensureFresh: async () => {
    const { feed, syncing } = get();
    if (!feed.authenticated || syncing) return;
    if (
      feed.lastSyncedAt !== null &&
      Date.now() - feed.lastSyncedAt < FRESH_MS &&
      feed.artists.length > 0
    ) {
      return;
    }
    await get().sync(true);
  },

  setFollowing: async (name, following) => {
    if (get().followPending) return;
    set({ followPending: name });
    try {
      const feed = await backend.setArtistFollow(name, following);
      set({ feed, followPending: null });
      const stillTracked = feed.artists.some(
        (artist) =>
          normalizeArtistName(artist.localName ?? artist.name) ===
            normalizeArtistName(name) ||
          normalizeArtistName(artist.name) === normalizeArtistName(name),
      );
      if (!following && stillTracked) {
        useToastStore.getState().push({
          kind: "info",
          title: `${name} stays tracked`,
          description: "Artists you follow on Spotify stay tracked.",
        });
      } else {
        useToastStore.getState().push({
          kind: "success",
          title: following ? `Following ${name}` : `Unfollowed ${name}`,
          description: following
            ? "New Spotify releases will appear in this feed."
            : "The artist was removed from New Releases.",
        });
      }
    } catch (error) {
      set({ followPending: null });
      useToastStore.getState().push({
        kind: "error",
        title: following
          ? "Could not follow artist"
          : "Could not unfollow artist",
        description:
          error instanceof Error ? error.message : String(error),
      });
    }
  },

  applyFeed: (feed) => set({ feed, loading: false, initialized: true }),

  markReleasesSeen: (ids) => {
    const current = get().seenReleaseIds;
    const known = new Set(current);
    const added = new Set<string>();
    for (const id of ids) {
      if (id && !known.has(id) && !added.has(id)) added.add(id);
    }
    if (added.size === 0) return;
    // Newest entries first; the cap only limits long-term localStorage growth.
    const next = [...added, ...current].slice(0, SEEN_RELEASES_LIMIT);
    writeSeenReleaseIds(next);
    set({ seenReleaseIds: next });
  },

  refresh: async () => {
    try {
      const feed = await backend.getReleaseFeed();
      set({ feed, loading: false, initialized: true });
    } catch (error) {
      console.error("[releases] refresh failed:", error);
    }
  },
}));
