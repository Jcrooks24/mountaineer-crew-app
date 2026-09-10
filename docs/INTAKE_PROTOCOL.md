# Mountaineer Crew App - Direction and Context Intake Protocol

This doc governs **how the assistant works with the owner in this repo**. Every
other protocol here describes the app. This one describes the conversation that
produces the app, and the record that conversation is supposed to leave behind.

It exists because the expensive failures in this project have never been syntax
errors. They are changes that were technically correct and operationally wrong,
built on an assumption about the field that nobody wrote down and nobody could
check later. See [docs/business/README.md](business/README.md), which says the
same thing about the business documents.

A decision recorded without the real-world scenario that drove it cannot be
defended a year later, and cannot be revisited either. It can only be re-argued
from taste, by people who have forgotten the situation it was answering.

## The rule

**Every change goes through intake. There is no size exception.** Not a one-line
defect fix, not a copy change, not a tidy-up. Decided in
[ADR 0046](decisions/0046-every-change-goes-through-a-direction-intake.md) for
four reasons, all of them the owner's:

1. **The judgment call is the leak.** If the assistant decides what counts as
   big enough to ask about, it will eventually decide wrong, and it will do so
   on the change that mattered.
2. **Small changes are where it went wrong.** A one-line fix carries a model of
   how the field works exactly as much as a feature does. It just carries it
   invisibly.
3. **The record has to be complete.** The value is in the accumulation, not in
   any one answer. A record with holes cannot be trusted, because nobody can
   tell which holes were the important ones.
4. **A rule with exceptions gets negotiated away.** An unconditional rule
   survives contact with a busy week.

Two things are not exceptions to this, because they are about safety rather than
size:

- **Active data loss.** Stop it, say so immediately, ask afterwards. Same
  carve-out as the debugging and sanity protocols.
- **An explicit waiver from the owner** for a specific change ("just do it").
  That is the owner's call to make, not the assistant's to infer, and it is
  noted in the commit message so the record still shows why that entry is thin.

---

## The four questions

Asked **before** the change, in this order, as one round wherever they fit in
one round.

### 1. Direction, as a multi-select

Never an open "what would you like?" That question hands the work of
enumerating the options to the person who asked for the feature, which is
backwards: the assistant has just read the code and is the one who knows what
the real branches are.

- Two to four **genuinely different** options. Not one real option and a set of
  decoys, and not the same option phrased three ways.
- Each option says what it means, what it costs, and **what it forecloses**.
- Put the recommendation first and label it. A recommendation is not a
  substitute for the alternatives.
- If there honestly is only one sane approach, say that and ask for a yes or no.
  Manufacturing alternatives to satisfy the format wastes the owner's attention
  and teaches them to skim.

### 2. Reason, in the owner's words

**What crew or admin real-world scenario drives this choice?**

What the answer is looking for: who, doing what, when, and what goes wrong
today. This becomes the Context section of the ADR, quoted where possible. It is
the single most valuable output of the whole protocol, because it is the only
part nobody can reconstruct from the code later.

### 3. User class impact

**Which user classes does this change touch, how, and why?** The answer is
written into [USER_PROFILES.md](USER_PROFILES.md) in the same commit, against
the profiles it touches. Over time that doc becomes the thing that makes this
question cheap to answer: most of it is already written down, and the question
narrows to what is new.

### 4. Anything the grade says is missing

Below.

---

## Grading the answers

Every answer gets assessed against four criteria. **The grade is surfaced only
when it falls short.** A sufficient answer is accepted silently and the work
proceeds. No grade theater on good answers.

An answer is sufficient when it is:

1. **Concrete.** Names a person-shaped actor in a situation, not a category.
   "A crew lead on a two-stop day" is concrete. "Users" is not.
2. **Causal.** Says what goes wrong today, or what gets better, and not merely
   which option is preferred.
3. **Bounded.** Says when it applies and when it does not. An answer with no
   boundary produces a feature with no boundary, which is how a tool ends up
   answering a scenario it was never meant to.
4. **Checkable later.** Someone could establish in a year whether the reason
   still holds. "It is cleaner" cannot be checked. "Hailey re-keys this into
   QuickBooks every Friday" can, and the day she stops, the decision is
   reopenable.

### When an answer falls short

1. **Name the missing criterion in one line.** Not a lecture, and not a rating
   of the owner. "This tells me which option, not what breaks today, and the ADR
   needs the second one."
2. **Then one of two moves, never both:**
   - **Extrapolate and confirm.** If the meaning can be reconstructed, offer the
     readings as a multi-select in which **each option is the full sentence that
     would go into the ADR**. Choosing one is approving the record, not hinting
     at a direction. This is the preferred move, because it costs the owner one
     tap instead of a paragraph.
   - **Ask one targeted question.** Only when extrapolation would be guessing.
     One question, aimed at the missing criterion, not a re-ask of the original.
