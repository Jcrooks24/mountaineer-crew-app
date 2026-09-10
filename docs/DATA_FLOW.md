# Data Flow

Every piece of data in this app, and the answer to two questions about it:
**what event triggers the exchange**, and **when the transfer actually happens**.

[ARCHITECTURE.md](ARCHITECTURE.md) describes the shape of the system. This doc is
the field-level ledger underneath it. When they disagree, this one is the one that
was checked against the code most recently, but fix both.

## Verified against

| | |
|---|---|
| Branch / commit | `main` @ `159d24b` |
| Date verified | 2026-09-10 |
| Verified by | reading the code, not by exercising the app |

**Folded at the 2026-09-10 promotion**, the first since 2026-08-13 (`d952d64`).
The staging delta covering 64 commits and 10 migrations was merged in below under
"Folded from staging at the 2026-09-10 promotion", and
[DATA_FLOW_STAGING.md](DATA_FLOW_STAGING.md) was emptied to its skeleton. Two
undecided questions were deliberately left there rather than folded, because they
are decisions nobody has made rather than facts about the code.

**This doc lives on `staging` but its baseline is `main`.** That is deliberate:
production behavior is the thing worth pinning down, and staging moves too fast to
re-verify every session. Unpromoted staging work is logged in its own delta doc,
**[DATA_FLOW_STAGING.md](DATA_FLOW_STAGING.md)**, and folded in at promotion.

## How to keep this current

1. **Same-commit rule.** Any change to a queue, a drain trigger, a debounce timing,
   an endpoint, or a Sheet export path is documented in the same commit. New dev work
   on `staging` goes in [DATA_FLOW_STAGING.md](DATA_FLOW_STAGING.md), not here. This
   doc changes only at promotion. Part of the Definition of done in
   [CLAUDE.md](../CLAUDE.md).
2. **`/handoff` sweeps both** at the end of a working session.
3. **`/vet` gates both at promotion.** Fold the staging delta into this doc, empty
   the delta, bump "Verified against". See the Data-flow doc gate in
   [VETTING_PROTOCOL.md](VETTING_PROTOCOL.md).

## The three hops

Nothing in this app is a single synchronous write. Every datum makes up to three
independent hops, and each can be pending while the others have completed.

**Hop 1, tap to device.** Synchronous, always first, never skipped. The write lands
in `localStorage` (or IndexedDB for blobs) before any network call is attempted.
This is what makes the app usable with no signal.

**Hop 2, device to Postgres.** Per-feature queues, each with its own drain function.
There is **no central sync coordinator, no interval timer, and no Background Sync
API**. A queue moves only when something calls its drain. The trigger table below is
the complete list of things that do.

**Hop 3, Postgres to Sheet.** Nearly always off the request path.
`sheets_export.run_export_in_background()` hands the work to a **2-thread pool**
(`_EXPORT_POOL`) and the HTTP response returns immediately. Google latency is
invisible to the crew. A failed export leaves Postgres correct and the Sheet stale.

**The catch-up layer for hop 3** is `auto_reconciler.py`: one daemon thread per
worker, started from `main.py::on_startup`, sleeps first then fires every
`RECONCILE_INTERVAL_S = 300` seconds, guarded by a Postgres advisory lock
(`0x7C8E0001`) so only one worker runs it. **It covers events and signed BOLs only.**
Every other export fires once at write time and nothing re-drives it; recovery for
those is `sheet_backfill.py`, which is admin-triggered and not scheduled.

## Legend

Used in the per-domain field tables.

| Mark | Meaning |
|---|---|
| `[x]` | Field completes its class's full path: device to Postgres to Sheet, as described for that domain. |
| `[ ]` | Field does **not** complete the path. Deviation named in the row. |
| `[-]` | Not device-sourced, so adherence does not apply. Server constant, admin-entered, or derived at export time. |

## Flow classes

| Class | Shape | Offline behavior |
|---|---|---|
| **A. Queued write** | local write, queue key, drain on trigger, POST, background Sheet export | Survives. Drains on reconnect. |
| **B. Direct write** | local draft, direct POST on submit, no queue | **Fails offline.** Draft survives, transmission does not. |
| **C. Debounced push** | local write, timer, POST | Survives only if the timer fires while online. |
| **D. Read cache** | server to localStorage, refreshed on trigger | Serves last-known value. |
| **E. Blob upload** | IndexedDB blob, Drive upload, URL to Postgres | Survives. Drains on reconnect. |

## Trigger reference

Everything that causes a hop-2 transfer, with the drain function it calls.

| Trigger | Source | Drains | Timing |
|---|---|---|---|
| `window` `online` | `App.tsx` | `syncQueueNow`, `drainNotePatchQueue`, `syncMaterialsInBackground`, `drainIncidents`, `drainOffJob`, `drainPendingPhotos`, `drainJobInventory`, `drainBugReports`, `drainFeatureRequests`, `drainJobSetups`, `drainChecklistChecks`, `drainReimbursements`, `drainLongDistance` (BOL + RODS + LD day, `Promise.allSettled`) | immediate on event |
| `isOnline` state flip | `App.tsx:1857` | `syncQueueNow`, `drainNotePatchQueue`, `drainPendingPhotos` | immediate. Redundant with the above on purpose: some browsers miss `online` after sleep or a VPN flap |
| App boot | `App.tsx:1758` mount effect | same set as `online`, plus `loadHistoryFromBackend`, `ensureDirectory` | once per cold load |
| Action tap | `App.tsx::recordEvent` | `syncQueueNow` | immediate, inline with the tap |
| **2-minute timer** | `App.tsx` while the app is open | `drainReimbursements` **only** | every 2 min. Exists because neither boot nor `online` fires when the app stays connected and the SERVER has a bad minute (a deploy, a 503, a cold start). `syncQueue()` returns immediately when offline, already draining, or empty |
| Component mount | BillCalculator, EstimatorTab, BillOfLadingForm, OfficeHours, Reimbursement | that feature's `syncQueue` / `drain` | on mount and on key change. **No longer the only trigger for any queue except the estimator** |
| `visibilitychange` / `focus` | BillCalculator `:523`, BolInventoryTab `:71`, JobReport `:329` | that feature's refresh | on tab return |
| Debounce timer | job notes `App.tsx:1840`, BOL `bolStore.ts:647`, estimator meta `EstimatorTab.tsx:338`, estimator item `:997` | `flushJobNotes`, `bolStore.syncQueue`, `flushMetaSave`, `flushItemSave` | 1500ms / 1000ms / 800ms / 600ms |

**Failure policy, uniform across every queue** (`lib/queueFailure.ts`, ADR 0013): a
permanent 4xx marks the entry `failed_at` and **keeps** it in the queue, skipped by
the drain so it cannot wedge the line, surfaced to the crew with Retry and Discard.
It leaves only when a person says so. **401, 403, 408 and 429 are deliberately
classified transient** so neither an expired token nor a Google Sheets rate limit
can destroy a day of queued field work. **413 is permanent everywhere**: the
body-size middleware and three upload endpoints return it, and an oversized upload
that retries forever never gets smaller.

There is **one** classifier. `api/client.ts::isPermanentFailure` (an allowlist of
400/404/409/422, which disagreed with the other) is deleted. Every queue
mark-and-keeps: `jobChecklistStore` and `jobSetupStore` used to delete on a
permanent rejection, and `bugReportStore` / `featureRequestStore` had no
permanent-versus-transient split at all, so a refused report was re-POSTed forever.

## Sheet export reference

| Export function | Tab env var (default) | Strategy | Reconciled |
|---|---|---|---|
| `export_events_to_sheets` | `SHEETS_EVENTS_TAB` (`Events`) | append at top, dedupe via `sheet_event_exports` | yes, 300s |
| `update_event_note_in_sheets` | `SHEETS_EVENTS_TAB` | in-place cell write, per-event lock | no |
| `update_event_timestamp_in_sheets` | `SHEETS_EVENTS_TAB` | in-place cell write, separate lock | no |
| `delete_event_from_sheets` | `SHEETS_EVENTS_TAB` | row delete | no |
| `export_materials_to_sheets` | `SHEETS_MATERIALS_TAB` (`Materials`) | append at top | no |
| `delete_materials_from_sheets` | `SHEETS_MATERIALS_TAB` | row delete by `submission_id` | no |
| `export_job_report_to_sheets` | `SHEETS_JOB_REPORTS_TAB` (`JobReports`) | replace by `job_uuid` | no |
| `export_bill_to_sheets` | `SHEETS_BILLS_TAB` (`Bills`) | append, keyed `job_uuid:updated_at:item_id` | no |
| `rebuild_job_materials_total_in_bills` | `SHEETS_BILLS_TAB` | replace by materials marker | no |
| `export_dvir_to_sheets` | `SHEETS_DVIRS_TAB` (`DVIRs`) | append, one row per phase | no |
| `export_prior_hours_to_sheets` | `SHEETS_PRIOR_HOURS_TAB` (`PriorOnDuty`) | append, dedupe by `statement_id` | no |
| `export_rods_to_sheets` | `SHEETS_RODS_TAB` (`RODS`) | replace by `rods_id` | no |
| `export_ld_day_to_sheets` | `SHEETS_LD_PAY_TAB` (`LongDistancePay`) | replace by `day_id` | no |
| `export_estimate_to_sheets` | `SHEETS_ESTIMATES_TAB` + `SHEETS_ESTIMATE_ITEMS_TAB` | replace by `estimate_uuid`, coalesced | no |
| `export_bol_to_sheets` | `SHEETS_BOLS_TAB` + `SHEETS_BOL_ITEMS_TAB` | replace by `bol_id`, coalesced | yes, 300s (`bol_reconcile.py`) |
| `export_job_inventory_to_sheets` | `SHEETS_JOB_INVENTORY_TAB` + `..._ITEMS_TAB` | replace by `job_uuid`, coalesced | no |
| `export_incident_to_sheets` | `SHEETS_INCIDENTS_TAB` (`Incidents`) | replace by `incident_uuid`, coalesced | no |
| `export_office_hours_to_sheets` | `SHEETS_OFFICE_HOURS_TAB` (`OfficeHours`) | replace by `entry_uuid` | no |
| `export_reimbursement_to_sheets` | `SHEETS_REIMBURSEMENTS_TAB` (`Reimbursements`) | replace by `reimbursement_uuid` | no |
| `export_availability_window_to_sheets` | `SHEETS_AVAILABILITY_TAB` (`Availability`) | replace by (user, `window_start`), coalesced | no |
| `export_off_job_to_sheets` | `SHEETS_OFF_JOB_TAB` (`OffJobHours`) | replace by `entry_uuid` | no |

Coalesced exports (`schedule_*_export`) hold an in-flight set plus a rerun flag per
key, so a burst of autosaves collapses into one export plus at most one follow-up.
This exists because estimator autosave fired a PATCH per keystroke and grew the pool
queue without bound until the worker OOMed.

**Health tracking:** every background export records success or failure into
`sheet_sync_status` keyed by **function name**, not by record. So the health check
tells you "office hours export is failing" but not which entry was lost. That is
what `sheet_backfill.py` is for.

---

# Per-domain field ledger

## Timeline events

**Class A.** The spine of the app. Everything else hangs off `job_uuid`.

| | |
|---|---|
| Local keys | `crew_event_log_v1` (log), `crew_event_queue_v1` (outbox) |
| Drain | `App.tsx::syncQueueNow` |
| Trigger | inline on tap, `online`, `isOnline` flip, boot |
| Endpoint | `POST /api/sync` (batch) |
| Export | `export_events_to_sheets`, reconciled every 300s |
| Idempotency | client `crypto.randomUUID()` `event_id`, DB unique, retry-safe |

| Field | Adheres | Note |
|---|---|---|
| `event_id` | `[x]` | client-generated, the dedupe key |
| `timestamp` | `[x]` | device clock at capture, user-editable afterwards |
| `logged_at` | `[x]` | equals `timestamp` on insert, never editable, diverges only after a timestamp edit |
| `job_uuid` | `[x]` | |
| `job_name` | `[x]` | resolved at sync time from `crew_job_meta_v1:` |
| `job_date` | `[x]` | resolved at sync time from `crew_job_meta_v1:` |
| `type` | `[x]` | |
| `note` | `[x]` | |
| `lat` / `lng` / `accuracy_m` | `[x]` | blank when location is refused or unavailable |
| `device_id` | `[x]` | `crew_device_id_v1`, sent on the batch not the event |
| `created_by` | `[x]` | stamped at **capture**, not at sync. Shared-phone correctness |
| `synced` | `[-]` | literal constant `"synced"` written at export |
| `entered_by` / `entered_on` | `[-]` | admin data-entry checkpoint, from `AdminEntryStatus` |

## Job notes

**Class C.** Rides the events pipeline as a sentinel row rather than its own table.

| | |
|---|---|
| Local keys | `crew_job_comments_v1:` (text), `crew_job_notes_event_v1:` (sentinel id), `crew_job_notes_synced_v1:` (last accepted) |
| Drain | `App.tsx::flushJobNotes`, then the events queue |
| Trigger | **1500ms debounce** after the last keystroke |
| Endpoint | first save `POST /api/sync` as a `JOB_NOTES` event, later saves `PATCH /api/events/{id}` |

Text is written to localStorage on **every keystroke**, independent of the debounce,
so a refresh never loses typing. The synced snapshot survives reloads and job
switches, so a save pending at the moment of a switch flushes when the user returns.
`JOB_NOTES` rows are filtered out of the timeline render.

## Event edits (note and timestamp)

**Class A.**

| | |
|---|---|
| Local key | `crew_event_note_patch_queue_v1` |
| Drain | `App.tsx::drainNotePatchQueue` |
| Trigger | `online`, `isOnline` flip, boot, and after every `syncQueueNow` |
| Endpoint | `PATCH /api/events/{event_id}` |
| Export | `update_event_note_in_sheets` / `update_event_timestamp_in_sheets`, **synchronous inside the PATCH**, not pooled |

The sheet write here is deliberately synchronous so memory stays bounded by uvicorn's
worker count. A sheet failure never fails the PATCH. **Not reconciled**: if the cell
write fails, the Sheet keeps the old value until the next edit.

An edit to a still-queued event is applied to the queued copy in place, so it syncs
once with the final value rather than syncing then patching.

## Materials

**Class A.** Feeds billing, which is why ADR 0013 exists.

| | |
|---|---|
| Local keys | `crew_materials_queue_v2` (global, all jobs), `crew_materials_cache_v1:` (per job) |
| Drain | `materialsStore.syncQueue`, refresh `materialsStore.fetchAndCache`, combined `syncAndFetch` |
| Trigger | BillCalculator mount, `online`, `visibilitychange`; plus boot and `online` from `App.tsx::syncMaterialsInBackground` |
| Endpoint | `POST /api/materials`, `DELETE /api/materials/{id}` |
| Export | `export_materials_to_sheets`, **not reconciled** |

Rendered list is `cache ∪ queued-adds − queued-deletes`. A **failed** delete does not
hide its item, because the item still exists on the server and hiding it would tell
the crew they deleted something that is still on the bill. `fetchAndCache` holds a
per-`job_uuid` in-flight guard: mount plus `visibilitychange` plus `focus` plus
`online` used to fire a burst of `limit=500` reads that OOMed the worker.

| Field | Adheres | Note |
|---|---|---|
| `submission_id` | `[x]` | client UUID |
| `created_at` | `[x]` | device clock at enqueue |
| `job_uuid` / `job_name` / `job_date` / `job_label` | `[x]` | `job_date` is sent empty by `enqueueAdd`, filled server-side |
| `notes` | `[x]` | sent empty by the current UI |
| `item_name` / `qty` / `unit_price` | `[x]` | |
| `line_total` / `submission_total` | `[-]` | computed at export |
| `entered_by` / `entered_on` | `[-]` | admin checkpoint |

## Photos

**Class E.**

| | |
|---|---|
| Local store | IndexedDB `crew_app_db`, object store `photos` |
| Drain | `App.tsx::drainPendingPhotos` |
| Trigger | boot, `online`, `isOnline` flip |
| Destination | Google Drive, URL recorded in Postgres. **No Sheet row of its own**; URLs surface through the Incidents export |

Drains **silently**: no spinner, no error banner. It runs unprompted and a failure is
not something the crew asked for and can act on, so the photo stays queued and
retryable. Stops mid-batch if signal drops again rather than burning through the rest
marking everything failed. Guarded by `drainingPhotosRef`.

**Captions are not queued, which is why swallowing mattered.** `POST /api/photos/caption`
used to return HTTP 200 with `{"ok": false}` when the photo was missing or the DB
commit failed. `apiFetch` throws only on `!res.ok`, so the UI showed "Note saved",
cleared the draft, and the note was gone. For an incident photo the note **is** the
record. It now returns **404** when the photo is not found (permanent) and **500**
when the commit fails (retryable), and the client turns on whether a local copy
holds the caption:

