/**
 * "Is the server restarting?" - inferred, because nobody can tell us.
 *
 * The backend is recycled every `--limit-max-requests` (1000) by design, and the
 * service is DOWN for the few seconds it takes to boot. During that window the
 * server cannot send a message saying it is unavailable, so the client has to
 * work it out from the shape of the failures: a request that fails while the
 * DEVICE still has a network.
 *
 * That distinction is the whole design. "You are offline" and "the server is
 * briefly restarting" look identical to a crew member staring at a spinner, but
 * they are different situations with different advice, and the app already
 * handles the first one well. This module only claims the second.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: promise a countdown. A boot takes as long as
 * it takes, and a timer ticking down to zero while the app is still unavailable
 * is worse than no timer - it turns a short wait into a broken promise. It
 * reports that a restart is in progress and how long it has been going.
 */

type Listener = (state: ServerState) => void;

export type ServerState = {
  /** True when recent failures look like a backend restart rather than a dead
   *  network. Cleared by the first success. */
  restarting: boolean;
  /** Seconds since the first failure of the current run. Drives "still going"
   *  wording rather than a countdown we cannot honour. */
  seconds: number;
};

let restartingSince: number | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  const state = snapshot();
  for (const fn of listeners) {
    try {
      fn(state);
    } catch {
      /* a broken subscriber must not break the app's error path */
    }
  }
}

export function snapshot(): ServerState {
  return {
    restarting: restartingSince != null,
    seconds: restartingSince == null ? 0 : Math.round((Date.now() - restartingSince) / 1000),
  };
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  // Guarded like emit(). The immediate push was unguarded, so a subscriber that
  // threw took down whatever was mounting it - which for an error-path module is
  // exactly backwards: this exists to make failures calmer, not to add one.
  try {
    fn(snapshot());
  } catch {
    /* see above */
  }
  return () => { listeners.delete(fn); };
}

/**
 * Does this failure look like the server being down rather than the device
 * being offline?
 *
 * A 502/503/504 is a proxy that cannot reach the app, which is exactly what
 * Render serves while a service restarts. A `TypeError` from fetch is a
 * connection that never completed - which means offline OR a refused connection,
 * so `navigator.onLine` breaks the tie.
 *
 * 500 is NOT in the list. A 500 is the app running and throwing, which is a bug
 * to report, not a wait to sit out, and telling a crew member to wait for a
 * restart that is not coming would strand them.
 */
export function looksLikeRestart(err: unknown, status?: number): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  if (err instanceof TypeError) {
    // navigator.onLine is unreliable in the other direction (it can report true
    // on a captive portal), but a FALSE here is trustworthy and is the case we
    // must not misreport as a server problem.
    return typeof navigator === "undefined" || navigator.onLine !== false;
  }
  return false;
}

/** Record that a request failed in a way that looks like a restart. */
export function noteServerUnavailable(): void {
  if (restartingSince == null) {
    restartingSince = Date.now();
    emit();
  }
}

/** Record a successful response. The server is up; clear the banner. */
export function noteServerReachable(): void {
  if (restartingSince != null) {
    restartingSince = null;
    emit();
  }
}

/** Test seam. */
export function resetServerStatus(): void {
  restartingSince = null;
  listeners.clear();
}
