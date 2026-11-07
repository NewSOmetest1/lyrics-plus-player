import { create } from "zustand";

export type LucidBackgroundStyle = "static" | "ambient" | "solid";
export type LucidLayoutMode = "card" | "compact";
export type LucidFontChoice = "inter" | "jakarta" | "spotify" | "system";
export type LucidBorderStyle = "solid" | "none";
export type LucidColorTheme = "dynamic" | "static";
export type LucidColorScheme = "tonal" | "vibrant" | "muted";

export interface LucidSettingsConfig {
  floatingModal: boolean;
  backgroundStyle: LucidBackgroundStyle;

  layoutMode: LucidLayoutMode;
  bodyFont: LucidFontChoice;
  headingFont: LucidFontChoice;
  borderWidth: number;
  uiRadius: number;
  borderColor: string;
  hoverBorderColor: string;
  borderStyle: LucidBorderStyle;
  autoHideLibrary: boolean;

  glassBlur: number;
  glassOpacity: number;

  colorTheme: LucidColorTheme;
  colorScheme: LucidColorScheme;
  uiTinting: boolean;
  lightMode: boolean;

  playerFloating: boolean;
  playerHeight: number;
  playerSliderHeight: number;
  playerCoverRadius: number;

  scalingEffect: boolean;
  ambientBlur: number;
  ambientBrightness: number;
  ambientContrast: number;
  ambientSaturation: number;
  ambientOpacity: number;
}

export const DEFAULT_LUCID_SETTINGS: LucidSettingsConfig = {
  floatingModal: true,
  backgroundStyle: "ambient",

  layoutMode: "card",
  bodyFont: "inter",
  headingFont: "jakarta",
  borderWidth: 1,
  uiRadius: 14,
  borderColor: "#ffffff",
  hoverBorderColor: "#ffffff",
  borderStyle: "solid",
  autoHideLibrary: false,

  glassBlur: 24,
  glassOpacity: 55,

  colorTheme: "dynamic",
  colorScheme: "tonal",
  uiTinting: true,
  lightMode: false,

  playerFloating: true,
  playerHeight: 72,
  playerSliderHeight: 3,
  playerCoverRadius: 10,

  scalingEffect: true,
  ambientBlur: 26,
  ambientBrightness: 65,
  ambientContrast: 100,
  ambientSaturation: 150,
  ambientOpacity: 80,
};

export const LUCID_LIMITS = {
  borderWidth: { min: 0, max: 6, step: 1, unit: "px" },
  uiRadius: { min: 0, max: 28, step: 1, unit: "px" },
  glassBlur: { min: 0, max: 60, step: 1, unit: "px" },
  glassOpacity: { min: 0, max: 100, step: 1, unit: "%" },
  playerHeight: { min: 40, max: 110, step: 1, unit: "px" },
  playerSliderHeight: { min: 1, max: 10, step: 1, unit: "px" },
  playerCoverRadius: { min: 0, max: 32, step: 1, unit: "px" },
  ambientBlur: { min: 0, max: 80, step: 1, unit: "px" },
  ambientBrightness: { min: 0, max: 150, step: 5, unit: "%" },
  ambientContrast: { min: 50, max: 200, step: 5, unit: "%" },
  ambientSaturation: { min: 0, max: 300, step: 5, unit: "%" },
  ambientOpacity: { min: 0, max: 100, step: 1, unit: "%" },
} as const;

export type LucidNumericKey = keyof typeof LUCID_LIMITS;

