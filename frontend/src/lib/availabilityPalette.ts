// Colorblind-friendly palettes for a crew member's OWN Availability tools.
// ADR 0050. The owner, 2026-09-04: "We have a color blind employee. Crew facing
// availability tools should have a color blind friendly palette mode. Color blind
// pallete should translate to the conventional color pallette by default in admin
// facing views."
//
// Three rules this module exists to hold:
//
//   1. The setting lives on the ACCOUNT (users.availability_palette), so it
//      follows the person to a new phone.
//   2. It only ever recolors a person's own view. An admin opening someone
//      else's availability, and the admin month grid, stay conventional. The
//      caller says which it is via `ownView`.
//   3. Choosing a palette works offline. The choice is kept in a per-user
//      pending key and applied immediately, then sent by
//      drainAvailabilityPalette on boot and on reconnect (wired in App.tsx).
//
// Colors were checked with a Machado 2009 simulation of each type: every pair of
// statuses stays at least dE2000 36 apart under the type a mode is for (and under
// normal vision), and the label ink on every fill is at least 4.8:1.

import { useMemo } from "react";
import { apiFetch } from "../api/client";
import { loadCachedUser, useAuth, type User } from "../auth/AuthContext";
import type { AvailabilityStatus } from "./availabilityStore";

export const AVAILABILITY_PALETTES = [
  "default", "red_green", "deuteranopia", "protanopia", "tritanopia", "monochrome",
] as const;
export type AvailabilityPalette = (typeof AVAILABILITY_PALETTES)[number];

export const PALETTE_LABELS: Record<AvailabilityPalette, { name: string; hint: string }> = {
  default:      { name: "Standard colors", hint: "Green, red and yellow." },
  red_green:    { name: "Red-green", hint: "Blue, brown and yellow. Works for both common red-green types." },
  deuteranopia: { name: "Deuteranopia", hint: "Tuned for green-weak vision." },
  protanopia:   { name: "Protanopia", hint: "Tuned for red-weak vision." },
  tritanopia:   { name: "Tritanopia", hint: "Teal, magenta and dark gray, for blue-yellow." },
  monochrome:   { name: "Monochrome", hint: "Light, dark and middle gray." },
};

export type StatusStyle = {
  /** Cell fill. */
  bg: string;
  /** Ink ON the fill. In a colorblind mode this is near-black or near-white, so
   *  never use it for text on the page background. */
  fg: string;
  border: string;
  /** The status color itself, for a small dot or swatch. */
  swatch: string;
  /** Color for the status word on the PAGE background. In a colorblind mode this
   *  is the body text color: a yellow word on a white page is unreadable, and
   *  the word already carries the meaning. */
  text: string;
  /** Full word, used in lists and sentences. */
  label: string;
  /** Short word printed inside a calendar cell. Empty in the standard palette. */
  cellLabel: string;
};

const LABELS: Record<AvailabilityStatus, string> = {
  available: "Available",
  unavailable: "Unavailable",
  conditional: "Conditional",
};

// Short enough for a 7-column grid at 400px. The owner chose short text over
// symbols, and no emoji.
const CELL_LABELS: Record<AvailabilityStatus, string> = {
  available: "Avail",
  unavailable: "Unavail",
  conditional: "Cond",
};

// The conventional palette, exactly what the app has always shown.
const STANDARD: Record<AvailabilityStatus, StatusStyle> = {
  available:   { bg: "color-mix(in srgb, var(--ok) 18%, transparent)",     fg: "var(--ok)",     border: "var(--ok)",     swatch: "var(--ok)",     text: "var(--ok)",     label: LABELS.available,   cellLabel: "" },
  unavailable: { bg: "color-mix(in srgb, var(--danger) 18%, transparent)", fg: "var(--danger)", border: "var(--danger)", swatch: "var(--danger)", text: "var(--danger)", label: LABELS.unavailable, cellLabel: "" },
  conditional: { bg: "var(--warn-bg)",                                     fg: "var(--warn)",   border: "var(--warn)",   swatch: "var(--warn)",   text: "var(--warn)",   label: LABELS.conditional, cellLabel: "" },
};

// Solid fills, not tints. A tint over the theme background changes with the
// theme, and a colorblind mode has to look the same on every theme to stay
// distinguishable. Ink is the one with more contrast on that fill.
//
// The literal colors below are the one deliberate exception to the theme-var
// rule (DESIGN_SYSTEM.md): each set was validated by simulation for a specific
// kind of color blindness, and a theme var would silently change what was
// validated. Do not swap a value without re-running that check.
/* eslint-disable no-restricted-syntax -- validated colorblind fills, see above */
const FILLS: Record<Exclude<AvailabilityPalette, "default">, Record<AvailabilityStatus, string>> = {
  red_green:    { available: "#0072B2", unavailable: "#A8440A", conditional: "#F5E663" },
  deuteranopia: { available: "#005AB5", unavailable: "#A8281B", conditional: "#FFD84D" },
  protanopia:   { available: "#006CD1", unavailable: "#994F00", conditional: "#FFC20A" },
  tritanopia:   { available: "#00A39B", unavailable: "#D41159", conditional: "#3D3D3D" },
  monochrome:   { available: "#F2F2F2", unavailable: "#1F1F1F", conditional: "#8A8A8A" },
};

