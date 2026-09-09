# Sanity pass - Area 10, Payroll and close-out

**Run 2026-09-09** against `PayrollTool`, `PayrollNotes`, `CloseoutStepper`, on
`staging` at commit `5e48ead`. Protocol: [SANITY_CHECK_PROTOCOL.md](../SANITY_CHECK_PROTOCOL.md).

**Status: eight findings, none decided, nothing fixed.** This file is the open
list. Nothing here has been approved or declined, so nothing has become work
yet. Pick items off it, or decline them - a declined defect moves to Known
defects in [RUNBOOKS.md](../RUNBOOKS.md), a declined matter of taste is deleted
from here.

More than one approved item goes through **Batch mode** in
[DEBUGGING_PROTOCOL.md](../DEBUGGING_PROTOCOL.md): explore all, propose per item,
wait for per-item approval, fix one at a time behind a checkbox list.

Area picked because every ledger row read `never` and the tie-break is "toward
whatever touches pay".

---

## Stated job

> "Turns everything the app collects into the numbers an admin types into
> QuickBooks." - `frontend/src/components/PayrollTool.tsx:6`, matching
> `docs/ADMIN_GUIDE.md:196` ("QuickBooks entry grid").

The code matches that sentence. The **guide** contradicts the code in two places
(F1, F2 below), which Q1 treats as the first finding of any pass.

## Scenario map

| Scenario | Answered by | Verdict |
|---|---|---|
| Job cancelled after arrival | Close-out variance + logged hours | covered |
| Crew changes mid-day | Per-employee hours on the report | covered |
| Two or three jobs in a day | One report per job | covered |
| Job runs past midnight / multi-day | Each hours entry carries its own `date` | covered |
| Somebody forgot to log something | The add tool (off-job / office / manual) | covered |
| Phone died or was replaced | Server-side | covered |
| No signal all job | Queues | covered |
| A quiet period where nobody needed a correction | Nothing. Finalize cannot run | **gap (F3)** |
| Wrong value found a week later, after payroll | Retroactive; nothing carries the delta forward | **gap (F5)** |
| Admin reopens a period already paid | Nothing tells them it was | **gap (F4)** |
| Brand new person on the screen | Admin-only, help text present | covered |

## Friction

Common path, a period of 10 jobs: **~62 taps, 60 of them the review loop** - six
per job (tap job, tick three attestations, Save, tap back to Payroll), with a
full payroll summary refetch on every return because the tab unmounts the
component (`frontend/src/pages/Admin.tsx:224`). Zero typed characters when the
period is already right.

---

## Open findings

### F3 - A period with no corrections cannot be finalized at all

**High. Q2.** The entire Finalize card is gated on `data.correction_count > 0`
(`PayrollTool.tsx:548`), and the button additionally on `pending === 0`
(`:609`). There is only one finalize entry point in the app.

But finalize does five things besides mailing corrections
(`backend/app/routers/payroll.py:2234-2264`):

1. `set_last_finalized_period` - advances every crew member's Worked Hours window
2. `_record_payroll_run` - the durable record that the period was run
3. `_mark_reimbursements_paid` - stamps claims paid
4. `payroll_run.rows_json` - the snapshot the Payroll worksheet publishes
5. `notes_snapshot` - archives the rolling payroll note

So a fortnight in which everybody logged correctly never stamps its
reimbursements paid, never records a run, **never reaches the Sheet mirror**
(which is finalized-only by design), never advances the crew's hours window, and
never archives the note. The "nothing went wrong" period is the one that falls
through.

*Direction:* gate the card on the period rather than on corrections; let the
button read "Finalize period" when there is nothing to mail.

*Before starting:* confirm with the office that a zero-correction period actually
happens. If it never does, this drops to Low.

### F7 - Finalize has no confirmation

**High. Q4.** `finalize()` goes straight to the POST
(`PayrollTool.tsx:330-338`). One tap sends irreversible emails about people's
pay, stamps money paid, and closes the period.

Meanwhile *removing a correction* - entirely reversible - does confirm
(`Admin.tsx:7800`, and the off-job panel). This is precisely the both-directions
case Q4 describes: the confirm budget is being spent on the reversible action and
not on the irreversible one.

*Direction:* a confirm that names what is about to happen - how many emails, to
whom, how many claims stamped. Not a bare "Are you sure?", which Q4 calls
decoration.

### F2 - The guide documents the reimbursement bug, not the rule

**High. Q1.** `docs/ADMIN_GUIDE.md:204` says "Reimbursements are **approved**,
personally-paid expenses only". The actual rule is pay-**unless-declined**, and
`payroll.py:475` records that the approved-only gate silently underpaid crew for
months before it was removed. The guide describes the defect as if it were the
design.