- **Local photo** - `updatePhoto` stored it and it rides along on the next upload.
  Every server failure is swallowed, a 404 included, because a not-yet-uploaded
  photo genuinely is not on the server yet.
- **Server-only photo** - nothing else holds the note, so every failure is
  surfaced, offline included, and the crew member knows to redo it on signal.

Drive description mirroring stays best-effort and never fails the request.

## Job inventory

**Class A.**

| | |
|---|---|
| Local key | `crew_job_inventory_queue_v1` |
| Drain | `jobInventoryQueue.drainAll` (all jobs) and `.drain` (one job) |
| Trigger | boot and `online` from `App.tsx`, **regardless of tab or mode** |
| Endpoint | `POST /api/job-inventory` |
| Export | `export_job_inventory_to_sheets`, coalesced per `job_uuid`, **not reconciled** |

`drainAll` exists specifically because this queue used to drain only from inside
`ActualInventory`. Hiding the Inventory tab on local jobs (ADR 0015) would have
stranded everything queued there. `pruneStale` deletes entries after 14 days.

Summary fields `furniture_count` / `box_count` / `item_count` are `[-]`, computed at
export from the item rows. Item fields `item_id`, `kind`, `item_name`, `qty`,
`pack_type`, `room`, `notes` are all `[x]`.

## Estimator

**Class C into Class A.**

| | |
|---|---|
| Local key | `crew_estimator_queue_v1` |
| Drain | `estimatorQueue.drain`, called from `EstimatorTab.tsx:524` |
| Trigger | **EstimatorTab mount / `estimate_uuid` change only.** Meta autosave 800ms, item autosave 600ms |
| Endpoint | `POST /api/estimates/{uuid}/items`, `PATCH` for edits |
| Export | `export_estimate_to_sheets`, coalesced per `estimate_uuid`, **not reconciled** |

**Deviation, see Deviations below.** This queue has no `online` listener. An item
queued offline does not ship on reconnect; it waits until the crew reopens that
estimate.

All summary fields (`customer_name`, `customer_email`, `customer_phone`, `move_date`,
`origin_address`, `destination_address`, `origin_access_notes`,
`destination_access_notes`, `special_items_notes`, `general_notes`,
`estimated_hours`, `job_uuid`) are `[x]`. `estimated_weight_lbs`,
`estimated_cubic_ft`, `item_count` are `[-]`, derived at export. Item fields
(`item_id`, `room`, `subcategory`, `item_name`, `qty`, `weight_lbs_each`,
`cubic_ft_each`, `notes`) are `[x]`; `total_weight_lbs`, `total_cubic_ft`,
`exported_at` are `[-]`.

## Digital BOL

**Class C into Class A.** The most elaborate queue in the app.

| | |
|---|---|
| Local keys | `crew_bol_draft_v1:` (per job), `crew_bol_queue_v1` (heterogeneous op queue) |
| Drain | `bolStore.syncQueue`, autosave entry point `bolStore.autosyncDraft` |
| Trigger | **1000ms debounce** after any item edit; plus boot and `online` app-wide (`App.tsx`, `drainLongDistance`), mount, and save. Before 2026-09-09 it drained only while `<BillOfLadingForm>` was mounted |
| Endpoint | `POST /api/bol` and signing / PDF endpoints |
| Export | `export_bol_to_sheets`, coalesced per `bol_id`, **reconciled every 300s** via `bol_reconcile.py` |

Op queue is heterogeneous: inventory upsert, signing session, PDF regenerate-and-
upload, drained in order. Carries `attempts` / `retry_at` for transient backoff so a
repeatedly failing op (a Drive 502) is spaced out instead of re-fired on every
mount, `online` and save. `autosyncDraft` enqueues the intent **immediately** so it
survives a reload, then debounces only the network push. Autosync deliberately does
**not** require the completeness attestation; signing stays a gated step.

Summary fields `bol_id`, `job_uuid`, `job_name`, `job_date`, `status`,
`inventory_verified`, `inventory_note`, `origin_signed_at`, `dest_signed_at`,
`final_charges`, `walkthrough_notes` are `[x]`. `created_by` is `[x]`,
`signed_pdf_url` is `[-]` (set after Drive upload), `item_count` is `[-]` (derived).
Item fields `item_no`, `item_name`, `qty`, `packed_by`, `condition_notes`,
`photo_links` are `[x]`.

## RODS (driver duty log)

**Class A.**

| | |
|---|---|
| Local keys | `crew_rods_day_v1:` (per date+driver), `crew_rods_queue_v1` |
| Drain | `rodsStore.syncQueue` |
| Trigger | **boot and `online`** (`App.tsx`, `drainLongDistance`), plus sign-off (`RodsSignoff.tsx`). Until 2026-09-09 this was sign-off only, so a duty log signed offline waited for somebody to reopen that exact screen while online |
| Endpoint | `POST /api/long-distance/rods` |
| Export | `export_rods_to_sheets`, replace by `rods_id`, **not reconciled** |

Duty changes are reconstructed from `DUTY` timeline events, so the underlying taps
reach the server through the events pipeline immediately even though the RODS
document itself waits for sign-off.

All of `rods_id`, `log_date`, `driver_name`, `co_driver_name`, `vehicle_number`,
`trailer_number`, `origin`, `destination`, `total_miles`, `shipping_docs`, `carrier`,
`main_office_address`, `duty_changes`, `remarks`, `signed_at` are `[x]`. The four
`total_*` fields and `created_at` are `[-]`, computed at export.

## Long-distance day (per-diem / drive day)

**Class A.** Was "Class A on paper, broken in practice" until 2026-09-09: nothing
called `syncQueue`, so every drive-day toggle ever set sat in the queue and the
`LongDistancePay` tab stayed empty.

| | |
|---|---|
| Local keys | `crew_ld_plan_v1:<date>` (the day plan), `crew_ld_day_v1:` (per date), `crew_ld_day_queue_v1` |
| Drain | `ldDayStore.syncQueue`, via `drainLongDistance` |
| Trigger | **boot and `online`** (`App.tsx`), `Promise.allSettled` alongside the BOL and RODS drains so one failure does not hold the others |
| Endpoint | `POST /api/long-distance/day` (idempotent by driver + date) |
| Export | `export_ld_day_to_sheets` |

| Field | Adheres | Note |
|---|---|---|
| `day_id` | `[x]` | |
| `date` | `[x]` | Mountain calendar date, not UTC: per-diem is per day, so the day it lands on is the money |
| `driver_name` | `[x]` | |
| `job_uuid` / `job_name` | `[x]` | attached from `readActiveJob()` at write time |
| `out_of_town` | `[ ]` | transmitted, **but never set**: `setLdDay` is only ever called with `drive_day`. See Deviations |
| `drive_day` | `[x]` | set from the day plan's `driving` activity by `useLdPlan` |
| `per_diem` | `[-]` | derived at export, `$50` if `out_of_town`, so it stays 0 while the above holds |
| `updated_at` | `[x]` | |

**The plan behind `drive_day` is client-only and per calendar day**
(`crew_ld_plan_v1:<date>`, `components/LdWorkday.tsx`). Only `driving` leaves the
device, as `drive_day`. Both the plan write and the `LdDay` write are checked and
reported: a selection that could not be stored shows the out-of-space message
rather than appearing ticked, and `toggleActivity` resolves against the committed
plan rather than the render snapshot. Covered by
`frontend/scripts/verify_ld_plan_toggle.mjs`.

`frontend/scripts/verify_ld_drain.mjs` asserts the drain wiring and scans `lib/`
for any queue module unreachable from `App.tsx`, so a new store cannot repeat the
original defect.

## Prior on-duty statement

**Class B.** Direct POST on sign. `export_prior_hours_to_sheets`, dedupe by
`statement_id`, append. `statement_id`, `driver_name`, `statement_date`,
`hours_last_24` and the daily entries are `[x]`; `total_last_7`,
`daily_breakdown` and `created_at` are `[-]`, computed at export.

## Incidents

**Class A.**

| | |
|---|---|
| Local key | `crew_incident_queue_v1` |
| Drain | `incidentStore.drainIncidents` |
| Trigger | boot, `online` |
| Endpoint | `POST /api/incidents` |
| Export | `export_incident_to_sheets`, coalesced, **not reconciled** |

`incident_uuid`, `claim_number`, `incident_date`, `job_uuid`, `job_name`,
`reported_by`, `attributed_crew`, `severity`, `attributable`, `description`,
`est_cost`, `resolved`, `notes` are `[x]`. `photo_urls` is `[-]`: the client snapshot
is usually empty because the normal flow is file-then-attach, so the export reads the
authoritative `photos.incident_uuid` and unions it with the snapshot.

## Off-job hours

**Class A.** `crew_off_job_queue_v1`, drain `offJobStore.drainOffJob`, trigger boot
and `online` (from both `App.tsx` and the OffJob page). `POST /api/off-job`,
`export_off_job_to_sheets` replace by `entry_uuid`, not reconciled. `entry_uuid`,
`submitted_by`, `work_date`, `start_time`, `end_time`, `hours`, `pay_structure`,
`pay_other_note`, `notes` all `[x]`.

## Office hours

**Class A.** `crew_office_hours_queue_v1` plus `crew_office_hours_cache_v1`, drain
`officeHoursStore.syncQueue` / `fetchAndCache`, trigger **OfficeHours page mount and
`online` only**. `export_office_hours_to_sheets` replace by `entry_uuid`, not
reconciled. `entry_uuid`, `user_name`, `work_date`, `start_time`, `end_time`,
`break_hours`, `notes` are `[x]`; `hours` and `hours_rounded` are `[-]`, computed.

## Reimbursements

**Class A over IndexedDB**, because receipts and odometer shots are blobs.

`crew_app_db` store `reimbursements` plus `crew_reimbursement_history_cache_v1`.
Drain `reimbursementStore.syncQueue`, trigger **Reimbursement page mount and `online`
only**. `export_reimbursement_to_sheets` replace by `reimbursement_uuid`, not
reconciled.

`reimbursement_uuid`, `user_name`, `type`, `job_name`, `job_date`, `expense_date`,
`odometer_start`, `odometer_end`, `amount`, `category`, `vendor`, `payment_method`,
`notes` are `[x]`. The three photo URL fields plus `photos_link` are `[-]` (set after
Drive upload). `miles` is `[-]` (computed). `status`, `approver`, `approved_at`,
`approval_notes` are `[-]`: admin-set, and a re-export overwrites the row in place.

## Availability

**Class B. Online-only.**

`crew_availability_draft_v1` and `crew_availability_cache_v1`.
`availabilityStore.submitDraft` is a direct `POST /api/availability` that **throws on
network error** so the caller shows the failure. There is no queue and no drain: an
offline submit does not happen. The draft survives, the transmission does not.

`export_availability_window_to_sheets`, replace by (user, `window_start`), coalesced,
not reconciled. `user_name`, `window_start` and the 14 `day_NN` cells are `[x]`;
`window_end`, `updated_at`, `user_email` are `[-]`.

## Job report

**Class B** with a durable local draft.

`crew_report_draft_v1:` per job, autosaved locally throughout. Submit is a direct
`POST /api/job-report`, optionally followed by `POST /api/bill`.
`export_job_report_to_sheets` replace by `job_uuid`, not reconciled.

All crew-answered fields are `[x]`: `personal_vehicles`, `bill_personal_vehicles`,
`dumpster_pct`, `recycling_pct`, `billing_method`, `review_candidate`, `hours_match`,
`hours_mismatch_reason`, `has_crew_feedback`, `crew_feedback`, `employee_hours`,
`job_type_tags`, `truck_fullness`, `overage_note`. Derived at export and therefore
`[-]`: `hours_verified`, `has_non_billable_hours`, `per_diem_total`,
`furniture_count`, `box_count`, `actual_man_hours`. `entered_by` / `entered_on` are
`[-]`, admin checkpoint.

Skill ratings ride this payload and are gated server-side in
`job_report.py::_is_skill_rater`: a non-rater's save preserves ratings a rater
already set and drops whatever its own payload carries (ADR 0014).

## Bill

**Class B.** `crew_bill_draft_v1:` per job, direct `POST /api/bill` on save.
`export_bill_to_sheets` appends keyed `job_uuid:updated_at:item_id`, so **each save
adds rows rather than replacing them**; the sheet holds the history of saves.
`item_label`, `item_qty`, `item_unit`, `item_rate`, `item_discount_pct`,
`item_source`, `global_discount_pct`, `bill_notes` are `[x]`. `item_amount` is `[-]`.
`submission_id` is `[-]` and populated only on rows generated from a materials
submission, where it is the delete key.

## DVIR

**Class B.** Direct POST on submit, plus an admin-gated
`PATCH /api/dvir/{id}/mechanic-sign`. `export_dvir_to_sheets` appends **one row per
phase**, so a fully processed DVIR is two rows (`driver`, then `mechanic`).

`dvir_id`, `inspection_type`, `inspection_date`, `vehicle_number`, `trailer_number`,
`odometer`, `driver_name`, `condition`, `defects`, `defect_notes`,
`back_of_truck_confirmed`, `overnight_hold`, `driver_signed_at` are `[x]`.
`mechanic_name`, `repairs_made`, `mechanic_notes`, `mechanic_signed_at` are `[-]`
(admin phase). `phase` and `created_at` are `[-]`.

## Read caches (Class D)

Server to device only. No hop 3.

| Data | Key | Refresh trigger |
|---|---|---|
| User / roster directory | `crew_roster_v1` | boot via `ensureDirectory`, manual `refreshDirectory` |
| Skills | `crew_skills_v1` | `skillsStore.fetchSkills` on demand |
| Job types | `crew_job_types_v1` | `jobTypesStore.fetchJobTypes` on demand |
| Furniture catalogue | `crew_furniture_catalog_v1` | `furnitureCatalogStore.fetchCatalog` on demand |
| Event history | `crew_event_log_v1` | boot via `loadHistoryFromBackend`, `GET /api/events` streamed |
| Auth user | `mm_user_cache_v1` | boot seeds from cache synchronously, then revalidates |

**Service worker runtime caching** (`vite.config.ts`, vite-plugin-pwa,
`registerType: "prompt"`) adds a layer above these:

| Route | Handler | Network timeout | Max age |
|---|---|---|---|
| `/api/calendar/*` GET | NetworkFirst | 4s | 7 days |
| `/api/auth/me` GET | NetworkFirst | 3s | 10 min |

Auth writes are never cached. The app shell is precached, and updates are
prompt-based via `UpdateBanner` (polls while visible, plus `visibilitychange`).

## Auth

JWT in `mm_access_token`, **90-day expiry, no refresh token**. The last successful
`/api/auth/me` is cached in `mm_user_cache_v1` and the app **seeds the user from that
cache synchronously on boot**, which is why a crew member at a no-signal jobsite
lands in the app instead of the login screen.

The asymmetry is load-bearing: background revalidation clears the user **only** on an
explicit 401 or 403. A network failure preserves the cached user. Inverting that logs
the whole crew out the moment they lose signal.

If `/me` returns a different user id than the cached one, all crew state is wiped
before adopting the new identity. That is the shared-phone case: A logs out, B logs
in, and A's queued materials must not sync under B's name. `clearCrewState()` wipes
by **key prefix** (`crew_`, `mm_`, plus IndexedDB `crew_app_db`), not from a
registry, so **any new store must use one of those prefixes** or it leaks one crew
member's data to the next person on that phone. `preserveFailedWork.ts` carries
failed queue entries across the wipe.

---

---

# Folded from staging at the 2026-09-10 promotion

