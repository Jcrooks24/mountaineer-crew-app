# Data Flow

Every piece of data in this app, and the answer to two questions about it:
**what event triggers the exchange**, and **when the transfer actually happens**.

[ARCHITECTURE.md](ARCHITECTURE.md) describes the shape of the system. This doc is
the field-level ledger underneath it. When they disagree, this one is the one that
was checked against the code most recently, but fix both.

## Verified against

| | |
|---|---|
| Branch / commit | `main` @ `72b544a` |
| Date verified | 2026-08-06 |
| Verified by | reading the code, not by exercising the app |

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
| `window` `online` | `App.tsx:1792` | `syncQueueNow`, `drainNotePatchQueue`, `syncMaterialsInBackground`, `drainIncidents`, `drainOffJob`, `drainPendingPhotos`, `drainJobInventory` | immediate on event |
| `isOnline` state flip | `App.tsx:1857` | `syncQueueNow`, `drainNotePatchQueue`, `drainPendingPhotos` | immediate. Redundant with the above on purpose: some browsers miss `online` after sleep or a VPN flap |
| App boot | `App.tsx:1758` mount effect | same set as `online`, plus `loadHistoryFromBackend`, `ensureDirectory` | once per cold load |
| Action tap | `App.tsx::recordEvent` | `syncQueueNow` | immediate, inline with the tap |
| Component mount | BillCalculator, EstimatorTab, BillOfLadingForm, OfficeHours, Reimbursement | that feature's `syncQueue` / `drain` | on mount and on key change |
| `visibilitychange` / `focus` | BillCalculator `:523`, BolInventoryTab `:71`, JobReport `:329` | that feature's refresh | on tab return |
| Debounce timer | job notes `App.tsx:1840`, BOL `bolStore.ts:647`, estimator meta `EstimatorTab.tsx:338`, estimator item `:997` | `flushJobNotes`, `bolStore.syncQueue`, `flushMetaSave`, `flushItemSave` | 1500ms / 1000ms / 800ms / 600ms |

**Failure policy, uniform across every queue** (`lib/queueFailure.ts`, ADR 0013): a
permanent 4xx marks the entry `failed_at` and **keeps** it in the queue, skipped by
the drain so it cannot wedge the line, surfaced to the crew with Retry and Discard.
It leaves only when a person says so. **401, 403 and 408 are deliberately classified
transient** so an expired token cannot destroy a day of queued field work.

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
| Trigger | **1000ms debounce** after any item edit; plus `online`, mount, and save |
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
| Trigger | **sign-off only** (`RodsSignoff.tsx:158`). Duty changes accumulate locally until the driver signs |
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

**Class A on paper. Broken in practice.**

| | |
|---|---|
| Local keys | `crew_ld_day_v1:` (per date), `crew_ld_day_queue_v1` |
| Drain | `ldDayStore.syncQueue` |
| Trigger | **NONE. Nothing calls it.** |
| Endpoint | `POST /api/long-distance/day` |
| Export | `export_ld_day_to_sheets` |

| Field | Adheres | Note |
|---|---|---|
| `day_id` | `[ ]` | never transmitted |
| `date` | `[ ]` | never transmitted |
| `driver_name` | `[ ]` | never transmitted |
| `job_uuid` / `job_name` | `[ ]` | never transmitted |
| `out_of_town` | `[ ]` | never transmitted, **and never set**: `setLdDay` is only ever called with `drive_day` |
| `drive_day` | `[ ]` | written locally by `LdWorkday.tsx:70`, never transmitted |
| `per_diem` | `[-]` | derived at export, `$50` if `out_of_town` |
| `updated_at` | `[ ]` | never transmitted |

See Deviations. This is logged as a Known defect in [RUNBOOKS.md](RUNBOOKS.md).

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

# Deviations from the model

Things that do not do what their class says. Keep this list short and act on it.

### 1. The long-distance day queue never drains

`LdWorkday.tsx:70` calls `setLdDay()`, which writes `crew_ld_day_queue_v1`. **Nothing
in the app calls `ldDayStore.syncQueue()`.** `POST /api/long-distance/day` is its
only caller, and `long_distance.py:375` is the only place `LdDay` rows are created.

Consequences: the `LdDays` table stays empty, the `LongDistancePay` tab stays empty,
Admin's "Drive days" tally (`Admin.tsx:7154`) always reads zero, and
`crew_ld_day_queue_v1` grows on every Driving toggle without ever emptying.

Not a payroll-money bug: `payroll.py` takes per-diem nights primarily from the
per-employee `out_of_town` flag on job-report hours and only supplements from
`LdDay`. The real loss is `drive_day`, which has no other source.

Present on `main` and `staging`. Logged in [RUNBOOKS.md](RUNBOOKS.md) Known defects.

### 2. The estimator queue drains only on mount

`estimatorQueue.drain` is called from `EstimatorTab.tsx:524` on mount and on
`estimate_uuid` change. It has no `online` listener, so an item queued offline waits
for the crew to reopen that estimate rather than shipping on reconnect. This is the
failure class ARCHITECTURE.md warns about under "A queue must not depend on its own
UI being mounted". It self-heals on next open, so it is a weakness rather than data
loss, but `pruneStale` deletes entries after 14 days.

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
