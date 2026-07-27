# 0025. Enterprise design system is the app's default look (facelift)

**Status:** Active, in progress. Started 2026-07-27. Supersedes the ad-hoc
inline-style visual language for new work. Rolls out screen by screen; this ADR
is the contract so the rollout stays consistent across sessions.

## Context

The UI grew screen by screen with inline `style={{}}` referencing theme CSS
vars. It works and it themes, but it reads as "vibe-coded": gradient surfaces,
decorative glows, ad-hoc font sizes and weights, status shown as filled pills,
`14px` radius everywhere, no mono treatment for data. A Figma Make exploration
("PWA Improvement Workflow") pushed toward a neutral, data-dense, enterprise
field-software look (ServiceNow / Samsara / Fleetio). The owner chose to adopt
it as the app's real identity, not a hidden option.

Two things had to be true before committing:
1. A dark theme that is actually readable in the field (see the fix below).
2. A small, reusable primitive set so the rollout is consistent and cheap,
   rather than 20 screens each reinventing the look.

## Decision

**Adopt an enterprise design system as the default, delivered through theme
presets + a handful of reusable primitives, applied screen by screen. Full
re-layout (crew bottom-nav, admin data-tables) follows the restyle.**

1. **Default theme is `enterprise-dark`** (`DEFAULT_SETTINGS.themeId`). Existing
   users keep whatever they saved in localStorage; only new users / never-picked
   land on it. The other six presets and `enterprise-light` stay available.

2. **The look is carried by token VALUES, not new machinery.** `enterprise-dark`
   / `enterprise-light` collapse the gradient stops (`--card2 == --card`,
   `--brand2 == --brand`) so surfaces and primary buttons render flat, use a
   single corporate blue as the only interactive color, hairline borders, and a
   white `--on-brand` ink. Surfaces are lifted off near-black so the screen is
   readable in sunlight.

3. **Reusable primitives (in `index.css`), theme-agnostic so every preset gets
   them:**
   - `.mono` - DM Mono, tabular, for all data (IDs, counts, times, money, odo).
   - `.microLabel` - small uppercase tracked section labels.
   - `.statusDot` - colored dot + neutral text (color on the dot, never a pill).
   - `.seg` / `.segBtn` - segmented control (the OK/DEFECT toggle), for any small
     mutually-exclusive choice.
   Reference implementations: `DVIR.tsx`, `Reimbursement.tsx`.

4. **Readability fix (load-bearing):** the Text-Color override in
   `applySettings` was unconditional, so "Dark text" forced near-black text on
   *every* theme - unreadable on a dark one. It is now conflict-aware: a forced
   light/dark text mode is applied only when it matches the theme background's
   WCAG luminance; on a conflict the preset's own text wins. Without this, a dark
   theme is one settings toggle away from dark-on-dark.

5. **Rollout order:** crew-facing mobile tools first (DVIR and Reimbursement
   done → Job Report, Materials, BOL, RODS, Long-distance, Off-job, the hub),
   then the admin console. Layout restructure (bottom-nav shell, admin
   data-tables) is a distinct phase after the restyle, verified on device
   because it changes crew muscle memory.

See [docs/DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md) for the concrete tokens,
primitives, and per-pattern rules every screen follows.

## Consequences

- New and restyled screens must use the primitives, not one-off inline styles,
  or the drift this ADR exists to end comes right back.
- Everything stays theme-agnostic (theme vars, `color-mix` on `--ok`/`--danger`),
  so the six legacy presets keep working - the facelift is not a hard fork of the
  theming system.
- The layout restructure is high-risk on a field-critical, offline-first app.
  It ships incrementally, per screen, verified, never as a big-bang - a crew
  cannot afford a nav they can't parse mid-job.

## What would break if you undid this

Reverting the default to `dark-ocean` is safe (cosmetic). Reverting the
conflict-aware text guard re-opens the dark-on-dark bug for any dark theme.
Dropping the primitives and going back to per-screen inline styles reintroduces
the exact drift and "vibe-coded" inconsistency the facelift set out to fix.
