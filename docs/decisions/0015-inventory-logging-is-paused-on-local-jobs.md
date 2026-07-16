# 0015. Inventory logging is paused on local jobs, and the code is kept

**Status:** Active, and deliberately temporary. Paused 2026-07-14 on `staging`.

## Context

Actual-inventory logging (`ActualInventory`, the Inventory tab) asks the crew to enter
items one at a time on a phone: pick the item, set a quantity, pick a pack type for
boxes. On a long-distance job that cost is worth paying, because the bill of lading is a
legal document and the inventory is the point of it.

On a local job it is not worth paying. The crew are moving, item-by-item entry on a
phone is slower than the work it is describing, and the app's whole reason for existing
is that it is faster to use than not to use. The result was predictable: inventory on
local jobs went in patchily or not at all, which is worse than not collecting it, because
partial data still looks like data to whoever reads the sheet.

The fix is a better capture flow, not a better nag. That flow does not exist yet. Rather
than leave a slow tab in front of the crew while it gets designed, the tab comes out.

There is a second, separate finding that landed with this one. The **Estimate check**
card used to compare the crew's logged inventory against the linked estimate's item list
and flag an overage. The estimate's item list comes from SmartMoving, **where inventory
is not reliably entered either**. So that comparison was never measuring the job. It was
measuring how thoroughly the estimator filled in a form, against how thoroughly the crew
filled in a form, and reporting the difference as if it meant something.

## Decision

**Inventory logging is long-distance only. The code, the endpoints, the table, and the
Sheets export all stay exactly where they are.**

- The Inventory tab (button and body) renders only in long-distance mode. LD keeps both
  `ActualInventory` and the BOL packing inventory, unchanged.
- `InventoryCountsSummary` on the Report tab is gated the same way, so a local job never
  shows a "none logged yet, add it on the Inventory tab" pointing at a tab that is not
  there.
- **The estimate-vs-actual item comparison is deleted outright, on every job type**, not
  just local. It was untrustworthy for a reason that has nothing to do with local vs LD.
  The `Estimate check` card becomes an informational `Estimate` card: the estimate's
  hours, counts, weight and volume, plus the access and special-item notes the crew
  actually act on, plus the free-text note (still `overage_note` in the sheet).
- **The comparison that survives is estimated vs actual man-hours**, which is real on
  both sides: the estimate's hours are entered by a human who is accountable for them,
  and the actual hours come from the crew's own timeline. It already renders under Total
  man-hours, and it already exports (`estimated_hours`, `actual_man_hours`,
  `hours_delta`). It was not touched.

Nothing is dropped or deleted server-side. `job_inventory_items`, `/api/job-inventory/*`,
and the `JobInventory` / `JobInventoryItems` sheet tabs are all intact. Restoring local
inventory is meant to be a one-line change at the tab, not an excavation.

## Consequences

- **The offline queue had to be rewired.** `jobInventoryQueue` only ever drained from
  inside `ActualInventory`, which no longer mounts on local jobs. Any item a crew member
  queued offline on a local job before this shipped would have sat in localStorage until
  `pruneStale` silently threw it away 14 days later: field work destroyed by a UI change,
  which is precisely what [ADR 0013](0013-rejected-queue-work-is-never-deleted.md) says
  must never happen. So `drainAll()` now runs from `App.tsx` on boot and on reconnect,
  regardless of tab or mode. **Anything already queued still syncs.** Do not remove that
  call when local inventory comes back.
- `furniture_count` / `box_count` land blank rather than `0` on local job reports. This
  already worked correctly (`None` exports as `""`), so the sheet reads "not collected"
  rather than "collected, and there was nothing".
- The BOL is unaffected. It never read `job_inventory_items`; its items live in
  `digital_bols.items_json`.

## What would break if you undid this

Deleting `ActualInventory`, the `job_inventory_items` table, or the inventory endpoints
because they "look unused on local jobs" is the mistake this file exists to prevent. They
are load-bearing on long-distance, where the BOL depends on them, and the local pause is
meant to be reversed.

Restoring the item-count comparison on the Estimate card would restore a number that
looks authoritative and is not. If item-level estimate-vs-actual is wanted again, the
estimate side has to become trustworthy first, which is a SmartMoving data-entry problem
and not something the crew app can fix by rendering it more confidently.
