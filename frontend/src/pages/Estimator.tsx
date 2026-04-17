import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { getToken } from "../auth/token";
import {
  FURNITURE_CATALOG,
  FURNITURE_CATEGORIES,
  type FurnitureItem,
} from "../data/furnitureCatalog";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

type EstimateItem = {
  id: number;
  name: string;
  qty: number;
  weight_lbs: number;
  cubic_ft: number;
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

type ServerPhoto = {
  id: string;
  drive_url: string;
  thumb_url: string;
  caption: string;
  created_at: string;
};

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

export default function Estimator() {
  const { user } = useAuth();
  const nav = useNavigate();

  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [current, setCurrent] = useState<Estimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (user && user.role !== "admin") nav("/", { replace: true });
  }, [user, nav]);

  async function refreshList() {
    try {
      const rows = await apiFetch<Estimate[]>("/api/estimates");
      setEstimates(rows);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to load estimates");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refreshList(); }, []);

  if (!user || user.role !== "admin") return null;

  if (current) {
    return (
      <EstimateDetail
        estimate={current}
        onBack={() => { setCurrent(null); refreshList(); }}
        onChange={(next) => setCurrent(next)}
      />
    );
  }

  return (
    <div className="container">
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Estimator</div>
          <div className="small" style={{ color: "var(--muted)" }}>In-home estimate builder (admin)</div>
        </div>
        <button onClick={() => nav(-1)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>
          ← Back
        </button>
      </div>

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
                    {Math.round(e.estimated_weight_lbs).toLocaleString()} lbs · {Math.round(e.estimated_cubic_ft)} cu ft · {e.items.length} items
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

// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────

type DetailProps = {
  estimate: Estimate;
  onBack: () => void;
  onChange: (e: Estimate) => void;
};

function EstimateDetail({ estimate, onBack, onChange }: DetailProps) {
  const [local, setLocal] = useState<Estimate>(estimate);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Keep local in sync when parent passes a fresh snapshot (e.g. after item add)
  useEffect(() => { setLocal(estimate); }, [estimate]);

  const totalWeight = useMemo(
    () => local.items.reduce((s, i) => s + (i.weight_lbs || 0) * (i.qty || 0), 0),
    [local.items],
  );
  const totalCuft = useMemo(
    () => local.items.reduce((s, i) => s + (i.cubic_ft || 0) * (i.qty || 0), 0),
    [local.items],
  );

  function setField<K extends keyof Estimate>(key: K, val: Estimate[K]) {
    setLocal((prev) => ({ ...prev, [key]: val }));
  }

  async function saveMeta() {
    setSaving(true);
    setErr(null);
    try {
      const updated = await apiFetch<Estimate>(`/api/estimates/${local.estimate_uuid}`, {
        method: "PATCH",
        body: JSON.stringify({
          customer_name: local.customer_name,
          customer_email: local.customer_email ?? "",
          customer_phone: local.customer_phone ?? "",
          origin_address: local.origin_address ?? "",
          destination_address: local.destination_address ?? "",
          move_date: local.move_date ?? "",
          origin_access_notes: local.origin_access_notes ?? "",
          destination_access_notes: local.destination_access_notes ?? "",
          special_items_notes: local.special_items_notes ?? "",
          general_notes: local.general_notes ?? "",
        }),
      });
      onChange(updated);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEstimate() {
    if (!confirm(`Delete estimate for ${local.customer_name}? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/estimates/${local.estimate_uuid}`, { method: "DELETE" });
      onBack();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  return (
    <div className="container">
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{local.customer_name || "Estimate"}</div>
          <div className="small" style={{ color: "var(--muted)" }}>
            {Math.round(totalWeight).toLocaleString()} lbs · {Math.round(totalCuft)} cu ft · {local.items.length} items
          </div>
        </div>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>
          ← Back
        </button>
      </div>

      {/* ── Customer & move details ── */}
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
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button type="button" className="btnPrimary" onClick={saveMeta} disabled={saving}>
              {saving ? "Saving…" : "Save details"}
            </button>
            <button type="button" onClick={deleteEstimate} style={{ color: "var(--danger)", borderColor: "var(--danger)" }}>
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* ── Inventory ── */}
      <InventoryCard estimate={local} onChange={onChange} />

      {/* ── Photos ── */}
      <EstimatePhotos estimateUuid={local.estimate_uuid} customerName={local.customer_name} moveDate={local.move_date ?? ""} />
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

// ─────────────────────────────────────────────────────────────────────────────

type InventoryProps = { estimate: Estimate; onChange: (e: Estimate) => void };

function InventoryCard({ estimate, onChange }: InventoryProps) {
  const [selectedName, setSelectedName] = useState("");
  const [qty, setQty] = useState(1);
  const [customName, setCustomName] = useState("");
  const [customWeight, setCustomWeight] = useState("");
  const [customCuft, setCustomCuft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, FurnitureItem[]>();
    for (const it of FURNITURE_CATALOG) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    return map;
  }, []);

  async function addItem() {
    setErr(null);
    if (!estimate.estimate_uuid) return;

    let name: string;
    let weight: number;
    let cuft: number;

    if (selectedName && selectedName !== "__custom__") {
      const found = FURNITURE_CATALOG.find((i) => i.name === selectedName);
      if (!found) { setErr("Item not found in catalog"); return; }
      name = found.name;
      weight = found.weight_lbs;
      cuft = found.cubic_ft;
    } else if (selectedName === "__custom__") {
      if (!customName.trim()) { setErr("Name required for custom item"); return; }
      name = customName.trim();
      weight = Number(customWeight) || 0;
      cuft = Number(customCuft) || 0;
    } else {
      setErr("Select an item or choose Custom");
      return;
    }

    setBusy(true);
    try {
      await apiFetch(`/api/estimates/${estimate.estimate_uuid}/items`, {
        method: "POST",
        body: JSON.stringify({ name, qty: Math.max(1, Math.floor(qty || 1)), weight_lbs: weight, cubic_ft: cuft }),
      });
      // Re-fetch estimate (router doesn't return the whole estimate here)
      const fresh = await apiFetch<Estimate>(`/api/estimates/${estimate.estimate_uuid}`);
      onChange(fresh);
      setSelectedName("");
      setQty(1);
      setCustomName("");
      setCustomWeight("");
      setCustomCuft("");
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(id: number) {
    try {
      await apiFetch(`/api/estimates/${estimate.estimate_uuid}/items/${id}`, { method: "DELETE" });
      const fresh = await apiFetch<Estimate>(`/api/estimates/${estimate.estimate_uuid}`);
      onChange(fresh);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Remove failed");
    }
  }

  return (
    <div className="card">
      <div className="sectionTitle">Inventory ({estimate.items.length})</div>

      {/* Add row */}
      <div className="col" style={{ gap: 8, marginBottom: 12 }}>
        <select value={selectedName} onChange={(e) => setSelectedName(e.target.value)}>
          <option value="">Select an item…</option>
          {FURNITURE_CATEGORIES.map((cat) => (
            <optgroup key={cat} label={cat}>
              {itemsByCategory.get(cat)!.map((it) => (
                <option key={it.name} value={it.name}>
                  {it.name} — {it.weight_lbs} lbs · {it.cubic_ft} cu ft
                </option>
              ))}
            </optgroup>
          ))}
          <option value="__custom__">Custom item…</option>
        </select>

        {selectedName === "__custom__" && (
          <div className="row wrap" style={{ gap: 8 }}>
            <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Item name" style={{ flex: "2 1 160px" }} />
            <input value={customWeight} onChange={(e) => setCustomWeight(e.target.value)} placeholder="Weight (lbs)" inputMode="decimal" style={{ flex: "1 1 100px" }} />
            <input value={customCuft} onChange={(e) => setCustomCuft(e.target.value)} placeholder="Cu ft" inputMode="decimal" style={{ flex: "1 1 80px" }} />
          </div>
        )}

        <div className="row" style={{ gap: 8 }}>
          <input
            type="number"
            min={1}
            step={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            style={{ width: 80 }}
          />
          <button type="button" onClick={addItem} disabled={busy} className="btnPrimary" style={{ flex: 1 }}>
            {busy ? "Adding…" : "Add to inventory"}
          </button>
        </div>
        {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}
      </div>

      {/* List */}
      {estimate.items.length === 0 ? (
        <div className="small" style={{ color: "var(--muted)" }}>No items yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <div
            className="row"
            style={{
              padding: "6px 0",
              borderBottom: "1px solid var(--border)",
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            <span style={{ flex: 1 }}>Item</span>
            <span style={{ width: 40, textAlign: "right" }}>Qty</span>
            <span style={{ width: 70, textAlign: "right" }}>lbs</span>
            <span style={{ width: 60, textAlign: "right" }}>cu ft</span>
            <span style={{ width: 26 }} />
          </div>
          {estimate.items.map((it) => (
            <div
              key={it.id}
              className="row"
              style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}
            >
              <span style={{ flex: 1 }}>{it.name}</span>
              <span style={{ width: 40, textAlign: "right", color: "var(--muted)" }}>×{it.qty}</span>
              <span style={{ width: 70, textAlign: "right" }}>{Math.round(it.weight_lbs * it.qty).toLocaleString()}</span>
              <span style={{ width: 60, textAlign: "right" }}>{(it.cubic_ft * it.qty).toFixed(1)}</span>
              <button
                type="button"
                onClick={() => removeItem(it.id)}
                style={{ width: 26, background: "none", border: "none", color: "var(--muted)", fontSize: 16, padding: 0, cursor: "pointer" }}
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          ))}
          <div className="row" style={{ padding: "10px 0", fontWeight: 700 }}>
            <span style={{ flex: 1 }}>Totals</span>
            <span style={{ width: 40 }} />
            <span style={{ width: 70, textAlign: "right" }}>
              {Math.round(estimate.estimated_weight_lbs).toLocaleString()}
            </span>
            <span style={{ width: 60, textAlign: "right" }}>
              {estimate.estimated_cubic_ft.toFixed(1)}
            </span>
            <span style={{ width: 26 }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

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

  async function refresh() {
    try {
      const data = await apiFetch<{ ok: boolean; photos: ServerPhoto[] }>(
        `/api/photos?job_uuid=${encodeURIComponent(estimateUuid)}`,
      );
      setPhotos(data?.photos ?? []);
    } catch {
      // offline — leave list
    }
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
