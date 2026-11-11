import { create } from "zustand";

import type {
  Playlist,
  SpotifyLikedTrackInput,
  Track,
} from "@/types";
import { LIKED_PLAYLIST_ID, LIKED_PLAYLIST_NAME } from "@/types";
import { backend, coverUrl } from "@/lib/api";
import {
  isSpotifyId,
  normalizeTrackPath,
  spotifyIdFromUrl,
} from "@/lib/trackPath";
import { useSettingsStore } from "@/store/settingsStore";
import {
  spotifyLikeKey,
  useSpotifyLikedStore,
} from "@/store/spotifyLikedStore";
import { useToastStore } from "@/store/toastStore";

export { normalizeTrackPath } from "@/lib/trackPath";

export interface SetLikeOptions {
  trackId?: string | null;
  liked: boolean;
  localPath?: string | null;
  input?: SpotifyLikedTrackInput | null;
  /** Force the Spotify write even when the Liked Songs source is local. */
  spotify?: boolean;
  title?: string;
}

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
  /** Optimistic, coalesced heart handler used by every like control. */
  setLike: (options: SetLikeOptions) => Promise<boolean>;
  toggleLike: (track: Track) => Promise<boolean>;
}

interface LocalTransaction {
  version: number;
  baseline: boolean;
}

const localTransactions = new Map<string, LocalTransaction>();
const likeActions = new Map<string, { version: number; baseline: boolean }>();
const desiredMembership = new Map<string, boolean>();