Everything below arrived in the `staging -> main` promotion of 2026-09-10, the
first since 2026-08-13. It is recorded in the same per-field format as the
domains above; the two headings that follow ("New domains", "New background
work") are kept because they are how this batch is shaped, not because staging
still owns them.

Two entries deliberately still say **Still open** or carry a `[ ]`. Those are
inherited gaps this promotion did not close, not new ones, and each names what
remains. New deviations would have blocked the merge; there were none.

# New domains

## Job setup (job header)

**Class A.** ADR 0034. One header row per job, the thing the unified job panel hangs
off.

| | |
|---|---|
| Local keys | `crew_job_setup_cache_v1` (bag, keyed by `job_uuid`), `crew_job_setup_queue_v1` |
| Drain | `jobSetupStore.drainJobSetups` |
| Trigger | boot and `online` (`App.tsx:1878`, `:1892`) |
| Endpoint | `GET` / `PUT /api/job-setup/{job_uuid}` |
| Export | **none. Postgres only, no Sheet row.** |
| Classifier | `queueFailure.isPermanentRejection` (converged 2026-08-11) |

A save the server actively rejects (a locked header, 409) is **surfaced, not
queued**: retrying a locked-header write forever would never succeed. Transient and
network failures queue and retry.

| Field | Adheres | Note |
|---|---|---|
| `job_name` / `job_date` / `source` | `[x]` | |
| `calendar_event_id` | `[x]` | |
| `is_long_distance` | `[x]` | |
| `job_type_tags` | `[x]` | JSON list column |
| `vehicle_unit_names` | `[x]` | JSON list column |
| `crew` | `[x]` | list of `{user_id, name, source, confirmed}`, `source` is `invitee` or `added` |
| `origin` / `destination` / `stops` | `[x]` | LD route; seeds BOL `origin_address`/`dest_address` + RODS `origin`/`destination` |
| `bol_header` | `[x]` | JSON dict (`bol_header_json`), LD only. FMCSA BOL shipment header: shipper name/phone/address, form_of_payment, estimate_type, valuation, agreed pickup/delivery, COD, declarations. Seeds the BOL draft blank-only. |
| `notes` | `[x]` | |
| `locked` | `[x]` | overwriting a locked header needs `override: true` on the PUT |
| `updated_by_name` / `updated_at` | `[-]` | server-stamped |

**Seeds (ADR 0034 C1.3):** the header is the office's single entry point that
prefills the tools **blank-only, once per job** (never overwriting a crew edit or a
signed doc): DVIR/BOL/RODS **vehicle** from `vehicle_unit_names[0]`; BOL/RODS
**origin/destination** from `origin`/`destination`; the **BOL shipment header** from
`bol_header`; and the RODS day carries the job's `job_uuid`/`job_name` so the `rods`
checklist signal auto-ticks.

**No Sheet export** is a deliberate gap to confirm at promotion: admin currently
reads this only in-app. If it should mirror to the Sheet, that is a new export
function plus a tab env var, not a config change.

## Job checklist

**Class A for the manual ticks. Server-derived for the rest.** The split matters:
half this feature never travels as data at all.

| | |
|---|---|
| Local keys | `crew_job_checklist_items_v1` (template), `crew_job_checklist_status_v1` (per job), `crew_job_checklist_queue_v1` (keyed `job_uuid\|item_key`) |
| Drain | `jobChecklistStore.drainChecklistChecks` |
| Trigger | boot and `online` (`App.tsx:1878`, `:1894`) |
| Endpoint | `GET /api/job-checklist/{job_uuid}/status`, `PUT .../check` |
| Export | **none. Postgres only.** |
| Idempotency | upsert by `(job_uuid, item_key)`, retry-safe |

**Manual ticks** are Class A: optimistic local write, then queue and retry.

**AUTO signals are not stored and never sync.** `_job_signals` recomputes them on
every read from the job's actual artifacts, so there is nothing to queue and nothing
to reconcile.

| Signal | Derived from |
|---|---|
| `pretrip_dvir` / `posttrip_dvir` | a `DVIR` row for the job with that `inspection_type` |
| `job_report` | a `JobReport` row exists |
| `bol_origin_signed` / `bol_delivered` | `DigitalBOL.status` |
| `inventory` | any `JobInventoryItem` for the job |
| `weighed` | any `Event` of type `WEIGHT` |
| `pods` | a `PriorOnDutyStatement` for the job |
| `rods` | a `RodsLog` for the job |

`rods` ticks once a `RodsLog` carries the job's `job_uuid`. The column was added in
`de27613`; the RODS client now sends `job_uuid`/`job_name` on the day payload
(`rodsStore.dayToPayload`) and seeds it from the job header in `RodsSignoff`, so a
signed RODS ticks the item.

**Deviation:** `drainChecklistChecks` **deletes** a permanently-rejected tick rather
than marking it failed and keeping it. See Deviations below.

**Template gains `requires_truck` (2026-09-02).** A checklist item can now be
limited to jobs that have a truck, alongside the existing `ld_only` and
`job_types` limits.

| Field | Adheres | Note |
|---|---|---|
| `requires_truck` | **read** | On the template item, not on a tick. Carried by `GET /api/config/job-checklist` and `PUT /api/admin/config/job-checklist`, stored in the `job_checklist_items` SystemConfig row, cached in `crew_job_checklist_items_v1` |

Nothing is queued, exported, or per-job: the flag lives on the template and is
applied at render time in `JobChecklistCard`, against `vehicle_unit_names` from
the job's setup header (which the card already loads).

Three properties worth holding onto, because each is a way this could have gone
wrong quietly:

- **No back-fill.** `normalize_items` defaults an absent field to `False` and does
  not seed it by key from `default_items()`. An existing install's list belongs to
  the admin; deciding on their behalf that their "Pre-trip DVIR submitted" is
  truck-only would change what crews see with nobody asking. `default_items()`
  seeds five (both DVIRs, trucks swept, DOT markings, weighed) for a FRESH
  install only. **The admin has to tick the boxes on the existing install.**
- **Unknown counts as having a truck.** The card starts `hasTruck` true and only
  clears it once a header has actually been read and lists no unit. No header yet,
  or a header unreachable offline, must not read as "no truck" - a DVIR silently
  vanishing from the checklist is a worse failure than one showing when it need
  not.
- **Both directions are compatible.** A phone holding a template cached by the
  older build has no `requires_truck` on any item, which reads as false and shows
  everything.

## Bug reports

**Class A.**

| | |
|---|---|
| Local key | `crew_bug_report_queue_v1` |
| Drain | `bugReportStore.drainBugReports` |
| Trigger | boot and `online` |
| Endpoint | `POST /api/bug-reports`, screenshots via `POST /api/bug-reports/screenshot` |
| Export | `schedule_bug_report_export`, tab `SHEETS_BUGS_TAB` (`Bugs`), replace by `bug_uuid`, coalesced, **not reconciled** |

Read by the nightly Apps Script crew email. Enqueue is idempotent by `bug_uuid`: a
re-submit replaces the earlier queued copy, which is what makes a re-POST after
late-finishing screenshot uploads safe.

| Field | Adheres | Note |
|---|---|---|
| `bug_uuid` | `[x]` | client UUID |
| `occurred_date` | `[x]` | |
| `submitted_by` | `[x]` | |
| `description` | `[x]` | |
| `screenshots` | `[x]` | Drive URLs, uploaded before the POST; a screenshot that fails to upload does not block the text |
| `created_at` | `[-]` | server-stamped |

**Deviation:** no permanent/transient split at all. See Deviations.

## Feature requests

**Class A.** Identical shape to bug reports.

| | |
|---|---|
| Local key | `crew_feature_request_queue_v1` |
| Drain | `featureRequestStore.drainFeatureRequests` |
| Trigger | boot and `online` |
| Endpoint | `POST /api/feature-requests` |
| Export | `schedule_feature_request_export`, tab `SHEETS_FEATURE_REQUESTS_TAB` (`FeatureRequests`), replace by `request_uuid`, coalesced, **not reconciled** |

Fields `request_uuid`, `title`, `submitted_by`, `description`, `screenshots` are
`[x]`; `created_at` is `[-]`. Same missing permanent/transient split as bug reports.

## Bulletin (crew feed)

**Class B. Online-only, no queue, no Sheet.**

| | |
|---|---|
| Local key | `crew_bulletin_seen_id_v1` (unread marker only) |
| Endpoint | `GET /api/bulletin/feed`, `/latest`, `POST /posts`, `/posts/photo`, `/posts/{uuid}/like`, `/comments`, `DELETE` for both |
| Export | **none** |

Every write is a direct call. Posting, liking and commenting offline all simply fail;
there is no draft and no outbox. That is a reasonable call for a social feed, but it
is the second crew-facing surface with no offline path (availability is the other),
so it belongs in the pattern rather than looking like an oversight.

**Image storage is unusual and worth knowing.** `BulletinPost` carries **both**
`image_bytes` (`LargeBinary`, served from `GET /api/bulletin/image/{post_uuid}`) and
`image_drive_file_id` / `image_drive_url` / `image_thumb_url`. Images therefore live
in Postgres, which is the only place in this app that stores blobs in the database
rather than Drive. On a 512 MB worker that is a memory surface worth watching as the
feed grows.

GIFs upload as original bytes; every other image is resized and JPEG-compressed
client-side first (`4b26b99`), because canvas flattening was killing GIF animation.

Post fields `post_uuid`, `author_name`, `kind`, `text`, `link_url` are `[x]` to
Postgres. `link_title` / `link_description` / `link_image_url` are `[-]`,
server-fetched link metadata. `removed_at` / `removed_by` are `[-]`, soft delete.

## DQ documents (driver qualification file)

**Class B into Class E.** Direct upload, no queue.

| | |
|---|---|
| Endpoint | `GET /api/dq/my`, `POST /api/dq/my/upload`, `GET /api/dq/doc-types`, plus admin routes |
| Storage | Google Drive: a per-driver subfolder named `<driver name>` under `DRIVE_DQ_FOLDER_ID`; `DqDocument` row in Postgres holds `drive_file_id`, `drive_url` and `drive_folder_id` |
| Export | **none. No Sheet row.** |

**Changed 2026-08-10.** Was `Mountaineer Crew Documents / DQ - <driver name>`,
resolved by folder NAME. Now a dedicated top-level folder addressed by ID, with the
driver's subfolder created on their first submission and reused after.

| Field | Path | |
|---|---|---|
| `drive_file_id` | device -> Postgres -> Drive | [x] |
| `drive_url` | device -> Postgres -> Drive | [x] |
| `drive_folder_id` | Drive -> Postgres (new, migration `c3e5g7b9d1f3`) | [x] |

`drive_folder_id` is denormalized onto each of the driver's rows and read back on
the next upload so the folder is addressed **by ID**, not re-resolved by name. That
is what keeps a driver who changes their name on one compliance folder instead of
silently starting a second one. NULL on existing rows: they resolve by name once on
their next upload, which reproduces the old behavior exactly.

**`DRIVE_DQ_FOLDER_ID` must be set per environment.** Unset, the code falls back to
the previous Documents-folder parent, which resolves by name and therefore points
staging and prod at the SAME physical folder. These documents are DOT compliance
records containing PII, so a shared folder is the failure mode that matters most
here. There is deliberately no name-based fallback for the DQ folder itself.

**One current copy per (driver, doc type).** A new upload replaces in place and
**deletes the old Drive file** (`delete_drive_file`). There is no version history: the
previous document is gone, not archived. That is a one-copy irreplaceable-data path,
so any change here triggers the Durability vet in VETTING_PROTOCOL.md.

A concurrent upload for the same (driver, type) is handled by catching the insert
race and re-reading the winner before deleting the loser's old file.

Renewal-cadence types warn ahead of lapsing; `missing_required` drives the driver's
nag count and deliberately excludes admin-audience forms the driver cannot file.

## Payroll corrections

**Class B, admin-only.** ADR 0029, ADR 0032.

| | |
|---|---|
| Endpoint | `GET/PUT/DELETE /api/payroll/corrections`, `GET/PUT/DELETE /api/payroll/job/{job_uuid}/corrections`, `GET /api/payroll/summary`, `POST /api/payroll/finalize` |
| Export | **none, by design.** Payroll is assembled on demand; a payroll tab would be a second copy of numbers that change whenever a correction is added |

**Payroll reads across every other feature and owns only the correction layer.**
Crew-submitted rows are never mutated. A correction is keyed by
`(period, user, source, source_key, bucket)`, a loose pair rather than a foreign key,
because one of the four sources is a JSON blob with no row identity.

Correction fields `period_start`, `period_end`, `job_uuid`, `user_id`, `user_name`,
`source`, `source_key`, `source_label`, `work_date`, `bucket`, `original_hours`,
`corrected_hours`, `reason` are `[x]` to Postgres. `created_by_id`,
`created_by_name`, `created_at`, `notified_at` are `[-]`.

**Per-diem nights are de-duplicated across two sources**
(`payroll.py::_per_diem_nights`): the per-employee `out_of_town` flag on job-report
hours first, then `LdDay` rows. This is why the dead LD-day queue does not corrupt
pay. Do not "simplify" that to the `LdDay` source alone without fixing the queue.

Query cost is bounded by the pay period, not the age of the company: jobs in range
are found by their events (indexed on `timestamp`), with `MAX_PERIOD_DAYS = 62` so a
mistyped year cannot read the whole database.

## Crew job summary (closed-job panel)

**Class D, read-only.** Added in `78153c3` for the unified closed-job panel
(backlog #2).

| | |
|---|---|
| Local key | none. Fetched live, not cached |
| Endpoint | `GET /api/job-summary/{job_uuid}` |
| Builder | `app/services/job_summary.py::build_job_summary(include_admin=False)` |
| Export | **none.** Pure read, no storage, no write path |

**No new data is captured by this feature.** It collates what other domains already
recorded, every source keyed by `job_uuid`: events, DVIRs, materials, job report,
bill, photos, job inventory, incidents. Each query is capped at `JOB_SUMMARY_CAP`.

Admin-only sections (`admin_notes`, `entry_status`) are excluded for crew callers via
`include_admin=False`. Off-job hours, office hours and availability are deliberately
absent because they are not job-scoped and cannot be joined here.

**Authenticated but not row-scoped** to "jobs this user worked", same as the other
crew job endpoints. It relies on `job_uuid` being an unguessable device-derived UUID
(ADR 0005). The router docstring says it plainly: do not add secrets to this payload.
Anything added to `build_job_summary` reaches every authenticated crew member who has
the UUID, so a field added there for admin needs `include_admin` gating.

Because it is read-only over already-documented domains, it has no per-field table of
its own. It passes.

## New read caches (Class D)

| Data | Key | Refresh |
|---|---|---|
| Vehicle units | `crew_vehicle_units_v1` | `vehicleUnits.refreshUnits` on demand |
| Company info | `crew_company_info_v1` | `companyInfo.refreshCompanyInfo` on demand |
| Checklist template | `crew_job_checklist_items_v1` | `loadChecklistItems`, from `GET /api/config/job-checklist` |

## Pure client logic, no exchange

`lib/closeout.ts` (variance causes, client readiness, scope-change vocabularies) and
`lib/hhg.ts` (`HHG_LBS_PER_CUFT = 7`) hold constants and normalizers only. They shape
values that travel inside the job report and estimate payloads; they have no storage,
no queue and no endpoint of their own. Listed so a successor does not go hunting for
a sync path that was never there.

---

# New background work

## Nightly Sheet integrity check

`backend/scripts/sheet_integrity_check.py`. **Not** an in-process thread and not in
`on_startup`; it is a standalone script run by an external scheduler, with its env
requirements documented in [CREDENTIALS.md](CREDENTIALS.md).

It re-derives what each tab should look like **from the app's own `*_HEADERS`
constants**, so it follows automatically when a column is added. There is no second
source of truth to maintain.

| Result | Condition |
|---|---|
| FAIL | a tab's key column missing from the live header row (the `dfg`-style overwrite) |
| FAIL | duplicate rows on a one-per-key tab (dedupe broke) |
| FAIL | a junk env-var-named tab (`sheets*Staging`, a misconfig) |
| FAIL | **a server record not present in the Sheet** (server to sheet completeness) |
| WARN | expected columns absent, often just un-promoted staging work |
| WARN | fully blank residue rows between data rows |

The completeness pass reuses the app's own reconciler (`audit_sheet_backfill` for the
diffable syncs, the Events and BOL marker-table counters for the two auto-reconciled
ones). Exit 0 on no FAILs, 1 otherwise. Emails on FAIL; `--email-warnings`,
`--force-email`, `--no-email`, `--no-completeness` available.

**Read pattern (changed 2026-08-12).** Both passes are now batched, and the read
cost is flat in the number of tabs:

| Phase | Sheets API calls |
|---|---|
| Workbook metadata | 1, with a `fields` mask for title + sheetId only |
| Structural: every header row | `ceil(tabs / 8)` batchGet |
| Structural: every key column | `ceil(tabs / 8)` batchGet |
| Completeness | 3, unchanged (`audit_sheet_backfill` was already batched) |

Roughly 7 calls for the whole run against ~50 before. This is a **memory**
constraint, not a quota one: RSS was measured climbing ~18.7 MB per API call and
never falling, which OOM-killed the job on the 512 MB worker partway through the
structural pass. The count of calls is the thing being controlled. Do not
un-batch these, and do not drop the `fields` mask on
`sheets_export._sheet_ids` - unmasked, that one call cost 66 MB on a 42-tab
workbook. See Known defects in [RUNBOOKS.md](RUNBOOKS.md).

**This is the first thing in the system that checks hop 3 end to end.** Before it,
`sheet_sync_status` could only say which export *function* last failed, never which
record was lost.

---

## Reimbursement approval + payroll report waiver (2026-08-12)

**Class A.** Two admin decisions that change what payroll pays and whether it can
finalize at all.

| Field | Path | Adherence |
|---|---|---|
| `reimbursements.status` | Payroll detail -> `POST /api/admin/payroll/reimbursement/{uuid}/decision` -> Postgres | read |
| `reimbursements.approver_id` / `approver_name` / `approved_at` | same | read |
| `reimbursements.approval_notes` | same; also the body of the decline email | read |
| `admin_entry_status.report_waived` | Payroll gate -> `POST /api/admin/payroll/job/{uuid}/report-waiver` -> Postgres | read |
| `admin_entry_status.report_waived_reason` / `_by_name` / `_at` | same | read |

Marked **read**, not `[x]`: verified by executing the endpoints against a real
database, not by tracing a value from a device through to the Sheet. None of
these reach the Sheet at all today, which is itself the thing to decide before
promoting them to `[x]` (see Open questions).

**Direction of the money, and why.** Payroll pays every claim EXCEPT one an admin
explicitly declined. It does not pay only what was approved. That is deliberate:
the approved-only gate was unreachable for months and silently reported $0 for
everyone, and a forgotten approval must never underpay somebody. `unreviewed`
counts per employee and finalize returns `reimbursements_unreviewed` so "nobody
looked" is visible rather than silent. It warns; it does not block.

**Rejected rows are fetched but not summed.** They have to stay visible so a
decline can be undone from the payroll screen.

**Emails.** A NEW decline emails the crew member (Postmark, `SMTP_FROM`). Re-saving
a note on an already-declined claim does not re-send. An approval never emails.
A send failure does NOT roll back the decision - refusing to record a decline
because a mailbox bounced would leave a claim being paid that an admin judged
wrong - and the failure comes back in the response so the admin can follow up.

**The waiver** drops a report-less job out of the finalize gate. Per job and
explicit, never global: a blanket "ignore report-less jobs" would retire the gate
rather than handle the exception. It borrows no initials - `entered_by` is set to
`(waived)` so a waiver is never mistaken for an ADR 0032 attestation.

---

## App build history (2026-08-12)

**Class A.** New `app_builds` table plus `patch_notes.build_id`.

| Field | Path | Adherence |
|---|---|---|
| `app_builds.build_id` / `version_name` | device on load -> `POST /api/patch-notes/build-seen` -> Postgres | read |
| `app_builds.first_seen_at` / `last_seen_at` | same | read |
| `patch_notes.build_id` | Admin -> `POST`/`PATCH /api/patch-notes` -> Postgres | read |

The build identity already existed in the bundle (`__APP_BUILD_ID__`,
`__APP_VERSION_NAME__`, baked by vite.config.ts). What was missing was any server
record that a build happened, so a build shipped without a note left no trace.

**This records builds REACHED BY A DEVICE, not builds deployed.** The client
reports its own build on load. That is the more useful fact: a build nobody
loaded is not part of the crew's history, and a build that never reaches a device
appears here as an absence, which is a deployment problem worth seeing. It also
means the history is only as current as the last crew member to open the app.

Dev builds (`dev-*`) are rejected server-side so a local machine cannot litter
production history.

**Does not reach the Sheet**, deliberately - this is app metadata, not business
record. Worth confirming at the vet alongside the reimbursement-approval fields,
which are in the same position.

---

## Worked Hours: jobs per week (2026-08-12)

**Class D (read cache).** `GET /api/hours/worked-history` weeks now carry a
`jobs` list: `{job_uuid, job_name, hours, date}` per job behind that week's
billable hours.

Read-only, nothing new is stored, no migration. The names come from one extra
grouped `Event.job_name` query bounded to the jobs that already survived the
window filter, so the endpoint's scan is unchanged in shape - it does not become
a per-job lookup, which on a 512 MB worker is the thing to avoid.

Only job hours are listed. Off-job and office time are not jobs and stay as
column totals; the UI says so rather than leaving the crew to wonder why a week's
job hours do not add up to its total.

---

## Truck loads: one entry per LOAD (2026-08-12)

**Class A.** No new field. A `truck_fullness` entry now means ONE TRUCKLOAD
rather than one truck.

| Field | Path | Adherence |
|---|---|---|
| `truck_fullness[]` (an entry = a load) | Job Report -> `PUT /api/job-report` -> `truck_fullness_json` -> JobReports sheet `truck_fullness` cell | read |

A truck that runs the job twice gets TWO entries, each with its own fill
estimate. A first load packed tight and a second half-empty is the normal case,
so one measurement multiplied by a load count would describe neither trip. The
picker therefore offers a fleet truck again after it is already on the list,
which it previously refused.

**No migration and no schema change.** Nothing was added to the payload; what
changed is what an entry MEANS. Every existing entry is a single load, which is
what it already was.

**A `loads` count was built first and reversed.** It multiplied one fill estimate
by a trip count, which also corrupted the per-truck weight readout: the deck
gauge and the `~lbs` figure describe a single fill, and doubling them implied a
truck carried twice its capacity in one trip.

**Sheet cell:** a repeated truck is numbered - `26Int (load 1)`, `26Int (load 2)` -
so two entries do not read as a duplicated row. A truck appearing once is
unnumbered, so single-load cells are unchanged.

---

## Sheet plumbing changes (2026-08-12)

**Class B/C.** Not new domains - changes to how existing exports read, report and
are driven. Logged because the same-commit rule covers write strategy, endpoints
and reconciler coverage, and a `/vet` found these missing.

| Change | Path | Adherence |
|---|---|---|
| `_ensure_tab` caches the header row per (spreadsheet, tab) for 30s | every Sheet export | read |
| `_sheet_ids` `fields` mask | every Sheet export | read |
| `record_sheet_sync` clears `last_error` on success | `sheet_sync_status` | read |
| `recent_failures` on the backfill audit response | `GET /api/admin/system-check/sheet-backfill` | read |
| `POST /api/admin/system-check/sheet-backfill-all` | drains every sync in one budgeted pass | read |
| Backfill throttle, 429 while a batch drains | both backfill endpoints | read |

**Header cache.** `_ensure_tab` read row 1 on EVERY export - one read per record,
the biggest consumer of the 60-reads-per-minute quota. Now cached for 30s, the
same window `_meta_cache` uses, and invalidated explicitly whenever a column is
appended. **The TTL is short on purpose:** this value drives positional column
mapping in `_build_row`, so a stale header would misalign a written row. It is a
small window by design, not a knob to turn up. The `SheetHeaderError` corruption
guard still evaluates on every call, cached or not.

**Drain-all.** Built on the existing `reconcile_all_missing`, the same code path
the auto-reconciler uses: audits once, spends one budget across all syncs. The
per-sync endpoint re-runs the FULL audit per call, so clearing syncs one at a
time cost an audit each. The throttle is server-side because the endpoint returns
when work is QUEUED, not when it lands - a request-scoped lock would release
while the pool was still reading.

**`recent_failures`** exists because `sheet_sync_status` is per export FUNCTION:
when most records succeed and a few throw every time, the sync reads as healthy
and the failing records have no visible explanation. In-memory and bounded, so an
empty list does not prove nothing failed.

---

## Job review attestation: reviewer from the account (2026-08-12)

**Class A, changed field.** ADR 0037.

| Field | Path | Adherence |
|---|---|---|
| `admin_entry_status.entered_by` | Job Summary -> `PUT /api/admin/job-entry-status/{job_uuid}` -> Postgres -> `update_entry_status_in_sheets` -> Events/JobReports `entered_by` cells | read |

The value CHANGES SHAPE. It was typed initials; it is now the reviewer's account
name (falling back to email), and the payroll waiver writes the literal
`(waived)`. Existing rows keep their initials - not backfilled, because those are
a true record of what was entered.

**This reaches the Sheet.** The `entered_by` column the office already reads
starts showing full names instead of initials. Anything parsing that column must
treat it as free text, which it always was.

---

## Bulletin feed: runtime shape validation (2026-08-12)

**Class D (read).** `fetchFeed` validated nothing - `apiFetch<Feed>` is a type
assertion erased at runtime - so a degraded response flowed into JSX. A malformed
body now throws (surfacing the error card and Retry) while a genuinely empty feed
still resolves to the empty state. `comments` is guaranteed an array on every path
that puts a post into component state.

Read-only, nothing stored, no migration.

---

## Forked-job repair (2026-08-12)

**Class A, offline tool.** `backend/scripts/repair_forked_jobs.py` re-keys rows
from a fork's orphan `job_uuid` onto the canonical one, across the 20 tables that
carry `job_uuid`. Never `calendar_jobs`, which is the canonical mapping itself.

Dry-run by default. Refuses to merge where both identities hold a row in a
one-per-job table. **Does not touch the Sheet** - rows exported under the orphan
key keep it, and are re-driven from Admin -> Sheet Backfill afterwards. See
[ADR 0038](decisions/0038-forked-job-repair-moves-rows-and-refuses-to-merge.md).

---

## Drive folder isolation is now checkable (2026-09-09)

Not a data path change - a change to what can be SEEN about one.

Every Drive folder the app writes to holds something with no second copy (a
signed BOL, a receipt, a DQ file with PII, an estimate photo), and each is kept
apart between staging and prod by an explicit folder-ID env var. When the ID is
unset the code resolves the folder BY NAME, and both environments resolve the
SAME real folder - which is how staging came to overwrite production's signed
BOLs (ADR 0020).

Three things made that invisible:

- the BOL fallback did not log at all, while the estimator and reimbursement
  paths both warned. The most dangerous fallback was the only silent one.
- there was no Drive entry in System Check.
- so checking it meant reading Render's env tab, and knowing to.

Now: `GET /api/admin/system-check/drive` reports all four folders, whether each
is pinned and to which id; Admin > Advanced Settings shows it beside the Sheet
Syncs card; and an unset BOL folder prints a `[drive]` warning naming the
consequence. `scripts/test_sync_registries.py` asserts every `DRIVE_*_ENV_VAR`
declared in `drive_upload` is reported by the check, so a fifth folder cannot be
added without appearing there.

Env-only, no Drive API call, so it answers when Drive credentials are broken -
which is when somebody is looking at it.

## Auto-reconcile sweep: cadence unchanged, throughput deliberately cut

The generic self-heal (`reconcile_all_missing`, every 4th 5-minute cycle) still
runs every ~20 minutes. Two things about its **rate** changed 2026-08-13, and both
matter to anyone reasoning about when a stranded record reaches the Sheet:

| | Before | After |
|---|---|---|
| Records re-driven per sweep | 100 (~400 Sheets reads) | 15 (~60 reads) |
| Behaviour while a batch is draining | ran anyway, and re-audited | skips, no audit |
| Time for a stranded record to land | "within one cycle" | one or two cycles; a backlog of hundreds takes hours |

The old numbers were not a faster version of the same thing, they were a failure
loop. 100 re-exports is roughly seven minutes of the entire project's 60/minute
read quota, spent unattended, on top of a batch still draining - so the export
pool sat in 429 backoff, the exports it was retrying failed, and the next sweep
re-drove the same records. The backlog never shrank and live crew exports queued
behind it. The cooldown that would have prevented this existed, but only the two
manual admin endpoints checked it; the sweep set it and ignored it.

Guarded by `backend/scripts/verify_reconcile_throttle.py` (bare python, no deps).

**The sweep's schedule moved from process memory into Postgres (2026-08-13).**
Cadence is unchanged at ~20 minutes, but it was previously `_cycle_count % 4`, an
in-process counter that every worker recycle reset to zero. The worker recycles
every 1000 requests by design, so the sweep needed 20+ uninterrupted minutes of
worker life to fire at all, and on a busy day it simply did not - the busier the
crew, the less the self-heal ran. It now claims a `worker_leases` row named
`generic_reconcile` with a 1200s TTL and deliberately never releases it: the
unexpired lease IS the "not yet due" state, so the schedule survives recycling
and is shared across workers on the database clock. No migration - the table
already exists and the row is created on first use. Guarded by
`backend/scripts/verify_generic_sweep_schedule.py`.

The sweep also now prints `generic: nothing missing` on an idle run. It was
silent, and a silent sweep is indistinguishable from one that never ran, which is
what hid this for months.

Nothing about the payloads, keys, tabs or endpoints changed - this is purely how
fast the existing self-heal is allowed to consume shared quota.

## Bulletin reaction mode (per post, owner only)

New column and new endpoint. No queue, no offline path, no Sheet export - the
bulletin has none of those by design.

| | |
|---|---|
| Storage | `bulletin_posts.reaction_mode` (NOT NULL, server default `like`) |
| Endpoint | `POST /api/bulletin/posts/{post_uuid}/reaction-mode` body `{mode}` |
| Who | one hardcoded address, checked server-side; 404 for everyone else |
| Read path | `reaction_mode` + `can_set_reaction_mode` on every post in `/feed` and on both create paths |
| Reaction rows | `bulletin_likes`, UNCHANGED by a switch - see ADR 0039 |

The reaction rows are the same either way. `reaction_mode` decides what a
reaction is called, which is why switching is reversible and why a post can show
dislikes from people who pressed Like. `can_set_reaction_mode` is computed by the
server per request, so the client never holds the permission rule.

Migration `h8j0l2g4i6k8`. Guarded by
`backend/scripts/verify_bulletin_reaction_mode.py`.

## Reimbursement decisions and report waivers now reach the Sheet

Answers the "should these reach the Sheet" question left open after the
2026-08-12 promotion. Owner decided 2026-08-13: yes to both. App build history
was NOT included and stays Postgres-only.

### Reimbursement approve / decline

| | |
|---|---|
| Trigger | `POST /api/payroll/reimbursement/{uuid}/decide` |
| Export | `export_reimbursement_to_sheets`, replace-style on `reimbursement_uuid` |
| Tab | existing `Reimbursements` (`SHEETS_REIMBURSEMENTS_TAB`) |
| Columns | none new - `status`, `approver`, `approved_at`, `approval_notes` already existed |

No new tab, no new column, no migration. The columns were there and the decision
endpoint simply never called the export, so the Sheet recorded every claim as
`submitted` no matter what the office decided. Fixed by reusing
`reimbursement.py::_queue_export`, so the decide path and the submit path cannot
drift.

### Payroll job-report waiver (NEW TAB)

| | |
|---|---|
| Trigger | `POST /api/payroll/job/{job_uuid}/report-waiver`, on waive AND un-waive |
| Export | `export_report_waiver_to_sheets`, replace-style on `job_uuid` |
| Tab | **new** `ReportWaivers` (`SHEETS_REPORT_WAIVERS_TAB`) |
| Columns | `job_uuid`, `job_name`, `waived`, `waived_by`, `waived_at`, `reason`, `entered_by`, `entered_on`, `updated_at` |
| Registry | `SHEET_SYNC_REGISTRY` + backfill registry (`report_waivers`) |

**Its own tab, not a JobReports column, and the reason is the feature itself:** a
waiver exists precisely for jobs that have NO job report, so a JobReports column
would live on a row that is by definition usually absent.

Un-waiving writes `not waived` rather than deleting the row - a waiver granted
and then revoked is a thing that happened, and the backfill source deliberately
includes revoked waivers so the two sides do not disagree forever.

New env var `SHEETS_REPORT_WAIVERS_TAB` (CREDENTIALS.md + .env.staging.example).

### Export pool health is now observable

`export_pool_status()` reports what the two export threads are doing, surfaced in
the Sheet Backfill audit and shown in Admin only when saturated or stuck. Added
alongside the real fix: the Google HTTP client had **no timeout**
(`httplib2.Http` defaults to blocking forever), so a stalled TLS read could park
an export thread permanently and two of them wedged all exporting - with no
exception raised, no row written, and the backfill still reporting work as
"queued". Now `GOOGLE_HTTP_TIMEOUT_S = 60`.

## Close-out redesign (job report)

Office feedback 2026-08-13. Two duplicate questions retired, the flat cause list
split into three bucketed single-selects, and two inferred values made into
stored answers. Full reasoning in
[ADR 0040](decisions/0040-closeout-is-a-stepper-with-three-cause-buckets.md).

| Field | Storage | Sheet | Status |
|---|---|---|---|
| `variance_direction` | **new** column on `job_reports` | **new** `variance_direction` (appended) | `[x]` device -> Postgres -> Sheet, traced by reading both write paths and the export row builder |
| `variance_cause_identified` | **new** column on `job_reports` | **new** `variance_cause_identified` (appended, tri-state Yes/No/blank) | `[x]` same |
| `variance_causes` | unchanged | unchanged (`variance_cause`) | `[x]` unchanged path; now at most one key per bucket |
| `variance_note` | unchanged | unchanged | `[x]` unchanged path |
| `client_readiness` / `client_unready` | unchanged, **write-frozen** | unchanged | `[-]` retired from the UI; still read, returned and exported for old reports |
| `scope_changes` | unchanged | unchanged | `[x]` unchanged path; now reached only via the site-and-client question |

Migration `i9k1m3h5j7l9`, both columns nullable with no backfill. NULL means "not
answered", which is the truth for every report written before this - backfilling a
direction from the existing causes would recreate the guess the column exists to
remove.

No new endpoint, no new queue, no new env var. The offline draft shape gains the
two fields and tolerates their absence, so a device holding a pre-deploy draft
restores it without losing the rest.

Guarded by `frontend/scripts/verify_closeout.mjs`, which includes a
frontend-to-backend vocabulary comparison - an offered cause the server would
reject is a 422 on save, and the two lists live in different languages in
different files.

**Correction, 2026-08-27.** The `[x]` on `variance_direction` above traced the
write path and the export row builder, and both were right. The flow into them
was not: tapping "Yes, it differed" wrote `variance_direction: null` over a value
that was already null, so the answer never changed, the step list stayed one long,
and question 2 could not be reached. Between the 08-13 deploy and 08-27 **no crew
member could record a variance direction, a cause, or a close-out note at all** -
only "No, as quoted" was reachable, which is also what the sheet will show for
that window. Reported from the field on 2026-08-18.

The state has no stored representation on purpose (null / as_quoted / more / less
is the whole vocabulary, and "differed, direction unknown" is a half-answer that
does not belong in the Sheet), so it is held in component state and passed to
`closeoutSteps`. That function moved from the component into `lib/closeout.ts`
for one reason: the stepper's assertions were regexes over the component's
source, and a regex can confirm a line exists but not that a crew member can
reach the next question. They now run the step logic.

## App speed: the backend recycle is handled (route splitting was reverted)

No new endpoint, no storage, no queue. Two changes to how the existing exchanges
are made, both aimed at the wait crews reported.

### The backend recycle is now handled rather than shown as an error

`apiFetch` retries a request that fails during a worker recycle: 502/503/504, or
a network failure while `navigator.onLine` is not false. Four attempts over
~7.7 s. **GET and HEAD only** - writes are not blindly retried, because the
bulletin like endpoint TOGGLES and a retry would silently undo the tap. Writes are
already covered better by the offline queues that own them.

`lib/serverStatus.ts` tracks the inferred state and `ServerRestartBanner` explains
it after 1.2 s, so a recycle the retry swallows is never mentioned at all. A 500
is deliberately NOT treated as a restart: the app is up and throwing, and telling
a crew member to wait for a restart that is not coming would strand them.

### Routes are NOT lazily loaded. The splitting was reverted

Corrected during the 2026-09-10 fold: the staging delta described route code
splitting as shipped (one 1.5 MB bundle cut to a 174 KB gz initial download, 28
precached chunks, Admin and the PDF library on demand). **It was reverted on
`main` the same day it landed**, in `d952d64`, and `staging` carries that revert.
Promoting the delta as written would have put a claim in this doc that the code
contradicts.

The mechanism of the revert is worth keeping, because it is a trap for the next
person who tries splitting: `applyWaitingUpdate()` posts `SKIP_WAITING`, Workbox
evicts the old precache the moment the new worker activates, and the page then
waits 150 ms before reloading. A lazily-loaded chunk requested inside that window
is gone from the cache and not yet re-fetched, so crews updating the app got a
black screen that only a manual refresh cleared.

Current state, verified by reading: no `lazy(` or `Suspense` anywhere in
`frontend/src`, and a production build emits **2** JS chunks, not 28. Every
screen is a static import again, including `Admin.tsx`.

`frontend/src/lib/lazyRoute.ts` still exists but nothing imports it. It is dead
code kept from the reverted attempt; `main.tsx` carries a comment saying it was
written for the neighbouring problem. Logged as a cleanup, not a data flow.

## Duplicate config reads are coalesced

Same endpoints, same payloads, fewer requests. No storage or queue change.

A production log showed one job screen fetching five resources TWICE each,
because two components mounted and each asked independently. `lib/sharedFetch.ts`
adds two mechanisms:

| Resource | Key | Treatment |
|---|---|---|
| `/api/config/vehicle-units` | `config:vehicle-units` | coalesce + 60s reuse |
| `/api/job-types` | `config:job-types` | coalesce + 60s reuse |
| `/api/config/job-checklist` | `config:job-checklist` | coalesce + 60s reuse |
| `/api/job-setup/{uuid}` | `job-setup:{uuid}` | **coalesce only, no reuse window** |

**The job header gets no reuse window on purpose.** It is a record crew actively
edit, and a stale read could show someone their own save undone. Sharing an
in-flight request carries no such risk: every caller gets exactly the answer it
would have got anyway, one request later instead of three.

A rejection is never remembered, so a failed read - most likely the backend
mid-recycle - cannot poison the next attempt. Admin save paths call the matching
`invalidate*()` so an edit is visible at once rather than up to a minute later,
and `clearCrewState` clears the whole in-memory cache on a user switch.

## Backend boot: googleapiclient is no longer imported at module scope

`drive_upload.py` imported `googleapiclient.discovery` at module level, and it is
pulled in by `app.routers.photos`, so ~300 ms (measured in isolation, fresh
process) was paid on EVERY uvicorn boot - and the worker recycles every 1000
requests by design, with the service down for each one. Every other Google
integration already deferred this import; this module was the exception. Moved
inside the two functions that build a client. No behaviour change.

---

## Row deletes are serialized per tab and re-read on a stale index (2026-08-27)

**Class B/C.** No new field and no new domain: a change to how every
replace-style export performs the delete half of its write. [ADR 0041](decisions/0041-row-deletes-are-locked-and-re-read.md).

| Change | Path | Adherence |
|---|---|---|
| `_delete_rows_matching` wraps every index-based row delete | `_delete_sheet_rows_by_value`, `_delete_bol_stale_rows`, `delete_event_from_sheets`, `delete_materials_from_sheets`, `export_availability_window_to_sheets` | read |
| Per-(spreadsheet, tab) lock held across the key-column read AND the `deleteDimension` batch | same five | read |
| One re-read-and-retry on the "Cannot delete a row that doesn't exist" 400 | same five | read |

**What changed in the exchange.** Nothing about *what* is written, or when it is
triggered. What changed is that the read and the delete are now one critical
section per tab instead of two independent calls, so a second writer cannot
invalidate the row indices between them.

**Why it belongs in this ledger.** The failure it removes was a silent
*write* failure, not a queue or trigger failure. `rebuild_job_materials_total_in_bills`
deletes the job's old Bills "Materials" line and then appends the new total.
Sheets rejects a `deleteDimension` batch atomically, so a lost race deleted
nothing and appended nothing, and the job kept its **previous** materials total
with no gap in the sheet to notice. 37 occurrences in one day on 2026-08-27.

**Re-drive after deploy.** The fix stops new occurrences; it does not refresh the
totals already frozen. Admin -> Sync & Accuracy -> Sheet Backfill re-drives the
materials exports, which recomputes those Bills lines.

**Adherence caveat.** The retry covers writers outside this process (cron,
backfill in another worker, an admin editing the sheet by hand); the lock covers
the two pool threads. Neither makes the delete atomic with the **append** that
follows it.

That remaining gap is harmless for row indices - an append does not move
existing rows - but it is **not** harmless for duplicates, which the first
version of this entry glossed over and a `/vet` caught. Two rebuilds of the same
job interleave as A.delete, B.delete (finds nothing), A.append, B.append, and
the job ends up with two Materials lines. The fix for that is coalescing, below,
not the lock.

## The Bills materials rebuild is coalesced per job (2026-08-27)

**Class B/C.** A trigger change, not a field change.

| Change | Path | Adherence |
|---|---|---|
| `schedule_job_materials_bills_rebuild(job_uuid)` replaces `run_export_in_background(rebuild_job_materials_total_in_bills, ...)` | `POST /api/materials` (`materials.py`), `DELETE /api/materials/{id}`, and the backfill's `_re_materials` | read |

Same in-flight + rerun shape as `schedule_incident_export`, keyed by `job_uuid`:
one worker per job, at most one pending rerun, and every run recomputes the
total from Postgres so a rerun cannot write a stale figure.

**Why it is needed.** The rebuild is replace-style and fires on every materials
POST and DELETE. A crew member's offline queue draining four materials
submissions for one job fires four rebuilds into a two-worker pool, and they
race into two Materials lines - a doubled materials charge, in the one export
whose output is money. The same defect and the same remedy as incidents, which
already carried this note in `schedule_incident_export`'s docstring; the Bills
rebuild simply never got one.

It is also cheaper: a job with eight submissions in a backfill now costs one
rebuild instead of eight writes of the same total.

**Failure handling is preserved deliberately.** The worker keeps
`note_export_failure` and the `[sheets] background export failed (...)` message
that `run_export_in_background` emits, because this path no longer goes through
it - the failure ring is how the 37 stale-index failures were seen at all, and
RUNBOOKS greps for that string. A raising rebuild still releases its in-flight
slot, or that job's Bills line would never rebuild again for the life of the
worker.

## A BOL `pdf` op that cannot be BUILT is a permanent failure (2026-09-02)

**Class B/C.** A drain-classification change. No new fields, no new endpoints, no
change to any payload: `POST /api/bol/{bol_id}/pdf` and the Drive folder it
writes to are untouched.

| Change | Path | Adherence |
|---|---|---|
| `generateBolPdf` throwing is re-raised as `BolPdfBuildError` and marked failed, instead of falling into the transient backoff | `lib/bolStore.ts::syncQueue`, the `op === "pdf"` branch | read |
| A `pdf` op that keeps failing transiently is marked failed after 8 online attempts (`PDF_MAX_TRANSIENT_ATTEMPTS`, roughly ten minutes of connectivity) | `lib/bolStore.ts::syncQueue`, transient branch | read |
| An explicit Retry now clears `attempts` / `retry_at` as well as the failure mark | `lib/bolStore.ts::retryFailedBol` | read |
| Every string drawn into a PDF is transliterated to WinAnsi first | `lib/winAnsi.ts` (new), called from `wrap()` in `bolPdf`, `dqCertViolationsPdf`, `dqEmploymentAppPdf`, `dqRoadTestPdf` | read |

**Why it is a data-flow fact and not just an error message.** The `pdf` op is the
last step of the BOL sequence and the only writer of `digital_bols.signed_pdf_url`
/ `signed_pdf_drive_id`. It regenerates the PDF from the local draft on each
drain, so a failure IN THE GENERATION is deterministic: the transient path
retried it every couple of minutes forever, and because a `pdf` op carries no
`failed_at`, nothing surfaced. **The observable effect was a signed BOL that
never appeared in Drive, with no error anywhere** - the exact silent-failure
shape the queue rules exist to prevent (ADR 0013, ADR 0020).

Upload failures stay transient, because a 502 from Drive IS worth retrying - but
only up to a point. A wrong `DRIVE_BOL_FOLDER_ID` or an expired credential
produces the same 502 forever, and the old behaviour was to retry it every two
minutes for the life of the install without ever saying so. Eight online attempts
now ends in the same failed mark, carrying the server's own reason. This is the
only op in the app with an attempt cap, deliberately: `pdf` is last in its
sequence (so marking it holds no sibling behind it), and it is the only op whose
entire purpose is a third-party upload. Do not generalize the cap to `submit` or
`sign` - those carry signatures and a marked `submit` blocks the two ops behind
it.

Nothing is deleted in either case (ADR 0013). A human Retry clears the mark and
now also resets the counters, so it genuinely tries again rather than waiting out
a backoff that was already up to two minutes long.

The transliteration changes the BYTES WRITTEN to Drive for any BOL whose item
names or notes contain non-WinAnsi characters: `≈ 320 cu ft` prints as
`~ 320 cu ft`. Postgres and the Sheet still hold the original text - only the
generated PDF is transliterated. See
[ADR 0042](decisions/0042-pdf-text-is-transliterated-and-a-failed-copy-is-not-a-failed-signature.md).

**Not fixed by this change:** rows already sitting at `status = 'delivered'` from
the retry-signs-the-next-phase defect. They are wrong records and need the SQL in
RUNBOOKS.

## Employee directory in Tools (2026-09-04)

Request ddf88e92. One new field on an existing payload; no new endpoint.

| Path | Where | Status |
|---|---|---|
| `phone` added to `DirectoryEntry` on `GET /api/users/directory` | `schemas/users.py`, `routers/users.py` | [x] |
| `phone?` on the client type, so an older cached roster still parses | `auth/AuthContext.tsx` | [x] |
| Directory page at `/directory`, reachable from Tools | `pages/EmployeeDirectory.tsx`, `pages/Tools.tsx`, `main.tsx` | [x] |

**CURRENT EMPLOYEES ONLY** (user direction). The endpoint already filtered on
`is_active` and still does. There is no archive concept in this app - the roster
action is Revoke / Restore - so "current" and "not revoked" are the same test.
Somebody who left and was never revoked still appears, which is roster hygiene
rather than something to work around in code.

**No new endpoint and no second fetch.** The page reads the SAME cached roster
the rest of the app keeps (`lib/userDirectory`), which is load-bearing already:
employee hours are keyed on it and it is cached so a crew member with no signal
can still log hours. Reusing it makes the directory work offline for free; a
second copy of the same data would only be a way for the two to disagree.

**What changes about visibility.** That endpoint already exposed every active
crew member's name and email to every signed-in crew member (it backs the profile
photos in activity logs). Adding `phone` widens what colleagues can see about
each other, which is the point of the request, but it is a real widening and is
recorded here as one.

