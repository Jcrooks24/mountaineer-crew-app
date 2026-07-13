# 0004. The staging-to-prod user migration is `ON CONFLICT DO NOTHING`

**Status:** Active.

## Context

Crew members get created on staging during testing. When we promote to production,
anyone who exists only on staging would otherwise have to re-register on prod,
which means a crew member standing in a driveway unable to log in.

So `backend/scripts/migrate_users_staging_to_prod.py` copies users (email, password
hash, name, role, active flag, profile photo) from the staging database to the
production database as part of the promotion runbook.

The question was what to do when a user exists in **both** databases.

## Decision

**`ON CONFLICT (email) DO NOTHING`. Production wins.**

The script is idempotent and safe to re-run. It only ever adds users who are missing
from prod; it never overwrites an existing prod user with staging's copy.

## Consequences

The consequence is not obvious and has confused us before, so state it plainly:

**A crew member who changed their password on staging during testing keeps their
old production password.** The change does not carry over. They sign in on prod with
the password they had before, or they reset it.

This is correct. The alternative (staging wins) would mean a throwaway test password
set on staging silently becoming someone's real production password, which is worse.

## What would break if you undid this

Switching to `DO UPDATE` would let staging test data overwrite real production
accounts: a role downgraded during testing, a name changed for a test case, or a
disposable password becoming the real one. Prod is the system of record for people.
Staging is not allowed to write to it.

## Related

The other half of a post-promotion lockout is `FRONTEND_URL`, not this. See
[../RUNBOOKS.md](../RUNBOOKS.md#someone-is-locked-out).
