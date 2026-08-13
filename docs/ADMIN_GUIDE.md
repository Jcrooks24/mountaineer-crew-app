# Mountaineer Crew App - Admin Guide

**Version 2.3**  |  Last updated: July 2026
**App:** https://mountaineer-crew-app-two.vercel.app

> This is the version-controlled copy of the admin guide. It is written for
> admins, not developers: what admin can do inside the app. Keep it accurate
> against the code (verify against `frontend/src/pages/Admin.tsx` and
> `backend/app/routers/admin.py` when features change). The crew-facing side of
> every feature lives in the separate Crew Reference & Troubleshooting Guide.

## 1. Overview

The Mountaineer Crew App is a mobile-first progressive web app (PWA) that crew
members install on their phones. It covers the full lifecycle of a job day, from
picking up a calendar event in the morning through DVIR, materials, photos,
incidents, actual inventory, the Job Report and Bill, and (for interstate jobs)
FMCSA compliance paperwork and the Digital Bill of Lading.

**Crew members can:**
- Select their job from Google Calendar for the day, or enter one manually if it isn't listed
- Log Arrive, Depart, Start, and Finish events with GPS coordinates
- Complete pre and post trip DVIRs
- Take and share job photos
- Report an incident (damage or a claim), with photos, right from the Photos tab
- Submit materials used on a job
- Log actual inventory on long-distance jobs: furniture and boxes with pack type, plus a loose-item "chow" volume estimate
- Fill out the Job Report and Bill at the end of a job, including the job type, how full each truck ended up, employee hours pulled from the roster, and skill ratings (entered by admins and designated Skill raters)
- Answer three optional close-out questions on the Job Report: why the job ran differently than quoted (tick every reason, in either direction), whether the client was ready, and anything added or changed on site
- Get a projected wrap-up finish time and a return-trip drive estimate on the Job Report
- File interstate compliance paperwork: Prior On Duty Hours Statement, Record of Duty Status, per-diem and drive days, and the Digital Bill of Lading
- Submit mileage and expense / reimbursement requests
- Log off-job hours (shop work, errands) and view their own Worked Hours by week
- Submit rolling 2 week Scheduling Availability
- Browse the Document Library
- Work offline. Nearly everything queues locally and syncs when connectivity returns

**As admin, you can:**
- Approve new crew accounts and enable or disable access
- Promote crew members to admin
- View a live map of today's GPS events
- Check that the app's Google Calendar connection is working, and reconnect it if it drops
- Customize the app's appearance: theme presets, fonts, button styling, and pin colors, and save/apply custom presets
- Sign off on defective DVIRs, in person or by emailing a mechanic a sign off link
- Log non job Office Hours
- Run Payroll for a pay period: hours by employee in the QuickBooks column shape, correct crew reporting errors without touching what they submitted, and email each affected crew member what changed
- Review any job in full from Job Summary (timeline, DVIRs, materials, employee hours with skill ratings, incidents, actual inventory, BOL, long-distance per-diem, reimbursements, bill, photos, notes)
- Review the Incident log: claim numbers, estimated cost, and whether each is resolved
- Publish app Patch Notes to the crew, and global or per-job admin notes
- Manage employee tags and email aliases, and grant Scheduling Availability unlocks
- Designate who can rate crew skills, and maintain the Skills registry and Job Types list
- Import and export the shared Furniture Catalogue
- Review, approve, or reject expense / reimbursement requests
- Build moving estimates
- Confirm every app-to-sheet connection with the built-in System Check
- Turn on a daily availability digest for the office

## 2. Managing Crew Accounts

> **New accounts are inactive by default** and cannot log in until you enable
> them. When a crew member signs up they see: "Account created. Ask your admin to
> activate it before logging in."

**Enable a new account:** Log in as admin -> Admin chip (top right) -> Employees
tab -> find the new row (shows Disabled in red) -> tap the enable/disable toggle.
Status changes to Active and they can log in immediately.

**Disable access:** same steps, tap the toggle on an active account. Disabled
accounts cannot log in. All historical data (events, photos, materials, DVIRs,
bills, BOLs) is preserved.

**Promote to admin:** Employees tab -> find the employee -> Make Admin -> confirm.
Admins reach the Admin Dashboard and all its tabs. Assign carefully. Admins cannot
change their own role or active status from the Employees tab; another admin has
to, so a single admin can't lock themselves out.

