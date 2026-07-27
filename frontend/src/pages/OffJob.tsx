import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BetaTag } from "../components/BetaTag";
import { formatMountainDateTime } from "../lib/time";
import {
  submitOffJob,
  retryFailedOffJob,
  discardFailedOffJob,
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

// A row is either a synced server entry, a still-queued local one, or one the
// server permanently refused (failed_at set): still on this phone, waiting on a
// person, never silently deleted (ADR 0013).
type DisplayRow = OffJobOut & {
  pending?: boolean;
  failed_at?: string;
  failed_reason?: string;
};

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
      failed_at: p.failed_at,
      failed_reason: p.failed_reason,
    }));
    return pending;
  }

  async function retryEntry(entryUuid: string) {
    setBusy(true);
    setErr(null);
    try {
      const rejected = await retryFailedOffJob(entryUuid);
      if (rejected.includes(entryUuid)) {
        const again = pendingOffJob().find((p) => p.entry_uuid === entryUuid);
        setErr(`Still not sent: ${again?.failed_reason || "the server rejected it again."}`);
      } else {
        setOk("Off-job hours submitted.");
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function discardEntry(entryUuid: string) {
    // Confirm-gated: the only path that destroys the entry, and it was never
    // sent, so there is no other copy.
    const proceed = window.confirm(
      "Delete these hours?\n\nThey were never sent to the office, so this permanently removes the only copy.",
    );
    if (!proceed) return;
    discardFailedOffJob(entryUuid);
    await refresh();
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
      const { failedReason } = await submitOffJob({
        entry_uuid: newOffJobUuid(),
        work_date: workDate || null,
        start_time: startTime.trim() || null,
        end_time: endTime.trim() || null,
        hours: h,
        pay_structure: pay,
        pay_other_note: pay === "other" ? payOther.trim() || null : null,
        notes: notes.trim(),
      });
      if (failedReason) {
        // Refused by the server. The hours are still on this phone and listed
        // below with a Retry, but do not tell somebody their hours are filed
        // when they are not: these feed payroll.
        setErr(`Not sent: ${failedReason} The entry is still saved on this phone - retry it below.`);
        await refresh();
        setBusy(false);
        return;
      }
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
          <div className="microLabel" style={{ marginBottom: 0 }}>Off-job hours</div>
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
            <div className="seg">
              {PAY_OPTIONS.map((p) => {
                const on = pay === p;
                return (
                  <button key={p} type="button" aria-pressed={on}
                    className={"segBtn" + (on ? " on" : "")}
                    style={{ ["--seg" as any]: "var(--brand)" }}
                    onClick={() => setPay(p)}>
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
        <div className="microLabel" style={{ marginBottom: 10 }}>Your off-job entries</div>
        {rows.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>No off-job hours logged.</div>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            {rows.map((r) => (
              <div
                key={r.entry_uuid}
                style={{
                  border: `1px solid ${r.failed_at ? "var(--danger)" : "var(--border)"}`,
                  borderRadius: 10,
                  padding: 10,
                  opacity: r.pending && !r.failed_at ? 0.7 : 1,
                }}
              >
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>
                    <span className="mono">{r.hours}h</span>
                    <span className="small" style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>
                      {PAY_STRUCTURE_LABELS[r.pay_structure]}{r.pay_structure === "other" && r.pay_other_note ? ` - ${r.pay_other_note}` : ""}
                    </span>
                  </span>
                  {r.failed_at ? (
                    <span className="statusDot" style={{ ["--dot" as any]: "var(--danger)", fontWeight: 600 }}>Not sent</span>
                  ) : r.pending ? (
                    <span className="statusDot" style={{ ["--dot" as any]: "var(--muted)" }}>Syncing…</span>
                  ) : (
                    <span className="small mono" style={{ color: "var(--muted)" }}>{r.work_date || formatMountainDateTime(r.created_at)}</span>
                  )}
                </div>
                <div style={{ fontSize: 14, marginTop: 4 }}>{r.notes}</div>
                {(r.start_time || r.end_time) && (
                  <div className="small mono" style={{ color: "var(--muted)", marginTop: 2 }}>
                    {r.start_time || "?"}–{r.end_time || "?"}
                  </div>
                )}
                {r.failed_at && (
                  <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                    <div className="small" style={{ color: "var(--muted)" }}>{r.failed_reason}</div>
                    <div className="small" style={{ marginTop: 4 }}>
                      It is still saved on this phone. Nothing has been lost.
                    </div>
                    <div className="row" style={{ gap: 8, marginTop: 8 }}>
                      <button
                        className="btnPrimary"
                        disabled={busy}
                        style={{ padding: "8px 14px", fontSize: 13, minHeight: 40 }}
                        onClick={() => retryEntry(r.entry_uuid)}
                      >
                        Retry
                      </button>
                      <button
                        disabled={busy}
                        style={{
                          padding: "8px 14px",
                          fontSize: 13,
                          minHeight: 40,
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--muted)",
                        }}
                        onClick={() => discardEntry(r.entry_uuid)}
                      >
                        Delete
                      </button>
                    </div>
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