export const FONT_STACKS: Record<LucidFontChoice, string> = {
  inter: "Inter, Manrope, system-ui, -apple-system, 'Segoe UI', sans-serif",
  jakarta:
    "'Plus Jakarta Sans', Inter, Manrope, system-ui, -apple-system, sans-serif",
  spotify:
    "'SpotifyMixUI', 'CircularSp-Cyrl', Inter, Manrope, system-ui, -apple-system, sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

/** Spotify uses its display cut for titles and the UI cut for body copy. */
export const HEADING_FONT_STACKS: Record<LucidFontChoice, string> = {
  ...FONT_STACKS,
  spotify:
    "'SpotifyMixUITitle', 'CircularSp-Cyrl', Inter, Manrope, system-ui, -apple-system, sans-serif",
};

const STORAGE_KEY = "lucidSettings";

const BOOLEAN_KEYS = [
  "floatingModal",
  "autoHideLibrary",
  "uiTinting",
  "lightMode",
  "playerFloating",
  "scalingEffect",
] as const satisfies ReadonlyArray<keyof LucidSettingsConfig>;

const COLOR_KEYS = [
  "borderColor",
  "hoverBorderColor",
] as const satisfies ReadonlyArray<keyof LucidSettingsConfig>;

export const LUCID_ENUM_OPTIONS = {
  backgroundStyle: [
    { value: "static", label: "Static Image" },
    { value: "ambient", label: "Dynamic Ambient" },
    { value: "solid", label: "Solid" },
  ],
  layoutMode: [
    { value: "card", label: "Card" },
    { value: "compact", label: "Compact" },
  ],
  bodyFont: [
    { value: "inter", label: "Inter" },
    { value: "jakarta", label: "Plus Jakarta Sans" },
    { value: "spotify", label: "Spotify Mix (Lyrics+)" },
    { value: "system", label: "System-UI" },
  ],
  headingFont: [
    { value: "inter", label: "Inter" },
    { value: "jakarta", label: "Plus Jakarta Sans" },
    { value: "spotify", label: "Spotify Mix (Lyrics+)" },
    { value: "system", label: "System-UI" },
  ],
  borderStyle: [
    { value: "solid", label: "Solid" },
    { value: "none", label: "None" },
  ],
  colorTheme: [
    { value: "dynamic", label: "Dynamic (cover art)" },
    { value: "static", label: "Static accent" },
  ],
  colorScheme: [
    { value: "tonal", label: "Tonal Spot" },
    { value: "vibrant", label: "Vibrant" },
    { value: "muted", label: "Muted" },
  ],
} as const;

type EnumKey = keyof typeof LUCID_ENUM_OPTIONS;

const ENUM_KEYS = Object.keys(LUCID_ENUM_OPTIONS) as EnumKey[];
const NUMERIC_KEYS = Object.keys(LUCID_LIMITS) as LucidNumericKey[];
const SETTING_KEYS = Object.keys(DEFAULT_LUCID_SETTINGS) as Array<
  keyof LucidSettingsConfig
>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function clampNumber(value: number, key: LucidNumericKey): number {
  const { min, max, step } = LUCID_LIMITS[key];
  const rounded = Math.round(value / step) * step;
  return Number(Math.min(max, Math.max(min, rounded)).toFixed(3));
}

/** Validate untrusted JSON, localStorage data or import payloads. */
export function sanitizeLucidSettings(input: unknown): LucidSettingsConfig {
  const raw =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const next: LucidSettingsConfig = { ...DEFAULT_LUCID_SETTINGS };

  for (const key of BOOLEAN_KEYS) {
    if (typeof raw[key] === "boolean") next[key] = raw[key] as never;
  }

  for (const key of NUMERIC_KEYS) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = clampNumber(value, key) as never;
    }
  }

  for (const key of ENUM_KEYS) {
    const value = raw[key];
    if (
      typeof value === "string" &&
      (LUCID_ENUM_OPTIONS[key] as ReadonlyArray<{ value: string }>).some(
        (option) => option.value === value,
      )
    ) {
      next[key] = value as never;
    }
  }

  for (const key of COLOR_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && HEX_COLOR.test(value)) {
      next[key] = value.toLowerCase() as never;
    }
  }

  return next;
}

function readStoredConfig(): LucidSettingsConfig {
  if (typeof window === "undefined") return { ...DEFAULT_LUCID_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LUCID_SETTINGS };
    const parsed = JSON.parse(raw) as unknown;
    const container =
      parsed && typeof parsed === "object" && "lucidSettings" in parsed
        ? (parsed as { lucidSettings: unknown }).lucidSettings
        : parsed;
    return sanitizeLucidSettings(container);
  } catch {
    return { ...DEFAULT_LUCID_SETTINGS };
  }
}

function persistConfig(config: LucidSettingsConfig): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage is best-effort; live styling still works.
  }
}