**Skill raters:** rating a crew member's skills on the Job Report is gated to
admins and to anyone you designate a Skill rater (a per-person toggle on the
Employees roster). The "crew lead" tag does NOT grant this on its own. Designate
your raters before they need to rate a job, or the skill rows and the job-type
picker will not appear for them.

**Employee Tags & Email Aliases:**
- **Tags:** free-form labels on an employee (Driver, Has CC, Tier I, Crew Lead). Manage the tag list from Settings. Tags group crew in the availability digest and the Month Schedule View.
- **Email aliases:** alternate addresses so a calendar invite sent to a personal email still maps back to the employee.
- **Availability unlocks:** a one-time exception that reopens a locked 14 day availability window for a specific employee. (Crew-facing side: Crew Reference Guide, Section 11.)

## 3. The Admin Dashboard

Tap the **Admin** chip in the top right (requires admin role). A **Desktop mode**
toggle in the topbar widens every admin screen for a laptop or monitor, remembered
per device. Tabs: Map, Employees, DVIR Review, Estimator, Patch Notes, Job
Summary, Office Hours, Payroll, Incidents, and Settings.

### Employees
All accounts with name, email, role, status. Per-row: toggle Active/Disabled,
toggle User/Admin, toggle Skill rater, manage Tags, manage Unlocks, manage
alternate Emails. Also hosts the **Month Schedule View** - a rolling 30 day grid
of every active employee's submitted availability overlaid with scheduled jobs.
Read-only by default; tap **Edit availability** to enable editing so a stray tap
can't change a schedule by accident. Tap a day to pin its row while scrolling
across employees; a color chip shows availability on a day someone is already
scheduled.

### Map
Live map with a pin for every GPS-tagged crew event today. Pin color varies by
event type (Arrive, Depart, Start, Finish, Note), customizable in Settings. Tap a
pin for employee, job, event type, and timestamp. Fetched live each open. Crew do
not see this tab.

### DVIR Review
All DVIRs with noted defects needing mechanic sign-off, with a pending-only
filter. Each row shows whether it is signed. Clear a defect two ways: sign the
mechanic portion on an admin device, or email a secure sign-off link to a mechanic
with no app account (they sign from any phone or computer, no login). Once signed,
it drops off the pending list.

### Estimator
Admin-only moving estimate builder: rooms, a searchable furniture catalog that
auto-fills weight and cubic footage, custom items, per-estimate photos, and live
total weight and volume. Autosaves. Estimates are a quoting tool only; they are
not linked to crew-app jobs (estimates flow into SmartMoving, where a job becomes
booked).

### Patch Notes
Two things live here:
- **Patch Notes:** publish a titled update note crew see the next time they open the app.
- **Admin Notes:** a Global note (banner on every crew home screen) or a Per-job note (shown only when that job is selected).

### Job Summary
The primary review surface. Search by date and customer name for a full per-job
report on one page: timeline, materials, employee hours with skill ratings, DVIRs,
incidents (with photo links), actual inventory, the Digital Bill of Lading,
long-distance per-diem and drive days, reimbursements, the bill with computed
total, photos, and admin notes. Two crew on the same job (same calendar event or
same typed manual entry) are grouped together automatically. A copy-paste invoice
block gives the office a plain-text summary for invoicing software.

**Correcting hours.** Under Employee Hours, **Hour corrections** is where you fix
a wrong hours entry for this job (ADR 0032). Pick the employee, the bucket
(billable / non-billable / per-diem), enter what it should be, and write a
reason. This never changes what the crew submitted - it records an override, and
both numbers stay visible. The correction flows into whichever pay period the
job falls in, and the payroll page shows it read-only.

**Correcting the bill.** The Bill card has a **Correct bill** button: edit the
line items, global discount and notes, and the job-report billing fields
(billing method, M1 dumpster/recycling %, personal vehicles). It shows the new
total against the old as you type. Write a reason and **Save & notify crew** -
the corrected bill and report re-export to the Sheet, and each crew member on the
job is emailed the total change and your reason. Untick the notify box to save
without emailing. Unlike hours, the bill is edited in place (it is the office's
invoice), so there is no separate override - the pre-edit total is captured for
the email.

**Initialing the job.** At the bottom, **Initial this job** is your sign-off.
Tick all three - you reviewed the record, made any corrections, and confirmed
the job's data landed in the Google Sheet (you look and tick; it is not
auto-verified) - then enter your initials. Saving writes your initials into the
job's sheet rows and **emails each crew member any correction made to their
hours** for this job. It is idempotent: re-initialing does not re-send a
correction that already went out. Add a correction after initialing? Its "not
yet sent" note tells you to re-initial to mail it.

