import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  type DutyChange,
  type DutyStatus,
  type RodsDay,
  DUTY_STATUSES,
  STATUS_COLORS,
  STATUS_HELP,
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

/**
 * Timeline RODS surface for a drive day. The DRIVER taps their duty status as
 * it changes (each tap + note is mirrored to the job activity timeline via
 * onLogEvent), and can edit any time / add a retroactive change here so the
 * totals stay accurate. The day is signed on the Report tab (RodsSignoff).
 */

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

export default function RodsRecorder({
  onLogEvent,
}: {
  onLogEvent?: (type: string, note?: string | null) => void;
}) {
  const { user } = useAuth();
  const driverName = user?.name || user?.email || "";
  const date = todayLocal();
  const [day, setDay] = useState<RodsDay>(() => loadDay(date) || newDay(date, driverName, listLocalDays()[0] || null));
  const [showHelp, setShowHelp] = useState(false);

  const totals = useMemo(() => computeTotals(day.changes), [day.changes]);
  const cur = currentStatus(day.changes);
  const sorted = useMemo(
    () => day.changes.map((c, i) => ({ c, i })).sort((a, b) => minutesOfDay(a.c.time) - minutesOfDay(b.c.time)),
    [day.changes],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await loadOrResumeDay(date, driverName);
      if (!cancelled) setDay(d);
      await syncQueue();
    })();
    const onOnline = () => { syncQueue(); };
    window.addEventListener("online", onOnline);
    return () => { cancelled = true; window.removeEventListener("online", onOnline); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveDay(day);
    if (day.changes.length <= 1 && !day.signature) return;
    const t = window.setTimeout(() => { enqueueDay(day); syncQueue(); }, 800);
    return () => window.clearTimeout(t);
  }, [day]);

  function tap(status: DutyStatus) {
    if (cur === status) return;
    setDay((prev) => ({
      ...prev,
      changes: [...prev.changes, { time: nowHHMM(), status, location: "", remarks: "" }],
      updated_at: new Date().toISOString(),
    }));
    onLogEvent?.("DUTY", STATUS_LABELS[status]);
  }

  function addNote() {
    const text = window.prompt("Note:", "");
    const t = (text || "").trim();
    if (!t) return;
    onLogEvent?.("NOTE", t);
    setDay((prev) => {
      if (prev.changes.length === 0) return prev;
      const s = [...prev.changes].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time));
      const idx = prev.changes.indexOf(s[s.length - 1]);
      const changes = prev.changes.slice();
      changes[idx] = { ...changes[idx], remarks: t };
      return { ...prev, changes, updated_at: new Date().toISOString() };
    });
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

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card" style={{ borderColor: "var(--brand)" }}>
        <div className="sectionTitle">Record of Duty Status — driver</div>
        <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
          This is the log for the person <strong>driving the truck</strong>. Tap your status as it changes.
          Passengers and non-driving crew do not keep a RODS. Sign the day on the <strong>Report</strong> tab.
        </div>
        <button type="button" onClick={() => setShowHelp((s) => !s)} style={{ background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontSize: 13, padding: 0, marginTop: 8 }}>
          {showHelp ? "Hide status guide" : "What do the statuses mean?"}
        </button>
        {showHelp && (
          <div className="col" style={{ gap: 6, marginTop: 8 }}>
            {DUTY_STATUSES.map((s) => (
              <div key={s} className="small" style={{ lineHeight: 1.4 }}>
                <span style={{ fontWeight: 700, color: STATUS_COLORS[s] }}>{STATUS_LABELS[s]}:</span>{" "}
                <span style={{ color: "var(--muted)" }}>{STATUS_HELP[s]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Current-status banner (not a button) + tap buttons */}
      <div className="card">
        <div
          style={{
            display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", marginBottom: 12,
            borderRadius: 8, borderLeft: `5px solid ${cur ? STATUS_COLORS[cur] : "var(--border)"}`,
            background: "rgba(255,255,255,0.04)",
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: cur ? STATUS_COLORS[cur] : "var(--muted)", flexShrink: 0 }} />
          <div>
            <div className="small" style={{ color: "var(--muted)" }}>Current status</div>
            <div style={{ fontWeight: 800, fontSize: 16, color: cur ? STATUS_COLORS[cur] : "var(--muted)" }}>
              {cur ? STATUS_LABELS[cur] : "Off Duty (day start)"}
            </div>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {DUTY_STATUSES.map((s) => (
            <button key={s} className="btnPrimary" onClick={() => tap(s)} disabled={cur === s} style={{ flex: "1 1 45%", opacity: cur === s ? 0.55 : 1 }}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <button type="button" onClick={addNote} style={{ width: "100%", marginTop: 8 }}>+ Add note</button>
      </div>

      {/* Editable duty changes — edit a time / status, remove, or add a retroactive change */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div className="sectionTitle" style={{ marginBottom: 0 }}>Duty changes</div>
          <button type="button" onClick={addChange} style={{ fontSize: 12 }}>+ Add</button>
        </div>
        <div className="col" style={{ gap: 8 }}>
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
      </div>

      {/* 24h strip + totals */}
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
    </div>
  );
}
