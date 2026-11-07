import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  ClipboardCopy,
  Droplets,
  Filter,
  HelpCircle,
  Image,
  Layers,
  LayoutDashboard,
  Minus,
  Music2,
  Palette,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";

import {
  DEFAULT_LUCID_SETTINGS,
  LUCID_ENUM_OPTIONS,
  LUCID_LIMITS,
  useLucidSettingsStore,
  type LucidNumericKey,
  type LucidSettingsConfig,
} from "@/store/lucidSettingsStore";
import { useToastStore } from "@/store/toastStore";
import { cn } from "@/lib/cn";

const EASE = [0.2, 0, 0, 1] as const;

type GroupId =
  | "modal"
  | "background"
  | "ui"
  | "glass"
  | "colors"
  | "player"
  | "filters";

interface FieldMeta {
  label: string;
  description: string;
  group: GroupId;
}

const FIELD_META: Record<keyof LucidSettingsConfig, FieldMeta> = {
  floatingModal: {
    label: "Floating Modal",
    description: "Detach the settings window and blur the canvas behind it.",
    group: "modal",
  },
  backgroundStyle: {
    label: "Background Style",
    description: "Pick how the app canvas is painted behind the interface.",
    group: "background",
  },

  layoutMode: {
    label: "Layout Mode",
    description: "Card keeps roomy panels; Compact tightens spacing and corners.",
    group: "ui",
  },
  bodyFont: {
    label: "Body Font",
    description:
      "Typeface used for labels, lists and controls. Spotify Mix matches lyrics-plus.",
    group: "ui",
  },
  headingFont: {
    label: "Heading Font",
    description:
      "Typeface used for titles and section headings. Spotify Mix uses its display cut.",
    group: "ui",
  },
  borderWidth: {
    label: "Border Thickness",
    description: "Thickness of glass panel borders.",
    group: "ui",
  },
  uiRadius: {
    label: "UI Corner Radius",
    description: "Rounding applied to glass panels and large surfaces.",
    group: "ui",
  },
  borderColor: {
    label: "Border Color",
    description: "Tint used for resting panel borders.",
    group: "ui",
  },
  hoverBorderColor: {
    label: "Hover Border Color",
    description: "Tint shown when a glass surface is hovered.",
    group: "ui",
  },
  borderStyle: {
    label: "Border Style",
    description: "Draw solid borders or remove them entirely.",
    group: "ui",
  },
  autoHideLibrary: {
    label: "Auto-Hide Library",
    description: "Hide the left library until you move the pointer to the edge.",
    group: "ui",
  },

  glassBlur: {
    label: "Blur Amount",
    description:
      "Shared backdrop blur applied identically to all four glass panels.",
    group: "glass",
  },
  glassOpacity: {
    label: "Opacity",
    description:
      "Shared glass background opacity for sidebar, main view, right panel and player.",
    group: "glass",
  },

  colorTheme: {
    label: "Color Theme",
    description: "Dynamic samples the cover; Static uses your accent color.",
    group: "colors",
  },
  colorScheme: {
    label: "Color Scheme Style",
    description: "Controls saturation and brightness of the generated accent.",
    group: "colors",
  },
  uiTinting: {
    label: "Enable UI Tinting",
    description: "Wash glass panels with the current accent color.",
    group: "colors",
  },
  lightMode: {
    label: "Enable Light Mode",
    description: "Experimental light palette for the whole interface.",
    group: "colors",
  },

  playerFloating: {
    label: "Make the Player Floating",
    description: "Lift the player bar off the window edges.",
    group: "player",
  },
  playerHeight: {
    label: "Height",
    description: "Height of the player bar.",
    group: "player",
  },
  playerSliderHeight: {
    label: "Slider Height",
    description: "Thickness of the seek progress track.",
    group: "player",
  },
  playerCoverRadius: {
    label: "Cover Radius",
    description: "Corner rounding of the album cover inside the player.",
    group: "player",
  },

  scalingEffect: {
    label: "Enable Scaling Effect",
    description: "Slightly scale the ambient background for extra depth.",
    group: "filters",
  },
  ambientBlur: {
    label: "Blur Amount",
    description: "Blur applied to the ambient cover and color blobs.",
    group: "filters",
  },
  ambientBrightness: {
    label: "Brightness",
    description: "Brightness of the ambient background layer.",
    group: "filters",
  },
  ambientContrast: {
    label: "Contrast",
    description: "Contrast of the ambient background layer.",
    group: "filters",
  },
  ambientSaturation: {
    label: "Saturation",
    description: "Color intensity of the ambient background.",
    group: "filters",
  },
  ambientOpacity: {
    label: "Opacity",
    description: "Overall opacity of the ambient background.",
    group: "filters",
  },
};

