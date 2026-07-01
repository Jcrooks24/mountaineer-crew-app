import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import SignaturePad, { type SignaturePadHandle } from "./SignaturePad";
import {
  type DutyChange,
  type DutyStatus,
  type RodsDay,
  DUTY_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  computeTotals,
  currentStatus,
  enqueueDay,
  listLocalDays,
  loadDay,
  loadOrResumeDay,
  minutesOfDay,
  minutesToHHMM,
  newDay,
  nowHHMM,
  saveDay,
  syncQueue,
  todayLocal,
} from "../lib/rodsStore";

function DutyStrip({ changes }: { changes: DutyChange[] }) {
  const sorted = [...changes].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time));
  const segments: { left: number; width: number; status: DutyStatus }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = minutesOfDay(sorted[i].time);
    const end = i + 1 < sorted.length ? minutesOfDay(sorted[i + 1].time) : 24 * 60;
    if (end <= start) continue;
    segments.push({ left: (start / 1440) * 100, width: ((end - start) / 1440) * 100, status: sorted[i].status });
  }
  return (
    <div>
      <div style={{ position: "relative", height: 30, borderRadius: 8, overflow: "hidden", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)" }}>
        {segments.map((s, i) => (
          <div key={i} title={STATUS_LABELS[s.status]} style={{ position: "absolute", top: 0, bottom: 0, left: `${s.left}%`, width: `${s.width}%`, background: STATUS_COLORS[s.status] }} />
        ))}
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 3, fontSize: 10, color: "var(--muted)" }}>
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
    </div>
  );
}

