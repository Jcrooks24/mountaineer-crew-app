# User profiles

Who actually uses this app, under what conditions, for what. One profile per
user class, each one describing a **real-world use**, not a permission set.

This doc exists so that "which user class does this change touch, and how?" has
a place to be answered once instead of re-guessed every time. It is built and
corrected by the third question of
[INTAKE_PROTOCOL.md](INTAKE_PROTOCOL.md): every change that touches a class
updates that class here, in the same commit.

**Permissions are not a profile.** `role == "admin"` says what the server will
allow. It does not say that the person holding it is standing in an office on a
Friday afternoon trying to close payroll before the bank cuts off. The second
fact is the one that decides whether a feature is right.

## How to read the confidence marks

- **[confirmed]** The owner stated this, in a session, on the date given. It can
  be relied on and quoted into an ADR.
- **[inferred]** Derived from [docs/business/SOP-2026.md](business/SOP-2026.md),
  from the code, or from how the app is built. Plausible, not confirmed. **An
  inferred line is not evidence.** When a change turns on one, that is an intake
  question, not an assumption to build on.

A `[confirmed]` line is part of the checked record. A later answer that conflicts
with one triggers the contradiction check in
[INTAKE_PROTOCOL.md](INTAKE_PROTOCOL.md): both lines are surfaced with their
dates, the work stops, and on the owner's call the old line moves to a dated
**Superseded** note inside that same profile rather than being deleted.

Everything below starts as `[inferred]`, because this doc was seeded from the
SOP and the code before the first intake ran. Confirming these is what the early
intake rounds will mostly be doing.

---

## 1. Mover (Tier 1, 2, 3)

App role: `crew`. The largest class, and the one with the least patience for the
app.

- **Who** [inferred]: field crew paid hourly ($27.50 / $30 / $32.50 by tier, SOP
  section 1.2), progressing by experience checklist and tier slips.
- **Device and conditions** [inferred]: personal phone, one hand, standing on a
  driveway or in a truck. Frequently no signal. Gloves, weather, and a customer
  watching. Every second in the app is a second not moving furniture, and they
  are being paid for the latter.
- **Uses it for** [inferred]: clocking their own time on a job, off-job hours,
  availability, photos, incidents, bulletin, their own DQ file and profile.
- **Never touches** [inferred]: payroll, close-out, the roster, anything under
  Admin, and skill ratings unless designated a rater.
- **What breaks their day** [inferred]: an action that silently needed signal, a
  screen that lost what they typed, being paid wrong because a tap did not
  register, or not knowing which of two tools to use for a situation.
- **Photos** [confirmed 2026-09-11]: they take them and, until the upload lands,
  they are the only person holding a copy. A photo destroyed on their phone is
  destroyed everywhere, and the office cannot tell it was ever attempted. The
  owner: "A lost job photo is not recoverable later, and damage photos are what a
  claim rests on." ([ADR 0048](decisions/0048-a-photo-is-durable-when-it-is-taken-not-when-it-is-saved.md))
- **A color-blind crew member** [confirmed 2026-09-14]: on the Availability screen
  they cannot tell which days they marked available vs. unavailable, so they submit
  wrong days or cannot check what they sent, and the office then schedules them on
  days they cannot work. They choose a colorblind palette on My Profile; it follows
  their account and changes only their own Availability screens.
  ([ADR 0050](decisions/0050-colorblind-availability-palettes-live-on-the-account-and-recolor-only-your-own-view.md))
- **Sheet row fidelity** [confirmed 2026-09-14]: Movers and crew leads are
  unaffected; every path changed runs on the server after their record was
  accepted. ([ADR 0049](decisions/0049-a-sheet-row-is-written-atomically-and-a-lying-marker-is-cleared-by-hand.md))
- **Picks up rental trucks, and files the inspection on them** [confirmed 2026-09-17]:
  rentals are collected by "admin or sometimes crew drivers". Every long-distance trip
  runs in one. Under the old practice of one generic "rental" unit, this person was
  shown a previous, unrelated truck's inspection report and asked to confirm the truck
  in front of them was safe, and could be locked out entirely by a defect on a truck
  the company had already handed back.
  ([ADR 0053](decisions/0053-a-rental-is-a-placeholder-and-the-job-records-which-truck-it-was.md))
