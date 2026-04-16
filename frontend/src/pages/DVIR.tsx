import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import SignaturePad, { type SignaturePadHandle } from "../components/SignaturePad";

// ── FMCSA 49 CFR §396.11 inspection items with descriptions ──────────────────
const INSPECTION_ITEMS: { name: string; desc: string }[] = [
  {
    name: "Air Brakes",
    desc: "Service brakes, parking brake, brake drums/rotors, hoses, tubing, air compressor, and low-pressure warning signal.",
  },
  {
    name: "Brake Connections",
    desc: "All brake connections, hoses, lines, and couplings for towed vehicles.",
  },
  {
    name: "Coupling Devices",
    desc: "Fifth wheel, kingpin, upper and lower plates, pintle hooks, drawbars, and fasteners.",
  },
  {
    name: "Defroster / Heater",
    desc: "Functioning defroster and heater controls; adequate airflow to windshield.",
  },
  {
    name: "Drive Line",
    desc: "Drive shafts, universal joints, hangers, center bearings, and all fasteners.",
  },
  {
    name: "Emergency Equipment",
    desc: "Fire extinguisher, three reflective triangles or flares, and first aid kit as required.",
  },
  {
    name: "Engine",
    desc: "Oil level, coolant level, belts, hoses, and engine mounts. No unusual noises, smoke, or leaks.",
  },
  {
    name: "Exhaust",
    desc: "Exhaust system for leaks, loose brackets, and proximity to fuel lines or wiring harness.",
  },
  {
    name: "Fifth Wheel",
    desc: "Upper and lower plate wear, locking jaw engagement, release arm position, and mounting bolts.",
  },
  {
    name: "Frame & Assembly",
    desc: "Frame rails, cross members, body mounts, and welds for cracks, bends, or damage.",
  },
  {
    name: "Front Axle",
    desc: "Axle beam, springs, spring hangers, U-bolts, steering knuckles, and drag links.",
  },
  {
    name: "Fuel Tanks",
    desc: "Mounting straps, fuel caps secured, visible leaks, and fuel line condition.",
  },
  {
    name: "Headlights",
    desc: "High and low beam function and aim; no cracked or missing lenses.",
  },
  {
    name: "Horn",
    desc: "City horn and air horn (if equipped) are audible and functional.",
  },
  {
    name: "Lights (Brake / Tail / Clearance)",
    desc: "All marker, clearance, tail, stop, and turn signal lights function properly.",
  },
  {
    name: "Mirrors",
    desc: "All mirrors properly mounted, clean, and adjusted for required fields of view.",
  },
  {
    name: "Rear End Protection",
    desc: "Rear impact guard (ICC bumper) securely mounted and undamaged.",
  },
  {
    name: "Reflectors / Reflective Tape",
    desc: "All required reflectors and reflective tape are present, clean, and visible.",
  },
  {
    name: "Safe Loading",
    desc: "Cargo properly distributed, secured, and within GVWR and axle weight limits.",
  },
  {
    name: "Steering",
    desc: "Steering wheel free play, column, gear box, pitman arm, tie rods, and drag links.",
  },
  {
    name: "Suspension",
    desc: "Leaf springs, spring hangers, U-bolts, shock absorbers, and air suspension bags.",
  },
  {
    name: "Tires",
    desc: "Tread depth (min 4/32\" steer axle, 2/32\" other axles), sidewall condition, inflation, and valve stems.",
  },
  {
    name: "Wheels & Rims",
    desc: "Rims and discs for cracks or damage, lug nut torque, spacers, and wheel seals.",
  },
  {
    name: "Windshield Wipers",
    desc: "Wiper blade condition, fluid reservoir level, and motor operation on all speeds.",
  },
];

