# 0039 - Bulletin reaction mode is per post, owner-only, and reinterprets existing reactions

Date: 2026-08-13
Status: Accepted

## Context

The owner asked for one control on the Company Bulletin: a per-post switch that
turns the like button into a dislike button. Visible to their account only
(`j.a.crooks24@gmail.com`), invisible to everyone else. Other crew can then press
dislike on that post, and liking it is no longer possible.

Three things about this request needed deciding rather than assuming.

## Decision

### 1. The gate is one hardcoded address, checked server-side, and it 404s

The owner explicitly approved hardcoding the address for this feature. It lives
in exactly one constant, `BULLETIN_REACTION_MODE_EMAIL` in
`app/routers/bulletin.py`, and nowhere in the frontend.

The frontend hides the control using a `can_set_reaction_mode` boolean that the
SERVER computes and ships with each post. The client never holds the rule. Hiding
a button is a courtesy to the UI; the endpoint's own check is the permission, and
it runs on every call.

The endpoint returns **404, not 403**, to anyone else. A 403 tells the caller the
endpoint exists and that somebody is allowed to use it. The request was for a
control other users cannot see, and a discoverable "forbidden" is a weaker
version of that than "there is nothing here".

This is the only hardcoded identity in the app. Everything else is gated on role
or on a per-person flag an admin sets from the roster. It is a deliberate
exception for a personal control, not a pattern to copy. **Admins are refused**,
which is the mistake this feature invites: every other privileged action here is
role-gated, so "let admins do it too" looks like consistency and is not what was
asked for.

### 2. Switching reinterprets existing reactions rather than moving them

`bulletin_likes` stores "user X reacted to post Y". The new
`bulletin_posts.reaction_mode` column decides what that reaction is CALLED.
Switching a post changes the label, not the rows.

The consequence, stated plainly: **a post with 12 likes becomes a post with 12
dislikes, attributed to people who pressed Like.** They did not choose that.

This was put to the owner against the alternatives (keep the likes hidden, or
delete them) and chosen knowingly. Two things make it defensible:

- It is **completely reversible**. Nothing is moved or destroyed, so switching
  back restores the original 12 likes exactly. Delete-on-switch would not have
  been recoverable, and hide-on-switch would have meant two parallel counts to
  keep straight.
- The UI **says so before it happens**. The confirm names the count and states
  that it is not what those people pressed. A misattribution the operator has
  been told about is a choice; a silent one is a bug.

The symmetric case follows from the same rule and is worth knowing: dislikes
collected while switched become LIKES if the post is switched back. There is one
set of reaction rows and one label for them at a time.

### 3. Per post, never global

The switch is a column on the post. There is deliberately no bulletin-wide
setting, because a global "no likes anywhere" is a different product decision
about the feed's tone, and this was asked for as a per-post tool.

## Consequences

- One hardcoded address to change or delete when this stops being wanted, in one
  file, with `backend/scripts/verify_bulletin_reaction_mode.py` asserting it
  appears exactly once and never in the frontend.
- Reaction counts are not comparable across a switch. A post showing 12 dislikes
  may be showing 12 people who liked it. Anything that later reports on bulletin
  engagement must read `reaction_mode` or it will be wrong.
- `reaction_mode` is NOT NULL with a server default of `like`, so every post that
  existed before this behaves exactly as it did and no backfill was needed.
- Downgrading the migration drops the column and turns every post back into a
  like post. It destroys nothing, because the reaction rows were never touched.

## Alternatives rejected

- **A separate `bulletin_dislikes` table.** Cleaner in theory: likes and dislikes
  would be different things with different rows, and nobody would ever be shown
  as disliking a post they liked. Rejected because it makes the switch
  destructive in one direction or leaves two counts to reconcile, and the owner
  chose conversion when the trade was put to them.
- **Role-gating to admin.** Would have avoided a hardcoded address, but the
  request was for a control only one person can see, and there is more than one
  admin.
- **A config row or env var for the address.** More flexible, and rejected as
  ceremony: an env var that only ever holds one value is a hardcoded constant
  with an extra failure mode, and the owner asked for it hardcoded.
