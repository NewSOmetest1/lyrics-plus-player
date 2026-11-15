import { Check, Download, Loader2 } from "lucide-react";

import type { SpotifyLikedTrackInput, Track } from "@/types";
import { cn } from "@/lib/cn";
import { coverUrl } from "@/lib/api";
import { useDownloadStore } from "@/store/downloadStore";
import { useIsLiked, usePlaylistStore } from "@/store/playlistStore";
import { useSpotifyLikedStore } from "@/store/spotifyLikedStore";
import { useToastStore } from "@/store/toastStore";

export function streamFormatLabel(
  track: Pick<Track, "isStream" | "streamType" | "format"> | null,
): string {
  if (!track) return "";
  if (track.isStream) {
    return track.streamType === "preview" ? "30s PREVIEW" : "STREAM";
  }
  return track.format;
}

export function streamSourceLabel(track: Track | null): string {
  if (!track?.isStream) return "";
  if (!track.streamSource) {
    return track.streamType === "preview" ? "Resolving preview…" : "Resolving stream…";
  }
  const source = track.streamSource;
  const label =
    source === "youtube"
      ? "YouTube"
      : source === "soundcloud"
        ? "SoundCloud"
        : source === "spotify"
          ? "Spotify"
          : source === "deezer"
            ? "Deezer"
            : "iTunes";
  return `${label} · ${track.streamType === "preview" ? "30s preview" : "full stream"}`;
}

export function streamSpotifyId(track: Track): string {
  return (
    track.streamSpotifyId?.trim() ||
    track.spotifyTrackId?.trim() ||
    ""
  );
}

export function useTrackLiked(track: Track | null): boolean {
  const localLiked = useIsLiked(track?.path);
  const id = track?.isStream ? streamSpotifyId(track) : "";
  const spotifyLiked = useSpotifyLikedStore((state) =>
    id ? state.likedIds.has(id) : false,
  );
  return track?.isStream ? spotifyLiked : localLiked;
}

export function toggleTrackLike(track: Track): void {
  if (!track.isStream) {
    void usePlaylistStore.getState().toggleLike(track);
    return;
  }
  const id = streamSpotifyId(track);
  if (!id) return;
  const liked = useSpotifyLikedStore.getState().likedIds.has(id);
  const input: SpotifyLikedTrackInput = {
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    coverUrl: coverUrl(track, true),
    spotifyUrl:
      id ? `https://open.spotify.com/track/${id}` : "",
    localPath: null,
  };
  void usePlaylistStore.getState().setLike({
    trackId: id,
    liked: !liked,
    spotify: true,
    title: track.title,
    input,
  });
}

/**
 * Compact Save FLAC action for a virtual stream row. The downloader runs in the
 * background; the queue slot is upgraded to the local file after the scan.
 */
export function StreamSaveButton({
  track,
  iconOnly = false,
  className,
}: {
  track: Track;
  iconOnly?: boolean;
  className?: string;
}) {
  const tasks = useDownloadStore((state) => state.tasks);
  const start = useDownloadStore((state) => state.start);
  const spotifyId = streamSpotifyId(track);

  const task = tasks.find(
    (item) =>
      (spotifyId
        ? item.trackId === spotifyId
        : Boolean(track.streamReleaseId) &&
          item.releaseId === track.streamReleaseId &&
          item.title === track.title),
  );
  const active =
    task?.status === "queued" || task?.status === "downloading";
  const complete =
    task?.status === "completed" || task?.status === "duplicate";

  const queue = async () => {
    if (!spotifyId || active) return;
    try {
      await start([
        {
          releaseId:
            track.streamReleaseId ??
            `spotify-track-${spotifyId}`,
          trackId: spotifyId,
          title: track.title,
          artist: track.artist,
          album: track.album,
          coverUrl: track.coverPath ?? track.coverFullPath ?? null,
          spotifyUrl: `https://open.spotify.com/track/${spotifyId}`,
        },
      ]);
      useToastStore.getState().push({
        kind: "success",
        title: "Saving FLAC in background",
        description: `${track.artist} · ${track.title}`,
      });
    } catch (error) {
      useToastStore.getState().push({
        kind: "error",
        title: "Could not queue download",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void queue();
      }}
      disabled={!spotifyId || active || complete}
      aria-label={
        complete
          ? `${track.title} is downloaded as FLAC`
          : active
            ? `Downloading ${track.title} as FLAC`
            : `Download ${track.title} as FLAC`
      }
      title="Download FLAC"
      className={cn(
        "group inline-flex shrink-0 items-center justify-center outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none",
        iconOnly
          ? cn(
              "h-7 w-7 rounded-full border-0 bg-transparent p-0",
              active
                ? "text-accent"
                : complete
                  ? "text-emerald-300/80"
                  : "text-white/55 hover:bg-white/[0.06] hover:text-white",
            )
          : cn(
              "h-7 gap-1 rounded-full border border-white/[0.09] bg-white/[0.04] px-2 text-[9px] font-bold uppercase tracking-[0.08em] text-white/50 hover:border-accent/30 hover:bg-accent/[0.1] hover:text-accent",
              complete &&
                "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300/80",
            ),
        className,
      )}
    >
      {active ? (
        <Loader2
          className={cn("animate-spin", iconOnly ? "h-4 w-4" : "h-3 w-3")}
        />
      ) : complete ? (
        <Check className={cn(iconOnly ? "h-4 w-4" : "h-3 w-3")} />
      ) : (
        <Download
          className={cn(
            "transition-transform duration-200",
            iconOnly ? "h-4 w-4 group-hover:scale-[1.08]" : "h-3 w-3",
          )}
        />
      )}
      {!iconOnly && (
        <span className="hidden sm:inline">
          {complete ? "Saved" : active ? "Saving" : "Save FLAC"}
        </span>
      )}
    </button>
  );
}
