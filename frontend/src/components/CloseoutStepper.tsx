/**
 * Close-out, as a stepper instead of a scroll.
 *
 * THE REDESIGN (office feedback, 2026-08-13). The old close-out was three
 * independent questions down a long page, and two of them asked the same thing
 * twice: "was the client ready when you arrived" duplicated the
 * `client_not_ready` chip under the variance question, and "anything added or
 * changed on site" duplicated `scope_added_on_site`. A crew member could answer
 * the pair inconsistently and both answers went to the office as fact.
 *
 * What replaces it is one line of questioning that narrows:
 *
 *   1  Did the job run differently than quoted?      -> No ends it
 *   2  Which way, longer or shorter?
 *   3  Site and client conditions?      Yes -> pick one  (+ scope changes)
 *   4  Travel and conditions?           Yes -> pick one
 *   5  Crew and equipment?              Yes -> pick one
 *   6  Anything to add (optional note)
 *
 * "CAN YOU IDENTIFY THE CAUSE?" IS DERIVED, NOT ASKED (2026-09-03). It used to
 * be its own question in front of the three below. That is still a fact the
 * office needs - a crew who genuinely cannot say why the day ran long must have
 * somewhere honest to go, or they leave the form blank (indistinguishable from
 * not filling it in) or invent a plausible cause (worse than silence). But
 * asking it FIRST made the crew commit before they had seen a single option,
 * and nothing recomputed it afterwards, so "Yes I can identify it" followed by
 * No to all three questions stored `identified = true` with an empty cause list
 * and the office read a claim the data did not support.
 *
 * Three Nos IS "we cannot say", so it is computed from the three answers
 * instead (`deriveCauseIdentified`). Same stored field, same tri-state in the
 * Sheet, and it can no longer contradict the answers it summarises.
 *
 * WHY THREE CAUSE QUESTIONS. Same delay, three different responses: a client who
 * was not ready is an estimating problem, the canyon is nobody's problem, and a
 * leaking lift gate is a maintenance ticket. One flat chip list made them look
 * alike. See CAUSE_BUCKETS in lib/closeout.ts.
 *
 * SINGLE-SELECT PER BUCKET, and this is a real narrowing from the old
 * multi-select. The office chose it: one dropdown answers "what was the cause"
 * where a multi-select answers "what were all the contributing factors", and
 * only the first is countable. The optional note on step 7 is where a day with
 * two site problems gets described.
 *
 * NOTHING HERE GATES SAVE. Every answer is optional, on purpose - a crew member
 * at 8pm who cannot face the questions must still be able to file their hours.
 * The stepper is a shape for the questions, not a wall in front of the report.
 */

import { useMemo, useState } from "react";

import {
  CAUSE_BUCKETS,
  type BucketAnswer,
  bucketAnswersFrom,
  causeForBucket,
  causesFor,
  causesInDirection,
  closeoutSteps,
  deriveCauseIdentified,
  isScopeCause,
  setCauseForBucket,
} from "../lib/closeout";

export type CloseoutValue = {
  /** null = unanswered, "as_quoted" = ran as quoted, "more"/"less" = differed. */
  variance_direction: string | null;
  /** null = unanswered. false = the crew looked and cannot name a cause. */
  variance_cause_identified: boolean | null;
  variance_causes: string[];
  variance_note: string;
};

type Props = {
  value: CloseoutValue;
  onChange: (patch: Partial<CloseoutValue>) => void;
  /** Rendered inside step 4 when a site cause is chosen. Keeps the scope-change
   *  editor where its trigger is, without this component knowing its shape. */
  scopeSlot?: React.ReactNode;
  /** True when a site cause has been picked, so the caller can decide whether
   *  its slot is worth rendering. */
  showScope?: boolean;
};

function Dots({ total, at }: { total: number; at: number }) {
  return (
    <div className="row" style={{ gap: 5, alignItems: "center" }} aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          style={{
            width: i === at ? 18 : 7, height: 7, borderRadius: 999,
            background: i <= at ? "var(--brand)" : "var(--border)",
            transition: "width 120ms, background 120ms",
          }}
        />
      ))}
    </div>
  );
}

