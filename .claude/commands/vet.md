---
description: Run the crew app's debugging & pre-promotion vetting protocol against a target
---

Run the Debugging & Vetting Protocol defined in `docs/VETTING_PROTOCOL.md` against:

**$ARGUMENTS**

If no target is given, vet the current git diff (`git diff` + staged changes). If the
argument names a surface (e.g. "long-distance mode", "BOL flow", "the timeline"), scope to that.

Follow the protocol exactly:
- Read `docs/VETTING_PROTOCOL.md` first and apply its rules.
- **Evidence first** - verify every claim by reading the file, building, or running an
  isolated test; cite the file:line / command / response. Do not assert from memory.
- Check the six Core Behaviors (offline-first/no-loss, cross-device continuity, Google
  Sheets sync, crew auth, job_uuid identity, field-grade mobile UX), the cross-cutting
  section (env vars, migrations, OOM-bounded resource use, security, build health,
  regression), and the code-level reliability checks (idempotency/upsert-by-device-UUID,
  async/threadpool teardown, server-side validation, scale/N+1, null handling, cross-device
  hydrate-on-mount).
- Use the standard evidence toolkit: `cd frontend && npm run build` (clean tsc + vite);
  backend `py_compile` on changed files (project venvs are broken - use a disposable venv +
  isolated stubbed unit tests for real import/endpoint checks); confirm a single Alembic head.
- Output: a **Passed (verified)** list and a **Findings** table
  (`# | Severity | Behavior # | Issue | Evidence | Fix`), promotion blockers separated from follow-ups.
- Confirm the working branch is `staging` (never `main` unless promoting).
- Offer to fix; apply only small, safe, high-confidence fixes unless told otherwise.
