TITLE:
v1.8 - Skills, incidents, inventory, and a big reliability pass

BODY (paste into Admin > Patch Notes; renders as plain text):

This is our largest update yet. New tools for the field and the back office, a
handful of workflow changes worth reading, quality-of-life polish, and a lot of
under-the-hood reliability work so nothing you log gets lost.

============================================================
WORKFLOW CHANGES (read these - they change how you work)
============================================================

- Skill rating is now gatekept. Only Admins and people specifically designated as
  a "Skill rater" (a per-person toggle on the Employees roster) can rate the crew.
  The Crew lead role does NOT grant it on its own. Designate your raters before
  you expect ratings to appear.

- Job type is collected by anyone on the crew. It is the job's basic descriptive
  data, so it gets recorded whether or not a rater is on site.

- Employee hours must be picked from the roster. No more free-typed names, so a
  person's hours reliably match them in the summary and payroll. If someone is not
  on the roster, add them first.

- Inventory logging is paused on LOCAL jobs for now. Item-by-item entry on a phone
  was too slow to be worth it locally; it stays on long-distance jobs, where the
  Bill of Lading needs it. A faster local capture flow is coming.

- The nightly crew-feedback email now also includes the day's incident reports
  with links to their photos.

============================================================
NEW TOOLS - FOR THE CREW (in the field)
============================================================

- Incident reporting. Report damage or an incident from the Photos tab. Each one
  gets an automatic claim number and you attach photos to it. Works offline.

- Skill ratings. Designated raters rate each mover on the skills the job actually
  called for, on the Job Report. A star scale with plain-language anchors (1 = held
  the job up, 5 = seasoned-lead level).

- Actual inventory (long-distance jobs). Log furniture and boxes with pack type
  (CP / PBO / N/A), search the shared catalogue as you type, apply a pack type to
  every box in one tap, and estimate "chow" (loose-item) volume.

- Digital Bill of Lading. Build the BOL inventory, capture origin and destination
  signatures, and generate the signed PDF on the device (works offline). It now
  syncs across devices, so two crew on the same job build one shared BOL.

- Off-job hours. Log hours for work not tied to a job (shop work, errands) from
  your Profile.

- Worked Hours. See your own logged hours by week (regular, overtime, non-billable)
  on your Profile.

- Return-trip tool. A drive-time estimate for the trip back, on the Job Report.

- Wrap-up estimator. Projects your finish time and offers it as an end time in the
  hours pickers.

- Job type + truck fullness on the Job Report. Tag what kind of job it was; record
  how full each truck ended up with sliders.

- Estimate reference on the Job Report. When a job has a linked estimate, you see
  its hours, its access and special-item notes, and estimated-vs-actual man-hours.

============================================================
NEW TOOLS - FOR ADMIN (back office)
============================================================

- Job Summary tab. Every source for one job on a single page: timeline, materials,
  employee hours with skill ratings, DVIRs, incidents (with photo links), inventory,
  the linked estimate, the BOL, long-distance per-diem and drive days, reimbursements,
  and the invoice builder.

- Skills registry. Define the skills, mark them core (rated on every job) or
  job-specific, choose which job types each one applies to, and keep a per-employee
  skill matrix.

- Job types. Admin-configurable job type tags.

- Furniture catalogue. CSV import and export round-trip with item dimensions and
  custom fields. One shared catalogue across the Estimator, actual inventory, and
  the BOL item pickers.

- Incident log. Review every incident with its claim number, estimated cost, and
  resolution status.

- Sheet-sync System Check (Advanced Settings). Confirms the Google Sheet connection
  and that every app-to-sheet sync has its worksheet, so you can spot a broken sync
  before data goes missing.

============================================================
QUALITY-OF-LIFE (smaller UI polish)
============================================================

Crew:
- Confetti when you submit a job report.
- Autocorrect works again when typing item names on the inventory and BOL builders.
- Skill ratings laid out cleanly on mobile (no more squished stars).
- Estimated man-hours is clearly marked as a rough approximation, not a firm figure.
- Faster load: the map script is deferred and a duplicate startup fetch was dropped.
- A contacts pill for quick access.

Admin:
- Month schedule is now a rolling 30-day view instead of calendar month. Tap a day
  to pin its row while you scroll sideways, and a small color chip shows a crew
  member's availability on a scheduled day (replacing the hard-to-read outline).
- Newly added estimator rooms sort to the top of the list, so you do not have to
  scroll to find the room you just made.
- Collapsible employee lists, furniture export, and clearer help text throughout.

============================================================
UNDER THE HOOD (reliability + performance)
============================================================

- Offline work is never destroyed by a server rejection. Anything the server
  refuses is kept on your phone, marked "not sent" with the reason, and given a
  Retry button, instead of silently vanishing. This now covers every offline
  queue: job events, materials, incidents, off-job hours, inventory, BOL, RODS,
  per-diem, office hours, estimate items, and reimbursements.

- Photos are stored as their own data, not a fragile file reference. Fixes a bug
  where a receipt or job photo could fail to send with a confusing "field required"
  error, and prevents silent photo loss on some phones.

- Your un-synced failed work is preserved when a different crew member logs in on a
  shared phone, and restored when you log back in on that device.

- Bounded, indexed lookups. Worked Hours and the job timeline no longer scan the
  whole history, so the app stays fast as data grows.

- The Digital BOL is one document per job that syncs and merges across devices.

- Many Google Sheet export fixes so the admin sheet stays accurate: incident photo
  links, estimate rows removed on delete, and no double-counted totals.
