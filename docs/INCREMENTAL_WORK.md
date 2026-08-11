# Incremental work

Cleanups that are **real but not worth their own commit**. Each one is too large
or too risky to sweep in one pass, and too small to schedule. So they get paid
down opportunistically: when you are already editing a file for an unrelated
reason, you also apply whatever items below apply **to that file**, and mention
it in the commit message.

This exists because a mass refactor is the wrong tool here. This app is used in
the field and quality is priority #1 (see CLAUDE.md core invariants). A 500-site
sweep is a large diff with no behavioral test behind it, reviewed all at once,
touching screens crew depend on. The same change spread over 40 commits is
reviewed in context, one screen at a time, and any regression is trivially
bisectable.

## The rule

When you open a file to do real work:

1. Check the items below. Apply any that match **the file you are already in**.
2. Do **not** open other files to hunt for instances. That is the sweep this doc
   exists to avoid.
3. Keep it to roughly **10 conversions per commit**. If a file needs more, do a
   slice and leave the rest.
4. The unrelated work stays the point of the commit. Note the cleanup as a
   trailing line, e.g. `Also: 6 spacing literals -> tokens in DVIR.tsx`.
5. If a conversion is not obviously safe, skip it and leave it. These are all
   optional by design. None of them is worth a field regression.

Update the **Progress** line when you knock some out, so the next session knows
where things stand.

---

## 1. Spacing literals to `--space-*` tokens

`DESIGN_SYSTEM.md` specifies five layout constants; they are tokens in
`index.css` as of 2026-08-10.

| Literal | Token |
|---|---|
| `12px` page container horizontal padding | `var(--space-page)` |
| `8px` gap between cards | `var(--space-gap)` |
| `14px` card padding | `var(--space-card)` |
| `48px` min interactive-row height | `var(--space-row-min)` |
| `36px` min button height | `var(--space-btn-min)` |

**Only convert a literal when it is being used for that specific purpose.** A
`14` that happens to be a font size, an icon width, or a one-off inset is not
card padding. Matching on the number alone is how this turns into a regression.

**Progress:** not started. Rough upper bound is ~516 candidate sites across the
frontend, and a large share of those will be false matches per the caveat above.

## 2. Dead `var(--on-brand, #fff)` fallbacks

`applySettings` sets `--on-brand` on every code path, so the `#fff` fallback can
never be reached. It is harmless but misleading: it reads as though white is a
real possibility, which is what the ADR 0035 bug looked like from the outside.

Replace `var(--on-brand, #fff)` with `var(--on-brand)`.

**Progress:** 7 occurrences across 3 files remaining as of 2026-08-10
(`JobSetupPanel.tsx` 4, `Admin.tsx` 2, `PayrollTool.tsx` 1). `JobReport.tsx`
cleared, 3 converted while it was already open for ADR 0035.

## 3. `Admin.tsx` decomposition

8,613 lines in one route component. It is the largest file in the repo by 2.5x
and the hardest thing in the app to review or hand off.

Extract **one tab or panel at a time** into `pages/admin/`, with **zero
behavior change** per step. Do not restructure state or routing on the way out.
When you are in Admin.tsx for a feature and the section you touched is cleanly
separable, lift that section and nothing else.

**Do not** attempt this as a planned refactor sprint. The value is in it being
boring and incremental.

**Progress:** not started. 8,613 lines.

## 4. Touch-target audit

`DESIGN_SYSTEM.md` requires >=40px touch targets (crew wear gloves and carry
furniture), 48px min interactive rows, 36px min buttons. This has never been
audited; it is currently a convention, not a verified property.

When you are in a file, check its interactive elements against those floors and
raise anything short. This one is safety-adjacent, so it is the highest-value
item here despite being the least glamorous.

**Progress:** not started, no baseline count.

## 5. Frontend test runner

There is no frontend test runner at all. The 186 test files in this repo are all
backend Python. That is why ADR 0035's contrast logic shipped verified by a
throwaway script rather than by a test.

