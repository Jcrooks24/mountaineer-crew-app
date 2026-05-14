import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  computeHours,
  enqueueDeleteOrCancel,
  enqueueUpsert,
  fetchAndCache,
  newEntryUuid,
  pendingOpCount,
  rendered,
  syncQueue,
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
  break_hours: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  entry_uuid: "",
  work_date: todayISO(),
  start_time: "09:00",
  end_time: "17:00",
  break_hours: "0",
  notes: "",
};

export default function OfficeHours() {
  const { user } = useAuth();
  const nav = useNavigate();

  const [entries, setEntries] = useState<OfficeHoursEntry[]>(() => rendered());
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(() => pendingOpCount());

  function refresh() {
    setEntries(rendered());
    setPendingCount(pendingOpCount());
  }

  // Bounce non-admins. RequireAuth handles the unauthenticated case; this
  // handles the wrong-role case (a regular crew user with a stale tab open).
  useEffect(() => {
    if (user && user.role !== "admin") nav("/", { replace: true });
  }, [user, nav]);

  // On mount: drain any queue + refetch from server, then re-render. The
  // optimistic render runs immediately so the page is never blank.
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

  const hoursPreview = useMemo(() => {
    const br = Number(form.break_hours) || 0;
    return computeHours(form.start_time, form.end_time, br);
  }, [form.start_time, form.end_time, form.break_hours]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditing(false);
    setErr(null);
  }

  function startEdit(e: OfficeHoursEntry) {
    setEditing(true);
    setForm({
      entry_uuid: e.entry_uuid,
      work_date: e.work_date,
      start_time: e.start_time,
      end_time: e.end_time,
      break_hours: String(e.break_hours ?? 0),
      notes: e.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErr(null);

    if (!form.work_date || !form.start_time || !form.end_time) {
      setErr("Date, start, and end are required.");
      return;
    }
    const breakHours = Number(form.break_hours) || 0;
    const hours = computeHours(form.start_time, form.end_time, breakHours);
    if (hours <= 0) {
      setErr("End time must be after start time (plus break).");
      return;
    }

    const input: OfficeHoursInput = {
      entry_uuid: form.entry_uuid || newEntryUuid(),
      work_date: form.work_date,
      start_time: form.start_time,
      end_time: form.end_time,
      break_hours: breakHours,
      hours,
      notes: form.notes,
    };

    setBusy(true);
    try {
      enqueueUpsert(input, user?.name || user?.email || "");
      refresh();
      // Best-effort sync — keeps the queue from sitting around when online.
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

  async function handleDelete(entry_uuid: string) {
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
    <div className="container" style={{ maxWidth: 640 }}>
      <div className="topbar" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>Office Hours</div>
        <button
          onClick={() => nav(-1)}
          style={{
            background: "none", border: "none", color: "var(--muted)",
            cursor: "pointer", fontSize: 13, padding: "4px 8px",
          }}
        >
          &larr; Back
        </button>
      </div>

      <div className="card">
        <div className="sectionTitle">{editing ? "Edit entry" : "New entry"}</div>
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
            <div style={{ flex: 1 }}>
              <div className="label">Start</div>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                required
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="label">End</div>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                required
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="label">Break (h)</div>
              <input
                type="number"
                step={0.25}
                min={0}
                value={form.break_hours}
                onChange={(e) => setForm((f) => ({ ...f, break_hours: e.target.value }))}
              />
            </div>
          </div>
          <div className="small" style={{ color: "var(--muted)" }}>
            Hours: <strong>{hoursPreview.toFixed(2)}</strong>
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
                    {e.break_hours > 0 ? ` · break ${e.break_hours}h` : ""}
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
