import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiError } from "../api/client";
import { getToken } from "../auth/token";
import {
  FURNITURE_CATALOG,
  type FurnitureItem,
} from "../data/furnitureCatalog";
import {
  cancelByTempId as cancelQueuedAdd,
  drain as drainEstimatorQueue,
  enqueue as enqueueEstimatorAdd,
  pendingFor as pendingEstimatorAddsFor,
  pruneStale as pruneEstimatorQueue,
  removeOp as removeEstimatorOp,
} from "../lib/estimatorQueue";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

// ── Types ─────────────────────────────────────────────────────────────────

type EstimateItem = {
  id: number;
  name: string;
  qty: number;
  weight_lbs: number;
  cubic_ft: number;
  room: string | null;
  subcategory: string | null;
  notes: string | null;
};

type Estimate = {
  id: number;
  estimate_uuid: string;
  created_by_id: number | null;
  created_by_name: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  origin_address: string | null;
  destination_address: string | null;
  move_date: string | null;
  origin_access_notes: string | null;
  destination_access_notes: string | null;
  special_items_notes: string | null;
  general_notes: string | null;
  estimated_weight_lbs: number;
  estimated_cubic_ft: number;
  created_at: string;
  updated_at: string;
  items: EstimateItem[];
};

type CatalogRow = { id: number; name: string; weight_lbs: number; cubic_ft: number; category: string | null };