**`phone` is optional end to end.** A roster cached by a build older than this
has no phone field, so "No phone on file" is a rendered state rather than a
crash.


## Reimbursement / mileage ledger for the office (2026-09-03)

Request b59434c2 item 3.

| Path | Where | Status |
|---|---|---|
| `reimbursements.qb_status` (pending / entered) + `qb_entered_at` / `qb_entered_by_name` | migration `n4p6r8m0o2q4` | [x] |
| `GET /api/reimbursements/search` - admin-only, composable filters | `routers/reimbursement.py` | [x] |
| `PATCH /api/reimbursements/{uuid}/qb-status` - reversible | `routers/reimbursement.py` | [x] |
| `paid_at` / `paid_period_*` and the QB fields on `ReimbursementOut` | `routers/reimbursement.py` | [x] |
| Admin module UI: search, filters, Drive links, QB toggle | `pages/Admin.tsx` (`ReimbursementsAdminTab`, its own nav tab) | [x] |
| `qb_status` / `qb_entered_at` / `qb_entered_by` as NEW COLUMNS on the Reimbursements tab; the PATCH re-exports | `sheets_export.REIMBURSEMENT_HEADERS`, `routers/reimbursement.py` | [x] |
| Date filters fall back to `created_at` when `expense_date` is NULL, matching payroll | `routers/reimbursement.py` | [x] |

