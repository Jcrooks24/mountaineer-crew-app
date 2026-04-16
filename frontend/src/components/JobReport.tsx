import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import DVIRReminderModal from "./DVIRReminderModal";
import BillCalculator from "./BillCalculator";

type BillingMethod =
  | "crew_cash_check"
  | "office_invoice"
  | "office_arrange"
  | "end_of_job";

const BILLING_OPTIONS: { value: BillingMethod; label: string }[] = [
  { value: "crew_cash_check",  label: "Crew collected cash / check" },
  { value: "office_invoice",   label: "Office sends invoice" },
  { value: "office_arrange",   label: "Office arranges drop-off / pick-up" },
  { value: "end_of_job",       label: "Bill at end of job (multi-day)" },
];

type ReportData = {
  personal_vehicles: number;
  dumpster_pct: number;
  recycling_pct: number;
  billing_method: string;
  review_candidate: boolean | null;
  hours_match: boolean | null;
  hours_mismatch_reason: string;
};

type Props = {
  jobUuid: string;
  jobName: string;
};

export default function JobReport({ jobUuid, jobName }: Props) {
  const { user } = useAuth();

  const [data, setData] = useState<ReportData>({
    personal_vehicles: 0,
    dumpster_pct: 0,
    recycling_pct: 0,
    billing_method: "",
    review_candidate: null,
    hours_match: null,
    hours_mismatch_reason: "",
  });

  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showDVIRModal, setShowDVIRModal] = useState(false);
  const pendingSaveRef = useRef<(() => Promise<void>) | null>(null);

  // Load existing report when job_uuid changes
  useEffect(() => {
    if (!jobUuid) { setLoaded(false); return; }
    setLoaded(false);
    setSaved(false);
    apiFetch<ReportData & { id: number }>(`/api/job-report?job_uuid=${encodeURIComponent(jobUuid)}`)
      .then((r) => {
        setData({
          personal_vehicles: r.personal_vehicles,
          dumpster_pct: r.dumpster_pct,
          recycling_pct: r.recycling_pct,
          billing_method: r.billing_method,
          review_candidate: r.review_candidate,
          hours_match: r.hours_match,
          hours_mismatch_reason: r.hours_mismatch_reason ?? "",
        });
        setSaved(true);
      })
      .catch(() => {
        // 404 = no report yet, start fresh
        setData({
          personal_vehicles: 0,
          dumpster_pct: 0,
          recycling_pct: 0,
          billing_method: "",
          review_candidate: null,
          hours_match: null,
          hours_mismatch_reason: "",
        });
      })
      .finally(() => setLoaded(true));
  }, [jobUuid]);

  function set<K extends keyof ReportData>(key: K, val: ReportData[K]) {
    setData((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  async function doSave() {
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
        }),
      });
      setSaved(true);
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
    <BillCalculator jobUuid={jobUuid} jobName={jobName} />
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {jobName && (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 2 }}>
          Report for: <strong style={{ color: "var(--text)" }}>{jobName}</strong>
        </div>
      )}

      {/* ── Personal vehicles ── */}
      <div className="card">
        <div className="sectionTitle">Personal Vehicles at Job Site</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10 }}>
          <button
            type="button"
            onClick={() => set("personal_vehicles", Math.max(0, data.personal_vehicles - 1))}
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
      </div>

      {/* ── Dumpster & Recycling ── */}
      <div className="card">
        <div className="sectionTitle">M1 Fill Estimates</div>

        <PctSlider
          label="Dumpster (trash)"
          value={data.dumpster_pct}
          onChange={(v) => set("dumpster_pct", v)}
          color="var(--danger)"
        />

        <div style={{ marginTop: 16 }}>
          <PctSlider
            label="Recycling bin"
            value={data.recycling_pct}
            onChange={(v) => set("recycling_pct", v)}
            color="var(--ok)"
          />
        </div>
      </div>

      {/* ── Billing ── */}
      <div className="card">
        <div className="sectionTitle">Billing Method</div>
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
        <div className="sectionTitle">Review Candidate</div>
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

      {/* ── Hours reconciliation ── */}
      <div className="card">
        <div className="sectionTitle">Hours Reconciliation</div>
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
              placeholder="e.g. Travel time not billed, job ran over estimate, early finish…"
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
