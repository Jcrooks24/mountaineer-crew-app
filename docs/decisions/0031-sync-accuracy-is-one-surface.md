# 0031. Sheet accuracy is one surface, and every sync self-heals

**Status:** Active. Shipped 2026-07-31.

## Context

Three admin tools answered facets of one question - "is the Sheet an accurate
mirror of the server, and fix it if not":

- **App Health** (`/api/admin/health`): db, creds, APIs, event/BOL drift, freshness.
- **System Check - Sheet Syncs** (`check_sheets_sync`): per sync, is the tab there,
  is the env var set, did the last export fail.
- **Sheet Backfill** (`sheet_backfill.py`): per record, is it in the Sheet, and a
  button to re-send what is missing.

Two problems on top of the duplication:

1. **Nothing warned that records were missing.** App Health covered event and BOL
   *drift* but not the other seventeen syncs' *records*. The backfill audit knew,
   but only if an admin remembered to open it and press a button. A backlog of
   silently-stranded exports built up unseen (hundreds of records across almost
   every sync).
2. **A stuck record gave no reason.** When the same couple of records would not
   re-send no matter how many times the button was pressed, the tool just kept
   showing them as "missing". The usual cause - the export throwing on that
   specific row every attempt - was recorded in `sheet_sync_status.last_error` but
   never surfaced next to the record.

Also, only events and BOLs self-healed (ADR 0020); the other seventeen fired once
at write time and, if that died, were stranded until a human re-saved the record.

## Decision

**One "Sync & Accuracy" surface, and all nineteen syncs self-heal.**

- **App Health folds in a live record audit.** `_check_sheet_record_drift` runs
  `audit_sheet_backfill` and returns WARN whenever any records are missing from the
  Sheet, with the per-sync breakdown. So the single health check now answers the
  whole question, and the Sheet going out of sync is visible without opening a
  separate tool. It runs the live audit on each health check (three batched Sheets
  reads); it never FAILs, because Postgres is the system of record and a hole in the
  mirror is recoverable.
- **The audit surfaces why a record will not drain.** Each audit row now carries the
  sync's `failing` / `last_error` (joined from `sheet_sync_status` via
  `SHEET_SYNC_REGISTRY`), and the UI shows "export failing: <reason>" next to a
  stuck sync. A record that will not re-send reads as a data/export problem to fix,
  not "the button does nothing".
- **The auto-reconciler self-heals all syncs.** Every ~20 minutes it runs
  `reconcile_all_missing` - the backfill diff for the other seventeen syncs -
  re-driving whatever never landed, capped per cycle and advisory-locked (see the
  reconciler internals). A missing row lands within a cycle without a re-save.
- **The three admin cards are grouped under one "Sync & Accuracy" heading** and
  cross-reference: App Health flags the drift, the backfill card drills in and fixes
  it, the sync-status card explains a structural failure (missing tab, unset env).

## Consequences

- **One question, one answer.** An admin reads App Health; a WARN on "Sheet record
  sync" tells them the mirror is behind and points at Sync & Accuracy to fix it.
- **The backlog drains itself and stays drained.** The reconciler closes the hole
  that let it accumulate; the manual re-send clears a large backlog faster.
- **Idempotent and bounded.** Re-drives are replace-style (keyed delete-before-
  write), so re-driving an already-present record rewrites its row, never
  duplicates. The per-cycle budget protects the 2-worker export pool from being
  flooded ahead of live crew syncs.
- **A genuinely-broken export is visible, not silently retried forever.** It shows
  its `last_error` in the audit and keeps App Health yellow until the underlying
  record/export is fixed - which is the correct signal, not noise.
- **Do not drop the health audit to a cached number or the reconciler to every
  cycle** without accounting for cost: the audit is three batched reads, and the
  reconciler's slower cadence + budget exist to protect the export pool.
