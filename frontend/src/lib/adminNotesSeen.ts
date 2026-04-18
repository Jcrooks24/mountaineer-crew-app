// Per-scope "last seen" tracking for admin notes.
// scopeKey is "global" for un-scoped notes or the job_uuid for job-scoped notes.

const KEY = "crew_admin_notes_seen_v1";

type SeenMap = Record<string, string>; // scopeKey → latest updated_at seen

function load(): SeenMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(map: SeenMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* noop */
  }
}

export function getAdminNotesSeenAt(scopeKey: string): string {
  return load()[scopeKey] ?? "";
}

export function markAdminNotesSeen(scopeKey: string, latestUpdatedAt: string): void {
  if (!latestUpdatedAt) return;
  const map = load();
  const prev = map[scopeKey];
  if (!prev || new Date(latestUpdatedAt) > new Date(prev)) {
    map[scopeKey] = latestUpdatedAt;
    save(map);
  }
}

export function hasUnseenAdminNotes(
  scopeKey: string,
  latestUpdatedAt: string | null | undefined,
): boolean {
  if (!latestUpdatedAt) return false;
  const seen = getAdminNotesSeenAt(scopeKey);
  if (!seen) return true;
  return new Date(latestUpdatedAt) > new Date(seen);
}
