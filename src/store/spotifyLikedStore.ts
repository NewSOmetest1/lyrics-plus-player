import { create } from "zustand";

import { backend } from "@/lib/api";
import type {
  SpotifyLikedSnapshot,
  SpotifyLikedTrack,
  SpotifyLikedTrackInput,
} from "@/types";
import { useToastStore } from "@/store/toastStore";

interface DerivedLiked {
  likedPaths: Set<string>;
  knownIds: Map<string, string>;
}

function derive(
  snapshot: SpotifyLikedSnapshot,
  previous?: Map<string, string>,
): DerivedLiked {
  const likedPaths = new Set<string>();
  const knownIds = new Map(previous);
  for (const item of snapshot.items) {
    if (!item.localPath) continue;
    likedPaths.add(item.localPath);
    knownIds.set(item.localPath, item.id);
  }
  return { likedPaths, knownIds };
}

interface SpotifyLikedState extends DerivedLiked {
  snapshot: SpotifyLikedSnapshot | null;
  /** Optimistic per-track overrides for likes missing from the cached list. */
  likedOverrides: Record<string, boolean>;
  loaded: boolean;
  syncing: boolean;

  init: () => Promise<void>;
  refresh: () => Promise<SpotifyLikedSnapshot | null>;
  sync: (silent?: boolean) => Promise<SpotifyLikedSnapshot | null>;
  setLiked: (
    trackId: string,
    liked: boolean,
    track?: SpotifyLikedTrackInput | null,
  ) => Promise<boolean>;
  itemForPath: (trackPath: string | null | undefined) => SpotifyLikedTrack | null;
  knownIdForPath: (trackPath: string | null | undefined) => string | null;
}

export const useSpotifyLikedStore = create<SpotifyLikedState>((set, get) => ({
  snapshot: null,
  likedOverrides: {},
  likedPaths: new Set<string>(),
  knownIds: new Map<string, string>(),
  loaded: false,
  syncing: false,

  init: async () => {
    try {
      const snapshot = await backend.getSpotifyLiked();
      set({
        snapshot,
        likedOverrides: {},
        ...derive(snapshot, get().knownIds),
        loaded: true,
      });
    } catch (error) {
      console.warn("[spotify-liked] initial load failed:", error);
      set({ loaded: true });
    }
  },

  refresh: async () => {
    try {
      const snapshot = await backend.getSpotifyLiked();
      set({
        snapshot,
        ...derive(snapshot, get().knownIds),
        loaded: true,
      });
      return snapshot;
    } catch (error) {
      console.warn("[spotify-liked] refresh failed:", error);
      return null;
    }
  },

  sync: async (silent = false) => {
    if (get().syncing) return null;
    set({ syncing: true });
    try {
      const snapshot = await backend.syncSpotifyLiked();
      set({
        snapshot,
        likedOverrides: {},
        ...derive(snapshot),
        loaded: true,
        syncing: false,
      });
      if (!silent) {
        useToastStore.getState().push({
          kind: "success",
          title: "Spotify Liked Songs synced",
          description: `${snapshot.total} tracks · ${snapshot.downloaded} downloaded · ${snapshot.missing} missing`,
        });
      }
      return snapshot;
    } catch (error) {
      set({ syncing: false });
      if (silent) {
        console.warn("[spotify-liked] background sync failed:", error);
      } else {
        useToastStore.getState().push({
          kind: "error",
          title: "Spotify sync failed",
          description: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    }
  },

  setLiked: async (trackId, liked, track) => {
    set((state) => ({
      likedOverrides: { ...state.likedOverrides, [trackId]: liked },
    }));
    try {
      const snapshot = await backend.setSpotifyLiked(trackId, liked, track);
      set({
        snapshot,
        ...derive(snapshot, get().knownIds),
      });
      const failure = snapshot.warnings.find((warning) =>
        warning.startsWith("Spotify Like Error"),
      );
      if (failure) {
        const separator = failure.indexOf(" — ");
        useToastStore.getState().push({
          kind: "error",
          title:
            separator >= 0 ? failure.slice(0, separator) : failure,
          description:
            (separator >= 0 ? failure.slice(separator + 3) : "") ||
            track?.title ||
            "",
        });
        return false;
      }
      useToastStore.getState().push({
        kind: liked ? "success" : "info",
        title: liked
          ? "❤️ Saved to Spotify profile"
          : "💔 Removed from Spotify profile",
        description: track?.title ?? "",
      });
      const fallback = snapshot.warnings.find((warning) =>
        warning.startsWith("Web API fallback:"),
      );
      if (fallback) {
        useToastStore.getState().push({
          kind: "info",
          title: "Spotify Web API limited",
          description: fallback.replace("Web API fallback: ", ""),
        });
      }
      return true;
    } catch (error) {
      // Keep the optimistic like: the local Liked Songs entry already exists.
      const message =
        error instanceof Error ? error.message : String(error);
      useToastStore.getState().push({
        kind: "error",
        title: message.startsWith("Could not match")
          ? message
          : "Spotify Like Error",
        description: message.startsWith("Could not match")
          ? (track?.title ?? "")
          : message,
      });
      return false;
    }
  },

  itemForPath: (trackPath) => {
    if (!trackPath) return null;
    return (
      get().snapshot?.items.find((item) => item.localPath === trackPath) ??
      null
    );
  },

  knownIdForPath: (trackPath) => {
    if (!trackPath) return null;
    return get().knownIds.get(trackPath) ?? null;
  },
}));