**Receipts are LINKS, not downloads** (user direction). The module renders plain
anchors with `target="_blank"` for `receipt_photo_url`,
`odometer_start_photo_url`, `odometer_end_photo_url` and `photos_drive_url`. It
never fetches image bytes, and there is no `download` attribute - which keeps
photos off the memory path that has bitten this app before, and gains nothing
that Drive does not already give. The copy tells the office to right-click to
save one.

**It opens on the working list**, not on everything: not-yet-entered, personally
paid. Every filter widens to "any". A module that opens on 500 rows is one nobody
works from.

**Search is a separate admin endpoint, not a flag on the crew list.** The crew
endpoint defaults to the caller's own rows and already carries an `all_users`
escape hatch; growing more admin filters onto it is the shape that eventually
leaks somebody else's receipts. This one requires admin on its first line.

**Payment and QuickBooks entry are separate facts.** A claim can be paid by a
finalized payroll run and still pending entry - which is exactly the state the
office needs to see, so both are returned.

**Marking entered is reversible**, and the who/when stamp is cleared on the way
back so it never describes a state the row is not in. A one-way flag turns a
mis-click into a receipt that never gets entered, which is the failure the column
exists to prevent.

**Default `pending` for every existing row** is a claim about the future, not the
past: nothing in the app knows what the office has already keyed in, and marking
history as entered would be inventing a record.


## PTO is recorded by the office, never by the crew (2026-09-03)

Request 1a50fa5b.

**PTO IS OFFICE-ONLY** (user direction, 2026-09-03). It appears nowhere
crew-facing: crew cannot log it, cannot see their balance, and do not see PTO the
office recorded for them on their own off-job list or in Worked Hours. It is
stored as an off-job entry purely because that is where payroll picks it up.

