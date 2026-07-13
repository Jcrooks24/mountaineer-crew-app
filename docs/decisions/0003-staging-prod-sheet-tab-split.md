# 0003. One Google Sheet for both environments, split by tab name

**Status:** Active, with a known sharp edge.

## Context

The office does not read the app's database. They read a Google Sheet. It is where
they build invoices and run payroll, and it is the only view of this system most of
the business ever touches.

Staging needs to produce data (that is the point of testing), but that data must
never appear in the office's working columns. The obvious answer is a second
spreadsheet. We did not do that.

## Decision

**Both environments write to the same spreadsheet.** They are separated by **tab**:
production writes to `Events`, `Materials`, `JobReports`; staging writes to
`EventsStaging`, `MaterialsStaging`, `JobReportsStaging`.

The split is driven entirely by `SHEETS_*_TAB` environment variables on the Render
service. **Worksheet names are never hardcoded.**

Why one spreadsheet: the owner wanted to look at staging output next to production
output, in one place, without switching documents or maintaining two sets of
formulas and permissions. It has worked well for that.

## Consequences

- Adding a new exported record type means adding a new `SHEETS_*_TAB` variable and
  setting it on **both** services. Forgetting the staging one is the failure below.
- Admin → Advanced Settings → System Check → Sheet Syncs lists every tab variable
  and flags the unset ones. Check it after any deploy that adds one.

## The sharp edge

**Every tab variable defaults to the production tab name.** So a missing variable
on staging does not fail loudly. It silently writes test data into the office's
real sheet, interleaved with real jobs.

This has happened. It is the most common configuration mistake in this system.
The recovery is in [../RUNBOOKS.md](../RUNBOOKS.md#data-is-not-reaching-the-google-sheet).

The safer design would be to fail closed: no tab variable, no export. That change
would be welcome, and the reason it has not been made is only that it has never
been the most urgent thing. If you are looking for a high-value cleanup, this is it.

## What would break if you undid this

If you hardcode tab names, staging pollutes production immediately and permanently,
and the office's payroll numbers become untrustworthy. The env-var indirection is
the entire safety mechanism.
