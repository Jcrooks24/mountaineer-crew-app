# Data Flow, staging delta

New and changed data exchange on `staging` that has **not been promoted to `main`**.
This is where dev work gets logged as it is built, and it is the checklist that gets
folded into [DATA_FLOW.md](DATA_FLOW.md) at promotion.

## Verified against

| | |
|---|---|
| Branch / commit | `staging` @ `7fe20a4` |
| Compared to | `main` @ `72b544a` |
| Date verified | 2026-08-06 |

> **Reconciled 2026-08-11 against `staging` @ `7f41611`.** The stamp above is the
> last full field-level verification. Every commit since that touches a data path
> has been checked against this ledger; the results are in "Reconciliation
> 7fe20a4 -> 7f41611" immediately below. The stamp itself is bumped at promotion,
> when this delta folds into DATA_FLOW.md, per "At promotion".

## Reconciliation 7fe20a4 -> 7f41611

18 commits, 7 touching a data path. Checked one by one.

> **Verification level: READ, not TRACED.** Every row below is marked **read**,
> not `[x]`, and that distinction is the point. This doc's legend says `[x]`
> means the field completes device -> Postgres -> Sheet, and VETTING_PROTOCOL
> spells it out: "a field marked `[x]` means you traced it device to Postgres to
> Sheet, not that you assumed it."
>
> These were verified by reading the source and the commit diffs. Nothing was
> exercised end to end, no row was followed into the Sheet. That is enough to
> say the ledger is no longer under-reporting; it is NOT enough to promote a
> field to `[x]`.
>
> **At promotion, trace these five before folding them into DATA_FLOW.md as
> `[x]`.** They are not marked `[ ]` because that asserts a field does not
> complete its path, which would be an equally unearned claim in the other
> direction.

Checked one by one:

| Commit | Data path | Ledger status |
|---|---|---|
| `3750c3f` LD job setup owns the BOL header | `job_setup` PUT gains `bol_header` (migration `b2d4f6a8c1e3`); seeds BOL + RODS | **already logged** under "Job setup", incl. the per-field row and the seed rules |
| `176a137` block finalize until every job reviewed | new precondition on `POST /api/payroll/finalize` | logged below |
| `fb66575` gate finalize on report-less jobs | same endpoint, second precondition | logged below |
| `fe2d27f` multi-day span + per-entry date | `payroll.py` + `employeeHours.ts`: how an entry's date is derived | logged below |
| `d8709aa` gate de-dup + `mountainHHMM` hourCycle | `payroll.py` + `lib/time.ts` | logged below |
| `de77fce` pin recorded times to Mountain | `ldDayStore`, `rodsStore`, `lib/time.ts`: the VALUE written | logged below |
| `9d9f97f` RODS driver-keying | `long_distance.py` + `rodsStore.ts`: how a RODS day is keyed | logged below |
| `99adc10` reopen-in-edit / deep links | **none** - UI only, no `routers`/`integrations`/`lib` change | not a data path |

### Recorded time is Mountain, not device-local (`de77fce`, `d8709aa`)

**This changes the value written, not the shape.** RODS duty-change stamps and
LD-day times were recorded in the device's local timezone. A phone on Pacific or
Central time therefore wrote a different clock reading than the same event on a
Mountain phone, and payroll then summed them as if they agreed.

Times are now pinned to **America/Denver** at the point of recording
(`lib/time.ts::mountainHHMM`, using an explicit `hourCycle` so 24-hour formatting
does not drift by locale). No field was added or removed; existing rows written
before this carry device-local values and are **not** back-corrected.

| Field | Adheres | Note |
|---|---|---|
| RODS `duty_changes_json[].time` | **read** | `mountainHHMM`. "A phone in Central must not shift the duty time +1h" |
| RODS `log_date` | **read** | `mountainDateYYYYMMDD` - the DOT log's home-terminal date, not the device's. A late-evening entry from a Pacific phone no longer files under the previous day |
| `LdDay` recorded times | **read** | same treatment |

Rows written before `de77fce` carry device-local values and are **not**
back-corrected.

### Payroll finalize has two new preconditions (`176a137`, `fb66575`)

