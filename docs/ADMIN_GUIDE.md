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
Summary, Office Hours, Incidents, and Settings.

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

### Office Hours
Admin-only logging of non-job office/shop time: date, clock in/out, any number of
break periods, notes. Net hours calculate automatically.

### Incidents
The log of every incident crew report from the field. Each carries an automatic
claim number and photo links. Record an estimated cost, add notes, and mark it
resolved. Filter to hide resolved incidents.

### Settings
Shared configuration; a change here applies to all crew devices on next load (no
per-device setup). Contains:
- **Theme & Appearance** (own page, below)
- **Advanced Settings** (own page, below)
- **DVIR unit list:** add, edit, remove vehicles from the DVIR dropdown
- **Employee Tags:** the free-form tag list used across the roster and digest
- **Job Types:** the job type tags crew pick from on the Job Report
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
- **System Check:** a one-tap health snapshot. Confirms the database, the Google Sheets connection, the Google Drive connection, and required settings are working; checks that every app-to-sheet sync points at the right worksheet; and flags any records that have drifted out of the sheet (events or signed BOLs). Copy and send to Jacob if something looks wrong.
- **Diagnostics:** read-only checks confirming the Crew Resources calendar connection is wired up correctly.

## 4. Troubleshooting Common Issues

| Problem | Cause | Fix |
|---|---|---|
| Crew member can't log in after signing up | Account is inactive | Admin -> Employees -> enable their account |
| Calendar picker is empty or errors | The Google Calendar connection dropped | Admin -> Advanced Settings -> check connection status; if disconnected, paste a fresh token |
| Materials, DVIRs, bills, or BOLs missing from the Google Sheet | A brief sync hiccup | The background check usually re-sends within a few minutes. To force it: Advanced Settings -> Sheet sync -> "Refresh sheet from app data." Run System Check to confirm nothing is still drifting |
| A signed BOL is not in the sheet or the signed-PDF Drive folder | Signed offline, or the phone was handed off before it finished sending | It is kept on the crew device and delivered when it can send; the background check also re-sends it. Confirm with System Check (Sheet drift - BOLs). If it persists, send Jacob the System Check output |
| Photos or BOL PDFs not uploading | Crew member is offline | Normal. Uploads finish automatically once the device reconnects |
| App shows the login screen mid job | The crew member's session expired | They log back in. Their job and local activity log are preserved; nothing is lost |
| Two crew on the same job ended up with separate records | Each typed a slightly different manual entry, or picked different calendar events | Reconcile in Job Summary, or have both re-pick the same entry next time they're online |
| A reimbursement or mileage submission has a mistake | No edit option on the crew side by design | Reject it from the review screen with a note explaining why, then ask them to resubmit |
| A DVIR is stuck waiting on mechanic sign-off | No admin has signed it yet | DVIR Review -> sign it directly or email a mechanic a sign-off link |
| A crew lead lost the skill rows and job-type picker | They are not designated a Skill rater (the crew-lead tag does not grant it) | Employees -> turn on the Skill rater toggle for them |
| Employee doesn't show as available in the Month Schedule View | They haven't submitted availability for that window yet | Nothing to fix; it fills in once they submit. Grant an unlock from Employees to change an already-locked window |
