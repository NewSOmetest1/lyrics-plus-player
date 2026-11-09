import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { documentOffsetTop } from "@/lib/virtualLayout";

/** Card content is cover + text lines; height stays cardWidth + extra. */
const DEFAULT_CARD_EXTRA_HEIGHT = 53;
const OVERSCAN_ROWS = 2;

interface VirtualMediaGridProps<T> {
  items: T[];
  itemKey: (item: T) => string;
  renderItem: (item: T, index: number, animateIn: boolean) => ReactNode;
  /** The page-level scroll container that owns the grid. */
  scrollRef: RefObject<HTMLDivElement>;
  /** Changes when content above the grid appears/disappears. */
  layoutKey?: string | number;
  minColumnWidth?: number;
  gap?: number;
  /** Height below the square cover; each card type has its own text stack. */
  cardExtraHeight?: number;
}

interface Metrics {
  width: number;
  scrollTop: number;
  gridTop: number;
  viewportHeight: number;
}

/**
 * Windowing for the library card grids. The grid uses the same auto-fill
 * column math as CSS (`minmax(180px, 1fr)`), then mounts only the visible rows
 * plus a small buffer. Cards that mount after the first frame skip their intro
 * animation, so scrolling never replays the whole stagger.
 */
export function VirtualMediaGrid<T>({
  items,
  itemKey,
  renderItem,
  scrollRef,
  layoutKey,
  minColumnWidth = 180,
  gap = 20,
  cardExtraHeight = DEFAULT_CARD_EXTRA_HEIGHT,
}: VirtualMediaGridProps<T>) {
  const gridRef = useRef<HTMLDivElement>(null);
  const firstFrameRef = useRef(true);
  const [metrics, setMetrics] = useState<Metrics>({
    width: 0,
    scrollTop: 0,
    gridTop: 0,
    viewportHeight: 0,
  });

  const measure = useCallback(() => {
    const scroller = scrollRef.current;
    const grid = gridRef.current;
    if (!scroller || !grid) return;

    const next: Metrics = {
      width: grid.clientWidth,
      scrollTop: scroller.scrollTop,
      gridTop: documentOffsetTop(grid) - documentOffsetTop(scroller),
      viewportHeight: scroller.clientHeight,
    };
    setMetrics((previous) =>
      previous.width === next.width &&
      previous.scrollTop === next.scrollTop &&
      previous.gridTop === next.gridTop &&
      previous.viewportHeight === next.viewportHeight
        ? previous
        : next,
    );
  }, [scrollRef]);

  useLayoutEffect(() => {
    measure();
  }, [layoutKey, measure, items]);

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
    if (gridRef.current) resizeObserver.observe(gridRef.current);
    scroller.addEventListener("scroll", scheduleMeasure, { passive: true });
    measure();

    return () => {
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", scheduleMeasure);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [measure, scrollRef]);

  // Only the first mounted window keeps the stagger; every later card,
  // including cards revealed by scrolling, skips the intro animation.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      firstFrameRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const columns = Math.max(
    1,
    Math.floor((metrics.width + gap) / (minColumnWidth + gap)),
  );
  const cardWidth =
    metrics.width > 0
      ? (metrics.width - gap * (columns - 1)) / columns
      : 0;
  const cardHeight = cardWidth + cardExtraHeight;
  const rowStride = cardHeight + gap;
  const rowCount = Math.ceil(items.length / columns);
  const totalHeight =
    rowCount > 0 ? rowCount * cardHeight + (rowCount - 1) * gap : 0;

  const localTop = Math.max(0, metrics.scrollTop - metrics.gridTop);
  const firstRow = Math.max(
    0,
    Math.floor(localTop / Math.max(1, rowStride)) - OVERSCAN_ROWS,
  );
  const visibleRowCount = Math.max(
    1,
    Math.ceil(metrics.viewportHeight / Math.max(1, rowStride)) +
      OVERSCAN_ROWS * 2,
  );
  const startRow =
    firstRow >= rowCount ? Math.max(0, rowCount - visibleRowCount) : firstRow;
  const endRow = Math.min(rowCount, startRow + visibleRowCount);
  const startIndex = startRow * columns;
  const endIndex = Math.min(items.length, endRow * columns);

  return (
    <div
      ref={gridRef}
      className="relative w-full"
      style={{ height: totalHeight }}
    >
      {cardWidth > 0 &&
        items.slice(startIndex, endIndex).map((item, offset) => {
          const index = startIndex + offset;
          const row = Math.floor(index / columns);
          const column = index % columns;
          return (
            <div
              key={itemKey(item)}
              className="absolute"
              style={{
                left: column * (cardWidth + gap),
                top: row * rowStride,
                width: cardWidth,
                height: cardHeight,
              }}
            >
              {renderItem(item, index, firstFrameRef.current)}
            </div>
          );
        })}
    </div>
  );
}
