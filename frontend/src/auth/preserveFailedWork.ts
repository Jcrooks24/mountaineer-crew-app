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
 * JOB REPORT / BILL EXCEPTION (added 2026-09-09, after a production report): the
 * same assumption is false for the close-out. A job report is typed up over a
 * whole job - hours per crew member, close-out answers, the bill - and it is
 * NEVER queued: it is a draft under `crew_report_draft_v1:<job_uuid>` that only
 * becomes a queued fact when the POST succeeds. So it has no `failed_at` to
 * preserve and no queue to drain, and the wipe simply deletes it.
 *
 * That is not hypothetical. A crew member hit a 401, was told by the app to
 * "log out and sign in again", did so, and lost the entire report - the app
 * instructed them to take the action that destroyed their work. Preserving these
 * two draft prefixes is what makes that advice survivable.
 *
 * PAYROLL NOTE EXCEPTION (added 2026-09-09, found by a vet): the office's rolling
 * payroll note keeps a local mirror on every keystroke, precisely so a save that
 * never reached the server is not lost. Its key is `crew_`-prefixed, so the wipe
 * deleted it - cutting the net at the one moment it exists for, and leaving the
 * server's copy to win silently on the next load, which is the exact outcome
 * that component's design says must never happen. Same treatment as the
 * close-out drafts, and user-scoped for the same reason.
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

// The close-out drafts. Same shape as the BOL drafts - one copy, keyed by
// job_uuid, never queued - so they get the same treatment and their own reserved
// section. Both are preserved together because a report and its bill are one
// piece of work to the crew member who typed them.
const JOB_DRAFT_PREFIXES = ["crew_report_draft_v1:", "crew_bill_draft_v1:"] as const;
const JOB_DRAFTS_SECTION = "__job_drafts__";

// The office's rolling payroll note (see components/PayrollNotes.tsx). Same
// exception as the close-out drafts and for the same reason: it is not a queue,
// so it has no `failed_at` to notice it by, and the mirror IS the safety net for
// a save that never reached the server. The wipe was cutting exactly that net -
// found by vet 2026-09-09. Restored only to the account that wrote it (office
// decision, 2026-09-09), so a second admin on the same machine sees only the
// server's copy.
const PAYROLL_NOTE_MIRROR_KEY = "crew_admin_payroll_notes_mirror_v1";
const PAYROLL_NOTE_SECTION = "__payroll_note__";
// Above this the note could not have been saved anyway (the server refuses more
// than a Google Sheets cell holds, 50k), and stuffing it into the backup would
// risk the QuotaExceededError that loses the WHOLE backup - signed BOLs
// included. Skipped loudly rather than truncated: silently shortening the text
// is the one outcome this field must never produce.
const PAYROLL_NOTE_MAX_CHARS = 100_000;

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

// Most sections hold an array of queue entries. The payroll-note mirror is the
// one exception: a single string under its own section key (see
// PAYROLL_NOTE_SECTION), which is why the value type is not array-only.
type FailedBackup = Record<string, unknown[] | string>;

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


/** The close-out drafts worth carrying across a wipe, newest jobs first.
 *
 * BOUNDED ON PURPOSE. The BOL draft block above is scarred by this: it used to
 * copy every draft on the device at logout, which on a phone with a season of
 * them was megabytes of synchronous JSON on the main thread - the freeze crews
 * reported - and briefly doubled stored bytes right before the wipe, on exactly
 * the devices nearest quota.
 *
 * Report and bill drafts are plain JSON rather than base64 signatures, so they
 * are far smaller, but the same reasoning applies: a crew member logging out
 * mid-job has ONE job in flight, not forty. Group by job_uuid, take the newest
 * few, and keep a report with its own bill - to the person who typed them they
 * are one piece of work.
 */
const MAX_JOB_DRAFT_JOBS = 3;

function collectJobDrafts(): Array<{ k: string; v: string }> {
  const byJob = new Map<string, { at: string; entries: Array<{ k: string; v: string }> }>();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    const prefix = JOB_DRAFT_PREFIXES.find((p) => k.startsWith(p));
    if (!prefix) continue;
    const v = localStorage.getItem(k);
    if (v == null) continue;
    const job = k.slice(prefix.length);
    let at = "";
    try {
      const parsed = JSON.parse(v) as { savedAt?: unknown };
      if (typeof parsed?.savedAt === "string") at = parsed.savedAt;
    } catch {
      /* unparseable draft: keep it, but it sorts last */
    }
    const cur = byJob.get(job) || { at: "", entries: [] };
    cur.entries.push({ k, v });
    // The job's recency is its most recently touched half.
    if (at > cur.at) cur.at = at;
    byJob.set(job, cur);
  }
  return [...byJob.values()]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, MAX_JOB_DRAFT_JOBS)
    .flatMap((g) => g.entries);
}

/**
 * Snapshot the outgoing user's FAILED queue entries. Call BEFORE clearCrewState.
 * A no-op when there is nothing failed, so it never writes an empty backup.
 */
