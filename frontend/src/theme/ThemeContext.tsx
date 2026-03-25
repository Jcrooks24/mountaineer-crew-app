import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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

// ─── Settings shape ───────────────────────────────────────────────────────────

export interface ThemeSettings {
  themeId: string;
  brandOverride: string | null;   // null = use preset
  brand2Override: string | null;
  fontValue: string;
  btnRadius: string;
}

const STORAGE_KEY = "crew_theme_settings";

const DEFAULT_SETTINGS: ThemeSettings = {
  themeId: "dark-ocean",
  brandOverride: null,
  brand2Override: null,
  fontValue: FONT_OPTIONS[0].value,
  btnRadius: RADIUS_OPTIONS[0].value,
};

function loadSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function applySettings(settings: ThemeSettings) {
  const preset = THEME_PRESETS[settings.themeId] ?? THEME_PRESETS["dark-ocean"];
  const root = document.documentElement;

  // Apply all preset vars
  for (const [k, v] of Object.entries(preset.vars)) {
    root.style.setProperty(k, v);
  }

  // Apply overrides if set
  if (settings.brandOverride) root.style.setProperty("--brand", settings.brandOverride);
  if (settings.brand2Override) root.style.setProperty("--brand2", settings.brand2Override);

  // Apply font
  root.style.setProperty("--font", settings.fontValue);

  // Apply button radius
  root.style.setProperty("--btn-r", settings.btnRadius);

  // Also update card radius to stay in sync (but not as extreme as pill)
  const cardR = settings.btnRadius === "999px" ? "20px"
              : settings.btnRadius === "4px"   ? "6px"
              : "14px";
  root.style.setProperty("--r", cardR);
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

  // Apply on mount and whenever settings change
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
