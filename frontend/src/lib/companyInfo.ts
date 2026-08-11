/**
 * Company (carrier) information - configurable in Admin > Settings > Company
 * information, read app-wide (notably the BOL carrier block, which used to be
 * hardcoded here and in bolPdf.ts).
 *
 * Offline-first: a synchronous cached getter backs every read (localStorage,
 * seeded with the historical defaults), and refreshCompanyInfo() updates the
 * cache from the server when online. The BOL PDF is generated both in the editor
 * and in the offline queue drain (bolStore.syncQueue), so the getter must be
 * synchronous and never throw.
 */

import { apiFetch } from "../api/client";

export type CompanyInfo = {
  name: string;
  address: string;
  phone: string;
  email: string;
  dot: string;
  mc: string;
};

// The values that were hardcoded before this became configurable - the fallback
// when nothing is cached or saved yet. Keep in sync with backend app/core/company.py.
export const COMPANY_DEFAULT: CompanyInfo = {
  name: "Mountaineer Moving LLC",
  address: "3021 S 27th Ave. #B, Bozeman, MT 59718",
  phone: "(406) 201-9580",
  email: "management@mountaineermoving.com",
  dot: "4557708",
  mc: "1811084",
};

const CACHE_KEY = "crew_company_info_v1";

function normalize(raw: Partial<CompanyInfo> | null | undefined): CompanyInfo {
  const out = { ...COMPANY_DEFAULT };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(COMPANY_DEFAULT) as (keyof CompanyInfo)[]) {
      const v = raw[k];
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
  }
  return out;
}

/** Synchronous best-available company info (cache, else defaults). Never throws. */
export function getCompanyInfoCached(): CompanyInfo {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    /* storage disabled / bad JSON - fall through to defaults */
  }
  return COMPANY_DEFAULT;
}

/** Write the cache (used after an admin save so the same device updates at once). */
export function setCompanyInfoCache(info: Partial<CompanyInfo>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(normalize(info)));
  } catch {
    /* storage full / disabled - the cache is best-effort */
  }
}

/** Fetch the latest company info and update the cache. Resolves to the cached
 * value on any failure (offline is fine - the app keeps the last known info). */
export async function refreshCompanyInfo(): Promise<CompanyInfo> {
  try {
    const r = await apiFetch<Partial<CompanyInfo>>("/api/config/company");
    const merged = normalize(r);
    setCompanyInfoCache(merged);
    return merged;
  } catch {
    return getCompanyInfoCached();
  }
}
