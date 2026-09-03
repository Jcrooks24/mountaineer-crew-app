// Close-out vocabularies for the job report: why the job differed from the
// quote, how ready the client was, and what changed on site.
//
// Mirrored on the backend in backend/app/schemas/job_report.py
// (VARIANCE_CAUSES / CLIENT_READINESS / CLIENT_UNREADY_REASONS /
// SCOPE_CHANGE_KINDS). Keep the two in sync - the server validates against its
// copy and rejects a key this file invents on its own.
//
// The stored value is the key, never the label. Labels can be reworded without
// orphaning a year of reports; keys cannot, so retiring one means leaving it
// here (the sheet export falls back to the raw key rather than a blank cell).

/** Which of the three cause questions an option belongs under.
 *
 *  The close-out used to ask one flat "tick every reason that applied" question
 *  over all 13 causes. The office's read of that (2026-08-13) is that the flat
 *  list buries the distinction it actually needs: a job that ran long because
 *  the CLIENT was not ready is a sales/estimating problem, one that ran long
 *  because of the CANYON is nobody's fault, and one that ran long because of
 *  the CREW OR A TRUCK is an operations problem. Same delay, three different
 *  responses, and a single chip list made them look alike.
 *
 *  Splitting the list into three named questions is the whole point of the
 *  redesign, so the bucket is a property of the option rather than something
 *  the UI decides. */
export type CauseBucket = "site" | "environment" | "crew";

export type Option = {
  key: string;
  label: string;
  /** Which half of a two-directional list this belongs to. Drives the section
   *  headers in the pickers so a 14-chip list stays scannable on a phone. */
  group?: "more" | "less";
  /** Which cause question this appears under. Absent on options that are not
   *  variance causes (readiness, scope kinds). */
  bucket?: CauseBucket;
};

/** The three cause questions, in the order they are asked. */
export const CAUSE_BUCKETS: {
  bucket: CauseBucket;
  question: string;
  /** Shown under the question. Concrete on purpose - "environmental factors"
   *  means nothing at a tailgate; "traffic in the canyon" does. */
  hint: string;
}[] = [
  {
    bucket: "site",
    question: "Were on-site conditions or client preparedness different from the expected scope?",
    hint: "What the crew found when they got there, versus what was quoted.",
  },
  {
    bucket: "environment",
    question: "Did travel or conditions on the way contribute?",
    hint: "Traffic, weather, road closures. Things nobody controls.",
  },
  {
    bucket: "crew",
    question: "Did anything with the crew or the equipment contribute?",
    hint: "A late start, a breakdown, something dropped. Answering honestly here is how equipment problems get fixed.",
  },
];

/** Why the job ran differently than estimated. Multi-select.
 *
 *  Both directions. The list used to describe only a job that ran LONG, which
 *  left a crew who finished early with nothing honest to tap - and cost the
 *  office the one signal that tells it an estimate was too high. */
