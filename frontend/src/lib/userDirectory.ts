import { apiFetch } from "../api/client";
import type { DirectoryEntry } from "../auth/AuthContext";

// The roster is now a REQUIRED match key, not just a suggestion list: employee
// hours are keyed on a roster user_id, and a crew member who cannot see the
// roster cannot log hours at all. So it must survive a reload and a dead signal,
// which an in-memory variable does not. Cached under the crew_ prefix so
// clearCrewState() wipes it when a different person logs in on a shared phone.
const CACHE_KEY = "crew_roster_v1";

let cached: DirectoryEntry[] | null = loadCache();
let inflight: Promise<DirectoryEntry[]> | null = null;
const listeners = new Set<() => void>();

function loadCache(): DirectoryEntry[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? (parsed as DirectoryEntry[]) : null;
  } catch {
    return null;
  }
}

function saveCache(list: DirectoryEntry[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch {
    /* quota - the in-memory copy still works for this session */
  }
}

function emit() {
  for (const fn of listeners) fn();
}

async function fetchDirectory(): Promise<DirectoryEntry[]> {
  const list = await apiFetch<DirectoryEntry[]>("/api/users/directory");
  const next = Array.isArray(list) ? list : [];
  // Never overwrite a good cache with an empty response: a roster that comes back
  // empty (an auth blip, a bad deploy) would otherwise lock every crew member out
  // of logging hours, offline and online alike.
  if (next.length > 0) {
    cached = next;
    saveCache(next);
  } else if (!cached) {
    cached = next;
  }
  emit();
  return cached ?? [];
}

/**
 * Kick off (or reuse) a fetch. Callers get the cached list in `current()`.
 *
 * Stale-while-revalidate: when a cached roster exists it is returned at once (so
 * an offline launch has a usable roster immediately) AND a refresh runs in the
 * background, so somebody added to the crew this morning shows up without a
 * reload. A failed refresh is silent by design; the cache is still good.
 */
export function ensureDirectory(): Promise<DirectoryEntry[]> {
  if (!inflight) {
    inflight = fetchDirectory()
      .catch(() => cached ?? [])
      .finally(() => { inflight = null; });
  }
  if (cached) return Promise.resolve(cached);
  return inflight;
}

/** Force a refresh (e.g. after the current user edits their own photo). */
export function refreshDirectory(): Promise<DirectoryEntry[]> {
  cached = null;
  inflight = null;
  return ensureDirectory();
}

export function currentDirectory(): DirectoryEntry[] {
  return cached ?? [];
}

export function subscribeDirectory(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Look up a user's profile photo by display string (name or email).
 * Accepts the `created_by` value we persist with events/photos, which is
 * the user's name if set, otherwise their email.
 */
export function photoForDisplay(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const needle = displayName.trim().toLowerCase();
  if (!needle) return null;
  const list = cached ?? [];
  for (const u of list) {
    if (u.name && u.name.trim().toLowerCase() === needle) return u.profile_photo ?? null;
    if (u.email.toLowerCase() === needle) return u.profile_photo ?? null;
  }
  return null;
}
