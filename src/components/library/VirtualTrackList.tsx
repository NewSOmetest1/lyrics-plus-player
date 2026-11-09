import { memo, type RefObject } from "react";
import type { Track } from "@/types";
import { TrackRow } from "@/components/library/TrackRow";
import { VirtualRowList } from "@/components/library/VirtualRowList";

/** TrackRow is h-[58px]; keep the virtual geometry in sync with it. */
export const TRACK_ROW_HEIGHT = 58;

interface VirtualTrackListProps {
  tracks: Track[];
  currentTrackId: number | null;
  playing: boolean;
  onPlay: (track: Track) => void;
  /** The page-level scroll container that owns the track list. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Changes when content above the list appears/disappears. */
  layoutKey?: string | number;
}

/**
 * Fixed-row-height windowing for the library track list. Delegates to the
 * shared row window so every long list uses the same measurement behaviour.
 */
export const VirtualTrackList = memo(function VirtualTrackList({
  tracks,
  currentTrackId,
  playing,
  onPlay,
  scrollRef,
  layoutKey,
}: VirtualTrackListProps) {
  return (
    <VirtualRowList
      count={tracks.length}
      rowHeight={TRACK_ROW_HEIGHT}
      scrollRef={scrollRef}
      layoutKey={layoutKey}
      getKey={(index) => tracks[index].id}
      renderRow={(index) => {
        const track = tracks[index];
        return (
          <TrackRow
            track={track}
            index={index}
            active={currentTrackId === track.id}
            playing={playing}
            onPlay={onPlay}
          />
        );
      }}
    />
  );
});