type ServerPhoto = {
  id: string;
  drive_url: string;
  thumb_url: string;
  caption: string;
  created_at: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────

function newUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function resizeImage(file: File | Blob, maxPx = 1920, quality = 0.8): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level
// ─────────────────────────────────────────────────────────────────────────

export default function EstimatorTab() {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [current, setCurrent] = useState<Estimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function refreshList() {
    setLoading(true);
    try {
      const rows = await apiFetch<Estimate[]>("/api/estimates");
      setEstimates(rows);
      setErr(null);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to load estimates");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refreshList(); }, []);

  if (current) {
    return (
      <EstimateDetail
        estimate={current}
        onBack={() => { setCurrent(null); refreshList(); }}
        onChange={(e) => setCurrent(e)}
      />
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <NewEstimateCard onCreated={(e) => setCurrent(e)} />

      {err && <div className="card" style={{ color: "var(--danger)", fontSize: 13 }}>{err}</div>}

      <div className="card">
        <div className="sectionTitle">Recent Estimates</div>
        {loading ? (
          <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
        ) : estimates.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>No estimates yet. Create your first one above.</div>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {estimates.map((e) => (
              <button
                key={e.id}
                onClick={() => setCurrent(e)}
                style={{ textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{e.customer_name}</div>
                  <div className="small" style={{ color: "var(--muted)" }}>
                    {e.move_date ? `Move: ${e.move_date} · ` : ""}
                    {Math.round(e.estimated_weight_lbs).toLocaleString()} lbs · {Math.round(e.estimated_cubic_ft)} cu ft · {e.items.reduce((s, i) => s + (i.qty || 1), 0)} items
                  </div>
                </div>
                <span className="small" style={{ color: "var(--muted)" }}>
                  {new Date(e.created_at).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function NewEstimateCard({ onCreated }: { onCreated: (e: Estimate) => void }) {
  const [customerName, setCustomerName] = useState("");
  const [moveDate, setMoveDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!customerName.trim()) return setErr("Customer name is required.");
    setBusy(true);
    try {
      const row = await apiFetch<Estimate>("/api/estimates", {
        method: "POST",
        body: JSON.stringify({
          estimate_uuid: newUUID(),
          customer_name: customerName.trim(),
          move_date: moveDate || null,
        }),
      });
      setCustomerName("");
      setMoveDate("");
      onCreated(row);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="sectionTitle">New Estimate</div>
      <form onSubmit={submit} className="col" style={{ gap: 10 }}>
        <div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Customer Name *</div>
          <input value={customerName} onChange={(ev) => setCustomerName(ev.target.value)} placeholder="Full name" />
        </div>
        <div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Target Move Date (optional)</div>
          <input type="date" value={moveDate} onChange={(ev) => setMoveDate(ev.target.value)} />
        </div>
        {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}
        <button type="submit" className="btnPrimary" disabled={busy}>
          {busy ? "Creating…" : "Start Estimate"}
        </button>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

type DetailProps = {
  estimate: Estimate;
  onBack: () => void;
  onChange: (e: Estimate) => void;
};

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

function EstimateDetail({ estimate, onBack, onChange }: DetailProps) {
  const [local, setLocal] = useState<Estimate>(estimate);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [err, setErr] = useState<string | null>(null);

  // Always-current ref so the unmount flush reads the latest field values.
  const localRef = useRef<Estimate>(local);
  useEffect(() => { localRef.current = local; }, [local]);

  const metaSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  // Rooms that exist only in the UI (before their first item is added)
  const [pendingRooms, setPendingRooms] = useState<string[]>([]);

  useEffect(() => { setLocal(estimate); }, [estimate]);

  const totalWeight = useMemo(
    () => local.items.reduce((s, i) => s + (i.weight_lbs || 0) * (i.qty || 0), 0),
    [local.items],
  );
  const totalCuft = useMemo(
    () => local.items.reduce((s, i) => s + (i.cubic_ft || 0) * (i.qty || 0), 0),
    [local.items],
  );

  // Rooms to render = distinct rooms-with-items + pending empty rooms + an
  // "Unassigned" bucket if anything lacks a room.
  const rooms = useMemo<string[]>(() => {
    const set = new Set<string>();
    let hasUnassigned = false;
    for (const it of local.items) {
      if (it.room && it.room.trim()) set.add(it.room.trim());
      else hasUnassigned = true;
    }
    for (const r of pendingRooms) set.add(r);
    const out = [...set];
    out.sort((a, b) => a.localeCompare(b));
    if (hasUnassigned) out.unshift("Unassigned");
    return out;
  }, [local.items, pendingRooms]);

  function setField<K extends keyof Estimate>(key: K, val: Estimate[K]) {
    setLocal((prev) => ({ ...prev, [key]: val }));
    scheduleMetaSave();
  }

  function scheduleMetaSave() {
    setSaveState("pending");
    if (metaSaveTimer.current) clearTimeout(metaSaveTimer.current);
    metaSaveTimer.current = setTimeout(() => flushMetaSave(localRef.current), 800);
  }

  async function flushMetaSave(l: Estimate) {
    if (!isMounted.current) return;
    setSaveState("saving");
    setErr(null);
    try {
      const updated = await apiFetch<Estimate>(`/api/estimates/${l.estimate_uuid}`, {
        method: "PATCH",
        body: JSON.stringify({
          customer_name: l.customer_name,
          customer_email: l.customer_email ?? "",
          customer_phone: l.customer_phone ?? "",
          origin_address: l.origin_address ?? "",
          destination_address: l.destination_address ?? "",
          move_date: l.move_date ?? "",
          origin_access_notes: l.origin_access_notes ?? "",
          destination_access_notes: l.destination_access_notes ?? "",
          special_items_notes: l.special_items_notes ?? "",
          general_notes: l.general_notes ?? "",
        }),
      });
      if (!isMounted.current) return;
      onChange(updated);
      setSaveState("saved");
      setTimeout(() => { if (isMounted.current) setSaveState("idle"); }, 2000);
    } catch (e: any) {
      if (!isMounted.current) return;
      setSaveState("error");
      setErr(e instanceof ApiError ? e.message : "Auto-save failed — check connection");
    }
  }

  // Flush any pending meta save on unmount (navigating back, closing, etc.)
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (metaSaveTimer.current) {
        clearTimeout(metaSaveTimer.current);
        // Fire-and-forget — component is gone so we can't update state
        const l = localRef.current;
        apiFetch(`/api/estimates/${l.estimate_uuid}`, {
          method: "PATCH",
          body: JSON.stringify({
            customer_name: l.customer_name,
            customer_email: l.customer_email ?? "",
            customer_phone: l.customer_phone ?? "",
            origin_address: l.origin_address ?? "",
            destination_address: l.destination_address ?? "",
            move_date: l.move_date ?? "",
            origin_access_notes: l.origin_access_notes ?? "",
            destination_access_notes: l.destination_access_notes ?? "",
            special_items_notes: l.special_items_notes ?? "",
            general_notes: l.general_notes ?? "",
          }),
        }).catch(() => {});
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deleteEstimate() {
    if (!confirm(`Delete estimate for ${local.customer_name}? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/estimates/${local.estimate_uuid}`, { method: "DELETE" });
      onBack();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  async function refreshEstimate() {
    try {
      const fresh = await apiFetch<Estimate>(`/api/estimates/${local.estimate_uuid}`);
      onChange(fresh);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Reload failed");
    }
  }

  type ItemPayload = Omit<EstimateItem, "id">;

  function newOpId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // Resolve a successful POST for a temp id — swap the temp row for the
  // server row in rendered state. Used by both the live submit path and
  // the on-mount drain of the persistent queue.
  function resolveTempItem(tempId: number, server: EstimateItem) {
    setLocal((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === tempId ? server : it)),
    }));
  }

  function dropTempItem(tempId: number) {
    setLocal((prev) => ({
      ...prev,
      items: prev.items.filter((it) => it.id !== tempId),
    }));
  }

  // Optimistic add. Enqueue first so the op survives tab close / navigation
  // / offline, then fire the POST in the background. On success: clear the
  // queue op and swap tempId for the server row. On 4xx: drop the op and
  // the temp row (server permanently rejected). On 5xx / network: leave
  // the op queued — the drain effect below retries on next mount / reload.
  function submitItemOptimistic(payload: ItemPayload) {
    const tempId = -(Date.now() + Math.floor(Math.random() * 1000));
    const opId = newOpId();

    enqueueEstimatorAdd({
      id: opId,
      tempId,
      estimateUuid: local.estimate_uuid,
      payload,
      createdAt: new Date().toISOString(),
    });

    const optimistic: EstimateItem = { id: tempId, ...payload };
    setLocal((prev) => ({ ...prev, items: [...prev.items, optimistic] }));

    apiFetch<EstimateItem>(`/api/estimates/${local.estimate_uuid}/items`, {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then((server) => {
        removeEstimatorOp(opId);
        resolveTempItem(tempId, server);
      })
      .catch((e: any) => {
        const isPermanent =
          e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408;
        if (isPermanent) {
          removeEstimatorOp(opId);
          dropTempItem(tempId);
          setErr(e instanceof ApiError ? e.message : "Add failed");
        }
        // else: network / 5xx — leave queued, drain will retry
      });
  }

  // Called from ItemRow when the user tries to delete a still-syncing
  // (negative id) row. Cancelling the queued op prevents the POST from
  // running; if the POST already fired, this is a best-effort — the
  // server row may still exist, and the next refreshEstimate will show it.
  function cancelTempItem(tempId: number) {
    cancelQueuedAdd(tempId);
    dropTempItem(tempId);
  }

  // On mount / estimate change: merge any pending queued adds for this
  // estimate into the rendered list (so a page reload shows them as
  // "Syncing…" rows), then drain the queue.
  useEffect(() => {
    pruneEstimatorQueue();
    const pending = pendingEstimatorAddsFor(local.estimate_uuid);
    if (pending.length > 0) {
      setLocal((prev) => {
        const existingIds = new Set(prev.items.map((it) => it.id));
        const toMerge = pending
          .filter((p) => !existingIds.has(p.tempId))
          .map((p) => ({ id: p.tempId, ...p.payload } as EstimateItem));
        return toMerge.length
          ? { ...prev, items: [...prev.items, ...toMerge] }
          : prev;
      });
    }
    drainEstimatorQueue(
      local.estimate_uuid,
      (tempId, server) => resolveTempItem(tempId, server),
      (tempId, reason) => {
        dropTempItem(tempId);
        setErr(`An add failed and was dropped: ${reason}`);
      },
    );
    // Run whenever the estimate UUID changes (including drill-down/back).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.estimate_uuid]);

  // Called by ItemRow after a successful auto-save PATCH so totals update
  // immediately without a full server round-trip.
  function handleItemPatched(updated: EstimateItem) {
    setLocal((prev) => ({
      ...prev,
      items: prev.items.map((it) => it.id === updated.id ? updated : it),
    }));
  }

  function addRoom() {
    const name = prompt("Room name (e.g. Living Room, Kitchen, Garage):")?.trim();
    if (!name) return;
    if (rooms.includes(name)) return;
    setPendingRooms((prev) => [...prev, name]);
  }

  return (
    <div style={{ marginTop: 16 }}>
      {/* Header */}
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{local.customer_name || "Estimate"}</div>
          <div className="small" style={{ color: "var(--muted)" }}>
            {Math.round(totalWeight).toLocaleString()} lbs · {Math.round(totalCuft)} cu ft · {local.items.reduce((s, i) => s + (i.qty || 1), 0)} items
          </div>
        </div>
        <button onClick={onBack}>← Back to estimates</button>
      </div>

      {/* Customer & move details */}
      <div className="card">
        <div className="sectionTitle">Customer & Move Details</div>
        <div className="col" style={{ gap: 10 }}>
          <Field label="Customer Name *">
            <input value={local.customer_name} onChange={(e) => setField("customer_name", e.target.value)} />
          </Field>
          <div className="row wrap" style={{ gap: 10 }}>
            <Field label="Email" flex>
              <input value={local.customer_email ?? ""} onChange={(e) => setField("customer_email", e.target.value)} />
            </Field>
            <Field label="Phone" flex>
              <input value={local.customer_phone ?? ""} onChange={(e) => setField("customer_phone", e.target.value)} />
            </Field>
          </div>
          <Field label="Target Move Date">
            <input type="date" value={local.move_date ?? ""} onChange={(e) => setField("move_date", e.target.value)} />
          </Field>
          <Field label="Origin Address">
            <input value={local.origin_address ?? ""} onChange={(e) => setField("origin_address", e.target.value)} placeholder="Street, City, ST" />
          </Field>
          <Field label="Destination Address">
            <input value={local.destination_address ?? ""} onChange={(e) => setField("destination_address", e.target.value)} placeholder="Street, City, ST" />
          </Field>
          <Field label="Origin Access Notes">
            <textarea
              rows={2}
              value={local.origin_access_notes ?? ""}
              onChange={(e) => setField("origin_access_notes", e.target.value)}
              placeholder="Stairs, elevators, parking distance, truck access…"
            />
          </Field>
          <Field label="Destination Access Notes">
            <textarea
              rows={2}
              value={local.destination_access_notes ?? ""}
              onChange={(e) => setField("destination_access_notes", e.target.value)}
              placeholder="Stairs, elevators, parking distance, truck access…"
            />
          </Field>
          <Field label="Special Items">
            <textarea
              rows={2}
              value={local.special_items_notes ?? ""}
              onChange={(e) => setField("special_items_notes", e.target.value)}
              placeholder="Pianos, safes, artwork, gun safes, antiques…"
            />
          </Field>
          <Field label="General Notes">
            <textarea
              rows={2}
              value={local.general_notes ?? ""}
              onChange={(e) => setField("general_notes", e.target.value)}
              placeholder="Client preferences, timing constraints, gotchas…"
            />
          </Field>
          {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span className="small" style={{
              color: saveState === "error" ? "var(--danger)" : saveState === "saved" ? "var(--ok)" : "var(--muted)",
              minHeight: 18,
            }}>
              {saveState === "pending" && "Unsaved…"}
              {saveState === "saving" && "Saving…"}
              {saveState === "saved" && "✓ Saved"}
              {saveState === "error" && "Save failed — check connection"}
            </span>
            <button type="button" onClick={deleteEstimate} style={{ color: "var(--danger)", borderColor: "var(--danger)" }}>
              Delete estimate
            </button>
          </div>
        </div>
      </div>

      {/* Inventory — rooms */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div className="sectionTitle" style={{ marginBottom: 2 }}>Inventory</div>
            <div className="small" style={{ color: "var(--muted)" }}>
              Totals: {Math.round(totalWeight).toLocaleString()} lbs · {Math.round(totalCuft)} cu ft
            </div>
          </div>
          <button type="button" className="btnPrimary" onClick={addRoom}>+ Add Room</button>
        </div>

        {rooms.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)", marginTop: 12 }}>
            No rooms yet. Tap "Add Room" to start building the inventory.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginTop: 12 }}>
            {rooms.map((r) => (
              <RoomTile
                key={r}
                room={r}
                estimateUuid={local.estimate_uuid}
                items={local.items.filter((it) =>
                  r === "Unassigned" ? !it.room : (it.room ?? "").trim() === r,
                )}
                onChanged={refreshEstimate}
                onItemPatched={handleItemPatched}
                onAddItem={submitItemOptimistic}
                onCancelTemp={cancelTempItem}
                onRemovePendingRoom={() =>
                  setPendingRooms((prev) => prev.filter((p) => p !== r))
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Photos */}
      <EstimatePhotos
        estimateUuid={local.estimate_uuid}
        customerName={local.customer_name}
        moveDate={local.move_date ?? ""}
      />
    </div>
  );
}

function Field({ label, children, flex }: { label: string; children: React.ReactNode; flex?: boolean }) {
  return (
    <div className="col" style={{ gap: 4, flex: flex ? 1 : undefined, minWidth: flex ? 160 : undefined }}>
      <div className="small" style={{ color: "var(--muted)" }}>{label}</div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// RoomTile — one room, its subcategories, and its items
// ─────────────────────────────────────────────────────────────────────────

function RoomTile({
  room,
  estimateUuid,
  items,
  onChanged,
  onItemPatched,
  onAddItem,
  onCancelTemp,
  onRemovePendingRoom,
}: {
  room: string;
  estimateUuid: string;
  items: EstimateItem[];
  onChanged: () => void;
  onItemPatched: (updated: EstimateItem) => void;
  onAddItem: (payload: Omit<EstimateItem, "id">) => void;
  onCancelTemp: (tempId: number) => void;
  onRemovePendingRoom: () => void;
}) {
  const [addingItem, setAddingItem] = useState(false);
  const [preSubcategory, setPreSubcategory] = useState<string | null>(null);

  const subcategories = useMemo<string[]>(() => {
    const set = new Set<string>();
    let hasUncategorized = false;
    for (const it of items) {
      const s = (it.subcategory ?? "").trim();
      if (s) set.add(s);
      else hasUncategorized = true;
    }
    const out = [...set].sort((a, b) => a.localeCompare(b));
    if (hasUncategorized && items.length > 0) out.unshift("—");
    return out;
  }, [items]);

  const roomWeight = items.reduce((s, i) => s + (i.weight_lbs || 0) * (i.qty || 0), 0);
  const roomCuft = items.reduce((s, i) => s + (i.cubic_ft || 0) * (i.qty || 0), 0);

  function addSubcategory() {
    const name = prompt(`Add subcategory to "${room}" (e.g. Going, Not Going, Pack, Don't Touch):`)?.trim();
    if (!name) return;
    setPreSubcategory(name);
    setAddingItem(true);
  }

  const isUnassigned = room === "Unassigned";

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: "var(--r)",
      background: "rgba(255,255,255,0.02)",
      padding: 12,
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{room}</div>
          <div className="small" style={{ color: "var(--muted)" }}>
            {items.reduce((s, i) => s + (i.qty || 1), 0)} items · {Math.round(roomWeight).toLocaleString()} lbs · {Math.round(roomCuft)} cu ft
          </div>
        </div>
        {items.length === 0 && !isUnassigned && (
          <button
            type="button"
            onClick={onRemovePendingRoom}
            style={{ fontSize: 11, padding: "4px 8px", color: "var(--muted)" }}
          >
            Remove
          </button>
        )}
      </div>

      {subcategories.map((sub) => {
        const subItems = items.filter((it) => {
          const s = (it.subcategory ?? "").trim();
          return sub === "—" ? !s : s === sub;
        });
        return (
          <div key={sub}>
            <div className="small" style={{ color: "var(--brand)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
              {sub === "—" ? "Items" : sub}
            </div>
            <div className="col" style={{ gap: 0 }}>
              {subItems.map((it) => (
                <ItemRow
                  key={it.id}
                  item={it}
                  estimateUuid={estimateUuid}
                  onChanged={onChanged}
                  onItemPatched={onItemPatched}
                  onCancelTemp={onCancelTemp}
                />
              ))}
            </div>
          </div>
        );
      })}

      <div className="row wrap" style={{ gap: 6 }}>
        <button
          type="button"
          onClick={() => { setPreSubcategory(null); setAddingItem(true); }}
          style={{ fontSize: 12, padding: "6px 10px", flex: 1 }}
        >
          + Add item
        </button>
        {!isUnassigned && (
          <button
            type="button"
            onClick={addSubcategory}
            style={{ fontSize: 12, padding: "6px 10px", flex: 1 }}
          >
            + Subcategory
          </button>
        )}
      </div>

      {addingItem && (
        <AddItemDialog
          room={isUnassigned ? "" : room}
          subcategory={preSubcategory ?? ""}
          knownSubcategories={subcategories.filter((s) => s !== "—")}
          onClose={() => { setAddingItem(false); setPreSubcategory(null); }}
          onAdd={(payload) => {
            onAddItem(payload);
            setAddingItem(false);
            setPreSubcategory(null);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ItemRow — editable row with inline edit + notes
// ─────────────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  estimateUuid,
  onChanged,
  onItemPatched,
  onCancelTemp,
}: {
  item: EstimateItem;
  estimateUuid: string;
  onChanged: () => void;
  onItemPatched: (updated: EstimateItem) => void;
  onCancelTemp: (tempId: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(item.qty));
  const [weight, setWeight] = useState(String(item.weight_lbs));
  const [cuft, setCuft] = useState(String(item.cubic_ft));
  const [notes, setNotes] = useState(item.notes ?? "");
  const [itemSaveState, setItemSaveState] = useState<SaveState>("idle");

  const itemSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs so the blur/timer callbacks always read the latest field values.
  const qtyRef = useRef(qty);
  const weightRef = useRef(weight);
  const cuftRef = useRef(cuft);
  const notesRef = useRef(notes);
  useEffect(() => { qtyRef.current = qty; }, [qty]);
  useEffect(() => { weightRef.current = weight; }, [weight]);
  useEffect(() => { cuftRef.current = cuft; }, [cuft]);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  // Negative ids are client-side placeholders for a not-yet-confirmed POST.
  const isTemp = item.id < 0;

  function buildPatch() {
    return {
      qty: Math.max(1, Math.floor(Number(qtyRef.current) || 1)),
      weight_lbs: Math.max(0, Number(weightRef.current) || 0),
      cubic_ft: Math.max(0, Number(cuftRef.current) || 0),
      notes: notesRef.current.trim(),
    };
  }

  async function flushItemSave() {
    setItemSaveState("saving");
    try {
      const updated = await apiFetch<EstimateItem>(
        `/api/estimates/${estimateUuid}/items/${item.id}`,
        { method: "PATCH", body: JSON.stringify(buildPatch()) },
      );
      onItemPatched(updated);
      setItemSaveState("saved");
      setTimeout(() => setItemSaveState("idle"), 2000);
    } catch (e: any) {
      setItemSaveState("error");
      alert(e instanceof ApiError ? e.message : "Save failed — check connection");
    }
  }

  function scheduleItemSave() {
    setItemSaveState("pending");
    if (itemSaveTimer.current) clearTimeout(itemSaveTimer.current);
    itemSaveTimer.current = setTimeout(() => flushItemSave(), 600);
  }

  // Flush immediately when a field loses focus so values are saved even
  // if the user taps away before the debounce fires.
  function handleBlur() {
    if (itemSaveState === "pending" || itemSaveState === "saving") {
      if (itemSaveTimer.current) clearTimeout(itemSaveTimer.current);
      flushItemSave();
    }
  }

  // Flush on unmount if there's a pending save (e.g. user navigates back
  // while the debounce timer is still counting).
  useEffect(() => {
    return () => {
      if (itemSaveTimer.current) clearTimeout(itemSaveTimer.current);
    };
  }, []);

  async function remove() {
    if (!confirm(`Remove "${item.name}"?`)) return;
    if (itemSaveTimer.current) clearTimeout(itemSaveTimer.current);
    try {
      await apiFetch(`/api/estimates/${estimateUuid}/items/${item.id}`, { method: "DELETE" });
      onChanged();
    } catch (e: any) {
      alert(e instanceof ApiError ? e.message : "Remove failed");
    }
  }

  function cancelEdit() {
    // Revert fields to server values and clear any pending save.
    if (itemSaveTimer.current) clearTimeout(itemSaveTimer.current);
    setQty(String(item.qty));
    setWeight(String(item.weight_lbs));
    setCuft(String(item.cubic_ft));
    setNotes(item.notes ?? "");
    setItemSaveState("idle");
    setEditing(false);
  }

  if (isTemp) {
    return (
      <div
        style={{
          padding: "8px 0",
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          opacity: 0.75,
        }}
      >
        <span style={{ fontSize: 13 }}>
          <strong>×{item.qty}</strong> {item.name}
          <span className="small" style={{ color: "var(--muted)", marginLeft: 8 }}>Syncing…</span>
        </span>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Cancel pending add of "${item.name}"?`)) onCancelTemp(item.id);
          }}
          style={{ fontSize: 11, padding: "4px 10px", color: "var(--muted)" }}
        >
          Cancel
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div style={{ borderTop: "1px solid var(--border)", padding: "6px 0" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{item.name}</div>
        <div className="row wrap" style={{ gap: 6 }}>
          <label className="col" style={{ gap: 2, flex: "1 1 70px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Qty</span>
            <input
              value={qty}
              onChange={(e) => { setQty(e.target.value); scheduleItemSave(); }}
              onBlur={handleBlur}
              type="number" min={1}
            />
          </label>
          <label className="col" style={{ gap: 2, flex: "1 1 90px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>lbs each</span>
            <input
              value={weight}
              onChange={(e) => { setWeight(e.target.value); scheduleItemSave(); }}
              onBlur={handleBlur}
              type="number" min={0} step={0.5}
            />
          </label>
          <label className="col" style={{ gap: 2, flex: "1 1 70px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>cu ft each</span>
            <input
              value={cuft}
              onChange={(e) => { setCuft(e.target.value); scheduleItemSave(); }}
              onBlur={handleBlur}
              type="number" min={0} step={0.5}
            />
          </label>
        </div>
        <label className="col" style={{ gap: 2, marginTop: 6 }}>
          <span className="small" style={{ color: "var(--muted)" }}>Notes</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => { setNotes(e.target.value); scheduleItemSave(); }}
            onBlur={handleBlur}
            placeholder="e.g. fragile, disassemble, client will pack…"
          />
        </label>
        <div className="row" style={{ gap: 6, marginTop: 6, alignItems: "center" }}>
          <span className="small" style={{
            flex: 1,
            color: itemSaveState === "error" ? "var(--danger)" : itemSaveState === "saved" ? "var(--ok)" : "var(--muted)",
          }}>
            {itemSaveState === "pending" && "Unsaved…"}
            {itemSaveState === "saving" && "Saving…"}
            {itemSaveState === "saved" && "✓ Saved"}
            {itemSaveState === "error" && "Save failed"}
          </span>
          <button type="button" onClick={cancelEdit} style={{ fontSize: 12 }}>Done</button>
          <button type="button" onClick={remove} style={{ color: "var(--danger)", borderColor: "var(--danger)", fontSize: 12 }}>Remove</button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      style={{
        textAlign: "left",
        padding: "6px 0",
        borderTop: "1px solid var(--border)",
        background: "transparent",
        border: "none",
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
      }}
    >
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13 }}>
          <strong>×{item.qty}</strong> {item.name}
        </span>
        <span className="small" style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
          {Math.round(item.weight_lbs * item.qty).toLocaleString()} lbs · {(item.cubic_ft * item.qty).toFixed(1)} cf
        </span>
      </div>
      {item.notes && (
        <div className="small" style={{ color: "var(--muted)", fontStyle: "italic", marginTop: 2 }}>
          "{item.notes}"
        </div>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// AddItemDialog — typeahead autocomplete + custom item with optional
// "save to app database" checkbox
// ─────────────────────────────────────────────────────────────────────────

type Match = {
  name: string;
  weight_lbs: number;
  cubic_ft: number;
  category: string | null;
  source: "builtin" | "user";
};

function useCatalog(): { list: Match[]; refresh: () => Promise<void> } {
  const [userCatalog, setUserCatalog] = useState<CatalogRow[]>([]);

  async function refresh() {
    try {
      const rows = await apiFetch<CatalogRow[]>("/api/estimates/catalog");
      setUserCatalog(rows);
    } catch { /* ignore */ }
  }

  useEffect(() => { refresh(); }, []);

  const list = useMemo<Match[]>(() => {
    const userNames = new Set(userCatalog.map((u) => u.name.toLowerCase()));
    const builtin: Match[] = FURNITURE_CATALOG
      .filter((f) => !userNames.has(f.name.toLowerCase()))
      .map((f: FurnitureItem) => ({
        name: f.name,
        weight_lbs: f.weight_lbs,
        cubic_ft: f.cubic_ft,
        category: f.category,
        source: "builtin",
      }));
    const user: Match[] = userCatalog.map((u) => ({
      name: u.name,
      weight_lbs: u.weight_lbs,
      cubic_ft: u.cubic_ft,
      category: u.category,
      source: "user",
    }));
    return [...user, ...builtin].sort((a, b) => a.name.localeCompare(b.name));
  }, [userCatalog]);

  return { list, refresh };
}

function AddItemDialog({
  room,
  subcategory,
  knownSubcategories,
  onClose,
  onAdd,
}: {
  room: string;
  subcategory: string;
  knownSubcategories: string[];
  onClose: () => void;
  onAdd: (payload: Omit<EstimateItem, "id">) => void;
}) {
  const { list: catalog, refresh: refreshCatalog } = useCatalog();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Match | null>(null);
  const [qty, setQty] = useState(1);
  const [weight, setWeight] = useState("");
  const [cuft, setCuft] = useState("");
  const [notes, setNotes] = useState("");
  const [saveToCatalog, setSaveToCatalog] = useState(false);
  const [sub, setSub] = useState(subcategory);
  const [err, setErr] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Hide dropdown once an item is selected.
  const suggestions = useMemo(() => {
    if (selected) return [];
    const q = query.trim().toLowerCase();
    if (!q) return catalog.slice(0, 8);
    return catalog.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 10);
  }, [catalog, query, selected]);

  const exactMatch = useMemo(
    () => catalog.find((c) => c.name.toLowerCase() === query.trim().toLowerCase()) || null,
    [catalog, query],
  );

  function doAdd(override?: { name: string; weight_lbs: number; cubic_ft: number }) {
    setErr(null);
    const name = (override?.name ?? selected?.name ?? query).trim();
    if (!name) { setErr("Item name required."); return; }
    const w = override?.weight_lbs ?? (Number(weight) || 0);
    const v = override?.cubic_ft ?? (Number(cuft) || 0);
    const q = Math.max(1, Math.floor(qty || 1));

    if (saveToCatalog && !selected && !override) {
      apiFetch("/api/estimates/catalog", {
        method: "POST",
        body: JSON.stringify({ name, weight_lbs: w, cubic_ft: v }),
      })
        .then(() => refreshCatalog())
        .catch(() => {/* non-fatal */});
    }

    onAdd({
      name,
      qty: q,
      weight_lbs: w,
      cubic_ft: v,
      room: room || null,
      subcategory: sub.trim() || null,
      notes: notes.trim() || null,
    });
  }

  function chooseAndAdd(m: Match) {
    setSelected(m);
    setQuery(m.name);
    setWeight(String(m.weight_lbs));
    setCuft(String(m.cubic_ft));
    doAdd({ name: m.name, weight_lbs: m.weight_lbs, cubic_ft: m.cubic_ft });
  }

  function clearSelection() {
    setSelected(null);
    setWeight("");
    setCuft("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    doAdd();
  }
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card"
        style={{ maxWidth: 460, width: "100%", maxHeight: "90vh", overflowY: "auto", marginTop: 0 }}
      >
        <div className="sectionTitle">
          Add Item{room ? ` — ${room}` : ""}
        </div>

        <form onSubmit={submit} className="col" style={{ gap: 10 }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Item *</span>
            <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
              <input
                autoFocus
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } }}
                placeholder="Start typing — e.g. Sofa, Dresser, Box…"
                style={{ flex: 1 }}
              />
              <div className="col" style={{ gap: 2, flexShrink: 0 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Qty</span>
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  style={{ width: 68 }}
                />
              </div>
            </div>
            {query && !exactMatch && !selected && (
              <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                No exact match — press Enter or tap "Add to inventory" to add as custom.
              </div>
            )}
          </label>

          {suggestions.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--btn-r)", maxHeight: 200, overflowY: "auto" }}>
              {suggestions.map((m) => (
                <button
                  key={`${m.source}:${m.name}`}
                  type="button"
                  onClick={() => chooseAndAdd(m)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: 15,
                    cursor: "pointer",
                  }}
                >
                  <span>
                    {m.name}
                    {m.source === "user" && (
                      <span style={{ fontSize: 10, color: "var(--brand)", marginLeft: 6 }}>• custom</span>
                    )}
                  </span>
                  <span className="small" style={{ color: "var(--muted)" }}>
                    {m.weight_lbs} lbs · {m.cubic_ft} cf
                  </span>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div className="small" style={{ color: "var(--brand)" }}>
              Added “{selected.name}” ({selected.weight_lbs} lbs · {selected.cubic_ft} cu ft).{" "}
              <button type="button" onClick={clearSelection} style={{ fontSize: 11, padding: "2px 8px", background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>
                Change item
              </button>
            </div>
          )}

          {knownSubcategories.length > 0 && (
            <div className="col" style={{ gap: 4 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Subcategory</span>
              <div className="row wrap" style={{ gap: 6 }}>
                {knownSubcategories.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSub((prev) => prev === s ? "" : s)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 99,
                      border: "1px solid var(--border)",
                      background: sub === s ? "var(--brand)" : "rgba(255,255,255,0.06)",
                      color: sub === s ? "#0b1220" : "var(--text)",
                      fontSize: 13,
                      cursor: "pointer",
                      fontWeight: sub === s ? 700 : 400,
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 13, textAlign: "left", padding: "4px 0", cursor: "pointer" }}
          >
            {showAdvanced ? "▴ Hide options" : "▾ Weight / volume / notes"}
          </button>

          {showAdvanced && (
            <>
              <div className="row wrap" style={{ gap: 8 }}>
                <label className="col" style={{ gap: 2, flex: "1 1 100px" }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Weight (lbs each)</span>
                  <input value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0" inputMode="decimal" />
                </label>
                <label className="col" style={{ gap: 2, flex: "1 1 90px" }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Volume (cu ft each)</span>
                  <input value={cuft} onChange={(e) => setCuft(e.target.value)} placeholder="0" inputMode="decimal" />
                </label>
              </div>

              <label className="col" style={{ gap: 4 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Subcategory (optional)</span>
                <input
                  list={knownSubcategories.length ? "subcategory-suggest" : undefined}
                  value={sub}
                  onChange={(e) => setSub(e.target.value)}
                  placeholder="e.g. Going, Not Going, Pack…"
                />
                {knownSubcategories.length > 0 && (
                  <datalist id="subcategory-suggest">
                    {knownSubcategories.map((s) => <option key={s} value={s} />)}
                  </datalist>
                )}
              </label>

              <label className="col" style={{ gap: 4 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Notes (optional)</span>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Fragile, PBO, client disassembles…" />
              </label>

              {!selected && query.trim() && !exactMatch && (
                <label className="row" style={{ gap: 10, alignItems: "center", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={saveToCatalog}
                    onChange={(e) => setSaveToCatalog(e.target.checked)}
                    style={{ accentColor: "var(--brand)", width: 16, height: 16 }}
                  />
                  <span>Also save this item to the app database for future estimates</span>
                </label>
              )}
            </>
          )}

          {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}

          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <button type="submit" className="btnPrimary" style={{ flex: 1 }}>
              Add to inventory
            </button>
            <button type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Photos
// ─────────────────────────────────────────────────────────────────────────

function EstimatePhotos({
  estimateUuid,
  customerName,
  moveDate,
}: {
  estimateUuid: string;
  customerName: string;
  moveDate: string;
}) {
  const [photos, setPhotos] = useState<ServerPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const data = await apiFetch<{ ok: boolean; photos: ServerPhoto[] }>(
        `/api/photos?job_uuid=${encodeURIComponent(estimateUuid)}`,
      );
      setPhotos(data?.photos ?? []);
    } catch { /* offline */ }
  }

  useEffect(() => { refresh(); }, [estimateUuid]);

  async function upload() {
    if (!pendingFile) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      const resized = await resizeImage(pendingFile);
      form.append("file", resized, (pendingFile.name || "estimate.jpg").replace(/.[^.]+$/, ".jpg"));
      form.append("photo_id", newUUID());
      form.append("job_uuid", estimateUuid);
      form.append("job_name", `Estimate - ${customerName}`);
      form.append("job_date", moveDate || new Date().toISOString().slice(0, 10));
      form.append("caption", caption.trim());
      // Routes the upload to the estimator-photos Drive parent folder so
      // estimator captures don't mix into the crew-job photos folder.
      form.append("folder", "estimator");

      const token = getToken() || "";
      const res = await fetch(`${API}/api/photos/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setPendingFile(null);
      setCaption("");
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="sectionTitle">Site Photos ({photos.length})</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
        Add photos of rooms, furniture, access paths, and anything worth noting for the crew.
      </div>

      {pendingFile ? (
        <div className="col" style={{ gap: 8 }}>
          <img
            src={URL.createObjectURL(pendingFile)}
            alt="preview"
            style={{ width: "100%", maxHeight: 260, objectFit: "cover", borderRadius: 8 }}
          />
          <textarea
            rows={2}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Note (optional)…"
          />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btnPrimary" onClick={upload} disabled={busy} style={{ flex: 1 }}>
              {busy ? "Uploading…" : "Save photo"}
            </button>
            <button type="button" onClick={() => { setPendingFile(null); setCaption(""); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <label
          className="btnPrimary"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "10px 18px",
            borderRadius: "var(--btn-r)",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Add Photo
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.currentTarget.value = "";
              if (f) setPendingFile(f);
            }}
          />
        </label>
      )}

      {err && <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}

      {photos.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginTop: 12 }}>
          {photos.map((p) => (
            <a
              key={p.id}
              href={p.drive_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "block", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}
            >
              <img src={p.thumb_url} alt={p.caption} style={{ width: "100%", display: "block" }} />
              {p.caption && (
                <div style={{ fontSize: 11, color: "var(--muted)", padding: "4px 6px" }}>{p.caption}</div>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
