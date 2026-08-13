/**
 * `React.lazy` that survives a deploy.
 *
 * THE HAZARD THIS EXISTS FOR, which arrived with route code splitting. Chunk
 * filenames carry a content hash, so every deploy produces new ones. A crew
 * member with the app already open is running the OLD index bundle, which asks
 * for the OLD chunk names. Once the new service worker activates and cleans up
 * the previous precache, those names can stop resolving - so navigating to a
 * screen that was working a minute ago throws instead of rendering.
 *
 * React.lazy propagates that to the error boundary, so the crew member does not
 * get a white screen, but they do get an error page for a screen that is
 * perfectly fine. The app is simply running two halves of two different builds.
 *
 * The fix is a reload, because the reload fetches the new index bundle and the
 * mismatch is gone. Two conditions on doing it automatically:
 *
 *  - ONLY ONCE per chunk, tracked in sessionStorage. If the chunk is missing for
 *    some other reason - a genuinely broken deploy, a proxy serving garbage - a
 *    reload loop would be far worse than an error page, because it would keep a
 *    crew member out of the whole app rather than one screen.
 *  - ONLY when the load actually failed for a resolution reason. An offline
 *    device also cannot fetch a chunk, and reloading an offline PWA is how you
 *    turn "this screen is unavailable" into "the app is gone".
 */

import { lazy, type ComponentType } from "react";

const RELOADED_PREFIX = "crew_chunk_reload_v1:";

/** Chunk-resolution failures, across browsers. Chrome and Firefox word these
 *  differently and Safari differently again, so this matches on the shapes all
 *  three produce rather than one exact string. */
function isChunkLoadError(err: unknown): boolean {
  const name = (err as { name?: string })?.name || "";
  const msg = (err as { message?: string })?.message || "";
  return (
    name === "ChunkLoadError" ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}

function alreadyReloadedFor(key: string): boolean {
  try {
    return sessionStorage.getItem(RELOADED_PREFIX + key) === "1";
  } catch {
    // No sessionStorage means no way to remember, and a reload we cannot
    // remember is a reload that can loop. Treat it as already done.
    return true;
  }
}

function markReloadedFor(key: string): void {
  try {
    sessionStorage.setItem(RELOADED_PREFIX + key, "1");
  } catch {
    /* see above */
  }
}

/**
 * Drop-in replacement for `lazy(() => import(...))` on a route.
 *
 * `key` names the route for the once-only reload guard. It must be stable
 * across builds - the chunk hash is not, which is the whole problem.
 */
export function lazyRoute<T extends ComponentType<any>>(
  key: string,
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      if (isChunkLoadError(err) && !offline && !alreadyReloadedFor(key)) {
        markReloadedFor(key);
        // Reload rather than rethrow: the error boundary cannot fix a build
        // mismatch, and a reload provably can.
        window.location.reload();
        // Never resolves - the reload is already underway, and returning a
        // component here would render it into a page that is going away.
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}
