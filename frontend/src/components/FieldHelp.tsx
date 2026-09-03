import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * A field title that reveals its help text when tapped, then closes itself.
 *
 * WHY IT IS BUILT THIS WAY. The job setup panel has ~20 fields, several of them
 * legal (valuation, estimate type, additional carriers) where a wrong answer
 * prints onto a signed Bill of Lading. Crews reported the interstate workflow as
 * confusing, but showing twenty paragraphs of guidance permanently would bury the
 * form itself on a phone, which trades one confusion for another. So the help is
 * there for whoever wants it and invisible to whoever does not.
 *
 * Three details that are load-bearing rather than decorative:
 *
 * 1. `e.preventDefault()` on the tap. These titles sit INSIDE a wrapping
 *    `<label>`, whose activation behaviour forwards a click to the labelled
 *    control. Without this, reading the help for a text field also focuses it and
 *    throws up the phone keyboard over the help you just asked for.
 *
 * 2. The timer is cleared on unmount AND on every re-tap. A stray timeout that
 *    outlives the panel is the standard React leak, and re-tapping without
 *    clearing leaves the first timer running so the text closes early.
 *
 * 3. No help text configured means NO affordance and no tap target. An admin can
 *    blank any of these from Admin > Help text, and a "?" that opens an empty box
 *    is worse than no "?" at all.
 */

/** How long the help stays up. Deliberately short: this is a reminder, not
 *  documentation, and a crew member who needs longer can tap it again. */
export const HELP_VISIBLE_MS = 3000;

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
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  // Unmount cleanup. Switching jobs unmounts this panel, and a pending timeout
  // would then fire setState on a dead component.
  useEffect(() => clear, []);

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

  const toggle = (e: React.MouseEvent | React.KeyboardEvent) => {
    // See note 1 above: without this the wrapping <label> also focuses the input.
    e.preventDefault();
    e.stopPropagation();
    clear();
    setOpen((was) => {
      if (was) return false;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setOpen(false);
      }, HELP_VISIBLE_MS);
      return true;
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title="Tap for help with this field"
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
      {open && (
        <div
          role="status"
          onClick={(e) => { e.preventDefault(); clear(); setOpen(false); }}
          className="small"
          style={{
            color: "var(--text)",
            background: "var(--surface2, var(--bg))",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "6px 8px",
            marginTop: 2,
            marginBottom: 2,
            cursor: "pointer",
          }}
        >
          {text}
        </div>
      )}
    </>
  );
}

export default FieldHelp;
