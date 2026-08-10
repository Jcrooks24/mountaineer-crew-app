# 0035. Ink on a filled surface is computed from the fill, not from the Text-Color setting

**Status:** Active. Shipped to staging 2026-08-10.

## Context

`--on-brand` is the ink used for text sitting **on** a brand-filled surface:
primary buttons and active tabs. Until now `applySettings` derived it from the
user's **Text-Color** setting, alongside `--text` and `--muted`:

```ts
if (settings.textMode === "light" && bgIsDark) {
  root.style.setProperty("--text", "#f5f7fa");
  root.style.setProperty("--muted", "#c6cedb");
  root.style.setProperty("--on-brand", "#f5f7fa");   // <- the bug
}
```

The reasoning was sound as far as it went: the app should follow the setting
"end-to-end." The existing guard is also careful, and correctly refuses a forced
mode that conflicts with the theme's **background** polarity (that is what made
Enterprise Dark unreadable on "Dark text").

The gap is that a brand-filled surface has its **own** polarity, independent of
the page background. Five of our presets are dark themes with a *bright* brand.
On those, the body text is correctly light while the button ink must be dark.
Coupling them meant that a crew member setting Text-Color to "Light text" put
`#f5f7fa` on the brand fill:

| Preset | Brand | Ink was | Contrast |
|---|---|---|---|
| dark-ocean | `#5dd6c2` | `#f5f7fa` | **1.65:1** |
| forest | `#34d399` | `#f5f7fa` | **1.79:1** |
| sunset | `#fb923c` | `#f5f7fa` | **2.11:1** |
| steel | `#58a6ff` | `#f5f7fa` | **2.35:1** |
| midnight-purple | `#a78bfa` | `#f5f7fa` | **2.54:1** |

All five fail WCAG AA (4.5:1) and also the 3:1 floor for large text and UI
components. The label is technically rendered and effectively invisible. This is
crew-triggerable from Settings, on the most-tapped controls in the app, used
outdoors in sunlight. Nothing in the codebase was wrong in a way a diff would
show, which is why it survived: the failure is a *combination* of two settings,
not a line of bad code.

## Decision

**`--on-brand` is decided by the brand color. The Text-Color setting drives body
text only, and no longer touches it.**

`pickBrandInk(brand)` returns whichever of `#0b1220` / `#f5f7fa` has the higher
WCAG contrast against the brand. Precedence:

1. **A user brand override always computes.** No authored value can anticipate
   an arbitrary color, so `brandOverride` ignores any declared `--on-brand`
   (declaring white and then picking a yellow brand would be unreadable).
2. **Otherwise a preset's declared `--on-brand` wins.** That is a deliberate
   authored choice; the enterprise blue wants white even though the computed
   result agrees.
3. **Otherwise compute** from the preset's brand.

`relLuminance` returns `0.5` for anything it cannot parse, which resolves to the
dark ink. That is the value this defaulted to before, so an unparseable brand
override degrades to the old behavior rather than to something unreadable.

## The same defect on `--ok`

Auditing the remaining hardcoded inks turned up a second instance of this exact
class, which is why the helper is named `pickInk` and not `pickBrandInk`.

The completed-state checkbox fills with `--ok` and draws a glyph on it. The two
call sites had drifted to **opposite** answers, and each is unreadable on the
themes the other handles:

| Call site | Ink | Worst case |
|---|---|---|
| `JobChecklistCard.tsx` | `#fff` | **1.74:1** on midnight-purple / sunset |
| `JobReport.tsx` | `#0b1f14` | **3.43:1** on enterprise-light |

`--ok` is a bright green on 7 of 8 presets and a dark forest green on
enterprise-light, so no single literal works. Both now use a computed `--on-ok`,
which scores **4.67 to 10.74** across all eight. `--ok` has no user override, so
the preset value is final.

The checkbox glyph is the thing that tells a crew member whether a checklist item
is done. It was rendering at under 2:1 on two presets.

## Consequences

- The default experience is **unchanged**. Of 24 preset x text-mode combinations,
  19 produce byte-identical output and 5 are the failures above. Every
  combination is now at or above 4.45:1.
- Text-Color no longer affects buttons and active tabs. This is intended. If
  someone reports it as a regression, the answer is that the setting was never
  able to express "light body text, dark button ink," which is what these five
  themes actually need.
- Call sites that write `var(--on-brand, #fff)` have a dead fallback:
  `applySettings` always sets the variable, on every path. Harmless, but
  misleading. Logged in [INCREMENTAL_WORK.md](../INCREMENTAL_WORK.md) rather
  than swept here, to keep this commit to the behavioral fix.

## Do not undo

Do not move `--on-brand` back into the Text-Color branches "so the setting
applies everywhere." Body text and brand ink sit on surfaces with independent
polarity; one setting cannot serve both. If brand ink ever needs to be
user-facing, it needs its own control, not a reuse of this one.

## Provenance

Found while triaging a third-party design-drift scan (ReWeaver AI beta). The
scan did not report this. It flagged the `var(--on-brand, #fff)` fallbacks as
generic hardcoded-color findings, ranked below ~3,800 hours of "hardcoded
spacing"; the actual defect surfaced only from reading `applySettings` to check
whether those findings were real. Worth remembering about that class of tool:
the finding list was a prompt to look, not a diagnosis.
