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
 *   3  Can the cause reasonably be identified?       -> No ends it
 *   4  Site and client conditions?      Yes -> pick one  (+ scope changes)
 *   5  Travel and conditions?           Yes -> pick one
 *   6  Crew and equipment?              Yes -> pick one
 *   7  Anything to add (optional note)
 *
 * WHY STEP 3 EXISTS. Without it, a crew that genuinely cannot say why the day
 * ran long has only two moves: leave everything blank, or pick something that
 * sounds plausible. The first is indistinguishable from not filling the form in;
 * the second puts a fabricated cause into the office's data and is much worse
 * than silence. Step 3 gives "we do not know" somewhere honest to go, and it is
 * stored, so the office can tell the two apart.
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
  type CauseBucket,
  causeForBucket,
  causesFor,
  causesInDirection,
  closeoutSteps,
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
  // Which bucket the crew has said "Yes" to but not yet picked a cause for.
  // Local, not stored: "Yes, but I have not chosen from the list" is a UI moment
  // between two taps, not a fact about the job. Storing it would put a
  // half-answer in the Sheet.
  const [pending, setPending] = useState<CauseBucket | null>(null);
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
            onYes={() =>
              answer(
                // Flipping direction drops causes belonging to the other one, so
                // a "truck broke down" cannot survive into a job that finished
                // early and quietly contradict it.
                { variance_direction: "more", variance_causes: causesInDirection(value.variance_causes, "more") },
                dir != null,
              )
            }
            onNo={() =>
              answer(
                { variance_direction: "less", variance_causes: causesInDirection(value.variance_causes, "less") },
                dir != null,
              )
            }
          />
        </>
      )}

      {step === "identified" && (
        <>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            Can you reasonably identify what caused it?
          </div>
          <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
            If not, say so. A guess is worse than no answer, and "we cannot say"
            is a real answer the office would rather have.
          </div>
          <YesNoRow
            value={value.variance_cause_identified}
            yesLabel="Yes"
            noLabel="No, cannot say"
            onYes={() => answer({ variance_cause_identified: true }, value.variance_cause_identified === true)}
            onNo={() =>
              onChange({ variance_cause_identified: false, variance_causes: [], variance_note: "" })
            }
          />
          {value.variance_cause_identified === false && (
            <div className="small" style={{ color: "var(--muted)", marginTop: 12 }}>
              Recorded as no identifiable cause. Nothing else to answer.
            </div>
          )}
        </>
      )}

      {bucketStep && dir && (
        <>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{bucketStep.question}</div>
          <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
            {bucketStep.hint}
          </div>
          {(() => {
            const chosen = causeForBucket(value.variance_causes, bucketStep.bucket);
            const options = causesFor(bucketStep.bucket, dir);
            return (
              <>
                <YesNoRow
                  value={chosen ? true : null}
                  onYes={() => { /* reveals the dropdown below; no state yet */
                    if (!chosen) onChange({ variance_causes: value.variance_causes });
                    setPending(bucketStep.bucket);
                  }}
                  onNo={() =>
                    onChange({
                      variance_causes: setCauseForBucket(value.variance_causes, bucketStep.bucket, ""),
                    })
                  }
                />
                {(chosen || pending === bucketStep.bucket) && (
                  <div style={{ marginTop: 12 }}>
                    <label className="small" style={{ color: "var(--muted)", display: "block", marginBottom: 6 }}>
                      What was it?
                    </label>
                    <select
                      value={chosen}
                      onChange={(e) =>
                        onChange({
                          variance_causes: setCauseForBucket(
                            value.variance_causes, bucketStep.bucket, e.target.value,
                          ),
                        })
                      }
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
                {showScope && bucketStep.bucket === "site" && chosen && scopeSlot}
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
