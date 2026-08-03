/**
 * Vehicle-unit fleet registry client (weight/dims for DOT weight compliance).
 *
 * Offline-first: a synchronous cached getter backs every read (localStorage),
 * with an async refresh from the server when online. DVIR, BOLs, and the
 * inventory weight flags all read this to show a unit's specs and to compute
 * payload capacity (GVWR - dry weight). Admin edits the list in Settings.
 */
import { apiFetch } from "../api/client";

export type VehicleUnit = {
  name: string;
  dry_weight_lbs: number | null;
  gvwr_lbs: number | null;
  length_ft: number | null;
  width_ft: number | null;
  height_ft: number | null;
  axle_capacities_lbs: number[];
  notes?: string;
};

const CACHE_KEY = "crew_vehicle_units_v1";

/** Synchronous best-available fleet list (cache, else empty). Never throws. */
export function getUnitsCached(): VehicleUnit[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setCache(units: VehicleUnit[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(units));
  } catch {
    /* storage full / disabled - the cache is best-effort */
  }
}

/** Fetch the latest fleet and update the cache. Resolves to the cached list on
 * failure so a caller always gets something usable. */
export async function refreshUnits(): Promise<VehicleUnit[]> {
  try {
    const r = await apiFetch<{ units: VehicleUnit[] }>("/api/config/vehicle-units");
    const units = Array.isArray(r?.units) ? r.units : [];
    setCache(units);
    return units;
  } catch {
    return getUnitsCached();
  }
}

/** Find a unit by its name / number (case-insensitive, trimmed). */
export function unitByName(units: VehicleUnit[], name: string | undefined | null): VehicleUnit | undefined {
  const n = (name || "").trim().toLowerCase();
  if (!n) return undefined;
  return units.find((u) => (u.name || "").trim().toLowerCase() === n);
}

/** Payload capacity (lb) = GVWR - dry weight, or null when either is unset. */
export function payloadCapacity(u: VehicleUnit | undefined | null): number | null {
  if (!u || u.gvwr_lbs == null || u.dry_weight_lbs == null) return null;
  return Math.max(0, u.gvwr_lbs - u.dry_weight_lbs);
}