const SECTIONS: Array<{
  id: GroupId;
  title: string;
  description: string;
  icon: typeof Sparkles;
  fields: Array<keyof LucidSettingsConfig>;
}> = [
  {
    id: "modal",
    title: "Modal Settings",
    description: "Window chrome and backdrop",
    icon: SlidersHorizontal,
    fields: ["floatingModal"],
  },
  {
    id: "background",
    title: "Background",
    description: "Canvas behind the interface",
    icon: Image,
    fields: ["backgroundStyle"],
  },
  {
    id: "ui",
    title: "UI Settings",
    description: "Typography, borders and layout",
    icon: LayoutDashboard,
    fields: [
      "layoutMode",
      "bodyFont",
      "headingFont",
      "borderWidth",
      "uiRadius",
      "borderColor",
      "hoverBorderColor",
      "borderStyle",
      "autoHideLibrary",
    ],
  },
  {
    id: "glass",
    title: "Glass",
    description: "One shared surface for all panels",
    icon: Layers,
    fields: ["glassBlur", "glassOpacity"],
  },
  {
    id: "colors",
    title: "Colors",
    description: "Theme generation and tinting",
    icon: Droplets,
    fields: ["colorTheme", "colorScheme", "uiTinting", "lightMode"],
  },
  {
    id: "player",
    title: "Player",
    description: "Bottom bar geometry and controls",
    icon: Music2,
    fields: [
      "playerFloating",
      "playerHeight",
      "playerSliderHeight",
      "playerCoverRadius",
    ],
  },
  {
    id: "filters",
    title: "Under Main View",
    description: "Ambient background filters",
    icon: Filter,
    fields: [
      "scalingEffect",
      "ambientBlur",
      "ambientBrightness",
      "ambientContrast",
      "ambientSaturation",
      "ambientOpacity",
    ],
  },
];

