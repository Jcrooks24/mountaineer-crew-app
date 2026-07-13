# 0009. The logged-in user is cached, and cleared only on an explicit 401 or 403

**Status:** Active. The asymmetry is the point.

## Context

The app boots at a jobsite with no signal. The standard pattern is: on mount, call
`/api/auth/me` to find out who the user is; if it fails, treat them as logged out
and redirect to the login screen.

At a no-signal jobsite, that call **always** fails. Which means the standard pattern
logs the entire crew out precisely when they need the app and cannot possibly log
back in.

## Decision

1. The last successful `/api/auth/me` response is cached in localStorage
   (`mm_user_cache_v1`).
2. On boot, if a token exists, the user is **seeded from that cache synchronously**
   and `loading` starts as `false`. The crew lands in the app, not on the login screen.
3. `loadMe()` revalidates in the background, on mount and on `online`.
4. **`loadMe()` clears the user only on an `ApiError` with status 401 or 403.** A
   network failure (a `TypeError`, "Failed to fetch") **preserves** the cached user.

That asymmetry is the whole decision. "The server told me you are not authorized" and
"I could not reach the server" are completely different facts, and only the first one
justifies logging someone out.

The token itself is a 90-day JWT in localStorage. There is no refresh token and no
client-side expiry check, which is deliberate: a refresh flow that requires the
network is useless in the field.

## Consequences

- The app trusts a cached identity offline. This is acceptable because the token is
  still required for every actual server write, so a stale cached user cannot do
  anything privileged without the server agreeing.
- **Identity change is handled explicitly:** if `/me` returns a different user id than
  the cached one, `clearCrewState()` runs *before* adopting the new identity. That is
  the shared-phone case, and without it crew member A's queued materials would sync
  under crew member B's name.
- `apiFetch` clears the *token* on any 401, but not the AuthContext user. So the app
  can briefly sit in a "logged-in UI, no token" state until the next `loadMe()`
  resolves it. Queued work survives this, because `loadMe()`'s 401 path does not call
  `clearCrewState()`. Only an explicit logout does.

## What would break if you undid this

Treating a network failure as a logout empties the crew's screen at every no-signal
jobsite, and since they cannot log back in without signal, they are locked out of
their own timesheet for the day. Also note that a logout **deletes unsynced photos
and reimbursements**, so auto-logging-out on network failure would destroy field work.
