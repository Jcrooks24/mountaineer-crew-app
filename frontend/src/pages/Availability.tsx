import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BetaTag } from "../components/BetaTag";
import {
  fetchState,
  flushDraftNow,
  isHorizonLow,
  loadCache,
  loadDraft,
  renderedDays,
  scheduleFlush,
  setDayInDraft,
  type AvailabilityDay,
  type AvailabilityState,
  type AvailabilityStatus,
} from "../lib/availabilityStore";

// Local-day YYYY-MM-DD (not UTC) — same reasoning as Reimbursement.tsx.
function todayLocalIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

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

// Cycle order on tap. Matches the spec: 1 tap = available, 2 = unavailable,
// 3 = conditional, then back to available. Once a day is touched it never
// returns to "unset" — every day in a submitted window carries a status.
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

type SaveStatus = "idle" | "saving" | "saved" | "offline";

export default function Availability() {
  const nav = useNavigate();
  const [state, setState] = useState<AvailabilityState>(() => loadCache());
  const [draft, setDraft] = useState(() => loadDraft());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [today] = useState<string>(() => todayLocalIso());

  // Initial server fetch — cache renders first, then this overrides.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetchState();
      if (!cancelled && r) setState(r);
    })();
    return () => { cancelled = true; };
  }, []);

  // Anchor for the active window:
  // - If the user has a draft, use whatever window it's anchored to.
  // - Else default to "next window after the user's last submitted day".
  // - If they've never submitted, anchor to today.
  const activeWindowStart = useMemo(() => {
    if (draft?.window_start) return draft.window_start;
    if (state.horizon) return addDaysIso(state.horizon, 1);
    return today;
  }, [draft?.window_start, state.horizon, today]);

  // Compute the 14 days of the active window in order.
  const windowDays = useMemo(
    () => Array.from({ length: 14 }, (_, i) => addDaysIso(activeWindowStart, i)),
    [activeWindowStart],
  );

  // Look up a day's current status from (server cache ∪ draft).
  const merged = useMemo(() => {
    const all = renderedDays(state, draft);
    const m = new Map<string, AvailabilityDay>();
    for (const d of all) m.set(d.day, d);
    return m;
  }, [state, draft]);

  const updateDay = useCallback(
    (day: string, nextDayStatus: AvailabilityStatus, note: string | null) => {
      const next = setDayInDraft(activeWindowStart, day, nextDayStatus, note);
      setDraft(next);
      setSaveStatus(navigator.onLine ? "saving" : "offline");
      scheduleFlush(900, (s) => {
        setState(s);
        setDraft(loadDraft());
        setSaveStatus("saved");
      });
    },
    [activeWindowStart],
  );

  const cycleDay = useCallback((day: string) => {
    const current = merged.get(day);
    const nextSt = nextStatus(current?.status ?? null);
    updateDay(day, nextSt, current?.note ?? null);
  }, [merged, updateDay]);

  const setNote = useCallback((day: string, note: string) => {
    const current = merged.get(day);
    if (!current) {
      // No status yet — adding a note implies "available" by default.
      updateDay(day, "available", note || null);
    } else {
      updateDay(day, current.status, note || null);
    }
  }, [merged, updateDay]);

  // Bulk-fill Mon–Fri: cycles all matching days (week 1 + week 2) to the
  // same status. Computes the new status from the leftmost matching cell
  // (so two taps cycle through the same sequence as a single cell tap).
  const bulkFill = useCallback((targetDow: number) => {
    const matching = windowDays.filter((d) => {
      const [y, m, day] = d.split("-").map(Number);
      const dt = new Date(y, m - 1, day);
      return dt.getDay() === targetDow;
    });
    if (matching.length === 0) return;
    const lead = merged.get(matching[0]);
    const nextSt = nextStatus(lead?.status ?? null);
    for (const d of matching) {
      const existing = merged.get(d);
      updateDay(d, nextSt, existing?.note ?? null);
    }
  }, [windowDays, merged, updateDay]);

  // Flush right away when the page unmounts so any pending taps don't sit
  // in localStorage indefinitely until the next visit.
  useEffect(() => {
    return () => { void flushDraftNow(); };
  }, []);

  // Mirror the live online / offline state into the pill so the UI doesn't
  // claim "✓ Saved" while a network drop is silently buffering.
  useEffect(() => {
    function onOnline() { void flushDraftNow().then((s) => { if (s) { setState(s); setDraft(loadDraft()); setSaveStatus("saved"); } }); }
    function onOffline() { setSaveStatus("offline"); }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const horizonLow = isHorizonLow(state.horizon, today);

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
          Tap any day to cycle its status: available → unavailable → conditional.
          Add a note (e.g. "available after 1pm") if your availability needs
          context. Once submitted, if you're scheduled for a job on an available
          day you're expected to work it — exception when the office schedules
          you with 3 or fewer days' notice.
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
            Your submitted availability is less than 2 weeks out — please fill in
            this window so the office can keep scheduling you confidently.
          </div>
        )}
      </div>

      {/* Bulk fill — Mon–Fri only, per the spec. Weekend bulk fill isn't
          common enough to be worth the extra surface area. */}
      <div className="card">
        <div className="sectionTitle">Quick fill — Mon to Fri</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
          Tap a weekday to set both weeks in this window to the same status.
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {[1, 2, 3, 4, 5].map((dow) => {
            // Status of the leftmost matching cell drives the "current" tint.
            const firstMatch = windowDays.find((d) => {
              const [y, m, day] = d.split("-").map(Number);
              return new Date(y, m - 1, day).getDay() === dow;
            });
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

      {/* 14-day grid, two rows of 7. */}
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
            const isToday = day === today;
            const hasNote = !!(current?.note && current.note.trim().length > 0);
            return (
              <button
                key={day}
                type="button"
                onClick={() => cycleDay(day)}
                aria-label={`${day} ${st ?? "unset"}`}
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
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.85 }}>
                  {dayOfWeekShort(day)}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>
                  {dayOfMonth(day)}
                </div>
                {isToday && (
                  <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.7 }}>today</div>
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

      {/* Per-day note inputs. Each row carries the day, status, and a small
          note textarea so the crew can drop a comment without leaving the page. */}
      <div className="card">
        <div className="sectionTitle">Notes for any day</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 8 }}>
          Optional. Use this when "available" or "conditional" needs context.
        </div>
        <div className="col" style={{ gap: 8 }}>
          {windowDays.map((day) => {
            const current = merged.get(day);
            const st = current?.status ?? null;
            const colors = st ? STATUS_COLORS[st] : null;
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
                  </span>
                  <span
                    className="small"
                    style={{
                      padding: "2px 8px", borderRadius: 999,
                      background: colors ? colors.bg : "transparent",
                      color: colors ? colors.fg : "var(--muted)",
                      border: `1px solid ${colors ? colors.fg : "var(--border)"}`,
                      fontWeight: 700,
                    }}
                  >
                    {colors ? colors.label : "Not set"}
                  </span>
                </div>
                <input
                  type="text"
                  value={current?.note ?? ""}
                  placeholder='e.g. "available after 1pm"'
                  onChange={(e) => setNote(day, e.target.value)}
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

      <div
        className="small"
        aria-live="polite"
        style={{
          textAlign: "right", color: "var(--muted)",
          minHeight: 18, marginBottom: 24,
        }}
      >
        {saveStatus === "saving" && "Saving…"}
        {saveStatus === "saved" && <span style={{ color: "var(--ok)" }}>✓ Saved</span>}
        {saveStatus === "offline" && (
          <span style={{ color: "#ffb02e" }}>Offline — will sync when back online</span>
        )}
      </div>
    </div>
  );
}
