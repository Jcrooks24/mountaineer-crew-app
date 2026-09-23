# 0054 - Every release is copied to the owner's vault

Date: 2026-09-23
Status: Accepted

**Driving scenario:** The owner at intake, 2026-09-23, choosing the reason for the
backup:

> "If the GitHub account or repo were lost or locked, the business still has every
> file of what crews run."

They asked for it to happen "on every merge to main", and said it "doesn't need to
happen every push to github".

**User classes affected** (owner-confirmed 2026-09-23): **systems owner** only. No
crew or admin surface in the app changes.

**Assumption this rests on:** That the vault (`OneDrive\Desktop\Mountaineer Moving`)
syncs off the laptop, so the copy survives both a GitHub loss and a laptop loss. If
the vault stops syncing, or GitHub stops being the only place the code lives, this
is worth reopening.

## Context

GitHub is the only complete copy of the code. The `work` remote is an antiquated
mirror nobody pushes to. The owner's Obsidian vault already holds the business's DOT,
safety and training documentation, and is synced by OneDrive and Obsidian Sync.

## Decision

At every merge to `main`, `scripts/backup_to_vault.py` writes
`Crew App Backup/<date>_<main sha>/{main,staging}` into the vault, plus a
`Backup info.md` naming both commits. It is section 12 of
[PROMOTION_CHECKLIST.md](../PROMOTION_CHECKLIST.md), driven by `/promote`.

- **Pushed refs, tracked files only.** `origin/main` and `origin/staging`, via
  `git archive`. No git history, no `node_modules`, no local `.env` files.
- **Verified before it counts.** Each copy is extracted to a `.partial` folder,
  its file count is checked against `git ls-tree`, and only then is it renamed
  into place.
- **Newest five kept.** Older dated folders are deleted after a successful write.
  Folders not named by date are never touched.

## Alternatives rejected

- **A local git hook** on `main` moving. Automatic, but not versioned, only fires
  on this laptop, never fires for a merge done on GitHub, and fires on a plain
  pull.
- **A checklist line with the commands typed by hand.** No count check, and the
  steps get re-typed every release.
- **Every push to staging.** Staging moves many times a day; the release is the
  thing worth keeping.
- **Keep every snapshot.** About 21 MB a release, synced by OneDrive and counted
  against Obsidian Sync storage. Five releases back is the owner's chosen bound.

## Consequences

- A merge done outside `/promote` gets no backup until someone runs the script.
  The checklist is the only trigger.
- It restores files, not a repository. Rebuilding the repo from it loses history.
  If history matters, a `git bundle` is the next step, not more snapshots.
- It runs on the owner's laptop. Elsewhere, `CREW_APP_VAULT_BACKUP_DIR` points it
  at a folder, or the step is skipped and said so.
- Obsidian shows code files only with the Code Files community plugin, set up on
  2026-09-23.

## What would break if you undid this

- **Reading local refs instead of `origin/`:** the backup would claim to be the
  release while holding unpushed work, or missing it.
- **Dropping the count check or the `.partial` rename:** a half-written copy
  looks like a good one, and the prune step then deletes a real backup to make
  room for it.
- **Widening the prune to every folder:** anything the owner keeps in
  `Crew App Backup` by hand would be deleted.
- **Copying the working tree instead of `git archive`:** local `.env` files with
  secrets would sync through OneDrive.
