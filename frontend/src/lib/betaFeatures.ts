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

export const APP_VERSION = "1.6";

// All v1.5 betas graduated at the v1.6 bump:
//   crewFeedback, reimbursementPhotoLibrary, reimbursementExpenseDate,
//   schedulingAvailability, schedulingNotes.
// Add the next round of beta keys here as new features ship.
export const BETA_FEATURES: ReadonlySet<string> = new Set<string>([
  "digitalBOL",
  // v1.6.x additions
  "rosterTypeahead",         // RODS driver + Employee Hours name typeahead
  "manualJobsCrossDevice",   // Manual "Other" jobs sync across devices
  "autoLaborLines",          // Employee hours auto-populate labor lines in Invoice Builder
  "podsPerDriver",           // Per-driver PODS checkbox on the Report tab
  "bolInventoryTab",         // Standalone Inventory tab on LD+ load/unload days
]);

export function isBeta(feature: string): boolean {
  return BETA_FEATURES.has(feature);
}
