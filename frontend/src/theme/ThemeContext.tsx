import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import logoLight from "../assets/logo_light.png";
import logoDark from "../assets/logo_dark.png";

// ─── Preset themes ────────────────────────────────────────────────────────────

export interface ThemeVars {
  "--bg": string;
  "--card": string;
  "--card2": string;
  "--text": string;
  "--muted": string;
  "--border": string;
  "--brand": string;
  "--brand2": string;
  "--danger": string;
  "--ok": string;
  // Amber/orange for "warn" or "conditional" states. --warn-bg is a
  // pre-mixed tinted background so callers don't need to compose rgba
  // strings against the theme's actual --bg.
  "--warn": string;
  "--warn-bg": string;
  // Pure yellow for the "scheduled to a job" cells in the admin month
  // view. Intentionally distinct from --warn (amber/orange) so admin
  // can tell at a glance whether yellow means scheduled vs conditional.
  "--scheduled": string;
  "--scheduled-bg": string;
  // Ink color for text on bright brand surfaces (primary buttons, active
  // tabs). Optional: when a preset omits it, the default Text-Color setting
  // drives `--on-brand` as before. A preset sets it when its brand color needs
  // a specific ink (e.g. the enterprise blue needs white, not the default dark
  // navy) so the button reads correctly without the user touching Text-Color.
  "--on-brand"?: string;
}

export interface ThemePreset {
  label: string;
  emoji: string;
  vars: ThemeVars;
}