| Path | Where | Status |
|---|---|---|
| `users.pto_hours_annual` (Float, default 0, 0 = not eligible) | migration `l2n4p6k8m0o2`, `db/models/user.py` | [x] |
| Eligibility / cap / remaining, derived from entries | `core/pto.py` | [x] |
| Crew POST refuses `pto` with 403; `CREW_PAY_STRUCTURES` excludes it | `routers/off_job.py` | [x] |
| `POST /api/admin/off-job-hours/pto` records PTO against an employee (admin) | `routers/off_job.py` | [x] |
| `GET /api/admin/off-job-hours/pto-balance/{user_id}` (admin) | `routers/off_job.py` | [x] |
| `GET /api/admin/off-job-hours/pto?user_id=` lists what has been recorded (admin) | `routers/off_job.py` | [x] |
| `DELETE /api/admin/off-job-hours/pto/{entry_uuid}` removes a mistake; PTO-only, 409 on logged work | `routers/off_job.py`, `sheets_export.delete_off_job_from_sheets` | [x] |
| PTO filtered out of the crew's off-job list and BOTH Worked Hours queries | `routers/off_job.py`, `routers/hours.py` | [x] |
| `off_job_entries.recorded_by_id` / `recorded_by_name` | migration `m3o5q7l9n1p3` | [x] |
| `recorded_by` on `OffJobOut` and as a NEW COLUMN on the OffJobHours tab | `routers/off_job.py`, `sheets_export.OFF_JOB_HEADERS` | [x] |
| Payroll: its own `pto` bucket, in `totals.pto_hours` and per day | `routers/payroll.py` | [x] |
| Payroll screen: record PTO + live balance, per employee | `components/PayrollTool.tsx` (`PtoSection`) | [x] |
| Admin roster: set someone's annual PTO hours | `pages/Admin.tsx` (`PtoAllowance`), `routers/admin.py` | [x] |
| Payroll TSV export gains PTO and Tips columns | `components/PayrollTool.tsx` | [x] |

**Calendar year, no roll-over, and PTO never reaches overtime** (both confirmed).
OT sums only the `billable` bucket, so giving PTO its own bucket is what keeps it
out - paid time off is not worked time, and letting it push somebody past forty
would pay overtime for hours nobody worked.

**The balance is derived, never stored.** A stored running total is a second
source of truth that drifts the first time an entry is edited or deleted, and it
would drift silently.

**Zero means not eligible.** There is deliberately no separate boolean: an
allowance of zero and "not eligible" are one fact, and two ways to say it would
eventually disagree.

**The cap is enforced server-side, not just in the UI.** An admin working from a
stale screen must not be able to overspend somebody's year.

**`submitted_by` stays the EMPLOYEE** on an admin-recorded entry, because payroll
attributes hours by it. `recorded_by` is the new audit trail for who in the
office entered it - for paid time drawn from an allowance, "who granted this" is
the question somebody will ask.

**A crew POST of `pto` is refused with 403, not silently coerced** to "regular".
A quiet downgrade would record paid time off as worked time, which is worse than
an error.

**Editing an entry is judged on the change.** The queue re-submits the same
`entry_uuid` to edit, so the entry's own prior hours are excluded from the "used"
figure - otherwise lowering 8 hours to 4 is refused for exceeding a cap the 8 had
already filled.

**A mistake can be taken back** (added 2026-09-09, vet finding 5). PTO is the one
entry in this app that SPENDS something finite, and there was no way to undo a
wrong one: nothing deletes an off-job entry, `hours` must be positive so it could
not be zeroed, the payroll screen never listed the entries or their uuids, and
`CORRECTION_BUCKETS` has no `pto` so a payroll correction could not offset one
either. A mistyped 80 instead of 8 consumed somebody's year, permanently, short of
a psql session.

The delete is **PTO-only and refuses a crew member's logged work with a 409**. That
work is a record of something that happened and is not the office's to erase;
re-using this path for it would turn an audit trail into an edit surface. It is a
hard delete, and the Sheet row goes with it - the balance is derived from the
entries, so removing the row IS the correction, which is exactly why the balance
was built derived rather than stored.


## Office-entered money reaches the Sheet (2026-09-09)

Vet findings 4 and 8. The rule the user set for this: **new data joins the
worksheet it is categorically like; only genuinely different data earns a new
tab.**

Four facts the OFFICE owns were being stored in Postgres and surfaced only
in-app. Postgres is not the record the office reconciles from - the Sheet is -
so "it is in the database" was not the same as recorded, and one of them
(`recorded_by`) was readable in no screen at all.

| Fact | Where it went | Why there |
|---|---|---|
| PTO `recorded_by` | **column** on OffJobHours | it is a fact about an off-job entry, and off-job entries have a tab |
| Reimbursement `paid_at` / `paid_period_*` | **columns** on Reimbursements | facts about a reimbursement |
| Reimbursement `qb_status` / `qb_entered_at` / `qb_entered_by` | **columns** on Reimbursements | same |
| Tips | **new tab** `Tips` | see below |

**Why tips did NOT become a column.** A tip is close to a reimbursement in shape
(employee, date, amount, optional job, note) but not in meaning: a reimbursement
pays somebody back for money they spent. Folding tips in would make that tab's
amount column stop answering "what do we owe in expenses", which is the question
it exists for. It is not hours either. So it is the one that earned a tab.

**Adding a column is safe and needs no migration.** `_ensure_tab` appends a
column that is missing from an existing tab, to the RIGHT of what is there, and
`_build_row` maps positionally against the header actually in the sheet. Rows
written before the column come back blank rather than shifted.
`scripts/test_sheet_new_columns.py` asserts exactly that, because the
Reimbursements header being overwritten is what produced 189 duplicate rows and a
$17,088 over-count in the 2026-08-05 audit.

**Blank means blank, not zero.** `paid_at` is empty on every claim settled by
hand before the stamp existed - the migration deliberately did not backfill,
because inventing a payment record is worse than an empty cell.

**Re-export is wired at every writer**, or the columns would only ever show the
value a row had when it was filed: the QB PATCH re-exports its claim, and
finalize re-exports every claim it stamped (after the commit, best-effort on the
bounded pool - the money has already moved and the DB already says so, so failing
a payroll run because Google was slow would be the wrong trade).

**`SHEETS_TIPS_TAB` must be set on staging** before tips are used there, or
staging tips land in the production `Tips` tab. See CREDENTIALS.md. Both it and
`SHEETS_PAYROLL_TAB` are now in `.env.staging.example` (2026-09-10), which is
where their absence was actually costing something: neither was listed, so the
default silently pointed staging payroll at the production worksheet.

**Both create paths are idempotent (2026-09-10).** `POST /api/admin/payroll/tips`
and `POST /api/admin/payroll/bonuses` accept a client-minted `tip_uuid` /
`bonus_uuid` on the request body, the same pattern as `event_id`,
`submission_id` and `bol_id`. The key is minted once per pending entry in
`PayrollTool.tsx` and held in a ref until the server confirms, so a retry after
a lost response carries the SAME key; the server returns the existing row with
`deduped: true` and does not update it, so a replay can never alter an amount
already recorded. Both fields are optional, so an older client keeps the
server-minted id and the old behaviour. Until this, the uuid was minted
server-side, which meant the unique index on it could not dedupe anything and a
hand-retried POST created a second payable row.

| Path | Where | Status |
|---|---|---|
| `tip_uuid` accepted and replayed | `schemas/payroll.py`, `routers/payroll.py::create_tip` | [x] |
| `bonus_uuid` accepted and replayed | `schemas/payroll.py`, `routers/payroll.py::create_bonus` | [x] |
| Key minted per pending entry, held across a retry | `components/PayrollTool.tsx` | [x] |
| Replay proven not to double-write | `scripts/test_payroll_tips.py` | [x] |


## Payroll notes: one rolling note, archived at each finalize (2026-09-09)

Office direction, and the brief was "it is very important the text is saved".

| Path | Where | Status |
|---|---|---|
| `system_config["payroll_notes"]` - ONE rolling note, not one per period | `routers/payroll.py` | [x] |
| `GET` / `PUT /api/admin/payroll/notes`, admin-only | `routers/payroll.py` | [x] |
| `payroll_runs.notes_snapshot` - what it said at that finalize | migration `q7s9u1p3r5t7` | [x] |
| `notes` column on the Payroll tab, from the snapshot | `sheets_export.PAYROLL_HEADERS` | [x] |
| Autosaving editor above the table, markdown bold + bullets | `components/PayrollNotes.tsx` | [x] |

**Rolling, not per period.** What the office keeps here is standing information,
so a field that emptied itself every fortnight would just be re-typed every
fortnight. Finalizing archives it and leaves it in place.

**Saved means the server said so.** The status reads "Saved" only once the PUT
has echoed the text back, never on having sent it - an indicator that reports the
attempt rather than the outcome is worse than none, because it gets trusted. Any
later keystroke reads as unsaved again.

**Four ways an autosave loses work, each closed:** a local mirror on every
keystroke; a flush on pagehide, on tab switch and on unmount (a debounce
cancelled on unmount is how the last sentence disappears); an immediate save on
blur; and a failed save that says so in words with a retry rather than being
swallowed.

**A local copy that never reached the server WINS on load.** If the mirror
disagrees with the server, that is work whose save did not land, and letting the
server copy overwrite it silently would destroy the thing this field exists to
protect. It is kept, and the office is told.

**Markdown, not rich text.** The archive is a Sheet cell. Markdown gives the bold
and bullets that were asked for and stays readable as plain text there; markup
would be lost or read as noise. No editor library was added.

**The SNAPSHOT publishes, never the live note.** Re-reading the current note when
a backfill re-drives an old run would rewrite history - the note keeps changing
after a period is finalized. Same reasoning as `rows_json`.

**The cap IS the Sheet cell cap** (50,000 characters), not a cautious fraction of
it. The archive writes the note into one cell of the Payroll tab, so that is the
point past which it stops being archivable at all - and a lower limit would
refuse text the Sheet could happily hold. Named once as `SHEETS_CELL_MAX_CHARS`
so the validator and its message cannot drift apart, and refused where somebody
is looking at it rather than truncated silently at finalize weeks later.


## Add-a-line becomes one tool for what an employee forgot to log (2026-09-09)

Office direction. "Add a line" and the requested bonus tool are the same job to
the person doing it - recording something that never got logged - so they are
one control, not two.

| Path | Where | Status |
|---|---|---|
| `employee_bonuses` table | migration `p6r8t0o2q4s6`, `db/models/employee_bonus.py` | [x] |
| `POST/GET/DELETE /api/admin/payroll/bonuses` | `routers/payroll.py`, `schemas/payroll.py` (`BonusCreate`) | [x] |
| `payroll_corrections.notify` - per-line email opt-out | migration `p6r8t0o2q4s6` | [x] |
| `totals.bonus_amount` + `bonus_items` on the summary | `routers/payroll.py` (`_bonuses`) | [x] |
| Tips and bonuses share ONE tab, separated by a `kind` column | `sheets_export.export_extra_pay_to_sheets` | [x] |
| Bonus column on the Payroll tab and in the TSV | `sheets_export.PAYROLL_HEADERS`, `PayrollTool.tsx` | [x] |

**It is an ADD tool, not a correction tool** (the wording the office objected to).
The old copy said it "records an override", which invited its use for fixing
numbers crew had already submitted. Corrections belong on the thing that was
logged; this adds a line that never existed. The heading and help say so.

**A bonus is not a bucket.** Every correction bucket is HOURS and a bonus is
DOLLARS, so it cannot share the mechanism without corrupting every sum that adds
them up. It appears in the same picker and routes to its own endpoint.

**A bonus needs no reason; everything else does.** That text is what the crew
member is emailed, and demanding a justification for paying somebody extra is
friction with nothing behind it.

**`notify` is opt-OUT, defaulting to true.** Changing somebody's pay without
telling them is the worse default, so silence is a deliberate tick, per line. A
line marked do-not-notify is left out of the finalize email but STILL stamped
`notified_at`, or every finalize would pick it up again forever. If every line
for one person is marked, they get no email rather than an empty one.

**ONE TAB for tips and bonuses**, per the office's rule that categorically
similar data joins the worksheet it is like. The fields are identical - person,
date, flat amount, optional job, note, who entered it - so `kind` is the fresh
column. They stay separate TABLES because "what did we pay out in bonuses" must
not come back inflated by tips. Safe to restructure the tab's key column
(`tip_uuid` to `entry_uuid`) because Tips is new and unpromoted, so there is no
live data to disturb. All THREE registries updated.


## Payroll periods reach a worksheet, with Tips as a column (2026-09-09)

User direction: tips belong on the payroll sheet in a fresh column, and the tab
must be one the app owns end to end.

| Path | Where | Status |
|---|---|---|
| `payroll_runs` table - one row per finalized period, with `rows_json` | migration `o5q7s9n1p3r5`, `db/models/payroll_run.py` | [x] |
| Snapshot of the run's rows taken INSIDE the finalize transaction | `routers/payroll.py` (`_payroll_snapshot_rows`) | [x] |
| Export refuses a period with no run row, and publishes the snapshot only | `routers/payroll.py` (`_queue_payroll_export`) | [x] |
| Recorded on finalize (upsert; `run_count` increments on a re-finalize) | `routers/payroll.py` (`_record_payroll_run`) | [x] |
| **NEW TAB** `Payroll` (`SHEETS_PAYROLL_TAB`), one row per employee per period | `sheets_export.export_payroll_period_to_sheets` | [x] |
| Rows carry `user_id` and a unique `row_key` (period + user_id) | `sheets_export.PAYROLL_HEADERS` | [x] |
| All THREE registries: health check, backfill audit, nightly integrity | `sheets_export.py`, `sheet_backfill.py`, `scripts/sheet_integrity_check.py` | [x] |
| Exported after the finalize commit, off-request on the bounded pool | `routers/payroll.py` (`_queue_payroll_export`) | [x] |
| Both registries + backfill source and re-export, keyed on `period` | `sheets_export.py`, `sheet_backfill.py` | [x] |

**FINALIZED PAYROLLS ONLY** (user direction, 2026-09-09), enforced at the
export rather than left to whoever calls it. Two ways it could be false, and only
one is obvious:

1. A period nobody finalized reaching the tab. Refused: no `payroll_runs` row,
   no export. Before this it was true only because the sole caller happened to be
   `finalize_period`, which is an accident, not a guarantee.
2. **The one that actually bites** - a finalized period whose FIGURES are not the
   ones that were finalized. `_build_summary` reflects the data as it is now, so
   a correction entered after a finalize but before a re-finalize changes what it
   returns, and the backfill re-drives exports from `payroll_runs` weeks later.
   That would have published numbers nobody ever finalized. Money that has been
   decided is not recomputed.

So the run stores `rows_json`, a snapshot taken inside the finalize transaction
after the paid stamps. A re-drive republishes exactly what was finalized; a
re-finalize is the one event that legitimately rewrites it. A run with no
snapshot is skipped and logged rather than falling back to live figures, which
would be the exact failure the snapshot exists to prevent.

**Why a run ledger had to come first.** `system_config` held only the LATEST
finalized period, so "which periods have been finalized" was unanswerable - which
meant the backfill audit had nothing to enumerate and the new sync would have
been unauditable. A sync nobody can audit is one whose stranded rows are
invisible, which is the hole `sheet_backfill` exists to close.

**Keyed by PERIOD, not per employee.** Every employee row in a run carries the
same `period` key, and the export replaces the whole period. Deleting by a
per-employee key would leave last run's rows behind for anyone who dropped off
the payroll since. This is why `_delete_sheet_rows_by_value`'s `keep_last` flag
became `keep_last_n`, a COUNT: sparing a single row would delete everybody except
the last person on the run.

**Append first, then drop the stale rows** (ADR 0043), so a worker recycle
mid-sequence leaves a visible duplicate the next run cleans up rather than a hole
where a pay period used to be.

**No second header guard.** The dedupe key IS `PAYROLL_HEADERS[0]`, so
`_ensure_tab` already raises on a populated header row that has lost it. The
Bills rebuild needs its own guard because `submission_id` sits at index 14 there;
here one would be unreachable, and an unreachable check reads as protection that
is not there.

**Identity by KEY, not by name** (Core Behavior 5). The first cut of this tab
identified people by display name alone, which is the one thing this app has an
invariant against - payroll joins on the roster `user_id` everywhere else exactly
so a rename or a nickname cannot detach somebody from their own hours, and two
people with the same name would have collapsed onto one row on the money tab.
Rows now carry `user_id`, and `row_key` (period + user_id) is unique per row.

**`row_key` is also what makes duplicates detectable.** `period` repeats by
design - every employee on a run shares it - so it cannot be the duplicate key
for `sheet_integrity_check.py`. Since this export appends before deleting stale
rows, a crash between the two leaves exactly the duplicates that check exists to
find. `row_key` is `PAYROLL_HEADERS[0]`, so it is also the column `_ensure_tab`
protects against a renamed header row.

**All THREE registries, not two.** The 2026-09-09 vet found `tips` and `payroll`
registered for the health check and the backfill audit but absent from
`scripts/sheet_integrity_check.py` - the NIGHTLY duplicate and header-overwrite
check, which is the one that found the 189-duplicate-row, $17,088 failure. It
also found `report_waivers` missing there since 2026-08-13, so that tab had never
once been checked. `scripts/test_sync_registries.py` now asserts all three agree.

**The Tips tab stays**, holding the itemization behind the total: which job, which
note, who entered it. Same relationship Materials has to the Bills materials line
- a total on the sheet the office works from, the detail on its own tab.


## Tips are paid out through payroll (2026-09-03)

Request f8e008cb. Money.

