# 0030. An empty BOL inherits the job's Actual Inventory

**Status:** Active. Shipped 2026-07-30 as a production hotfix. Amends [0015](0015-inventory-logging-is-paused-on-local-jobs.md).

## Context

There are two separate inventory stores in the app, and until this change nothing
bridged them:

- **Actual Inventory** (`ActualInventory`, the Inventory tab) writes to
  `job_inventory_items`, keyed by `job_uuid`, via `/api/job-inventory/*`.
- **The BOL** reads its declared items only from `digital_bols.items_json`, keyed by
  `bol_id = bolIdForJob(job_uuid)`, populated exclusively by `BolInventoryTab` /
  `BillOfLadingForm`. The BOL router never queried `job_inventory_items`.

[ADR 0015](0015-inventory-logging-is-paused-on-local-jobs.md) recorded this separation as
intentional ("The BOL is unaffected. It never read `job_inventory_items`"). In the field
it produced a data-loss trap. On the LD Inventory tab, `ActualInventory` renders
unconditionally at the top, while `BolInventoryTab` (the only inventory that feeds the
BOL) renders only when the crew's LD day plan includes `"loading"`
(`App.tsx`, the `ldLabor.includes("loading")` gate). On a non-loading leg, a drive day, or
a day where the plan was left at its empty default, the crew's only visible inventory box
was `ActualInventory` - a store the BOL cannot see. A crew on 2026-07-29 logged a full
inventory there, opened the BOL, found it empty, and collected signatures on an empty BOL.

## Decision

**An unsigned BOL with no items of its own inherits the job's Actual Inventory.**

In `bolStore.loadForJob`, after the working draft is resolved (server-adopted or
locally-merged), if `draft.items.length === 0` **and** `draft.status === "draft"`, the
job's `job_inventory_items` are fetched (`GET /api/job-inventory/{job_uuid}`), mapped to
the BOL item shape, and seeded into the draft. Both entry points into the BOL
(`BolInventoryTab` and `BillOfLadingForm`) load through `loadForJob`, so the seeded items
appear on both the inventory review and the signing screen.

Guards that keep this safe:

- **Only when empty.** A BOL that already has items (crew used `BolInventoryTab`) is never
  touched, so nothing is duplicated. Seed, not merge - see Consequences.
- **Only while `draft`.** A signed BOL (`origin_signed` / `delivered`) is never re-seeded,
  so a delivered record is immutable and a deliberately-empty signed BOL stays empty.
- **Best-effort, online-only.** Offline, no inventory, or a fetch error leaves the draft
  exactly as it was. The seed is not queued as a write; it rides the crew's natural
  save/sign, so a viewed-but-untouched BOL persists nothing.
- **Once per BOL per session.** `loadForJob` re-runs on every tab focus /
  visibilitychange. The seed is attempted at most once per `bol_id` per session (an
  in-memory Set, cleared on reload), so an empty BOL does not re-fetch inventory on every
  refocus, and items the crew deliberately deletes after the first fill do not keep
  reappearing. A genuinely new session re-checks.
- **Stable ids.** Seeded items get id `inv-<item_uuid|id>` so a re-open or the two-device
  merge dedupes instead of duplicating.

The existing empty-BOL guard stays: `BillOfLadingForm` still blocks saving or signing a
BOL with zero items ("Add at least one item before signing"). The seed makes that guard
pass with the crew's real inventory instead of forcing a placeholder item.

## Consequences

- **This amends ADR 0015, it does not delete the separation.** The two stores still exist
  and are still written independently. The BOL now *reads* from Actual Inventory as a
  fallback; Actual Inventory does not read from the BOL. Do not "simplify" this into one
  table - the offline queues, idempotency, and Sheets exports of the two are distinct.
- **Seed-when-empty, not always-merge.** If a crew logs items in *both* stores, the BOL
  keeps its own and does not pull the Actual Inventory copy, because name-level dedup
  across the two shapes is unreliable and a double-listed inventory on a legal document is
  worse than the status quo. The reported failure (logged in one store only) is fully
  covered.
- **Offline first-open is not covered.** The seed needs the server (there is no local
  mirror of confirmed `job_inventory_items` - `jobInventoryQueue` is an add-queue, not a
  store). A BOL opened for the first time fully offline still starts empty; it seeds on the
  next online open. Signing is typically done with some connectivity, so this covers the
  reported case. A local-cache seed is the follow-up if offline-first-open proves to bite.
- **The `ldLabor.includes("loading")` UI gate is left in place.** With the bridge, the
  gate no longer causes silent inventory loss, so it was not touched in this hotfix. If it
  is later removed so `BolInventoryTab` always shows on LD, that is an additive UI change,
  not a correctness fix.
