# Product requirements, as stated

What each capability of this app is **for**, and **who** it serves, in the
owner's own words.

This document writes itself. It is the accumulated output of the second and
third questions of [INTAKE_PROTOCOL.md](INTAKE_PROTOCOL.md), one entry at a
time, as changes get made. It was deliberately not drafted up front, because a
product document written by the person reading the code is a reconstruction, and
a reconstruction is the exact thing this document exists to not be.

## The one hard rule

**Nothing enters the body of this document that the owner did not say.**

- No inference, no reconstruction, no "presumably", no filling a gap because the
  gap looks bad. A line that was never stated is **absent**, not guessed.
- Every stated line carries **who said it and when**.
- The assistant may put words in this document only two ways: by quoting the
  owner, or by offering a confirm multi-select in which each option is **the
  exact sentence that would be written here**, so choosing one is approving the
  text rather than approving a direction.
- What is not yet known goes in **Open questions** at the bottom of its entry.
  That list is a worklist for future intake, not content, and it is never
  promoted to a stated line without an answer.
- **Mechanical facts are not statements of intent.** Which files exist, which
  ADR touches which surface, and which routes are in the app can be recorded as
  facts with a citation. They are not purposes, and they never fill a Purpose
  line.

## What this is, next to the decision log

Settled 2026-09-09, so the same sentence is never written in both places:

- **This document owns WHAT a capability is for and WHO it serves.** That
  sentence lives here and only here.
- **[docs/decisions/](decisions/) owns WHICH approach was taken and why not the
  alternative.** An ADR links up to its capability entry here rather than
  restating the scenario.
- Most ADRs are technical and belong to no capability. They stay where they are
  and get no entry here.
- Each entry lists the ADRs beneath it, as the decisions behind it.

## When a new answer contradicts a stated line

Every answer is checked against this document, against the `[confirmed]` lines
in [USER_PROFILES.md](USER_PROFILES.md), against ADR driving scenarios and
assumptions from 0046 on, and against answers given earlier in the same session.
The full rules are the **contradiction check** in
[INTAKE_PROTOCOL.md](INTAKE_PROTOCOL.md).

When one fires: surface both lines with their dates, stop, and wait. The prior
line has to be quotable with its date, or it is not a flag.

On the owner's call, the old line moves into the entry's **Superseded** block
with the date it was replaced. It is never deleted, and there is no separate
reversals log: the history lives inside the entry it belongs to. A document that
shows only the current answer hides the fact that the direction changed, which
is the same hole the rest of this protocol closes.

## Entry template

```
### <Capability>

**Purpose** (owner, YYYY-MM-DD): what it is for, in their words.
**Serves**: user classes, per USER_PROFILES.md, and what each one does with it.
**Driving scenario** (owner, YYYY-MM-DD): the real situation behind it.
**Out of scope, deliberately** (owner, YYYY-MM-DD): what it is not for.
**Decisions behind it**: ADR links.
**Open questions**: what intake has not asked yet.
**Superseded**: dated lines this entry used to carry.
```

---

# The capabilities

Every entry below is currently **unstated**. The inventory itself is a
mechanical fact (these are the app's surfaces, per `frontend/src/main.tsx` and
`frontend/src/pages/`), and the areas match the Coverage ledger in
[SANITY_CHECK_PROTOCOL.md](SANITY_CHECK_PROTOCOL.md) so that the two ledgers and
the ADR review ledger stay aligned.

Purposes fill in as intake runs, and from the ADR review draining the backlog:
when a reviewed decision turns out to rest on something the owner states in
their own words, that statement becomes a line here.

| # | Capability | Purpose stated? |
|---|---|---|
| 1 | Auth and account | not yet |
| 2 | Job capture and timeline | not yet |
| 3 | Time capture siblings (off-job, office, availability, LD workday) | not yet |
| 4 | Long-distance mode | not yet |
| 5 | Vehicle and DVIR | not yet |
| 6 | Money out (reimbursements, materials) | not yet |
| 7 | Customer paperwork (BOL, inventory, signature, documents) | not yet |
| 8 | Photos and incidents | partly, 2026-09-11 |
| 9 | Estimating | not yet |
| 10 | Payroll and close-out | not yet |
| 11 | Roster, skills, DQ files | not yet |
| 12 | Admin job summary and notes | not yet |
| 13 | Crew comms (bulletin, directory, patch notes) | not yet |
| 14 | Feedback intake (bug reports, feature requests) | not yet |

---

### Photos and incidents

**Purpose** (owner, 2026-09-11): "A lost job photo is not recoverable later, and
damage photos are what a claim rests on." Stated as the consequence of losing
one, which is the only part of the purpose intake has drawn out so far. What the
photo tool is *for* in the positive sense, beyond evidence for a claim, is still
unstated.

**Serves**: Mover and Crew lead take the photos and are the only people holding a
copy until it uploads. Admin depends on them for claims and cannot see that a
photo was ever attempted, so a loss is invisible from the office side.

**Driving scenario** (owner, 2026-09-11): "A crew member added photos to a job,
pressed Save, and got a red error they could not act on. The photo was gone: not
in the tray, not in Saved, no Retry. The exact sequence that led to it was not
captured."

**Out of scope, deliberately**: not yet stated.

**Decisions behind it**:
[ADR 0017](decisions/0017-offline-queues-store-bytes-not-file-handles.md),
[ADR 0048](decisions/0048-a-photo-is-durable-when-it-is-taken-not-when-it-is-saved.md).

**Open questions**: what the tool is for beyond claim evidence; whether
before/after photos serve a different job from damage photos and should be
treated differently; whether unsaved photos should expire off a device, and after
how long.

---

## Product-level questions nobody has answered yet

These are the questions the intake will ask when the relevant work comes up.
They are recorded here so the document knows what it is missing, which is
different from filling the gap.

- What is this app for, in one sentence, as opposed to what it does?
- Which of the 14 capabilities above are load-bearing to the business, and which
  exist because they were easy to build?
- What is deliberately **not** this app's job, and belongs to the Sheet,
  QuickBooks, or a conversation?
- Which capability, if it disappeared tomorrow, would stop a job from happening?
- What does the app need to become for the M1 merger, if anything?
