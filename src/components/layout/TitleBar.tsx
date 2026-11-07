import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Square, X } from "lucide-react";
import { isDesktop } from "@/lib/api";
import { useNavigation } from "@/hooks/useNavigation";
import { usePlayerStore } from "@/store/playerStore";
import { cn } from "@/lib/cn";

function LogoMark() {
  return (
    <span className="relative flex h-[26px] w-[26px] items-center justify-center overflow-hidden rounded-[8px] bg-gradient-to-br from-[#ffcf70] via-[#ff9a3c] to-[#ff5e62] shadow-[0_2px_12px_rgba(255,154,60,.35)]">
      <span className="flex items-end gap-[2px]">
        {[8, 14, 10, 6].map((height, index) => (
          <span
            key={index}
            className="w-[2.5px] rounded-full bg-black/80"
            style={{ height }}
          />
        ))}
      </span>
    </span>
  );
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const api = window.electronAPI;

  useEffect(() => {
    if (!api) return;
    void api.window.isMaximized().then(setMaximized);
    return api.window.onMaximized(setMaximized);
  }, [api]);

  const action = (callback?: () => Promise<unknown> | undefined) => {
    void callback?.()?.catch(() => undefined);
  };

  return (
    <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
      <button
        type="button"
        className="titlebar-button"
        aria-label="Minimize"
        onClick={() => action(() => api?.window.minimize())}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="titlebar-button"
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => action(() => api?.window.toggleMaximize())}
      >
        <Square className={cn("h-3 w-3", maximized && "scale-90")} />
      </button>
      <button
        type="button"
        className="titlebar-button hover:!bg-red-500 hover:!text-white"
        aria-label="Close"
        onClick={() => action(() => api?.window.close())}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function HistoryControls() {
  const { canGoBack, canGoForward, goBack, goForward } = useNavigation();

  return (
    <div className="ml-1 flex items-center gap-0.5">
      <button
        type="button"
        aria-label="Back"
        title="Back (Alt+←)"
        onClick={goBack}
        disabled={!canGoBack}
        style={canGoBack ? undefined : { opacity: 0.3, pointerEvents: "none" }}
        className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full text-white/60 outline-none transition-[color,background-color,transform] duration-150 hover:bg-white/[0.08] hover:text-white active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/60 [-webkit-app-region:no-drag]"
      >
        <ChevronLeft className="h-[15px] w-[15px]" strokeWidth={2.2} />
      </button>
      <button
        type="button"
        aria-label="Forward"
        title="Forward (Alt+→)"
        onClick={goForward}
        disabled={!canGoForward}
        style={
          canGoForward ? undefined : { opacity: 0.3, pointerEvents: "none" }
        }
        className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full text-white/60 outline-none transition-[color,background-color,transform] duration-150 hover:bg-white/[0.08] hover:text-white active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/60 [-webkit-app-region:no-drag]"
      >
        <ChevronRight className="h-[15px] w-[15px]" strokeWidth={2.2} />
      </button>
    </div>
  );
}

export function TitleBar() {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);

  return (
    <>
    <header className="relative z-40 flex h-11 shrink-0 items-center justify-between px-3.5 select-none">
      <div
        className="absolute inset-0 z-0 [-webkit-app-region:drag]"
        onDoubleClick={() => {
          void window.electronAPI?.window.toggleMaximize().catch(() => undefined);
        }}
      />

      <div className="pointer-events-none relative z-10 flex items-center gap-2.5">
        <LogoMark />
        <div className="flex items-baseline gap-1">
          <span className="font-display text-[14px] font-extrabold tracking-tight text-white">
            Lyrics
          </span>
          <span className="font-display text-[14px] font-extrabold tracking-tight text-accent">
            +
          </span>
        </div>
        <HistoryControls />
        {!isDesktop && (
          <span
            className="ml-1 rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-amber-200/80"
            title="Browser preview — run npm run dev for the Electron desktop app"
          >
            Preview
          </span>
        )}
      </div>

      {currentTrack && (
        <div className="titlebar-track-info">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
              isPlaying ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.8)]" : "bg-white/25",
            )}
          />
          <span className="titlebar-track-text">
            {currentTrack.title}
            <span className="text-white/20"> — </span>
            {currentTrack.artist}
          </span>
        </div>
      )}

      <div className="relative z-10 flex items-center gap-2">
        <WindowControls />
      </div>
    </header>
    </>
  );
}

const resizeHandles = [
  { direction: "North", className: "left-2 right-2 top-0 h-1 cursor-n-resize" },
  { direction: "South", className: "bottom-0 left-2 right-2 h-1 cursor-s-resize" },
  { direction: "West", className: "bottom-2 left-0 top-2 w-1 cursor-w-resize" },
  { direction: "East", className: "bottom-2 right-0 top-2 w-1 cursor-e-resize" },
  { direction: "NorthWest", className: "left-0 top-0 h-2 w-2 cursor-nw-resize" },
  { direction: "NorthEast", className: "right-0 top-0 h-2 w-2 cursor-ne-resize" },
  { direction: "SouthWest", className: "bottom-0 left-0 h-2 w-2 cursor-sw-resize" },
  { direction: "SouthEast", className: "bottom-0 right-0 h-2 w-2 cursor-se-resize" },
] as const;

export function WindowResizeHandles() {
  useEffect(() => {
    if (!isDesktop) return;
    const end = () => {
      void window.electronAPI?.window.resizeEnd().catch(() => undefined);
    };
    window.addEventListener("mouseup", end);
    return () => window.removeEventListener("mouseup", end);
  }, []);

  if (!isDesktop) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]">
      {resizeHandles.map((handle) => (
        <div
          key={handle.direction}
          className={cn("pointer-events-auto absolute", handle.className)}
          onMouseDown={(event) => {
            event.preventDefault();
            void window.electronAPI?.window.resizeStart(handle.direction).catch(() => undefined);
          }}
        />
      ))}
    </div>
  );
}
