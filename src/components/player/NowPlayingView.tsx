import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import {
  Disc3,
  FileText,
  Maximize2,
  Mic2,
  Minimize2,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { usePlayerStore } from "@/store/playerStore";
import { formatSource } from "@/lib/format";
import { LyricsTabs } from "@/components/lyrics/LyricsTabs";
import { LyricsViewer } from "@/components/lyrics/LyricsViewer";
import { LoadingDots } from "@/components/lyrics/LoadingDots";
import { TrackDelayIndicator } from "@/components/player/TrackDelayIndicator";
import { TrackDelayPill } from "@/components/player/TrackDelayPill";
import { HEADER_BADGE_CLASS } from "@/components/player/headerBadge";
import { IconButton } from "@/components/ui/IconButton";

const EASE = [0.2, 0, 0, 1] as const;

function StatusPanel({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Mic2;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
          <Icon className="h-6 w-6 text-white/45" />
        </div>
        <h3 className="mt-4 font-display text-[18px] font-bold text-white/90">{title}</h3>
        <p className="mt-1.5 text-[12px] leading-relaxed text-white/35">{description}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export function NowPlayingView() {
  const track = usePlayerStore((state) => state.currentTrack);
  const mode = usePlayerStore((state) => state.lyricsMode);
  const status = usePlayerStore((state) => state.lyricsStatus);
  const synced = usePlayerStore((state) => state.lyricsSynced);
  const source = usePlayerStore((state) => state.lyricsSource);
  const focusMode = usePlayerStore((state) => state.focusMode);
  const setLyricsMode = usePlayerStore((state) => state.setLyricsMode);
  const toggleFocus = usePlayerStore((state) => state.toggleFocus);
  const loadLyrics = usePlayerStore((state) => state.loadLyrics);

  const effectiveMode = !synced && mode !== "unsynced" ? "unsynced" : mode;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-6 pb-2 pt-4">
        <span aria-hidden="true" />

        <LyricsTabs
          mode={effectiveMode}
          synced={synced}
          onChange={setLyricsMode}
        />

        <div className="flex shrink-0 items-center justify-end gap-1.5 justify-self-end">
          {status === "ready" && (
            <>
              {source && (
                <span className={`${HEADER_BADGE_CLASS} gap-1.5`}>
                  <Sparkles className="h-3 w-3" />
                  {formatSource(source)}
                </span>
              )}
              {track && <TrackDelayPill />}
            </>
          )}
          <IconButton
            label="Refresh lyrics"
            size="sm"
            onClick={() => track && void loadLyrics(track, true)}
            disabled={!track || status === "loading"}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${status === "loading" ? "animate-spin" : ""}`} />
          </IconButton>
          {focusMode ? (
            <IconButton label="Exit immersive mode (Esc)" size="sm" onClick={toggleFocus}>
              <Minimize2 className="h-3.5 w-3.5" />
            </IconButton>
          ) : (
            <IconButton label="Immersive lyrics (F)" size="sm" onClick={toggleFocus}>
              <Maximize2 className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          {status === "loading" && (
            <motion.div
              key="loading"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <LoadingDots label="Finding lyrics" />
            </motion.div>
          )}

          {status === "ready" && (
            <motion.div
              key={`${track?.id ?? "none"}-${effectiveMode}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="absolute inset-0"
            >
              <LyricsViewer mode={effectiveMode} />
            </motion.div>
          )}

          {status === "instrumental" && (
            <motion.div
              key="instrumental"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="absolute inset-0"
            >
              <StatusPanel
                icon={Disc3}
                title="Instrumental track"
                description="No lyrics to display here — just the music. Close your eyes and enjoy the mix."
              />
            </motion.div>
          )}

          {(status === "empty" || status === "error") && (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="absolute inset-0"
            >
              <StatusPanel
                icon={status === "error" ? TriangleAlert : FileText}
                title={status === "error" ? "Could not load lyrics" : "No lyrics found"}
                description="Drop a .lrc file next to the track, embed lyrics in the tags, or enable LRCLIB, Musixmatch or Spotify in Providers."
                action={
                  track ? (
                    <button
                      type="button"
                      onClick={() => void loadLyrics(track, true)}
                      className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2 text-[11px] font-semibold text-white/70 transition hover:bg-white/[0.14] hover:text-white"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Try again
                    </button>
                  ) : undefined
                }
              />
            </motion.div>
          )}

          {status === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0"
            >
              <StatusPanel
                icon={Mic2}
                title="Ready when you are"
                description="Pick a track from your library to see its lyrics light up line by line."
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-4 px-6 pb-3 text-[9.5px] text-white/20">
        <span>
          <kbd className="rounded border border-white/10 bg-white/[0.04] px-1 py-0.5 font-sans text-[9px] text-white/35">
            Space
          </kbd>{" "}
          play / pause
        </span>
        <span className="text-white/10">·</span>
        <span>Click a line to jump</span>
        <span className="text-white/10">·</span>
        <span>
          <kbd className="rounded border border-white/10 bg-white/[0.04] px-1 py-0.5 font-sans text-[9px] text-white/35">
            Ctrl F
          </kbd>{" "}
          search
        </span>
        <span className="text-white/10">·</span>
        <span>
          <kbd className="rounded border border-white/10 bg-white/[0.04] px-1 py-0.5 font-sans text-[9px] text-white/35">
            F
          </kbd>{" "}
          immersive
        </span>
      </div>

      <TrackDelayIndicator />
    </div>
  );
}
