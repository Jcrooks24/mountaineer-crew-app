/**
 * How much this device is actually carrying, and where it went.
 *
 * Crews reported the app being slow, "especially on certain devices". That
 * phrasing is the whole diagnosis waiting to happen: the app's cost is dominated
 * by SYNCHRONOUS localStorage work whose size varies enormously per device -
 * signature PNGs on a driver's phone, a long event log on a lead's, almost
 * nothing on a new hire's. Same build, same network, wildly different feel.
 *
 * Nobody could see that, so it was guessed at. This makes it a number.
 *
 * Deliberately cheap: reading every localStorage value is O(total bytes) and on
 * a loaded device that is the very cost being measured, so this must be run on
 * demand from a settings screen, NEVER on boot or on a timer. Measuring the
 * problem must not become the problem.
 */

/** localStorage counts UTF-16 code units, so a byte estimate is 2x the length.
 *  Close enough to reason about; nothing here needs to be exact. */
function approxBytes(s: string): number {
  return s.length * 2;
}

export type StorageEntry = {
  key: string;
  bytes: number;
  /** Grouped label - per-job keys collapse so one busy job does not fill the
   *  list with forty near-identical rows. */
  group: string;
};

export type StorageReport = {
  totalBytes: number;
  entries: StorageEntry[];
  /** Largest groups first, which is the only ordering anyone wants here. */
  groups: { group: string; bytes: number; count: number }[];
  /** From navigator.storage.estimate(), covering IndexedDB and caches too.
   *  Undefined where the browser does not implement it (older iOS Safari). */
  quota?: { usageBytes: number; quotaBytes: number; pct: number };
  /** True when localStorage alone is big enough to make synchronous reads
   *  perceptible. Not a hard limit - a hint about where to look. */
  heavy: boolean;
};

/** Collapse `crew_bol_draft_v1:<uuid>` and friends into one row per family. */
function groupOf(key: string): string {
  const colon = key.indexOf(":");
  return colon > 0 ? key.slice(0, colon) : key;
}

/** Threshold at which localStorage is worth acting on. Chosen from what the app
 *  actually does rather than from a spec number: the logout path reads and
 *  re-serialises this whole surface synchronously, and a few megabytes of
 *  JSON.parse plus JSON.stringify is where a phone visibly stalls. The
 *  per-origin quota is typically 5-10 MB, so this is also the point at which
 *  writes start failing. */
export const HEAVY_LOCAL_STORAGE_BYTES = 2 * 1024 * 1024;

export async function buildStorageReport(): Promise<StorageReport> {
  const entries: StorageEntry[] = [];
  let totalBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const value = localStorage.getItem(key);
      if (value == null) continue;
      const bytes = approxBytes(key) + approxBytes(value);
      totalBytes += bytes;
      entries.push({ key, bytes, group: groupOf(key) });
    }
  } catch {
    /* storage unavailable - report what we have */
  }

  const byGroup = new Map<string, { bytes: number; count: number }>();
  for (const e of entries) {
    const g = byGroup.get(e.group) || { bytes: 0, count: 0 };
    g.bytes += e.bytes;
    g.count += 1;
    byGroup.set(e.group, g);
  }

  let quota: StorageReport["quota"];
  try {
    // Covers IndexedDB and the service-worker caches, which localStorage
    // measurement cannot see - and on this app the photo queue lives there.
    const est = await navigator.storage?.estimate?.();
    if (est && typeof est.usage === "number" && typeof est.quota === "number" && est.quota > 0) {
      quota = {
        usageBytes: est.usage,
        quotaBytes: est.quota,
        pct: Math.round((est.usage / est.quota) * 100),
      };
    }
  } catch {
    /* not implemented - localStorage numbers still stand on their own */
  }

  return {
    totalBytes,
    entries: entries.sort((a, b) => b.bytes - a.bytes),
    groups: [...byGroup.entries()]
      .map(([group, v]) => ({ group, ...v }))
      .sort((a, b) => b.bytes - a.bytes),
    quota,
    heavy: totalBytes >= HEAVY_LOCAL_STORAGE_BYTES,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
