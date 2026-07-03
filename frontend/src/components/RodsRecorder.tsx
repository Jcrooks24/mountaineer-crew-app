import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import RosterTypeahead from "./RosterTypeahead";
import BetaTag from "./BetaTag";
import {
  type DutyStatus,
  DUTY_STATUSES,
  STATUS_COLORS,
  STATUS_HELP,
  STATUS_LABELS,
  changesForDriver,
  currentStatus,
  dutyEventNote,
} from "../lib/rodsStore";

type MinEvent = { type: string; note?: string | null; timestamp: string };

/**
 * Timeline RODS surface for a drive day. The DRIVER (or a passenger logging on
 * their behalf) taps a duty status; each tap logs a DUTY event to the single
 * activity log via onLogEvent, encoding WHO the change is for. Multiple drivers
 * can log on the same day - each driver's changes group into their own RODS on
 * the Report tab. Editing an event's time in the activity log edits the RODS.
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
  const { user } = useAuth();
  const me = user?.name || user?.email || "";
  const [showHelp, setShowHelp] = useState(false);
  const [loggingFor, setLoggingFor] = useState<string>(me);
  useEffect(() => { if (me && !loggingFor) setLoggingFor(me); }, [me, loggingFor]);

  const driver = (loggingFor || "").trim() || me;
  const cur = useMemo(() => currentStatus(changesForDriver(events, driver, me)), [events, driver, me]);

  function tap(status: DutyStatus) {
    if (cur === status) return;
    onLogEvent?.("DUTY", dutyEventNote(status, driver));
  }
  function addNote() {
    const text = window.prompt("Note:", "");
    const t = (text || "").trim();
    if (!t) return;
    onLogEvent?.("NOTE", t);
  }

  return (
    <div className="card" style={{ borderColor: "var(--brand)" }}>
      {/* Title changes when the tile also hosts the "Actions - job labor"
          slot on mixed drive+labor days - "Record of Duty Status" alone is
          misleading in that case. */}
      <div className="sectionTitle">
        {actionsSlot ? "Timeline actions" : "Record of Duty Status - driver"}
      </div>

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

      {/* Who this duty change is for - default is the person logging it, but a
          passenger can log on behalf of the driver. Freeform typeahead so a
          custom name still submits when the driver isn't in the roster. */}
      <div className="col" style={{ gap: 4, marginBottom: 8 }}>
        <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="small" style={{ color: "var(--muted)" }}>I'm logging this duty change for</span>
          <BetaTag feature="rosterTypeahead" style={{ marginTop: 0 }} />
        </div>
        <RosterTypeahead
          value={loggingFor}
          onChange={setLoggingFor}
          placeholder="Start typing a name…"
          style={{ width: "100%" }}
        />
      </div>

      <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
        For the person <strong>driving the truck</strong>. Tap a status as it changes; each tap is logged in the
        Activity list below (tap a time there to correct it). A RODS is required for each driver, each day - sign them
        on the <strong>Report</strong> tab.
      </div>
      <button type="button" onClick={() => setShowHelp((s) => !s)} style={{ background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontSize: 13, padding: 0, marginTop: 8, marginBottom: 8 }}>
        {showHelp ? "Hide status guide" : "What do the statuses mean?"}
      </button>
      {showHelp && (
        <div className="col" style={{ gap: 6, marginBottom: 8 }}>
          {DUTY_STATUSES.map((s) => (
            <div key={s} className="small" style={{ lineHeight: 1.4 }}>
              <span style={{ fontWeight: 700, color: STATUS_COLORS[s] }}>{STATUS_LABELS[s]}:</span>{" "}
              <span style={{ color: "var(--muted)" }}>{STATUS_HELP[s]}</span>
            </div>
          ))}
        </div>
      )}

      <div className="small" style={{ color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>RODS - tap the duty status</div>
      <div className="row wrap" style={{ gap: 8 }}>
        {DUTY_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className="btnPrimary"
            onClick={() => tap(s)}
            disabled={cur === s}
            style={{ opacity: cur === s ? 0.55 : 1 }}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
        <button type="button" className="btnPrimary" onClick={addNote} style={{ background: "transparent", color: "var(--text)", borderColor: "var(--border)" }}>+ Note</button>
      </div>
    </div>
  );
}
