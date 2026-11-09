import { useEffect, useMemo, useState } from "react";
import type { Palette } from "@/types";
import { extractPalette, paletteFromHash } from "@/lib/colors";

/**
 * Palette extraction is expensive: colorthief scans the decoded bitmap and the
 * old hook re-did it for every mount. Cache the result by artwork URL and share
 * in-flight work. Sampling a downscaled canvas was measured to pick different
 * dominant swatches on real covers, which visibly shifted accent colors, so we
 * keep the source artwork as migration left it and only remove repeated work.
 */
const PALETTE_CACHE_LIMIT = 200;

const paletteCache = new Map<string, Palette>();
const pendingPalettes = new Map<string, Promise<Palette | null>>();

function rememberPalette(url: string, palette: Palette): void {
  if (paletteCache.size >= PALETTE_CACHE_LIMIT) {
    const oldest = paletteCache.keys().next().value;
    if (oldest !== undefined) paletteCache.delete(oldest);
  }
  paletteCache.set(url, palette);
}

function loadPalette(url: string): Promise<Palette | null> {
  const cached = paletteCache.get(url);
  if (cached) return Promise.resolve(cached);

  const pending = pendingPalettes.get(url);
  if (pending) return pending;

  const task = new Promise<Palette | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";

    image.onload = () => {
      try {
        const palette = extractPalette(image);
        rememberPalette(url, palette);
        resolve(palette);
      } catch {
        // Tainted canvas (remote art without CORS) cannot be sampled.
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  }).finally(() => {
    pendingPalettes.delete(url);
  });

  pendingPalettes.set(url, task);
  return task;
}

export function useCoverPalette(url: string | null, seed: string): Palette {
  const fallback = useMemo(() => paletteFromHash(seed), [seed]);
  const [palette, setPalette] = useState<Palette>(fallback);

  useEffect(() => {
    if (!url) {
      setPalette(fallback);
      return;
    }

    // Keep the previous track's palette until the new cover is decoded. A hash
    // fallback in between would flash a random hue before the crossfade.
    let cancelled = false;
    void loadPalette(url).then((next) => {
      if (!cancelled && next) setPalette(next);
    });

    return () => {
      cancelled = true;
    };
  }, [url, fallback]);

  return palette;
}
