# 0034. A job has a top-level header record, and tools seed from it

**Status:** Active. C1 in progress (2026-08-03).

## Context

Until now a "job" was not an object. It was a `job_uuid` string threaded through
every per-job artifact (events, job report, DVIR, BOL, materials, inventory,
incidents, LD days, bill), with `job_name` and `job_date` denormalized onto each
row and no single record that says "this is the job." The facts that describe a
job as a whole were scattered:

- **Crew** existed only inside the job report's `employee_hours_json`, entered at
  the end. Before the report there was no record of who was on the job (only the
  calendar event's invitee list, which the app never surfaced).
- **Vehicle** lived on DVIRs / BOLs / RODS, never as a job's assigned truck.
- **Local vs long-distance** was a device-global toggle (`crew_mode_v1`), not a
  property of the job, so it drifted between devices and jobs.
- **Addresses / stops** lived on the BOL shipment or RODS, or nowhere.
- **Job type** lived on the job report.

The office wanted a first-thing, <3-minute setup that captures these once and
feeds the rest of the app (batch C1-C4, the "top-level job data capture"
project). That is impossible without a place to put the answers.

## Decision

**Introduce a `job_setup` record - one row per `job_uuid` - as the job's
authoritative header, and have the other tools seed their defaults from it.**

- The header holds: job name, date, source (calendar/manual), calendar event id,
  `is_long_distance`, job type tags, assigned vehicle unit(s), the crew
  (user_ids), origin / destination / stops, notes, and a `locked` flag.
- **Crew are interpolated from the calendar event's invitees.** The backend
  already matches attendee emails to users (`_email_to_user_id` in
  `crew_resources_calendar.py`); the capture screen surfaces the matches, and the
  crew confirm or add. A name still only counts when it resolves to a `user_id`.
- **The header is authoritative for the fields it owns, and tools READ it as
  their seed** (chosen over a pre-fill-and-forget layer). DVIR's unit, the LD
  mode, the report's job type, the BOL/RODS addresses, and the report's roster
  default from the header when the tool has no value of its own. The tools keep
  their own storage for tool-specific detail; the header is the shared default,
  not a replacement.
- **Long-distance becomes a property of the job**, stored on the header. Selecting
  a job sets the mode, instead of the device-global toggle deciding it. This
  fixes the drift and makes LD-only checklist items (C3) and LD tabs correct
  per job.
- **The header resists accidental overwrite (C2).** Once set, editing it is a
  deliberate act (a `locked` flag + confirm-to-edit), because it now feeds other
  tools and a stray change propagates.

The three dead job structures stay dead: the legacy `jobs` table + integer
`job_id` FK (always null), and the unregistered `jobs_registry`. `job_uuid` is
the only identity.

## Consequences

- **The app finally has a job object.** `job_setup` is the header the
  `job-summary` aggregator and the capture screen both build on, and the natural
  home for anything about a job "as a whole" from here on.
- **Autopopulation is real, not copied.** Because tools read the header as their
  seed, correcting the header corrects their defaults, rather than leaving stale
  copies behind. Tool-specific edits still win locally (the seed is a default,
  not a lock on the tool).
- **Wiring is incremental and additive.** The header ships first as a standalone
  record + capture screen (no tool reads it yet), then each tool is pointed at it
  one at a time. Nothing breaks if a job has no header - tools fall back to
  today's behavior, so old jobs and offline-first both keep working.
- **`is_long_distance` moves off the device.** The `crew_mode_v1` toggle becomes
  a per-job value hydrated on selection; the device toggle remains only as the
  fallback for a job with no header.
- **Do not resurrect the `jobs` table or `job_id`.** Build on `job_setup` keyed
  by `job_uuid`.

## Roadmap (batch C)

- **C1 - Job capture (this ADR).**
  - C1.1: `job_setup` model + migration + GET/PUT `/api/job-setup/{job_uuid}` (additive, no tool wiring). Sheet export of the header.
  - C1.2: the capture screen - crew from invitees (new crew-suggestions endpoint off the existing matcher) + confirm/add, vehicle unit(s), local/LD, name/date, origin/destination/stops, job type. Entry point from the hub.
  - C1.3: tools seed from the header - DVIR unit, LD mode, job type, addresses, report roster - one tool at a time.
- **C2 - Overwrite protection.** `locked` + confirm-to-edit on the header. Folds into C1.
- **C3 - Configurable checklists.** Admin builds checklists in Settings, assigns to job types (+ LD-only items). Items auto-check off existing presence signals (DVIR row exists, report saved, BOL signed, inventory present, PODS/RODS filed); manual items (trucks swept, gear accounted for) the crew tick. Leans on the `job-summary` presence data + the header.
- **C4 - DQ docs repository (independent).** Per-driver DQ forms filled in-app, exported to Drive, most-recent-per-type-per-driver, shown in Profile, with a reminder banner. Self-contained; does not depend on C1-C3.