export const VARIANCE_CAUSES: Option[] = [
  // ── Site and client ────────────────────────────────────────────────────────
  { key: "underestimated_volume", label: "More to move than quoted", group: "more", bucket: "site" },
  { key: "access_stairs_carry", label: "Access, stairs or long carry", group: "more", bucket: "site" },
  { key: "client_not_ready", label: "Client not ready", group: "more", bucket: "site" },
  { key: "scope_added_on_site", label: "Scope added on site", group: "more", bucket: "site" },
  { key: "site_other", label: "Something else on site", group: "more", bucket: "site" },
  { key: "overestimated_volume", label: "Less to move than quoted", group: "less", bucket: "site" },
  { key: "easier_access", label: "Easier access than expected", group: "less", bucket: "site" },
  { key: "client_ahead_of_prep", label: "Client further along than expected", group: "less", bucket: "site" },
  { key: "scope_reduced_on_site", label: "Scope reduced on site", group: "less", bucket: "site" },
  { key: "site_other_less", label: "Something else on site", group: "less", bucket: "site" },

  // ── Travel and conditions ──────────────────────────────────────────────────
  // "less" options exist here for a reason: the old list had NONE, so a crew
  // that finished early because the canyon was clear had nothing to pick, and
  // the office lost the signal that its travel allowance is too generous.
  { key: "travel_or_traffic", label: "Traffic or slow travel", group: "more", bucket: "environment" },
  { key: "weather", label: "Weather", group: "more", bucket: "environment" },
  { key: "road_closure_or_detour", label: "Road closure or detour", group: "more", bucket: "environment" },
  { key: "environment_other", label: "Something else on the way", group: "more", bucket: "environment" },
  { key: "travel_clear", label: "Clear roads, faster travel", group: "less", bucket: "environment" },
  { key: "environment_other_less", label: "Something else on the way", group: "less", bucket: "environment" },

  // ── Crew and equipment ─────────────────────────────────────────────────────
  { key: "crew_size_or_skill", label: "Crew size or experience", group: "more", bucket: "crew" },
  { key: "crew_late_start", label: "Late start or someone did not show", group: "more", bucket: "crew" },
  { key: "equipment_failure", label: "Truck or equipment problem", group: "more", bucket: "crew" },
  { key: "damage_or_repack", label: "Something dropped, damaged or repacked", group: "more", bucket: "crew" },
  { key: "crew_other", label: "Something else with the crew or gear", group: "more", bucket: "crew" },
  { key: "crew_faster_than_expected", label: "Crew worked faster than expected", group: "less", bucket: "crew" },
  { key: "crew_other_less", label: "Something else with the crew or gear", group: "less", bucket: "crew" },
];

/** RETIRED FROM THE UI 2026-08-13. Kept for rendering old reports only.
 *
 *  The office's read: "was the client ready when you arrived" duplicated a chip
 *  that already existed under the variance question (`client_not_ready`), so
 *  crews were answering the same thing twice and the two answers could
 *  disagree. Client readiness is now captured once, as an option under the
 *  site-and-client cause question.
 *
 *  The COLUMN and the stored values stay - reports written before this carry
 *  them, the Sheet has a year of them, and deleting the vocabulary would render
 *  those as raw keys. Do not offer these in a picker again without deciding what
 *  happens to the duplicate answer. */
export const CLIENT_READINESS: Option[] = [
  { key: "fully_ready", label: "Fully ready" },
  { key: "mostly_ready", label: "Mostly ready" },
  { key: "partly_ready", label: "Partly ready" },
  { key: "not_ready", label: "Not ready" },
];

/** What specifically was not ready. Multi-select. */
export const CLIENT_UNREADY_REASONS: Option[] = [
  { key: "packing_incomplete", label: "Packing incomplete" },
  { key: "parking_not_reserved", label: "Parking not reserved" },
  { key: "elevator_not_reserved", label: "Elevator not reserved" },
  { key: "access_blocked", label: "Access blocked / clutter" },
  { key: "utilities_off", label: "Utilities off" },
  { key: "pets_or_kids", label: "Pets / kids underfoot" },
  { key: "paperwork_or_payment", label: "Paperwork or payment" },
  { key: "other", label: "Other" },
];

/** One row per thing that changed on site. Multi-select within a row: a single
 *  change is often two of these at once ("client dropped the storage unit and
 *  the second stop"), and splitting that into two rows inflated the count. */
export const SCOPE_CHANGE_KINDS: Option[] = [
  { key: "added_items", label: "Added items", group: "more" },
  { key: "extra_stop", label: "Extra stop", group: "more" },
  { key: "packing_added", label: "Packing added", group: "more" },
  { key: "storage_added", label: "Storage added", group: "more" },
  { key: "disposal_added", label: "Disposal added", group: "more" },
  { key: "address_changed", label: "Address changed", group: "more" },
  { key: "fewer_items", label: "Fewer items", group: "less" },
  { key: "stop_dropped", label: "Stop dropped", group: "less" },
  { key: "packing_not_needed", label: "Packing not needed", group: "less" },
  { key: "storage_not_needed", label: "Storage not needed", group: "less" },
  { key: "client_already_packed", label: "Client already packed", group: "less" },
  { key: "less_volume_than_estimated", label: "Less volume than estimated", group: "less" },
  { key: "other", label: "Other" },
];

