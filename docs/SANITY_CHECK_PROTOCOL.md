# Mountaineer Crew App - Sanity Check Protocol

A **findings-only** review of a tool as a human being actually uses it: the
workflow, the UX, and the UI. It asks a different question from every other
protocol in this repo.

| Protocol | Question it answers |
|---|---|
| [DEBUGGING_PROTOCOL.md](DEBUGGING_PROTOCOL.md) (`/debug`) | Something is wrong. What is causing it? |
| **This doc (`/sanity`)** | **Is this tool the right answer to the job it exists for, and does using it feel like it?** |
| [VETTING_PROTOCOL.md](VETTING_PROTOCOL.md) (`/vet`) | Is this change correct and safe to put on crew devices? |

A feature can pass `/vet` completely and still be the wrong feature: correct
code, clean build, data lands in the Sheet, and the crew still cannot answer
"what do I tap when the job gets cancelled after we arrive?" `/vet` cannot see
that, because it checks the change against the code's own intent. This pass
checks the intent itself.

## When to run it

1. **Before a new feature is marked done, and before the vet pass.** Order is
   `build -> /sanity -> fix what is approved -> /vet -> done`. Running it after
   the vet wastes the vet, because the fixes it produces need vetting too.
2. **Periodically, on a feature set nobody chose.** Sanity findings accumulate in
   old features, not new ones, because old features were shaped by requirements
   that have since changed. Pick the area with the oldest date in the
   **Coverage ledger** at the bottom of this doc, run the pass, update the row.
   One area per session at most, in the spirit of
   [INCREMENTAL_WORK.md](INCREMENTAL_WORK.md).

## Rules

- **Findings only. This pass fixes nothing.** Not the one-line ones, not the
  obvious ones, not "while I was in there". The report is the deliverable, and
  the user decides what becomes work. A pass that ends with a diff has failed,
  because the user never got to see the finding before it became a decision.
  Update the Coverage ledger row and nothing else.
- **One exception: active data loss.** If the walkthrough shows crew work being
  destroyed right now, say so immediately and stop the pass. Same rule as the
  debugging protocol.
- **Evidence first, never assume.** Every claim about what a screen does cites
  the `file:line` that renders it. "The button is probably disabled" is not a
  finding, it is a guess. The codebase moves fast, and a report full of guesses
  is worse than no report, because it burns the user's trust in the next one.
- **Walk it as the person, not as the developer.** Crew: a phone, one hand, in a
  truck or on a driveway, possibly with no signal, in a hurry, being paid by the
  hour to move furniture rather than to operate an app. Admin: at a desk,
  reading the Sheet, trying to answer a question a customer just asked.
- **Do not drive the user's browser.** Chrome tabs sync to the business partner's
  computer. When something can only be settled by looking at the running app,
  put it in **Needs a human look** and say exactly what to tap and what to
  report back.
- **Staging only.** Confirm `git branch --show-current` is `staging`.

---

## Q1 - Does this tool do what it is supposed to do?

1. **State the tool's job in one sentence, in the app's own words.** Take it from
   the header, the help text, [CREW_GUIDE.md](CREW_GUIDE.md), or
   [ADMIN_GUIDE.md](ADMIN_GUIDE.md), not from the code and not from the commit
   message. If those sources disagree, that is finding number one, and the rest
   of the pass is built on sand until the user picks the real sentence.
2. **Walk the primary path end to end** and write down what actually happens at
   each step, citing the component.
3. **Compare the output to the sentence.** The tool's stated job and its real
   output disagreeing is the highest-value finding this pass produces, and it is
   invisible to `/vet`.

A tool that does its stated job, but whose stated job is not the job the business
has, is a Q1 finding too. [docs/business/](business/) is the reference for what
the business actually does.

## Q2 - Does the category of tool answer every user-level scenario?

This is the gap-hunting question, and it is where most real findings come from.

1. **Name the category and list every sibling in it.** Example categories:
   time capture (Timeline, Off-job, Office hours, Long-distance workday),
   vehicle (DVIR, mechanic sign, unit specs), money out (Materials,
   Reimbursements), customer paperwork (BOL, signatures, documents).
2. **Enumerate the scenarios a real user hits**, including the ugly ones. The
   demo path is never where the gap is. Start from this list and add to it:
   - The job is cancelled after the crew arrives.
   - The crew changes mid-day: someone leaves at noon, someone joins at 2.
   - Two jobs in one day. Three.
   - A job runs past midnight, or across multiple days.
   - Somebody forgot to start it and remembers at the end of the day.
   - The phone died, or was replaced, or is a different person's phone.
   - There was no signal for the whole job.
   - The value entered was wrong and is noticed a week later, after payroll.
   - The person doing this is brand new and has never seen the screen.
