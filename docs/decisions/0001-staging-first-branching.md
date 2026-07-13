# 0001. Everything ships to `staging` first

**Status:** Active and non-negotiable.

## Context

This app is used by moving crews, on their phones, while they are carrying
furniture. There is no QA team, no test crew, and no staged rollout. A bad push to
`main` is on real phones, on real jobs, within minutes, and the people affected
cannot stop and debug it. They are holding a couch.

## Decision

`staging` is the default branch. All work lands there. `main` is production and is
only ever reached by an explicit, deliberate promotion.

Staging has its own Render service, its own Vercel project, and its own Postgres
database. It has no real crew data and its users are disposable.

## Consequences

- Every feature gets exercised on staging before crews see it, using the `/vet`
  protocol in [../VETTING_PROTOCOL.md](../VETTING_PROTOCOL.md).
- Promotion is a procedure, not a merge. It includes a user-migration script and an
  environment-variable check, both of which have caused incidents when skipped. The
  checklist is in [CLAUDE.md](../../CLAUDE.md).
- The two environments share one Google Sheet, which is why
  [ADR 0003](0003-staging-prod-sheet-tab-split.md) exists.

## What would break if you undid this

You would be testing on crew phones during a move. The first time an offline queue
regression ships, a crew loses a day of hours and nobody finds out until payroll.