// Keys no longer OFFERED, but still stored on old reports. They keep their
// labels forever: the module contract is that a retired key renders as words
// rather than as a raw key or a blank cell, so a year of reports stays readable.
//
// `reduced_scope` was replaced by the specific reduction keys on 2026-07-28.
// `other` was the single catch-all before the 2026-08-13 split into three cause
//   questions. It survives on old reports but is no longer offered, because
//   "other" without a bucket cannot be filed under any of the three questions -
//   which is exactly the ambiguity the split existed to remove. New reports use
//   the per-bucket `*_other` keys instead.
// `client_readiness` / `client_unready` keys are retired from the UI entirely
//   (see CLIENT_READINESS below) but their labels are still needed to render the
//   reports that carry them.
const RETIRED_LABELS: Record<string, string> = {
  reduced_scope: "Reduced scope",
  other: "Other",
};

const ALL_LABELS: Record<string, string> = {
  ...RETIRED_LABELS,
  ...Object.fromEntries(
    [...VARIANCE_CAUSES, ...CLIENT_READINESS, ...CLIENT_UNREADY_REASONS, ...SCOPE_CHANGE_KINDS]
      .map((o) => [o.key, o.label]),
  ),
};

/** Human label for a stored key, falling back to the key itself so a retired
 *  or unrecognised value shows as something rather than as a blank. */
export function closeoutLabel(key: string): string {
  return ALL_LABELS[key] || key;
}

/** Which way a scope change moved the day. `hours` is always a positive
 *  magnitude; this carries the sign. */
export type ScopeDirection = "added" | "saved";

export type ScopeChangeEntry = {
  /** One or more keys from SCOPE_CHANGE_KINDS. */
  kinds: string[];
  direction: ScopeDirection;
  /** Rough hours the change moved the day by, unsigned. Optional: logging that
   *  it happened matters more than pinning a number nobody can estimate at the
   *  tailgate. */
  hours?: number | null;
  note?: string;
};

/** The pre-2026-07-28 shape, still found in localStorage drafts written by a
 *  build the crew member has not refreshed past, and in server responses for
 *  reports saved before the change. */
type LegacyScopeChangeEntry = {
  kind?: string;
  kinds?: unknown;
  direction?: unknown;
  hours?: number | null;
  note?: string;
};

// The only reduction-flavored key that existed before the split, so it is the
// only legacy row that infers a "saved" direction.
const LEGACY_REDUCTION_KINDS = new Set(["reduced_scope"]);

/** Normalize one stored/queued scope change into the current shape.
 *
 *  Called on every read path (draft restore, server load) rather than at the
 *  point of render, so the rest of the component only ever sees `kinds[]`. */
export function normalizeScopeChange(raw: unknown): ScopeChangeEntry {
  const c = (raw || {}) as LegacyScopeChangeEntry;
  const kinds = Array.isArray(c.kinds)
    ? c.kinds.filter((k): k is string => typeof k === "string" && !!k)
    : c.kind
      ? [c.kind]
      : [];
  const direction: ScopeDirection =
    c.direction === "saved" || c.direction === "added"
      ? c.direction
      : kinds.some((k) => LEGACY_REDUCTION_KINDS.has(k))
        ? "saved"
        : "added";
  return {
    kinds,
    direction,
    hours: c.hours ?? null,
    note: c.note || "",
  };
}

export function normalizeScopeChanges(raw: unknown): ScopeChangeEntry[] {
  return Array.isArray(raw) ? raw.map(normalizeScopeChange) : [];
}

/** Normalize the variance answer, which was a single key before 2026-07-28.
 *  Accepts the list, the old bare string, or nothing. */
