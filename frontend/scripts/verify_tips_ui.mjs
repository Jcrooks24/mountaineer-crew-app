/**
 * The two tip entry points (request f8e008cb).
 * `node scripts/verify_tips_ui.mjs`
 *
 * WHY THIS EXISTS. The tip feature has a property that is invisible in the UI
 * and easy to undo by accident: a tip is dated by when it is PAID, never by the
 * job it came from. Tips arrive after the job's pay period has been finalized,
 * so dating one by the job drops it into a closed run where it is missed.
 *
 * Both screens rely on the server defaulting `tip_date` to today. The way to
 * break that is for somebody to "helpfully" pass the job's date from the Job
 * Summary, where it is right there on screen. So this asserts the client sends
 * NO tip_date at all, from either entry point, and that the copy on screen still
 * tells the admin which period the money lands in.
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

console.log("Both entry points exist:");
check("payroll screen has a tips section", /function TipsSection\(/.test(payroll));
check("job summary has a tips card", /function JobTipsCard\(/.test(admin));
check("the payroll employee row renders it", /<TipsSection /.test(payroll));
// [\s>] rather than \n: these files have CRLF line endings, so an anchor on a
// bare \n immediately after the tag name never matches.
check("the job summary renders it", /<JobTipsCard[\s>]/.test(admin));

console.log("\nTHE INVARIANT: neither entry point dates a tip itself");
// The server defaults tip_date to today (Mountain). A client that sends one -
// especially the Job Summary, where the job's date is on screen - would put the
// money in a finalized period.
const payrollPost = payroll.match(/apiFetch\("\/api\/admin\/payroll\/tips",[\s\S]{0,300}/);
check("payroll POST found, and the window reaches its body",
  !!payrollPost && /body: JSON.stringify/.test(payrollPost[0]));
check("payroll POST sends no tip_date",
  !!payrollPost && !/tip_date/.test(payrollPost[0]), payrollPost?.[0]);
const adminPost = admin.match(/apiFetch\("\/api\/admin\/payroll\/tips",[\s\S]{0,300}/);
check("job summary POST found, and the window reaches its body",
  !!adminPost && /body: JSON.stringify/.test(adminPost[0]));
check("job summary POST sends no tip_date",
  !!adminPost && !/tip_date/.test(adminPost[0]), adminPost?.[0]);
check("but the job summary DOES send the job, for reference",
  !!adminPost && /job_uuid: jobUuid/.test(adminPost[0]));
check("the payroll entry sends no job (there is none)",
  !!payrollPost && !/job_uuid/.test(payrollPost[0]));

console.log("\nThe server is the one that decides the date:");
check("tip_date defaults to today in Mountain time",
  /utc_naive_to_mountain_date\(datetime\.now\(timezone\.utc\)/.test(api));
check("and the period comes from tip_date, not the job",
  /EmployeeTip\.tip_date >= start\.isoformat\(\)/.test(api));

console.log("\nThe admin is told where the money lands:");
check("job summary says it pays on the CURRENT period",
  /Paid on the CURRENT payroll period/.test(admin));
check("job summary says there is no automatic split",
  /no automatic split/.test(admin));
check("payroll entry says it is dated today",
  /Dated today, so it pays on this period/.test(payroll));

console.log("\nA tips list that fails to load must not break the page:");
check("the job summary swallows a tips fetch failure",
  /catch \{[\s\S]{0,200}?setTips\(\[\]\)/.test(admin),
  "the rest of the Job Summary is why somebody opened it");

console.log("\nGuards on the input:");
check("payroll rejects a non-positive amount client-side",
  /!Number\.isFinite\(value\) \|\| value <= 0/.test(payroll));
check("job summary rejects a non-positive amount client-side",
  /!Number\.isFinite\(value\) \|\| value <= 0/.test(admin));
check("job summary requires a person", /if \(!userId\)/.test(admin));
check("and handles a job whose crew has no roster match",
  /Nobody on this job's report has a roster match/.test(admin));

console.log();
if (fails.length) {
  console.log("FAILURES: " + fails.join(", "));
  process.exit(1);
}
console.log("all checks passed");
