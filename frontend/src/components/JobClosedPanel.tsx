/**
 * Closed-job panel (backlog #2).
 *
 * When a job is closed out (its report saved), the whole crew job screen becomes
 * this static, read-only summary of everything the job produced, in order:
 *   Job -> Job Setup -> Checklist -> Job Report -> DVIRs -> Incidents & Photos ->
 *   Actions log -> Billing & materials.
 * "Edit finalized job" reopens the working view; "Start / change job" clears it.
 *
 * Data comes from GET /api/job-summary/{uuid} (same aggregation the admin Job
 * Summary uses, minus admin-only sections). The checklist reuses the live
 * JobChecklistCard so unchecked manual items can still be ticked (non-blocking,
 * offline-safe). On a fetch failure we degrade to the cached job setup + checklist
 * rather than blanking.
 */
import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import JobChecklistCard from "./JobChecklistCard";
import { loadJobSetup } from "../lib/jobSetupStore";
import { billTotal, fmtMoney, type BillLineLike } from "../lib/billTotal";

type Crew = { name?: string; source?: string; confirmed?: boolean };
type JobSetupOut = {
  job_date: string | null;
  is_long_distance: boolean;
  job_type_tags: string[];
  vehicle_unit_names: string[];
  crew: Crew[];
  origin: string | null;
  destination: string | null;
  stops: string[];
  notes: string | null;
  updated_by_name: string | null;
};
type EmpHours = { name?: string; hours?: number; non_billable?: boolean; out_of_town?: boolean };
type Summary = {
  job_uuid: string;
  job_name: string;
  job_setup: JobSetupOut | null;
  events: Array<{ event_id: string; type: string; timestamp: string | null; note: string | null; created_by: string | null }>;
  dvirs: Array<{ dvir_id: string; inspection_type: string; vehicle_number: string | null; condition: string | null; defects: string[]; defect_notes: string | null; driver_name: string | null; created_at: string | null }>;
  materials: Array<{ id: string; total: number; items: unknown[] }>;
  job_report: null | {
    submitted_by_name: string | null; personal_vehicles: number; dumpster_pct: number;
    recycling_pct: number; billing_method: string | null; review_candidate: string | null;
    hours_match: boolean | null; hours_mismatch_reason: string | null; out_of_town: boolean;
    crew_feedback: string; overage_note: string; job_type_tags: string[];
    truck_fullness: unknown[]; employee_hours: EmpHours[]; updated_at: string | null;
  };
  inventory: { furniture_count: number; box_count: number; items: unknown[] };
  incidents: Array<{ incident_uuid: string; claim_number: string | null; severity: string; description: string; resolved: boolean; attributed_crew: string | null; est_cost: number | null; photo_urls: string[]; created_at: string | null }>;
  bol: null | { bol_id: string; status: string; item_count: number; signed_pdf_url: string | null };
  ld_days: Array<{ driver_name: string; date: string; out_of_town: boolean; drive_day: boolean }>;
  reimbursements: Array<{ reimbursement_uuid: string; type: string; user_name: string; amount: number | null; status: string | null }>;
  // `items` was `unknown[]`, which is why the panel could only ever count them.
  // The priced fields are what this screen needs; the rest of a line is not its
  // business, so BillLineLike (an optional-field shape) is the honest type for a
  // payload decoded from items_json.
  bill: null | { saved_by_name: string | null; items: BillLineLike[]; global_discount: number; notes: string };
  photos: Array<{ id: number; caption: string | null; drive_url: string | null; created_by: string | null }>;
};

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
}

