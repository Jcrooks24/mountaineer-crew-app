// Beta-feature registry.
//
// Any feature listed here renders a "beta" subtext under its section header
// (via <BetaTag feature="..." />). The tag persists until the next manual
// APP_VERSION bump, at which point graduated features are removed from the
// set. APP_VERSION is the user-facing milestone the crew sees in patch notes
// (e.g. "1.4", "1.5") - not the per-deploy build id.
//
// On version bump:
//   1. Bump APP_VERSION below.
//   2. Remove every entry in BETA_FEATURES that has now stabilized.
//   3. Add the keys for any features introduced in this new version.
//
// Adding a new beta feature mid-version:
//   1. Add its key to BETA_FEATURES.
//   2. Drop <BetaTag feature="<key>" /> next to the feature's section header.

export const APP_VERSION = "1.7";

// All v1.6 betas graduated at the v1.7 bump:
//   digitalBOL, rosterTypeahead, manualJobsCrossDevice, autoLaborLines,
//   podsPerDriver, bolInventoryTab.
// Add the next round of beta keys here as new features ship.
export const BETA_FEATURES: ReadonlySet<string> = new Set<string>([
  "jobTypeTags",
  "employeeSkillRating",
  "truckFullness",
  "actualInventory",
  "multiPhoto",
  "incidentReporting",
  "skillRater",
  "offJobHours",
  "chowVolume",
  "returnTrip",
  "workedHours",
  "closeout",
  "bulletin",
  // The day plan gained "Internal rearrange" (2026-09-02). A new option on a
  // prompt every interstate crew answers daily is a new thing to notice, and the
  // tag is how they are told to look. Graduates at the next APP_VERSION bump.
  "internalRearrange",
  // Tap-a-field-title help on the Bill of Lading details (2026-09-03; reworked
  // 2026-09-09 into a toast with a visible countdown, and trimmed to the nine
  // fields that actually need explaining). A new interaction is worth nothing if
  // nobody discovers it, and the "?" alone is easy to miss.
  "setupFieldHelp",
  // Employee directory in Tools (2026-09-04).
  "employeeDirectory",
  // Bill lines are now checked one at a time instead of with a single "I
  // reviewed the bill" tick (2026-09-09, ADR 0044). It is more taps at close-out
  // and the crew will notice, so it says so rather than looking like a bug.
  "billLineChecks",
]);

export function isBeta(feature: string): boolean {
  return BETA_FEATURES.has(feature);
}
