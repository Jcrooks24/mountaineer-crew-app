import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  computeWorkedHours,
  enqueueDeleteOrCancel,
  enqueueUpsert,
  fetchAndCache,
  newEntryUuid,
  pendingOpCount,
  rendered,
  syncQueue,
  type BreakPeriod,
  type OfficeHoursEntry,
  type OfficeHoursInput,
} from "../lib/officeHoursStore";

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type FormState = {
  entry_uuid: string;
  work_date: string;
  start_time: string;
  end_time: string;
  breaks: BreakPeriod[];
  notes: string;
};

function emptyForm(): FormState {
  return {
    entry_uuid: "",
    work_date: todayISO(),
    start_time: "",
    end_time: "",
    breaks: [],
    notes: "",
  };
}

/**
 * Office Hours entry panel - embedded as a tab in the Admin dashboard.
 * Admin-only; the Admin page already gates on role so no extra check here.
 *
 * Time entry mirrors the Report tab's employee-hours editor: a start and an
 * end time, plus any number of clocked-out periods entered as their own
 * start/end pairs. Net hours are derived, not typed.
 */
export default function OfficeHoursPanel() {
  const { user } = useAuth();

  const [entries, setEntries] = useState<OfficeHoursEntry[]>(() => rendered());
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(() => pendingOpCount());

  function refresh() {
    setEntries(rendered());
    setPendingCount(pendingOpCount());
  }

  useEffect(() => {
    (async () => {
      await syncQueue();
      const ok = await fetchAndCache();
      if (ok) refresh();
    })();

    function onOnline() {
      (async () => {
        const drained = await syncQueue();
        const ok = await fetchAndCache();
        if (drained || ok) refresh();
      })();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const computation = useMemo(
    () => computeWorkedHours(form.start_time, form.end_time, form.breaks),
    [form.start_time, form.end_time, form.breaks],
  );

  function resetForm() {
    setForm(emptyForm());
    setEditing(false);
    setErr(null);
  }

  function startEdit(e: OfficeHoursEntry) {
    setEditing(true);
    // Saved rows only persist a break-hours total, not the individual
    // periods. Surface a single representative period if there was any
    // break time, so the editor stays consistent - the admin can re-split
    // it if they want different math.
    const breaks: BreakPeriod[] =
      e.break_hours > 0 ? [{ start: "", end: "" }] : [];
    setForm({
      entry_uuid: e.entry_uuid,
      work_date: e.work_date,
      start_time: e.start_time,
      end_time: e.end_time,
      breaks,
      notes: e.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addBreak() {
    setForm((f) => ({ ...f, breaks: [...f.breaks, { start: "", end: "" }] }));
  }
  function updateBreak(i: number, patch: Partial<BreakPeriod>) {
    setForm((f) => ({
      ...f,
      breaks: f.breaks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)),
    }));
  }
  function removeBreak(i: number) {
    setForm((f) => ({ ...f, breaks: f.breaks.filter((_, idx) => idx !== i) }));
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErr(null);

    if (!form.work_date || !form.start_time || !form.end_time) {
      setErr("Date, start, and end times are required.");
      return;
    }
    if (computation.kind === "error") {
      setErr(computation.message);
      return;
    }
    if (computation.kind !== "ok") {
      setErr("Enter valid start and end times.");
      return;
    }

    const input: OfficeHoursInput = {
      entry_uuid: form.entry_uuid || newEntryUuid(),
      work_date: form.work_date,
      start_time: form.start_time,
      end_time: form.end_time,
      break_hours: computation.breakHours,
      hours: computation.hours,
      notes: form.notes,
    };

    setBusy(true);
    try {
      enqueueUpsert(input, user?.name || user?.email || "");
      refresh();
      (async () => {
        await syncQueue();
        await fetchAndCache();
        refresh();
      })();
      resetForm();
    } finally {
      setBusy(false);
    }
  }

  function handleDelete(entry_uuid: string) {
    if (!window.confirm("Delete this entry?")) return;
    enqueueDeleteOrCancel(entry_uuid);
    refresh();
    (async () => {
      await syncQueue();
      await fetchAndCache();
      refresh();
    })();
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card">
        <div className="sectionTitle">{editing ? "Edit entry" : "Log office hours"}</div>
        <form onSubmit={handleSubmit} className="col" style={{ gap: 10 }}>
          <div>
            <div className="label">Date</div>
            <input
              type="date"
              value={form.work_date}
              onChange={(e) => setForm((f) => ({ ...f, work_date: e.target.value }))}
              required
            />
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="label">Clock in</div>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                required
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="label">Clock out</div>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                required
              />
            </div>
          </div>

          {/* Breaks - clocked-out periods, entered as start/end pairs to
              match the Report tab's employee-hours editor. */}
          <div>
            <div className="label">Breaks / clocked-out time</div>
            {form.breaks.length === 0 && (
              <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
                No breaks added.
              </div>
            )}
            <div className="col" style={{ gap: 8, marginTop: 6 }}>
              {form.breaks.map((b, i) => (
                <div key={i} className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input
                    type="time"
                    value={b.start}
                    onChange={(e) => updateBreak(i, { start: e.target.value })}
                    aria-label="Break start"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <span className="small" style={{ color: "var(--muted)" }}>to</span>
                  <input
                    type="time"
                    value={b.end}
                    onChange={(e) => updateBreak(i, { end: e.target.value })}
                    aria-label="Break end"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button
                    type="button"
                    onClick={() => removeBreak(i)}
                    style={{
                      fontSize: 12, color: "var(--danger)",
                      border: "1px solid var(--danger)", background: "none",
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addBreak}
              style={{ fontSize: 13, marginTop: 8 }}
            >
              + Add break
            </button>
          </div>

          <div
            className="small"
            style={{
              color: computation.kind === "error" ? "var(--danger)" : "var(--muted)",
            }}
          >
            {computation.kind === "ok"
              ? `Worked ${computation.hours.toFixed(2)}h` +
                (computation.breakHours > 0
                  ? ` (${computation.spanHours.toFixed(2)}h span − ${computation.breakHours.toFixed(2)}h break)`
                  : "")
              : computation.kind === "error"
                ? computation.message
                : "Enter clock-in and clock-out times to see total hours."}
          </div>

          <div>
            <div className="label">Notes</div>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="Optional"
              style={{
                width: "100%", padding: "8px 10px", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--bg)",
                color: "var(--text)", fontSize: 14, resize: "vertical", boxSizing: "border-box",
              }}
            />
          </div>
          {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btnPrimary" disabled={busy} type="submit">
              {editing ? "Save changes" : "Add entry"}
            </button>
            {editing && (
              <button type="button" onClick={resetForm} disabled={busy} style={{ fontSize: 13 }}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <div className="sectionTitle">
          Entries
          {pendingCount > 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, color: "var(--muted)" }}>
              ({pendingCount} pending sync)
            </span>
          )}
        </div>
        {entries.length === 0 && (
          <div className="small" style={{ color: "var(--muted)" }}>No entries yet.</div>
        )}
        <div className="col" style={{ gap: 8 }}>
          {entries.map((e) => (
            <div
              key={e.entry_uuid}
              style={{
                borderTop: "1px solid var(--border)",
                paddingTop: 8,
                opacity: e.pending ? 0.7 : 1,
              }}
            >
              <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {e.work_date} · {e.hours.toFixed(2)}h
                    {e.pending && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--muted)" }}>(pending)</span>}
                  </div>
                  <div className="small" style={{ color: "var(--muted)" }}>
                    {e.start_time}–{e.end_time}
                    {e.break_hours > 0 ? ` · break ${e.break_hours.toFixed(2)}h` : ""}
                  </div>
                  {e.notes && (
                    <div style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>
                      {e.notes}
                    </div>
                  )}
                </div>
                <div className="col" style={{ gap: 4, alignItems: "flex-end" }}>
                  <button onClick={() => startEdit(e)} style={{ fontSize: 12 }}>Edit</button>
                  <button
                    onClick={() => handleDelete(e.entry_uuid)}
                    style={{ fontSize: 12, color: "var(--danger)", border: "1px solid var(--danger)", background: "none" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
