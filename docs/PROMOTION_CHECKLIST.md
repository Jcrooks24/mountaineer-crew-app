# Promotion checklist (staging -> main)

Work through this on **every** merge to `main`. It is the human half of the
promotion; the machine half is `scripts/promotion_gate.py` (run that first, it
answers several of the questions below for you).

```
python scripts/promotion_gate.py --base-ref origin/main --report
```

`--report` prints the env-var diff, Apps Script changes, and sheet column
changes as an advisory block, so sections 2, 3 and 4 start from facts rather
than memory.

Order matters: **1-7 before the merge, 8-11 after.**

---

## 1. Run the gate, clear or waive every blocker

Duplicate ADR numbers, split migration chain, `[ ]` fields and open deviations in
`DATA_FLOW_STAGING.md`. A waiver is a `GATE-WAIVER: <check-id> <reason>` line in
that doc and needs a real reason. See RUNBOOKS "Promotion gate".

## 2. Sheets: is it still a true mirror of the server?

Two different questions, both required.

**a. Does the data still land in the right place?**

- Run `backend/scripts/sheet_integrity_check.py` against **prod**. Zero FAILs:
  no duplicate keys, no overwritten KEY column, no junk tabs. WARNs about
  columns not yet promoted are expected pre-promotion.
- Admin -> Advanced Settings -> **System Check, Sheet Syncs**: Sheets connected,
  every sync's tab exists, no recent export errors.
- Any NEW sheet sync must be in `SHEET_SYNC_REGISTRY` in `sheets_export.py`, or
  the health check cannot see it.

**b. Will new fields disturb existing columns?**

The gate diffs every `*_HEADERS` list against `main` and classifies each change:

- **NEW TAB** - no existing data to disturb. Safe.
- **APPEND** - columns added at the end of the list. Safe.
- **MID-LIST INSERT** - columns added in the middle. **Not corruption, but read
  this:** `_ensure_tab` reads the sheet's *actual* header row and appends only
  missing columns to the right, then `_build_row` maps positionally against that
  real order. So existing prod rows do **not** shift. What it does mean is that
  prod's tab ends up in a different **column order** than a freshly created tab
  on staging. The two environments stop being visually identical, and anyone
  reading column letters (or an Apps Script that hardcodes a column index) will
  be wrong on one of them.

  So on a mid-list insert: confirm nothing downstream addresses that tab by
  column letter or index, and decide whether you want to reorder the prod tab by
  hand to match.

> Currently flagged: `BOL_HEADERS` inserts 11 columns (`shipment_number` through
> `agreed_delivery`) after `item_count`. Prod's BOL tab will get them appended at
> the far right instead. `JOB_REPORT_HEADERS` is a clean append.

## 3. New environment variables

The gate prints variables read on `staging` but not on `main`. **It only catches
literals** - `os.getenv("FOO")`. Variables read through a constant
(`os.getenv(DQ_FOLDER_ID_ENV_VAR)`) are listed separately from the
`*_ENV_VAR = "..."` declarations, but a var built by string concatenation will be
missed. Check `docs/CREDENTIALS.md` too.

For each one, record **which platform and which environment**:

| Variable | Platform | Environment | Set? |
|---|---|---|---|
| | Render / Vercel | staging / prod / both | |

Anything with a folder or tab ID needs a **different value per environment**, or
staging writes into production. That is the single most common way this list
hurts you.

> Currently outstanding: `ALERT_EMAIL`, `SHEETS_BUGS_TAB`,
> `SHEETS_FEATURE_REQUESTS_TAB`, `DRIVE_DQ_FOLDER_ID` (prod value needed; must
> NOT be the same folder as staging).

Also re-run the standing post-promotion env checks in CLAUDE.md: `FRONTEND_URL`,
`JWT_SECRET`, `DATABASE_URL`, Postmark token on Render prod; `VITE_API_URL` on
Vercel prod.

## 4. Apps Script

`apps_script/` is **a fourth runtime that CI does not deploy.** The files here are
the source of truth; what actually runs is whatever has been pasted into the
Sheet's script editor. A change here is not shipped until somebody pastes it.

The gate lists files changed between `main` and `staging`. For each:

