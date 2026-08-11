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

> **STALE BASELINE - reconcile before promoting.** `staging` is 18 commits past
> `7fe20a4`, and 15 of those commits touched a data path
> (`routers/`, `integrations/`, `lib/`). Two of those changes are written up in
> this doc (the DQ folder move, and the queue failure-handling change below);
> the rest have **not** been reconciled against this ledger.
>
> Unreconciled commits touching a data path: `3750c3f` (LD job setup owns the
> BOL header), `176a137` + `fb66575` + `de77fce` + `fe2d27f` (payroll time fixes
> and the finalize gate), `d8709aa` (BOL shipper-address seed race), `9d9f97f`
> (RODS driver-keying), `99adc10` (reopen-in-edit / deep links).
>
> Per the Data-flow doc gate in VETTING_PROTOCOL, "a data path changed in the
> promotion diff but absent from the staging doc" **blocks the merge** until it
> is written up. This stamp is deliberately NOT bumped to the current commit:
> doing so would claim a verification nobody performed, which is the one thing
> this doc exists to prevent.
| Verified by | reading the code, not by exercising the app |

`7fe20a4` (admin Job Summary sticky nav) is presentation only: ids and
`scrollMarginTop` in `Admin.tsx`, no queue, endpoint or export touched. Carried
forward with no ledger change.

Uncommitted work in the working tree is **not** covered. Commit first, then log here.

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

## Two different failure classifiers now coexist

`staging` adds `isPermanentFailure` to `frontend/src/api/client.ts` alongside the
existing `isPermanentRejection` in `lib/queueFailure.ts`. **They do not classify the
same way.**

| Classifier | Permanent (op stops retrying) | Used by |
|---|---|---|
| `queueFailure.isPermanentRejection` | any 4xx **except** 401, 403, 408 | the 10 original queues: materials, BOL, RODS, LD day, incidents, off-job, office hours, job inventory, estimator, reimbursements |
| `client.isPermanentFailure` | **only** 400, 404, 409, 422 | `jobSetupStore`, `jobChecklistStore` |

The practical difference is **429**. The old rule treats a rate-limit response as
permanent and stops; the new rule treats it as transient and keeps retrying. Given
this app's history with Google Sheets quota, the new rule is the better one. Worth
deciding whether to converge the old queues onto it before promotion, rather than
shipping two rules that a successor has to discover.

## The long-distance day queue is still dead on staging

`ldDayStore.syncQueue()` still has no caller. The `online` handler at
`App.tsx:1878` now drains eleven queues and LD day is not among them. See
DATA_FLOW.md Deviations and Known defects in [RUNBOOKS.md](RUNBOOKS.md).

## The `online` / boot drain set has grown

`App.tsx:1878` (`online`) and the mount effect now also call `drainBugReports`,
`drainFeatureRequests`, `drainJobSetups`, `drainChecklistChecks`. All four are wired
to **both** boot and `online`, correctly.

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
| Classifier | `isPermanentFailure` (400/404/409/422) |

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

**This is the first thing in the system that checks hop 3 end to end.** Before it,
`sheet_sync_status` could only say which export *function* last failed, never which
record was lost.

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

Nothing outstanding as of `7fe20a4`.

Uncommitted work in the working tree is out of scope until it is committed. When it
lands, log it here in the same commit.