export function backupFailedWork(userId: number | string | undefined | null): boolean {
  if (userId == null) return true;
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
    //
    // ONLY THE DRAFTS A PRESERVED OP ACTUALLY NEEDS. This used to copy EVERY
    // `crew_bol_draft_v1:*` on the device, unconditionally, even when there were
    // no BOL ops at all - and each draft holds up to four base64 signature PNGs.
    // On a phone with a season of drafts that is megabytes of synchronous
    // getItem + JSON.stringify + setItem on the main thread at logout, which is
    // the freeze crews reported. It also briefly DOUBLED the stored bytes, at
    // the exact moment before the wipe, on the devices most likely to be near
    // quota already.
    const drafts = collectBolDraftsFor(neededDraftJobs(backup[BOL_QUEUE_KEY] as unknown[] | undefined));
    if (drafts.length > 0) {
      backup[BOL_DRAFTS_SECTION] = drafts;
      any = true;
    }
    // The close-out drafts. Unconditional rather than keyed off a queue, because
    // there IS no queue: a job report is only ever a draft until its POST
    // succeeds, so there is no `failed_at` anywhere to notice it by.
    const jobDrafts = collectJobDrafts();
    if (jobDrafts.length > 0) {
      backup[JOB_DRAFTS_SECTION] = jobDrafts;
      any = true;
    }
    // The payroll note's mirror. One small key, so no grouping or capping to do
    // beyond the size guard - but it is backed up whether or not it differs from
    // the server, because nothing on this side can tell the two apart. A copy
    // that turns out to match the server simply restores invisibly.
    const note = localStorage.getItem(PAYROLL_NOTE_MIRROR_KEY);
    if (note != null && note !== "") {
      if (note.length <= PAYROLL_NOTE_MAX_CHARS) {
        backup[PAYROLL_NOTE_SECTION] = note;
        any = true;
      } else {
        // eslint-disable-next-line no-console
        console.error(
          "[preserveFailedWork] payroll note too large to back up; it is about "
          + "to be wiped and was never saved:", note.length, "chars",
        );
      }
    }
    if (any) localStorage.setItem(backupKey(userId), JSON.stringify(backup));
    return true;
  } catch (e) {
    // NOT SWALLOWED ANY MORE. The caller wipes immediately after this returns,
    // so a failure here - realistically QuotaExceededError, on exactly the full
    // devices this matters most for - meant the preservation silently failed and
    // the wipe then destroyed the signed BOL it was meant to save. That is the
    // one-copy loss ADR 0021 exists to prevent, reintroduced by the code written
    // to prevent it.
    // eslint-disable-next-line no-console
    console.error("[preserveFailedWork] backup FAILED, work is still at risk:", e);
    return false;
  }
}

/** The job_uuids whose signature drafts a preserved op still needs.
 *
 *  Only the `pdf` op rebuilds from a draft, and it is the only op that carries a
 *  job_uuid. A submit or sign op holds its own payload and needs nothing else. */
function neededDraftJobs(bolOps: unknown[] | undefined): Set<string> {
  const jobs = new Set<string>();
  for (const op of bolOps || []) {
    if (!op || typeof op !== "object") continue;
    const o = op as { op?: unknown; job_uuid?: unknown };
    if (o.op === "pdf" && typeof o.job_uuid === "string" && o.job_uuid) {
      jobs.add(o.job_uuid);
    }
  }
  return jobs;
}

/** Snapshot only the named jobs' drafts as [{k, v}] pairs.
 *
 *  Returns immediately for an empty set, which is the common case - most logouts
 *  have no pending pdf op - so the usual cost of this function is now zero
 *  instead of a full localStorage scan plus a copy of every signature on the
 *  device. */
function collectBolDraftsFor(jobs: Set<string>): Array<{ k: string; v: string }> {
  const out: Array<{ k: string; v: string }> = [];
  if (jobs.size === 0) return out;
  try {
    for (const job of jobs) {
      const k = `${BOL_DRAFT_PREFIX}${job}`;
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
    // Restore the close-out drafts on the same terms: never clobber a draft the
    // returning user has since started on this device.
    const jobDrafts = Array.isArray((backup as Record<string, unknown[]>)[JOB_DRAFTS_SECTION])
      ? ((backup as Record<string, unknown[]>)[JOB_DRAFTS_SECTION] as Array<{ k?: string; v?: string }>)
      : [];
    for (const d of jobDrafts) {
      if (d && typeof d.k === "string" && typeof d.v === "string"
          && JOB_DRAFT_PREFIXES.some((p) => d.k!.startsWith(p))) {
        if (localStorage.getItem(d.k) == null) localStorage.setItem(d.k, d.v);
      }
    }
    // Restore the payroll note on the same non-clobber terms: if this admin has
    // already typed something on this device since, that is newer and wins.
    const note = (backup as Record<string, unknown>)[PAYROLL_NOTE_SECTION];
    if (typeof note === "string" && note !== ""
        && localStorage.getItem(PAYROLL_NOTE_MIRROR_KEY) == null) {
      localStorage.setItem(PAYROLL_NOTE_MIRROR_KEY, note);
    }
    localStorage.removeItem(backupKey(userId));
    return restored;
  } catch {
    return 0;
  }
}
