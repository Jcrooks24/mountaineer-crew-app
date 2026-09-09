# 44. Bill lines are verified one at a time, and a tick expires when the line changes

Date: 2026-09-09
Status: Accepted

## Context

Submitting a job report was gated on a single checkbox at the bottom of the
report:

> I have reviewed and confirmed the correctness of the auto-populated line items
> in the Invoice Builder above.

One tick, covering every line on the bill. It is the cheapest possible thing to
satisfy without reading anything, and that is how it was used.

What went out underneath it: a "Truck #1 (per hour)" line frozen at **1 hour** on
a **$90/hr** charge. The line was created as soon as a truck count was known,
which is during the job, while the employee-hours array was still empty - so the
hours reduced to 0, a `|| 1` made it 1, and the line then preserved itself
forever. Crews confirmed the bill; the confirmation said nothing about whether
anyone had looked at that number, because it could not.

The 1h defect itself is fixed (the line is no longer created before there are
hours to size it from). This ADR is about the gate that failed to catch it, which
will be asked to catch the next one.

## Decision

**Verification is per line**, in the Invoice Builder, and every line must be
ticked before the report submits. The single checkbox is gone.

**A tick stores a SIGNATURE of the line's billable values, not a boolean.** A
line counts as checked only while `verifiedSig === lineSignature(line)`, where
the signature covers label, quantity, rate, unit and discount - everything that
changes what the customer pays.

```
verifiedSig?: string          // the signature at the moment it was ticked
isVerified(it) = !!it.verifiedSig && it.verifiedSig === lineSignature(it)
```

**An existing truck line is never re-sized by auto-fill.** Auto-fill sizes a line
when it creates it, and after that the number belongs to whoever is on the bill.
"Use crew hours" on the row re-derives on request.

## Why a signature rather than a boolean

Because a boolean lies the moment anything moves. Tick every line, then have the
materials rebuild change a total, or somebody fix an end time and re-size the
labor line, and a boolean still asserts that the new figure was checked. The
crew's sign-off would be attached to numbers they never saw - which is the exact
failure the single checkbox already had, reproduced one level down.

The signature also means **there is no invalidation logic to maintain.** A dozen
places write to a line: five auto-fill effects, the manual editors, the materials
sync, the discount fields. A boolean needs every one of them to remember to clear
the flag, and the one added next year will not. The signature makes staleness a
property of the data rather than a thing code has to remember to do.

## Why not keep both

A per-line gate plus a global "I reviewed everything" tick is strictly worse than
the per-line gate alone: the global one is the path of least resistance, so it is
the one that gets used, and it re-creates exactly what this replaced.

## Consequences

- **More taps for the crew**, proportional to bill size. Accepted deliberately:
  this is the last point before an invoice reaches a customer, and the app's
  whole justification for auto-populating these lines is that somebody checks
  them. A ten-line bill is ten taps.
- **A tick can expire between filling the bill in and submitting it**, if a line
  changes in between. The line says so ("This line changed since it was checked")
  rather than silently un-ticking, and an unchecked left edge marks it.
- **Ticks persist with the bill** (items are free-form JSON, so no schema
  change), which means a report cannot be finished on a second device without
  the lines having been looked at somewhere.
- **Old bills are untouched.** Existing lines carry no signature, so re-opening
  an old bill shows every line unchecked. That is honest - nobody checked them
  individually - and it only bites a report that is re-submitted.

## What would make us revisit this

Crews reporting that ticking is the slowest part of closing out a job, on bills
long enough for it to matter. The answer then is fewer auto-generated lines, or
grouping them, **not** a single tick that covers everything - that is the thing
that failed.

## See also

- `frontend/scripts/verify_bill_line_verification.mjs` - asserts the
  invalidation property directly, not just that the field exists.
- [ADR 0033](0033-standardized-reimbursement-rates.md) for the other place a
  crew-entered count turns into money.
