// Tracks the most recent patch-note updated_at this crew member has seen.
// Used by the landing page to show a "new patch notes" indicator, and by
// the Profile patch-notes card to clear that indicator when the user reads.

const KEY = "crew_patch_notes_seen_at_v1";

export function getPatchNotesSeenAt(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function markPatchNotesSeenNow(latestUpdatedAt: string): void {
  try {
    const prev = getPatchNotesSeenAt();
    if (!prev || new Date(latestUpdatedAt) > new Date(prev)) {
      localStorage.setItem(KEY, latestUpdatedAt);
    }
  } catch {
    /* noop - localStorage unavailable */
  }
}

export function hasUnseenPatchNotes(latestUpdatedAt: string | null | undefined): boolean {
  if (!latestUpdatedAt) return false;
  const seen = getPatchNotesSeenAt();
  if (!seen) return true;
  return new Date(latestUpdatedAt) > new Date(seen);
}
