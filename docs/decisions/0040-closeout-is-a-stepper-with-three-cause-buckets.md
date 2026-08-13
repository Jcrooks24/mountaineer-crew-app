# 0040 - Close-out is a stepper with three cause buckets

Date: 2026-08-13
Status: Accepted
Supersedes parts of [ADR 0028](0028-closeout-reasons-are-multi-select-and-bidirectional.md)

## Context

The office reviewed the job wrap-up close-out in use and found three problems.

**Two questions asked the same thing twice.** "Was the client ready when you
arrived?" duplicated the `client_not_ready` chip under the variance question, and
"Anything added or changed on site?" duplicated `scope_added_on_site`. A crew
member could answer a pair inconsistently, and both answers reached the office as
fact with nothing to say which was meant.

**One flat cause list buried the distinction the office needs.** All 13 causes sat
in a single multi-select. But the same delay means three different things: a
client who was not ready is an estimating problem, traffic in the canyon is
nobody's problem, and a leaking lift gate is a maintenance ticket. A flat list
made them look alike.

**The close-out was a scroll, not a line of questioning.** Every question was
visible at once regardless of whether it applied.

## Decision

### 1. One narrowing flow, presented as a stepper

```
1  Did the job run differently than quoted?     No  -> ends here
2  Which way, longer or shorter?
3  Can you reasonably identify the cause?       No  -> ends here
4  Site and client conditions?      Yes -> pick one   (+ scope changes)
5  Travel and conditions?           Yes -> pick one
6  Crew and equipment?              Yes -> pick one
7  Anything to add                  (optional note)
```

The stepper wraps the close-out only. The rest of the job report stays a scroll:
the office asked whether the whole report should become a wizard and chose to see
this pattern work in the field on one section first.

### 2. Step 3 exists so "we do not know" has somewhere honest to go

Without it, a crew that genuinely cannot say why the day ran long has two moves:
leave everything blank, or pick something plausible. The first is
indistinguishable from not filling the form in. The second puts a fabricated
cause into the office's data, which is **worse than silence** because it reads as
a real signal.

`variance_cause_identified` is stored as a nullable boolean precisely so NULL
("nobody answered") and FALSE ("the crew looked and cannot say") stay distinct.

### 3. Three bucketed single-select questions, not one flat multi-select

This is a deliberate narrowing from ADR 0028, which made the causes multi-select
on the grounds that a long day usually has more than one cause. That is still
true. The office chose the trade anyway: one dropdown answers "what was the
cause", a multi-select answers "what were all the contributing factors", and only
the first is countable across jobs. The optional note on step 7 is where a day
with two site problems gets described.

The three buckets share the existing `variance_causes` column rather than adding
three. A bucket is a property of the option (`Option.bucket`), so every report
ever saved still reads back correctly and the Sheet column is unchanged.

### 4. Direction and "ran differently" become stored answers

`variance_direction` was previously LOCAL STATE, reconstructed on load by finding
the first stored cause that carried a direction - and **defaulting to "more" when
it could not tell**. A report whose only cause was "Other" told the office the
job ran long, on no evidence.

It is now one column with three meanings, which is why there is no separate
`ran_differently` boolean:

| Value | Meaning |
|---|---|
| NULL | nobody answered |
| `as_quoted` | the crew answered, and it ran as quoted |
| `more` / `less` | the crew answered, and it differed this way |

Without `as_quoted`, "answered No" and "not answered" would both collapse to an
empty direction with no causes - the same ambiguity, moved one question earlier.

### 5. Retired questions keep their columns and their labels

`client_readiness` and `client_unready` are gone from the form but still stored,
still returned by the API, still exported, and still rendered in the recap when an
old report carries them (labelled "retired"). A year of reports and a year of
Sheet rows carry values; deleting the vocabulary would render them as raw keys.

Every retired cause key also stays in the backend's `VARIANCE_CAUSES` allow-list.
That set is a validator, not a menu: dropping a key would make a re-save of an
untouched old report fail on data the crew never entered and cannot see.

## Consequences

- Expect `client_readiness` blank on new reports and populated on old ones. That
  is not a sync fault, and anything reporting on that column must handle both.
- Causes are no longer comparable across the change. Before 2026-08-13 a report
  could carry several causes from one bucket; after, at most one per bucket.
- Two new columns (`variance_direction`, `variance_cause_identified`), both
  nullable, no backfill. Backfilling a direction from existing causes would
  recreate exactly the guess this removes.
- Two new Sheet columns, appended, so existing rows and formulas are undisturbed.
- Scope changes survive but are no longer a top-level question: they appear under
  the site-and-client question once a cause is chosen. The per-change hours field
  is why they were kept at all - it is the one close-out number that maps to
  billable time.

## Alternatives rejected

- **Dropdown plus a per-question note.** Offered; the office chose dropdown only,
  with the single note at the end. Flagged at the time that their own examples
  ("lift gate hydraulics began leaking") are more specific than any dropdown
  holds, which is what step 7 is for.
- **Removing scope changes entirely.** Would have lost the hours estimate, the
  only close-out figure tied to billable time.
- **Making the whole job report a wizard.** What was literally asked for, and
  deferred by choice: it is a rebuild of the app's biggest screen and every field
  crews use daily. Revisit once the close-out stepper has been used in the field.
