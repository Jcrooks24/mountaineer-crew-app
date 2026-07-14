import { useEffect, useMemo, useRef, useState } from "react";
import { useMergedCatalog } from "../lib/furnitureCatalogStore";
import {
  type BOLDraft,
  type BOLItem,
  enqueueSubmit,
  itemIsBox,
  loadForJob,
  newUUID,
  saveDraft,
  syncQueue,
} from "../lib/bolStore";
import BetaTag from "./BetaTag";
import SuggestInput from "./SuggestInput";

type Props = {
  jobUuid: string;
  jobName: string;
  jobDate: string;
};

/**
 * Inventory tab for LD+ load / unload days. Wraps the same bolStore that
 * the /long-distance BOL editor uses, so items compile into the trip's
 * digital BOL. Cross-device: on mount and on tab focus we reload from the
 * server (via loadForJob), and every add/edit is queued for upsert.
 */
export default function BolInventoryTab({ jobUuid, jobName, jobDate }: Props) {
  // Shared catalogue (server rows + built-in, cached offline) so this picker
  // matches Actual Inventory and the Estimator instead of the built-in list.
  const catalog = useMergedCatalog();
  const [draft, setDraft] = useState<BOLDraft | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "syncing">("loading");
  const [itemName, setItemName] = useState("");
  const [itemQty, setItemQty] = useState<number>(1);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Tracks whether the loaded draft came from the server (existing BOL) or
  // was freshly minted by newDraft(). Flipped to false once loadForJob
  // returns a server-backed draft.
  const isNewBolRef = useRef<boolean>(true);

  const totalPieces = useMemo(
    () => (draft ? draft.items.reduce((s, it) => s + it.qty, 0) : 0),
    [draft],
  );

  async function refresh() {
    if (!jobUuid) return;
    // Detect "does the server already have a BOL for this job" by peeking
    // at the raw remote row before loadForJob adapts it into a draft. That
    // gives us a reliable first-save flag for the "BOL linked" note.
    const { fetchRemoteBol } = await import("../lib/bolStore");
    const remote = await fetchRemoteBol(jobUuid);
    const d = await loadForJob({ job_uuid: jobUuid, job_name: jobName, job_date: jobDate });
    isNewBolRef.current = !remote;
    setDraft(d);
  }

  useEffect(() => {
    let live = true;
    setStatus("loading");
    (async () => {
      await refresh();
      if (live) setStatus("idle");
    })();
    // Refresh when the tab returns to the foreground so a second device's
    // adds show up without a manual reload.
    function onVis() { if (document.visibilityState === "visible") refresh(); }
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobUuid, jobName, jobDate]);

  // Persist every local change to the draft so a refresh doesn't lose in-
  // progress typing.
  useEffect(() => {
    if (draft) saveDraft(draft);
  }, [draft]);

  function nextItemNo(items: BOLItem[]): number {
    return items.reduce((m, it) => Math.max(m, it.item_no), 0) + 1;
  }

  function addItem() {
    if (!draft) return;
    const name = itemName.trim();
    const qty = Math.max(1, Math.floor(Number(itemQty) || 1));
    if (!name) { setErr("Enter an item name."); return; }
    setErr(null);
    const item: BOLItem = {
      item_no: nextItemNo(draft.items),
      id: newUUID(),
      name,
      qty,
      condition_notes: "",
      packed_by: "",
      photos: [],
    };
    setDraft({ ...draft, items: [...draft.items, item], updated_at: new Date().toISOString() });
    setItemName("");
    setItemQty(1);
  }

  function updateItem(item_no: number, patch: Partial<BOLItem>) {
    if (!draft) return;
    setDraft({
      ...draft,
      items: draft.items.map((it) => (it.item_no === item_no ? { ...it, ...patch } : it)),
      updated_at: new Date().toISOString(),
    });
  }

  function removeItem(item_no: number) {
    if (!draft) return;
    setDraft({
      ...draft,
      items: draft.items.filter((it) => it.item_no !== item_no),
      updated_at: new Date().toISOString(),
    });
  }

  function setVerified(v: boolean) {
    if (!draft) return;
    setDraft({
      ...draft,
      inventory_verified: v,
      inventory_note: v ? "" : (draft.inventory_note || ""),
      updated_at: new Date().toISOString(),
    });
  }

  function setIncompleteReason(text: string) {
    if (!draft) return;
    setDraft({ ...draft, inventory_note: text, updated_at: new Date().toISOString() });
  }

  async function save() {
    if (!draft) return;
    if (draft.inventory_verified !== true && !(draft.inventory_note || "").trim()) {
      setErr("Confirm the inventory is a complete record, or explain why not, before saving.");
      return;
    }
    setErr(null);
    setStatus("saving");

    // Saving auto-creates a BOL on the server if one doesn't already
    // exist for this job - the draft carries a fresh bol_id from
    // newDraft(), and the POST /api/bol upsert either creates the row
    // or updates the existing one. Either way the BOL is linked to
    // this job_uuid, so it appears attached on the Report tab.
    const wasFirstSave = isNewBolRef.current;
    enqueueSubmit(draft);
    try {
      const synced = await syncQueue();
      const baseMsg = synced > 0
        ? "Inventory saved and synced."
        : "Saved on this device - will sync when back online.";
      setNote(wasFirstSave ? `${baseMsg} BOL linked to this job.` : baseMsg);
      // After a successful first save the server now has the row, so
      // subsequent saves should not brag about creating it again.
      if (wasFirstSave && synced > 0) isNewBolRef.current = false;
    } finally {
      setStatus("idle");
      window.setTimeout(() => setNote(null), 5000);
    }
  }

  if (status === "loading" || !draft) {
    return (
      <div className="card">
        <div className="small" style={{ color: "var(--muted)" }}>Loading inventory…</div>
      </div>
    );
  }

  return (
    <>
      <div className="card" data-component="BolInventoryTab">
        <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div className="sectionTitle" style={{ marginBottom: 0 }}>BOL Inventory</div>
          <BetaTag feature="bolInventoryTab" style={{ marginTop: 0 }} />
        </div>
        <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
          Items you add here compile into the trip's Bill of Lading and sync
          across crew devices. Add items as they go on the truck.
        </div>
        <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5, marginTop: 6 }}>
          For anything that's a <strong>box</strong>, indicate <strong>CP</strong>
          {" "}(Company Packed - we packed the contents; carrier is responsible for
          loss / damage) or <strong>PBO</strong> (Packed By Owner - shipper packed
          the contents; carrier is not liable for the contents inside).
        </div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>
          Job: <strong style={{ color: "var(--text)" }}>{draft.job_name || jobName || "Untitled"}</strong>
          {draft.job_date ? `  ·  ${draft.job_date}` : ""}
        </div>
      </div>

      <div className="card">
        <div className="sectionTitle">Add Item</div>
        <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
          <label className="col" style={{ gap: 4, flex: "2 1 200px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Item</span>
            {/* A native <datalist> suppresses the mobile keyboard's autocorrect
                strip, which is why crew were logging misspelled items on the BOL.
                Rendered suggestions instead: autocorrect works, typeahead works. */}
            <SuggestInput
              value={itemName}
              onChange={setItemName}
              options={catalog.map((f) => f.name)}
              onEnter={addItem}
              placeholder="Sofa, dresser, CP box, PBO box…"
            />
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
        {err && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{err}</div>}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div className="sectionTitle" style={{ marginBottom: 0 }}>
            Inventory ({draft.items.length})
          </div>
          <span className="small" style={{ color: "var(--muted)" }}>
            {totalPieces} pc
          </span>
        </div>
        {draft.items.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>
            No items yet. Add items as they go on the truck.
          </div>
        ) : (
          <div className="col" style={{ gap: 10 }}>
            {[...draft.items].sort((a, b) => b.item_no - a.item_no).map((it) => (
              <div
                key={it.id}
                style={{
                  padding: 10,
                  border: "1px solid var(--border)",
                  borderRadius: "var(--btn-r)",
                  background: "rgba(255,255,255,0.05)",
                }}
              >
                <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div style={{ fontWeight: 700, color: "var(--text)" }}>
                    <span style={{ color: "var(--text)", opacity: 0.7, marginRight: 6 }}>#{it.item_no}</span>
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
                  <div className="row" style={{ gap: 6, alignItems: "center" }}>
                    <span className="small" style={{ color: "var(--muted)" }}>Qty</span>
                    <button
                      type="button"
                      onClick={() => updateItem(it.item_no, { qty: Math.max(1, it.qty - 1) })}
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={it.qty}
                      onChange={(e) => updateItem(it.item_no, { qty: Math.max(1, Math.floor(Number(e.target.value || 1))) })}
                      style={{ width: 56, textAlign: "center" }}
                    />
                    <button
                      type="button"
                      onClick={() => updateItem(it.item_no, { qty: it.qty + 1 })}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  {itemIsBox(it.name) && (
                    <div className="row" style={{ gap: 6, alignItems: "center" }}>
                      <span className="small" style={{ color: "var(--muted)" }}>Packed by</span>
                      <select
                        value={it.packed_by || ""}
                        onChange={(e) => updateItem(it.item_no, { packed_by: (e.target.value as "cp" | "pbo" | "") })}
                        style={{ fontSize: 13 }}
                      >
                        <option value="">Select…</option>
                        <option value="cp">Company Packed (CP)</option>
                        <option value="pbo">Packed By Owner (PBO)</option>
                      </select>
                    </div>
                  )}
                </div>
                <label className="col" style={{ gap: 4, marginTop: 8 }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Condition notes</span>
                  <input
                    value={it.condition_notes}
                    onChange={(e) => updateItem(it.item_no, { condition_notes: e.target.value })}
                    placeholder="e.g. scuff on left arm, chip on top corner"
                  />
                </label>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="sectionTitle">Verify inventory</div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 14 }}>
          <input
            type="checkbox"
            checked={draft.inventory_verified === true}
            onChange={(e) => setVerified(e.target.checked)}
            style={{ marginTop: 2, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }}
          />
          <span>
            This inventory is a <strong>complete record</strong> of everything on the truck for this trip.
          </span>
        </label>
        {draft.inventory_verified !== true && (
          <div className="col" style={{ gap: 4, marginTop: 10 }}>
            <span className="small" style={{ color: "var(--muted)" }}>
              If not complete, briefly explain why (required to save)
            </span>
            <textarea
              rows={2}
              value={draft.inventory_note || ""}
              onChange={(e) => setIncompleteReason(e.target.value)}
              placeholder="e.g. loading in progress; items pending from a second stop; etc."
            />
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12, gap: 8, alignItems: "center" }}>
          {note && <span className="small" style={{ color: "var(--ok)" }}>{note}</span>}
          <button className="btnPrimary" onClick={save} disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : "Save inventory"}
          </button>
        </div>
      </div>
    </>
  );
}