| Path | Where | Status |
|---|---|---|
| `employee_tips` table | migration `k1m3o5j7l9n1`, `db/models/employee_tip.py` | [x] |
| `POST/GET/DELETE /api/admin/payroll/tips` | `routers/payroll.py`, `schemas/payroll.py` (`TipCreate`) | [x] |
| `_tips()` windows on `tip_date` and totals per employee | `routers/payroll.py` | [x] |
| `totals.tips_amount` + `tip_items` on the payroll summary | `routers/payroll.py` | [x] |
| Payroll screen: per-employee tip entry, list and remove | `components/PayrollTool.tsx` (`TipsSection`) | [x] |
| Admin Job Summary: per-job tip entry, list and remove | `pages/Admin.tsx` (`JobTipsCard`) | [x] |
| **NEW TAB** `Tips` (`SHEETS_TIPS_TAB`), replace-style on `tip_uuid`; a delete removes the row | `sheets_export.export_tip_to_sheets` / `delete_tip_from_sheets` | [x] |
| Registered in `SHEET_SYNC_REGISTRY`, so the Sheet-syncs health check covers it | `integrations/sheets_export.py` | [x] |

**The design point.** Tips arrive late, so `tip_date` (the payout date, defaulting
to today in Mountain time) decides the pay period, NOT the job's date. A tip
recorded today for an August job is paid on the current run instead of landing in
a period that has already been finalized. `job_uuid` is reference only and is
deliberately not a foreign key: a tip is money owed and must survive the job row
changing.

**Tips are flat dollars, never hours.** They sit in `totals` beside
`per_diem_amount` and `reimbursement_amount`, never enter the hours buckets, and
are explicitly absent from the OT calculation (confirmed by the user). They are
not quarter-rounded - rounding a dollar figure to the quarter hour would be
nonsense.

**No split rule.** The office types who gets what. A tip is a gift with somebody's
judgement attached, and an allocation formula would put the app's opinion where
the office's belongs.

An employee whose ONLY entry in a period is a tip still gets a payroll row, or
the money would be invisible.

**NEITHER SCREEN SENDS `tip_date`.** Both rely on the server defaulting it to
today, and that is load-bearing: the Job Summary has the job's date right there,
and passing it would drop the tip into a period that has almost certainly been
finalized. `frontend/scripts/verify_tips_ui.mjs` asserts both clients omit it.


## Finalizing payroll marks the reimbursements it paid (2026-09-03)

Request b59434c2 item 2.

| Path | Where | Status |
|---|---|---|
| `reimbursements.paid_at` / `paid_period_start` / `paid_period_end` | migration `j0l2n4i6k8m0`, `db/models/reimbursement.py` | [x] |
| Stamped on payroll finalize, in the same transaction as the correction emails | `routers/payroll.py` (`_mark_reimbursements_paid`) | [x] |
| Returned on the payroll summary's reimbursement items as `paid_at` + `paid_period` | `routers/payroll.py` | [x] |
| Finalize response carries `reimbursements_paid` (a count) | `routers/payroll.py` | [x] |
| `paid_at` / `paid_period_start` / `paid_period_end` as NEW COLUMNS on the Reimbursements tab, re-exported after the finalize commit | `sheets_export.REIMBURSEMENT_HEADERS`, `routers/payroll.py` | [x] |

**A separate stamp, not a `status = "paid"` value.** Approval and payment are two
different facts about one row; overwriting the status would lose who approved it
and when, and would make a paid-but-never-reviewed claim indistinguishable from
an approved one. The existing approve/decline flow is untouched.

**What counts as paid** is exactly what payroll counted: everything in the window
except an explicit decline. In practice that is the approved ones, because
**finalize now BLOCKS on any unreviewed claim** (2026-09-03, at the user's
direction), so "paid but nobody looked at it" cannot happen.

That gate replaced a warning. The old argument was that payroll pays anything not
declined, so an unreviewed claim was already being paid and blocking would stop
payroll over money going out either way. Right about the money, wrong about the
outcome: it left a real state ("paid, and nobody ever looked") that then had to be
represented in the finalize response, in the paid stamp, and in the admin's head.
Requiring the review deletes the state instead of describing it.

The stamp's rule is still written as "not declined" rather than "approved", so it
agrees with what `_reimbursements` actually summed. Narrowing it would make the
ledger disagree with the payment the day anything reaches it in another state.

The payroll screen disables Finalize and names who has outstanding claims, so the
block is visible before the button is pressed rather than only as a 409 after.

**Idempotent.** Only rows with a null `paid_at` are touched, so re-finalizing a
period stamps nothing new and a claim paid on an earlier run keeps that run's
dates instead of being re-attributed to whichever period is finalized next.

**Not gated on the correction emails succeeding.** A correction that fails to
send is retried by the next finalize because its `notified_at` stays null; a
reimbursement is not a notification, it is money that has already moved, and
leaving the ledger wrong to protect an email would be the wrong trade.

**Migration is additive and nullable with no backfill.** NULL means "not paid
through the app", which is the truth for every claim filed before this: earlier
periods were settled by hand and nothing here can know what happened outside the
app. Backfilling would be inventing a payment record.


## Payroll hours are quarter-rounded per contribution (2026-09-03)

Request e2126bf1. A MONEY change: it changes what people are paid.

| Path | Where | Status |
|---|---|---|
| The rounding rule moves to a dependency-free module | `core/hours_rounding.py` (new) | [x] |
| `sheets_export._round_billable_quarter` becomes an alias of it | `integrations/sheets_export.py` | [x] |
| Every payroll contribution is quarter-rounded after corrections and before any sum | `routers/payroll.py` (`_round_rows`, called at the `_apply_corrections` seam) | [x] |
| Applies only to periods STARTING on or after the cutover | `core/hours_rounding.py` (`PAYROLL_ROUNDING_EFFECTIVE_FROM = 2026-09-16`) | [x] |

**The defect.** Payroll summed raw hours and rounded the total to two decimal
places; the Sheet and the job report quarter-rounded each entry. Two numbers for
the same work, and people were paid from the unrounded one. A realistic week
(8:05, 7:58, 8:20, 6:04, 9:12) pays 39.65 under the old rule and 40.00 under the
new one, while the crew member's own job reports already showed them 40.00.

**Round-then-sum is not sum-then-round.** Three 2h05m jobs are 6.75 rounded per
job and 6.25 rounded at the end. Rounding happens per contribution, which is what
the request asked for and what the job report already does.

**Not retroactive**, at the user's direction: earlier periods were reconciled by
hand and re-rounding them would restate what has already been paid. Gated on the
period's START so a period is rounded or not as a whole, never half-and-half.

The cutover is set a week out, because the promotion date is not known. **It is
a fixed date, so a promotion that slips past it turns the cutover into the past**
and restates periods already paid. Moved from 2026-09-10 to **2026-09-16** on
2026-09-09, when the 2026-09-09 vet found it one day from expiry with `main` four
weeks behind.

That near-miss is why it is no longer only a checklist tick: `scripts/promotion_gate.py`
now **fails** the check id `cutover` when the date is not in the future (and notes
it when within three days), and CI runs that gate on every PR into `main`. Section
7b of [PROMOTION_CHECKLIST.md](PROMOTION_CHECKLIST.md) still carries the step,
because the gate can say the date is stale but not what the right new one is.

**No schema, no migration, no new env var.** `per_diem_nights` rows are skipped:
their "hours" is a count of nights, not a duration.


## Bill lines are checked one at a time (2026-09-09)

Vet finding 7, redirected by the user. **Class D-ish: no endpoint, no queue, no
migration.** What changes is a field inside the bill's existing free-form items
JSON, and what gates report submission.

| Path | Where | Status |
|---|---|---|
| `LineItem.verifiedSig` - the line's value-signature when it was ticked | `components/BillCalculator.tsx` | [x] |
| `isVerified` / `unverifiedLines`, exported for the gate | `components/BillCalculator.tsx` | [x] |
| `BillSlots.unverified` comes down the render prop so the readout re-renders | `components/BillCalculator.tsx` | [x] |
| Submission and the step-through both block, naming the lines | `components/JobReport.tsx` | [x] |
| `ReportDraft.billReviewed` is DEAD, kept only so older drafts parse | `components/JobReport.tsx` | [x] |

**It rides in the bill items JSON**, which the API already stores free-form
(`items: billData.items`), so there is no schema change, no new column, and a
tick survives a reload and reaches a second device with the rest of the bill.

**A tick is a signature, not a boolean** (ADR 0044). A line counts as checked only
while its signature still matches its label / qty / rate / unit / discount, so any
later change - a materials rebuild, a corrected end time, an auto-fill added next
year - un-ticks it without any invalidation code to keep in step.

**Truck lines are no longer re-sized after creation.** The previous behaviour
re-derived any line without an explicit lock, which repaired the frozen-1h bills
and also silently overwrote every deliberate figure entered before the lock
existed. Old bills are left alone at the user's direction (2026-09-09): they have
been corrected by hand where it mattered, and the 1h bug cannot recur because the
line is not created until there are hours to size it from.

**The truck hours rule itself is unchanged**, and is what was asked for: the
longest single billable shift, minus that shift's breaks.
`EmployeeHoursEntry.hours` is already `span - breaks` (`JobReport.tsx`,
`hours: Math.max(0, (span - breakMin) / 60)`), and `longestBillableShift` reads
`hours`, so "longest shift minus breaks" is what already shipped. A coverage /
union-of-shifts rule was considered and **not** adopted; the review burden moves
to the per-line check instead.


## Truck lines on the bill are sized from the longest shift (2026-09-03)

Admin report: "trucks are autopopulating as 1 hr". A truck line is $90/hr, so
this is the money path.

| Path | Where | Status |
|---|---|---|
| Truck line qty = `longestBillableShift(employee_hours)`, quarter-rounded, non-billable rows excluded | `lib/employeeHours.ts` (new export), `components/BillCalculator.tsx` | [x] |
| The line is NOT created until at least one billable shift exists | `components/BillCalculator.tsx` | [x] |
| The line follows the longest shift until the admin edits its qty or rate | `components/BillCalculator.tsx` (`truckEditedRef`, session-scoped) | [x] |
| Bill-totals warning covers "trucks recorded, no hours yet" | `components/BillCalculator.tsx` | [x] |

**Cause.** The effect created the line as soon as `truckCount` was known and
sized it `reduce(...) || 1`, then preserved that value forever because `existing`
was truthy on every later render. Employee hours are entered at the END of a job
and truck fullness during it, so the hours array was normally EMPTY at creation:
reduce gave 0, `|| 1` gave 1, and the line sat frozen at one hour. Not a race,
the ordinary order of work. The labor effect already guarded
`employeeHours === undefined`; the truck effect did not.

**No stored shape changes.** No new field on the bill, no schema, no migration,
no Sheet column. The qty written is different, that is all. Bills already saved
with a wrong 1h are repaired when the bill is next opened, because a line the
admin has not edited in that session tracks the longest shift.

**The override is PERSISTED**, as `qtyLocked` on the line item. Typing hours into
a truck line sets it; the line then keeps that number through a reload and
through later changes to the hours. Crews as well as admin can override - there
is no role gate on the bill lines.

A first pass held this in a component ref, which was wrong: the override snapped
back to the computed value the moment anybody re-opened the bill. It has to be
stored. It needs no backend change - `BillUpsert.items` is
`List[Dict[str, Any]]` stored as JSON, so the flag round-trips - and no
migration.

`qtyLocked` absent means "not overridden", which is what every bill written
before this carries, so bills stuck at a wrong 1h re-size themselves on open
rather than needing to be found by hand.

**There is a way back.** An overridden truck line shows "Hours set by hand" and a
"Use crew hours" control that clears the flag. Without it, one hand-typed number
detaches the line from the crew's hours permanently, and hours get corrected all
the time - a break logged late, an end time fixed the next morning. The truck
would sit at the old figure with nothing admitting it had stopped tracking,
which is the same silent-wrong-number shape as the 1h bug itself.


## Close-out: `variance_cause_identified` becomes derived (2026-09-03)

From a review of the whole close-out section. No new field, no schema change,
no endpoint change. What changes is HOW one existing field gets its value.

| Path | Where | Status |
|---|---|---|
| `variance_cause_identified` was answered at its own step; it is now computed from the three cause answers (`deriveCauseIdentified`) | `lib/closeout.ts`, `components/CloseoutStepper.tsx` | [x] |
| The `identified` step is gone from `closeoutSteps`; the flow is ran -> direction -> 3 causes -> note | `lib/closeout.ts` | [x] |
| Re-opening a report reconstructs the three answers from what was stored (`bucketAnswersFrom`) | `components/CloseoutStepper.tsx` | [x] |
| Flipping direction now recomputes the flag against the causes that survive the flip | `components/CloseoutStepper.tsx` | [x] |
| Scope editor gated on `scope_added_on_site` / `scope_reduced_on_site` only | `components/CloseoutStepper.tsx` | [x] |

**The defect this removes.** Answering "Yes I can identify the cause" and then No
to all three questions stored `true` with an empty cause list, and the Sheet
showed "Cause identified: Yes" next to a blank Reasons column. Nothing
recomputed the flag once it was set.

Storage, validation and the Sheet column are all unchanged: still a nullable
boolean, still exported Yes / No / blank by `_yes_no_blank`, still accepted by
`JobReportIn` as `Optional[bool]`. Old reports read back correctly, and a stored
`false` reconstructs as three Nos. **No back-fill and no migration**: a report
saved before this keeps whatever it recorded.

See the 2026-09-03 addendum to
[ADR 0040](decisions/0040-closeout-is-a-stepper-with-three-cause-buckets.md).


## Field help is a toast, on nine fields only (2026-09-03, reworked 2026-09-09)

**Class D, client only.** No endpoint and no queue. `helpTexts` is admin config
that already round-trips through `SystemConfig`; what changed is which keys exist
and how the text is shown.

| Change | Where | Adherence |
|---|---|---|
| Tapping a field title opens a TOAST, not an inline reveal | `components/FieldHelp.tsx` | read |
| Duration is `readingTimeMs`: 3s, plus 3s per 10 words | `components/Toast.tsx` | read |
| A depleting progress bar, driven by that same value | `components/Toast.tsx` | read |
| 12 help keys retired; 9 remain | `theme/ThemeContext.tsx`, `pages/Admin.tsx` | read |

**Why a toast rather than the inline box.** The reveal opened under the field
title and pushed the rest of the form down, so the field being explained moved
while it was being read, and on a long form the explanation could open
off-screen. A toast sits in one predictable place over the form and nothing
reflows.

**Why the duration is not fixed.** Three seconds suits "Crew" and is far too
short for the valuation explanation, which is the one people most need to finish.
Ten words per three seconds is roughly ordinary reading speed, with a flat three
seconds on top for noticing the toast at all. The longest text runs 21 seconds.

**Why the progress bar.** There is no close button, so without something visibly
moving a crew member cannot tell "this will go in a moment" from "this is stuck".
The bar and the timer read the same number, so it cannot promise a moment the
toast does not honour. Tapping still dismisses early (existing `Toast`
behaviour); the bar is so nobody has to discover that to believe the app works.

**Why only nine fields.** Help on "Crew" and "Origin" is noise, and a "?" on an
obvious field teaches people the "?" is not worth tapping - so they stop tapping
it on Valuation, which decides what a customer is owed for a broken television.
What is left is the set where a wrong answer puts wrong terms on a signed legal
document, or where the field name is industry vocabulary a new crew member has no
reason to know: shipper name, form of payment, both COD fields, estimate type,
valuation, additional carriers, third-party insurance, accessorial services.

**The text is written for somebody new to moving** (office direction). Every
acronym is spelled out where it is used, and where a wrong answer costs money the
text says what it costs - released value is explained as "60 cents per pound, so
a 10 pound TV pays $6". The valuation text also names released value as the
STANDARD and points at the job's Google Calendar description, which is where the
office flags a full-value job (their direction, 2026-09-09), so the crew have
somewhere to check instead of guessing. It deliberately does not claim the form
pre-selects released value: the field opens on "Not set", which is correct,
because released value is a written waiver and an app should not tick a waiver on
somebody's behalf. `verify_field_help.mjs` asserts the exact nine, the
timing arithmetic by exercise rather than by grep, and that COD and DOT are
expanded wherever they appear.


## BOL queue: a failed `pdf` no longer holds the rest of its BOL (2026-09-03)

Found by `/vet` (F3). No payload change; the **drain order** changes.

| Path | Where | Status |
|---|---|---|
| `syncQueue` blocking rule: an op that did not land holds later ops for the same `bol_id`, EXCEPT `pdf` (`blocksSequence`) | `lib/bolStore.ts` | [x] |
| `PDF_MAX_TRANSIENT_ATTEMPTS` 8 -> 11 (the stated ~10 min window; the sum of backoffs at 8 was 246s, about four minutes) | `lib/bolStore.ts` | [x] |

