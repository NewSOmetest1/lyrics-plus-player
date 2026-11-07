import { create } from "zustand";

import type { Playlist } from "@/types";

type PlaylistDialogMode = "create" | "rename";

interface PlaylistDialogState {
  open: boolean;
  mode: PlaylistDialogMode;
  playlistId: string | null;
  initialName: string;
  initialDescription: string;
  pendingTrackPath: string | null;
  openCreate: (pendingTrackPath?: string) => void;
  openRename: (playlist: Playlist) => void;
  close: () => void;
}

export const usePlaylistDialogStore = create<PlaylistDialogState>((set) => ({
  open: false,
  mode: "create",
  playlistId: null,
  initialName: "",
  initialDescription: "",
  pendingTrackPath: null,

  openCreate: (pendingTrackPath) =>
    set({
      open: true,
      mode: "create",
      playlistId: null,
      initialName: "",
      initialDescription: "",
      pendingTrackPath: pendingTrackPath ?? null,
    }),

  openRename: (playlist) =>
    set({
      open: true,
      mode: "rename",
      playlistId: playlist.id,
      initialName: playlist.name,
      initialDescription: playlist.description ?? "",
      pendingTrackPath: null,
    }),

  close: () =>
    set({
      open: false,
      pendingTrackPath: null,
    }),
}));
