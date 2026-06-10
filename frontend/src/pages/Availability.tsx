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

// ─────────────────────────────────────────────────────────────────────────────

export default function Availability() {
  const nav = useNavigate();
  const today = useMemo(() => todayLocalIso(), []);

  const [cache, setCache] = useState<AvailabilityState>(() => loadCache());
  const [draft, setDraft] = useState<AvailabilityDraft | null>(() => loadDraft());

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

  const setDay = useCallback(
    (day: string, status: AvailabilityStatus, note: string | null) => {
      setSubmitError(null);
      setPostSubmitMsg(null);
      const base: AvailabilityDraft =
        draft && draft.window_start === activeWindowStart
          ? draft
          : { window_start: activeWindowStart, days: [] };
      const others = base.days.filter((d) => d.day !== day);
      const next: AvailabilityDraft = {
        window_start: activeWindowStart,
        days: [...others, { day, status, note: note || null }],
      };
      setDraft(next);
      saveDraft(next);
    },
    [draft, activeWindowStart],
  );

  const cycleDay = useCallback((day: string) => {
    if (isLocked(day, today)) return;
    const current = merged.get(day);
    setDay(day, nextStatus(current?.status ?? null), current?.note ?? null);
  }, [merged, setDay, today]);

  const setNote = useCallback((day: string, note: string) => {
    if (isLocked(day, today)) return;
    const current = merged.get(day);
    // Letting note edits create the day defaults the status to available —
    // matches the "if you bothered to leave a note, you're probably available"
    // heuristic and avoids stranding the cell with a note but no status.
    setDay(day, current?.status ?? "available", note);
  }, [merged, setDay, today]);

  // Quick-fill: 7 buttons (Sun–Sat). Tapping cycles both matching days in
  // the window to the next status (relative to whichever leading cell sets
  // the current pattern). Locked cells are skipped.
  const bulkFill = useCallback((targetDow: number) => {
    const matching = windowDays.filter((d) => dayOfWeekIndex(d) === targetDow);
    if (matching.length === 0) return;
    const lead = merged.get(matching[0]);
    const next = nextStatus(lead?.status ?? null);
    for (const d of matching) {
      if (isLocked(d, today)) continue;
      const existing = merged.get(d);
      setDay(d, next, existing?.note ?? null);
    }
  }, [windowDays, merged, setDay, today]);

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

      {/* Quick fill — full 7-day week. */}
      <div className="card">
        <div className="sectionTitle">Quick fill</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
          Tap a day-of-week to cycle both matching days in this window to the
          same status. Skips any cells that are locked.
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {[0, 1, 2, 3, 4, 5, 6].map((dow) => {
            const firstMatch = windowDays.find((d) => dayOfWeekIndex(d) === dow);
            const st = firstMatch ? merged.get(firstMatch)?.status ?? null : null;
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

      {/* Notes — collapsed by default. The user adds notes only to the days
          they actually need to annotate, instead of facing 14 textareas. */}
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
