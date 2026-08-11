---
description: Work the staging -> main promotion checklist. Surfaces every pre- and post-merge step and reports what is still outstanding.
---

You are running the promotion checklist for the Crew App. **Do not merge
anything.** This command's job is to surface state and tell the user exactly
what is outstanding. The merge itself happens only when they say "promote".

## Step 1: run the gate and the report

```
python scripts/promotion_gate.py --base-ref origin/main --report
```

That gives you: mechanical blockers, new env vars, Apps Script changes, and
sheet column changes. Start from its output, not from memory.

## Step 2: work `docs/PROMOTION_CHECKLIST.md` top to bottom

Read that file and go through all eleven sections. It is the source of truth for
what a promotion involves; this command is just the driver.

For each section, report one of: **done**, **outstanding (with the specific
action)**, or **needs the user's decision**. Do not report a section as done
unless you verified it in this session. "Probably fine" is outstanding.

## Step 3: things you must check by reading, not assuming

- `git log --oneline origin/main..origin/staging` in FULL for the patch note
  scope. A 100+ commit promotion cannot be summarized from the last few commits.
- `docs/RUNBOOKS.md` Known defects for anything tagged
  `STAGING ONLY, BLOCKS PROMOTION`.
- The **Carried over, still undone** section at the bottom of the checklist.
  Items land there when a previous promotion ended with something unfinished.

## Step 4: report

Give the user:

1. **Blocking** - what stops the merge today, and for each: fix it, or waive it
   with a reason. You cannot waive your own finding; the waiver is theirs.
2. **Manual steps they must do themselves** - env vars by platform and
   environment, Apps Script pastes, Postmark/OAuth config, in-app config.
   Be specific about WHICH environment each one goes in.
3. **Post-merge** - patch note draft, whether a mass crew email is warranted,
   branch repointing.
4. **What you could not verify** and why.

Then stop and wait. Offer to draft the patch note and the crew email; do not
send anything.

## Reminders that are easy to skip

- The Sheet is the office's source of truth. A sheet that silently stops
  mirroring is worse than an outage, because nobody notices.
- `apps_script/` is a fourth runtime CI does not deploy. A change there ships
  only when a human pastes it.
- Any folder/tab ID env var needs a DIFFERENT value per environment, or staging
  writes into production.
- A green gate is not a vet. Run `/vet` separately.
