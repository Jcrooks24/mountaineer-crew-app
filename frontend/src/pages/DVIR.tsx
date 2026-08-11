import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import SignaturePad, { type SignaturePadHandle } from "../components/SignaturePad";
import AppHeader from "../components/AppHeader";
import VehicleUnitSpecs from "../components/VehicleUnitSpecs";
import { getUnitsCached, refreshUnits, unitByName, type VehicleUnit } from "../lib/vehicleUnits";
import { loadJobSetup } from "../lib/jobSetupStore";

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
  defect_notes: string | null;
  driver_name: string;
  mechanic_signature: string | null;
  mechanic_name: string | null;
  mechanic_signed_at: string | null;
  repairs_made: boolean | null;
  mechanic_notes: string | null;
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

// Shared with App.tsx - the currently-selected job is stored here. DVIR pulls
// it directly from localStorage so a fresh DVIR auto-attaches to the job the
// crew is on, which is what puts DVIRs on the Admin Job Summary.
const ACTIVE_JOB_KEY = "crew_active_job_uuid_v1";
const JOB_NAME_PREFIX = "crew_job_name_v1:";

export default function DVIRPage() {
  const nav = useNavigate();
  const { user } = useAuth();

  // ── Attached job (optional, auto-picked from home screen selection) ───────
  const [attachedJobUuid, setAttachedJobUuid] = useState<string>("");
  const [attachedJobName, setAttachedJobName] = useState<string>("");
  useEffect(() => {
    try {
      const uuid = localStorage.getItem(ACTIVE_JOB_KEY) || "";
      setAttachedJobUuid(uuid);
      if (uuid) {
        setAttachedJobName(localStorage.getItem(JOB_NAME_PREFIX + uuid) || "");
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  // ── Units list ─────────────────────────────────────────────────────────────
  const [units, setUnits] = useState<string[]>([]);
  const [vehUnits, setVehUnits] = useState<VehicleUnit[]>(() => getUnitsCached());
  useEffect(() => { refreshUnits().then(setVehUnits).catch(() => {}); }, []);
  useEffect(() => {
    apiFetch<{ units: string[] }>("/api/dvir/units")
      .then((r) => setUnits(r.units))
      .catch(() => setUnits(["26INT", "24FR8", "16FORD"]));
  }, []);

  // ── Vehicle info ───────────────────────────────────────────────────────────
  const [vehicleNumber, setVehicleNumber] = useState("");

  // C1.3 (ADR 0034): default the unit from the job header's assigned truck when
  // this DVIR is attached to a job and the inspector hasn't picked one yet. Only
  // fills an empty field, so it never overrides a manual choice.
  useEffect(() => {
    if (!attachedJobUuid) return;
    let cancelled = false;
    loadJobSetup(attachedJobUuid)
      .then((h) => {
        const u = h?.vehicle_unit_names?.[0];
        if (!cancelled && u) setVehicleNumber((cur) => cur || u);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [attachedJobUuid]);

  const [odometer, setOdometer] = useState("");
  const [inspectionType, setInspectionType] = useState<"pre-trip" | "post-trip">("pre-trip");
  const [inspectionDate, setInspectionDate] = useState(todayLocal());

  // ── Previous DVIR review ───────────────────────────────────────────────────
  const [prevDVIR, setPrevDVIR] = useState<PrevDVIR | null>(null);
  const [prevLoading, setPrevLoading] = useState(false);
  const [prevReviewed, setPrevReviewed] = useState(false);

  function loadPrevDVIR(vehicle: string) {
    if (!vehicle) { setPrevDVIR(null); setPrevReviewed(false); return; }
    setPrevLoading(true);
    apiFetch<PrevDVIR | null>(`/api/dvir/latest-for-vehicle?vehicle_number=${encodeURIComponent(vehicle)}`)
      .then((r) => setPrevDVIR(r ?? null))
      .catch(() => setPrevDVIR(null))
      .finally(() => setPrevLoading(false));
  }

  useEffect(() => {
    setPrevReviewed(false);
    loadPrevDVIR(vehicleNumber);
  }, [vehicleNumber]);

  // True when previous DVIR has defects that haven't been mechanic-signed yet
  const prevHasOpenDefect =
    prevDVIR !== null &&
    prevDVIR.defects.length > 0 &&
    !prevDVIR.mechanic_signature;

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

  // ── Back-of-truck confirmation ─────────────────────────────────────────────
  const [backOfTruckConfirmed, setBackOfTruckConfirmed] = useState(false);
  // Post-trip only: truck left loaded overnight (client belongings or trash)
  const [overnightHold, setOvernightHold] = useState(false);

  // ── E-signature consent ────────────────────────────────────────────────────
  const [eSignConsent, setESignConsent] = useState(false);

  // ── Submit state ───────────────────────────────────────────────────────────
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<DVIRResponse | null>(null);

  const hasDefects = defects.size > 0;
  const condition = hasDefects ? "defects_noted" : "satisfactory";
  const [showDefectWarning, setShowDefectWarning] = useState(false);

  async function doSubmit() {
    setBusy(true);
    try {
      const res = await apiFetch<DVIRResponse>("/api/dvir", {
        method: "POST",
        body: JSON.stringify({
          dvir_id: newUUID(),
          vehicle_number: vehicleNumber,
          // Straight trucks only - no trailer, ever. Field removed from the form;
          // the column stays for back-compat but is always null now.
          trailer_number: null,
          odometer: odometer ? parseInt(odometer, 10) : null,
          inspection_type: inspectionType,
          inspection_date: inspectionDate,
          job_uuid: attachedJobUuid || null,
          defects: Array.from(defects),
          defect_notes: defectNotes.trim() || null,
          condition,
          back_of_truck_confirmed:
            inspectionType === "post-trip" && overnightHold ? null : backOfTruckConfirmed,
          overnight_hold: inspectionType === "post-trip" ? overnightHold : null,
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!vehicleNumber) return setErr("Select a vehicle unit.");
    if (!odometer.trim()) return setErr("Odometer reading is required.");
    if (!driverName.trim()) return setErr("Driver name is required.");
    if (hasDefects && !defectNotes.trim()) return setErr("Describe the defect(s) - defect notes are required when defects are checked.");
    if (prevDVIR && !prevReviewed)
      return setErr("You must confirm you have reviewed the previous inspection report.");
    if (inspectionType === "pre-trip" && !backOfTruckConfirmed) {
      return setErr(
        "Confirm you have checked the back of the truck for the job's gear before submitting."
      );
    }
    if (inspectionType === "post-trip" && !overnightHold && !backOfTruckConfirmed) {
      return setErr(
        "Confirm the back of the truck has been reset for the next crew, or mark the truck as held loaded overnight."
      );
    }
    if (sigRef.current?.isEmpty()) return setErr("Driver signature is required - please sign above.");
    if (!eSignConsent) return setErr("You must accept the electronic signature consent to submit.");

    // If defects noted, warn before submitting
    if (hasDefects) {
      setShowDefectWarning(true);
      return;
    }

    doSubmit();
  }

  // ── Success view ───────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="container">
        <AppHeader title="DVIR Submitted" onBack={() => nav("/")} />
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
            {submitted.condition === "satisfactory" ? "Satisfactory - No Defects" : "Defects Noted"}
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
                setOdometer("");
                setDefects(new Set());
                setDefectNotes("");
                setPrevDVIR(null);
                setPrevReviewed(false);
                setBackOfTruckConfirmed(false);
                setOvernightHold(false);
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

  // ── Open-defect block: mechanic must sign before new DVIR ──────────────────
  if (vehicleNumber && !prevLoading && prevHasOpenDefect) {
    return (
      <div className="container">
        <AppHeader title="DVIR" onBack={() => nav("/")} />
        <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>FMCSA 49 CFR §396.11</div>

        {/* Out-of-service warning */}
        <div style={{
          padding: "16px",
          borderRadius: 12,
          background: "rgba(255,107,107,0.12)",
          border: "2px solid var(--danger)",
          marginBottom: 16,
        }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--danger)", marginBottom: 6 }}>
            ⚠ Vehicle Out of Service - Open Defect
          </div>
          <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
            <strong>{vehicleNumber}</strong> has an unresolved defect from the last inspection on{" "}
            <strong>{prevDVIR!.inspection_date}</strong>. This vehicle must not be operated and a new DVIR
            cannot be submitted until a qualified mechanic reviews the defect, makes repairs as needed,
            and signs the report below.
          </div>
        </div>

        {/* Previous defective DVIR summary */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
            Defective DVIR - {prevDVIR!.inspection_type === "pre-trip" ? "Pre-Trip" : "Post-Trip"} · {prevDVIR!.inspection_date}
          </div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
            Driver: {prevDVIR!.driver_name}
          </div>
          <div style={{ marginBottom: prevDVIR!.defect_notes ? 8 : 0, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {prevDVIR!.defects.map((d) => (
              <span key={d} className="chip" style={{ fontSize: 11, background: "rgba(255,107,107,0.15)", color: "var(--danger)" }}>{d}</span>
            ))}
          </div>
          {prevDVIR!.defect_notes && (
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, fontStyle: "italic" }}>
              "{prevDVIR!.defect_notes}"
            </div>
          )}
        </div>

        {/* Contact admin - no inline sign-off on crew form */}
        <div className="card" style={{ textAlign: "center", padding: "20px 16px" }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Mechanic review required</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
            A qualified mechanic must review the defect, perform repairs as needed, and sign off
            on this report before <strong>{vehicleNumber}</strong> can return to service.
            <br /><br />
            Mechanic sign-off is completed by an admin in the <strong>Admin → DVIR Review</strong> tab.
            Once signed, return here to submit a new inspection for this vehicle.
          </div>
        </div>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <div className="container">
      <AppHeader title="DVIR" onBack={() => nav("/")} />
      <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>FMCSA 49 CFR §396.11</div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── Job attachment ── */}
        <div className="card">
          <div className="microLabel" style={{ marginBottom: 8 }}>Job</div>
          {attachedJobUuid ? (
            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {attachedJobName || "(unnamed job)"}
                </div>
                <div className="small mono" style={{ color: "var(--muted)", wordBreak: "break-all" }}>
                  {attachedJobUuid}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setAttachedJobUuid(""); setAttachedJobName(""); }}
                style={{ fontSize: 12 }}
              >
                Detach
              </button>
            </div>
          ) : (
            <div className="small" style={{ color: "var(--muted)" }}>
              No job attached - this DVIR will be filed as a standalone inspection.
              To attach, select a job on the home screen before starting the DVIR.
            </div>
          )}
        </div>

        {/* ── Vehicle Information ── */}
        <div className="card">
          <div className="microLabel" style={{ marginBottom: 12 }}>Vehicle Information</div>

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
            <VehicleUnitSpecs unit={unitByName(vehUnits, vehicleNumber)} />
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 10,
            marginBottom: 10,
          }}>
            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Odometer (miles) *</div>
              <input type="number" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="Required" min={0} required style={inputStyle} />
            </div>
          </div>

          {/* Date + Type - stack on phones (below ~360px column width) so
              the Pre-Trip / Post-Trip buttons don't crowd the date input.
              minWidth:0 on the cells lets the native date input shrink
              to match its cell instead of pushing the cell wider than the tile. */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
            marginBottom: 10,
          }}>
            <div style={{ minWidth: 0 }}>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Inspection Date *</div>
              <input type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} required style={inputStyle} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>Type *</div>
              <div style={{ display: "flex", gap: 8 }}>
                {(["pre-trip", "post-trip"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setInspectionType(t);
                      setBackOfTruckConfirmed(false);
                      setOvernightHold(false);
                    }}
                    style={{
                      flex: 1,
                      padding: "9px 6px",
                      borderRadius: 10,
                      border: inspectionType === t ? "2px solid var(--brand)" : "1px solid var(--border)",
                      background: inspectionType === t ? "color-mix(in srgb, var(--brand) 12%, transparent)" : "var(--card)",
                      color: inspectionType === t ? "var(--brand)" : "var(--muted)",
                      cursor: "pointer",
                      fontWeight: inspectionType === t ? 700 : 400,
                      fontSize: 13,
                      whiteSpace: "nowrap",
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
            <div className="microLabel" style={{ marginBottom: 6 }}>Previous Inspection Review</div>
            {prevLoading ? (
              <div className="small" style={{ color: "var(--muted)" }}>Loading previous report…</div>
            ) : prevDVIR ? (
              <>
                {/* This tile only renders when the vehicle is cleared to drive:
                    either the last inspection was satisfactory, or it had
                    defects that a mechanic has since signed off. (An unresolved
                    defect is intercepted by the out-of-service block above.)
                    So a defects-noted report here means "repaired & approved",
                    not "open defect" - surface that explicitly. */}
                {(() => {
                  const resolvedByMechanic =
                    prevDVIR.defects.length > 0 && !!prevDVIR.mechanic_signature;
                  return (
                    <div
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: "rgba(45,212,191,0.08)",
                        border: "1px solid rgba(45,212,191,0.25)",
                        marginBottom: 10,
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>
                        Last inspection: {prevDVIR.inspection_type === "pre-trip" ? "Pre-Trip" : "Post-Trip"} - {prevDVIR.inspection_date}
                      </div>
                      <div className="small" style={{ color: "var(--muted)", marginBottom: prevDVIR.defects.length > 0 ? 6 : 0 }}>
                        Driver: {prevDVIR.driver_name} ·{" "}
                        <span style={{ color: "var(--ok)", fontWeight: 600 }}>
                          {resolvedByMechanic
                            ? `${prevDVIR.defects.length} defect${prevDVIR.defects.length !== 1 ? "s" : ""} - repaired & approved`
                            : "Satisfactory"}
                        </span>
                      </div>
                      {prevDVIR.defects.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {prevDVIR.defects.map((d) => (
                            <span key={d} className="chip" style={{ fontSize: 11, background: "rgba(45,212,191,0.15)", color: "var(--ok)" }}>{d}</span>
                          ))}
                        </div>
                      )}
                      {resolvedByMechanic && (
                        <div
                          style={{
                            marginTop: 8,
                            paddingTop: 8,
                            borderTop: "1px solid rgba(45,212,191,0.2)",
                            fontSize: 12,
                            color: "var(--text)",
                            lineHeight: 1.5,
                          }}
                        >
                          <div style={{ fontWeight: 600, color: "var(--ok)" }}>
                            ✓ Approved for use by mechanic
                          </div>
                          <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                            {prevDVIR.mechanic_name || "Mechanic"}
                            {prevDVIR.mechanic_signed_at
                              ? ` · ${new Date(prevDVIR.mechanic_signed_at).toLocaleDateString()}`
                              : ""}
                            {prevDVIR.repairs_made === true
                              ? " · Repairs completed"
                              : prevDVIR.repairs_made === false
                                ? " · No repairs needed"
                                : ""}
                          </div>
                          {prevDVIR.mechanic_notes && (
                            <div style={{ marginTop: 4, fontStyle: "italic", color: "var(--muted)" }}>
                              "{prevDVIR.mechanic_notes}"
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
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
          <div className="microLabel" style={{ marginBottom: 4 }}>Inspection Checklist</div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>
            Check any item where a defect was found. Tap an item name to see what to inspect.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {INSPECTION_ITEMS.map((item) => {
              const checked = defects.has(item.name);   // checked === DEFECT
              const expanded = expandedItem === item.name;
              return (
                <div
                  key={item.name}
                  style={{
                    borderRadius: 6,
                    border: checked ? "1px solid var(--danger)" : "1px solid var(--border)",
                    background: checked ? "color-mix(in srgb, var(--danger) 8%, transparent)" : "transparent",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px 6px 10px" }}>
                    <span
                      style={{ flex: 1, minWidth: 0, fontSize: 13, color: checked ? "var(--danger)" : "var(--text)", fontWeight: checked ? 600 : 400, cursor: "pointer", userSelect: "none" }}
                      onClick={() => setExpandedItem(expanded ? null : item.name)}
                    >
                      {item.name}
                    </span>

                    {/* Explicit OK / DEFECT segmented toggle (Figma DVIR pattern):
                        larger touch targets and a clear state, vs a small
                        checkbox that silently means "defect". Same data model -
                        DEFECT = item in the `defects` set. */}
                    <div
                      role="group"
                      aria-label={`${item.name} condition`}
                      style={{ display: "flex", flexShrink: 0, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}
                    >
                      <button
                        type="button"
                        aria-pressed={!checked}
                        onClick={() => { if (checked) toggleDefect(item.name); }}
                        style={{
                          minWidth: 52, minHeight: 40, padding: "0 10px", border: "none", cursor: "pointer",
                          fontSize: 12, fontWeight: !checked ? 700 : 500, letterSpacing: "0.04em",
                          background: !checked ? "color-mix(in srgb, var(--ok) 16%, transparent)" : "transparent",
                          color: !checked ? "var(--ok)" : "var(--muted)",
                        }}
                      >
                        OK
                      </button>
                      <button
                        type="button"
                        aria-pressed={checked}
                        onClick={() => { if (!checked) toggleDefect(item.name); }}
                        style={{
                          minWidth: 62, minHeight: 40, padding: "0 10px", border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                          fontSize: 12, fontWeight: checked ? 700 : 500, letterSpacing: "0.04em",
                          background: checked ? "color-mix(in srgb, var(--danger) 16%, transparent)" : "transparent",
                          color: checked ? "var(--danger)" : "var(--muted)",
                        }}
                      >
                        DEFECT
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpandedItem(expanded ? null : item.name)}
                      style={{
                        background: "none", border: "none", color: "var(--muted)",
                        cursor: "pointer", fontSize: 14, lineHeight: 1,
                        width: 36, height: 40, padding: 0, flexShrink: 0,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}
                      aria-label="Toggle description"
                    >
                      {expanded ? "▲" : "▼"}
                    </button>
                  </div>
                  {expanded && (
                    <div style={{ padding: "0 10px 10px", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                      {item.desc}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Condition summary - dot + text (color only on the dot), count in mono. */}
          <div
            className="statusDot"
            style={{
              marginTop: 12,
              padding: "10px 2px",
              fontWeight: 600,
              ["--dot" as any]: hasDefects ? "var(--danger)" : "var(--ok)",
            }}
          >
            {hasDefects
              ? <span><span className="mono">{defects.size}</span> defect{defects.size !== 1 ? "s" : ""} noted - mechanic review required</span>
              : "No defects - vehicle in satisfactory condition"}
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
          <div className="microLabel" style={{ marginBottom: 4 }}>Driver Certification</div>
          <p className="small" style={{ color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
            I certify that this vehicle has been inspected in accordance with applicable requirements and to the best
            of my knowledge and belief, the above defects and deficiencies were not present, have been corrected, or
            need not be corrected.
          </p>

          <div style={{ marginBottom: 10 }}>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Driver Name *</div>
            <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Full name" required style={inputStyle} />
          </div>

          <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>Driver Signature * - sign below</div>
          <SignaturePad ref={sigRef} height={150} />
          <button
            type="button"
            onClick={() => sigRef.current?.clear()}
            style={{ marginTop: 6, background: "none", border: "none", color: "var(--muted)", fontSize: 12, cursor: "pointer", padding: 0 }}
          >
            Clear signature
          </button>
        </div>

        {/* ── Back-of-truck confirmation ── */}
        <div className="card">
          <div className="microLabel" style={{ marginBottom: 8 }}>
            Back of Truck Check *
          </div>
          {inspectionType === "pre-trip" ? (
            <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={backOfTruckConfirmed}
                onChange={(e) => setBackOfTruckConfirmed(e.target.checked)}
                style={{ marginTop: 3, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }}
              />
              <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>
                I have opened the back of the truck and confirmed that everything needed for the job is
                present and properly secured.
              </span>
            </label>
          ) : (
            <>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer", opacity: overnightHold ? 0.5 : 1 }}>
                <input
                  type="checkbox"
                  checked={backOfTruckConfirmed}
                  onChange={(e) => setBackOfTruckConfirmed(e.target.checked)}
                  disabled={overnightHold}
                  style={{ marginTop: 3, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>
                  I have opened the back of the truck and confirmed it contains the appropriate gear for
                  the next crew, everything is properly secured, the block heater is plugged in (in
                  winter), and the truck is clean and free of debris.
                </span>
              </label>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <input
                  type="checkbox"
                  checked={overnightHold}
                  onChange={(e) => {
                    setOvernightHold(e.target.checked);
                    if (e.target.checked) setBackOfTruckConfirmed(false);
                  }}
                  style={{ marginTop: 3, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>
                  Truck is being stowed overnight with a full load (client belongings to unload tomorrow
                  or trash for the dump) - back-of-truck reset does not apply.
                </span>
              </label>
            </>
          )}
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

      {/* ── Defect warning modal ── */}
      {showDefectWarning && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowDefectWarning(false); }}
        >
          <div style={{ background: "var(--card)", border: "2px solid var(--danger)", borderRadius: "var(--r, 14px)", padding: 24, maxWidth: 380, width: "100%", boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "var(--danger)" }}>⚠ Vehicle Will Be Placed Out of Service</div>
            <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.6 }}>
              You have noted <strong>{defects.size} defect{defects.size !== 1 ? "s" : ""}</strong> on this vehicle.
              Submitting this DVIR will flag <strong>{vehicleNumber}</strong> as out of service.
              <br /><br />
              The vehicle must not be operated until a mechanic reviews the defect and signs off in the admin dashboard.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                className="btnPrimary"
                onClick={() => { setShowDefectWarning(false); doSubmit(); }}
                style={{ fontSize: 14, background: "var(--danger)", borderColor: "var(--danger)" }}
              >
                Submit & place vehicle out of service
              </button>
              <button
                onClick={() => setShowDefectWarning(false)}
                style={{ padding: "10px 14px", borderRadius: "var(--btn-r, 12px)", border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontSize: 14, cursor: "pointer" }}
              >
                Go back and review
              </button>
            </div>
          </div>
        </div>
      )}
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

const outlineBtnStyle: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "none",
  color: "var(--text)",
  cursor: "pointer",
};
