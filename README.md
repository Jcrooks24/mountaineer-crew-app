# Mountaineer Crew App

Field app for Mountaineer Moving's crews. Movers use it on their phones at the
jobsite; the office uses the data it produces to bill the job and run payroll.

**If you are new and inherited this system, read this page, then
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), then [CLAUDE.md](CLAUDE.md). That is
enough to reason about the system without reading source.** When something is on
fire, go straight to [docs/RUNBOOKS.md](docs/RUNBOOKS.md).

## What this system does, in plain English

A crew arrives at a job. On their phone they clock in, log the materials they
used, take photos, fill out a truck inspection (DVIR), capture a Bill of Lading
with the customer's signature, count the furniture, and log everyone's hours.
Long-distance jobs also record duty status (RODS) and per-diem pay.

All of it must work **with no cell signal**, because plenty of jobsites have
none. Writes go into a queue on the device and sync when signal comes back.

Once synced, every record is mirrored into **one Google Sheet**, which is what
the office actually reads to build the invoice and run payroll. The app's own
database is the system of record; the Sheet is the office's view of it.

## Where everything lives

| Thing | Where |
|---|---|
| Code | https://github.com/Jcrooks24/mountaineer-crew-app |
| Backend (API) | Render, one service for prod and one for staging. Root directory is `backend`. |
| Frontend (app) | Vercel, one project for prod and one for staging. Root directory is `frontend`. |
| Database | PostgreSQL (Render/Supabase), one per environment. Separate prod and staging databases. |
| Office's data | One Google Sheet. Prod writes to tabs like `Events`; staging writes to `EventsStaging`. |
| Photos, documents, signed BOL PDFs | Google Drive |
| Outbound email (password resets) | Postmark |
| Drive time, mileage, address lookup | Google Maps APIs (Directions, Distance Matrix, Places) |

The full inventory of accounts, keys, and who issues them is in
[docs/CREDENTIALS.md](docs/CREDENTIALS.md). **No secret values are stored in this
repo.** They live in the password manager and in each host's environment
variables.

## Branches (important)

- **`staging`** is the default branch. All work goes here first.
- **`main`** is production, on real crew phones. Only ever reached by an explicit
  promotion from `staging`.

Both hosts auto-deploy on push to their branch. Pushing to `main` puts code on
crew phones within minutes. The promotion runbook is in [CLAUDE.md](CLAUDE.md).

## Running it locally

Prerequisites: Python 3.11+, Node 20+.

```bash
# Backend (from the repo root)
cd backend
python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash
pip install -r requirements.txt
python scripts/run_migrations.py     # once, after pulling new migrations
uvicorn app.main:app --reload        # http://127.0.0.1:8000
```

With no `DATABASE_URL` set, the backend uses a local SQLite file (`backend/app.db`)
and a dev JWT secret. That is the intended local setup: you do not need Postgres,
and you do not need any Google credentials to boot. Features that call out to
Google (Sheets, Drive, Maps) degrade to a disabled state instead of crashing.

```bash
# Frontend (separate terminal, from the repo root)
cd frontend
npm install
npm run dev                          # http://127.0.0.1:5173
```

The frontend defaults to `http://127.0.0.1:8000` for the API. Override with
`VITE_API_URL` in `frontend/.env.local` if you need to point at staging.

Useful checks before you push:

```bash
cd frontend && npx tsc --noEmit && npx vite build
```

## Deploying

You do not run a deploy command. **Push to the branch and the host deploys it.**

- Push to `staging` → Render staging backend and Vercel staging frontend rebuild.
- Merge `staging` into `main` → production rebuilds. Do this only when explicitly
  promoting. Follow the promotion checklist in [CLAUDE.md](CLAUDE.md), which
  includes a user-migration step and an environment-variable check that have both
  bitten us before.

The Render **start command** is load-bearing and documented in
[CLAUDE.md](CLAUDE.md). It runs migrations in a separate short-lived process
before starting the web worker, and caps requests and concurrency. Do not
simplify it. The reasoning is in [ADR 0002](docs/decisions/0002-render-start-command.md).

## The rules that matter

These are non-negotiable and are enforced in review. Full text in
[CLAUDE.md](CLAUDE.md):

1. Offline-first. The app works with no signal and loses no data.
2. Everything synced lands in the Google Sheet, on the right tab per environment.
3. Crew auth (login, logout, password reset) keeps working end to end.
4. Jobs are identified by a unique key, never by name alone.
5. Field reliability beats cleverness. This is used by people carrying furniture.
6. No em dashes anywhere in the codebase or its output.

## Documentation map

| Doc | What it is for |
|---|---|
| [CLAUDE.md](CLAUDE.md) | The operating rules: branch policy, invariants, promotion runbook, environment checklist. Read by both humans and Claude Code. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | What the pieces are and how they talk. Start here to understand the system. |
| [docs/RUNBOOKS.md](docs/RUNBOOKS.md) | Step-by-step checklists for when something is broken. |
| [docs/CREDENTIALS.md](docs/CREDENTIALS.md) | Inventory of every account and key, what it does, how to rotate it. No secret values. |
| [docs/decisions/](docs/decisions/) | Why things are the way they are. Read before "fixing" something that looks wrong. |
| [docs/VETTING_PROTOCOL.md](docs/VETTING_PROTOCOL.md) | The pre-promotion test protocol (`/vet`). |

**These docs are also mirrored to Google Drive** as Google Docs, so you can read them on
a phone without cloning anything. A push to `staging` updates the Drive copy
automatically (`.github/workflows/sync-docs-to-drive.yml`). The mirror is one way: edit
the repo, never the Doc, because the Doc is overwritten on the next push.

## Who to call

<!-- TODO: fill these in. This is the single most important section of this file
     for a successor and the only one that cannot be reconstructed from code. -->

| Role | Who | Contact |
|---|---|---|
| Business owner / product decisions | TODO | TODO |
| Google Workspace admin (Sheet, Drive, Calendar, Cloud project) | TODO | TODO |
| Whoever holds the password manager emergency access | TODO | TODO |
| Accountant / payroll (consumer of this data) | TODO | TODO |
