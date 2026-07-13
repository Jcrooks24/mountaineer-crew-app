# 0002. The Render start command, and why it looks over-engineered

**Status:** Active. Do not simplify.

## Context

The Render instance has **512 MB of RAM**. We hit OOM kills repeatedly, across
multiple deploys, chasing what looked like several different bugs but was one class
of problem: too much resident memory in the web worker.

Two specific causes:

1. **Alembic ran at app startup**, inside the web worker process. Every migration
   module in the chain got imported and stayed resident. Once the chain passed
   roughly 24 modules, that import surface alone was enough to push the worker over
   the limit during boot.
2. **Unbounded in-flight requests.** Concurrent photo and document uploads stacked
   into memory with nothing capping how many could be in flight at once.

## Decision

The start command, on **both** the staging and production services:

```
python scripts/run_migrations.py && uvicorn app.main:app --host 0.0.0.0 --port $PORT --limit-max-requests 1000 --limit-concurrency 50 --timeout-keep-alive 5
```

- **Migrations run in a separate, short-lived process** that exits before uvicorn
  starts. The web worker never carries the Alembic import surface.
- **`--limit-max-requests 1000`** recycles the worker periodically, which caps any
  slow leak: unbounded module-level state, library caches, anything we have not
  found yet.
- **`--limit-concurrency 50`** bounds in-flight requests so concurrent uploads
  cannot stack into RAM.
- The app's `on_startup` hook **no longer runs Alembic.** If the schema is stale at
  boot, the first query that needs a missing column raises a clear
  `ProgrammingError`, which is far easier to diagnose than an OOM kill.

Render's root directory is `backend` on both services, so the working directory is
already `backend/` at start. Do not prefix the script path with `backend/`; you get
a duplicated path segment and the script is not found.

## Consequences

- A failed migration stops the deploy before uvicorn starts, which is what we want.
- Stale schema surfaces as an obvious error rather than a mysterious restart loop.
- The flags look like tuning knobs. They are not. They are the fix.

## What would break if you undid this

The 512 MB worker starts getting OOM-killed again, intermittently, under load,
which presents as random 502s and restart loops rather than as a memory problem.
We spent multiple deploys diagnosing this once. Do not pay for it twice.

If you change either flag, **document the reason here.**
