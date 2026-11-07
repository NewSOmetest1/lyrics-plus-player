import { useMemo } from "react";
import { motion } from "framer-motion";
import { Disc3, Play } from "lucide-react";

import type { AlbumGroup } from "@/types";
import { buildAlbumGroups } from "@/lib/artists";
import { formatCount } from "@/lib/format";
import { usePlayerStore } from "@/store/playerStore";
import { CoverArt } from "@/components/ui/CoverArt";

function AlbumCard({ album, index }: { album: AlbumGroup; index: number }) {
  const playTrack = usePlayerStore((state) => state.playTrack);
  const setShuffle = usePlayerStore((state) => state.setShuffle);
  const navigate = usePlayerStore((state) => state.navigate);

  const openAlbum = () => {
    navigate({ type: "search", query: album.album });
  };

  const playAlbum = () => {
    if (album.tracks.length === 0) return;
    setShuffle(false);
    void playTrack(album.tracks[0], 0, album.tracks);
  };

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={`Open ${album.album}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.012, 0.2) }}
      onClick={openAlbum}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openAlbum();
        }
      }}
      className="library-media-card lucid-glass-panel group relative min-w-0 cursor-pointer rounded-2xl p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <div className="relative">
        <CoverArt
          track={album.coverTrack}
          className="aspect-square w-full rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
          iconClassName="h-8 w-8"
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            playAlbum();
          }}
          aria-label={`Play ${album.album}`}
          title="Play album"
          className="absolute bottom-2 right-2 flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-accent text-black opacity-0 shadow-glow transition-all duration-[250ms] ease-out group-hover:translate-y-0 group-hover:opacity-100 hover:brightness-110 focus-visible:translate-y-0 focus-visible:opacity-100 active:scale-95"
        >
          <Play className="ml-0.5 h-4 w-4 fill-current" />
        </button>
      </div>

      <p className="mt-3 truncate text-[14px] font-bold text-white/90 transition-colors group-hover:text-white">
        {album.album}
      </p>
      <p className="mt-0.5 truncate text-[12px] text-white/40">
        {album.artist} <span className="text-white/20">•</span>{" "}
        {formatCount(album.trackCount, "track")}
      </p>
    </motion.div>
  );
}

export function AlbumGrid({ query = "" }: { query?: string }) {
  const tracks = usePlayerStore((state) => state.tracks);
  const albums = useMemo(() => buildAlbumGroups(tracks), [tracks]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return albums;
    return albums.filter((album) =>
      `${album.album} ${album.artist}`.toLocaleLowerCase().includes(needle),
    );
  }, [albums, query]);

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/25">
          {query.trim() ? "Search results" : "All albums"}
          <span className="ml-2 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] tracking-normal text-white/35">
            {filtered.length}
          </span>
        </p>
        <span className="text-[10px] text-white/20">Alphabetical</span>
      </div>

      {filtered.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-8 py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.05]">
            <Disc3 className="h-6 w-6 text-white/30" />
          </span>
          <h2 className="mt-4 font-display text-[16px] font-bold text-white/80">
            {query.trim() ? `No albums match “${query.trim()}”` : "No albums yet"}
          </h2>
          <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-white/30">
            {query.trim()
              ? "Try a shorter name or clear the search field."
              : "Albums appear automatically after your first library scan."}
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 20,
          }}
        >
          {filtered.map((album, index) => (
            <AlbumCard key={album.key} album={album} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}
