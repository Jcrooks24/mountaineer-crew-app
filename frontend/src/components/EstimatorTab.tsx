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
import { mountainDateYYYYMMDD } from "../lib/time";
import { fetchCalendarDay, resolveJobUuid, type CalEvent } from "../lib/bolStore";
import { BetaTag } from "./BetaTag";

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
  estimated_hours: number | null;
  job_uuid: string | null;
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
  // Always resolves - never rejects, never hangs. Falls back to the original
  // file on any failure (decode error, canvas OOM, unsupported MIME). The
  // 30s safety timer is load-bearing: a synchronous throw inside `onload`
  // (e.g. `getContext("2d")` is null on a low-RAM phone) would otherwise
  // leave the promise pending forever and the photo button stuck.
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (out: Blob) => {
      if (settled) return;
      settled = true;
      try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
      resolve(out);
    };
    const timeout = window.setTimeout(() => {
      console.warn("[estimator-photo] resize timed out - uploading original");
      finish(file);
    }, 30_000);
    img.onload = () => {
      window.clearTimeout(timeout);
      try {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { finish(file); return; }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => finish(blob ?? file), "image/jpeg", quality);
      } catch (e) {
        console.warn("[estimator-photo] resize failed - uploading original", e);
        finish(file);
      }
    };
    img.onerror = () => { window.clearTimeout(timeout); finish(file); };
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

  // Job-link picker state (bind this estimate to the real calendar job).
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDate, setLinkDate] = useState<string>("");
  const [linkEvents, setLinkEvents] = useState<CalEvent[] | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  // Always-current ref so the unmount flush reads the latest field values.
  const localRef = useRef<Estimate>(local);
  useEffect(() => { localRef.current = local; }, [local]);

  const metaSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  // Rooms that exist only in the UI (before their first item is added)
  const [pendingRooms, setPendingRooms] = useState<string[]>([]);
  // Inline room-name entry - see note on subcategory entry below; window.prompt
  // is unusable in a mobile standalone/PWA context.
  const [addingRoom, setAddingRoom] = useState(false);
  const [roomDraft, setRoomDraft] = useState("");

  // Resync local ONLY when a different estimate is opened. Keying on the whole
  // `estimate` object would reset local every time our own autosave echoes back
  // an updated record, clobbering characters typed during the save round-trip
  // (and any trailing whitespace the backend trims) - the "lose a sentence while
  // typing" bug. Item edits refresh local.items explicitly via refreshEstimate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLocal(estimate); }, [estimate.estimate_uuid]);

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
    metaSaveTimer.current = setTimeout(() => { metaSaveTimer.current = null; flushMetaSave(localRef.current); }, 800);
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
          estimated_hours: l.estimated_hours,
        }),
      });
      if (!isMounted.current) return;
      onChange(updated);
      setSaveState("saved");
      setTimeout(() => { if (isMounted.current) setSaveState("idle"); }, 2000);
    } catch (e: any) {
      if (!isMounted.current) return;
      setSaveState("error");
      setErr(e instanceof ApiError ? e.message : "Auto-save failed - check connection");
    }
  }

  // Flush any pending meta save on unmount (navigating back, closing, etc.)
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (metaSaveTimer.current) {
        clearTimeout(metaSaveTimer.current);
        // Fire-and-forget - component is gone so we can't update state
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
            estimated_hours: l.estimated_hours,
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
      // Pull the refreshed item list into local (item add/remove/edit happens in
      // child rows). Meta fields the user may be typing are preserved - the
      // prop-sync effect above no longer resets local for the same estimate.
      setLocal((prev) => ({ ...prev, items: fresh.items }));
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Reload failed");
    }
  }

  // ── Job link ──────────────────────────────────────────────────────────────
  function openLinkPicker() {
    setLinkOpen(true);
    setLinkEvents(null);
    // Default the date to the estimate's target move date, else today.
    setLinkDate(local.move_date || mountainDateYYYYMMDD());
  }

  async function loadLinkDay(date: string) {
    if (!date) return;
    setLinkBusy(true);
    setErr(null);
    try {
      setLinkEvents(await fetchCalendarDay(date));
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Could not load calendar jobs");
      setLinkEvents([]);
    } finally {
      setLinkBusy(false);
    }
  }

  async function patchJobLink(jobUuid: string) {
    // Empty string = explicit unlink on the backend.
    const updated = await apiFetch<Estimate>(`/api/estimates/${local.estimate_uuid}`, {
      method: "PATCH",
      body: JSON.stringify({ job_uuid: jobUuid }),
    });
    onChange(updated);
    setLocal(updated);
  }

  async function linkToEvent(ev: CalEvent) {
    setLinkBusy(true);
    setErr(null);
    try {
      const jobUuid = await resolveJobUuid(ev.id, ev.start, ev.end);
      await patchJobLink(jobUuid);
      setLinkOpen(false);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Could not link this job");
    } finally {
      setLinkBusy(false);
    }
  }

  async function unlinkJob() {
    setErr(null);
    try {
      await patchJobLink("");
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Could not unlink");
    }
  }

  type ItemPayload = Omit<EstimateItem, "id">;

  function newOpId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // Resolve a successful POST for a temp id - swap the temp row for the
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
  // the op queued - the drain effect below retries on next mount / reload.
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

    // item_uuid = opId. The server upserts on it, so this POST and any later
    // retry from drainEstimatorQueue() are the same write. Without it, a lost
    // response here left the op queued and the next drain added the item twice.
    apiFetch<EstimateItem>(`/api/estimates/${local.estimate_uuid}/items`, {
      method: "POST",
      body: JSON.stringify({ ...payload, item_uuid: opId }),
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
        // else: network / 5xx - leave queued, drain will retry
      });
  }

  // Called from ItemRow when the user tries to delete a still-syncing
  // (negative id) row. Cancelling the queued op prevents the POST from
  // running; if the POST already fired, this is a best-effort - the
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

  function confirmRoom() {
    const name = roomDraft.trim();
    if (!name) return;
    if (!rooms.includes(name)) setPendingRooms((prev) => [...prev, name]);
    setRoomDraft("");
    setAddingRoom(false);
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
          <div className="row wrap" style={{ gap: 10 }}>
            <Field label="Target Move Date" flex>
              <input type="date" value={local.move_date ?? ""} onChange={(e) => setField("move_date", e.target.value)} />
            </Field>
            <Field label="Estimated Hours" flex>
              <input
                type="number"
                min={0}
                step={0.5}
                value={local.estimated_hours ?? ""}
                onChange={(e) => setField("estimated_hours", e.target.value === "" ? null : Number(e.target.value))}
                placeholder="e.g. 6.5"
              />
            </Field>
          </div>
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
              {saveState === "error" && "Save failed - check connection"}
            </span>
            <button type="button" onClick={deleteEstimate} style={{ color: "var(--danger)", borderColor: "var(--danger)" }}>
              Delete estimate
            </button>
          </div>
        </div>
      </div>

      {/* Job link */}
      <div className="card">
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <div className="sectionTitle" style={{ marginBottom: 0 }}>Linked Job</div>
          <BetaTag feature="estimateJobLink" style={{ marginTop: 0 }} />
        </div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
          Bind this estimate to the scheduled job so the crew sees it at the job (powers the overage check).
        </div>
        {local.job_uuid ? (
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div className="small">
              Linked ✓ <span style={{ color: "var(--muted)" }}>({local.job_uuid.slice(0, 8)}…)</span>
            </div>
            <button type="button" onClick={unlinkJob} style={{ color: "var(--danger)" }}>Unlink</button>
          </div>
        ) : !linkOpen ? (
          <button type="button" onClick={openLinkPicker}>Link to a job…</button>
        ) : (
          <div className="col" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
              <Field label="Job date" flex>
                <input type="date" value={linkDate} onChange={(e) => setLinkDate(e.target.value)} />
              </Field>
              <button type="button" onClick={() => loadLinkDay(linkDate)} disabled={linkBusy || !linkDate}>
                {linkBusy ? "Loading…" : "Load jobs"}
              </button>
            </div>
            {linkEvents && linkEvents.length === 0 && (
              <div className="small" style={{ color: "var(--muted)" }}>No calendar jobs on this date.</div>
            )}
            {linkEvents && linkEvents.map((ev) => (
              <button key={ev.id} type="button" onClick={() => linkToEvent(ev)} disabled={linkBusy} style={{ textAlign: "left" }}>
                {ev.summary}
              </button>
            ))}
            <button type="button" onClick={() => setLinkOpen(false)} style={{ color: "var(--muted)" }}>Cancel</button>
          </div>
        )}
      </div>

      {/* Inventory - rooms */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div className="sectionTitle" style={{ marginBottom: 2 }}>Inventory</div>
            <div className="small" style={{ color: "var(--muted)" }}>
              Totals: {Math.round(totalWeight).toLocaleString()} lbs · {Math.round(totalCuft)} cu ft
            </div>
          </div>
          {!addingRoom && (
            <button type="button" className="btnPrimary" onClick={() => { setRoomDraft(""); setAddingRoom(true); }}>+ Add Room</button>
          )}
        </div>

        {addingRoom && (
          <div className="col" style={{ gap: 6, marginTop: 10 }}>
            <span className="small" style={{ color: "var(--muted)" }}>New room</span>
            <div className="row" style={{ gap: 6 }}>
              <input
                autoFocus
                value={roomDraft}
                onChange={(e) => setRoomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); confirmRoom(); }
                  if (e.key === "Escape") { setAddingRoom(false); setRoomDraft(""); }
                }}
                placeholder="e.g. Living Room, Kitchen, Garage"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btnPrimary"
                onClick={confirmRoom}
                disabled={!roomDraft.trim()}
                style={{ padding: "6px 12px" }}
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => { setAddingRoom(false); setRoomDraft(""); }}
                style={{ padding: "6px 10px", color: "var(--muted)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

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
// RoomTile - one room, its subcategories, and its items
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
  // Inline subcategory-name entry. Replaces window.prompt(), which mobile
  // standalone/PWA browsers silently suppress (crew tapped "+ Subcategory"
  // and nothing happened - no way to classify items on a phone).
  const [addingSub, setAddingSub] = useState(false);
  const [subDraft, setSubDraft] = useState("");

  const subcategories = useMemo<string[]>(() => {
    const set = new Set<string>();
    let hasUncategorized = false;
    for (const it of items) {
      const s = (it.subcategory ?? "").trim();
      if (s) set.add(s);
      else hasUncategorized = true;
    }
    const out = [...set].sort((a, b) => a.localeCompare(b));
    if (hasUncategorized && items.length > 0) out.unshift("-");
    return out;
  }, [items]);

  const roomWeight = items.reduce((s, i) => s + (i.weight_lbs || 0) * (i.qty || 0), 0);
  const roomCuft = items.reduce((s, i) => s + (i.cubic_ft || 0) * (i.qty || 0), 0);

  function confirmSubcategory() {
    const name = subDraft.trim();
    if (!name) return;
    setPreSubcategory(name);
    setAddingSub(false);
    setSubDraft("");
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
          return sub === "-" ? !s : s === sub;
        });
        return (
          <div key={sub}>
            <div className="small" style={{ color: "var(--brand)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
              {sub === "-" ? "Items" : sub}
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
        {!isUnassigned && !addingSub && (
          <button
            type="button"
            onClick={() => { setSubDraft(""); setAddingSub(true); }}
            style={{ fontSize: 12, padding: "6px 10px", flex: 1 }}
          >
            + Subcategory
          </button>
        )}
      </div>

      {addingSub && (
        <div className="col" style={{ gap: 6 }}>
          <span className="small" style={{ color: "var(--muted)" }}>
            New subcategory for "{room}"
          </span>
          <div className="row" style={{ gap: 6 }}>
            <input
              autoFocus
              value={subDraft}
              onChange={(e) => setSubDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); confirmSubcategory(); }
                if (e.key === "Escape") { setAddingSub(false); setSubDraft(""); }
              }}
              placeholder="e.g. Going, Not Going, Pack, Don't Touch"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              onClick={confirmSubcategory}
              disabled={!subDraft.trim()}
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => { setAddingSub(false); setSubDraft(""); }}
              style={{ fontSize: 12, padding: "6px 10px", color: "var(--muted)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {addingItem && (
        <AddItemDialog
          room={isUnassigned ? "" : room}
          subcategory={preSubcategory ?? ""}
          knownSubcategories={subcategories.filter((s) => s !== "-")}
          onClose={() => { setAddingItem(false); setPreSubcategory(null); }}
          onAdd={(payload) => { onAddItem(payload); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ItemRow - editable row with inline edit + notes
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
    }
  }

  function scheduleItemSave() {
    setItemSaveState("pending");
    if (itemSaveTimer.current) clearTimeout(itemSaveTimer.current);
    itemSaveTimer.current = setTimeout(() => { itemSaveTimer.current = null; flushItemSave(); }, 600);
  }

  // Flush immediately when a field loses focus so values are saved even
  // if the user taps away before the debounce fires. Only flush when
  // "pending" - if already "saving" the in-flight request is handling it
  // and a second concurrent PATCH would race against it.
  function handleBlur() {
    if (itemSaveState === "pending") {
      if (itemSaveTimer.current) { clearTimeout(itemSaveTimer.current); itemSaveTimer.current = null; }
      flushItemSave();
    }
  }

  // Fire-and-forget flush on unmount so edits aren't silently dropped when
  // the user navigates away while the debounce timer is still counting.
  useEffect(() => {
    return () => {
      if (itemSaveTimer.current) {
        clearTimeout(itemSaveTimer.current);
        apiFetch(`/api/estimates/${estimateUuid}/items/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify(buildPatch()),
        }).catch(() => {});
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function remove() {
    if (!confirm(`Remove "${item.name}"?`)) return;
    if (itemSaveTimer.current) { clearTimeout(itemSaveTimer.current); itemSaveTimer.current = null; }
    try {
      await apiFetch(`/api/estimates/${estimateUuid}/items/${item.id}`, { method: "DELETE" });
      onChanged();
    } catch (e: any) {
      setItemSaveState("error");
    }
  }

  function cancelEdit() {
    // Revert fields to server values and clear any pending save.
    if (itemSaveTimer.current) { clearTimeout(itemSaveTimer.current); itemSaveTimer.current = null; }
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
// AddItemDialog - typeahead autocomplete + custom item with optional
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

  // The dialog stays open after each add so the estimator can add several items
  // in a row; searchRef lets us drop the cursor straight back in the item box,
  // and justAdded gives a quick confirmation of the item that was just added.
  const searchRef = useRef<HTMLInputElement>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Match | null>(null);
  // String-backed so the user can clear and retype. A numeric-clamped state
  // snaps back to 1 mid-edit and makes the field uneditable on mobile.
  const [qty, setQty] = useState("1");
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
    const parsedQty = Number(qty);
    const q = Number.isFinite(parsedQty) && parsedQty >= 1 ? Math.floor(parsedQty) : 1;

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
    resetForNext(name);
  }

  // Clear the item-specific fields and drop the cursor back in the search box so
  // the next item can be typed immediately. Keeps `sub` (subcategory) so a run
  // of items in the same subcategory stays grouped without re-picking it.
  function resetForNext(addedName: string) {
    setJustAdded(addedName);
    setSelected(null);
    setQuery("");
    setWeight("");
    setCuft("");
    setNotes("");
    setQty("1");
    setSaveToCatalog(false);
    setErr(null);
    requestAnimationFrame(() => searchRef.current?.focus());
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
          Add Item{room ? ` - ${room}` : ""}
        </div>

        <form onSubmit={submit} className="col" style={{ gap: 10 }}>
          {/* Subcategory chips render before the Item input so they stay
              visible once the mobile keyboard opens (the Item input used to
              autoFocus, pushing the chips below the keyboard fold). */}
          {/* Subcategory is always available here (not behind the advanced
              toggle) so crew can classify items on mobile: tap an existing
              chip, or type a new name. */}
          <div className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Subcategory (optional)</span>
            {knownSubcategories.length > 0 && (
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
            )}
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
          </div>

          {justAdded && (
            <div className="small" style={{ color: "var(--ok)", fontWeight: 600 }}>
              ✓ Added “{justAdded}”. Add another, or tap Done.
            </div>
          )}

          <label className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Item *</span>
            <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelected(null); if (justAdded) setJustAdded(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } }}
                placeholder="Start typing - e.g. Sofa, Dresser, Box…"
                style={{ flex: 1 }}
              />
              <div className="col" style={{ gap: 2, flexShrink: 0 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Qty</span>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={qty}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setQty(e.target.value)}
                  onBlur={() => {
                    const n = Number(qty);
                    setQty(String(Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1));
                  }}
                  style={{ width: 68 }}
                />
              </div>
            </div>
            {query && !exactMatch && !selected && (
              <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                No exact match - press Enter or tap "Add to inventory" to add as custom.
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
            <button type="button" onClick={onClose}>{justAdded ? "Done" : "Cancel"}</button>
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
  // Pending batch: take several shots and/or multi-select from the library,
  // each with its own note, then upload them together.
  const [pending, setPending] = useState<{ id: string; file: File; caption: string }[]>([]);
  // Saved-grid note editor: which photo's note is open + its draft.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  async function refresh() {
    try {
      const data = await apiFetch<{ ok: boolean; photos: ServerPhoto[] }>(
        `/api/photos?job_uuid=${encodeURIComponent(estimateUuid)}`,
      );
      setPhotos(data?.photos ?? []);
    } catch { /* offline */ }
  }

  useEffect(() => { refresh(); }, [estimateUuid]);

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErr(null);
    setPending((prev) => [
      ...prev,
      ...Array.from(files).map((file) => ({ id: newUUID(), file, caption: "" })),
    ]);
  }

  async function uploadOne(file: File, caption: string) {
    const form = new FormData();
    const resized = await resizeImage(file);
    form.append("file", resized, (file.name || "estimate.jpg").replace(/.[^.]+$/, ".jpg"));
    form.append("photo_id", newUUID());
    form.append("job_uuid", estimateUuid);
    form.append("job_name", `Estimate - ${customerName}`);
    form.append("job_date", moveDate || mountainDateYYYYMMDD());
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
  }

  async function uploadAll() {
    if (pending.length === 0) return;
    setBusy(true);
    setErr(null);
    let lastErr = "";
    for (const p of pending) {
      try {
        await uploadOne(p.file, p.caption);
      } catch (e: any) {
        lastErr = e?.message ?? "Upload failed";
      }
    }
    setPending([]);
    if (lastErr) setErr(lastErr);
    await refresh();
    setBusy(false);
  }

  async function saveNote(photoId: string, caption: string) {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/api/photos/caption`, {
        method: "POST",
        body: JSON.stringify({ photo_id: photoId, caption }),
      });
      setEditingId(null);
      setNoteDraft("");
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Could not save note");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="sectionTitle" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Site Photos ({photos.length})<BetaTag feature="multiPhoto" />
      </div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
        Add photos of rooms, furniture, access paths, and anything worth noting for the crew.
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        <label
          className="btnPrimary"
          style={{ display: "inline-flex", alignItems: "center", padding: "10px 18px", borderRadius: "var(--btn-r)", cursor: busy ? "not-allowed" : "pointer" }}
        >
          Take Photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            disabled={busy}
            onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ""; }}
          />
        </label>
        <label
          style={{ display: "inline-flex", alignItems: "center", padding: "10px 18px", borderRadius: "var(--btn-r)", border: "1px solid var(--border)", background: "rgba(255,255,255,0.04)", cursor: busy ? "not-allowed" : "pointer" }}
        >
          Add from Library
          <input
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            disabled={busy}
            onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ""; }}
          />
        </label>
      </div>

      {/* Pending batch - note each photo, then upload together. */}
      {pending.length > 0 && (
        <div className="col" style={{ gap: 10, marginTop: 12 }}>
          <div className="small" style={{ fontWeight: 700 }}>Ready to upload ({pending.length})</div>
          {pending.map((p) => {
            const url = URL.createObjectURL(p.file);
            return (
              <div key={p.id} className="col" style={{ gap: 6, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                <img src={url} alt="preview" style={{ width: "100%", maxHeight: 220, objectFit: "cover" }} onLoad={() => URL.revokeObjectURL(url)} />
                <div className="col" style={{ gap: 6, padding: 8 }}>
                  <textarea
                    rows={2}
                    value={p.caption}
                    onChange={(e) => setPending((prev) => prev.map((x) => x.id === p.id ? { ...x, caption: e.target.value } : x))}
                    placeholder="Note (optional)…"
                  />
                  <button type="button" onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))} disabled={busy}
                    style={{ alignSelf: "flex-start", fontSize: 12, padding: "4px 10px" }}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          <div className="row wrap" style={{ gap: 8 }}>
            <button type="button" className="btnPrimary" onClick={uploadAll} disabled={busy} style={{ flex: 1 }}>
              {busy ? "Uploading…" : (pending.length === 1 ? "Upload photo" : `Upload all (${pending.length})`)}
            </button>
            <button type="button" onClick={() => setPending([])} disabled={busy}>Clear</button>
          </div>
        </div>
      )}

      {err && <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}

      {photos.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginTop: 12 }}>
          {photos.map((p) => (
            <div key={p.id} style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
              <a href={p.drive_url} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
                <img src={p.thumb_url} alt={p.caption} style={{ width: "100%", display: "block" }} />
              </a>
              <div style={{ padding: "4px 6px" }}>
                {editingId === p.id ? (
                  <div className="col" style={{ gap: 4 }}>
                    <textarea
                      rows={2}
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Note…"
                      autoFocus
                    />
                    <div className="row" style={{ gap: 4 }}>
                      <button type="button" className="btnPrimary" disabled={busy}
                        onClick={() => saveNote(p.id, noteDraft.trim())}
                        style={{ fontSize: 11, padding: "3px 8px" }}>
                        Save
                      </button>
                      <button type="button" onClick={() => { setEditingId(null); setNoteDraft(""); }}
                        style={{ fontSize: 11, padding: "3px 8px" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {p.caption && <div style={{ fontSize: 11, color: "var(--muted)" }}>{p.caption}</div>}
                    <button type="button" onClick={() => { setEditingId(p.id); setNoteDraft(p.caption || ""); }}
                      disabled={busy}
                      style={{ fontSize: 11, padding: "3px 8px", marginTop: 4 }}>
                      {p.caption ? "Edit note" : "Add note"}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
