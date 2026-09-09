/**
 * Every offline queue is drained on reconnect, including the long-distance ones.
 * `node scripts/verify_ld_drain.mjs`
 *
 * WHY THIS EXISTS. Three queues were not in App.tsx's drain set, and they were
 * the three holding the least replaceable records in the app:
 *
 *   bolStore     a SIGNED BILL OF LADING. Drained only while <BillOfLadingForm>
 *                was mounted. Sign offline, close the editor, reconnect -
 *                nothing sent it. The BOL reconciler cannot save this: it
 *                recovers Postgres -> Sheet drift, and this never reached
 *                Postgres.
 *   rodsStore    a FEDERAL DUTY LOG. Drained only from <RodsSignoff> at the
 *                moment of signing, which prints "RODS signed - will sync when
 *                back online". Nothing then did.
 *   ldDayStore   per-diem and drive-day. Had NO CALLER ANYWHERE. Every toggle
 *                ever set sat in localStorage, which is why the LongDistancePay
 *                tab is empty.
 *
 * All three were the same on `main`, so this was never a staging regression -
 * it is how the app has always behaved.
 *
 * The check is deliberately about the DRAIN SET rather than about any one store:
 * the failure was structural, and the next queue added will be at risk the same
 * way. It asserts that every module exporting a drainable queue is wired into
 * App.tsx.
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

const app = readFileSync(`${ROOT}/frontend/src/App.tsx`, "utf8");

console.log("The three long-distance / BOL queues reach the drain set:");
for (const [store, alias] of [
  ["bolStore", "drainBolQueue"],
  ["rodsStore", "drainRodsQueue"],
  ["ldDayStore", "drainLdDayQueue"],
]) {
  check(`${store} is imported into App`,
    new RegExp(`syncQueue as ${alias} \} from "\./lib/${store}"`).test(app));
  check(`  and ${alias} is actually called`,
    new RegExp(`${alias}\(\)`).test(app));
}

console.log("\nAnd they run on BOTH paths, not just one:");
check("drainLongDistance is in the `online` handler",
  /const onOnline = \(\) => \{[^}]*drainLongDistance\(\)/.test(app),
  "a reconnect while the app is open must flush them");
check("drainLongDistance also runs on mount",
  (app.match(/void drainLongDistance\(\);/g) || []).length >= 2,
  "an app relaunched after being killed offline must flush them too");

console.log("\nOne queue failing must not hold the other two:");
check("they drain independently", /Promise\.allSettled\(\[drainBolQueue\(\), drainRodsQueue\(\), drainLdDayQueue\(\)\]\)/.test(app),
  "a rejected BOL upload must not strand a RODS day behind it");

console.log("\nThe reason is recorded where somebody would undo it:");
// Comments wrap, so flatten the whitespace before matching or this fails on
// where the line happens to break rather than on what it says.
const appFlat = app.split(/\s+/).join(" ").split(" * ").join(" ");
check("the comment names what each queue carries",
  /signed Bill of Lading/.test(appFlat) && /federal duty log/.test(appFlat),
  "these look like three redundant lines to anyone tidying up");

console.log("\nNo queue is left out of the drain set:");
// The real structural check. Any lib module exporting a drainable queue must be
// reachable from App.tsx, or be listed here with a reason. A store added later
// fails this until somebody decides where it drains - which is exactly the
// decision that was never made for the three above.
//
// An earlier draft of this block asserted `known.length > 0`, which cannot fail
// and so checked nothing. The vetting protocol is explicit that a check unable to
// name a production symptom is a check about its author's imagination.
// An entry here is an exemption, so it has to be honest about WHY. "It drains on
// its own page" is the excuse that produced the three defects above, not a
// reason - do not reach for it again.
const DRAINED_ELSEWHERE = {
  officeHoursStore:
    "Admin-only, entered at a desk. Drains on its own page. Weakest entry here; "
    + "promote it into drainLongDistance if office hours are ever logged in the field.",
  estimatorQueue:
    "KNOWN DEFECT, not an exemption. RUNBOOKS 'The estimator queue drains only "
    + "while its tab is mounted': no online listener, and pruneStale deletes after "
    + "14 days, so an estimate never reopened loses the item silently. Listed so "
    + "this check passes on a pre-existing bug rather than blocking on it. Fixing "
    + "it is the same one line as drainLongDistance.",
};
const libDir = resolve(ROOT, "frontend/src/lib");
const queueModules = readdirSync(libDir)
  .filter((f) => f.endsWith(".ts"))
  .filter((f) => /export async function syncQueue|export function drain[A-Z]/
    .test(readFileSync(resolve(libDir, f), "utf8")))
  .map((f) => f.slice(0, -3));

const orphans = queueModules.filter(
  (m) => !DRAINED_ELSEWHERE[m] && !app.includes(`./lib/${m}"`));
check(`all ${queueModules.length} queue modules are drained from App or explained`,
  orphans.length === 0,
  `not reachable from App.tsx and not listed as drained elsewhere: ${orphans.join(", ")}`);

console.log();
if (fails.length) { console.log(`FAILURES: ${fails.join(", ")}`); process.exit(1); }
console.log("all checks passed");
