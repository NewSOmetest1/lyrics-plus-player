import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { coverPaletteUrl, coverUrl } from "@/lib/api";
import { hexToRgb, hslToHex, rgbToHsl, withAlpha } from "@/lib/colors";
import { useCoverPalette } from "@/hooks/useCoverPalette";
import { useRenderProbe } from "@/lib/renderProbe";
import { usePlayerStore } from "@/store/playerStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useLucidSettingsStore } from "@/store/lucidSettingsStore";

const STATIC_ACCENT = "#f5a524";
const MONOCHROME_BACKGROUND =
  "linear-gradient(160deg, #101014 0%, #16161c 100%)";

function tuneAccent(hex: string, scheme: "tonal" | "vibrant" | "muted"): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [hue, saturation, lightness] = rgbToHsl(rgb.r, rgb.g, rgb.b);
  if (scheme === "vibrant") {
    return hslToHex(
      hue,
      Math.min(1, Math.max(0.66, saturation * 1.2 + 0.08)),
      Math.min(0.72, Math.max(0.5, lightness)),
    );
  }
  if (scheme === "muted") {
    return hslToHex(
      hue,
      Math.max(0.16, saturation * 0.55),
      Math.min(0.64, Math.max(0.42, lightness * 0.92)),
    );
  }
  return hslToHex(hue, saturation, lightness);
}

function shiftHue(hex: string, degrees: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [hue, saturation, lightness] = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return hslToHex(hue + degrees, saturation, lightness);
}

/**
 * Two fixed gradient slots. The incoming palette is written into the hidden
 * slot, then both slots swap opacity. CSS transitions finish the crossfade
 * without keeping a growing stack of exiting layers.
 */
function AmbientGlow({ background }: { background: string }) {
  const [slots, setSlots] = useState<[string, string]>([
    background,
    background,
  ]);
  const [active, setActive] = useState(0);
  const lastBackground = useRef(background);

  useEffect(() => {
    if (lastBackground.current === background) return;
    lastBackground.current = background;
    const next = active === 0 ? 1 : 0;
    setSlots((current) => {
      const updated: [string, string] = [current[0], current[1]];
      updated[next] = background;
      return updated;
    });
    setActive(next);
  }, [background, active]);

  return (
    <div
      aria-hidden
      className="ambient-blobs absolute -inset-16 mix-blend-screen"
    >
      {slots.map((slot, index) => (
        <div
          key={index}
          className="absolute inset-0"
          style={{
            background: slot,
            opacity: active === index ? 1 : 0,
            transition:
              "background 0.8s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)",
          }}
        />
      ))}
    </div>
  );
}

export function AmbientBackground() {
  useRenderProbe("Ambient");
  const track = usePlayerStore((state) => state.currentTrack);
  const image = coverUrl(track, true);
  const palette = useCoverPalette(
    coverPaletteUrl(track),
    track ? `${track.title}${track.album}` : "lyricsplus",
  );
  const colorful = useSettingsStore((state) => state.ambientColorful);
  const noise = useSettingsStore((state) => state.noiseOverlay);
  const accentColor = useSettingsStore((state) => state.accentColor);

  const backgroundStyle = useLucidSettingsStore(
    (state) => state.backgroundStyle,
  );
  const colorTheme = useLucidSettingsStore((state) => state.colorTheme);
  const colorScheme = useLucidSettingsStore((state) => state.colorScheme);

  const { accent, secondary, monochrome } = useMemo(() => {
    if (colorTheme === "dynamic" && palette.monochrome) {
      // Achromatic art must stay achromatic: white/silver accent on graphite.
      return {
        accent: "#ffffff",
        secondary: "#cbd5e1",
        monochrome: true,
      };
    }
    const base =
      colorTheme === "dynamic"
        ? palette.primary
        : accentColor === "auto"
          ? STATIC_ACCENT
          : accentColor;
    return {
      accent: tuneAccent(base, colorScheme),
      secondary:
        colorTheme === "dynamic"
          ? tuneAccent(palette.secondary, colorScheme)
          : shiftHue(tuneAccent(base, colorScheme), 34),
      monochrome: false,
    };
  }, [palette, accentColor, colorTheme, colorScheme]);

  useEffect(() => {
    const root = document.documentElement;
    const rgb = hexToRgb(accent);
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-soft", withAlpha(accent, 0.16));
    root.style.setProperty("--accent-glow", withAlpha(accent, 0.42));
    root.style.setProperty("--lucid-accent-secondary", secondary);
    if (rgb) {
      root.style.setProperty(
        "--accent-color",
        `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      );
      root.style.setProperty(
        "--ambient-glow",
        `radial-gradient(circle at 50% 30%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.45) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15) 55%, transparent 100%)`,
      );
    }
  }, [accent, secondary]);

  const glowBackground = `radial-gradient(circle at 50% 30%, ${withAlpha(accent, 0.45)} 0%, ${withAlpha(accent, 0.15)} 55%, transparent 100%)`;
  const blobsBackground = `${glowBackground}, radial-gradient(58% 62% at 18% 12%, ${withAlpha(accent, 0.95)} 0%, transparent 72%), radial-gradient(55% 58% at 84% 18%, ${withAlpha(secondary, 0.8)} 0%, transparent 74%), radial-gradient(60% 55% at 62% 96%, ${withAlpha(accent, 0.7)} 0%, transparent 76%)`;

  const showCover =
    Boolean(image) && backgroundStyle !== "solid" && colorful;
  const showBlobs = backgroundStyle === "ambient" && colorful;

  return (
    <div
      className="ambient-layer pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#0a0a0c]"
      data-style={backgroundStyle}
      style={monochrome ? { background: MONOCHROME_BACKGROUND } : undefined}
    >
      <AnimatePresence initial={false} mode="sync">
        {showCover && (
          <motion.div
            key={track?.id ?? "cover"}
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: backgroundStyle === "static" ? 0.45 : 0.8, ease: "easeInOut" }}
            className={`ambient-cover absolute -inset-16 bg-cover bg-center${
              monochrome ? " ambient-cover-mono" : ""
            }`}
            style={{ backgroundImage: `url("${image}")` }}
          />
        )}
      </AnimatePresence>

      {showBlobs && <AmbientGlow background={blobsBackground} />}

      {backgroundStyle === "solid" && (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: monochrome
              ? `radial-gradient(70% 65% at 50% 0%, rgba(255, 255, 255, 0.06) 0%, transparent 62%), ${MONOCHROME_BACKGROUND}`
              : "radial-gradient(70% 65% at 50% 0%, var(--accent-soft) 0%, transparent 62%), linear-gradient(180deg, #101014 0%, #0a0a0c 100%)",
          }}
        />
      )}

      <div
        aria-hidden
        className="ambient-dim absolute inset-0 bg-[#0a0a0c]/10"
      />
      <div className="ambient-vignette absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(5,5,8,0.12)_55%,rgba(5,5,8,0.68)_100%)]" />
      <div className="ambient-fade absolute inset-0 bg-[linear-gradient(180deg,rgba(10,10,12,0.35)_0%,transparent_26%,transparent_74%,rgba(10,10,12,0.5)_100%)]" />
      <div className="ambient-light-veil absolute inset-0" />
      {noise && (
        <div className="absolute inset-0 opacity-[0.045] mix-blend-overlay grain" />
      )}
    </div>
  );
}
