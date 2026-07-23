import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../api/client";
import { BetaTag } from "./BetaTag";
import SignaturePad, { type SignaturePadHandle } from "./SignaturePad";
import { useMergedCatalog } from "../lib/furnitureCatalogStore";
import {
  applySignature,
  type BOLDraft,
  type BOLItem,
  type CalEvent,
  type OpenBol,
  type SignInput,
  autosyncDraft,
  captureItemPhoto,
  emailBolToClient,
  enqueueBolResync,
  enqueueSubmit,
  fetchCalendarDay,
  itemIsBox,
  listOpenBols,
  loadDraft,
  loadForJob,
  manualJobToJobUuid,
  newDraft,
  newUUID,
  pendingSubmitCount,
  failedBolOps,
  retryFailedBol,
  discardFailedBol,
  rememberJob,
  resolveJobUuid,
  retryPendingPhotos,
  saveDraft,
  syncQueue,
  BolStorageFullError,
} from "../lib/bolStore";
import {
  BOL_CONTRACT_SECTIONS,
  FORM_OF_PAYMENT_OPTIONS,
  ESTIMATE_TYPE_OPTIONS,
  VALUATION_OPTIONS,
} from "../lib/bolContract";
import SuggestInput from "./SuggestInput";

/** Hand the shipper their dated copy: Web Share (with file) if available,
 * otherwise a download. Works offline. */
