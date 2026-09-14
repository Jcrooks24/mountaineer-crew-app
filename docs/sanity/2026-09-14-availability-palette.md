# Sanity check - Availability colorblind palette (area 3, partial)

Date: 2026-09-14
Branch: `staging` @ `d1a6077`
Surfaces: `pages/Availability.tsx` (Submit calendar, quick fill, notes, History,
future absence), `pages/Profile.tsx` (`AvailabilityPaletteCard`, `#colors` deep
link), `lib/availabilityPalette.ts`, `PATCH /api/auth/me`

Run because the palette is a new feature
([ADR 0050](../decisions/0050-colorblind-availability-palettes-live-on-the-account-and-recolor-only-your-own-view.md))
and the repo's rule is that a feature is not done until this pass has run and the
owner has ruled on the findings. **Scope is the palette and its hint only**, not
the whole Time capture siblings area: Off-job, Office hours and LD workday were not
walked, so that ledger row stays partly unchecked.

## 1. Tool and stated job

From the Profile card (`Profile.tsx:374-376`): "Changes the colors on your
Availability screens, and adds a word to each day. The office still sees the
standard colors." From [CREW_GUIDE.md](../CREW_GUIDE.md) section 11.1, the same,
plus "It is saved to your account, so it follows you to a new phone, and it works
without signal." From the owner, 2026-09-14: "make sure to add a hint ... so they
can find the pallete settings."

These agree. The job: **let a color-blind crew member read their own availability,
and find the setting that makes that possible, without the office's view changing.**

## 2. Scenario map

| Scenario | Answered by | Verdict |
|---|---|---|
| Color-blind crew member opens Availability while a window is due | Hint under the Submit instructions, `Availability.tsx:541` | covered |
| Same person on a day nothing is due (the usual state) | Caught-up view, `Availability.tsx:512-513` | **gap, F1. No hint** |
| Same person checking what they sent, on History | History tab, `Availability.tsx:502` | **gap, F1. No hint** |
| Can tell the colors apart once chosen | Solid fills + word per cell, `Availability.tsx:619, 676, 1070` | covered, but see F2 and F4 |
| Chose a palette, wants to get back to Availability | My Profile back arrow, `Profile.tsx:169` | **friction, F3** |
| New or replaced phone | Account column, returned by `GET /me` (`auth.py:118`) | covered |
| No signal when choosing | Local key applies at once (`availabilityPalette.ts` `effectivePalette`) | covered, sync lags, F5 |
| Shared phone, another crew member signs in | Key per user id, drain guarded by signed-in id | covered |
| Admin opens this person's availability | `useStatusPalette(isViewingSelf)`, `Availability.tsx:89` | covered, standard colors |
| Admin month grid | never reads the setting (no reference in `Admin.tsx`) | covered, standard colors |
| Chose on two phones, one of them offline | last drain wins | ambiguous, F6 |
| "My calendar looks different", asked of the office | nothing on the office side | **gap, F8** |
| Color-blind person in any other tool | out of scope by the owner, 2026-09-14 | not a finding |

## 3. Friction count

From a due Availability window: tap the hint (1), tap a palette (1), get back to
Availability via the in-app back arrow, then Tools and the Availability tile (2).
**4 taps, 0 typed characters.** 3 taps using the phone's own back gesture, if it
returns to `/availability` (unverified).

## 4. Findings

| # | Q | Severity | Finding | Evidence | Suggested direction |
|---|---|---|---|---|---|
| F1 | Q5 | Med | The hint only renders inside the Submit picker, which shows only when a window is due or unlocked. On the caught-up view (most days) and on History, there is no hint, so "always" is really "only when availability is due". | `Availability.tsx:421` (`showPicker = horizonLow \|\| unlock`), `:502-513` (History and CaughtUpView branches), hint at `:541` inside the picker branch | Render the hint once above the tabs on the person's own view, so every state carries it |
| F2 | Q7 | Med | "Unavail" likely does not fit a calendar cell at 390px. Width budget: container 14px each side, card padding, 6 gaps of 6px across 7 columns, then 6px cell padding, leaves roughly 30px of content width; "Unavail" at 9px weight 800 is roughly 38px. It will overflow the cell edge or clip. | cell padding `Availability.tsx:664` area (`padding: 6`), grid `gap: 6`, `.container{ padding: 14px }` `index.css:70`, label `:620, :677, :1071` | Confirm on a phone first (Needs a human look). If it overflows: a shorter word set, or let the label wrap under the date |
| F3 | Q3 | Med | After choosing a palette, the in-app back arrow on My Profile goes to the Profile landing, not back to Availability, where the person came from and where the result is visible. | `Profile.tsx:169-175` sets `view` to `"main"` | When arrived via `#colors`, back returns to `/availability` |
| F4 | Q7 | Low | Locked days in the Submit calendar render at 55% opacity, which blends the validated fill and its word into the page background. The contrast and distinguishability checks were done on the full-strength fills. Locked cells appear in unlocked or partly locked windows. | `Availability.tsx:667` (`opacity: locked ? 0.55 : 1`) | Show "locked" another way (the lock icon is already there) instead of fading the whole cell in colorblind modes |
| F5 | Q6 | Low | A palette chosen offline reaches the account only when the job screen (`App`) is mounted, because the drain lives in App.tsx and `/availability` and `/profile` are separate routes. The Profile note promises "when you are back online". It applies on this phone meanwhile, so nothing is lost unless the phone is replaced before the job screen is opened. | `main.tsx:81, 91` vs `:96-100` (`App` on `/*`), drain wiring in `App.tsx` `drainPalette`, note `Profile.tsx:364` | Also drain on `online` from somewhere always mounted, or soften the note |
| F6 | Q6 | Low | Two phones: a choice made offline on phone A, then a different choice made online on phone B, is overwritten by A's older choice when A next drains. | `drainAvailabilityPalette` sends whatever is pending, with no age check | Accept as rare, or drop a pending choice older than the account's last change |
| F7 | Q7 | Low | The hint's tap target is 32px tall, under the 48px row minimum and the 36px button minimum. | `Availability.tsx:544` (`minHeight: 32`), [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md) line 123 | Use `var(--space-btn-min)` or the row minimum |
| F8 | Q5 | Low | The office cannot see which palette a crew member has chosen, or reset it. If someone picks Monochrome by accident, or asks why their calendar looks different, nothing on the admin side explains it. | no reference to `availability_palette` in `Admin.tsx` | Show the palette name on the roster row, read-only |

