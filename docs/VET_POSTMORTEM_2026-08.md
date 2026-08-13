# Antagonistic review of the vetting protocol

**Period:** 2026-07-14 (the v1.8 merge) to 2026-08-13.
**Scope:** 271 commits to `main`, 10 promotions, one 574-line protocol.
**Question:** the protocol was followed. Things still broke. Why, and what would
have to change for the same protocol to catch them next time?

This is deliberately unfair to the process. Everything below is a case where the
protocol was RUN and PASSED and something reached crews anyway. The passes it
earned are not listed, because they are not the interesting half.

---

## The escapes

Each of these was on `main`, in front of crews, after a vet that passed.

| Defect | How it was actually found |
|---|---|
| Route splitting black-screened the app on update (`d952d64`) | A crew member updating the app |
| Truck double-billed after the per-load change (`3b2310e`) | A customer was billed wrong and the crew reported it |
| Sign-out copied every signature, then silently lost them on a full device (`310b426`) | Found by accident while investigating unrelated slowness |
| Google HTTP calls had no timeout; the export pool could wedge silently (`d0ce07f`) | Found on the fourth pass over the same file |
| The generic self-heal sweep had not run in months (`3798a7a`) | Found by reading, after two wrong diagnoses |
| `NameError` in the sheet-integrity cron (`ee6fa59`) | The cron crashed in production |
| New columns could never be added to a full sheet tab (`5f4e5c5`) | Exports started failing |
| DQ listed everyone; payroll reported zero expenses (`00bea42`) | Office noticed the numbers |
| BOL queue-reorder deadlock that silently lost a signature (`21f3e1c`) | A vet that was specifically told to be non-naive |

Nine escapes. **One** was caught by a vet, and only because that vet had been
explicitly instructed to distrust the previous one.

---

## Nine findings

### 1. The protocol vets the diff. The failures live in the interactions.

The black screen is the cleanest example. The change was to `main.tsx` (route
imports). The bug was in `appUpdate.ts`, which nobody touched, which no diff
pointed at, and which no check in the protocol mentions. The two are connected
only by an invariant nobody had written down: *the app never fetches code after
the precache is evicted.* Splitting violated an assumption held by a file it did
not modify.

This is not a one-off. The sweep that never ran was an in-process counter meeting
a platform that recycles the process by design. The wedged export pool was a
missing timeout on a client shared by a two-thread executor. **All three of the
worst defects this month were interactions between a change and a lifecycle
event, not defects in the changed lines.** A diff-scoped protocol is structurally
blind to all of them.

### 2. Static verification is allowed to discharge obligations that are inherently dynamic.

The splitting change shipped with 38 passing assertions, including one that
asserted all 28 chunks were in the service-worker precache. That assertion was
true. It was also irrelevant to the failure, which happened in a 150 ms window
during worker activation.

The deeper problem: **I wrote the code and the checks at the same sitting, from
the same mental model.** Such checks cannot find what their author did not think
of. They can only pin the author's assumptions in place and then report those
assumptions back as evidence. "38 assertions pass" reads like strength and is
actually a measure of how thoroughly one person's imagination was encoded.

### 3. Device testing sits AFTER promotion, which is backwards.

It is item 6 of 8 in a post-promotion list, and has been carried unfinished
across several promotions. For a crew-facing screen, "test it after crews have
it" is not testing. It is monitoring, and the instrument is a crew member's bad
afternoon.

### 4. The blocking conditions do not block.

The DATA_FLOW fold has now been deferred at five consecutive promotions, each
time with a written and genuinely reasonable justification. That is the problem.
A gate that always yields to a good reason is not a gate, and every deferral
makes the next one easier. It should either block or be demoted honestly, because
its current state teaches everyone that blockers are negotiable.

### 5. The gate is trusted infrastructure with no tests of its own.

`scripts/promotion_gate.py` is the first thing the protocol tells you to run. Two
defects have been found in it: a false negative in the deviation check
(`788da49`), and a header scraper that read quoted phrases out of COMMENTS and
announced four new Sheet columns when there were two (found 2026-08-13, by
noticing the output looked odd). Both were found by accident. Nothing tests the
thing that gates everything else.

### 6. There is no blast-radius triage.

A copy tweak and a change to the asset-loading lifecycle go through an identical
process. Nothing in the protocol asks: *if this is wrong, what is the worst
outcome, and can a crew member recover without me?* Route splitting could leave a
phone on a black screen with no path forward except a manual refresh nobody would
think to try. That deserved a different bar than it got, and the protocol offered
no mechanism to give it one.

### 7. Diagnosis has no measurement gate, only fixes do.

The backfill stall was diagnosed and fixed three times: an identity-map OOM, then
a self-sustaining sweep storm, then a schedule living in process memory. The
first two were shipped with confidence and were not the cause. The protocol has
pages on verifying a FIX and nothing at all on verifying a DIAGNOSIS.

The one time measurement was forced first (the cron OOM, where the user said
"don't guess a third time"), it killed two wrong hypotheses in a single run.

### 8. Self-review is the entire review.

