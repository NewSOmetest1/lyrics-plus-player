import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpDown, Check } from "lucide-react";

import { cn } from "@/lib/cn";
import {
  TRACK_SORT_OPTIONS,
  type TrackSortKey,
} from "@/hooks/useTrackSorting";

interface SortDropdownProps {
  mode: TrackSortKey;
  reverse: boolean;
  onModeChange: (mode: TrackSortKey) => void;
  onReverseChange: (reverse: boolean) => void;
  className?: string;
  align?: "left" | "right";
}

interface MenuPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

/** Shared glass sort menu used by Liked Songs, playlists and search. */
export function SortDropdown({
  mode,
  reverse,
  onModeChange,
  onReverseChange,
  className,
  align = "right",
}: SortDropdownProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 230;
    const margin = 8;
    const expectedHeight = 296;
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openAbove = spaceBelow < expectedHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      180,
      Math.min(360, openAbove ? spaceAbove : spaceBelow),
    );
    const preferredLeft =
      align === "right" ? rect.right - width : rect.left;
    setPosition({
      left: Math.max(
        margin,
        Math.min(preferredLeft, window.innerWidth - width - margin),
      ),
      top: openAbove
        ? Math.max(margin, rect.top - maxHeight - 6)
        : rect.bottom + 6,
      width,
      maxHeight,
    });
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const activeLabel =
    TRACK_SORT_OPTIONS.find((option) => option.id === mode)?.label ?? "Default";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Sort by: ${activeLabel}${reverse ? " · reversed" : ""}`}
        className={cn(
          "flex h-9 items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.05] px-4 text-[11.5px] font-semibold text-white/60 outline-none transition hover:bg-white/[0.09] hover:text-white focus-visible:ring-2 focus-visible:ring-accent/60",
          mode !== "default" && "border-accent/25 bg-accent/[0.08] text-accent/90",
          className,
        )}
      >
        <ArrowUpDown className="h-3.5 w-3.5" />
        Sort by…
        {mode !== "default" && (
          <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.02em] text-accent">
            {activeLabel.replace(/\s*\(.*\)$/, "")}
            {reverse ? " ↓" : ""}
          </span>
        )}
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Sort tracks"
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
            className="dropdown-menu fixed z-[190] overflow-y-auto rounded-xl border border-white/10 bg-[#141419]/92 p-1 shadow-glass backdrop-blur-[22px]"
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[8.5px] font-bold uppercase tracking-[0.2em] text-white/20">
              Sort by
            </p>
            {TRACK_SORT_OPTIONS.map((option) => {
              const active = option.id === mode;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    onModeChange(option.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11.5px] font-medium transition",
                    active
                      ? "bg-accent/[0.12] text-accent"
                      : "text-white/65 hover:bg-white/[0.07] hover:text-white",
                  )}
                >
                  <span className="flex h-3.5 w-3.5 items-center justify-center">
                    {active && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </button>
              );
            })}

            <div className="mx-1 my-1 h-px bg-white/[0.07]" />

            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={reverse}
              onClick={() => onReverseChange(!reverse)}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11.5px] font-medium text-white/65 transition hover:bg-white/[0.07] hover:text-white"
            >
              <span
                className={cn(
                  "flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border transition",
                  reverse
                    ? "border-accent bg-accent text-black"
                    : "border-white/20 bg-white/[0.03]",
                )}
              >
                {reverse && <Check className="h-2.5 w-2.5" />}
              </span>
              Reverse order
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
