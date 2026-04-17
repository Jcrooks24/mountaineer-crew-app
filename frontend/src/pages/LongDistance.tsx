import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import SignaturePad, { type SignaturePadHandle } from "../components/SignaturePad";

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function datesBefore(baseDate: string, days: number): string[] {
  const [y, m, d] = baseDate.split("-").map(Number);
  const base = new Date(y, (m || 1) - 1, d || 1);
  const out: string[] = [];
  for (let i = days; i >= 1; i--) {
    const dt = new Date(base);
    dt.setDate(dt.getDate() - i);
    out.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
  }
  return out;
}

function newUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function LongDistance() {
  const { user } = useAuth();
  const nav = useNavigate();

  const [tripDate, setTripDate] = useState(todayLocal());
  const [driverName, setDriverName] = useState(user?.name || "");
  const priorDates = useMemo(() => datesBefore(tripDate, 7), [tripDate]);
  const [dailyHours, setDailyHours] = useState<Record<string, string>>({});
  const [hoursLast24, setHoursLast24] = useState("0");
  const [eSignConsent, setESignConsent] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);

  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const totalLast7 = useMemo(
    () =>
      priorDates.reduce((s, d) => {
        const n = Number(dailyHours[d] ?? 0);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0),
    [priorDates, dailyHours],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!driverName.trim()) return setErr("Driver name is required.");
    for (const d of priorDates) {
      const raw = dailyHours[d];
      if (raw == null || raw === "") return setErr(`Enter hours for ${d} (use 0 if off-duty).`);
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 24) return setErr(`Hours for ${d} must be between 0 and 24.`);
    }
    const last24 = Number(hoursLast24);
    if (!Number.isFinite(last24) || last24 < 0 || last24 > 24)
      return setErr("Hours worked in the last 24 hours must be 0–24.");
    if (sigRef.current?.isEmpty()) return setErr("Signature is required.");
    if (!eSignConsent) return setErr("You must accept the electronic signature consent to submit.");

    setBusy(true);
    try {
      await apiFetch("/api/long-distance/prior-hours", {
        method: "POST",
        body: JSON.stringify({
          statement_id: newUUID(),
          driver_name: driverName.trim(),
          statement_date: tripDate,
          daily_hours: priorDates.map((d) => ({ date: d, hours: Number(dailyHours[d] || 0) })),
          hours_last_24: last24,
          signature: sigRef.current!.toDataURL(),
          signed_at: new Date().toISOString(),
        }),
      });
      setSubmitted(true);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Submission failed.");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="container">
        <div className="topbar" style={{ marginBottom: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Prior On-Duty Statement Submitted</span>
          <button onClick={() => nav(-1)} style={backBtnStyle}>← Back</button>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "32px 24px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: "var(--ok)", marginBottom: 6 }}>Statement on File</div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 20 }}>
            Total on-duty hours in the prior 7 days: <strong>{totalLast7.toFixed(2)}</strong>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              className="btnPrimary"
              onClick={() => {
                setSubmitted(false);
                setDailyHours({});
                setHoursLast24("0");
                setESignConsent(false);
                sigRef.current?.clear();
              }}
            >
              New statement
            </button>
            <button onClick={() => nav("/")}>Back to Jobs</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Long Distance Compliance</div>
          <div className="small" style={{ color: "var(--muted)" }}>FMCSR interstate-trip resources</div>
        </div>
        <button onClick={() => nav(-1)} style={backBtnStyle}>← Back</button>
      </div>

      {/* ── HOS rules summary ── */}
      <div className="card">
        <div className="sectionTitle">Hours of Service — Quick Reference</div>
        <div className="small" style={{ color: "var(--text)", lineHeight: 1.6 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>11-hour driving limit</strong> after 10 consecutive hours off-duty.</li>
            <li><strong>14-hour on-duty window</strong> — driving prohibited after 14 hours following the start of the day, even with off-duty breaks.</li>
            <li><strong>30-minute break</strong> after 8 cumulative hours of driving without a 30-minute interruption.</li>
            <li><strong>60/70-hour limit</strong> — 60 hrs / 7 days or 70 hrs / 8 days. Reset with 34+ consecutive hours off-duty.</li>
            <li><strong>Short-haul exception</strong> (§395.1(e)) — on-duty up to 14 hrs within a 150 air-mile radius from normal work reporting location, returning each day.</li>
            <li>When leaving the short-haul radius you must keep a <strong>paper RODS log</strong> for that day.</li>
          </ul>
          <div style={{ marginTop: 10, color: "var(--muted)" }}>
            When in doubt — call the office before crossing state lines.
          </div>
        </div>
      </div>

      {/* ── Prior On-Duty Hours Statement ── */}
      <div className="card">
        <div className="sectionTitle">Prior On-Duty Hours Statement</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Required by FMCSR §395.8(j)(2) before an interstate trip. Record total
          on-duty hours (driving + other work) for each of the 7 days immediately
          before this trip, plus hours worked in the last 24.
        </div>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Driver Name *</div>
            <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Full name" />
          </div>

          <div>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Trip Start Date *</div>
            <input type="date" value={tripDate} onChange={(e) => setTripDate(e.target.value)} />
          </div>

          <div>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>
              On-duty hours per day (last 7 days before trip) *
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {priorDates.map((d) => (
                <div key={d} className="row" style={{ gap: 10, justifyContent: "space-between" }}>
                  <span className="small" style={{ color: "var(--text)", minWidth: 110 }}>{d}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={24}
                    step={0.25}
                    value={dailyHours[d] ?? ""}
                    onChange={(e) => setDailyHours((prev) => ({ ...prev, [d]: e.target.value }))}
                    placeholder="0"
                    style={{ width: 100, textAlign: "right" }}
                  />
                </div>
              ))}
            </div>
            <div className="small" style={{ color: "var(--muted)", marginTop: 8, textAlign: "right" }}>
              7-day total: <strong style={{ color: "var(--text)" }}>{totalLast7.toFixed(2)} hrs</strong>
            </div>
          </div>

          <div>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>
              Hours worked in the 24 hours immediately before this trip *
            </div>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={24}
              step={0.25}
              value={hoursLast24}
              onChange={(e) => setHoursLast24(e.target.value)}
              style={{ width: 120 }}
            />
          </div>

          <div>
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

          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={eSignConsent}
              onChange={(e) => setESignConsent(e.target.checked)}
              style={{ marginTop: 3, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }}
            />
            <span style={{ lineHeight: 1.5, color: "var(--text)" }}>
              I certify the above record of on-duty hours is true and accurate. I understand my electronic
              signature is legally binding and equivalent to my handwritten signature.
            </span>
          </label>

          {err && (
            <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "rgba(255,107,107,0.1)", borderRadius: 8 }}>
              {err}
            </div>
          )}

          <button type="submit" className="btnPrimary" disabled={busy} style={{ marginBottom: 4 }}>
            {busy ? "Submitting…" : "Submit Prior On-Duty Statement"}
          </button>
        </form>
      </div>

      {/* ── RODS reference ── */}
      <div className="card">
        <div className="sectionTitle">Record of Duty Status (RODS)</div>
        <div className="small" style={{ color: "var(--text)", lineHeight: 1.6 }}>
          A paper RODS (graph grid) must be kept for any day you operate outside
          the 150 air-mile short-haul radius, or any day short-haul conditions
          are not met. The form is not yet fillable in the app — grab a blank
          RODS grid from the truck's compliance folder or print one from the
          FMCSA website.
          <div style={{ marginTop: 8 }}>
            <a
              href="https://www.fmcsa.dot.gov/sites/fmcsa.dot.gov/files/docs/regulations/hours-service/55616/hos-paper-graph-grid.pdf"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--brand)" }}
            >
              FMCSA — blank RODS paper grid (PDF)
            </a>
          </div>
        </div>
      </div>

      {/* ── FRN 82 FR 47306 (TRALA exemption) ── */}
      <div className="card">
        <div className="sectionTitle">FRN 82 FR 47306 — TRALA 150 Air-Mile Short-Haul Exemption</div>
        <div className="small" style={{ color: "var(--text)", lineHeight: 1.6 }}>
          Published by FMCSA in the Federal Register, this exemption applies to
          qualifying rental-truck drivers operating within 150 air miles of
          their normal work reporting location. Carry a copy in the cab when
          relying on it for a trip. Confirm your eligibility with the office
          before each long-distance move.
          <div style={{ marginTop: 8 }}>
            <a
              href="https://www.federalregister.gov/documents/2017/10/11/2017-22003/hours-of-service-of-drivers-truck-renting-and-leasing-association-trala-application-for-exemption"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--brand)" }}
            >
              Federal Register — 82 FR 47306
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

const backBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 13,
};