export function applyLucidSettings(config: LucidSettingsConfig): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const set = (name: string, value: string) =>
    root.style.setProperty(name, value);

  set("--lucid-border-width", `${config.borderWidth}px`);
  set("--lucid-border-color", config.borderColor);
  set("--lucid-hover-border-color", config.hoverBorderColor);
  set("--lucid-border-radius", `${config.uiRadius}px`);
  set("--lucid-border-style", config.borderStyle);
  set("--lucid-font-body", FONT_STACKS[config.bodyFont]);
  set("--lucid-font-heading", HEADING_FONT_STACKS[config.headingFont]);

  set("--lucid-glass-blur", `${config.glassBlur}px`);
  set(
    "--lucid-glass-bg",
    `rgba(18, 18, 24, ${(config.glassOpacity / 100).toFixed(2)})`,
  );

  set("--lucid-player-height", `${config.playerHeight}px`);
  set("--lucid-player-slider-height", `${config.playerSliderHeight}px`);
  set("--lucid-player-cover-radius", `${config.playerCoverRadius}px`);

  set("--lucid-ambient-blur", `${config.ambientBlur}px`);
  set("--lucid-ambient-brightness", `${config.ambientBrightness}%`);
  set("--lucid-ambient-contrast", `${config.ambientContrast}%`);
  set("--lucid-ambient-saturate", `${config.ambientSaturation}%`);
  set("--lucid-ambient-opacity", String(config.ambientOpacity / 100));
  set("--lucid-ambient-scale", config.scalingEffect ? "1.1" : "1");

  root.dataset.lucidLayout = config.layoutMode;
  root.dataset.lucidPlayerFloating = config.playerFloating ? "true" : "false";
  root.dataset.lucidLight = config.lightMode ? "true" : "false";
  root.dataset.lucidBackground = config.backgroundStyle;
  root.dataset.lucidTinting = config.uiTinting ? "true" : "false";
  root.dataset.lucidColorTheme = config.colorTheme;
  root.dataset.lucidColorScheme = config.colorScheme;
  root.dataset.lucidFloatingModal = config.floatingModal ? "true" : "false";
}

interface LucidStoreState extends LucidSettingsConfig {
  open: boolean;
  initialized: boolean;
  init: () => void;
  update: (patch: Partial<LucidSettingsConfig>) => void;
  replace: (input: unknown) => boolean;
  importConfig: (json: string) => boolean;
  exportConfig: () => string;
  reset: () => void;
  openDialog: () => void;
  closeDialog: () => void;
}

function configFromState(state: LucidSettingsConfig): LucidSettingsConfig {
  const config = {} as LucidSettingsConfig;
  for (const key of SETTING_KEYS) {
    (config as unknown as Record<string, unknown>)[key] = state[key];
  }
  return config;
}

function applyAndPersist(config: LucidSettingsConfig): void {
  applyLucidSettings(config);
  persistConfig(config);
}

const initialConfig = readStoredConfig();
applyLucidSettings(initialConfig);

export const useLucidSettingsStore = create<LucidStoreState>((set, get) => ({
  ...initialConfig,
  open: false,
  initialized: false,

  init: () => {
    const config = readStoredConfig();
    set({ ...config, initialized: true });
    applyLucidSettings(config);
    persistConfig(config);
  },

  update: (patch) => {
    const next = sanitizeLucidSettings({
      ...configFromState(get()),
      ...patch,
    });
    set(next);
    applyAndPersist(next);
  },

  replace: (input) => {
    const next = sanitizeLucidSettings(input);
    set(next);
    applyAndPersist(next);
    return true;
  },

  importConfig: (json) => {
    try {
      const parsed = JSON.parse(json) as unknown;
      const container =
        parsed && typeof parsed === "object" && "lucidSettings" in parsed
          ? (parsed as { lucidSettings: unknown }).lucidSettings
          : parsed;
      if (!container || typeof container !== "object") return false;
      get().replace(container);
      return true;
    } catch {
      return false;
    }
  },

  exportConfig: () => JSON.stringify(configFromState(get()), null, 2),

  reset: () => {
    const next = { ...DEFAULT_LUCID_SETTINGS };
    set(next);
    applyAndPersist(next);
  },

  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
}));
