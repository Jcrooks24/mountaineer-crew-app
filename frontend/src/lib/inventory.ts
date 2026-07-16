// Shared box-vs-furniture classification, used by the Actual Inventory add
// form (auto box flag) and the overage comparison (splitting an estimate's
// items into furniture vs boxes).

import { FURNITURE_CATALOG } from "../data/furnitureCatalog";
import { itemIsBox } from "./bolStore";

const CATALOG_BOX_NAMES = new Set(
  FURNITURE_CATALOG.filter((f) => f.category === "Boxes").map((f) => f.name.toLowerCase()),
);

/** True when an item counts as a box: a catalog "Boxes" entry (incl. "Dish
 * pack", which has no "box" in the name) or any name containing the word
 * "box" (so free-typed "Box of books" is caught too). */
export function isBoxItem(name: string): boolean {
  const n = (name || "").trim().toLowerCase();
  if (!n) return false;
  return CATALOG_BOX_NAMES.has(n) || itemIsBox(n);
}
