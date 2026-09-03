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

## Addendum, 2026-09-03: "can you identify a cause" is derived, not asked

A review of the whole section found the step-3 gate doing more harm than good,
and it is removed. The stepper is now: ran differently -> which way -> the three
cause questions -> note.

**Why it was wrong to ask.** It asked the crew to commit to "can you reasonably
identify what caused it?" **before showing them a single option**, which nobody
can answer honestly. And nothing ever recomputed it: answering Yes and then No to
all three cause questions stored `variance_cause_identified = true` with an empty
cause list, so the Sheet showed "Cause identified: Yes" beside a blank Reasons
column. The office read a claim the data did not support, which is the exact
failure the tri-state export was built to prevent.

**Three Nos is "we cannot say."** The flag is now computed from the three answers
(`deriveCauseIdentified` in `lib/closeout.ts`): any named cause is `true`, three
Nos is `false`, anything in between is `null`. Same stored field, same tri-state
column, and it can no longer contradict the answers it summarises.

The honest-answer property this ADR argued for is kept, not dropped. A crew that
cannot name a cause still has somewhere to go, and it is still stored and still
distinguishable from an unfilled form. It is now reached by answering the
questions rather than by predicting how they will be answered.

Also in the same pass:

- **The scope editor opens only under "Scope added on site" / "Scope reduced on
  site"** (`isScopeCause`). It used to open under ANY site cause, so picking
  "Client not ready" was answered with "was anything added or dropped?" - the
  longest sub-form in the close-out, offered right after the crew said the
  problem was something else.
- **The three cause questions advance when answered**, like every other question.
  They were the only ones that did not, which reads as a stuck button. The one
  exception is a cause that opens the scope editor, which the crew would never
  see if the card advanced out from under it.
- **A Yes with no cause picked yet is held**, so the press is not lost when the
  crew looks at another question. `pending` held only one bucket at a time, so a
  Yes on a second question silently un-pressed the first.
- **A cause question with no direction chosen** prompts back to the direction
  question instead of rendering an empty card.

**Do not re-add a "can you identify a cause" question.** If the answer is wanted
earlier in the flow, derive it and display it; asking it twice is how the two
answers start disagreeing, which is what this ADR's original half fixed.
