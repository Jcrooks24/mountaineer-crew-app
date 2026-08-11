// Shared failure handling for the localStorage offline queues.
//
// The rule is ADR 0013: a queue NEVER deletes work because the server refused it.
// It marks the entry failed, leaves it in the queue, skips it on the drain (so it
// cannot wedge the line), and shows it to the crew member with the reason and a
// way to act. The entry leaves the queue only when a person says so.
//
// `reimbursementStore` implements this over IndexedDB, because it carries photo
// blobs. The queues that are plain localStorage (incidents, off-job hours, job
// inventory) share the pieces here rather than each growing their own copy, which
// is how they drifted apart the first time.

import { ApiError } from "../api/client";

// Widen a queued entry with `& Partial<QueueFailure>`. All fields optional, so
// entries already sitting on crew phones stay readable and count as pending.
export type QueueFailure = {
  failed_at: string;     // ISO
  failed_status: number; // the 4xx the server answered with
  failed_reason: string; // in words a crew member can act on
};

export type MaybeFailed = Partial<QueueFailure>;

/**
 * Did the server permanently refuse this payload, as opposed to failing for a
 * reason that retrying can fix?
 *
 * **This is the ONLY failure classifier in the app.** `api/client.ts` briefly
 * carried a second one (`isPermanentFailure`, an allowlist of 400/404/409/422)
 * and the two disagreed, so which of a crew member's queues survived a given
 * error depended on which store happened to be draining. Converged 2026-08-11.
 *
 * The rule is a DENYLIST: every 4xx is permanent except the four that retrying
 * genuinely fixes. That shape was chosen over an allowlist deliberately -
 * an allowlist silently treats every unlisted 4xx as transient, and the
 * unlisted one that bites is **413**. The backend returns 413 from the body-size
 * middleware and from three upload endpoints; an oversized photo retried
 * forever never gets smaller, so it wedges the queue and burns the crew
 * member's data every reconnect.
 *
 * The transient four:
 * - **401 / 403** - an expired token is not a bad payload. Treating it as one
 *   would throw away a whole day of queued work the moment a session lapsed.
 * - **408** - a timeout is the definition of "try again".
 * - **429** - a rate limit. This app's history with the Google Sheets quota
 *   makes this the one that matters: the old rule called 429 permanent and
 *   would discard real field work the moment we got throttled.
 */
export function isPermanentRejection(e: unknown): e is ApiError {
  return (
    e instanceof ApiError &&
    e.status >= 400 &&
    e.status < 500 &&
    e.status !== 401 &&
    e.status !== 403 &&
    e.status !== 408 &&
    e.status !== 429
  );
}

/**
 * Turn an API error into something a crew member can act on. FastAPI answers a
 * 422 with `{detail: [{loc: ["body", "description"], msg: "..."}]}`, which is
 * not something to put in front of somebody on a phone in a driveway.
 */
export function describeApiError(e: unknown, fieldLabels: Record<string, string> = {}): string {
  if (!(e instanceof ApiError)) {
    return e instanceof Error ? e.message : "Unknown error.";
  }
  const detail = (e.body as any)?.detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d: any) => {
        const loc = Array.isArray(d?.loc) ? d.loc : [];
        const field = String(loc[loc.length - 1] ?? "");
        const label = fieldLabels[field] || field || "A field";
        return `${label}: ${d?.msg || "was rejected"}`;
      })
      .join(". ");
  }
  if (typeof detail === "string" && detail.trim()) return detail;
  return `The server rejected this (${e.status}).`;
}

/** The failure mark to stamp onto an entry. */
export function failureMark(e: ApiError, fieldLabels?: Record<string, string>): QueueFailure {
  return {
    failed_at: new Date().toISOString(),
    failed_status: e.status,
    failed_reason: describeApiError(e, fieldLabels),
  };
}

/** Clearing the mark is what puts an entry back in the drain rotation. */
export const CLEARED_FAILURE: MaybeFailed = {
  failed_at: undefined,
  failed_status: undefined,
  failed_reason: undefined,
};