`POST /api/payroll/finalize` now refuses when the pay period contains a job that is
**not reviewed**, or a job with **no report at all**. Both are server-side; the UI
mirrors them but is not the gate. `d8709aa` de-duplicates the two so a single job
cannot raise both at once.

No new fields. This is a **write-strategy** change: finalize is no longer
unconditional, so a period can now be blocked by upstream data that has not landed.

### Entry date is per-entry, not per-job (`fe2d27f`)

A multi-day job used to attribute every hour entry to the job's own date. Hours are
now attributed to **each entry's own date** (`employeeHours.ts` + `payroll.py`), so a
job spanning a period boundary splits across periods correctly instead of landing
wholly in one.

| Field | Adheres | Note |
|---|---|---|
| employee-hours entry `date` | **read** | **optional.** When present it is authoritative for period assignment; when absent the job's earliest-event date is used, which is the old behavior. So this is additive: existing entries without a `date` are unaffected |

### RODS days are keyed by driver, not by device (`9d9f97f`)

The resume cluster and the shared-trip fetch keyed a RODS day inconsistently, so on a
multi-driver trip one driver's device could resume **another driver's** day. Keying
is now `(driver_id, log_date)` on both paths, matching the idempotency key
VETTING_PROTOCOL already lists for RODS.

| Field | Adheres | Note |
|---|---|---|
| RODS `driver_id` | **read** | now the join key on resume AND shared-trip fetch |

**Pre-existing rows written before this may carry the wrong `driver_id`** on
multi-driver trips. Not back-corrected, and worth a spot-check against the RODS tab
before promoting.

## A failing staging flow blocks the merge

Every new or changed data path on `staging` must **pass** before it promotes. A path
passes when every field in its table is `[x]` or `[-]`, and it does what its flow
class promises.

**These block a `staging -> main` merge:**

| Blocker | Why |
|---|---|
| Any `[ ]` in this doc | a new field that does not complete its path. Shipping it means shipping data that is collected and then lost |
| Any entry under "Deviations new on staging" | a new path that does not honor its class's contract, most often ADR 0013 |
| A data path changed in the diff but absent from this doc | you cannot vet what was never logged, so treat it as failing until it is written up |

**Inherited deviations do not block.** Anything already carried by `main` and listed
in Known defects in [RUNBOOKS.md](RUNBOOKS.md) is pre-existing; promoting it changes
nothing about production. It is the **new** ones that stop a merge.

A blocker clears one of two ways: fix it, or get an explicit written waiver from the
user recorded in this doc with the reason. Silence is not a waiver.

### Open blockers right now

**None.** All three cleared 2026-08-11:

1. **Checklist ticks deleted on permanent rejection.** `jobChecklistStore` now marks
   the entry failed, keeps it, rolls back the optimistic cache, and surfaces it on
   the job card with Retry and Discard.
2. **Bug reports and feature requests retried forever.** Both stores now split
   permanent from transient and mark-and-keep.
3. **Two failure classifiers.** Converged to one (`queueFailure.isPermanentRejection`).
   `api/client.isPermanentFailure` is gone.

A fourth was found while fixing these and is also cleared: `jobSetupStore` silently
deleted a queued job header on a permanent rejection. Every offline queue in the app
now honors ADR 0013.

Summaries also appear under "Deviations new on staging" below, in data-flow terms.

## How the two docs relate

| Doc | Covers | Changes when |
|---|---|---|
| [DATA_FLOW.md](DATA_FLOW.md) | production, verified against `main` | only at promotion |
| **this doc** | everything `staging` adds or changes on top of that | every feature, same commit as the code |

**This is a delta, not a second copy.** A domain that behaves identically on both
branches is documented once, in DATA_FLOW.md, and does not appear here. Duplicating
the full ledger would guarantee the two drift, and then neither is trustworthy.

**New dev work goes here first.** Adding a queue, a drain, an endpoint, or a Sheet
export on staging means adding its entry to this doc in the same commit, in the same
per-field format DATA_FLOW.md uses. Legend (`[x]` / `[ ]` / `[-]`) and the flow
classes (A through E) are defined there; do not restate them.

## At promotion

