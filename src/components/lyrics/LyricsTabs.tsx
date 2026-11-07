import { Fragment } from "react";
import { motion } from "framer-motion";
import type { LyricsMode } from "@/types";
import { cn } from "@/lib/cn";

interface LyricsTabsProps {
  mode: LyricsMode;
  synced: boolean;
  onChange: (mode: LyricsMode) => void;
}

const tabs: { id: LyricsMode; label: string }[] = [
  { id: "karaoke", label: "Karaoke" },
  { id: "synced", label: "Synced" },
  { id: "unsynced", label: "Unsynced" },
];

export function LyricsTabs({ mode, synced, onChange }: LyricsTabsProps) {
  return (
    <div className="flex items-center justify-center gap-0.5">
      {tabs.map((tab, index) => {
        const active = mode === tab.id;
        const disabled = !synced && tab.id !== "unsynced";
        return (
          <Fragment key={tab.id}>
            {index > 0 && <span className="px-0.5 text-[9px] text-white/15">•</span>}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(tab.id)}
              title={disabled ? "No synced lyrics for this track" : `Switch to ${tab.label}`}
              className={cn(
                "relative rounded-full px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.18em] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent/60",
                active ? "text-white" : "text-white/30 hover:text-white/60",
                disabled && "cursor-not-allowed opacity-25 hover:text-white/30",
              )}
            >
              {tab.label}
              {active && (
                <motion.span
                  layoutId="lyrics-tab-underline"
                  className="absolute inset-x-3 -bottom-[3px] h-[2px] rounded-full bg-accent shadow-[0_0_12px_var(--accent-glow)]"
                  transition={{ type: "spring", stiffness: 480, damping: 38 }}
                />
              )}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
