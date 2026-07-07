import { useEffect, useMemo, useState } from "react";
import RosterTypeahead from "./RosterTypeahead";
import { BetaTag } from "./BetaTag";
import { useTheme } from "../theme/ThemeContext";
import { mountainDateYYYYMMDD } from "../lib/time";
import { formatMountainDateTime } from "../lib/time";
import {
  submitIncident,
  fetchJobIncidents,
  pendingIncidents,
  newIncidentUuid,
  newClaimNumber,
  type IncidentOut,
  type IncidentPayload,
  type Severity,
} from "../lib/incidentStore";

const SEVERITIES: { value: Severity; label: string; color: string }[] = [
  { value: "minor", label: "Minor", color: "var(--ok)" },
  { value: "moderate", label: "Moderate", color: "#f59e0b" },
  { value: "major", label: "Major", color: "var(--danger)" },
];

// Lightweight shape passed up to the Photos tab so it can offer an
// "attach these photos to <claim>" selector on the pending batch.
export type JobIncidentRef = {
  incident_uuid: string;
  claim_number: string;
  severity: string;
  description: string;
};

export default function IncidentReport({
  jobUuid,
  jobName,
  jobDate,
  onIncidentsChange,
  onReported,
  photoCounts,
}: {
  jobUuid: string;
  jobName?: string;
  jobDate?: string;
  // Fires whenever the known incidents for this job change (synced + queued),
  // so the parent can drive the photo attach-target selector.
  onIncidentsChange?: (list: JobIncidentRef[]) => void;
  // Fires right after a new incident is submitted so the parent can auto-select
  // it as the attach target for the next photo batch.
  onReported?: (ref: JobIncidentRef) => void;
  // incident_uuid -> number of photos already tagged to it (local + server).
  photoCounts?: Record<string, number>;
}) {
  const { settings } = useTheme();
  const ht = settings.helpTexts;
  const [incidents, setIncidents] = useState<IncidentOut[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");

  // Form state
  const [date, setDate] = useState(jobDate || mountainDateYYYYMMDD());
  const [attributed, setAttributed] = useState("");
  const [severity, setSeverity] = useState<Severity>("minor");
  const [description, setDescription] = useState("");
  const [resolved, setResolved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const list = await fetchJobIncidents(jobUuid);
      setIncidents(list);
    } catch {
      // offline - show queued below
    }
  }

  useEffect(() => { if (jobUuid) refresh(); /* eslint-disable-next-line */ }, [jobUuid]);

  const queued = useMemo(() => pendingIncidents(jobUuid), [jobUuid, status]);

  // Surface the union of synced + queued incidents to the parent so it can
  // offer a photo attach target. Deduped by incident_uuid (synced wins).
  useEffect(() => {
    const seen = new Set<string>();
    const refs: JobIncidentRef[] = [];
    for (const inc of incidents) {
      seen.add(inc.incident_uuid);
      refs.push({
        incident_uuid: inc.incident_uuid,
        claim_number: inc.claim_number || "",
        severity: inc.severity,
        description: inc.description,
      });
    }
    for (const q of queued) {
      if (seen.has(q.incident_uuid)) continue;
      refs.push({
        incident_uuid: q.incident_uuid,
        claim_number: q.claim_number || "",
        severity: q.severity,
        description: q.description,
      });
    }
    onIncidentsChange?.(refs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidents, queued]);

  function resetForm() {
    setDate(jobDate || mountainDateYYYYMMDD());
    setAttributed("");
    setSeverity("minor");
    setDescription("");
    setResolved(false);
    setErr(null);
  }

  async function submit() {
    if (!description.trim()) { setErr("Describe what happened."); return; }
    setBusy(true); setErr(null);
    const incidentUuid = newIncidentUuid();
    const claimNumber = newClaimNumber(date || null, incidentUuid);
    const payload: IncidentPayload = {
      incident_uuid: incidentUuid,
      claim_number: claimNumber,
      job_uuid: jobUuid || null,
      job_name: jobName || null,
      incident_date: date || null,
      attributed_crew: attributed.trim() || null,
      severity,
      // The crew form no longer collects these; send neutral defaults so the
      // admin log + sheet columns stay populated.
      attributable: "unknown",
      description: description.trim(),
      est_cost: null,
      resolved,
      notes: null,
      photo_urls: [],
    };
    try {
      await submitIncident(payload);
      setStatus(
        navigator.onLine
          ? `Incident submitted - Claim ${claimNumber}`
          : `Saved offline - Claim ${claimNumber}. Will submit when back online.`,
      );
      onReported?.({ incident_uuid: incidentUuid, claim_number: claimNumber, severity, description: description.trim() });
      resetForm();
      setShowForm(false);
      await refresh();
    } catch {
      // submitIncident queues first, so the record is never lost even here.
      setStatus(`Saved offline - Claim ${claimNumber}. Will submit when back online.`);
      onReported?.({ incident_uuid: incidentUuid, claim_number: claimNumber, severity, description: description.trim() });
      setShowForm(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ alignItems: "center", gap: 8, justifyContent: "space-between" }}>
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <div className="sectionTitle" style={{ marginBottom: 0 }}>Incidents</div>
          <BetaTag feature="incidentReporting" style={{ marginTop: 0 }} />
        </div>
        {!showForm && (
          <button className="btnPrimary" style={{ padding: "6px 14px" }} onClick={() => { resetForm(); setShowForm(true); }}>
            Report incident
          </button>
        )}
      </div>
      {ht.incidentHint && (
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 12 }}>
          {ht.incidentHint}
        </div>
      )}

      {status && <div className="small" style={{ color: "var(--ok)", marginBottom: 8, fontWeight: 600 }}>{status}</div>}

      {showForm && (
        <div className="col" style={{ gap: 12, marginBottom: 14 }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          <div className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Severity</span>
            <div className="row" style={{ gap: 6 }}>
              {SEVERITIES.map((s) => {
                const on = severity === s.value;
                return (
                  <button key={s.value} type="button" onClick={() => setSeverity(s.value)}
                    style={{ flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 13, cursor: "pointer",
                      border: on ? `2px solid ${s.color}` : "1px solid var(--border)",
                      background: on ? "rgba(255,255,255,0.06)" : "transparent",
                      color: on ? s.color : "var(--muted)", fontWeight: on ? 700 : 400 }}>
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Attributed to</span>
            <RosterTypeahead value={attributed} onChange={setAttributed} placeholder="Crew member (or leave blank)" />
            <button type="button" onClick={() => setAttributed("Unknown / Crew")}
              style={{ alignSelf: "flex-start", fontSize: 12, padding: "3px 10px", marginTop: 2 }}>
              Unknown / Crew
            </button>
          </div>

          <label className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>What happened? *</span>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder={ht.incidentDescriptionPlaceholder} />
          </label>

          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} style={{ accentColor: "var(--brand)", width: 16, height: 16 }} />
            <span className="small">Resolved on site</span>
          </label>

          <div className="small" style={{ color: "var(--muted)" }}>
            A claim number is generated when you submit. Add photos below and tag them to the claim to document the incident.
          </div>

          {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}

          <div className="row" style={{ gap: 8 }}>
            <button className="btnPrimary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Submit incident"}</button>
            <button onClick={() => setShowForm(false)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {/* Queued (not yet synced) */}
      {queued.length > 0 && (
        <div className="col" style={{ gap: 6, marginBottom: 10 }}>
          {queued.map((q) => (
            <IncidentRow key={q.incident_uuid} claimNumber={q.claim_number} severity={q.severity} date={q.incident_date}
              description={q.description} attributed={q.attributed_crew} resolved={q.resolved}
              photoCount={photoCounts?.[q.incident_uuid] || 0} pending />
          ))}
        </div>
      )}

      {/* Synced incidents */}
      {incidents.length === 0 && queued.length === 0 ? (
        <div className="small" style={{ color: "var(--muted)" }}>No incidents logged.</div>
      ) : (
        <div className="col" style={{ gap: 6 }}>
          {incidents.map((inc) => (
            <IncidentRow key={inc.id} claimNumber={inc.claim_number} severity={inc.severity} date={inc.incident_date}
              description={inc.description} attributed={inc.attributed_crew} createdAt={inc.created_at}
              reportedBy={inc.reported_by_name} resolved={inc.resolved}
              photoCount={photoCounts?.[inc.incident_uuid] || 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function IncidentRow({
  claimNumber, severity, date, description, attributed, createdAt, reportedBy, resolved, photoCount, pending,
}: {
  claimNumber?: string | null;
  severity: string;
  date?: string | null;
  description: string;
  attributed?: string | null;
  createdAt?: string;
  reportedBy?: string | null;
  resolved?: boolean;
  photoCount?: number;
  pending?: boolean;
}) {
  const color = severity === "major" ? "var(--danger)" : severity === "moderate" ? "#f59e0b" : "var(--ok)";
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, opacity: pending ? 0.7 : 1 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span className="row" style={{ gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color }}>{severity}</span>
          {claimNumber && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--brand)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px" }}>
              {claimNumber}
            </span>
          )}
        </span>
        <span className="small" style={{ color: "var(--muted)" }}>
          {pending ? "Syncing…" : (createdAt ? formatMountainDateTime(createdAt) : (date || ""))}
        </span>
      </div>
      <div style={{ fontSize: 14, marginTop: 4 }}>{description}</div>
      <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
        {[
          attributed ? `Attributed: ${attributed}` : null,
          reportedBy ? `by ${reportedBy}` : null,
          resolved ? "Resolved" : null,
          photoCount ? `${photoCount} photo${photoCount === 1 ? "" : "s"} attached` : null,
        ].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
}
