import { create } from "zustand";

import type { Playlist } from "@/types";
import { backend } from "@/lib/api";
import { useToastStore } from "@/store/toastStore";

interface PlaylistState {
  playlists: Playlist[];
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
}

function reportError(error: unknown): void {
  useToastStore.getState().push({
    kind: "error",
    title: "Playlist operation failed",
    description: String(error),
  });
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  playlists: [],
  loaded: false,
  loading: false,

  init: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const playlists = await backend.getPlaylists();
      set({ playlists, loaded: true, loading: false });
    } catch (error) {
      set({ loaded: true, loading: false });
      reportError(error);
    }
  },

  create: async (input) => {
    try {
      const playlist = await backend.createPlaylist(input);
      set((state) => ({
        playlists: [playlist, ...state.playlists.filter((item) => item.id !== playlist.id)],
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
        playlists: [playlist, ...state.playlists.filter((item) => item.id !== id)],
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
          playlists: state.playlists.filter((playlist) => playlist.id !== id),
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
          playlists: [
            result.playlist,
            ...state.playlists.filter((playlist) => playlist.id !== playlistId),
          ],
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
          playlists: state.playlists.map((playlist) =>
            playlist.id === playlistId ? result.playlist : playlist,
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
          playlists: [playlist, ...state.playlists.filter((item) => item.id !== playlist.id)],
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
    const existing = get().playlists.find(
      (playlist) => playlist.name.trim().toLowerCase() === "liked songs",
    );
    if (existing) return existing;
    const playlist = await get().create({
      name: "Liked Songs",
      description: "Tracks you love",
    });
    return playlist;
  },
}));