An admin reading that sentence believes unapproved claims are excluded, which is
backwards, and would explain a real "why did we pay that" conversation.

*Direction:* correct the sentence to pay-unless-declined and say that declining
emails the crew member.

### F4 - The screen cannot tell you a period is already finalized

**High. Q2.** `payroll_runs` records `finalized_at`, `finalized_by_name` and
`run_count`, but `_build_summary` never reads them
(`payroll.py:1148-1178`) and `PayrollTool.tsx` has no concept of a closed
period. An open period and one that was paid a fortnight ago render identically.

Compounded by F8: the period box restores whatever was last loaded, so the admin
can be looking at a paid period without a single cue.

*Direction:* return `finalized_at` / `run_count` on the summary and mark the
period closed on screen.

### F5 - A correction found after payroll has no route to the next run

**Med. Q2.** A correction to a closed period silently rewrites that period's
numbers, after the money has already left through QuickBooks. Nothing carries the
delta into the next run, and nothing flags that the delta exists.

The app has already solved this exact shape once: tips and bonuses are dated by
**payout** rather than by the job precisely so that money decided in arrears pays
on the current run instead of landing in a finalized period
(`payroll.py:579-628`). Hour corrections did not get that treatment.

*Direction:* a decision first, not a patch. Is a correction to a closed period
retroactive (fix history, office carries the delta by hand) or a next-run
adjustment (the tips model)? The answer changes the data model.

### F6 - The review loop is O(jobs) round trips through the nav

**Med. Q3.** Six taps per job and a full summary refetch on every return, with no
"next pending job" and no way back from the Job Summary. The period does persist
(`PayrollTool.tsx:222-231`), so the period itself is not re-picked - the cost is
the navigation and the refetch.

*Direction:* a next/back affordance between pending jobs, or review inline from
the pending list.

### F8 - The period default is whatever was last loaded, forever

**Med. Q7.** `PERIOD_KEY` is restored on mount and never expires
(`PayrollTool.tsx:222-231`). `defaultPeriod()` (`:207`) only ever applies on a
device that has never used the screen.

The app already knows the open period -
`backend/app/core/payroll_period.py:44 current_period_start` - and this screen
does not use it. Q7's test is "if the user never looks at the pre-filled value,
is what gets submitted right?" Here the submitted thing is the QuickBooks paste,
and it would be the previous period's numbers.

Mitigated by the dates being visible in the picker, which is why this is Med and
not High.

*Direction:* default to the open period; keep the sticky value within a session
only.

### F1 - The guide says tips are not tracked

**Med. Q1.** `docs/ADMIN_GUIDE.md:209-210`: "Tips are not tracked per employee
anywhere in the app, so they stay manual." Contradicted by the `employee_tips`
table, the Tips column (`PayrollTool.tsx:522`), the tips tooling and the
Tips-and-bonuses worksheet.

*Direction:* delete the sentence, describe the tips tool.

---

## Verified good

Do not re-check these next pass without reason.

- Close-out beta subtext renders (`JobReport.tsx:2354`; key present in `BETA_FEATURES`).
- Nothing gates close-out Save, so a crew member at 8pm can still file hours
  (`CloseoutStepper.tsx:45`).
- Tap targets 44px / 40px, 16px note input, so no iOS zoom (`CloseoutStepper.tsx:124, 367, 417`).
- Both wide payroll tables wrapped in `overflowX: auto` (`PayrollTool.tsx:500, 790`).
- Every hours aggregator windows in SQL; the reimbursement read was the last
  outlier and was fixed in `5e48ead`.
- Payroll rows key on `user_id`, never display name.
- `SHEETS_PAYROLL_TAB` and `SHEETS_TIPS_TAB` registered and documented
  (`sheets_export.py:4149-4150`, `CREDENTIALS.md:69-76`).
- "Can you identify the cause" is derived from the three bucket answers, so it
  cannot contradict them (`CloseoutStepper.tsx:19-33`).

## Needs a human look

1. Open Payroll on a phone at 390px. The summary table is 13 columns behind a
   horizontal scroll. Report whether it is usable one-handed, and whether the
   scroll is discoverable at all.
2. Confirm F3 is real: has the office ever run a fortnight with zero
   corrections?
3. On the Finalize card, check whether the suppress chips read as "already spoken
   to" or as a filter.

## Unverified from here

- `SHEETS_PAYROLL_TAB` / `SHEETS_TIPS_TAB` actually set on staging (a known open
  promotion item).
- Two admins finalizing the same period concurrently.
- A real historical payroll run recomputed by hand. STEP 0 of the vetting
  protocol asks for this on any money change and it is still owed; see the same
  admission in `backend/scripts/test_payroll_rounding.py`.
