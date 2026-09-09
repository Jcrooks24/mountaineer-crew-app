/**
 * Every bill line is checked individually, and a tick does not survive a change.
 * `node scripts/verify_bill_line_verification.mjs`
 *
 * WHY THIS EXISTS. Submission used to be gated on ONE checkbox at the bottom of
 * the report: "I have reviewed and confirmed the correctness of the
 * auto-populated line items". One tick, covering every line, and the cheapest
 * possible thing to satisfy without reading anything. A truck line frozen at 1h
 * - a $90/hr line - went out on real invoices underneath it.
 *
 * The replacement is per line. The property that makes it worth having, and the
 * one that is easy to get wrong, is that a tick must describe the NUMBERS it was
 * given for: tick a line, then have the materials rebuild change its total or
 * somebody fix an end time, and a boolean would still claim the new figure had
 * been checked. So the tick stores a SIGNATURE of the line's billable values and
 * is only honoured while it still matches.
 *
 * That also means there is no invalidation logic to keep in step at the dozen
 * places that write to a line, and an auto-fill added later cannot forget to
 * clear it.
 *
 * Static checks: no jsdom or test runner here, and the Chrome tools are off
 * limits. The signature logic itself is exercised directly below.
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

const bill = readFileSync(`${ROOT}/frontend/src/components/BillCalculator.tsx`, "utf8");
const report = readFileSync(`${ROOT}/frontend/src/components/JobReport.tsx`, "utf8");

console.log("The tick is a signature, not a boolean:");
check("the line carries verifiedSig", /verifiedSig\?: string;/.test(bill));
check("and there is no boolean `verified` field to regress to",
  !/^\s*verified\??: boolean/m.test(bill));
check("isVerified compares against the CURRENT values",
  /it\.verifiedSig === lineSignature\(it\)/.test(bill));
check("the signature covers everything that changes the charge",
  /\[it\.label, it\.qty, it\.rate, it\.unit, it\.discount\]/.test(bill),
  "label, qty, rate, unit and discount all alter what the customer pays");

console.log("\nThe signature behaves (exercised, not just grepped):");
// Mirrors lineSignature / isVerified exactly.
const sig = (it) => [it.label, it.qty, it.rate, it.unit, it.discount].join("~|~");
const ok = (it) => !!it.verifiedSig && it.verifiedSig === sig(it);

const line = { label: "Truck #1 (per hour)", qty: 8, rate: 90, unit: "hr", discount: 0 };
check("an unticked line is not verified", !ok(line));
const ticked = { ...line, verifiedSig: sig(line) };
check("a ticked line is verified", ok(ticked));
check("changing the HOURS un-ticks it", !ok({ ...ticked, qty: 14 }),
  "the 1h truck bug is exactly this: the number changes after somebody signed off");
check("changing the RATE un-ticks it", !ok({ ...ticked, rate: 120 }));
check("changing the DISCOUNT un-ticks it", !ok({ ...ticked, discount: 10 }));
check("changing the LABEL un-ticks it", !ok({ ...ticked, label: "Truck #2 (per hour)" }));
check("re-ticking at the new values verifies it again",
  ok({ ...ticked, qty: 14, verifiedSig: sig({ ...line, qty: 14 }) }));
check("a stale signature from another line does not verify",
  !ok({ ...line, verifiedSig: sig({ ...line, qty: 99 }) }));

console.log("\nSubmission is gated on the LINES, not on one checkbox:");
check("the single bill-review checkbox is gone",
  !/checked=\{billReviewed\}/.test(report),
  "one tick covering every line is the thing this replaced");
check("nothing gates on billReviewed any more",
  !/!billReviewed/.test(report));
check("the flag is kept only so older drafts still parse",
  /DEAD as of 2026-09-09/.test(report));
check("save is blocked while any line is unchecked",
  /unverifiedLines\(billData\.items\)/.test(report));
check("and the crew are told WHICH lines", /\.map\(\(l\) => l\.label\)\.join\(", "\)/.test(report));
check("the step-through gate blocks too, not just the save",
  /anchor: "bill_review"/.test(report) && /uncheckedLines\.length > 0/.test(report));

console.log("\nThe status readout re-renders as lines are ticked:");
check("unverified comes down the render prop, not off the imperative ref",
  /unverified: LineItem\[\];/.test(bill) && /billSlots\.unverified/.test(report),
  "reading it off getData() would leave the count frozen until something else re-rendered");

console.log("\nAn existing truck line is never silently re-sized:");
check("auto-fill only sizes a line it is creating",
  /const overridden = existing !== undefined && existing\.qtyLocked !== false;/.test(bill),
  "old bills are left alone; they were corrected by hand where it mattered");
check("and the reason is recorded where somebody would undo it",
  /AN EXISTING LINE IS NEVER RE-SIZED/.test(bill));

console.log();
if (fails.length) { console.log(`FAILURES: ${fails.join(", ")}`); process.exit(1); }
console.log("all checks passed");
