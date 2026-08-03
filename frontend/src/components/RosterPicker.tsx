import { useEffect, useMemo, useRef, useState } from "react";
import type { DirectoryEntry } from "../auth/AuthContext";
import {
  currentDirectory,
  ensureDirectory,
  subscribeDirectory,
} from "../lib/userDirectory";

/**
 * Pick a crew member from the roster. Selection only, no free text.
 *
 * Employee hours are the input to payroll and to the worked-hours summary, and
 * those join on the person. When the name was a free-text box, "Jake", "Jacob",
 * and "Jacob Crooks" were three different people as far as the data was
 * concerned, and hours quietly went missing from somebody's total with nothing
 * on screen to say so. So the row now carries the roster `user_id` as its key and
 * the name only for display, and the only way to produce a row is to choose a
 * real person.
 *
 * A native <select> on purpose: it is one tap to the OS picker on a phone, it
 * cannot produce a value that is not on the list, and it needs no dropdown of our
 * own to get right in a truck.
 *
 * `legacyName` handles the rows that already exist. A report written before this
 * change has a name and no id, and possibly a name nobody on the roster has. It
 * stays selectable and saveable, so editing an old report does not force the crew
 * to re-key somebody else's row, but it renders as "not on roster" so it is
 * visibly the odd one out rather than silently equivalent.
 */
export default function RosterPicker({
  userId,
  legacyName,
  onChange,
  disabled,
  style,
}: {
  userId: number | null;
  legacyName?: string;
  onChange: (userId: number | null, name: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const [roster, setRoster] = useState<DirectoryEntry[]>(() => currentDirectory());

  useEffect(() => {
    // Cached-first: the store seeds from localStorage, so an offline launch has a
    // usable roster immediately and this fetch is a background revalidate.
    ensureDirectory().catch(() => { /* offline - the cached roster stands */ });
    return subscribeDirectory(() => setRoster(currentDirectory()));
  }, []);

  const sorted = [...roster].sort((a, b) =>
    (a.name || a.email).localeCompare(b.name || b.email),
  );
  const showLegacy = !!legacyName && userId == null;

  // The roster has never loaded on this device. Say so plainly rather than
  // rendering an empty picker that reads as "there is nobody to choose".
  if (sorted.length === 0) {
    return (
      <div
        className="small"
        style={{
          border: "1px dashed var(--danger)",
          borderRadius: 8,
          padding: "8px 10px",
          color: "var(--muted)",
        }}
      >
        <strong style={{ color: "var(--danger)" }}>Crew roster not loaded.</strong>{" "}
        Connect to the internet once and reopen this tab. Hours have to be logged
        against a real crew member, so there is nothing to pick from until it loads.
      </div>
    );
  }

  return <SearchableRoster
    sorted={sorted}
    userId={userId}
    showLegacy={showLegacy}
    legacyName={legacyName}
    onChange={onChange}
    disabled={disabled}
    style={style}
  />;
}

/** Search-as-you-type picker. Still selection-only: typing filters the roster,
 * but the row's user_id is only set by CLICKING a real person - free text never
 * commits, preserving the id-keyed invariant above. Replaces a native <select>
 * that made you scroll dozens of names in a truck. */
function SearchableRoster({
  sorted, userId, showLegacy, legacyName, onChange, disabled, style,
}: {
  sorted: DirectoryEntry[];
  userId: number | null;
  showLegacy: boolean;
  legacyName?: string;
  onChange: (userId: number | null, name: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const selected = userId != null ? sorted.find((u) => u.id === userId) : undefined;
  const selectedLabel = selected
    ? (selected.name || selected.email)
    : showLegacy ? `${legacyName} (not on roster)` : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (u) => (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q),
    );
  }, [query, sorted]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={boxRef} style={{ position: "relative", ...style }}>
      <input
        type="text"
        value={open ? query : selectedLabel}
        placeholder="Search crew member…"
        disabled={disabled}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        style={{
          width: "100%", padding: "10px 12px", borderRadius: 10,
          border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)",
          // 16px or iOS zooms the page on focus. See index.css.
          fontSize: 16, boxSizing: "border-box",
        }}
      />
      {open && !disabled && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
          background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10,
          maxHeight: 264, overflowY: "auto", boxShadow: "var(--shadow)",
        }}>
          {filtered.length === 0 ? (
            <div className="small" style={{ padding: "10px 12px", color: "var(--muted)" }}>No match.</div>
          ) : filtered.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => { onChange(u.id, (u.name || u.email).trim()); setOpen(false); setQuery(""); }}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
                minHeight: 44, background: u.id === userId ? "var(--card2)" : "transparent",
                border: "none", borderBottom: "1px solid var(--border)", color: "var(--text)",
                cursor: "pointer", fontSize: 15,
              }}
            >
              {u.name || u.email}
              {u.name && u.email ? <span className="small" style={{ color: "var(--muted)" }}> · {u.email}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