export const THEME_PRESETS: Record<string, ThemePreset> = {
  "dark-ocean": {
    label: "Dark Ocean",
    emoji: "🌊",
    vars: {
      "--bg": "#0b1220",
      "--card": "#0f1a2e",
      "--card2": "#0c1628",
      "--text": "#e6edf7",
      "--muted": "#9fb0c8",
      "--border": "rgba(255,255,255,0.08)",
      "--brand": "#5dd6c2",
      "--brand2": "#6aa7ff",
      "--danger": "#ff6b6b",
      "--ok": "#2dd4bf",
      "--warn": "#f59e0b",
      "--warn-bg": "rgba(245,158,11,0.18)",
      "--scheduled": "#facc15",
      "--scheduled-bg": "rgba(250,204,21,0.30)",
    },
  },
  "midnight-purple": {
    label: "Midnight Purple",
    emoji: "🔮",
    vars: {
      "--bg": "#0d0b1a",
      "--card": "#130f2a",
      "--card2": "#0f0c22",
      "--text": "#e8e0f8",
      "--muted": "#9b8fc4",
      "--border": "rgba(255,255,255,0.08)",
      "--brand": "#a78bfa",
      "--brand2": "#c084fc",
      "--danger": "#f87171",
      "--ok": "#4ade80",
      "--warn": "#f59e0b",
      "--warn-bg": "rgba(245,158,11,0.18)",
      "--scheduled": "#facc15",
      "--scheduled-bg": "rgba(250,204,21,0.30)",
    },
  },
  "forest": {
    label: "Deep Forest",
    emoji: "🌲",
    vars: {
      "--bg": "#0a1a0f",
      "--card": "#0e2015",
      "--card2": "#0a1a11",
      "--text": "#e0f0e8",
      "--muted": "#8ab09a",
      "--border": "rgba(255,255,255,0.08)",
      "--brand": "#34d399",
      "--brand2": "#6ee7b7",
      "--danger": "#f87171",
      "--ok": "#34d399",
      "--warn": "#f59e0b",
      "--warn-bg": "rgba(245,158,11,0.18)",
      "--scheduled": "#facc15",
      "--scheduled-bg": "rgba(250,204,21,0.30)",
    },
  },
  "sunset": {
    label: "Sunset",
    emoji: "🌅",
    vars: {
      "--bg": "#1a0f0b",
      "--card": "#2a160e",
      "--card2": "#1f110a",
      "--text": "#f8e8e0",
      "--muted": "#c09088",
      "--border": "rgba(255,255,255,0.08)",
      "--brand": "#fb923c",
      "--brand2": "#fbbf24",
      "--danger": "#ef4444",
      "--ok": "#4ade80",
      // Sunset's brand IS amber, so warn shifts to a deeper rust to stay
      // distinguishable from --brand on this theme.
      "--warn": "#c2410c",
      "--warn-bg": "rgba(194,65,12,0.20)",
      "--scheduled": "#facc15",
      "--scheduled-bg": "rgba(250,204,21,0.30)",
    },
  },
  "steel": {
    label: "Steel",
    emoji: "⚙️",
    vars: {
      "--bg": "#0d1117",
      "--card": "#161b22",
      "--card2": "#0d1117",
      "--text": "#e6edf3",
      "--muted": "#8b949e",
      "--border": "rgba(255,255,255,0.1)",
      "--brand": "#58a6ff",
      "--brand2": "#79c0ff",
      "--danger": "#f85149",
      "--ok": "#3fb950",
      "--warn": "#f59e0b",
      "--warn-bg": "rgba(245,158,11,0.18)",
      "--scheduled": "#facc15",
      "--scheduled-bg": "rgba(250,204,21,0.30)",
    },
  },
  "light": {
    label: "Light",
    emoji: "☀️",
    vars: {
      "--bg": "#f5f7fa",
      "--card": "#ffffff",
      "--card2": "#edf0f5",
      "--text": "#1a2030",
      "--muted": "#5a6a7e",
      "--border": "rgba(0,0,0,0.1)",
      "--brand": "#3b82f6",
      "--brand2": "#6366f1",
      "--danger": "#ef4444",
      "--ok": "#22c55e",
      // Light theme needs a notably darker warn so the text reads - the
      // amber-500 used on dark themes washes out against a white card.
      "--warn": "#b45309",
      "--warn-bg": "rgba(180,83,9,0.12)",
      // Light theme needs a darker yellow so the job title reads on a
      // yellow background. yellow-700 with a 18% tint.
      "--scheduled": "#a16207",
      "--scheduled-bg": "rgba(161,98,7,0.18)",
    },
  },
  // ── Enterprise (extracted from the Figma Make "PWA Improvement Workflow"
  // exploration): 95% neutral, corporate blue as the ONLY interactive color,
  // no gradients. The flat look is delivered purely through these values:
  // --card2 == --card collapses the .card gradient, --brand2 == --brand
  // collapses the .btnPrimary gradient, and --on-brand forces white button ink.
  // For the fullest effect also pick "Sharp" button radius in theme settings
  // (tighter corners); Card Glow is already off by default (hairline borders).
  "enterprise-dark": {
    label: "Enterprise Dark",
    emoji: "🏢",
    vars: {
      // Field-robust dark: surfaces are lifted off near-black so cards
      // separate clearly and the screen stays readable in sunlight (a pure
      // black field app washes out and reads as a murky blur outdoors).
      // Text/muted are high-contrast, borders are visible hairlines, and the
      // blue is bright enough to read as an accent while carrying white ink.
      "--bg": "#12151d",
      "--card": "#1e2532",
      "--card2": "#1e2532",
      "--text": "#edf1f7",
      "--muted": "#aebaca",
      "--border": "#3d4762",
      "--brand": "#4574d6",
      "--brand2": "#4574d6",
      "--danger": "#f4726f",
      "--ok": "#3ac583",
      "--warn": "#e89a3c",
      "--warn-bg": "rgba(232,154,60,0.16)",
      "--scheduled": "#eec53f",
      "--scheduled-bg": "rgba(238,197,63,0.26)",
      "--on-brand": "#ffffff",
    },
  },
  "enterprise-light": {
    label: "Enterprise Light",
    emoji: "🏛️",
    vars: {
      "--bg": "#eef1f6",
      "--card": "#ffffff",
      "--card2": "#ffffff",
      "--text": "#0f1724",
      "--muted": "#5a6b82",
      "--border": "#d1d9e6",
      "--brand": "#1a44b8",
      "--brand2": "#1a44b8",
      "--danger": "#b91c1c",
      "--ok": "#15803d",
      "--warn": "#b45309",
      "--warn-bg": "rgba(180,83,9,0.12)",
      "--scheduled": "#a16207",
      "--scheduled-bg": "rgba(161,98,7,0.18)",
      "--on-brand": "#ffffff",
    },
  },
};

