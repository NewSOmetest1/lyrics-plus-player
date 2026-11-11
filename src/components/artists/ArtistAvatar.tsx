import { memo, useEffect } from "react";
import { UserRound } from "lucide-react";

import type { Track } from "@/types";
import { useArtistCacheStore } from "@/store/artistCacheStore";
import { CoverArt } from "@/components/ui/CoverArt";
import { SpotifyArtwork } from "@/components/spotify/SpotifyCards";

/**
 * Circular artist image backed by the persisted Spotify profile cache.
 * Falls back to a local cover while the cache is still empty.
 */
export const ArtistAvatar = memo(function ArtistAvatar({
  name,
  spotifyId,
  coverTrack,
  className,
  rounded = "rounded-full",
  iconClassName,
}: {
  name: string;
  spotifyId?: string | null;
  coverTrack?: Track | null;
  className?: string;
  rounded?: string;
  iconClassName?: string;
}) {
  const entry = useArtistCacheStore((state) => {
    if (spotifyId && state.byId[spotifyId]) return state.byId[spotifyId];
    const key = name.trim().toLocaleLowerCase();
    return key ? (state.byName[key] ?? null) : null;
  });
  const resolve = useArtistCacheStore((state) => state.resolve);

  // Stale-while-revalidate: an existing profile paints immediately, then a
  // stale one is refreshed in the background. Uncached names are not resolved
  // here because a virtualized grid can hold hundreds of artists and would
  // otherwise flood the Spotify catalog with name searches.
  useEffect(() => {
    if (entry) void resolve({ name, id: spotifyId });
    else if (spotifyId) void resolve({ id: spotifyId, name });
  }, [entry, name, resolve, spotifyId]);

  if (entry?.imageUrl) {
    return (
      <SpotifyArtwork
        url={entry.imageUrl}
        rounded={rounded}
        className={className}
      />
    );
  }

  if (coverTrack) {
    return (
      <CoverArt
        track={coverTrack}
        width={512}
        height={512}
        className={className}
        iconClassName={iconClassName}
        coverMenu={false}
      />
    );
  }

  return (
    <div
      className={`flex items-center justify-center bg-gradient-to-br from-[#450af5]/60 to-[#8e8ee8]/40 ${rounded} ${className ?? ""}`}
    >
      <UserRound className={iconClassName ?? "h-6 w-6 text-white/60"} />
    </div>
  );
});
