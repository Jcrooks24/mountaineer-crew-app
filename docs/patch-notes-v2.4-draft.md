TITLE:
v2.4 - Close-out fixes, BOL fixes, and the office money tools

BODY (paste into Admin > Patch Notes; renders as plain text):

This one is mostly repair work. A lot of things that looked like they were
working were not, and several of them were quietly losing work. If you have
reported something in the last month, it is probably in here.

============================================================
FIXED - THINGS THAT WERE NOT WORKING
============================================================

- The close-out is fixed. Since the middle of August you could not get past the
  first question: tapping "Yes, it differed" did nothing and question 2 never
  appeared. Every job closed in that window went to the office as "As quoted"
  whether that was your answer or not. It works now.

- The close-out cause questions take No, and you can change your mind. Tapping
  No now lights up and moves you on. Tapping Yes and then correcting yourself to
  No actually registers. Saying Yes before you have picked a cause is remembered
  instead of being lost when you look away, and reopening a report shows what you
  actually answered.

- "Can you identify the cause?" is gone. You were being asked to commit before
  you had seen a single option. The app works it out from your three answers
  instead.

- Picking a site cause no longer drops you straight into the long "what was added
  or dropped" form unless the cause actually means the job changed.

- The Bill of Lading could not be printed or emailed on any job seeded from a
  volume estimate. It failed every time, and the "try again" message it showed
  was wrong: your signature had been saved, and signing again signed the DELIVERY
  leg on a truck that had only been loaded. Fixed. The message now tells you the
  signature is recorded and not to sign again, and signing at destination asks
  you to confirm, because delivered cannot be undone.

- A signed destination BOL could sit unsent for the whole trip because a PDF that
  would not build was blocking it in the queue. The signature goes first now.

- Signed BOLs, RODS logs and drive-day records saved offline now actually send
  when you get signal back. Before this they only sent while you had that exact
  screen open, and the drive-day record never sent at all, which is why the
  office was seeing "Drive days: 0". This has been the behaviour since the start,
  not something that broke recently.

- Uploads over about 8 MB were failing every time. Job photos, receipts, odometer
  shots, estimate photos, DQ documents and signed BOLs were all affected.
  Anything smaller went through fine, which is why it took so long to spot.

- A job report typed up but not yet submitted is no longer lost if you log out. A
  crew hit "Not authenticated", followed the app's own advice to log out and back
  in, and lost the whole report: hours, close-out and bill, all typed again. Your
  report draft and bill draft are now kept and restored when you sign back in. We
  are still chasing what caused the original error.

- Pre-trip DVIR, post-trip DVIR and "trucks swept out" no longer sit unticked
  forever on labor-only jobs that never had a truck. Admin has to tick "Only if a
  truck is on the job" on those items for it to take effect.

- Switching jobs quickly could paint the previous job's checklist, which after
  the change above could have hidden the DVIRs on a job that does have a truck.

- Trucks were being billed at 1 hour. The truck line was created before anyone
  had entered employee hours, so it defaulted to 1 hour and stayed there for the
  life of the bill. At $90/hr that went out to customers. The truck line is now
  the longest single shift on the job, minus that shift's breaks, and it is not
  created at all until there are hours to size it from.

============================================================
NEW - FOR THE CREW
============================================================

- "Internal rearrange" is now an option on the day plan. If you are moving items
  around inside one home, you no longer have to tick Loading, which put the wrong
  activity on the record and opened a packing inventory for a shipment that does
  not exist.

- You can change today's activities straight from the Job setup tile. Tap the
  "Doing" row and the checkboxes open in place. No Edit, no warning screen. The
  plan resets each calendar day, so on day 2 of a trip this is how you change it.

- On an interstate job where you have picked labor but not driving, the card now
  says the driving log is missing instead of telling you it is handled for you. A
  RODS is federally required on an interstate drive day.

- Scale weight has its own spot on the RODS tile. If you load one evening and
  weigh the next morning, there is now somewhere to record it. Before, the Weight
  button did not exist at all on a pure drive day.

