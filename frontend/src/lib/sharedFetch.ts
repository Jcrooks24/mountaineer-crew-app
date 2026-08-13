/**
 * One request where the app was making several.
 *
 * THE PROBLEM, straight from a production log. Opening one job produced:
 *
 *     GET /api/job-setup/d7a0...      GET /api/job-setup/d7a0...
 *     GET /api/config/vehicle-units   GET /api/config/vehicle-units
 *     GET /api/job-types              GET /api/job-types
 *     GET /api/config/job-checklist   GET /api/config/job-checklist
 *     GET /api/users/directory        GET /api/users/directory
 *
 * Each pair is the same resource fetched twice because two components mounted
 * and each asked independently. Nothing was wrong with either caller; there was
 * simply nothing in between them. On a crew phone in a driveway every one of
 * those is a round trip on whatever signal exists, and they are all on the
 * critical path to the screen rendering.
 *
 * TWO MECHANISMS, and they solve different halves:
 *
 *   coalesce()  Concurrent callers share ONE in-flight promise. Pure win, no
 *               staleness of any kind: everybody gets the same answer they
 *               would have got, one request later instead of five.
 *
 *   ttl         A repeat within a few seconds is served from the last result
 *               instead of the network. This is the half with a trade-off, so
 *               it is opt-in per caller and short by default.
 *
 * WHAT THIS IS NOT FOR. Anything that writes, anything per-record that a crew
 * member is actively editing, and anything where a stale read is a correctness
 * problem rather than a cosmetic one. It is for the shared, slow-moving,
 * read-only config the whole app leans on: the fleet list, job types, the
 * checklist template, the roster.
 */

type Entry = {
  inflight: Promise<unknown> | null;
  /** Last resolved value and when, for the TTL path. */
  value?: unknown;
  at?: number;
};

const entries = new Map<string, Entry>();

export type CoalesceOptions = {
  /**
   * Milliseconds a resolved result stays reusable. 0 (the default) coalesces
   * concurrent calls only and never serves a stale value.
   *
   * Keep it small. The point is to collapse the burst of duplicate requests a
   * screen makes while it mounts, not to build a cache with its own
   * invalidation problems - the callers here already have a localStorage cache
   * underneath them for the offline case.
   */
  ttlMs?: number;
  /** Skip the TTL and force a network round trip. For the path that just saved
   *  a change and needs to see it. Still coalesces concurrent callers. */
  force?: boolean;
};

/**
 * Run `fn` at most once per key at a time, optionally reusing its result.
 *
 * A rejection is NEVER cached and never reused: a failed fetch must not poison
 * the next attempt, especially here, where the most likely failure is the
 * backend being mid-recycle and the right answer a second later is "fine".
 */
export function coalesce<T>(
  key: string,
  fn: () => Promise<T>,
  opts: CoalesceOptions = {},
): Promise<T> {
  const { ttlMs = 0, force = false } = opts;
  let entry = entries.get(key);
  if (!entry) {
    entry = { inflight: null };
    entries.set(key, entry);
  }

  // Someone is already asking. Join them rather than asking again.
  if (entry.inflight) return entry.inflight as Promise<T>;

  if (!force && ttlMs > 0 && entry.at != null && Date.now() - entry.at < ttlMs) {
    return Promise.resolve(entry.value as T);
  }

  const p = fn()
    .then((value) => {
      entry!.value = value;
      entry!.at = Date.now();
      return value;
    })
    .finally(() => {
      entry!.inflight = null;
    });

  entry.inflight = p;
  return p;
}

/** Drop a key's remembered result so the next call goes to the network.
 *  Call after saving a change to that resource. */
export function invalidate(key: string): void {
  const entry = entries.get(key);
  if (entry) {
    entry.value = undefined;
    entry.at = undefined;
  }
}

/** Test seam, and the right thing to call on user switch: a new crew member
 *  must not be served the previous one's roster from memory. */
export function clearSharedFetchCache(): void {
  entries.clear();
}