1. Every section below is merged into the matching place in DATA_FLOW.md: new
   domains become new domain sections, changed rows are edited in place, new
   deviations join the Deviations list.
2. DATA_FLOW.md's "Verified against" block is bumped to the promoted commit.
3. **This file is emptied back to the skeleton** (headers, the two tables above, and
   empty sections), with its "Verified against" reset to the new `main`. An entry
   left here after promotion is a lie about what is unreleased.
4. Anything deliberately not folded up gets a stated reason, in writing, here.

The full step-by-step is the **Data-flow doc gate** in
[VETTING_PROTOCOL.md](VETTING_PROTOCOL.md).

---

# Changed behavior in existing domains

## One failure classifier (converged 2026-08-11)

`staging` briefly carried two, and they disagreed. Converged to a single function,
`lib/queueFailure.ts::isPermanentRejection`. `client.isPermanentFailure` is deleted.

**Permanent = every 4xx except 401, 403, 408, 429.** Full reasoning in
[ADR 0013](decisions/0013-rejected-queue-work-is-never-deleted.md); the two facts
that matter to data flow are recorded under "Queue failure handling" below.

## Photo captions: a failed save is no longer reported as success

**Changed 2026-08-11.** `POST /api/photos/caption` returned HTTP **200** with
`{"ok": false, "error": ...}` when the photo was missing or the DB commit failed.
`apiFetch` throws only on `!res.ok`, so a 200 read as success: the UI showed
"Note saved", cleared the draft, and the note was gone. Neither caller checked
`ok`. For an incident photo the note **is** the record.

| | |
|---|---|
| Endpoint | `POST /api/photos/caption` |
| Was | 200 + `{"ok": false}` on both failure paths |
| Now | **404** photo not found (permanent), **500** DB commit failed (retryable) |
| Queue | none. Captions are not queued, which is why swallowing mattered |

Client handling now turns on whether a local copy holds the caption:

- **Local photo** - `updatePhoto` stored it and it rides along on the next
  upload. Every server failure is swallowed, including a 404, because a
  not-yet-uploaded photo genuinely is not on the server yet.
- **Server-only photo** - nothing else holds the note. Every failure is
  surfaced, offline included, so the crew member knows to redo it on signal.

Drive description mirroring stays best-effort and still never fails the request.

## The long-distance day queue is still dead on staging

`ldDayStore.syncQueue()` still has no caller. The `online` handler at
`App.tsx:1878` now drains eleven queues and LD day is not among them. See
DATA_FLOW.md Deviations and Known defects in [RUNBOOKS.md](RUNBOOKS.md).

## The `online` / boot drain set has grown

`App.tsx` (`online`) and the mount effect now also call `drainBugReports`,
`drainFeatureRequests`, `drainJobSetups`, `drainChecklistChecks`. All four are wired
to **both** boot and `online`, correctly.

**`drainReimbursements` joined them 2026-08-12**, and it is the reason to check this
list when adding a queue. Mileage and expense claims drained **only while
`Reimbursement.tsx` was mounted**, so a claim that hit a transient failure sat in
IndexedDB until the crew member happened to open that screen again. It read to them
as "resend is broken": resend worked, nothing retried after it. A receipt could go
unsent for days with the crew member believing it was filed.

It is now on boot, on `online`, and additionally on a **2-minute timer** while the
app is open. The timer exists because neither boot nor `online` fires when the app
stays connected and the SERVER has a bad minute (a deploy, a 503, a cold start).
Cost is one IndexedDB read per tick: `syncQueue()` returns immediately when offline,
already draining, or empty.

Reimbursements are the only queue on a timer. The others are boot + `online` only,
so the same stranding is possible for any of them - most notably the estimator
queue, which has its own Known defects entry for exactly this.

| Queue | boot | `online` | timer |
|---|---|---|---|
| incidents, off-job, bug reports, feature requests, photos, job inventory, job setups, checklist checks | yes | yes | no |
| reimbursements | yes | yes | **yes, 2 min** |
| estimator | **no - tab-mounted only** | no | no |

---

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

## Queue failure handling (write-strategy change, all queues)

**Changed 2026-08-11.** No new fields and no new endpoints; what changed is what
each queue does with a payload the server permanently refuses.