3. **Map each scenario to the tool that answers it.** Then read the map:
   - A scenario with **no** tool is a gap. Crew will invent a workaround, and the
     workaround is what the data will actually be.
   - A scenario with **two** tools is worse than a gap. Crew will split between
     them, and the admin totals will be quietly wrong.
   - A scenario whose answer is "tell the office" is a gap with extra steps.

## Q3 - Is there as little friction as possible?

1. **Count the taps and the typed characters** from app open to task complete, on
   the **most common** path, not the shortest possible one.
2. Then look for these specifically:
   - **Re-entry of something the app already knows.** Address, job name, crew
     names, today's date, the truck. Every one of these is a finding.
   - **Anything that requires signal at that moment.** Core Behavior 1 says the
     app works offline. A step that silently needs the network is both a
     friction finding and a vet-level defect.
   - **Steps that exist for the office's convenience**, paid for in crew time on
     a driveway. Sometimes correct, always worth naming.
   - **A screen that must be scrolled to reach the only button that matters.**
   - **Anything crew has to remember to do** rather than being led to it. Memory
     is not a workflow, and the newest person has the least of it.

## Q4 - Are there manual confirmations or checks on important information?

Both directions are findings, and the second one causes the first.

- **Missing where it matters.** Irreversible or hard-to-notice-wrong actions with
  no confirmation: deleting queued work, finalizing payroll, submitting to the
  Sheet, signing on the customer's behalf, closing a job out. Anything that
  touches money or a signature.
- **Present where it does not.** A confirm on a routine action trains crew to tap
  through confirms, which is exactly how they will treat the one that mattered.
  Every low-value confirm spends the attention budget of the high-value one.
- **Verification the app is making a human do.** If the app can check it, the app
  should check it: totals that do not add up, a negative time span, a date in the
  future, a job with no crew on it. Asking crew to eyeball it outsources a
  computation to the busiest person in the chain.
- **Confirmations that show the wrong thing.** A confirm that says "Are you
  sure?" without naming what is about to happen is decoration.

## Q5 - Is there a more efficient way to fit this into the app's ecosystem?

- **Does the data it collects already exist somewhere in the app?** If so, the
  tool should read it, not ask for it.
- **Does its output reach where it is needed** without a person re-keying it:
  the Sheet, payroll, the job summary, the admin tab that answers the question.
  A tool whose output an admin copies by hand into something else is unfinished.
- **Is it discoverable from where the user already is** when they need it? A tool
  reachable only from its own nav entry gets used by whoever remembers it exists.
- **Would it be better as a step inside an existing flow than its own screen?**
  The reverse happens too: a step buried inside a flow that people need
  independently.
- **Does anything else in the app now duplicate part of it?** Features have been
  consolidated here before (job type and trips, incidents into Photos). Say so
  when the shape has drifted.

## Q6 - What has to be true at the code level, and is it?

This is the only question in the pass that opens the code in depth, and it is
still a findings-only read.

1. **Write the preconditions list first**, before checking any of them. Take the
   tool as designed and state what must be true for it to work in the field.
   Typical entries:
   - The queue key exists, and something actually triggers the drain.
   - The server accepts every field the client sends (see the triage rule in the
     vetting protocol: a field the client provably sends and the server drops).
   - The Sheet tab env var exists in the staging environment as well as prod.
   - Identity flows on `job_uuid`, never on the job name.
   - The value shown on screen is read from the same place it is written to.
   - Two devices doing this at once do not overwrite each other.
   - The rows this reads are bounded, so it does not grow into the OOM class.
2. **Then verify each one, with evidence.** `file:line`, a command, a response.
3. **Anything you cannot verify from here goes in the unverified list**, named,
   not assumed. "Cannot verify" is a legitimate and common result. Assuming is
   not.

## Q7 - Does the UI render in an organized way?

Check on a phone-width viewport (390px) first, desktop second.

- **Organized:** does the screen's visual order match the order the task is done
  in? Is the primary action obviously the primary action? Does
  [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) cover what is on screen, or has this
  screen grown its own styling?
- **Sticky buttons:** a sticky footer covering the last row of a list or the
  field being typed into. A primary action pushed below the fold with the
  keyboard open. A bottom nav overlapping content.
- **Broken buttons:** a disabled button with no explanation of what would enable
  it. A button that does nothing while offline and does not say so. A tap target
  under the 48px row minimum. A double-tap that submits twice.
