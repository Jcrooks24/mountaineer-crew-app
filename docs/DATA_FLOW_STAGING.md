# Data Flow, staging delta

New and changed data exchange on `staging` that has **not been promoted to `main`**.
This is where dev work gets logged as it is built, and it is the checklist that gets
folded into [DATA_FLOW.md](DATA_FLOW.md) at promotion.

## Verified against

| | |
|---|---|
| Branch / commit | `staging` @ working tree, 2026-09-17 |
| Compared to | `main` @ `7681d5a` (the 2026-09-10 promotion) |
| Date verified | 2026-09-17 |

**Emptied at the 2026-09-10 promotion.** Everything that stood here was folded
into [DATA_FLOW.md](DATA_FLOW.md) under "Folded from staging at the 2026-09-10
promotion", the first promotion since 2026-08-13. This file is a skeleton again
and stays that way until the next piece of staging-only work is built.

Two things were deliberately **not** folded as settled, and they are below rather
than in DATA_FLOW.md because neither is a fact about the code: they are decisions
nobody has made. One correction was also made during the fold - the staging delta
described route code splitting as shipped, when it had been reverted on `main` in
`d952d64`; DATA_FLOW.md records the corrected state and why the revert happened.

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

**None.** The delta is empty: the 2026-09-10 promotion carried everything, and it
carried no new deviations. The four that were open during that batch (checklist
ticks and job headers deleted on permanent rejection, bug reports and feature
requests retried forever, two disagreeing failure classifiers) were all cleared
before promoting and are recorded in DATA_FLOW.md's failure policy.

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

---

# New data paths

## Availability palette (colorblind colors)

**Class A-shaped: local first, drained.** A crew member's colorblind palette for their
own Availability screens. See
[ADR 0050](decisions/0050-colorblind-availability-palettes-live-on-the-account-and-recolor-only-your-own-view.md).

| | |
|---|---|
| Trigger | tapping a palette on Profile, My Profile, Colorblind-friendly colors |
| Local write | `availability_palette_pending_v1:<user id>` (localStorage), at the tap, before any network |
| Applies | immediately, from the local key, on that user's own Availability screens |
| Transfer | `PATCH /api/auth/me` `{availability_palette}` from `chooseAvailabilityPalette`, then `drainAvailabilityPalette` on App.tsx boot and `online` |
| Drain guard | sends only while the signed-in user (`mm_user_cache_v1`) is the key's user id |
| On success | only when the response ECHOES the chosen palette (a backend without the column answers 200 and drops it): local key removed (unless re-picked in flight), profile passed to `setUser` |
| Storage blocked | no local copy possible: sent directly; if that also fails the pick is reverted and "Could not save" shown |
| Logout | key survives: outside the `mm_` / `crew_` prefixes `clearCrewState` wipes |
| Server | `users.availability_palette` (NOT NULL, default `default`), migration `t1v3x5z7b9d1` |
| Read back | `GET /api/auth/me` and every `UserResponse` |
| Sheet | none |

| Field | | Note |
|---|---|---|
| `availability_palette` | `[x]` | one of `default`, `red_green`, `deuteranopia`, `protanopia`, `tritanopia`, `monochrome`; anything else is a 422 on write |
| Sheet column | `[-]` | a display preference for one person's own screen, not job, time or pay data. No worksheet carries user settings, and admin views deliberately ignore it |

No new deviation.

---

# Changed behavior in existing domains

## Sheet plumbing - atomic top insert, and Re-send past a lying marker

**Sheet export path, all tabs that use `_write_rows_top`.** Destinations, triggers,
debounce, and per-field columns are unchanged from [DATA_FLOW.md](DATA_FLOW.md).
What changed is how a row is placed, and what the manual backfill does. See
[ADR 0049](decisions/0049-a-sheet-row-is-written-atomically-and-a-lying-marker-is-cleared-by-hand.md).

