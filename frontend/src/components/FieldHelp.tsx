import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Toast, readingTimeMs, type ToastMessage } from "./Toast";

/**
 * A field title that explains itself when tapped.
 *
 * WHY IT IS BUILT THIS WAY. The job setup panel asks for things a crew member
 * may never have met - released-value liability, accessorial services, a binding
 * estimate - and several of them print onto a signed Bill of Lading, where a
 * wrong answer is a legal document with the wrong terms on it. Showing all that
 * guidance permanently would bury the form itself on a phone. So it is there for
 * whoever wants it and invisible to whoever does not.
 *
 * IT IS A TOAST, NOT AN INLINE REVEAL (changed 2026-09-09). The help used to
 * open a box under the field title, which pushed the rest of the form down the
 * screen the moment you tapped it - so the field you were asking about moved
 * while you were reading about it, and on a long form the answer could open
 * off-screen. A toast sits in one predictable place at the bottom, over the
 * form rather than inside it, and nothing reflows.
 *
 * HOW LONG IT STAYS is `readingTimeMs`: three seconds, plus three more for every
 * ten words. A fixed timeout that suits "Crew" is far too short for the
 * valuation explanation, which is the one people most need to finish reading.
 *
 * Three details that are load-bearing rather than decorative:
 *
 * 1. `e.preventDefault()` on the tap. These titles sit INSIDE a wrapping
 *    `<label>`, whose activation behaviour forwards a click to the labelled
 *    control. Without this, reading the help for a text field also focuses it and
 *    throws up the phone keyboard over the help you just asked for.
 *
 * 2. The toast carries a progress bar, because it has no close button. Without
 *    something visibly moving, a crew member cannot tell "this will go away in a
 *    moment" from "this is stuck and the app is broken" - and the longer the
 *    text, the longer they are left wondering. Tapping it dismisses early, which
 *    is the existing Toast behaviour and worth keeping, but nobody should have
 *    to discover that to know the app is working.
 *
 * 3. No help text configured means NO affordance and no tap target. An admin can
 *    blank any of these from Admin > Help text, and a "?" that opens an empty box
 *    is worse than no "?" at all.
 */

export function FieldHelp({
  label,
  help,
  bold = false,
  style,
}: {
  label: string;
  /** From `useTheme().settings.helpTexts`. Empty or missing renders a plain title. */
  help?: string;
  bold?: boolean;
  style?: CSSProperties;
}) {
  const [msg, setMsg] = useState<ToastMessage | null>(null);
  // A counter, not a boolean: tapping a second "?" while the first toast is up
  // must restart the timer with the new text. Toast keys its effect on the id,
  // so re-using one would leave the new message inheriting the old one's
  // remaining time and vanishing early.
  const seq = useRef(0);

  // A toast outliving its panel would setState on a dead component. Switching
  // jobs unmounts this, and the longest help text is up for the best part of a
  // minute, so this is a real window rather than a theoretical one.
  useEffect(() => () => setMsg(null), []);

  const text = (help || "").trim();

  const title = (
    <span
      className="small"
      style={{ color: "var(--muted)", fontWeight: bold ? 700 : undefined, ...style }}
    >
      {label}
    </span>
  );

  if (!text) return title;

  const open = (e: React.MouseEvent | React.KeyboardEvent) => {
    // See note 1 above: without this the wrapping <label> also focuses the input.
    e.preventDefault();
    e.stopPropagation();
    seq.current += 1;
    setMsg({ id: seq.current, text });
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        title="Tap for help with this field"
        aria-label={`What is ${label}?`}
        style={{
          // Reset the button back to looking like the label it replaces. Only
          // the dotted underline and the "?" say it can be tapped.
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          // Comfortably tappable without changing the form's rhythm.
          minHeight: 24,
        }}
      >
        <span
          className="small"
          style={{
            color: "var(--muted)",
            fontWeight: bold ? 700 : undefined,
            borderBottom: "1px dotted var(--border)",
            ...style,
          }}
        >
          {label}
        </span>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 14,
            height: 14,
            borderRadius: "50%",
            border: "1px solid var(--border)",
            color: "var(--muted)",
            fontSize: 9,
            lineHeight: 1,
            flex: "0 0 auto",
          }}
        >
          ?
        </span>
      </button>

      {/* Left-aligned: this is prose, not a one-line confirmation. The duration
          and the progress bar are driven by the same readingTimeMs value, so the
          bar cannot promise a different moment than the timer delivers. */}
      <Toast
        message={msg}
        onDone={() => setMsg(null)}
        durationMs={msg ? readingTimeMs(msg.text) : undefined}
        align="left"
        showProgress
      />
    </>
  );
}

export default FieldHelp;