export default function RodsRecorder({ onBack }: { onBack?: () => void }) {
  const { user } = useAuth();
  const driverName = user?.name || user?.email || "";

  const [date, setDate] = useState(todayLocal());
  const [day, setDay] = useState<RodsDay>(() => loadDay(todayLocal()) || newDay(todayLocal(), driverName, listLocalDays()[0] || null));
  const [showDetails, setShowDetails] = useState(false);
  const [showDays, setShowDays] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const sigRef = useRef<SignaturePadHandle>(null);

  const totals = useMemo(() => computeTotals(day.changes), [day.changes]);
  const cur = currentStatus(day.changes);

  // Load the selected day: local first, else the signed server copy, else a new
  // day carrying the trip header forward. Also drain the submit queue.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await loadOrResumeDay(date, driverName);
      if (!cancelled) { setDay(d); setConsent(false); }
      await syncQueue();
    })();
    const onOnline = () => { syncQueue(); };
    window.addEventListener("online", onOnline);
    return () => { cancelled = true; window.removeEventListener("online", onOnline); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Autosave locally, and back the day up to the server (continuity) once it
  // has real content — debounced so taps/typing don't spam the API. Unsigned
  // days are DB-only on the server; signing triggers the Sheet export.
  useEffect(() => {
    saveDay(day);
    if (day.changes.length <= 1 && !day.signature) return;
    const t = window.setTimeout(() => { enqueueDay(day); syncQueue(); }, 800);
    return () => window.clearTimeout(t);
  }, [day]);

  function patch(p: Partial<RodsDay>) {
    setDay((prev) => ({ ...prev, ...p, updated_at: new Date().toISOString() }));
  }

  function tap(status: DutyStatus) {
    setErr(null);
    if (cur === status) return; // no-op if already in this status
    const change: DutyChange = { time: nowHHMM(), status, location: "", remarks: "" };
    setDay((prev) => ({ ...prev, changes: [...prev.changes, change], updated_at: new Date().toISOString() }));
  }

  function undoLast() {
    setDay((prev) => {
      if (prev.changes.length <= 1) return prev; // keep the 00:00 seed
      const sorted = [...prev.changes].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time));
      const last = sorted[sorted.length - 1];
      const idx = prev.changes.indexOf(last);
      const next = prev.changes.slice();
      next.splice(idx, 1);
      return { ...prev, changes: next, updated_at: new Date().toISOString() };
    });
  }

  async function signSubmit() {
    setErr(null);
    if (day.changes.length < 2) return setErr("Record at least one duty change before signing.");
    if (sigRef.current?.isEmpty()) return setErr("Driver signature is required.");
    if (!consent) return setErr("Accept the electronic signature consent to submit.");
    setBusy(true);
    try {
      const signed: RodsDay = { ...day, signature: sigRef.current!.toDataURL(), signed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      saveDay(signed);
      setDay(signed);
      enqueueDay(signed);
      const synced = await syncQueue();
      sigRef.current?.clear();
      setConsent(false);
      setNote(synced > 0 ? "Day signed and synced." : "Day signed — will sync when back online.");
      window.setTimeout(() => setNote(null), 4000);
    } catch {
      setErr("Could not submit. Your log is saved — try again.");
    } finally {
      setBusy(false);
    }
  }

  const sortedChanges = [...day.changes].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time));
  const recentDays = listLocalDays().slice(0, 10);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Record of Duty Status</div>
          <div className="small" style={{ color: "var(--muted)" }}>FMCSR §395.8 — tap to log a status change{day.signature ? " · signed" : day.submitted ? " · backed up" : ""}</div>
        </div>
        {onBack && (
          <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>← Menu</button>
        )}
      </div>

      {/* Day selector */}
      <div className="card">
        <div className="row wrap" style={{ gap: 10, alignItems: "flex-end", justifyContent: "space-between" }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Log date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {recentDays.length > 1 && (
            <button type="button" onClick={() => setShowDays((s) => !s)} style={{ fontSize: 13 }}>
              {showDays ? "Hide days" : "Resume a day"}
            </button>
          )}
        </div>
        {showDays && recentDays.length > 0 && (
          <div className="col" style={{ gap: 6, marginTop: 10 }}>
            {recentDays.map((d) => (
              <button key={d.log_date} onClick={() => { setDate(d.log_date); setShowDays(false); }} style={{ textAlign: "left", fontSize: 13 }}>
                <strong>{d.log_date}</strong>{d.log_date === todayLocal() ? " (today)" : ""} — {d.changes.length - 1} change{d.changes.length - 1 === 1 ? "" : "s"}{d.signature ? " · signed" : d.submitted ? " · backed up" : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Current status + tap buttons */}
      <div className="card">
        <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>
          Current status{cur ? "" : " — none yet"}
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 8, marginBottom: 12, background: cur ? STATUS_COLORS[cur] : "var(--border)", color: cur ? "#10222b" : "var(--muted)", fontWeight: 800, fontSize: 16, textAlign: "center" }}>
          {cur ? STATUS_LABELS[cur] : "Off Duty (day start)"}
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {DUTY_STATUSES.map((s) => (
            <button
              key={s}
              className="btnPrimary"
              onClick={() => tap(s)}
              disabled={cur === s}
              style={{ flex: "1 1 45%", opacity: cur === s ? 0.55 : 1 }}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Strip + totals */}
      <div className="card">
        <DutyStrip changes={day.changes} />
        <div className="row wrap" style={{ gap: 10, marginTop: 10 }}>
          {DUTY_STATUSES.map((s) => (
            <div key={s} className="col" style={{ gap: 2, flex: "1 1 110px" }}>
              <span className="small" style={{ color: "var(--muted)" }}>{STATUS_LABELS[s]}</span>
              <span style={{ fontWeight: 700, color: STATUS_COLORS[s] }}>{minutesToHHMM(totals[s])}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Change log */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div className="sectionTitle" style={{ marginBottom: 0 }}>Today's log</div>
          {day.changes.length > 1 && <button type="button" onClick={undoLast} style={{ fontSize: 12 }}>Undo last</button>}
        </div>
        <div className="col" style={{ gap: 4 }}>
          {sortedChanges.map((c, i) => (
            <div key={i} className="row" style={{ justifyContent: "space-between", gap: 8, fontSize: 13, borderTop: i ? "1px solid var(--border)" : "none", paddingTop: i ? 4 : 0 }}>
              <span><strong>{c.time}</strong> — <span style={{ color: STATUS_COLORS[c.status] }}>{STATUS_LABELS[c.status]}</span></span>
              {c.location ? <span className="small" style={{ color: "var(--muted)" }}>{c.location}</span> : null}
            </div>
          ))}
        </div>
      </div>

      {/* Trip details (carried across days) */}
      <div className="card">
        <button type="button" onClick={() => setShowDetails((s) => !s)} style={{ background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontSize: 13, padding: 0 }}>
          {showDetails ? "Hide trip details" : "Trip details (vehicle, route, docs)"}
        </button>
        {showDetails && (
          <div className="col" style={{ gap: 10, marginTop: 10 }}>
            <div className="row wrap" style={{ gap: 10 }}>
              <label className="col" style={{ gap: 4, flex: "1 1 140px" }}><span className="small" style={{ color: "var(--muted)" }}>Vehicle #</span><input value={day.vehicle_number || ""} onChange={(e) => patch({ vehicle_number: e.target.value })} /></label>
              <label className="col" style={{ gap: 4, flex: "1 1 140px" }}><span className="small" style={{ color: "var(--muted)" }}>Trailer #</span><input value={day.trailer_number || ""} onChange={(e) => patch({ trailer_number: e.target.value })} /></label>
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <label className="col" style={{ gap: 4, flex: 1 }}><span className="small" style={{ color: "var(--muted)" }}>Origin</span><input value={day.origin || ""} onChange={(e) => patch({ origin: e.target.value })} placeholder="City, ST" /></label>
              <label className="col" style={{ gap: 4, flex: 1 }}><span className="small" style={{ color: "var(--muted)" }}>Destination</span><input value={day.destination || ""} onChange={(e) => patch({ destination: e.target.value })} placeholder="City, ST" /></label>
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <label className="col" style={{ gap: 4, flex: "1 1 120px" }}><span className="small" style={{ color: "var(--muted)" }}>Miles today</span><input value={day.total_miles || ""} onChange={(e) => patch({ total_miles: e.target.value })} inputMode="numeric" /></label>
              <label className="col" style={{ gap: 4, flex: "2 1 200px" }}><span className="small" style={{ color: "var(--muted)" }}>Shipping docs (BOL/manifest #)</span><input value={day.shipping_docs || ""} onChange={(e) => patch({ shipping_docs: e.target.value })} /></label>
            </div>
            <label className="col" style={{ gap: 4 }}><span className="small" style={{ color: "var(--muted)" }}>Co-driver</span><input value={day.co_driver_name || ""} onChange={(e) => patch({ co_driver_name: e.target.value })} placeholder="If any" /></label>
          </div>
        )}
      </div>

      {/* Sign + submit */}
      <div className="card">
        <div className="sectionTitle">Driver certification</div>
        <p className="small" style={{ color: "var(--muted)", marginTop: 0, marginBottom: 8 }}>I certify this record of duty status is true and accurate for {date}.</p>
        <SignaturePad ref={sigRef} height={130} />
        <button type="button" onClick={() => sigRef.current?.clear()} style={{ marginTop: 6, background: "none", border: "none", color: "var(--muted)", fontSize: 12, cursor: "pointer", padding: 0 }}>Clear signature</button>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13, marginTop: 10 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }} />
          <span style={{ lineHeight: 1.5, color: "var(--text)" }}>My electronic signature is legally binding and equivalent to my handwritten signature for this Record of Duty Status.</span>
        </label>
        {err && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{err}</div>}
        {note && <div className="small" style={{ color: "var(--ok)", marginTop: 10 }}>{note}</div>}
        <button className="btnPrimary" onClick={signSubmit} disabled={busy} style={{ marginTop: 12 }}>
          {busy ? "Submitting…" : "Sign & submit day"}
        </button>
      </div>
    </div>
  );
}