3. **One follow-up round.** A second round is an interrogation, and its real
   effect is to train the owner to give short answers to escape it, which
   destroys exactly what this protocol is for. If it is still unclear after one
   round, record what is known, mark the rest as an open assumption, and move.
4. **"I do not know yet" is a valid answer.** It gets recorded as an open
   assumption in the ADR, not chased. The retro review below is what comes back
   for it.

---

## The contradiction check

Every answer is checked against what the owner has already said. Added
2026-09-09, at the owner's request, for three reasons in their words: they
answer in whatever framing the question arrives in, so the same underlying
question can be ruled one way in the morning and the opposite way in the
afternoon without either answer feeling wrong at the time; direction changes as
they learn, and a reversal should surface at the moment it happens rather than
be found months later as two documents that disagree; and a record that
contradicts itself is worse than none, because the next person builds from
whichever line they read first with no way to know it was superseded.

### What it is checked against

Two corpora, both chosen deliberately:

1. **The stated record.** PRD purpose and out-of-scope lines, `[confirmed]`
   lines in [USER_PROFILES.md](USER_PROFILES.md), and the driving scenarios and
   assumptions in ADRs from 0046 onward. Every line in it is dated and
   attributed, which is what makes a flag checkable rather than an impression.
2. **Answers earlier in the same session.** The fast kind: ruled one way on the
   second question and the other way on the fifth, usually because the framing
   changed. Free to check, since it is all in front of the assistant.

**Deliberately not checked:** evidence in the code and the data, and commit
history from before this protocol. The first is a different question (a stated
belief disagreeing with what the Sheet shows belongs to a `/sanity` or `/debug`
finding, not to a contradiction flag). The second is mostly the assistant's own
words rather than the owner's, and flagging the owner against a sentence the
assistant wrote is how a check like this loses its credibility.

### What earns a flag

Two categories, and nothing else:

1. **Direct conflict.** The new statement and a stated line cannot both be true.
2. **Scope tension.** The request reaches into something explicitly marked out
   of scope, or moves a stated boundary without saying so.

**The threshold, and the whole defense against noise: the prior line must be
quotable, with its date and its source.** If it cannot be pointed to, it is not
a flag. It is an ordinary intake question, asked as one.

### What happens

**Stop. Do not proceed on either reading.** A contradiction usually means the
change is not yet well defined, and continuing produces work that one of the two
answers was always going to discard.

Show three things and then wait:

- **The prior line**, quoted, with its date and where it lives.
- **The new statement**, quoted.
- **What each one implies** for the change actually in hand.

Do not rank them, do not argue for either, and do not guess which was meant.
Waiting is the entire value.

### After the ruling

- **Not actually a contradiction** (the assistant misread the prior line):
  record nothing, continue. Say so plainly, do not defend the flag.
- **The new statement stands:** the old line moves into the `Superseded` block
  **of the entry it belongs to**, dated, directly under its replacement. History
  lives next to the thing it is about, and there is no separate reversals log to
  keep true.
- **The old line stands:** the request is adjusted to fit it. Nothing is written
  to the record, because nothing changed.

### How the flag is phrased

It names lines, never the person. "The PRD says X, dated 2026-09-12; this reads
as Y" is the shape. Not "you contradicted yourself", not a count of how often it
has happened, and not a flag re-raised later in the session once it has been
ruled on. This check exists to protect the record, not to keep score.

## Small changes: ask, then work while the answer comes

The questions go out first. Then, while they are unanswered, only work that
**no possible answer could change** may proceed:

- Reading the code and tracing the current behavior.
- Reproducing the defect, including writing the failing test that pins it.
- Build, environment, and branch checks.
- Enumerating the options themselves.

Stop before anything an answer could redirect: the fix, the schema, the UI, the
copy, the ADR.

- **Nothing is committed before the answers land.** A commit is the record, and
  the record is what this protocol produces.
- **If an answer redirects the work, the speculative work is thrown away without
  being argued for.** Work already done is not evidence about which direction is
  right. Sunk cost is the most common way an intake gets quietly overridden.

---

## What the answers become

| Answer | Where it lands |
|---|---|
| What the capability is for, and who it serves | [PRD.md](PRD.md), in the owner's words, and **only there** |
| Direction chosen, and why not the alternative | The change itself, and the ADR's decision |
| Options rejected | The ADR's alternatives, with why each was not taken |
| Driving scenario | The PRD entry when it is product-level, the ADR's Context when it is decision-level. Never both |
| User classes affected | [USER_PROFILES.md](USER_PROFILES.md), same commit |
| Open assumption | The ADR's **Assumption this rests on**, which is what the retro review checks |
| Anything not answered | The PRD entry's **Open questions**, as a worklist for a later round |

### The PRD is written from answers, never from the code

[PRD.md](PRD.md) is the product document this protocol produces. It has one hard
rule, and it is absolute: **nothing enters its body that the owner did not say.**
No inference, no reconstruction, no filling a gap because the gap looks bad. A
line that was never stated is absent, not guessed.

