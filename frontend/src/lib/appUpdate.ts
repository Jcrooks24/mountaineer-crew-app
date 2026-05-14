// App update helper used by the Profile → Crew Settings card.
//
// vite-plugin-pwa is configured with `registerType: "autoUpdate"`, so a newly
// deployed build will normally take over silently on the next page load. This
// module gives the crew a way to:
//   1. Force a check NOW (without quitting the app or hard-refreshing), and
//   2. Get explicit confirmation they're on the latest version.
//
// Flow:
//   getRegistration() → registration.update() → if a SW is `waiting`, post
//   SKIP_WAITING + reload on `controllerchange`; otherwise report "latest".

export type UpdateResult =
  | { kind: "updating" }            // a new SW took over; we will reload
  | { kind: "latest" }              // no new build available
  | { kind: "unsupported" }         // no service worker (older browsers, dev)
  | { kind: "offline" }             // navigator.onLine === false
  | { kind: "error"; message: string };

/** Build ID baked into the bundle at compile time. Surfaced read-only to the
 * user so they can compare what they're running against what the team shipped.
 */
export const APP_BUILD_ID: string =
  typeof __APP_BUILD_ID__ !== "undefined" ? __APP_BUILD_ID__ : "dev";

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
