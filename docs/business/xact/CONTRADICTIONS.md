# Contradiction ledger: the two prior xact exports

The two exports in this folder disagree with each other, with this repo, and in
places with themselves. This file lists every conflict found, so that the next
project can resolve them deliberately instead of inheriting whichever version
happened to get imported.

**Read this before either export.** Nothing in those files is ratified.

Line numbers cite `export-A-crew-app-framing.md` and
`export-B-m1-install-framing.md` as committed here.

## Why they diverge

The exports are not two drafts of one thing. They diverged because the project
was under-specified at the outset and the objective drifted during the
interviews: the stated goal is **harden the existing field app**, but many
answers were given as though the goal were **build the unified business brain**.
The platform's AI had no way to tell those apart, so it kept widening scope, and
each project widened in a different direction.

A second root cause compounds it: neither project was told the app already
exists and is in daily field use. Both interviewed as if from a standing start,
so both describe the pre-app world as the present one and re-specify shipped
features as new MVP scope.

## How each entry is classified

| Tag | Meaning |
|---|---|
| CONFLICT | A and B state incompatible things. A human has to pick. |
| SELF-CONFLICT | One export contradicts itself. |
| INVENTED | Recorded as fact with no source in this repo or the business docs. |
| STALE | Describes the pre-app world as if it were current. |
| DRIFT | Scope that belongs to the business brain, not to hardening the app. |

---

## 1. The product has three different names. CONFLICT / INVENTED

- **A** calls it **FieldSync** throughout (A:709 onward).
- **B** calls it **xAct** throughout (B:281 onward), which is the name of the
  platform conducting the interview, not the product.
- **This repo** calls it the Mountaineer Crew App.

Neither name appears anywhere in this repository or in `docs/business/`.

**Decide:** the actual product name, once, before anything else. Every downstream
artifact inherits it.

## 2. Two different hard launch dates, both invented. CONFLICT / INVENTED

- **A**: GA **September 1, 2026**, alpha gate August 8, beta rollout August 16
  (A:807-832). Recorded as immovable.
- **B**: GA **hard September 30**, alpha starting no later than September 6,
  beta two weeks after (B:704-777, B:906-915). Also recorded as immovable, with
  "miss it and something breaks."

The only date with an actual external source is the **December 31 close**, with
msWhse migration needed before it so staff can train for **January 1** use
(B:253, and the M1 assessment). Both September dates appear to be artifacts of
the interview.

**Decide:** whether any September date is real. If not, say so explicitly, or the
next project will inherit a phantom deadline and triage against it.

## 3. Native app versus PWA. CONFLICT, and the answer is already in the repo

- **A**: "Mobile web app, browser-based, no install required" (A:490), with PWA
  confirmed as the path and native left open if limits bite (A:559).
- **B**: native iOS and Android (B:42), App Store distribution, MDM provisioning,
  a whole thread on App Store review adding 1 to 3 days per bug fix (B:384), and
  a decision to "build OTA in now" via CodePush (B:577).

The app is a Vite/React **PWA** deployed on Vercel. There is no App Store, no
MDM, no CodePush, and no review cycle. B's entire update-cadence thread is
answering a problem this product does not have. You said as much inside B
("I am not sure why the App Store is a factor at this point", B:452) and the
interview continued down the native path anyway.

**Decide:** nothing. This one is settled by the repo. It needs correcting in the
record, not deciding.

## 4. Remote wipe: acceptable risk, or hard requirement. CONFLICT

- **A**: crew are on personal phones with no MDM, so the company has no
  remote-wipe or access-revoke capability, and that is "acceptable risk for v1,
  address post-launch" (A:585).
- **B**: "the app date must be wipeable at the office level from crew leads and
  members personal devices" (B:452), stated as a requirement.

This is a genuine unresolved requirement, not a wording difference. It has real
architectural consequences and it interacts with a live defect: today, logging
out already destroys unsynced photos and reimbursements (see the Known defects
list in `docs/RUNBOOKS.md`). Any remote-wipe design has to be built on top of
that, not before it.

**Decide:** is office-initiated remote wipe in scope, and if so, what exactly
does it wipe.

## 5. Device fleet: company-issued or BYOD. CONFLICT, resolved inside B

