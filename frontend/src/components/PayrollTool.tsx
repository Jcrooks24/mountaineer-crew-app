import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../api/client";

/**
 * Admin payroll tool - the page that turns everything the app collects into the
 * numbers an admin types into QuickBooks.
 *
 * Deliberately hours-only. The app has never held a pay rate and does not start
 * here (ADR 0029), so this page reports hours per bucket, per-diem nights, and
 * the dollar figures crew entered themselves. Rates and gross pay stay in QBO.
 *
 * Three things happen here, in the order an admin actually does them:
 *   1. Pick a pay period, read the per-employee summary.
 *   2. Open an employee whose numbers look wrong, correct the offending line.
 *      Corrections are an override layer - the crew's submission is never
 *      touched, and both numbers stay visible. Job hours are read-only here:
 *      they are corrected on the Job Summary for that job (ADR 0032), and this
 *      page shows the corrected number with an "at Job Summary" marker. Only
 *      off-job, office and manual lines are editable here.
 *   3. Finalize, which mails each affected crew member exactly what changed on
 *      their off-job/office/manual lines. Job corrections are mailed when their
 *      job is initialed, not here.
 */

// ── Types (mirror routers/payroll.py's response) ─────────────────────────────

type Totals = {
  regular_hours: number;
  ot_hours: number;
  non_billable_hours: number;
  other_hours: number;
  total_hours: number;
  per_diem_nights: number;
  reimbursement_amount: number;
  mileage_miles: number;
};

type WeekRow = {
  week_start: string;
  billable_hours: number;
  regular_hours: number;
  ot_hours: number;
  partial: boolean;
};

type DayRow = {
  date: string;
  billable_hours: number;
  non_billable_hours: number;
  other_hours: number;
};

type LineRow = {
  date: string;
  bucket: string;
  source: string;
  source_key: string;
  source_label: string;
  detail: string;
  hours: number;
  reported_hours: number | null;
  correction_id: number | null;
  correction_reason: string | null;
};

type ReimbItem = {
  date: string;
  kind: string;
  label: string;
  amount: number | null;
  miles: number | null;
};

type Employee = {
  user_id: number;
  name: string;
  email: string;
  totals: Totals;
  weeks: WeekRow[];
  days: DayRow[];
  lines: LineRow[];
  reimbursement_items: ReimbItem[];
  correction_count: number;
};

type Summary = {
  period: { start: string; end: string };
  employees: Employee[];
  pending_correction_count: number;
  correction_count: number;
  warnings: string[];
};

type FinalizeResult = {
  sent: { user_id: number; name: string; count: number }[];
  suppressed: { user_id: number; name: string; count: number }[];
  failed: { user_id: number; name: string; count: number; error: string }[];
};

const BUCKET_LABELS: Record<string, string> = {
  billable: "Billable",
  non_billable: "Non-billable",
  other: "Other pay",
  per_diem_nights: "Per-diem nights",
};

const SOURCE_LABELS: Record<string, string> = {
  job: "Job",
  off_job: "Off-job",
  office: "Office",
  manual: "Added by admin",
};

const PERIOD_KEY = "crew_admin_payroll_period_v1";

// ── Date helpers ─────────────────────────────────────────────────────────────
// All local-date math. `new Date("2026-07-13")` parses as UTC midnight and can
// render as the 12th west of Greenwich, which would silently shift every label
// on this page back a day. Parse the parts instead.

