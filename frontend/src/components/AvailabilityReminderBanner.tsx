import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  fetchState,
  isHorizonLow,
  loadCache,
  todayLocalIso,
} from "../lib/availabilityStore";

/**
 * App-wide drop-down reminder that the user needs to submit availability
 * for the next 2 weeks. Replaces the originally-planned push notification:
 * we run inside the PWA anyway, so a banner here is just as visible without
 * the iOS web-push limitations.
 *
 * Rules:
 *   - Only shown when logged in.
 *   - Hidden on /availability itself (no need to nag while editing).
 *   - Dismissed for the rest of the browser session via sessionStorage.
 *   - Re-checked when connectivity returns (so a successful submit clears
 *     it on the next tab focus without a page reload).
 */

const DISMISS_KEY = "crew_availability_reminder_dismissed_v1";

function isDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function markDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {}
}

export default function AvailabilityReminderBanner() {
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  const [horizonLow, setHorizonLow] = useState<boolean>(false);
  const [horizon, setHorizon] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => isDismissed());

  // Re-evaluate whenever the route changes — the user submitting availability
  // navigates to /availability, fills it in, submits, and goes back. Picking
  // up the new horizon on each navigation means the banner clears itself
  // without needing a manual dismiss.
  useEffect(() => {
    if (!user) {
      setHorizonLow(false);
      return;
    }
    const today = todayLocalIso();
    const cached = loadCache();
    setHorizon(cached.horizon);
    setHorizonLow(isHorizonLow(cached.horizon, today));

    let cancelled = false;
    (async () => {
      const s = await fetchState();
      if (cancelled || !s) return;
      setHorizon(s.horizon);
      setHorizonLow(isHorizonLow(s.horizon, today));
    })();
    return () => { cancelled = true; };
  }, [user, loc.pathname]);

  // Visual reveal so the banner slides in rather than popping.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!user || !horizonLow || dismissed) {
      setRevealed(false);
      return;
    }
    const id = window.setTimeout(() => setRevealed(true), 30);
    return () => window.clearTimeout(id);
  }, [user, horizonLow, dismissed]);

  // Suppress on the availability page itself and on any public auth route.
  const onSuppressRoute =
    loc.pathname.startsWith("/availability") ||
    loc.pathname.startsWith("/login") ||
    loc.pathname.startsWith("/signup") ||
    loc.pathname.startsWith("/forgot-password") ||
    loc.pathname.startsWith("/reset-password") ||
    loc.pathname.startsWith("/mechanic-sign");

  if (!user || !horizonLow || dismissed || onSuppressRoute) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 950,
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "var(--card)",
        borderBottom: "1px solid var(--warn)",
        boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
        // Slide-down reveal — simple translate-Y transition so the banner
        // doesn't pop suddenly when the user lands on a route that triggers it.
        transform: revealed ? "translateY(0)" : "translateY(-100%)",
        transition: "transform 220ms ease-out",
      }}
    >
      <span style={{ fontSize: 20, color: "var(--warn)", flexShrink: 0 }}>!</span>
      <div className="col" style={{ gap: 1, flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>
          Submit your availability
        </span>
        <span
          className="small"
          style={{
            color: "var(--muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {horizon
            ? `Your submitted horizon ends ${horizon}. Add the next 2 weeks.`
            : "You haven't submitted any availability yet."}
        </span>
      </div>
      <button
        onClick={() => nav("/availability")}
        className="btnPrimary"
        style={{ fontSize: 13, flexShrink: 0 }}
      >
        Open
      </button>
      <button
        onClick={() => { markDismissed(); setDismissed(true); }}
        aria-label="Dismiss until next session"
        title="Dismiss until next session"
        style={{
          flexShrink: 0, width: 30, height: 30, padding: 0,
          fontSize: 15, lineHeight: 1,
          background: "none", border: "1px solid var(--border)",
          color: "var(--muted)",
        }}
      >
        ✕
      </button>
    </div>
  );
}
