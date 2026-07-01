import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../api/client";
import SignaturePad, { type SignaturePadHandle } from "./SignaturePad";
import {
  type RodsDay,
  DUTY_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  computeTotals,
  enqueueDay,
  loadDay,
  loadOrResumeDay,
  minutesToHHMM,
  newDay,
  saveDay,
  syncQueue,
  todayLocal,
} from "../lib/rodsStore";

/**
 * Driver RODS sign-off, shown on the Report tab. Duty status is recorded AND
 * edited on the Timeline (RodsRecorder); here the DRIVER reviews the day's
 * totals, fills the trip details, and signs. Self-hides when there's no RODS.
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
  const [units, setUnits] = useState<string[]>([]);
  const sigRef = useRef<SignaturePadHandle>(null);

  const totals = useMemo(() => computeTotals(day.changes), [day.changes]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await loadOrResumeDay(date, driverName);
      if (!cancelled) setDay(d);
    })();
    apiFetch<{ units: string[] }>("/api/dvir/units").then((r) => { if (!cancelled) setUnits(r.units || []); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { saveDay(day); }, [day]);

  // Autofill shipping-docs (BOL/manifest #) from the trip's BOL once known.
  useEffect(() => {
    if (bolRef && !(day.shipping_docs || "").trim()) {
      setDay((prev) => ({ ...prev, shipping_docs: bolRef, updated_at: new Date().toISOString() }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bolRef]);

  function patch(p: Partial<RodsDay>) {
    setDay((prev) => ({ ...prev, ...p, updated_at: new Date().toISOString() }));
  }

  async function sign() {
    setErr(null);
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
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
        For the person who <strong>drove</strong> today. Edit the duty log on the <strong>Timeline</strong>; here, add trip details and sign.
        {day.signature ? "  This day is signed." : ""}
      </div>

      {/* Totals */}
      <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
        {DUTY_STATUSES.map((s) => (
          <div key={s} className="col" style={{ gap: 2, flex: "1 1 110px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>{STATUS_LABELS[s]}</span>
            <span style={{ fontWeight: 700, color: STATUS_COLORS[s] }}>{minutesToHHMM(totals[s])}</span>
          </div>
        ))}
      </div>

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
