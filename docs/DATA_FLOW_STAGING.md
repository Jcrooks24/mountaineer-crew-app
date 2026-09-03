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

## App speed: restart handling and route code splitting

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

### Routes are lazily loaded

Every screen was a static import, so the app shipped as one 1.5 MB bundle
(462 KB gz) that every crew phone downloaded and parsed before showing the
timeline - including `Admin.tsx`, 9,268 lines, which almost nobody opens.

| | Before | After |
|---|---|---|
| Initial download | 462 KB gz, one chunk | **174 KB gz** |
| Admin | in the main bundle | 69 KB gz, on demand |
| PDF library | in the main bundle | 174 KB gz, on demand |

`App` (the timeline) stays a STATIC import: it is the screen crews open, and
making the common case wait on a second round trip would be a pessimisation
dressed as an optimisation.

**Offline is unaffected and this was checked, not assumed:** all 28 chunks are in
the service worker precache, so they download in the background after first
paint and a crew member navigating with no signal still gets the screen.
`verify_server_restart.mjs` asserts the precache contains each lazy chunk.

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

## Finalizing payroll marks the reimbursements it paid (2026-09-03)

Request b59434c2 item 2.

| Path | Where | Status |
|---|---|---|
| `reimbursements.paid_at` / `paid_period_start` / `paid_period_end` | migration `j0l2n4i6k8m0`, `db/models/reimbursement.py` | [x] |
| Stamped on payroll finalize, in the same transaction as the correction emails | `routers/payroll.py` (`_mark_reimbursements_paid`) | [x] |
| Returned on the payroll summary's reimbursement items as `paid_at` + `paid_period` | `routers/payroll.py` | [x] |
| Finalize response carries `reimbursements_paid` (a count) | `routers/payroll.py` | [x] |

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
| Applies only to periods STARTING on or after the cutover | `core/hours_rounding.py` (`PAYROLL_ROUNDING_EFFECTIVE_FROM = 2026-09-10`) | [x] |

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

The cutover is one week out from when this was written, chosen because the
promotion date is not known. **It is a fixed date, so a promotion that slips past
it turns the cutover into the past** and restates periods already paid. Section
7b of [PROMOTION_CHECKLIST.md](PROMOTION_CHECKLIST.md) carries the step to
re-check and bump it.

**No schema, no migration, no new env var.** `per_diem_nights` rows are skipped:
their "hours" is a count of nights, not a duration.


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


## Job setup gains tap-to-reveal field help (2026-09-03)

From field feedback that the interstate workflow is confusing. 21 new keys on an
EXISTING synced payload (`helpTexts` in the theme settings), so the flow class
does not change - only the field list does.

| Path | Where | Status |
|---|---|---|
| 21 new `helpTexts` keys (`setup*Help`, `bol*Help`) on the theme-settings payload | `theme/ThemeContext.tsx` (`HelpTexts`, `DEFAULT_HELP_TEXTS`) | [x] |
| Rendered by `<FieldHelp>`: hidden, tap the field title, visible 3s, self-closing | `components/FieldHelp.tsx`, used in `components/JobSetupPanel.tsx` | [x] |
| Admin-editable, so wording changes need no redeploy | `pages/Admin.tsx` (`HelpTextCard` groups) | [x] |

Theme settings already sync device -> server and merge `DEFAULT_HELP_TEXTS` under
whatever is stored (`ThemeContext.tsx:411` and `:608`), so a device or a server
record written by an older build simply gains the new keys at their defaults.
No endpoint, no queue, no Sheet export, and no env var changes.

Blanking a key in Admin removes the "?" from that field entirely rather than
opening an empty box, which is the intended way to switch one off.

Regression-guarded by `frontend/scripts/verify_field_help.mjs`: the type, the
defaults, the rendered field and the Admin editor are four separate hardcoded
lists that nothing links, and tsc only catches one of those pairings.


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
`LdPlanTile` renders from the fixed `LD_ACTIVITIES` list rather than from the
stored array, so an older build reading a plan that contains `rearranging` keeps
the value, counts it as labor, and simply shows no chip for it.

Reported from the field 2026-09-01: with no honest option for a day spent moving
items inside one home, crews were ticking **Loading**, which recorded a wrong
activity and offered a BOL inventory for a shipment that does not exist.

# Not yet documented

Nothing outstanding as of `7f41611`. Every data path changed since the "Verified
against" stamp is accounted for in "Reconciliation 7fe20a4 -> 7f41611" above, the
auto-reconcile rate change, the row-delete serialization, and the BOL `pdf`-op
classification immediately above.

Uncommitted work in the working tree is out of scope until it is committed. When it
lands, log it here in the same commit.
