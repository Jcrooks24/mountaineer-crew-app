import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { BetaTag } from "./BetaTag";
import { FURNITURE_CATALOG } from "../data/furnitureCatalog";
import {
  type BOLDraft,
  type BOLItem,
  captureItemPhoto,
  enqueueSubmit,
  loadDraft,
  newDraft,
  newUUID,
  pendingSubmitCount,
  readActiveJob,
  retryPendingPhotos,
  saveDraft,
  syncQueue,
} from "../lib/bolStore";

// Static carrier block — from the Mountaineer Moving Bill of Lading template.
// Autofilled onto every BOL (federal law requires it to appear; §375.505(b)(1)).
const CARRIER = {
  name: "Mountaineer Moving LLC",
  address: "3021 S 27th Ave. #B, Bozeman, MT 59718",
  phone: "(406) 201-9580",
  email: "management@mountaineermoving.com",
  dot: "4557708",
  mc: "1811084",
};

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const backBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 13,
};

export default function BillOfLadingForm({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const nav = useNavigate();

  // Crew rep — autofilled from the logged-in user. Informational: the server
  // records the authenticated user as created_by regardless of this value.
  const [crewRep, setCrewRep] = useState(user?.name || user?.email || "");

  // Load (or start) the BOL draft for the crew's currently-active job.
  const [draft, setDraft] = useState<BOLDraft>(() => {
    const job = readActiveJob();
    const existing = loadDraft(job.job_uuid);
    if (existing) return existing;
    const d = newDraft(job);
    if (!d.job_date) d.job_date = todayLocal();
    return d;
  });

  const hadActiveJob = useMemo(() => !!readActiveJob().job_uuid, []);

  // Add-item form state
  const [itemName, setItemName] = useState("");
  const [itemQty, setItemQty] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  // Session-only preview URLs for freshly-captured photos (photoId -> objectURL).
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [busyPhotoItem, setBusyPhotoItem] = useState<number | null>(null);

  // Autosave the draft on every change.
  useEffect(() => {
    saveDraft(draft);
  }, [draft]);

  // On mount + whenever we come back online: finish any offline photo uploads
  // and drain the submit queue so queued BOLs and photo links reach the server.
  useEffect(() => {
    let cancelled = false;
    async function flush() {
      const updated = await retryPendingPhotos(draft);
      if (!cancelled && updated !== draft) setDraft(updated);
      await syncQueue();
    }
    flush();
    const onOnline = () => { flush(); };
    window.addEventListener("online", onOnline);
    return () => { cancelled = true; window.removeEventListener("online", onOnline); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patchDraft(patch: Partial<BOLDraft>) {
    setDraft((prev) => ({ ...prev, ...patch, updated_at: new Date().toISOString() }));
  }

  function updateItem(itemNo: number, patch: Partial<BOLItem>) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.item_no === itemNo ? { ...it, ...patch } : it)),
      updated_at: new Date().toISOString(),
    }));
  }

  function addItem() {
    setErr(null);
    const name = itemName.trim();
    if (!name) return setErr("Enter an item name.");
    const qty = Math.max(1, Math.floor(itemQty || 1));
    const nextNo = draft.items.reduce((m, it) => Math.max(m, it.item_no), 0) + 1;
    const item: BOLItem = { item_no: nextNo, id: newUUID(), name, qty, condition_notes: "", photos: [] };
    setDraft((prev) => ({ ...prev, items: [...prev.items, item], updated_at: new Date().toISOString() }));
    setItemName("");
    setItemQty(1);
  }

  function adjustQty(itemNo: number, delta: number) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it.item_no === itemNo ? { ...it, qty: Math.max(1, it.qty + delta) } : it,
      ),
      updated_at: new Date().toISOString(),
    }));
  }

  function removeItem(itemNo: number) {
    // Item numbers stay stable (no renumber) so a number never shifts under the
    // crew or diverges from an already-saved copy — a gap is acceptable.
    setDraft((prev) => ({
      ...prev,
      items: prev.items.filter((it) => it.item_no !== itemNo),
      updated_at: new Date().toISOString(),
    }));
  }

  async function onPickPhoto(itemNo: number, file: File | undefined) {
    if (!file) return;
    setErr(null);
    setBusyPhotoItem(itemNo);
    try {
      const { photo, previewUrl } = await captureItemPhoto(draft, itemNo, file);
      setPreviews((prev) => ({ ...prev, [photo.photo_id]: previewUrl }));
      setDraft((prev) => ({
        ...prev,
        items: prev.items.map((it) =>
          it.item_no === itemNo ? { ...it, photos: [...it.photos, photo] } : it,
        ),
        updated_at: new Date().toISOString(),
      }));
    } catch {
      setErr("Could not attach photo. Try again.");
    } finally {
      setBusyPhotoItem(null);
    }
  }

  async function save() {
    setErr(null);
    if (draft.items.length === 0) return setErr("Add at least one item before saving.");
    const snapshot: BOLDraft = { ...draft, updated_at: new Date().toISOString() };
    saveDraft(snapshot);
    setDraft(snapshot);
    enqueueSubmit(snapshot);
    const synced = await syncQueue();
    const queued = pendingSubmitCount();
    setSavedNote(
      synced > 0 && queued === 0
        ? "Saved and synced."
        : "Saved on this device — will sync when back online.",
    );
    window.setTimeout(() => setSavedNote(null), 4000);
  }

  const totalPieces = draft.items.reduce((s, it) => s + it.qty, 0);

  return (
    <div className="container">
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Bill of Lading</div>
          <BetaTag feature="digitalBOL" />
          <div className="small" style={{ color: "var(--muted)" }}>Declared inventory — interstate move</div>
        </div>
        <button onClick={onBack} style={backBtnStyle}>← Menu</button>
      </div>

      {/* Job + crew rep (autofilled from the active job) */}
      <div className="card">
        <div className="sectionTitle">Job</div>
        {!hadActiveJob && (
          <div className="small" style={{ color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
            No active job detected — select a job on the Timeline first for autofill, or enter it below.
          </div>
        )}
        <div className="col" style={{ gap: 10 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <label className="col" style={{ gap: 4, flex: "2 1 220px" }}>
              <span className="small" style={{ color: "var(--muted)" }}>Job name *</span>
              <input value={draft.job_name} onChange={(e) => patchDraft({ job_name: e.target.value })} placeholder="Customer / job name" />
            </label>
            <label className="col" style={{ gap: 4, flex: "1 1 140px" }}>
              <span className="small" style={{ color: "var(--muted)" }}>Date</span>
              <input type="date" value={draft.job_date} onChange={(e) => patchDraft({ job_date: e.target.value })} />
            </label>
          </div>
          <label className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Crew rep</span>
            <input value={crewRep} onChange={(e) => setCrewRep(e.target.value)} placeholder="Your name" />
          </label>
        </div>
      </div>

      {/* Static carrier block */}
      <div className="card">
        <div className="sectionTitle">Carrier</div>
        <div className="small" style={{ color: "var(--text)", lineHeight: 1.6 }}>
          <strong>{CARRIER.name}</strong><br />
          {CARRIER.address}<br />
          {CARRIER.phone} · {CARRIER.email}<br />
          <span style={{ color: "var(--muted)" }}>U.S. DOT {CARRIER.dot} · MC {CARRIER.mc}</span>
        </div>
      </div>

      {/* Add item */}
      <div className="card">
        <div className="sectionTitle">Add Item</div>
        <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
          <label className="col" style={{ gap: 4, flex: "2 1 200px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Item</span>
            <input
              list="bol-furniture"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
              placeholder="Sofa, dresser, box…"
            />
            <datalist id="bol-furniture">
              {FURNITURE_CATALOG.map((f) => (
                <option key={f.name} value={f.name} />
              ))}
            </datalist>
          </label>
          <label className="col" style={{ gap: 4, width: 90 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Qty</span>
            <input
              type="number"
              min={1}
              step={1}
              value={itemQty}
              onChange={(e) => setItemQty(Math.max(1, Math.floor(Number(e.target.value || 1))))}
            />
          </label>
          <button type="button" className="btnPrimary" onClick={addItem} style={{ minWidth: 90 }}>
            Add
          </button>
        </div>
        {err && (
          <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{err}</div>
        )}
      </div>

      {/* Inventory */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div className="sectionTitle" style={{ marginBottom: 0 }}>Inventory</div>
          <span className="small" style={{ color: "var(--muted)" }}>
            {draft.items.length} item{draft.items.length === 1 ? "" : "s"} · {totalPieces} pc
          </span>
        </div>

        {draft.items.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>No items yet. Add items as they go on the truck.</div>
        ) : (
          <div className="col" style={{ gap: 10 }}>
            {draft.items.map((it) => (
              <div
                key={it.id}
                style={{ padding: 10, border: "1px solid var(--border)", borderRadius: "var(--btn-r)", background: "rgba(255,255,255,0.02)" }}
              >
                <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>
                    <span style={{ color: "var(--muted)", marginRight: 6 }}>#{it.item_no}</span>
                    {it.name}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(it.item_no)}
                    style={{ fontSize: 12, padding: "4px 10px", color: "var(--danger)", borderColor: "var(--danger)" }}
                  >
                    Remove
                  </button>
                </div>

                <div className="row wrap" style={{ gap: 10, alignItems: "center", marginTop: 8 }}>
                  {/* Inline qty adjust */}
                  <div className="row" style={{ gap: 6, alignItems: "center" }}>
                    <span className="small" style={{ color: "var(--muted)" }}>Qty</span>
                    <button type="button" onClick={() => adjustQty(it.item_no, -1)} style={qtyBtnStyle} aria-label="Decrease quantity">−</button>
                    <input
                      type="number"
                      min={1}
                      value={it.qty}
                      onChange={(e) => updateItem(it.item_no, { qty: Math.max(1, Math.floor(Number(e.target.value || 1))) })}
                      style={{ width: 56, textAlign: "center" }}
                    />
                    <button type="button" onClick={() => adjustQty(it.item_no, 1)} style={qtyBtnStyle} aria-label="Increase quantity">+</button>
                  </div>

                  {/* Photo add */}
                  <PhotoButton
                    busy={busyPhotoItem === it.item_no}
                    onPick={(file) => onPickPhoto(it.item_no, file)}
                  />
                </div>

                {/* Condition notes */}
                <label className="col" style={{ gap: 4, marginTop: 8 }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Condition notes</span>
                  <input
                    value={it.condition_notes}
                    onChange={(e) => updateItem(it.item_no, { condition_notes: e.target.value })}
                    placeholder="e.g. scuff on left arm, chip on top corner"
                  />
                </label>

                {/* Photo thumbnails */}
                {it.photos.length > 0 && (
                  <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                    {it.photos.map((p) => {
                      const src = p.thumb_url || p.drive_url || previews[p.photo_id];
                      return src && !p.pending ? (
                        <a key={p.photo_id} href={p.drive_url || src} target="_blank" rel="noreferrer">
                          <img src={src} alt="" style={thumbStyle} />
                        </a>
                      ) : previews[p.photo_id] ? (
                        <div key={p.photo_id} style={{ position: "relative" }}>
                          <img src={previews[p.photo_id]} alt="" style={{ ...thumbStyle, opacity: 0.6 }} />
                          <span style={uploadingBadge}>uploading…</span>
                        </div>
                      ) : (
                        <div key={p.photo_id} style={{ ...thumbStyle, display: "grid", placeItems: "center", fontSize: 10, color: "var(--muted)", textAlign: "center", padding: 4 }}>
                          saved · will upload
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save */}
      <div className="card">
        <div className="small" style={{ color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Signing and the printable PDF are coming in the next update. For now, save the inventory — it syncs to the office sheet and works offline.
        </div>
        {savedNote && (
          <div className="small" style={{ color: "var(--ok)", marginBottom: 10 }}>{savedNote}</div>
        )}
        <div className="row wrap" style={{ justifyContent: "flex-end", gap: 10 }}>
          <button onClick={() => nav("/")}>Back to Jobs</button>
          <button className="btnPrimary" onClick={save}>Save Inventory</button>
        </div>
      </div>
    </div>
  );
}

function PhotoButton({ busy, onPick }: { busy: boolean; onPick: (file: File | undefined) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        style={{ fontSize: 13, padding: "6px 12px" }}
      >
        {busy ? "Adding…" : "📷 Add photo"}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          if (ref.current) ref.current.value = "";
        }}
      />
    </>
  );
}

const qtyBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  fontSize: 18,
  lineHeight: 1,
  fontWeight: 700,
};

const thumbStyle: React.CSSProperties = {
  width: 64,
  height: 64,
  objectFit: "cover",
  borderRadius: 8,
  border: "1px solid var(--border)",
  display: "block",
};

const uploadingBadge: React.CSSProperties = {
  position: "absolute",
  bottom: 2,
  left: 2,
  right: 2,
  fontSize: 9,
  textAlign: "center",
  background: "rgba(0,0,0,0.55)",
  color: "#fff",
  borderRadius: 4,
  padding: "1px 0",
};
