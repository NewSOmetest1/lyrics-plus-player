import { create } from "zustand";

import type { Playlist, Track } from "@/types";
import { LIKED_PLAYLIST_ID } from "@/types";
import { backend, coverUrl } from "@/lib/api";
import { useSettingsStore } from "@/store/settingsStore";
import { useSpotifyLikedStore } from "@/store/spotifyLikedStore";
import { useToastStore } from "@/store/toastStore";

interface PlaylistState {
  playlists: Playlist[];
  /** Normalized paths of every track in the system Liked Songs playlist. */
  likedPaths: Set<string>;
  loaded: boolean;
  loading: boolean;

  init: () => Promise<void>;
  create: (input: {
    name: string;
    description?: string;
    trackPaths?: string[];
  }) => Promise<Playlist | null>;
  update: (
    id: string,
    patch: { name?: string; description?: string; trackPaths?: string[] },
  ) => Promise<Playlist | null>;
  remove: (id: string) => Promise<boolean>;
  addTrack: (
    playlistId: string,
    trackPath: string,
  ) => Promise<{ playlist: Playlist; changed: boolean } | null>;
  removeTrack: (
    playlistId: string,
    trackPath: string,
  ) => Promise<{ playlist: Playlist; changed: boolean } | null>;
  importM3U: () => Promise<Playlist | null>;
  exportM3U: (playlistId: string) => Promise<string | null>;
  ensureLiked: () => Promise<Playlist | null>;
  isLiked: (trackPath: string) => boolean;
  toggleLike: (track: Track) => Promise<boolean>;
}

function reportError(error: unknown): void {
  useToastStore.getState().push({
    kind: "error",
    title: "Playlist operation failed",
    description: String(error),
  });
}

/** Match the desktop playlist store's path comparison in the renderer. */
export function normalizeTrackPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  const cleaned = normalized.replace(/\/\.\//g, "/");
  return cleaned.length > 1 ? cleaned.replace(/\/$/, "") : cleaned;
}

function likedPathSet(playlists: Playlist[]): Set<string> {
  const liked = playlists.find(
    (playlist) => playlist.id === LIKED_PLAYLIST_ID,
  );
  return new Set((liked?.trackPaths ?? []).map(normalizeTrackPath));
}

/** The system playlist always stays at the top of the sidebar and library. */
function pinLikedFirst(playlists: Playlist[]): Playlist[] {
  const liked = playlists.find(
    (playlist) => playlist.id === LIKED_PLAYLIST_ID,
  );
  if (!liked) return playlists;
  return [liked, ...playlists.filter((playlist) => playlist.id !== LIKED_PLAYLIST_ID)];
}

function playlistPatch(playlists: Playlist[]) {
  const ordered = pinLikedFirst(playlists);
  return { playlists: ordered, likedPaths: likedPathSet(ordered) };
}