- **A**: personal phones, BYOD, no MDM (A:524-532).
- **B** early: "company issues iOS but some crew bring Android" (B:350), "some
  company devices via MDM, some personal BYOD" (B:359), and later an assumption
  block asserting "crew leads are always iOS, company-issued" (B:887).
- **B** late: you corrected it. "company does not issue phones. users are all
  BYOD, and types vary" (B:893).

**Decide:** nothing, but carry B:893 forward and discard everything upstream of
it. The SOP agrees: BYOD, types vary.

## 6. Headcount: three different numbers. CONFLICT / INVENTED

- **A**: ~50 field installers and 8 office staff (A:117 thread).
- **B**: 40 users total, 36 field (6 leads + 30 members), 4 back-office
  (B:519, B:1068).
- **The SOP** describes three principals, one administrator, one cleaner, and a
  tiered field crew, without a headcount.

**Decide:** the real number, from the roster. It drives seat math, alpha and beta
sizing, and several cost figures below.

## 7. Cost-of-pain figures disagree, including within A. SELF-CONFLICT / INVENTED

Recorded across the two exports: **$23,400/year** in admin labour (A, advocate
leg), **~$94,000/year** in manual transfer labour (A:284), **$2K/quarter** in
misfit software, **70% revenue growth**, and growth **from $1.6M to $10M**.

The $23.4K and $94K figures describe the same pain and differ by a factor of
four. None of them are sourced in `docs/business/`.

**Decide:** whether any of these are real numbers. A business case built on an
invented figure is worse than one built on none.

## 8. Warehouse inventory: must-have, or post-launch. SELF-CONFLICT in A, CONFLICT with B

- **A** says inventory is a "Must-have at September launch, billing and KPIs
  depend on it" (A:127), then later records full inventory tracking as an
  explicit **non-goal** for v1 (A:409 thread), then separately says the storage
  merger folds in "post-launch, v1 serves current operation only" (A:255).
  Three positions in one export.
- **B** makes the msWhse import core and hard-dated: project inventory with
  per-item barcode, quantity, photo, description, dimensions and weights
  (B:313), migrated **before the December 31 close** (B:253).

**Decide:** this is the single biggest scope question in the two files. Warehouse
inventory is the named next module after hardening. It is not part of hardening.

## 9. Integration ambition: clean source, or push to QuickBooks. CONFLICT

- **A**: the September win is a "single source of record only, staff still
  transfer, but from one clean place" (A:166). Live integrations are an explicit
  non-goal.
- **B**: the back-office console ships in v1 with "full read/write including
  scheduling and invoicing" (B:512), feeding a Q4 invoicing module that "will
  push through QuickBooks" and acts as the consolidating gate with a human
  deterministic review before processing (B:566).

These are different products. A leaves Hailey hand-keying QuickBooks. B removes
that. The SOP confirms the hand-keying is real and that retiring it is a planned
build.

**Decide:** whether QuickBooks integration is in the hardening scope at all. It
is the highest-value thing in either file, and it is almost certainly a separate
module rather than part of making the current app reliable.

## 10. Time tracking and expenses: B would remove shipped features. STALE

- **B**: "v1 clock-in/out only, employee expenses are v2" (B:503).
- **A**: KPI dashboard and billing export deferred to v1.1 (A:886).

Crew expense and reimbursement capture, with mileage odometer photos and receipt
photos, **already ships** and is documented in SOP section 6.1. Treating it as v2
would be a regression, not a deferral. The same trap applies to any "MVP" list
built without reading what exists.

**Decide:** nothing. Fix the record.

## 11. The FMCSA rationale is factually wrong in B. INVENTED

B records that the compliance exposure arose because "growth crossed a
compliance threshold, fleet size or route type changed" (B:956).

The SOP says the opposite: the owned trucks run intrastate **below** Montana's
26,001 lb threshold, and the company runs Part 396 practices on them
voluntarily. The federal burden is concentrated on the **interstate Penske
rental path**, and the two bright lines that would change the answer (any
interstate trip in an owned truck, or a combination over 26,000 lbs) have not
been crossed.

B then builds on the wrong premise: HOS is made launch-critical, a software-only
ELD path is selected, and a back-office HOS view with live duty status, 7-day
logs, and violation alerts is scoped for launch (B:1088-1091).

