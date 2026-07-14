# 0014. Skill rating is designated, never inherited from a role

**Status:** Active. Implemented 2026-07-14 on `staging`.

## Context

Rating a crew member's skills is not like the rest of the job report. The rest of the
report is a record of what happened: hours, materials, truck fullness. Anyone on the
crew can fill it in, and if they get it wrong somebody notices, because the numbers have
to add up. A skill rating is a judgement about a colleague, it follows that person
around, and nothing about it self-corrects. Whoever holds that pen should be a small
group, chosen on purpose.

The original gate did not work that way. It read:

```python
user.role in ("admin", "crew_lead") or bool(user.is_crew_lead)
```

Two separate things granted skill rating, and only one of them was a decision anybody
made deliberately:

- **`is_crew_lead`**, a boolean an admin flips per person. This was always the real
  designation. The Admin roster button that sets it has been labelled **"Skill rater"**
  since the day it shipped.
- **The `crew_lead` role**, which granted rating **for free**. Promote somebody to lead
  and they could rate the whole crew, without anyone deciding they should.

The second is the one to be rid of. Leading a job and judging the people on it are
different jobs, and the app was conflating them because a role name happened to be
nearby. Every new lead silently widened the group that could rate.

The naming made it worse. A boolean called `is_crew_lead` that is deliberately
independent of the `crew_lead` role is a trap. It reads like a duplicate of the role, so
the tempting cleanup is to delete it and lean on `role == "crew_lead"`, which is exactly
backwards: it would delete the real designation and keep the accident.

## Decision

**Skill rating, and the job-type picker that decides which skills get rated, are granted
only by an explicit per-person designation. No role grants them except `admin`.**

```python
user.role == "admin" or bool(user.is_skill_rater)
```

Three parts:

1. **`is_crew_lead` is renamed to `is_skill_rater`** (migration `c5e7a9b1d3f6`, an
   `ALTER ... RENAME COLUMN`, so every designation an admin already made survives). The
   column now says what it does.
2. **The `crew_lead` role no longer grants rating.** A lead who should rate is designated
   like anyone else, from the Admin roster. The role still carries its other powers
   (hours verify); it just no longer carries this one.
3. **`admin` keeps it**, so an admin can always correct a bad rating without first
   designating themselves.

The **job type** moves behind the same gate rather than staying with the leads, because
job type selects which skills are rated on a job. Leaving it with a wider group would
let someone who cannot rate still decide what gets rated, which is the same authority
wearing a different hat.

## Consequences

- **Existing crew leads lose skill rating the moment this deploys**, unless an admin has
  also flipped their Skill rater toggle. This is the intended effect, not a migration
  bug, but it is a live behaviour change for real people: designate the leads who should
  still be rating **before** promoting this to `main`.
- The gate is enforced **server-side** in `job_report.py::_is_skill_rater`, not just
  hidden in the UI. A non-rater's report save keeps whatever skills and job type a rater
  previously set (re-applied from the existing row) and drops anything its own payload
  carries. A stale client cannot write either field.
- `is_skill_rater` is copied by `migrate_users_staging_to_prod.py`, so a staging-only
  crew member arrives in prod with their designation intact.

## What would break if you undid this

Putting `crew_lead` back in the gate re-opens the hole quietly. Nothing errors, no test
goes red; the group that can rate the crew simply grows every time somebody is promoted,
which is the failure this exists to prevent.

Renaming `is_skill_rater` back to `is_crew_lead`, or deleting it in favour of the role,
destroys the only real designation in the system. The roster's "Skill rater" button
would then be setting a flag nothing reads.
