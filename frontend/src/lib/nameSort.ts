/**
 * Sort people by LAST name.
 *
 * Mirrored on the backend in `app/core/name_sort.py`. The two must agree, or
 * payroll (sorted server-side) and the roster (sorted client-side) will order
 * the same people differently and it will read as a bug in one of them. Change
 * both together.
 */

// Stripped from the END of a name before picking the surname, so "John Smith Jr."
// files under Smith rather than under J. Matched case-insensitively with any
// trailing dot removed, so "jr", "Jr" and "Jr." all match.
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "md", "phd", "dds", "esq"]);

export type SurnameKey = { last: string; rest: string };

/**
 * The surname is the last whitespace-separated token after suffixes are removed.
 * That is wrong for some compound surnames ("van der Berg" files under Berg),
 * and deliberately so: guessing particles introduces its own errors, and the
 * real alternative is a separate surname field on the user record, which is a
 * bigger change than this. Noted rather than silently accepted.
 */
export function surnameKey(name?: string | null, fallback?: string | null): SurnameKey {
  const raw = (name ?? "").trim();
  if (!raw) {
    // No name at all: fall back to the email so the row lands somewhere
    // predictable instead of moving between reloads.
    return { last: (fallback ?? "").trim().toLowerCase(), rest: "" };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  // Drop trailing suffixes, but never the only token - "Jr" alone is a name.
  while (parts.length > 1 && SUFFIXES.has(parts[parts.length - 1].replace(/\.+$/, "").toLowerCase())) {
    parts.pop();
  }
  return {
    last: parts[parts.length - 1].toLowerCase(),
    rest: parts.slice(0, -1).join(" ").toLowerCase(),
  };
}

/** Compare two people by surname, then by the rest of the name. */
export function compareBySurname(
  a: { name?: string | null; email?: string | null },
  b: { name?: string | null; email?: string | null },
): number {
  const ka = surnameKey(a.name, a.email);
  const kb = surnameKey(b.name, b.email);
  return ka.last.localeCompare(kb.last) || ka.rest.localeCompare(kb.rest);
}

/**
 * Roster order: active people first, alphabetically by surname, then inactive
 * people in the same order.
 *
 * Inactive accounts used to be mixed in with active ones, so the list of people
 * who actually work here was interrupted by people who do not. Grouping them
 * keeps the working roster readable without hiding anyone.
 */
export function compareRoster(
  a: { name?: string | null; email?: string | null; is_active?: boolean },
  b: { name?: string | null; email?: string | null; is_active?: boolean },
): number {
  const aa = a.is_active === false ? 1 : 0;
  const bb = b.is_active === false ? 1 : 0;
  if (aa !== bb) return aa - bb;
  return compareBySurname(a, b);
}
