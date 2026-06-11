import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BetaTag } from "../components/BetaTag";
import { apiFetch, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  addDaysIso,
  clearDraft,
  fetchState,
  isHorizonLow,
  isLocked,
  loadCache,
  loadDraft,
  saveCache,
  saveDraft,
  submitDraft,
  todayLocalIso,
  type AvailabilityDay,
  type AvailabilityDraft,
  type AvailabilityDraftDay,
  type AvailabilityState,
  type AvailabilityStatus,
  type AvailabilityUnlock,
} from "../lib/availabilityStore";

type AdminUserLite = {
  id: number;
  email: string;
  name: string | null;
  is_active: boolean;
};

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
  conditional: { bg: "var(--warn-bg)",         fg: "var(--warn)",   label: "Conditional" },
};

type Tab = "submit" | "history";

// ─────────────────────────────────────────────────────────────────────────────

export default function Availability() {
  const nav = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const today = useMemo(() => todayLocalIso(), []);

  // viewingUserId: null = looking at your own data; otherwise an admin is
  // viewing/editing another crew member. Drives both the data source and
  // whether History cells become editable.
  const [viewingUserId, setViewingUserId] = useState<number | null>(null);
  const isViewingSelf = viewingUserId === null;

  // Admin-only user list for the "View as" picker. Lazy-loaded once on mount.
  const [adminUsers, setAdminUsers] = useState<AdminUserLite[]>([]);
  useEffect(() => {
    if (!isAdmin) return;
    apiFetch<AdminUserLite[]>("/api/admin/users")
      .then(setAdminUsers)
      .catch(() => { /* silently ignore — picker just stays empty */ });
  }, [isAdmin]);

  const [cache, setCache] = useState<AvailabilityState>(() => loadCache());
  // Discard any draft whose window_start has already passed — otherwise a
  // returning user who tested months ago lands on a stale draft they can't
  // realistically submit (the window's already in the past).
  const [draft, setDraft] = useState<AvailabilityDraft | null>(() => {
    const d = loadDraft();
    if (d && d.window_start < todayLocalIso()) {
      clearDraft();
      return null;
    }
    return d;
  });
  const [tab, setTab] = useState<Tab>("submit");

  // Sticky active window — initialized from draft / cache, then stays put.
  // Submitting the current window advances it explicitly to the next one
  // rather than being recomputed from the new horizon. Clamps to >= today
  // so a stale cached horizon doesn't drop the user on a past window.
  const [activeWindowStart, setActiveWindowStart] = useState<string>(() => {
    const today = todayLocalIso();
    const d = loadDraft();
    if (d?.window_start && d.window_start >= today) return d.window_start;
    const c = loadCache();
    if (c.horizon) {
      const candidate = addDaysIso(c.horizon, 1);
      return candidate >= today ? candidate : today;
    }
    return today;
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

  // Fetch server state on mount or whenever the viewed user changes. For
  // self the regular /api/availability path keeps the localStorage cache
  // warm; for an admin viewing another user we hit /api/admin/availability/{id}
  // and replace state in memory but don't persist (the admin shouldn't pollute
  // their own cache with a teammate's data).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (viewingUserId === null) {
        const s = await fetchState();
        if (!cancelled && s) setCache(s);
        return;
      }
      try {
        const s = await apiFetch<AvailabilityState>(`/api/admin/availability/${viewingUserId}`);
        if (!cancelled) setCache(s);
      } catch {
        if (!cancelled) setCache({ horizon: null, days: [], unlocks: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [viewingUserId]);

  // Switching to another user — clear any active draft and reset the
  // active window so admin starts fresh in the History tab.
  useEffect(() => {
    if (viewingUserId !== null) {
      setDraft(null);
      clearDraft();
      setTab("history");
    } else {
      // Re-honor the cached self state when switching back to self.
      const selfCache = loadCache();
      setCache(selfCache);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingUserId]);

  // Admin click-cycle handler used by the History tab when isAdmin is true.
  // Sends a single-day patch through the admin endpoint and optimistically
  // updates local state on success. Bypasses the 14-day lock since this
  // is the whole point of the override.
  async function adminCycleHistoryDay(targetUserId: number, day: AvailabilityDay) {
    const nextStat = nextStatus(day.status);
    try {
      const updated = await apiFetch<AvailabilityState>(
        `/api/admin/availability/${targetUserId}`,
        {
          method: "POST",
          body: JSON.stringify({
            window_start: day.window_start,
            days: [{ day: day.day, status: nextStat, note: day.note ?? null }],
          }),
        },
      );
      setCache(updated);
      if (viewingUserId === null) saveCache(updated);
    } catch (e) {
      alert(
        e instanceof ApiError
          ? `Edit failed: ${e.message}`
          : "Edit failed — check connection and try again.",
      );
    }
  }

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

  // Set of days that have an existing server-side record. The lock only
  // applies to those — a brand-new user with no prior submissions has
  // activeWindowStart = today, putting every day in the 14-day "lock"
  // range; without this guard their first-ever window would be
  // un-editable. Mirrors the backend rule (existing record AND within
  // 14 days), and the admin-unlock check still overrides both.
  const serverSideDays = useMemo(() => {
    const s = new Set<string>();
    for (const d of cache.days) s.add(d.day);
    return s;
  }, [cache]);

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

  // The lock rule the user sees on screen: within 14 days of today AND the
  // day already has a server-side record AND there's no admin unlock for
  // this window. Without the server-record guard, a brand-new user can't
  // touch any day of their first submission (their activeWindowStart is
  // today, putting every cell in the 14-day range).
  const isEffectivelyLocked = useCallback((day: string) => {
    if (!isLocked(day, today)) return false;
    if (!serverSideDays.has(day)) return false;
    const unlocks = cache.unlocks ?? [];
    if (unlocks.some((u) => u.window_start === activeWindowStart)) return false;
    return true;
  }, [today, serverSideDays, cache.unlocks, activeWindowStart]);

  const cycleDay = useCallback((day: string) => {
    if (isEffectivelyLocked(day)) return;
    const current = merged.get(day);
    patchDays([{
      day,
      status: nextStatus(current?.status ?? null),
      note: current?.note ?? null,
    }]);
  }, [merged, patchDays, isEffectivelyLocked]);

  const setNote = useCallback((day: string, note: string) => {
    if (isEffectivelyLocked(day)) return;
    const current = merged.get(day);
    // Letting note edits create the day defaults the status to available —
    // matches the "if you bothered to leave a note, you're probably available"
    // heuristic and avoids stranding the cell with a note but no status.
    patchDays([{ day, status: current?.status ?? "available", note }]);
  }, [merged, patchDays, isEffectivelyLocked]);

  // Quick-fill: 7 buttons (Sun–Sat). Each button owns an independent cycle
  // status (quickFillStatus[dow]) — calendar cell changes don't shift it,
  // and tapping the button cycles its own state forward then writes that
  // status to every matching unlocked day in the window IN ONE SHOT.
  const bulkFill = useCallback((targetDow: number) => {
    const matching = windowDays.filter(
      (d) => dayOfWeekIndex(d) === targetDow && !isEffectivelyLocked(d),
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
  }, [windowDays, isEffectivelyLocked, quickFillStatus, merged, patchDays]);

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
      // Reset activeWindowStart to the natural next window — horizon+1 or
      // today, whichever is later. This drops the user back into the
      // standard flow after both normal submissions and admin-unlocked
      // edits (so editing a past unlocked window doesn't leave them
      // stranded on it).
      const submittedRange = `${formatHuman(activeWindowStart)} → ${formatHuman(addDaysIso(activeWindowStart, 13))}`;
      const naturalNext = s.horizon ? addDaysIso(s.horizon, 1) : today;
      setActiveWindowStart(naturalNext >= today ? naturalNext : today);
      setPostSubmitMsg(`Submitted ${submittedRange}.`);
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
  const unlocks = cache.unlocks ?? [];
  const unlockForActiveWindow = unlocks.find((u) => u.window_start === activeWindowStart) ?? null;
  // Show the picker if the user has work to do (horizon low) OR they're
  // viewing an admin-unlocked window for editing.
  const showPicker = horizonLow || !!unlockForActiveWindow;

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

      {/* Admin-only "View as" picker. Collapsed by default so the page
          reads the same way for admins on a normal day. The viewed-user
          name surfaces in the collapsed header as a hint when admin is
          acting on someone else's data. */}
      {isAdmin && (
        <AdminViewToggle
          users={adminUsers}
          currentUserId={user?.id ?? null}
          viewingUserId={viewingUserId}
          onChange={setViewingUserId}
        />
      )}

      {/* Tab switcher — Submit hidden when an admin is viewing another user
          (Submit is for the crew member's own flow; admins edit via History). */}
      <div className="card" style={{ padding: 6 }}>
        <div className="row" style={{ gap: 6 }}>
          {(isViewingSelf ? (["submit", "history"] as Tab[]) : (["history"] as Tab[])).map((t) => {
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

      {tab === "history" || !isViewingSelf ? (
        <HistoryView
          state={cache}
          activeWindowStart={activeWindowStart}
          editable={isAdmin}
          onAdminCycle={isAdmin
            ? (d) => adminCycleHistoryDay(viewingUserId ?? user!.id, d)
            : undefined}
        />
      ) : !showPicker ? (
        <CaughtUpView
          horizon={cache.horizon}
          postSubmitMsg={postSubmitMsg}
          unlocks={unlocks}
          onOpenUnlock={(ws) => {
            setPostSubmitMsg(null);
            setActiveWindowStart(ws);
          }}
        />
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
            {unlockForActiveWindow ? (
              <div
                className="small"
                style={{
                  marginTop: 10, padding: "8px 10px", borderRadius: 8,
                  background: "rgba(93,214,194,0.10)",
                  border: "1px solid var(--brand)",
                  color: "var(--text)",
                }}
              >
                The office unlocked this window for changes
                {unlockForActiveWindow.granted_by_name
                  ? <> (granted by <strong>{unlockForActiveWindow.granted_by_name}</strong>)</>
                  : null}
                {unlockForActiveWindow.note
                  ? <> — <em>"{unlockForActiveWindow.note}"</em></>
                  : null}
                . Edit and resubmit; the office will revoke the unlock once
                they've confirmed your update.
              </div>
            ) : (
              <div
                className="small"
                style={{
                  marginTop: 10, padding: "8px 10px", borderRadius: 8,
                  background: "var(--warn-bg)",
                  border: "1px solid var(--warn)",
                  color: "var(--text)",
                }}
              >
                You're submitting availability for this window only. Once it's
                in, you're set — the next window will open here when your
                submitted horizon dips below 2 weeks. If you need to change a
                window that's already locked, contact the office.
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
                const locked = isEffectivelyLocked(day);
                const noteText = (current?.note || "").trim();
                const hasNote = noteText.length > 0;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => cycleDay(day)}
                    disabled={locked}
                    aria-label={`${day} ${st ?? "unset"}${locked ? " (locked)" : ""}${hasNote ? ` — ${noteText}` : ""}`}
                    title={hasNote ? noteText : (locked ? "Locked — contact the office to change this day" : undefined)}
                    style={{
                      display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "flex-start",
                      gap: 2,
                      minHeight: 76,
                      padding: 6,
                      borderRadius: 8,
                      border: `1px solid ${colors ? colors.fg : "var(--border)"}`,
                      background: colors ? colors.bg : "transparent",
                      color: colors ? colors.fg : "var(--text)",
                      position: "relative",
                      cursor: locked ? "not-allowed" : "pointer",
                      opacity: locked ? 0.55 : 1,
                    }}
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
                      <div
                        style={{
                          fontSize: 10, lineHeight: 1.2, fontStyle: "italic",
                          marginTop: 2, padding: "0 2px",
                          width: "100%", textAlign: "center",
                          overflow: "hidden", display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          wordBreak: "break-word",
                        }}
                      >
                        {noteText}
                      </div>
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
                const locked = isEffectivelyLocked(day);
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

// ── Admin "View as" toggle ───────────────────────────────────────────────────

function AdminViewToggle({
  users,
  currentUserId,
  viewingUserId,
  onChange,
}: {
  users: AdminUserLite[];
  currentUserId: number | null;
  viewingUserId: number | null;
  onChange: (id: number | null) => void;
}) {
  // Auto-expand when admin is already acting on someone else, so they can
  // see + change/clear the selection without hunting for the toggle.
  const [open, setOpen] = useState<boolean>(viewingUserId !== null);
  useEffect(() => {
    if (viewingUserId !== null) setOpen(true);
  }, [viewingUserId]);

  const viewingUser =
    viewingUserId !== null ? users.find((u) => u.id === viewingUserId) : null;

  return (
    <div
      className="card"
      style={{ padding: open ? undefined : "6px 10px" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", gap: 8,
          background: "none", border: "none", padding: 0,
          color: "var(--muted)", fontSize: 12, cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span>
          Admin view
          {viewingUser && (
            <span style={{ color: "var(--brand)", fontWeight: 700 }}>
              {" · acting as "}{viewingUser.name || viewingUser.email}
            </span>
          )}
        </span>
        <span style={{ fontSize: 13 }}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div
          className="row"
          style={{
            alignItems: "center", gap: 10, flexWrap: "wrap",
            marginTop: 10,
          }}
        >
          <div className="small" style={{ color: "var(--muted)", flex: "1 1 220px" }}>
            Tap a cell in History to cycle status. Edits bypass the 2-week lock.
          </div>
          <select
            value={viewingUserId === null ? "" : String(viewingUserId)}
            onChange={(e) => {
              const v = e.target.value;
              onChange(v === "" ? null : Number(v));
            }}
            style={{
              flex: "1 1 200px", padding: "8px 10px",
              borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--bg)", color: "var(--text)", fontSize: 13,
            }}
          >
            <option value="">Yourself (default)</option>
            {users
              .filter((u) => u.is_active && u.id !== currentUserId)
              .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                </option>
              ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ── Caught-up view ───────────────────────────────────────────────────────────

function CaughtUpView({
  horizon,
  postSubmitMsg,
  unlocks,
  onOpenUnlock,
}: {
  horizon: string | null;
  postSubmitMsg: string | null;
  unlocks: AvailabilityUnlock[];
  onOpenUnlock: (windowStart: string) => void;
}) {
  return (
    <>
      {postSubmitMsg && (
        <div className="card" style={{ background: "rgba(45,212,191,0.1)" }}>
          <div style={{ color: "var(--ok)", fontSize: 14, fontWeight: 700 }}>
            ✓ {postSubmitMsg}
          </div>
        </div>
      )}
      {unlocks.length > 0 && (
        <div
          className="card"
          style={{
            background: "rgba(93,214,194,0.08)",
            border: "1px solid var(--brand)",
          }}
        >
          <div className="sectionTitle" style={{ color: "var(--brand)" }}>
            Unlocked by the office
          </div>
          <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
            The office has reopened {unlocks.length === 1 ? "this window" : "these windows"} for you to edit.
            Tap to open and submit your changes.
          </div>
          <div className="col" style={{ gap: 6 }}>
            {unlocks.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => onOpenUnlock(u.window_start)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", padding: "10px 12px", borderRadius: 8,
                  background: "var(--card)",
                  border: "1px solid var(--brand)",
                  color: "var(--text)", textAlign: "left", cursor: "pointer",
                }}
              >
                <span className="col" style={{ gap: 2 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>
                    {formatHuman(u.window_start)} → {formatHuman(addDaysIso(u.window_start, 13))}
                  </span>
                  {u.note && (
                    <span className="small" style={{ color: "var(--muted)" }}>
                      "{u.note}"
                    </span>
                  )}
                  {u.granted_by_name && (
                    <span className="small" style={{ color: "var(--muted)" }}>
                      Granted by {u.granted_by_name}
                    </span>
                  )}
                </span>
                <span style={{ color: "var(--brand)", fontWeight: 700, fontSize: 13 }}>Edit ›</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="card">
        <div className="sectionTitle">You're all caught up</div>
        <BetaTag feature="schedulingAvailability" />
        <div className="small" style={{ color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
          {horizon
            ? <>Your submitted availability extends through <strong style={{ color: "var(--text)" }}>{formatHuman(horizon)}</strong>. The next window opens here automatically once your horizon drops below 2 weeks.</>
            : <>You haven't submitted any availability yet. Come back later — there's nothing to submit right now.</>}
          {" "}If you need to change a window that's already locked, ask the office to unlock it for you.
        </div>
        <div className="small" style={{ marginTop: 12, color: "var(--muted)" }}>
          Switch to the <strong style={{ color: "var(--text)" }}>History</strong> tab to review what you've already submitted.
        </div>
      </div>
    </>
  );
}

// ── History tab ──────────────────────────────────────────────────────────────

function HistoryView({
  state,
  activeWindowStart,
  editable,
  onAdminCycle,
}: {
  state: AvailabilityState;
  activeWindowStart: string;
  /** When true (admin only), cells render as click-cycle buttons. */
  editable?: boolean;
  /** Click handler that advances the cell's status one step. Required when
   *  editable is true; called with the original day record. */
  onAdminCycle?: (day: AvailabilityDay) => void;
}) {
  // Group submitted days by window_start. Each group becomes a 14-cell grid
  // that mirrors the layout the user saw at submit time. Read-only by
  // default; admins get click-cycle cells.
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
                const noteText = (d?.note || "").trim();
                const hasNote = noteText.length > 0;
                const cellContent = (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.85 }}>
                      {dayOfWeekShort(day)}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>
                      {dayOfMonth(day)}
                    </div>
                    {hasNote && (
                      <div
                        style={{
                          fontSize: 10, lineHeight: 1.2, fontStyle: "italic",
                          marginTop: 2, padding: "0 2px",
                          width: "100%", textAlign: "center",
                          overflow: "hidden", display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          wordBreak: "break-word",
                        }}
                      >
                        {noteText}
                      </div>
                    )}
                  </>
                );
                const cellStyle: React.CSSProperties = {
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "flex-start",
                  gap: 2, minHeight: 76, padding: 6,
                  borderRadius: 8,
                  border: `1px solid ${colors ? colors.fg : "var(--border)"}`,
                  background: colors ? colors.bg : "transparent",
                  color: colors ? colors.fg : "var(--muted)",
                  position: "relative",
                  opacity: st ? 1 : 0.5,
                };
                if (editable && d && onAdminCycle) {
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => onAdminCycle(d)}
                      aria-label={`${day} ${st ?? "unset"}${hasNote ? ` — ${noteText}` : ""} (admin click to cycle)`}
                      title={hasNote ? noteText : "Click to cycle status"}
                      style={{ ...cellStyle, cursor: "pointer" }}
                    >
                      {cellContent}
                    </button>
                  );
                }
                return (
                  <div
                    key={day}
                    aria-label={`${day} ${st ?? "unset"}${hasNote ? ` — ${noteText}` : ""}`}
                    title={hasNote ? noteText : undefined}
                    style={cellStyle}
                  >
                    {cellContent}
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
