import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../api/client";
import SignaturePad, { type SignaturePadHandle } from "./SignaturePad";
import {
  type RodsDay,
  DUTY_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  changesFromDutyEvents,
  computeTotals,
  enqueueDay,
  loadDay,
  minutesOfDay,
  minutesToHHMM,
  newDay,
  nowHHMM,
  saveDay,
  syncQueue,
  todayLocal,
} from "../lib/rodsStore";

type MinEvent = { type: string; note?: string | null; timestamp: string };

function fmt12(hhmm: string): string {
  const mins = minutesOfDay(hhmm);
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? "p" : "a";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")}${ap}`;
}

/**
 * Driver RODS sign-off on the Report tab. The duty log IS the activity log
 * (duty taps + time edits happen there); this derives the day's duty changes
 * from the DUTY events, shows the day's summary + totals, collects trip details,
 * and signs. Self-hides when no driving was logged.
 */
export default function RodsSignoff({ events = [], bolLink }: { events?: MinEvent[]; bolLink?: { ref: string; onOpen: () => void } | null }) {
  const { user } = useAuth();
  const driverName = user?.name || user?.email || "";
  const date = todayLocal();

  const [day, setDay] = useState<RodsDay>(() => loadDay(date) || newDay(date, driverName, null));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [units, setUnits] = useState<string[]>([]);
  const [calcMsg, setCalcMsg] = useState<string | null>(null);
  const sigRef = useRef<SignaturePadHandle>(null);

  // Duty changes come from the activity log's DUTY events (single source).
  const changes = useMemo(() => changesFromDutyEvents(events), [events]);
  const totals = useMemo(() => computeTotals(changes), [changes]);
  const periods = useMemo(() => {
    const nowMin = minutesOfDay(nowHHMM());
    const sorted = [...changes].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time));
    return sorted.map((c, i) => {
      const startMin = minutesOfDay(c.time);
      const isLast = i === sorted.length - 1;
      const endMin = isLast ? Math.max(startMin, nowMin) : minutesOfDay(sorted[i + 1].time);
      return { start: c.time, end: isLast ? null : sorted[i + 1].time, status: c.status, dur: Math.max(0, endMin - startMin), isLast };
    });
  }, [changes]);

  useEffect(() => {
    apiFetch<{ units: string[] }>("/api/dvir/units").then((r) => setUnits(r.units || [])).catch(() => {});
  }, []);
  useEffect(() => { saveDay(day); }, [day]);

  function patch(p: Partial<RodsDay>) {
    setDay((prev) => ({ ...prev, ...p, updated_at: new Date().toISOString() }));
  }

  // Auto-calculate driving miles from the origin/destination cities via the
  // backend (Google Maps Distance Matrix). Falls back to manual entry.
  async function calcMiles() {
    const o = (day.origin || "").trim();
    const d = (day.destination || "").trim();
    if (!o || !d) { setCalcMsg("Enter origin + destination first."); return; }
    setCalcMsg("Calculating…");
    try {
      const r = await apiFetch<{ ok: boolean; miles: number | null }>(
        `/api/long-distance/distance?origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}`,
      );
      if (r.ok && r.miles != null) { patch({ total_miles: String(r.miles) }); setCalcMsg(null); }
      else setCalcMsg("Couldn't calculate - enter manually.");
    } catch {
      setCalcMsg("Couldn't calculate - enter manually.");
    }
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
        changes,                       // derived from the activity log
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
      setNote(n > 0 ? "RODS signed and synced." : "RODS signed - will sync when back online.");
      window.setTimeout(() => setNote(null), 4000);
    } catch {
      setErr("Could not submit. Your log is saved - try again.");
    } finally {
      setBusy(false);
    }
  }

  if (changes.length <= 1 && !day.signature) return null;

  return (
    <div className="card" style={{ borderColor: "var(--brand)" }}>
      <div className="sectionTitle">Record of Duty Status - driver ({date})</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
        For the person who <strong>drove</strong> today. The duty log is the Activity list on the Timeline (tap a time
        there to correct it). Review the summary, add trip details, and sign.
        {day.signature ? "  This day is signed." : ""}
      </div>

      {/* Duty summary: chronological periods + daily totals. */}
      <div className="col" style={{ gap: 6, marginBottom: 12 }}>
        {periods.map((p, i) => (
          <div key={i} className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span className="row" style={{ gap: 8, alignItems: "center", minWidth: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS[p.status], flexShrink: 0 }} />
              <span style={{ fontWeight: 600, fontSize: 13 }}>{STATUS_LABELS[p.status]}</span>
              <span className="small" style={{ color: "var(--muted)" }}>{fmt12(p.start)} &rarr; {p.end ? fmt12(p.end) : "now"}</span>
            </span>
            <span className="small" style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{minutesToHHMM(p.dur)}{p.isLast ? " so far" : ""}</span>
          </div>
        ))}
      </div>
      <div className="row wrap" style={{ gap: 10, marginBottom: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
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
              <option value="">Select&hellip;</option>
              {units.map((u) => <option key={u} value={u}>{u}</option>)}
              {day.vehicle_number && !units.includes(day.vehicle_number) && <option value={day.vehicle_number}>{day.vehicle_number}</option>}
            </select>
          </label>
          <label className="col" style={{ gap: 4, flex: "1 1 160px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Miles today</span>
            <div className="row" style={{ gap: 6 }}>
              <input value={day.total_miles || ""} onChange={(e) => patch({ total_miles: e.target.value })} inputMode="numeric" style={{ flex: 1, minWidth: 0 }} />
              <button type="button" onClick={calcMiles} title="Calculate from the origin/destination cities" style={{ fontSize: 12, padding: "6px 10px", whiteSpace: "nowrap" }}>Auto</button>
            </div>
            {calcMsg && <span className="small" style={{ color: "var(--muted)" }}>{calcMsg}</span>}
          </label>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <label className="col" style={{ gap: 4, flex: 1 }}><span className="small" style={{ color: "var(--muted)" }}>Origin</span><input value={day.origin || ""} onChange={(e) => patch({ origin: e.target.value })} placeholder="City, ST" /></label>
          <label className="col" style={{ gap: 4, flex: 1 }}><span className="small" style={{ color: "var(--muted)" }}>Destination</span><input value={day.destination || ""} onChange={(e) => patch({ destination: e.target.value })} placeholder="City, ST" /></label>
        </div>
        <div className="col" style={{ gap: 4 }}>
          <span className="small" style={{ color: "var(--muted)" }}>Bill of Lading</span>
          {bolLink ? (
            <button type="button" onClick={bolLink.onOpen} style={{ alignSelf: "flex-start", fontSize: 13, padding: "6px 12px", border: "1px solid var(--brand)", color: "var(--brand)", background: "transparent", borderRadius: 8, cursor: "pointer" }}>
              View {bolLink.ref} &rsaquo;
            </button>
          ) : (
            <span className="small" style={{ color: "var(--muted)" }}>Attach a BOL in the Long-distance documents tile above.</span>
          )}
        </div>
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
        {busy ? "Submitting&hellip;" : "Sign & submit RODS"}
      </button>
    </div>
  );
}
