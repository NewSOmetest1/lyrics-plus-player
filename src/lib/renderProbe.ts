/**
 * Render-count probe for performance verification builds only.
 * Enable with VITE_LYRICS_PERF=1; a normal build compiles the guard to false.
 */
const ENABLED = import.meta.env.VITE_LYRICS_PERF === "1";
const counts = new Map<string, number>();

if (ENABLED && typeof window !== "undefined") {
  window.setInterval(() => {
    if (counts.size === 0) return;
    const snapshot: Record<string, number> = {};
    for (const [name, value] of counts) snapshot[name] = value;
    counts.clear();
    console.log(`[perf-render] ${JSON.stringify(snapshot)}`);
  }, 1000);
}

/** Count one render of the calling component. No-op in normal builds. */
export function useRenderProbe(name: string): void {
  if (!ENABLED) return;
  counts.set(name, (counts.get(name) ?? 0) + 1);
}