### Office Hours
Admin-only logging of non-job office/shop time: date, clock in/out, any number of
break periods, notes. Net hours calculate automatically.

### Payroll
Every hour the app collected for a pay period, per employee, in the shape you
type into QuickBooks. Nothing here is a new source of data; it is everything
already in the app assembled onto one page.

**What it reports.** One row per employee: Regular, Overtime, Non-billable,
Other, Total hours, per-diem nights, approved reimbursement dollars, and
mileage. **Copy for spreadsheet** puts the whole table on the clipboard as
tab-separated text, so it pastes straight into a sheet or lines up next to the
QuickBooks entry grid.

**Where each number comes from.** Billable and non-billable hours come from the
per-employee hours on job reports (dated by the job's first timeline event) plus
off-job entries. Office hours land in non-billable. "Other" is an off-job entry
on a pay structure management approved case by case. Per-diem counts nights
flagged out-of-town, from the long-distance day log and the per-employee
out-of-town flag, de-duplicated so a night marked in both places is owed once.
Reimbursements are approved, personally-paid expenses only; company-card
expenses are an expense log and are excluded.

**No hourly wages, on purpose.** The app has never stored an hourly rate and
this tool does not add one, so it reports hours rather than gross pay ([ADR
0029](decisions/0029-payroll-corrections-are-an-override-layer.md)). Tips are not
tracked per employee anywhere in the app, so they stay manual.

**Mileage and per-diem pay.** Those two are reimbursement rates, not wages, so
they *are* configurable ([ADR
0033](decisions/0033-reimbursement-rates-live-in-config.md)). Set them in
**Settings -> Payroll rates** (mileage $/mile, per-diem $/night). The payroll
page then multiplies each person's logged miles and out-of-town nights by the
rate and shows the dollar figure under the count, and the spreadsheet export
gains **Per-diem $** and **Mileage $** columns. Leave a rate at 0 and that column
stays a count only, priced by you. Rates apply live: re-opening an old period
shows it at today's rate, so copy the numbers out at run time if a rate later
changes.

**Overtime.** Billable hours over 40 in a Monday-to-Sunday week. Non-billable
and Other do not count toward the 40. Run periods that start on a Monday and end
on a Sunday: any week hanging outside the period gets flagged `partial`, because
its overtime cannot be settled without the rest of that week.

**Check these first.** A yellow panel at the top lists anything that would make
the numbers wrong, most importantly a name on a job report that matches nobody
on the roster. Those hours are **not counted**, so fix the name or add the
person before you run payroll.

**Correcting a crew mistake.** Open an employee's **Detail** to see their week
by week overtime, hours by day, and every line the totals were built from.
Corrections never change what the crew submitted - they are an override, and
both numbers stay visible ("Corrected from 8: clocked out at 3:30"). Overtime is
recalculated after corrections, so moving hours out of billable can correctly
remove someone's OT.

**Job hours are corrected on the Job Summary, not here** (ADR 0032). A `Job`
line shows the corrected number with an **at Job Summary** marker and no Correct
button; open that job in Job Summary to change it, and the crew member is emailed
when you initial the job. Off-job, office and manual lines are still corrected
here: hit **Correct** on the line, or **+ Add a line** for something with no
underlying entry at all (a bonus, say).

**Finalizing.** When the off-job/office/manual corrections are right, **Finalize
and notify** emails each affected crew member one summary of exactly what changed
and why (your reason text is the body of that email, so write it for them). Job
corrections are not mailed from here - they go out when you initial the job. It
is safe to run repeatedly: a correction is mailed once, so if you fix one more
thing afterwards, only that one goes out. Tick anyone you have already spoken to
in person to mark them done without an email. If a send fails, the page says so
and that correction is left unsent, so finalizing again retries it.

### Incidents
The log of every incident crew report from the field. Each carries an automatic
claim number and photo links. Record an estimated cost, add notes, and mark it
resolved. Filter to hide resolved incidents.

### Settings
Shared configuration; a change here applies to all crew devices on next load (no
per-device setup). Contains:
- **Theme & Appearance** (own page, below)
- **Advanced Settings** (own page, below)
- **Company information:** your company name, address, phone, email, U.S. DOT number, and MC number. Shown as the carrier on the Bill of Lading and used anywhere the company address appears. Edit any field and Save; a blank field falls back to the built-in default. This replaces the values that used to be hardcoded in the app
- **DVIR unit list:** add, edit, remove vehicles from the DVIR dropdown
- **Employee Tags:** the free-form tag list used across the roster and digest
- **Job Types:** the job type tags crew pick from on the Job Report
- **Job Checklist:** the checklist shown on a job. Each item is either manual (the crew tick it) or auto (it ticks itself when the app sees the thing happen - a DVIR filed, the report saved, the BOL signed, PODS/RODS filed, etc.). Limit an item to long-distance jobs and/or specific job types; leave job types empty for every job. The crew see the applicable items on the hub once a job is set up
- **DQ document types:** the documents that make up a driver's DQ file. Each type is driver-filled (a medical card, the certification of violations) or office-filed (the road-test form and certificate), and required or not. Required documents show in the driver's missing-docs reminder

The **DQ Files** admin tab is a per-driver board of who is missing which required documents; open a driver to upload or replace any document. Drivers see their own DQ file in Profile, upload the ones they own, and get a reminder on the hub when they owe a required document. (In-app fillable forms are coming; for now a document is a scan or filled PDF uploaded to the driver's Drive folder, most-recent-per-type.)
- **Crew Skills (registry):** define each skill, mark it core (rated on every job) or job-specific, choose which job types it applies to, and keep a per-employee skill matrix
- **Furniture Catalogue:** import and export the shared catalogue as CSV, with item dimensions and custom fields. One catalogue feeds the Estimator, actual inventory, and the BOL item pickers
- **Help Text:** labels and hints shown on the crew timeline and other fields

#### Theme & Appearance

| Setting | Options |
|---|---|
| Theme preset | dark ocean, midnight purple, forest, steel, sunset, light |
| Font family | System default or custom |
| Border radius | Sharp to rounded |
| Shadow level | None, subtle, elevated |
| Density | Compact / Comfortable / Spacious |
| Button gradient colors & size | Custom colors |
| Map pin colors | Per event type (Arrive, Depart, Start, Finish, Note) |
| Help text labels | Shown on the crew timeline and other UI fields |

Custom presets: save the current look as a named preset and apply it to all users
with one tap.

#### Advanced Settings
- **Google Calendar:** whether the app's calendar connection is working. If disconnected, paste a fresh connection token here; it takes effect right away.
- **Crew Resources:** a daily digest posted automatically to a calendar, listing who is available today (grouped by tag, crew leads called out) alongside who is already scheduled. Off by default. A Generate / refresh button forces an immediate run once on.
- **Data Management:** on-device housekeeping for the current admin's phone (clear local caches and queues). Does not touch server data.
- **Sheet sync:** a "Refresh sheet from app data" button that re-sends anything that reached the app but did not land in the shared Google Sheet (events and BOLs). Safe any time; the app also runs this automatically in the background.
- **System Check:** a one-tap health snapshot. Confirms the database, the Google Sheets connection, the Google Drive connection, and required settings are working; checks that every app-to-sheet sync points at the right worksheet; and flags any records that have drifted out of the sheet (events or signed BOLs). Copy and send to Jacob if something looks wrong. In the Sheet Syncs table, `not yet` under Exists is normal (nothing has used that feature, so the worksheet has not been created); `missing` is not. A red `error` date means the last attempt failed; a grey date with "recovered from an error" underneath means it failed once and has been fine since.
- **Sheet Backfill - what never made it:** answers a different question than System Check. System Check tells you whether a sync is working *now*; this compares the app's records against the Sheet and lists the ones that were saved but whose sheet row never landed, usually the leftovers of an outage. Nothing is lost when this happens - the app is the system of record and the Sheet is a mirror. "Run audit" only reads. "Re-send" queues those records through the normal export, up to 100 at a time; it is safe to press twice, because a re-send overwrites the row in place rather than duplicating it. Timeline events and BOLs are not listed here - the background reconciler already re-sends those on its own.

  **Re-sending is not instant, and the audit will lie to you if you re-run it too soon.** A re-send returns as soon as the records are queued, not when they reach the Sheet, so an audit run straight afterwards still shows them missing - which reads as "the tool did nothing" when it is actually working. Re-sending is read-heavy (roughly four Google reads per record against a cap of 60 a minute), so budget about **a minute per 15 records**; 100 records is around seven. The tool tells you the estimate when you press it, and locks the button for that long, so waiting for it to unlock is the same as waiting for the drain.
- **Diagnostics:** read-only checks confirming the Crew Resources calendar connection is wired up correctly.

### Close-out data on the job report

Three columns groups arrive on the JobReports tab from every report submitted after this deploy. All three are optional for crew, so a blank cell means "not answered", not "nothing happened" - worth remembering the first time you chart them.

- `variance_cause` / `variance_note` - every reason the job ran differently than quoted, from a fixed list, plus free text. **Multi-select since 2026-07-28**, so the cell holds a comma-separated list and the causes across all reports will out-number the reports. Count selections, not rows, when you chart it. The column header stays singular so existing formulas keep resolving. The list runs in both directions: `Overestimated volume`, `Easier access than expected`, `Client further along than expected`, `Scope reduced on site`, and `Crew faster than expected` mean the job beat its estimate. Those are the ones worth watching - a job that runs long generates a complaint, a job that runs short quietly overcharges the client and never does.
- `client_readiness` / `client_unready` - how ready the client was on arrival, and (when they were not fully ready) a comma-separated list of what specifically was not ready. Readiness stays single-select; it is one answer about one moment.
- `scope_change_count` / `scope_change_hours` / `scope_changes` - how many things changed on site, the **net** hours those changes moved the day by, and one readable line per change. Each change can now carry several reasons and a direction, so a line reads `Fewer items, Stop dropped (-2.5h): garage already empty`. `scope_change_hours` nets additions against reductions (it was a gross total of additions before 2026-07-28), and is blank rather than 0 when nobody estimated, so "not estimated" stays distinguishable from "netted out to nothing". `scope_change_count` counts changes, not reasons: a change with three reasons is still one change.

Reports submitted before this deploy have these columns empty and will stay that way; there is nothing to backfill, because the crew was never asked.

The `truck_fullness` cell now also carries cubic feet, e.g. `26Int: V75×H50 (38%, 672 cu ft)`. That volume is derived from the truck's interior dimensions in `backend/app/schemas/job_report.py` (`TRUCK_SPECS`), which are **estimated from box length and typical interior width and height - measure the fleet and correct them**. The percentage is what the crew observed and is stored; the cubic feet are computed at export time, so fixing a spec fixes future exports rather than rewriting history.

## 4. Troubleshooting Common Issues

| Problem | Cause | Fix |
|---|---|---|
| Crew member can't log in after signing up | Account is inactive | Admin -> Employees -> enable their account |
| Calendar picker is empty or errors | The Google Calendar connection dropped | Admin -> Advanced Settings -> check connection status; if disconnected, paste a fresh token |
| Materials, DVIRs, bills, or BOLs missing from the Google Sheet | A brief sync hiccup | Events and BOLs re-send themselves within a few minutes; to force those, Advanced Settings -> Sheet sync -> "Refresh sheet from app data." Everything else does not re-send on its own: run **Sheet Backfill -> Run audit**, then **Re-send** for the sync that shows a count |
| A signed BOL is not in the sheet or the signed-PDF Drive folder | Signed offline, or the phone was handed off before it finished sending | It is kept on the crew device and delivered when it can send; the background check also re-sends it. Confirm with System Check (Sheet drift - BOLs). If it persists, send Jacob the System Check output |
| Photos or BOL PDFs not uploading | Crew member is offline | Normal. Uploads finish automatically once the device reconnects |
| App shows the login screen mid job | The crew member's session expired | They log back in. Their job and local activity log are preserved; nothing is lost |
| Two crew on the same job ended up with separate records | Each typed a slightly different manual entry, or picked different calendar events | Reconcile in Job Summary, or have both re-pick the same entry next time they're online |
| A reimbursement or mileage submission has a mistake | No edit option on the crew side by design | Reject it from the review screen with a note explaining why, then ask them to resubmit |
| A DVIR is stuck waiting on mechanic sign-off | No admin has signed it yet | DVIR Review -> sign it directly or email a mechanic a sign-off link |
| A crew lead lost the skill rows and job-type picker | They are not designated a Skill rater (the crew-lead tag does not grant it) | Employees -> turn on the Skill rater toggle for them |
| Employee doesn't show as available in the Month Schedule View | They haven't submitted availability for that window yet | Nothing to fix; it fills in once they submit. Grant an unlock from Employees to change an already-locked window |