- **Default values, the highest-yield item on this list:** every pre-filled value
  is an answer the app is submitting on the user's behalf. Ask of each one: if
  the user never looks at it, is the submitted value right? A pre-filled `0`, a
  date defaulted to today on a form usually filled in late, a dropdown defaulted
  to the first option alphabetically. These do not look like bugs, and they
  produce wrong data silently.
- **Loading, empty, and error states** exist and say something a person can act
  on. "No data" is not the same as "not loaded yet", and crew cannot tell them
  apart.
- **Beta subtext:** a new feature carries `beta` as header subtext until the next
  app update (`BetaTag.tsx`). Check it is there, and check it has been removed
  from things that are no longer new.

---

## Output format

The whole pass is a report. Structure it like this, so passes are comparable
across sessions.

1. **Tool and stated job.** One sentence, and where it came from.
2. **Scenario map.** `Scenario | Answered by | Verdict (covered / gap / ambiguous)`
3. **Friction count.** Taps and typed characters on the common path, one line.
4. **Findings.** `# | Q | Severity | Finding | Evidence | Suggested direction`
   - **Critical** - data loss, wrong pay, a crew member blocked in the field.
   - **High** - a real scenario has no answer, or crew are working around it.
   - **Med** - friction, ambiguity, a confirm in the wrong place.
   - **Low** - polish.
   - "Suggested direction" is one line and is not a plan. No patches here.
5. **Verified good.** Say what passed. A clean check is a result: do not pad it,
   and do not omit it.
6. **Needs a human look.** What to tap, on which screen, and what to report back.
7. **Unverified from here.** Preconditions from Q6 that could not be checked.
8. Close with: **nothing was changed in this pass**, and offer to open the
   findings as a batch.

## What happens to the findings

- Findings the user approves become normal work, then a `/vet` before promotion.
- More than one approved finding goes through **Batch mode** in the debugging
  protocol: explore all, propose per item, wait for per-item approval, then fix
  one at a time behind a checkbox list.
- A finding that is a defect with an unknown cause goes to `/debug`, not into a
  fix inside this pass.
- A finding the user declines is written into Known defects in
  [RUNBOOKS.md](RUNBOOKS.md) if it is a defect, or dropped if it is taste.
- A finding that reveals a rule worth keeping goes into the vetting protocol, so
  the next change is checked for it automatically.

---

## Coverage ledger

Pick the oldest row. Break ties toward whatever touches pay, safety, or a
customer signature. Update the row in the same commit as the report, and keep
the open-findings count honest.

The count links to that pass's report in `docs/sanity/`, which is the open list
for the area: findings sit there undecided until they are approved (they become
work) or declined (a defect moves to Known defects in RUNBOOKS.md, a matter of
taste is deleted).

| # | Area | Main surfaces | Last checked | Open findings |
|---|---|---|---|---|
| 1 | Auth and account | `Login`, `Signup`, `ForgotPassword`, `ResetPassword`, `Profile` | never | - |
| 2 | Job capture and timeline | `App` job screen, `JobSetupPanel`, `JobChecklistCard`, `JobReport`, `JobClosedPanel` | never | - |
| 3 | Time capture siblings | `OffJob`, `OfficeHours`, `Availability`, `LdWorkday` | never | - |
| 4 | Long-distance mode | `LongDistance`, `RodsRecorder`, `RodsSignoff`, `LdDocuments` | never | - |
| 5 | Vehicle and DVIR | `DVIR`, `MechanicSign`, `VehicleUnitSpecs`, `TruckDeckGauge` | never | - |
| 6 | Money out | `Reimbursement`, materials capture, `ReimbursementsAdminTab` | never | - |
| 7 | Customer paperwork | `BillOfLadingForm`, `BolInventoryTab`, `ActualInventory`, `SignaturePad`, `DocumentLibrary` | never | - |
| 8 | Photos and incidents | `IncidentReport`, photo capture, `IncidentsAdminTab` | 2026-09-11 | [6](sanity/2026-09-11-photos-incidents.md) |
| 9 | Estimating | `EstimatorTab`, `WrapUpEstimator`, `BillCalculator` | never | - |
| 10 | Payroll and close-out | `PayrollTool`, `PayrollNotes`, `CloseoutStepper` | 2026-09-09 | [8](sanity/2026-09-09-payroll-closeout.md) |
| 11 | Roster, skills, DQ files | `EmployeesTab`, `DqFilesTab`, `DqMyFileCard`, `RosterPicker` | never | - |
| 12 | Admin job summary and notes | `JobSummaryTab`, `NotesTab`, `AdminNotesBanner`, `MapTab` | never | - |
| 13 | Crew comms | `Bulletin`, `EmployeeDirectory`, patch notes, `UpdateBanner` | never | - |
| 14 | Feedback intake | `ReportBug`, `RequestFeature` | never | - |
