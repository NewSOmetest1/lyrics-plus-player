import { getPaletteSync } from "colorthief";
import type { Palette } from "@/types";

export function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(255, 154, 60, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const value = hex.replace("#", "").trim();
  if (value.length !== 6) return null;
  const int = Number.parseInt(value, 16);
  if (Number.isNaN(int)) return null;
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, s));
  const light = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
}

/**
 * Neutral palette for black-and-white / near-monochrome covers. A white accent
 * reads as intentional on graphite instead of inventing a hue from noise.
 */
const MONOCHROME_PALETTE: Palette = {
  primary: "#ffffff",
  secondary: "#cbd5e1",
  glow: withAlpha("#ffffff", 0.42),
  monochrome: true,
};

export function paletteFromHash(seed: string): Palette {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const primary = hslToHex(hue, 0.68, 0.6);
  const secondary = hslToHex(hue + 38, 0.62, 0.46);
  return {
    primary,
    secondary,
    glow: withAlpha(primary, 0.42),
    monochrome: false,
  };
}

type RgbTuple = [number, number, number];

interface ScoredSwatch {
  rgb: RgbTuple;
  hue: number;
  saturation: number;
  lightness: number;
  score: number;
}

function scoreSwatch(rgb: RgbTuple): ScoredSwatch {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  const delta = max - min;
  const denominator = 1 - Math.abs(2 * lightness - 1);
  const saturation = delta === 0 || denominator === 0 ? 0 : delta / denominator;
  const [hue] = rgbToHsl(r, g, b);

  return {
    rgb,
    hue,
    saturation,
    lightness,
    // Vibrant scoring used by ColorThief/Spotify-style extractors: reward
    // chroma twice as much as closeness to mid lightness.
    score: saturation * 2 + (1 - Math.abs(lightness - 0.5)),
  };
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

/**
 * Lift dark swatches into a readable accent range while keeping the hue the
 * cover actually contains. Near-monochrome swatches stay muted; vivid ones get
 * a small saturation boost so neon art stays neon.
 */
function accentFromSwatch(swatch: ScoredSwatch, vibrant: boolean): string {
  const saturation = vibrant
    ? Math.min(1, Math.max(0.55, swatch.saturation))
    : Math.min(0.2, Math.max(0.1, swatch.saturation));
  const lightness = Math.min(0.64, Math.max(0.5, swatch.lightness));
  return hslToHex(swatch.hue, saturation, lightness);
}

/**
 * Extract a vivid accent from cover art.
 *
 * ColorThief quantizes the image into 8 dominant swatches. Scoring each swatch
 * by saturation and mid-lightness avoids the old failure mode where a dark
 * cover's many near-black pixels dragged the mean saturation into monochrome.
 * Only a palette with no chromatic swatch at all is treated as black & white.
 */
export function extractPalette(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): Palette {
  let palette: ReturnType<typeof getPaletteSync>;
  try {
    palette = getPaletteSync(image, { colorCount: 8, quality: 10 });
  } catch {
    // Tainted canvas (remote art without CORS) cannot be sampled.
    return paletteFromHash("canvas");
  }

  if (!palette || palette.length === 0) return paletteFromHash("empty");

  const scored = palette.map((color) => scoreSwatch(color.array()));

  // Absolute monochrome: every dominant swatch is achromatic. A single
  // chromatic swatch is enough to keep the cover colorful.
  if (scored.every((swatch) => swatch.saturation < 0.08)) {
    return MONOCHROME_PALETTE;
  }

  // Ignore crushed shadows and blown highlights, as they carry no usable hue.
  const usable = scored.filter(
    (swatch) => swatch.lightness >= 0.15 && swatch.lightness <= 0.88,
  );
  const pool = (usable.length > 0 ? usable : scored)
    .slice()
    .sort((a, b) => b.score - a.score);

  const primarySwatch = pool[0];
  const vibrant = primarySwatch.saturation > 0.12;
  const primary = accentFromSwatch(primarySwatch, vibrant);

  const secondarySwatch = pool.find(
    (swatch) =>
      swatch !== primarySwatch &&
      swatch.saturation >= 0.25 &&
      swatch.lightness >= 0.3 &&
      hueDistance(swatch.hue, primarySwatch.hue) >= 20,
  );

  // A cover with one usable hue gets a deeper related tone instead of an
  // invented purple/green from shadow noise.
  const secondary = secondarySwatch
    ? accentFromSwatch(secondarySwatch, true)
    : hslToHex(
        primarySwatch.hue - 24,
        Math.max(0.25, Math.min(0.6, primarySwatch.saturation * 0.9)),
        Math.min(0.58, Math.max(0.38, primarySwatch.lightness * 0.78)),
      );

  return {
    primary,
    secondary,
    glow: withAlpha(primary, 0.45),
    monochrome: false,
  };
}