export function normalizeVarianceCauses(
  causes: unknown,
  legacySingle?: unknown,
): string[] {
  if (Array.isArray(causes)) {
    return causes.filter((c): c is string => typeof c === "string" && !!c);
  }
  return typeof legacySingle === "string" && legacySingle ? [legacySingle] : [];
}

/** Readiness values that mean something went wrong, so the follow-up question
 *  about what was not ready is worth asking.
 *
 *  Only reached by reports saved before 2026-08-13; the question is retired. */
export function readinessNeedsDetail(readiness: string | null): boolean {
  return readiness !== null && readiness !== "" && readiness !== "fully_ready";
}

/** The options offered for one cause question, in one direction.
 *
 *  Direction filtering is what keeps each dropdown to a handful of entries. A
 *  crew that finished EARLY should never be shown "truck broke down" - it is
 *  noise at best and a mis-tap at worst, and a mis-tapped cause is worse than no
 *  cause because it reads as a real signal in the Sheet. */
export function causesFor(bucket: CauseBucket, direction: "more" | "less"): Option[] {
  return VARIANCE_CAUSES.filter((o) => o.bucket === bucket && o.group === direction);
}

/** The two site causes that mean "the job itself changed", as opposed to the
 *  job being harder than quoted.
 *
 *  The scope editor used to open under ANY site cause, so picking "Client not
 *  ready" immediately asked "was anything actually added or dropped?" - the
 *  longest sub-form in the close-out, offered at the moment the crew had just
 *  said the problem was something else. Only these two keys are about scope. */
export const SCOPE_CAUSE_KEYS = new Set(["scope_added_on_site", "scope_reduced_on_site"]);

export function isScopeCause(key: string): boolean {
  return SCOPE_CAUSE_KEYS.has(key);
}

/** How the crew answered one cause question, before they pick from its list.
 *  "yes" with no cause chosen yet is a real UI state and has to be held, or the
 *  Yes press is silently lost when they navigate away. */
export type BucketAnswer = "yes" | "no" | undefined;

/** Whether the crew could name a cause, DERIVED from the three bucket answers
 *  rather than asked as its own question.
 *
 *  It used to be asked first, at step 3, which had two problems. It asked the
 *  crew to commit before they had seen a single option, which nobody can answer
 *  honestly; and nothing ever recomputed it, so answering "Yes I can identify
 *  it" and then No to all three buckets stored `identified = true` with an empty
 *  cause list. The office read "Cause identified: Yes" beside a blank Reasons
 *  column - a claim the data did not support.
 *
 *  Derived, the three answers cannot contradict the summary of themselves:
 *    any cause chosen        -> true
 *    all three answered No   -> false  ("we looked and cannot say", a real finding)
 *    anything else           -> null   (not finished answering) */
export function deriveCauseIdentified(
  causes: string[],
  answers: Record<string, BucketAnswer>,
): boolean | null {
  if (CAUSE_BUCKETS.some((b) => causeForBucket(causes, b.bucket))) return true;
  if (CAUSE_BUCKETS.every((b) => answers[b.bucket] === "no")) return false;
  return null;
}

/** Rebuild the per-bucket answers from what was stored, so re-opening a report
 *  shows the crew what they actually said.
 *
 *  A stored `false` means every bucket was answered No - that is the only way it
 *  can be false now - so all three are reconstructed. A stored cause means that
 *  bucket was a Yes. A bucket answered No while others are still unanswered has
 *  nowhere to be stored and comes back blank; see Known defects. */
export function bucketAnswersFrom(
  causes: string[],
  identified: boolean | null,
): Record<string, BucketAnswer> {
  const out: Record<string, BucketAnswer> = {};
  for (const b of CAUSE_BUCKETS) {
    if (causeForBucket(causes, b.bucket)) out[b.bucket] = "yes";
    else if (identified === false) out[b.bucket] = "no";
  }
  return out;
}

