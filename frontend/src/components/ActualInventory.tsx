import { useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../api/client";
import { useMergedCatalog, splitCatalogNames } from "../lib/furnitureCatalogStore";
import { BetaTag } from "./BetaTag";
import {
  drain,
  enqueue,
  cancelByTempId,
  pendingFor,
  pruneStale,
  type InventoryItemPayload,
  type PackType,
  type QueuedAdd,
  type ServerItem,
} from "../lib/jobInventoryQueue";

// A rendered row is either a synced server item (positive id) or an
// optimistic temp row (negative id) still queued for POST.
type Row = ServerItem & { pending?: boolean };

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
      (tempId) => {
        // Permanent rejection: drop the temp row.
        setRows((prev) => prev.filter((r) => r.id !== tempId));
      },
    );
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

      {/* Derived counts */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <CountTile label="Furniture" value={counts.furniture} />
        <CountTile label="Boxes" value={counts.boxes} />
        {counts.chowPiles > 0 && <CountTile label="Chow (cu ft)" value={counts.chowCuft} />}
      </div>

      {/* Add furniture - dedicated item search box. */}
      <div style={addSectionStyle}>
        <div style={addTitleStyle}>Add furniture</div>
        <input
          list="job-inventory-furniture"
          value={fName}
          onChange={(e) => setFName(e.target.value)}
          placeholder="Item (start typing to search)"
          style={inputStyle}
        />
        <datalist id="job-inventory-furniture">
          {furnitureNames.map((n) => <option key={n} value={n} />)}
        </datalist>
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
        <input
          list="job-inventory-boxes"
          value={bName}
          onChange={(e) => setBName(e.target.value)}
          placeholder="Box type - Small, Medium, Large, Dish pack…"
          style={inputStyle}
        />
        <datalist id="job-inventory-boxes">
          {boxNames.map((n) => <option key={n} value={n} />)}
        </datalist>
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
                  background: active ? "rgba(93,214,194,0.18)" : "transparent",
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
                  background: active ? "rgba(93,214,194,0.18)" : "transparent",
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
          <ItemGroup title="Furniture" rows={furnitureRows} onQty={changeQty} onRemove={removeRow} />
          <ItemGroup title="Boxes" rows={boxRows} onQty={changeQty} onRemove={removeRow} />
          <ItemGroup title="Chow (loose items)" rows={chowRows} onQty={changeQty} onRemove={removeRow} />
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
}: {
  title: string;
  rows: Row[];
  onQty: (row: Row, delta: number) => void;
  onRemove: (row: Row) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 12, color: "var(--muted)", margin: "8px 0 4px" }}>{title}</div>
      {rows.map((r) => (
        <div
          key={r.id}
          className="row"
          style={{
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            padding: "8px 0",
            borderBottom: "1px solid var(--border)",
            opacity: r.pending ? 0.6 : 1,
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
            <div className="small" style={{ color: "var(--muted)" }}>
              {[r.pack_type, r.room, r.notes, r.pending ? "Syncing…" : null].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="row" style={{ gap: 6, alignItems: "center", flex: "0 0 auto" }}>
            <button type="button" onClick={() => onQty(r, -1)} disabled={r.pending} style={stepBtnSm} aria-label="Decrease">−</button>
            <span style={{ minWidth: 22, textAlign: "center", fontWeight: 700 }}>{r.qty}</span>
            <button type="button" onClick={() => onQty(r, 1)} disabled={r.pending} style={stepBtnSm} aria-label="Increase">+</button>
            <button type="button" onClick={() => onRemove(r)} style={{ color: "var(--danger)", marginLeft: 4 }}>Remove</button>
          </div>
        </div>
      ))}
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
  fontSize: 14,
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
