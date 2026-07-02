import { useEffect, useMemo, useState, type ReactNode } from "react";
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
 * onLogEvent). New duty changes are ONLY created by tapping a status button;
 * the log below lets you correct a time/status or remove a mistap. On a mixed
 * day (driving + labor) the parent passes the normal Actions buttons via
 * `actionsSlot`, shown as a second labeled subsection with one shared Note
 * button. Signed on the Report tab (RodsSignoff).
 */

function fmt12(hhmm: string): string {
  const mins = minutesOfDay(hhmm);
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? "p" : "a";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")}${ap}`;
}

export default function RodsRecorder({
  onLogEvent,
  actionsSlot,
}: {
  onLogEvent?: (type: string, note?: string | null) => void;
  actionsSlot?: ReactNode;
}) {
  const { user } = useAuth();
  const driverName = user?.name || user?.email || "";
  const date = todayLocal();
  const [day, setDay] = useState<RodsDay>(() => loadDay(date) || newDay(date, driverName, listLocalDays()[0] || null));
  const [showHelp, setShowHelp] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const totals = useMemo(() => computeTotals(day.changes), [day.changes]);
  const cur = currentStatus(day.changes);
  const sorted = useMemo(
    () => day.changes.map((c, i) => ({ c, i })).sort((a, b) => minutesOfDay(a.c.time) - minutesOfDay(b.c.time)),
    [day.changes],
  );

  // Readable "duty periods" view: each status runs until the next change (the
  // open period runs to now). Far clearer than a thin color bar.
  const periods = useMemo(() => {
    const nowMin = minutesOfDay(nowHHMM());
    return sorted.map(({ c }, pos) => {
      const startMin = minutesOfDay(c.time);
      const isLast = pos === sorted.length - 1;
      const endMin = isLast ? Math.max(startMin, nowMin) : minutesOfDay(sorted[pos + 1].c.time);
      return { start: c.time, end: isLast ? null : sorted[pos + 1].c.time, status: c.status, dur: Math.max(0, endMin - startMin), isLast };
    });
  }, [sorted]);

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

  return (
    <div className="col" style={{ gap: 14 }}>
      {/* Duty status: description + current-status banner + tap buttons all in
          one tile. */}
      <div className="card" style={{ borderColor: "var(--brand)" }}>
        <div className="sectionTitle">Record of Duty Status &ndash; driver</div>
        <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
          For the person <strong>driving the truck</strong>. Tap your status as it changes; passengers and
          non-driving crew do not keep a RODS. Sign the day on the <strong>Report</strong> tab.
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

        <div
          style={{
            display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", margin: "12px 0",
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

        <div className="small" style={{ color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>RODS &ndash; tap your duty status</div>
        <div className="row wrap" style={{ gap: 8 }}>
          {DUTY_STATUSES.map((s) => (
            <button key={s} className="btnPrimary" onClick={() => tap(s)} disabled={cur === s} style={{ flex: "1 1 45%", opacity: cur === s ? 0.55 : 1 }}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {actionsSlot && (
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
            <div className="small" style={{ color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>Actions &ndash; job labor</div>
            {actionsSlot}
          </div>
        )}

        <button type="button" onClick={addNote} style={{ width: "100%", marginTop: 10 }}>+ Add note</button>
      </div>

      {/* Duty log: tap a status button above to log a change. Here you correct
          a time/status or remove a mistap (no manual "add"). */}
      <div className="card">
        <div className="sectionTitle">Duty log</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
          Tap a status above to log a change. Tap a time here to correct it.
        </div>
        <div>
          {sorted.map(({ c, i }, pos) => (
            <div key={i} style={{ padding: "10px 0", borderTop: pos > 0 ? "1px solid var(--border)" : "none" }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span className="row" style={{ gap: 8, alignItems: "center", minWidth: 0 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: STATUS_COLORS[c.status], flexShrink: 0 }} />
                  <strong style={{ fontSize: 14 }}>{STATUS_LABELS[c.status]}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setEditingIdx((prev) => (prev === i ? null : i))}
                  title="Tap to edit this duty change"
                  style={{ background: "transparent", border: "none", padding: 0, color: "var(--muted)", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap", textDecoration: "underline dotted", textDecorationColor: "var(--border)", textUnderlineOffset: 3 }}
                >
                  {fmt12(c.time)}
                </button>
              </div>
              {editingIdx === i && (
                <div style={{ marginTop: 8, padding: 10, background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                  <label className="small" style={{ color: "var(--muted)" }}>Edit duty change</label>
                  <input
                    type="time"
                    value={c.time}
                    onChange={(e) => updateChange(i, { time: e.target.value })}
                    style={{ padding: "8px 10px", fontSize: 14, borderRadius: "var(--btn-r)", border: "1px solid var(--border)", background: "rgba(255,255,255,0.05)", color: "var(--text)" }}
                  />
                  <select
                    value={c.status}
                    onChange={(e) => updateChange(i, { status: e.target.value as DutyStatus })}
                    style={{ padding: "8px 10px", fontSize: 14, borderRadius: "var(--btn-r)", border: "1px solid var(--border)", background: "rgba(255,255,255,0.05)", color: "var(--text)" }}
                  >
                    {DUTY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                  <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => { removeChange(i); setEditingIdx(null); }}
                      disabled={day.changes.length <= 1}
                      style={{ fontSize: 12, padding: "6px 12px", background: "transparent", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: 6, cursor: "pointer" }}
                    >
                      Remove
                    </button>
                    <button type="button" className="btnPrimary" onClick={() => setEditingIdx(null)} style={{ fontSize: 12, padding: "6px 12px" }}>Done</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Readable duty summary: chronological periods + daily totals. */}
      <div className="card">
        <div className="sectionTitle">Today's duty summary</div>
        <div className="col" style={{ gap: 6 }}>
          {periods.map((p, i) => (
            <div key={i} className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span className="row" style={{ gap: 8, alignItems: "center", minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS[p.status], flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{STATUS_LABELS[p.status]}</span>
                <span className="small" style={{ color: "var(--muted)" }}>
                  {fmt12(p.start)} &rarr; {p.end ? fmt12(p.end) : "now"}
                </span>
              </span>
              <span className="small" style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
                {minutesToHHMM(p.dur)}{p.isLast ? " so far" : ""}
              </span>
            </div>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 10, marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
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
