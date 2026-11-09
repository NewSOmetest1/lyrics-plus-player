import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { documentOffsetTop } from "@/lib/virtualLayout";

const DEFAULT_OVERSCAN = 5;

interface VirtualRowListProps {
  /** Number of fixed-height rows in the full list. */
  count: number;
  /** Height of one row in CSS pixels; must match the row component. */
  rowHeight: number;
  /** The page-level scroll container that owns the row list. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Renders one row by its index in the full list. */
  renderRow: (index: number) => ReactNode;
  /** Stable row identity for React; falls back to the index. */
  getKey?: (index: number) => string | number;
  /** Changes when content above the list appears/disappears. */
  layoutKey?: string | number;
  /** Extra rows mounted above and below the viewport. */
  overscan?: number;
}

interface ViewportMetrics {
  scrollTop: number;
  listTop: number;
  viewportHeight: number;
}

/**
 * Fixed-row-height windowing shared by every long track list. Only the visible
 * rows plus an overscan buffer are mounted; the full list is represented by a
 * single spacer and rows are absolutely positioned with translateY.
 */
export const VirtualRowList = memo(function VirtualRowList({
  count,
  rowHeight,
  scrollRef,
  renderRow,
  getKey,
  layoutKey,
  overscan = DEFAULT_OVERSCAN,
}: VirtualRowListProps) {
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
  }, [count, layoutKey, measure, rowHeight]);

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
  const rawStart = Math.max(0, Math.floor(localTop / rowHeight) - overscan);
  const visibleCount = Math.max(1, Math.ceil(metrics.viewportHeight / rowHeight));
  // Filters can shrink the list while the scroller is still clamped; never
  // render an empty window during that frame.
  const start =
    rawStart >= count
      ? Math.max(0, count - visibleCount - overscan * 2)
      : rawStart;
  const end = Math.min(count, start + visibleCount + overscan * 2);

  const rows: ReactNode[] = [];
  for (let index = start; index < end; index += 1) {
    rows.push(
      <div
        key={getKey ? getKey(index) : index}
        className="absolute inset-x-0 top-0"
        style={{
          height: rowHeight,
          transform: `translateY(${index * rowHeight}px)`,
        }}
      >
        {renderRow(index)}
      </div>,
    );
  }

  return (
    <div
      ref={listRef}
      className="relative"
      style={{ height: count * rowHeight }}
    >
      {rows}
    </div>
  );
});