const TABS = [
  { id: "all", label: "All" },
  { id: "modal", label: "Modal Settings" },
  { id: "background", label: "Background" },
  { id: "ui", label: "UI Settings" },
  { id: "glass", label: "Glass" },
  { id: "colors", label: "Colors" },
  { id: "player", label: "Player" },
  { id: "filters", label: "Filters" },
  { id: "advanced", label: "Advanced" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isNumericField(
  field: keyof LucidSettingsConfig,
): field is LucidNumericKey {
  return field in LUCID_LIMITS;
}

function isEnumField(
  field: keyof LucidSettingsConfig,
): field is keyof typeof LUCID_ENUM_OPTIONS {
  return field in LUCID_ENUM_OPTIONS;
}

function isColorField(field: keyof LucidSettingsConfig): boolean {
  return field === "borderColor" || field === "hoverBorderColor";
}

function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const ref = useRef<HTMLButtonElement | null>(null);

  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 232;
    setPosition({
      left: Math.min(
        Math.max(8, rect.left + rect.width / 2 - width / 2),
        window.innerWidth - width - 8,
      ),
      top: rect.bottom + 8,
    });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label="More information"
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white/20 outline-none transition hover:text-white/60 focus-visible:text-white/70"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open &&
        createPortal(
          <div
            style={{ left: position.left, top: position.top }}
            className="popover-content pointer-events-none fixed z-[240] w-[232px] rounded-xl border border-white/10 bg-[#16161d]/95 px-3 py-2 text-[10.5px] leading-relaxed text-white/60 shadow-2xl backdrop-blur-xl"
            role="tooltip"
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}

function ToggleControl({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="toggle-switch shrink-0"
    >
      <span className="toggle-thumb" />
    </button>
  );
}

function StepperControl({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const clamped = Math.min(max, Math.max(min, value));
  const display = unit === "%" ? `${clamped}%` : `${clamped} ${unit}`;
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={clamped <= min}
        onClick={() => onChange(Math.max(min, clamped - step))}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04] text-white/45 transition hover:bg-white/[0.09] hover:text-white disabled:pointer-events-none disabled:opacity-25"
      >
        <Minus className="h-3 w-3" />
      </button>
      <span
        aria-live="polite"
        className="min-w-[62px] rounded-lg border border-white/[0.07] bg-white/[0.035] px-2 py-1.5 text-center text-[10.5px] font-semibold tabular-nums text-white/75"
      >
        {display}
      </span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={clamped >= max}
        onClick={() => onChange(Math.min(max, clamped + step))}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04] text-white/45 transition hover:bg-white/[0.09] hover:text-white disabled:pointer-events-none disabled:opacity-25"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

const selectClass =
  "h-8 w-[176px] appearance-none rounded-lg border border-white/[0.08] bg-white/[0.05] pl-2.5 pr-7 text-[10.5px] font-medium text-white/75 outline-none transition hover:bg-white/[0.08] focus:border-accent/40";

function SelectControl({
  value,
  options,
  label,
  onChange,
}: {
  value: string;
  options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative shrink-0">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={selectClass}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            className="bg-[#16161a]"
          >
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-white/35" />
    </div>
  );
}

function ColorControl({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="w-[68px] text-right font-mono text-[9.5px] uppercase tracking-wide text-white/30">
        {value}
      </span>
      <label
        title={`Choose ${label.toLowerCase()}`}
        className="relative h-7 w-9 cursor-pointer overflow-hidden rounded-lg border border-white/10"
        style={{ backgroundColor: value }}
      >
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <button
        type="button"
        aria-label={`Reset ${label}`}
        title="Reset color"
        onClick={() => onChange(fallback)}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04] text-white/35 transition hover:bg-white/[0.09] hover:text-white/80"
      >
        <RotateCcw className="h-3 w-3" />
      </button>
    </div>
  );
}

function FieldRow({
  field,
  config,
  update,
}: {
  field: keyof LucidSettingsConfig;
  config: LucidSettingsConfig;
  update: (patch: Partial<LucidSettingsConfig>) => void;
}) {
  const meta = FIELD_META[field];
  const value = config[field];

  let control: React.ReactNode;
  if (typeof value === "boolean") {
    control = (
      <ToggleControl
        label={meta.label}
        checked={value}
        onChange={(next) => update({ [field]: next } as Partial<LucidSettingsConfig>)}
      />
    );
  } else if (isNumericField(field)) {
    const limits = LUCID_LIMITS[field];
    control = (
      <StepperControl
        label={meta.label}
        value={value as number}
        unit={limits.unit}
        min={limits.min}
        max={limits.max}
        step={limits.step}
        onChange={(next) =>
          update({ [field]: next } as Partial<LucidSettingsConfig>)
        }
      />
    );
  } else if (isEnumField(field)) {
    const options = LUCID_ENUM_OPTIONS[field] as ReadonlyArray<{
      readonly value: string;
      readonly label: string;
    }>;
    control = (
      <SelectControl
        label={meta.label}
        value={String(value)}
        options={options}
        onChange={(next) =>
          update({ [field]: next } as Partial<LucidSettingsConfig>)
        }
      />
    );
  } else if (isColorField(field)) {
    const fallback = DEFAULT_LUCID_SETTINGS[field] as string;
    control = (
      <ColorControl
        label={meta.label}
        value={String(value)}
        fallback={fallback}
        onChange={(next) =>
          update({ [field]: next } as Partial<LucidSettingsConfig>)
        }
      />
    );
  }

  return (
    <div className="flex min-h-[54px] items-center justify-between gap-4 px-4 py-2.5">
      <div className="flex min-w-0 items-start gap-1.5">
        <div className="min-w-0">
          <span className="block text-[11.5px] font-semibold text-white/75">
            {meta.label}
          </span>
          <p className="mt-0.5 text-[10px] leading-relaxed text-white/30">
            {meta.description}
          </p>
        </div>
        <div className="mt-0.5">
          <InfoTip text={meta.description} />
        </div>
      </div>
      {control}
    </div>
  );
}

function SettingsSection({
  section,
  config,
  update,
}: {
  section: (typeof SECTIONS)[number];
  config: LucidSettingsConfig;
  update: (patch: Partial<LucidSettingsConfig>) => void;
}) {
  const Icon = section.icon;
  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.025]">
      <div className="flex items-center gap-2.5 border-b border-white/[0.05] px-4 py-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/[0.06] text-white/45">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div>
          <h3 className="text-[11.5px] font-bold text-white/85">{section.title}</h3>
          <p className="text-[9.5px] text-white/25">{section.description}</p>
        </div>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {section.fields.map((field) => (
          <FieldRow key={field} field={field} config={config} update={update} />
        ))}
      </div>
    </section>
  );
}

