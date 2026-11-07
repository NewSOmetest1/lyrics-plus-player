import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePlayerStore } from "@/store/playerStore";
import { usePlaylistStore } from "@/store/playlistStore";
import { subscribePlayback } from "@/lib/api";
import { useNavigation } from "@/hooks/useNavigation";
import { useSettingsStore } from "@/store/settingsStore";
import { useLucidSettingsStore } from "@/store/lucidSettingsStore";
import {
  TRACK_DELAY_STEP,
  announceTrackDelay,
  useTrackDelayStore,
} from "@/store/trackDelayStore";
import { useSystemIntegration } from "@/hooks/useSystemIntegration";
import { cn } from "@/lib/cn";
import { AmbientBackground } from "@/components/background/AmbientBackground";
import { TitleBar, WindowResizeHandles } from "@/components/layout/TitleBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { LibraryView } from "@/components/library/LibraryView";
import { ArtistDetailView } from "@/components/artists/ArtistDetailView";
import { PlaylistView } from "@/components/playlists/PlaylistView";
import { StatsView } from "@/components/stats/StatsView";
import { PlaylistDialog } from "@/components/playlists/PlaylistDialog";
import { TrackContextMenu } from "@/components/playlists/TrackContextMenu";
import { LucidSettingsDialog } from "@/components/settings/LucidSettingsDialog";
import { NowPlayingView } from "@/components/player/NowPlayingView";
import { NowPlayingPanel } from "@/components/player/NowPlayingPanel";
import { PlayerBar } from "@/components/player/PlayerBar";
import { QueuePanel } from "@/components/player/QueuePanel";
import { Toaster } from "@/components/ui/Toaster";

const EASE = [0.2, 0, 0, 1] as const;

const SIDEBAR_WIDTH_KEY = "lyricsplus.sidebarWidth";
const RIGHT_PANEL_WIDTH_KEY = "lyricsplus.rightPanelWidth";
const LEFT_COLLAPSED_KEY = "lyricsplus.leftCollapsed";
const RIGHT_OPEN_KEY = "lyricsplus.rightOpen";
const SIDEBAR_LIMITS = {
  min: 160,
  max: 420,
  default: 280,
  collapsed: 72,
  snap: 160,
};
const RIGHT_PANEL_LIMITS = {
  min: 160,
  max: 480,
  default: 318,
  snap: 160,
  restore: 320,
};

function readStoredWidth(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  try {
    const parsed = Number.parseFloat(window.localStorage.getItem(key) ?? "");
    if (Number.isFinite(parsed)) return Math.min(max, Math.max(min, parsed));
  } catch {
    // Private mode / disabled storage: fall back to the default width.
  }
  return fallback;
}

function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Persisting layout is best-effort.
  }
}