The assistant may put words in that document exactly two ways: by quoting the
owner, or by offering a confirm multi-select in which **each option is the exact
sentence that would be written**, so that choosing one approves the text and not
merely the direction. Mechanical facts (which routes exist, which ADR touches
which surface) may be recorded with a citation, and never fill a Purpose line.

**The division of labor with the decision log**, settled 2026-09-09: the PRD owns
what a capability is for and who it serves; an ADR owns which approach was taken
and why not the other, and links up to its PRD entry rather than restating the
scenario. Most ADRs here are technical, belong to no capability, and get no PRD
entry at all. The same sentence is never written in both places.

**When a new answer contradicts a stated PRD line**, surface both with their
dates and stop. On the owner's call, the old line moves to that entry's
`Superseded` block with the date. It is never deleted.

When a change does not earn an ADR by the test in
[docs/decisions/README.md](decisions/README.md), the driving scenario still gets
written, as a **Why** paragraph in the commit message. The commit is then the
record, and it is searchable.

### Every ADR from ADR 0046 onward carries three extra lines

```
**Driving scenario:** the owner's answer, in their words.
**User classes affected:** which profiles, and how each one experiences it.
**Assumption this rests on:** the thing that, if it stopped being true, would
make this decision wrong.
```

That last line is what makes the retro review possible at all. An ADR without it
can only be re-argued from taste, which is what this whole protocol exists to
stop.

---

## Retro review: past decisions, incrementally

Both triggers are active.

**A. Opportunistic, in the files you are already in.** Before changing an area,
read the ADRs that govern it and check their founding assumption against today.
Same spirit and same restraint as [INCREMENTAL_WORK.md](INCREMENTAL_WORK.md): do
not go hunting outside the area you are working in.

**B. Scheduled, oldest first.** One block from the ledger below per session,
oldest `Last reviewed` first. This is the trigger that catches the decision
nobody has touched in a year, which is exactly where a stale assumption hides.

### The three outcomes

1. **Holds.** Record the date in the ledger. Change nothing. Most reviews end
   here and that is a real result.
2. **Holds, but the record is thin.** The decision is still right, and the ADR
   has no driving scenario, no user classes, or no stated assumption. Run the
   four questions retroactively and fill them in. Status stays `Accepted`. Note
   in the ADR that the context was added later and on what date, so nobody
   mistakes a 2026 reconstruction for what was actually thought at the time.
3. **Founded on something that is no longer true, or was never true.**
   **Do not quietly rewrite it.** Write a new ADR that supersedes it, stating
   what the old one assumed, what is actually the case, and what changes as a
   result. Mark the old one `Superseded by`. An ADR silently edited to match the
   present teaches nothing and hides the fact that the assumption was wrong,
   which is the most useful thing in it.

**Reviewing does not authorize changing code.** Findings go to the owner, the
same way [SANITY_CHECK_PROTOCOL.md](SANITY_CHECK_PROTOCOL.md) findings do. An
approved finding then goes through intake like any other change.

### The review is also how the PRD backlog drains

The 45 decisions that predate this protocol hold real choices, but their stated
reasons were largely reconstructed from the code after the fact, which is
exactly what [PRD.md](PRD.md) forbids in its body. So none of them were bulk
imported.

Instead, each reviewed block asks the owner the capability-level question for
whatever product decisions it contains: **what is this for, and who does it
serve?** The answer, in their words, becomes a PRD line dated to the day it was
said. A block whose ADRs are purely technical produces no PRD lines, and that is
a normal outcome. Nothing is written to the PRD from a review alone.

### ADR review ledger

Oldest `Last reviewed` first. Update the row in the same commit as the review.

| Block | ADRs | Last reviewed | Outcome |
|---|---|---|---|
| 1 | 0001 - 0005 | never | - |
| 2 | 0006 - 0010 | never | - |
| 3 | 0011 - 0015 | never | - |
| 4 | 0016 - 0020 | never | - |
| 5 | 0021 - 0025 | never | - |
| 6 | 0026 - 0030 | never | - |
| 7 | 0031 - 0035 | never | - |
| 8 | 0036 - 0040 | never | - |
| 9 | 0041 - 0045 | never | - |

---

## Where this sits among the protocols

| Protocol | When | Question |
|---|---|---|
| **This doc (`/intake`)** | **Before the work** | **Where should this go, and what real situation drives that?** |
| [SANITY_CHECK_PROTOCOL.md](SANITY_CHECK_PROTOCOL.md) (`/sanity`) | Built, not yet done | Is it the right answer, and does using it feel like it? |
| [VETTING_PROTOCOL.md](VETTING_PROTOCOL.md) (`/vet`) | Before promotion | Is it correct and safe on crew devices? |
| [DEBUGGING_PROTOCOL.md](DEBUGGING_PROTOCOL.md) (`/debug`) | Something is wrong | What is actually causing it? |

Intake feeds the sanity pass directly: the driving scenario from question 2 is
what the sanity pass checks the built tool against in its Q1, and the user
classes from question 3 are the personas it walks the workflow as.