async function deliverPdfToClient(blob: Blob, filename: string): Promise<void> {
  try {
    const file = new File([blob], filename, { type: "application/pdf" });
    const navAny = navigator as any;
    if (navAny.canShare && navAny.canShare({ files: [file] }) && navAny.share) {
      await navAny.share({ files: [file], title: filename });
      return;
    }
  } catch {
    /* share cancelled / unsupported - fall through to download */
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Static carrier block - from the Mountaineer Moving Bill of Lading template.
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

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  origin_signed: "Origin signed",
  delivered: "Delivered",
};

// ─────────────────────────────────────────────────────────────────────────
// Hub - choose an open BOL to continue, or start a new one (job selector).
// ─────────────────────────────────────────────────────────────────────────
export default function BillOfLadingForm({ onBack, openBolId }: { onBack: () => void; openBolId?: string }) {
  const [editing, setEditing] = useState<BOLDraft | null>(null);
  const [openBols, setOpenBols] = useState<OpenBol[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [busy, setBusy] = useState(false);
  // Guard so an auto-open only fires once per mount (a re-render triggered
  // by state updates inside openExisting must not re-open the BOL).
  const autoOpenedRef = useRef<boolean>(false);

  // New-job selector (mirrors the Timeline tab).
  const [selDate, setSelDate] = useState(todayLocal());
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [calLoaded, setCalLoaded] = useState(false);
  const [calErr, setCalErr] = useState("");
  const [selValue, setSelValue] = useState("");
  const [manualName, setManualName] = useState("");

  // Refresh the open-BOL list on mount and whenever we return from the editor.
  // If the caller asked for a specific bol_id (deep link from Report tab),
  // auto-open it once the list has that BOL.
  useEffect(() => {
    if (editing) return;
    let cancelled = false;
    (async () => {
      setLoadingList(true);
      const list = await listOpenBols();
      if (cancelled) return;
      setOpenBols(list);
      setLoadingList(false);
      if (openBolId && !autoOpenedRef.current) {
        const match = list.find((b) => b.bol_id === openBolId);
        if (match) {
          autoOpenedRef.current = true;
          await openExisting(match);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, openBolId]);

  // Load the day's calendar jobs when the date changes (and on mount).
  useEffect(() => {
    if (editing) return;
    let cancelled = false;
    (async () => {
      setCalErr(""); setCalLoading(true); setCalLoaded(false); setCalEvents([]); setSelValue("");
      try {
        const evs = await fetchCalendarDay(selDate);
        if (!cancelled) setCalEvents(evs);
      } catch (e: any) {
        if (!cancelled) setCalErr(e?.message || "Could not load calendar");
      } finally {
        if (!cancelled) { setCalLoading(false); setCalLoaded(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [selDate, editing]);

  async function openExisting(o: OpenBol) {
    setBusy(true);
    try {
      const job = { job_uuid: o.job_uuid, job_name: o.job_name, job_date: o.job_date };
      const draft = o.job_uuid ? await loadForJob(job) : loadDraft(o.job_uuid) || newDraft(job);
      setEditing(draft);
    } finally {
      setBusy(false);
    }
  }

  async function onSelectEvent(value: string) {
    setSelValue(value);
    if (!value || value === "__other__") return;
    const ev = calEvents.find((e) => e.id === value);
    if (!ev) return;
    setBusy(true);
    try {
      const job_uuid = await resolveJobUuid(value);
      const job = { job_uuid, job_name: ev.summary, job_date: selDate };
      rememberJob(job);
      const draft = await loadForJob(job); // continue existing, or start fresh
      setEditing(draft);
    } finally {
      setBusy(false);
    }
  }

  function startManual() {
    const name = manualName.trim();
    if (!name) return;
    // Derive job_uuid from the name+date the same way the Timeline and PODS do,
    // NOT a per-device random id. Two crew typing the same manual job must land on
    // the same job_uuid, or the derived bol_id can't converge and each device gets
    // its own BOL for the one job (defeats ADR 0018 on the manual path).
    const job = { job_uuid: manualJobToJobUuid(name, selDate), job_name: name, job_date: selDate };
    rememberJob(job);
    const draft = newDraft(job);
    saveDraft(draft);
    setEditing(draft);
  }

  if (editing) {
    return <BolEditor initialDraft={editing} onBack={() => { setManualName(""); setEditing(null); }} />;
  }

  return (
    <div className="container">
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Bill of Lading</div>
          <BetaTag feature="digitalBOL" />
          <div className="small" style={{ color: "var(--muted)" }}>Long-distance declared inventory + signing</div>
        </div>
        <button onClick={onBack} style={backBtnStyle}>← Menu</button>
      </div>

      {/* Continue an open BOL */}
      <div className="card">
        <div className="sectionTitle">Continue an open BOL</div>
        {loadingList ? (
          <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
        ) : openBols.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>No open BOLs. Start a new one below.</div>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {openBols.map((o) => (
              <button
                key={o.bol_id}
                onClick={() => openExisting(o)}
                disabled={busy}
                style={{ textAlign: "left" }}
              >
                <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700 }}>{o.job_name || "Untitled job"}</span>
                  <span
                    className="small"
                    style={{
                      color: o.status === "origin_signed" ? "var(--brand)" : "var(--muted)",
                      border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px", fontSize: 11,
                    }}
                  >
                    {STATUS_LABEL[o.status] || o.status}
                  </span>
                </div>
                <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                  {o.job_date || "no date"}
                  {o.source === "local" ? "  ·  not synced" : ""}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Start a new BOL */}
      <div className="card">
        <div className="sectionTitle">Start a new BOL</div>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Date</span>
            <input type="date" value={selDate} onChange={(e) => setSelDate(e.target.value)} />
          </label>

          <label className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>
              Select job{" "}
              <span className="small" style={{ marginLeft: 6 }}>
                {calLoading ? "(loading…)" : calEvents.length > 0 ? `(${calEvents.length} found)` : calLoaded ? "(none found)" : ""}
              </span>
            </span>
            <select value={selValue} onChange={(e) => onSelectEvent(e.target.value)} disabled={calLoading || busy}>
              <option value="">Select a job…</option>
              {calEvents.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.summary}</option>
              ))}
              <option value="__other__">Other (enter manually)</option>
            </select>
          </label>

          {calErr && <div className="small" style={{ color: "var(--danger)" }}>{calErr}</div>}

          {selValue === "__other__" && (
            <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
              <label className="col" style={{ gap: 4, flex: "1 1 200px" }}>
                <span className="small" style={{ color: "var(--muted)" }}>Job name</span>
                <input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); startManual(); } }}
                  placeholder="Customer / job name"
                />
              </label>
              <button className="btnPrimary" onClick={startManual} disabled={!manualName.trim()}>
                Start
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BolEditor({ initialDraft, onBack }: { initialDraft: BOLDraft; onBack: () => void }) {
  const { user } = useAuth();
  const nav = useNavigate();

  // Crew rep - carries over from the BOL if set, otherwise the logged-in user.
  const [crewRep, setCrewRep] = useState(initialDraft.crew_rep || user?.name || user?.email || "");
  const [draft, setDraft] = useState<BOLDraft>(initialDraft);
  // Always-current draft for the reconnect handler below, which has an empty dep
  // array. Without this it would close over the MOUNT-TIME draft and, on
  // reconnect, rebuild + persist from that stale item list - dropping any item
  // the crew added after mount (state, localStorage, AND the queue). See vet H1.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Shared catalogue (server rows + built-in, cached offline) so the BOL item
  // picker matches Actual Inventory and the Estimator.
  const catalog = useMergedCatalog();

  // Add-item form state
  const [itemName, setItemName] = useState("");
  const [itemQty, setItemQty] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  // Failed queue ops for THIS BOL. A permanent 4xx (e.g. a submit the server
  // refuses) is kept, not deleted (ADR 0013), and blocks this BOL's sign/pdf
  // behind it - so without a retry surface a signed-on-device BOL could get
  // stuck with its signature never reaching the server. This banner is that
  // surface. Refreshed after every drain.
  const [failedOps, setFailedOps] = useState(() =>
    failedBolOps().filter((o) => o.bol_id === initialDraft.bol_id),
  );
  const refreshFailed = () =>
    setFailedOps(failedBolOps().filter((o) => o.bol_id === draft.bol_id));

  // Session-only preview URLs for freshly-captured photos (photoId -> objectURL).
  const [previews, setPreviews] = useState<Record<string, string>>({});
  // Revoke the preview object URLs on unmount so they don't leak for the session.
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  useEffect(() => {
    return () => { Object.values(previewsRef.current).forEach((u) => URL.revokeObjectURL(u)); };
  }, []);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [busyPhotoItem, setBusyPhotoItem] = useState<number | null>(null);

  // Signing state
  const shipperSigRef = useRef<SignaturePadHandle>(null);
  const carrierSigRef = useRef<SignaturePadHandle>(null);
  const [pickupDate, setPickupDate] = useState(draft.actual_pickup_date || todayLocal());
  const [vehicle, setVehicle] = useState(draft.vehicle || "");
  // Vehicle units list - same source as DVIR + RODS so the BOL vehicle
  // field shows the fleet's canonical units in a dropdown instead of a
  // free-text input. Preserves any pre-existing custom entry.
  const [units, setUnits] = useState<string[]>([]);
  useEffect(() => {
    apiFetch<{ units: string[] }>("/api/dvir/units")
      .then((r) => setUnits(Array.isArray(r?.units) ? r.units : []))
      .catch(() => { /* offline is fine - the input still accepts a saved custom value */ });
  }, []);
  const [walkNotes, setWalkNotes] = useState(draft.walkthrough_notes || "");
  const [finalCharges, setFinalCharges] = useState(draft.final_charges != null ? String(draft.final_charges) : "");
  const [shipperName, setShipperName] = useState("");
  const [consent, setConsent] = useState(false);
  const [signBusy, setSignBusy] = useState(false);
  const [signErr, setSignErr] = useState<string | null>(null);

  // Origin (pickup) + destination (delivery) addresses live on the draft so the
  // same values feed the origin-signing form, the retrieval card, and the PDF.
  function setAddress(patch: { origin_address?: string; dest_address?: string }) {
    setDraft((prev) => ({ ...prev, ...patch, updated_at: new Date().toISOString() }));
  }

  // Generic setter for the FMCSA BOL detail fields (shipper, payment, valuation,
  // dates, declarations). All ride the draft -> shipment_json (ADR 0023).
  function setField(patch: Partial<BOLDraft>) {
    setDraft((prev) => ({ ...prev, ...patch, updated_at: new Date().toISOString() }));
  }

  // Prefill the shipment / job reference from the job once, so the crew is not
  // retyping what the app already knows (still editable).
  useEffect(() => {
    if (draft.status === "draft" && !draft.shipment_number && (draft.job_name || draft.job_date)) {
      setField({ shipment_number: [draft.job_name, draft.job_date].filter(Boolean).join(" - ") });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signed-BOL retrieval + send-to-client card state (shown once signed).
  const [clientEmail, setClientEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNote, setEmailNote] = useState<string | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [viewBusy, setViewBusy] = useState(false);
  const [addrNote, setAddrNote] = useState<string | null>(null);
  const [addrErr, setAddrErr] = useState<string | null>(null);

  // Inventory list controls
  const [invSearch, setInvSearch] = useState("");
  const [invExpanded, setInvExpanded] = useState(false);

  // Contract-clauses toggle - preview text is always visible; full 16 CFR
  // §375.505 text expands on click.
  const [showContract, setShowContract] = useState(false);

  // Autosave the draft on every change.
  useEffect(() => {
    saveDraft(draft);
  }, [draft]);

  // Push item + verification changes to the SERVER (debounced) so a second device
  // sees them without waiting for a gated Save. Skips the first run so adopting
  // the server copy on open does not echo straight back. Signatures are not
  // autosynced - they go through the explicit sign flow. Deps are the item array
  // reference (changes only on an item edit) and the two inventory scalars.
  const didFirstAutosync = useRef(false);
  useEffect(() => {
    if (!didFirstAutosync.current) { didFirstAutosync.current = true; return; }
    autosyncDraft(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.items, draft.inventory_verified, draft.inventory_note]);

  // On mount + reconnect: finish any offline photo uploads and drain the queue
  // so queued BOLs, signatures, and PDFs reach the server. (The server copy was
  // already adopted by the hub before this editor opened.)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const after = await retryPendingPhotos(draft);
      if (!cancelled && after !== draft) setDraft(after);
      await syncQueue();
      if (!cancelled) refreshFailed();
    })();
    const onOnline = () => {
      syncQueue().then(() => { if (!cancelled) refreshFailed(); });
      // Read the LATEST draft via the ref, not the stale mount-time closure, so a
      // reconnect never rebuilds from an outdated item list (vet H1).
      const cur = draftRef.current;
      retryPendingPhotos(cur).then((u) => { if (!cancelled && u !== cur) setDraft(u); });
    };
    window.addEventListener("online", onOnline);
    return () => { cancelled = true; window.removeEventListener("online", onOnline); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const item: BOLItem = { item_no: nextNo, id: newUUID(), name, qty, condition_notes: "", photos: [], packed_by: "" };
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
    // crew or diverges from an already-saved copy - a gap is acceptable.
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
    // Surface a storage-full failure instead of a false "Saved" (bug 5): if the
    // draft or the queued submit can't be persisted, nothing was saved.
    if (!saveDraft(snapshot) || !enqueueSubmit(snapshot)) {
      return setErr("This device's storage is full, so the BOL could not be saved. Free up space and try again.");
    }
    setDraft(snapshot);
    const synced = await syncQueue();
    refreshFailed(); // surface a rejected op now, not on the next remount (bug 6)
    const queued = pendingSubmitCount();
    setSavedNote(
      synced > 0 && queued === 0
        ? "Saved and synced."
        : "Saved on this device - will sync when back online.",
    );
    window.setTimeout(() => setSavedNote(null), 4000);
  }

  function pdfFilename(d: BOLDraft): string {
    const date = (d.job_date || todayLocal()).slice(0, 10);
    const name = (d.job_name || "Bill of Lading").replace(/[\\/:*?"<>|]/g, "-").trim();
    return `${date} - ${name}.pdf`;
  }

  // Regenerate the signed BOL on-device and hand it over (Web Share / download).
  // Works offline - the signatures and addresses are all in the local draft - so
  // the driver can produce the signed BOL at a border crossing with no signal.
  async function viewSignedBol() {
    setEmailErr(null);
    setViewBusy(true);
    try {
      const { generateBolPdf } = await import("../lib/bolPdf");
      const blob = await generateBolPdf(draft);
      await deliverPdfToClient(blob, pdfFilename(draft));
    } catch {
      setEmailErr("Could not open the BOL. Try again.");
    } finally {
      setViewBusy(false);
    }
  }

  // Persist corrected addresses to the server + regenerate the stored Drive PDF.
  // For an already-signed BOL this is how the DOT-required addresses get onto the
  // official copy after the fact (they are also live on the on-device PDF at once).
  async function saveAddresses() {
    setAddrErr(null);
    setAddrNote(null);
    if (!enqueueBolResync(draft)) {
      setAddrErr("This device's storage is full, so the change could not be saved. Free up space and try again.");
      return;
    }
    const synced = await syncQueue();
    refreshFailed();
    setAddrNote(
      synced > 0
        ? "Addresses saved and synced."
        : "Addresses saved on this device - will sync when back online.",
    );
    window.setTimeout(() => setAddrNote(null), 4000);
  }

  // Email the signed BOL PDF to the client. Requires connectivity; drains any
  // queued sign op first so the server row exists before we ask it to email.
  async function sendToClient() {
    setEmailErr(null);
    setEmailNote(null);
    const email = clientEmail.trim();
    if (!email) return setEmailErr("Enter the client's email address.");
    setEmailBusy(true);
    try {
      await syncQueue(); // make sure the signed row is on the server first
      const { generateBolPdf } = await import("../lib/bolPdf");
      const blob = await generateBolPdf(draft);
      await emailBolToClient(draft.bol_id, blob, email);
      setEmailNote(`Signed BOL sent to ${email}.`);
      setClientEmail("");
      window.setTimeout(() => setEmailNote(null), 6000);
    } catch (e: any) {
      setEmailErr(e?.message || "Could not send the email. Check the address and your connection, then try again.");
    } finally {
      setEmailBusy(false);
    }
  }

  async function signSession(phase: "origin" | "destination") {
    setSignErr(null);
    if (draft.items.length === 0) return setSignErr("Add at least one item before signing.");
    if (!shipperName.trim()) return setSignErr("Enter the client's printed name.");
    if (shipperSigRef.current?.isEmpty()) return setSignErr("Shipper signature is required.");
    if (carrierSigRef.current?.isEmpty()) return setSignErr("Carrier representative signature is required.");
    if (!consent) return setSignErr("Both parties must accept the electronic signature consent.");
    if (phase === "origin") {
      // FMCSA 375.505 required fields - block origin signing until each is filled
      // so no BOL leaves origin incomplete (ADR 0023). Entered in the detail cards.
      const need = (v: string | undefined) => !(v || "").trim();
      if (need(draft.shipper_name)) return setSignErr("Enter the shipper (customer) name in Shipper & shipment.");
      if (need(draft.shipper_phone)) return setSignErr("Enter the shipper phone (or N/A) in Shipper & shipment.");
      if (need(draft.origin_address)) return setSignErr("Enter the origin (pickup) address in Shipper & shipment.");
      if (need(draft.dest_address)) return setSignErr("Enter the destination (delivery) address in Shipper & shipment.");
      if (need(draft.shipper_address)) return setSignErr("Enter the shipper address in Shipper & shipment.");
      if (need(draft.shipment_number)) return setSignErr("Enter the shipment / job reference in Shipper & shipment.");
      if (need(draft.form_of_payment)) return setSignErr("Select the form of payment in Payment & estimate.");
      if (draft.form_of_payment === "cod" && need(draft.cod_notify)) return setSignErr("Enter who to notify for COD in Payment & estimate.");
      if (need(draft.estimate_type)) return setSignErr("Select the estimate type in Payment & estimate.");
      if (need(draft.valuation)) return setSignErr("Have the shipper choose a valuation option in Valuation.");
      if (need(draft.agreed_pickup)) return setSignErr("Enter the agreed pickup date in Agreed dates.");
      if (need(draft.agreed_delivery)) return setSignErr("Enter the agreed delivery date in Agreed dates.");
    }
    if (phase === "destination") {
      if (finalCharges.trim() && !Number.isFinite(Number(finalCharges))) return setSignErr("Final charges must be a number.");
    }

    setSignBusy(true);
    try {
      const input: SignInput = {
        phase,
        shipper_sig: shipperSigRef.current!.toDataURL(),
        carrier_sig: carrierSigRef.current!.toDataURL(),
        shipper_name: shipperName.trim() || undefined,
        signed_at: new Date().toISOString(),
        ...(phase === "origin"
          ? {
              actual_pickup_date: pickupDate || undefined,
              vehicle: vehicle.trim() || undefined,
              origin_address: (draft.origin_address || "").trim() || undefined,
              dest_address: (draft.dest_address || "").trim() || undefined,
            }
          : { walkthrough_notes: walkNotes.trim() || undefined, final_charges: finalCharges.trim() ? Number(finalCharges) : null }),
      };
      // Persist signatures + status, queue the sign PATCH + PDF upload.
      const updated = applySignature({ ...draft, crew_rep: crewRep }, input);
      setDraft(updated);

      // Generate the PDF on-device and hand the client a dated copy (works offline).
      const { generateBolPdf } = await import("../lib/bolPdf");
      const blob = await generateBolPdf(updated);
      await deliverPdfToClient(blob, pdfFilename(updated));

      // Reset pads + printed name + consent for any subsequent session.
      shipperSigRef.current?.clear();
      carrierSigRef.current?.clear();
      setShipperName("");
      setConsent(false);

      // Push to the server (or leave queued if offline).
      const synced = await syncQueue();
      refreshFailed(); // surface a rejected sign/pdf op now, not on remount (bug 6)
      setSavedNote(
        synced > 0 && pendingSubmitCount() === 0
          ? `${phase === "origin" ? "Origin" : "Delivery"} signing complete - copy delivered and synced.`
          : `${phase === "origin" ? "Origin" : "Delivery"} signing saved - copy delivered; will sync when back online.`,
      );
      window.setTimeout(() => setSavedNote(null), 5000);
    } catch (e) {
      // A storage-full error means the signature was NOT saved - do not tell the
      // crew "your data is saved" (bug 5). Every other failure happens after the
      // draft + queue ops are persisted, so retry is safe there.
      setSignErr(
        e instanceof BolStorageFullError
          ? e.message
          : "Could not complete signing. Your data is saved - try again.",
      );
    } finally {
      setSignBusy(false);
    }
  }

  const totalPieces = draft.items.reduce((s, it) => s + it.qty, 0);

  // Inventory display: newest item nearest the Add tile (highest item_no first),
  // filtered by the search box, and clipped to the 5 most recent unless expanded
  // or actively searching.
  const orderedItems = [...draft.items].sort((a, b) => b.item_no - a.item_no);
  const invQuery = invSearch.trim().toLowerCase();
  const filteredItems = invQuery
    ? orderedItems.filter((it) => it.name.toLowerCase().includes(invQuery) || it.condition_notes.toLowerCase().includes(invQuery))
    : orderedItems;
  const CLIP = 5;
  const showAll = invExpanded || invQuery.length > 0;
  const visibleItems = showAll ? filteredItems : filteredItems.slice(0, CLIP);
  const hiddenCount = filteredItems.length - visibleItems.length;

  return (
    <div className="container">
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Bill of Lading</div>
          <BetaTag feature="digitalBOL" />
          <div className="small" style={{ color: "var(--muted)" }}>Declared inventory - interstate move</div>
        </div>
        <button onClick={onBack} style={backBtnStyle}>← BOLs</button>
      </div>

      {/* Failed-sync banner: this BOL was refused by the server and is stuck on
          this phone (ADR 0013 keeps it rather than deleting it). Retry re-drains
          the whole submit->sign->pdf sequence; Discard is confirm-gated because
          it can drop a captured signature. */}
      {failedOps.length > 0 && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          <div style={{ fontWeight: 800, color: "var(--danger)" }}>This BOL could not be sent</div>
          <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
            {failedOps[0].failed_reason || "The server rejected it."}
          </div>
          <div className="small" style={{ marginTop: 4 }}>
            It is still saved on this phone. Nothing has been lost.
            {draft.status !== "draft" ? " The signature is safe and will send once this clears." : ""}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button
              className="btnPrimary"
              style={{ padding: "8px 14px", fontSize: 13, minHeight: 40 }}
              onClick={async () => {
                setErr(null);
                await retryFailedBol(draft.bol_id);
                refreshFailed();
              }}
            >
              Retry
            </button>
            <button
              style={{ padding: "8px 14px", fontSize: 13, minHeight: 40, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)" }}
              onClick={() => {
                const ok = window.confirm(
                  "Discard this BOL's unsent changes?\n\nIt was never received by the office. If it was signed, that signature will be lost.",
                );
                if (!ok) return;
                discardFailedBol(draft.bol_id);
                refreshFailed();
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Job (selected in the chooser) + crew rep */}
      <div className="card">
        <div className="sectionTitle">Job</div>
        <div style={{ fontWeight: 700 }}>{draft.job_name || "Untitled job"}</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
          {draft.job_date || "no date"}
          {draft.status !== "draft" ? `  ·  ${draft.status === "origin_signed" ? "origin signed" : "delivered"}` : ""}
        </div>
        <label className="col" style={{ gap: 4 }}>
          <span className="small" style={{ color: "var(--muted)" }}>Crew rep</span>
          <input value={crewRep} onChange={(e) => setCrewRep(e.target.value)} placeholder="Your name" />
        </label>
      </div>

      {/* Signed Bill of Lading - retrieval + send. Shown as soon as the BOL has
          been signed at origin, so the driver can PRODUCE the signed document on
          demand (a DOT officer at a border wanted the actual signed BOL, not just
          a record that it was signed) and email the client a copy. Placed high so
          it is the first thing reachable when the BOL is opened in the field. */}
      {draft.status !== "draft" && (
        <div className="card" style={{ borderColor: "var(--brand)" }}>
          <div className="sectionTitle">Signed Bill of Lading</div>
          <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5, marginBottom: 10 }}>
            {draft.status === "delivered"
              ? "Origin and destination signed."
              : `Origin signed${draft.origin_signed_at ? ` on ${new Date(draft.origin_signed_at).toLocaleDateString()}` : ""}.`}
            {" "}Produce the signed BOL to present it (for example at a border crossing) or send a copy to the client.
          </div>

          <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
            <button className="btnPrimary" onClick={viewSignedBol} disabled={viewBusy}>
              {viewBusy ? "Opening…" : "View / download signed BOL"}
            </button>
            {draft.signed_pdf_url && (
              <a href={draft.signed_pdf_url} target="_blank" rel="noreferrer" className="small" style={{ color: "var(--brand)" }}>
                Open signed PDF in Drive &rarr;
              </a>
            )}
          </div>
          <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>
            The signed copy is generated on this device and works offline.
          </div>

          {/* DOT-required addresses - editable so a BOL signed before this
              feature (or with a typo) can be corrected and re-issued. */}
          <div className="col" style={{ gap: 10, marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <span className="small" style={{ color: "var(--muted)", fontWeight: 700 }}>
              Origin &amp; destination addresses (printed on the BOL)
            </span>
            <label className="col" style={{ gap: 4 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Origin (pickup) address</span>
              <input
                value={draft.origin_address || ""}
                onChange={(e) => setAddress({ origin_address: e.target.value })}
                placeholder="Street, City, ST ZIP"
              />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Destination (delivery) address</span>
              <input
                value={draft.dest_address || ""}
                onChange={(e) => setAddress({ dest_address: e.target.value })}
                placeholder="Street, City, ST ZIP"
              />
            </label>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
              {addrErr && <span className="small" style={{ color: "var(--danger)" }}>{addrErr}</span>}
              {addrNote && <span className="small" style={{ color: "var(--ok)" }}>{addrNote}</span>}
              <button onClick={saveAddresses}>Save addresses</button>
            </div>
          </div>

          {/* Send to client - emails the signed PDF. Needs connectivity. */}
          <div className="col" style={{ gap: 8, marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <span className="small" style={{ color: "var(--muted)", fontWeight: 700 }}>Send a copy to the client</span>
            <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
              <label className="col" style={{ gap: 4, flex: "1 1 200px" }}>
                <span className="small" style={{ color: "var(--muted)" }}>Client email</span>
                <input
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="client@example.com"
                />
              </label>
              <button className="btnPrimary" onClick={sendToClient} disabled={emailBusy} style={{ minWidth: 120 }}>
                {emailBusy ? "Sending…" : "Send to client"}
              </button>
            </div>
            {emailErr && <div style={{ color: "var(--danger)", fontSize: 13 }}>{emailErr}</div>}
            {emailNote && <div className="small" style={{ color: "var(--ok)" }}>{emailNote}</div>}
          </div>
        </div>
      )}

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

      {/* ── FMCSA-required BOL detail cards (crew-entered; ADR 0023). Shown only
          while building the BOL, before it is signed at origin. Bite-size like
          the Job Report tab: one card per group, * marks a field required to
          sign. ── */}
      {draft.status === "draft" && (
        <>
          {/* Card 1: Shipper & shipment */}
          <div className="card">
            <div className="sectionTitle">Shipper &amp; shipment</div>
            <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5, marginBottom: 10 }}>
              Look these up in the job's Google Calendar description and type them in.
              They print on the Bill of Lading and are required to sign at origin.
            </div>
            <div className="col" style={{ gap: 10 }}>
              <label className="col" style={{ gap: 4 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Shipper (customer) name *</span>
                <input value={draft.shipper_name || ""} onChange={(e) => setField({ shipper_name: e.target.value })} placeholder="Full name" />
              </label>
              <label className="col" style={{ gap: 4 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Shipper phone *</span>
                <input type="tel" inputMode="tel" value={draft.shipper_phone || ""} onChange={(e) => setField({ shipper_phone: e.target.value })} placeholder="(406) 555-0100" />
              </label>
              <label className="col" style={{ gap: 4 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Origin (pickup) address *</span>
                <input value={draft.origin_address || ""} onChange={(e) => setAddress({ origin_address: e.target.value })} placeholder="Street, City, ST ZIP" />
              </label>
              <label className="col" style={{ gap: 4 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Destination (delivery) address *</span>
                <input value={draft.dest_address || ""} onChange={(e) => setAddress({ dest_address: e.target.value })} placeholder="Street, City, ST ZIP" />
              </label>
              <label className="col" style={{ gap: 4 }}>
                <span className="row small" style={{ color: "var(--muted)", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Shipper address *</span>
                  <button
                    type="button"
                    onClick={() => setField({ shipper_address: draft.origin_address || "" })}
                    disabled={!draft.origin_address}
                    style={{ fontSize: 12, padding: "2px 8px" }}
                  >
                    Same as pickup
                  </button>
                </span>
                <input value={draft.shipper_address || ""} onChange={(e) => setField({ shipper_address: e.target.value })} placeholder="Shipper's own address" />
              </label>
              <label className="col" style={{ gap: 4 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Shipment / job reference *</span>
                <input value={draft.shipment_number || ""} onChange={(e) => setField({ shipment_number: e.target.value })} placeholder="Job / shipment number" />
              </label>
            </div>
          </div>

          {/* Card 2: Payment & estimate */}
          <div className="card">
            <div className="sectionTitle">Payment &amp; estimate</div>
            <div className="col" style={{ gap: 10 }}>
              <label className="col" style={{ gap: 4 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Form of payment honored at delivery *</span>
                <select value={draft.form_of_payment || ""} onChange={(e) => setField({ form_of_payment: e.target.value })}>
                  <option value="">Select&hellip;</option>
                  {FORM_OF_PAYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              {draft.form_of_payment === "cod" && (
                <div className="col" style={{ gap: 10, borderLeft: "2px solid var(--border)", paddingLeft: 10 }}>
                  <label className="col" style={{ gap: 4 }}>
                    <span className="small" style={{ color: "var(--muted)" }}>COD - who to notify about charges *</span>
                    <input value={draft.cod_notify || ""} onChange={(e) => setField({ cod_notify: e.target.value })} placeholder="Name + phone/email, or 'same as shipper'" />
                  </label>
                  <label className="col" style={{ gap: 4 }}>
                    <span className="small" style={{ color: "var(--muted)" }}>COD - maximum amount demanded at delivery</span>
                    <input value={draft.cod_max || ""} onChange={(e) => setField({ cod_max: e.target.value })} inputMode="decimal" placeholder="$" />
                  </label>
                </div>
              )}
              <label className="col" style={{ gap: 4 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Estimate type *</span>
                <select value={draft.estimate_type || ""} onChange={(e) => setField({ estimate_type: e.target.value })}>
                  <option value="">Select&hellip;</option>
                  {ESTIMATE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>
          </div>

          {/* Card 3: Valuation election */}
          <div className="card">
            <div className="sectionTitle">Valuation *</div>
            <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5, marginBottom: 10 }}>
              Federal law requires the shipper to choose one liability option, freely
              and in writing. Have the shipper pick one before signing.
            </div>
            <div className="col" style={{ gap: 10 }}>
              {VALUATION_OPTIONS.map((o) => {
                const selected = draft.valuation === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setField({ valuation: o.value })}
                    style={{
                      textAlign: "left",
                      padding: 12,
                      borderRadius: "var(--btn-r)",
                      border: `2px solid ${selected ? "var(--brand)" : "var(--border)"}`,
                      background: selected ? "rgba(90,140,180,0.12)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                      <span
                        style={{
                          width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                          border: `2px solid ${selected ? "var(--brand)" : "var(--muted)"}`,
                          background: selected ? "var(--brand)" : "transparent",
                        }}
                      />
                      <span style={{ fontWeight: 700, color: "var(--text)" }}>{o.label}</span>
                    </div>
                    <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5, marginTop: 6 }}>{o.blurb}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Card 4: Agreed dates */}
          <div className="card">
            <div className="sectionTitle">Agreed dates</div>
            <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5, marginBottom: 10 }}>
              The pickup and delivery dates or windows agreed with the shipper. A single
              date or a range is fine.
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <label className="col" style={{ gap: 4, flex: "1 1 160px" }}>
                <span className="small" style={{ color: "var(--muted)" }}>Agreed pickup *</span>
                <input value={draft.agreed_pickup || ""} onChange={(e) => setField({ agreed_pickup: e.target.value })} placeholder="e.g. Jul 25, or week of Jul 25" />
              </label>
              <label className="col" style={{ gap: 4, flex: "1 1 160px" }}>
                <span className="small" style={{ color: "var(--muted)" }}>Agreed delivery *</span>
                <input value={draft.agreed_delivery || ""} onChange={(e) => setField({ agreed_delivery: e.target.value })} placeholder="e.g. Jul 27, or Jul 27 to 30" />
              </label>
            </div>
          </div>

          {/* Card 5: Other required declarations (default None / N/A) */}
          <div className="card">
            <div className="sectionTitle">Other required declarations</div>
            <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5, marginBottom: 10 }}>
              Leave blank if none - the Bill of Lading records None / N/A.
            </div>
            <div className="col" style={{ gap: 10 }}>
              <label className="col" style={{ gap: 4 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Additional motor carriers</span>
                <input value={draft.additional_carriers || ""} onChange={(e) => setField({ additional_carriers: e.target.value })} placeholder="None" />
              </label>
              <label className="col" style={{ gap: 4 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Third-party insurance (insurer + premium)</span>
                <input value={draft.third_party_insurance || ""} onChange={(e) => setField({ third_party_insurance: e.target.value })} placeholder="None" />
              </label>
              <label className="col" style={{ gap: 4 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Special / accessorial services</span>
                <input value={draft.accessorial_services || ""} onChange={(e) => setField({ accessorial_services: e.target.value })} placeholder="N/A" />
              </label>
            </div>
          </div>
        </>
      )}

      {/* Add item */}
      <div className="card">
        <div className="sectionTitle">Add Item</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 8, lineHeight: 1.5 }}>
          For boxes, indicate <strong>CP</strong> (Company Packed - carrier is
          responsible for loss / damage of contents) or <strong>PBO</strong>{" "}
          (Packed By Owner - carrier is not liable for the contents inside).
        </div>
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
          <>
            {draft.items.length > CLIP && (
              <input
                value={invSearch}
                onChange={(e) => setInvSearch(e.target.value)}
                placeholder="Search inventory…"
                style={{ marginBottom: 10 }}
              />
            )}
            {invQuery && filteredItems.length === 0 && (
              <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>No items match “{invSearch}”.</div>
            )}
          <div className="col" style={{ gap: 10 }}>
            {visibleItems.map((it) => (
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

                  {/* CP / PBO selector for boxes only. FMCSA liability
                      splits along this axis (Company Packed is our
                      responsibility; Packed By Owner shifts internal-
                      contents liability to the shipper). */}
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
            {!invQuery && hiddenCount > 0 && (
              <button type="button" onClick={() => setInvExpanded(true)} style={{ marginTop: 10, fontSize: 13 }}>
                Show all {filteredItems.length} items ({hiddenCount} more)
              </button>
            )}
            {!invQuery && invExpanded && draft.items.length > CLIP && (
              <button type="button" onClick={() => setInvExpanded(false)} style={{ marginTop: 10, fontSize: 13 }}>
                Show fewer
              </button>
            )}
          </>
        )}
      </div>

      {/* Save inventory */}
      <div className="card">
        <div className="small" style={{ color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Save the inventory as you build it - it syncs to the office sheet and works offline. Signing is below.
        </div>
        {savedNote && (
          <div className="small" style={{ color: "var(--ok)", marginBottom: 10 }}>{savedNote}</div>
        )}
        <div className="row wrap" style={{ justifyContent: "flex-end", gap: 10 }}>
          <button onClick={() => nav("/")}>Back to Jobs</button>
          <button onClick={async () => { if (draft.items.length > 0) await save(); onBack(); }}>Save &amp; finish later</button>
          <button className="btnPrimary" onClick={save}>Save Inventory</button>
        </div>
      </div>

      {/* Contract clauses + required disclosures - preview is always visible;
          expand to review the full 16 CFR §375.505 text before signing. */}
      <div className="card">
        <div className="sectionTitle">Contract clauses &amp; required disclosures</div>
        <div className="small" style={{ color: "var(--muted)", lineHeight: 1.6, marginBottom: 8 }}>
          This Bill of Lading incorporates the 16 CFR §375.505 clauses below (valuation,
          right to rescind, claims, arbitration, and required federal publications). By
          signing at origin and destination, the shipper acknowledges each clause.
        </div>
        {!showContract && BOL_CONTRACT_SECTIONS.length > 0 && (
          <div className="small" style={{ color: "var(--text)", lineHeight: 1.6, marginBottom: 8 }}>
            <strong>{BOL_CONTRACT_SECTIONS[0].n}. {BOL_CONTRACT_SECTIONS[0].title}.</strong>{" "}
            {BOL_CONTRACT_SECTIONS[0].body}{" "}
            <span style={{ color: "var(--muted)" }}>…</span>
          </div>
        )}
        {showContract && (
          <div className="col" style={{ gap: 10, marginBottom: 8 }}>
            {BOL_CONTRACT_SECTIONS.map((s) => (
              <div key={s.n}>
                <div className="small" style={{ fontWeight: 700 }}>{s.n}. {s.title}</div>
                {s.body.split("\n").map((line, i) => (
                  <div key={i} className="small" style={{ color: "var(--muted)", marginTop: 2, lineHeight: 1.5 }}>{line}</div>
                ))}
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowContract((v) => !v)}
          style={{ background: "none", border: "none", color: "var(--brand)", padding: 0, cursor: "pointer", fontSize: 13 }}
        >
          {showContract ? "Hide full contract text" : "Show full contract text"}
        </button>
      </div>

      {/* Signing */}
      {draft.status === "delivered" ? (
        <div className="card">
          <div className="sectionTitle">Signing Complete</div>
          <div className="small" style={{ color: "var(--ok)" }}>
            ✓ Origin and destination signed. The signed Bill of Lading has been delivered to the shipper and stored.
          </div>
          <div className="small" style={{ color: "var(--muted)", marginTop: 8 }}>
            Use <strong>Signed Bill of Lading</strong> above to view, download, or email the client a copy.
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="sectionTitle">
            {draft.status === "origin_signed" ? "Destination Signing - upon delivery" : "Origin Signing - before loading"}
          </div>

          {draft.status === "origin_signed" ? (
            <>
              <div className="small" style={{ color: "var(--ok)", marginBottom: 10 }}>
                ✓ Origin signed{draft.origin_signed_at ? ` on ${new Date(draft.origin_signed_at).toLocaleDateString()}` : ""}. Complete the final walk-through, then sign at delivery.
              </div>
              <label className="col" style={{ gap: 4, marginBottom: 10 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Walk-through notes / damage noted (write NONE if applicable)</span>
                <textarea rows={2} value={walkNotes} onChange={(e) => setWalkNotes(e.target.value)} />
              </label>
              <label className="col" style={{ gap: 4, marginBottom: 12, maxWidth: 200 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Final actual charges ($)</span>
                <input value={finalCharges} onChange={(e) => setFinalCharges(e.target.value)} inputMode="decimal" placeholder="0.00" />
              </label>
            </>
          ) : (
            <>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
                The shipper, addresses, payment, valuation, and dates are entered in
                the BOL detail cards above. Record the loading-time facts below, then
                sign.
              </div>
              <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
                <label className="col" style={{ gap: 4, flex: "1 1 150px" }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Actual pickup date</span>
                  <input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} />
                </label>
                <label className="col" style={{ gap: 4, flex: "1 1 150px" }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Vehicle (unit)</span>
                  <select value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
                    <option value="">Select&hellip;</option>
                    {units.map((u) => <option key={u} value={u}>{u}</option>)}
                    {vehicle && !units.includes(vehicle) && (
                      <option value={vehicle}>{vehicle}</option>
                    )}
                  </select>
                </label>
              </div>
            </>
          )}

          <label className="col" style={{ gap: 4, marginBottom: 12 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Client printed name *</span>
            <input value={shipperName} onChange={(e) => setShipperName(e.target.value)} placeholder="Client's full printed name" />
          </label>

          <div className="col" style={{ gap: 4, marginBottom: 12 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Shipper signature *</span>
            <SignaturePad ref={shipperSigRef} height={130} />
            <button type="button" onClick={() => shipperSigRef.current?.clear()} style={clearSigStyle}>Clear</button>
          </div>

          <div className="col" style={{ gap: 4, marginBottom: 12 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Carrier representative signature * ({crewRep || "you"})</span>
            <SignaturePad ref={carrierSigRef} height={130} />
            <button type="button" onClick={() => carrierSigRef.current?.clear()} style={clearSigStyle}>Clear</button>
          </div>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              style={{ marginTop: 3, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }}
            />
            <span style={{ lineHeight: 1.5, color: "var(--text)" }}>
              Both parties agree their electronic signature is legally binding and equivalent to a handwritten signature for this Bill of Lading, and the shipper affirms the certifications in Section 16.
            </span>
          </label>

          {signErr && (
            <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>{signErr}</div>
          )}

          <button className="btnPrimary" disabled={signBusy} onClick={() => signSession(draft.status === "origin_signed" ? "destination" : "origin")}>
            {signBusy
              ? "Signing…"
              : draft.status === "origin_signed"
                ? "Sign at delivery & give copy"
                : "Sign at origin & give copy"}
          </button>
        </div>
      )}
    </div>
  );
}

const clearSigStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  background: "none",
  border: "none",
  color: "var(--muted)",
  fontSize: 12,
  cursor: "pointer",
  padding: 0,
};

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