- Tap a field title for help. Nine fields in the job setup Bill of Lading section
  have a small "?" next to the title. Tap it and a short explanation appears at
  the bottom of the screen with a bar showing how long it is staying. Tap again
  to dismiss. Valuation is the one worth reading: released value is the standard
  and pays 60 cents per pound of the item, so a 10 pound TV pays $6, not what the
  TV is worth. If a job is full value protection, it says so in the job's Google
  Calendar description.

- Employee Directory, in Tools. Search anyone currently on the crew by name,
  email or phone and tap to call or email them. It works offline, because it
  reads the roster the app already keeps.

- Bill lines are checked one at a time now. Instead of one tick at the bottom
  saying you reviewed the whole bill, each line gets its own tick, and the app
  names the lines you have missed. It is more taps. It is also how a truck line
  frozen at 1 hour went out to customers under a single tick.

- If you type a number into a truck line by hand, it stays. The line stops
  following the crew hours and says so, and a "Use crew hours" button puts it
  back.

============================================================
FOR THE OFFICE
============================================================

- Payroll hours are now quarter-rounded per entry, the same way the Sheet and the
  job reports have always shown them. Payroll used to sum the raw numbers, so
  people were paid a different figure from the one their own reports showed. Not
  retroactive: it applies to pay periods starting 2026-09-16 or later.

- Tips. Record a tip for an employee on the payroll screen. A tip lands in the
  pay period it was entered, not the period the job was in, because tips often
  turn up long after the move. They are flat dollars, never hours, and never
  count toward overtime.

- Bonuses, and the "add a line" tool. One control for anything an employee did
  not log: a bonus in dollars, a per diem, or a contractor's hours. It adds a line
  that never existed. Corrections to something crew already submitted still
  belong on the thing they logged.

- PTO. Set an annual allowance per person on the roster, record PTO on the
  payroll screen, see the balance for the year, and remove an entry that was
  typed wrong. No roll-over, and it does not count toward overtime. Crew cannot
  see it or grant it to themselves.

- Reimbursements now say whether they have been paid and which payroll run paid
  them, and there is a QuickBooks ledger tab: search by employee, type, review
  status, card, date or free text, tick each one off as entered, and untick it if
  you mis-clicked. Receipts open as links into Drive. Expense rows on payroll now
  name the card, so it is clear the list is personal spend only.

- A rolling payroll notes field that saves properly. It only says "Saved" once
  the server confirms it, it flushes when you switch tabs or close the page, and
  if a save never landed it keeps your copy rather than letting the server
  overwrite it. Finalizing archives what it says onto that run.

- Payroll finalize is stricter. It will not run with reimbursement claims nobody
  has reviewed, and a job that was initialed and then had its hours edited comes
  back to the pending list instead of being paid at the new number silently.

- Off-job hours can be corrected. They show in the Job Summary lookup and open
  the same hours correction panel a job has. Recorded PTO is deliberately not
  correctable there.

- Payroll periods now write to a Payroll worksheet in the Sheet, one row per
  employee per finalized period, with tips and PTO on the row. The clipboard
  paste is no longer the only record. Tips and bonuses have their own tab behind
  it.

- System Check now shows the Drive folders too: which ones are pinned to a
  specific folder and which are being looked up by name. That is what keeps
  staging from writing over real signed documents.

============================================================
BEHIND THE SCENES
============================================================

- The materials charge on the Bills tab could go missing entirely, or be counted
  twice, depending on when the server restarted. Jobs were invoiced off a stale
  number and nothing looked wrong. Fixed, with a five-minute check that re-drives
  anything that did not land.

- 37 export failures in a single day were traced to two jobs writing to the same
  worksheet at once. Fixed.

- The nightly digest was re-sending every bug report and feature request ever
  filed, every night.

- The reimbursement search was firing a request on every keystroke.

- Beta tags this round: internal rearrange, field help, employee directory,
  per-line bill checks, and editing the day plan from the setup tile.
