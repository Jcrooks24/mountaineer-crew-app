import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiError } from "../api/client";
import { FURNITURE_CATALOG } from "../data/furnitureCatalog";
import { isBoxItem } from "../lib/inventory";
import { BetaTag } from "./BetaTag";
import {
  drain,
  enqueue,
  cancelByTempId,
  pendingFor,
  pruneStale,
  type InventoryItemPayload,
  type QueuedAdd,
  type ServerItem,
} from "../lib/jobInventoryQueue";

// A rendered row is either a synced server item (positive id) or an
// optimistic temp row (negative id) still queued for POST.
type Row = ServerItem & { pending?: boolean };

const CATALOG_NAMES = FURNITURE_CATALOG.map((f) => f.name);

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

  // Add-form state
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);
  const [isBox, setIsBox] = useState(false);
  const [room, setRoom] = useState("");
  const boxTouchedRef = useRef(false); // did the crew manually toggle the box flag?

  // Merge a pending queue op into the rows as a temp row.
  function pendingToRow(op: QueuedAdd): Row {
    return {
      id: op.tempId,
      name: op.payload.name,
      qty: op.payload.qty,
      is_box: op.payload.is_box,
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

  // Auto-detect box vs furniture from the item name until the crew overrides it.
  useEffect(() => {
    if (boxTouchedRef.current) return;
    setIsBox(isBoxItem(name));
  }, [name]);

  const counts = useMemo(() => {
    let furniture = 0;
    let boxes = 0;
    for (const r of rows) {
      if (r.is_box) boxes += r.qty || 0;
      else furniture += r.qty || 0;
    }
    return { furniture, boxes };
  }, [rows]);

  function resetForm() {
    setName("");
    setQty(1);
    setIsBox(false);
    setRoom("");
    boxTouchedRef.current = false;
  }

  function addItem() {
    const trimmed = name.trim();
    if (!trimmed) {
      setErr("Enter an item name.");
      return;
    }
    setErr(null);
    const payload: InventoryItemPayload = {
      name: trimmed,
      qty: Math.max(1, qty),
      is_box: isBox,
      room: room.trim() || null,
      notes: null,
    };
    const tempId = newTempId();
    const op: QueuedAdd = {
      id: newOpId(),
      tempId,
      jobUuid,
      payload,
      createdAt: new Date().toISOString(),
    };
    // Optimistic: show immediately, queue for durability, fire in background.
    setRows((prev) => [...prev, pendingToRow(op)]);
    enqueue(op);
    resetForm();
    void drainQueue();
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

  const furnitureRows = rows.filter((r) => !r.is_box);
  const boxRows = rows.filter((r) => r.is_box);

  return (
    <div className="card">
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
      </div>

      {/* Add form */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <input
          list="job-inventory-catalog"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Item (start typing to search)"
          style={inputStyle}
        />
        <datalist id="job-inventory-catalog">
          {CATALOG_NAMES.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} style={stepBtn} aria-label="Decrease quantity">−</button>
            <span style={{ fontSize: 20, fontWeight: 700, minWidth: 28, textAlign: "center" }}>{qty}</span>
            <button type="button" onClick={() => setQty((q) => q + 1)} style={stepBtn} aria-label="Increase quantity">+</button>
          </div>
          <label className="row" style={{ gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={isBox}
              onChange={(e) => { boxTouchedRef.current = true; setIsBox(e.target.checked); }}
              style={{ accentColor: "var(--brand)", width: 16, height: 16 }}
            />
            <span className="small">This is a box</span>
          </label>
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="Room (optional)"
            style={{ ...inputStyle, flex: "1 1 120px", minWidth: 100 }}
          />
        </div>
        <button
          type="button"
          onClick={addItem}
          style={{
            padding: "11px 14px",
            borderRadius: 10,
            border: "none",
            background: "var(--brand)",
            color: "#00120e",
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Add item
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
              {r.room ? r.room : ""}{r.pending ? (r.room ? " · " : "") + "Syncing…" : ""}
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
