# 0050 - Colorblind availability palettes live on the account, and recolor only your own view

Date: 2026-09-14
Status: Accepted

**Driving scenario:** Feature request from the owner, 2026-09-04: "We have a color
blind employee. Crew facing availability tools should have a color blind friendly
palette mode. Color blind pallete should translate to the conventional color
pallette by default in admin facing views." Confirmed at intake, 2026-09-14, as what
goes wrong today: on the crew Availability screen they cannot tell which days they
marked available vs. unavailable, so they submit wrong days or cannot check what they
sent, and the office then schedules them on days they cannot work.

**User classes affected** (owner-confirmed 2026-09-14): Mover, specifically the
color-blind crew member, who picks a palette and sees it on their own Availability
screens. Nobody else changes: every other crew member keeps the standard colors
unless they choose otherwise, and admin views stay conventional.

**Assumption this rests on:** That availability is the tool where color alone
carries meaning this person needs. If they struggle the same way elsewhere (sync
status, close-out checks, payroll marks), the owner's scope decision, Availability
only, is what to reopen, and the palette would move from this screen to the theme
tokens.

## Context

Availability status was shown by color alone on the calendar, the quick-fill
buttons, and the History grid: `var(--ok)`, `var(--danger)`, `var(--warn)`, green,
red and amber on every theme. Red vs. green is precisely the pair the most common
color blindness cannot separate, and nothing else in a calendar cell said which
status it was.

Theme settings (the obvious home) are saved per device, with one admin-set server
default. A per-person, cross-device setting did not exist anywhere in theming.

## Decision

Owner's choices at intake, 2026-09-14:

1. **Modes:** standard, red-green (covers both common types), deuteranopia,
   protanopia, tritanopia, monochrome. The owner selected both the combined red-green
   mode and the split pair, so all three are offered.
2. **A short word in each cell** (`Avail` / `Unavail` / `Cond`) whenever a
   colorblind mode is on, so color is never the only cue. No emoji and no symbols,
   by the owner's direction. Standard mode is unchanged: no words added.
3. **Availability only.** The rest of the app keeps its colors.
4. **On the account:** `users.availability_palette`, set via `PATCH /api/auth/me`,
   validated against the six names.
5. **Own view only.** `useStatusPalette(ownView)` returns standard whenever the
   person on screen is not the signed-in user, which is the admin opening someone's
   availability (`?admin_user=`). The admin month grid never reads the setting.

How it is built:

- **Solid fills with computed ink**, not the 18% tints the standard palette uses. A
  tint over the theme background shifts with the theme, and a palette validated for
  a kind of color blindness has to look the same on every theme. Each set was
  checked with a Machado 2009 simulation: every pair of statuses stays at least
  dE2000 36 apart under the vision it is for and under normal vision, and the word on
  every fill is at least 4.8:1. `frontend/scripts/verify_availability_palette.mjs`
  re-runs that check, and fails if a fill is swapped for a confusable one.
- **Offline:** a choice is written to `availability_palette_pending_v1:<user id>`
  and applies at once. `drainAvailabilityPalette` sends it on boot and on `online`
  from App.tsx, only while that same user is signed in, then drops the local copy
  and hands the updated profile to `setUser`. The key is deliberately outside the
  `mm_` / `crew_` prefixes `clearCrewState` wipes, so a choice made offline survives
  a sign-out.

## Alternatives not taken

- **Symbols only, no palette mode.** Rejected by the owner: the employee would still
  see colors they cannot tell apart.
- **App-wide colorblind mode.** Rejected by the owner as past the request. Recorded
  in the assumption above as the thing to reopen.
- **Saved on the device, like the theme.** Rejected by the owner: lost on a new phone
  or a reinstall. (The first version of the intake question wrongly said theme
  settings were already per account; the owner re-answered after the correction.)
- **Tints instead of solid fills.** Contrast and distinguishability would depend on
  the theme, which defeats validating the palette.

## Consequences

- One new column with a server default, so every existing user reads `default`,
  exactly today's look. `migrate_users_staging_to_prod.py` does not copy it: staging
  test choices should not reach prod accounts.
- A value this build does not know (from a later build) falls back to standard on
  the client, and `UserResponse` still serializes it.
- The monochrome available fill is near-white, so its status dot in the Notes list
  is faint on a light theme. The word beside the dot carries the meaning.
- The setting is on My Profile. Nothing on the Availability screen points to it;
  whether the employee can find it unaided is a question for the sanity pass.
