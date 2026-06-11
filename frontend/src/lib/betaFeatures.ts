// Beta-feature registry.
//
// Any feature listed here renders a "beta" subtext under its section header
// (via <BetaTag feature="..." />). The tag persists until the next manual
// APP_VERSION bump, at which point graduated features are removed from the
// set. APP_VERSION is the user-facing milestone the crew sees in patch notes
// (e.g. "1.4", "1.5") — not the per-deploy build id.
//
// On version bump:
//   1. Bump APP_VERSION below.
//   2. Remove every entry in BETA_FEATURES that has now stabilized.
//   3. Add the keys for any features introduced in this new version.
//
// Adding a new beta feature mid-version:
//   1. Add its key to BETA_FEATURES.
//   2. Drop <BetaTag feature="<key>" /> next to the feature's section header.

export const APP_VERSION = "1.5";

export const BETA_FEATURES: ReadonlySet<string> = new Set<string>([
  "crewFeedback",
  "reimbursementPhotoLibrary",
  "reimbursementExpenseDate",
  "schedulingAvailability",
]);

export function isBeta(feature: string): boolean {
  return BETA_FEATURES.has(feature);
}
