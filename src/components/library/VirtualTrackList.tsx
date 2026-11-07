import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Track } from "@/types";
import { TrackRow } from "@/components/library/TrackRow";

/** TrackRow is h-[58px]; keep the virtual geometry in sync with it. */
export const TRACK_ROW_HEIGHT = 58;
const OVERSCAN = 5;

interface VirtualTrackListProps {
  tracks: Track[];
  currentTrackId: number | null;
  playing: boolean;
  onPlay: (track: Track) => void;
  /** The page-level scroll container that owns the track list. */
  scrollRef: RefObject<HTMLDivElement>;
  /** Changes when content above the list appears/disappears. */
  layoutKey?: string | number;
}

interface ViewportMetrics {
  scrollTop: number;
  listTop: number;
  viewportHeight: number;
}

/**
 * Layout offset in the document, ignoring transforms and scrolling. Using
 * getBoundingClientRect here would drift whenever a page transition applies a
 * scale/translate to an ancestor.
 */
function documentOffsetTop(element: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = element;
  while (node) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
}

/**
 * Fixed-row-height windowing for the library track list. Only the visible
 * rows plus a five-row buffer are mounted; the full list is represented by a
 * single spacer and rows are absolutely positioned with translateY.
 */
export const VirtualTrackList = memo(function VirtualTrackList({
  tracks,
  currentTrackId,
  playing,
  onPlay,
  scrollRef,
  layoutKey,
}: VirtualTrackListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<ViewportMetrics>({
    scrollTop: 0,
    listTop: 0,
    viewportHeight: 0,
  });

  const measure = useCallback(() => {
    const scroller = scrollRef.current;
    const list = listRef.current;
    if (!scroller || !list) return;

    const next: ViewportMetrics = {
      scrollTop: scroller.scrollTop,
      // Stable content offset of the virtual list inside the scroller.
      listTop: documentOffsetTop(list) - documentOffsetTop(scroller),
      viewportHeight: scroller.clientHeight,
    };
    setMetrics((previous) =>
      previous.scrollTop === next.scrollTop &&
      previous.listTop === next.listTop &&
      previous.viewportHeight === next.viewportHeight
        ? previous
        : next,
    );
  }, [scrollRef]);

  useLayoutEffect(() => {
    measure();
  }, [layoutKey, measure, tracks]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    let frame = 0;
    const scheduleMeasure = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(scroller);
    scroller.addEventListener("scroll", scheduleMeasure, { passive: true });
    measure();

    return () => {
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", scheduleMeasure);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [measure, scrollRef]);

  const localTop = Math.max(0, metrics.scrollTop - metrics.listTop);
  const rawStart = Math.max(
    0,
    Math.floor(localTop / TRACK_ROW_HEIGHT) - OVERSCAN,
  );
  const visibleCount = Math.max(
    1,
    Math.ceil(metrics.viewportHeight / TRACK_ROW_HEIGHT),
  );
  // Filters can shrink the list while the scroller is still clamped; never
  // render an empty window during that frame.
  const start =
    rawStart >= tracks.length
      ? Math.max(0, tracks.length - visibleCount - OVERSCAN * 2)
      : rawStart;
  const end = Math.min(
    tracks.length,
    start + visibleCount + OVERSCAN * 2,
  );
  const visible = tracks.slice(start, end);

  return (
    <div
      ref={listRef}
      className="relative"
      style={{ height: tracks.length * TRACK_ROW_HEIGHT }}
    >
      {visible.map((track, offset) => {
        const index = start + offset;
        return (
          <div
            key={track.id}
            className="absolute inset-x-0 top-0"
            style={{
              height: TRACK_ROW_HEIGHT,
              transform: `translateY(${index * TRACK_ROW_HEIGHT}px)`,
            }}
          >
            <TrackRow
              track={track}
              index={index}
              active={currentTrackId === track.id}
              playing={playing}
              onPlay={onPlay}
            />
          </div>
        );
      })}
    </div>
  );
});
