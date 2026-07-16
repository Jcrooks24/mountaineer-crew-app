# 0016. A logged item is a snapshot, never a reference to the catalogue

**Status:** Active. This is how the code already works. Written down 2026-07-14 because
nothing was stopping someone from "improving" it.

## Context

The furniture catalogue (`furniture_catalog`) is an admin-maintained list of items with
weights and cubic feet, editable by CSV import. Four different things let a crew member
or an estimator put an item on a record: actual inventory (`job_inventory_items`), BOL
inventory (`digital_bols.items_json`), estimate items (`estimate_items`), and the chow
volume tool.

None of them store a catalogue id. Every one of them copies the item's **name** as a
plain string, and copies whatever numbers it needs (`is_box`, `qty`, `weight_lbs`,
`cubic_ft`, and the chow volume, which is frozen into the row's own `notes`) onto the
row at the moment it is added. Totals are recomputed from the stored rows, never from
the catalogue:

```python
def _recalc_totals(e: Estimate) -> None:
    e.estimated_weight_lbs = float(sum((it.weight_lbs or 0) * (it.qty or 0) for it in e.items))
    e.estimated_cubic_ft = float(sum((it.cubic_ft or 0) * (it.qty or 0) for it in e.items))
```

The catalogue is a **suggestion source**. It populates autocomplete. That is its whole
job. Nothing reads it back to interpret a row that already exists.

This looks like sloppy denormalization, and it is not. It is what makes an inventory
logged in March still mean in July exactly what the crew meant when they logged it.

## Decision

**An item, once logged, is a snapshot. It does not change because the catalogue changed.**

Concretely, and these are the properties to preserve:

- **No foreign key from any item row to `furniture_catalog`.** Not `job_inventory_items`,
  not `estimate_items`, not BOL items.
- **`is_box` is stored on the row**, decided by which add-form the crew used. It is never
  re-derived by looking the name up in the catalogue.
- **Weight, cubic feet, and chow volume are stored on the row** at add time. Never
  recomputed from the live catalogue at read or render time.
- **The CSV import is upsert-by-name, and never deletes.** Rows absent from the uploaded
  CSV are left alone; blank cells do not overwrite existing values.
- **No UI filters logged rows against the catalogue.** A logged item renders because it
  is in the job's item list, not because its name is still in the catalogue.

Therefore: renaming a catalogue item, deleting one, or re-importing the entire CSV has
**no effect whatsoever** on inventory already logged. The only thing that changes is what
the autocomplete suggests next time.

## Consequences

- A logged item can name something the catalogue no longer contains. **This is correct.**
  It is a record of what was actually on the truck, not a claim about what the catalogue
  currently offers.
- Fixing a wrong weight in the catalogue does **not** retroactively correct estimates that
  already used the old weight. That is the trade, and it is the right one: an estimate is
  a document that was sent to a customer at a point in time, and silently rewriting its
  numbers months later because an admin fixed a typo would be worse than leaving it.
- The same name can therefore carry different weights on two different estimates. Expected.

## What would break if you undid this

The tempting refactor is to normalize: replace the `name` string with a
`catalog_item_id` foreign key, so the data is "clean" and an item's weight lives in one
place. Do not do this. It converts every catalogue edit into a silent, retroactive,
unbounded rewrite of historical records:

- **Delete a catalogue item** and, depending on the cascade, every inventory row that
  referenced it either vanishes from a hundred past jobs or becomes a dangling id that
  renders as blank. A crew member's field work, destroyed by an admin tidying a list.
- **Fix a weight** and every past estimate's totals silently change, including ones
  already sent to customers.
- **Re-import the CSV** and any row whose name is not in the new file loses its referent.

The current design cannot do any of that, because there is nothing to point at. Keep it
that way. If you want catalogue corrections to reach old records, that has to be an
explicit, reviewable backfill, not an invisible side effect of a join.