The same person writes the change, writes its tests, runs the protocol against
it, and rules on whether it passes. The protocol's adversarial content is
self-administered, and self-administered adversarial review mostly re-runs the
reasoning that produced the code.

The evidence is blunt: the two most productive passes this month
(`bec6153` "Antagonistic vet: three real bugs", `fc7fbed` "Broader vet") both
happened because the user explicitly asked for another pass **after a normal vet
had already passed**. The protocol's own adversarial step did not produce those.

### 9. Confirmation is counted; disconfirmation is not.

Nothing in the protocol requires a check to be tied to a failure that has
actually been observed. Assertions accumulate around the happy path and around
whatever the author found interesting, and their count is reported as confidence.
None of the 38 assertions on the splitting change was derived from asking "how
has this app broken before?"

---

## Hardening

Ranked by how many of the nine escapes each would plausibly have caught.

### H1. Change-class triage, before anything else *(would have caught 5)*

Before touching the diff checks, classify the change into one or more classes,
each with a short checklist that is **not derived from the diff**:

| Class | Mandatory extra checks |
|---|---|
| **Asset / bundle / service worker** | Walk the SW lifecycle: install, activate, precache eviction, controllerchange, reload. State what the change assumes is in memory at each step. |
| **Offline queue / one-copy data** | The existing durability vet, mandatory rather than conditional. |
| **Auth / session** | Logout, user switch, token expiry mid-operation. |
| **Money** | Recompute one real historical record by hand and compare. |
| **Schema / migration** | Apply to a copy of the PREVIOUS schema, not to head. |
| **Scheduled / background work** | Prove it still runs after a worker recycle. |
| **Crew-facing UI** | Device test BEFORE promotion (H3). |

The classes are not generic. Each one is written from a defect in the table above.

### H2. The four lifecycle questions, asked every time *(would have caught 4)*

This app has exactly four events that routinely invalidate assumptions. Every vet
answers all four in writing, even if the answer is "not applicable":

1. **Worker recycle** (every 1000 requests, by design). What does this change
   keep in process memory, and what happens when that memory is discarded?
2. **Service-worker update.** What does it assume is already loaded, and what
   happens in the window where the old precache is gone and the page has not
   reloaded?
3. **User switch / logout.** What un-synced data exists at that instant, and does
   the wipe destroy it?
4. **Offline to online.** What drains, in what order, and what happens if it
   fails halfway?

The sweep bug, the black screen, the sign-out loss and the mid-drain data loss
are one question each.

### H3. "Cannot verify from here" blocks a crew-facing promotion *(would have caught 2)*

Today the protocol permits promoting with a written caveat, and I used that twice
this week. **Both caveats were accurate and both ships were still wrong.** An
honest note about an unverified risk is not a substitute for verifying it.

New rule: if a change's principal risk can only be exercised on a device or
across two deploys, it does not reach `main` until that has happened. The
alternative is not "ship with a note", it is "ship the rest and hold this back".

### H4. Staging must survive one real service-worker update *(would have caught the black screen exactly)*

Mechanical, cheap, and precisely targeted: deploy to staging twice, and update a
device across the second one before promoting. The black screen was reproducible
in about ninety seconds by anyone who thought to try.

### H5. Test the gate *(would have caught 2 gate defects)*

`verify_promotion_gate.py`, with fixtures: a branched migration chain, a header
list containing a quoted comment, a `[ ]` field, an open deviation. The gate
gates everything and is checked by nothing.

### H6. A diagnosis is not complete until a measurement could have falsified it *(3 wasted fixes)*

For any behavioural or performance defect, before writing a fix, record: the
hypothesis, the observation that would DISPROVE it, and the result of taking that
observation. `memprobe`, `/api/admin/system-check/worker` and the export-pool
readout exist for this. Shipping a fix for an unmeasured hypothesis is how the
same bug gets fixed three times.

### H7. Every verification block names the symptom it would have caught

A check that cannot name a production symptom is a check about the author's
imagination. This is a one-line documentation rule with real teeth: it makes
assertion-count theatre visibly empty, and it forces the question "how has this
broken before?" that finding 9 says nobody asks.

### H8. Resolve the DATA_FLOW gate honestly

Either schedule the session that clears it, or demote it from "blocks the merge"
to "tracked debt" and stop calling it a blocker. Its current state is the worst of
both: it fails to block, and it normalises deferral for everything that follows.

### H9. For high blast radius, a mandatory second pass with a different question

Not "check this again", which re-runs the same reasoning. Specifically: *given
the class of this change, which of the nine historical failure modes applies?*
The two passes that produced real bugs this month were exactly this, and they only
happened because someone asked.

---

## The uncomfortable summary

The protocol is thorough about the things it can see and structurally blind to
the things that have actually broken. Its checks cluster where evidence is cheap
(greps, builds, static reads) and thin out exactly where this app fails: at
lifecycle boundaries, on real devices, and across deploys.

Eight of nine escapes were found by crews, by the office, or by accident. That is
the number the protocol should be judged on, and 574 lines of it did not move it.
