/**
 * Availability store — offline-capable per-day status + note for the
 * crew's forward-looking scheduling window.
 *
 * Model: the crew touches one rolling window at a time, so the queue is a
 * single localStorage "dirty batch" rather than a list of independent ops.
 *
 *   - cache (`crew_availability_cache_v1`): the server's latest known
 *     state — used for initial render and offline reads.
 *   - draft (`crew_availability_draft_v1`): in-progress edits for the
 *     active window. Persists across reloads so a tab close / phone
 *     lock doesn't lose the user's taps.
 *
 * Render layer always reads draft ∪ cache so the UI reflects the user's
 * latest taps immediately, even if the POST hasn't drained yet.
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

export type AvailabilityState = {
  horizon: string | null;  // last day the user has submitted, or null
  days: AvailabilityDay[];
};

type AvailabilityDraft = {
  window_start: string;
  // Only days the user has actually touched in the current draft live here.
  // Untouched days within the window inherit from cache (= keep the prior
  // server value) until the user taps them.
  days: AvailabilityDay[];
};

const CACHE_KEY = "crew_availability_cache_v1";
const DRAFT_KEY = "crew_availability_draft_v1";

// ── Cache helpers ────────────────────────────────────────────────────────────

export function loadCache(): AvailabilityState {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { horizon: null, days: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.days)) {
      return { horizon: null, days: [] };
    }
    return {
      horizon: typeof parsed.horizon === "string" ? parsed.horizon : null,
      days: parsed.days as AvailabilityDay[],
    };
  } catch {
    return { horizon: null, days: [] };
  }
}

function saveCache(state: AvailabilityState): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {}
}

// ── Draft helpers ────────────────────────────────────────────────────────────

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

function saveDraft(draft: AvailabilityDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {}
}

function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

// ── Merge ────────────────────────────────────────────────────────────────────

/** Apply the current draft on top of the cache. The draft wins for any day
 *  it has touched; days the draft hasn't touched are unchanged. */
export function renderedDays(state: AvailabilityState, draft: AvailabilityDraft | null): AvailabilityDay[] {
  if (!draft) return state.days;
  const byDay = new Map<string, AvailabilityDay>();
  for (const d of state.days) byDay.set(d.day, d);
  for (const d of draft.days) byDay.set(d.day, d);
  return Array.from(byDay.values()).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Returns true when the user's submitted horizon is less than 14 days out
 *  from `today` — which is when the device-side prompt to submit the next
 *  window fires. Inclusive on both ends. */
export function isHorizonLow(horizon: string | null, todayIso: string): boolean {
  if (!horizon) return true;
  const horizonMs = Date.parse(horizon + "T00:00:00");
  const todayMs = Date.parse(todayIso + "T00:00:00");
  if (Number.isNaN(horizonMs) || Number.isNaN(todayMs)) return true;
  const oneDay = 86_400_000;
  const daysAhead = Math.round((horizonMs - todayMs) / oneDay);
  return daysAhead < 14;
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

/** Update one day in the current draft. Creates a draft for `window_start`
 *  if none exists yet. Triggers a debounced flush; the caller may pass
 *  `immediate: true` to flush right away (e.g. on submit). */
export function setDayInDraft(
  window_start: string,
  day: string,
  status: AvailabilityStatus,
  note: string | null,
): AvailabilityDraft {
  const existing = loadDraft();
  const base: AvailabilityDraft =
    existing && existing.window_start === window_start
      ? existing
      : { window_start, days: [] };
  // If switching windows, the prior draft is discarded — it's already been
  // either flushed or abandoned by the user navigating away.
  const others = base.days.filter((d) => d.day !== day);
  const next: AvailabilityDraft = {
    window_start,
    days: [
      ...others,
      { day, status, note: note || null, window_start },
    ],
  };
  saveDraft(next);
  return next;
}

let flushTimer: number | null = null;
let inFlight: Promise<AvailabilityState | null> | null = null;

export function scheduleFlush(delayMs = 900, onState?: (s: AvailabilityState) => void): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushDraftNow(onState);
  }, delayMs);
}

/** POST the current draft as a batch. On success, clears the draft and
 *  updates the cache from the server response. On failure, leaves draft
 *  in place for the next online attempt. Concurrent calls dedupe. */
export async function flushDraftNow(
  onState?: (s: AvailabilityState) => void,
): Promise<AvailabilityState | null> {
  if (inFlight) return inFlight;
  const draft = loadDraft();
  if (!draft || draft.days.length === 0) return null;
  if (!navigator.onLine) return null;

  inFlight = (async () => {
    try {
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
      clearDraft();
      saveCache(r);
      onState?.(r);
      return r;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// Drain on visibility/online so backgrounded edits get sent the moment
// connectivity returns or the user comes back to the tab.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushDraftNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flushDraftNow();
  });
}