// ─── Font options ─────────────────────────────────────────────────────────────

export interface FontOption {
  label: string;
  value: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { label: "Inter", value: "'Inter', system-ui, sans-serif" },
  { label: "Roboto", value: "'Roboto', system-ui, sans-serif" },
  { label: "Poppins", value: "'Poppins', system-ui, sans-serif" },
  { label: "Montserrat", value: "'Montserrat', system-ui, sans-serif" },
  { label: "System UI", value: "system-ui, -apple-system, Segoe UI, sans-serif" },
];

// ─── Button style options ─────────────────────────────────────────────────────

export interface RadiusOption {
  label: string;
  value: string;
}

export const RADIUS_OPTIONS: RadiusOption[] = [
  { label: "Rounded", value: "12px" },
  { label: "Pill", value: "999px" },
  { label: "Sharp", value: "4px" },
];

// ─── Shadow options ───────────────────────────────────────────────────────────

export interface ShadowOption {
  label: string;
  value: string;
}

export const SHADOW_OPTIONS: ShadowOption[] = [
  { label: "None",   value: "none" },
  { label: "Subtle", value: "0 4px 12px rgba(0,0,0,0.2)" },
  { label: "Normal", value: "0 10px 30px rgba(0,0,0,0.35)" },
  { label: "Deep",   value: "0 20px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)" },
];

// ─── Density options ──────────────────────────────────────────────────────────

export interface DensityOption {
  label: string;
  pad: string;
  cardR: string;
}

export const DENSITY_OPTIONS: DensityOption[] = [
  { label: "Compact",   pad: "10px", cardR: "10px" },
  { label: "Normal",    pad: "14px", cardR: "14px" },
  { label: "Spacious",  pad: "20px", cardR: "18px" },
];

// ─── Map pin event types ──────────────────────────────────────────────────────

export const DEFAULT_PIN_COLORS: Record<string, string> = {
  arrive:  "#60a5fa",  // blue
  depart:  "#fb923c",  // orange
  start:   "#34d399",  // green
  finish:  "#f87171",  // red
  note:    "#fbbf24",  // yellow
  other:   "#e2e8f0",  // gray
};

export const PIN_EVENT_TYPES = Object.keys(DEFAULT_PIN_COLORS);

// ─── Configurable help text ───────────────────────────────────────────────────

export interface HelpTexts {
  photoCaptionPlaceholder: string;
  jobNotesPlaceholder: string;
  billNotesPlaceholder: string;
  hoursMismatchPlaceholder: string;
  jobDescriptionPlaceholder: string;
  photosHint: string;
  // Scheduling-related - added after the Scheduling Availability + future
  // absence + persistent notes features landed. Admin can swap the wording
  // for org-specific phrasing without a redeploy.
  schedulingNotesPlaceholder: string;
  availabilityDayNotePlaceholder: string;
  futureAbsenceNotePlaceholder: string;
  // Newer-feature hints, admin-editable so wording can change without a redeploy.
  incidentHint: string;          // Photos tab - incident reporting card
  incidentDescriptionPlaceholder: string; // Photos tab - "what happened" field
  skillsHint: string;            // Job Report - per-employee skill rating
  skillScaleHint: string;        // Job Report - what 1 star and 5 stars mean
  jobTypeHint: string;           // Job Report - job type tag picker
  truckFullnessHint: string;     // Job Report - truck fullness readings
  overageHint: string;           // Job Report - overage conversation prompt
}