function AdvancedPanel({
  config,
  importConfig,
  exportConfig,
  reset,
}: {
  config: LucidSettingsConfig;
  importConfig: (json: string) => boolean;
  exportConfig: () => string;
  reset: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!confirmReset) return;
    const timer = window.setTimeout(() => setConfirmReset(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmReset]);

  const exportJson = useMemo(() => exportConfig(), [config, exportConfig]);

  const copy = async () => {
    const payload = exportConfig();
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      const area = document.createElement("textarea");
      area.value = payload;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    useToastStore.getState().push({
      kind: "success",
      title: "Configuration copied",
      description: "Lucid JSON is on your clipboard.",
    });
  };

  const applyImport = () => {
    const value = draft.trim();
    if (!value) return;
    if (importConfig(value)) {
      useToastStore.getState().push({
        kind: "success",
        title: "Configuration imported",
        description: "Lucid styles were applied instantly.",
      });
    } else {
      useToastStore.getState().push({
        kind: "error",
        title: "Invalid configuration",
        description: "Paste a valid Lucid settings JSON object.",
      });
    }
  };

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.025]">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] px-4 py-2.5">
          <div>
            <h3 className="text-[11.5px] font-bold text-white/85">
              Export Configuration
            </h3>
            <p className="text-[9.5px] text-white/25">
              Copy the complete Lucid JSON to your clipboard.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void copy()}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[10.5px] font-bold transition active:scale-[0.98]",
              copied
                ? "bg-emerald-400/15 text-emerald-300"
                : "bg-[var(--accent)] text-black hover:brightness-110",
            )}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <ClipboardCopy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="p-3">
          <textarea
            readOnly
            spellCheck={false}
            value={exportJson}
            aria-label="Exported Lucid configuration"
            className="no-scrollbar h-36 w-full resize-none rounded-lg border border-white/[0.06] bg-black/25 p-3 font-mono text-[9.5px] leading-relaxed text-white/40 outline-none"
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.025]">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] px-4 py-2.5">
          <div>
            <h3 className="text-[11.5px] font-bold text-white/85">
              Import Configuration
            </h3>
            <p className="text-[9.5px] text-white/25">
              Paste JSON, then apply it without reloading.
            </p>
          </div>
          <button
            type="button"
            onClick={applyImport}
            disabled={!draft.trim()}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.09] px-3 text-[10.5px] font-bold text-white/80 transition hover:bg-white/[0.14] disabled:pointer-events-none disabled:opacity-30"
          >
            <Wrench className="h-3.5 w-3.5" />
            Apply
          </button>
        </div>
        <div className="p-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                applyImport();
              }
            }}
            spellCheck={false}
            placeholder={'{\n  "playerHeight": 80,\n  "colorScheme": "vibrant"\n}'}
            aria-label="Import Lucid configuration"
            className="no-scrollbar h-32 w-full resize-none rounded-lg border border-white/[0.06] bg-black/25 p-3 font-mono text-[9.5px] leading-relaxed text-white/65 placeholder:text-white/15 outline-none transition focus:border-accent/35"
          />
          <p className="mt-2 text-[9px] text-white/20">
            Tip: Ctrl / Cmd + Enter applies immediately. Missing keys keep their
            defaults.
          </p>
        </div>
      </section>

      <section className="flex items-center justify-between gap-4 rounded-xl border border-rose-400/15 bg-rose-400/[0.045] px-4 py-3">
        <div>
          <h3 className="text-[11.5px] font-bold text-rose-200/90">Reset Theme</h3>
          <p className="text-[9.5px] text-white/25">
            Restore every Lucid style option to its default value.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true);
              return;
            }
            setConfirmReset(false);
            reset();
            useToastStore.getState().push({
              kind: "info",
              title: "Theme reset",
              description: "Lucid styles are back to defaults.",
            });
          }}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[10.5px] font-bold transition active:scale-[0.98]",
            confirmReset
              ? "bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,.35)]"
              : "border border-rose-400/25 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20",
          )}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {confirmReset ? "Click again to confirm" : "Reset theme"}
        </button>
      </section>
    </div>
  );
}

