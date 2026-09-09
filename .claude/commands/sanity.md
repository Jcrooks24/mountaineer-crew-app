---
description: Findings-only workflow/UX/UI sanity check of a tool, before it is called done
---

Run the Sanity Check Protocol in `docs/SANITY_CHECK_PROTOCOL.md` against:

**$ARGUMENTS**

If no target is given, open the **Coverage ledger** at the bottom of that doc, take the
area with the oldest `Last checked` date (ties break toward pay, safety, or a customer
signature), tell the user which area you picked and why, and run the pass on it.

**Read `docs/SANITY_CHECK_PROTOCOL.md` first and follow it in order.** This is not `/vet`
and not `/debug`. It asks whether the tool is the right answer to the job it exists for,
and whether using it feels like it.

- **This pass fixes nothing.** No patches, no "while I was in there", not even the
  one-line ones. The report is the deliverable and the user decides what becomes work.
  The only thing you may change is the Coverage ledger row. The single exception is
  **active data loss**: report it immediately and stop the pass.
- **Evidence first.** Every claim about what a screen does cites the `file:line` that
  renders it. Do not assert from memory, and do not guess at behavior you did not read.
- **Do not drive the user's Chrome.** Anything that can only be settled by looking at the
  running app goes in **Needs a human look**, with the exact taps to make and what to
  report back.
- Confirm `git branch --show-current` is `staging`.

Work the seven questions in order and do not collapse them into prose:

1. **Q1 Does it do its job?** State the job in one sentence in the app's own words
   (header, help text, `docs/CREW_GUIDE.md`, `docs/ADMIN_GUIDE.md`), walk the primary
   path, compare the real output to that sentence.
2. **Q2 Does the category answer every scenario?** List the sibling tools, enumerate the
   ugly real-world scenarios from the doc's list, map each scenario to a tool. Gaps and
   two-tools-one-scenario ambiguities are the highest-yield findings here.
3. **Q3 Friction.** Count taps and typed characters on the most common path. Flag re-entry
   of data the app already has, any step that silently needs signal, and anything crew has
   to remember rather than being led to.
4. **Q4 Confirmations.** Missing on irreversible or money/signature actions, and present
   on routine ones (which trains crew to tap through the ones that matter). Also flag
   checks the app makes a human do that the app could do itself.
5. **Q5 Ecosystem fit.** Data it re-asks for, output an admin has to re-key, discoverability,
   whether it should be a step inside an existing flow, duplication with other features.
6. **Q6 Code-level preconditions.** Write the preconditions list *first*, then verify each
   with evidence (queue key + drain trigger, server accepts every field sent, staging Sheet
   tab env var, `job_uuid` identity, read-path matches write-path, concurrent devices,
   bounded row counts). Anything unverifiable from here is listed as unverified, not assumed.
7. **Q7 UI render.** At 390px first. Organization, sticky/broken buttons, disabled buttons
   with no explanation, sub-48px targets, and above all **default values**: if the user
   never looks at a pre-filled value, is what gets submitted right? Loading/empty/error
   states. Beta subtext present on new features and removed from old ones.

Output in the doc's format: stated job, scenario map table, friction count, findings table
(`# | Q | Severity | Finding | Evidence | Suggested direction`), verified-good list, needs
a human look, unverified from here. End by stating plainly that nothing was changed, and
offer to open the approved findings as a batch under the debugging protocol's Batch mode.

Update that area's Coverage ledger row (`Last checked`, open findings count) and commit
that single change with the report.

**No em dashes** (ADR 0011).
