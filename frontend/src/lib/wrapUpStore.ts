/**
 * Job wrap-up estimate store.
 *
 * The crew estimates when a job actually wraps up: drive time from where they
 * are back to dispatch, plus any billable work still to do once they get there
 * (trash, unstocking the truck, etc). The result is a projected clock time that
 * an employee can then pick as their End time in the hours editor.
 *
 * Persisted to localStorage per job_uuid so the estimate survives navigating to
 * another tab, an app reload, or no signal - the estimator lives inside the Job
 * Report, which unmounts whenever the crew switches tabs, and losing the numbers
 * on every switch made the tool unusable in the field.
 *
 * The wrap-up time is derived (anchor + minutes), never stored as a clock value.
 * Storing the anchor instead means editing a task-minutes field updates the
 * projection live, without a second "generate" press - and the projection stays
 * pinned to when the crew actually took the reading rather than silently
 * sliding forward with the wall clock.
 */

const KEY_PREFIX = "wrapup:";

export type WrapUpState = {
  /** Destination override. Empty = dispatch (backend supplies the address). */
  dest: string;
  /** Buffered drive minutes. Auto-filled by the calc, editable by hand so the
   *  tool still works offline / when GPS is denied. Kept as a string: these are
   *  raw <input> values and blanking a field must not read as 0-vs-empty. */
  driveMin: string;
  trashMin: string;
  unstockMin: string;
  miscMin: string;
  /** When "Calculate" was pressed - the clock the estimate counts forward from.
   *  Null until the first press; its presence is what makes a wrap-up exist. */
  anchorIso: string | null;
  /** Display-only echo of the last successful drive-time calc. */
  destResolved: string | null;
  baseSec: number | null;
  trafficUsed: boolean;
  distanceM: number | null;
};

export function emptyWrapUp(): WrapUpState {
  return {
    dest: "",
    driveMin: "",
    trashMin: "",
    unstockMin: "",
    miscMin: "",
    anchorIso: null,
    destResolved: null,
    baseSec: null,
    trafficUsed: false,
    distanceM: null,
  };
}

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Billable minutes still to do back at dispatch. */
export function taskMinutes(s: WrapUpState): number {
  return num(s.trashMin) + num(s.unstockMin) + num(s.miscMin);
}

/** Drive + tasks. */
export function totalMinutes(s: WrapUpState): number {
  return num(s.driveMin) + taskMinutes(s);
}

/**
 * The projected wrap-up timestamp: anchor + drive + tasks. Null until the crew
 * has pressed Calculate (no anchor = no estimate).
 */
export function wrapUpAt(s: WrapUpState | null): Date | null {
  if (!s || !s.anchorIso) return null;
  const anchor = new Date(s.anchorIso);
  if (Number.isNaN(anchor.getTime())) return null;
  return new Date(anchor.getTime() + totalMinutes(s) * 60_000);
}

function key(jobUuid: string): string {
  return `${KEY_PREFIX}${jobUuid}`;
}

export function loadWrapUp(jobUuid: string): WrapUpState {
  try {
    const raw = localStorage.getItem(key(jobUuid));
    if (!raw) return emptyWrapUp();
    // Merge over the empty shape so a state written by an older build (missing
    // a field added later) still loads instead of rendering undefined.
    return { ...emptyWrapUp(), ...(JSON.parse(raw) as Partial<WrapUpState>) };
  } catch {
    return emptyWrapUp();
  }
}

export function saveWrapUp(jobUuid: string, state: WrapUpState): void {
  try {
    localStorage.setItem(key(jobUuid), JSON.stringify(state));
  } catch {
    // Quota / private-mode failures must not break the report. The estimate is
    // still live in component state for this session.
  }
}

export function clearWrapUp(jobUuid: string): void {
  try {
    localStorage.removeItem(key(jobUuid));
  } catch {
    /* no-op */
  }
}
