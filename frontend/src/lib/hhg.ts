/**
 * Household-goods weight rule of thumb.
 *
 * Loaded household goods (HHG) average about 7 lbs per cubic foot across a mixed
 * load - the industry planning figure moving companies use to turn a volume
 * estimate into a rough weight. We show that weight alongside any volume
 * estimate in the app (truck fill, etc.) so crew and office have a feel for the
 * tonnage, not just the space. It is a planning average, not a scale reading.
 *
 * Keep this the single source of the factor so every "cu ft -> lbs" readout in
 * the PWA stays consistent.
 */
export const HHG_LBS_PER_CUFT = 7;

/** Rough HHG weight (lbs) for a volume in cubic feet, rounded to a whole pound. */
export function hhgWeightLbs(cuft: number): number {
  return Math.round((cuft || 0) * HHG_LBS_PER_CUFT);
}
