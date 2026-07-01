import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../api/client";
import SignaturePad, { type SignaturePadHandle } from "./SignaturePad";
import {
  type DutyChange,
  type DutyStatus,
  type RodsDay,
  DUTY_STATUSES,
  STATUS_COLORS,
  STATUS_HELP,
  STATUS_LABELS,
  computeTotals,
  enqueueDay,
  loadDay,
  loadOrResumeDay,
  minutesOfDay,
  minutesToHHMM,
  newDay,
  saveDay,
  syncQueue,
  todayLocal,
} from "../lib/rodsStore";

/**
 * Driver RODS sign-off, shown on the Report tab. Duty status is recorded on the
 * Timeline (RodsRecorder); here the DRIVER reviews + corrects the log (edit any
 * time / add a retroactive change - totals recompute), fills the trip details,
 * and signs. Self-hides when there's no RODS to sign.
 */
export default function RodsSignoff({ bolRef }: { bolRef?: string }) {
  const { user } = useAuth();
  const driverName = user?.name || user?.email || "";
  const date = todayLocal();

  const [day, setDay] = useState<RodsDay>(() => loadDay(date) || newDay(date, driverName, null));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [units, setUnits] = useState<string[]>([]);
  const sigRef = useRef<SignaturePadHandle>(null);

  const totals = useMemo(() => computeTotals(day.changes), [day.changes]);
  const sorted = useMemo(
    () => day.changes.map((c, i) => ({ c, i })).sort((a, b) => minutesOfDay(a.c.time) - minutesOfDay(b.c.time)),
    [day.changes],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await loadOrResumeDay(date, driverName);
      if (!cancelled) setDay(d);
    })();
    // Vehicle unit list (same source as the DVIR module).
    apiFetch<{ units: string[] }>("/api/dvir/units").then((r) => { if (!cancelled) setUnits(r.units || []); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { saveDay(day); }, [day]);

  // Autofill the shipping-docs (BOL/manifest #) from the trip's BOL once known.
  useEffect(() => {
    if (bolRef && !(day.shipping_docs || "").trim()) {
      setDay((prev) => ({ ...prev, shipping_docs: bolRef, updated_at: new Date().toISOString() }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bolRef]);

  function patch(p: Partial<RodsDay>) {
    setDay((prev) => ({ ...prev, ...p, updated_at: new Date().toISOString() }));
  }
  function updateChange(idx: number, p: Partial<DutyChange>) {
    setDay((prev) => ({ ...prev, changes: prev.changes.map((c, i) => (i === idx ? { ...c, ...p } : c)), updated_at: new Date().toISOString() }));
  }
  function removeChange(idx: number) {
    setDay((prev) => ({ ...prev, changes: prev.changes.filter((_, i) => i !== idx), updated_at: new Date().toISOString() }));
  }
  function addChange() {
    let t = "08:00";
    if (sorted.length > 0) {
      const mins = Math.min(23 * 60 + 59, minutesOfDay(sorted[sorted.length - 1].c.time) + 60);
      t = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    }
    setDay((prev) => ({ ...prev, changes: [...prev.changes, { time: t, status: "on_duty", location: "", remarks: "" }], updated_at: new Date().toISOString() }));
  }

  async function sign() {
    setErr(null);
    for (const { c } of sorted) if (!/^\d{2}:\d{2}$/.test(c.time)) return setErr(`Invalid time: ${c.time}`);
    if (sigRef.current?.isEmpty()) return setErr("Driver signature is required.");
    if (!consent) return setErr("Accept the electronic signature consent to submit.");
    setBusy(true);
    try {
      const signed: RodsDay = {
        ...day,
        driver_name: driverName || day.driver_name,
        signature: sigRef.current!.toDataURL(),
        signed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      saveDay(signed);
      setDay(signed);
      enqueueDay(signed);
      const n = await syncQueue();
      sigRef.current?.clear();
      setConsent(false);
      setNote(n > 0 ? "RODS signed and synced." : "RODS signed — will sync when back online.");
      window.setTimeout(() => setNote(null), 4000);
    } catch {
      setErr("Could not submit. Your log is saved — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (day.changes.length <= 1 && !day.signature) return null;

  return (
    <div className="card" style={{ borderColor: "var(--brand)" }}>
      <div className="sectionTitle">Record of Duty Status — driver ({date})</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 8, lineHeight: 1.5 }}>
        For the person who <strong>drove</strong> today. Review + correct the log, add trip details, and sign.
        {day.signature ? "  This day is signed." : ""}
      </div>

      <button type="button" onClick={() => setShowHelp((s) => !s)} style={{ background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 }}>
        {showHelp ? "Hide status guide" : "What do the statuses mean?"}
      </button>
      {showHelp && (
        <div className="col" style={{ gap: 6, marginBottom: 12 }}>
          {DUTY_STATUSES.map((s) => (
            <div key={s} className="small" style={{ lineHeight: 1.4 }}>
              <span style={{ fontWeight: 700, color: STATUS_COLORS[s] }}>{STATUS_LABELS[s]}:</span>{" "}
              <span style={{ color: "var(--muted)" }}>{STATUS_HELP[s]}</span>
            </div>
          ))}
        </div>
      )}

      {/* Totals */}
      <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
        {DUTY_STATUSES.map((s) => (
          <div key={s} className="col" style={{ gap: 2, flex: "1 1 110px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>{STATUS_LABELS[s]}</span>
            <span style={{ fontWeight: 700, color: STATUS_COLORS[s] }}>{minutesToHHMM(totals[s])}</span>
          </div>
        ))}
      </div>

      {/* Editable duty changes — edit a time or add a retroactive change; totals recompute */}
      <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>Duty status changes</div>
      <div className="col" style={{ gap: 8, marginBottom: 8 }}>
        {sorted.map(({ c, i }) => (
          <div key={i} className="row wrap" style={{ gap: 8, alignItems: "center" }}>
            <input type="time" value={c.time} onChange={(e) => updateChange(i, { time: e.target.value })} style={{ width: 110 }} />
            <select value={c.status} onChange={(e) => updateChange(i, { status: e.target.value as DutyStatus })} style={{ flex: "1 1 150px" }}>
              {DUTY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <button type="button" onClick={() => removeChange(i)} disabled={day.changes.length <= 1} style={{ fontSize: 12, padding: "6px 10px", color: "var(--danger)", borderColor: "var(--danger)" }}>Remove</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addChange} style={{ fontSize: 13, marginBottom: 12 }}>+ Add a change</button>

      {/* Trip details */}
      <div className="col" style={{ gap: 10, marginBottom: 12 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <label className="col" style={{ gap: 4, flex: "1 1 160px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Vehicle</span>
            <select value={day.vehicle_number || ""} onChange={(e) => patch({ vehicle_number: e.target.value })}>
              <option value="">Select…</option>
              {units.map((u) => <option key={u} value={u}>{u}</option>)}
              {day.vehicle_number && !units.includes(day.vehicle_number) && <option value={day.vehicle_number}>{day.vehicle_number}</option>}
            </select>
          </label>
          <label className="col" style={{ gap: 4, flex: "1 1 120px" }}><span className="small" style={{ color: "var(--muted)" }}>Miles today</span><input value={day.total_miles || ""} onChange={(e) => patch({ total_miles: e.target.value })} inputMode="numeric" /></label>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <label className="col" style={{ gap: 4, flex: 1 }}><span className="small" style={{ color: "var(--muted)" }}>Origin</span><input value={day.origin || ""} onChange={(e) => patch({ origin: e.target.value })} placeholder="City, ST" /></label>
          <label className="col" style={{ gap: 4, flex: 1 }}><span className="small" style={{ color: "var(--muted)" }}>Destination</span><input value={day.destination || ""} onChange={(e) => patch({ destination: e.target.value })} placeholder="City, ST" /></label>
        </div>
        <label className="col" style={{ gap: 4 }}><span className="small" style={{ color: "var(--muted)" }}>Shipping docs (BOL / manifest #)</span><input value={day.shipping_docs || ""} onChange={(e) => patch({ shipping_docs: e.target.value })} /></label>
        <label className="col" style={{ gap: 4 }}><span className="small" style={{ color: "var(--muted)" }}>Co-driver</span><input value={day.co_driver_name || ""} onChange={(e) => patch({ co_driver_name: e.target.value })} placeholder="If any" /></label>
      </div>

      {/* Signature */}
      <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>Driver signature *</div>
      <SignaturePad ref={sigRef} height={130} />
      <button type="button" onClick={() => sigRef.current?.clear()} style={{ marginTop: 6, background: "none", border: "none", color: "var(--muted)", fontSize: 12, cursor: "pointer", padding: 0 }}>Clear signature</button>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13, marginTop: 10 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }} />
        <span style={{ lineHeight: 1.5, color: "var(--text)" }}>
          My electronic signature is legally binding and equivalent to my handwritten signature for this Record of Duty Status.
        </span>
      </label>
      {err && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{err}</div>}
      {note && <div className="small" style={{ color: "var(--ok)", marginTop: 10 }}>{note}</div>}
      <button className="btnPrimary" onClick={sign} disabled={busy} style={{ marginTop: 12 }}>
        {busy ? "Submitting…" : "Sign & submit RODS"}
      </button>
    </div>
  );
}
