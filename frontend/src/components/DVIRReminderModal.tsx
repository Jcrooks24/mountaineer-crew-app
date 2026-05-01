import { useNavigate } from "react-router-dom";

type Trigger = "pre-trip" | "post-trip" | "report";

type Props = {
  trigger: Trigger;
  onProceed: () => void;   // "Already done" or "N/A"
  onCancel: () => void;    // close without action
};

const COPY: Record<Trigger, { heading: string; body: string; multiJob: string }> = {
  "pre-trip": {
    heading: "Pre-trip inspection",
    body: "Has the driver completed a pre-trip DVIR for the vehicle being used on this job?",
    multiJob: "Already pre-tripped for an earlier job today",
  },
  "post-trip": {
    heading: "Post-trip inspection",
    body: "Has the driver completed a post-trip DVIR for the vehicle used on this job?",
    multiJob: "Multiple jobs today — final DVIR at end of last job",
  },
  "report": {
    heading: "DVIR required",
    body: "Before submitting this report, confirm that the driver has completed a Driver Vehicle Inspection Report for any truck used on this job.",
    multiJob: "Multiple jobs today — final DVIR at end of last job",
  },
};

export default function DVIRReminderModal({ trigger, onProceed, onCancel }: Props) {
  const nav = useNavigate();
  const { heading, body, multiJob } = COPY[trigger];

  function goToDVIR() {
    onCancel();          // close modal first
    nav("/dvir");
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r, 14px)",
        padding: 24,
        maxWidth: 380,
        width: "100%",
        boxShadow: "var(--shadow)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              DVIR Reminder
            </div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{heading}</div>
          </div>
          <button
            onClick={onCancel}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 20, lineHeight: 1, padding: 0, flexShrink: 0 }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>
          {body}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            className="btnPrimary"
            onClick={goToDVIR}
            style={{ fontSize: 14 }}
          >
            Complete DVIR now
          </button>

          <button
            onClick={onProceed}
            style={{
              padding: "10px 14px", borderRadius: "var(--btn-r, 12px)",
              border: "1px solid var(--border)",
              background: "transparent", color: "var(--text)",
              fontSize: 14, cursor: "pointer",
            }}
          >
            Already completed ✓
          </button>

          <button
            onClick={onProceed}
            style={{
              padding: "10px 14px", borderRadius: "var(--btn-r, 12px)",
              border: "1px solid var(--border)",
              background: "transparent", color: "var(--text)",
              fontSize: 13, cursor: "pointer", lineHeight: 1.3,
            }}
          >
            {multiJob}
          </button>

          <button
            onClick={onProceed}
            style={{
              padding: "10px 14px", borderRadius: "var(--btn-r, 12px)",
              border: "1px solid var(--border)",
              background: "transparent", color: "var(--muted)",
              fontSize: 14, cursor: "pointer",
            }}
          >
            N/A — no truck used
          </button>
        </div>
      </div>
    </div>
  );
}
