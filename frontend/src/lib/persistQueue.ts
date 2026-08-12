/**
 * Persist a queue to localStorage and SAY SO IF IT FAILS.
 *
 * This exists because of "bug 5" from the BOL durability incident (ADR 0020 /
 * 0021): a `try { localStorage.setItem(...) } catch {}` on a queue write is a
 * silent drop behind a success message. The crew member is told their work is
 * saved, the write threw, and the record is gone with nothing to retry.
 *
 * `bolStore` was fixed at the time and the pattern was never generalised, so
 * rodsStore, ldDayStore, officeHoursStore, materialsStore and jobChecklistStore
 * each kept a `saveQueue(...): void` that swallowed the failure. RODS logs are
 * DOT compliance records; materials feed billing; office hours feed pay.
 *
 * The realistic trigger is QuotaExceededError, not disk failure. A crew phone's
 * localStorage already carries queued photos and base64 signatures, so the
 * budget is genuinely reachable in the field - which is where nobody can tell
 * that a "Saved" was a lie.
 *
 * Callers must check the return value and surface a failure. A queue write that
 * cannot report failure is the bug this file is named after.
 */

/** Thrown by callers that cannot return a boolean (an async path already
 *  contracted to throw on failure). Carries a message crew can act on. */
export class StorageFullError extends Error {
  constructor(what = "this") {
    super(
      `There is no room left on this device to save ${what}. ` +
      `Free up space - sync or delete old photos - and try again. ` +
      `Nothing has been sent yet, so do not close the app.`,
    );
    this.name = "StorageFullError";
  }
}

/**
 * Write `value` as JSON at `key`. Returns false if it could not be stored.
 *
 * Never throws: the caller decides what a failure means. Some paths can return
 * false to their UI, others must raise - forcing one of those on every caller
 * would just push the swallowing somewhere else.
 */
export function persistJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    // Logged, not swallowed. If a queue write fails there is nothing else that
    // will tell anyone, and the console line is what turns "my hours vanished"
    // into a diagnosable report.
    // eslint-disable-next-line no-console
    console.error(`[persistQueue] could not write ${key}:`, e);
    return false;
  }
}

/** True when the error looks like the browser refusing on space grounds.
 *  Firefox and Safari use different names/codes for the same condition. */
export function isStorageFull(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = (e as any).name;
  const code = (e as any).code;
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    code === 22 ||
    code === 1014
  );
}
