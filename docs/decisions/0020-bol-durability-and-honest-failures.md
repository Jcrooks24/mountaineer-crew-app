# 0020. The Digital BOL export is durable, and BOL endpoints fail honestly

**Status:** Active. Decided 2026-07-16 after a signed BOL reached neither the
Google Sheet nor the Drive folder, and a lifecycle trace found several
independent silent-loss paths.

## Context

A Bill of Lading is a signed legal document. The lifecycle: the crew build the
inventory and sign on-device (offline-capable), the ops queue to the server, the
server writes Postgres and schedules a Sheets export on a bounded background
pool, and a PDF is uploaded to Drive. A trace of a lost BOL surfaced four
independent defects, each able to lose data on its own:

1. **Endpoints lied with HTTP 200.** `POST /api/bol` and `POST /api/bol/{id}/pdf`
   returned `{"ok": false}` with status **200** on a DB or Drive failure. The
   offline drain checks only the HTTP status (`apiFetch` throws on `!res.ok`), so
   a 200 was read as success and the queued op - signatures and all - was
   dropped. (`sign` already raised 500; save and pdf were the outliers.)

2. **The export had no durability.** After the commit, the export was scheduled
   onto an in-process `ThreadPoolExecutor`. That thread dies with the worker -
   Render recycles every `--limit-max-requests`, plus the OOM history - between
   commit and execution, and nothing retried. The BOL sat in Postgres, absent
   from the sheet, forever. There was a reconciler for events but not for BOLs.

3. **Destructive export ordering.** The exporter deleted every sheet row for the
   `bol_id` *before* writing the fresh ones. An exception in between left the
   sheet with no row for a BOL that previously had one.

4. **Staging shared production's Drive folder.** The signed-BOL folder was
   resolved by NAME ("Signed Bills of Lading"), and `DRIVE_BOL_FOLDER_NAME` was
   unset on staging, so staging resolved the SAME real folder as prod - and the
   PDF upload replaces content in place by file id, so staging could overwrite a
   production document.

## Decision

**Fail honestly, make the export durable and non-destructive, and isolate the
Drive folder by id.**

1. **Real status codes.** BOL endpoints raise `500` on a DB error and `502` on a
   Drive-upload failure, never 200-with-`ok:false`. Both are transient by the
   queue's taxonomy (`isPermanentRejection` retries 5xx), so the op is kept and
   re-sent, not dropped. Defense-in-depth: the BOL drain also treats a
   `{ok:false}` body as a transient failure, so a future 200-lie can't silently
   drop a signed BOL either.

2. **A durable reconciler.** `bol_reconcile.py` mirrors the events reconciler:
   it finds BOLs in `digital_bols` with no `sheet_generic_exports` entry and
   re-exports them (idempotently). It runs in the advisory-locked background
   auto-reconciler every cycle, is surfaced as a "Sheet drift - BOLs" health
   check, and can be forced for one document via
   `POST /api/admin/bol/{bol_id}/reexport` - the first on-demand re-export path
   (previously the only way to force a write was a real save).

3. **Write-first, then delete stale.** The exporter now writes the fresh rows
   first, then deletes only the rows for that `bol_id` whose timestamp differs
   from the fresh write. A mid-export crash leaves at worst a transient
   DUPLICATE (visible, and cleaned up by the reconciler or the next real change),
   never a gap. An idempotency skip (the `(bol_id, updated_at)` dedupe key)
   prevents re-writing an unchanged state.

4. **`DRIVE_BOL_FOLDER_ID` per environment.** The folder is resolved by id first
   (matching the estimator/reimbursement folders), falling back to the legacy
   name lookup only when unset. Staging and prod set different ids, so staging
   can never touch production's documents.

## Consequences

- Nothing about a signed BOL is silently dropped: a server failure surfaces to
  the crew (a queued op that stays queued and, on a permanent 4xx, a failed
  banner) and the reconciler is the backstop for anything the live path missed.
- The write-first ordering trades a possible gap for a possible transient
  duplicate. Duplicates are recoverable and visible; a missing signed document is
  neither. A very narrow window remains (process death in the ~10 ms between the
  summary write and its dedupe commit, or between the summary and item writes)
  that could leave a same-timestamp duplicate or a summary-without-items row; the
  reconciler handles the missing-summary case, and a same-timestamp duplicate
  self-heals on the next real change. Item-level reconciliation is a known
  follow-up (RUNBOOKS).
- Someone must set `DRIVE_BOL_FOLDER_ID` on both Render services. Until the
  staging id is set, staging still shares prod's folder - flagged in
  CREDENTIALS.md and .env.staging.example as load-bearing.

## What would break if you undid this

Returning 200-with-`ok:false` from any BOL endpoint re-opens the exact silent
drop: the drain acks it and deletes the signed op. Removing the reconciler
re-exposes every BOL to permanent loss on a single worker recycle between commit
and export. Going back to delete-before-write reintroduces the gap-on-crash.
Resolving the Drive folder by name lets staging overwrite production BOLs. Each
looked reasonable on its own; each was a way to lose a signed legal document.