function Section({ title, children, danger, id }: { title: string; children: React.ReactNode; danger?: boolean; id?: string }) {
  return (
    <div className="card" id={id} style={{ scrollMarginTop: 64, ...(danger ? { borderColor: "var(--danger)" } : {}) }}>
      <div className="microLabel" style={{ marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

const jumpBtn: React.CSSProperties = {
  fontSize: 12, padding: "3px 10px", background: "none",
  border: "1px solid var(--border)", borderRadius: 999, color: "var(--brand)", cursor: "pointer",
};
function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "3px 0" }}>
      <span className="small" style={{ color: "var(--muted)", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, textAlign: "right", minWidth: 0, wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

const yesNoBlank = (v: boolean | null | undefined) => (v == null ? "-" : v ? "Yes" : "No");

export default function JobClosedPanel({
  jobUuid,
  jobName,
  jobDate,
  longDistance,
  onEditFinalized,
  onChangeJob,
}: {
  jobUuid: string;
  jobName: string;
  jobDate: string;
  longDistance: boolean;
  onEditFinalized: () => void;
  onChangeJob: () => void;
}) {
  const [s, setS] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [cachedSetup, setCachedSetup] = useState<JobSetupOut | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setOffline(false);
    apiFetch<Summary>(`/api/job-summary/${encodeURIComponent(jobUuid)}`)
      .then((r) => { if (!cancelled) { setS(r); setLoading(false); } })
      .catch(async () => {
        // Offline / transient: keep the panel useful with what's cached rather
        // than blanking it (same lesson as the report load path).
        if (cancelled) return;
        setOffline(true);
        const setup = await loadJobSetup(jobUuid).catch(() => null);
        if (!cancelled) { setCachedSetup((setup as any) || null); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [jobUuid]);

  const setup = s?.job_setup ?? cachedSetup;
  const report = s?.job_report ?? null;
  const totalHours = (report?.employee_hours ?? []).reduce((a, e) => a + (Number(e.hours) || 0), 0);
  const crewNames = (setup?.crew ?? []).map((c) => c.name).filter(Boolean).join(", ");

  return (
    <div className="col" style={{ gap: 12 }}>
      {/* 1. Job */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div className="col" style={{ gap: 2, minWidth: 0 }}>
            <span className="small" style={{ color: "var(--ok)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
              ✓ Closed out
            </span>
            <div style={{ fontWeight: 700, fontSize: 18, wordBreak: "break-word" }}>{jobName || s?.job_name || "Job"}</div>
            <div className="mono small" style={{ color: "var(--muted)" }} title={jobUuid}>
              {(setup?.job_date || jobDate) ? `${setup?.job_date || jobDate}  ·  ` : ""}#{jobUuid.slice(0, 8)}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" className="btnPrimary" onClick={onEditFinalized}>Edit finalized job</button>
          <button type="button" onClick={onChangeJob}>Start / change job</button>
        </div>
        {offline && (
          <div className="small" style={{ color: "var(--muted)", marginTop: 10 }}>
            Offline - showing last-synced setup and checklist. Reconnect to see the full summary.
          </div>
        )}
      </div>

      {/* 2. Job Setup */}
      <Section title="Job setup">
        {setup ? (
          <div className="col" style={{ gap: 0 }}>
            <Row label="Crew" value={crewNames || "-"} />
            <Row label="Job type" value={(setup.job_type_tags || []).join(", ") || "-"} />
            <Row label="Vehicle unit(s)" value={(setup.vehicle_unit_names || []).join(", ") || "-"} />
            <Row label="Long distance" value={setup.is_long_distance ? "Yes" : "No"} />
            {setup.is_long_distance && <Row label="Origin" value={setup.origin || "-"} />}
            {setup.is_long_distance && <Row label="Destination" value={setup.destination || "-"} />}
            {setup.is_long_distance && (setup.stops || []).length > 0 && <Row label="Stops" value={setup.stops.join(" -> ")} />}
            {setup.notes && <Row label="Notes" value={setup.notes} />}
          </div>
        ) : (
          <div className="small" style={{ color: "var(--muted)" }}>No job setup was recorded.</div>
        )}
      </Section>

      {/* 3. Checklist - reuse the live card so unchecked manual items stay tickable. */}
      <JobChecklistCard jobUuid={jobUuid} longDistance={longDistance} refreshKey={`closed-${jobUuid}`} />

      {/* In-app links from the checklist area to the completed docs rendered below. */}
      {s && (s.dvirs.length > 0 || s.incidents.length > 0 || s.photos.length > 0 || s.events.length > 0) && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", padding: "0 2px" }}>
          <span className="small" style={{ color: "var(--muted)" }}>Jump to:</span>
          {s.dvirs.length > 0 && <button type="button" onClick={() => scrollToSection("jcp-dvirs")} style={jumpBtn}>DVIRs ({s.dvirs.length})</button>}
          {(s.incidents.length > 0 || s.photos.length > 0) && <button type="button" onClick={() => scrollToSection("jcp-incidents")} style={jumpBtn}>Incidents & photos</button>}
          {s.events.length > 0 && <button type="button" onClick={() => scrollToSection("jcp-actions")} style={jumpBtn}>Actions</button>}
        </div>
      )}

      {/* 4. Job Report */}
      <Section title="Job report">
        {report ? (
          <div className="col" style={{ gap: 0 }}>
            <Row label="Submitted by" value={report.submitted_by_name || "-"} />
            <Row label="Total hours" value={`${totalHours.toFixed(2)} h`} />
            {(report.employee_hours || []).filter((e) => (e.name || "").trim()).map((e, i) => (
              <Row key={i} label={`  ${e.name}${e.out_of_town ? " · out of town" : ""}${e.non_billable ? " · non-billable" : ""}`} value={`${(Number(e.hours) || 0).toFixed(2)} h`} />
            ))}
            <Row label="Personal vehicles" value={report.personal_vehicles || "None"} />
            <Row label="M1 dumpster" value={report.dumpster_pct > 0 ? `${report.dumpster_pct}%` : "Not used"} />
            <Row label="M1 recycling" value={report.recycling_pct > 0 ? `${report.recycling_pct}%` : "Not used"} />
            <Row label="Billing method" value={report.billing_method || "-"} />
            <Row label="Review candidate" value={report.review_candidate || "-"} />
            <Row label="Hours match billed" value={report.hours_match == null ? "-" : report.hours_match ? "Yes" : `No - ${report.hours_mismatch_reason || ""}`} />
            <Row label="Out of town" value={yesNoBlank(report.out_of_town)} />
            {report.overage_note && <Row label="Overage note" value={report.overage_note} />}
            {report.crew_feedback && <Row label="Crew feedback" value={report.crew_feedback} />}
          </div>
        ) : (
          <div className="small" style={{ color: "var(--muted)" }}>No job report was filed for this job.</div>
        )}
      </Section>

      {/* 5. DVIRs */}
      {s && s.dvirs.length > 0 && (
        <Section id="jcp-dvirs" title={`DVIRs (${s.dvirs.length})`}>
          <div className="col" style={{ gap: 8 }}>
            {s.dvirs.map((d) => (
              <div key={d.dvir_id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, textTransform: "capitalize" }}>{d.inspection_type} · {d.vehicle_number || "unit ?"}</span>
                  <span className="small" style={{ color: d.defects.length ? "var(--danger)" : "var(--ok)" }}>
                    {d.defects.length ? `${d.defects.length} defect(s)` : "No defects"}
                  </span>
                </div>
                {d.defects.length > 0 && <div className="small" style={{ color: "var(--muted)" }}>{d.defects.join(", ")}</div>}
                {d.defect_notes && <div className="small" style={{ color: "var(--muted)" }}>{d.defect_notes}</div>}
                <div className="small" style={{ color: "var(--muted)" }}>{d.driver_name || ""}{fmtTime(d.created_at) ? ` · ${fmtTime(d.created_at)}` : ""}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 6. Incidents & Photos */}
      {s && (s.incidents.length > 0 || s.photos.length > 0) && (
        <Section id="jcp-incidents" title={`Incidents & photos`} danger={s.incidents.length > 0}>
          {s.incidents.map((i) => (
            <div key={i.incident_uuid} style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 8 }}>
              <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--danger)" }}>{i.severity}</span>
                {i.claim_number && (
                  <span className="small" style={{ fontWeight: 700, color: "var(--brand)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px" }}>{i.claim_number}</span>
                )}
                <span className="small" style={{ color: i.resolved ? "var(--ok)" : "var(--muted)" }}>{i.resolved ? "Resolved" : "Open"}</span>
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{i.description}</div>
              <div className="small" style={{ color: "var(--muted)" }}>
                {i.attributed_crew ? `Attributed: ${i.attributed_crew}` : ""}{i.est_cost != null ? ` · est $${i.est_cost.toFixed(2)}` : ""}
              </div>
              {i.photo_urls.length > 0 && (
                <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  {i.photo_urls.map((u, n) => (
                    <a key={n} href={u} target="_blank" rel="noreferrer" className="small" style={{ color: "var(--brand)" }}>Photo {n + 1}</a>
                  ))}
                </div>
              )}
            </div>
          ))}
          {s.photos.length > 0 && (
            <div style={{ marginTop: s.incidents.length ? 12 : 0 }}>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Job photos ({s.photos.length})</div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {s.photos.map((p) => (
                  <a key={p.id} href={p.drive_url || "#"} target="_blank" rel="noreferrer" className="small" style={{ color: "var(--brand)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 8px" }}>
                    {p.caption || "Photo"}
                  </a>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* 7. Actions log (timeline) */}
      {s && s.events.length > 0 && (
        <Section id="jcp-actions" title={`Actions log (${s.events.length})`}>
          <div className="col" style={{ gap: 4 }}>
            {s.events.map((e) => (
              <div key={e.event_id} className="row" style={{ justifyContent: "space-between", gap: 8, padding: "3px 0", borderTop: "1px solid var(--border)" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{e.type}{e.note ? ` · ${e.note}` : ""}</span>
                <span className="small mono" style={{ color: "var(--muted)", flexShrink: 0 }}>{fmtTime(e.timestamp)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 8. Billing, materials & inventory (compact - so nothing is hidden) */}
      {s && (s.bill || s.materials.length > 0 || s.inventory.items.length > 0 || s.bol || s.reimbursements.length > 0 || s.ld_days.length > 0) && (
        <Section title="Billing, materials & inventory">
          <div className="col" style={{ gap: 0 }}>
            {/* The AMOUNT first - that is what anyone opening a closed job is
                looking for. This row used to read "3 line(s)" and nothing else,
                which is the one fact about a bill nobody needs. Line count and
                discount stay as the sub-line, since they explain the number. */}
            {s.bill && (
              <Row
                label="Bill total"
                value={
                  <span>
                    <strong>{fmtMoney(billTotal(s.bill.items, s.bill.global_discount))}</strong>
                    <span className="small" style={{ color: "var(--muted)" }}>
                      {` · ${(s.bill.items || []).length} line(s)`}
                      {s.bill.global_discount ? ` · ${s.bill.global_discount}% off` : ""}
                    </span>
                  </span>
                }
              />
            )}
            {s.materials.length > 0 && <Row label="Materials" value={`$${s.materials.reduce((a, m) => a + (m.total || 0), 0).toFixed(2)}`} />}
            {(s.inventory.furniture_count > 0 || s.inventory.box_count > 0) && (
              <Row label="Inventory" value={`${s.inventory.furniture_count} furniture · ${s.inventory.box_count} boxes`} />
            )}
            {s.bol && (
              <Row label="Bill of Lading" value={s.bol.signed_pdf_url ? <a href={s.bol.signed_pdf_url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>{s.bol.status} (PDF)</a> : `${s.bol.status} · ${s.bol.item_count} items`} />
            )}
            {s.ld_days.length > 0 && (
              <Row label="Per-diem days" value={`${s.ld_days.filter((d) => d.out_of_town).length} out-of-town · ${s.ld_days.filter((d) => d.drive_day).length} drive`} />
            )}
            {s.reimbursements.map((r) => (
              <Row key={r.reimbursement_uuid} label={`Reimbursement · ${r.user_name}`} value={r.amount != null ? `$${r.amount.toFixed(2)}` : (r.type || "-")} />
            ))}
          </div>
        </Section>
      )}

      {loading && <div className="small" style={{ color: "var(--muted)", textAlign: "center" }}>Loading job summary...</div>}
    </div>
  );
}
