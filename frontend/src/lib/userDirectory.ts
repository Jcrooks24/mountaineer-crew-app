import { apiFetch } from "../api/client";
import type { DirectoryEntry } from "../auth/AuthContext";

let cached: DirectoryEntry[] | null = null;
let inflight: Promise<DirectoryEntry[]> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

async function fetchDirectory(): Promise<DirectoryEntry[]> {
  const list = await apiFetch<DirectoryEntry[]>("/api/users/directory");
  cached = Array.isArray(list) ? list : [];
  emit();
  return cached;
}

/** Kick off (or reuse) a fetch. Callers get the cached list in `current()`. */
export function ensureDirectory(): Promise<DirectoryEntry[]> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetchDirectory().finally(() => { inflight = null; });
  }
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
