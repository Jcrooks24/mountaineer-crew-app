/**
 * Off-job hours are findable and correctable, and a correction is always paid
 * AND mailed. `node scripts/verify_off_job_corrections.mjs`
 *
 * WHY THIS EXISTS. Off-job hours had no admin surface at all: the crew filed
 * them, payroll summed them, nothing could fix a wrong number. Giving them one
 * meant introducing a correction that is DATE-scoped and not a job - and that
 * combination fell into a gap between the two existing rules:
 *
 *   - the payroll summary read job corrections by `job_uuid IS NOT NULL`, so a
 *     non-job date-scoped row was never applied and the employee was paid the
 *     wrong number anyway;
 *   - finalize mailed corrections by `period_start == this period`, and the job
 *     path mailed by job_uuid, so a row with neither was mailed by NOBODY. That
 *     is the dangerous one: pay changes and the employee is never told.
 *
 * Both queries now key on `period_start IS NULL` instead, and this file asserts
 * they key on the SAME rule - what is paid and what is mailed must be one set.
 * It also asserts the two things that rule must not break: job corrections stay
 * out of finalize (they are mailed at the job, and mailing them twice is worse
 * than not at all), and period-scoped rows still match by period.
 *
 * Cannot verify the rendering or a live save: no jsdom or test runner in this
 * project, and the Chrome tools are off limits here.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..").split("\\").join("/");
const fails = [];
const check = (n, c, d = "") => {
  console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${!c && d ? `   ${d}` : ""}`);
  if (!c) fails.push(n);
};

const payroll = readFileSync(`${ROOT}/backend/app/routers/payroll.py`, "utf8");
const adminPy = readFileSync(`${ROOT}/backend/app/routers/admin.py`, "utf8");
const model = readFileSync(`${ROOT}/backend/app/db/models/payroll_correction.py`, "utf8");
const schema = readFileSync(`${ROOT}/backend/app/schemas/payroll.py`, "utf8");
const admin = readFileSync(`${ROOT}/frontend/src/pages/Admin.tsx`, "utf8");
const routes = JSON.parse(readFileSync(`${ROOT}/frontend/scripts/api_routes.json`, "utf8"));
const routePaths = new Set(Array.isArray(routes) ? routes : routes.paths || []);

// The section of finalize_period that chooses what to mail.
const finalizeIdx = payroll.indexOf("def finalize_period(");
const finalize = payroll.slice(finalizeIdx, finalizeIdx + 6000);
// The section of the summary that chooses what to apply.
const summaryReadIdx = payroll.indexOf("    job_corrections = (");
const summaryRead = payroll.slice(summaryReadIdx, summaryReadIdx + 1800);

console.log("The endpoints exist and are admin-only:");
check("GET/PUT corrections route is registered",
  routePaths.has("/api/admin/payroll/off-job/{entry_uuid}/corrections"),
  "regenerate with backend/scripts/dump_api_routes.py");
check("and the withdraw route",
  routePaths.has("/api/admin/payroll/off-job/{entry_uuid}/corrections/{correction_id}"));
check("all three require an admin",
  /@router\.get\("\/off-job\/\{entry_uuid\}\/corrections"\)[\s\S]{0,400}?require_admin/.test(payroll)
  && /@router\.put\("\/off-job\/\{entry_uuid\}\/corrections"\)[\s\S]{0,400}?require_admin/.test(payroll)
  && /@router\.delete\("\/off-job\/\{entry_uuid\}\/corrections\/\{correction_id\}"[\s\S]{0,400}?require_admin/.test(payroll));

console.log("\nA correction that changes pay is ALWAYS mailed:");
check("finalize mails date-scoped non-job rows",
  /period_start\.is_\(None\)/.test(finalize)
  && /PayrollCorrection\.work_date >= s\.isoformat\(\)/.test(finalize),
  "without this clause an off-job correction is mailed by nobody: not a job, "
  + "so the attestation never sees it, and no period, so finalize skips it");
check("as an alternative to the period match, not instead of it",
  /or_\(/.test(finalize) && /PayrollCorrection\.period_start == s\.isoformat\(\)/.test(finalize));
check("job corrections are still excluded, so nobody is told twice",
  /PayrollCorrection\.job_uuid\.is_\(None\)/.test(finalize),
  "job corrections are mailed when the job is initialed (ADR 0032)");
check("and only un-notified rows are picked up, so finalize stays idempotent",
  /PayrollCorrection\.notified_at\.is_\(None\)/.test(finalize));

console.log("\nWhat is PAID and what is MAILED are the same set:");
check("the summary reads date-scoped rows by the same rule",
  /PayrollCorrection\.period_start\.is_\(None\)/.test(summaryRead)
  && /PayrollCorrection\.work_date >= start\.isoformat\(\)/.test(summaryRead));
check("the summary no longer keys that read on job_uuid",
  !/PayrollCorrection\.job_uuid\.isnot\(None\)/.test(summaryRead),
  "keying on job_uuid is what made a non-job date-scoped row unpayable");
check("period-scoped rows are still read by period",
  /PayrollCorrection\.period_start == start\.isoformat\(\)/.test(summaryRead));

console.log("\nThe correction is derived from the entry, not from the client:");
check("who it is about comes from the entry",
  /user_id=e\.submitted_by_id,/.test(payroll));
// The FIELD DECLARATIONS only. The docstring above them explains why there is
// no user_id, so scanning the whole class matches its own rationale and passes
// for the wrong reason.
const offJobSchema = schema.slice(schema.indexOf("class OffJobCorrectionUpsert(BaseModel):"));
const offJobFields = offJobSchema
  .slice(0, offJobSchema.indexOf("@field_validator"))
  .split("\n")
  .filter((l) => /^ {4}[a-z_]+\s*:/.test(l));
check("it declares only bucket, hours, reason and notify",
  offJobFields.length === 4 && /bucket/.test(offJobFields[0]),
  offJobFields.join(" | "));
check("the client cannot send a user_id at all",
  offJobFields.length > 0 && !offJobFields.some((l) => /user_id/.test(l)),
  "an entry belongs to one person; a user_id field could only correct the wrong one");
check("the work date comes from the entry",
  /work_date = \(e\.work_date or ""\)\.strip\(\)/.test(payroll));
check("and an unparseable one is refused, not guessed",
  /if not _parse_date_str\(work_date\):/.test(payroll));
check("the reported figure comes from the entry",
  /original = float\(e\.hours or 0\.0\) if body\.bucket == entry_bucket else 0\.0/.test(payroll),
  "the employee is emailed this number, so it has to be what they filed");
check("a reason is required, since it is the body of that email",
  /a correction needs a reason - the crew member is told it/.test(schema));

console.log("\nExactly one correction per target, whichever surface wrote it:");
check("the payroll screen's lookup is not period-filtered for off_job",
  /dated_source = body\.source == "off_job"/.test(payroll)
  && /if not dated_source:\s*\n\s*q = q\.filter\(/.test(payroll),
  "a period-filtered lookup would miss the other surface's row and insert a "
  + "second one, which finalize would then mail twice while paying once");
check("and it writes them date-scoped",
  /period_start=None if dated_source else s\.isoformat\(\),/.test(payroll));
check("the off-job surface migrates a legacy period-scoped row in place",
  /existing\.period_start = None[\s\S]{0,120}?existing\.corrected_hours = body\.corrected_hours/.test(payroll));
check("a uniqueness rule covers date-scoped non-job rows",
  /uq_payroll_correction_dated/.test(model)
  && /period_start IS NULL AND job_uuid IS NULL/.test(model));
const migrations = readdirSync(`${ROOT}/backend/alembic/versions`).filter((f) => f.endsWith(".py"));
const datedMig = migrations
  .map((f) => readFileSync(`${ROOT}/backend/alembic/versions/${f}`, "utf8"))
  .find((t) => t.includes("uq_payroll_correction_dated"));
check("and a migration creates it", !!datedMig);
check("guarded to Postgres, because postgresql_where is dropped on SQLite",
  !!datedMig && /dialect\.name != 'postgresql'/.test(datedMig),
  "unguarded, dev SQLite gets a FULL unique index that also binds the "
  + "period-scoped rows the partial clause exists to exclude");

console.log("\nRecorded PTO is refused, and says why:");
check("the server refuses it",
  /Recorded PTO is corrected with the PTO tool/.test(payroll));
check("the payload says so before the admin fills the form in",
  /"correctable": not is_pto and not unlinked/.test(payroll));
check("an entry with no roster account is refused too",
  /not linked to a roster account/.test(payroll));
check("the UI shows the reason instead of the form",
  /\{resp\.correctable_reason\}/.test(admin));

console.log("\nOff-job entries reach the lookup, and ONLY the lookup:");
check("job-search can return them", /include_off_job/.test(adminPy));
check("marked so a caller can tell them apart", /"kind": "off_job"/.test(adminPy));
check("it is opt-in, defaulting to off",
  /include_off_job: bool = Query\(\s*\n\s*False,/.test(adminPy),
  "always-on would offer off-job entries to the admin-notes job picker, which "
  + "attaches a job_uuid to a note - and an off-job entry has none");
check("the Job Summary lookup asks for them",
  /params\.set\("include_off_job", "true"\)/.test(admin));
check("and exactly one caller does",
  (admin.match(/include_off_job/g) || []).length === 1);
check("they are matched on the employee's name, the only name they have",
  /func\.lower\(OffJobEntry\.submitted_by_name\)\.like/.test(adminPy));
check("and bounded like the other candidate queries",
  /OffJobEntry\.work_date\.desc\(\)\)\.limit\(200\)/.test(adminPy));

console.log("\nThe two kinds of result do not get confused for each other:");
check("the row keys are namespaced, so a uuid collision cannot clash",
  /key=\{isOffJob \? `oj:\$\{c\.entry_uuid\}` : c\.job_uuid\}/.test(admin));
check("clicking one opens the entry, not a job summary",
  /isOffJob \? setOffJobUuid\(c\.entry_uuid!\) : loadSummary\(c\.job_uuid\)/.test(admin));
check("opening a job closes an open entry, and a new search closes both",
  (admin.match(/setOffJobUuid\(null\)/g) || []).length >= 3);
check("an off-job row does not show the job-only entry chip",
  /Off-job hours<\/span>/.test(admin) || /Off-job hours\s*\n\s*<\/span>/.test(admin));

console.log("\nThe admin is told what the surface will and will not do:");
check("that it does not touch what the employee submitted",
  /never changes what the employee submitted/.test(admin));
// JSX wraps these sentences across lines, so match against collapsed whitespace.
const adminFlat = admin.replace(/\s+/g, " ");
check("and when the email actually goes out",
  /emailed when you finalize the pay period/.test(adminFlat),
  "a job says 'initial the job to send'; there is no such step here, so saying "
  + "nothing would leave 'not yet sent' with nothing to press");
check("moving hours between buckets warns about the double-pay",
  /otherwise both buckets are paid/.test(admin));
check("the do-not-email opt-out is per line, matching the add tool",
  /Do not email \{resp\.user_name\} about this line/.test(admin));

console.log("\nGuards:");
check("a withdraw is scoped to its entry, not just an id",
  /PayrollCorrection\.source_key == entry_uuid,\s*\n\s*\)\s*\n\s*\.first\(\)\s*\n\s*\)\s*\n\s*if c is None:/.test(payroll),
  "id-only would let a stale tab delete another record's correction");
check("the bucket is checked against the allowed set",
  /if body\.bucket not in CORRECTION_BUCKETS:/.test(payroll));
check("the 'other' bucket is selectable, or an 'other' entry cannot be fixed",
  /other: "Other",/.test(admin));

console.log();
if (fails.length) {
  console.log("FAILURES: " + fails.join(", "));
  process.exit(1);
}
console.log("all checks passed");
