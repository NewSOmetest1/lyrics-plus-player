import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  Disc3,
  Download,
  FolderOpen,
  Loader2,
  Music2,
  Save,
  Sparkles,
} from "lucide-react";

import type { CoverQuality } from "@/types";
import { cn } from "@/lib/cn";
import { backend } from "@/lib/api";
import { useCoverMenuStore } from "@/store/coverMenuStore";
import { useToastStore } from "@/store/toastStore";

const MENU_WIDTH = 252;
const SUBMENU_WIDTH = 232;

const QUALITY_OPTIONS: Array<{
  id: CoverQuality;
  label: string;
  hint: string;
  icon: React.ReactNode;
  spotifyOnly?: boolean;
}> = [
  {
    id: "max",
    label: "Максимум",
    hint: "лучший источник, до 3000 px",
    icon: <Sparkles className="h-3.5 w-3.5" />,
  },
  {
    id: "spotify",
    label: "Spotify 2000",
    hint: "оригинал Spotify",
    icon: <Music2 className="h-3.5 w-3.5" />,
    spotifyOnly: true,
  },
  {
    id: "deezer",
    label: "Deezer 1500",
    hint: "CDN Deezer",
    icon: <Disc3 className="h-3.5 w-3.5" />,
  },
  {
    id: "640",
    label: "640",
    hint: "стандартный размер",
    icon: <Download className="h-3.5 w-3.5" />,
    spotifyOnly: true,
  },
];

function MenuItem({
  icon,
  label,
  hint,
  onClick,
  trailing,
  onMouseEnter,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  trailing?: React.ReactNode;
  onMouseEnter?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-8 w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-left text-[11.5px] font-medium text-white/65 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.09] disabled:pointer-events-none disabled:opacity-40"
    >
      <span className="shrink-0 text-white/35">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && (
          <span className="block truncate text-[9.5px] font-normal text-white/25">
            {hint}
          </span>
        )}
      </span>
      {trailing}
    </button>
  );
}

export function CoverContextMenu() {
  const open = useCoverMenuStore((state) => state.open);
  const target = useCoverMenuStore((state) => state.target);
  const x = useCoverMenuStore((state) => state.x);
  const y = useCoverMenuStore((state) => state.y);
  const close = useCoverMenuStore((state) => state.close);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    if (!open) return;
    const height = menuRef.current?.offsetHeight ?? 240;
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [open, x, y]);

  useEffect(() => {
    if (!open) {
      setSubmenuOpen(false);
      setBusy(false);
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onScroll = () => close();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close]);

  if (!target) return null;

  const options = target.spotifyImageUrl
    ? QUALITY_OPTIONS
    : QUALITY_OPTIONS.filter((option) => !option.spotifyOnly);

  const runDownload = async (
    quality: CoverQuality,
    saveAs = false,
  ): Promise<void> => {
    if (!target || busy) return;
    setBusy(true);
    close();

    const toasts = useToastStore.getState();
    const pending = saveAs
      ? null
      : toasts.push({
          kind: "info",
          title: "Скачиваю обложку…",
          description: `${target.artist} — ${target.album}`,
        });

    try {
      const result = await backend.downloadCover({ target, quality, saveAs });
      if (pending !== null) toasts.dismiss(pending);
      if (result.canceled) return;
      toasts.push({
        kind: "success",
        title: "Обложка сохранена",
        description: `${result.width}×${result.height} · ${result.source} · ${result.displayPath}`,
      });
    } catch (error) {
      if (pending !== null) toasts.dismiss(pending);
      toasts.push({
        kind: "error",
        title: "Не удалось скачать обложку",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const openFolder = async (): Promise<void> => {
    close();
    try {
      await backend.openCoverFolder();
    } catch (error) {
      useToastStore.getState().push({
        kind: "error",
        title: "Не удалось открыть папку",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const submenuSide =
    position.left + MENU_WIDTH + SUBMENU_WIDTH + 12 > window.innerWidth
      ? "right"
      : "left";
  const submenuBelow = position.top + 40 + 218 < window.innerHeight - 8;

  return createPortal(
    <AnimatePresence>
      {open && (
      <motion.div
        key="cover-context-menu"
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.96, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
        style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
        className="context-menu fixed z-[170] rounded-xl border border-white/10 bg-[#141419]/85 p-1 shadow-glass backdrop-blur-[20px]"
        role="menu"
        aria-label={`Обложка: ${target.artist} — ${target.album}`}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#450af5]/55 to-[#8e8ee8]/35">
            <Disc3 className="h-3.5 w-3.5 text-white/70" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-semibold text-white/75">
              {target.album || "Обложка"}
            </span>
            <span className="block truncate text-[9.5px] text-white/30">
              {target.artist || "Unknown artist"}
            </span>
          </span>
        </div>

        <div className="my-1 h-px bg-white/[0.07]" />

        <div
          className="relative"
          onMouseEnter={() => setSubmenuOpen(true)}
          onMouseLeave={() => setSubmenuOpen(false)}
        >
          <MenuItem
            icon={<Download className="h-3.5 w-3.5" />}
            label="Скачать обложку"
            hint="сохранить в ~/Covers"
            onClick={() => setSubmenuOpen((value) => !value)}
            trailing={
              <ChevronRight
                className={cn(
                  "h-3 w-3 shrink-0 text-white/25 transition-transform",
                  submenuOpen && "translate-x-0.5",
                )}
              />
            }
          />

          <AnimatePresence>
            {submenuOpen && (
              <motion.div
                initial={{ opacity: 0, x: submenuSide === "left" ? -4 : 4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                style={{ width: SUBMENU_WIDTH }}
                className={cn(
                  "context-menu absolute z-10 rounded-xl border border-white/10 bg-[#16161c]/92 p-1 shadow-glass backdrop-blur-[20px]",
                  submenuBelow ? "top-0" : "bottom-0",
                  submenuSide === "left" ? "left-full ml-1" : "right-full mr-1",
                )}
                role="menu"
                aria-label="Качество обложки"
              >
                {options.map((option) => (
                  <MenuItem
                    key={option.id}
                    icon={option.icon}
                    label={option.label}
                    hint={option.hint}
                    disabled={busy}
                    onClick={() => void runDownload(option.id)}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="my-1 h-px bg-white/[0.07]" />

        <MenuItem
          icon={<Save className="h-3.5 w-3.5" />}
          label="Сохранить как…"
          hint="выбрать папку и имя"
          disabled={busy}
          onClick={() => void runDownload("max", true)}
        />
        <MenuItem
          icon={<FolderOpen className="h-3.5 w-3.5" />}
          label="Открыть папку обложек"
          disabled={busy}
          onClick={() => void openFolder()}
        />

        {busy && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/35 backdrop-blur-[1px]">
            <Loader2 className="h-4 w-4 animate-spin text-white/70" />
          </div>
        )}
      </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
