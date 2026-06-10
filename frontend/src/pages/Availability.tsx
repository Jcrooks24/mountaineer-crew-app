import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BetaTag } from "../components/BetaTag";
import { ApiError } from "../api/client";
import {
  addDaysIso,
  clearDraft,
  fetchState,
  isHorizonLow,
  isLocked,
  loadCache,
  loadDraft,
  saveDraft,
  submitDraft,
  todayLocalIso,
  type AvailabilityDay,
  type AvailabilityDraft,
  type AvailabilityDraftDay,
  type AvailabilityState,
  type AvailabilityStatus,
} from "../lib/availabilityStore";

function formatHuman(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dayOfWeekShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { weekday: "short" });
}

function dayOfMonth(iso: string): string {
  const [, , d] = iso.split("-");
  return d ? String(parseInt(d, 10)) : "";
}

function dayOfWeekIndex(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

// empty → available → unavailable → conditional → back to available.
function nextStatus(current: AvailabilityStatus | null): AvailabilityStatus {
  if (current === "available") return "unavailable";
  if (current === "unavailable") return "conditional";
  if (current === "conditional") return "available";
  return "available";
}

const STATUS_COLORS: Record<AvailabilityStatus, { bg: string; fg: string; label: string }> = {
  available:   { bg: "rgba(45,212,191,0.18)",  fg: "var(--ok)",     label: "Available" },
  unavailable: { bg: "rgba(255,107,107,0.18)", fg: "var(--danger)", label: "Unavailable" },
  conditional: { bg: "rgba(255,176,46,0.18)",  fg: "#ffb02e",       label: "Conditional" },
};

type Tab = "submit" | "history";

// ─────────────────────────────────────────────────────────────────────────────

export default function Availability() {
  const nav = useNavigate();
  const today = useMemo(() => todayLocalIso(), []);

  const [cache, setCache] = useState<AvailabilityState>(() => loadCache());
  const [draft, setDraft] = useState<AvailabilityDraft | null>(() => loadDraft());
  const [tab, setTab] = useState<Tab>("submit");

  // Sticky active window — initialized from draft / cache, then stays put.
  // Submitting the current window advances it explicitly to the next one
  // rather than being recomputed from the new horizon.
  const [activeWindowStart, setActiveWindowStart] = useState<string>(() => {
    const d = loadDraft();
    if (d?.window_start) return d.window_start;
    const c = loadCache();
    if (c.horizon) return addDaysIso(c.horizon, 1);
    return todayLocalIso();
  });

  // Independent quick-fill status per day-of-week. Decoupled from the
  // calendar cell state so tapping a single calendar day doesn't shift the
  // quick-fill button's color, and tapping a quick-fill button cycles its
  // own state forward regardless of what the calendar cells look like.
  // Resets on every active-window change since each window starts fresh.
  const [quickFillStatus, setQuickFillStatus] = useState<Record<number, AvailabilityStatus | undefined>>({});
  useEffect(() => {
    setQuickFillStatus({});
  }, [activeWindowStart]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [postSubmitMsg, setPostSubmitMsg] = useState<string | null>(null);

  // Fetch server state on mount. Cache still drives the initial render.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchState();
      if (!cancelled && s) setCache(s);
    })();
    return () => { cancelled = true; };
  }, []);

  // The 14 ISO dates of the current window, in order.
  const windowDays = useMemo(
    () => Array.from({ length: 14 }, (_, i) => addDaysIso(activeWindowStart, i)),
    [activeWindowStart],
  );

  // Build a Map<day, AvailabilityDraftDay | AvailabilityDay> covering both
  // the user's in-progress draft (wins) and any server-side records that
  // fall in this window. Used to drive cell rendering.
  const merged = useMemo(() => {
    const m = new Map<string, AvailabilityDraftDay & { fromServer?: boolean }>();
    // Seed from server cache for this window.
    for (const d of cache.days) {
      if (windowDays.includes(d.day)) {
        m.set(d.day, { day: d.day, status: d.status, note: d.note ?? null, fromServer: true });
      }
    }
    // Draft entries overlay server data — but only for this window. A stale
    // draft from another window shouldn't bleed in.
    if (draft && draft.window_start === activeWindowStart) {
      for (const d of draft.days) {
        m.set(d.day, { day: d.day, status: d.status, note: d.note ?? null });
      }
    }
    return m;
  }, [cache, draft, windowDays, activeWindowStart]);

  // Run prior-window prefill once when the active window has no draft and
  // no server data yet. Copies the matching DOW status (not notes) from the
  // most recent 14-day stretch the user submitted.
  useEffect(() => {
    if (draft && draft.window_start === activeWindowStart && draft.days.length > 0) return;
    const hasAnyServerData = windowDays.some((d) =>
      cache.days.some((c) => c.day === d),
    );
    if (hasAnyServerData) return;

    // Use addDaysIso(d, -14): each window day pulls from "same DOW, 14 days back".
    const prefilled: AvailabilityDraftDay[] = [];
    for (const wd of windowDays) {
      const prior = cache.days.find((c) => c.day === addDaysIso(wd, -14));
      if (prior) prefilled.push({ day: wd, status: prior.status, note: null });
    }
    if (prefilled.length === 0) return;
    const next: AvailabilityDraft = { window_start: activeWindowStart, days: prefilled };
    setDraft(next);
    saveDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWindowStart, cache]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  // Helper: produce a new draft from the current one by patching a set of
  // (day, status, note) tuples atomically. The naive setDay-in-a-loop
  // version had a closure-stale `draft` so successive setDay calls
  // overwrote each other and only the last one stuck — which is why the
  // bulkFill bug looked like "the buttons don't change color".
  const patchDays = useCallback(
    (patches: { day: string; status: AvailabilityStatus; note: string | null }[]) => {
      if (patches.length === 0) return;
      setSubmitError(null);
      setPostSubmitMsg(null);
      const base: AvailabilityDraft =
        draft && draft.window_start === activeWindowStart
          ? draft
          : { window_start: activeWindowStart, days: [] };
      const patchedDays = new Set(patches.map((p) => p.day));
      const kept = base.days.filter((d) => !patchedDays.has(d.day));
      const next: AvailabilityDraft = {
        window_start: activeWindowStart,
        days: [
          ...kept,
          ...patches.map((p) => ({ day: p.day, status: p.status, note: p.note || null })),
        ],
      };
      setDraft(next);
      saveDraft(next);
    },
    [draft, activeWindowStart],
  );

  const cycleDay = useCallback((day: string) => {
    if (isLocked(day, today)) return;
    const current = merged.get(day);
    patchDays([{
      day,
      status: nextStatus(current?.status ?? null),
      note: current?.note ?? null,
    }]);
  }, [merged, patchDays, today]);

  const setNote = useCallback((day: string, note: string) => {
    if (isLocked(day, today)) return;
    const current = merged.get(day);
    // Letting note edits create the day defaults the status to available —
    // matches the "if you bothered to leave a note, you're probably available"
    // heuristic and avoids stranding the cell with a note but no status.
    patchDays([{ day, status: current?.status ?? "available", note }]);
  }, [merged, patchDays, today]);

  // Quick-fill: 7 buttons (Sun–Sat). Each button owns an independent cycle
  // status (quickFillStatus[dow]) — calendar cell changes don't shift it,
  // and tapping the button cycles its own state forward then writes that
  // status to every matching unlocked day in the window IN ONE SHOT.
  const bulkFill = useCallback((targetDow: number) => {
    const matching = windowDays.filter(
      (d) => dayOfWeekIndex(d) === targetDow && !isLocked(d, today),
    );
    if (matching.length === 0) return;

    const current = quickFillStatus[targetDow] ?? null;
    const next = nextStatus(current);

    setQuickFillStatus((prev) => ({ ...prev, [targetDow]: next }));
    patchDays(
      matching.map((d) => {
        const existing = merged.get(d);
        return { day: d, status: next, note: existing?.note ?? null };
      }),
    );
  }, [windowDays, today, quickFillStatus, merged, patchDays]);

  // ── Submit ────────────────────────────────────────────────────────────────

  const unsetDays = useMemo(
    () => windowDays.filter((d) => !merged.get(d)),
    [windowDays, merged],
  );
  const lockedDirtyDays = useMemo(() => {
    if (!draft || draft.window_start !== activeWindowStart) return [];
    return draft.days.filter((d) => isLocked(d.day, today)).map((d) => d.day);
  }, [draft, activeWindowStart, today]);

  const canSubmit =
    unsetDays.length === 0 &&
    lockedDirtyDays.length === 0 &&
    !submitting &&
    !!draft &&
    draft.window_start === activeWindowStart &&
    draft.days.length > 0;

  async function handleConfirmSubmit() {
    setShowConfirm(false);
    if (!draft) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const s = await submitDraft(draft);
      setCache(s);
      // Clear local draft AFTER the server has the data and our cache
      // reflects it — otherwise a transient render between clearDraft and
      // setCache would flash empty cells.
      setDraft(null);
      clearDraft();
      // Advance to the next 14-day window so the user can keep going,
      // and surface a confirmation so the screen doesn't feel inert.
      const next = addDaysIso(activeWindowStart, 14);
      setActiveWindowStart(next);
      setPostSubmitMsg(
        `Submitted ${formatHuman(activeWindowStart)} → ${formatHuman(addDaysIso(activeWindowStart, 13))}. Next up: ${formatHuman(next)}.`,
      );
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? typeof e.message === "string"
            ? e.message
            : "Submit failed — please try again."
          : "Submit failed — check your connection and try again.";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function handleDiscardDraft() {
    setDraft(null);
    clearDraft();
    setSubmitError(null);
  }

  const horizonLow = isHorizonLow(cache.horizon, today);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <div className="topbar" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>Scheduling Availability</div>
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

      {/* Tab switcher — Submit (active window) vs History (read-only past). */}
      <div className="card" style={{ padding: 6 }}>
        <div className="row" style={{ gap: 6 }}>
          {(["submit", "history"] as Tab[]).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  flex: 1, padding: "8px 10px", borderRadius: 8,
                  background: active ? "var(--brand)" : "transparent",
                  color: active ? "var(--on-brand)" : "var(--text)",
                  border: active ? "1px solid var(--brand)" : "1px solid var(--border)",
                  fontWeight: 700, fontSize: 13,
                }}
              >
                {t === "submit" ? "Submit" : "History"}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "history" ? (
        <HistoryView state={cache} activeWindowStart={activeWindowStart} />
      ) : (
        <>
          <div className="card">
            <div className="sectionTitle">
              {formatHuman(activeWindowStart)} → {formatHuman(addDaysIso(activeWindowStart, 13))}
            </div>
            <BetaTag feature="schedulingAvailability" />
            <div className="small" style={{ color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
              Tap each day to set its status: available → unavailable → conditional.
              Use the quick-fill row to bulk-set both matching weekdays at once.
              Submit once every day is filled in. Once submitted, days within the
              next 2 weeks lock — contact the office to change a locked day.
              Once submitted, if you're scheduled on an available day you're
              expected to work it (exception: scheduled with 3 or fewer days' notice).
            </div>
            {horizonLow && (
              <div
                className="small"
                style={{
                  marginTop: 10, padding: "8px 10px", borderRadius: 8,
                  background: "rgba(255,176,46,0.10)",
                  border: "1px solid rgba(255,176,46,0.4)",
                  color: "var(--text)",
                }}
              >
                Your submitted availability is less than 2 weeks out — please fill
                in this window so the office can keep scheduling you confidently.
              </div>
            )}
          </div>

          {/* Quick fill — full 7-day week, independent state per button. */}
          <div className="card">
            <div className="sectionTitle">Quick fill</div>
            <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
              Tap a day-of-week to cycle its own status and apply it to both
              matching days in this window. Skips any cells that are locked.
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {[0, 1, 2, 3, 4, 5, 6].map((dow) => {
                const st = quickFillStatus[dow] ?? null;
                const colors = st ? STATUS_COLORS[st] : null;
                const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                return (
                  <button
                    key={dow}
                    type="button"
                    onClick={() => bulkFill(dow)}
                    style={{
                      flex: "1 1 60px",
                      padding: "10px 8px", borderRadius: 8,
                      border: `1px solid ${colors ? colors.fg : "var(--border)"}`,
                      background: colors ? colors.bg : "transparent",
                      color: colors ? colors.fg : "var(--text)",
                      fontWeight: 700, fontSize: 13,
                    }}
                  >
                    {labels[dow]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Calendar grid. */}
          <div className="card">
            <div className="sectionTitle">Calendar</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 6,
                marginTop: 8,
              }}
            >
              {windowDays.map((day) => {
                const current = merged.get(day);
                const st = current?.status ?? null;
                const colors = st ? STATUS_COLORS[st] : null;
                const isTodayDay = day === today;
                const locked = isLocked(day, today);
                const hasNote = !!(current?.note && current.note.trim().length > 0);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => cycleDay(day)}
                    disabled={locked}
                    aria-label={`${day} ${st ?? "unset"}${locked ? " (locked)" : ""}`}
                    style={{
                      display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center",
                      gap: 2,
                      aspectRatio: "1",
                      padding: 4,
                      borderRadius: 8,
                      border: `1px solid ${colors ? colors.fg : "var(--border)"}`,
                      background: colors ? colors.bg : "transparent",
                      color: colors ? colors.fg : "var(--text)",
                      position: "relative",
                      cursor: locked ? "not-allowed" : "pointer",
                      opacity: locked ? 0.55 : 1,
                    }}
                    title={locked ? "Locked — contact the office to change this day" : undefined}
                  >
                    <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.85 }}>
                      {dayOfWeekShort(day)}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>
                      {dayOfMonth(day)}
                    </div>
                    {isTodayDay && (
                      <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.7 }}>today</div>
                    )}
                    {locked && (
                      <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.7 }}>🔒</div>
                    )}
                    {hasNote && (
                      <span
                        title="Has note"
                        style={{
                          position: "absolute", top: 4, right: 6,
                          width: 6, height: 6, borderRadius: "50%",
                          background: colors ? colors.fg : "var(--brand)",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes — collapsed by default. */}
          <div className="card">
            <div className="sectionTitle">Notes</div>
            <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 8 }}>
              Optional. Use this when "available" or "conditional" needs context
              (e.g. "available after 1pm").
            </div>
            <div className="col" style={{ gap: 6 }}>
              {windowDays.map((day) => {
                const current = merged.get(day);
                const hasNote = !!(current?.note && current.note.trim().length > 0);
                const expanded = expandedNote === day;
                const locked = isLocked(day, today);
                const st = current?.status ?? null;
                const colors = st ? STATUS_COLORS[st] : null;

                if (!hasNote && !expanded) {
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => !locked && setExpandedNote(day)}
                      disabled={locked}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        width: "100%", padding: "6px 10px", borderRadius: 6,
                        border: "1px dashed var(--border)", background: "transparent",
                        color: locked ? "var(--muted)" : "var(--text)",
                        fontSize: 12, cursor: locked ? "not-allowed" : "pointer",
                        opacity: locked ? 0.55 : 1, textAlign: "left",
                      }}
                    >
                      <span>
                        {dayOfWeekShort(day)} {formatHuman(day)}
                        {colors && (
                          <span style={{ marginLeft: 6, color: colors.fg, fontWeight: 700 }}>
                            · {colors.label}
                          </span>
                        )}
                      </span>
                      <span style={{ color: "var(--muted)" }}>+ note</span>
                    </button>
                  );
                }

                return (
                  <div
                    key={day}
                    style={{
                      display: "flex", flexDirection: "column", gap: 4,
                      paddingBottom: 8, borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                        {dayOfWeekShort(day)} {formatHuman(day)}
                        {locked && (
                          <span style={{ marginLeft: 6, color: "var(--muted)", fontWeight: 400 }}>
                            🔒 locked
                          </span>
                        )}
                      </span>
                      {colors && (
                        <span
                          className="small"
                          style={{
                            padding: "2px 8px", borderRadius: 999,
                            background: colors.bg,
                            color: colors.fg,
                            border: `1px solid ${colors.fg}`,
                            fontWeight: 700,
                          }}
                        >
                          {colors.label}
                        </span>
                      )}
                      {!locked && (
                        <button
                          type="button"
                          onClick={() => setExpandedNote(null)}
                          style={{
                            background: "none", border: "none",
                            color: "var(--muted)", fontSize: 12, cursor: "pointer",
                          }}
                        >
                          Hide
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={current?.note ?? ""}
                      placeholder='e.g. "available after 1pm"'
                      onChange={(e) => setNote(day, e.target.value)}
                      disabled={locked}
                      style={{
                        width: "100%", padding: "6px 10px", borderRadius: 8,
                        border: "1px solid var(--border)", background: "var(--bg)",
                        color: "var(--text)", fontSize: 13, boxSizing: "border-box",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Submit row + status messages */}
          <div className="card">
            {unsetDays.length > 0 && (
              <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
                {unsetDays.length} day{unsetDays.length === 1 ? "" : "s"} left to set
                before you can submit.
              </div>
            )}
            {lockedDirtyDays.length > 0 && (
              <div className="small" style={{ color: "var(--danger)", marginBottom: 8 }}>
                Your draft includes locked days ({lockedDirtyDays.join(", ")}).
                Discard your changes for those days or contact the office.
              </div>
            )}
            {submitError && (
              <div
                style={{
                  fontSize: 13, color: "var(--danger)",
                  padding: "8px 12px", marginBottom: 8,
                  background: "rgba(255,107,107,0.1)", borderRadius: 8,
                }}
              >
                {submitError}
              </div>
            )}
            {postSubmitMsg && (
              <div
                style={{
                  fontSize: 13, color: "var(--ok)",
                  padding: "8px 12px", marginBottom: 8,
                  background: "rgba(45,212,191,0.1)", borderRadius: 8,
                }}
              >
                ✓ {postSubmitMsg}
              </div>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btnPrimary"
                disabled={!canSubmit}
                onClick={() => setShowConfirm(true)}
                style={{ flex: 1 }}
              >
                {submitting ? "Submitting…" : "Submit availability"}
              </button>
              {draft && draft.window_start === activeWindowStart && draft.days.length > 0 && (
                <button
                  type="button"
                  onClick={handleDiscardDraft}
                  disabled={submitting}
                  style={{
                    background: "none",
                    color: "var(--muted)",
                    border: "1px solid var(--border)",
                    padding: "0 14px",
                    fontSize: 13,
                  }}
                >
                  Discard draft
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <div style={{ marginBottom: 24 }} />

      {showConfirm && (
        <ConfirmModal
          windowStart={activeWindowStart}
          onCancel={() => setShowConfirm(false)}
          onConfirm={handleConfirmSubmit}
        />
      )}
    </div>
  );
}

// ── History tab ──────────────────────────────────────────────────────────────

function HistoryView({
  state,
  activeWindowStart,
}: {
  state: AvailabilityState;
  activeWindowStart: string;
}) {
  // Group submitted days by window_start. Each group becomes a read-only
  // 14-cell grid that mirrors the layout the user saw at submit time.
  const windows = useMemo(() => {
    const byWindow = new Map<string, AvailabilityDay[]>();
    for (const d of state.days) {
      // Skip the active (currently-editable) window — that's owned by the
      // Submit tab. Only show what's already been committed in the past.
      if (d.window_start === activeWindowStart) continue;
      if (!byWindow.has(d.window_start)) byWindow.set(d.window_start, []);
      byWindow.get(d.window_start)!.push(d);
    }
    return Array.from(byWindow.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))   // newest first
      .map(([windowStart, days]) => ({
        windowStart,
        days: days.sort((a, b) => (a.day < b.day ? -1 : 1)),
      }));
  }, [state.days, activeWindowStart]);

  if (windows.length === 0) {
    return (
      <div className="card" style={{ color: "var(--muted)", textAlign: "center", padding: 28 }}>
        No submitted history yet. Submit a window from the Submit tab and it'll
        show up here for future reference.
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      {windows.map(({ windowStart, days }) => {
        const windowDays = Array.from({ length: 14 }, (_, i) => addDaysIso(windowStart, i));
        const byDay = new Map<string, AvailabilityDay>();
        for (const d of days) byDay.set(d.day, d);
        const notedDays = days.filter((d) => !!(d.note && d.note.trim().length));
        return (
          <div className="card" key={windowStart}>
            <div className="sectionTitle">
              {formatHuman(windowStart)} → {formatHuman(addDaysIso(windowStart, 13))}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 6, marginTop: 8,
              }}
            >
              {windowDays.map((day) => {
                const d = byDay.get(day);
                const st = d?.status ?? null;
                const colors = st ? STATUS_COLORS[st] : null;
                const hasNote = !!(d?.note && d.note.trim().length > 0);
                return (
                  <div
                    key={day}
                    aria-label={`${day} ${st ?? "unset"}`}
                    style={{
                      display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center",
                      gap: 2, aspectRatio: "1", padding: 4,
                      borderRadius: 8,
                      border: `1px solid ${colors ? colors.fg : "var(--border)"}`,
                      background: colors ? colors.bg : "transparent",
                      color: colors ? colors.fg : "var(--muted)",
                      position: "relative",
                      opacity: st ? 1 : 0.5,
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.85 }}>
                      {dayOfWeekShort(day)}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>
                      {dayOfMonth(day)}
                    </div>
                    {hasNote && (
                      <span
                        title={d!.note || ""}
                        style={{
                          position: "absolute", top: 4, right: 6,
                          width: 6, height: 6, borderRadius: "50%",
                          background: colors ? colors.fg : "var(--brand)",
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {notedDays.length > 0 && (
              <div className="col" style={{ gap: 4, marginTop: 8 }}>
                {notedDays.map((d) => (
                  <div key={d.day} className="small" style={{ color: "var(--muted)" }}>
                    <strong style={{ color: "var(--text)" }}>
                      {dayOfWeekShort(d.day)} {formatHuman(d.day)}
                    </strong>
                    {" — "}
                    {d.note}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Confirmation modal ───────────────────────────────────────────────────────

function ConfirmModal({
  windowStart,
  onCancel,
  onConfirm,
}: {
  windowStart: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card)", borderRadius: 12,
          border: "1px solid var(--border)",
          maxWidth: 420, width: "100%",
          padding: 18, display: "flex", flexDirection: "column", gap: 12,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 800 }}>Submit availability?</div>
        <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
          You're submitting availability for the window starting{" "}
          <strong style={{ color: "var(--text)" }}>{formatHuman(windowStart)}</strong>.
          Once submitted, days within the next 2 weeks become locked — you'll
          need to contact the office to change them. Make sure your selections
          are correct.
        </div>
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: "none",
              color: "var(--muted)",
              border: "1px solid var(--border)",
              padding: "8px 14px", fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btnPrimary"
            onClick={onConfirm}
            style={{ padding: "8px 14px" }}
          >
            Yes — submit
          </button>
        </div>
      </div>
    </div>
  );
}