function PanelResizeHandle({
  side,
  width,
  min,
  max,
  onResize,
  onDraggingChange,
  className,
}: {
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onDraggingChange: (dragging: boolean) => void;
  className?: string;
}) {
  const latest = useRef(width);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    latest.current = width;
  }, [width]);

  useEffect(
    () => () => {
      cleanup.current?.();
    },
    [],
  );

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    let frame = 0;

    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const raw = side === "left" ? startWidth + delta : startWidth - delta;
      const next = Math.min(max, Math.max(min, Math.round(raw)));
      latest.current = next;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => onResize(next));
    };

    const finish = () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      document.body.classList.remove("is-resizing");
      onDraggingChange(false);
      cleanup.current = null;
    };

    cleanup.current = finish;
    document.body.classList.add("is-resizing");
    onDraggingChange(true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
  };

  const nudge = (delta: number) => {
    const next = Math.min(max, Math.max(min, latest.current + delta));
    latest.current = next;
    onResize(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side === "left" ? "library" : "now playing"} panel`}
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          nudge(side === "left" ? -12 : 12);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          nudge(side === "left" ? 12 : -12);
        }
      }}
      className={cn(
        "panel-resize-handle group relative w-[5px] shrink-0 cursor-col-resize touch-none items-center justify-center rounded-full outline-none transition-colors focus-visible:bg-white/[0.06]",
        className,
      )}
    >
      <span className="pointer-events-none h-10 w-[2px] rounded-full bg-white/[0.07] transition-colors duration-200 group-hover:bg-accent/70 group-focus-visible:bg-accent/70" />
    </div>
  );
}

function RightEdgeHandle({ onOpen }: { onOpen: () => void }) {
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanup.current?.();
    },
    [],
  );

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    let opened = false;
    const controller = new AbortController();

    const finish = () => {
      controller.abort();
      document.body.classList.remove("is-resizing");
      cleanup.current = null;
    };

    const move = (moveEvent: PointerEvent) => {
      if (opened) return;
      if (startX - moveEvent.clientX >= 8) {
        opened = true;
        finish();
        onOpen();
      }
    };

    cleanup.current = finish;
    document.body.classList.add("is-resizing");
    window.addEventListener("pointermove", move, { signal: controller.signal });
    window.addEventListener("pointerup", finish, { signal: controller.signal });
    window.addEventListener("pointercancel", finish, { signal: controller.signal });
    window.addEventListener("blur", finish, { signal: controller.signal });
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Open Now Playing panel"
      title="Drag left to open Now Playing"
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" ||
          event.key === " " ||
          event.key === "ArrowLeft"
        ) {
          event.preventDefault();
          onOpen();
        }
      }}
      className="panel-edge-handle group absolute inset-y-0 right-0 z-40 hidden w-2 cursor-col-resize touch-none outline-none lg:block"
    >
      <span className="pointer-events-none absolute right-0 top-1/2 h-16 w-[2px] -translate-y-1/2 rounded-full bg-accent/0 transition-colors duration-200 group-hover:bg-accent/70 group-focus-visible:bg-accent/70" />
    </div>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select") ||
      target.isContentEditable ||
      target.closest("[contenteditable='true']"),
  );
}

export default function App() {
  const view = usePlayerStore((state) => state.view);
  const selectedPlaylistId = usePlayerStore((state) => state.selectedPlaylistId);
  const selectedArtistName = usePlayerStore((state) => state.selectedArtistName);
  const focusMode = usePlayerStore((state) => state.focusMode);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredWidth(
      SIDEBAR_WIDTH_KEY,
      SIDEBAR_LIMITS.default,
      SIDEBAR_LIMITS.min,
      SIDEBAR_LIMITS.max,
    ),
  );
  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    readStoredWidth(
      RIGHT_PANEL_WIDTH_KEY,
      RIGHT_PANEL_LIMITS.default,
      RIGHT_PANEL_LIMITS.min,
      RIGHT_PANEL_LIMITS.max,
    ),
  );
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(() =>
    readStoredBool(LEFT_COLLAPSED_KEY, false),
  );
  const [isRightOpen, setIsRightOpen] = useState(() =>
    readStoredBool(RIGHT_OPEN_KEY, true),
  );
  const [libraryPeek, setLibraryPeek] = useState(false);
  const [resizingPanel, setResizingPanel] = useState<"left" | "right" | null>(null);
  const autoHideLibrary = useLucidSettingsStore((state) => state.autoHideLibrary);
  const lastHardwareNavigation = useRef<{
    direction: "back" | "forward";
    source: "mouse" | "ipc";
    at: number;
  }>({ direction: "back", source: "ipc", at: Number.NEGATIVE_INFINITY });
  const { goBack, goForward } = useNavigation();
  useSystemIntegration();

  const effectiveSidebarWidth = isLeftCollapsed
    ? SIDEBAR_LIMITS.collapsed
    : sidebarWidth;

  const sidebarRenderWidth = autoHideLibrary
    ? libraryPeek
      ? Math.max(sidebarWidth, 240)
      : 0
    : effectiveSidebarWidth;

  useEffect(() => {
    setLibraryPeek(false);
  }, [autoHideLibrary]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => writeStored(SIDEBAR_WIDTH_KEY, String(sidebarWidth)),
      180,
    );
    return () => window.clearTimeout(timer);
  }, [sidebarWidth]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => writeStored(RIGHT_PANEL_WIDTH_KEY, String(rightPanelWidth)),
      180,
    );
    return () => window.clearTimeout(timer);
  }, [rightPanelWidth]);

  useEffect(() => {
    writeStored(LEFT_COLLAPSED_KEY, isLeftCollapsed ? "1" : "0");
  }, [isLeftCollapsed]);

  useEffect(() => {
    writeStored(RIGHT_OPEN_KEY, isRightOpen ? "1" : "0");
  }, [isRightOpen]);

  const handleSidebarResize = (next: number) => {
    if (next <= SIDEBAR_LIMITS.snap) {
      setIsLeftCollapsed(true);
      return;
    }
    setIsLeftCollapsed(false);
    setSidebarWidth(
      Math.min(SIDEBAR_LIMITS.max, Math.max(SIDEBAR_LIMITS.min, next)),
    );
  };

  const handleRightPanelResize = (next: number) => {
    if (next <= RIGHT_PANEL_LIMITS.snap) {
      setIsRightOpen(false);
      return;
    }
    setIsRightOpen(true);
    setRightPanelWidth(
      Math.min(RIGHT_PANEL_LIMITS.max, Math.max(RIGHT_PANEL_LIMITS.min, next)),
    );
  };

  const rightPanelVisible = isRightOpen && view === "player" && !focusMode;

  const openRightPanel = () => {
    const store = usePlayerStore.getState();
    if (store.focusMode) store.toggleFocus();
    if (store.view !== "player") store.setView("player");
    setRightPanelWidth((width) =>
      width < 200 ? RIGHT_PANEL_LIMITS.restore : width,
    );
    setIsRightOpen(true);
  };

  const toggleRightPanel = () => {
    if (rightPanelVisible) {
      setIsRightOpen(false);
      return;
    }
    openRightPanel();
  };

  useEffect(() => {
    void usePlayerStore.getState().init();
    void useSettingsStore.getState().init();
    void useTrackDelayStore.getState().init();
    void usePlaylistStore.getState().init();
    useLucidSettingsStore.getState().init();
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void subscribePlayback({
      onPosition: (snapshot) => usePlayerStore.getState().handlePosition(snapshot),
      onEnded: () => usePlayerStore.getState().handleEnded(),
      onScanProgress: (progress) =>
        usePlayerStore.getState().handleScanProgress(progress),
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const stepHistory = (direction: "back" | "forward", source: "mouse" | "ipc") => {
      const now = performance.now();
      const last = lastHardwareNavigation.current;
      if (
        last.source !== source &&
        last.direction === direction &&
        now - last.at < 300
      ) {
        return;
      }
      lastHardwareNavigation.current = { direction, source, at: now };
      if (direction === "back") goBack();
      else goForward();
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        event.stopPropagation();
        stepHistory("back", "mouse");
      } else if (event.button === 4) {
        event.preventDefault();
        event.stopPropagation();
        stepHistory("forward", "mouse");
      }
    };

    const unlistenBack = window.electronAPI?.on("nav:back", () =>
      stepHistory("back", "ipc"),
    );
    const unlistenForward = window.electronAPI?.on("nav:forward", () =>
      stepHistory("forward", "ipc"),
    );

    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
      unlistenBack?.();
      unlistenForward?.();
    };
  }, [goBack, goForward]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const store = usePlayerStore.getState();

      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          store.goBack();
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          store.goForward();
          return;
        }
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "f"
      ) {
        if (store.view === "player") {
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("lyricsplus:lyrics-search"));
        }
        return;
      }

      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const step = event.shiftKey ? 15_000 : 5_000;

      switch (event.key) {
        case " ":
          event.preventDefault();
          void store.togglePlay();
          break;
        case "ArrowLeft":
          event.preventDefault();
          store.seek(store.positionMs - step);
          break;
        case "ArrowRight":
          event.preventDefault();
          store.seek(store.positionMs + step);
          break;
        case "ArrowUp":
          event.preventDefault();
          store.setVolume(store.volume + 0.05);
          break;
        case "ArrowDown":
          event.preventDefault();
          store.setVolume(store.volume - 0.05);
          break;
        case "n":
        case "N":
          void store.next();
          break;
        case "p":
        case "P":
          void store.prev();
          break;
        case "m":
        case "M":
          store.toggleMute();
          break;
        case "f":
        case "F":
          store.toggleFocus();
          break;
        case "q":
        case "Q":
          store.toggleQueue();
          break;
        case "l":
        case "L":
          store.setView(store.view === "library" ? "player" : "library");
          break;
        case "/":
          event.preventDefault();
          store.setView("library");
          window.dispatchEvent(new CustomEvent("lyricsplus:focus-search"));
          break;
        case "[":
        case "]": {
          if (store.view !== "player" || !store.currentTrack) break;
          event.preventDefault();
          const delta = event.key === "[" ? -TRACK_DELAY_STEP : TRACK_DELAY_STEP;
          const nextDelay = useTrackDelayStore
            .getState()
            .adjustDelay(store.currentTrack.path, delta);
          announceTrackDelay(nextDelay);
          break;
        }
        case "Escape":
          if (store.queueOpen) store.toggleQueue();
          else if (store.focusMode) store.toggleFocus();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden text-white">
      <AmbientBackground />
      <TitleBar />

      <div className="lucid-app-content relative z-10 flex min-h-0 flex-1 gap-2 px-3 pb-2">
        {autoHideLibrary && !focusMode && !libraryPeek && (
          <div
            aria-hidden
            onMouseEnter={() => setLibraryPeek(true)}
            className="absolute inset-y-0 left-0 z-40 hidden w-2.5 cursor-e-resize lg:block"
          />
        )}

        <AnimatePresence initial={false}>
          {!focusMode && (
            <motion.div
              key="sidebar"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: sidebarRenderWidth }}
              exit={{ opacity: 0, width: 0 }}
              transition={{
                duration: resizingPanel === "left" ? 0 : 0.25,
                ease: [0.2, 0.8, 0.2, 1],
              }}
              onMouseLeave={() => {
                if (autoHideLibrary) setLibraryPeek(false);
              }}
              className="sidebar-shell hidden shrink-0 overflow-hidden lg:flex"
            >
              <div className="sidebar-frame flex h-full w-full flex-col">
                <Sidebar
                  collapsed={autoHideLibrary ? false : isLeftCollapsed}
                  width={sidebarRenderWidth}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!focusMode && (!autoHideLibrary || libraryPeek) && (
          <PanelResizeHandle
            side="left"
            width={effectiveSidebarWidth}
            min={SIDEBAR_LIMITS.collapsed}
            max={SIDEBAR_LIMITS.max}
            onResize={handleSidebarResize}
            onDraggingChange={(dragging) =>
              setResizingPanel(dragging ? "left" : null)
            }
            className="hidden lg:flex"
          />
        )}

        <main className="lucid-glass-panel glass relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl">
          <AnimatePresence initial={false} mode="sync">
            <motion.div
              key={
                view === "playlist"
                  ? `playlist-${selectedPlaylistId ?? "none"}`
                  : view === "artist"
                    ? `artist-${selectedArtistName ?? "none"}`
                    : view
              }
              initial={{ opacity: 0, scale: 0.985, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 1.012, y: -6 }}
              transition={{ duration: 0.32, ease: EASE }}
              className="absolute inset-0"
            >
              {view === "artist" ? (
                <ArtistDetailView />
              ) : view === "playlist" ? (
                <PlaylistView />
              ) : view === "stats" ? (
                <StatsView />
              ) : view === "library" ? (
                <LibraryView />
              ) : (
                <NowPlayingView />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        {!focusMode && view === "player" && (
          <>
            {isRightOpen ? (
              <PanelResizeHandle
                side="right"
                width={rightPanelWidth}
                min={RIGHT_PANEL_LIMITS.min}
                max={RIGHT_PANEL_LIMITS.max}
                onResize={handleRightPanelResize}
                onDraggingChange={(dragging) =>
                  setResizingPanel(dragging ? "right" : null)
                }
                className="hidden lg:flex"
              />
            ) : (
              <RightEdgeHandle onOpen={openRightPanel} />
            )}

            <div
              aria-hidden={!isRightOpen}
              data-open={isRightOpen ? "true" : "false"}
              data-resizing={resizingPanel === "right" ? "true" : "false"}
              className={cn(
                "now-playing-panel hidden h-full min-w-0 shrink-0 overflow-hidden lg:block",
                !isRightOpen && "pointer-events-none",
              )}
              style={{ width: isRightOpen ? rightPanelWidth : 0 }}
            >
              <div className="now-playing-panel-content flex h-full min-w-0 flex-col">
                <NowPlayingPanel />
              </div>
            </div>
          </>
        )}
      </div>

      <PlayerBar
        rightPanelOpen={rightPanelVisible}
        onToggleRightPanel={toggleRightPanel}
      />
      <QueuePanel />
      <TrackContextMenu />
      <PlaylistDialog />
      <LucidSettingsDialog />
      <Toaster />
      <WindowResizeHandles />
    </div>
  );
}
