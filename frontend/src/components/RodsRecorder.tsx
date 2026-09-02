import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  todayLocal,
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
  weightSlot,
}: {
  events?: MinEvent[];
  onLogEvent?: (type: string, note?: string | null) => void;
  actionsSlot?: ReactNode;
  /** The Weight control. Rendered in its own subsection at the bottom (see
   *  there) so it reaches a drive day, which is when the truck is usually
   *  weighed. */
  weightSlot?: ReactNode;
}) {
  const { user } = useAuth();
  const me = user?.name || user?.email || "";
  const [showHelp, setShowHelp] = useState(false);
  const [loggingFor, setLoggingFor] = useState<string>(me);
  // Hydrate once when `me` first becomes truthy (auth loads after mount).
  // Do NOT re-hydrate every time `loggingFor` becomes empty - that made
  // the field un-clearable: as soon as the crew backspaced the current
  // name to type another, the effect jammed the current user's name back
  // in and swallowed further keystrokes.
  const hydratedRef = useRef<boolean>(!!me);
  useEffect(() => {
    if (me && !hydratedRef.current) {
      hydratedRef.current = true;
      setLoggingFor((prev) => prev || me);
    }
  }, [me]);

  const driver = (loggingFor || "").trim() || me;
  // Filter to TODAY: on a multi-day trip, an un-dated reconstruction sorts all
  // days by time-of-day, so a prior night's last "Off Duty" tap wins and the
  // status shows stuck on Off Duty. today = the local RODS day.
  const cur = useMemo(() => currentStatus(changesForDriver(events, driver, me, todayLocal())), [events, driver, me]);

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
    <div className="card" data-component="RodsRecorder" style={{ borderColor: "var(--brand)" }}>
      {/* Title changes when the tile also hosts the "Actions - job labor"
          slot on mixed drive+labor days - "Record of Duty Status" alone is
          misleading in that case. */}
      <div className="microLabel" style={{ marginBottom: 10 }}>
        {actionsSlot ? "Timeline actions" : "Record of Duty Status - driver"}
      </div>

      {actionsSlot && (
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
          <div className="microLabel" style={{ marginBottom: 10 }}>Actions - job labor</div>
          {actionsSlot}
        </div>
      )}

      <div
        style={{
          display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", margin: "12px 0",
          borderRadius: 8, borderLeft: `5px solid ${cur ? STATUS_COLORS[cur] : "var(--border)"}`,
          // Deeper fill so the "Current status" label reads on both dark
          // and light themes (the prior 0.04 was invisible on light).
          // Tint by the current duty-status color so it follows the theme.
          background: cur
            ? `color-mix(in srgb, ${STATUS_COLORS[cur]} 10%, transparent)`
            : "color-mix(in srgb, var(--muted) 8%, transparent)",
          border: "1px solid var(--border)",
          borderLeftWidth: 5,
          borderLeftColor: cur ? STATUS_COLORS[cur] : "var(--border)",
          borderLeftStyle: "solid",
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: cur ? STATUS_COLORS[cur] : "var(--muted)", flexShrink: 0 }} />
        <div>
          <div className="small" style={{ color: "var(--text)", opacity: 0.7 }}>Current status</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: cur ? STATUS_COLORS[cur] : "var(--text)" }}>
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

      <div className="microLabel" style={{ marginBottom: 10 }}>RODS - tap the duty status</div>
      <div className="seg" style={{ marginBottom: 8 }}>
        {DUTY_STATUSES.map((s) => {
          const active = cur === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              className={"segBtn" + (active ? " on" : "")}
              style={{ ["--seg" as any]: STATUS_COLORS[s] }}
              onClick={() => tap(s)}
              disabled={active}
            >
              {STATUS_LABELS[s]}
            </button>
          );
        })}
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className="btnPrimary" onClick={addNote} style={{ background: "transparent", color: "var(--text)", borderColor: "var(--border)" }}>+ Note</button>
      </div>

      {/* Scale weight. Its own subsection rather than part of the labor Actions
          slot above: a certified weight is a scale reading, not labor, and the
          day it is most often taken is a DRIVE day - the truck is loaded one
          evening and weighed the next morning before pulling out. It used to
          render only where the labor Actions rendered, so on a pure drive day
          there was nowhere to record it at all (bug 4ead0d74). */}
      {weightSlot && (
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
          <div className="microLabel" style={{ marginBottom: 10 }}>Scale weight</div>
          {weightSlot}
        </div>
      )}
    </div>
  );
}