## 5. Verified good

- **Standard mode is unchanged.** `STANDARD` in `availabilityPalette.ts` uses the same
  `--ok` / `--danger` / `--warn` tints the old constant did, with no word added.
- **Admin views stay standard.** `useStatusPalette(false)` whenever `admin_user` is
  set (`Availability.tsx:86, 89`); the admin month grid never reads the setting.
- **Server round-trip.** `PATCH /me` writes it (`auth.py:126` and the new branch),
  `GET /me` and `PATCH /me` both return `UserResponse` (`auth.py:118, 126`), which
  carries the field; an unknown name is a 422, and an unknown stored value still
  serializes.
- **Offline and shared phones.** The pending key is outside the `mm_` / `crew_`
  prefixes `clearCrewState` wipes, keyed by user id, and only sent while that user
  is signed in (pinned in `verify_availability_palette.mjs`).
- **No confirmation on picking a palette, correctly.** It is routine, instant and
  reversible from the same list; a confirm there would only teach tapping through.
- **Color is never the only cue in a colorblind mode:** words on calendar cells,
  quick-fill buttons, and History; status words already present in Notes and the
  future-absence picker; page text uses `var(--text)`, never a fill color.
- **Beta tag** present on the setting (`Profile.tsx:372`).
- **Default value:** every account defaults to `default` (server default in the
  migration), which is exactly today's look. Nobody's screen changes unless they choose.
- **Palette validation is real, not decorative:** the verifier fails when a fill is
  swapped for a red-green-confusable one (checked by mutation, deutan min 6).

## 6. Needs a human look

1. **F2, on a phone at normal width:** pick **Protanopia**, open Availability while a
   window is due. Look at a day marked Unavailable that also has a note and is
   today. Report: does "Unavail" sit inside the cell, overflow its edge, or get cut off?
   Is the cell taller than its neighbours?
2. **Dark theme:** switch to a dark theme, pick **Tritanopia**, then **Monochrome**.
   Report: can you tell a Conditional day (dark gray) from an unset day, and an
   Unavailable day (near-black) from the card background?
3. **F3 and the hint:** from Availability, tap "Colorblind-friendly colors". Report:
   did it land on My Profile with the setting in view? Then use the phone's own back
   gesture (not the arrow). Report: did it return to Availability?
4. **F1:** on a day when nothing is due, open Availability. Report: is the hint anywhere
   on screen?

### Owner's results, 2026-09-14

"I think the my eyes points pass besides 3: link does not return to availability on
back button."

- **Item 1 passed: F2 closed.** "Unavail" fits the cell on a real phone; the width
  estimate above was wrong.
- **Item 2 passed:** Tritanopia and Monochrome are distinguishable on a dark theme.
- **Item 3 failed: F3 confirmed**, and it is not only the in-app arrow: going back does
  not return to Availability.
- **Item 4 reported as passing,** which disagrees with the code for the caught-up state
  (`Availability.tsx:421, 502-513`). Open until it is re-checked on a day with nothing
  due; F1 stays open meanwhile.

### Rulings, 2026-09-14

| # | Ruling | Where it went |
|---|---|---|
| F1 | declined (item 4 not re-checked) | RUNBOOKS Known defects; ADR 0050 corrected |
| F2 | closed, did not reproduce on a phone | - |
| F3 | **approved, fixed** | back arrow on My Profile returns to Availability when opened from its link; pinned in `verify_availability_palette.mjs` |
| F4 | declined, polish | dropped |
| F5 | declined | RUNBOOKS Known defects |
| F6 | declined | RUNBOOKS Known defects |
| F7 | declined, polish | dropped |
| F8 | declined, taste | dropped |

**Open findings: 0.** The phone's own back gesture from the setting still wants one
re-check: no code in the app intercepts history, so it should already return.

## 7. Unverified from here

- The migration `t1v3x5z7b9d1` against a real Postgres (runs on the staging deploy).
- The phone's own back gesture from `/profile#colors` (item 3 above).
- Screen-reader output for a cell: `aria-label` includes the status name
  (`Availability.tsx` calendar button), but nothing was listened to.

---

**Nothing was changed in this pass** apart from this report and the Coverage ledger
row. Approved findings go through Batch mode in the debugging protocol.
