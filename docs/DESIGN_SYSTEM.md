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
| `--on-brand` | Ink on a brand-filled surface (button/active tab) |
| `--ok` `--danger` `--warn` `--scheduled` | Semantic status ONLY |

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
  padding; 48px min interactive-row height; 36px min button height.

## Layout — admin desktop shell (Phase C, not yet built)

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
  `TruckDeckGauge`.
- Next (crew): Materials, Availability, Profile, the crew hub (`App.tsx`).
- Then: Admin console.
- Layout restructure: after the restyle, per ADR 0025.
