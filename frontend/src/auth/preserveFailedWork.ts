/**
 * Preserve a departing crew member's FAILED offline work across a shared-phone
 * user switch.
 *
 * The problem (found in the non-naive integration vet): `clearCrewState` wipes
 * every `crew_`-prefixed queue when a different user logs in, so crew B logging
 * in on crew A's phone destroys A's un-synced work. Most of A's work drains on
 * the `online` event before B can log in - but FAILED entries never auto-drain
 * (ADR 0013 skips them, deliberately, so a human can retry them), so they sit in
 * the queue until the wipe deletes them. That is the exact silent, one-copy loss
 * ADR 0013 exists to prevent, undone by the wipe.
 *
 * The fix: before the wipe, snapshot A's FAILED entries under a key the wipe does
 * NOT touch, scoped to A's user id. When A next logs in on this device, restore
 * them so A can retry. Pending (not-failed) work is untouched - it drains
 * normally and preserving it would risk syncing it under B's identity.
 *
 * Scope: the localStorage queues. The IndexedDB queues (reimbursements, photos)
 * hold blobs and are wiped via `deleteDatabase`; preserving those across a
 * wholesale DB delete is a larger change and is not covered here (see RUNBOOKS).
 */

// The wipe clears `crew_` and `mm_`. The backup key must avoid BOTH so it
// survives, and be scoped to the outgoing user so two users' backups don't mix.
const BACKUP_PREFIX = "keepfailed_v1:";

// Every localStorage queue that carries a `failed_at` mark (ADR 0013). If a new
// queue is added, add its key here or its failed work is lost on a user switch.
const QUEUE_KEYS = [
  "crew_rods_queue_v1",
  "crew_materials_queue_v2",
  "crew_bol_queue_v1",
  "crew_ld_day_queue_v1",
  "crew_off_job_queue_v1",
  "crew_office_hours_queue_v1",
  "crew_estimator_queue_v1",
  "crew_job_inventory_queue_v1",
  "crew_incident_queue_v1",
] as const;

type FailedBackup = Record<string, unknown[]>;

function backupKey(userId: number | string): string {
  return `${BACKUP_PREFIX}${userId}`;
}

function loadArray(key: string): unknown[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Snapshot the outgoing user's FAILED queue entries. Call BEFORE clearCrewState.
 * A no-op when there is nothing failed, so it never writes an empty backup.
 */
export function backupFailedWork(userId: number | string | undefined | null): void {
  if (userId == null) return;
  try {
    const backup: FailedBackup = {};
    let any = false;
    for (const key of QUEUE_KEYS) {
      const failed = loadArray(key).filter(
        (o) => o && typeof o === "object" && (o as { failed_at?: unknown }).failed_at,
      );
      if (failed.length > 0) {
        backup[key] = failed;
        any = true;
      }
    }
    if (any) localStorage.setItem(backupKey(userId), JSON.stringify(backup));
  } catch {
    /* storage unavailable - nothing to preserve */
  }
}

/**
 * Restore a returning user's preserved failed work into the live queues and
 * clear the backup. Call AFTER the new identity is adopted on login. Merges
 * ahead of whatever is currently queued, deduped by a stable JSON identity so a
 * double-login can't multiply entries; the server is idempotent regardless.
 * Returns how many entries were restored (for an optional "N items are still
 * here" notice).
 */
export function restoreFailedWork(userId: number | string | undefined | null): number {
  if (userId == null) return 0;
  try {
    const raw = localStorage.getItem(backupKey(userId));
    if (!raw) return 0;
    const backup = JSON.parse(raw) as FailedBackup;
    let restored = 0;
    for (const key of QUEUE_KEYS) {
      const saved = Array.isArray(backup[key]) ? backup[key] : [];
      if (saved.length === 0) continue;
      const current = loadArray(key);
      const seen = new Set(current.map((o) => JSON.stringify(o)));
      const merged = [...current];
      for (const entry of saved) {
        const id = JSON.stringify(entry);
        if (!seen.has(id)) {
          seen.add(id);
          merged.push(entry);
          restored++;
        }
      }
      localStorage.setItem(key, JSON.stringify(merged));
    }
    localStorage.removeItem(backupKey(userId));
    return restored;
  } catch {
    return 0;
  }
}
