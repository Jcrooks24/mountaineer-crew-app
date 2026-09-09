/**
 * Bill of Lading field help: which fields have it, what it says, how long it stays.
 * `node scripts/verify_field_help.mjs`
 *
 * WHY THIS EXISTS. A help text has to agree in FOUR places: the `HelpTexts`
 * type, `DEFAULT_HELP_TEXTS`, the field that renders it, and the hardcoded
 * `groups` array in the Admin editor. Nothing links them and tsc catches only
 * one of the four pairings, so the failures are silent - a key the office cannot
 * reword, or a field whose "?" never appears because its default is missing.
 *
 * REWRITTEN 2026-09-09, and the change is worth knowing about. The first version
 * asserted that NO field title was left without help, because the complaint that
 * prompted the feature was "the interstate workflow is confusing". That was the
 * wrong target: help on "Crew" and "Origin" is noise, and a "?" on an obvious
 * field teaches people the "?" is not worth tapping - so they stop tapping it on
 * Valuation, which is the one that decides what a customer is owed for a broken
 * television. The invariant is now the opposite: help exists on EXACTLY the
 * fields that need it, and that list is asserted here.
 *
 * It cannot verify the interaction. There is no jsdom or test runner in this
 * project and the Chrome tools are off limits, so "tap the title, a toast
 * appears, the bar drains, it goes" needs a human on a phone.
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
const toast = readFileSync(`${ROOT}/frontend/src/components/Toast.tsx`, "utf8");

// The fields the office said need explaining, and no others (2026-09-09).
const EXPECTED = [
  "bolShipperNameHelp",
  "bolFormOfPaymentHelp",
  "bolCodNotifyHelp",
  "bolCodMaxHelp",
  "bolEstimateTypeHelp",
  "bolValuationHelp",
  "bolAdditionalCarriersHelp",
  "bolThirdPartyInsuranceHelp",
  "bolAccessorialServicesHelp",
];

const iface = theme.match(/export interface HelpTexts \{([\s\S]*?)\n\}/);
const typeKeys = new Set([...(iface?.[1] || "").matchAll(/^\s*(\w+):\s*string;/gm)].map((m) => m[1]));
const defaults = theme.match(/export const DEFAULT_HELP_TEXTS: HelpTexts = \{([\s\S]*?)\n\};/);
const defaultKeys = new Set([...(defaults?.[1] || "").matchAll(/^\s*(\w+):\s*['"`]/gm)].map((m) => m[1]));
const usedKeys = [...panel.matchAll(/help=\{ht\.(\w+)\}/g)].map((m) => m[1]);
const adminKeys = new Set([...admin.matchAll(/\{\s*key:\s*"(\w+)"/g)].map((m) => m[1]));

console.log("Help exists on exactly the fields that need it:");
check("the panel wires precisely the expected set",
  JSON.stringify([...usedKeys].sort()) === JSON.stringify([...EXPECTED].sort()),
  `wired: ${JSON.stringify([...usedKeys].sort())}`);
const strays = [...typeKeys].filter((k) => k.endsWith("Help") && !EXPECTED.includes(k));
check("no retired help key is still declared", strays.length === 0,
  `still in HelpTexts: ${strays.join(", ")} - a key nobody renders is a row in the Admin editor that does nothing`);

console.log("\nEvery key agrees across all four places:");
for (const k of EXPECTED) {
  check(`${k}`,
    typeKeys.has(k) && defaultKeys.has(k) && usedKeys.includes(k) && adminKeys.has(k),
    `type=${typeKeys.has(k)} default=${defaultKeys.has(k)} panel=${usedKeys.includes(k)} admin=${adminKeys.has(k)}`);
}
const dupes = usedKeys.filter((k, i) => usedKeys.indexOf(k) !== i);
check("no key is wired to two different fields", dupes.length === 0, dupes.join(", "));

// -- the timing the office asked for -----------------------------------------
console.log("\nThe toast stays up long enough to actually read:");
// Mirrors readingTimeMs exactly, and is asserted by EXERCISE rather than by a
// regex on the formula: a regex passes just as happily on a formula that
// computes the wrong number.
const ms = (t) => 3000 + Math.floor(t.trim().split(/\s+/).filter(Boolean).length / 10) * 3000;
check("readingTimeMs is 3s + 3s per 10 words",
  /return 3000 \+ Math\.floor\(words \/ 10\) \* 3000;/.test(toast));
check("a short text gets the 3s minimum", ms("Four words only here") === 3000);
check("ten words earns the first extra 3s", ms("one two three four five six seven eight nine ten") === 6000);
check("nine words does not", ms("one two three four five six seven eight nine") === 3000);
check("thirty words gets 12s", ms(Array(30).fill("w").join(" ")) === 12000);

console.log("\nWhat the real texts work out to:");
// BOTH quote styles. Two of the older defaults are single-quoted, and a check
// that silently skips entries is worse than no check - which is exactly what
// happened when this was rewritten and briefly read only 23 of 25 keys. The
// count assertion at the bottom is what caught it, so it earns its place.
const values = Object.fromEntries([...(defaults?.[1] || "").matchAll(
  /^\s*(\w+):\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/gm,
)].map((m) => [m[1], (m[2] ?? m[3] ?? "").replace(/\\"/g, '"')]));
for (const k of EXPECTED) {
  const v = values[k] || "";
  const words = v.trim().split(/\s+/).filter(Boolean).length;
  console.log(`    ${String(ms(v) / 1000).padStart(2)}s  ${String(words).padStart(3)} words  ${k}`);
}
check("every expected key has a non-empty default",
  EXPECTED.every((k) => (values[k] || "").trim().length > 0),
  EXPECTED.filter((k) => !(values[k] || "").trim()).join(", "));
// A toast nobody can dismiss that sits there for most of a minute is its own
// problem, whatever the progress bar says.
const longest = Math.max(...EXPECTED.map((k) => ms(values[k] || "")));
check("no help text is up for more than 30 seconds", longest <= 30000, `${longest / 1000}s`);

console.log("\nIt is a toast, with a visible reason it has not closed:");
check("FieldHelp renders a Toast, not an inline reveal", /<Toast/.test(comp));
check("the inline open/close state is gone", !/HELP_VISIBLE_MS/.test(comp));
check("its duration is readingTimeMs of the text shown",
  /durationMs=\{msg \? readingTimeMs\(msg\.text\) : undefined\}/.test(comp));
check("the progress bar is switched on", /showProgress/.test(comp));
check("the bar is driven by the SAME duration as the timer",
  /transition: `width \$\{ms\}ms linear`/.test(toast),
  "a bar on its own timer would promise a moment the toast does not honour");
check("prose is left-aligned, not centred like a confirmation", /align="left"/.test(comp));
check("a re-tap restarts the timer with the new text", /seq\.current \+= 1;/.test(comp));
check("the tap does not focus the wrapped input (preventDefault)", /e\.preventDefault\(\)/.test(comp));
check("no help text means no affordance", /if \(!text\) return title;/.test(comp));

console.log("\nPlain language: an acronym is spelled out where it is used:");
// The office's point: some crew are new to moving. A term nobody explains is
// the same as no help at all.
const ACRONYMS = [["COD", "Collect on delivery"], ["DOT", "DOT number"]];
for (const [short, long] of ACRONYMS) {
  const users = EXPECTED.filter((k) => new RegExp(`\\b${short}\\b`).test(values[k] || ""));
  for (const k of users) {
    check(`${k} explains "${short}"`, (values[k] || "").includes(long),
      `uses "${short}" without "${long}"`);
  }
}
check("the valuation text says what released value actually pays",
  /60 cents per pound/.test(values.bolValuationHelp || "")
  && /\$6/.test(values.bolValuationHelp || ""),
  "a worked example is the difference between understanding it and not");

console.log("\nHouse rules:");
check("FieldHelp uses theme vars, no hardcoded hex", !/#[0-9a-fA-F]{3,6}\b/.test(comp),
  (comp.match(/#[0-9a-fA-F]{3,6}\b/g) || []).join(", "));
check("the em-dash check reads every default",
  Object.keys(values).length === defaultKeys.size,
  `${Object.keys(values).length} values vs ${defaultKeys.size} keys`);
const withEmDash = Object.entries(values).filter(([, v]) => v.includes("\u2014"));
check("no em dashes in any help text", withEmDash.length === 0,
  withEmDash.map(([k]) => k).join(", "));

console.log();
if (fails.length) {
  console.log("FAILURES: " + fails.join(", "));
  process.exit(1);
}
console.log("all checks passed");
