import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
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
  STATUS_HELP,
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
 * it changes; each tap (and note) is logged to the job activity timeline via
 * onLogEvent, so there is a single activity log (no separate RODS change list).
 * The day is signed on the Report tab (see RodsSignoff).
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

  // Resume today's day (adopt a server copy that's ahead) + drain the queue.
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

  // Autosave + back up in-progress days to the server (continuity).
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
      const sorted = [...prev.changes].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time));
      const idx = prev.changes.indexOf(sorted[sorted.length - 1]);
      const changes = prev.changes.slice();
      changes[idx] = { ...changes[idx], remarks: t };
      return { ...prev, changes, updated_at: new Date().toISOString() };
    });
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

      {/* Current status + tap buttons */}
      <div className="card">
        <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>Current status{cur ? "" : " — none yet"}</div>
        <div style={{ padding: "10px 12px", borderRadius: 8, marginBottom: 12, background: cur ? STATUS_COLORS[cur] : "var(--border)", color: cur ? "#10222b" : "var(--muted)", fontWeight: 800, fontSize: 16, textAlign: "center" }}>
          {cur ? STATUS_LABELS[cur] : "Off Duty (day start)"}
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
