import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Heart,
  ListMusic,
  Pause,
  Play,
  Sparkles,
} from "lucide-react";
import { usePlayerStore } from "@/store/playerStore";
import { useTrackMenuStore } from "@/store/contextMenuStore";
import { cn } from "@/lib/cn";
import { formatQuality, formatTime } from "@/lib/format";
import { CoverArt } from "@/components/ui/CoverArt";
import { ArtistLinks } from "@/components/artists/ArtistLinks";
import { IconButton } from "@/components/ui/IconButton";

export function NowPlayingPanel() {
  const track = usePlayerStore((state) => state.currentTrack);
  const tracks = usePlayerStore((state) => state.playbackQueue);
  const queueIndex = usePlayerStore((state) => state.queueIndex);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const toggleQueue = usePlayerStore((state) => state.toggleQueue);
  const openMenu = useTrackMenuStore((state) => state.openMenu);
  const [liked, setLiked] = useState(false);

  const queue = useMemo(() => {
    if (tracks.length <= 1) return [];
    const count = Math.min(4, tracks.length - 1);
    const items = [];
    for (let offset = 1; offset <= count; offset += 1) {
      const item = tracks[(queueIndex + offset) % tracks.length];
      if (item && item.id !== track?.id) items.push(item);
    }
    return items;
  }, [tracks, queueIndex, track?.id]);

  return (
    <aside className="now-playing-content flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col">
      <div className="now-playing-card lucid-glass-panel glass flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <span className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-white/30">
            Now playing
          </span>
          <IconButton label="Open queue" size="sm" onClick={toggleQueue}>
            <ListMusic className="h-3.5 w-3.5" />
          </IconButton>
        </div>

        <div className="relative mx-auto mt-3 w-full min-w-0">
          <motion.div
            whileHover={{ scale: 1.015 }}
            transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
            className="group relative"
            onContextMenu={
              track
                ? (event) => {
                    event.preventDefault();
                    openMenu(track, event.clientX, event.clientY);
                  }
                : undefined
            }
          >
            <CoverArt
              track={track}
              full
              className="aspect-square w-full rounded-xl shadow-[0_24px_60px_-18px_rgba(0,0,0,.85)]"
              iconClassName="h-10 w-10"
            />
            <button
              type="button"
              onClick={() => void togglePlay()}
              disabled={!track}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="absolute bottom-3 right-3 flex h-11 w-11 translate-y-1.5 items-center justify-center rounded-full bg-accent text-black opacity-0 shadow-glow transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 disabled:opacity-0"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4 fill-current" />
              ) : (
                <Play className="ml-0.5 h-4 w-4 fill-current" />
              )}
            </button>
          </motion.div>
        </div>

        <div className="mt-4 min-w-0">
          <h2 className="truncate font-display text-[21px] font-extrabold leading-tight tracking-[-0.02em] text-white">
            {track?.title ?? "Nothing playing"}
          </h2>
          {track ? (
            <ArtistLinks
              artistString={track.artist}
              className="mt-1 block truncate text-[12.5px] text-white/45"
            />
          ) : (
            <p className="mt-1 truncate text-[12.5px] text-white/45">
              Choose a track from your library
            </p>
          )}
          {track && (
            <p className="mt-0.5 truncate text-[11px] text-white/25 [@media(max-height:780px)]:hidden">
              {track.album}
            </p>
          )}
        </div>

        {track && (
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="max-w-full truncate rounded-md border border-accent/25 bg-accent/[0.12] px-2 py-0.5 text-[9px] font-bold tracking-[0.1em] text-accent">
              {track.format}
            </span>
            <span className="max-w-full truncate rounded-md border border-white/[0.08] bg-white/[0.035] px-2 py-0.5 text-[9.5px] font-medium text-white/40">
              {formatQuality(track)}
            </span>
            {track.bitrate && (
              <span className="max-w-full truncate rounded-md border border-white/[0.08] bg-white/[0.035] px-2 py-0.5 text-[9.5px] font-medium text-white/40">
                {track.bitrate.toLocaleString("en-US")} kbps
              </span>
            )}
          </div>
        )}

        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setLiked((value) => !value)}
            className={cn(
              "flex h-8 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[10.5px] font-semibold transition",
              liked
                ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
                : "border-white/[0.08] bg-white/[0.04] text-white/45 hover:bg-white/[0.08] hover:text-white/75",
            )}
          >
            <Heart className={cn("h-3.5 w-3.5 shrink-0", liked && "fill-current")} />
            {liked ? "Liked" : "Like"}
          </button>
          <button
            type="button"
            onClick={toggleQueue}
            className="flex h-8 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-[10.5px] font-semibold text-white/45 transition hover:bg-white/[0.08] hover:text-white/75"
          >
            <ListMusic className="h-3.5 w-3.5 shrink-0" />
            Queue
          </button>
        </div>

        <div className="my-3 h-px shrink-0 bg-white/[0.06]" />

        <div className="flex shrink-0 items-center justify-between">
          <span className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.18em] text-white/30">
            <Sparkles className="h-3 w-3 text-white/25" />
            In queue
          </span>
          <span className="text-[9.5px] tabular-nums text-white/20">
            {Math.max(0, tracks.length - 1)}
          </span>
        </div>

        <div className="no-scrollbar mt-1 min-h-0 flex-1 overflow-y-auto">
          {queue.length === 0 ? (
            <p className="py-5 text-center text-[10.5px] leading-relaxed text-white/20">
              Queue is empty.
              <br />
              Add more tracks to your library.
            </p>
          ) : (
            queue.map((item, index) => (
              <motion.div
                key={`${item.id}-${index}`}
                onClick={() => void playTrack(item, 0, tracks)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openMenu(item, event.clientX, event.clientY);
                }}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: index * 0.04, ease: [0.2, 0, 0, 1] }}
                className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-white/[0.05]"
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void playTrack(item, 0, tracks);
                  }}
                  aria-label={`Play ${item.title}`}
                  className="shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  <CoverArt
                    track={item}
                    className="h-8 w-8 shrink-0 rounded-md"
                    iconClassName="h-3.5 w-3.5"
                    showInitials={false}
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void playTrack(item, 0, tracks);
                    }}
                    className="block max-w-full truncate text-left text-[11px] font-medium text-white/65 group-hover:text-white"
                  >
                    {item.title}
                  </button>
                  <ArtistLinks
                    artistString={item.artist}
                    className="block truncate text-[9.5px] text-white/25"
                  />
                </div>
                <span className="text-[9px] tabular-nums text-white/20">
                  {formatTime(item.durationMs)}
                </span>
              </motion.div>
            ))
          )}
        </div>

      </div>
    </aside>
  );
}
