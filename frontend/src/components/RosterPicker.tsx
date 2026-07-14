import { useEffect, useState } from "react";
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

  return (
    <select
      value={userId != null ? String(userId) : showLegacy ? "__legacy__" : ""}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "" || v === "__legacy__") return; // keep whatever is set
        const id = Number(v);
        const hit = sorted.find((u) => u.id === id);
        if (hit) onChange(id, (hit.name || hit.email).trim());
      }}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--bg)",
        color: "var(--text)",
        // 16px or iOS zooms the page on focus. See index.css.
        fontSize: 16,
        boxSizing: "border-box",
        ...style,
      }}
    >
      <option value="" disabled>
        Select crew member…
      </option>
      {showLegacy && (
        <option value="__legacy__">{legacyName} (not on roster)</option>
      )}
      {sorted.map((u) => (
        <option key={u.id} value={String(u.id)}>
          {u.name || u.email}
        </option>
      ))}
    </select>
  );
}
