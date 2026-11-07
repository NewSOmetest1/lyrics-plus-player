import { AnimatePresence, motion } from "framer-motion";
import {
  Heart,
  ListMusic,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { usePlayerStore } from "@/store/playerStore";
import { useTrackMenuStore } from "@/store/contextMenuStore";
import { useLucidSettingsStore } from "@/store/lucidSettingsStore";
import { cn } from "@/lib/cn";
import { formatQuality, formatTime } from "@/lib/format";
import { CoverArt } from "@/components/ui/CoverArt";
import { ArtistLinks } from "@/components/artists/ArtistLinks";
import { IconButton } from "@/components/ui/IconButton";
import { EqualizerBars } from "@/components/ui/EqualizerBars";
import { ProgressBar } from "@/components/player/ProgressBar";
import { VolumeControl } from "@/components/player/VolumeControl";

const EASE = [0.2, 0, 0, 1] as const;

function TransportButton({
  label,
  active = false,
  compact = false,
  onClick,
  className,
  children,
}: {
  label: string;
  active?: boolean;
  compact?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full outline-none transition-[color,opacity,background-color,transform] duration-200 hover:bg-white/[0.06] hover:opacity-100 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/60",
        compact ? "h-6 w-6" : "h-7 w-7",
        active ? "text-accent opacity-100" : "text-white opacity-60",
        className,
      )}
    >
      {children}
      {active && (
        <span className="absolute bottom-0 left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-accent shadow-[0_0_6px_var(--accent-glow)]" />
      )}
    </button>
  );
}

