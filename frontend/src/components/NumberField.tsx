import { useEffect, useRef, useState } from "react";

/**
 * A numeric input you can actually clear and retype.
 *
 * The bug this exists to kill: a controlled `<input type="number">` whose
 * onChange coerces straight back into state, e.g.
 *
 *     value={it.qty}
 *     onChange={(e) => update({ qty: Math.max(1, Number(e.target.value || 1)) })}
 *
 * Clearing the box makes `e.target.value` an empty string, which coerces to the
 * default and is immediately re-rendered into the field. The field is never
 * empty, so on a phone the caret sits after the stuck digit and the crew member
 * types `2` into a field showing `1` and gets `12`. It reads as a value that
 * refuses to be changed, and it has come back more than once because the fix was
 * always applied to one input rather than to the pattern.
 *
 * The fix is to separate what is DISPLAYED from what is STORED:
 *
 * - While the field has focus, the raw text the user typed is what renders,
 *   including the empty string. Nothing is coerced back into the box.
 * - The stored value is only updated when the text parses to a real number, and
 *   it is clamped on the way through, so callers never see a value outside
 *   [min, max] and never see NaN.
 * - An empty box does not write anything. The last good value stands until the
 *   user types a new one (or, with `allowEmpty`, `onEmpty` fires so the caller
 *   can clear an optional field).
 * - On blur the text is normalized back to the stored value, so a half-typed
 *   `-` or `.` or an out-of-range number tidies itself up when the user leaves.
 *
 * Use this for every numeric field rather than hand-rolling the coercion.
 */

type Props = {
  value: number | null | undefined;
  /** Fired only with a valid, clamped number. Never with NaN. */
  onChange: (next: number) => void;
  /** Allow the field to be left empty. Without it, clearing keeps the last value. */
  allowEmpty?: boolean;
  /** Called when the field is left empty and `allowEmpty` is set. */
  onEmpty?: () => void;
  min?: number;
  max?: number;
  step?: number;
  /** Round to whole numbers on commit. Counts should set this. */
  integer?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  "aria-label"?: string;
  id?: string;
};

export function display(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? "" : String(value);
}

export type Bounds = {
  min?: number;
  max?: number;
  integer?: boolean;
  allowEmpty?: boolean;
};

export function clampTo(n: number, { min, max, integer }: Bounds): number {
  let out = integer ? Math.round(n) : n;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

/** What a keystroke does. `text` is always what the box should show next -
 *  never a coerced value, which is the entire point. `commit` is the number to
 *  store (absent means leave the stored value alone); `clear` asks the caller to
 *  blank an optional field.
 *
 *  Split out as a pure function so the behaviour is testable without a DOM. */
export function onInput(raw: string, bounds: Bounds):
  { text: string; commit?: number; clear?: boolean } {
  if (raw.trim() === "") {
    // Empty is a legitimate intermediate state: the crew member is retyping.
    // Writing a default back here is the bug this component exists to fix.
    return bounds.allowEmpty ? { text: raw, clear: true } : { text: raw };
  }
  const parsed = Number(raw);
  // Not a number yet ("-", "1e", "."). Keep showing what they typed.
  if (!Number.isFinite(parsed)) return { text: raw };
  return { text: raw, commit: clampTo(parsed, bounds) };
}

/** What leaving the field does: tidy the text back to the stored value, and
 *  commit a correction if the typed number was out of bounds. */
export function onLeave(text: string, value: number | null | undefined, bounds: Bounds):
  { text: string; commit?: number } {
  if (text.trim() === "") {
    return { text: bounds.allowEmpty ? "" : display(value) };
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { text: display(value) };
  const settled = clampTo(parsed, bounds);
  return settled === value
    ? { text: display(settled) }
    : { text: display(settled), commit: settled };
}

export default function NumberField({
  value,
  onChange,
  allowEmpty = false,
  onEmpty,
  min,
  max,
  step,
  integer = false,
  placeholder,
  disabled,
  className,
  style,
  id,
  "aria-label": ariaLabel,
}: Props) {
  const [text, setText] = useState(() => display(value));
  const focused = useRef(false);

  // Track the value while the field is idle, so a +/- button, a reset, or a
  // value loaded from the server shows up. Skipped while focused: overwriting
  // the box mid-keystroke is the whole bug.
  useEffect(() => {
    if (!focused.current) setText(display(value));
  }, [value]);

  const bounds: Bounds = { min, max, integer, allowEmpty };

  return (
    <input
      id={id}
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      style={style}
      aria-label={ariaLabel}
      value={text}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => {
        const next = onInput(e.target.value, bounds);
        setText(next.text);
        if (next.clear) onEmpty?.();
        else if (next.commit !== undefined) onChange(next.commit);
      }}
      onBlur={() => {
        focused.current = false;
        const next = onLeave(text, value, bounds);
        setText(next.text);
        if (next.commit !== undefined) onChange(next.commit);
      }}
    />
  );
}
