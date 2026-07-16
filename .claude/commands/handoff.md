---
description: End-of-session documentation maintenance pass - keep the bus-factor docs true
---

Run the documentation maintenance pass for this session's work.

**Scope: $ARGUMENTS** (if empty, use everything changed this session: `git diff main...HEAD`
plus uncommitted changes, and the substance of this conversation.)

The goal is simple and narrow: **someone who has never seen this system must be able to
run it from the repo alone.** Every session either keeps that true or erodes it. Do not
write documentation for its own sake, and do not restate what the code already says.

## 1. Determine what actually changed

Read the diff. Do not work from memory of the conversation; the diff is the fact.

## 2. Check each doc against the diff, and update only what is now wrong

Work through these in order. For each, state explicitly whether it needs a change and why.
"No change needed" is a valid and common answer - say it and move on.

- **`README.md`** - Did setup, local dev, or deploy change? Did a new top-level capability
  appear that the plain-English paragraph no longer covers?
- **`docs/ARCHITECTURE.md`** - Did a service, integration, data store, background job, or
  queue appear or disappear? Did a data flow change? Does the Mermaid diagram still match
  reality?
- **`docs/CREDENTIALS.md`** - **Did this change add or remove ANY environment variable,
  secret, API, or Google Cloud API dependency?** This is the highest-value check on the list
  and the easiest to forget. A new env var that is not in this table is a deploy that breaks
  for the next person. Never put a secret value here, only its name and what it gates.
- **`docs/RUNBOOKS.md`** - Did we hit a new failure mode, or diagnose an existing one more
  cheaply? Add or sharpen the checklist. **Did we find a bug we did not fix? Add it to
  Known defects.** Did we fix one that is listed there? Delete the entry.
- **`docs/decisions/`** - Apply the one test in `docs/decisions/README.md`: *would a
  competent person, seeing this for the first time, be tempted to undo it?* If this session
  produced such a decision, write the ADR now. Number it sequentially and add it to the
  index table. Be honest about consequences and about what would break if it were reverted.
- **`CLAUDE.md`** - Did a durable operating rule, invariant, or gotcha change? This file is
  the operating manual, not a changelog. Only durable rules belong here.
- **`docs/VETTING_PROTOCOL.md`** - Did we learn a check that should run on every future
  change?

## 3. Report

Give a short table: doc, changed or not, one-line reason. Then list anything you chose
**not** to document and why, so the user can overrule you.

## Rules

- **Evidence first.** Verify against the code before asserting anything in a doc. A
  confidently wrong runbook is worse than a missing one, because the next person trusts it.
- **Docs change in the same commit as the code they describe.** Not "later".
- **No em dashes** (ADR 0011).
- **No secret values in the repo, ever.** Names and purposes only.
- Prefer deleting a stale sentence over adding a new one. These docs earn their keep by
  being short enough that people actually read them.
