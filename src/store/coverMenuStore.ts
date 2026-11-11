import { create } from "zustand";

import type { CoverTarget } from "@/types";

interface CoverMenuState {
  open: boolean;
  target: CoverTarget | null;
  x: number;
  y: number;
  openMenu: (target: CoverTarget, x: number, y: number) => void;
  close: () => void;
}

export const useCoverMenuStore = create<CoverMenuState>((set) => ({
  open: false,
  target: null,
  x: 0,
  y: 0,

  openMenu: (target, x, y) => set({ open: true, target, x, y }),

  close: () => set({ open: false }),
}));