type PrevDVIR = {
  dvir_id: string;
  inspection_date: string;
  inspection_type: string;
  condition: string;
  defects: string[];
  driver_name: string;
};

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

  // ── Units list ─────────────────────────────────────────────────────────────
  const [units, setUnits] = useState<string[]>([]);
  useEffect(() => {
    apiFetch<{ units: string[] }>("/api/dvir/units")
      .then((r) => setUnits(r.units))
      .catch(() => setUnits(["26INT", "24FR8", "16FORD"]));
  }, []);

  // ── Vehicle info ───────────────────────────────────────────────────────────
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [trailerNumber, setTrailerNumber] = useState("");
  const [odometer, setOdometer] = useState("");
  const [inspectionType, setInspectionType] = useState<"pre-trip" | "post-trip">("pre-trip");
  const [inspectionDate, setInspectionDate] = useState(todayLocal());

  // ── Previous DVIR review ───────────────────────────────────────────────────
  const [prevDVIR, setPrevDVIR] = useState<PrevDVIR | null>(null);
  const [prevLoading, setPrevLoading] = useState(false);
  const [prevReviewed, setPrevReviewed] = useState(false);

  useEffect(() => {
    if (!vehicleNumber) { setPrevDVIR(null); setPrevReviewed(false); return; }
    setPrevLoading(true);
    setPrevReviewed(false);
    apiFetch<PrevDVIR | null>(`/api/dvir/latest-for-vehicle?vehicle_number=${encodeURIComponent(vehicleNumber)}`)
      .then((r) => setPrevDVIR(r ?? null))
      .catch(() => setPrevDVIR(null))
      .finally(() => setPrevLoading(false));
  }, [vehicleNumber]);

  // ── Checklist ──────────────────────────────────────────────────────────────
  const [defects, setDefects] = useState<Set<string>>(new Set());
  const [defectNotes, setDefectNotes] = useState("");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  function toggleDefect(name: string) {
    setDefects((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  // ── Driver sig ─────────────────────────────────────────────────────────────
  const [driverName, setDriverName] = useState(user?.name || "");
  const sigRef = useRef<SignaturePadHandle>(null);

  // ── E-signature consent ────────────────────────────────────────────────────
  const [eSignConsent, setESignConsent] = useState(false);

  // ── Submit state ───────────────────────────────────────────────────────────
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<DVIRResponse | null>(null);

  const hasDefects = defects.size > 0;
  const condition = hasDefects ? "defects_noted" : "satisfactory";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!vehicleNumber) return setErr("Select a vehicle unit.");
    if (!driverName.trim()) return setErr("Driver name is required.");
    if (prevDVIR && !prevReviewed)
      return setErr("You must confirm you have reviewed the previous inspection report.");
    if (sigRef.current?.isEmpty()) return setErr("Driver signature is required — please sign above.");
    if (!eSignConsent) return setErr("You must accept the electronic signature consent to submit.");

    setBusy(true);
    try {
      const res = await apiFetch<DVIRResponse>("/api/dvir", {
        method: "POST",
        body: JSON.stringify({
          dvir_id: newUUID(),
          vehicle_number: vehicleNumber,
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
      const msg = e?.message ?? "Submission failed.";
      setErr(
        msg === "Failed to fetch"
          ? "Cannot reach the server. Check your connection or try again."
          : msg
      );
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
          <button onClick={() => nav("/")} style={backBtnStyle}>← Back to Jobs</button>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "32px 24px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6, color: "var(--ok)" }}>DVIR Recorded</div>
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
                setPrevDVIR(null);
                setPrevReviewed(false);
                setESignConsent(false);
                sigRef.current?.clear();
              }}
            >
              New DVIR
            </button>
            <button onClick={() => nav("/")} style={outlineBtnStyle}>Back to Jobs</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <div className="container">
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Driver Vehicle Inspection Report</div>
          <div className="small" style={{ color: "var(--muted)" }}>FMCSA 49 CFR §396.11</div>
        </div>
        <button onClick={() => nav("/")} style={backBtnStyle}>← Back</button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── Vehicle Information ── */}
        <div className="card">
          <div className="label" style={{ marginBottom: 12, fontWeight: 700 }}>Vehicle Information</div>

          <div style={{ marginBottom: 10 }}>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Unit *</div>
            <select
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value)}
              required
              style={selectStyle}
            >
              <option value="">Select unit…</option>
              {units.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Trailer #</div>
              <input value={trailerNumber} onChange={(e) => setTrailerNumber(e.target.value)} placeholder="Optional" style={inputStyle} />
            </div>
            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Odometer (miles)</div>
              <input type="number" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="Optional" min={0} style={inputStyle} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Inspection Date *</div>
              <input type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} required style={inputStyle} />
            </div>
            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>Type *</div>
              <div style={{ display: "flex", gap: 8 }}>
                {(["pre-trip", "post-trip"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setInspectionType(t)}
                    style={{
                      flex: 1,
                      padding: "9px 0",
                      borderRadius: 10,
                      border: inspectionType === t ? "2px solid var(--brand)" : "1px solid var(--border)",
                      background: inspectionType === t ? "rgba(93,214,194,0.12)" : "var(--card)",
                      color: inspectionType === t ? "var(--brand)" : "var(--muted)",
                      cursor: "pointer",
                      fontWeight: inspectionType === t ? 700 : 400,
                      fontSize: 12,
                    }}
                  >
                    {t === "pre-trip" ? "Pre-Trip" : "Post-Trip"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Previous DVIR Review ── */}
        {vehicleNumber && (
          <div className="card">
            <div className="label" style={{ fontWeight: 700, marginBottom: 6 }}>Previous Inspection Review</div>
            {prevLoading ? (
              <div className="small" style={{ color: "var(--muted)" }}>Loading previous report…</div>
            ) : prevDVIR ? (
              <>
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: prevDVIR.condition === "satisfactory" ? "rgba(45,212,191,0.08)" : "rgba(255,107,107,0.08)",
                    border: `1px solid ${prevDVIR.condition === "satisfactory" ? "rgba(45,212,191,0.25)" : "rgba(255,107,107,0.25)"}`,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>
                    Last inspection: {prevDVIR.inspection_type === "pre-trip" ? "Pre-Trip" : "Post-Trip"} — {prevDVIR.inspection_date}
                  </div>
                  <div className="small" style={{ color: "var(--muted)", marginBottom: prevDVIR.defects.length > 0 ? 6 : 0 }}>
                    Driver: {prevDVIR.driver_name} ·{" "}
                    <span style={{ color: prevDVIR.condition === "satisfactory" ? "var(--ok)" : "var(--danger)", fontWeight: 600 }}>
                      {prevDVIR.condition === "satisfactory" ? "Satisfactory" : `${prevDVIR.defects.length} defect${prevDVIR.defects.length !== 1 ? "s" : ""} noted`}
                    </span>
                  </div>
                  {prevDVIR.defects.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {prevDVIR.defects.map((d) => (
                        <span key={d} className="chip" style={{ fontSize: 11, background: "rgba(255,107,107,0.15)", color: "var(--danger)" }}>{d}</span>
                      ))}
                    </div>
                  )}
                </div>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={prevReviewed}
                    onChange={(e) => setPrevReviewed(e.target.checked)}
                    style={{ marginTop: 2, accentColor: "var(--brand)", width: 16, height: 16, flexShrink: 0 }}
                  />
                  <span>
                    I have reviewed the most recent inspection report for <strong>{vehicleNumber}</strong> and confirm the vehicle is in safe operating condition.
                  </span>
                </label>
              </>
            ) : (
              <div className="small" style={{ color: "var(--muted)" }}>
                No previous inspection on file for {vehicleNumber}. This will be the first record.
              </div>
            )}
          </div>
        )}

        {/* ── Inspection Checklist ── */}
        <div className="card">
          <div className="label" style={{ marginBottom: 4, fontWeight: 700 }}>Inspection Checklist</div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>
            Check any item where a defect was found. Tap an item name to see what to inspect.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {INSPECTION_ITEMS.map((item) => {
              const checked = defects.has(item.name);
              const expanded = expandedItem === item.name;
              return (
                <div
                  key={item.name}
                  style={{
                    borderRadius: 8,
                    border: checked ? "1px solid var(--danger)" : "1px solid var(--border)",
                    background: checked ? "rgba(255,107,107,0.06)" : "transparent",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDefect(item.name)}
                      style={{ accentColor: "var(--danger)", width: 16, height: 16, flexShrink: 0, cursor: "pointer" }}
                    />
                    <span
                      style={{ flex: 1, fontSize: 13, color: checked ? "var(--danger)" : "var(--text)", fontWeight: checked ? 600 : 400, cursor: "pointer", userSelect: "none" }}
                      onClick={() => setExpandedItem(expanded ? null : item.name)}
                    >
                      {item.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedItem(expanded ? null : item.name)}
                      style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}
                      aria-label="Toggle description"
                    >
                      {expanded ? "▲" : "▼"}
                    </button>
                  </div>
                  {expanded && (
                    <div style={{ padding: "0 10px 10px 34px", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                      {item.desc}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Condition summary */}
          <div
            style={{
              marginTop: 12,
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
          <p className="small" style={{ color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
            I certify that this vehicle has been inspected in accordance with applicable requirements and to the best
            of my knowledge and belief, the above defects and deficiencies were not present, have been corrected, or
            need not be corrected.
          </p>

          <div style={{ marginBottom: 10 }}>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Driver Name *</div>
            <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Full name" required style={inputStyle} />
          </div>

          <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>Driver Signature * — sign below</div>
          <SignaturePad ref={sigRef} height={150} />
          <button
            type="button"
            onClick={() => sigRef.current?.clear()}
            style={{ marginTop: 6, background: "none", border: "none", color: "var(--muted)", fontSize: 12, cursor: "pointer", padding: 0 }}
          >
            Clear signature
          </button>
        </div>

        {/* ── E-signature consent ── */}
        <div className="card">
          <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={eSignConsent}
              onChange={(e) => setESignConsent(e.target.checked)}
              style={{ marginTop: 3, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }}
            />
            <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>
              I understand and agree that my electronic signature is legally binding and equivalent to my handwritten
              signature for the purposes of this Driver Vehicle Inspection Report.
            </span>
          </label>
        </div>

        {err && (
          <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "rgba(255,107,107,0.1)", borderRadius: 8 }}>
            {err}
          </div>
        )}

        <button type="submit" className="btnPrimary" disabled={busy} style={{ marginBottom: 32 }}>
          {busy ? "Submitting…" : "Submit DVIR"}
        </button>
      </form>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

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

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "auto",
};

const backBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 13,
};

const outlineBtnStyle: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "none",
  color: "var(--text)",
  cursor: "pointer",
};
