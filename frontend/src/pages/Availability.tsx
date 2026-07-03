import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BetaTag } from "../components/BetaTag";
import { apiFetch, ApiError } from "../api/client";
import { useAuth, type User } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeContext";
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
  const { settings: themeSettings } = useTheme();
  const ht = themeSettings.helpTexts;
  const isAdmin = user?.role === "admin";
  const today = useMemo(() => todayLocalIso(), []);

  // viewingUserId: null = looking at your own data; otherwise an admin is
  // viewing/editing another crew member (opened from the roster as its own
  // page, e.g. /availability?admin_user=42). Drives both the data source and
  // whether History cells become editable.
  const [viewingUserId, setViewingUserId] = useState<number | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("admin_user");
    const id = raw ? Number(raw) : NaN;
    return Number.isFinite(id) ? id : null;
  });
  const isViewingSelf = viewingUserId === null;

  const [cache, setCache] = useState<AvailabilityState>(() => loadCache());
  // Discard any draft whose window_start has already passed - otherwise a
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

  // Sticky active window - initialized from draft / cache, then stays put.
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

  // Re-align the active window to the server-derived next window
  // (horizon + 1, clamped to today) whenever fresh server state arrives and
  // the user isn't mid-edit. activeWindowStart is otherwise only seeded once
  // (from the cached horizon) and advanced explicitly on submit, so a stale
  // cache - e.g. one whose horizon was inflated by an old far-future absence
  // before the contiguous-horizon backend fix - would leave the picker stuck
  // on the wrong window even after correct state loads. An in-progress draft
  // for this window, or an intentionally-opened admin-unlocked window, is
  // preserved so this never yanks the user out of an active edit.
  useEffect(() => {
    if (!isViewingSelf) return;
    if (draft && draft.window_start === activeWindowStart) return;
    const wUnlocks = cache.unlocks ?? [];
    if (wUnlocks.some((u) => u.window_start === activeWindowStart)) return;
    const next = cache.horizon ? addDaysIso(cache.horizon, 1) : today;
    const clamped = next >= today ? next : today;
    setActiveWindowStart((cur) => (cur === clamped ? cur : clamped));
  }, [cache.horizon, cache.unlocks, isViewingSelf, draft, activeWindowStart, today]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [postSubmitMsg, setPostSubmitMsg] = useState<string | null>(null);
  // Future-period pre-submission ("Plan a future absence"). Lives outside
  // the rolling-cadence picker because the range can be any window past
  // today + 14, not just the next-after-horizon window.
  const [showFutureModal, setShowFutureModal] = useState(false);

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

  // Switching to another user - clear any active draft and reset the
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
          : "Edit failed - check connection and try again.",
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
    // Draft entries overlay server data - but only for this window. A stale
    // draft from another window shouldn't bleed in.
    if (draft && draft.window_start === activeWindowStart) {
      for (const d of draft.days) {
        m.set(d.day, { day: d.day, status: d.status, note: d.note ?? null });
      }
    }
    return m;
  }, [cache, draft, windowDays, activeWindowStart]);

  // Set of days that have an existing server-side record. The lock only
  // applies to those - a brand-new user with no prior submissions has
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
  // overwrote each other and only the last one stuck - which is why the
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
    // Letting note edits create the day defaults the status to available -
    // matches the "if you bothered to leave a note, you're probably available"
    // heuristic and avoids stranding the cell with a note but no status.
    patchDays([{ day, status: current?.status ?? "available", note }]);
  }, [merged, patchDays, isEffectivelyLocked]);

  // Quick-fill: 7 buttons (Sun–Sat). Each button owns an independent cycle
  // status (quickFillStatus[dow]) - calendar cell changes don't shift it,
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
    // Same effective-lock rule as the calendar cells (existing record
    // AND within 14 days AND no admin unlock). Without this guard a
    // brand-new user who just cycled all 14 cells would see every one
    // of them flagged as "locked-and-dirty" and Submit would stay
    // disabled, since the old isLocked-only test fired on every day
    // in the today→today+13 range regardless of server state.
    return draft.days.filter((d) => isEffectivelyLocked(d.day)).map((d) => d.day);
  }, [draft, activeWindowStart, isEffectivelyLocked]);

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
      // reflects it - otherwise a transient render between clearDraft and
      // setCache would flash empty cells.
      setDraft(null);
      clearDraft();
      // Reset activeWindowStart to the natural next window - horizon+1 or
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
            : "Submit failed - please try again."
          : "Submit failed - check your connection and try again.";
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

      {/* Admin view banner - this page is opened per-employee from the roster
          (Employees → Availability), so there's no in-page "view as" dropdown.
          The banner just confirms whose availability is being edited. */}
      {isAdmin && viewingUserId !== null && (
        <div className="card" style={{ borderColor: "var(--brand)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Admin view</div>
            <div className="small" style={{ color: "var(--muted)" }}>Editing this employee's availability - tap a History day to set it.</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" onClick={() => setViewingUserId(null)}>My availability</button>
            <button type="button" onClick={() => nav("/admin")}>Back to roster</button>
          </div>
        </div>
      )}

      {/* Tab switcher - Submit hidden when an admin is viewing another user
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

      {/* Plan a future absence - pre-submit a known stretch of dates
          15+ days out (vacation, family event, etc). Lives outside the
          rolling cadence so crew can lock in known absences early
          without having to wait for the cadence to roll around. Hidden
          when admin is viewing another user - the modal posts as the
          current account, not the viewed crew member. */}
      {isViewingSelf && (
        <div className="card">
          <button
            type="button"
            onClick={() => setShowFutureModal(true)}
            style={{
              width: "100%",
              padding: "10px 14px",
              background: "transparent",
              border: "1px dashed var(--brand)",
              borderRadius: 10,
              color: "var(--brand)",
              fontWeight: 700, fontSize: 13,
              textAlign: "left", cursor: "pointer",
            }}
          >
            + Plan a future absence
            <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>
              · vacation, planned event, anything fixed in your calendar
            </span>
          </button>
        </div>
      )}

      {/* Scheduling notes - persistent ongoing constraints. Self-only;
          admins viewing another user can read the note via the monthly
          schedule view's hover tooltip. Collapsed by default. */}
      {isViewingSelf && <SchedulingNotesCard />}

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
              next 2 weeks lock - contact the office to change a locked day.
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
                  ? <> - <em>"{unlockForActiveWindow.note}"</em></>
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
                in, you're set - the next window will open here when your
                submitted horizon dips below 2 weeks. If you need to change a
                window that's already locked, contact the office.
              </div>
            )}
          </div>

          {/* Quick fill - full 7-day week, independent state per button. */}
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
                    aria-label={`${day} ${st ?? "unset"}${locked ? " (locked)" : ""}${hasNote ? ` - ${noteText}` : ""}`}
                    title={hasNote ? noteText : (locked ? "Locked - contact the office to change this day" : undefined)}
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

          {/* Notes - collapsed by default. */}
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
                      placeholder={ht.availabilityDayNotePlaceholder}
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
      {showFutureModal && (
        <FuturePeriodModal
          today={today}
          onCancel={() => setShowFutureModal(false)}
          onSubmitted={(newState, summary) => {
            setCache(newState);
            setShowFutureModal(false);
            setPostSubmitMsg(summary);
          }}
        />
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
            : <>You haven't submitted any availability yet. Come back later - there's nothing to submit right now.</>}
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
      // Skip the active (currently-editable) window - that's owned by the
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
                      aria-label={`${day} ${st ?? "unset"}${hasNote ? ` - ${noteText}` : ""} (admin click to cycle)`}
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
                    aria-label={`${day} ${st ?? "unset"}${hasNote ? ` - ${noteText}` : ""}`}
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
                    {" - "}
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
          Once submitted, days within the next 2 weeks become locked - you'll
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
            Yes - submit
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Future-period modal ─────────────────────────────────────────────────────

function FuturePeriodModal({
  today,
  onCancel,
  onSubmitted,
}: {
  today: string;
  onCancel: () => void;
  onSubmitted: (newState: AvailabilityState, summary: string) => void;
}) {
  const { settings: themeSettings } = useTheme();
  const ht = themeSettings.helpTexts;
  // Earliest legal Start is today + 14: anything earlier is the rolling
  // cadence's job and the backend's lock check would 409 anyway.
  const minStart = useMemo(() => addDaysIso(today, 14), [today]);
  // Soft cap of 1 year out - discourages typos that submit decades of
  // unavailability. The backend's 100-day batch limit is a separate
  // safety net.
  const maxEnd = useMemo(() => addDaysIso(today, 365), [today]);

  const [from, setFrom] = useState(minStart);
  const [to, setTo] = useState(minStart);
  const [status, setStatus] = useState<AvailabilityStatus>("unavailable");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");

  // Keep `to` >= `from` automatically when the user shifts From after To.
  useEffect(() => {
    if (to < from) setTo(from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  const totalDays = useMemo(() => {
    if (to < from) return 0;
    // daysBetween returns whole-day difference; +1 for inclusive count.
    const diff = (Date.parse(to + "T00:00:00") - Date.parse(from + "T00:00:00")) / 86_400_000;
    return Math.round(diff) + 1;
  }, [from, to]);

  async function handleSubmit() {
    setErr(null);
    if (from < minStart) {
      setErr(
        `Start date must be at least 14 days from today (${minStart} or later). For sooner dates, use your regular submission.`,
      );
      return;
    }
    if (to < from) {
      setErr("End date must be on or after the start date.");
      return;
    }
    if (to > maxEnd) {
      setErr(`End date must be on or before ${maxEnd}.`);
      return;
    }
    if (totalDays > 100) {
      setErr("Range is too long - split into shorter submissions (max 100 days each).");
      return;
    }

    // Chunk the range into 14-day pieces anchored at `from`. Each chunk
    // becomes one POST that the existing submit_batch handler accepts:
    // window_start = chunk_start, days = the in-range days within that
    // 14-day window. Multi-chunk ranges therefore land as multiple sheet
    // rows (one per 14-day chunk), same as if the user had submitted
    // those windows via the normal cadence.
    const chunks: { window_start: string; days: string[] }[] = [];
    let cs = from;
    while (cs <= to) {
      const ce = addDaysIso(cs, 13);
      const last = ce < to ? ce : to;
      const days: string[] = [];
      let d = cs;
      while (d <= last) { days.push(d); d = addDaysIso(d, 1); }
      chunks.push({ window_start: cs, days });
      cs = addDaysIso(ce, 1);
    }

    setBusy(true);
    let lastState: AvailabilityState | null = null;
    try {
      const trimmedNote = note.trim() || null;
      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1) setProgress(`Submitting ${i + 1} of ${chunks.length}…`);
        const c = chunks[i];
        lastState = await apiFetch<AvailabilityState>("/api/availability", {
          method: "POST",
          body: JSON.stringify({
            window_start: c.window_start,
            days: c.days.map((d) => ({ day: d, status, note: trimmedNote })),
          }),
        });
      }
      if (lastState) {
        saveCache(lastState);
        const fmt = (iso: string) => {
          const [y, m, dd] = iso.split("-").map(Number);
          return new Date(y, m - 1, dd).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        };
        const summary =
          totalDays === 1
            ? `Marked ${fmt(from)} as ${status}.`
            : `Marked ${fmt(from)} → ${fmt(to)} (${totalDays} days) as ${status}.`;
        onSubmitted(lastState, summary);
      }
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Submit failed - check connection and try again.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, padding: 16, zIndex: 1000,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card)", borderRadius: 12,
          border: "1px solid var(--border)",
          maxWidth: 460, width: "100%",
          padding: 18, display: "flex", flexDirection: "column", gap: 14,
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 800 }}>Plan a future absence</div>
        <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
          Pre-submit availability for a known future period - vacation, family
          event, anything fixed in your calendar. Start date must be at least
          14 days out; closer dates go through your regular 2-week submission.
        </div>

        <div className="row" style={{ gap: 8 }}>
          <label className="col" style={{ flex: 1, gap: 4 }}>
            <span className="label">From</span>
            <input
              type="date"
              value={from}
              min={minStart}
              max={maxEnd}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="col" style={{ flex: 1, gap: 4 }}>
            <span className="label">To</span>
            <input
              type="date"
              value={to}
              min={from}
              max={maxEnd}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>

        <div>
          <span className="label">Status for every day in the range</span>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {(["available", "unavailable", "conditional"] as const).map((s) => {
              const colors = STATUS_COLORS[s];
              const active = status === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  style={{
                    flex: 1, padding: "10px 8px", borderRadius: 8,
                    border: `1px solid ${active ? colors.fg : "var(--border)"}`,
                    background: active ? colors.bg : "transparent",
                    color: active ? colors.fg : "var(--text)",
                    fontWeight: 700, fontSize: 13,
                  }}
                >
                  {colors.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="col" style={{ gap: 4 }}>
          <span className="label">Note (optional, applies to every day)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={ht.futureAbsenceNotePlaceholder}
          />
        </div>

        {totalDays > 0 && (
          <div
            className="small"
            style={{
              color: "var(--muted)", padding: "8px 10px",
              borderRadius: 8, border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            Marking <strong style={{ color: "var(--text)" }}>{totalDays}</strong>
            {" "}day{totalDays === 1 ? "" : "s"} as
            {" "}<strong style={{ color: STATUS_COLORS[status].fg }}>{STATUS_COLORS[status].label.toLowerCase()}</strong>.
            {" "}You'll see these in your History tab and the office will see them in your calendar today.
          </div>
        )}

        {err && (
          <div
            className="small"
            style={{
              color: "var(--danger)", padding: "8px 12px",
              background: "rgba(255,107,107,0.1)", borderRadius: 8,
            }}
          >
            {err}
          </div>
        )}
        {progress && (
          <div className="small" style={{ color: "var(--muted)" }}>{progress}</div>
        )}

        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
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
            onClick={handleSubmit}
            disabled={busy || totalDays === 0}
            style={{ padding: "8px 14px" }}
          >
            {busy ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SchedulingNotesCard - persistent per-user text field for ongoing scheduling
// constraints ("no Saturdays until July", "back to full availability after the
// 15th"). One note per user, independent of any window. Collapsed by default so
// it stays out of the way; expanded shows a textarea with debounced autosave.
//
// Surfaced to admin via a hover tooltip on the monthly availability view.

type NotesStatus = "idle" | "saving" | "saved" | "offline" | "error";

// Per-user local draft so an offline edit survives an app reload before the
// next online save flushes. Keyed by user id so a shared device doesn't
// surface crew member A's unsaved draft to crew member B after a logout.
// Cleared once the server confirms a successful save.
const SCHED_NOTES_DRAFT_PREFIX = "mm_scheduling_notes_draft_v1:";
function schedNotesDraftKey(userId: number | undefined): string | null {
  return typeof userId === "number" ? `${SCHED_NOTES_DRAFT_PREFIX}${userId}` : null;
}

function SchedulingNotesCard() {
  const { user, setUser } = useAuth();
  const { settings: themeSettings } = useTheme();
  const ht = themeSettings.helpTexts;
  const userId = user?.id;
  const initial = useMemo(() => {
    // Prefer a locally saved draft over the server-side value on mount -
    // if the user typed something while offline and reloaded, we want to
    // resume their unsaved edit, not silently drop it. Empty draft falls
    // back to whatever /me carried in.
    const key = schedNotesDraftKey(userId);
    if (key) {
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null) return raw;
      } catch {}
    }
    return user?.scheduling_notes ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  const [value, setValue] = useState<string>(initial);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [status, setStatus] = useState<NotesStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastSavedRef = useRef<string>(user?.scheduling_notes ?? "");
  const timerRef = useRef<number | null>(null);
  const savedFlashRef = useRef<number | null>(null);

  // Persist every keystroke to a local draft so an offline edit doesn't
  // vanish on reload. The successful-save path below clears the draft so
  // we don't keep a stale copy lying around once the server has the value.
  useEffect(() => {
    const key = schedNotesDraftKey(userId);
    if (!key) return;
    try { localStorage.setItem(key, value); } catch {}
  }, [userId, value]);

  // Resync from the user object when it changes underneath us (another tab
  // saved, or AuthContext refetched /me). Guard against clobbering an in-flight
  // edit: only adopt the incoming value if it differs from the one we last
  // wrote AND from the value the user is currently typing.
  useEffect(() => {
    const incoming = user?.scheduling_notes ?? "";
    if (incoming !== lastSavedRef.current && incoming !== value) {
      setValue(incoming);
      lastSavedRef.current = incoming;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.scheduling_notes]);

  // Debounced autosave. 1.2s after the last keystroke we flush the PATCH.
  // No explicit submit button - matches the autosave pattern already used
  // elsewhere in the app for free-form text fields.
  useEffect(() => {
    if (value === lastSavedRef.current) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setStatus("saving");
    setErrorMsg(null);
    timerRef.current = window.setTimeout(async () => {
      timerRef.current = null;
      try {
        const updated = await apiFetch<User>("/api/auth/me", {
          method: "PATCH",
          body: JSON.stringify({ scheduling_notes: value }),
        });
        lastSavedRef.current = updated.scheduling_notes ?? "";
        setUser(updated);
        setStatus("saved");
        setErrorMsg(null);
        // Local draft can go now - server has the canonical value.
        const key = schedNotesDraftKey(userId);
        if (key) { try { localStorage.removeItem(key); } catch {} }
        // Flash "Saved" briefly then return to idle so the pill doesn't
        // permanently shout SAVED at the user.
        if (savedFlashRef.current !== null) window.clearTimeout(savedFlashRef.current);
        savedFlashRef.current = window.setTimeout(() => {
          setStatus((s) => (s === "saved" ? "idle" : s));
          savedFlashRef.current = null;
        }, 1800);
      } catch (e: any) {
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        if (offline) {
          setStatus("offline");
          setErrorMsg(null);
        } else {
          // Real server/network failure while online - surface it instead of
          // pretending the save succeeded. The local draft persists either
          // way so the user's text isn't lost.
          setStatus("error");
          const msg = e instanceof ApiError
            ? `Save failed: ${e.message}`
            : "Save failed - try again";
          setErrorMsg(msg);
        }
      }
    }, 1200);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Clean up the saved-flash timer on unmount.
  useEffect(() => () => {
    if (savedFlashRef.current !== null) window.clearTimeout(savedFlashRef.current);
  }, []);

  // First 1-2 non-empty lines, cropped to ~120 chars for the collapsed preview.
  const preview = useMemo(() => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
    const head = lines.slice(0, 2).join(" · ");
    return head.length > 120 ? head.slice(0, 117) + "…" : head;
  }, [value]);

  const pill = (() => {
    if (status === "saving") return { text: "Saving…", color: "var(--muted)" };
    if (status === "saved") return { text: "Saved", color: "var(--ok)" };
    if (status === "offline") return { text: "Offline - saves when back online", color: "var(--warn)" };
    if (status === "error") return { text: errorMsg || "Save failed", color: "var(--danger)" };
    return null;
  })();

  return (
    <div className="card" style={{ padding: 0 }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: "12px 14px",
          textAlign: "left",
          cursor: "pointer",
          color: "var(--text)",
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sectionTitle" style={{ marginBottom: 0 }}>Scheduling notes</div>
          <BetaTag feature="schedulingNotes" />
          {!expanded && (
            <div
              className="small"
              style={{
                color: "var(--muted)",
                marginTop: 4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {preview || "Ongoing scheduling constraints (e.g. \"no Saturdays until July\")"}
            </div>
          )}
        </div>
        <div style={{ color: "var(--muted)", fontSize: 14, flexShrink: 0 }}>
          {expanded ? "▾" : "▸"}
        </div>
      </button>
      {expanded && (
        <div style={{ padding: "0 14px 14px 14px" }}>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder={ht.schedulingNotesPlaceholder}
            style={{ width: "100%", boxSizing: "border-box", resize: "vertical" }}
          />
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 6,
              fontSize: 11,
            }}
          >
            <span style={{ color: "var(--muted)" }}>
              These notes are visible to admin alongside your availability.
            </span>
            {pill ? (
              <span style={{ color: pill.color, fontWeight: 600 }}>{pill.text}</span>
            ) : (
              <span />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
