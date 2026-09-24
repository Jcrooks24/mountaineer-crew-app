# Compliance reference

**Read this before changing any code listed in Part 1.** It exists so that the
question "does this rule even reach us, and what does this field do for it" is
answered once and read many times, instead of being re-derived from scratch every
time compliance comes up.

This file is in two parts, and they age differently:

| Part | What it is | Churn |
|---|---|---|
| **[Part 1: Regression guard](#part-1-regression-guard)** | Code surface to record to invariant. What must not break. | Slow. Changes when the code changes. |
| **[Part 2: Open gap ledger](#part-2-open-gap-ledger)** | Findings from the 2026-09 gap audit, and where each stands. | Fast. Items close and leave. |

**Part 1 verified against:** `staging` @ `b920b93`, 2026-09-17. Registry and rental
section re-verified 2026-09-24 for ADR 0055.
**Part 2 last ruled on:** 2026-09-17. V-5 answered; B-14, B-05 and B-19 closed; A-03 corrected and re-scoped; B-06 partly addressed.

A stale date on one part says nothing about the other. Update them independently.

---

## What this document is not

**It is not a statement of law, and nothing in it may be relied on as one.**

Regulations are cited here as pointers, so that a reader knows which text to go
read. They are not reproduced, summarized as fact, or interpreted. The CFR is not
vendored into this repo on purpose ([ADR 0051](decisions/0051-the-compliance-reference-maps-code-to-obligations-and-vendors-no-cfr.md)):
a frozen copy goes stale silently while looking authoritative, which is exactly how
an expired exemption notice ended up being cited as operative during the 2026-09
audit.

Every claim below carries one of three marks. **Do not promote a claim from one
tier to a higher one without doing the work that tier requires.**

| Mark | Means | How to check it |
|---|---|---|
| `[code]` | Verified by reading the source at the stated commit. | Read the code. Cheap and certain. |
| `[owner]` | An operational fact the owner stated. True until they say otherwise. | Ask. |
| `[reg]` | A regulatory claim from an outside source, with the date it was checked. **Never verified by this repo.** | Read current text at [ecfr.gov](https://www.ecfr.gov). |

A `[reg]` mark is a research lead, not an answer. If a decision turns on one,
check the current text first and update the date here.

---

## Applicability gate

**Almost nothing below applies unconditionally. Check this first.**

Federal safety regulations reach a vehicle only above a weight threshold, and reach
this company only on certain trips. Getting these wrong makes a finding either
irrelevant or urgent, and the 2026-09 audit spent three revisions establishing them.

| # | Fact | Mark | Consequence if it flips |
|---|---|---|---|
| V-1 | Federal safety rules reach a vehicle at 10,001 lbs GVWR or more, or GCWR with a towed unit. | `[reg]` 49 CFR 390.5, checked 2026-09-16 | Below it, no DVIR, no RODS, no DQ file for that trip. |
| V-2 | Long-distance trips run in **rented** trucks. | `[owner]` 2026-09-16 | Rental status drives DQ, DVIR, and registry findings. |
| V-3 | Owned trucks operate **intrastate only**. | `[owner]` 2026-09-16 | If an owned truck crosses a state line, every interstate obligation reaches it too. Montana applies intrastate FMCSRs at 26,001 lbs or more. `[reg]` Getting Started p.5, p.13, p.17, p.40 |
| V-4 | No driver holds a CDL, and no CDL-required operation is run. | `[owner]` 2026-09-16 | Makes 26,000 lbs a hard ceiling on any rental. Also gates drug and alcohol testing applicability. `[reg]` 49 CFR 383.5, 383.91, 382.103, checked 2026-09-16 |
| V-5 | **The app's RODS is the record of duty status. Always.** No paper log is kept alongside it. | `[owner]` 2026-09-17 | Resolved. A-03, A-04, A-05, B-08, B-10, B-11 and B-14 are **live compliance findings**, not internal tooling. Every duty-status guarantee in this file is load-bearing: there is no paper copy to fall back on. If paper is ever reintroduced, re-rate all seven. |
| V-6 | Part 375 consumer protections reach only an **individual shipper** who pays their own charges. Employer-paid relocations and commercial freight are outside it. | `[reg]` 49 CFR 375.103, checked 2026-09-16 | Decides whether the weight-ticket finding applies at all. |

**Vendored source:** the Montana booklet these cite lives at
[business/MONTANA-GETTING-STARTED-2025.md](business/MONTANA-GETTING-STARTED-2025.md),
with the PDF beside it. Page citations are PDF page index.

---

# Part 1: Regression guard

One section per code surface. Each says what record the code produces, what must
not regress, and what a violation would look like in the field.

**How to use it:** find the file you are about to edit. If it is here, read its
section before you change anything in it. If your change touches an invariant, that
is not automatically a refusal, it is a reason to raise it in `/intake` before
building.

---

## `backend/app/routers/dvir.py`, `backend/app/db/models/dvir.py`, `frontend/src/pages/DVIR.tsx`

**Produces:** the Driver Vehicle Inspection Report. `[reg]` 49 CFR 396.11, 396.13,
checked 2026-09-16. See also Getting Started p.40 to p.41.

**Applicability:** V-1. A truck under 10,001 lbs GVWR needs none of this.

### Invariants

**`defect_notes` is mandatory whenever any defect is checked.** `[code]` The form
blocks submission with "Describe the defect(s)". This single field is what carries
the actual defect description into the record, because the 24 inspection items are
categories, not descriptions. It is stored, exported to the DVIRs worksheet as its
own column, shown to the next driver during the prior-report review, and included in
the remote mechanic's email. **Making this optional would strip the defect
description out of a federal record and leave only a category tag.** The 2026-09
audit raised the coarse category naming as a gap and then closed it specifically
because this field exists and is required.

**The prior-report review blocks submission.** `[code]` When a previous DVIR exists
for the selected unit, the driver must tick a review confirmation or the form
refuses. This is the §396.13 review, enforced rather than prompted. Softening it to
a dismissible prompt removes the enforcement.

**An unsigned defect locks the vehicle out.** `[code]` When the last report for a
unit carries defects with no mechanic signature, the DVIR form will not open for
that unit at all. This is stricter than the regulation requires and is deliberate.
It also means the lockout is keyed to a **name string**, see the registry section
below.

**Export is two-phase and must stay two-phase.** `[code]` The report exports on
driver submit and again on mechanic sign-off, as two rows distinguished by `phase`.
Collapsing this into one row, or making the mechanic row update the driver row in
place, destroys the pre-repair state. That state is the evidence that a defect
existed before it was signed off.

**Mechanic review is required only when defects are noted.** `[code]` A satisfactory
report auto-clears. Do not add a blanket review requirement without asking: it would
put every clean inspection into the queue.

### Known weaknesses, not yet changed

- The vehicle field is a **closed select** built from the fleet registry, with no
  free-text option. `[code]` A truck absent from the registry cannot have a DVIR
  filed for it at all. See B-05 in Part 2.
- `odometer` is required by the form and **nullable** in the schema. `[code]` No
  regulation requires it `[reg]`, so this is data quality only.
- "Air Brakes" is the only brake item among the 24, and its description names
  air-only components. `[code]` See B-18.

---

## `backend/app/routers/long_distance.py`, `backend/app/db/models/long_distance.py`, `frontend/src/lib/rodsStore.ts`, `frontend/src/components/RodsRecorder.tsx`, `RodsSignoff.tsx`

**Produces:** Record of Duty Status, and the Prior On-Duty Hours Statement.
`[reg]` 49 CFR 395.8 and 395.8(j)(2), checked 2026-09-16. See also Getting Started p.31.

**Applicability:** V-1. **V-5 is resolved: the app is the record of duty status, with
no paper log alongside it** `[owner]` 2026-09-17. Every guarantee below is therefore
load-bearing. A duty record this app loses is lost, not recoverable from a paper copy.

### Invariants

**Every row in `rods_logs` is a signed, certified day, and the server enforces it.**
`[code]` `[ADR 0052]` An unsigned submit is refused with a 400, the export refuses to
publish an unsigned row, and the Sheet backfill does not list one as publishable.
Three layers, because layer 1 covers only the submit path while 2 and 3 stop a row
that predates the rule or arrives some future way. Guarded by
`backend/scripts/verify_rods_signed_only.py`.

**Do not re-open this endpoint to unsigned payloads to build in-progress autosave.**
That is the obvious way to implement the draft store (A-03) and it is the one thing
this rule exists to prevent: the backfill would report every in-progress day as
missing from the Sheet, and the re-export built to fix that would publish
uncertified duty logs into the compliance copy, indistinguishable from signed ones.
Under V-5 there is no paper log to check them against. Drafts get their own table.

**The RODS Sheet row is replace-style, one row per driver-day.** `[code]` Re-submitting
deletes the existing row and rewrites it. Changing this to an append would produce
duplicate duty records for the same day, which is worse than the current lack of
version history.

**`logged_at` is immutable and must stay immutable.** `[code]` Events carry an
editable `timestamp` that drives the duty log, and a `logged_at` set from device time
at insert that is never updated. The model calls it the audit trail for spotting
back-dated entries, and both columns export to the Events worksheet. **Making
`logged_at` writable removes the only evidence that a duty time was edited.**

**The driver on a RODS is the named driver, not the submitter.** `[code]` A passenger
may log on the driver's behalf, so the row is keyed to the typed name matched against
user records. This is deliberate. It is also fragile, see A-05.

**PODS auto-fill is a convenience over a legal attestation.** `[code]` `GET /api/hours/daily`
pre-fills all seven prior days and the last-24 figure from the driver's own logged
job, off-job, and office hours, with a banner saying so. The driver still signs. The
auto-fill **cannot see hours worked for another employer**, so the pre-filled number
can be confidently wrong. Do not remove the banner, and do not make the fields
read-only: the driver's ability to correct it is the only thing standing between the
auto-fill and a false statement.

**A PODS on file gates BOL origin signing.** `[code]` Removing that gate removes the
only enforcement point in the long-distance flow.

### Known weaknesses, not yet changed

- An unsigned day's **trip header** exists only in browser storage on one device.
  `[code]` See A-03. **The duty timeline is not at risk**: `changes` is derived from
  `DUTY` events (`rodsStore.ts:194`), which ride the normal offline event queue to
  the server and the Events tab, so a replacement device rebuilds the timeline from
  `mergedLog`. What a lost phone destroys is the header (co-driver, vehicle, trailer,
  origin, destination, total miles, shipping documents, carrier, main office address,
  remarks) and the `rods_id`. Several of those are required content `[reg]` 395.8(f),
  checked 2026-09-16.
- No view shows the current day plus the prior seven. `[code]` See A-04.
- "Passenger" is stored and exported as `sleeper`. `[code]` See A-01. **Do not
  "fix" the label without deciding what the stored value should be**; changing the
  stored value changes historical records.

---

## `backend/app/routers/dq.py`, `backend/app/core/dq_doc_types.py`, `backend/app/db/models/dq_document.py`

**Produces:** the Driver Qualification file. `[reg]` 49 CFR Part 391, checked 2026-09-16.

**Applicability:** V-1 and V-2. A driver who only drives owned trucks intrastate is
outside Part 391 under V-3.

**Live config:** the document catalogue is admin-editable and stored in the database.
The source only shows what a fresh install seeds. **Read the running catalogue before
concluding a document type is missing.** Three findings in Part 2 depend on this.

### Invariants

**Replacement is destructive and deliberate.** `[code]` One row per driver per
document type, enforced by a unique constraint; a new upload overwrites the row and
deletes the previous Drive file by ID. This is the "current copy only" design.
`[reg]` 391.51(d) appears to require retaining superseded MVRs, review notes, and
medical certificates for 3 years from execution, checked 2026-09-16, which this
design cannot satisfy. **If you add retention, do not do it by disabling the delete**:
the unique constraint and the folder-by-ID addressing both assume one current row.
See A-02.

**The driver folder is addressed by stored ID, not by name.** `[code]` This is what
keeps a driver who changes their name on one compliance folder instead of silently
starting a second. `[ADR 0036]` Do not revert to name resolution.

**A non-driver has no DQ obligation and the reminder stays silent for them.** `[code]`
Deliberate: chasing non-drivers for a medical card trains everyone to ignore the
reminder.

**Files here are PII.** `[code]` Medical cards and employment applications. The Drive
folder is environment-split by `DRIVE_DOCUMENTS_FOLDER_NAME` so staging test uploads
cannot land among real drivers' documents. **Do not remove that split**, and do not
resolve the folder by a hardcoded name.

### Known weaknesses, not yet changed

- The "driver" tag match is a case-insensitive **substring** test, so it cannot
  exclude: a tag named "Non-Driver" matches. `[code]` See B-03.
- No expiration is tracked for the Medical Examiner's Certificate; `renewal_days`
  is null, so it is filed-or-missing forever. `[code]` See B-01.

---

## `backend/app/core/vehicle_units.py`, `backend/app/core/rental_trucks.py`, the fleet registry and rental truck records

**Produces:** no regulated record itself, but **gates** the DVIR. `[code]`

### Invariants

**A truck must be in the registry before a DVIR can be filed for it.** `[code]` The
DVIR vehicle field is a closed select fed from this registry. This is the highest
consequence property of an otherwise unremarkable config list, and it is not
obvious from reading either file alone.

**Units are seeded name-only, with every numeric field null.** `[code]` Deliberate,
so no stale hardcoded weight can drift.

**A `is_rental` entry is a placeholder, and a rental truck RECORD says which truck
it was.** `[code]` `[ADR 0053, amended by 0055]` A rental entry stands for whatever was
hired. The actual truck (company, agreement number, **plate**, GVWR) is a
`rental_trucks` record, entered at the DVIR or the job header, and linked to every job
it serves. The plate seeds the RODS and BOL vehicle, and the DVIR **snapshots** the
record's details onto its own row rather than pointing at the record, so a report stays
true to the truck it inspected even if the record is edited later.

**One physical truck is one live record.** `[code]` `[ADR 0055]` A new entry whose
plate matches a truck not yet returned joins that record. A later write only fills
blank details, never blanks one. A header save never unlinks a truck from its job.
**The plate cannot change once an inspection is filed against the truck**, because
the review and lockout below key on it: changing it would split one truck's inspection
history in two.

**The prior-report review and the out-of-service lockout are scoped to the actual
truck.** `[code]` They key on `(vehicle_number, vehicle_identifier)` for a rental.
**Do not drop that second filter.** It looks redundant and removing it silently
re-merges every rental into one shared inspection history: a driver gets locked out
by a defect on a truck the company no longer has, or waved through on a clean report
for a different truck. Nothing errors either way. A rental with no identifier gets
**no** prior report rather than another rental's. Owned units are untouched.

**A rental DVIR without a plate is refused**, server-side, because the report would
not identify the vehicle and could never be scoped afterwards. `[code]`

**The GVWR on a rental job is the only place the app records whether a trip was over
the federal threshold at all.** `[code]` See V-1. Owned units still hold no GVWR
unless an admin has entered one.

---

## `backend/app/routers/bol.py`, `backend/app/routers/job_setup.py`, `frontend/src/components/BillOfLadingForm.tsx`, `frontend/src/lib/bolPdf.ts`

**Produces:** the Bill of Lading for interstate moves. `[reg]` 49 CFR 375.505,
checked 2026-09-16.

**Applicability:** V-6. Part 375 reaches individual shippers only.

### Invariants

**Writes are upserts by `bol_id`, and the Sheet export is replace-style.** `[code]`
The same BOL is re-submitted as photos finish uploading and as signatures land.
An append would duplicate a legal document.

**The carrier block is read live from admin settings, not hardcoded.** `[code]` It
carries the USDOT and MC numbers that print on the document. It was hardcoded in the
frontend once; do not put it back.

**Signed PDFs go to a Drive folder addressed by ID.** `[code]` `DRIVE_BOL_FOLDER_ID`
is load-bearing: when it was unset, staging resolved the signed-BOL folder **by name**
to the same physical folder production uses, and uploads replace content in place by
file ID, so staging could overwrite production's signed legal documents. `[ADR 0020]`
**Never reintroduce name-based resolution for this folder.**

**Origin signing is gated on a PODS being on file.** `[code]`

---

## `backend/app/integrations/sheets_export.py`

**Produces:** the office's record of resort for every instrument above.

### Invariants

**A row is written atomically, and the exported marker means the row is really
there.** `[ADR 0049]` A marker written before the row is a lying marker: the record
looks exported and is absent.

**Each instrument's worksheet is environment-split by its own `SHEETS_*_TAB` env
var.** `[code]` `[ADR 0003]` Hardcoding a worksheet name puts staging test data into
the production compliance record. This has a dedicated System Check panel; when you
add an instrument, add its env var to the registry so an unset value is flagged
rather than silently defaulting to the production tab.

**Signature blobs are deferred out of list queries.** `[code]` Not a compliance
property, but the DVIR list defers both base64 signature columns and computes
signed-ness in SQL. Undoing that pulls tens of MB into a 512 MB worker. `[ADR 0002]`

---

## `backend/app/core/job_checklists.py`, `backend/app/routers/job_checklist.py`

**Produces:** an advisory close-out checklist. **It blocks nothing.** `[code]`

**Live config:** admin-editable, stored in the database. The source shows seeds only.

Auto-ticked items read real records by `job_uuid`: both DVIRs, the BOL signatures,
inventory, weight, PODS, and RODS. The DOT-markings item is manual. Treat a tick as
"a record exists," never as "the record is correct."

---

# Part 2: Open gap ledger

Findings from the 2026-09 gap audit. IDs match the audit's Revision 6 and 7 so the
two documents can be read side by side.

**Status meanings:** `open` needs a decision. `accepted` means the owner has ruled
that it stays as-is. `closed` means fixed or determined to be a non-issue.

**No individual item has been ruled on yet.** The audit is complete; the rulings are not.

**V-5 was answered on 2026-09-17**: the app's RODS is the record of duty status, always,
with no paper log alongside it. The seven items that were conditional on it are now
marked **live**. Four items remain gated on a read of the running admin configuration.

| ID | Finding | Applies if | Mark | Status |
|---|---|---|---|---|
| A-01 | Passenger time stored and exported as sleeper berth on trucks with no berth. | V-1, **live** | `[code]` | open |
| A-02 | DQ replacement deletes the prior copy; no retention of superseded documents. | V-1, V-2 | `[code]` | open |
| A-03 | An in-progress RODS day's **trip header** exists only in browser storage on one phone. The duty timeline itself is safe, derived from synced `DUTY` events. Corrected 2026-09-17. | **live** | `[code]` | open |
| A-04 | No view of the current day plus the prior seven. | V-1, **live** | `[code]` | open |
| A-05 | A typed driver name that does not match a user exactly files the log under the submitter, silently. | V-1, **live** | `[code]` | open |
| A-06 | No National Registry verification note type. | live config | `[code]` | open |
| A-07 | Catalogue omits pre-hire MVR, safety performance history inquiry, investigation history file, annual MVR, annual review note. | live config | `[code]` | open |
| A-09 | No weight tickets: no tare, gross, ticket image, or scale identity. | V-6 | `[code]` | open |
| B-01 | Medical certificate expiration not tracked. | V-1, V-2 | `[code]` | open |
| B-02 | HOS limits not computed. PODS auto-fill cannot see other-employer hours, and the offline fallback to blank is silent. | V-1 | `[code]` | open |
| B-03 | Driver tag substring match cannot exclude; "Non-Driver" matches. | live config | `[code]` | open |
| B-04 | DVIR and PODS cannot be filed offline. | V-1 | `[code]` | open |
| B-05 | Nothing prompts registering a rental; a truck absent from the registry cannot have a DVIR filed at all. | V-1, V-2 | `[code]` | **CLOSED 2026-09-17**, accepted by design. A flagged rental placeholder plus a per-job plate is the supported path ([ADR 0053](decisions/0053-a-rental-is-a-placeholder-and-the-job-records-which-truck-it-was.md)). Drivers still cannot write the registry, and no longer need to. |
| B-07 | Incident model has no accident-trigger fields and no register link. | V-1 | `[code]` | open |
| B-08 | No admin review screen for RODS or PODS. | **live** | `[code]` | open |
| B-09 | App still requires the annual certification of violations. | live config, `[reg]` 391.27 reserved, checked 2026-09-16 | mixed | open |
| B-10 | RODS resubmission overwrites the Sheet row with no version history. | **live** | `[code]` | open |
| B-11 | Immutable `logged_at` is exported to the Events tab but never joined to the RODS record it qualifies. | **live** | `[code]` | open |
| B-12 | Remote mechanic certification rests on possessing an emailed link and a typed name, for 14 days. | unconfirmed | `[code]` | open |
| B-13 | Loaded weight stored as free text, not a number. | V-6 | `[code]` | open |
| B-14 | The signed-RODS guarantee is enforced by the client, not the server. | **live** | `[code]` | **CLOSED 2026-09-17**, fixed. Three server layers refuse an unsigned day ([ADR 0052](decisions/0052-a-rods-row-is-always-signed-and-the-server-is-what-says-so.md)). Invariant moved into Part 1. |
| B-15 | DVIR odometer required by the form, nullable in the database. | none | `[code]` | open, data quality only |
| B-16 | Emergency equipment is a checkbox attestation, not evidence. | V-1 | `[code]` | open |
| B-18 | "Air Brakes" is the only brake item, and its description names air-only components, so a hydraulic-brake driver may reasonably skip it. Under-reporting risk, not a record gap. | V-1 | `[code]` | open |
| B-19 | A registry entry is a reusable name string with no link to a VIN, plate or rental agreement, so every rental shared one inspection history. **This was current practice, not a risk.** | V-1, V-2 | `[code]` | **CLOSED 2026-09-17**, fixed. Identity captured per job, snapshot onto the DVIR, review and lockout scoped to the truck ([ADR 0053](decisions/0053-a-rental-is-a-placeholder-and-the-job-records-which-truck-it-was.md)). |

**Outside the app**, tracked in the audit and not here: the TRALA exemption notice
and its rental conditions, roadside inspection report handling, hired-auto liability
evidence, Part 375 disclosure delivery, and the accident register's structure. Those
are business-process items with no code surface.

**Closed during the audit:** the DVIR defect-category finding (A-08), because
`defect_notes` is mandatory and exported. The "no edit trail" finding, because
`logged_at` is immutable. The "checklist ticks on an unsigned autosave" finding,
because the client only submits signed days. The "self-reported PODS" finding,
because it auto-fills.

---

## Maintaining this file

- **Editing a Part 1 surface?** Update its section in the same commit, and bump the
  Part 1 date. This is the same rule `DATA_FLOW_STAGING.md` carries.
- **Adding a compliance-bearing surface?** Give it a section. A record with no entry
  here is a record nobody knows is regulated.
- **Ruling on a Part 2 item?** Change its status and bump the Part 2 date. When an
  item closes because code changed, move what remains into the relevant Part 1
  section as an invariant, so the protection outlives the ledger entry.
- **A `[reg]` claim older than a year** should be re-checked or struck. An undated
  regulatory claim is not usable.
- **Never** add CFR text to this repo. [ADR 0051](decisions/0051-the-compliance-reference-maps-code-to-obligations-and-vendors-no-cfr.md)
  says why, and the expired-notice incident is the reason it says it.
