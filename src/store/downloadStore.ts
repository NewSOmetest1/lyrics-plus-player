import { create } from "zustand";

import { backend } from "@/lib/api";
import type { DownloadRequest, DownloadSnapshot, DownloadTask } from "@/types";

const EMPTY: DownloadSnapshot = {
  tasks: [],
  activeCount: 0,
  completedCount: 0,
};

interface DownloadState {
  tasks: DownloadTask[];
  activeCount: number;
  completedCount: number;
  open: boolean;
  initialized: boolean;
  init: () => Promise<void>;
  applySnapshot: (snapshot: DownloadSnapshot) => void;
  start: (tracks: DownloadRequest[]) => Promise<DownloadSnapshot>;
  cancel: (taskId: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
  toggle: () => void;
  openDrawer: () => void;
  close: () => void;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  ...EMPTY,
  open: false,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    try {
      const snapshot = await backend.getDownloads();
      set({
        tasks: snapshot.tasks,
        activeCount: snapshot.activeCount,
        completedCount: snapshot.completedCount,
        initialized: true,
      });
    } catch (error) {
      set({ initialized: true });
      console.error("[downloads] initial load failed:", error);
    }
  },

  applySnapshot: (snapshot) =>
    set({
      tasks: snapshot.tasks,
      activeCount: snapshot.activeCount,
      completedCount: snapshot.completedCount,
    }),

  start: async (tracks) => {
    if (tracks.length === 0) return EMPTY;
    const snapshot = await backend.startDownloads(tracks);
    set({
      tasks: snapshot.tasks,
      activeCount: snapshot.activeCount,
      completedCount: snapshot.completedCount,
      open: true,
    });
    return snapshot;
  },

  cancel: async (taskId) => {
    const snapshot = await backend.cancelDownload(taskId);
    set({
      tasks: snapshot.tasks,
      activeCount: snapshot.activeCount,
      completedCount: snapshot.completedCount,
    });
  },

  clearCompleted: async () => {
    const snapshot = await backend.clearCompletedDownloads();
    set({
      tasks: snapshot.tasks,
      activeCount: snapshot.activeCount,
      completedCount: snapshot.completedCount,
    });
  },

  toggle: () => set({ open: !get().open }),
  openDrawer: () => set({ open: true }),
  close: () => set({ open: false }),
}));
