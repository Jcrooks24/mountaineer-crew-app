import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BetaTag } from "../components/BetaTag";
import { formatMountainDateTime } from "../lib/time";
import {
  submitOffJob,
  pendingOffJob,
  fetchMyOffJob,
  drainOffJob,
  newOffJobUuid,
  hoursFromTimes,
  PAY_STRUCTURE_LABELS,
  type PayStructure,
  type OffJobOut,
} from "../lib/offJobStore";

function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PAY_OPTIONS: PayStructure[] = ["regular", "non_billable", "other"];

// A row is either a synced server entry or a still-queued local one.
type DisplayRow = OffJobOut & { pending?: boolean };

export default function OffJob() {
  const nav = useNavigate();

  const [workDate, setWorkDate] = useState(todayLocalIso());
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [hours, setHours] = useState("");
  const [pay, setPay] = useState<PayStructure>("regular");
  const [payOther, setPayOther] = useState("");
  const [notes, setNotes] = useState("");

  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Auto-fill hours from the start/end stamps whenever both are valid. The crew
  // can still overwrite the hours field afterward.
  const computed = useMemo(() => (startTime && endTime ? hoursFromTimes(startTime, endTime) : null), [startTime, endTime]);
  useEffect(() => { if (computed != null) setHours(String(computed)); }, [computed]);

  function renderRows(): DisplayRow[] {
    const pending: DisplayRow[] = pendingOffJob().map((p) => ({
      id: -1,
      entry_uuid: p.entry_uuid,
      submitted_by_name: null,
      work_date: p.work_date,
      start_time: p.start_time,
      end_time: p.end_time,
      hours: p.hours,
      pay_structure: p.pay_structure,
      pay_other_note: p.pay_other_note,
      notes: p.notes,
      created_at: new Date().toISOString(),
      pending: true,
    }));
    return pending;
  }

  async function refresh() {
    const pendingUuids = new Set(pendingOffJob().map((p) => p.entry_uuid));
    let server: OffJobOut[] = [];
    try {
      server = await fetchMyOffJob();
    } catch {
      // offline - show queued only
    }
    const serverRows: DisplayRow[] = server.filter((s) => !pendingUuids.has(s.entry_uuid));
    setRows([...renderRows(), ...serverRows]);
  }

  useEffect(() => {
    (async () => { await drainOffJob(); await refresh(); })();
    function onOnline() { (async () => { await drainOffJob(); await refresh(); })(); }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setWorkDate(todayLocalIso());
    setStartTime("");
    setEndTime("");
    setHours("");
    setPay("regular");
    setPayOther("");
    setNotes("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setOk(null);
    const h = Number(hours);
    if (!notes.trim()) return setErr("Describe what you did.");
    if (!Number.isFinite(h) || h <= 0) return setErr("Enter hours worked (or start and end times).");
    if (pay === "other" && !payOther.trim()) return setErr("Describe the pay arrangement, or pick a different pay type.");

    setBusy(true);
    try {
      await submitOffJob({
        entry_uuid: newOffJobUuid(),
        work_date: workDate || null,
        start_time: startTime.trim() || null,
        end_time: endTime.trim() || null,
        hours: h,
        pay_structure: pay,
        pay_other_note: pay === "other" ? payOther.trim() || null : null,
        notes: notes.trim(),
      });
      setOk(navigator.onLine ? "Off-job hours submitted." : "Saved - will submit when back online.");
      resetForm();
      await refresh();
    } catch {
      setOk("Saved - will submit when back online.");
      resetForm();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <div className="topbar" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>Log Off-Job Hours</div>
        <button
          onClick={() => nav(-1)}
          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13, padding: "4px 8px" }}
        >
          &larr; Back
        </button>
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <div className="sectionTitle" style={{ marginBottom: 0 }}>Off-job hours</div>
          <BetaTag feature="offJobHours" style={{ marginTop: 0 }} />
        </div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 4 }}>
          For work not tied to a job (usually approved by management ahead of time).
          Works offline - queued entries sync automatically.
        </div>

        <form onSubmit={handleSubmit} className="col" style={{ gap: 12, marginTop: 8 }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Date</span>
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          </label>

          <div className="row wrap" style={{ gap: 10 }}>
            <label className="col" style={{ gap: 4, flex: "1 1 120px" }}>
              <span className="small" style={{ color: "var(--muted)" }}>Start (optional)</span>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
            <label className="col" style={{ gap: 4, flex: "1 1 120px" }}>
              <span className="small" style={{ color: "var(--muted)" }}>End (optional)</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </label>
            <label className="col" style={{ gap: 4, flex: "1 1 100px" }}>
              <span className="small" style={{ color: "var(--muted)" }}>Hours *</span>
              <input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="0" />
            </label>
          </div>

          <div className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Pay structure * (management-approved)</span>
            <div className="row wrap" style={{ gap: 6 }}>
              {PAY_OPTIONS.map((p) => {
                const on = pay === p;
                return (
                  <button key={p} type="button" onClick={() => setPay(p)}
                    style={{ flex: "1 1 100px", padding: "8px 0", borderRadius: 8, fontSize: 13, cursor: "pointer",
                      border: on ? "2px solid var(--brand)" : "1px solid var(--border)",
                      background: on ? "rgba(93,214,194,0.18)" : "transparent",
                      color: on ? "var(--brand)" : "var(--muted)", fontWeight: on ? 700 : 400 }}>
                    {PAY_STRUCTURE_LABELS[p]}
                  </button>
                );
              })}
            </div>
          </div>

          {pay === "other" && (
            <label className="col" style={{ gap: 4 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Pay arrangement *</span>
              <input value={payOther} onChange={(e) => setPayOther(e.target.value)} placeholder="e.g. flat $150 approved by office" />
            </label>
          )}

          <label className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>What did you do? *</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Describe the work done off-job." />
          </label>

          {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}
          {ok && <div className="small" style={{ color: "var(--ok)" }}>{ok}</div>}

          <button className="btnPrimary" disabled={busy} type="submit">{busy ? "Saving…" : "Submit hours"}</button>
        </form>
      </div>

      <div className="card">
        <div className="sectionTitle">Your off-job entries</div>
        {rows.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>No off-job hours logged.</div>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            {rows.map((r) => (
              <div key={r.entry_uuid} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, opacity: r.pending ? 0.7 : 1 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>
                    {r.hours}h
                    <span className="small" style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>
                      {PAY_STRUCTURE_LABELS[r.pay_structure]}{r.pay_structure === "other" && r.pay_other_note ? ` - ${r.pay_other_note}` : ""}
                    </span>
                  </span>
                  <span className="small" style={{ color: "var(--muted)" }}>
                    {r.pending ? "Syncing…" : (r.work_date || formatMountainDateTime(r.created_at))}
                  </span>
                </div>
                <div style={{ fontSize: 14, marginTop: 4 }}>{r.notes}</div>
                {(r.start_time || r.end_time) && (
                  <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                    {r.start_time || "?"}–{r.end_time || "?"}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
