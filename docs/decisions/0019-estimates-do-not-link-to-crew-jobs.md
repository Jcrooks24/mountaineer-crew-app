# 0019. A crew-app estimate does not link to a crew-app job

**Status:** Active. Decided 2026-07-16 after the owner corrected a misunderstanding
about how estimates become booked jobs. Reverses the estimate-to-job link and the
estimated-vs-actual comparison shipped earlier in the v1.8 line.

## Context

The estimator was built with a "link to job" picker: an admin bound an estimate to a
calendar `job_uuid`, and that link powered an estimated-vs-actual man-hours comparison
on the Job Report and in the admin Job Summary (`GET /api/estimates/by-job/{job_uuid}`,
plus `estimated_hours_for` in the sheet export).

This was based on a wrong model of the business flow. The real flow:

1. The crew-app PWA estimate tool is only the **start** of a quote.
2. The estimate is carried into **SmartMoving** (a separate system).
3. The client signs the estimate and contract **in SmartMoving**.
4. SmartMoving books the job and generates a **Google Calendar event**.
5. That event is copied from SmartMoving's calendar onto **our Job calendar**, crew are
   added as invitees, and the calendar post is formatted.

So the booked job the crew works (a Job-calendar event → `job_uuid`) and the crew-app
estimate record are in **different systems with no reliable correspondence**. A PWA
estimate is frequently not the estimate that produced the job, or the numbers were
re-worked in SmartMoving. Linking them by hand was manufacturing a connection that does
not exist, and the estimated-vs-actual comparison was measuring noise: the "estimated"
side came from a record that is not authoritative for that job.

## Decision

**Estimates do not link to crew-app jobs. There is no estimate-to-job picker and no
estimated-vs-actual comparison.**

Removed: the estimator link/unlink picker, the `job_uuid` field on the estimate
create/update/response schemas, `GET /api/estimates/by-job/{job_uuid}`, the
`GET /api/job-report/estimated-hours` endpoint, `estimated_hours_for`, the
estimated-vs-actual displays on the Job Report and admin Job Summary, and the
`estimated_hours` / `estimated_hours_source` / `hours_delta` columns from the JobReports
sheet export.

Kept: the estimator itself (customer, inventory, notes, photos, the admin-entered
`estimated_hours` field), the standalone `actual_man_hours` column in the JobReports
sheet (a fact about the job, not a comparison), and the estimator's site-photo storage,
which reuses the estimate's **own** `estimate_uuid` as the photos `job_uuid` key - that
is unrelated to job linking and must not be confused with it.

The `estimates.job_uuid` DB column is left in place, **dormant and always NULL**, to
avoid a destructive migration. It is written by nothing and read by nothing.

## Consequences

- The Job Report no longer shows an estimate reference card or an over/under hours line.
  The `overage_note` field ("anything different from the estimate?") lost its only input
  and its admin display; the DB column is left dormant.
- The admin Job Summary no longer has an "Estimate" card or an "estimated vs actual"
  hours card. Actual man-hours still reach the sheet.
- If an estimate-to-actuals comparison is ever wanted, it must be sourced from the
  system that actually holds the authoritative estimate for a booked job
  (SmartMoving), joined on whatever key SmartMoving ↔ Job-calendar share - not from a
  hand-set crew-app link.

## What would break if you undid this

Re-adding a "link this estimate to a job" tool re-introduces the original mistake: it
lets an admin assert a correspondence between a crew-app estimate and a booked job that
the business flow does not guarantee, and any comparison built on it reads a
non-authoritative "estimate" against real actuals. It looks like a reasonable feature in
isolation - which is why it was built the first time. The dormant `estimates.job_uuid`
column exists only to avoid a migration; it is **not** an invitation to wire the link
back up. If you find yourself repopulating it, re-read the flow in Context first.
