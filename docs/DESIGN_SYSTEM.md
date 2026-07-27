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

## Layout (phase 2 — not yet built)

Crew = mobile-first bottom-nav shell; admin = desktop sidebar + data-tables.
These ship per screen, verified on device, after the restyle. Do not start a
layout restructure without confirming the nav information architecture first —
crew muscle memory is safety-critical.

## Rollout status

- Done: `DVIR`, `Reimbursement`.
- Next (crew): Job Report, Materials, BOL, RODS, Long-distance, Off-job, hub.
- Then: Admin console.
- Layout restructure: after the restyle, per ADR 0025.
