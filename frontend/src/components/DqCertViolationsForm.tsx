/**
 * Annual Driver's Certification of Violations - in-app fillable form (C4.2).
 * Collects the 391.27 data + a signature, generates the PDF on-device, and
 * uploads it to the driver's DQ file. First of the structured-form -> generated
 * PDF DQ forms.
 */
import { useRef, useState } from "react";
import SignaturePad, { type SignaturePadHandle } from "./SignaturePad";
import { uploadMyDq } from "../lib/dqStore";
import { generateCertViolationsPdf, type Violation } from "../lib/dqCertViolationsPdf";

function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function DqCertViolationsForm({
  driverName,
  onDone,
  onCancel,
}: {
  driverName: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(driverName || "");
  const [license, setLicense] = useState("");
  const [state, setState] = useState("");
  const [noViolations, setNoViolations] = useState(false);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [signedDate, setSignedDate] = useState(todayISO());
  const sigRef = useRef<SignaturePadHandle>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setV = (i: number, patch: Partial<Violation>) =>
    setViolations((prev) => prev.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const addV = () => setViolations((prev) => [...prev, { date: "", offense: "", location: "", vehicleType: "" }]);
  const rmV = (i: number) => setViolations((prev) => prev.filter((_, j) => j !== i));

  async function submit() {
    if (!name.trim()) { setErr("Enter your name."); return; }
    if (sigRef.current?.isEmpty()) { setErr("Sign in the box before submitting."); return; }
    if (!noViolations && violations.length === 0) {
      setErr("Add at least one violation, or tick 'No violations to report'.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const blob = await generateCertViolationsPdf({
        driverName: name.trim(),
        licenseNumber: license.trim(),
        licenseState: state.trim().toUpperCase(),
        noViolations,
        violations: noViolations ? [] : violations,
        signatureDataUrl: sigRef.current?.toDataURL() || "",
        signedDate,
      });
      const file = new File([blob], "annual_certification_of_violations.pdf", { type: "application/pdf" });
      await uploadMyDq(file, "annual_cert_violations");
      onDone();
    } catch (e: any) {
      setErr(e?.message ?? "Could not submit. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Annual Certification of Violations</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
          List any traffic violations (other than parking) you were convicted of in the past 12 months, or certify you had none. 49 CFR 391.27.
        </div>
      </div>

      <div className="row wrap" style={{ gap: 10 }}>
        <label className="col" style={{ gap: 2, flex: "1 1 180px" }}>
          <span className="small" style={{ color: "var(--muted)" }}>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="col" style={{ gap: 2, flex: "1 1 140px" }}>
          <span className="small" style={{ color: "var(--muted)" }}>Driver's license #</span>
          <input value={license} onChange={(e) => setLicense(e.target.value)} />
        </label>
        <label className="col" style={{ gap: 2, width: 90 }}>
          <span className="small" style={{ color: "var(--muted)" }}>State</span>
          <input value={state} onChange={(e) => setState(e.target.value)} maxLength={2} placeholder="MT" />
        </label>
      </div>

      <label className="row" style={{ gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={noViolations}
          onChange={(e) => setNoViolations(e.target.checked)}
        />
        <span className="small"><strong>No violations to report</strong> in the past 12 months</span>
      </label>

      {!noViolations && (
        <div className="col" style={{ gap: 8 }}>
          {violations.map((v, i) => (
            <div key={i} className="col" style={{ gap: 6, border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <label className="col" style={{ gap: 2, width: 150 }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Date of conviction</span>
                  <input type="date" value={v.date} onChange={(e) => setV(i, { date: e.target.value })} />
                </label>
                <label className="col" style={{ gap: 2, flex: "1 1 160px" }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Offense / violation</span>
                  <input value={v.offense} onChange={(e) => setV(i, { offense: e.target.value })} />
                </label>
              </div>
              <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
                <label className="col" style={{ gap: 2, flex: "1 1 160px" }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Location</span>
                  <input value={v.location} onChange={(e) => setV(i, { location: e.target.value })} />
                </label>
                <label className="col" style={{ gap: 2, flex: "1 1 140px" }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Type of vehicle</span>
                  <input value={v.vehicleType} onChange={(e) => setV(i, { vehicleType: e.target.value })} placeholder="Commercial / personal" />
                </label>
                <button type="button" onClick={() => rmV(i)} style={{ color: "var(--danger)", fontSize: 12 }}>Remove</button>
              </div>
            </div>
          ))}
          <button type="button" onClick={addV} style={{ alignSelf: "flex-start", fontSize: 13 }}>+ Add violation</button>
        </div>
      )}

      <div className="col" style={{ gap: 6 }}>
        <span className="small" style={{ color: "var(--muted)" }}>Signature</span>
        <SignaturePad ref={sigRef} />
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <button type="button" onClick={() => sigRef.current?.clear()} style={{ fontSize: 12 }}>Clear signature</button>
          <label className="row" style={{ gap: 6, alignItems: "center", marginLeft: "auto" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Date</span>
            <input type="date" value={signedDate} onChange={(e) => setSignedDate(e.target.value)} />
          </label>
        </div>
      </div>

      {err && <span className="small" style={{ color: "var(--danger)" }}>{err}</span>}

      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btnPrimary" onClick={submit} disabled={busy}>
          {busy ? "Submitting…" : "Sign & submit"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
