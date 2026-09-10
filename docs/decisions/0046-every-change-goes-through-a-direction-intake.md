# 0046 - Every change goes through a direction and context intake, with no size exception

Date: 2026-09-09
Status: Accepted

**Driving scenario:** The owner asked for a protocol that makes the assistant
stop and ask before executing, and that captures why a direction was chosen
while the reason is still in someone's head. Four reasons were given for making
it unconditional rather than scoped to large changes, and all four were
selected: the judgment call about what is "big enough" is itself the leak; the
bad assumptions historically entered through changes that looked too small to
question; the record's value is in being complete, because holes cannot be
identified after the fact; and a rule with exceptions gets negotiated away over
time, while an unconditional one survives a busy week.

**User classes affected:** None directly. This governs the assistant's behavior,
not the app. Indirectly all of them, since its output is
[USER_PROFILES.md](../USER_PROFILES.md), which is where every class's real-world
use gets recorded.

**Assumption this rests on:** That the per-change cost of asking is small enough
to pay every time, given the "ask, then proceed on work no answer could change"
allowance. If intake starts visibly slowing ordinary work, that assumption has
failed and this ADR is reopened rather than quietly ignored.

## Context

The documentation in this repo is unusually strong on **what exists** and
**whether it is safe to change**. It has been weak on **why a direction was
chosen at the moment of choosing it**. ADRs got written after the fact, from the
code, by the person who already knew the answer. That produces an accurate
record of the decision and a thin record of the situation the decision was
answering, which is the half that cannot be reconstructed later.

The same gap shows up in reverse when an old ADR is questioned. Without a stated
founding assumption, there is no way to establish whether a decision is stale.
It can only be re-argued from taste, usually by someone who has forgotten the
operational problem it solved. ADR 0019 (the estimate-to-job link, removed after
being built) and ADR 0028 to 0040 (close-out reshaped once the first version met
the field) are both cases where the situation drove the answer and the situation
was the part that had to be recovered by hand.

The obvious design was to scope the intake to changes big enough to warrant it.
That was offered and rejected, for reason 1 above: the scoping decision is
exactly the discretion that leaks.

## Decision

**Every change goes through the intake in
[INTAKE_PROTOCOL.md](../INTAKE_PROTOCOL.md) before execution.** Four questions:
direction as a multi-select of genuinely different options; the crew or admin
real-world scenario driving the choice; which user classes it touches and how;
and any follow-up the answer's grade calls for.

Supporting rules, each decided rather than assumed:

- **Answers are graded against four criteria** (concrete, causal, bounded,
  checkable later) and **the grade is surfaced only when it falls short**. A
  sufficient answer is accepted silently. When it falls short, the missing
  criterion is named in one line, followed by either a multi-select of
  extrapolated readings, each phrased as the sentence that would enter the ADR,
  or one targeted question. **One follow-up round, never two**, because a second
  round trains the owner to give short answers to escape it.
- **On small changes, the questions go out and work continues only on what no
  answer could change**: reading code, reproducing, writing the failing test,
  build and branch checks. Nothing is committed before answers land, and work
  invalidated by an answer is discarded without being argued for.
- **Every ADR from this one onward carries three extra lines**: driving
  scenario, user classes affected, and the assumption it rests on. The third
  makes the retro review possible.
- **The answers accumulate into [PRD.md](../PRD.md)**, a capability ledger whose
  body may contain **nothing the owner did not say**. It was not drafted up
  front and was not bulk imported from these 45 ADRs, because their stated
  reasons were largely reconstructed from the code, which is the failure mode
  the PRD exists to avoid. The owner's framing: it is backwards for the work to
  specify the keystone document, and it creates itself from the answers anyway.
  **The PRD owns what a capability is for and who it serves; an ADR owns which
  approach was taken and why not the other, and links up to its PRD entry.** The
  same sentence is never written in both. Most ADRs here are technical, belong
  to no capability, and get no PRD entry.
- **Past ADRs get re-examined on two triggers**, both active: opportunistically
  in the area being worked, and by a scheduled oldest-first sweep of the ADR
  review ledger. A decision founded on something no longer true is **superseded
  by a new ADR, never quietly edited**, because the fact that the assumption was
  wrong is the most useful thing in the record.
- **Every answer is checked for contradictions, and a hit stops the work**
  (added 2026-09-09, same day, at the owner's request; see the section in the
  protocol). Checked against the stated record and against answers earlier in
  the same session. **Not** checked against the code, the data, or pre-protocol
  commit history: a stated belief disagreeing with the Sheet is a `/sanity` or
  `/debug` finding rather than a contradiction, and old commit text is mostly
  the assistant's words, so flagging the owner against it would discredit the
  check. Two categories earn a flag, direct conflict and scope tension, and the
  prior line must be quotable with its date or it is not a flag at all. The
  owner's reasons: they answer in whatever framing the question arrives in, so
  the same question can be ruled opposite ways hours apart without either
  feeling wrong; a reversal should surface as it happens rather than be found
  later as two documents that disagree; and a record that contradicts itself is
  worse than none, because the next person builds from whichever line they read
  first. A fourth candidate reason, scope creeping one step at a time, was
  offered and **not** selected, which is why the check is framed around keeping
  the record honest rather than around gatekeeping scope.
- **Two carve-outs, both about safety rather than size:** active data loss is
  stopped first and asked about after, and the owner may waive intake for a
  specific change, with the waiver noted in the commit message.

## Consequences

- Every change costs at least one round trip before code is written. This is the
  point, and it is also the risk: see the assumption above.
- ADRs stop being written from the code after the fact. The Context section is
  now the owner's own words, captured before the work.
- [USER_PROFILES.md](../USER_PROFILES.md) accumulates. It starts almost entirely
  `[inferred]` from the SOP and the code, and each intake converts a few lines to
  `[confirmed]`. The early rounds will spend most of their questions there.
- [PRD.md](../PRD.md) starts almost empty and stays that way until enough intake
  has run to fill it. That is the intended cost of the no-assumptions rule: an
  honest short document rather than a plausible long one. Its backlog drains
  through the ADR review, one block at a time, and only via answers.
- The ADR review ledger creates ongoing work that competes with features. It is
  deliberately paced at one block per session, like
  [INCREMENTAL_WORK.md](../INCREMENTAL_WORK.md).
- The assistant loses the ability to "just fix it quickly". A one-line fix now
  posts questions first. That friction is the mechanism, not a side effect.

## What would break if you undid this

Reverting to "ask only when it seems important" restores the discretion that
reason 1 identifies as the failure. The visible symptom would not be a bad
change; it would be the slow return of ADRs written from the code, and decisions
whose founding assumption nobody can name, which is the state this repo was
already climbing out of.

Removing only the three extra ADR lines would be the quieter version of the same
mistake: the retro review has nothing to check against, and stale decisions
become undetectable again.
