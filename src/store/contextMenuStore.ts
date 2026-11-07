import { create } from "zustand";

import type { Track } from "@/types";

interface TrackContextMenuState {
  open: boolean;
  track: Track | null;
  x: number;
  y: number;
  playlistId: string | null;
  playlistName: string | null;
  openMenu: (
    track: Track,
    x: number,
    y: number,
    playlist?: { id: string; name: string },
  ) => void;
  close: () => void;
}

export const useTrackMenuStore = create<TrackContextMenuState>((set) => ({
  open: false,
  track: null,
  x: 0,
  y: 0,
  playlistId: null,
  playlistName: null,

  openMenu: (track, x, y, playlist) =>
    set({
      open: true,
      track,
      x,
      y,
      playlistId: playlist?.id ?? null,
      playlistName: playlist?.name ?? null,
    }),

  close: () => set({ open: false }),
}));