export const DEFAULT_HELP_TEXTS: HelpTexts = {
  photoCaptionPlaceholder: "Describe what's in this photo…",
  jobNotesPlaceholder: "Notes for this job…",
  billNotesPlaceholder: "Any notes to include with this bill…",
  hoursMismatchPlaceholder: "e.g. Travel time not billed, job ran over estimate, early finish…",
  jobDescriptionPlaceholder: "Describe the job…",
  photosHint: "Submit before-and-after photos, damage photos, and any other photos relevant to this job.",
  schedulingNotesPlaceholder: "e.g. Mornings only until July 1. No Saturdays. Back to full availability after the 15th.",
  availabilityDayNotePlaceholder: 'e.g. "available after 1pm"',
  futureAbsenceNotePlaceholder: 'e.g. "Hawaii vacation"',
  incidentHint: "Document damage, injuries, or near-misses. Submitting generates a claim number - then add photos below and tag them to the claim.",
  incidentDescriptionPlaceholder: "Describe the incident, location, and any damage.",
  skillsHint: "Rate each mover on the skills this job called for. Use N/A for any skill that didn't apply.",
  skillScaleHint:
    "1 star = actively detracted from job flow, needs follow-up. 5 stars = operated on par with the most seasoned crew leaders.",
  jobTypeHint: "Tag the kind of work on this job (select all that apply). This decides which skills you rate below.",
  truckFullnessHint: "Add one reading per truck used - vertical and horizontal fill against the interior 25% marks.",
  overageHint: "Actual inventory ran over the estimate. Note what the extra items were and whether you discussed the overage with the customer.",
};

// ─── Settings shape ───────────────────────────────────────────────────────────

// Text-contrast override. "preset" uses whatever the current theme preset
// ships with; "light" forces light body text + muted (use on dark themes),
// "dark" forces dark body text + muted (use on light themes or pale customs).
export type TextMode = "preset" | "light" | "dark";

// Logo variant selector. "light" serves logo_light.png (light-pixel logo,
// reads on dark backgrounds); "dark" serves logo_dark.png (dark-pixel logo,
// reads on light backgrounds); "auto" picks based on the theme preset.
export type LogoMode = "auto" | "light" | "dark";

export interface ThemeSettings {
  themeId: string;
  brandOverride: string | null;
  brand2Override: string | null;
  textMode: TextMode;
  logoMode: LogoMode;
  fontValue: string;
  btnRadius: string;
  btnBgFrom: string;
  btnBgTo: string;
  btnSize: "sm" | "md" | "lg";
  cardShadow: string;
  density: string;          // label of DensityOption
  cardGlow: boolean;
  pinSize: number;          // radius in px (6–16)
  pinColors: Record<string, string>;
  helpTexts: HelpTexts;
}

const STORAGE_KEY = "crew_theme_settings";
const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export const DEFAULT_SETTINGS: ThemeSettings = {
  // Enterprise Dark is the app's default identity (the facelift). Existing
  // users keep whatever they already saved in localStorage; only new users and
  // anyone who never picked a theme land here. See ADR 0025.
  themeId: "enterprise-dark",
  brandOverride: null,
  brand2Override: null,
  textMode: "preset",
  logoMode: "auto",
  fontValue: FONT_OPTIONS[0].value,
  btnRadius: RADIUS_OPTIONS[0].value,
  btnBgFrom: "#1b2945",
  btnBgTo: "#162238",
  btnSize: "md",
  cardShadow: SHADOW_OPTIONS[2].value,
  density: "Normal",
  cardGlow: false,
  pinSize: 9,
  pinColors: { ...DEFAULT_PIN_COLORS },
  helpTexts: { ...DEFAULT_HELP_TEXTS },
};

function loadSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      pinColors: { ...DEFAULT_PIN_COLORS, ...(parsed.pinColors ?? {}) },
      helpTexts: { ...DEFAULT_HELP_TEXTS, ...(parsed.helpTexts ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** WCAG relative luminance (0 = black, 1 = white) of a "#rrggbb" color.
 * Returns 0.5 (neutral) for anything unparseable, so a bad value never
 * triggers the dark/light-text conflict guard. */
function relLuminance(hex: string | undefined): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? "").trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
}

