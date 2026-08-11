# 0033. Standardized reimbursement rates live in config; wages still do not

**Status:** Active. Shipped 2026-08-03. Amends [0029](0029-payroll-corrections-are-an-override-layer.md).

## Context

ADR 0029 said the app stores no pay rates: it reports hours and lets QuickBooks
hold the money. That was right for **wages** - a per-employee hourly rate is
sensitive, varies by person, and already lives in QBO, so mirroring it here would
be a second source of truth to drift and to secure.

But two figures on the payroll page are not wages, and the office wanted them as
dollars, not raw counts:

- **Mileage.** Crew log miles (odometer start/end on a reimbursement request).
  The page reported the miles and said "price it yourself." The reimbursement
  rate is a single company-wide number (e.g. $0.65/mi) that changes over time.
- **Per-diem.** Crew mark out-of-town nights. The page counted nights. The
  per-diem allowance is again one company-wide number per night.

These are **standardized reimbursement / allowance rates**, identical for every
employee, not a wage schedule. Keeping them out of the app meant the office
re-did the same two multiplications by hand every pay run.

## Decision

**Mileage and per-diem rates are configurable, and only those.**

- A `payroll_rates` SystemConfig key holds `mileage_rate` ($/mile) and
  `per_diem_rate` ($/night). Admin sets them in Settings -> Payroll rates.
- The payroll summary multiplies each employee's logged miles and out-of-town
  nights by these to add `mileage_amount` and `per_diem_amount` alongside the
  existing counts. Default 0 means "not set": the page shows the count with no
  dollar figure, exactly as before, so nothing changes until a rate is entered.
- **Wages stay out.** No hourly rate, no per-employee rate, no gross pay. The
  0029 principle holds for wages; this is a narrow, deliberate exception for two
  company-wide reimbursement constants.

## Consequences

- **The office stops doing the arithmetic by hand.** Miles and nights become
  dollars on the same page they read for QuickBooks, and the TSV export carries
  the dollar columns too.
- **One rate, changed in one place.** When the mileage rate changes, the admin
  updates it in Settings and every subsequent payroll run reflects it. Past runs
  are not rewritten - the summary is computed live from the current rate, so
  re-opening an old period shows it at today's rate. If a historical rate must be
  preserved, copy the numbers out at run time (the TSV export does this).
- **The line stays bright.** Reimbursement rates in config, wages in QuickBooks.
  Do not extend `payroll_rates` into hourly or per-employee pay - that is the
  thing 0029 keeps out, and this ADR is not a crack in it.
- **The rate config is admin-only.** Unlike the other SystemConfig reads
  (theme, company, vehicle units) which are public so field screens can read
  them, payroll rates are read only by the admin payroll page and the settings
  editor, so both endpoints require an admin token.
