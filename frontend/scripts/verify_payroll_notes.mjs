/**
 * The payroll note is saved provably, carries across periods, and archives.
 * `node scripts/verify_payroll_notes.mjs`
 *
 * THE BRIEF was "important info would live here so it is very important the text
 * is saved". That makes the interesting failures the quiet ones - the ways an
 * autosave loses work while looking like it is working:
 *
 *   - reporting SAVED on having sent the request rather than on the server
 *     confirming it. An indicator that reports the attempt is worse than none,
 *     because it gets trusted;
 *   - a debounce that dies with the component, losing the last thing typed on
 *     the way out of the page;
 *   - a load that lets the server copy silently overwrite local text whose save
 *     never landed;
 *   - a failed save that is swallowed, so the office believes it is written down.
 *
 * Each of those is asserted below. Also asserted: finalizing ARCHIVES the note
 * without clearing it, because the office said the field must keep its contents
 * and a snapshot must reach the Sheet.
 *
 * Cannot verify the typing or the rendering: no jsdom or test runner here, and
 * the Chrome tools are off limits.
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

const notes = readFileSync(`${ROOT}/frontend/src/components/PayrollNotes.tsx`, "utf8");
const tool = readFileSync(`${ROOT}/frontend/src/components/PayrollTool.tsx`, "utf8");
const api = readFileSync(`${ROOT}/backend/app/routers/payroll.py`, "utf8");
const sheets = readFileSync(`${ROOT}/backend/app/integrations/sheets_export.py`, "utf8");
const model = readFileSync(`${ROOT}/backend/app/db/models/payroll_run.py`, "utf8");

console.log("It sits above the table and is not tied to a period:");
check("PayrollTool renders it", /<PayrollNotes \/>/.test(tool));
check("above the period picker, since it carries across periods",
  tool.indexOf("<PayrollNotes />") < tool.indexOf("Period picker"));
check("the server stores ONE note, not one per period",
  /PAYROLL_NOTES_KEY = "payroll_notes"/.test(api)
  && !/payroll_notes:.*period/.test(api));

console.log("\nSAVED means the server confirmed it, not that we asked:");
check("the confirmed value comes from the RESPONSE",
  /confirmed\.current = r\?\.notes \?\? v;/.test(notes),
  "setting it from the local value would call a failed save a success");
check("status is saved only after that assignment",
  notes.indexOf('confirmed.current = r?.notes') < notes.indexOf('setStatus("saved")'));
check("and any later edit reads as unsaved again",
  /const dirty = loaded && text !== confirmed\.current;/.test(notes));

console.log("\nNothing typed is lost on the way out:");
check("a local mirror is written on every keystroke",
  /mirror\(v\);/.test(notes) && /localStorage\.setItem\(NOTES_MIRROR_KEY/.test(notes));
check("a pending save is flushed on pagehide", /addEventListener\("pagehide", flush\)/.test(notes));
check("and on tab switch", /addEventListener\("visibilitychange", flush\)/.test(notes));
check("and on unmount, not just cancelled",
  /return \(\) => \{[\s\S]{0,240}?flush\(\);\s*\};/.test(notes),
  "a debounce cancelled on unmount is how the last sentence gets lost");
check("blur saves immediately rather than waiting out the debounce",
  /onBlur=\{\(\) => \{ if \(text !== confirmed\.current\) void push\(text\); \}\}/.test(notes));

console.log("\nA local copy that never reached the server is not overwritten:");
check("a differing mirror wins on load", /if \(local && local !== server\)/.test(notes));
check("and the office is told, with a retry",
  /never reached the server/.test(notes) && /Save now/.test(notes));
check("a failed save is surfaced, never swallowed",
  /setStatus\("error"\)/.test(notes) && !/catch \{\s*\}/.test(notes));

console.log("\nFormatting is markdown, so the archive stays readable:");
check("bold wraps in asterisks", /\$\{before\}\*\*\$\{body\}\*\*\$\{after\}/.test(notes));
check("bullets prefix with a dash", /l\.startsWith\("- "\) \? l : `- \$\{l\}`/.test(notes));
check("no rich-text editor was pulled in", !/contentEditable|dangerouslySetInnerHTML/.test(notes),
  "markup would archive into a Sheet cell as noise or be lost");

console.log("\nFinalizing archives it WITHOUT clearing it:");
check("the run stores a snapshot", /notes_snapshot/.test(model));
check("taken at finalize", /payroll_run\.notes_snapshot = _get_payroll_notes\(db\)/.test(api));
check("the field is NOT cleared afterwards",
  !/PAYROLL_NOTES_KEY[\s\S]{0,200}?=\s*""/.test(api.slice(api.indexOf("payroll_run.notes_snapshot"))),
  "the office asked that finalizing leave the text in place");
check("the snapshot, not the live note, is what publishes",
  /"notes": run\.notes_snapshot or ""/.test(api),
  "re-reading the live note later would rewrite history on a backfill re-drive");
check("and it reaches the Sheet as a column on the run",
  /"notes",/.test(sheets) && /"notes": run\.get\("notes"\) or ""/.test(sheets));

console.log("\nGuards:");
check("the endpoints are admin-only",
  /@router\.get\("\/notes"\)[\s\S]{0,220}?require_admin/.test(api)
  && /@router\.put\("\/notes"\)[\s\S]{0,260}?require_admin/.test(api));
check("an absurd paste is refused before it reaches a Sheet cell",
  /limited to 20,000 characters/.test(api),
  "Sheets caps a cell at 50k and the archive writes this into one");

console.log();
if (fails.length) {
  console.log("FAILURES: " + fails.join(", "));
  process.exit(1);
}
console.log("all checks passed");