- **Enters a rental truck once, at the pre-trip inspection, then picks it** [confirmed
  2026-09-24, owner-selected option]: "Picks up the rental and files the pre-trip DVIR;
  would now enter the truck there and pick it from the list on later days." The truck
  then shows as "Rental*<job name>" in the unit list, so two rentals out at once are
  told apart and a multi-day job does not re-enter it.
  ([ADR 0055](decisions/0055-a-rental-truck-is-entered-once-and-offered-in-the-truck-list.md))
- **The subject of the federal records, and never the reader of them**
  [confirmed 2026-09-17]: their DVIRs, duty logs and DQ documents are what
  [COMPLIANCE_REFERENCE.md](COMPLIANCE_REFERENCE.md) exists to protect from a
  well-meant change. They are affected by it entirely indirectly and will never
  open it. When a compliance invariant is weakened, this is the person a defect
  lands on: a driver whose inspection report lost its defect description, or whose
  duty log was filed under someone else's name.
  ([ADR 0051](decisions/0051-the-compliance-reference-maps-code-to-obligations-and-vendors-no-cfr.md))
- **Open questions:** Do movers share a phone on a job? What is the actual rate
  of "my phone died mid-job"? Which screens do new hires get wrong most? How long
  do unsaved photos sit in the tray before somebody saves or discards them?

## 2. Crew lead

App role: `crew_lead`. $35/hr (SOP section 1.2). Owns on-site execution,
billing, and client communication (SOP section 6.2).

- **Who** [inferred]: the senior person on site, running the job and the crew,
  and the app's most loaded user by a wide margin.
- **Device and conditions** [inferred]: as the mover, plus the paperwork burden:
  they are the one holding the phone in front of a customer for a signature, and
  the one still tapping when everyone else is loading.
- **Uses it for** [inferred]: everything a mover does, plus job setup,
  checklists, the bill, BOL and inventory, customer signature, close-out, and
  the crew's hours as well as their own.
- **Does not get by role alone** [confirmed, ADR 0014]: skill rating. `crew_lead`
  does not grant it, it is the per-person `is_skill_rater` flag.
- **What breaks their day** [inferred]: a flow that makes them stop the crew to
  finish paperwork, anything that fails in front of a customer, and re-entering
  something the office already has.
- **Reads the trip toggle as the driving setting** [confirmed, 2026-09-10, ADR
  0047]: a crew lead on an interstate load-and-drive day set the job up as
  Long-distance, ticked Packing and Loading, and reported the RODS recorder as a
  missing feature. In his words: "because today we're loading and driving, you
  know, that's how I set it up in the app. The issue with that that I'm seeing
  is there's no option for rods logging when it's set up as that combination."
  Long-distance and the day's Driving box read to him as one setting, not two.
- **Reports app faults by what is missing, not by what is unset** [confirmed,
  2026-09-10]: the same call. A state the app can reach but does not explain
  gets reported as a bug and costs a phone call mid-job, which is the expensive
  form of this class discovering something.
- **Enters the rental truck's details at job setup** [confirmed 2026-09-17]: likely
  the person collecting a rental for an early long-distance departure, with the
  agreement in hand. The plate they type is what makes the inspection report, the
  duty log and the bill of lading name a truck rather than the word "rental", and
  the GVWR they copy off the door sticker is the only record of whether federal
  rules reached the trip at all.
  ([ADR 0053](decisions/0053-a-rental-is-a-placeholder-and-the-job-records-which-truck-it-was.md))
- **Enters or picks the rental truck** [confirmed 2026-09-24, owner-selected option]:
  "Often collects the rental for an early departure; enters or picks the truck." Amends
  the 2026-09-17 line above: the truck can now be entered at the pre-trip inspection
  as well as at job setup, and whichever comes first is the one record both use.
  ([ADR 0055](decisions/0055-a-rental-truck-is-entered-once-and-offered-in-the-truck-list.md))
- **Open questions:** How much of the app do they run at the truck versus after
  the job? What do they currently do on paper instead?

## 3. Skill rater

Not a role. The `is_skill_rater` flag, set per person from the Admin roster.

- **Who** [confirmed, ADR 0014]: someone an admin has designated. Reversed on
  2026-07-14 so job type is captured whether or not a rater is on site.
- **Uses it for** [inferred]: rating crew on a job they were present for.
- **What breaks their day** [confirmed, promotion checklist]: losing the flag in
  a promotion. Prod leads who are not re-designated find the skill rows and the
  job-type picker gone the next morning with no explanation.
