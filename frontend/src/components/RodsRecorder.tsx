import { useMemo, useState, type ReactNode } from "react";
import {
  type DutyStatus,
  DUTY_STATUSES,
  STATUS_COLORS,
  STATUS_HELP,
  STATUS_LABELS,
  changesFromDutyEvents,
  currentStatus,
} from "../lib/rodsStore";

type MinEvent = { type: string; note?: string | null; timestamp: string };

/**
 * Timeline RODS surface for a drive day. The DRIVER taps their duty status as
 * it changes; each tap logs a DUTY event to the single activity log (via
 * onLogEvent), which is also the RODS record - editing an event's time in the
 * activity log edits the RODS. So there is no separate duty log or summary here;
 * the day's summary + signature live on the Report tab (RodsSignoff). On a mixed
 * day the parent passes the normal Actions buttons via `actionsSlot`, shown as a
 * second labeled subsection with one shared Note button.
 */
export default function RodsRecorder({
  events = [],
  onLogEvent,
  actionsSlot,
}: {
  events?: MinEvent[];
  onLogEvent?: (type: string, note?: string | null) => void;
  actionsSlot?: ReactNode;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const cur = useMemo(() => currentStatus(changesFromDutyEvents(events)), [events]);

  function tap(status: DutyStatus) {
    if (cur === status) return;
    onLogEvent?.("DUTY", STATUS_LABELS[status]);
  }
  function addNote() {
    const text = window.prompt("Note:", "");
    const t = (text || "").trim();
    if (!t) return;
    onLogEvent?.("NOTE", t);
  }

  return (
    <div className="card" style={{ borderColor: "var(--brand)" }}>
      <div className="sectionTitle">Record of Duty Status - driver</div>
      <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
        For the person <strong>driving the truck</strong>. Tap your status as it changes; each tap is logged in the
        Activity list below (tap a time there to correct it). Passengers and non-driving crew do not keep a RODS.
        Review the day's totals and sign on the <strong>Report</strong> tab.
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

      {/* Job labor actions come first on a mixed day; RODS below. */}
      {actionsSlot && (
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
          <div className="small" style={{ color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>Actions - job labor</div>
          {actionsSlot}
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

      <div className="small" style={{ color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>RODS - tap your duty status</div>
      <div className="row wrap" style={{ gap: 8 }}>
        {DUTY_STATUSES.map((s) => (
          <button key={s} className="btnPrimary" onClick={() => tap(s)} disabled={cur === s} style={{ flex: "1 1 45%", opacity: cur === s ? 0.55 : 1 }}>
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <button type="button" onClick={addNote} style={{ width: "100%", marginTop: 10 }}>+ Add note</button>
    </div>
  );
}
