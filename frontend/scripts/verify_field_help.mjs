/**
 * Field help on the job setup form (2026-09-03).
 * `node scripts/verify_field_help.mjs`
 *
 * WHY THIS EXISTS. A help text has to agree in FOUR places: the `HelpTexts`
 * type, `DEFAULT_HELP_TEXTS`, the field that renders it, and the hardcoded
 * `groups` array in the Admin editor. Nothing links them, and tsc only catches
 * one of the four pairings. The realistic failures are silent:
 *
 *   - a key defined and rendered but missing from the Admin groups: the office
 *     cannot reword it, and cannot switch it off, and nothing says why;
 *   - a field wired to a key that has no default: the "?" never appears, so the
 *     field looks like it simply has no help;
 *   - a field on the form that nobody wired at all, which is the whole
 *     complaint that prompted this ("the LD workflow is confusing").
 *
 * It also holds the two invariants a reviewer would otherwise have to remember:
 * the three-second timer the user asked for, and no em dashes.
 *
 * This canNOT verify the interaction: there is no jsdom or test runner in this
 * project, and the Chrome tools are off limits here. Tapping a title and seeing
 * it close after three seconds needs a human on a phone.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..").split("\\").join("/");
const fails = [];
const check = (n, c, d = "") => {
  console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${!c && d ? `   ${d}` : ""}`);
  if (!c) fails.push(n);
};

const theme = readFileSync(`${ROOT}/frontend/src/theme/ThemeContext.tsx`, "utf8");
const panel = readFileSync(`${ROOT}/frontend/src/components/JobSetupPanel.tsx`, "utf8");
const admin = readFileSync(`${ROOT}/frontend/src/pages/Admin.tsx`, "utf8");
const comp = readFileSync(`${ROOT}/frontend/src/components/FieldHelp.tsx`, "utf8");

// ── the four sources of truth ───────────────────────────────────────────────
const iface = theme.match(/export interface HelpTexts \{([\s\S]*?)\n\}/);
const typeKeys = new Set([...(iface?.[1] || "").matchAll(/^\s*(\w+):\s*string;/gm)].map((m) => m[1]));

const defaults = theme.match(/export const DEFAULT_HELP_TEXTS: HelpTexts = \{([\s\S]*?)\n\};/);
const defaultKeys = new Set([...(defaults?.[1] || "").matchAll(/^\s*(\w+):\s*['"`]/gm)].map((m) => m[1]));

const usedKeys = [...panel.matchAll(/help=\{ht\.(\w+)\}/g)].map((m) => m[1]);
const adminKeys = new Set([...admin.matchAll(/\{\s*key:\s*"(\w+)"/g)].map((m) => m[1]));

check("HelpTexts type parsed", typeKeys.size > 0, `${typeKeys.size}`);
check("DEFAULT_HELP_TEXTS parsed", defaultKeys.size > 0, `${defaultKeys.size}`);
check("the panel wires at least 20 field titles", usedKeys.length >= 20, `${usedKeys.length}`);

// ── every key agrees everywhere ─────────────────────────────────────────────
const missingDefault = usedKeys.filter((k) => !defaultKeys.has(k));
check("every key the panel renders has a default", missingDefault.length === 0, missingDefault.join(", "));

const missingType = usedKeys.filter((k) => !typeKeys.has(k));
check("every key the panel renders is in the type", missingType.length === 0, missingType.join(", "));

const notEditable = usedKeys.filter((k) => !adminKeys.has(k));
check("every key the panel renders is editable in Admin", notEditable.length === 0, notEditable.join(", "));

const typeVsDefault = [...typeKeys].filter((k) => !defaultKeys.has(k));
check("no declared key is missing its default", typeVsDefault.length === 0, typeVsDefault.join(", "));

const dupes = usedKeys.filter((k, i) => usedKeys.indexOf(k) !== i);
check("no key is wired to two different fields", dupes.length === 0, dupes.join(", "));

// ── no field on the form was left unwired ───────────────────────────────────
// Any remaining bare muted-span title inside the setup form is a field that
// still has no help, which is the failure this whole change is about.
const bareTitles = [...panel.matchAll(
  /<span className="small" style=\{\{ color: "var\(--muted\)"(?:, fontWeight: 700)? \}\}>([A-Z][^<{]{2,40})<\/span>/g,
)].map((m) => m[1].trim());
// Section headings and inline status text are not fields and are listed here on
// purpose, so a NEW bare title shows up as a failure rather than growing the list.
const NOT_FIELDS = new Set([
  "Bill of Lading details",
  "Fill once; the crew's Bill of Lading for this job starts prefilled with these.",
  "No crew yet. Add them below.",
  "No units configured.",
  "No job types configured.",
  "Not set up yet",
]);
const unwired = bareTitles.filter((t) => !NOT_FIELDS.has(t));
check("no field title on the setup form was left without help", unwired.length === 0,
  `unwired: ${JSON.stringify(unwired)}`);

// ── the behaviour the user specified ────────────────────────────────────────
check("help closes after 3 seconds", /HELP_VISIBLE_MS\s*=\s*3000/.test(comp));
check("the timer is cleared on unmount", /useEffect\(\(\) => clear, \[\]\)/.test(comp));
check("the timer is cleared before a re-tap starts a new one", /clear\(\);\s*\n\s*setOpen\(\(was\)/.test(comp));
check("the tap does not focus the wrapped input (preventDefault)", /e\.preventDefault\(\)/.test(comp));
check("no help text means no affordance", /if \(!text\) return title;/.test(comp));

// ── house rules ─────────────────────────────────────────────────────────────
check("FieldHelp uses theme vars, no hardcoded hex", !/#[0-9a-fA-F]{3,6}\b/.test(comp),
  (comp.match(/#[0-9a-fA-F]{3,6}\b/g) || []).join(", "));

// Both quote styles: two existing entries are single-quoted, and a check that
// silently skips entries is worse than no check.
const helpValues = [...(defaults?.[1] || "").matchAll(
  /^\s*\w+:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/gm,
)].map((m) => m[1] ?? m[2] ?? "");
check("the em-dash check reads every default", helpValues.length === defaultKeys.size,
  `${helpValues.length} values vs ${defaultKeys.size} keys`);
const withEmDash = helpValues.filter((v) => v.includes("\u2014"));
check("no em dashes in any help text", withEmDash.length === 0, withEmDash.join(" | "));

console.log();
console.log(`  (${usedKeys.length} field titles wired)`);
if (fails.length) {
  console.log("FAILURES: " + fails.join(", "));
  process.exit(1);
}
console.log("all checks passed");