export function LucidSettingsDialog() {
  const config = useLucidSettingsStore();
  const open = config.open;
  const closeDialog = config.closeDialog;
  const update = config.update;
  const importConfig = config.importConfig;
  const exportConfig = config.exportConfig;
  const reset = config.reset;
  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const searchRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab("all");
    setQuery("");
    const timer = window.setTimeout(() => searchRef.current?.blur(), 40);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [tab, normalizedQuery]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeDialog]);

  const visibleSections = useMemo(() => {
    return SECTIONS.filter((section) => tab === "all" || section.id === tab)
      .map((section) => ({
        ...section,
        fields: section.fields.filter((field) => {
          if (!normalizedQuery) return true;
          const meta = FIELD_META[field];
          return (
            meta.label.toLowerCase().includes(normalizedQuery) ||
            meta.description.toLowerCase().includes(normalizedQuery) ||
            section.title.toLowerCase().includes(normalizedQuery)
          );
        }),
      }))
      .filter((section) => section.fields.length > 0);
  }, [tab, normalizedQuery]);

  const showAdvanced = tab === "advanced";
  const noResults =
    !showAdvanced && visibleSections.length === 0 && normalizedQuery.length > 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[170] flex items-center justify-center p-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE }}
        >
          <button
            type="button"
            aria-label="Close Lucid Settings"
            onClick={closeDialog}
            className={cn(
              "absolute inset-0 z-0 cursor-default",
              config.floatingModal
                ? "bg-black/55 backdrop-blur-[3px]"
                : "bg-black/75",
            )}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="lucid-settings-title"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.24, ease: EASE }}
            className={cn(
              "lucid-settings-modal relative z-10 flex w-full flex-col overflow-hidden",
              config.floatingModal
                ? "max-h-[min(88vh,800px)] max-w-[780px] rounded-2xl"
                : "h-[94vh] max-w-[1080px] rounded-xl",
            )}
          >
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_0_22px_var(--accent-glow)]">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2
                    id="lucid-settings-title"
                    className="truncate text-[15px] font-extrabold tracking-tight text-white"
                  >
                    Lucid Settings
                  </h2>
                  <p className="text-[10px] text-white/30">
                    Live appearance engine · changes apply instantly
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={closeDialog}
                  aria-label="Close"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-white/35 transition hover:bg-white/[0.07] hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto border-b border-white/[0.06] px-4 py-2.5">
              {TABS.map((item) => {
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    aria-pressed={active}
                    className={cn(
                      "h-7 shrink-0 whitespace-nowrap rounded-full px-3 text-[10.5px] font-semibold transition",
                      active
                        ? "bg-[var(--accent)] text-black shadow-[0_0_16px_var(--accent-glow)]"
                        : "bg-white/[0.045] text-white/40 hover:bg-white/[0.08] hover:text-white/75",
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.05] px-4 py-2.5">
              <label className="relative flex min-w-0 flex-1 items-center">
                <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-white/25" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search settings..."
                  aria-label="Search settings"
                  className="h-8 w-full rounded-lg border border-white/[0.07] bg-white/[0.035] pl-8 pr-8 text-[11px] text-white/80 outline-none transition placeholder:text-white/20 focus:border-accent/35 focus:bg-white/[0.06]"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute right-2 rounded p-0.5 text-white/25 transition hover:text-white/70"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </label>
              <span className="hidden shrink-0 items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-white/20 sm:flex">
                <Palette className="h-3 w-3" />
                Appearance
              </span>
            </div>

            <div
              ref={contentRef}
              className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3"
            >
              {showAdvanced ? (
                <AdvancedPanel
                  config={config}
                  importConfig={importConfig}
                  exportConfig={exportConfig}
                  reset={reset}
                />
              ) : noResults ? (
                <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 text-center">
                  <Search className="h-6 w-6 text-white/15" />
                  <p className="text-[12px] font-semibold text-white/45">
                    No settings match “{query.trim()}”
                  </p>
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="text-[10.5px] font-semibold text-[var(--accent)] transition hover:brightness-125"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleSections.map((section) => (
                    <SettingsSection
                      key={section.id}
                      section={section}
                      config={config}
                      update={update}
                    />
                  ))}
                </div>
              )}
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-2.5">
              <p className="text-[9.5px] text-white/25">
                Saved to <span className="font-mono text-white/35">localStorage</span>{" "}
                · CSS variables update live
              </p>
              <button
                type="button"
                onClick={closeDialog}
                className="rounded-lg bg-white/[0.08] px-3.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/[0.13] active:scale-[0.98]"
              >
                Done
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
