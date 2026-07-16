import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Text input with a rendered suggestion list.
 *
 * This exists because of a real field bug: every item-name box used a native
 * <datalist>, and on iOS and Android a datalist REPLACES the keyboard's
 * autocorrect / autocapitalise strip with its own suggestion row. So a crew
 * member typing "dreser" on a phone got no correction and no capital letter, and
 * the item went into the inventory misspelled. The two features are mutually
 * exclusive in a native datalist; you cannot have both.
 *
 * So the suggestions are rendered by us instead of by the browser. The input goes
 * back to being an ordinary text field, which means the phone keyboard does its
 * normal job (autocorrect, autocapitalise, spellcheck are all explicitly ON
 * below), and the catalog typeahead still works.
 *
 * Deliberately NOT a combobox that forces a choice: crew must be able to log an
 * item that is not in the catalog. Suggestions help, they do not gate.
 */
export default function SuggestInput({
  value,
  onChange,
  options,
  placeholder,
  onEnter,
  maxSuggestions = 8,
  style,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  /** Fired on Enter when no suggestion is highlighted (e.g. "add the item"). */
  onEnter?: () => void;
  maxSuggestions?: number;
  style?: React.CSSProperties;
  inputMode?: "text" | "search";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const blurTimer = useRef<number | null>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    const starts: string[] = [];
    const contains: string[] = [];
    for (const o of options) {
      const lo = o.toLowerCase();
      if (lo === q) continue; // already typed exactly; nothing to suggest
      if (lo.startsWith(q)) starts.push(o);
      else if (lo.includes(q)) contains.push(o);
      if (starts.length >= maxSuggestions) break;
    }
    return [...starts, ...contains].slice(0, maxSuggestions);
  }, [value, options, maxSuggestions]);

  // Reset the highlight whenever the match set changes, or the highlighted index
  // can point at a different item than the one under the user's finger.
  useEffect(() => { setActive(-1); }, [value]);

  useEffect(() => () => {
    if (blurTimer.current) window.clearTimeout(blurTimer.current);
  }, []);

  const show = open && matches.length > 0;

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        // The whole point: let the phone keyboard behave like a phone keyboard.
        autoCorrect="on"
        autoCapitalize="sentences"
        spellCheck
        // "off" would be a lie to the browser and, on some engines, re-suppresses
        // the correction strip. There is no site-wide autofill for item names.
        autoComplete="off"
        inputMode={inputMode}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay: a tap on a suggestion fires blur BEFORE click, so closing
          // immediately would swallow the selection.
          blurTimer.current = window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && matches.length) {
            e.preventDefault();
            setOpen(true);
            setActive((i) => (i + 1) % matches.length);
          } else if (e.key === "ArrowUp" && matches.length) {
            e.preventDefault();
            setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
          } else if (e.key === "Enter") {
            if (show && active >= 0) {
              e.preventDefault();
              pick(matches[active]);
            } else if (onEnter) {
              e.preventDefault();
              setOpen(false);
              onEnter();
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        style={style}
      />
      {show && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 30,
            marginTop: 2,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 6px 20px rgba(0,0,0,0.28)",
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {matches.map((m, i) => (
            <button
              key={m}
              type="button"
              // onMouseDown, not onClick: mousedown beats the input's blur, so the
              // pick lands even if the blur timer is short.
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}
              onMouseEnter={() => setActive(i)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                // 44px: a real finger target in a truck.
                minHeight: 44,
                fontSize: 15,
                border: "none",
                borderBottom: i === matches.length - 1 ? "none" : "1px solid var(--border)",
                background: i === active ? "var(--card2)" : "transparent",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