- **Open questions:** Who holds this today, and is the rating done during the
  job or after?

## 4. Office administrator

App role: `admin`. Hailey (SOP section 1.1).

- **Who** [inferred]: owns invoicing (manual QuickBooks builds), collections,
  payroll entry, materials reordering, the fleet maintenance log, and
  crew-facing administrative communication.
- **Device and conditions** [inferred]: desk, full screen, working from the
  Google Sheet as much as from the app. Deadline-shaped work: payroll and
  invoicing happen on a schedule that does not move.
- **Uses it for** [inferred]: payroll and corrections, close-out, job summary,
  reimbursements, incidents, DQ files, the roster, and answering crew questions
  about hours.
- **What breaks their day** [inferred]: a number in the app disagreeing with the
  Sheet, a correction that does not reach the person it corrects, and re-keying
  anything by hand into QuickBooks.
- **Cannot see a photo that never arrived** [confirmed 2026-09-11]: job and
  damage photos surface to the office only once they reach Drive. Nothing records
  that a crew member tried and lost one, so a claim can be short of evidence with
  no signal anywhere on this side that it happened.
  ([ADR 0048](decisions/0048-a-photo-is-durable-when-it-is-taken-not-when-it-is-saved.md))
- **Reconciles against the Sheet** [confirmed 2026-09-14]: reconciles jobs
  invoiced long ago against the Sheet, and expects the Sheet to match the server.
  A row missing from the Sheet is a job that cannot be reconciled, with nothing on
  the Sheet side to say so.
  ([ADR 0049](decisions/0049-a-sheet-row-is-written-atomically-and-a-lying-marker-is-cleared-by-hand.md))
- **Is who an auditor's question lands on** [confirmed 2026-09-17]: reads the DVIRs
  worksheet as the record, and until now it recorded the vehicle as "rental" on every
  hired truck, so the office could not tell two inspections apart or say which truck
  either described. The worksheet now carries the plate, the rental company, the
  agreement number and the GVWR as their own columns.
  ([ADR 0053](decisions/0053-a-rental-is-a-placeholder-and-the-job-records-which-truck-it-was.md))
- **Enters rental details at booking when known, and reads the records** [confirmed
  2026-09-24, owner-selected option]: "Enters rental details at booking when known,
  and reads the DVIR / RODS / BOL records." The RentalTrucks tab lists each truck with
  every job it served.
  ([ADR 0055](decisions/0055-a-rental-truck-is-entered-once-and-offered-in-the-truck-list.md))
- **Open questions:** Which app numbers get trusted directly and which get
  re-checked against the Sheet? What is still done by hand that the app could
  produce? Should the office be able to see that a photo was attempted and lost?

## 5. Scheduler and estimator

App role: `admin`, but a different job from profile 4. Jonas primarily, Lucas
when covering (SOP section 1.1, 3.x, 5.x).

- **Who** [inferred]: runs most inbound calls, is the default scheduler by
  virtue of knowing each crew member's capability, and builds the estimates.
- **Device and conditions** [inferred]: on the phone with a customer while
  looking at the app or the calendar. Answers have to be fast and defensible in
  real time.
- **Uses it for** [inferred]: estimator, crew availability, job map, job
  summary, and crew skills as an input to who gets assigned.
- **What breaks their day** [inferred]: stale availability, a skill record that
  does not reflect the person, and an estimate that the field then contradicts.
- **Open questions:** Is the app consulted during a live sales call, or before
  and after? What decision does it need to support that it currently does not?

## 6. Systems owner

App role: `admin`, plus the repo. Jacob (SOP section 1.1), the person reading
this file.

- **Who** [confirmed]: builds and maintains the app, works staging, promotes to
  main, and holds the operational knowledge these docs exist to outlive.
- **Uses it for** [inferred]: everything, plus the admin system-check endpoints,
  the staging role-preview switch, and the Sheet itself.
- **What breaks their day** [inferred]: a defect reaching crews, a promotion
  that needs manual setup nobody recorded, and being the only person who knows
  something.
- **The Sheet as compliance copy** [confirmed 2026-09-14]: treats DVIRs and prior
  on-duty statements in the Sheet as the DOT compliance copy, so a lost row is a
  gap in an inspection or hours record.
  ([ADR 0049](decisions/0049-a-sheet-row-is-written-atomically-and-a-lying-marker-is-cleared-by-hand.md))
