import { useEffect, useMemo, useState } from "react";
import RosterTypeahead from "./RosterTypeahead";
import { BetaTag } from "./BetaTag";
import { mountainDateYYYYMMDD } from "../lib/time";
import { formatMountainDateTime } from "../lib/time";
import {
  submitIncident,
  fetchJobIncidents,
  pendingIncidents,
  newIncidentUuid,
  type IncidentOut,
  type IncidentPayload,
  type Severity,
  type Attributable,
} from "../lib/incidentStore";

const SEVERITIES: { value: Severity; label: string; color: string }[] = [
  { value: "minor", label: "Minor", color: "var(--ok)" },
  { value: "moderate", label: "Moderate", color: "#f59e0b" },
  { value: "major", label: "Major", color: "var(--danger)" },
];

const ATTRIBUTABLE: { value: Attributable; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unknown", label: "Unknown" },
];

export default function IncidentReport({
  jobUuid,
  jobName,
  jobDate,
}: {
  jobUuid: string;
  jobName?: string;
  jobDate?: string;
}) {
  const [incidents, setIncidents] = useState<IncidentOut[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");

  // Form state
  const [date, setDate] = useState(jobDate || mountainDateYYYYMMDD());
  const [attributed, setAttributed] = useState("");
  const [severity, setSeverity] = useState<Severity>("minor");
  const [attributable, setAttributable] = useState<Attributable>("unknown");
  const [description, setDescription] = useState("");
  const [estCost, setEstCost] = useState("");
  const [resolved, setResolved] = useState(false);
  const [notes, setNotes] = useState("");
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

  function resetForm() {
    setDate(jobDate || mountainDateYYYYMMDD());
    setAttributed("");
    setSeverity("minor");
    setAttributable("unknown");
    setDescription("");
    setEstCost("");
    setResolved(false);
    setNotes("");
    setErr(null);
  }

  async function submit() {
    if (!description.trim()) { setErr("Describe what happened."); return; }
    setBusy(true); setErr(null);
    const payload: IncidentPayload = {
      incident_uuid: newIncidentUuid(),
      job_uuid: jobUuid || null,
      job_name: jobName || null,
      incident_date: date || null,
      attributed_crew: attributed.trim() || null,
      severity,
      attributable,
      description: description.trim(),
      est_cost: estCost.trim() ? Number(estCost) : null,
      resolved,
      notes: notes.trim() || null,
      photo_urls: [],
    };
    try {
      await submitIncident(payload);
      setStatus(navigator.onLine ? "Incident submitted" : "Saved — will submit when back online");
      resetForm();
      setShowForm(false);
      await refresh();
    } catch (e: any) {
      // submitIncident queues first, so the record is never lost even here.
      setStatus("Saved — will submit when back online");
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
      <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 12 }}>
        Log damage, injuries, or near-misses on {jobName ? <strong>{jobName}</strong> : "this job"}. Saved offline and synced when back online.
      </div>

      {status && <div className="small" style={{ color: "var(--ok)", marginBottom: 8 }}>{status}</div>}

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

          <div className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Attributable?</span>
            <div className="row" style={{ gap: 6 }}>
              {ATTRIBUTABLE.map((a) => {
                const on = attributable === a.value;
                return (
                  <button key={a.value} type="button" onClick={() => setAttributable(a.value)}
                    style={{ flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 13, cursor: "pointer",
                      border: on ? "2px solid var(--brand)" : "1px solid var(--border)",
                      background: on ? "rgba(93,214,194,0.18)" : "transparent",
                      color: on ? "var(--brand)" : "var(--muted)", fontWeight: on ? 700 : 400 }}>
                    {a.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>What happened? *</span>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the incident, location, and any damage." />
          </label>

          <div className="row wrap" style={{ gap: 10 }}>
            <label className="col" style={{ gap: 4, flex: "1 1 120px" }}>
              <span className="small" style={{ color: "var(--muted)" }}>Est. cost ($)</span>
              <input inputMode="decimal" value={estCost} onChange={(e) => setEstCost(e.target.value)} placeholder="0" />
            </label>
            <label className="row" style={{ gap: 8, alignItems: "center", flex: "1 1 120px", marginTop: 18 }}>
              <input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} style={{ accentColor: "var(--brand)", width: 16, height: 16 }} />
              <span className="small">Resolved on site</span>
            </label>
          </div>

          <label className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Others involved / notes</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </label>

          <div className="small" style={{ color: "var(--muted)" }}>
            Need photos? Add them on the Photos tab and mention this incident in the note.
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
            <IncidentRow key={q.incident_uuid} severity={q.severity} date={q.incident_date} description={q.description} attributed={q.attributed_crew} pending />
          ))}
        </div>
      )}

      {/* Synced incidents */}
      {incidents.length === 0 && queued.length === 0 ? (
        <div className="small" style={{ color: "var(--muted)" }}>No incidents logged.</div>
      ) : (
        <div className="col" style={{ gap: 6 }}>
          {incidents.map((inc) => (
            <IncidentRow key={inc.id} severity={inc.severity} date={inc.incident_date} description={inc.description}
              attributed={inc.attributed_crew} createdAt={inc.created_at} reportedBy={inc.reported_by_name} resolved={inc.resolved} />
          ))}
        </div>
      )}
    </div>
  );
}

function IncidentRow({
  severity, date, description, attributed, createdAt, reportedBy, resolved, pending,
}: {
  severity: string;
  date?: string | null;
  description: string;
  attributed?: string | null;
  createdAt?: string;
  reportedBy?: string | null;
  resolved?: boolean;
  pending?: boolean;
}) {
  const color = severity === "major" ? "var(--danger)" : severity === "moderate" ? "#f59e0b" : "var(--ok)";
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, opacity: pending ? 0.7 : 1 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color }}>{severity}</span>
        <span className="small" style={{ color: "var(--muted)" }}>
          {pending ? "Syncing…" : (createdAt ? formatMountainDateTime(createdAt) : (date || ""))}
        </span>
      </div>
      <div style={{ fontSize: 14, marginTop: 4 }}>{description}</div>
      <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
        {[attributed ? `Attributed: ${attributed}` : null, reportedBy ? `by ${reportedBy}` : null, resolved ? "Resolved" : null].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
}
