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
- **Open questions:** Do movers share a phone on a job? What is the actual rate
  of "my phone died mid-job"? Which screens do new hires get wrong most?

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
- **Open questions:** Which app numbers get trusted directly and which get
  re-checked against the Sheet? What is still done by hand that the app could
  produce?

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