| | |
|---|---|
| Classifier | **one** now: `lib/queueFailure.ts::isPermanentRejection`. Permanent = every 4xx except 401, 403, 408, **429**. `api/client.ts::isPermanentFailure` (an allowlist of 400/404/409/422) is deleted |
| Write strategy | mark-and-keep on a permanent rejection, in **every** queue. Nothing is deleted because the server refused it |
| Drain | a marked entry is skipped, so it cannot wedge the entries behind it |
| Exit | an entry leaves the queue only by syncing, or by an explicit human Discard |

Ported this day: `jobChecklistStore` (was deleting), `jobSetupStore` (was
deleting a queued job header - addresses, crew, shipment details), plus
`bugReportStore` and `featureRequestStore` (had no permanent/transient split at
all, so a refused report was re-POSTed forever).

Two classifier consequences worth recording as data-flow facts:

- **429 is now transient everywhere.** A Google Sheets rate limit no longer
  discards field work in the ten queues that previously treated it as permanent.
- **413 is now permanent everywhere.** The backend returns 413 from the body-size
  middleware and three upload endpoints; the deleted allowlist treated it as
  transient, which meant an oversized upload retried forever and never shrank.

See [ADR 0013](decisions/0013-rejected-queue-work-is-never-deleted.md).

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

## Truck loads (2026-08-12)

**Class A.** `truck_fullness` entries gain `loads`.

| Field | Path | Adherence |
|---|---|---|
| `truck_fullness[].loads` | Job Report -> `PUT /api/job-report` -> `truck_fullness_json` -> JobReports sheet `truck_fullness` cell | read |

One truck running a job twice was unrecordable: the picker refuses to list a
fleet truck twice (so two rentals cannot collide), which also made "we used two
truck loads" impossible to say. The count lives on the entry, so that constraint
stays.

**No migration.** It rides inside the existing `truck_fullness_json` column.
Entries written before the field have no `loads` key, and every reader treats
missing as 1 - which is exactly what those entries meant.

**The Sheet cell changes shape only when loads > 1.** A single-load truck renders
byte-identical to before, so nothing in the existing column shifts. Two loads
appends ` ×2 loads` and the cubic-foot figure is multiplied, because the office
reasons about total volume moved. The percentage stays per-load: it is the crew's
observation of one fill, not a total.

---

# Deviations new on staging

**Everything in this section is a promotion blocker** until fixed or waived in
writing. See "A failing staging flow blocks the merge" above.

# Open questions

Not defects. Decisions nobody has made yet, which someone should make **before**
these paths promote and become the way it has always been. Each needs a yes or a no,
not a fix.

### 1. Should job setup mirror to the Sheet?

`job_setup` is the only new crew-captured domain on staging with **no Sheet export**
at all (job checklist is the other, but its manual ticks are arguably UI state).
Admin reads the header in-app today. Every comparable domain that admin cares about
(reports, bills, incidents, inventory) does land in the Sheet, and the Sheet is the
long-term record; Postgres is not.

If the answer is yes, it is a new export function plus a tab env var plus a `_HEADERS`
constant, not a config toggle. The nightly integrity check picks it up automatically
once the constant exists. If the answer is no, write down why, because the next person
mapping this will ask the same question.

### 2. Bulletin images live in Postgres, not Drive

`BulletinPost` carries `image_bytes` as a `LargeBinary` column **and**
`image_drive_file_id` / `image_drive_url` / `image_thumb_url`. This is the only place
in the app that stores blobs in the database; photos, receipts and signed PDFs all go
to Drive with only a URL in Postgres.

On a 512 MB Render worker this is a memory surface that grows with the feed, and it
sits behind `GET /api/bulletin/image/{post_uuid}` which serves the bytes through the
web worker. Worth confirming the Drive columns are the intended destination and the
`image_bytes` path is transitional, before the feed has enough history to make the
migration painful.

# Not yet documented

Nothing outstanding as of `7f41611`. Every data path changed since the "Verified
against" stamp is accounted for in "Reconciliation 7fe20a4 -> 7f41611" above.

Uncommitted work in the working tree is out of scope until it is committed. When it
lands, log it here in the same commit.
