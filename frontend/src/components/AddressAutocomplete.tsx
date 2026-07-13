import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api/client";

// Address typeahead over /api/routing/address-suggest (Google Places).
//
// Degrades to a plain text input on every failure path - offline, no maps key,
// Places API not enabled. Crew can always just type the address, so a lookup
// that can't answer stays silent rather than surfacing an error in the field.
type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
};

export default function AddressAutocomplete({ value, onChange, placeholder, style }: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  // Suppresses the lookup that would otherwise fire from the onChange of a
  // suggestion click (which would just re-suggest the address we just picked).
  const skipNextRef = useRef(false);

  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }

    // Debounce: crew are thumb-typing on a phone, and each upstream call is
    // billed. 300ms after they stop is soon enough to feel instant.
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const r = await apiFetch<{ ok: boolean; suggestions: string[] }>(
          `/api/routing/address-suggest?q=${encodeURIComponent(q)}`,
        );
        if (cancelled) return;
        setSuggestions(r.ok ? r.suggestions || [] : []);
        setOpen(true);
      } catch {
        if (!cancelled) setSuggestions([]); // offline - plain text field
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [value]);

  function pick(s: string) {
    skipNextRef.current = true;
    onChange(s);
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        // Delay the close so a tap on a suggestion lands before the list
        // unmounts (blur fires first on touch).
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        style={style}
      />
      {open && suggestions.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 20,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
            boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
          }}
        >
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              // onMouseDown, not onClick: blur would otherwise close the list
              // before the click resolves.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                border: "none",
                borderBottom: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
