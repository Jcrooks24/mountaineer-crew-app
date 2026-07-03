/**
 * Availability store.
 *
 * Crew submit forward-looking 14-day windows of availability. The data model
 * splits into three concerns:
 *
 *   - cache (`crew_availability_cache_v1`): the server's latest known state.
 *     Used for initial render and offline reads.
 *   - draft (`crew_availability_draft_v1`): in-progress edits for the active
 *     window. Persists across reloads so a tab close / phone lock doesn't
 *     lose the user's taps. Cleared on a successful Submit.
 *   - server (POST /api/availability): only written when the user explicitly
 *     hits Submit. There is intentionally NO autosave on this module - testers
 *     reported the autosave UX made it feel like selections vanished after
 *     each save (the active window was auto-advancing).
 *
 * Day locking: any day within 14 days of today is locked once it has a server
 * record. The lock is enforced on both the device (read-only cell, disabled
 * Submit if any locked-day write is queued) and the backend (rejects the
 * request). Crew must reach out to admin to change a locked day.
 */

import { apiFetch } from "../api/client";

export type AvailabilityStatus = "available" | "unavailable" | "conditional";

export type AvailabilityDay = {
  day: string;        // ISO YYYY-MM-DD
  status: AvailabilityStatus;
  note?: string | null;
  window_start: string;
  updated_at?: string;
};

export type AvailabilityUnlock = {
  id: number;
  window_start: string;
  granted_by_name: string;
  granted_at: string;
  note: string | null;
};

export type AvailabilityState = {
  horizon: string | null;  // last day the user has submitted, or null
  days: AvailabilityDay[];
  unlocks?: AvailabilityUnlock[];
};

export type AvailabilityDraftDay = {
  day: string;
  status: AvailabilityStatus;
  note?: string | null;
};

export type AvailabilityDraft = {
  window_start: string;
  days: AvailabilityDraftDay[];
};

const CACHE_KEY = "crew_availability_cache_v1";
const DRAFT_KEY = "crew_availability_draft_v1";

// ── Date helpers ────────────────────────────────────────────────────────────

/** Local-day YYYY-MM-DD (not UTC) so the lock cutoff doesn't shift overnight
 *  for crew on the western side of the country. */
export function todayLocalIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Whole-day difference `a - b` (positive when a is after b). */
export function daysBetween(a: string, b: string): number {
  const aMs = Date.parse(a + "T00:00:00");
  const bMs = Date.parse(b + "T00:00:00");
  if (Number.isNaN(aMs) || Number.isNaN(bMs)) return 0;
  return Math.round((aMs - bMs) / 86_400_000);
}

/** A day is locked when it lands within the 14-day window starting from
 *  `todayIso` (inclusive). Days past that window stay editable so the crew
 *  can refine far-out availability up until they're committed. */
export function isLocked(day: string, todayIso: string): boolean {
  return daysBetween(day, todayIso) < 14;
}

// ── Cache ────────────────────────────────────────────────────────────────────

export function loadCache(): AvailabilityState {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { horizon: null, days: [], unlocks: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.days)) {
      return { horizon: null, days: [], unlocks: [] };
    }
    return {
      horizon: typeof parsed.horizon === "string" ? parsed.horizon : null,
      days: parsed.days as AvailabilityDay[],
      unlocks: Array.isArray(parsed.unlocks) ? (parsed.unlocks as AvailabilityUnlock[]) : [],
    };
  } catch {
    return { horizon: null, days: [], unlocks: [] };
  }
}

export function saveCache(state: AvailabilityState): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {}
}

// ── Draft ────────────────────────────────────────────────────────────────────

export function loadDraft(): AvailabilityDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.window_start !== "string" ||
      !Array.isArray(parsed.days)
    ) {
      return null;
    }
    return parsed as AvailabilityDraft;
  } catch {
    return null;
  }
}

export function saveDraft(draft: AvailabilityDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {}
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

// ── Server sync ──────────────────────────────────────────────────────────────

export async function fetchState(): Promise<AvailabilityState | null> {
  try {
    const r = await apiFetch<AvailabilityState>("/api/availability");
    saveCache(r);
    return r;
  } catch {
    return null;
  }
}

/** POST the supplied draft to the backend. On success, returns + persists
 *  the new server state and clears the draft. Throws on network or
 *  validation error so the caller can show the message - the autosave path
 *  used to swallow these and the user lost the failure signal. */
export async function submitDraft(draft: AvailabilityDraft): Promise<AvailabilityState> {
  const r = await apiFetch<AvailabilityState>("/api/availability", {
    method: "POST",
    body: JSON.stringify({
      window_start: draft.window_start,
      days: draft.days.map((d) => ({
        day: d.day,
        status: d.status,
        note: d.note || null,
      })),
    }),
  });
  saveCache(r);
  clearDraft();
  return r;
}

// ── Horizon ────────────────────────────────────────────────────────────────

/** True when the user's submitted horizon is less than 14 days out from
 *  `today` - the threshold at which the "submit the next 2 weeks" prompt
 *  fires on Profile and inside the picker. */
export function isHorizonLow(horizon: string | null, todayIso: string): boolean {
  if (!horizon) return true;
  return daysBetween(horizon, todayIso) < 14;
}
