import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeContext";
import { formatMountainTime } from "../lib/time";
import DVIRReminderModal from "./DVIRReminderModal";
import BillCalculator, { type BillHandle } from "./BillCalculator";

// Mirrors backend EmployeeHoursEntry. Times are local "HH:MM" 24-hour or "" if
// the crew member only logged a duration without start/end.
export type EmployeeHoursEntry = {
  name: string;
  start: string;
  end: string;
  break_hours: number;
  hours: number;
};

// Compact subset of EventRecord — enough to populate the time-math dropdowns
// without leaking the rest of App.tsx's offline state into JobReport.
type ReportEvent = {
  event_id: string;
  type: string;
  timestamp: string;
};

type BillingMethod =
  | "crew_cash"
  | "crew_check"
  | "office_invoice"
  | "office_arrange_cash"
  | "office_arrange_check"
  | "end_of_job";

const BILLING_OPTIONS: { value: BillingMethod; label: string }[] = [
  { value: "crew_cash",           label: "Crew collected — cash" },
  { value: "crew_check",          label: "Crew collected — check" },
  { value: "office_invoice",      label: "Office sends invoice" },
  { value: "office_arrange_cash", label: "Office arranges pick-up / drop-off — cash" },
  { value: "office_arrange_check",label: "Office arranges pick-up / drop-off — check" },
  { value: "end_of_job",          label: "Bill at end of job (multi-day)" },
];

type ReportData = {
  has_personal_vehicles: boolean | null;
  personal_vehicles: number;
  has_dumpster_use: boolean | null;
  dumpster_pct: number;
  has_recycling_use: boolean | null;
  recycling_pct: number;
  billing_method: string;
  review_candidate: boolean | null;
  hours_match: boolean | null;
  hours_mismatch_reason: string;
  employee_hours: EmployeeHoursEntry[];
};

// In-progress draft persisted to localStorage so partially filled reports
// survive tab switches (the JobReport component unmounts when the user
// navigates away from the Report tab) and full page reloads. Cleared on
// successful submit. Keyed by job_uuid; per-device only — drafts are not
// synced cross-device.
const REPORT_DRAFT_PREFIX = "crew_report_draft_v1:";
type ReportDraft = { data: ReportData; billReviewed: boolean };