/** Reactive selector: returns true only when this exact track is liked. */
export function useIsLiked(trackPath: string | null | undefined): boolean {
  const local = usePlaylistStore((state) =>
    trackPath ? state.likedPaths.has(normalizeTrackPath(trackPath)) : false,
  );
  const spotify = useSpotifyLikedStore((state) =>
    trackPath ? state.likedPaths.has(trackPath) : false,
  );
  const source = useSettingsStore((state) => state.likedSongsSource);
  return source === "spotify" ? local || spotify : local;
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  playlists: [],
  likedPaths: new Set<string>(),
  loaded: false,
  loading: false,

  init: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      let playlists = await backend.getPlaylists();
      if (!playlists.some((playlist) => playlist.id === LIKED_PLAYLIST_ID)) {
        const liked = await backend.ensureLikedPlaylist();
        playlists = [
          liked,
          ...playlists.filter((playlist) => playlist.id !== liked.id),
        ];
      }
      set({ ...playlistPatch(playlists), loaded: true, loading: false });
    } catch (error) {
      set({ loaded: true, loading: false });
      reportError(error);
    }
  },

  create: async (input) => {
    try {
      const playlist = await backend.createPlaylist(input);
      set((state) => ({
        ...playlistPatch([
          playlist,
          ...state.playlists.filter((item) => item.id !== playlist.id),
        ]),
        loaded: true,
      }));
      return playlist;
    } catch (error) {
      reportError(error);
      return null;
    }
  },

  update: async (id, patch) => {
    try {
      const playlist = await backend.updatePlaylist(id, patch);
      set((state) => ({
        ...playlistPatch([
          playlist,
          ...state.playlists.filter((item) => item.id !== id),
        ]),
      }));
      return playlist;
    } catch (error) {
      reportError(error);
      return null;
    }
  },

  remove: async (id) => {
    try {
      const removed = await backend.deletePlaylist(id);
      if (removed) {
        set((state) => ({
          ...playlistPatch(
            state.playlists.filter((playlist) => playlist.id !== id),
          ),
        }));
      }
      return removed;
    } catch (error) {
      reportError(error);
      return false;
    }
  },

  addTrack: async (playlistId, trackPath) => {
    try {
      const result = await backend.addTrackToPlaylist(playlistId, trackPath);
      if (result.changed) {
        set((state) => ({
          ...playlistPatch([
            result.playlist,
            ...state.playlists.filter(
              (playlist) => playlist.id !== playlistId,
            ),
          ]),
        }));
      }
      return result;
    } catch (error) {
      reportError(error);
      return null;
    }
  },

  removeTrack: async (playlistId, trackPath) => {
    try {
      const result = await backend.removeTrackFromPlaylist(playlistId, trackPath);
      if (result.changed) {
        set((state) => ({
          ...playlistPatch(
            state.playlists.map((playlist) =>
              playlist.id === playlistId ? result.playlist : playlist,
            ),
          ),
        }));
      }
      return result;
    } catch (error) {
      reportError(error);
      return null;
    }
  },

  importM3U: async () => {
    try {
      const playlist = await backend.importM3U();
      if (playlist) {
        set((state) => ({
          ...playlistPatch([
            playlist,
            ...state.playlists.filter((item) => item.id !== playlist.id),
          ]),
          loaded: true,
        }));
        useToastStore.getState().push({
          kind: "success",
          title: `Imported "${playlist.name}"`,
          description: `${playlist.trackPaths.length} track${playlist.trackPaths.length === 1 ? "" : "s"} from M3U`,
        });
      }
      return playlist;
    } catch (error) {
      reportError(error);
      return null;
    }
  },

  exportM3U: async (playlistId) => {
    try {
      const target = await backend.exportM3U(playlistId);
      if (target) {
        useToastStore.getState().push({
          kind: "success",
          title: "Playlist exported",
          description: target,
        });
      }
      return target;
    } catch (error) {
      reportError(error);
      return null;
    }
  },

  ensureLiked: async () => {
    try {
      const playlist = await backend.ensureLikedPlaylist();
      set((state) => ({
        ...playlistPatch([
          playlist,
          ...state.playlists.filter((item) => item.id !== playlist.id),
        ]),
        loaded: true,
      }));
      return playlist;
    } catch (error) {
      reportError(error);
      return null;
    }
  },

  isLiked: (trackPath) => {
    if (!trackPath.trim()) return false;
    return get().likedPaths.has(normalizeTrackPath(trackPath));
  },

  toggleLike: async (track) => {
    const trackPath = track.path?.trim();
    if (!trackPath) return false;

    const likedPlaylist =
      get().playlists.find(
        (playlist) => playlist.id === LIKED_PLAYLIST_ID,
      ) ?? (await get().ensureLiked());
    if (!likedPlaylist) return false;

    const source = useSettingsStore.getState().likedSongsSource;
    const spotifyStore = useSpotifyLikedStore.getState();
    const spotifyItem =
      source === "spotify" ? spotifyStore.itemForPath(trackPath) : null;
    const wasLiked = get().likedPaths.has(normalizeTrackPath(trackPath));
    const currentlyLiked = wasLiked || Boolean(spotifyItem);
    const knownId =
      source === "spotify"
        ? (spotifyItem?.id ?? spotifyStore.knownIdForPath(trackPath) ?? "")
        : "";

    // Local first: the heart and playlists.json change before any network
    // request, so a Spotify rate limit cannot lose the user's like.
    if (currentlyLiked) {
      if (wasLiked) await get().removeTrack(likedPlaylist.id, trackPath);
    } else {
      const result = await get().addTrack(likedPlaylist.id, trackPath);
      if (!result) return false;
    }

    if (source === "spotify") {
      // Empty id means "resolve by artist + title" in the main process.
      await spotifyStore.setLiked(knownId, !currentlyLiked, {
        title: track.title,
        artist: track.artist,
        album: track.album,
        durationMs: track.durationMs,
        coverUrl: coverUrl(track, true),
        spotifyUrl: knownId
          ? `https://open.spotify.com/track/${knownId}`
          : "",
      });
      return !currentlyLiked;
    }

    useToastStore.getState().push({
      kind: currentlyLiked ? "info" : "success",
      title: currentlyLiked
        ? "💔 Removed from Liked Songs"
        : "❤️ Added to Liked Songs",
      description: track.title,
    });
    return !currentlyLiked;
  },
}));