RODS, DVIR, prior on-duty statements, and the digital BOL already ship. What
exists is a compliance-record capture surface, not an ELD.

**Decide:** what, if anything, is actually missing from FMCSA capture today.
Start from SOP section 12 and `docs/RUNBOOKS.md`, not from B.

## 12. Both exports burned rounds on GTM you twice ruled out. DRIFT

- In **A** you selected "Internal tool, TAM framing doesn't apply" (A:195).
- In **B** you wrote: "Selling the product is a secondary need to solving our own
  day-to-day needs... the research and developing the TAM or GTM for this
  component is a waste of time" (B:225).

Both projects then continued through full commercial legs: TAM tiers, beachhead
segments, competitor sets, per-seat pricing at $8 to $12 per seat per month in A,
per-seat with a five-seat floor and a $50 to $100 per month field-app line in B,
free-trial shape, discount policy by company size, and external-monetization
triggers.

This is the clearest instance of the drift. It is also the easiest to prevent:
say once, at project setup, that this is an internal tool with no external
customer and no GTM leg, and that pricing questions are out of scope until an
explicit future decision reopens them.

**Decide:** nothing. State it as a boundary at setup.

## 13. Tenancy. Minor CONFLICT

- **A**: "single company now, maybe more down the line" (A:514).
- **B**: "single-tenant v1 but architect for multi-tenant later" (B:376).

B commits real architectural work that A does not. On a codebase with no test
suite, speculative multi-tenancy is a cost with no near-term return.

**Decide:** confirm single-tenant, no multi-tenant architecture work, until an
external customer actually exists.

## 14. Triage rule, already flagged by the platform. SELF-CONFLICT in B

B caught this one itself (B:1123): "cut hold-harmless to protect clock-in/out"
(B:769) versus "nothing is cuttable, date must move if any feature slips"
(B:1100). Resolved as "Jacob decides case-by-case" (B:1130).

Noted for completeness. The resolution is fine, but it is only meaningful if the
date in entry 2 is real.

## 15. Both exports describe the pre-app world as current. STALE

Throughout: installers capture job data in phone notes and by SMS, the office
re-enters across Google Sheets, SmartMoving and Google Calendar, paper manifests
and printed delivery tickets are the incumbent, WhatsApp is in the tool list
(A, market landscape leg).

The Crew App has been in daily field use for months. It captures the job
timeline, DVIR, RODS, digital BOL with signatures, materials, photos,
reimbursements, job reports, and the bill. WhatsApp is not in the SOP's tool
inventory at all.

Some of this is genuinely still true: Hailey does re-enter data by hand into a
catch-all spreadsheet and then into QuickBooks, per SOP section 7.2. The rest is
history being recorded as present state.

**Decide:** nothing, but this is the reason the reset decided to load the
reference documents before letting the AI ask anything.

---

## What is worth carrying forward

Most of the value in the two files is in the free-text answers, not in the
checkbox rounds. These are the ones that are grounded and worth keeping:

- The December 31 close and the msWhse migration needed before it, so staff can
  train for January 1 (B:253).
- What the msWhse import actually contains: project-unique inventory number in
  visual and barcode form, quantity, photo, description, dimensions and weights
  (B:313).
- The invoicing module as the consolidating gate, with human deterministic review
  before pushing to QuickBooks (B:566).
- All users are BYOD, device types vary, no company-issued phones (B:893).
- Office-level remote wipe is wanted (B:452), pending entry 4.
- The app stays open all day for the crew lead, and is checked before the job by
  crew members, at minimum to clock in and out (B:433).
- Some crew members are drivers; most are also crew leads, but not all (B:1016).
- Duty status by driver tap, with automation preferred if it can be made
  low-error (B:1082).
- Hybrid mobile and desktop, mobile first, heavy daily use of both, internal
  only, must cache with no signal (A:36).
- The administrator is occasionally client-facing: job confirmations, billing
  disputes, payment reminders (A:1051).
- What the app cannot do today for scheduling: no staff self-scheduling of
  availability, no capture of materials consumed for invoicing outside employee
  time (B:243). Note that crew availability **has** since shipped, so verify this
  before reusing it.

Everything else in the two files should be treated as unverified until it is
either confirmed by a human or found in this repo or `docs/business/`.
