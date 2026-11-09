import { useMemo } from "react";
import { motion } from "framer-motion";
import { ListMusic, Play, Plus } from "lucide-react";

import type { Playlist, Track } from "@/types";
import { isLikedPlaylist } from "@/types";
import { formatCount } from "@/lib/format";
import { usePlayerStore } from "@/store/playerStore";
import { usePlaylistStore } from "@/store/playlistStore";
import { usePlaylistDialogStore } from "@/store/playlistDialogStore";
import { PlaylistCover } from "@/components/playlists/PlaylistCover";

function PlaylistCard({
  playlist,
  tracks,
  index,
}: {
  playlist: Playlist;
  tracks: Track[];
  index: number;
}) {
  const openPlaylist = usePlayerStore((state) => state.openPlaylist);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const setShuffle = usePlayerStore((state) => state.setShuffle);

  const playPlaylist = () => {
    if (tracks.length === 0) return;
    setShuffle(false);
    void playTrack(tracks[0], 0, tracks);
  };

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={`Open ${playlist.name} playlist`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.012, 0.2) }}
      onClick={() => openPlaylist(playlist.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPlaylist(playlist.id);
        }
      }}
      className="library-media-card lucid-glass-panel group relative min-w-0 cursor-pointer rounded-2xl p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <div className="relative">
        <PlaylistCover
          tracks={tracks.slice(0, 4)}
          liked={isLikedPlaylist(playlist)}
          className="aspect-square w-full rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
          iconClassName="h-8 w-8"
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            playPlaylist();
          }}
          disabled={tracks.length === 0}
          aria-label={`Play ${playlist.name}`}
          title="Play playlist"
          className="absolute bottom-2 right-2 flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-accent text-black opacity-0 shadow-glow transition-all duration-[250ms] ease-out group-hover:translate-y-0 group-hover:opacity-100 hover:brightness-110 focus-visible:translate-y-0 focus-visible:opacity-100 active:scale-95 disabled:pointer-events-none disabled:opacity-0"
        >
          <Play className="ml-0.5 h-4 w-4 fill-current" />
        </button>
      </div>

      <p className="mt-3 truncate text-[14px] font-bold text-white/90 transition-colors group-hover:text-white">
        {playlist.name}
      </p>
      <p className="mt-0.5 truncate text-[12px] text-white/40">
        {isLikedPlaylist(playlist) ? (
          <>
            Playlist <span className="text-white/20">•</span>{" "}
            {playlist.trackPaths.length}{" "}
            {playlist.trackPaths.length === 1 ? "song" : "songs"}
          </>
        ) : (
          <>
            Playlist <span className="text-white/20">•</span>{" "}
            {formatCount(playlist.trackPaths.length, "track")}
          </>
        )}
      </p>
    </motion.div>
  );
}

export function PlaylistGrid({ query = "" }: { query?: string }) {
  const playlists = usePlaylistStore((state) => state.playlists);
  const tracks = usePlayerStore((state) => state.tracks);
  const openCreate = usePlaylistDialogStore((state) => state.openCreate);

  const byPath = useMemo(
    () => new Map(tracks.map((track) => [track.path, track])),
    [tracks],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return playlists;
    return playlists.filter((playlist) =>
      playlist.name.toLocaleLowerCase().includes(needle),
    );
  }, [playlists, query]);

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/25">
          {query.trim() ? "Search results" : "All playlists"}
          <span className="ml-2 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] tracking-normal text-white/35">
            {filtered.length}
          </span>
        </p>
        <button
          type="button"
          onClick={() => openCreate()}
          className="flex h-7 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-[10.5px] font-semibold text-white/45 outline-none transition hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Plus className="h-3 w-3" />
          New playlist
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-8 py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.05]">
            <ListMusic className="h-6 w-6 text-white/30" />
          </span>
          <h2 className="mt-4 font-display text-[16px] font-bold text-white/80">
            {query.trim()
              ? `No playlists match “${query.trim()}”`
              : "No playlists yet"}
          </h2>
          <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-white/30">
            {query.trim()
              ? "Try a shorter name or clear the search field."
              : "Create a playlist, then add tracks from the library context menu."}
          </p>
          {!query.trim() && (
            <button
              type="button"
              onClick={() => openCreate()}
              className="mt-4 flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-[11px] font-bold text-black shadow-glow transition hover:brightness-110"
            >
              <Plus className="h-3.5 w-3.5" />
              Create playlist
            </button>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 20,
          }}
        >
          {filtered.map((playlist, index) => (
            <PlaylistCard
              key={playlist.id}
              playlist={playlist}
              tracks={playlist.trackPaths
                .map((trackPath) => byPath.get(trackPath))
                .filter((track): track is Track => Boolean(track))}
              index={index}
            />
          ))}
        </div>
      )}
    </div>
  );
}
