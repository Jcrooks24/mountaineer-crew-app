# Feature inventory: definition and method

**Inferred feature definition.** A feature is a distinct user-facing tool or
surface that one user class uses to do one job, at the same grain as the PRD's
own capability entries. PRD.md's capabilities table (docs/PRD.md, "The
capabilities", rows 1-14) names entries like row 3, "Time capture siblings
(off-job, office, availability, LD workday)", and row 7, "Customer paperwork
(BOL, inventory, signature, documents)" - the parenthesized items inside each
capability are the features; the capability itself is a grouping, not a
feature. Below that grain (a new button, a filter, a column, a setting, a bug
fix, a restyle, or a config toggle on an existing tool) is an enhancement of a
feature, not a new one. A patch-note item was counted as a new feature only
when it named a surface nobody could reach before (a new page, a new tab, a
new backend router with its own endpoints, a new admin queue); an item that
extended, fixed, or reconfigured something already reachable was counted as an
enhancement or a fix, per the patch note's own section heading where given
("UPGRADES TO TOOLS YOU ALREADY USE", "FIXED", "BEHIND THE SCENES").

**Method.** PRD.md's 14 capabilities first; frontend/src/pages,
frontend/src/components, and backend/app/routers next, to find every surface
that exists; docs/ADMIN_GUIDE.md and docs/CREW_GUIDE.md to confirm user-facing
naming and catch anything the file layout alone would miss; then
patch-notes-v1.8 (recovered from git history, commit 24099d4, since deleted
from the working tree), v2.3, and v2.4 to fill in items not otherwise
documented and to classify each patch-note item as new-feature vs. enhancement
vs. fix. Dates: `first_commit` is the earliest `git log --diff-filter=A`
(or content-search `-S`, where a feature was split out of another file later
and refactor renames would have given a misleadingly late date) event for the
feature's representative file(s); `first_on_staging_date` is that commit's
authored date; `first_on_main_date` is looked up from
`the reach-main table built for the ledger`'s reached-main column for that short sha.

## Counts per capability (55 features, 1 removed, 54 live)

| # | Capability | Features |
|---|---|---|
| 1 | Auth and account | 4 |
| 2 | Job capture and timeline | 7 |
| 3 | Time capture siblings (off-job, office, availability, LD workday) | 6 |
| 4 | Long-distance mode | 4 |
| 5 | Vehicle and DVIR | 4 |
| 6 | Money out (reimbursements, materials) | 3 |
| 7 | Customer paperwork (BOL, inventory, signature, documents) | 3 |
| 8 | Photos and incidents | 3 |
| 9 | Estimating | 2 (1 removed) |
| 10 | Payroll and close-out | 7 |
| 11 | Roster, skills, DQ files | 5 |
| 12 | Admin job summary and notes | 2 |
| 13 | Crew comms (bulletin, directory, patch notes) | 3 |
| 14 | Feedback intake (bug reports, feature requests) | 2 |

Every one of the 55 features reached `main` at some point (the reach_main
lookup returned a date, never `NOT_ON_MAIN`, for any representative commit
used here) - including the one removed feature, which was promoted and pulled
on the same day per its ADR.

## Borderline calls made

- **Capability 7's literal 4-way reading ("BOL, inventory, signature,
  documents") was not followed for "signature".** Signature capture
  (SignaturePad.tsx) is a component embedded in the BOL and DVIR signing
  flows, not its own surface a user class visits to do a distinct job, so it
  was folded into the Digital BOL feature rather than counted separately.
  Capability 7 therefore has 3 features (BOL, Actual inventory, Document
  Library), not 4.
- **"Job setup" (JobSetupPanel.tsx / job_setup.py, first shipped 2026-08-03)
  was not given its own feature row.** It is a UI reorganization of two
  already-existing capture points - the LD day-plan tile (capability 3) and
  the BOL's federally-required detail cards (capability 7, shipped inside
  BillOfLadingForm.tsx from 2026-07-01) - not a new job a user does. The
  v2.4 patch-note line "You can change today's activities straight from the
  Job setup tile" was classified as an enhancement of LD workday, not a new
  feature.
- **"Close-out" was placed under capability 10 (Payroll and close-out), not
  capability 2 (Job capture and timeline)**, even though the crew fills it
  out inside the Job Report. The component is literally named
  `CloseoutStepper`, and capability 10's own name pairs "Payroll and
  close-out," which reads as the office's naming of this exact tool as the
  input to its close-out/finalize process.
- **"Month Schedule View" (admin availability grid overlaid with scheduled
  jobs) was placed under capability 3 (Time capture siblings) rather than
  capability 11 (Roster)**, even though it lives in Admin.tsx's Employees
  tab alongside roster management. It is fundamentally a view of
  availability data, which is a capability-3 feature; roster management
  (tags, unlocks, promote/activate) stayed split between capabilities 1 and
  11 by function rather than by tab.
- **"Skill ratings on the Job Report" and "Skills registry" were counted as
  two separate features** under capability 11, even though they are two
  views of the same `skills.py` router and shipped in the same commit
  (cb6a1ae / c25917a, both 2026-07-06): the registry is an admin
  configuration surface (define skills, mark core/job-specific, build the
  matrix), the rating is a crew/rater-facing action on a different page
  (JobReport.tsx). Same reasoning split "Reimbursement / Expense requests"
  (capability 6, crew submission + admin approve/reject on one page) as a
  single feature, since both sides share one surface with no separately
  named admin tool - unlike DVIR, where "DVIR Review queue" got its own row
  because ADMIN_GUIDE and the code both name it as a distinct tab.
