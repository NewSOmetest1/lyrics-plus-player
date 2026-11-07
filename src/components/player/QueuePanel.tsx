import { AnimatePresence, motion } from "framer-motion";
import { ListMusic, Pause, Play, X } from "lucide-react";
import { usePlayerStore } from "@/store/playerStore";
import { useTrackMenuStore } from "@/store/contextMenuStore";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { CoverArt } from "@/components/ui/CoverArt";
import { ArtistLinks } from "@/components/artists/ArtistLinks";
import { EqualizerBars } from "@/components/ui/EqualizerBars";

const EASE = [0.2, 0, 0, 1] as const;

export function QueuePanel() {
  const open = usePlayerStore((state) => state.queueOpen);
  const tracks = usePlayerStore((state) => state.playbackQueue);
  const current = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const toggleQueue = usePlayerStore((state) => state.toggleQueue);
  const openMenu = useTrackMenuStore((state) => state.openMenu);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="queue-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[55]"
            onClick={toggleQueue}
          />
          <motion.aside
            key="queue"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            transition={{ duration: 0.24, ease: EASE }}
            className="queue-popover lucid-queue-panel fixed bottom-[108px] right-3 z-[60] flex max-h-[min(480px,62vh)] w-[340px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121218]/60 shadow-glass backdrop-blur-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
              <div className="flex items-center gap-2">
                <ListMusic className="h-4 w-4 text-accent" />
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">
                  Queue
                </span>
                <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[9px] text-white/35">
                  {tracks.length}
                </span>
              </div>
              <button
                type="button"
                onClick={toggleQueue}
                className="rounded-full p-1 text-white/30 transition hover:bg-white/10 hover:text-white"
                aria-label="Close queue"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {current && (
              <div className="flex items-center gap-2.5 border-b border-white/[0.06] bg-white/[0.025] px-4 py-2.5">
                <CoverArt
                  track={current}
                  className="h-10 w-10 rounded-md"
                  showInitials={false}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold text-accent">
                    {current.title}
                  </p>
                  <div className="truncate text-[9.5px] text-white/30">
                    <span>Now playing · </span>
                    <ArtistLinks artistString={current.artist} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void togglePlay()}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? (
                    <Pause className="h-3 w-3 fill-current" />
                  ) : (
                    <Play className="ml-0.5 h-3 w-3 fill-current" />
                  )}
                </button>
              </div>
            )}

            <div className="no-scrollbar flex-1 overflow-y-auto p-2">
              {tracks.map((track, index) => {
                const active = track.id === current?.id;
                return (
                  <div
                    key={`${track.id}-${index}`}
                    onClick={() => void playTrack(track, 0, tracks)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openMenu(track, event.clientX, event.clientY);
                    }}
                    className={cn(
                      "queue-track-row group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition",
                      active && "is-active bg-white/[0.07]",
                    )}
                  >
                    <span className="w-4 shrink-0 text-center text-[9px] tabular-nums text-white/20">
                      {active && isPlaying ? (
                        <EqualizerBars playing className="h-3 justify-center" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void playTrack(track, 0, tracks);
                      }}
                      aria-label={`Play ${track.title}`}
                      className="shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                      <CoverArt
                        track={track}
                        className="h-8 w-8 shrink-0 rounded-md"
                        showInitials={false}
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void playTrack(track, 0, tracks);
                        }}
                        className={cn(
                          "block max-w-full truncate text-left text-[11px] font-medium",
                          active ? "text-accent" : "text-white/65 group-hover:text-white",
                        )}
                      >
                        {track.title}
                      </button>
                      <ArtistLinks
                        artistString={track.artist}
                        className="block truncate text-[9.5px] text-white/25"
                      />
                    </div>
                    <span className="text-[9px] tabular-nums text-white/20">
                      {formatTime(track.durationMs)}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
