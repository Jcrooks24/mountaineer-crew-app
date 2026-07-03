import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import SignaturePad, { type SignaturePadHandle } from "../components/SignaturePad";
import BillOfLadingForm from "../components/BillOfLadingForm";
import { BetaTag } from "../components/BetaTag";
import {
  fetchCalendarDay,
  fetchManualJobsForDate,
  listOpenBols,
  manualJobToJobUuid,
  readActiveJob,
  resolveJobUuid,
  type CalEvent,
  type OpenBol,
} from "../lib/bolStore";

type Section = "menu" | "prior" | "hos" | "trala" | "bol";

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
  // Deep-link support: /long-distance?section=prior|bol|hos|trala jumps
  // straight to the target sub-page. Report tab links now use these so the
  // crew doesn't have to bounce through the menu.
  const [params, setParams] = useSearchParams();
  const initialSection: Section = (() => {
    const raw = params.get("section");
    if (raw === "prior" || raw === "bol" || raw === "hos" || raw === "trala") return raw;
    return "menu";
  })();
  const [section, setSectionState] = useState<Section>(initialSection);
  function setSection(next: Section) {
    setSectionState(next);
    if (next === "menu") {
      // Clean up the query string when the crew backs out of a sub-page.
      const p = new URLSearchParams(params);
      p.delete("section");
      setParams(p, { replace: true });
    } else {
      const p = new URLSearchParams(params);
      p.set("section", next);
      setParams(p, { replace: true });
    }
  }

  if (section === "prior") return <PriorOnDutyForm onBack={() => setSection("menu")} />;
  if (section === "bol") return <BillOfLadingForm onBack={() => setSection("menu")} />;

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
        <div className="sectionTitle">Hours of Service - Quick Reference</div>
        <div className="small" style={{ color: "var(--text)", lineHeight: 1.6 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>11-hour driving limit</strong> after 10 consecutive hours off-duty.</li>
            <li><strong>14-hour on-duty window</strong> - driving prohibited after 14 hours following the start of the day, even with off-duty breaks.</li>
            <li><strong>30-minute break</strong> after 8 cumulative hours of driving without a 30-minute interruption.</li>
            <li><strong>60/70-hour limit</strong> - 60 hrs / 7 days or 70 hrs / 8 days. Reset with 34+ consecutive hours off-duty.</li>
            <li><strong>Short-haul exception</strong> (§395.1(e)) - on-duty up to 14 hrs within a 150 air-mile radius from normal work reporting location, returning each day.</li>
            <li>When leaving the short-haul radius you must keep a <strong>paper RODS log</strong> for that day (or use the in-app RODS below).</li>
          </ul>
          <div style={{ marginTop: 10, color: "var(--muted)" }}>
            When in doubt - call the office before crossing state lines.
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
          <button onClick={() => setSection("bol")} style={{ textAlign: "left" }}>
            <div style={{ fontWeight: 700 }}>Digital Bill of Lading</div>
            <BetaTag feature="digitalBOL" />
            <div className="small" style={{ color: "var(--muted)" }}>
              Build the declared inventory in the field - photos, condition notes, offline.
            </div>
          </button>
        </div>
      </div>

      <div className="card">
        <div className="sectionTitle">TRALA Rental-Truck Exemption - 82 FR 47306</div>
        <div className="small" style={{ color: "var(--text)", lineHeight: 1.6 }}>
          Published by FMCSA in the Federal Register (Oct 11, 2017), this exemption covers
          drivers operating a rental truck on our behalf during out-of-state moves. Carry a
          copy of the exemption in the cab, and confirm eligibility with the office before
          dispatch.
          <div style={{ marginTop: 10 }}>
            <strong>When it applies to us:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li>The vehicle is a rental truck (CDL not required for class) operated for a Mountaineer customer.</li>
              <li>The trip crosses state lines - this is the out-of-state use case we rely on.</li>
              <li>Office has confirmed the exemption applies to this specific move before departure.</li>
            </ul>
          </div>
          <div style={{ marginTop: 10 }}>
            <strong>When it doesn't cover you - use RODS instead:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li>You're not returning to the reporting location that same day, or</li>
              <li>The move requires driving beyond what TRALA's HOS relief allows.</li>
            </ul>
            In either case, complete the <strong>Prior On-Duty Hours Statement</strong> and keep a
            <strong> RODS</strong> for each day on the road.
          </div>
          <div style={{ marginTop: 10, color: "var(--muted)" }}>
            The short-haul / 150 air-mile clauses in 82 FR 47306 are rarely the reason we use
            this exemption - document your trip the same way regardless. A full copy of the
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
  const [driverName, setDriverName] = useState(() => {
    // Prefer the driver the Report tab asked us to file for (Report ->
    // Driver PODS section -> tap to file). Falls back to the signed-in
    // user so a driver filing their own PODS still sees their name.
    try {
      const preset = localStorage.getItem("crew_pods_preset_driver_v1");
      if (preset && preset.trim()) {
        localStorage.removeItem("crew_pods_preset_driver_v1");
        return preset.trim();
      }
    } catch { /* noop */ }
    return user?.name || "";
  });
  // Job selector - mirrors the Timeline: date + calendar dropdown + manual
  // "Other" fallback. The picked calendar/manual entry drives both the
  // display name and the canonical job_uuid sent with the PODS submission.
  const [jobName, setJobName] = useState(() => readActiveJob().job_name || "");
  const [jobUuid, setJobUuid] = useState<string>(() => readActiveJob().job_uuid || "");
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [calLoading, setCalLoading] = useState<boolean>(false);
  const [manualEntries, setManualEntries] = useState<{ job_uuid: string; name: string }[]>([]);
  const [pickerValue, setPickerValue] = useState<string>("");
  const [manualName, setManualName] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setCalLoading(true);
    setCalEvents([]);
    setManualEntries([]);
    (async () => {
      try {
        const [evs, manual] = await Promise.all([
          fetchCalendarDay(tripDate),
          fetchManualJobsForDate(tripDate),
        ]);
        if (cancelled) return;
        setCalEvents(evs);
        setManualEntries(manual);
      } catch {
        /* offline is fine */
      } finally {
        if (!cancelled) setCalLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tripDate]);

  async function onPickJob(value: string) {
    setPickerValue(value);
    if (!value) return;
    if (value === "__other__") {
      setManualName("");
      setJobUuid("");
      setJobName("");
      return;
    }
    const manual = manualEntries.find((m) => m.job_uuid === value);
    if (manual) {
      setJobUuid(manual.job_uuid);
      setJobName(manual.name);
      return;
    }
    const cal = calEvents.find((e) => e.id === value);
    if (cal) {
      const uuid = await resolveJobUuid(cal.id);
      setJobUuid(uuid);
      setJobName(cal.summary);
    }
  }

  function confirmManualName() {
    const name = manualName.trim();
    if (!name) return;
    const uuid = manualJobToJobUuid(name, tripDate);
    setJobUuid(uuid);
    setJobName(name);
  }

  // BOL attachment stays optional (surfaced as a separate control below).
  const [openBols, setOpenBols] = useState<OpenBol[]>([]);
  const [bolId, setBolId] = useState("");
  useEffect(() => { listOpenBols().then(setOpenBols).catch(() => {}); }, []);
  // Legacy "File Prior On-Duty for this BOL" launcher used to pre-attach a
  // BOL. Kept for back-compat if any stale localStorage entry remains.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("crew_pods_attach_bol_v1");
      if (raw) {
        const ctx = JSON.parse(raw);
        if (ctx?.bol_id) {
          setBolId(ctx.bol_id);
          if (ctx.job_name) setJobName(ctx.job_name);
        }
        localStorage.removeItem("crew_pods_attach_bol_v1");
      }
    } catch {}
  }, []);
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
      const bol = openBols.find((b) => b.bol_id === bolId);
      const active = readActiveJob();
      await apiFetch("/api/long-distance/prior-hours", {
        method: "POST",
        body: JSON.stringify({
          statement_id: newUUID(),
          driver_name: driverName.trim(),
          statement_date: tripDate,
          job_uuid: jobUuid || bol?.job_uuid || active.job_uuid || null,
          job_name: jobName.trim() || bol?.job_name || active.job_name || null,
          bol_id: bolId || null,
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
          The <strong>driver</strong> is responsible for completing this statement.
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
            <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>
              Job{" "}
              <span className="small" style={{ marginLeft: 4 }}>
                {calLoading ? "(loading…)" : calEvents.length > 0 ? `(${calEvents.length} found)` : "(none found)"}
              </span>
            </div>
            <select value={pickerValue} onChange={(e) => onPickJob(e.target.value)} disabled={calLoading}>
              <option value="">Select a job…</option>
              {calEvents.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.summary}</option>
              ))}
              {manualEntries.map((m) => (
                <option key={m.job_uuid} value={m.job_uuid}>{m.name}</option>
              ))}
              <option value="__other__">Other (enter manually)</option>
            </select>

            {pickerValue === "__other__" && (
              <div className="row wrap" style={{ gap: 8, alignItems: "flex-end", marginTop: 8 }}>
                <label className="col" style={{ gap: 4, flex: "1 1 200px" }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Job name</span>
                  <input
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    onBlur={confirmManualName}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmManualName(); } }}
                    placeholder="Customer / job name"
                  />
                </label>
                <button type="button" className="btnPrimary" onClick={confirmManualName} disabled={!manualName.trim()}>
                  Confirm
                </button>
              </div>
            )}

            {jobName && (
              <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>
                Selected: <strong style={{ color: "var(--text)" }}>{jobName}</strong>
              </div>
            )}
          </div>

          <div>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Attach to Bill of Lading (optional)</div>
            <select
              value={bolId}
              onChange={(e) => {
                const id = e.target.value;
                setBolId(id);
                const b = openBols.find((x) => x.bol_id === id);
                if (b && b.job_name) setJobName(b.job_name);
                if (b && b.job_uuid) setJobUuid(b.job_uuid);
              }}
            >
              <option value="">None</option>
              {openBols.map((b) => (
                <option key={b.bol_id} value={b.bol_id}>{b.job_name || "Untitled"}{b.job_date ? " (" + b.job_date + ")" : ""}</option>
              ))}
            </select>
            <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
              Attaching is optional - the PODS is filed per driver, per trip.
            </div>
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


const backBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 13,
};