function reportDraftKey(uuid: string) {
  return `${REPORT_DRAFT_PREFIX}${uuid || "none"}`;
}
function loadReportDraft(uuid: string): ReportDraft | null {
  try {
    const raw = localStorage.getItem(reportDraftKey(uuid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.data) return null;
    return parsed as ReportDraft;
  } catch {
    return null;
  }
}
function saveReportDraft(uuid: string, draft: ReportDraft) {
  try {
    localStorage.setItem(reportDraftKey(uuid), JSON.stringify(draft));
  } catch {}
}
function clearReportDraft(uuid: string) {
  try {
    localStorage.removeItem(reportDraftKey(uuid));
  } catch {}
}

type Props = {
  jobUuid: string;
  jobName: string;
  events?: ReportEvent[];
};

export default function JobReport({ jobUuid, jobName, events = [] }: Props) {
  const { user } = useAuth();
  const { settings: themeSettings } = useTheme();
  const ht = themeSettings.helpTexts;

  const [data, setData] = useState<ReportData>({
    has_personal_vehicles: null,
    personal_vehicles: 0,
    has_dumpster_use: null,
    dumpster_pct: 0,
    has_recycling_use: null,
    recycling_pct: 0,
    billing_method: "",
    review_candidate: null,
    hours_match: null,
    hours_mismatch_reason: "",
    employee_hours: [],
  });

  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showDVIRModal, setShowDVIRModal] = useState(false);
  // Crew must confirm the auto-populated bill rows before the report submits.
  // The checkbox lives below the M1 sliders so crew see the M1-driven
  // charges populate before acknowledging them.
  const [billReviewed, setBillReviewed] = useState(false);
  const pendingSaveRef = useRef<(() => Promise<void>) | null>(null);
  const billRef = useRef<BillHandle>(null);

  // Draft autosave state — see REPORT_DRAFT_PREFIX above for the persistence
  // contract. Pill mirrors the global notes pattern: "Saving…" → "✓ Draft saved".
  type DraftStatus = "idle" | "saving" | "saved";
  const [draftStatus, setDraftStatus] = useState<DraftStatus>("idle");
  const draftSaveTimeoutRef = useRef<number | null>(null);
  // Set to true right after we hydrate state from server / localStorage so
  // the autosave effect skips writing back the just-loaded values (which
  // would flip the pill to "Saving" on mount for no reason).
  const skipNextDraftSaveRef = useRef<boolean>(false);

  // Load existing report when job_uuid changes
  useEffect(() => {
    if (!jobUuid) { setLoaded(false); return; }
    setLoaded(false);
    setSaved(false);
    setBillReviewed(false);
    apiFetch<ReportData & { id: number; employee_hours: EmployeeHoursEntry[] | null }>(`/api/job-report?job_uuid=${encodeURIComponent(jobUuid)}`)
      .then((r) => {
        setData({
          // Existing reports — infer answers from saved values
          has_personal_vehicles: r.personal_vehicles > 0,
          personal_vehicles: r.personal_vehicles,
          has_dumpster_use: r.dumpster_pct > 0,
          dumpster_pct: r.dumpster_pct,
          has_recycling_use: r.recycling_pct > 0,
          recycling_pct: r.recycling_pct,
          billing_method: r.billing_method,
          review_candidate: r.review_candidate,
          hours_match: r.hours_match,
          hours_mismatch_reason: r.hours_mismatch_reason ?? "",
          employee_hours: r.employee_hours ?? [],
        });
        setSaved(true);
      })
      .catch(() => {
        // 404 = no report yet, start fresh
        setData({
          has_personal_vehicles: null,
          personal_vehicles: 0,
          has_dumpster_use: null,
          dumpster_pct: 0,
          has_recycling_use: null,
          recycling_pct: 0,
          billing_method: "",
          review_candidate: null,
          hours_match: null,
          hours_mismatch_reason: "",
          employee_hours: [],
        });
      })
      .finally(() => {
        // After the server load (or 404 fallback), check for an in-progress
        // draft. Drafts represent the user's most-recent typing on this
        // device, so they win over a stale server snapshot from a previous
        // submit. Cleared on successful Save below.
        const draft = loadReportDraft(jobUuid);
        if (draft) {
          setData(draft.data);
          setBillReviewed(draft.billReviewed);
          setDraftStatus("saved");
        } else {
          setDraftStatus("idle");
        }
        skipNextDraftSaveRef.current = true;
        setLoaded(true);
      });
  }, [jobUuid]);

  // Debounced draft autosave. Triggers on every change to `data` or
  // `billReviewed` once the form is loaded; skipped during the first render
  // after hydration so we don't write back the just-loaded values.
  useEffect(() => {
    if (!loaded || !jobUuid) return;
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
      return;
    }

    if (draftSaveTimeoutRef.current !== null) {
      window.clearTimeout(draftSaveTimeoutRef.current);
    }
    setDraftStatus("saving");
    draftSaveTimeoutRef.current = window.setTimeout(() => {
      draftSaveTimeoutRef.current = null;
      saveReportDraft(jobUuid, { data, billReviewed });
      setDraftStatus("saved");
    }, 750);

    return () => {
      if (draftSaveTimeoutRef.current !== null) {
        window.clearTimeout(draftSaveTimeoutRef.current);
        draftSaveTimeoutRef.current = null;
      }
    };
  }, [data, billReviewed, jobUuid, loaded]);

  function set<K extends keyof ReportData>(key: K, val: ReportData[K]) {
    setData((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  // ── Employee Hours helpers ─────────────────────────────────────────────────
  // Sort timeline events ascending so the time-math dropdowns read like a day.
  // App.tsx supplies them newest-first.
  const sortedEvents = useMemo(
    () =>
      events
        .slice()
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [events],
  );

  const [timeMathA, setTimeMathA] = useState<string>("");
  const [timeMathB, setTimeMathB] = useState<string>("");
  const timeMathHours = useMemo(() => {
    if (!timeMathA || !timeMathB) return null;
    const a = sortedEvents.find((e) => e.event_id === timeMathA);
    const b = sortedEvents.find((e) => e.event_id === timeMathB);
    if (!a || !b) return null;
    const ms = Math.abs(new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return ms / 3_600_000;
  }, [timeMathA, timeMathB, sortedEvents]);

  function parseHHMM(s: string): number | null {
    if (!s) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
  }

  function computeWorkedHours(start: string, end: string, breakHours: number): number {
    const s = parseHHMM(start);
    const e = parseHHMM(end);
    if (s === null || e === null) return 0;
    let durMin = e - s;
    if (durMin < 0) durMin += 24 * 60; // shift crossed midnight
    return Math.max(0, durMin / 60 - (Number.isFinite(breakHours) ? breakHours : 0));
  }

  function addEmployee() {
    setData((prev) => ({
      ...prev,
      employee_hours: [
        ...prev.employee_hours,
        { name: "", start: "", end: "", break_hours: 0, hours: 0 },
      ],
    }));
    setSaved(false);
  }

  function updateEmployee(i: number, patch: Partial<EmployeeHoursEntry>) {
    setData((prev) => {
      const next = prev.employee_hours.slice();
      const merged: EmployeeHoursEntry = { ...next[i], ...patch };
      // Auto-fill hours from start/end/break whenever those are touched and
      // both times are present. Crew can still type a duration directly when
      // start/end aren't known (skip the time fields, fill Hours Worked).
      const touchedTimeOrBreak =
        patch.start !== undefined ||
        patch.end !== undefined ||
        patch.break_hours !== undefined;
      if (touchedTimeOrBreak && merged.start && merged.end) {
        merged.hours = Number(
          computeWorkedHours(merged.start, merged.end, Number(merged.break_hours) || 0).toFixed(2),
        );
      }
      next[i] = merged;
      return { ...prev, employee_hours: next };
    });
    setSaved(false);
  }

  function removeEmployee(i: number) {
    setData((prev) => ({
      ...prev,
      employee_hours: prev.employee_hours.filter((_, idx) => idx !== i),
    }));
    setSaved(false);
  }

  async function doSave() {
    // Validate bill review checkbox
    const billData = billRef.current?.getData();
    if (billData !== null && billData !== undefined && !billReviewed) {
      return setErr("Please confirm you have reviewed the auto-populated bill items before saving.");
    }

    setBusy(true);
    try {
      await apiFetch("/api/job-report", {
        method: "POST",
        body: JSON.stringify({
          job_uuid: jobUuid,
          personal_vehicles: data.personal_vehicles,
          dumpster_pct: data.dumpster_pct,
          recycling_pct: data.recycling_pct,
          billing_method: data.billing_method,
          review_candidate: data.review_candidate,
          hours_match: data.hours_match,
          hours_mismatch_reason: data.hours_mismatch_reason.trim() || null,
          // Strip empty rows so the sheet column doesn't get noise from
          // accidentally-added employees the crew didn't fill in.
          employee_hours: data.employee_hours
            .filter((e) => e.name.trim() || e.hours > 0 || e.start || e.end)
            .map((e) => ({
              name: e.name.trim(),
              start: e.start,
              end: e.end,
              break_hours: Number(e.break_hours) || 0,
              hours: Number(e.hours) || 0,
            })),
        }),
      });

      // Save bill alongside the report
      if (billData) {
        await apiFetch("/api/bill", {
          method: "POST",
          body: JSON.stringify({
            job_uuid: jobUuid,
            items: billData.items,
            global_discount: billData.globalDiscount,
            notes: billData.notes || null,
          }),
        });
      }

      setSaved(true);
      // Submit succeeded — discard the in-progress draft. The server is now
      // authoritative; further edits start a fresh draft.
      clearReportDraft(jobUuid);
      setDraftStatus("idle");
    } catch (e: any) {
      setErr(e?.message ?? "Save failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!jobUuid) return setErr("No job selected.");
    if (data.has_personal_vehicles === null) return setErr("Indicate whether personal vehicles were at the job site.");
    if (data.has_personal_vehicles && data.personal_vehicles < 1) return setErr("Enter how many personal vehicles were at the job site.");
    if (data.has_dumpster_use === null) return setErr("Indicate whether the M1 dumpster was used on this job.");
    if (data.has_dumpster_use && data.dumpster_pct <= 0) return setErr("Select the M1 dumpster fill percentage.");
    if (data.has_recycling_use === null) return setErr("Indicate whether the M1 recycling bin was used on this job.");
    if (data.has_recycling_use && data.recycling_pct <= 0) return setErr("Select the M1 recycling bin fill percentage.");
    if (!data.billing_method) return setErr("Select a billing method.");
    if (data.review_candidate === null) return setErr("Indicate whether this client is a review candidate.");
    if (data.hours_match === null) return setErr("Indicate whether hours worked match hours billed.");
    if (!data.hours_match && !data.hours_mismatch_reason.trim())
      return setErr("Please explain why the hours don't match.");

    // Show DVIR reminder before saving
    pendingSaveRef.current = doSave;
    setShowDVIRModal(true);
  }

  if (!jobUuid) {
    return (
      <div className="card" style={{ color: "var(--muted)", textAlign: "center", padding: "28px 16px" }}>
        Select a job to fill out the job report.
      </div>
    );
  }

  if (!loaded) {
    return <div className="card small" style={{ color: "var(--muted)" }}>Loading…</div>;
  }

  return (
    <>
    {showDVIRModal && (
      <DVIRReminderModal
        trigger="report"
        onProceed={() => {
          setShowDVIRModal(false);
          pendingSaveRef.current?.();
          pendingSaveRef.current = null;
        }}
        onCancel={() => {
          setShowDVIRModal(false);
          pendingSaveRef.current = null;
        }}
      />
    )}
    <BillCalculator
      ref={billRef}
      jobUuid={jobUuid}
      jobName={jobName}
      dumpsterPct={data.dumpster_pct}
      recyclingPct={data.recycling_pct}
    />
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Draft autosave indicator. Hidden once the report is submitted
          (the existing "✓ Report saved" banner below covers that state). */}
      {!saved && (
        <div
          className="small"
          aria-live="polite"
          style={{
            color:
              draftStatus === "saved"
                ? "var(--ok)"
                : draftStatus === "saving"
                  ? "var(--muted)"
                  : "var(--muted)",
            textAlign: "right",
            minHeight: 16,
          }}
        >
          {draftStatus === "saving" && "Saving draft…"}
          {draftStatus === "saved" && "✓ Draft saved"}
        </div>
      )}

      {/* ── Dumpster & Recycling (sit under the Bill Helper because the
             sliders drive bill line items) ── */}
      <div className="card">
        <div className="sectionTitle">M1 Dumpster Use *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
          Was the M1 dumpster (trash) used on this job?
        </div>
        <YesNo
          value={data.has_dumpster_use}
          onChange={(v) => {
            setData((prev) => ({
              ...prev,
              has_dumpster_use: v,
              dumpster_pct: v ? Math.max(5, prev.dumpster_pct) : 0,
            }));
            setSaved(false);
          }}
          yesLabel="Yes"
          noLabel="No"
        />
        {data.has_dumpster_use && (
          <div style={{ marginTop: 14 }}>
            <PctSlider
              label="Dumpster fill estimate"
              value={data.dumpster_pct}
              onChange={(v) => set("dumpster_pct", v)}
              color="var(--danger)"
            />
          </div>
        )}
      </div>

      <div className="card">
        <div className="sectionTitle">M1 Recycling Use *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
          Was the M1 recycling bin used on this job?
        </div>
        <YesNo
          value={data.has_recycling_use}
          onChange={(v) => {
            setData((prev) => ({
              ...prev,
              has_recycling_use: v,
              recycling_pct: v ? Math.max(5, prev.recycling_pct) : 0,
            }));
            setSaved(false);
          }}
          yesLabel="Yes"
          noLabel="No"
        />
        {data.has_recycling_use && (
          <div style={{ marginTop: 14 }}>
            <PctSlider
              label="Recycling bin fill estimate"
              value={data.recycling_pct}
              onChange={(v) => set("recycling_pct", v)}
              color="var(--ok)"
            />
          </div>
        )}
      </div>

      {/* ── Bill auto-populate review ──
          Placed here so the crew sees the M1 sliders drive new bill
          line items before confirming them. */}
      <div className="card">
        <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={billReviewed}
            onChange={(e) => { setBillReviewed(e.target.checked); setSaved(false); }}
            style={{ marginTop: 3, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }}
          />
          <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>
            I have reviewed and confirmed the correctness of the auto-populated line items
            in the Bill Helper above (including any dumpster / recycling charges from the
            sliders).
          </span>
        </label>
      </div>

      {jobName && (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 2 }}>
          Report for: <strong style={{ color: "var(--text)" }}>{jobName}</strong>
        </div>
      )}

      {/* ── Personal vehicles ── */}
      <div className="card">
        <div className="sectionTitle">Personal Vehicles at Job Site *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
          Were any crew personal vehicles at the job site?
        </div>
        <YesNo
          value={data.has_personal_vehicles}
          onChange={(v) => {
            setData((prev) => ({
              ...prev,
              has_personal_vehicles: v,
              personal_vehicles: v ? Math.max(1, prev.personal_vehicles) : 0,
            }));
            setSaved(false);
          }}
          yesLabel="Yes"
          noLabel="No"
        />
        {data.has_personal_vehicles && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
            <button
              type="button"
              onClick={() => set("personal_vehicles", Math.max(1, data.personal_vehicles - 1))}
              style={stepBtnStyle}
              aria-label="Decrease"
            >
              −
            </button>
            <span style={{ fontSize: 28, fontWeight: 700, minWidth: 36, textAlign: "center" }}>
              {data.personal_vehicles}
            </span>
            <button
              type="button"
              onClick={() => set("personal_vehicles", data.personal_vehicles + 1)}
              style={stepBtnStyle}
              aria-label="Increase"
            >
              +
            </button>
            <span className="small" style={{ color: "var(--muted)" }}>vehicle{data.personal_vehicles !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>

      {/* ── Billing ── */}
      <div className="card">
        <div className="sectionTitle">Billing Method *</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {BILLING_OPTIONS.map(({ value, label }) => {
            const active = data.billing_method === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => set("billing_method", value)}
                style={{
                  padding: "11px 14px",
                  borderRadius: 10,
                  border: active ? "2px solid var(--brand)" : "1px solid var(--border)",
                  background: active ? "rgba(93,214,194,0.1)" : "transparent",
                  color: active ? "var(--brand)" : "var(--text)",
                  fontWeight: active ? 700 : 400,
                  fontSize: 13,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Review candidate ── */}
      <div className="card">
        <div className="sectionTitle">Review Candidate *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
          Is this client a good candidate for the office to seek a review from?
        </div>
        <YesNo
          value={data.review_candidate}
          onChange={(v) => set("review_candidate", v)}
          yesLabel="Yes — reach out"
          noLabel="No"
        />
      </div>

      {/* ── Employee Hours ──
          Crew enters per-employee start/end/break/duration here. Time-math
          helper below picks two timeline events and shows the duration in
          base-10 hours; crew transcribes that into the rows. The whole
          block flows into a single Employee Hours column on the JobReports
          worksheet via the backend. */}
      <div className="card">
        <div className="sectionTitle">Employee Hours</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
          Record hours worked per crew member. Filling Start + End auto-fills Hours
          Worked (minus any break). Otherwise type Hours Worked directly.
        </div>

        {sortedEvents.length >= 2 && (
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 10,
              marginBottom: 12,
            }}
          >
            <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>
              Time math
            </div>
            <div className="row wrap" style={{ gap: 6, alignItems: "center" }}>
              <select
                value={timeMathA}
                onChange={(e) => setTimeMathA(e.target.value)}
                style={{ flex: "1 1 140px", minWidth: 0 }}
              >
                <option value="">From event…</option>
                {sortedEvents.map((ev) => (
                  <option key={ev.event_id} value={ev.event_id}>
                    {ev.type} — {formatMountainTime(ev.timestamp)}
                  </option>
                ))}
              </select>
              <span className="small">→</span>
              <select
                value={timeMathB}
                onChange={(e) => setTimeMathB(e.target.value)}
                style={{ flex: "1 1 140px", minWidth: 0 }}
              >
                <option value="">To event…</option>
                {sortedEvents.map((ev) => (
                  <option key={ev.event_id} value={ev.event_id}>
                    {ev.type} — {formatMountainTime(ev.timestamp)}
                  </option>
                ))}
              </select>
              {timeMathHours !== null && (
                <span style={{ fontWeight: 700, fontSize: 14 }}>
                  = {timeMathHours.toFixed(2)} hrs
                </span>
              )}
            </div>
            <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>
              Use this to compute either worked time or break time, then type the result below.
            </div>
          </div>
        )}

        {data.employee_hours.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>No employees added yet.</div>
        ) : (
          <div className="col" style={{ gap: 12 }}>
            {data.employee_hours.map((emp, i) => (
              <div
                key={i}
                style={{
                  borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  paddingTop: i > 0 ? 12 : 0,
                }}
              >
                <input
                  type="text"
                  placeholder="Employee name"
                  value={emp.name}
                  onChange={(e) => updateEmployee(i, { name: e.target.value })}
                  style={{ width: "100%", marginBottom: 8 }}
                />
                <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
                  <label className="col" style={{ gap: 2, flex: "1 1 90px", minWidth: 90 }}>
                    <span className="small" style={{ color: "var(--muted)" }}>Start</span>
                    <input
                      type="time"
                      value={emp.start}
                      onChange={(e) => updateEmployee(i, { start: e.target.value })}
                    />
                  </label>
                  <label className="col" style={{ gap: 2, flex: "1 1 90px", minWidth: 90 }}>
                    <span className="small" style={{ color: "var(--muted)" }}>End</span>
                    <input
                      type="time"
                      value={emp.end}
                      onChange={(e) => updateEmployee(i, { end: e.target.value })}
                    />
                  </label>
                  <label className="col" style={{ gap: 2, flex: "1 1 80px", minWidth: 80 }}>
                    <span className="small" style={{ color: "var(--muted)" }}>Break (hrs)</span>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      value={emp.break_hours}
                      onChange={(e) =>
                        updateEmployee(i, { break_hours: Number(e.target.value) || 0 })
                      }
                    />
                  </label>
                  <label className="col" style={{ gap: 2, flex: "1 1 90px", minWidth: 90 }}>
                    <span className="small" style={{ color: "var(--muted)" }}>Worked (hrs)</span>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      value={emp.hours}
                      onChange={(e) => updateEmployee(i, { hours: Number(e.target.value) || 0 })}
                      style={{ fontWeight: 700 }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeEmployee(i)}
                    style={{ color: "var(--danger)", flex: "0 0 auto" }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button type="button" onClick={addEmployee} style={{ marginTop: 12 }}>
          + Add employee
        </button>
      </div>

      {/* ── Hours reconciliation ── */}
      <div className="card">
        <div className="sectionTitle">Hours Reconciliation *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
          Do hours worked match hours billed?
        </div>
        <YesNo
          value={data.hours_match}
          onChange={(v) => set("hours_match", v)}
          yesLabel="Yes, they match"
          noLabel="No, there's a difference"
        />
        {data.hours_match === false && (
          <div style={{ marginTop: 12 }}>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>
              Please explain the discrepancy *
            </div>
            <textarea
              value={data.hours_mismatch_reason}
              onChange={(e) => set("hours_mismatch_reason", e.target.value)}
              placeholder={ht.hoursMismatchPlaceholder}
              rows={3}
              style={textareaStyle}
            />
          </div>
        )}
      </div>

      {err && (
        <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "rgba(255,107,107,0.1)", borderRadius: 8 }}>
          {err}
        </div>
      )}

      {saved && !busy && (
        <div style={{ color: "var(--ok)", fontSize: 13, padding: "8px 12px", background: "rgba(45,212,191,0.1)", borderRadius: 8 }}>
          ✓ Report saved{user?.name ? ` by ${user.name}` : ""}
        </div>
      )}

      <button
        type="submit"
        className="btnPrimary"
        disabled={busy}
        style={{ marginBottom: 32 }}
      >
        {busy ? "Saving…" : saved ? "Update Report" : "Save Report"}
      </button>
    </form>
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PctSlider({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="small" style={{ color: "var(--muted)" }}>{label}</span>
        <span style={{ fontWeight: 700, fontSize: 15, color }}>{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: color }}
      />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>Empty</span>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>Half</span>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>Full</span>
      </div>
    </div>
  );
}

function YesNo({
  value,
  onChange,
  yesLabel,
  noLabel,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  yesLabel: string;
  noLabel: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      {[
        { v: true, label: yesLabel },
        { v: false, label: noLabel },
      ].map(({ v, label }) => {
        const active = value === v;
        return (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: active
                ? `2px solid ${v ? "var(--brand)" : "var(--danger)"}`
                : "1px solid var(--border)",
              background: active
                ? v ? "rgba(93,214,194,0.1)" : "rgba(255,107,107,0.08)"
                : "transparent",
              color: active
                ? v ? "var(--brand)" : "var(--danger)"
                : "var(--muted)",
              fontWeight: active ? 700 : 400,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const stepBtnStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--card)",
  color: "var(--text)",
  fontSize: 22,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 14,
  resize: "vertical",
  boxSizing: "border-box",
};
