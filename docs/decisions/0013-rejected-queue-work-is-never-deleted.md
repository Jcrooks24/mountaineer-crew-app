# 0013. A queue never deletes work the server rejected

**Status:** Active, and **fully rolled out**: all ten offline queues honor this as of
2026-07-15. The remaining work is crew-facing retry UI for three of them, not the
data-loss fix. See "Still to port" below. The rule binds every *future* queue too.

## Context

Every offline queue in this app drains by POSTing each entry and removing it on
success. The hard question is what to do when the server answers with a 4xx that
retrying cannot fix: a payload it will simply never accept.

The original answer, written into every store, was to **delete the entry**. The
reasoning was sound as far as it went. If the server permanently refuses an entry and
the queue keeps retrying it, that entry jams the line and everything behind it never
syncs. The usual name for this is a poison pill, and dropping it is the crude way to
clear the jam.

It was the wrong trade. On 2026-07-13 a real mileage reimbursement was destroyed by it:
a crew device sent a payload the API refused, got a 422, and the queue deleted the
submission with nothing but a `console.warn`. No error was shown. The odometer photos
existed only on that phone. The crew member filed their mileage, the app went quiet,
and the claim was gone.

That is the whole failure, and it is worth being precise about why it is severe:

- **The work exists nowhere else.** Photos taken in the field, on one phone, with no
  copy anywhere. Deleting the queue entry is the destruction of the only copy.
- **It is silent.** Not a failed submission the crew member can refile. A submission
  they believe they made.
- **A server-side change can trigger it retroactively.** Tighten validation on an
  endpoint and every queued entry that no longer passes is destroyed on the next drain,
  across every device, with no signal.

A stuck queue is an annoyance somebody can see and fix. Destroyed field work is
invisible and permanent. We optimised for the wrong one.

## Decision

**A queue entry is never deleted because the server refused it. It is only ever deleted
by an explicit human action.**

A permanent 4xx marks the entry `failed` and leaves it in the queue, with the reason.
The crew member sees it, in their own list, with what went wrong and a way to act.

The poison-pill problem is still solved, just not by destroying anything: a failed entry
is **skipped by the drain**. It steps out of the line rather than blocking it, and it
does not re-post a payload the server is known to refuse. It waits on a person, because
a person is what it actually needs.

## The pattern (copy this)

The reference implementation is `frontend/src/lib/reimbursementStore.ts`. Five pieces:

1. **Widen the entry type** with `Partial<QueueFailure>`:
   `{ failed_at: string; failed_status: number; failed_reason: string }`. All optional,
   so entries already sitting on crew phones stay readable and are treated as pending.
   **No IndexedDB version bump**, no new object store: adding optional fields to a
   stored object needs neither, and bumping the shared `crew_app_db` version would drag
   every other store into the migration.
2. **`markFailed()` on a permanent 4xx**, in place of the old `removeFromQueue()`.
   Keep 401 / 403 / 408 as transient, as they already are: an expired token is not a bad
   payload.
3. **Skip failed entries in the drain loop** (`if (entry.failed_at) continue`).
4. **Surface it.** The entry renders with status `failed` ("Not sent", not "Rejected":
   rejected is an admin declining a valid claim, which is different news), the reason in
   words a crew member can act on, an explicit "It is still saved on this phone. Nothing
   has been lost.", and Retry / Delete buttons. **Delete is confirm-gated**, because it
   destroys photos that exist on no other device.
5. **`retryFailed()` clears the mark and re-drains.** It must then re-read the rendered
   rows rather than assume success, or a second rejection reports itself as a successful
   send.

Translate the server's error into the words the form uses. FastAPI's raw
`{detail: [{loc: ["body","odometer_start"], msg: "..."}]}` is not something to put in
front of a crew member on a phone.

## The localStorage variant

`reimbursementStore` is IndexedDB because it carries photo blobs. The plain-localStorage
queues share the pieces in **`frontend/src/lib/queueFailure.ts`**: the `QueueFailure`
type, `isPermanentRejection()` (which is where 401/403/408 are held as *transient*), and
`describeApiError()`. `incidentStore.ts` is the shortest worked example to copy.

One extra trap the localStorage queues have and reimbursements does not: **a stale-entry
pruner.** `jobInventoryQueue.pruneStale()` drops anything older than 14 days. A failed
entry must be exempt, or the queue destroys the crew member's work on a timer instead of
on a 4xx, which is the same outcome by a slower route.

## Still to port

## One classifier (2026-08-11)

There were briefly **two** failure classifiers, and they disagreed:

| | Rule | Used by |
|---|---|---|
| `queueFailure.isPermanentRejection` | denylist: any 4xx except 401/403/408 | the ten ported queues |
| `api/client.isPermanentFailure` | allowlist: 400/404/409/422 only | `jobSetupStore`, `jobChecklistStore` |

So whether a crew member's queued work survived a given error depended on which
store happened to be draining. That is worse than either rule being wrong.

**Neither was right.** The denylist called **429** permanent, so a Google Sheets
rate limit - which this app has real history with - would discard field work. The
allowlist called **413** transient, so an oversized upload would be retried
forever and never get smaller; the backend returns 413 from the body-size
middleware and three upload endpoints, so that is not hypothetical.