| | Before (`main`) | After (staging) |
|---|---|---|
| Top insert | `insertDimension`, then `values.update` into `A2`: two calls | one `batchUpdate`: `insertDimension` + `updateCells`, atomic |
| Tab lock | keyed deletes only | keyed deletes, top inserts, event note/timestamp cell writes, entered-by sweep |
| Cell typing | `valueInputOption=RAW` | `_cell`: text literal, numbers/booleans typed, empty stays empty (same result) |
| Audit: Bills, Materials with zero line items | counted missing, forever | not counted (owe the sheet no row) |
| `POST /api/admin/system-check/sheet-backfill` | re-drives; marker-gated exports skip | clears markers of ids a fresh audit reads absent, then re-drives |
| `POST /api/admin/system-check/sheet-backfill-all` | same | same as above, reusing its own audit |
| Auto-reconcile sweep (20 min) | re-drives; skips on marker | unchanged: never clears a marker |
| Response field | - | `markers_cleared` on both endpoints' per-sync result |

Marker tables cleared, per sync, only on the two manual endpoints:

| Sync | Table | Keys cleared | |
|---|---|---|---|
| Materials | `sheet_material_exports` | `<submission_id>:*` | `[x]` |
| Bills | `sheet_generic_exports`, kind `bill` | `<job_uuid>:*` (every saved version) | `[x]` |
| DVIRs | `sheet_generic_exports`, kind `dvir` | `<dvir_id>:*` (driver and mechanic rows) | `[x]` |
| Prior on-duty | `sheet_generic_exports`, kind `prior_hours` | `<statement_id>` | `[x]` |

No new deviation. The lost-row race is a deviation `main` carries (RUNBOOKS Known
defects), and this removes it.

## Photos - the local write moved from Save to pick

