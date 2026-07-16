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
 *
 * BOL EXCEPTION (ADR 0021): the "pending drains normally" assumption is FALSE for
 * the Digital BOL. Crew routinely hand a shared phone off (or log out) mid-job,
 * offline, right after signing - so the pending submit/sign/pdf ops have no
 * `failed_at` yet, and the wipe destroyed the only copy of a signed legal
 * document. So for `crew_bol_queue_v1` we preserve ALL pending ops, not just
 * failed ones, plus the `crew_bol_draft_v1:*` drafts that hold the signature PNGs
 * the pdf op regenerates from. Still user-scoped, so it only ever restores to the
 * same crew member - no cross-user mis-attribution.
 */

// The wipe clears `crew_` and `mm_`. The backup key must avoid BOTH so it
// survives, and be scoped to the outgoing user so two users' backups don't mix.
const BACKUP_PREFIX = "keepfailed_v1:";

// The BOL queue whose PENDING (not just failed) work we preserve, plus the
// prefix of its signature-bearing drafts. A reserved backup section holds the
// drafts (which are not part of QUEUE_KEYS - they are keyed by job_uuid).
const BOL_QUEUE_KEY = "crew_bol_queue_v1";
const BOL_DRAFT_PREFIX = "crew_bol_draft_v1:";
const BOL_DRAFTS_SECTION = "__bol_drafts__";

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
      // BOL: preserve ALL pending + failed ops (see the BOL EXCEPTION above).
      // Every other queue: only failed entries, which never auto-drain.
      const entries =
        key === BOL_QUEUE_KEY
          ? loadArray(key)
          : loadArray(key).filter(
              (o) => o && typeof o === "object" && (o as { failed_at?: unknown }).failed_at,
            );
      if (entries.length > 0) {
        backup[key] = entries;
        any = true;
      }
    }
    // Preserve the BOL drafts too - the pdf op regenerates the signed PDF from
    // the draft, so a restored pdf op with no draft would have nothing to build.
    const drafts = collectBolDrafts();
    if (drafts.length > 0) {
      backup[BOL_DRAFTS_SECTION] = drafts;
      any = true;
    }
    if (any) localStorage.setItem(backupKey(userId), JSON.stringify(backup));
  } catch {
    /* storage unavailable - nothing to preserve */
  }
}

/** Snapshot every `crew_bol_draft_v1:*` entry as [{k, v}] pairs. */
function collectBolDrafts(): Array<{ k: string; v: string }> {
  const out: Array<{ k: string; v: string }> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(BOL_DRAFT_PREFIX)) continue;
      const v = localStorage.getItem(k);
      if (v != null) out.push({ k, v });
    }
  } catch {
    /* storage unavailable */
  }
  return out;
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
    // Restore BOL drafts. Only write a draft key that is not already present, so
    // a live draft the returning user has since started is never clobbered.
    const drafts = Array.isArray((backup as Record<string, unknown[]>)[BOL_DRAFTS_SECTION])
      ? ((backup as Record<string, unknown[]>)[BOL_DRAFTS_SECTION] as Array<{ k?: string; v?: string }>)
      : [];
    for (const d of drafts) {
      if (d && typeof d.k === "string" && typeof d.v === "string" && d.k.startsWith(BOL_DRAFT_PREFIX)) {
        if (localStorage.getItem(d.k) == null) localStorage.setItem(d.k, d.v);
      }
    }
    localStorage.removeItem(backupKey(userId));
    return restored;
  } catch {
    return 0;
  }
}