function YesNoRow({
  value, onYes, onNo, yesLabel = "Yes", noLabel = "No",
}: {
  value: boolean | null;
  onYes: () => void;
  onNo: () => void;
  yesLabel?: string;
  noLabel?: string;
}) {
  return (
    <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
      {([[true, yesLabel, onYes], [false, noLabel, onNo]] as const).map(([v, label, fn]) => {
        const on = value === v;
        return (
          <button
            key={String(v)}
            type="button"
            aria-pressed={on}
            onClick={fn}
            style={{
              // 44px min height: this is tapped on a phone, in a driveway,
              // often in gloves.
              minHeight: 44, padding: "10px 20px", borderRadius: 10, fontSize: 15,
              fontWeight: on ? 700 : 500, cursor: "pointer", flex: "1 1 120px",
              border: `1px solid ${on ? "var(--brand)" : "var(--border)"}`,
              background: on ? "var(--brand)" : "transparent",
              color: on ? "var(--on-brand)" : "var(--text)",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function CloseoutStepper({ value, onChange, scopeSlot, showScope }: Props) {
  // "Yes, it differed" before a direction is chosen. Local for the same reason
  // as `pending` below: the stored vocabulary is null / as_quoted / more / less,
  // and there is no value in it for "differed, direction unknown". Writing one
  // would put a half-answer in the Sheet; not holding it at all is the bug this
  // replaced, where tapping Yes wrote null over null and the card sat there
  // looking like the button was dead (reported from the field, 2026-08-18).
  const [differed, setDiffered] = useState(false);
  const steps = useMemo(() => closeoutSteps(value, differed), [value, differed]);
  const [at, setAt] = useState(0);
  // How the crew answered each of the three cause questions.
  //
  // ONE record rather than the previous `pending` (a single bucket the crew had
  // said Yes to) plus `bucketNo`. `pending` held only one bucket at a time, so
  // saying Yes to a second question silently un-pressed the first, and a Yes
  // with no cause picked yet was never reflected in the buttons at all.
  //
  // Seeded from what was stored, so re-opening a report shows what the crew
  // actually said: a stored cause is a Yes, and a stored `identified === false`
  // means all three were answered No, which is now the only way it can be false.
  const [bucketAnswers, setBucketAnswers] = useState<Record<string, BucketAnswer>>(
    () => bucketAnswersFrom(value.variance_causes, value.variance_cause_identified),
  );
  // Clamp rather than reset: answering "No" at step 1 shortens the list, and an
  // index past the end would blank the card.
  const idx = Math.min(at, steps.length - 1);
  const step = steps[idx];
  const dir = value.variance_direction === "more" || value.variance_direction === "less"
    ? value.variance_direction
    : null;

  const go = (n: number) => setAt(Math.max(0, Math.min(n, steps.length - 1)));

  // Deferred by a beat so the button's pressed state is visible before the card
  // changes under the thumb.
  //
  // Deliberately not cleaned up on unmount, which a teardown audit will flag.
  // It is a single 120 ms timeout, not an interval, and the two ways it can
  // land late are both already handled: React 18 makes a setState on an
  // unmounted component a no-op, and if the answer changed in those 120 ms and
  // SHORTENED the step list (tap Yes, then No), `idx` clamps to the last real
  // step rather than blanking the card. A ref and an effect to cancel it would
  // be ceremony around a case that already resolves correctly.
  const advance = () => setTimeout(() => setAt((a) => a + 1), 120);

  /** Answering a question advances. Changing an ALREADY answered question does
   *  not, so a crew member correcting a mis-tap is not thrown forward again. */
  const answer = (patch: Partial<CloseoutValue>, wasAnswered: boolean) => {
    onChange(patch);
    if (!wasAnswered) advance();
  };

  /** Set longer/shorter, dropping causes that belong to the other direction so a
   *  "truck broke down" cannot survive into a job that finished early and
   *  quietly contradict it.
   *
   *  The derived flag is recomputed against what SURVIVES. Without that, flipping
   *  direction could strip every cause and leave `identified` still saying Yes,
   *  which is the same contradiction the derivation was introduced to remove -
   *  reintroduced through a different door. */
  const flipDirection = (next: "more" | "less") => {
    const kept = causesInDirection(value.variance_causes, next);
    answer(
      {
        variance_direction: next,
        variance_causes: kept,
        variance_cause_identified: deriveCauseIdentified(kept, bucketAnswers),
      },
      dir != null,
    );
  };

  const bucketStep = step.startsWith("cause:")
    ? CAUSE_BUCKETS.find((b) => `cause:${b.bucket}` === step)
    : null;

  return (
    <div
      style={{
        border: "1px solid var(--border)", borderRadius: 12,
        padding: "var(--space-card)",
        background: "var(--surface, transparent)",
      }}
    >
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="small" style={{ color: "var(--muted)", fontWeight: 700 }}>
          Step {idx + 1} of {steps.length}
        </span>
        <Dots total={steps.length} at={idx} />
      </div>

      {step === "ran" && (
        <>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            Did the job run differently than quoted?
          </div>
          <YesNoRow
            value={
              value.variance_direction === "as_quoted" ? false
                : differed || dir != null ? true
                : null
            }
            yesLabel="Yes, it differed"
            noLabel="No, as quoted"
            onYes={() => {
              const wasAnswered = differed || dir != null;
              // Yes lives only in local state - it is not a storable answer on
              // its own, and step 2 is what turns it into "more" or "less".
              setDiffered(true);
              // Coming back from "as quoted", the stored No has to be retracted
              // or the next step would open on top of a contradicting answer.
              if (value.variance_direction === "as_quoted") {
                onChange({ variance_direction: null });
              }
              if (!wasAnswered) advance();
            }}
            onNo={() => {
              setDiffered(false);
              // The three cause answers are retracted too. They are local state,
              // so without this they survive a "No, as quoted" invisibly: the
              // rows would come back pre-answered if the crew changed their mind,
              // and the first bucket they then touched would derive "cannot say"
              // from three answers they had not given this time round.
              setBucketAnswers({});
              onChange({
                variance_direction: "as_quoted",
                // Answering No retracts everything downstream. Leaving a stale
                // cause attached to a job the crew just said ran as quoted would
                // put a contradiction in the Sheet.
                variance_cause_identified: null,
                variance_causes: [],
                variance_note: "",
              });
            }}
          />
          {value.variance_direction === "as_quoted" && (
            <div className="small" style={{ color: "var(--muted)", marginTop: 12 }}>
              Nothing else to answer here. Thanks.
            </div>
          )}
        </>
      )}

      {step === "direction" && (
        <>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Which way?</div>
          <YesNoRow
            value={dir == null ? null : dir === "more"}
            yesLabel="Ran longer"
            noLabel="Ran shorter"
            onYes={() => flipDirection("more")}
            onNo={() => flipDirection("less")}
          />
        </>
      )}

      {bucketStep && !dir && (
        <>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{bucketStep.question}</div>
          <div className="small" style={{ color: "var(--muted)", marginTop: 8 }}>
            Go back one step and say whether the job ran longer or shorter first.
            The causes offered here depend on which way it went.
          </div>
        </>
      )}

      {bucketStep && dir && (
        <>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{bucketStep.question}</div>
          <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
            {bucketStep.hint}
          </div>
          {(() => {
            const bucket = bucketStep.bucket;
            const chosen = causeForBucket(value.variance_causes, bucket);
            const options = causesFor(bucket, dir);
            const answered = bucketAnswers[bucket];

            /** Record one bucket's answer and recompute the derived
             *  "could the crew name a cause" flag from all three, so the summary
             *  can never contradict the answers it summarises. */
            const apply = (answer: BucketAnswer, causeKey: string | null) => {
              const nextAnswers = { ...bucketAnswers, [bucket]: answer };
              const nextCauses = causeKey === null
                ? value.variance_causes
                : setCauseForBucket(value.variance_causes, bucket, causeKey);
              setBucketAnswers(nextAnswers);
              onChange({
                variance_causes: nextCauses,
                variance_cause_identified: deriveCauseIdentified(nextCauses, nextAnswers),
              });
            };

            return (
              <>
                <YesNoRow
                  // A Yes with no cause picked yet still reads as Yes. It used to
                  // read as unanswered, so the press vanished the moment the crew
                  // looked at another question.
                  value={chosen || answered === "yes" ? true : answered === "no" ? false : null}
                  onYes={() => apply("yes", null)}
                  onNo={() => {
                    apply("no", "");
                    // Answering moves on, the same as every other question in the
                    // stepper. The three cause questions used to be the only ones
                    // that did not, which read as another stuck button.
                    advance();
                  }}
                />
                {(chosen || answered === "yes") && (
                  <div style={{ marginTop: 12 }}>
                    <label className="small" style={{ color: "var(--muted)", display: "block", marginBottom: 6 }}>
                      What was it?
                    </label>
                    <select
                      value={chosen}
                      onChange={(e) => {
                        const key = e.target.value;
                        apply("yes", key);
                        // Picking a cause finishes this question, so move on -
                        // UNLESS it opens the scope editor just below, which the
                        // crew would never see if the card advanced out from
                        // under it.
                        if (key && !(showScope && bucket === "site" && isScopeCause(key))) {
                          advance();
                        }
                      }}
                      // 16px or iOS zooms the whole page on focus.
                      style={{ width: "100%", minHeight: 44, fontSize: 16 }}
                    >
                      <option value="">Choose one...</option>
                      {options.map((o) => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                {/* Only the two causes that actually mean the job CHANGED. It
                    used to open under any site cause, so "Client not ready" was
                    answered with "was anything added or dropped?". */}
                {showScope && bucket === "site" && isScopeCause(chosen) && scopeSlot}
              </>
            );
          })()}
        </>
      )}

      {step === "note" && (
        <>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Anything to add?</div>
          <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
            Optional, and the only place specifics fit. "Lift gate hydraulics
            started leaking" is a maintenance ticket; "Equipment problem" on its
            own is not.
          </div>
          {value.variance_cause_identified === false && (
            <div className="small" style={{ color: "var(--muted)", marginTop: 8, fontStyle: "italic" }}>
              Recorded as no identifiable cause, since none of the three
              questions applied. That is a real answer and the office would
              rather have it than a guess. Anything you can add below still helps.
            </div>
          )}
          <textarea
            value={value.variance_note}
            onChange={(e) => onChange({ variance_note: e.target.value })}
            rows={3}
            placeholder="What actually happened?"
            style={{ width: "100%", marginTop: 10, resize: "vertical", fontSize: 16 }}
          />
        </>
      )}

      <div className="row" style={{ justifyContent: "space-between", marginTop: 16, gap: 8 }}>
        <button
          type="button"
          onClick={() => go(idx - 1)}
          disabled={idx === 0}
          style={{
            minHeight: 40, padding: "8px 16px", borderRadius: 8, fontSize: 14,
            border: "1px solid var(--border)", background: "transparent",
            color: idx === 0 ? "var(--muted)" : "var(--text)",
            opacity: idx === 0 ? 0.4 : 1, cursor: idx === 0 ? "default" : "pointer",
          }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => go(idx + 1)}
          disabled={idx >= steps.length - 1}
          style={{
            minHeight: 40, padding: "8px 16px", borderRadius: 8, fontSize: 14,
            border: "1px solid var(--border)", background: "transparent",
            color: idx >= steps.length - 1 ? "var(--muted)" : "var(--text)",
            opacity: idx >= steps.length - 1 ? 0.4 : 1,
            cursor: idx >= steps.length - 1 ? "default" : "pointer",
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
