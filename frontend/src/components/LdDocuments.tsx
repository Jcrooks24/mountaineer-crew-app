import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/client";

/**
 * One place to browse a crew member's long-distance compliance docs across all
 * days and jobs: Bills of Lading, RODS duty logs, and Prior On-Duty statements.
 * Read-only browser (additive). Each list is newest-first; a job filter narrows
 * to one trip. BOLs open in the editor (retrieve / email the signed copy).
 */

type BolItem = { bol_id: string; job_name: string; job_date: string; status: string; signed_pdf_url?: string };
type RodsItem = {
  rods_id: string; driver_name: string; log_date: string; origin?: string; destination?: string;
  total_driving?: number; total_on_duty?: number; total_off_duty?: number; signed_at?: string | null;
};
type PodsItem = {
  statement_id: string; driver_name: string; job_name?: string; statement_date: string;
  hours_last_24?: number; signed_at?: string | null;
};

const STATUS_LABEL: Record<string, string> = { draft: "Draft", origin_signed: "Origin signed", delivered: "Delivered" };

function Signed({ signed }: { signed: boolean }) {
  return (
    <span className="statusDot" style={{ ["--dot" as any]: signed ? "var(--ok)" : "var(--muted)", fontSize: 12 }}>
      {signed ? "Signed" : "Unsigned"}
    </span>
  );
}

export default function LdDocuments({ onOpenBol }: { onOpenBol: (bolId: string) => void }) {
  const [bols, setBols] = useState<BolItem[]>([]);
  const [rods, setRods] = useState<RodsItem[]>([]);
  const [pods, setPods] = useState<PodsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [jobFilter, setJobFilter] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const [b, r, p] = await Promise.all([
          apiFetch<{ ok: boolean; bols: BolItem[] }>("/api/bol?limit=100").then((x) => x.bols || []).catch(() => []),
          apiFetch<RodsItem[]>("/api/long-distance/rods").catch(() => []),
          apiFetch<PodsItem[]>("/api/long-distance/prior-hours").catch(() => []),
        ]);
        if (cancelled) return;
        setBols(b); setRods(r); setPods(p);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Could not load documents.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Job names for the filter (BOLs + PODS carry a job name).
  const jobNames = useMemo(() => {
    const set = new Set<string>();
    for (const b of bols) if (b.job_name) set.add(b.job_name);
    for (const p of pods) if (p.job_name) set.add(p.job_name);
    return [...set].sort();
  }, [bols, pods]);

  const jf = jobFilter.trim();
  const shownBols = useMemo(() => [...bols].filter((b) => !jf || b.job_name === jf).sort((a, b) => (b.job_date || "").localeCompare(a.job_date || "")), [bols, jf]);
  // RODS has no job name; the filter only narrows BOLs/PODS.
  const shownRods = useMemo(() => [...rods].sort((a, b) => (b.log_date || "").localeCompare(a.log_date || "")), [rods]);
  const shownPods = useMemo(() => [...pods].filter((p) => !jf || p.job_name === jf).sort((a, b) => (b.statement_date || "").localeCompare(a.statement_date || "")), [pods, jf]);

  const hrs = (n?: number) => `${(n ?? 0).toFixed(1)}h`;

  return (
    <div className="col" style={{ gap: 12 }}>
      {jobNames.length > 1 && (
        <div className="card">
          <div className="microLabel" style={{ marginBottom: 8 }}>Filter by job</div>
          <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
            <option value="">All jobs</option>
            {jobNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}

      {loading && <div className="card"><div className="small" style={{ color: "var(--muted)" }}>Loading documents…</div></div>}
      {err && <div className="card"><div className="small" style={{ color: "var(--danger)" }}>{err}</div></div>}

      {/* Bills of Lading */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Bills of Lading</div>
        {shownBols.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>No bills of lading.</div>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {shownBols.map((b) => (
              <button key={b.bol_id} type="button" onClick={() => onOpenBol(b.bol_id)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, textAlign: "left", width: "100%" }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600 }}>{b.job_name || "Untitled job"}</span>
                  <span className="small mono" style={{ color: "var(--muted)" }}>{b.job_date || "no date"}</span>
                </span>
                <span className="statusDot" style={{ ["--dot" as any]: b.status === "delivered" ? "var(--ok)" : b.status === "origin_signed" ? "var(--brand)" : "var(--muted)", fontSize: 12, flexShrink: 0 }}>
                  {STATUS_LABEL[b.status] || b.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* RODS duty logs */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>RODS duty logs</div>
        {shownRods.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>No RODS logs.</div>
        ) : (
          <div className="col" style={{ gap: 10 }}>
            {shownRods.map((r) => (
              <div key={r.rods_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600 }}>
                    <span className="mono">{r.log_date}</span> · {r.driver_name}
                  </span>
                  {(r.origin || r.destination) && (
                    <span className="small" style={{ display: "block", color: "var(--muted)" }}>{r.origin || "?"} → {r.destination || "?"}</span>
                  )}
                  <span className="small mono" style={{ display: "block", color: "var(--muted)" }}>
                    drive {hrs(r.total_driving)} · on-duty {hrs(r.total_on_duty)} · off {hrs(r.total_off_duty)}
                  </span>
                </span>
                <Signed signed={!!r.signed_at} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Prior On-Duty statements */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Prior On-Duty statements</div>
        {shownPods.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>No prior on-duty statements.</div>
        ) : (
          <div className="col" style={{ gap: 10 }}>
            {shownPods.map((p) => (
              <div key={p.statement_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600 }}>
                    <span className="mono">{p.statement_date}</span> · {p.driver_name}
                  </span>
                  {p.job_name && <span className="small" style={{ display: "block", color: "var(--muted)" }}>{p.job_name}</span>}
                  <span className="small mono" style={{ display: "block", color: "var(--muted)" }}>prior 7-day: {hrs(p.hours_last_24)}</span>
                </span>
                <Signed signed={!!p.signed_at} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