function applySettings(settings: ThemeSettings) {
  const preset = THEME_PRESETS[settings.themeId] ?? THEME_PRESETS["dark-ocean"];
  const root = document.documentElement;

  // Preset vars
  for (const [k, v] of Object.entries(preset.vars)) {
    root.style.setProperty(k, v);
  }

  // Color overrides
  if (settings.brandOverride) root.style.setProperty("--brand", settings.brandOverride);
  if (settings.brand2Override) root.style.setProperty("--brand2", settings.brand2Override);

  // Text contrast override. Also drives `--on-brand`, the color used for
  // text on bright brand-coloured surfaces (primary buttons, active tabs),
  // so the whole app follows the setting end-to-end.
  //
  // The override is CONFLICT-AWARE: forcing "dark text" on a dark-background
  // theme (or "light text" on a light one) renders text-on-same-shade and is
  // never readable - it is always a mistake, not a preference. So we apply a
  // forced mode only when it matches the theme's background polarity; on a
  // conflict we keep the preset's own text (already set above). This is what
  // made Enterprise Dark unreadable when Text-Color was left on "Dark text".
  const bgIsDark = relLuminance(preset.vars["--bg"]) < 0.5;
  if (settings.textMode === "light" && bgIsDark) {
    root.style.setProperty("--text", "#f5f7fa");
    root.style.setProperty("--muted", "#c6cedb");
    root.style.setProperty("--on-brand", "#f5f7fa");
  } else if (settings.textMode === "dark" && !bgIsDark) {
    root.style.setProperty("--text", "#1a2030");
    root.style.setProperty("--muted", "#5a6a7e");
    root.style.setProperty("--on-brand", "#0b1220");
  } else {
    // "preset" mode, OR a conflicting forced mode we refuse to apply: keep the
    // preset's --text / --muted (set above) and use the preset's brand ink if
    // it declares one (e.g. the enterprise blue needs white), else dark navy.
    root.style.setProperty("--on-brand", preset.vars["--on-brand"] ?? "#0b1220");
  }

  // Font
  root.style.setProperty("--font", settings.fontValue);

  // Button radius + card radius
  root.style.setProperty("--btn-r", settings.btnRadius);
  const cardR = settings.btnRadius === "999px" ? "20px"
              : settings.btnRadius === "4px"   ? "6px"
              : "14px";
  root.style.setProperty("--r", cardR);

  // Button background gradient and size
  const BTN_PAD: Record<string, string> = { sm: "6px 10px", md: "10px 14px", lg: "14px 20px" };
  root.style.setProperty("--btn-bg-from", settings.btnBgFrom);
  root.style.setProperty("--btn-bg-to", settings.btnBgTo);
  root.style.setProperty("--btn-pad", BTN_PAD[settings.btnSize] ?? "10px 14px");

  // Shadow
  root.style.setProperty("--shadow", settings.cardShadow);

  // Density (padding)
  const densityOpt = DENSITY_OPTIONS.find((d) => d.label === settings.density) ?? DENSITY_OPTIONS[1];
  root.style.setProperty("--pad", densityOpt.pad);

  // Card glow
  const brand = settings.brandOverride ?? preset.vars["--brand"];
  root.style.setProperty(
    "--border",
    settings.cardGlow
      ? `${brand}44`
      : preset.vars["--border"]
  );

  // Enterprise presets are intentionally FLAT and tight (per the design system):
  // 4px cards, 3px buttons, no shadow, hairline borders - the look must not
  // depend on the user's radius / shadow / glow settings, so force these last
  // (they win over the settings applied above). Other presets keep honoring the
  // user's choices. Undo this block to let enterprise follow the radius setting.
  if (settings.themeId.startsWith("enterprise")) {
    root.style.setProperty("--r", "4px");
    root.style.setProperty("--btn-r", "3px");
    root.style.setProperty("--shadow", "none");
    root.style.setProperty("--border", preset.vars["--border"]);
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ThemeContextValue {
  settings: ThemeSettings;
  update: (partial: Partial<ThemeSettings>) => void;
  reset: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(loadSettings);

  // On mount: fetch admin-saved theme from server and apply it for all users
  useEffect(() => {
    fetch(`${API}/api/config/theme`)
      .then((r) => r.ok ? r.json() : null)
      .then((serverSettings: Partial<ThemeSettings> | null) => {
        if (!serverSettings) return;
        setSettings((prev) => ({
          ...prev,
          ...serverSettings,
          pinColors: { ...DEFAULT_PIN_COLORS, ...(serverSettings.pinColors ?? {}) },
          helpTexts: { ...DEFAULT_HELP_TEXTS, ...(serverSettings.helpTexts ?? {}) },
        }));
      })
      .catch(() => { /* network unavailable - use localStorage fallback */ });
  }, []);

  useEffect(() => {
    applySettings(settings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  function update(partial: Partial<ThemeSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
  }

  function reset() {
    setSettings(DEFAULT_SETTINGS);
  }

  return (
    <ThemeContext.Provider value={{ settings, update, reset }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

// Resolve which logo file to serve for the current theme + logoMode.
// `logo_light.png` is the light-pixel variant (for dark backgrounds);
// `logo_dark.png` is the dark-pixel variant (for light backgrounds).
// In "auto", "light" preset → dark-pixel logo; every other preset → light-pixel.
export function useResolvedLogo(): { src: string; variant: "light" | "dark" } {
  const { settings } = useTheme();
  const variant: "light" | "dark" =
    settings.logoMode === "light"
      ? "light"
      : settings.logoMode === "dark"
        ? "dark"
        : settings.themeId === "light"
          ? "dark"
          : "light";
  return { src: variant === "light" ? logoLight : logoDark, variant };
}

// ─── Custom (device-local) theme presets ──────────────────────────────────────
//
// Admins can snapshot the current look as a named preset that then shows up in
// the Theme Template grid next to the built-ins. These live in localStorage on
// that device only - no backend. To push a custom look to every crew member,
// select it and use "Apply to all users", which saves the resolved settings to
// the server config the same way a built-in selection does.

// A theme preset captures everything visual *except* the editable help-text
// copy - help text is content, not look-and-feel, and shouldn't ride along
// when someone picks a different palette.
export type ThemeStyle = Omit<ThemeSettings, "helpTexts">;

export interface CustomPreset {
  id: string;
  label: string;
  emoji: string;
  style: ThemeStyle;
}

const CUSTOM_PRESETS_KEY = "crew_custom_theme_presets";

// Pull the style fields out of a full settings object, in a fixed key order so
// two snapshots of the same look stringify identically (used for the "active
// preset" check in the UI).
export function pickStyle(s: ThemeSettings): ThemeStyle {
  return {
    themeId: s.themeId,
    brandOverride: s.brandOverride,
    brand2Override: s.brand2Override,
    textMode: s.textMode,
    logoMode: s.logoMode,
    fontValue: s.fontValue,
    btnRadius: s.btnRadius,
    btnBgFrom: s.btnBgFrom,
    btnBgTo: s.btnBgTo,
    btnSize: s.btnSize,
    cardShadow: s.cardShadow,
    density: s.density,
    cardGlow: s.cardGlow,
    pinSize: s.pinSize,
    pinColors: s.pinColors,
  };
}

export function loadCustomPresets(): CustomPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is CustomPreset =>
        !!p &&
        typeof (p as CustomPreset).id === "string" &&
        typeof (p as CustomPreset).label === "string" &&
        !!(p as CustomPreset).style,
    );
  } catch {
    return [];
  }
}

export function persistCustomPresets(list: CustomPreset[]) {
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode / quota) - non-fatal */
  }
}

// Swatch colors for a style snapshot: the preset palette with brand overrides
// applied on top - matches what applySettings() would render.
export function styleVars(
  style: Pick<ThemeStyle, "themeId" | "brandOverride" | "brand2Override">,
): ThemeVars {
  const base = THEME_PRESETS[style.themeId] ?? THEME_PRESETS["dark-ocean"];
  const vars = { ...base.vars };
  if (style.brandOverride) vars["--brand"] = style.brandOverride;
  if (style.brand2Override) vars["--brand2"] = style.brand2Override;
  return vars;
}