function reportError(error: unknown): void {
  useToastStore.getState().push({
    kind: "error",
    title: "Playlist operation failed",
    description: String(error),
  });
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

/** Synchronous heart/Liked Songs update with no disk or network wait. */
function applyLikedMembership(
  playlists: Playlist[],
  trackPath: string,
  liked: boolean,
): Playlist[] {
  const normalized = normalizeTrackPath(trackPath);
  if (!normalized) return playlists;
  const existing = playlists.find(
    (playlist) => playlist.id === LIKED_PLAYLIST_ID,
  );
  const likedPlaylist: Playlist =
    existing ?? {
      id: LIKED_PLAYLIST_ID,
      name: LIKED_PLAYLIST_NAME,
      description: "Your favorite tracks",
      trackPaths: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  const hasTrack = likedPlaylist.trackPaths.some(
    (path) => normalizeTrackPath(path) === normalized,
  );
  if (hasTrack === liked) return playlists;

  const trackPaths = liked
    ? [normalized, ...likedPlaylist.trackPaths.filter(
        (path) => normalizeTrackPath(path) !== normalized,
      )]
    : likedPlaylist.trackPaths.filter(
        (path) => normalizeTrackPath(path) !== normalized,
      );

  const nextLiked: Playlist = {
    ...likedPlaylist,
    trackPaths,
    updatedAt: Date.now(),
  };
  return existing
    ? playlists.map((playlist) =>
        playlist.id === LIKED_PLAYLIST_ID ? nextLiked : playlist,
      )
    : [nextLiked, ...playlists];
}

/** Reactive selector: returns true only when this exact track is liked. */
export function useIsLiked(trackPath: string | null | undefined): boolean {
  const local = usePlaylistStore((state) =>
    trackPath ? state.likedPaths.has(normalizeTrackPath(trackPath)) : false,
  );
  const spotify = useSpotifyLikedStore((state) =>
    trackPath ? state.likedPaths.has(normalizeTrackPath(trackPath)) : false,
  );
  const source = useSettingsStore((state) => state.likedSongsSource);
  return source === "spotify" ? local || spotify : local;
}

async function persistMembership(
  trackPath: string,
  liked: boolean,
  version: number,
): Promise<boolean> {
  const path = normalizeTrackPath(trackPath);
  desiredMembership.set(path, liked);
  try {
    const result = await backend.setLikedPlaylistTrack(trackPath, liked);
    if (desiredMembership.get(path) !== liked) return true;
    usePlaylistStore.setState((state) => {
      const exists = state.playlists.some(
        (playlist) => playlist.id === LIKED_PLAYLIST_ID,
      );
      return playlistPatch(
        exists
          ? state.playlists.map((playlist) =>
              playlist.id === LIKED_PLAYLIST_ID
                ? result.playlist
                : playlist,
            )
          : [result.playlist, ...state.playlists],
      );
    });
    return true;
  } catch (error) {
    if (
      desiredMembership.get(path) === liked &&
      (localTransactions.get(path)?.version ?? version) === version
    ) {
      reportError(error);
    }
    return false;
  }
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

  setLike: async (options) => {
    const liked = options.liked;
    const path = options.localPath?.trim()
      ? normalizeTrackPath(options.localPath)
      : null;
    const input = options.input ?? null;
    const source = useSettingsStore.getState().likedSongsSource;
    const spotifyEnabled = options.spotify ?? source === "spotify";
    const spotify = useSpotifyLikedStore.getState();
    const key = spotifyLikeKey(options.trackId ?? "", path, input);

    const spotifyItem = path ? spotify.itemForPath(path) : null;
    const idFromInput = spotifyIdFromUrl(input?.spotifyUrl ?? null);
    const spotifyWasLiked = Boolean(
      (isSpotifyId(options.trackId) && spotify.likedIds.has(options.trackId!.trim())) ||
        (spotifyItem && spotify.likedIds.has(spotifyItem.id)) ||
        (idFromInput && spotify.likedIds.has(idFromInput)),
    );
    const localWasLiked = path ? get().likedPaths.has(path) : false;
    const baseline = spotifyEnabled
      ? spotifyWasLiked || localWasLiked
      : localWasLiked;

    let action = likeActions.get(key);
    if (!action) {
      action = { version: 0, baseline };
      likeActions.set(key, action);
    }
    action.version += 1;
    const version = action.version;
    const isLatest = () => likeActions.get(key)?.version === version;

    let localVersion = 0;
    if (path) {
      let transaction = localTransactions.get(path);
      if (!transaction) {
        transaction = { version: 0, baseline: localWasLiked };
        localTransactions.set(path, transaction);
      }
      transaction.version += 1;
      localVersion = transaction.version;
      set((state) => ({
        ...playlistPatch(
          applyLikedMembership(state.playlists, path, liked),
        ),
      }));
    }

    if (!spotifyEnabled) {
      const localOk = path
        ? await persistMembership(path, liked, localVersion)
        : true;
      if (!localOk && path) {
        const transaction = localTransactions.get(path);
        if (transaction && transaction.version === localVersion) {
          set((state) => ({
            ...playlistPatch(
              applyLikedMembership(state.playlists, path, transaction.baseline),
            ),
          }));
          localTransactions.delete(path);
        }
      }
      if (isLatest()) {
        if (localOk && liked !== action.baseline) {
          useToastStore.getState().push({
            kind: liked ? "success" : "info",
            title: liked
              ? "❤️ Added to Liked Songs"
              : "💔 Removed from Liked Songs",
            description: options.title ?? input?.title ?? "",
          });
        }
        likeActions.delete(key);
      }
      return localOk;
    }

    spotify.applyOptimistic({
      trackId: options.trackId ?? "",
      liked,
      input,
      localPath: path,
    });
    const localPersist = path
      ? persistMembership(path, liked, localVersion)
      : Promise.resolve(true);
    const spotifyOk = await spotify.requestNetwork(key, {
      trackId: options.trackId ?? "",
      liked,
      input,
      localPath: path,
    });
    const localOk = await localPersist;

    if (!spotifyOk && path) {
      const transaction = localTransactions.get(path);
      if (transaction && transaction.version === localVersion) {
        set((state) => ({
          ...playlistPatch(
            applyLikedMembership(state.playlists, path, transaction.baseline),
          ),
        }));
        void persistMembership(path, transaction.baseline, transaction.version);
        localTransactions.delete(path);
      }
    } else if (spotifyOk && path) {
      const transaction = localTransactions.get(path);
      if (transaction && transaction.version === localVersion) {
        localTransactions.delete(path);
      }
    }

    if (isLatest()) {
      if (spotifyOk && liked !== action.baseline) {
        useToastStore.getState().push({
          kind: liked ? "success" : "info",
          title: liked
            ? "❤️ Saved to Spotify profile"
            : "💔 Removed from Spotify profile",
          description: options.title ?? input?.title ?? "",
        });
      }
      likeActions.delete(key);
    }

    return spotifyOk && localOk;
  },

  toggleLike: async (track) => {
    const trackPath = track.path?.trim();
    if (!trackPath) return false;

    const source = useSettingsStore.getState().likedSongsSource;
    const spotify = useSpotifyLikedStore.getState();
    const spotifyItem = spotify.itemForPath(trackPath);
    const knownId =
      spotifyItem?.id ??
      (isSpotifyId(track.spotifyTrackId) ? track.spotifyTrackId! : "");
    const currentLiked =
      get().likedPaths.has(normalizeTrackPath(trackPath)) ||
      (source === "spotify" && Boolean(spotifyItem));

    return get().setLike({
      trackId: knownId,
      liked: !currentLiked,
      localPath: trackPath,
      title: track.title,
      input: {
        title: track.title,
        artist: track.artist,
        album: track.album,
        durationMs: track.durationMs,
        coverUrl: coverUrl(track, true),
        spotifyUrl: knownId
          ? `https://open.spotify.com/track/${knownId}`
          : "",
        localPath: trackPath,
      },
    });
  },
}));