Converged to one function, `queueFailure.isPermanentRejection`, keeping the
**denylist shape** and adding 429 to the transient set. Permanent = every 4xx
except 401, 403, 408, 429.

The shape matters as much as the list. An allowlist treats every *unlisted* 4xx
as transient, so the next status nobody thought about silently becomes an
infinite retry loop - which is exactly how 413 got missed. A denylist fails the
other way: an unlisted status is treated as permanent, which is visible (the
crew member sees a failed entry with a reason) rather than silent. Given ADR
0013's whole premise, prefer the failure mode somebody can see.

`api/client.isPermanentFailure` was deleted. Do not add a second classifier; the
one in `queueFailure` is it.

**`jobChecklistStore` ported 2026-08-11.** It was written after the 2026-07-15
sweep and reintroduced the exact pattern this ADR bans: `delete q[k]` on a
permanent 4xx, surfacing nothing. That is the point of the closing line above -
the rule binds every *future* queue, and a queue written later is exactly where
it gets forgotten. It now marks the entry failed, keeps it, skips it in the
drain, rolls back the optimistic status cache, and shows Retry / Discard on the
job card. The failed state renders **outside** the card's collapsed section,
because the card defaults to closed and a rejection nobody opens the card to find
is still silent.

Two things it added that the earlier ports did not have to think about:

- **The optimistic cache can lie even when the queue is honest.** The tick is
  written to the status cache before the request goes out, so keeping the queue
  entry but leaving that write in place still shows the item as done. Both
  rejection paths now roll it back. Any future queue with an optimistic local
  write needs the same.
- **A failed entry is not "pending."** Counting it as pending leaves the unsynced
  indicator permanently lit, which trains crew to ignore it.

**Three more ported the same day**, found while converging the classifiers:

- **`jobSetupStore`** did `dequeue(jobUuid)` on a permanent rejection. This was
  the worst of the four and was in no defect list: a queued job header is
  addresses, crew and shipment details somebody typed in the field, and it was
  being destroyed silently. Now marks and keeps, with
  `failedJobSetups` / `retryFailedJobSetup` / `discardFailedJobSetup`.
- **`bugReportStore`** and **`featureRequestStore`** had no permanent/transient
  split at all - a bare `catch { remaining.push(x) }`. Nothing was lost, but a
  report the server would never accept was re-POSTed on every boot and every
  reconnect, forever, and the person who wrote it was never told. Both now split
  and mark-and-keep.

Every offline queue in the app now honors this ADR. The pattern to copy is
`queueFailure.ts`: `isPermanentRejection`, `failureMark`, `CLEARED_FAILURE`, and
a `& MaybeFailed` on the queued type. A new queue that hand-rolls its own
classifier or its own reason-extraction is how these drifted apart both times.

**Done. All ten queues have been ported** (2026-07-15): `reimbursementStore`,
`incidentStore`, `offJobStore`, `jobInventoryQueue`, then the final six -
`rodsStore`, `materialsStore`, `bolStore`, `ldDayStore`, `officeHoursStore`,
`estimatorQueue`. None deletes on a permanent 4xx; each marks the entry failed,
skips it in the drain, and exposes retry/discard.

Surfacing varies by whether the feature already had a list view: `materialsStore`
(BillCalculator), `officeHoursStore` (Office Hours page), and `reimbursementStore`
show a per-row failed state with Retry/Discard. `estimatorQueue` keeps the item on
screen with a synchronous error and the row's own delete as discard. `rodsStore`,
`ldDayStore`, and `bolStore` have no per-op list view yet, so their failed entries
are kept and retryable via the store API (`failedDays`/`retryFailedDay`, etc.) but
do not yet have a dedicated crew-facing screen - **that surfacing is the remaining
follow-up**, not the data-loss fix, which is done.

**Two structural notes for the next queue:**

- `bolStore` ops are ordered `submit -> sign -> pdf` on one `bol_id`. A failed op
  **blocks the later ops for the same BOL** (a `sign` must not run when the `submit`
  that should have created the row was refused), while independent BOLs still drain.
  Any multi-op queue needs the same dependency guard.
- `estimatorQueue` and `jobInventoryQueue` have a `pruneStale()` that deletes old
  entries. A failed entry is **exempt** from it - ageing field work out on a 14-day
  timer is the same silent loss by a slower route.

**A warning from this ADR's own first week.** It was written on 2026-07-13. The very next
release added three new queues (incidents, off-job hours, job inventory), every one of
them with the banned delete-on-4xx, and the incident queue went further and showed the
crew member a green *"Incident submitted"* over a report it had just destroyed. Nobody
was ignoring this document; it simply did not occur to anyone that a *new* queue was in
scope for a rule phrased as a list of old ones. So: **this rule binds every queue,
including the one you are about to write.** A new queue that deletes on 4xx is not a
queue that has yet to be ported. It is a regression.

## Why it is written down

The delete is the tempting fix, and it will be reached for again. Somebody will find a
queue wedged behind an entry the server keeps refusing, see that the obvious way to
unwedge it is to throw the entry away, and do it. It clears the jam. It looks correct.
The cost lands on a crew member weeks later who never learns why their expense claim
never arrived, and there is no way to reconstruct it.

If a queue is stuck, the entry is evidence. Keep it, show it, and fix the reason it was
refused.
