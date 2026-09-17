# 0051 - The compliance reference maps code to obligations, and vendors no CFR

Date: 2026-09-17
Status: Accepted

**Driving scenario:** Owner at intake, 2026-09-17, on what goes wrong today: "Every
time compliance comes up, the applicability question gets worked out from scratch,
at cost, and possibly differently each time, because nothing in the repo records
which rules reach this company and why." The September 2026 gap audit made the cost
concrete: three revisions were spent establishing facts (rental versus owned,
interstate versus intrastate, the no-CDL policy, the 10,001 lb threshold) that are
stable, knowable, and were nowhere in the repo.

**User classes affected** (owner-confirmed 2026-09-17): the **systems owner**, and
Claude Code acting for them, as the direct and primary reader, at the moment of
editing a compliance-bearing file. The **mover and driver** are affected indirectly
and never read it: their DVIR, RODS, and DQ records are what the document exists to
protect from a well-meant change.

**Assumption this rests on:** That the applicability facts (the V-items) are stable
enough to be worth writing down, and that the expensive part of a compliance
question is the applicability analysis rather than the regulation text. If the
company's operating posture starts changing often, for example if owned trucks begin
interstate work, the V-items become the churning part of the file and this
structure is what to reopen.

## Context

The gap audit raised the question of how compliance knowledge should live in the
repo. Two obvious answers were considered and one was rejected.

**Vendoring the regulations** is the intuitive move: put Part 391, Part 396 and the
rest into `docs/` so a future session can read the authority directly. It fails for
four reasons, and the fourth is not hypothetical.

1. It answers the wrong question. Mid-edit in `dvir.py`, what is needed is "this
   field is the defect description on a regulated record, here is what must not
   regress", not forty pages of Part 396 to re-read and re-interpret.
2. The reasoning still has to happen every time, at cost, and may come out
   differently each time. That is the exact problem the owner described.
3. Volume. The relevant set spans Parts 375, 382, 383, 387, 390, 391, 392, 393, 395
   and 396.
4. **A frozen copy goes stale silently while looking authoritative.** During the
   audit, the project library's copy of the TRALA exemption notice, 82 FR 47306, had
   expired on 11 Oct 2022, and Revision 4 of the audit cited it as operative. The
   renewal was the operative notice. A vendored Part 391 would reproduce that
   failure across a far larger surface, and nothing in CI would catch it.

The thing that could **not** be reconstructed from public sources was the company's
own operating posture and the mapping from code surface to obligation. That is what
was worth writing.

## Decision

1. **`docs/COMPLIANCE_REFERENCE.md` is the compliance reference.** It is organized by
   **code surface**, not by CFR part, because the trigger is always "I am editing
   `dvir.py`", never "I am reading §396.11".

2. **No CFR text is vendored, ever.** Regulations are cited as pointers so a reader
   knows which text to go read. eCFR is the live source.

3. **Every claim carries one of three marks**, extending the `[confirmed]` and
   `[inferred]` convention already load-bearing in `USER_PROFILES.md`:
   - `[code]` verified by reading source at a stated commit
   - `[owner]` an operational fact the owner stated
   - `[reg]` a regulatory claim from an outside source, with the date checked, and
     **never verified by this repo**

   A `[reg]` mark is a research lead, not an answer. The document says outright that
   it is not a statement of law.

4. **An applicability gate sits above everything**, holding the V-items. Nearly every
   finding is conditional on them, and V-5, whether the app's RODS or a paper log is
   the record of duty status, gates seven separate items and is recorded as open.

5. **The file is in two parts with independent dates**, at the owner's direction at
   intake: Part 1 the slow-churning regression guard, Part 2 the fast-churning gap
   ledger. The owner chose this over two files with the cost stated in front of
   them. The mitigation is structural: each part carries its own "verified against"
   date, and a stale date on one says nothing about the other.

6. **The Montana booklet is vendored**, into `docs/business/`, as a page-marked text
   extraction beside the PDF. It is finite, stable, cited by page, and `docs/business/`
   already has the convention for external documents whose originals govern. This is
   not an exception to rule 2: a state agency booklet reissued occasionally is a
   different artifact from a continuously amended body of federal regulation.

## Consequences

- A compliance question starts by reading one file, and the applicability analysis is
  done once rather than per session.
- Citations resolve inside the repo for Montana, and deliberately do not for the CFR.
- The marks make the document's own reliability legible: a reader can see at a glance
  which claims are cheap to verify and which are research leads.
- Part 2 will churn and eventually empty. That is intended. As items close, what
  remains moves into Part 1 as invariants, so protection outlives the ledger entry.
- Someone must keep the file current. It carries the same same-commit rule as
  `DATA_FLOW_STAGING.md`.

## What would break if you undid this

**If you vendor the CFR:** the repo acquires an authoritative-looking copy of law
that nothing updates. The next person to read it will trust it, and it will be wrong
eventually, in the specific way the expired TRALA notice was wrong: not obviously
stale, just quietly superseded. The audit that produced this document already
demonstrated the failure mode on a single notice.

**If you strip the marks and state claims flatly:** the document becomes a compliance
opinion. A future session will treat `[reg]` guesses as settled law and build on
them. The marks are what keep it honest about the difference between "I read this in
the source" and "somebody cited this once".

**If you merge the two parts into a single flat list:** the regression guard inherits
the gap ledger's churn, the whole file starts looking stale, and readers stop
trusting the invariants. The separation and the two dates are the point.

**If you reorganize it by CFR part:** it stops being reachable at the moment it is
needed. Nobody goes looking for §396.11 before editing a file; they go looking for
the file.