**Class E**, unchanged. The destination, the drain, the trigger and the Sheet
position are all exactly as
[DATA_FLOW.md](DATA_FLOW.md#photos) describes. What changed is **when the row
enters the local store**, and one field that the retry path was dropping.

See [ADR 0048](decisions/0048-a-photo-is-durable-when-it-is-taken-not-when-it-is-saved.md).

| | Before (`main`) | After (staging) |
|---|---|---|
| Row created | in `uploadOnePhoto`, on Save | in `onAddPhotoFiles`, at pick |
| Bytes read | `toQueuedPhoto(file)` at Save, unguarded | `toQueuedPhoto(file)` at pick, guarded |
| Row on a failed read | **none. The photo was destroyed** | no row, and the photo is not added to the tray, because there was nothing to read |
| `job_uuid` stamped | at Save, from the then-current selection | at pick |
| Tray contents | React state only | restored from stored drafts per job |
| Upload path on Save | `uploadOnePhoto`, a second copy of the uploader | `pushPhotoToDrive`, the same one the drain uses |

**The new local state.** A `photos` row may now carry `draft: true`, meaning the
bytes are on the device but the crew member has not pressed Save. A draft is
filtered out inside `listPhotosForJob`, so the saved gallery, `drainPendingPhotos`,
the estimator and the BOL cannot see it. `listDraftPhotosForJob` is the only reader,
and only the pending tray calls it. **No draft ever reaches the network**: Save is
what clears the flag, and the drain only ever sees cleared rows.

Per-field, for the row as it now enters the store at pick:

| Field | | Note |
|---|---|---|
| `id` | `[x]` | `crypto.randomUUID()`, and the same id the upload carries |
| `job_uuid` | `[x]` | stamped at pick. This is the fix for photos following a job switch |
| `created_at` | `[x]` | pick time, not save time, so the tray restores in capture order |
| `mime` | `[x]` | |
| `blob` | `[x]` | `QueuedPhoto` bytes per ADR 0017, read at pick |
| `draft` | `[x]` | new. `true` at pick, cleared on Save, never sent anywhere |
| `caption` | `[x]` | empty at pick, written on Save |
| `category` | `[x]` | written on Save. **Was `[ ]` on the retry path**: `pushPhotoToDrive` did not send it, so a photo tagged Before came back General after a failed first upload. It now sends the stored value |
| `incident_uuid` / `claim_number` | `[x]` | written on Save from the tray's attach target |
| `drive_status` / `drive_url` / `drive_error` | `[x]` | unchanged, owned by the uploader |

**Deletion is now a real delete.** Remove and Clear in the tray call
`deletePhoto` on the stored draft. Clear confirms first, because it destroys
stored image data rather than discarding a list. A failed delete is swallowed: the
row is already out of the tray, and orphaned bytes are wasteful rather than wrong.

## RODS - an unsigned day is refused, at three layers

**Class C-shaped, unchanged in shape.** The trigger, the queue, the drain and the
replace-style Sheet write are all exactly as [DATA_FLOW.md](DATA_FLOW.md) describes.
What changed is **which payloads the server will accept into `rods_logs` at all**,
and which rows any path will publish to the worksheet.

See [ADR 0052](decisions/0052-a-rods-row-is-always-signed-and-the-server-is-what-says-so.md).

Under V-5 in [COMPLIANCE_REFERENCE.md](COMPLIANCE_REFERENCE.md) the app's RODS is the
only record of duty status, with no paper log behind it, so every row in that table
is a certified federal record.

| | Before (`main`) | After (staging) |
|---|---|---|
| Unsigned submit to `POST /api/long-distance/rods` | accepted and stored | **refused, 400**, with a sentence the driver can act on |
| What made the rule hold | the client happened to submit only after signing | the server refuses |
| `export_rods_to_sheets` with an unsigned row | writes it to the worksheet | returns 0, writes nothing |
| `sheet_backfill._src_rods` | lists every row, signed or not | lists signed rows only |
| Router export gate | `if row.signature:` on both paths | gone; a submit is always signed by then |
| Signature assignment on update | conditional, `if body.signature is not None` | unconditional |

**Why three layers and not one.** Layer 1 covers the submit path only. Layers 2 and 3
are what stop a row that predates this rule, or arrives some future way, from reaching
the compliance copy. Before this change an unsigned row would have been reported by the
Sheet-sync health check as permanently missing from the worksheet, and the re-export
that exists to fix exactly that would have published an uncertified duty log
indistinguishable from a signed one.

**Failure class.** The 400 is a **permanent** rejection under `queueFailure.ts`, so a
refused day is marked failed, stays in the queue per ADR 0013, is skipped so it cannot
wedge the line, and is shown to the crew member. It is not one of the transient four
(401, 403, 408, 429), which would retry forever on a payload that can never fix itself.

Per-field: no field was added, removed or renamed. The table's shape is unchanged.

| Field | | Note |
|---|---|---|
| `signature` | `[x]` | now **required in practice**. Column stays nullable so pre-existing rows are readable, and so the refusal is our own 400 rather than a 422 schema dump |
| `signed_at` | `[x]` | set together with the signature, unconditionally |
| every other field | `[-]` | unchanged by this work; documented in DATA_FLOW.md |

**No in-progress day is stored server-side.** That remains true and is now a rule
rather than an accident. The drafts store for A-03 is not built; when it is, it gets
its own table and its own entry here, and it does **not** reuse this endpoint.

Guarded by `backend/scripts/verify_rods_signed_only.py`.

# New domains

Nothing yet.

# New background work

Nothing yet.

# Deviations new on staging

**Everything in this section is a promotion blocker** until fixed or waived in
writing. See "A failing staging flow blocks the merge" above.

Nothing yet.

# Open questions

Not defects. Decisions nobody has made yet, which someone should make **before**
these paths promote and become the way it has always been. Each needs a yes or a no,
not a fix.

> **WAIVED FOR THE 2026-09-10 PROMOTION, by the owner, explicitly.** Both promoted
> undecided. Their words: "bypass for now and merge to main. will have a more
> granular followup session this afternoon but we need to get this batch live."
> Recorded here because the protocol says silence is not a waiver and a bypass
> needs its reason in writing.
>
> **What the bypass costs.** These stop being open questions the moment they are
> in production: job setup becomes a domain admin reads only in-app, and bulletin
> images become a `LargeBinary` column with real history behind it. Neither gets
> harder to answer, but both get harder to change, and the bulletin one gets
> harder in proportion to how much the crew posts. They stay in this file, under
> this waiver, until they are ruled on rather than being quietly absorbed.

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

Nothing outstanding as of the 2026-09-17 RODS signed-only change.

Uncommitted work in the working tree is out of scope until it is committed. When it
lands, log it here in the same commit.
