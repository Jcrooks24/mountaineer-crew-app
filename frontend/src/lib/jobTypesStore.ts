// Loads the admin-configurable job-type tags from the server, with a
// localStorage cache and the built-in list as the ultimate offline fallback so
// the Report still renders choices with no connectivity.

import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { JOB_TYPE_TAGS } from "./jobTypes";

const CACHE_KEY = "crew_job_types_v1";

type JobTypeRow = { id: number; name: string; sort_order: number; active: boolean };

export function cachedJobTypes(): string[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr as string[];
    }
  } catch {
    /* fall through to defaults */
  }
  return [...JOB_TYPE_TAGS];
}

export async function fetchJobTypes(): Promise<string[]> {
  const rows = await apiFetch<JobTypeRow[]>("/api/job-types");
  const names = rows.map((r) => r.name);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(names));
  } catch {
    /* quota - noop */
  }
  return names;
}

// Returns the current job-type tags (cache-first, refreshed from the server).
export function useJobTypes(): string[] {
  const [types, setTypes] = useState<string[]>(cachedJobTypes);
  useEffect(() => {
    fetchJobTypes().then(setTypes).catch(() => {/* offline - keep cache */});
  }, []);
  return types;
}