`pickInk` / `contrastRatio` in `ThemeContext.tsx` are pure functions with exact
expected values already documented in ADR 0035 - a good first test if someone
stands up vitest.

**Not opportunistic.** This one needs its own commit. Listed here so it is not
forgotten.

## 6. Crew-facing surfacing for refused queue entries

Every offline queue now honors ADR 0013: a permanently-refused entry is marked
failed and kept, never deleted. But **keeping it and showing it are different
things**, and only some queues do the second.

| Store | Failed entries surfaced to crew? |
|---|---|
| `reimbursementStore`, `materialsStore`, `officeHoursStore` | yes, per-row with Retry/Discard |
| `estimatorQueue` | yes, synchronous error + the row's own delete |
| `jobChecklistStore` | yes, on the job card (2026-08-11) |
| `jobSetupStore` | **no** - `failedJobSetups` / `retryFailedJobSetup` / `discardFailedJobSetup` exist, nothing renders them |
| `bugReportStore` | **no** - `failedBugReportInputs` / retry / discard exist, unrendered |
| `featureRequestStore` | **no** - same |
| `rodsStore`, `ldDayStore`, `bolStore` | **no** - noted as the open follow-up in ADR 0013 since 2026-07-15 |

For the unrendered ones, a crew member's refused work is preserved and
**invisible**. That is strictly better than destroyed and is not a regression,
but they still do not know it did not land.

The store API is already there in every case, so this is a rendering job: find
the screen that owns the entity, show the failed entry with its
`failed_reason`, and wire Retry and Discard. `JobChecklistCard.tsx` is the
smallest reference implementation, including the bit that matters - it renders
the failed state **outside** the collapsed section, because a rejection nobody
opens a panel to find is still silent.

`jobSetupStore` is the one to do first: a job header is the most valuable of
the three unrendered ones.

**Progress:** 6 stores unrendered as of 2026-08-11 (3 of them long-standing).

## 7. Hardcoded colors, and promoting the lint rule to `error`

`eslint.config.js` warns on hardcoded hex outside the permanent exceptions. It is
deliberately **`warn`, not `error`**: there were ~38 pre-existing violations when
it landed, and shipping it as an error would have broken `npm run lint` for
everyone and invited a blanket disable.

When you are in one of these files, convert what you can:

| File | Warnings |
|---|---|
| `pages/Admin.tsx` | 13 |
| `components/RolePreviewSwitch.tsx` | 8 |
| `lib/confetti.ts` | 6 |
| `lib/rodsStore.ts` | 4 |
| `App.tsx` | 2 |
| `components/SignaturePad.tsx` | 2 |
| `components/BillOfLadingForm.tsx` | 1 |
| `pages/ReportBug.tsx` | 1 |
| `pages/RequestFeature.tsx` | 1 |

Some of these are genuine exceptions rather than drift (a canvas stroke color has
to be a literal because the Canvas API cannot take a CSS var; confetti particles
are decorative). Those get an `eslint-disable-next-line` **with a reason** at the
site, not a config entry, so the exception is visible where someone reads it.

**When the count reaches zero, change `'warn'` to `'error'`** in
`eslint.config.js` and delete this item.

**Progress:** 38 warnings as of 2026-08-10.

> Separately: `npm run lint` currently reports ~277 **pre-existing errors** from
> other rules (mostly `no-unused-vars`), unrelated to any of this. Lint was
> already red before the color rule landed. Worth its own cleanup someday; not
> this doc's problem.

---

## Not on this list, deliberately

A third-party drift scan (ReWeaver AI beta, 2026-08-10) reported 2,631 "critical"
findings and 5,658 hours of remediation against this repo. Most of that total was
one rule (`spacing-hardcoded`) counted per occurrence, its worked example was a
false positive (a responsive `maxWidth`, not a spacing value), and its per-file
ranking tracked file size more closely than defect density.

Items 1-5 above are what survived checking those findings against the source.
Two genuine bugs also came out of that triage and were fixed outright rather than
listed here (ADR 0035). If a future scan produces another large number, the useful
move is the same: verify a sample against the code before treating any of it as a
work list.
