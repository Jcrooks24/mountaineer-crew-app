/**
 * Wipe every user-specific store the app holds on this device.
 *
 * Called when the active crew member changes - explicit logout, or a fresh
 * /me response that doesn't match the previously-cached user. Without this,
 * crew B logging in on a shared phone would inherit crew A's queued
 * materials, draft availability, and dismissed-banner flags, and would
 * unintentionally submit them under their own identity on the next sync.
 *
 * Conservative by design: it wipes anything keyed with the well-known
 * "crew_" prefix or the auth-related "mm_" prefix, plus the shared
 * crew_app_db IndexedDB database that hosts the photo + reimbursement
 * queues. Non-user state (theme settings, last-seen patch notes timestamp,
 * etc.) deliberately re-uses these prefixes, so wiping them is acceptable
 * - they reseed from server defaults on next render.
 */

import { clearSharedFetchCache } from "../lib/sharedFetch";

const KEY_PREFIXES = ["crew_", "mm_"] as const;
const INDEXED_DB_NAME = "crew_app_db";

function wipeStorage(s: Storage | undefined): void {
  if (!s) return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (!k) continue;
      if (KEY_PREFIXES.some((p) => k.startsWith(p))) toRemove.push(k);
    }
    for (const k of toRemove) s.removeItem(k);
  } catch {
    /* storage unavailable - nothing to clear */
  }
}

export function clearCrewState(): void {
  if (typeof window === "undefined") return;
  // In-memory coalesced reads too. They are shared config rather than personal
  // data, but a wipe that leaves the previous session's answers sitting in
  // module memory is the kind of thing that is only ever discovered as a bug.
  clearSharedFetchCache();
  wipeStorage(window.localStorage);
  wipeStorage(window.sessionStorage);
  // Fire-and-forget - onsuccess/onerror are no-ops. If the DB doesn't exist
  // yet, deleteDatabase is a no-op too. If something is holding a connection
  // open, the deletion is blocked but the failure is benign here: the
  // logged-in user just sees the previous queue once and re-syncs.
  try {
    window.indexedDB?.deleteDatabase(INDEXED_DB_NAME);
  } catch {
    /* indexedDB unavailable - ignore */
  }
}
