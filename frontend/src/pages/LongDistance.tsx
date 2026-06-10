import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import SignaturePad, { type SignaturePadHandle } from "../components/SignaturePad";

type Section = "menu" | "prior" | "rods" | "hos" | "trala";

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function newUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

export default function LongDistance() {
  const nav = useNavigate();
  const [section, setSection] = useState<Section>("menu");

  if (section === "prior") return <PriorOnDutyForm onBack={() => setSection("menu")} />;
  if (section === "rods") return <RODSForm onBack={() => setSection("menu")} />;

  return (
    <div className="container">
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Long Distance Compliance</div>
          <div className="small" style={{ color: "var(--muted)" }}>FMCSR interstate-trip resources</div>
        </div>
        <button onClick={() => nav(-1)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>
          ← Back
        </button>
      </div>

      <div className="card">
        <div className="sectionTitle">Hours of Service — Quick Reference</div>
        <div className="small" style={{ color: "var(--text)", lineHeight: 1.6 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>11-hour driving limit</strong> after 10 consecutive hours off-duty.</li>
            <li><strong>14-hour on-duty window</strong> — driving prohibited after 14 hours following the start of the day, even with off-duty breaks.</li>
            <li><strong>30-minute break</strong> after 8 cumulative hours of driving without a 30-minute interruption.</li>
            <li><strong>60/70-hour limit</strong> — 60 hrs / 7 days or 70 hrs / 8 days. Reset with 34+ consecutive hours off-duty.</li>
            <li><strong>Short-haul exception</strong> (§395.1(e)) — on-duty up to 14 hrs within a 150 air-mile radius from normal work reporting location, returning each day.</li>
            <li>When leaving the short-haul radius you must keep a <strong>paper RODS log</strong> for that day (or use the in-app RODS below).</li>
          </ul>
          <div style={{ marginTop: 10, color: "var(--muted)" }}>
            When in doubt — call the office before crossing state lines.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="sectionTitle">Forms</div>
        <div className="col" style={{ gap: 8 }}>
          <button onClick={() => setSection("prior")} style={{ textAlign: "left" }}>
            <div style={{ fontWeight: 700 }}>Prior On-Duty Hours Statement</div>
            <div className="small" style={{ color: "var(--muted)" }}>
              Required before an interstate trip (§395.8(j)(2)).
            </div>
          </button>
          <button onClick={() => setSection("rods")} style={{ textAlign: "left" }}>
            <div style={{ fontWeight: 700 }}>Record of Duty Status (RODS)</div>
            <div className="small" style={{ color: "var(--muted)" }}>
              Fill and sign your daily log on the phone — no paper.
            </div>
          </button>
        </div>
      </div>

      <div className="card">
        <div className="sectionTitle">TRALA Rental-Truck Exemption — 82 FR 47306</div>
        <div className="small" style={{ color: "var(--text)", lineHeight: 1.6 }}>
          Published by FMCSA in the Federal Register (Oct 11, 2017), this exemption covers
          drivers operating a rental truck on our behalf during out-of-state moves. Carry a
          copy of the exemption in the cab, and confirm eligibility with the office before
          dispatch.
          <div style={{ marginTop: 10 }}>
            <strong>When it applies to us:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li>The vehicle is a rental truck (CDL not required for class) operated for a Mountaineer customer.</li>
              <li>The trip crosses state lines — this is the out-of-state use case we rely on.</li>
              <li>Office has confirmed the exemption applies to this specific move before departure.</li>
            </ul>
          </div>
          <div style={{ marginTop: 10 }}>
            <strong>When it doesn't cover you — use RODS instead:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li>You're not returning to the reporting location that same day, or</li>
              <li>The move requires driving beyond what TRALA's HOS relief allows.</li>
            </ul>
            In either case, complete the <strong>Prior On-Duty Hours Statement</strong> and keep a
            <strong> RODS</strong> for each day on the road.
          </div>
          <div style={{ marginTop: 10, color: "var(--muted)" }}>
            The short-haul / 150 air-mile clauses in 82 FR 47306 are rarely the reason we use
            this exemption — document your trip the same way regardless. A full copy of the
            exemption lives in the <strong>Document Library</strong>; ask an admin if you don't
            see it.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Prior On-Duty Hours Statement
// ─────────────────────────────────────────────────────────────────────────

function PriorOnDutyForm({ onBack }: { onBack: () => void }) {
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
          <span style={{ fontWeight: 700, fontSize: 16 }}>Statement Submitted</span>
          <button onClick={onBack} style={backBtnStyle}>← Back</button>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "32px 24px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: "var(--ok)", marginBottom: 6 }}>Statement on File</div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 20 }}>
            Total on-duty hours in the prior 7 days: <strong>{totalLast7.toFixed(2)}</strong>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btnPrimary" onClick={onBack}>Back to menu</button>
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
          <div style={{ fontWeight: 700, fontSize: 16 }}>Prior On-Duty Hours Statement</div>
          <div className="small" style={{ color: "var(--muted)" }}>§395.8(j)(2)</div>
        </div>
        <button onClick={onBack} style={backBtnStyle}>← Menu</button>
      </div>

      <div className="card">
        <div className="small" style={{ color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Record total on-duty hours (driving + other work) for each of the 7 days
          immediately before this trip, plus hours worked in the last 24.
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
              onFocus={(e) => e.currentTarget.select()}
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

          <button type="submit" className="btnPrimary" disabled={busy}>
            {busy ? "Submitting…" : "Submit Prior On-Duty Statement"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// RODS — Record of Duty Status
// ─────────────────────────────────────────────────────────────────────────

type DutyStatus = "off_duty" | "sleeper" | "driving" | "on_duty";

type DutyChange = {
  time: string;       // "HH:MM"
  status: DutyStatus;
  location: string;
  remarks: string;
};

const STATUS_LABELS: Record<DutyStatus, string> = {
  off_duty: "Off Duty",
  sleeper: "Sleeper Berth",
  driving: "Driving",
  on_duty: "On Duty (Not Driving)",
};

const STATUS_COLORS: Record<DutyStatus, string> = {
  off_duty: "#6aa7ff",
  sleeper: "#a78bfa",
  driving: "#5dd6c2",
  on_duty: "#fbbf24",
};

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return Math.max(0, Math.min(24 * 60, h * 60 + m));
}

function computeTotals(changes: DutyChange[]): Record<DutyStatus, number> {
  const totals: Record<DutyStatus, number> = { off_duty: 0, sleeper: 0, driving: 0, on_duty: 0 };
  if (changes.length === 0) return totals;
  const sorted = [...changes].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time));
  for (let i = 0; i < sorted.length; i++) {
    const start = minutesOfDay(sorted[i].time);
    const end = i + 1 < sorted.length ? minutesOfDay(sorted[i + 1].time) : 24 * 60;
    const mins = Math.max(0, end - start);
    totals[sorted[i].status] += mins;
  }
  return totals;
}

function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function RODSForm({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const sigRef = useRef<SignaturePadHandle>(null);

  const [logDate, setLogDate] = useState(todayLocal());
  const [driverName, setDriverName] = useState(user?.name || "");
  const [coDriverName, setCoDriverName] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [trailerNumber, setTrailerNumber] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [totalMiles, setTotalMiles] = useState("");
  const [shippingDocs, setShippingDocs] = useState("");
  const [carrier, setCarrier] = useState("Mountaineer Moving Co.");
  const [mainOffice, setMainOffice] = useState("");
  const [remarks, setRemarks] = useState("");
  const [eSignConsent, setESignConsent] = useState(false);

  // Start the day off-duty at 00:00 by default.
  const [changes, setChanges] = useState<DutyChange[]>([
    { time: "00:00", status: "off_duty", location: "", remarks: "" },
  ]);

  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sortedChanges = useMemo(
    () => [...changes].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time)),
    [changes],
  );
  const totals = useMemo(() => computeTotals(changes), [changes]);

  function updateChange(idx: number, patch: Partial<DutyChange>) {
    setChanges((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function removeChange(idx: number) {
    setChanges((prev) => prev.filter((_, i) => i !== idx));
  }

  function addChange() {
    // Default new change to the last-used time + 1 hour, or 08:00
    let defaultTime = "08:00";
    if (sortedChanges.length > 0) {
      const last = sortedChanges[sortedChanges.length - 1];
      const mins = Math.min(23 * 60 + 59, minutesOfDay(last.time) + 60);
      defaultTime = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    }
    setChanges((prev) => [
      ...prev,
      { time: defaultTime, status: "driving", location: "", remarks: "" },
    ]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!driverName.trim()) return setErr("Driver name is required.");
    if (changes.length === 0) return setErr("Add at least one duty status entry.");
    for (const c of changes) {
      if (!/^\d{2}:\d{2}$/.test(c.time)) return setErr(`Invalid time: ${c.time}`);
    }
    if (sigRef.current?.isEmpty()) return setErr("Driver signature is required.");
    if (!eSignConsent) return setErr("You must accept the electronic signature consent to submit.");

    setBusy(true);
    try {
      await apiFetch("/api/long-distance/rods", {
        method: "POST",
        body: JSON.stringify({
          rods_id: newUUID(),
          driver_name: driverName.trim(),
          log_date: logDate,
          co_driver_name: coDriverName.trim() || null,
          vehicle_number: vehicleNumber.trim() || null,
          trailer_number: trailerNumber.trim() || null,
          origin: origin.trim() || null,
          destination: destination.trim() || null,
          total_miles: totalMiles.trim() || null,
          shipping_docs: shippingDocs.trim() || null,
          carrier: carrier.trim() || null,
          main_office_address: mainOffice.trim() || null,
          duty_changes: sortedChanges,
          remarks: remarks.trim() || null,
          total_off_duty: minutesToHHMM(totals.off_duty),
          total_sleeper: minutesToHHMM(totals.sleeper),
          total_driving: minutesToHHMM(totals.driving),
          total_on_duty: minutesToHHMM(totals.on_duty),
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
          <span style={{ fontWeight: 700, fontSize: 16 }}>RODS Submitted</span>
          <button onClick={onBack} style={backBtnStyle}>← Back</button>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "32px 24px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: "var(--ok)", marginBottom: 6 }}>Log Saved</div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 20 }}>
            {logDate} · Driving {minutesToHHMM(totals.driving)} · On-Duty {minutesToHHMM(totals.on_duty)}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btnPrimary" onClick={onBack}>Back to menu</button>
            <button onClick={() => nav("/")}>Back to Jobs</button>
          </div>
        </div>
      </div>
    );
  }

  const totalAccounted = totals.off_duty + totals.sleeper + totals.driving + totals.on_duty;

  return (
    <div className="container">
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Record of Duty Status</div>
          <div className="small" style={{ color: "var(--muted)" }}>FMCSR §395.8 — daily log</div>
        </div>
        <button onClick={onBack} style={backBtnStyle}>← Menu</button>
      </div>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Header */}
        <div className="card">
          <div className="sectionTitle">Trip Header</div>
          <div className="col" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 10 }}>
              <label className="col" style={{ gap: 4, flex: "1 1 140px" }}>
                <span className="small" style={{ color: "var(--muted)" }}>Date *</span>
                <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
              </label>
              <label className="col" style={{ gap: 4, flex: "2 1 200px" }}>
                <span className="small" style={{ color: "var(--muted)" }}>Driver *</span>
                <input value={driverName} onChange={(e) => setDriverName(e.target.value)} />
              </label>
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <label className="col" style={{ gap: 4, flex: "1 1 200px" }}>
                <span className="small" style={{ color: "var(--muted)" }}>Co-driver</span>
                <input value={coDriverName} onChange={(e) => setCoDriverName(e.target.value)} placeholder="If any" />
              </label>
              <label className="col" style={{ gap: 4, flex: "1 1 140px" }}>
                <span className="small" style={{ color: "var(--muted)" }}>Vehicle #</span>
                <input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} />
              </label>
              <label className="col" style={{ gap: 4, flex: "1 1 140px" }}>
                <span className="small" style={{ color: "var(--muted)" }}>Trailer #</span>
                <input value={trailerNumber} onChange={(e) => setTrailerNumber(e.target.value)} placeholder="N/A if none" />
              </label>
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <label className="col" style={{ gap: 4, flex: 1 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Origin</span>
                <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="City, ST" />
              </label>
              <label className="col" style={{ gap: 4, flex: 1 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Destination</span>
                <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="City, ST" />
              </label>
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <label className="col" style={{ gap: 4, flex: "1 1 120px" }}>
                <span className="small" style={{ color: "var(--muted)" }}>Total miles</span>
                <input value={totalMiles} onChange={(e) => setTotalMiles(e.target.value)} inputMode="numeric" />
              </label>
              <label className="col" style={{ gap: 4, flex: "2 1 200px" }}>
                <span className="small" style={{ color: "var(--muted)" }}>Shipping docs (BOL/manifest #)</span>
                <input value={shippingDocs} onChange={(e) => setShippingDocs(e.target.value)} />
              </label>
            </div>
            <label className="col" style={{ gap: 4 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Carrier</span>
              <input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Main office address</span>
              <input value={mainOffice} onChange={(e) => setMainOffice(e.target.value)} placeholder="Terminal / reporting location" />
            </label>
          </div>
        </div>

        {/* Duty status entries */}
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <div>
              <div className="sectionTitle" style={{ marginBottom: 2 }}>Duty Status Log</div>
              <div className="small" style={{ color: "var(--muted)" }}>
                Record a change each time your duty status changes. Status applies from its time until the next entry (or midnight).
              </div>
            </div>
            <button type="button" onClick={addChange} className="btnPrimary" style={{ fontSize: 13 }}>
              + Add change
            </button>
          </div>

          {/* 24-hour strip visualization */}
          <DutyStrip changes={sortedChanges} />

          <div className="col" style={{ gap: 10, marginTop: 12 }}>
            {changes.map((c, idx) => (
              <div key={idx} style={{ padding: "10px", border: "1px solid var(--border)", borderRadius: "var(--btn-r)", background: "rgba(255,255,255,0.02)" }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <label className="col" style={{ gap: 2, width: 100 }}>
                    <span className="small" style={{ color: "var(--muted)" }}>Time *</span>
                    <input type="time" value={c.time} onChange={(e) => updateChange(idx, { time: e.target.value })} />
                  </label>
                  <label className="col" style={{ gap: 2, flex: "1 1 160px" }}>
                    <span className="small" style={{ color: "var(--muted)" }}>Status</span>
                    <select value={c.status} onChange={(e) => updateChange(idx, { status: e.target.value as DutyStatus })}>
                      {(["off_duty", "sleeper", "driving", "on_duty"] as DutyStatus[]).map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeChange(idx)}
                    style={{ fontSize: 12, padding: "6px 10px", color: "var(--danger)", borderColor: "var(--danger)" }}
                  >
                    Remove
                  </button>
                </div>
                <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                  <label className="col" style={{ gap: 2, flex: "1 1 180px" }}>
                    <span className="small" style={{ color: "var(--muted)" }}>Location</span>
                    <input value={c.location} onChange={(e) => updateChange(idx, { location: e.target.value })} placeholder="City, ST" />
                  </label>
                  <label className="col" style={{ gap: 2, flex: "2 1 240px" }}>
                    <span className="small" style={{ color: "var(--muted)" }}>Remarks</span>
                    <input value={c.remarks} onChange={(e) => updateChange(idx, { remarks: e.target.value })} placeholder="e.g. Pre-trip, fueling, 30-min break…" />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <div className="row wrap" style={{ gap: 10, marginTop: 12, padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: "var(--btn-r)" }}>
            {(["off_duty", "sleeper", "driving", "on_duty"] as DutyStatus[]).map((s) => (
              <div key={s} className="col" style={{ gap: 2, flex: "1 1 110px" }}>
                <span className="small" style={{ color: "var(--muted)" }}>{STATUS_LABELS[s]}</span>
                <span style={{ fontWeight: 700, color: STATUS_COLORS[s] }}>{minutesToHHMM(totals[s])}</span>
              </div>
            ))}
          </div>
          {totalAccounted !== 24 * 60 && (
            <div className="small" style={{ color: "var(--muted)", marginTop: 8 }}>
              Accounted: {minutesToHHMM(totalAccounted)} / 24h 00m — {totalAccounted < 24 * 60
                ? "the last status continues to midnight."
                : "your entries overlap midnight — check the times."}
            </div>
          )}
        </div>

        {/* Remarks */}
        <div className="card">
          <div className="sectionTitle">Day Remarks (optional)</div>
          <textarea
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Any notes for the day — weather, detours, issues…"
          />
        </div>

        {/* Signature */}
        <div className="card">
          <div className="sectionTitle">Driver Certification *</div>
          <p className="small" style={{ color: "var(--muted)", marginTop: 0, marginBottom: 8 }}>
            I certify that this record is true and accurate.
          </p>
          <SignaturePad ref={sigRef} height={150} />
          <button
            type="button"
            onClick={() => sigRef.current?.clear()}
            style={{ marginTop: 6, background: "none", border: "none", color: "var(--muted)", fontSize: 12, cursor: "pointer", padding: 0 }}
          >
            Clear signature
          </button>
        </div>

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
              signature for the purposes of this Record of Duty Status.
            </span>
          </label>
        </div>

        {err && (
          <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "rgba(255,107,107,0.1)", borderRadius: 8 }}>
            {err}
          </div>
        )}

        <button type="submit" className="btnPrimary" disabled={busy} style={{ marginBottom: 32 }}>
          {busy ? "Submitting…" : "Submit RODS"}
        </button>
      </form>
    </div>
  );
}

function DutyStrip({ changes }: { changes: DutyChange[] }) {
  if (changes.length === 0) return null;
  const sorted = [...changes].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time));
  const segments: { left: number; width: number; status: DutyStatus }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = minutesOfDay(sorted[i].time);
    const end = i + 1 < sorted.length ? minutesOfDay(sorted[i + 1].time) : 24 * 60;
    if (end <= start) continue;
    segments.push({
      left: (start / (24 * 60)) * 100,
      width: ((end - start) / (24 * 60)) * 100,
      status: sorted[i].status,
    });
  }
  return (
    <div>
      <div
        style={{
          position: "relative",
          height: 36,
          borderRadius: 8,
          overflow: "hidden",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid var(--border)",
        }}
      >
        {segments.map((s, i) => (
          <div
            key={i}
            title={STATUS_LABELS[s.status]}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${s.left}%`,
              width: `${s.width}%`,
              background: STATUS_COLORS[s.status],
            }}
          />
        ))}
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--muted)" }}>
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
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