/** The cause currently chosen for one bucket, or "" if that question has not
 *  been answered yes. At most one per bucket: these are single-select
 *  dropdowns, so a second key for the same bucket means stale data from the old
 *  multi-select and the first is taken. */
export function causeForBucket(causes: string[], bucket: CauseBucket): string {
  const inBucket = causes.filter(
    (k) => VARIANCE_CAUSES.find((o) => o.key === k)?.bucket === bucket,
  );
  return inBucket[0] || "";
}

/** Replace this bucket's cause, leaving the other two buckets untouched.
 *
 *  Pass "" to clear (the crew answered No). Written as a pure function over the
 *  stored array so the three questions can share one `variance_causes` field
 *  rather than needing three new columns - which also means every report ever
 *  saved still reads back correctly. */
export function setCauseForBucket(
  causes: string[],
  bucket: CauseBucket,
  key: string,
): string[] {
  const others = causes.filter(
    (k) => VARIANCE_CAUSES.find((o) => o.key === k)?.bucket !== bucket,
  );
  return key ? [...others, key] : others;
}

/** Drop any cause that belongs to the other direction.
 *
 *  Called when the crew flips longer/shorter, so an answer given under "ran
 *  longer" cannot survive into a "ran shorter" report and quietly contradict
 *  it. Keys with no direction (retired ones on an old report) are kept. */
export function causesInDirection(causes: string[], direction: "more" | "less"): string[] {
  return causes.filter((k) => {
    const o = VARIANCE_CAUSES.find((x) => x.key === k);
    return !o?.group || o.group === direction;
  });
}

/** Infer the direction from stored causes, for a report saved before direction
 *  was persisted. Returns null when nothing can be inferred - which is honest,
 *  and better than the previous behaviour of defaulting to "longer" and showing
 *  the office a direction nobody entered. */
export function inferDirection(causes: string[]): "more" | "less" | null {
  for (const k of causes) {
    const g = VARIANCE_CAUSES.find((o) => o.key === k)?.group;
    if (g === "more" || g === "less") return g;
  }
  return null;
}

/** Which close-out steps apply given the answers so far.
 *
 *  Recomputed on every change, because answering "No" at step 1 or 3 genuinely
 *  removes later steps rather than skipping past them - a progress dot for a
 *  question that will never be asked is a lie about how much is left.
 *
 *  `saidDiffered` is the crew having tapped "Yes, it differed" WITHOUT having
 *  chosen a direction yet. It has to be a separate argument because there is no
 *  stored value for that state: `variance_direction` is null (unanswered),
 *  "as_quoted", "more" or "less", and inventing a fifth would put a half-answer
 *  in the Sheet. Without it, tapping Yes produced a one-step list and step 2 was
 *  unreachable, so the whole close-out was dead below question 1 (reported from
 *  the field 2026-08-18: "did not allow me to click yes it differed").
 *
 *  Lives here rather than in CloseoutStepper.tsx so it can be exercised
 *  directly by verify_closeout.mjs. The version inside the component was only
 *  ever checked by grepping its source, which is how a regex kept passing over
 *  a flow no crew member could complete. */
export function closeoutSteps(
  value: { variance_direction: string | null; variance_cause_identified: boolean | null },
  saidDiffered: boolean,
): string[] {
  const steps = ["ran"];
  const differed =
    saidDiffered ||
    (!!value.variance_direction && value.variance_direction !== "as_quoted");
  if (!differed) return steps;
  steps.push("direction");
  // The three cause questions follow the direction directly. There used to be a
  // "can you reasonably identify what caused it?" gate here; it is now DERIVED
  // from the three answers instead (see deriveCauseIdentified), because asking
  // it up front made the crew commit before seeing any option, and because
  // nothing recomputed it afterwards so it could end up asserting a cause that
  // the three answers had since contradicted.
  //
  // `variance_cause_identified` is still read on the value for callers and for
  // old reports; it no longer decides which steps exist.
  return [...steps, ...CAUSE_BUCKETS.map((b) => `cause:${b.bucket}`), "note"];
}
