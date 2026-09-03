/**
 * Truck hours on the bill (admin report, 2026-09-03: "trucks are autopopulating
 * as 1 hr"). `node scripts/verify_bill_truck_hours.mjs`
 *
 * THE SYMPTOM THIS EXISTS TO CATCH. A truck line is $90/hr. The old effect
 * created it as soon as `truckCount` was known, sized it `reduce(...) || 1` over
 * the employee hours, and then preserved whatever it wrote forever because
 * `existing` was truthy on every later render.
 *
 * Employee hours are entered at the END of a job; truck fullness is entered
 * during it. So at the moment the line was created the hours array was normally
 * EMPTY, the reduce returned 0, `|| 1` made it 1, and the line sat frozen at one
 * hour. That is not a race, it is the ordinary order of work, and on a six hour
 * job it under-bills a truck by $450.
 *
 * This is a MONEY path, so per STEP 0 of the vetting protocol the arithmetic is
 * worked by hand below against a realistic job rather than asserted. NOTE: no
 * real historical bill was recomputed - production data is not reachable from
 * this machine, and the protocol asks for a real record. That check is still
 * owed and is called out in the commit.
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

const esbuild = await import(`file:///${ROOT}/frontend/node_modules/esbuild/lib/main.js`);
const src = readFileSync(`${ROOT}/frontend/src/lib/employeeHours.ts`, "utf8");
const mod = await import(
  "data:text/javascript;base64," +
  Buffer.from(esbuild.transformSync(src, { loader: "ts", format: "esm" }).code).toString("base64")
);
const { longestBillableShift, roundBillableQuarter } = mod;

const TRUCK_RATE = 90;

console.log("The rule: longest SINGLE shift, not the sum:");
// Four movers, six hours each. A truck was there for six hours, not 24.
const fourMovers = [
  { name: "A", hours: 6, non_billable: false },
  { name: "B", hours: 6, non_billable: false },
  { name: "C", hours: 6, non_billable: false },
  { name: "D", hours: 6, non_billable: false },
];
check("four movers x 6h is a 6h truck, not 24h",
  longestBillableShift(fourMovers) === 6, String(longestBillableShift(fourMovers)));
check("and that is $540, not $2160",
  longestBillableShift(fourMovers) * TRUCK_RATE === 540);

console.log("\nThe longest shift wins, and rounds by the quarter:");
const staggered = [
  { name: "Lead", hours: 8.1, non_billable: false },   // 8h06m -> 8.25
  { name: "B", hours: 6, non_billable: false },
  { name: "C", hours: 4.5, non_billable: false },
];
check("the lead's 8h06m sets the truck, quarter-rounded to 8.25",
  longestBillableShift(staggered) === 8.25, String(longestBillableShift(staggered)));
check("hand-check: 8.25 x $90 = $742.50",
  longestBillableShift(staggered) * TRUCK_RATE === 742.5);
check("it agrees with roundBillableQuarter on the same input value",
  longestBillableShift([{ name: "x", hours: 8.1 }]) === roundBillableQuarter(8.1));

console.log("\nNon-billable rows do not size the truck:");
const withNonBillable = [
  { name: "Trainee", hours: 9, non_billable: true },
  { name: "Lead", hours: 5, non_billable: false },
];
check("a 9h non-billable trainee does not make it a 9h truck",
  longestBillableShift(withNonBillable) === 5, String(longestBillableShift(withNonBillable)));
check("that is $450, and billing the trainee's day would have been $810",
  longestBillableShift(withNonBillable) * TRUCK_RATE === 450);

console.log("\nTHE REGRESSION: no hours means no number, never 1:");
check("an empty roster returns 0, not 1", longestBillableShift([]) === 0);
check("undefined returns 0, not 1", longestBillableShift(undefined) === 0);
check("all-non-billable returns 0, not 1",
  longestBillableShift([{ name: "A", hours: 8, non_billable: true }]) === 0);
// The old code was `reduce(...) || 1`. That expression is what put 1h on the
// bill, so assert the literal is gone from the component.
const calc = readFileSync(`${ROOT}/frontend/src/components/BillCalculator.tsx`, "utf8");
check("the `|| 1` fallback is gone from the truck effect",
  !/non_billable \? max[\s\S]{0,120}\|\| 1;/.test(calc)
  && !/longestBillableShift\(employeeHours\) \|\| 1/.test(calc));

console.log("\nThe line is not created until it can be sized:");
check("the effect waits for employeeHours, like the labor effect does",
  /if \(!loaded \|\| truckCount === undefined \|\| employeeHours === undefined\) return;/.test(calc),
  "this guard is what the labor effect had and the truck effect did not");
check("and bails out when nothing billable is logged yet",
  /if \(longest <= 0\) return;/.test(calc));
check("the absence is explained rather than silent",
  /no hours logged yet/.test(calc));

console.log("\nIt follows the hours until an admin edits it:");
check("a non-edited line takes the longest shift",
  /qty: adminEdited \? existing!\.qty : longest,/.test(calc));
check("an admin edit is remembered and wins",
  /truckEditedRef\.current\.add\(id\)/.test(calc)
  && /truckEditedRef\.current\.has\(existing\.id\)/.test(calc));
check("only qty/rate edits count as an edit, not a re-render",
  /patch\.qty !== undefined \|\| patch\.rate !== undefined/.test(calc));

console.log("\nOne definition of the rule, not two:");
const dupes = (calc.match(/non_billable \? max : Math\.max/g) || []).length
  + (calc.match(/non_billable \? m : Math\.max/g) || []).length;
check("BillCalculator no longer carries its own copies of the reduce", dupes === 0,
  `${dupes} inline copies remain`);
check("both call sites use the shared helper",
  (calc.match(/longestBillableShift\(/g) || []).length >= 2);

console.log();
if (fails.length) {
  console.log("FAILURES: " + fails.join(", "));
  process.exit(1);
}
console.log("all checks passed");
