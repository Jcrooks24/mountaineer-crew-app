/**
 * Tips are entered in ONE place, and never dated by the job (request f8e008cb).
 * `node scripts/verify_tips_ui.mjs`
 *
 * WHY THIS EXISTS. The tip feature has a property that is invisible in the UI
 * and easy to undo by accident: a tip is dated by when it is PAID, never by the
 * job it came from. Tips arrive after the job's pay period has been finalized,
 * so dating one by the job drops it into a closed run where it is missed. The
 * screen relies on the server defaulting `tip_date` to today, and the way to
 * break that is for somebody to "helpfully" pass the job's date. So this asserts
 * the client sends NO tip_date at all.
 *
 * REWRITTEN 2026-09-09. There used to be TWO entry points - the payroll screen
 * and a card on the Job Summary - and this file asserted both existed. The
 * office asked for one, and the Job Summary one was the wrong one to keep: its
 * person picker was built from the job report's `employee_hours` filtered to
 * roster-matched rows, so on a job with no report yet, or with legacy hours
 * rows, the picker was empty and the card could not be used at all. It read as
 * a missing feature. Tips now live only where the money is worked out, and this
 * file asserts the Job Summary entry point is GONE - the inverse of what it
 * used to check.
 *
 * Cannot verify the rendering or the taps: no jsdom or test runner in this
 * project, and the Chrome tools are off limits here.
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

const payroll = readFileSync(`${ROOT}/frontend/src/components/PayrollTool.tsx`, "utf8");
const admin = readFileSync(`${ROOT}/frontend/src/pages/Admin.tsx`, "utf8");
const api = readFileSync(`${ROOT}/backend/app/routers/payroll.py`, "utf8");
// The amount guards are pydantic validators, which live in the schema module
// rather than the router - reading only the router silently skipped them.
const schema = readFileSync(`${ROOT}/backend/app/schemas/payroll.py`, "utf8");

console.log("There is exactly ONE place to enter a tip:");
check("the payroll screen has a tips section", /function TipsSection\(/.test(payroll));
check("it is rendered on the employee row", /<TipsSection /.test(payroll));
check("the Job Summary tips card is gone", !/JobTipsCard/.test(admin),
  "two entry points meant the office had to know which screen to use, and the "
  + "Job Summary one could not be used on a job with no roster-matched crew");
check("and nothing in Admin posts a tip any more", !/payroll\/tips/.test(admin));
check("the help text no longer sends people to the Job Summary",
  !/Job Summary instead/.test(payroll));

console.log("\nThe payout date is the server's, never the job's:");
const payrollPost = payroll.match(/apiFetch\("\/api\/admin\/payroll\/tips",[\s\S]{0,300}/);
check("payroll POST found, and the window reaches its body",
  !!payrollPost && /body: JSON.stringify/.test(payrollPost[0]));
check("payroll POST sends no tip_date",
  !!payrollPost && !/tip_date/.test(payrollPost[0]), payrollPost?.[0]);
check("the server defaults it to today in Mountain time",
  /utc_naive_to_mountain_date\(datetime\.now\(timezone\.utc\)/.test(api),
  "UTC would already be tomorrow at 6pm Mountain and could shift the pay period");
check("and the server windows on tip_date, not on the job's date",
  /EmployeeTip\.tip_date >= start\.isoformat\(\)/.test(api));

console.log("\nThe admin is told where the money lands:");
check("the payroll screen says it pays on this period",
  /pays on this period/.test(payroll));

console.log("\nA tips list that will not load must not take the row with it:");
check("the payroll section handles its own failure",
  /Could not add the tip\./.test(payroll));

console.log("\nGuards on the amount:");
check("payroll rejects a non-positive amount client-side",
  /Enter a dollar amount greater than zero\./.test(payroll));
check("the server rejects it too, so the UI is not the only gate",
  /a tip must be a positive dollar amount/.test(schema));
check("and an implausible one", /tip looks like a typo/.test(schema));

console.log();
if (fails.length) {
  console.log("FAILURES: " + fails.join(", "));
  process.exit(1);
}
console.log("all checks passed");