A long-distance BOL is signed twice and each signing enqueues its own
`submit+sign+pdf` triple, so `pdf` is the last op of its triple but not of the
BOL. A deterministic PDF build failure (ADR 0042's font defect) therefore held
the DESTINATION SIGNATURE unsent behind it. Failed ops are still kept and still
marked (ADR 0013); they just stop taking a signature hostage. `submit` and `sign`
still block. See the addendum to
[ADR 0042](decisions/0042-pdf-text-is-transliterated-and-a-failed-copy-is-not-a-failed-signature.md).

Regression-guarded by `frontend/scripts/verify_bol_queue_blocking.mjs`, which
drives the real `syncQueue` and asserts BOTH directions.


## Bills materials rebuild: write strategy and reconciler coverage (2026-09-03)

Found by `/vet`, not from the field. No payload field changes; what changes is
the **write strategy** of one export and the **reconciler coverage** behind it.
See [ADR 0043](decisions/0043-the-bills-materials-line-is-appended-before-stale-rows-are-dropped.md).

| Path | Where | Status |
|---|---|---|
| `rebuild_job_materials_total_in_bills` write strategy: was delete-then-append, now **append-then-delete-stale** (`keep_last=True` spares the bottom-most match) | `integrations/sheets_export.py` | [x] |
| `schedule_job_materials_bills_rebuild(job_uuid, db)` writes a durable pending marker before the work is attempted | `integrations/sheets_export.py`; callers in `routers/materials.py` (POST + DELETE) and `integrations/sheet_backfill.py` | [x] |
| Marker row: `sheet_generic_exports (kind='bills_materials_pending', export_key=<job_uuid>)`, cleared only on a successful rebuild | existing table, created by `ensure_sheet_exports_tables` - **no migration** | [x] |
| `reconcile_job_materials_bills(db, max_jobs=25)` drains leftover markers on the auto-reconciler's FAST (5 min) cycle | `integrations/auto_reconciler.py` | [x] |

**Why the ordering flipped.** The delete ran first, so a worker recycle between
the delete and the append left the job with no materials charge on the Bills tab
at all - silent under-billing on the one export whose output is money. Appending
first turns that same crash into a duplicate line, which is visible, flagged by
`sheet_integrity_check.py`, and cleaned up by the next rebuild.

**Why the marker exists.** The coalescer's in-flight and rerun sets are process
memory, and Render recycles this process every 1000 requests by design. A rerun
registered just before a recycle was lost, and a rebuild that raised was given up
on; nothing re-drove either. The marker is in Postgres and the reconciler holds a
DB lease, so it survives the recycle that lost the work.

**No new env var, no new tab, no schema change.** Staging/prod isolation is
unchanged: the rebuild still resolves its tab from `SHEETS_BILLS_TAB`.


## The day plan gains an "internal rearrange" activity (2026-09-02)

**Class D, client only.** No endpoint, no queue, no new field. What changes is
the vocabulary of an existing persisted value.

| Change | Path | Adherence |
|---|---|---|
| `crew_ld_plan_v1:<date>.activities` may now contain `"rearranging"` | `components/LdWorkday.tsx` (`LD_ACTIVITIES`) | read |

Nothing about the exchange moves. Only `driving` is sent anywhere - `useLdPlan`
derives `drive_day` from it and writes that through `setLdDay` - and
`rearranging` is a LABOR activity, so it lands in `laborSelected` and gates the
Actions buttons exactly like packing or unloading. It deliberately does **not**
open the BOL Inventory tab: that gate is `ldLabor.includes("loading")`
(`App.tsx`), and an internal rearrange has no shipment to declare.

Both directions are compatible with a device holding the other build's plan.

### The plan write reports its failure, and a toggle reads the committed plan (2026-09-10)

**Class D, client only.** Still no endpoint and no new field; what changes is the
WRITE STRATEGY behind the same key, so it is logged here rather than ridden along.

| Change | Path | Adherence |
|---|---|---|
| `crew_ld_plan_v1:<date>` written via `persistJson`, result checked | `components/LdWorkday.tsx` (`savePlan`, `persist`) | `[x]` |
| A refused plan write surfaces the storage-full message | `components/LdWorkday.tsx` (`storageErr`) | `[x]` |
| `toggleActivity` resolves against `planRef.current`, not the render snapshot | `components/LdWorkday.tsx` | `[x]` |
| Behavioral coverage | `frontend/scripts/verify_ld_plan_toggle.mjs` | `[x]` |

`savePlan` used to be a bare `try/catch` that dropped its failure, the last raw
swallow on a write path in the app and exactly the pattern `lib/persistQueue.ts`
exists to outlaw (ADR 0020, "bug 5"). It matters more here than the "client only"
class suggests: `driving` is what `useLdPlan` turns into `drive_day`, and
`drive_day` is what pays the day and gates the federally required RODS recorder.
A plan that did not persist used to look ticked, then revert to whatever last
landed, which is how a crew lead reached a drive day with no duty log
(2026-09-10). Both the plan write and the `setLdDay` write are now reported.

The stale-snapshot half is the same defect seen from the other side: two toggles
resolved against one render dropped the first, so ticking a second activity
cleared `driving`.
`LdPlanTile` renders from the fixed `LD_ACTIVITIES` list rather than from the
stored array, so an older build reading a plan that contains `rearranging` keeps
the value, counts it as labor, and simply shows no chip for it.

Reported from the field 2026-09-01: with no honest option for a day spent moving
items inside one home, crews were ticking **Loading**, which recorded a wrong
activity and offered a BOL inventory for a shipment that does not exist.

## Off-job hours reach the Job Summary lookup, and can be corrected there (2026-09-09)

Off-job hours were the last logged thing with no admin surface anywhere:
`GET /api/admin/off-job-hours` existed and **nothing called it**. The crew could
file them, payroll summed them, and a wrong number could only be fixed by
deleting the entry and asking the person to file it again.

### Exchanges

| Change | Path | Trigger | Adherence |
|---|---|---|---|
| `GET /api/admin/job-search` takes `include_off_job` (default **false**) and may return `kind:"off_job"` rows | `routers/admin.py::job_search` | admin presses Search in the Job Summary lookup | read |
| `GET /api/admin/payroll/off-job/{entry_uuid}/corrections` | `routers/payroll.py::list_off_job_corrections` | admin opens an off-job result | read |
| `PUT /api/admin/payroll/off-job/{entry_uuid}/corrections` | `routers/payroll.py::upsert_off_job_correction` | admin saves a correction | write, immediate |
| `DELETE /api/admin/payroll/off-job/{entry_uuid}/corrections/{correction_id}` | `routers/payroll.py::delete_off_job_correction` | admin withdraws one | write, immediate |

No queue and no offline path: this is an admin-only desk surface, and a
correction that silently retried later is worse than one that failed loudly.

`include_off_job` is **opt-in**, and that is a correctness property rather than
tidiness. `job-search` has a second caller - the admin-notes job picker, which
attaches a `job_uuid` to a note. An off-job entry has none, so an always-on flag
would let an admin file a note against nothing. Exactly one caller passes it.

### Per-field: `kind:"off_job"` search rows

| Field | Source | Notes |
|---|---|---|
| `kind` | literal | `"off_job"`; `"job"` on every other row |
| `entry_uuid` | `off_job_entries.entry_uuid` | what the caller acts on |
| `job_uuid` | literal `""` | present so the list has one shape |
| `job_name` | `"<employee> - off-job hours"` | the row's title |
| `dates` | `[work_date]` | matched on `work_date` exactly |
| `hours`, `pay_structure`, `user_name` | the entry | shown on the row |
| `entered` | literal `false` | data-entry attestation is a job concept |

Matched on the **employee's** name, not a customer's - it is the only name an
off-job entry has, and it is what an admin looking for "Dylan's shop hours on
the 3rd" types. Bounded at 200 rows like the sibling queries.

### The correction rows themselves

Off-job corrections are **date-scoped**: `period_start` / `period_end` NULL,
placed by `work_date`, exactly as job corrections have been since ADR 0032. See
**[ADR 0045](decisions/0045-corrections-are-scoped-by-period-or-by-date-never-by-job.md)**
for why, and for the discriminator change it forced.

Two read paths moved, and both moved the same way:

| Path | Was | Now |
|---|---|---|
| `_payroll_summary` date-scoped read | `job_uuid IS NOT NULL` + work_date in period | `period_start IS NULL` + work_date in period |
| `finalize_period` pending-mail query | `period_start == start` only | that **or** `period_start IS NULL` + work_date in period, still excluding `job_uuid IS NOT NULL` |

The finalize half is the load-bearing one. Before it, a correction with neither
a period nor a job was mailed by **no** path - the attestation only mails by
`job_uuid`, and the period clause cannot match NULL - so pay would have changed
with the employee never told. Both queries now key on the same rule, so what a
period pays and what it mails are one set.

Neither change affects an existing row: job corrections have always nulled their
period and period corrections have always set one, so `period_start IS NULL`
selects exactly the set `job_uuid IS NOT NULL` did.

`PUT /api/admin/payroll/corrections` (the payroll screen's per-line editor) also
drops its period filter for `source="off_job"` and writes NULL periods, so the
two surfaces cannot each hold a row for the same entry.

Everything factual on the correction is derived server-side from the entry - who
it is about, the work date, and what was filed - so a stale client cannot
misattribute one. `OffJobCorrectionUpsert` carries no `user_id` at all.

### Schema

`r8t0v2q4s6u8` adds `uq_payroll_correction_dated`, unique on
`(user_id, source, source_key, bucket)` where `period_start IS NULL AND
job_uuid IS NULL`. **Postgres only, guarded on the dialect**: `postgresql_where`
is silently dropped on SQLite, where this would become a full unique index that
also binds the period-scoped rows the partial clause exists to exclude.

Nothing new reaches the Sheet. A corrected off-job figure flows out through the
existing payroll export, because it is applied by `_payroll_summary` like any
other correction.

### Refused, on purpose

Recorded **PTO** cannot be corrected here. It pays into the `pto` bucket, which
is deliberately not a correction bucket (it must never reach the overtime sum),
and it draws down an allowance the PTO tool tracks; correcting it here would
leave the two out of step. The payload carries `correctable: false` and the
reason, so the admin reads it instead of filling in a form and taking a 400. An
entry with no roster account is refused the same way - there is nobody to
correct, and nobody to tell.

Verified by `frontend/scripts/verify_off_job_corrections.mjs` (44 checks).

## Admin-review vet fixes (2026-09-09)

Three findings from a vet of the payroll / job-report-review / reimbursement
surfaces. No new endpoint and no new payload field; two read paths change and one
localStorage key changes hands at logout.

### 1. An attestation goes stale when the report changes under it

| Change | Path | Adherence |
|---|---|---|
| `jobs_pending_review[].reason` may now be `"edited after review"` | `routers/payroll.py::_build_summary` | read |

A job counted as reviewed forever once initialed. A crew member editing their
hours afterwards was paid the new number and the job never returned to the
pending list. **Reproduced**: initialed at 8 hours, edited to 14, payroll paid
14.0 with `jobs_pending_review == []`.

The gate now compares `AdminEntryStatus.updated_at` against
`JobReport.updated_at` for the same job and treats a later report as unreviewed.
Two extra bounded queries, both restricted to the period's own job list.

Compared against the **report only**, not the bill (office decision): the report
carries hours and hours are what this gate protects, while a bill edit is
usually the admin's own during review and would just ask for a second tick.

Safe to key on `updated_at` because `routers/job_report.py` is its only writer -
the Sheet backfill reads job reports and never writes them - and admin
corrections live in `payroll_corrections` and never touch the crew's submission
(ADR 0029). Asserted in the test: correcting hours does **not** re-open a job.

The frontend needs no contract change; the new reason string renders where
`"not initialed"` already did, and the Waive button stays keyed to
`"no report filed"`.

### 2. The payroll read no longer loads every reimbursement ever filed

| Change | Path | Adherence |
|---|---|---|
| `_reimbursements` windows in SQL instead of scanning the table | `routers/payroll.py::_reimbursements` | read |
| `ix_reimbursements_expense_date`, `ix_reimbursements_created_at` | migration `s9u1w3r5t7v9` | schema |

`db.query(Reimbursement).all()` ran on every payroll page load and threw most of
the result away in a Python date test. It was the only aggregator on the page
doing that; tips, bonuses, off-job and office hours all window in SQL. This is
the unbounded-growth-in-the-worker class CLAUDE.md documents.

Now two bounded queries whose union is the same set:

- `expense_date` inside the window (ISO string compare, as `_off_job_hours` does);
- `created_at` inside the window's UTC span, which catches every row whose
  `expense_date` is null, empty **or unparseable** - the fallback cases, none of
  which a portable SQL predicate can express - and over-fetches a few that the
  unchanged Python check then discards.

The Python re-check remains the authority, so **which rows are paid does not
change**. Proven by an equivalence test over all seven shapes, including a
`"09/03/2026"` expense_date and a claim created in-window but dated out.

The indexes are what make it bounded work rather than only bounded memory: the
table only grows, and the office opens this page repeatedly during a run.

### 3. The payroll note's mirror survives a logout

| Change | Path | Adherence |
|---|---|---|
| `crew_admin_payroll_notes_mirror_v1` is backed up before `clearCrewState` | `auth/preserveFailedWork.ts` | write, local only |

The note mirrors to localStorage on every keystroke so a save that never reached
the server is not lost. Its key is `crew_`-prefixed, so the logout/user-switch
wipe deleted it - cutting the net at the one moment it exists for. Worse, the
next load then had no local copy to disagree with the server, so the server's
copy won silently, which is exactly what `PayrollNotes.tsx` is built to prevent.

Preserved the same way the close-out drafts are, and **user-scoped**: restored
only to the account that wrote it (office decision), so a second admin on the
same machine sees only the server's copy. Restore never clobbers text typed
since. A note over 100k chars is skipped with a console error rather than
truncated - it could not have been saved anyway (the server caps at a Sheets
cell's 50k), and an unbounded write here risks the `QuotaExceededError` that
would lose the entire backup, signed BOLs included.

Nothing reaches the Sheet differently. Verified by
`backend/scripts/test_payroll_review_integrity.py` (37 checks) and
`frontend/scripts/verify_payroll_notes.mjs`.

---

# Deviations from the model

Things that do not do what their class says. Keep this list short and act on it.

### 1. `out_of_town` is transmitted but never set

Narrowed 2026-09-09. The old form of this entry was "the long-distance day queue
never drains", which was the larger defect: nothing called
`ldDayStore.syncQueue()`, so the `LdDays` table and the `LongDistancePay` tab
stayed empty and Admin's "Drive days" tally always read zero. That is fixed - the
queue now drains from boot and `online` - and `drive_day` completes its path.

What remains is narrower: **nothing ever calls `setLdDay` with `out_of_town`**, so
that column stays false and the tab's derived `per_diem` stays 0. The toggle that
would set it lives on the Report tab, per person, and writes the job report rather
than the `LdDay` row.

Not a payroll-money bug: `payroll.py` takes per-diem nights from the per-employee
`out_of_town` flag on job-report hours and only supplements from `LdDay`. The loss
is confined to the `LongDistancePay` tab's own columns.

Logged in [RUNBOOKS.md](RUNBOOKS.md) Known defects.

### 2. The estimator queue drains only on mount

`estimatorQueue.drain` is called from `EstimatorTab.tsx:524` on mount and on
`estimate_uuid` change. It has no `online` listener, so an item queued offline waits
for the crew to reopen that estimate rather than shipping on reconnect. This is the
failure class ARCHITECTURE.md warns about under "A queue must not depend on its own
UI being mounted". It self-heals on next open, so it is a weakness rather than data
loss, but `pruneStale` deletes entries after 14 days.

**It is now the only one left.** The BOL, RODS, long-distance day, bug report,
feature request, job setup, checklist and reimbursement queues were all moved to
boot + `online` (reimbursements additionally on a 2-minute timer). `verify_ld_drain.mjs`
scans `lib/` for queue modules unreachable from `App.tsx`; the estimator is the
known exception it is allowed to report.

### 3. Availability has no offline path

Class B by design, but it is the only crew-facing **submission** that silently cannot
be made offline. Worth knowing before someone reports "I submitted my availability
and it vanished".

### 4. Event edits are not reconciled

`PATCH /api/events/{id}` writes the sheet cell synchronously and swallows failures.
The auto-reconciler covers missing event **rows**, not stale event **cells**. A
failed note or timestamp edit leaves the Sheet showing the old value until someone
edits it again.

---

# Unpromoted work

Everything `staging` adds or changes on top of this baseline is logged in
**[DATA_FLOW_STAGING.md](DATA_FLOW_STAGING.md)**, in the same per-field format. At
promotion those entries are folded into this doc, that one is emptied, and the
"Verified against" block above is bumped. The procedure is the **Data-flow doc gate**
in [VETTING_PROTOCOL.md](VETTING_PROTOCOL.md).

If you are debugging something a crew member reported, this doc is the one that
describes what they are running. If you are building a feature, the staging doc is
where it gets logged.