function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(s: string, n: number): string {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Monday of the week containing `s`. */
function mondayOf(s: string): string {
  const d = parseISO(s);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return toISO(d);
}

function shortDate(s: string): string {
  const d = parseISO(s);
  return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

function weekdayShort(s: string): string {
  return parseISO(s).toLocaleDateString(undefined, { weekday: "short" });
}

/** The most recent two-week period ending on a Sunday, on or before today.
 *  Matches how the company already runs payroll (Mon-start, two weeks). */
function defaultPeriod(): { start: string; end: string } {
  const thisMonday = mondayOf(toISO(new Date()));
  const start = addDays(thisMonday, -14);
  return { start, end: addDays(start, 13) };
}

function fmtHours(n: number): string {
  // Trailing ".00" on every cell makes a wide table much harder to scan, but a
  // quarter-hour value has to keep its fraction.
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PayrollTool() {
  const [period, setPeriod] = useState<{ start: string; end: string }>(() => {
    try {
      const raw = localStorage.getItem(PERIOD_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p?.start && p?.end) return p;
      }
    } catch {}
    return defaultPeriod();
  });
  const [draft, setDraft] = useState(period);
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openUser, setOpenUser] = useState<number | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeResult, setFinalizeResult] = useState<FinalizeResult | null>(null);
  const [suppressed, setSuppressed] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (p: { start: string; end: string }) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<Summary>(
        `/api/admin/payroll/summary?start=${p.start}&end=${p.end}`,
      );
      setData(r);
    } catch (e) {
      setData(null);
      setErr(
        e instanceof ApiError
          ? e.message
          : "Could not load payroll. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load(period);
    try { localStorage.setItem(PERIOD_KEY, JSON.stringify(period)); } catch {}
  }, [period, load]);

  const applyPeriod = () => {
    if (parseISO(draft.end) < parseISO(draft.start)) {
      setErr("The end date is before the start date.");
      return;
    }
    setFinalizeResult(null);
    setSuppressed(new Set());
    setPeriod(draft);
  };

  const shiftPeriod = (weeks: number) => {
    const next = {
      start: addDays(period.start, weeks * 7),
      end: addDays(period.end, weeks * 7),
    };
    setDraft(next);
    setFinalizeResult(null);
    setSuppressed(new Set());
    setPeriod(next);
  };

  /** Tab-separated, one row per employee, header included. Pastes straight into
   *  a spreadsheet or lines up next to the QuickBooks entry grid. */
  const tsv = useMemo(() => {
    if (!data) return "";
    const head = [
      "Employee", "Regular", "Overtime", "Non-billable", "Other",
      "Total hrs", "Per-diem nights", "Reimbursement $", "Mileage mi",
    ].join("\t");
    const rows = data.employees.map((e) =>
      [
        e.name,
        e.totals.regular_hours,
        e.totals.ot_hours,
        e.totals.non_billable_hours,
        e.totals.other_hours,
        e.totals.total_hours,
        e.totals.per_diem_nights,
        e.totals.reimbursement_amount.toFixed(2),
        e.totals.mileage_miles,
      ].join("\t"),
    );
    return [head, ...rows].join("\n");
  }, [data]);

  const copyTsv = async () => {
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr("Could not copy. Select the table and copy manually.");
    }
  };

  const finalize = async () => {
    if (!data) return;
    setFinalizing(true);
    setErr(null);
    try {
      const r = await apiFetch<FinalizeResult>("/api/admin/payroll/finalize", {
        method: "POST",
        body: JSON.stringify({
          period_start: period.start,
          period_end: period.end,
          suppress_user_ids: [...suppressed],
        }),
      });
      setFinalizeResult(r);
      await load(period);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Finalize failed.");
    } finally {
      setFinalizing(false);
    }
  };

  const pending = data?.pending_correction_count ?? 0;

  return (
    <div className="col" style={{ gap: 14 }}>
      {/* ── Period picker ── */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Pay period</div>
        <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
          <label className="col" style={{ gap: 3 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Start</span>
            <input
              type="date"
              value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
          </label>
          <label className="col" style={{ gap: 3 }}>
            <span className="small" style={{ color: "var(--muted)" }}>End</span>
            <input
              type="date"
              value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            />
          </label>
          <button type="button" onClick={applyPeriod} disabled={busy}>
            {busy ? "Loading..." : "Load"}
          </button>
          <div className="row" style={{ gap: 6, marginLeft: "auto" }}>
            <button type="button" onClick={() => shiftPeriod(-2)} disabled={busy}>
              ← Previous
            </button>
            <button type="button" onClick={() => shiftPeriod(2)} disabled={busy}>
              Next →
            </button>
          </div>
        </div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 8 }}>
          Overtime is worked out per week (Monday to Sunday) on billable hours
          over 40. Periods that start on a Monday and end on a Sunday are the
          only ones whose overtime this page can settle on its own.
        </div>
      </div>

      {err && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          <span style={{ color: "var(--danger)" }}>{err}</span>
        </div>
      )}

      {data?.warnings?.length ? (
        <div className="card" style={{ borderColor: "var(--warn, #e0a800)" }}>
          <div className="microLabel" style={{ marginBottom: 8 }}>Check these first</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {data.warnings.map((w, i) => (
              <li key={i} className="small" style={{ marginBottom: 4 }}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ── Summary table ── */}
      {data && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div className="microLabel" style={{ marginBottom: 0 }}>
              {shortDate(period.start)} to {shortDate(period.end)} - {data.employees.length} employees
            </div>
            <button type="button" onClick={copyTsv} disabled={!tsv}>
              {copied ? "Copied" : "Copy for spreadsheet"}
            </button>
          </div>

          {data.employees.length === 0 ? (
            <div className="small" style={{ color: "var(--muted)" }}>
              Nobody logged hours in this period.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "right", color: "var(--muted)" }}>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Employee</th>
                    <th style={{ padding: "6px 8px" }}>Regular</th>
                    <th style={{ padding: "6px 8px" }}>OT</th>
                    <th style={{ padding: "6px 8px" }}>Non-bill</th>
                    <th style={{ padding: "6px 8px" }}>Other</th>
                    <th style={{ padding: "6px 8px" }}>Total</th>
                    <th style={{ padding: "6px 8px" }}>Per-diem</th>
                    <th style={{ padding: "6px 8px" }}>Reimb</th>
                    <th style={{ padding: "6px 8px" }}>Miles</th>
                    <th style={{ padding: "6px 8px" }} />
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((e) => (
                    <EmployeeRows
                      key={e.user_id}
                      emp={e}
                      period={period}
                      open={openUser === e.user_id}
                      onToggle={() =>
                        setOpenUser(openUser === e.user_id ? null : e.user_id)
                      }
                      onChanged={() => load(period)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Finalize ── */}
      {data && data.correction_count > 0 && (
        <div className="card">
          <div className="microLabel" style={{ marginBottom: 8 }}>Finalize period</div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
            {pending === 0
              ? "Every correction in this period has already been sent. Nothing left to mail."
              : `${pending} correction${pending === 1 ? " has" : "s have"} not been sent yet. ` +
                "Finalizing emails each affected crew member one summary of exactly what " +
                "changed on their hours and why. Corrections already sent are not re-sent."}
          </div>

          {pending > 0 && data.employees.some((e) => e.correction_count > 0) && (
            <div style={{ marginBottom: 12 }}>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>
                Tick anyone you have already spoken to in person - they will be
                marked done without an email.
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                {data.employees
                  .filter((e) => e.correction_count > 0)
                  .map((e) => {
                    const on = suppressed.has(e.user_id);
                    return (
                      <button
                        key={e.user_id}
                        type="button"
                        onClick={() => {
                          const next = new Set(suppressed);
                          if (on) next.delete(e.user_id); else next.add(e.user_id);
                          setSuppressed(next);
                        }}
                        style={{
                          padding: "6px 12px", borderRadius: 999, fontSize: 13,
                          border: on ? "1px solid var(--brand)" : "1px solid var(--border)",
                          background: on ? "var(--brand)" : "transparent",
                          color: on ? "var(--on-brand, #fff)" : "var(--text)",
                          fontWeight: on ? 700 : 400, cursor: "pointer",
                        }}
                      >
                        {on ? "No email: " : ""}{e.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          <button type="button" onClick={finalize} disabled={finalizing || pending === 0}>
            {finalizing ? "Sending..." : `Finalize and notify (${pending})`}
          </button>

          {finalizeResult && (
            <div style={{ marginTop: 12 }} className="col">
              {finalizeResult.sent.map((s) => (
                <div key={s.user_id} className="small" style={{ color: "var(--ok)" }}>
                  Emailed {s.name} ({s.count} correction{s.count === 1 ? "" : "s"})
                </div>
              ))}
              {finalizeResult.suppressed.map((s) => (
                <div key={s.user_id} className="small" style={{ color: "var(--muted)" }}>
                  {s.name}: marked done, no email sent
                </div>
              ))}
              {finalizeResult.failed.map((f) => (
                <div key={f.user_id} className="small" style={{ color: "var(--danger)" }}>
                  Could not email {f.name}: {f.error}. Their corrections were NOT
                  marked as sent, so finalizing again will retry.
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── One employee: summary row + expandable detail ────────────────────────────

function EmployeeRows({
  emp,
  period,
  open,
  onToggle,
  onChanged,
}: {
  emp: Employee;
  period: { start: string; end: string };
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const t = emp.totals;
  const num = (n: number) => (
    <td style={{ textAlign: "right", padding: "6px 8px", fontVariantNumeric: "tabular-nums" }}>
      {n === 0 ? <span style={{ color: "var(--muted)" }}>0</span> : fmtHours(n)}
    </td>
  );

  return (
    <>
      <tr style={{ borderTop: "1px solid var(--border)" }}>
        <td style={{ padding: "6px 8px", fontWeight: 600 }}>
          {emp.name}
          {emp.correction_count > 0 && (
            <span
              className="small"
              title={`${emp.correction_count} admin correction(s) applied`}
              style={{ marginLeft: 6, color: "var(--brand)" }}
            >
              corrected
            </span>
          )}
        </td>
        {num(t.regular_hours)}
        {num(t.ot_hours)}
        {num(t.non_billable_hours)}
        {num(t.other_hours)}
        <td style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {fmtHours(t.total_hours)}
        </td>
        {num(t.per_diem_nights)}
        <td style={{ textAlign: "right", padding: "6px 8px", fontVariantNumeric: "tabular-nums" }}>
          {t.reimbursement_amount ? `$${t.reimbursement_amount.toFixed(2)}` : <span style={{ color: "var(--muted)" }}>-</span>}
        </td>
        {num(t.mileage_miles)}
        <td style={{ textAlign: "right", padding: "6px 8px" }}>
          <button type="button" onClick={onToggle} style={{ fontSize: 12 }}>
            {open ? "Close" : "Detail"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} style={{ padding: "4px 8px 14px" }}>
            <EmployeeDetail emp={emp} period={period} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

function EmployeeDetail({
  emp,
  period,
  onChanged,
}: {
  emp: Employee;
  period: { start: string; end: string };
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<LineRow | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div
      className="col"
      style={{
        gap: 12, padding: 12, borderRadius: 10,
        border: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--text) 3%, transparent)",
      }}
    >
      {/* Per-week OT working */}
      <div>
        <div className="small" style={{ color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>
          Overtime by week
        </div>
        {emp.weeks.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>No billable hours.</div>
        ) : (
          <div className="row wrap" style={{ gap: 10 }}>
            {emp.weeks.map((w) => (
              <div
                key={w.week_start}
                style={{
                  border: "1px solid var(--border)", borderRadius: 8,
                  padding: "6px 10px", fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 700 }}>
                  Week of {shortDate(w.week_start)}
                  {w.partial && (
                    <span style={{ color: "var(--warn, #e0a800)", marginLeft: 6 }}>
                      partial
                    </span>
                  )}
                </div>
                <div style={{ color: "var(--muted)" }}>
                  {fmtHours(w.billable_hours)} billable = {fmtHours(w.regular_hours)} reg
                  {w.ot_hours > 0 ? ` + ${fmtHours(w.ot_hours)} OT` : ""}
                </div>
                {w.partial && (
                  <div className="small" style={{ color: "var(--muted)", maxWidth: 260 }}>
                    This week runs outside the period, so its overtime may change.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* By-day breakdown */}
      {emp.days.length > 0 && (
        <div>
          <div className="small" style={{ color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>
            Hours by day
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th style={{ textAlign: "left", padding: "3px 8px" }}>Day</th>
                  {emp.days.map((d) => (
                    <th key={d.date} style={{ padding: "3px 8px", textAlign: "right" }}>
                      {weekdayShort(d.date)} {shortDate(d.date)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["billable_hours", "non_billable_hours", "other_hours"] as const).map((k) => {
                  const any = emp.days.some((d) => d[k] > 0);
                  if (!any) return null;
                  const label = { billable_hours: "Billable", non_billable_hours: "Non-bill", other_hours: "Other" }[k];
                  return (
                    <tr key={k} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "3px 8px", color: "var(--muted)" }}>{label}</td>
                      {emp.days.map((d) => (
                        <td key={d.date} style={{ padding: "3px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {d[k] ? fmtHours(d[k]) : ""}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Line-by-line, each correctable */}
      <div>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span className="small" style={{ color: "var(--muted)", fontWeight: 700 }}>
            Where the hours came from
          </span>
          <button type="button" onClick={() => setAdding(true)} style={{ fontSize: 12 }}>
            + Add a line
          </button>
        </div>
        <div className="col" style={{ gap: 6 }}>
          {emp.lines.length === 0 && (
            <span className="small" style={{ color: "var(--muted)" }}>
              No hours logged in this period.
            </span>
          )}
          {emp.lines.map((l, i) => (
            <div
              key={`${l.source}-${l.source_key}-${l.bucket}-${i}`}
              className="row"
              style={{
                justifyContent: "space-between", alignItems: "center", gap: 10,
                padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 8,
                fontSize: 12,
              }}
            >
              <div className="col" style={{ gap: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>
                  {shortDate(l.date)} - {l.source_label}
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                    {" "}({SOURCE_LABELS[l.source] || l.source}, {BUCKET_LABELS[l.bucket] || l.bucket})
                  </span>
                </span>
                {l.detail && (
                  <span className="small" style={{ color: "var(--muted)" }}>{l.detail}</span>
                )}
                {l.correction_id && (
                  <span className="small" style={{ color: "var(--brand)" }}>
                    Corrected from {fmtHours(l.reported_hours ?? 0)}: {l.correction_reason}
                  </span>
                )}
              </div>
              <div className="row" style={{ gap: 8, alignItems: "center", flexShrink: 0 }}>
                <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {fmtHours(l.hours)}
                  {l.bucket === "per_diem_nights"
                    ? (l.hours === 1 ? " night" : " nights")
                    : " hrs"}
                </span>
                {l.source === "job" ? (
                  // Job hours are corrected on the Job Summary now (ADR 0032),
                  // so they are read-only here - the number reflects any
                  // correction, but the edit happens where the job lives.
                  <span
                    className="small"
                    title="Correct this on the Job Summary for this job"
                    style={{ color: "var(--muted)", whiteSpace: "nowrap" }}
                  >
                    at Job Summary
                  </span>
                ) : (
                  <button type="button" onClick={() => setEditing(l)} style={{ fontSize: 12 }}>
                    {l.correction_id ? "Edit" : "Correct"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {(editing || adding) && (
        <CorrectionForm
          emp={emp}
          period={period}
          line={editing}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSaved={() => { setEditing(null); setAdding(false); onChanged(); }}
        />
      )}

      {emp.reimbursement_items.length > 0 && (
        <div>
          <div className="small" style={{ color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>
            Reimbursements (approved, paid personally)
          </div>
          <div className="col" style={{ gap: 3 }}>
            {emp.reimbursement_items.map((r, i) => (
              <span key={i} className="small">
                {shortDate(r.date)} - {r.label}
                {r.amount != null ? ` - $${r.amount.toFixed(2)}` : ""}
                {r.miles != null ? ` - ${r.miles} mi (no rate in app; price it yourself)` : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Correction form ──────────────────────────────────────────────────────────

function CorrectionForm({
  emp,
  period,
  line,
  onClose,
  onSaved,
}: {
  emp: Employee;
  period: { start: string; end: string };
  /** The line being corrected, or null when adding a standalone line. */
  line: LineRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // When correcting an existing line, `reported_hours` is what the crew filed
  // and `hours` is what it currently reads (they differ only if a correction is
  // already in place). The original must stay pinned to the crew's number so
  // editing a correction twice does not quietly rewrite history to the last
  // corrected value.
  const original = line ? (line.reported_hours ?? line.hours) : 0;
  const [hours, setHours] = useState<string>(String(line ? line.hours : ""));
  const [bucket, setBucket] = useState(line?.bucket || "billable");
  const [workDate, setWorkDate] = useState(line?.date || period.start);
  const [label, setLabel] = useState(line?.source_label || "");
  const [reason, setReason] = useState(line?.correction_reason || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const n = Number(hours);
    if (!Number.isFinite(n) || n < 0) {
      setErr("Enter the corrected hours as a number.");
      return;
    }
    if (!reason.trim()) {
      setErr("A reason is required - the crew member is emailed this text.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/admin/payroll/corrections", {
        method: "PUT",
        body: JSON.stringify({
          period_start: period.start,
          period_end: period.end,
          user_id: emp.user_id,
          source: line ? line.source : "manual",
          source_key: line ? line.source_key : "",
          source_label: label.trim() || (line ? line.source_label : "Added by admin"),
          work_date: workDate,
          bucket,
          original_hours: original,
          corrected_hours: n,
          reason: reason.trim(),
        }),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save the correction.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!line?.correction_id) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/api/admin/payroll/corrections/${line.correction_id}`, {
        method: "DELETE",
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not remove the correction.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="col"
      style={{
        gap: 10, padding: 12, borderRadius: 10,
        border: "1px solid var(--brand)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13 }}>
        {line ? `Correct: ${line.source_label} (${shortDate(line.date)})` : `Add a line for ${emp.name}`}
      </div>
      <div className="small" style={{ color: "var(--muted)" }}>
        This does not change what the crew submitted. It records an override for
        this pay period, and {emp.name} is emailed the before, the after, and
        your reason when you finalize.
      </div>

      <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
        {!line && (
          <label className="col" style={{ gap: 3 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Date</span>
            <input
              type="date"
              value={workDate}
              min={period.start}
              max={period.end}
              onChange={(e) => setWorkDate(e.target.value)}
            />
          </label>
        )}
        <label className="col" style={{ gap: 3 }}>
          <span className="small" style={{ color: "var(--muted)" }}>Bucket</span>
          <select value={bucket} onChange={(e) => setBucket(e.target.value)} disabled={!!line}>
            {Object.entries(BUCKET_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        {!line && (
          <label className="col" style={{ gap: 3, flex: 1, minWidth: 160 }}>
            <span className="small" style={{ color: "var(--muted)" }}>What is it</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Bonus - Annette jobs"
            />
          </label>
        )}
        <label className="col" style={{ gap: 3, width: 130 }}>
          <span className="small" style={{ color: "var(--muted)" }}>
            {line ? "Should be" : bucket === "per_diem_nights" ? "Nights" : "Hours"}
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.25}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </label>
        {line && (
          <div className="small" style={{ color: "var(--muted)", paddingBottom: 6 }}>
            Crew reported {fmtHours(original)}
          </div>
        )}
      </div>

      <label className="col" style={{ gap: 3 }}>
        <span className="small" style={{ color: "var(--muted)" }}>
          Reason (this is the email {emp.name} receives)
        </span>
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Clocked out at 3, not 5 - confirmed with the crew lead."
          style={{ width: "100%", resize: "vertical" }}
        />
      </label>

      {err && <span className="small" style={{ color: "var(--danger)" }}>{err}</span>}

      <div className="row" style={{ gap: 8 }}>
        <button type="button" onClick={save} disabled={busy}>
          {busy ? "Saving..." : "Save correction"}
        </button>
        <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
        {line?.correction_id && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            style={{ color: "var(--danger)", marginLeft: "auto" }}
          >
            Remove correction
          </button>
        )}
      </div>
    </div>
  );
}
