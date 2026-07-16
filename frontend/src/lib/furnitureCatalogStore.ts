// The unified furniture catalog: server rows (admin-managed + CSV-imported)
// merged with the built-in list, cached for offline. Used by both the
// Estimator and the job Actual-Inventory search so one upload feeds both.

import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { FURNITURE_CATALOG } from "../data/furnitureCatalog";

export type CatalogItem = {
  name: string;
  weight_lbs: number;
  cubic_ft: number;
  category: string | null;
};

const CACHE_KEY = "crew_furniture_catalog_v1";

function builtin(): CatalogItem[] {
  return FURNITURE_CATALOG.map((f) => ({
    name: f.name,
    weight_lbs: f.weight_lbs,
    cubic_ft: f.cubic_ft,
    category: f.category,
  }));
}

// Server rows win; built-in entries are appended only when their name isn't
// already a server row (case-insensitive), matching the Estimator's merge.
function merge(server: CatalogItem[]): CatalogItem[] {
  const seen = new Set(server.map((s) => s.name.trim().toLowerCase()));
  return [...server, ...builtin().filter((b) => !seen.has(b.name.trim().toLowerCase()))];
}

export function cachedCatalog(): CatalogItem[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return merge(arr as CatalogItem[]);
    }
  } catch {
    /* fall through */
  }
  return builtin();
}

export async function fetchCatalog(): Promise<CatalogItem[]> {
  const rows = await apiFetch<CatalogItem[]>("/api/furniture-catalog");
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
  } catch {
    /* quota - noop */
  }
  return merge(rows);
}

export function useMergedCatalog(): CatalogItem[] {
  const [items, setItems] = useState<CatalogItem[]>(cachedCatalog);
  useEffect(() => {
    fetchCatalog().then(setItems).catch(() => {/* offline - keep cache */});
  }, []);
  return items;
}

// Names split for the two Actual-Inventory search boxes.
export function splitCatalogNames(items: CatalogItem[]): { furniture: string[]; boxes: string[] } {
  const furniture: string[] = [];
  const boxes: string[] = [];
  for (const it of items) {
    if ((it.category || "").toLowerCase() === "boxes") boxes.push(it.name);
    else furniture.push(it.name);
  }
  return { furniture, boxes };
}
