# Design System (Enterprise facelift)

The visual contract for the app. New and restyled screens follow this so the UI
reads as one system, not 20 screens each reinventing the look. Rationale and
rollout plan: [ADR 0025](decisions/0025-enterprise-design-system-facelift.md).

**Golden rule:** use theme CSS vars and the primitives below. Do **not** hardcode
colors or reinvent a component inline. If you reach for a hardcoded hex, that is
almost always a bug on some theme.

## Tokens (theme vars, set per preset in `theme/ThemeContext.tsx`)

| Var | Use |
|---|---|
| `--bg` | Page background |
| `--card` / `--card2` | Card surface (enterprise collapses them → flat) |
| `--text` | Primary text |
| `--muted` | Secondary / label text |
| `--border` | Hairline borders, dividers |
| `--brand` / `--brand2` | The single interactive color (enterprise collapses → flat solid) |
| `--on-brand` | Ink on a brand-filled surface (button/active tab). **Computed** from the brand color by contrast, never from the Text-Color setting ([ADR 0035](decisions/0035-brand-ink-is-computed-from-the-brand-color.md)). Always set, on every path - do not write a `var(--on-brand, #fff)` fallback |
| `--ok` `--danger` `--warn` `--scheduled` | Semantic status ONLY |
| `--on-ok` | Ink on an `--ok`-filled surface (the completed-state checkbox). Computed, same rule as `--on-brand` |

- **Never** put dark text on a dark theme or light on a light one. The
  Text-Color guard in `applySettings` enforces this at the theme level; do not
  fight it with hardcoded `color`.
- Status colors are for **meaning**, never decoration. A tint uses
  `color-mix(in srgb, var(--danger) 16%, transparent)` so it follows the theme.

## Type

- **UI text:** Inter, weights 400 / 500 / 600. Do not exceed 600 in new work.
- **Data:** `.mono` (DM Mono, tabular) for everything that is a figure - IDs,
  counts, times, hours, money, odometer, coordinates. Figures should align.
- **Section headers:** `.microLabel` (11px, uppercase, tracked, muted). Not the
  old bold `.label`/`.sectionTitle`.

## Primitives (`index.css`) — use these, don't reinvent

| Class | What | Example |
|---|---|---|
| `.mono` | Tabular data font | `<span className="mono">{jobId}</span>` |
| `.microLabel` | Uppercase tracked section label | `<div className="microLabel">Vehicle Information</div>` |
| `.statusDot` | Colored dot + neutral text (color on the dot) | `<span className="statusDot" style={{['--dot']: 'var(--danger)'}}>Not sent</span>` |
| `.seg` / `.segBtn` | Segmented control (large touch targets) | OK/DEFECT, mode switches, pre/post-trip |
| `.card` | Standard surface | section container |
| `.btnPrimary` | Primary action (flat solid on enterprise) | submit |

Reference implementations to copy from: `pages/DVIR.tsx` (segmented toggle,
dot-status, micro-labels, mono) and `pages/Reimbursement.tsx` (segmented mode
switch, mono money/odo, dot status badge).

## Patterns

- **Status:** dot + text (`.statusDot`), never a filled pill.
- **Small mutually-exclusive choices:** `.seg`/`.segBtn`, never a pair of filled
  brand pills. Active segment tints with the semantic color (`--seg`).
- **Surfaces:** flat (enterprise collapses the card gradient). Radius is user
  radius setting; enterprise reads best on "Sharp".
- **Touch targets:** ≥40px in the field (crew wear gloves / carry furniture).
- **Beta features:** keep the `<BetaTag feature="..." />` until the next
  `APP_VERSION` bump (unchanged by the facelift).

## Intentional hardcoded colors (do NOT "fix" these)

The golden rule above says a hardcoded hex is almost always a bug. These are the
exceptions. They are deliberate, and a tool or reviewer sweeping for hardcoded
colors will flag every one of them.

| Where | Why it is correct |
|---|---|
| `theme/ThemeContext.tsx` | This is where the palettes are **defined**. Every preset value lives here by definition. |
| `components/ErrorBoundary.tsx` (8 values) | It has to render when theming has failed. Referencing a var that may never have been set is exactly the failure mode it exists to catch. Tokens here would be the bug. |
| `App.tsx` `optionStyle` | Native `<option>` elements do not reliably inherit themed colors across platforms. A fixed dark-on-white pair is the standard workaround. |
| `components/BillOfLadingForm.tsx` (`#fff` on `rgba(0,0,0,0.55)`) | An overlay label on a photo. The scrim is its own surface, not a themed one, so the ink is fixed against the scrim rather than the theme. |
| `pages/Admin.tsx` (~line 158, header text) | The admin backdrop is always a dark image regardless of the active theme, so `--text` would be wrong on light presets. Already commented in place. |

Anything **not** on this list that hardcodes ink on a themed fill is drift. The
pattern to reach for is a computed `--on-*` ink (see `pickInk` in
`ThemeContext.tsx`), not a literal that happens to look right on your theme.

