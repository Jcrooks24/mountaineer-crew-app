// Rebuilding the auto-filled lines of a bill (labor, crew vehicles, trucks)
// without losing what a person did to them. Pure, so it can be tested without
// React: frontend/scripts/verify_bill_line_sync.mjs.

export type SyncLine = {
  id: string;
  label: string;
  qty: number;
  rate: number;
  unit: string;
  discount: number;
  source: string;
  qtyLocked?: boolean;
  verifiedSig?: string;
};

/**
 * Replace every line of one auto-filled `source` with `desired`, keeping what a
 * person did to the old lines. Shared by the labor, crew-vehicle and truck syncs.
 *
 * HOTFIX 2026-09-14. Crew reported that ticking several bill lines un-ticked
 * others, on a report with a crew member entered twice. Two defects, both here:
 *
 *  1. Lines were matched to their previous version by LABEL, and `find` returns
 *     the first match, so two "Labor - Bob" rows got the SAME id. `updateItem`
 *     patches by id, so ticking one Bob line stamped both with its own values;
 *     the twin (different hours) read as changed, and ticking the twin cleared
 *     the first. With every line required before submit, the report could not be
 *     submitted at all. Now the Nth desired line with a label takes the Nth
 *     existing line with that label, and an id is never handed out twice (a bill
 *     already SAVED with duplicate ids is repaired on open).
 *  2. The rebuilt lines did not carry `verifiedSig`, and the "nothing changed"
 *     bail-out compared by POSITION. A reopened report whose saved order differed
 *     rebuilt on load and silently cleared every tick on those lines. The tick is
 *     now carried: it is a signature of the values it was given for, so a line
 *     whose numbers did change still un-ticks itself (see isVerified). The
 *     bail-out compares this source's lines only, in their own order.
 */
export function syncSourceLines<L extends SyncLine, B extends { items: L[] }>(
  prev: B,
  source: L["source"],
  build: (existing: L | undefined) => Omit<L, "id" | "verifiedSig">,
  labels: string[],
  mintId: () => string,
): B {
  const oldLines = prev.items.filter((it) => it.source === source);
  const takenIds = new Set<string>();
  const seenPerLabel = new Map<string, number>();
  const desired: L[] = labels.map((label) => {
    const nth = seenPerLabel.get(label) ?? 0;
    seenPerLabel.set(label, nth + 1);
    const existing = oldLines.filter((it) => it.label === label)[nth];
    const base = build(existing);
    let id = existing?.id;
    if (!id || takenIds.has(id)) id = mintId();
    takenIds.add(id);
    return {
      ...base,
      id,
      ...(existing?.verifiedSig ? { verifiedSig: existing.verifiedSig } : {}),
    } as L;
  });

  const same =
    desired.length === oldLines.length &&
    desired.every((n, i) => {
      const p = oldLines[i];
      return p.id === n.id && p.label === n.label && p.qty === n.qty && p.rate === n.rate
        && p.unit === n.unit && p.discount === n.discount && p.source === n.source
        && p.qtyLocked === n.qtyLocked && p.verifiedSig === n.verifiedSig;
    });
  if (same) return prev;
  return { ...prev, items: [...prev.items.filter((it) => it.source !== source), ...desired] };
}

