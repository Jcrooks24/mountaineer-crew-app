import { useEffect, useId, useState } from "react";
import type { DirectoryEntry } from "../auth/AuthContext";
import {
  currentDirectory,
  ensureDirectory,
  subscribeDirectory,
} from "../lib/userDirectory";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  /** Names to omit from suggestions (already-listed drivers, etc.). */
  exclude?: string[];
};

/**
 * Freeform text input backed by <datalist> suggestions from the crew
 * roster. Native typeahead works on iOS, Android, and desktop. Any
 * string the user types is accepted, so custom names still submit if
 * the driver isn't in the roster.
 */
export default function RosterTypeahead({
  value, onChange, placeholder, style, className, autoFocus, onBlur, exclude,
}: Props) {
  const listId = useId();
  const [dir, setDir] = useState<DirectoryEntry[]>(() => currentDirectory());
  useEffect(() => {
    let live = true;
    ensureDirectory().then((d) => { if (live) setDir(d); }).catch(() => {});
    const unsub = subscribeDirectory(() => { if (live) setDir(currentDirectory()); });
    return () => { live = false; unsub(); };
  }, []);

  const skip = new Set((exclude || []).map((n) => n.trim().toLowerCase()));
  const names = Array.from(
    new Set(
      dir
        .map((d) => (d.name || "").trim())
        .filter((n) => n && !skip.has(n.toLowerCase())),
    ),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <>
      <input
        type="text"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        style={style}
        className={className}
        autoFocus={autoFocus}
        autoComplete="off"
      />
      <datalist id={listId}>
        {names.map((n) => <option key={n} value={n} />)}
      </datalist>
    </>
  );
}
