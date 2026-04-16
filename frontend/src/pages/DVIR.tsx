import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import SignaturePad, { type SignaturePadHandle } from "../components/SignaturePad";

// FMCSA 49 CFR §396.11 inspection item categories
const INSPECTION_ITEMS = [
  "Air Brakes",
  "Brake Connections",
  "Coupling Devices",
  "Defroster / Heater",
  "Drive Line",
  "Emergency Equipment",
  "Engine",
  "Exhaust",
  "Fifth Wheel",
  "Frame & Assembly",
  "Front Axle",
  "Fuel Tanks",
  "Headlights",
  "Horn",
  "Lights (Brake / Tail / Clearance)",
  "Mirrors",
  "Rear End Protection",
  "Reflectors / Reflective Tape",
  "Safe Loading",
  "Steering",
  "Suspension",
  "Tires",
  "Wheels & Rims",
  "Windshield Wipers",
];

type DVIRResponse = {
  dvir_id: string;
  vehicle_number: string;
  inspection_type: string;
  inspection_date: string;
  condition: string;
};

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function newUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function DVIRPage() {
  const nav = useNavigate();
  const { user } = useAuth();

  // ── Vehicle ────────────────────────────────────────────────────────────────
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [trailerNumber, setTrailerNumber] = useState("");
  const [odometer, setOdometer] = useState("");
  const [inspectionType, setInspectionType] = useState<"pre-trip" | "post-trip">("pre-trip");
  const [inspectionDate, setInspectionDate] = useState(todayLocal());

  // ── Checklist ──────────────────────────────────────────────────────────────
  const [defects, setDefects] = useState<Set<string>>(new Set());
  const [defectNotes, setDefectNotes] = useState("");

  function toggleDefect(item: string) {
    setDefects((prev) => {
      const next = new Set(prev);
      next.has(item) ? next.delete(item) : next.add(item);
      return next;
    });
  }

  // ── Driver sig ─────────────────────────────────────────────────────────────
  const [driverName, setDriverName] = useState(user?.name || "");
  const sigRef = useRef<SignaturePadHandle>(null);

  // ── Submit state ───────────────────────────────────────────────────────────
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<DVIRResponse | null>(null);

  const hasDefects = defects.size > 0;
  const condition = hasDefects ? "defects_noted" : "satisfactory";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!vehicleNumber.trim()) return setErr("Vehicle / unit number is required.");
    if (!driverName.trim()) return setErr("Driver name is required.");
    if (sigRef.current?.isEmpty()) return setErr("Driver signature is required — please sign above.");

    setBusy(true);
    try {
      const res = await apiFetch<DVIRResponse>("/api/dvir", {
        method: "POST",
        body: JSON.stringify({
          dvir_id: newUUID(),
          vehicle_number: vehicleNumber.trim(),
          trailer_number: trailerNumber.trim() || null,
          odometer: odometer ? parseInt(odometer, 10) : null,
          inspection_type: inspectionType,
          inspection_date: inspectionDate,
          defects: Array.from(defects),
          defect_notes: defectNotes.trim() || null,
          condition,
          driver_name: driverName.trim(),
          driver_signature: sigRef.current!.toDataURL(),
          driver_signed_at: new Date().toISOString(),
        }),
      });
      setSubmitted(res);
    } catch (e: any) {
      setErr(e?.message ?? "Submission failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // ── Success view ───────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="container">
        <div className="topbar" style={{ marginBottom: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>DVIR Submitted</span>
          <button
            onClick={() => nav("/")}
            style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}
          >
            ← Back to Jobs
          </button>
        </div>

        <div className="card" style={{ textAlign: "center", padding: "32px 24px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6, color: "var(--ok)" }}>
            DVIR Recorded
          </div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 20 }}>
            {submitted.inspection_type === "pre-trip" ? "Pre-Trip" : "Post-Trip"} inspection for{" "}
            <strong>{submitted.vehicle_number}</strong> on {submitted.inspection_date}
          </div>
          <div
            className="chip"
            style={{
              display: "inline-block",
              marginBottom: 20,
              background: submitted.condition === "satisfactory" ? "rgba(45,212,191,0.15)" : "rgba(255,107,107,0.15)",
              color: submitted.condition === "satisfactory" ? "var(--ok)" : "var(--danger)",
            }}
          >
            {submitted.condition === "satisfactory" ? "Satisfactory — No Defects" : "Defects Noted"}
          </div>

          {submitted.condition === "defects_noted" && (
            <p className="small" style={{ color: "var(--muted)", marginBottom: 20 }}>
              This report is pending mechanic review and signature.
            </p>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              className="btnPrimary"
              onClick={() => {
                setSubmitted(null);
                setVehicleNumber("");
                setTrailerNumber("");
                setOdometer("");
                setDefects(new Set());
                setDefectNotes("");
                sigRef.current?.clear();
              }}
            >
              New DVIR
            </button>
            <button
              onClick={() => nav("/")}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "none",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              Back to Jobs
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <div className="container">
      {/* Header */}
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Driver Vehicle Inspection Report</div>
          <div className="small" style={{ color: "var(--muted)" }}>FMCSA 49 CFR §396.11</div>
        </div>
        <button
          onClick={() => nav("/")}
          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}
        >
          ← Back
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── Vehicle Information ── */}
        <div className="card">
          <div className="label" style={{ marginBottom: 12, fontWeight: 700 }}>Vehicle Information</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Unit / Truck # *</div>
              <input
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
                placeholder="e.g. T-101"
                required
                style={inputStyle}
              />
            </div>
            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Trailer #</div>
              <input
                value={trailerNumber}
                onChange={(e) => setTrailerNumber(e.target.value)}
                placeholder="Optional"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Odometer (miles)</div>
              <input
                type="number"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                placeholder="Optional"
                min={0}
                style={inputStyle}
              />
            </div>
            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Inspection Date *</div>
              <input
                type="date"
                value={inspectionDate}
                onChange={(e) => setInspectionDate(e.target.value)}
                required
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>Inspection Type *</div>
            <div style={{ display: "flex", gap: 10 }}>
              {(["pre-trip", "post-trip"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setInspectionType(t)}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    borderRadius: 10,
                    border: inspectionType === t ? "2px solid var(--brand)" : "1px solid var(--border)",
                    background: inspectionType === t ? "rgba(93,214,194,0.12)" : "var(--card)",
                    color: inspectionType === t ? "var(--brand)" : "var(--muted)",
                    cursor: "pointer",
                    fontWeight: inspectionType === t ? 700 : 400,
                    fontSize: 13,
                    textTransform: "capitalize",
                  }}
                >
                  {t === "pre-trip" ? "Pre-Trip" : "Post-Trip"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Inspection Checklist ── */}
        <div className="card">
          <div className="label" style={{ marginBottom: 4, fontWeight: 700 }}>
            Inspection Checklist
          </div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>
            Check any item where a defect was found.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {INSPECTION_ITEMS.map((item) => {
              const checked = defects.has(item);
              return (
                <label
                  key={item}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 10px",
                    borderRadius: 8,
                    border: checked ? "1px solid var(--danger)" : "1px solid var(--border)",
                    background: checked ? "rgba(255,107,107,0.08)" : "transparent",
                    cursor: "pointer",
                    fontSize: 13,
                    color: checked ? "var(--danger)" : "var(--text)",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleDefect(item)}
                    style={{ accentColor: "var(--danger)", width: 15, height: 15, cursor: "pointer" }}
                  />
                  {item}
                </label>
              );
            })}
          </div>

          {/* Condition summary */}
          <div
            style={{
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: 8,
              background: hasDefects ? "rgba(255,107,107,0.1)" : "rgba(45,212,191,0.1)",
              color: hasDefects ? "var(--danger)" : "var(--ok)",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {hasDefects
              ? `${defects.size} defect${defects.size !== 1 ? "s" : ""} noted — mechanic review required`
              : "No defects — vehicle in satisfactory condition"}
          </div>

          {/* Defect notes shown when any defect is checked */}
          {hasDefects && (
            <div style={{ marginTop: 10 }}>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Defect Description / Location</div>
              <textarea
                value={defectNotes}
                onChange={(e) => setDefectNotes(e.target.value)}
                placeholder="Describe the defect(s) and location…"
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>
          )}
        </div>

        {/* ── Driver Certification ── */}
        <div className="card">
          <div className="label" style={{ marginBottom: 4, fontWeight: 700 }}>Driver Certification</div>
          <p
            className="small"
            style={{ color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}
          >
            I certify that this vehicle has been inspected in accordance with applicable requirements and to
            the best of my knowledge and belief, the above defects and deficiencies were not present, have
            been corrected, or need not be corrected.
          </p>

          <div style={{ marginBottom: 10 }}>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Driver Name *</div>
            <input
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="Full name"
              required
              style={inputStyle}
            />
          </div>

          <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>
            Driver Signature * — sign below
          </div>
          <SignaturePad ref={sigRef} height={150} />
          <button
            type="button"
            onClick={() => sigRef.current?.clear()}
            style={{
              marginTop: 6,
              background: "none",
              border: "none",
              color: "var(--muted)",
              fontSize: 12,
              cursor: "pointer",
              padding: 0,
            }}
          >
            Clear signature
          </button>
        </div>

        {err && (
          <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "rgba(255,107,107,0.1)", borderRadius: 8 }}>
            {err}
          </div>
        )}

        <button
          type="submit"
          className="btnPrimary"
          disabled={busy}
          style={{ marginBottom: 32 }}
        >
          {busy ? "Submitting…" : "Submit DVIR"}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 14,
  boxSizing: "border-box",
};