export function PlayerBar({
  rightPanelOpen,
  onToggleRightPanel,
}: {
  rightPanelOpen: boolean;
  onToggleRightPanel: () => void;
}) {
  const track = usePlayerStore((state) => state.currentTrack);
  const tracks = usePlayerStore((state) => state.tracks);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const positionMs = usePlayerStore((state) => state.positionMs);
  const durationMs = usePlayerStore((state) => state.durationMs);
  const repeat = usePlayerStore((state) => state.repeat);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const focusMode = usePlayerStore((state) => state.focusMode);

  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const next = usePlayerStore((state) => state.next);
  const prev = usePlayerStore((state) => state.prev);
  const seek = usePlayerStore((state) => state.seek);
  const toggleRepeat = usePlayerStore((state) => state.toggleRepeat);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const toggleFocus = usePlayerStore((state) => state.toggleFocus);
  const openMenu = useTrackMenuStore((state) => state.openMenu);
  const playerHeight = useLucidSettingsStore((state) => state.playerHeight);

  const [liked, setLiked] = useState(false);

  const compactPlayer = playerHeight < 56;
  const tinyPlayer = playerHeight < 48;
  const repeatLabel =
    repeat === "one" ? "Repeat one" : repeat === "all" ? "Repeat all" : "Repeat off";
  const quality = useMemo(() => (track ? formatQuality(track) : ""), [track]);
  const coverSize = tinyPlayer
    ? "h-8 w-8"
    : compactPlayer
      ? "h-9 w-9"
      : "h-[52px] w-[52px]";

  return (
    <div className="lucid-player-shell relative z-30 shrink-0 px-3 pb-3">
      <div
        className={cn(
          "lucid-glass-panel lucid-player-bar glass flex items-center rounded-2xl",
          compactPlayer ? "gap-2 px-3" : "gap-4 px-4",
        )}
      >
        {/* Track identity */}
        <div
          className={cn(
            "flex min-w-0 flex-1 basis-0 items-center",
            compactPlayer ? "gap-2" : "gap-3",
          )}
          onContextMenu={
            track
              ? (event) => {
                  event.preventDefault();
                  openMenu(track, event.clientX, event.clientY);
                }
              : undefined
          }
        >
          <div className="shrink-0">
            <CoverArt
              track={track}
              className={cn(
                "lucid-player-cover shrink-0 rounded-xl shadow-lg",
                coverSize,
              )}
              iconClassName={compactPlayer ? "h-3.5 w-3.5" : "h-5 w-5"}
            />
          </div>

          <div className="min-w-0 max-w-[190px] xl:max-w-[260px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={track?.id ?? "empty"}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.22, ease: EASE }}
                className="min-w-0"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <p
                    className={cn(
                      "min-w-0 truncate font-semibold text-white/90",
                      compactPlayer ? "text-[12px]" : "text-[12.5px]",
                    )}
                  >
                    {track?.title ?? "Nothing playing"}
                  </p>
                  {track && (
                    <EqualizerBars
                      playing={isPlaying}
                      bars={3}
                      className="eq-bars-track-title shrink-0"
                    />
                  )}
                </div>
                {track ? (
                  <ArtistLinks
                    artistString={track.artist}
                    className={cn(
                      "block truncate text-white/35",
                      compactPlayer ? "text-[10px]" : "mt-0.5 text-[10.5px]",
                    )}
                  />
                ) : (
                  <p
                    className={cn(
                      "truncate text-white/35",
                      compactPlayer ? "text-[10px]" : "mt-0.5 text-[10.5px]",
                    )}
                  >
                    Pick a track to begin
                  </p>
                )}
              </motion.div>
            </AnimatePresence>

            {track && !compactPlayer && (
              <div className="mt-1 flex items-center gap-1.5">
                <span className="rounded-[4px] border border-accent/25 bg-accent/[0.09] px-1.5 py-px text-[8px] font-bold tracking-[0.08em] text-accent/90">
                  {track.format}
                </span>
                <span className="hidden truncate text-[9px] text-white/25 xl:inline">
                  {quality}
                </span>
              </div>
            )}
          </div>

          <IconButton
            label={liked ? "Remove from favourites" : "Add to favourites"}
            size="sm"
            onClick={() => setLiked((value) => !value)}
            className={cn("shrink-0", liked && "text-rose-400")}
          >
            <Heart className={cn("h-3.5 w-3.5", liked && "fill-current")} />
          </IconButton>
        </div>

        {/* Transport + progress */}
        <div
          className={cn(
            "flex min-w-0 shrink-0 flex-col items-center",
            compactPlayer ? "gap-px" : "gap-1",
          )}
        >
          <div
            className={cn(
              "flex items-center",
              compactPlayer ? "gap-0.5" : "gap-1",
            )}
          >
            <TransportButton
              label={shuffle ? "Shuffle on" : "Shuffle off"}
              active={shuffle}
              compact={compactPlayer}
              onClick={toggleShuffle}
              className="hidden sm:inline-flex"
            >
              <Shuffle className="h-4 w-4" strokeWidth={1.6} />
            </TransportButton>

            <TransportButton
              label="Previous track"
              compact={compactPlayer}
              onClick={() => void prev()}
            >
              <SkipBack className="h-[17px] w-[17px]" strokeWidth={1.7} />
            </TransportButton>

            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => void togglePlay()}
              disabled={tracks.length === 0}
              aria-label={isPlaying ? "Pause" : "Play"}
              title={isPlaying ? "Pause (Space)" : "Play (Space)"}
              className={cn(
                "mx-0.5 flex shrink-0 items-center justify-center rounded-full bg-white text-black shadow-[0_4px_16px_rgba(0,0,0,.35)] outline-none transition-transform duration-200 hover:scale-[1.06] focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-35",
                compactPlayer ? "h-[26px] w-[26px]" : "h-8 w-8",
              )}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isPlaying ? (
                  <motion.span
                    key="pause"
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ duration: 0.14 }}
                  >
                    <Pause
                      className={cn(
                        "fill-current",
                        compactPlayer ? "h-3 w-3" : "h-[13px] w-[13px]",
                      )}
                      strokeWidth={1.5}
                    />
                  </motion.span>
                ) : (
                  <motion.span
                    key="play"
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ duration: 0.14 }}
                  >
                    <Play
                      className={cn(
                        "ml-0.5 fill-current",
                        compactPlayer ? "h-3 w-3" : "h-[13px] w-[13px]",
                      )}
                      strokeWidth={1.5}
                    />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>

            <TransportButton
              label="Next track"
              compact={compactPlayer}
              onClick={() => void next()}
            >
              <SkipForward className="h-[17px] w-[17px]" strokeWidth={1.7} />
            </TransportButton>

            <TransportButton
              label={repeatLabel}
              active={repeat !== "off"}
              compact={compactPlayer}
              onClick={toggleRepeat}
              className="hidden sm:inline-flex"
            >
              {repeat === "one" ? (
                <Repeat1 className="h-4 w-4" strokeWidth={1.6} />
              ) : (
                <Repeat className="h-4 w-4" strokeWidth={1.6} />
              )}
            </TransportButton>
          </div>

          <div className="w-[clamp(280px,36vw,560px)]">
            <ProgressBar
              positionMs={positionMs}
              durationMs={durationMs}
              onSeek={seek}
              compact={compactPlayer}
            />
          </div>
        </div>

        {/* Output + view controls */}
        <div className="flex min-w-0 flex-1 basis-0 items-center justify-end gap-1">
          <span className="mr-1 hidden font-mono text-[10px] tabular-nums text-white/25 xl:inline">
            {formatTime(durationMs)}
          </span>
          <IconButton
            label={rightPanelOpen ? "Hide Now Playing panel" : "Show Now Playing panel"}
            size="sm"
            onClick={onToggleRightPanel}
            active={rightPanelOpen}
            className={cn(
              rightPanelOpen && "!bg-accent-soft !text-accent",
            )}
          >
            <ListMusic className="h-4 w-4" strokeWidth={1.7} />
          </IconButton>
          <VolumeControl />
          <IconButton
            label={focusMode ? "Exit immersive mode (Esc)" : "Immersive lyrics (F)"}
            size="sm"
            onClick={toggleFocus}
          >
            {focusMode ? (
              <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.7} />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.7} />
            )}
          </IconButton>
        </div>
      </div>
    </div>
  );
}
