---
description: Run the direction and context intake before making a change, or retroactively on a past decision
---

Run the intake in `docs/INTAKE_PROTOCOL.md` for:

**$ARGUMENTS**

If no target is given, run it on whatever change is being discussed. If the argument names
an ADR or a block from that doc's **ADR review ledger**, run the retro review instead: check
the founding assumption against today, and ask the capability question for any product
decision in it.

**This protocol is not optional and has no size exception** (ADR 0046). It applies to a
one-line defect fix the same as a feature. The reasons are the owner's: the judgment call
about what is big enough is itself the leak, small changes are where the bad assumptions
entered, the record's value is in being complete, and a rule with exceptions gets negotiated
away. The only carve-outs are active data loss (stop it, ask after) and an explicit waiver
from the owner, which gets noted in the commit message.

## Ask, in one round where possible

1. **Direction, as a multi-select.** Two to four genuinely different options, recommendation
   first and labeled, each saying what it costs and **what it forecloses**. Never an open
   "what would you like?" - you just read the code, you are the one who knows the branches.
   If there is honestly one sane approach, say so and ask for a yes or no instead of
   manufacturing alternatives.
2. **The reason: what crew or admin real-world scenario drives this?** Who, doing what,
   when, and what goes wrong today. This is the highest-value output of the whole protocol,
   because it is the only part nobody can reconstruct from the code later.
3. **Which user classes does this touch, how, and why?** The answer updates
   `docs/USER_PROFILES.md` in the same commit.

## Then grade the answers, and surface the grade only if it falls short

Sufficient means **concrete** (a person-shaped actor in a situation, not "users"), **causal**
(what breaks today, not just which option), **bounded** (when it applies and when it does
not), and **checkable later** (someone could establish in a year whether it still holds).

A sufficient answer is accepted silently. Work proceeds. No grade theater.

When it falls short: name the missing criterion in one line, then **either** offer a
confirm multi-select in which each option is **the exact sentence that would be written into
the record**, **or** ask one targeted question when extrapolating would be guessing. Never
both, and **one follow-up round only** - a second round trains the owner to give short
answers to escape it, which destroys the point. "I do not know yet" is a valid answer and is
recorded as an open assumption, not chased.

## Check every answer for contradictions, and stop when one fires

Check each answer against **the stated record** (PRD purpose and out-of-scope lines,
`[confirmed]` lines in `docs/USER_PROFILES.md`, driving scenarios and assumptions in ADRs
from 0046 on) and against **answers given earlier in this session**. Do not check against
the code, the data, or pre-protocol commit history: the first is a `/sanity` or `/debug`
finding rather than a contradiction, and the second is mostly your own words, not the
owner's.

Two things earn a flag: a **direct conflict** (both statements cannot be true) and **scope
tension** (the request reaches into something explicitly out of scope, or moves a stated
boundary without saying so). **The prior line must be quotable with its date and source. If
you cannot point to it, it is not a flag, it is an ordinary question.**

When one fires: **stop, and do not proceed on either reading.** Show the prior line quoted
with its date and location, the new statement quoted, and what each implies for the change
in hand. Do not rank them, do not argue for one, do not guess which was meant. Then wait.

Name lines, never the person. "The PRD says X, dated 2026-09-12; this reads as Y." Not "you
contradicted yourself", no tally of how often it happens, and no re-raising a flag that has
already been ruled on. After the ruling: a misread flag is dropped without defending it; a
new statement that stands sends the old line to the **Superseded** block of the entry it
belongs to, dated; an old line that stands means the request gets adjusted and nothing is
written.

## While waiting for answers

Do only work **no possible answer could change**: read the code, trace current behavior,
reproduce the defect, write the failing test, check build and branch. Stop before the fix,
the schema, the UI, the copy, and the ADR. **Commit nothing before answers land.** If an
answer redirects the work, throw the speculative work away without arguing for it.

## Where the answers go

- **What the capability is for and who it serves** -> `docs/PRD.md`, in the owner's words,
  and **only there**. That document's body may contain **nothing the owner did not say**:
  no inference, no reconstruction, no filling a gap because it looks bad. You may write into
  it only by quoting, or via a confirm multi-select whose options are the exact sentences.
  Unanswered things go to that entry's **Open questions**, which is a worklist, not content.
- **Which approach and why not the other** -> the ADR, which links up to its PRD entry
  rather than restating the scenario. The same sentence is never in both.
- **User classes** -> `docs/USER_PROFILES.md`, converting `[inferred]` lines to
  `[confirmed]` with the date.
- Every ADR from 0046 on carries **Driving scenario**, **User classes affected**, and
  **Assumption this rests on**.
- If the change earns no ADR, the driving scenario still gets written, as a **Why**
  paragraph in the commit message.
- **A new answer contradicting a stated PRD line**: surface both with dates and stop. On the
  owner's call the old line moves to that entry's `Superseded` block. Never deleted.

**No em dashes** (ADR 0011). Confirm `git branch --show-current` is `staging`.
