TITLE:
v2.3 - Skills, incidents, inventory, and more

BODY (paste into Admin > Patch Notes; renders as plain text):

Our biggest update yet. A batch of brand-new tools for the field and the office,
some upgrades to tools you already use, and a lot of behind-the-scenes work so
nothing you log ever gets lost.

============================================================
NEW - FOR THE CREW (in the field)
============================================================

- Incident reporting. Report damage or an incident right from the Photos tab.
  Each one gets an automatic claim number, and you attach photos to it. Works
  offline and syncs when you are back on signal.

- Skill ratings on the Job Report. Rate each mover on the skills a job actually
  called for, on a 1-to-5 star scale (1 = held the job up, 5 = seasoned-lead
  level). Only Admins and people an admin designates as a "Skill rater" can fill
  these in.

- Actual inventory (long-distance jobs). Log furniture and boxes with their pack
  type (CP / PBO / N/A), search the shared catalogue as you type, set a pack type
  on every box in one tap, and estimate "chow" (loose-item) volume.

- Off-job hours. Log hours for work not tied to a job - shop work, errands,
  anything not billed to a move - from your Profile.

- Worked Hours. See your own logged hours by week on your Profile: regular,
  overtime, and non-billable.

- Wrap-up estimator + return trip. On the Job Report, get a projected finish time
  (your remaining work plus the drive back to the yard) that you can pick as your
  End time, and a drive-time estimate for the trip home.

============================================================
NEW - FOR ADMIN (back office)
============================================================

- Job Summary tab. Every source for one job on a single page: timeline,
  materials, employee hours with skill ratings, DVIRs, incidents (with photo
  links), inventory, the BOL, long-distance per-diem and drive days,
  reimbursements, and the invoice builder.

- Skills registry. Define the skills, mark them core (rated on every job) or
  job-specific, choose which job types each one applies to, and keep a per-employee
  skill matrix. Designate who can rate skills with a toggle on the roster.

- Job types. Configure the job type tags the crew pick from on the Job Report.

- Shared furniture catalogue. Import and export your catalogue as a CSV, with item
  dimensions and custom fields. One catalogue now feeds the Estimator, actual
  inventory, and the BOL item pickers.

- Incident log. Review every incident with its claim number, estimated cost, and
  whether it is resolved.

- Sheet-sync System Check (Settings > Advanced). Confirms the Google Sheet
  connection and that every app-to-sheet sync is pointed at the right worksheet,
  so you can catch a broken sync before data goes missing.

============================================================
UPGRADES TO TOOLS YOU ALREADY USE
============================================================

Job Report:
- It now also captures the job type and how full each truck ended up (fill sliders
  per truck).
- Employee hours are now chosen from the roster instead of typed by hand, so a
  person's hours reliably match them in the summary. If someone is not on the
  roster, add them first.

Invoice builder:
- Auto-fills a labor line for each crew member from their hours, a line per
  personal vehicle billed as crew transport, and now a "Truck (per hour)" line for
  each truck recorded in Truck fullness.

Digital Bill of Lading:
- Now syncs across devices. Two crew on the same job build one shared BOL instead
  of two separate ones, and items appear on the other device as they are added.
- A signed BOL now always reaches the office. If you sign offline, hand the phone
  off before it syncs, or the send hits a snag, the BOL and its signatures are kept
  and delivered when they can be. It can no longer say "sent" without actually
  landing in the office sheet and the signed-PDF folder, and a background check
  re-sends anything that slipped through.

Estimator:
- Attach site photos with notes, and use the richer shared furniture catalogue.
  Site photos are now held safely on your device until they upload, so a failed
  send or a reload no longer loses one.

Admin month schedule:
- A rolling 30-day view (instead of the calendar month), tap a day to pin its row
  while you scroll across employees, and a small color chip shows a crew member's
  availability on a day they are already scheduled.
- It is read-only by default now. Tap "Edit availability" to turn editing on, so a
  stray tap while scanning can no longer change someone's schedule by accident.

============================================================
BEHIND THE SCENES (reliability + speed)
============================================================

- Offline work is never lost to a server hiccup. If a submission is rejected, it
  is kept on your phone, marked "not sent" with the reason, and given a Retry
  button, instead of silently disappearing. This covers every offline queue, and
  a "saved" or "synced" message only shows once the work has actually landed - not
  before.

- Photos are stored more reliably. Job photos, incident photos, BOL item photos,
  and estimator site photos are all held as real image data on your device, so a
  failed upload or a reload no longer loses one and they finish sending on their
  own when signal returns.

- If a different crew member logs in on a shared phone, your un-synced work is kept
  for you and restored when you log back in on that device - now including a signed
  BOL you had not finished sending.

- The app stays fast and steady as data grows. Screens no longer reload the entire
  past to show, and the office server was hardened so a heavy day no longer risks
  slowing it down or restarting it.

- The office Google Sheet stays accurate, and a background check now catches and
  re-sends anything that did not make it to the sheet, including signed BOLs.
