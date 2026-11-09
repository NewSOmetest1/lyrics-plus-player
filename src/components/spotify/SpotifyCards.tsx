import { useEffect, useState } from "react";
import { Check, Download, Loader2, Music2 } from "lucide-react";

import type { SpotifyAlbumSummary, Track } from "@/types";
import { cn } from "@/lib/cn";
import { localAlbumStats } from "@/lib/spotifyMatch";

export function SpotifyArtwork({
  url,
  className,
  rounded = "rounded-xl",
}: {
  url: string | null;
  className?: string;
  rounded?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <div
      className={cn(
        "relative isolate shrink-0 overflow-hidden bg-white/[0.04]",
        rounded,
        className,
      )}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#450af5]/55 to-[#8e8ee8]/35">
          <Music2 className="h-5 w-5 text-white/55" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10" />
    </div>
  );
}

export function SpotifyAlbumCard({
  album,
  tracks,
  downloading,
  onDownload,
  onOpen,
}: {
  album: SpotifyAlbumSummary;
  tracks: readonly Track[];
  downloading: boolean;
  onDownload: () => void;
  onOpen?: () => void;
}) {
  const stats = localAlbumStats(tracks, album);
  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (!onOpen) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group min-w-0 rounded-2xl border border-white/[0.055] bg-white/[0.02] p-2.5 transition hover:border-white/[0.1] hover:bg-white/[0.04]",
        onOpen &&
          "cursor-pointer outline-none focus-visible:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent/50",
      )}
    >
      <div className="relative">
        <SpotifyArtwork
          url={album.coverUrl}
          className="aspect-square w-full shadow-[0_18px_40px_-22px_rgba(0,0,0,.9)]"
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDownload();
          }}
          disabled={downloading || stats.downloaded}
          aria-label={`Download ${album.title}`}
          title={stats.downloaded ? "Already downloaded" : "Download album"}
          className={cn(
            "absolute bottom-2 right-2 flex h-8 w-8 translate-y-1 items-center justify-center rounded-full shadow-lg opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 disabled:pointer-events-none",
            stats.downloaded
              ? "bg-emerald-400 text-black"
              : "bg-accent text-black hover:brightness-110",
          )}
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : stats.downloaded ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <p className="mt-2.5 truncate text-[12px] font-bold text-white/80">
        {album.title}
      </p>
      <p className="mt-0.5 truncate text-[10.5px] text-white/30">
        {album.releaseDate.slice(0, 4) || "—"}
        <span className="mx-1 text-white/15">·</span>
        {album.artist || album.type}
      </p>
      <div className="mt-2">
        {stats.downloaded ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.08em] text-emerald-300/80">
            <Check className="h-2.5 w-2.5" />
            Downloaded
          </span>
        ) : stats.onPc > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.08em] text-amber-200/70">
            {stats.onPc}/{stats.total || "?"} on PC
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.03] px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.08em] text-white/25">
            {album.type || "Album"}
          </span>
        )}
      </div>
    </div>
  );
}
