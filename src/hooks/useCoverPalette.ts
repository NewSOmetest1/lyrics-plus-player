import { useEffect, useMemo, useState } from "react";
import type { Palette } from "@/types";
import { extractPalette, paletteFromHash } from "@/lib/colors";

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
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";

    image.onload = () => {
      if (cancelled) return;
      try {
        setPalette(extractPalette(image));
      } catch {
        setPalette(fallback);
      }
    };
    image.onerror = () => {
      if (!cancelled) setPalette(fallback);
    };
    image.src = url;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [url, fallback]);

  return palette;
}
