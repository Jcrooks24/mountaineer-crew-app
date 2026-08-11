# Business context

The rest of `docs/` describes how this app is built. This folder describes the
company it serves, and who does what inside it.

It exists because the interesting failures in this project are not syntax
errors. They are changes that are technically correct and operationally wrong:
a field captured that nobody consumes, a queue "simplified" in a way that loses
a DOT record, a feature re-added that was removed on purpose. You cannot catch
that class of mistake by reading code. Read these first.

These are Markdown conversions of Word documents maintained outside this repo.
The `.docx` originals are authoritative for exact wording. Update the source
document first, then re-export here.

## The documents

| Doc | What it is | Read it for |
|---|---|---|
| [SOP-2026.md](SOP-2026.md) | Standard Operating Procedures v1.0, July 2026. Process-forward: for each business function, who owns it, what triggers it, the steps, the tools, the output. | Who does what. Section 6 is the job-day workflow and every Crew App input, with the business reason each input matters. Section 1 is roles. |
| [SYSTEMS-REPORT-2026.md](SYSTEMS-REPORT-2026.md) | The tools-forward audit. What systems the company runs and how well each performs. | What else is in the stack and how the app fits beside it. |
| [M1-INTEGRATION-ASSESSMENT.md](M1-INTEGRATION-ASSESSMENT.md) | Combined systems profile for Mountaineer plus M1 Logistics, ahead of the merger. | Where this app is headed, the overlap matrix, and the key-person risk table. |
| [xact/](xact/) | Prior product-definition work done in the xact platform, plus the meeting that reset it. | What has already been asked and answered, so it is not asked again. |

## Three rules for reading them

**1. The SOP is descriptive, not prescriptive.** It records operations as they
actually run today, including where a function has no owner, where a practice
is aspirational, and where a system is built but unused. A documented gap is a
finding, not an error in the document. The "what is worth fixing" judgments are
deliberately quarantined in its Appendix A, the Gap Ledger.

**2. Where documents disagree, the SOP governs.** It supersedes the standalone
Moving Handbook and the Crew Lead Handbook.

**3. The Systems Report is partly stale by design.** It is the oldest of the
three. The SOP's Appendix A.1 is an explicit list of patches owed to it: the AI
and automation layer is missing entirely, Notion is unaudited, the calendar
auto-formatter status is wrong, the crew-availability cutover is recorded as in
progress when it is complete, the tier-slip system is described as declining
when it is active, and its notes on manual BOL handling and receipt-texting are
stale because both now ship in this app. Do not spend effort reconciling the two
documents. The reconciliation is already written.

## Two things to carry into any change you make here

**Capture without consumption.** The SOP's recurring finding is that this
company captures data nothing downstream reads. This app participates: the
end-of-day report asks whether the office should solicit a review, the answer
is logged to the Sheet, and it goes nowhere. When something looks broken, first
decide whether it is broken or whether it works and has no consumer. The fixes
are completely different.

**Name the human on the other end.** When this app is wrong, it lands on
somebody specific: a crew member on a phone with no signal, Hailey's invoice,
a mover's paycheck, or a DOT compliance record. The SOP tells you which.

## A note on em dashes

[ADR 0011](../decisions/0011-no-em-dashes.md) bans em dashes in this repo. The
converted business documents keep theirs, because they are imported source
material and repunctuating a governing SOP would be worse than the exception.
The rule still binds everything written for this repo, including this file.
