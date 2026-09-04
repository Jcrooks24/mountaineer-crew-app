/**
 * PTO is office-only, on the client too (request 1a50fa5b).
 * `node scripts/verify_pto_ui.mjs`
 *
 * WHY THIS EXISTS. The backend refuses crew PTO and filters it out of every
 * crew-facing read (backend/scripts/test_pto.py covers that). This is the other
 * half: the client must not OFFER it. A crew-facing screen that shows a PTO
 * option produces a 403 the crew member cannot act on and cannot understand, and
 * one that renders a balance leaks a number they are not meant to see.
 *
 * The realistic way this breaks is somebody adding "pto" to the Off Job page's
 * pay-structure picker because it is in the backend's PAY_STRUCTURES set and
 * looks like an oversight. So the assertion is on the crew screens: no mention.
 *
 * Cannot verify rendering or taps: no jsdom or test runner here, and the Chrome
 * tools are off limits.
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

const offJob = readFileSync(`${ROOT}/frontend/src/pages/OffJob.tsx`, "utf8");
const payroll = readFileSync(`${ROOT}/frontend/src/components/PayrollTool.tsx`, "utf8");
const admin = readFileSync(`${ROOT}/frontend/src/pages/Admin.tsx`, "utf8");

console.log("CREW SCREENS MUST NOT MENTION PTO:");
// Word-boundary, case-insensitive: "pto" as a token, not inside another word.
const ptoToken = /\bpto\b/i;
check("the crew Off Job page has no PTO anywhere", !ptoToken.test(offJob),
  (offJob.match(/.{0,40}\bpto\b.{0,40}/i) || [])[0]);
check("and does not call the PTO endpoints", !/pto-balance|off-job\/pto/.test(offJob));

console.log("\nThe office CAN record it, from the payroll screen:");
check("payroll has a PTO panel", /function PtoSection\(/.test(payroll));
check("it is rendered on the employee row", /<PtoSection /.test(payroll));
check("it posts to the ADMIN endpoint",
  /apiFetch\("\/api\/admin\/off-job\/pto"/.test(payroll));
check("it reads the balance from the ADMIN endpoint",
  /\/api\/admin\/off-job\/pto-balance\//.test(payroll));
check("it mints an idempotency key so a double-tap cannot double-record",
  /entry_uuid: crypto\.randomUUID\(\)/.test(payroll));
check("a balance that fails to load does not break the row",
  /catch \{[\s\S]{0,120}?setBal\(null\)/.test(payroll));
check("somebody with no allowance is told, not shown a form that will 403",
  /Not set up for PTO/.test(payroll));
check("and the button is disabled when nothing is left",
  /bal\.remaining_hours <= 0/.test(payroll));

console.log("\nThe allowance is set on the roster:");
check("the roster has a PTO allowance control", /function PtoAllowance\(/.test(admin));
// [\s>] not \n: these files are CRLF, so an anchor on a bare newline right after
// the tag name never matches.
check("it is rendered in the roster row", /<PtoAllowance[\s>]/.test(admin));
check("it PATCHes pto_hours_annual", /pto_hours_annual: hours/.test(admin));
check("zero is presented as not eligible, with no second switch",
  /hrs > 0 \? `PTO \$\{hrs\}h` : "PTO -"/.test(admin));

console.log("\nThe payroll export carries the new columns:");
// A column missing here is hours or money that silently never reach QuickBooks.
check("PTO is in the TSV header", /"Other", "PTO",/.test(payroll));
check("Tips is in the TSV header", /"Tips \$"/.test(payroll));
check("PTO is in the TSV rows", /e\.totals\.pto_hours \?\? 0/.test(payroll));
check("Tips is in the TSV rows", /e\.totals\.tips_amount \?\? 0/.test(payroll));

console.log();
if (fails.length) {
  console.log("FAILURES: " + fails.join(", "));
  process.exit(1);
}
console.log("all checks passed");
