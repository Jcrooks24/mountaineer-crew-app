/**
 * Job checklist card (C3.3) - shown on the hub for the selected job.
 *
 * Renders the applicable checklist items (filtered by long-distance + job type
 * from the header). AUTO items tick themselves from the live signals and are
 * read-only; MANUAL items the crew tick, offline-safe. The template comes from
 * admin config; this card only shows what is done for THIS job.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { loadJobSetup } from "../lib/jobSetupStore";
import {
  loadChecklistItems,
  loadChecklistStatus,
  cachedItems,
  cachedStatus,
  setManualCheck,
  type ChecklistItem,
  type ChecklistStatus,
} from "../lib/jobChecklistStore";

export default function JobChecklistCard({
  jobUuid,
  longDistance,
  refreshKey,
}: {
  jobUuid: string;
  longDistance: boolean;
  // Bump to force a re-pull of the AUTO signals. The card is persistent across
  // in-app tabs, so finishing the job report (a tab, not a route change) would
  // otherwise leave its "job report completed" auto-item stale until remount.
  refreshKey?: string | number;
}) {
  const [items, setItems] = useState<ChecklistItem[]>(() => cachedItems());
  const [status, setStatus] = useState<ChecklistStatus>(
    () => cachedStatus(jobUuid) || { signals: {}, manual: {} },
  );
  const [isLD, setIsLD] = useState(longDistance);
  const [tags, setTags] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [its, st, header] = await Promise.all([
      loadChecklistItems(),
      loadChecklistStatus(jobUuid),
      loadJobSetup(jobUuid).catch(() => null),
    ]);
    setItems(its);
    setStatus(st);
    if (header) {
      setIsLD(!!header.is_long_distance);
      setTags(header.job_type_tags || []);
    }
  }, [jobUuid]);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  const applicable = useMemo(
    () =>
      items.filter(
        (it) =>
          (!it.ld_only || isLD) &&
          (it.job_types.length === 0 || it.job_types.some((t) => tags.includes(t))),
      ),
    [items, isLD, tags],
  );

  const isChecked = (it: ChecklistItem): boolean =>
    it.auto_key ? !!status.signals[it.auto_key] : !!status.manual[it.key];

  const done = applicable.filter(isChecked).length;
  const total = applicable.length;

  // Open the checklist by default the first time it loads with unfinished items
  // - a checklist that hides what is still undone is no nudge in the field. Only
  // auto-opens once, so it still respects the crew closing it afterward.
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (didAutoOpen.current || total === 0) return;
    didAutoOpen.current = true;
    if (done < total) setOpen(true);
  }, [total, done]);

  const toggle = async (it: ChecklistItem) => {
    if (it.auto_key || busyKey) return; // auto items are read-only
    const next = !status.manual[it.key];
    setErr(null);
    setBusyKey(it.key);
    setStatus((s) => ({ ...s, manual: { ...s.manual, [it.key]: next } }));
    try {
      await setManualCheck(jobUuid, it.key, next);
    } catch (e) {
      // Server refused - revert the optimistic tick.
      setStatus((s) => ({ ...s, manual: { ...s.manual, [it.key]: !next } }));
      setErr(e instanceof ApiError ? e.message : "Could not save. Try again.");
    } finally {
      setBusyKey(null);
    }
  };

  if (total === 0) return null;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div>
          <div className="microLabel" style={{ marginBottom: 2 }}>Job checklist</div>
          <div className="small" style={{ color: done === total ? "var(--ok)" : "var(--muted)" }}>
            {done}/{total} done{done === total ? " ✓" : ""}
          </div>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} style={{ fontSize: 12 }}>
          {open ? "Close" : "Open"}
        </button>
      </div>

      {open && (
        <div className="col" style={{ gap: 6, marginTop: 12 }}>
          {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}
          {applicable.map((it) => {
            const checked = isChecked(it);
            const auto = !!it.auto_key;
            return (
              <label
                key={it.key}
                onClick={() => { if (!auto) toggle(it); }}
                style={{
                  display: "flex", gap: 10, alignItems: "flex-start",
                  padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)",
                  cursor: auto ? "default" : "pointer",
                  opacity: busyKey === it.key ? 0.6 : 1,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0, width: 20, height: 20, borderRadius: 5, marginTop: 1,
                    border: checked ? "none" : "2px solid var(--border)",
                    background: checked ? "var(--ok)" : "transparent",
                    color: "#fff", fontSize: 14, lineHeight: "20px", textAlign: "center",
                  }}
                >
                  {checked ? "✓" : ""}
                </span>
                <div className="col" style={{ gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: checked ? 400 : 600, color: checked ? "var(--muted)" : "var(--text)", textDecoration: checked ? "line-through" : "none" }}>
                    {it.label}
                  </span>
                  {auto && (
                    <span className="small" style={{ color: "var(--muted)" }}>
                      {checked ? "Done automatically" : "Ticks itself when done in the app"}
                    </span>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
