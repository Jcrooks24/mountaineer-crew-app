/**
 * Road Test documents - in-app fill (C4.3). Office-filled: an examiner completes
 * the form (variant "form") or the certificate (variant "certificate") for a
 * driver from the admin DQ tab. Structured form -> generated PDF -> the driver's
 * DQ file.
 */
import { useRef, useState } from "react";
import SignaturePad, { type SignaturePadHandle } from "./SignaturePad";
import { adminUploadDq } from "../lib/dqStore";
import {
  ROAD_TEST_OPERATIONS,
  generateRoadTestFormPdf,
  generateRoadTestCertPdf,
} from "../lib/dqRoadTestPdf";

const RATINGS = ["Satisfactory", "Unsatisfactory", "N/A"];

function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function DqRoadTest({
  variant,
  driverName,
  userId,
  onDone,
  onCancel,
}: {
  variant: "form" | "certificate";
  driverName: string;
  userId: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const isForm = variant === "form";
  const [testDate, setTestDate] = useState(todayISO());
  const [vehicleType, setVehicleType] = useState("");
  const [ratings, setRatings] = useState<string[]>(() => ROAD_TEST_OPERATIONS.map(() => "Satisfactory"));
  const [remarks, setRemarks] = useState("");
  const [license, setLicense] = useState("");
  const [state, setState] = useState("");
  const [powerUnit, setPowerUnit] = useState("");
  const [miles, setMiles] = useState("");
  const [examiner, setExaminer] = useState("");
  const [examinerTitle, setExaminerTitle] = useState("");
  const [signedDate, setSignedDate] = useState(todayISO());
  const sigRef = useRef<SignaturePadHandle>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!examiner.trim()) { setErr("Enter the examiner's name."); return; }
    if (sigRef.current?.isEmpty()) { setErr("The examiner must sign before submitting."); return; }
    setBusy(true);
    setErr(null);
    try {
      const sig = sigRef.current?.toDataURL() || "";
      let blob: Blob;
      let docType: string;
      let filename: string;
      if (isForm) {
        blob = await generateRoadTestFormPdf({
          driverName,
          testDate,
          vehicleType: vehicleType.trim(),
          ratings: ROAD_TEST_OPERATIONS.map((operation, i) => ({ operation, rating: ratings[i] })),
          remarks,
          examinerName: examiner.trim(),
          examinerTitle: examinerTitle.trim(),
          signatureDataUrl: sig,
          signedDate,
        });
        docType = "road_test_form";
        filename = "driver_road_test_form.pdf";
      } else {
        blob = await generateRoadTestCertPdf({
          driverName,
          licenseNumber: license.trim(),
          licenseState: state.trim().toUpperCase(),
          powerUnitType: powerUnit.trim(),
          testDate,
          miles: miles.trim(),
          examinerName: examiner.trim(),
          examinerTitle: examinerTitle.trim(),
          signatureDataUrl: sig,
          signedDate,
        });
        docType = "road_test_certificate";
        filename = "driver_road_test_certificate.pdf";
      }
      const file = new File([blob], filename, { type: "application/pdf" });
      await adminUploadDq(file, userId, docType);
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
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          {isForm ? "Driver's Road Test" : "Driver's Road Test Certificate"}
        </div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
          For {driverName || "this driver"}. 49 CFR 391.31.
        </div>
      </div>

      <label className="col" style={{ gap: 2, width: 170 }}>
        <span className="small" style={{ color: "var(--muted)" }}>Date of test</span>
        <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} />
      </label>

      {isForm ? (
        <>
          <label className="col" style={{ gap: 2, flex: "1 1 200px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Type of vehicle</span>
            <input value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} />
          </label>
          <div className="col" style={{ gap: 6 }}>
            <span className="small" style={{ color: "var(--muted)", fontWeight: 700 }}>Evaluation</span>
            {ROAD_TEST_OPERATIONS.map((op, i) => (
              <div key={op} className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span className="small" style={{ minWidth: 0 }}>{op}</span>
                <select
                  value={ratings[i]}
                  onChange={(e) => setRatings((prev) => prev.map((r, j) => (j === i ? e.target.value : r)))}
                  style={{ flexShrink: 0 }}
                >
                  {RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            ))}
          </div>
          <label className="col" style={{ gap: 2 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Remarks</span>
            <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
          </label>
        </>
      ) : (
        <>
          <div className="row wrap" style={{ gap: 10 }}>
            <label className="col" style={{ gap: 2, flex: "1 1 140px" }}>
              <span className="small" style={{ color: "var(--muted)" }}>Driver's license #</span>
              <input value={license} onChange={(e) => setLicense(e.target.value)} />
            </label>
            <label className="col" style={{ gap: 2, width: 90 }}>
              <span className="small" style={{ color: "var(--muted)" }}>State</span>
              <input value={state} onChange={(e) => setState(e.target.value)} maxLength={2} placeholder="MT" />
            </label>
          </div>
          <div className="row wrap" style={{ gap: 10 }}>
            <label className="col" style={{ gap: 2, flex: "1 1 180px" }}>
              <span className="small" style={{ color: "var(--muted)" }}>Type of power unit</span>
              <input value={powerUnit} onChange={(e) => setPowerUnit(e.target.value)} />
            </label>
            <label className="col" style={{ gap: 2, width: 120 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Approx. miles</span>
              <input value={miles} onChange={(e) => setMiles(e.target.value)} inputMode="numeric" />
            </label>
          </div>
        </>
      )}

      <div className="row wrap" style={{ gap: 10 }}>
        <label className="col" style={{ gap: 2, flex: "1 1 160px" }}>
          <span className="small" style={{ color: "var(--muted)" }}>Examiner name</span>
          <input value={examiner} onChange={(e) => setExaminer(e.target.value)} />
        </label>
        <label className="col" style={{ gap: 2, flex: "1 1 140px" }}>
          <span className="small" style={{ color: "var(--muted)" }}>Examiner title</span>
          <input value={examinerTitle} onChange={(e) => setExaminerTitle(e.target.value)} />
        </label>
      </div>

      <div className="col" style={{ gap: 6 }}>
        <span className="small" style={{ color: "var(--muted)" }}>Examiner's signature</span>
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
