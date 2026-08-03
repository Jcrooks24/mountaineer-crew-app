import { useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../api/client";
import { useMergedCatalog, splitCatalogNames } from "../lib/furnitureCatalogStore";
import { fetchRemoteBol } from "../lib/bolStore";
import { getUnitsCached, refreshUnits, unitByName, payloadCapacity, type VehicleUnit } from "../lib/vehicleUnits";
import { BetaTag } from "./BetaTag";
import SuggestInput from "./SuggestInput";
import {
  drain,
  enqueue,
  cancelByTempId,
  pendingFor,
  pruneStale,
  retryFailed,
  discardFailed,
  setQueuedPackType,
  type InventoryItemPayload,
  type PackType,
  type QueuedAdd,
  type ServerItem,
} from "../lib/jobInventoryQueue";

// A rendered row is either a synced server item (positive id) or an
// optimistic temp row (negative id) still queued for POST.
// A row is a synced server item, a still-queued local add, or one the server
// permanently refused (opId + failedReason set). A refused add is NOT deleted -
// it stays in the queue and is shown with a Retry (ADR 0013).
type Row = ServerItem & {
  pending?: boolean;
  opId?: string;
  failedReason?: string;
};

const PACK_TYPES: { value: PackType; label: string }[] = [
  { value: "CP", label: "CP" },
  { value: "PBO", label: "PBO" },
  { value: "NA", label: "N/A" },
];

// "Chow" = piles of loose miscellaneous items (garden tools, hoses, blankets,
// random odds and ends) not worth logging individually. The crew approximate
// the floor imprint (L x W x H, in feet) the pile occupies on the truck;
// cubic feet is that occupied space, and density sets a rough weight per cubic
// foot for load planning. Stored as a normal inventory row (name prefixed with
// CHOW_PREFIX, estimate in notes) so it rides the existing offline queue with
// no backend change.
const CHOW_PREFIX = "Chow - ";
const CHOW_DENSITY: { value: string; label: string; lbsPerCuft: number }[] = [
  { value: "loose", label: "Loosely strewn", lbsPerCuft: 4 },
  { value: "medium", label: "Medium", lbsPerCuft: 7 },
  { value: "packed", label: "Packed tight", lbsPerCuft: 11 },
];
function isChowRow(r: { is_box: boolean; name: string }): boolean {
  return !r.is_box && r.name.startsWith(CHOW_PREFIX);
}
function chowCuftFromNotes(notes: string | null | undefined): number {
  const m = (notes || "").match(/≈\s*([\d.]+)\s*cu ft/);
  return m ? parseFloat(m[1]) || 0 : 0;
}

function newTempId(): number {
  return -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
}
function newOpId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `op-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

export default function ActualInventory({
  jobUuid,
  jobName,
}: {
  jobUuid: string;
  jobName?: string;
  jobDate?: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Weight-capacity flags (B5): the fleet registry + the unit selected on this
  // job's BOL give the payload capacity to flag the running inventory weight
  // against. No unit picked yet -> show the estimate without a capacity flag.
  const [vehUnits, setVehUnits] = useState<VehicleUnit[]>(() => getUnitsCached());
  const [bolVehicle, setBolVehicle] = useState<string>("");
  useEffect(() => { refreshUnits().then(setVehUnits).catch(() => {}); }, []);
  useEffect(() => {
    if (!jobUuid) return;
    let cancelled = false;
    fetchRemoteBol(jobUuid)
      .then((raw: any) => { if (!cancelled) setBolVehicle(((raw?.shipment?.vehicle || raw?.vehicle) || "").toString().trim()); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [jobUuid]);

  // Unified catalog (server + built-in), split into furniture vs box names for
  // the two search boxes. CSV-imported items show up here automatically.
  const catalog = useMergedCatalog();
  const { furniture: furnitureNames, boxNames } = useMemo(() => {
    const { furniture, boxes } = splitCatalogNames(catalog);
    return { furniture, boxNames: boxes };
  }, [catalog]);

  // Furniture add-form state.
  const [fName, setFName] = useState("");
  const [fQty, setFQty] = useState(1);
  const [fRoom, setFRoom] = useState("");

  // Box add-form state. pack type ("" until chosen) is required to add a box.
  const [bName, setBName] = useState("");
  const [bQty, setBQty] = useState(1);
  const [bRoom, setBRoom] = useState("");
  const [bPack, setBPack] = useState<PackType | "">("");

  // "Estimate chow volume" tool state.
  const [chowLabel, setChowLabel] = useState("");
  const [chowL, setChowL] = useState("");
  const [chowW, setChowW] = useState("");
  const [chowH, setChowH] = useState("");
  const [chowDensity, setChowDensity] = useState("medium");
  const [chowRoom, setChowRoom] = useState("");

  // Merge a pending queue op into the rows as a temp row.
  function pendingToRow(op: QueuedAdd): Row {
    return {
      id: op.tempId,
      name: op.payload.name,
      qty: op.payload.qty,
      is_box: op.payload.is_box,
      pack_type: op.payload.pack_type,
      room: op.payload.room,
      notes: op.payload.notes,
      pending: true,
      opId: op.id,
      failedReason: op.failed_reason,
    };
  }

  // Load server items + merge any queued (offline) adds.
  useEffect(() => {
    if (!jobUuid) {
      setRows([]);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    setErr(null);
    pruneStale();

    let cancelled = false;
    apiFetch<{ items: ServerItem[] }>(`/api/job-inventory/${encodeURIComponent(jobUuid)}`)
      .then((r) => {
        if (cancelled) return;
        const pend = pendingFor(jobUuid).map(pendingToRow);
        setRows([...r.items, ...pend]);
      })
      .catch(() => {
        // Offline / transient: still surface any queued adds so the crew sees
        // their in-progress work rather than an empty list.
        if (cancelled) return;
        setRows(pendingFor(jobUuid).map(pendingToRow));
      })
      .finally(() => {
        if (cancelled) return;
        setLoaded(true);
        void drainQueue();
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobUuid]);

  async function drainQueue() {
    await drain(
      jobUuid,
      (tempId, server) => {
        // Swap temp row → server row.
        setRows((prev) => prev.map((r) => (r.id === tempId ? { ...server, pending: false } : r)));
      },
      (tempId, reason) => {
        // Permanent rejection. The item is NOT dropped: it stays queued, marked,
        // and the row now says why and offers a Retry. Silently deleting it used
        // to mean an item the crew logged just vanished off the list.
        setRows((prev) =>
          prev.map((r) => (r.id === tempId ? { ...r, failedReason: reason } : r)),
        );
      },
    );
  }

  async function retryRow(row: Row) {
    if (!row.opId) return;
    setErr(null);
    retryFailed(row.opId);
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, failedReason: undefined } : r)));
    await drainQueue();
  }

  function discardRow(row: Row) {
    if (!row.opId) return;
    const ok = window.confirm(
      `Remove "${row.name}"?\n\nIt was never saved to the office, so this deletes the only copy.`,
    );
    if (!ok) return;
    discardFailed(row.opId);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  }

  const counts = useMemo(() => {
    let furniture = 0;
    let boxes = 0;
    let chowCuft = 0;
    let chowPiles = 0;
    for (const r of rows) {
      if (r.is_box) { boxes += r.qty || 0; continue; }
      if (isChowRow(r)) { chowPiles += 1; chowCuft += chowCuftFromNotes(r.notes); continue; }
      furniture += r.qty || 0;
    }
    return { furniture, boxes, chowCuft: Math.round(chowCuft * 10) / 10, chowPiles };
  }, [rows]);

  // Estimated total weight: catalog weight x qty per item; chow via its cubic
  // feet x a medium-density planning estimate. Items missing from the catalog
  // contribute 0 (unknown), so the total is a floor estimate for load planning.
  const catalogWeight = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of catalog) m.set(c.name.trim().toLowerCase(), c.weight_lbs || 0);
    return m;
  }, [catalog]);
  const estWeight = useMemo(() => {
    let lbs = 0;
    for (const r of rows) {
      if (isChowRow(r)) { lbs += chowCuftFromNotes(r.notes) * 7; continue; }
      lbs += (catalogWeight.get((r.name || "").trim().toLowerCase()) ?? 0) * (r.qty || 0);
    }
    return Math.round(lbs);
  }, [rows, catalogWeight]);
  const unitCapacity = useMemo(() => payloadCapacity(unitByName(vehUnits, bolVehicle)), [vehUnits, bolVehicle]);
  const weightPct = unitCapacity && unitCapacity > 0 ? estWeight / unitCapacity : null;

  // Live chow estimate from the L x W x H (feet) + density inputs.
  const chowPreview = useMemo(() => {
    const l = parseFloat(chowL), w = parseFloat(chowW), h = parseFloat(chowH);
    if (!(l > 0 && w > 0 && h > 0)) return null;
    const cuft = l * w * h;
    const d = CHOW_DENSITY.find((x) => x.value === chowDensity) || CHOW_DENSITY[1];
    return { cuft: Math.round(cuft * 10) / 10, weight: Math.round(cuft * d.lbsPerCuft), density: d };
  }, [chowL, chowW, chowH, chowDensity]);

  // Optimistic add: show immediately, queue for durability, fire in background.
  function queueAdd(payload: InventoryItemPayload) {
    const op: QueuedAdd = {
      id: newOpId(),
      tempId: newTempId(),
      jobUuid,
      payload,
      createdAt: new Date().toISOString(),
    };
    setRows((prev) => [...prev, pendingToRow(op)]);
    enqueue(op);
    void drainQueue();
  }

  function addFurniture() {
    const trimmed = fName.trim();
    if (!trimmed) {
      setErr("Enter an item name.");
      return;
    }
    setErr(null);
    queueAdd({
      name: trimmed,
      qty: Math.max(1, fQty),
      is_box: false,
      pack_type: null,
      room: fRoom.trim() || null,
      notes: null,
    });
    setFName("");
    setFQty(1);
    setFRoom("");
  }

  function addBox() {
    const trimmed = bName.trim();
    if (!trimmed) {
      setErr("Enter a box type.");
      return;
    }
    if (!bPack) {
      setErr("Choose CP, PBO, or N/A before adding a box.");
      return;
    }
    setErr(null);
    queueAdd({
      name: trimmed,
      qty: Math.max(1, bQty),
      is_box: true,
      pack_type: bPack,
      room: bRoom.trim() || null,
      notes: null,
    });
    setBName("");
    setBQty(1);
    setBRoom("");
    setBPack("");
  }

  function addChow() {
    if (!chowPreview) {
      setErr("Enter length, width, and height (ft) for the pile.");
      return;
    }
    setErr(null);
    const label = chowLabel.trim() || "loose items";
    queueAdd({
      name: `${CHOW_PREFIX}${label}`,
      qty: 1,
      is_box: false,
      pack_type: null,
      room: chowRoom.trim() || null,
      notes: `≈ ${chowPreview.cuft} cu ft, ≈ ${chowPreview.weight} lbs (${chowL}x${chowW}x${chowH} ft, ${chowPreview.density.label.toLowerCase()})`,
    });
    setChowLabel("");
    setChowL("");
    setChowW("");
    setChowH("");
    setChowDensity("medium");
    setChowRoom("");
  }

  async function changeQty(row: Row, delta: number) {
    if (row.pending) return; // can't PATCH a not-yet-synced row
    const next = Math.max(1, (row.qty || 1) + delta);
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, qty: next } : r)));
    try {
      await apiFetch(`/api/job-inventory/${encodeURIComponent(jobUuid)}/items/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ qty: next }),
      });
    } catch (e) {
      // Revert on failure so the count stays truthful.
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, qty: row.qty } : r)));
      setErr(e instanceof ApiError ? e.message : "Could not update quantity - check connection.");
    }
  }

  async function removeRow(row: Row) {
    if (row.pending) {
      // Cancel the queued add and drop the temp row.
      cancelByTempId(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    try {
      await apiFetch(`/api/job-inventory/${encodeURIComponent(jobUuid)}/items/${row.id}`, {
        method: "DELETE",
      });
    } catch (e) {
      // Restore on failure.
      setRows((prev) => [...prev, row]);
      setErr(e instanceof ApiError ? e.message : "Could not remove item - check connection.");
    }
  }

  const furnitureRows = rows.filter((r) => !r.is_box && !isChowRow(r));
  const boxRows = rows.filter((r) => r.is_box);
  const chowRows = rows.filter((r) => isChowRow(r));

  /**
   * Set the pack type on every box already logged for this job.
   *
   * Most jobs are all-CP or all-PBO, and tapping the pack type once per box is
   * the kind of repetition that makes crew stop logging boxes at all. This makes
   * the common case one tap.
   *
   * Pending (not yet synced) boxes are handled too, but they cannot be PATCHed -
   * they have no server id yet. Their queued payload is rewritten in place
   * instead, so they arrive with the right pack type rather than silently keeping
   * the old one.
   */
  const [bulkBusy, setBulkBusy] = useState(false);

  async function applyPackTypeToAllBoxes(pt: PackType) {
    if (boxRows.length === 0) return;
    const label = PACK_TYPES.find((p) => p.value === pt)?.label ?? pt;
    const ok = window.confirm(
      `Set every box on this job to ${label}?\n\n${boxRows.length} box${boxRows.length === 1 ? "" : "es"} will be updated.`,
    );
    if (!ok) return;

    setBulkBusy(true);
    setErr(null);

    // Each box's prior pack type, so a FAILED box can be reverted to its own
    // value - not to some whole-list snapshot that would also undo the boxes that
    // succeeded.
    const priorById = new Map(boxRows.map((r) => [r.id, r.pack_type]));

    setRows((prev) => prev.map((r) => (r.is_box ? { ...r, pack_type: pt } : r)));

    // Pending rows never reach the PATCH endpoint: rewrite their queued payload so
    // they SYNC with the new pack type. This is a localStorage write, it cannot
    // fail, and it must not be reverted below - the box really does carry pt now.
    for (const r of boxRows) {
      if (r.pending && r.opId) setQueuedPackType(r.opId, pt);
    }

    const synced = boxRows.filter((r) => !r.pending);
    const failedIds = new Set<number>();
    for (const r of synced) {
      try {
        await apiFetch(`/api/job-inventory/${encodeURIComponent(jobUuid)}/items/${r.id}`, {
          method: "PATCH",
          body: JSON.stringify({ pack_type: pt }),
        });
      } catch {
        failedIds.add(r.id);
      }
    }

    if (failedIds.size > 0) {
      // Revert ONLY the boxes whose PATCH failed, each to its own prior value.
      // The ones that succeeded keep pt, matching the server and the sheet.
      setRows((prev) =>
        prev.map((r) =>
          failedIds.has(r.id) ? { ...r, pack_type: priorById.get(r.id) ?? r.pack_type } : r,
        ),
      );
      setErr(
        `Could not update ${failedIds.size} box${failedIds.size === 1 ? "" : "es"} - check connection and try again. The rest were updated.`,
      );
    }
    setBulkBusy(false);
  }

  return (
    <div className="card" data-component="ActualInventory">
      <div className="row" style={{ alignItems: "center", gap: 8 }}>
        <div className="sectionTitle" style={{ marginBottom: 0 }}>Actual inventory</div>
        <BetaTag feature="actualInventory" style={{ marginTop: 0 }} />
      </div>
      <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 12 }}>
        Log what actually moved on {jobName ? <strong>{jobName}</strong> : "this job"}. Furniture and box
        counts update automatically.
      </div>

      {/* Running estimated weight + capacity flag (B5). Escalates from a quiet
          line, to an amber warning at 75% of the unit's payload capacity, to an
          intense red banner over capacity. */}
      {(estWeight > 0 || unitCapacity != null) && (
        <div style={{ marginBottom: 12 }}>
          {weightPct != null && weightPct >= 1 ? (
            <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--danger)", background: "color-mix(in srgb, var(--danger) 22%, transparent)", color: "var(--text)", fontWeight: 700, fontSize: 14 }}>
              ⚠ OVER weight capacity - est. <span className="mono">{estWeight.toLocaleString()} lb</span> of <span className="mono">{unitCapacity!.toLocaleString()} lb</span> ({Math.round(weightPct * 100)}%) on {bolVehicle}. Redistribute or reduce the load.
            </div>
          ) : weightPct != null && weightPct >= 0.75 ? (
            <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--warn)", background: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--text)", fontWeight: 600, fontSize: 14 }}>
              Approaching weight capacity - est. <span className="mono">{estWeight.toLocaleString()} lb</span> of <span className="mono">{unitCapacity!.toLocaleString()} lb</span> ({Math.round(weightPct * 100)}%) on {bolVehicle}.
            </div>
          ) : (
            <div className="small" style={{ color: "var(--muted)" }}>
              Est. loaded weight: <span className="mono" style={{ color: "var(--text)", fontWeight: 600 }}>{estWeight.toLocaleString()} lb</span>
              {unitCapacity != null
                ? <> of <span className="mono">{unitCapacity.toLocaleString()} lb</span> capacity ({Math.round((weightPct || 0) * 100)}%) on {bolVehicle}</>
                : <> {" · "}pick a vehicle unit on the BOL to see capacity</>}
            </div>
          )}
        </div>
      )}

      {/* Derived counts */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <CountTile label="Furniture" value={counts.furniture} />
        <CountTile label="Boxes" value={counts.boxes} />
        {counts.chowPiles > 0 && <CountTile label="Chow (cu ft)" value={counts.chowCuft} />}
      </div>

      {/* Add furniture - dedicated item search box. */}
      <div style={addSectionStyle}>
        <div style={addTitleStyle}>Add furniture</div>
        {/* Not a native <datalist>: on mobile that suppresses the keyboard's
            autocorrect strip, so crew were logging misspelled items. See
            SuggestInput. */}
        <SuggestInput
          value={fName}
          onChange={setFName}
          options={furnitureNames}
          placeholder="Item (start typing to search)"
          onEnter={addFurniture}
          style={inputStyle}
        />
        <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <button type="button" onClick={() => setFQty((q) => Math.max(1, q - 1))} style={stepBtn} aria-label="Decrease quantity">−</button>
            <span style={qtyStyle}>{fQty}</span>
            <button type="button" onClick={() => setFQty((q) => q + 1)} style={stepBtn} aria-label="Increase quantity">+</button>
          </div>
          <input
            value={fRoom}
            onChange={(e) => setFRoom(e.target.value)}
            placeholder="Room (optional)"
            style={{ ...inputStyle, flex: "1 1 120px", minWidth: 100 }}
          />
        </div>
        <button type="button" onClick={addFurniture} style={addBtnStyle}>Add item</button>
      </div>

      {/* Add box - dedicated box search box + required pack type (CP/PBO/NA). */}
      <div style={addSectionStyle}>
        <div style={addTitleStyle}>Add box</div>
        <SuggestInput
          value={bName}
          onChange={setBName}
          options={boxNames}
          placeholder="Box type - Small, Medium, Large, Dish pack…"
          style={inputStyle}
        />
        <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <button type="button" onClick={() => setBQty((q) => Math.max(1, q - 1))} style={stepBtn} aria-label="Decrease quantity">−</button>
            <span style={qtyStyle}>{bQty}</span>
            <button type="button" onClick={() => setBQty((q) => q + 1)} style={stepBtn} aria-label="Increase quantity">+</button>
          </div>
          <input
            value={bRoom}
            onChange={(e) => setBRoom(e.target.value)}
            placeholder="Room (optional)"
            style={{ ...inputStyle, flex: "1 1 120px", minWidth: 100 }}
          />
        </div>

        {/* Pack type is required to add a box. */}
        <div className="small" style={{ fontWeight: 700, marginTop: 2 }}>Packed by *</div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {PACK_TYPES.map((pt) => {
            const active = bPack === pt.value;
            return (
              <button
                key={pt.value}
                type="button"
                onClick={() => setBPack(active ? "" : pt.value)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 999,
                  border: active ? "2px solid var(--brand)" : "1px solid var(--border)",
                  background: active ? "color-mix(in srgb, var(--brand) 18%, transparent)" : "transparent",
                  color: active ? "var(--brand)" : "var(--text)",
                  fontWeight: active ? 700 : 500,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                {pt.label}
              </button>
            );
          })}
        </div>
        <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
          <strong>CP</strong> = Carrier Packed (we packed the box). <strong>PBO</strong> = Packed By Owner
          (the customer packed it themselves). Use <strong>N/A</strong> if it doesn't apply.
        </div>

        <button
          type="button"
          onClick={addBox}
          disabled={!bPack}
          style={{ ...addBtnStyle, opacity: bPack ? 1 : 0.5, cursor: bPack ? "pointer" : "not-allowed" }}
        >
          Add box
        </button>
      </div>

      {/* Estimate chow volume - piles of loose miscellaneous items. */}
      <div style={addSectionStyle}>
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <div style={addTitleStyle}>Estimate chow volume</div>
          <BetaTag feature="chowVolume" style={{ marginTop: 0 }} />
        </div>
        <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
          For piles of loose odds and ends (garden tools, hoses, blankets, randoms).
          Approximate the floor imprint the pile takes up on the truck in <strong>feet</strong>,
          then pick how tightly it's packed.
        </div>
        <input
          value={chowLabel}
          onChange={(e) => setChowLabel(e.target.value)}
          placeholder="What is it? (e.g. garage loose items)"
          style={inputStyle}
        />
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <label className="col" style={{ gap: 4, flex: "1 1 70px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Length (ft)</span>
            <input inputMode="decimal" value={chowL} onChange={(e) => setChowL(e.target.value)} placeholder="0" style={inputStyle} />
          </label>
          <label className="col" style={{ gap: 4, flex: "1 1 70px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Width (ft)</span>
            <input inputMode="decimal" value={chowW} onChange={(e) => setChowW(e.target.value)} placeholder="0" style={inputStyle} />
          </label>
          <label className="col" style={{ gap: 4, flex: "1 1 70px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Height (ft)</span>
            <input inputMode="decimal" value={chowH} onChange={(e) => setChowH(e.target.value)} placeholder="0" style={inputStyle} />
          </label>
        </div>
        <div className="small" style={{ fontWeight: 700, marginTop: 2 }}>Density</div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {CHOW_DENSITY.map((d) => {
            const active = chowDensity === d.value;
            return (
              <button
                key={d.value}
                type="button"
                onClick={() => setChowDensity(d.value)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: active ? "2px solid var(--brand)" : "1px solid var(--border)",
                  background: active ? "color-mix(in srgb, var(--brand) 18%, transparent)" : "transparent",
                  color: active ? "var(--brand)" : "var(--text)",
                  fontWeight: active ? 700 : 500,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                {d.label}
              </button>
            );
          })}
        </div>
        <input
          value={chowRoom}
          onChange={(e) => setChowRoom(e.target.value)}
          placeholder="Room / area (optional)"
          style={inputStyle}
        />
        <div className="small" style={{ color: chowPreview ? "var(--text)" : "var(--muted)" }}>
          {chowPreview ? (
            <>Estimate: <strong>{chowPreview.cuft} cu ft</strong>, <strong>≈ {chowPreview.weight} lbs</strong></>
          ) : (
            "Enter L x W x H to estimate."
          )}
        </div>
        <button
          type="button"
          onClick={addChow}
          disabled={!chowPreview}
          style={{ ...addBtnStyle, opacity: chowPreview ? 1 : 0.5, cursor: chowPreview ? "pointer" : "not-allowed" }}
        >
          Add chow estimate
        </button>
      </div>

      {err && (
        <div className="small" style={{ color: "var(--danger)", marginBottom: 10 }}>{err}</div>
      )}

      {!loaded ? (
        <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="small" style={{ color: "var(--muted)" }}>No items logged yet.</div>
      ) : (
        <>
          <ItemGroup title="Furniture" rows={furnitureRows} onQty={changeQty} onRemove={removeRow} onRetry={retryRow} onDiscard={discardRow} />
          <ItemGroup title="Boxes" rows={boxRows} onQty={changeQty} onRemove={removeRow} onRetry={retryRow} onDiscard={discardRow} />
          {/* Most jobs are all-CP or all-PBO. Tapping the pack type once per box
              is the repetition that makes crew stop logging boxes at all. */}
          {boxRows.length > 1 && (
            <div className="row wrap" style={{ gap: 8, alignItems: "center", marginTop: 8 }}>
              <span className="small" style={{ color: "var(--muted)" }}>
                Set all {boxRows.length} boxes to:
              </span>
              {PACK_TYPES.filter((p) => p.value !== "NA").map((p) => (
                <button
                  key={p.value}
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => applyPackTypeToAllBoxes(p.value)}
                  style={{
                    padding: "8px 14px",
                    minHeight: 44,
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text)",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: bulkBusy ? "wait" : "pointer",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <ItemGroup title="Chow (loose items)" rows={chowRows} onQty={changeQty} onRemove={removeRow} onRetry={retryRow} onDiscard={discardRow} />
        </>
      )}
    </div>
  );
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        flex: 1,
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "10px 12px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 26, fontWeight: 800, color: "var(--brand)" }}>{value}</div>
      <div className="small" style={{ color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

function ItemGroup({
  title,
  rows,
  onQty,
  onRemove,
  onRetry,
  onDiscard,
}: {
  title: string;
  rows: Row[];
  onQty: (row: Row, delta: number) => void;
  onRemove: (row: Row) => void;
  onRetry: (row: Row) => void;
  onDiscard: (row: Row) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 12, color: "var(--muted)", margin: "8px 0 4px" }}>{title}</div>
      {rows.map((r) => {
        const failed = !!r.failedReason;
        return (
        <div
          key={r.id}
          style={{
            padding: "8px 0",
            borderBottom: "1px solid var(--border)",
            opacity: r.pending && !failed ? 0.6 : 1,
          }}
        >
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ minWidth: 0, flex: "1 1 auto" }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
              <div className="small" style={{ color: failed ? "var(--danger)" : "var(--muted)" }}>
                {[
                  r.pack_type,
                  r.room,
                  r.notes,
                  failed ? "Not sent" : r.pending ? "Syncing…" : null,
                ].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="row" style={{ gap: 6, alignItems: "center", flex: "0 0 auto" }}>
              <button type="button" onClick={() => onQty(r, -1)} disabled={r.pending} style={stepBtnSm} aria-label="Decrease">−</button>
              <span style={{ minWidth: 22, textAlign: "center", fontWeight: 700 }}>{r.qty}</span>
              <button type="button" onClick={() => onQty(r, 1)} disabled={r.pending} style={stepBtnSm} aria-label="Increase">+</button>
              <button type="button" onClick={() => onRemove(r)} style={{ color: "var(--danger)", marginLeft: 4 }}>Remove</button>
            </div>
          </div>
          {/* The server refused this add. It is still queued on this phone - it
              is not deleted behind the crew's back (ADR 0013). */}
          {failed && (
            <div style={{ marginTop: 6, paddingLeft: 2 }}>
              <div className="small" style={{ color: "var(--muted)" }}>{r.failedReason}</div>
              <div className="small">It is still saved on this phone.</div>
              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => onRetry(r)}
                  style={{ padding: "6px 12px", fontSize: 13, minHeight: 40, borderRadius: 8, border: "1px solid var(--brand)", background: "transparent", color: "var(--brand)", fontWeight: 700 }}
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => onDiscard(r)}
                  style={{ padding: "6px 12px", fontSize: 13, minHeight: 40, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)" }}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  // 16px, not 14: iOS Safari auto-zooms the page on focus when an input's
  // computed font-size is under 16px, and does not zoom back out. index.css sets
  // this globally for exactly that reason; overriding it here reintroduced the
  // bug on every field in this form.
  fontSize: 16,
  boxSizing: "border-box",
};

const addSectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  marginBottom: 14,
  padding: 12,
  border: "1px solid var(--border)",
  borderRadius: 12,
  background: "rgba(255,255,255,0.02)",
};

const addTitleStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
};

const qtyStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  minWidth: 28,
  textAlign: "center",
};

const addBtnStyle: React.CSSProperties = {
  padding: "11px 14px",
  borderRadius: 10,
  border: "none",
  background: "var(--brand)",
  color: "#00120e",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

const stepBtn: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--card)",
  color: "var(--text)",
  fontSize: 20,
  cursor: "pointer",
  lineHeight: 1,
};

const stepBtnSm: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--card)",
  color: "var(--text)",
  fontSize: 16,
  cursor: "pointer",
  lineHeight: 1,
};