const INK_DARK = "#0b1220";
const INK_LIGHT = "#f5f7fa";
/* eslint-enable no-restricted-syntax */

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function inkFor(fill: string): string {
  return contrast(fill, INK_DARK) >= contrast(fill, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

export function isPalette(v: unknown): v is AvailabilityPalette {
  return typeof v === "string" && (AVAILABILITY_PALETTES as readonly string[]).includes(v);
}

export function statusPalette(mode: AvailabilityPalette): Record<AvailabilityStatus, StatusStyle> {
  if (mode === "default") return STANDARD;
  const fills = FILLS[mode];
  const out = {} as Record<AvailabilityStatus, StatusStyle>;
  for (const s of ["available", "unavailable", "conditional"] as const) {
    out[s] = {
      bg: fills[s],
      fg: inkFor(fills[s]),
      // A visible edge on every cell, so a near-white or near-black fill does
      // not disappear into a light or dark theme background.
      border: "color-mix(in srgb, var(--text) 55%, transparent)",
      swatch: fills[s],
      text: "var(--text)",
      label: LABELS[s],
      cellLabel: CELL_LABELS[s],
    };
  }
  return out;
}

// ── Offline-safe persistence ─────────────────────────────────────────────────
//
// Deliberately NOT under the "mm_" / "crew_" prefixes clearCrewState wipes on
// logout: an offline choice must survive a sign-out and send on the next sign-in.
// Keyed by user id, and only ever sent while that same user is signed in, so a
// shared phone never applies one person's palette to another's account.

const PENDING_PREFIX = "availability_palette_pending_v1:";

function pendingKey(userId: number): string {
  return `${PENDING_PREFIX}${userId}`;
}

function readPending(userId: number): AvailabilityPalette | null {
  try {
    const raw = localStorage.getItem(pendingKey(userId));
    return isPalette(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** The palette this user should see: an unsent local choice wins over the
 *  account value, so a /me refresh carrying the old value cannot undo a choice
 *  made offline. Unknown values fall back to standard. */
export function effectivePalette(userId: number | undefined, accountValue: string | undefined): AvailabilityPalette {
  if (typeof userId === "number") {
    const p = readPending(userId);
    if (p) return p;
  }
  return isPalette(accountValue) ? accountValue : "default";
}

let draining = false;

/**
 * Send an unsent palette choice for the signed-in user. Silent and idempotent,
 * like every other drain in App.tsx.
 *
 * Returns the updated profile when the server took it, and the CALLER MUST pass
 * that to setUser. The local copy is dropped at the same moment, so from then on
 * the account value is the only source, which is what lets a choice made later on
 * another phone win here too.
 */
export async function drainAvailabilityPalette(): Promise<User | null> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  const me = loadCachedUser();
  if (!me || draining) return null;
  const mode = readPending(me.id);
  if (!mode) return null;
  draining = true;
  try {
    const updated = await apiFetch<User>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ availability_palette: mode }),
    });
    // A 200 is not proof the account has it. A backend that predates the column
    // (the frontend deploys on its own, often ahead of the backend) ignores the
    // unknown field and still answers 200. Keep the local copy until the account
    // echoes the choice back.
    if (updated?.availability_palette !== mode) return null;
    // Only drop the local copy if nobody picked again while this was in flight;
    // otherwise the newer choice stays pending and goes on the next drain.
    if (readPending(me.id) === mode) {
      try { localStorage.removeItem(pendingKey(me.id)); } catch { /* storage blocked: re-sends next drain, harmless */ }
    }
    return updated;
  } catch {
    return null;
  } finally {
    draining = false;
  }
}

/** Choose a palette. It applies at once on this device, with or without signal,
 *  and returns the updated profile if it also reached the server. */
export async function chooseAvailabilityPalette(userId: number, mode: AvailabilityPalette): Promise<User | null> {
  try {
    localStorage.setItem(pendingKey(userId), mode);
  } catch {
    // Storage blocked or full: there is no local copy to drain, so send it
    // straight away. The caller shows "saved on this phone" only on a null
    // return, and a null here would be a lie, so a failure throws instead.
    const updated = await apiFetch<User>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ availability_palette: mode }),
    });
    if (updated?.availability_palette !== mode) throw new Error("palette not saved");
    return updated;
  }
  return drainAvailabilityPalette();
}

/**
 * The status colors for an Availability screen.
 * `ownView` is false whenever the person on screen is not the signed-in user
 * (an admin opening someone's availability): that view is always standard.
 */
export function useStatusPalette(ownView: boolean): {
  mode: AvailabilityPalette;
  colors: Record<AvailabilityStatus, StatusStyle>;
} {
  const { user } = useAuth();
  const mode = ownView ? effectivePalette(user?.id, user?.availability_palette) : "default";
  return useMemo(() => ({ mode, colors: statusPalette(mode) }), [mode]);
}
