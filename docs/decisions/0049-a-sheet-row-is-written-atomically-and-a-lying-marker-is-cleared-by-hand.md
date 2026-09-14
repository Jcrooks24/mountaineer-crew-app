# 0049 - A Sheet row is written atomically, and a lying marker is cleared by hand

Date: 2026-09-14
Status: Accepted

**Driving scenario:** The owner, 2026-09-14, reporting prod's Sheet Backfill page:
"sheets backfill still has stubborn records that wont drain (repeat issue): 40
record(s) missing from the Sheet" (Materials 5, Bills 33, DVIRs 1, Prior on-duty 1),
unchanged by Re-send. Asked why missing rows matter: DVIRs and prior on-duty
statements in the Sheet are the DOT compliance copy, "and the sheets record is used
to reconcile for jobs invoiced long ago. sheets is expected to match the server, so
it needs to be high fidelity."

**User classes affected** (owner-confirmed 2026-09-14, lines in
[USER_PROFILES.md](../USER_PROFILES.md)): Office administrator, who reconciles
long-invoiced jobs against the Sheet and cannot see a missing row from that side.
Systems owner, who treats the DVIR and prior on-duty rows as the DOT compliance
copy. Movers and crew leads are unaffected: every path changed runs on the server
after their record was accepted.

**Assumption this rests on:** That this process is the only thing writing rows
concurrently to these tabs at volume. The tab lock is in-process; the atomic batch
covers other processes for the insert, but not a keyed delete racing an insert from
another process. If a second long-lived writer appears (a second web worker, a cron
that writes, an Apps Script that inserts rows), the lock stops being sufficient and
row writes need a cross-process guard.

## Context

Measured on prod 2026-09-14, against Postgres and the live Sheet:

| Sync | Missing | What it actually was |
|---|---|---|
| Bills | 33 | 29 bills with zero line items; 4 with items, every item marked exported, no row in the tab |
| Materials | 5 | all marked exported, no row (sheet short by exactly 5) |
| DVIRs | 1 | marked exported, no row |
| Prior on-duty | 1 | marked exported, no row |

No `last_error`, no recent export failures. The Bills count had been 33 in
RUNBOOKS since 2026-08-12.

Three separate defects produced that page:

1. **The audit counted records that owe the sheet nothing.** Bills and Materials
   write one row per line item and none for the record, so an empty bill can never
   appear.
2. **Re-send could not recover a record whose marker outlived its row.** The
   Materials, Bills, DVIR and prior-hours exports skip any record already marked,
   and return 0 without an error. So the audit (which reads the sheet, correctly
   treating it as ground truth) reported the record missing, and every re-drive
   of it silently did nothing.
3. **The rows were lost by the writer.** `_write_rows_top` inserted blank rows under
   the header and then wrote the fixed range `A2`, as two calls. The export pool
   runs two threads. Reproduced offline against the old code:
   - two writers interleave and the second overwrites the first's row, leaving a
     blank row behind. That is the only mechanism in the app that removes a row
     from DVIRs or PriorOnDuty, where nothing deletes rows. The 2026-08-05 cleanup
     swept exactly such "partial-write residue" rows (3 on Bills, 1 on DVIRs),
     which destroyed the evidence.
   - an insert lands between a keyed delete's read and its delete, every data row
     shifts down one, and the delete removes the neighbouring row instead of its
     target. No stale-index 400, because the grid got longer. The existing tab
     lock covered deletes only.

**Not explained by this:** the 5 Materials records are from 2026-03-28, before
insert-at-top shipped (268c0b8, 2026-05-01), when writes were a plain append. Their
loss has some other cause, still unknown. Defect 2's fix recovers them either way.

## Decision

1. **The audit skips records with no line items** (`_has_items` in
   `sheet_backfill.py`). Unparseable JSON counts as having items, so a corrupt
   record stays visible.
2. **A human-initiated re-drive clears the marker for a record a fresh audit reads
   as absent** (`MARKER_CLEARERS`, `clear_markers=True` on `POST .../sheet-backfill`
   and `POST .../sheet-backfill-all`). A caller passing stale ids always gets a fresh
   audit first, so a record that landed in the meantime keeps its marker.
   **The unattended 20-minute sweep never clears one** (owner's call).
3. **A top insert is one `batchUpdate`** carrying `insertDimension` and
   `updateCells` together, **under the per-tab lock** already used by
   `_delete_rows_matching`. The three in-place cell writers that find a row and then
   write to it (event note, event timestamp, entered-by sweep) take the same lock.

## Alternatives not taken

- **Let the automatic sweep clear markers too.** Rejected by the owner. The failure
  that makes an audit misread a whole tab (row 1 overwritten, a key column renamed)
  would become unattended mass duplication, which is how Reimbursements reached 189
  duplicate rows in July.
- **Show empty records separately instead of dropping them.** Not chosen; the owner
  picked exclusion.
- **Atomic write without widening the lock.** Leaves the insert-inside-delete race,
  which deletes the wrong row on Bills on every materials rebuild.
- **Keep two calls, only add the lock.** Closes the in-process race but not a writer
  in another process. The atomic batch costs nothing extra.
- **Diagnose further before changing the write path.** Rows would keep disappearing
  meanwhile, from a tab the office reconciles invoices against.

## Consequences

- Exports to the same tab now queue behind each other. The pool has two threads,
  so the worst case is one export waiting on one Sheets round-trip.
- `_api` retries transient failures. A batch that timed out after Google applied it
  would insert its rows twice. Before, the same retry left a blank row. A duplicate
  is visible to the integrity check; a lost row was not.
- A cell is now written through `updateCells`, so `_cell` must keep matching what
  `valueInputOption=RAW` did: text stays literal (a leading `=` is not a formula),
  numbers and booleans stay typed, empty stays empty. Pinned in
  `backend/scripts/test_sheet_row_fidelity.py`.
- Prod stays short these 11 records until this promotes. After it does, one
  **Drain all** (or Re-send per sync) recovers them.
- **Still open:** the Bills audit keys on `job_uuid`, and the aggregated Materials
  line on the Bills tab carries the same `job_uuid`. A job whose bill line items are
  lost but whose Materials line survives reads as present. Logged in RUNBOOKS Known
  defects.