## Reconciliation with the external Figma spec

An external design doc (Figma) specified this look in full. We adopt its
**direction and concrete values**, but deliberately did **not** adopt two things
(they would break real functionality — see ADR 0025):

- **We keep `ThemeContext` and the 8-preset system.** The Figma doc proposed
  ripping it out for a two-theme `data-theme` rewrite. The presets +
  user customization (brand, text-mode, density, radius) are a real feature.
  Enterprise ships **as a preset**; its values already match the doc.
- **We keep the existing token names.** Map Figma → ours: `--surface`→`--card`,
  `--raised`→`--card2`, `--sub`→`--muted`, `--primary`→`--brand`,
  `--primary-fg`→`--on-brand`, `--status-active`→`--brand2`,
  `--status-danger`→`--danger`, `--status-done`→`--ok`, `--status-sched`/`--status-warn`→`--scheduled`/`--warn`.
  Enterprise-dark uses **legibility-tuned** values (bg `#12151d`, card `#1e2532`,
  text `#edf1f7`), NOT the doc's darker originals — those were unreadable.

Enterprise flat/tight is enforced in `applySettings` (radius 4px, btn 3px, no
shadow, hairline border) whenever an `enterprise-*` preset is active. Button
label weight is capped at 600 globally.

## Layout — crew mobile shell (Phase B — bottom nav DONE)

- **Bottom tab bar — built** (`components/BottomNav.tsx`, mounted in `main.tsx`):
  persistent, self-hides on public + `/admin` routes. Tabs are **Jobs / DVIR /
  Docs / Profile** — the doc's "Active" tab was dropped because the hub (`/`) IS
  the active-job view here; Docs took its slot, other tools stay under Profile.
  Additive: every existing back-button / Tools-&-Resources path still works.
  `body` gets `padding-bottom` and `UpdateBanner` sits above the nav.
- **Top bar (still per-screen):** target is 44px, wordmark (Inter 600) left,
  online/offline dot + `.mono` label right, no hamburger/avatar. Not yet unified
  across screens - a follow-up.
- **Bottom tab active state:** a 24×3px `var(--brand)` bar above the icon +
  a 24×3px `var(--brand)` bar above the label + `var(--brand)` label (weight
  600); inactive = `var(--muted)`. No background fill on the active tab.
- **Job list item:** a card with a `border-bottom` status strip (`.statusDot`
  left, time in `.mono` right) — NOT a colored card header. Then customer name
  (Inter 600, 0.9375rem), address (`--muted`, 0.8125rem), then a `.mono`
  metadata row (job id · crew · type). Never color the status row background.
- Page container 12px horizontal padding; 8px gap between cards; 14px card
  padding; 48px min interactive-row height; 36px min button height. These are
  tokens in `index.css` - `--space-page`, `--space-gap`, `--space-card`,
  `--space-row-min`, `--space-btn-min`. **Use the token in new work.** Existing
  literals are converted opportunistically, never in a sweep (see
  [INCREMENTAL_WORK.md](INCREMENTAL_WORK.md)).

## Layout — admin desktop shell (Phase C — shell + roster table + metrics strip built; see Rollout status)

- **Sidebar:** 200px fixed, `var(--card)` bg, `border-right`. Active nav item =
  `border-left: 3px solid var(--brand)` + `background: var(--hover→--card2)`,
  NOT a fill.
- **Data tables** over cards; header row `var(--card2)` with `.mono` column
  labels; row hover = background shift only (`--card2`), no border/scale/shadow.
  Cell padding 11px 14px (data) / 8px 14px (header).
- **Metrics** = one bordered row split into columns (`.microLabel` + a large
  `.mono` value), NOT individual KPI boxes.

Do not start the layout restructure without confirming the nav IA first — crew
muscle memory is safety-critical.

## Rollout status

- Done (crew): `DVIR`, `Reimbursement`, `JobReport`, `BillOfLadingForm`,
  `LongDistance`, `OffJob`, `DocumentLibrary`, `RodsRecorder`, `RodsSignoff`,
  `TruckDeckGauge`, `Availability`, `Profile`, the crew hub (`App.tsx`, incl.
  Phase B action-grid drill-in + status chips → `.statusDot`). Materials is
  embedded in `App.tsx` and follows the hub's primitives.
- Admin console (Phase C): desktop sidebar shell **built**; roster is a data-table
  aligned to the spec (`.mono` header on `--card2`, row-hover shift, `.statusDot`
  status); Job Summary leads with a metrics strip (`.microLabel` + large `.mono`).
  Remaining: apply the data-table pattern to any other admin card-lists as they
  come up, and the metrics strip to other admin views if wanted.
- Not a from-scratch layout restructure - the shell exists; remaining work is
  converting specific views to the table/metrics patterns (ADR 0025). Confirm nav
  IA before moving where things live.
