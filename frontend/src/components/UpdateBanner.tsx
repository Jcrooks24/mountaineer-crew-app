import { useEffect, useState } from "react";
import { applyWaitingUpdate } from "../lib/appUpdate";

// How often to re-ask the service worker to check for a new build while the
// app stays open — covers crew who leave the PWA running for days.
const PERIODIC_CHECK_MS = 20 * 60 * 1000; // 20 min
// Minimum gap between focus-triggered checks, so flipping between apps a lot
// doesn't hammer the network.
const FOCUS_CHECK_THROTTLE_MS = 5 * 60 * 1000; // 5 min

/**
 * App-wide "update available" banner.
 *
 * With registerType: "prompt", a freshly deployed build installs and then
 * waits. This component:
 *   • re-checks for updates periodically and whenever the app regains focus
 *     (a long-lived PWA session otherwise never notices a new deploy), and
 *   • shows a dismissible banner when a new version is waiting, so the crew
 *     apply it at a safe stopping point instead of being reloaded mid-task.
 *
 * Ignoring the banner is safe: a waiting worker activates on its own once the
 * app is fully closed and reopened.
 */
export default function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    let reg: ServiceWorkerRegistration | null = null;
    let interval: number | undefined;
    let lastFocusCheck = Date.now();

    // A waiting worker counts as an *update* only if this page is already
    // controlled by a worker — otherwise it's just the first-ever install.
    function announce() {
      if (cancelled) return;
      if (navigator.serviceWorker.controller) {
        setReady(true);
        setDismissed(false); // a newer build overrides an earlier dismissal
      }
    }

    function watchInstall(worker: ServiceWorker) {
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") announce();
      });
    }

    navigator.serviceWorker.getRegistration().then((r) => {
      if (cancelled || !r) return;
      reg = r;

      if (r.waiting) announce();
      if (r.installing) watchInstall(r.installing);
      r.addEventListener("updatefound", () => {
        if (r.installing) watchInstall(r.installing);
      });

      interval = window.setInterval(() => {
        r.update().catch(() => { /* offline / transient — retry next tick */ });
      }, PERIODIC_CHECK_MS);
    });

    function onVisible() {
      if (document.visibilityState !== "visible" || !reg) return;
      const now = Date.now();
      if (now - lastFocusCheck < FOCUS_CHECK_THROTTLE_MS) return;
      lastFocusCheck = now;
      reg.update().catch(() => {});
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  async function handleUpdate() {
    setApplying(true);
    // Resolves as the page reloads; if it somehow returns, drop the spinner.
    await applyWaitingUpdate();
    setApplying(false);
  }

  if (!ready || dismissed) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed", left: 12, right: 12, bottom: 12,
        zIndex: 900, margin: "0 auto", maxWidth: 460,
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 14px",
        borderRadius: 14,
        border: "1px solid var(--brand)",
        background: "var(--card)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
      }}
    >
      <span style={{ fontSize: 20, flexShrink: 0 }}>↻</span>
      <div className="col" style={{ gap: 1, flex: 1 }}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>New version available</span>
        <span className="small" style={{ color: "var(--muted)" }}>
          Update when you're at a safe stopping point.
        </span>
      </div>
      <button
        onClick={handleUpdate}
        disabled={applying}
        className="btnPrimary"
        style={{ fontSize: 13, flexShrink: 0 }}
      >
        {applying ? "Updating…" : "Update"}
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        title="Dismiss"
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
