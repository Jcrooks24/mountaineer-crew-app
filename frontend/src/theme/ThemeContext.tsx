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
}

export const DEFAULT_HELP_TEXTS: HelpTexts = {
  photoCaptionPlaceholder: "Describe what's in this photo…",
  jobNotesPlaceholder: "Notes for this job…",
  billNotesPlaceholder: "Any notes to include with this bill…",
  hoursMismatchPlaceholder: "e.g. Travel time not billed, job ran over estimate, early finish…",
  jobDescriptionPlaceholder: "Describe the job…",
  photosHint: "Submit before-and-after photos, damage photos, and any other photos relevant to this job.",
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
  themeId: "dark-ocean",
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

  // Text contrast override
  if (settings.textMode === "light") {
    root.style.setProperty("--text", "#f5f7fa");
    root.style.setProperty("--muted", "#c6cedb");
  } else if (settings.textMode === "dark") {
    root.style.setProperty("--text", "#1a2030");
    root.style.setProperty("--muted", "#5a6a7e");
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
      .catch(() => { /* network unavailable — use localStorage fallback */ });
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
export function useLogoSrc(): string {
  const { settings } = useTheme();
  if (settings.logoMode === "light") return logoLight;
  if (settings.logoMode === "dark") return logoDark;
  return settings.themeId === "light" ? logoDark : logoLight;
}
