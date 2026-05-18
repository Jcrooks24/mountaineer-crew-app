// App update helpers.
//
// vite-plugin-pwa is configured with `registerType: "prompt"`, so a newly
// deployed build installs in the background and then *waits* — it does not
// silently reload the page. Updates reach the crew two ways:
//   • UpdateBanner — watches for the waiting worker, re-checks periodically
//     and on focus, and shows a dismissible "new version" banner.
//   • The Profile "Update app" button — an on-demand check via
//     checkForAppUpdate(), with explicit "you're on the latest" feedback.
//
// Apply flow (shared): if a SW is `waiting`, post SKIP_WAITING and reload on
// `controllerchange`; otherwise report "latest".

export type UpdateResult =
  | { kind: "updating" }            // a new SW took over; we will reload
  | { kind: "latest" }              // no new build available
  | { kind: "unsupported" }         // no service worker (older browsers, dev)
  | { kind: "offline" }             // navigator.onLine === false
  | { kind: "error"; message: string };

/** Build ID baked into the bundle at compile time — the precise identifier
 * (commit + timestamp), kept for support/debugging. */
export const APP_BUILD_ID: string =
  typeof __APP_BUILD_ID__ !== "undefined" ? __APP_BUILD_ID__ : "dev";

/** Friendly two-word version name derived from the build, e.g. "Brave Otter".
 * This is what we show the crew — far more memorable than the raw build id. */
export const APP_VERSION_NAME: string =
  typeof __APP_VERSION_NAME__ !== "undefined" ? __APP_VERSION_NAME__ : "Local Build";

export async function checkForAppUpdate(timeoutMs = 8000): Promise<UpdateResult> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return { kind: "unsupported" };
  }
  if (navigator.onLine === false) {
    return { kind: "offline" };
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { kind: "unsupported" };

    // If a worker is already waiting from a prior auto-update, activate it now.
    if (reg.waiting) {
      return await activateWaiting(reg.waiting, timeoutMs);
    }

    // Ask the SW to re-check the server for a new bundle.
    await reg.update();

    // A new worker may already be waiting, or it may be installing. If it's
    // installing, wait for the statechange to either `installed` (then it
    // becomes the waiting worker) or `redundant` (no update).
    if (reg.waiting) {
      return await activateWaiting(reg.waiting, timeoutMs);
    }

    if (reg.installing) {
      const installed = await waitForInstall(reg.installing, timeoutMs);
      if (installed && reg.waiting) {
        return await activateWaiting(reg.waiting, timeoutMs);
      }
    }

    return { kind: "latest" };
  } catch (e: any) {
    return { kind: "error", message: e?.message || "Update check failed" };
  }
}

/**
 * Apply an update that's already waiting — used by the in-app "update
 * available" banner, where detection already happened and the user has
 * tapped to apply. Resolves as the page reloads.
 */
export async function applyWaitingUpdate(timeoutMs = 8000): Promise<UpdateResult> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return { kind: "unsupported" };
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg?.waiting) {
      return await activateWaiting(reg.waiting, timeoutMs);
    }
    // Nothing waiting — the worker may have already activated (e.g. another
    // tab applied it). A plain reload pulls the fresh shell either way.
    window.location.reload();
    return { kind: "updating" };
  } catch (e: any) {
    return { kind: "error", message: e?.message || "Update failed" };
  }
}

function waitForInstall(worker: ServiceWorker, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      worker.removeEventListener("statechange", onChange);
      resolve(false);
    }, timeoutMs);
    function onChange() {
      if (worker.state === "installed") {
        window.clearTimeout(timer);
        worker.removeEventListener("statechange", onChange);
        resolve(true);
      } else if (worker.state === "redundant") {
        window.clearTimeout(timer);
        worker.removeEventListener("statechange", onChange);
        resolve(false);
      }
    }
    worker.addEventListener("statechange", onChange);
  });
}

async function activateWaiting(
  waiting: ServiceWorker,
  timeoutMs: number,
): Promise<UpdateResult> {
  return new Promise<UpdateResult>((resolve) => {
    const onController = () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onController);
      // Give React a moment to unmount, then hard-reload so the new SW serves
      // a fresh shell. location.reload() is enough — no need to bust caches
      // manually; Workbox already evicted the old precache.
      window.setTimeout(() => window.location.reload(), 150);
      resolve({ kind: "updating" });
    };
    navigator.serviceWorker.addEventListener("controllerchange", onController);

    waiting.postMessage({ type: "SKIP_WAITING" });

    // Safety net: if the SW never fires controllerchange (some browsers when
    // the page never had a controller yet), fall back to a plain reload after
    // the timeout. The new SW will then take over on the fresh page.
    window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", onController);
      window.location.reload();
      resolve({ kind: "updating" });
    }, timeoutMs);
  });
}