- **"Furniture/Materials Catalogue" was placed under capability 6 (Money out)
  rather than split across capabilities 6/7/9**, even though the same
  catalogue feeds Materials, the BOL item picker, and the Estimator. It is
  one shared admin surface (`furniture_catalog.py`, CSV import/export), so it
  was counted once rather than three times, filed where its router name and
  the "materials" wording in capability 6 point.
- **"Employee Hours editor" was counted as its own feature** distinct from
  "Job Report," even though it is a card inside the same JobReport.tsx page,
  because it is named as its own tool in CREW_GUIDE (section 7.4) and
  ADMIN_GUIDE, and it is the thing Payroll and Job Summary both read from
  directly.
- **Bulletin's `source` list omits "guide"**: neither ADMIN_GUIDE.md nor
  CREW_GUIDE.md mentions "Bulletin" anywhere (checked directly), even though
  both guides carry a "Version 2.3 / July 2026" header and Bulletin shipped
  2026-08-05, after that header's nominal date. The guides are stale on this
  one point; PRD.md capability 13 ("bulletin, directory, patch notes") and
  the code are the only sources used.
- **The estimate-to-job link / estimated-vs-actual comparison (ADR 0019)**
  was kept as its own row per the task's explicit instruction, with
  `removed_date` 2026-07-16. `first_on_main_date` and `removed_date` land on
  the same day: the reach-main table built for the ledger shows the adding commit (0855f45,
  authored 2026-07-06) reached main 2026-07-16, the same day the owner's
  correction (2e9ae1c) was authored, so its live window on `main` may have
  been very short or zero depending on merge order within that day.

## Patch-note items classified as enhancement or fix, not a new feature

- **v2.3, "UPGRADES TO TOOLS YOU ALREADY USE" (entire section)**: Job Report's
  job-type + truck-fullness capture, roster-picked employee hours, Invoice
  builder's auto-fill additions, BOL's cross-device sync / resend
  reconciliation / present-or-send card / federal detail cards / pickup-delivery
  address printing, Estimator's site photos + richer catalogue, and Admin
  month schedule's rolling-30-day view + read-only-by-default toggle. All of
  these extend a feature that already existed (Job Report, Invoice builder,
  BOL, Estimator, Month Schedule View respectively) rather than opening a
  surface nobody could reach before.
- **v2.3, "BEHIND THE SCENES" (entire section)**: offline-queue retry
  behavior, photo storage durability, cross-login draft preservation, server
  performance hardening, and Sheet re-send reconciliation are reliability
  work on existing features, not new ones.
- **v2.4, "FIXED - THINGS THAT WERE NOT WORKING" (entire section)**: the
  close-out cause-question bugs, BOL print/email/sign failures, offline-queue
  drain gaps for RODS/drive-days, the >8MB upload cap, job-draft loss on
  forced logout, DVIR "only if a truck is on the job" gating, and the
  truck-line 1-hour billing bug are all fixes to features already counted
  elsewhere (Close-out, BOL, Timeline queues, DVIR, Bill calculator).
- **v2.4, "NEW - FOR THE CREW"**: "Internal rearrange" as a day-plan option
  and "change today's activities from the Job setup tile" are both
  enhancements of the existing LD workday day-plan feature, not new tools.
  "Scale weight has its own spot on the RODS tile" is an enhancement of the
  RODS recorder. "Tap a field title for help" (FieldHelp.tsx) is UI polish on
  BOL/job-setup fields, not a distinct surface. "Bill lines are checked one
  at a time" and "type a number into a truck line by hand" are enhancements
  of the Bill calculator, already counted as its own feature.
- **v2.4, "FOR THE OFFICE"**: "A rolling payroll notes field that saves
  properly" (PayrollNotes.tsx) is an enhancement of Payroll, not a separate
  feature, since the notes field itself is not a distinct job a user does -
  it is a field on the Payroll page. "Payroll periods now write to a Payroll
  worksheet in the Sheet" is an export-path change (infrastructure), not a
  user-facing feature. "Payroll finalize is stricter" is a rule change on the
  existing Payroll feature.
- **v1.8, "QUALITY-OF-LIFE" (entire section)**: confetti on submit,
  autocorrect fix, star-rating mobile layout, estimated-hours labeling,
  faster map load, contacts pill, collapsible employee lists, furniture
  export polish, and clearer help text are all polish on existing features.
- **v1.8, "WORKFLOW CHANGES"**: skill-rating gatekeeping (who can rate),
  roster-only employee hours, and pausing local-job inventory logging are
  rule/config changes to features already counted (Skill ratings, Employee
  Hours editor, Actual inventory), not new features.
- **Company information (Settings)**, mentioned as NEW in v2.3, was treated
  as a settings field (company name/address/DOT/MC feeding the BOL and
  wherever the company address prints), not a standalone feature - it has no
  job of its own beyond configuring an existing surface (BOL, Settings).
- **Sheet-sync System Check / Sheet Backfill** (v2.3 NEW, and referenced
  throughout ADMIN_GUIDE Advanced Settings) is a genuine distinct admin tool,
  but it does not map to any of the PRD's 14 named capabilities (it is an
  operational/ops-health surface, not a job-facing or crew-facing tool), so
  it was left out of features.json rather than force-fit into one of the 14
  rows. Noted here so the gap is visible rather than silent.