- [ ] Opened the correct Sheet -> Extensions -> Apps Script
- [ ] Pasted the new contents, saved
- [ ] Confirmed the trigger still exists and is on the right schedule
- [ ] Ran it once by hand and checked the execution log

> Currently outstanding: `apps_script/nightly_crew_email.gs` is modified on
> staging and must be pasted after promotion.

## 5. Postmark / OAuth manual configuration

- **Postmark:** is the prod server token set on Render prod (not staging's)? Is
  the `SMTP_FROM` sender verified in Postmark for the prod domain? A new
  recipient domain does not need setup; a new *sender* does.
- **Google OAuth / service account:** any new Drive folder or Sheet must be
  shared with the service account, or writes fail with a 404 that reads like a
  missing file. Any new API scope requires re-consent.
- Check `docs/CREDENTIALS.md` for what each account is and what breaks without it.

## 6. Email workflow inventory

Every path in the app that results in a sent email. Confirm each still works
after promotion, and that the **sender** is the prod sender.

| Trigger | Tool | Sender | Recipient |
|---|---|---|---|
| Password reset request | Postmark (`core/mailer.py`) | `SMTP_FROM` | The crew member resetting |
| Admin "send test email" | Postmark | `SMTP_FROM` | Address typed by admin |
| Signed BOL delivery | Postmark | `SMTP_FROM` | The customer on the BOL |
| DVIR mechanic sign-off needed | Postmark | `SMTP_FROM` | `mechanic_email` on the DVIR |
| Bill/job-hour correction initialing | Postmark | `SMTP_FROM` | The affected crew member (per job) |
| Payroll notifications (2 paths) | Postmark | `SMTP_FROM` | The affected crew member |
| Nightly crew feedback + incidents digest | **Apps Script** `MailApp` | The Google account that owns the script | Office |

Note the last row: it is the only one that does **not** go through Postmark, does
not use `SMTP_FROM`, and is not deployed by CI. It is the one most likely to be
silently broken after a promotion.

## 7. Backlog check

Before merging, confirm nothing half-finished is riding along:

- `docs/RUNBOOKS.md` **Known defects** - anything tagged `STAGING ONLY, BLOCKS
  PROMOTION` must be fixed or explicitly waived.
- `docs/INCREMENTAL_WORK.md` - opportunistic items do NOT block, by design.
- Any feature batch in flight that should land whole rather than split across two
  promotions.

---

## 8. In-app configuration, post-merge

Config that lives in the database, not the code, and therefore does **not** come
across with the merge:

- [ ] **Skill raters.** ADR 0014: `crew_lead` does not grant skill rating. Every
      prod crew lead who should keep rating needs the **Skill rater** toggle set
      in Admin -> roster. The user-migration script is `ON CONFLICT DO NOTHING`
      and will not do it. Do it in the same sitting or leads quietly lose the
      feature overnight.
- [ ] **Reimbursement / per-diem rates** (ADR 0033) exist in prod SystemConfig.
- [ ] **DQ document type catalog** matches what the office expects.
- [ ] **Anything left undone from a prior merge** - check the bottom of this file.

## 9. Patch note

Draft in Admin -> Patch Notes. Scope must cover **every** change in the
promotion, not just the headline feature. For a 100+ commit promotion, read
`git log --oneline origin/main..origin/staging` in full.

Cover: new features, bug fixes, and **any workflow change** - anything where the
crew's existing muscle memory now leads somewhere different. Workflow changes
matter more than features; a crew member who cannot find a button assumes the app
is broken.

No em dashes (company invariant).

## 10. Mass crew email

Required when the promotion changes **where things live** or **how a task is
done**, not merely when it is large. A hundred commits of backend hardening needs
no email. One moved button does.

Include: what changed, what they should do differently, what to do if something
looks wrong, and who to contact.

## 11. Repoint anything that tracks a branch

- [ ] Render **Cron Job** for the sheet integrity check: switch Branch from
      `staging` to `main` once `main` has the script.
- [ ] Any other Render/Vercel service pinned to `staging`.

---

## Carried over, still undone

Items that were on a previous promotion's list and never got done. **Clear this
section as part of the promotion, or explain why it is still here.**

- _(nothing carried over yet - this section starts empty and is populated when a
  promotion ends with an item unfinished)_