- **Also collects rentals, and owns the registry the practice depends on**
  [confirmed 2026-09-17]: "admin or sometimes crew drivers pick up trucks. current
  practice is using a generic 'rental' in the crew app to designate the rental."
  Marking that entry as a rental placeholder is an admin action, and nothing works
  until it is done.
  ([ADR 0053](decisions/0053-a-rental-is-a-placeholder-and-the-job-records-which-truck-it-was.md))
- **Reads the compliance reference, and so does Claude Code on their behalf**
  [confirmed 2026-09-17]: the direct and primary reader of
  [COMPLIANCE_REFERENCE.md](COMPLIANCE_REFERENCE.md), at the moment of editing a
  compliance-bearing file. What goes wrong without it, in their words: "Every time
  compliance comes up, the applicability question gets worked out from scratch, at
  cost, and possibly differently each time, because nothing in the repo records
  which rules reach this company and why."
  ([ADR 0051](decisions/0051-the-compliance-reference-maps-code-to-obligations-and-vendors-no-cfr.md))
- **Keeps a copy of every release outside GitHub** [confirmed 2026-09-23]: "If the
  GitHub account or repo were lost or locked, the business still has every file of
  what crews run." Runs the vault backup at each merge to main; no other class is
  touched.
  ([ADR 0054](decisions/0054-every-release-is-copied-to-the-owners-vault.md))
- **Tracks bug incidence over time** [confirmed 2026-09-24]: the reader of
  [bugs/BUG_LEDGER.csv](bugs/README.md), to see whether quality is improving,
  where bugs cluster, what each cost the field, and how bug frequency is
  trending, read against lines of code and feature count "so that the bug
  frequency can be related to the actual size of the app." Their own reports,
  including through the in-app bug tool, are owner-reported and kept apart from
  field reports: "bugs reported by me shouldn't be considered field-reported"
  (2026-09-24, replacing that morning's "counts as user-reported"). The office
  and crew are touched only as the people whose reports count as field-reported.

## 7. Mechanic

No account. Reaches `/mechanic-sign` unauthenticated when a device is handed to
them (`main.tsx:78`).

- **Who** [inferred]: whoever services the vehicle. Not an employee of the app
  in any sense: they see one screen, once, on somebody else's phone.
- **Uses it for** [inferred]: signing off a DVIR defect.
- **What breaks their day** [inferred]: anything requiring them to understand
  the rest of the app, or a screen assuming they have seen it before.
- **Open questions:** Is this an in-house mechanic or an outside shop? Do they
  sign on the crew's phone or their own device?

## 8. New hire, pending approval

Created by `POST /api/auth/signup`, inactive until an admin approves.

- **Who** [inferred]: someone hired last week, opening the app for the first
  time, possibly on their first morning, possibly in a parking lot.
- **What breaks their day** [inferred]: not knowing whether they did the signup
  right, and a first job where every screen is new at the same time as the work
  is new. This class has none of the accumulated knowledge every other profile
  quietly assumes.
- **Open questions:** Who walks a new hire through the app today, and how? What
  gets misunderstood most often on day one?

## 9. Customer

Not a user, and worth a profile anyway: they touch a crew member's phone to sign
the BOL, and they are the only person in this list who sees the app exactly once
and forms an opinion of the company from it.

- **Conditions** [inferred]: handed a stranger's phone, in their own doorway,
  usually at the end of a long day, sometimes without their glasses.
- **What breaks their day** [inferred]: a signature that has to be retried, a
  document they cannot read at that size, and a crew lead visibly fighting the
  app while they wait.
- **Open questions:** Do customers ever ask for a copy on the spot? Has anyone
  refused to sign on a phone?

---

## Classes deliberately not here

- **Kayleigh, cleaning** (SOP section 1.1, Annex A). Operates the cleaning CRM,
  a separate product. Not a Crew App user class.
- **Patrick.** Historical only, view-only QuickBooks access, no operational role
  (SOP section 1.2).
- **M1 personnel.** Pending the merger. Add a profile when a real M1 user gets
  an account, not before, and see
  [M1-INTEGRATION-ASSESSMENT.md](business/M1-INTEGRATION-ASSESSMENT.md).
