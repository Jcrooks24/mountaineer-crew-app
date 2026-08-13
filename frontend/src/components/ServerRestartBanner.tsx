/**
 * "The server is restarting" - shown while the backend is mid-recycle.
 *
 * The backend is recycled every 1000 requests to stay inside Render's 512 MB
 * memory limit. That is deliberate, not a fault, but for a few seconds the app
 * cannot reach it - and a crew member with a spinner and no explanation
 * reasonably concludes the app is broken.
 *
 * THREE THINGS THIS IS CAREFUL ABOUT.
 *
 * 1. It does not count down. A boot takes as long as it takes; a timer reaching
 *    zero while the app is still unavailable turns a short wait into a broken
 *    promise. It says a restart is happening and, once it has dragged on, how
 *    long it has been.
 *
 * 2. It does not claim more than it can. "Your data will not be lost" is true of
 *    queued work and of anything still on a form, so the wording is about the
 *    data being ON THE DEVICE - which is checkable - rather than a guarantee
 *    about a server nobody can reach.
 *
 * 3. It waits before appearing. Most recycles are caught by the automatic retry
 *    in apiFetch and the crew member never notices; a banner that flashed up on
 *    every one would train them to ignore it. It only appears once the wait is
 *    long enough to be worth explaining.
 */

import { useEffect, useState } from "react";

import { subscribe, type ServerState } from "../lib/serverStatus";

/** How long a restart must persist before it is worth a banner. Below this the
 *  retry usually wins and the interruption is invisible. */
const SHOW_AFTER_MS = 1200;

export default function ServerRestartBanner() {
  const [state, setState] = useState<ServerState>({ restarting: false, seconds: 0 });
  const [visible, setVisible] = useState(false);

  useEffect(() => subscribe(setState), []);

  useEffect(() => {
    if (!state.restarting) {
      setVisible(false);
      return;
    }
    const t = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [state.restarting]);

  // Tick so the "still going" wording updates without the status module having
  // to run a timer of its own when nothing is wrong.
  const [, force] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [visible]);

  if (!visible || !state.restarting) return null;

  const seconds = Math.max(1, state.seconds);
  const dragging = seconds >= 15;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        // Above the fixed bottom nav rather than over it: covering the nav
        // during a wait is exactly when someone wants to navigate away.
        bottom: 78,
        left: 12,
        right: 12,
        zIndex: 60,
        padding: "10px 14px",
        borderRadius: 12,
        background: "var(--surface, #1c1c1e)",
        border: "1px solid var(--border)",
        boxShadow: "0 6px 24px rgba(0,0,0,0.28)",
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 2 }}>
        The server is restarting{dragging ? ` (${seconds}s)` : ""}
      </div>
      <div style={{ color: "var(--muted)" }}>
        {dragging
          ? "Taking longer than usual. Nothing you have entered is lost - it is saved on this phone and will send once the server is back."
          : "It does this periodically to stay within its memory limit. Nothing you have entered is lost; this should clear in a few seconds."}
      </div>
    </div>
  );
}
