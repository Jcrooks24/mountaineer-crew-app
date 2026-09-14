/**
 * Bill line ticks survive the auto-filled line rebuilds.
 * `node scripts/verify_bill_line_sync.mjs`
 *
 * WHY THIS EXISTS. Hotfix 2026-09-14, crew report: "Job report bill line items
 * uncheck themselves when user attempts to select multiple. Happened while
 * editing an already submitted job report. Additionally, employee hour entries
 * were duplicated."
 *
 * Reproduced against the shipped code before the fix:
 *   - a crew member with two hours rows gave two "Labor - Bob" lines the SAME id,
 *     so ticking one Bob line un-ticked the other, and the bill (which needs every
 *     line checked) could never be finished;
 *   - a reopened report whose saved line order differed lost every labor tick on
 *     load, because the rebuild dropped verifiedSig and compared by position.
 * Each check below names which of those it would have caught.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..").split("\\").join("/");
const fails = [];
const check = (n, c, d = "") => {
  console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${d ? `   ${d}` : ""}`);
  if (!c) fails.push(n);
};

const esbuild = await import(`file:///${ROOT}/frontend/node_modules/esbuild/lib/main.js`);
const src = readFileSync(`${ROOT}/frontend/src/lib/billLineSync.ts`, "utf8");
const js = esbuild.transformSync(src, { loader: "ts", format: "esm" }).code;
const { syncSourceLines } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

// The same definitions BillCalculator uses.
const lineSignature = (it) => [it.label, it.qty, it.rate, it.unit, it.discount].join("~|~");
const isVerified = (it) => !!it.verifiedSig && it.verifiedSig === lineSignature(it);
const updateItem = (bill, id, patch) => ({ ...bill, items: bill.items.map((it) => (it.id !== id ? it : { ...it, ...patch })) });
const tickLine = (bill, line) => updateItem(bill, line.id, { verifiedSig: lineSignature(line) });

let n = 0;
const mint = () => `new${++n}`;
function syncLabor(bill, rows) {
  let i = 0;
  const billable = rows.filter((e) => !e.non_billable && (e.name || "").trim());
  return syncSourceLines(bill, "hours", (existing) => {
    const e = billable[i++];
    return {
      label: `Labor - ${e.name.trim()}`, qty: Math.round((e.hours || 0) * 4) / 4,
      rate: existing ? existing.rate : 75, unit: "hr", discount: existing?.discount ?? 0, source: "hours",
    };
  }, billable.map((e) => `Labor - ${e.name.trim()}`), mint);
}
const labor = (b) => b.items.filter((it) => it.source === "hours");

console.log("A crew member entered twice (the reported case):");
let bill = { items: [] };
const hours = [{ name: "Bob", hours: 8 }, { name: "Ann", hours: 8 }, { name: "Bob", hours: 7.5 }];
bill = syncLabor(bill, hours);
const ids = labor(bill).map((it) => it.id);
check("each hours row gets its own line id", new Set(ids).size === ids.length, ids.join(","));
for (const line of labor(bill)) bill = tickLine(bill, line);
check("ticking every line leaves every line checked", labor(bill).every(isVerified),
  labor(bill).map((it) => `${it.label} ${it.qty}h ${isVerified(it) ? "checked" : "UNCHECKED"}`).join(" | "));
bill = syncLabor(bill, hours);
check("a re-render with the same hours keeps every tick", labor(bill).every(isVerified));

console.log("\nA bill already SAVED with duplicate ids is repaired on open:");
const saved = { items: [
  { id: "dup", label: "Labor - Bob", qty: 8, rate: 75, unit: "hr", discount: 0, source: "hours" },
  { id: "dup", label: "Labor - Bob", qty: 7.5, rate: 75, unit: "hr", discount: 0, source: "hours" },
] };
const repaired = syncLabor(saved, [{ name: "Bob", hours: 8 }, { name: "Bob", hours: 7.5 }]);
check("the second line gets a fresh id", new Set(labor(repaired).map((it) => it.id)).size === 2);
check("the first keeps its id", labor(repaired)[0].id === "dup");

console.log("\nReopening a submitted report (the 'editing an already submitted report' case):");
const reopened = { items: [
  { id: "L1", label: "Labor - Ann", qty: 8, rate: 75, unit: "hr", discount: 0, source: "hours" },
  { id: "C1", label: "Stairs", qty: 1, rate: 50, unit: "flat", discount: 0, source: "custom" },
].map((it) => ({ ...it, verifiedSig: lineSignature(it) })) };
const afterLoad = syncLabor(reopened, [{ name: "Ann", hours: 8 }]);
check("a checked labor line is still checked after the load-time sync", afterLoad.items.filter(isVerified).length === 2);
check("nothing changed, so the bill object is untouched", afterLoad === reopened);

console.log("\nA real change still un-ticks, as designed:");
const changed = syncLabor(reopened, [{ name: "Ann", hours: 9 }]);
const ann = labor(changed)[0];
check("hours changed: the line reads as changed since checked", !isVerified(ann) && !!ann.verifiedSig);
check("a hand-set rate survives the rebuild", syncLabor({ items: [{ ...reopened.items[0], rate: 90 }] }, [{ name: "Ann", hours: 8 }]).items[0].rate === 90);

console.log("\nTruck and crew-vehicle lines keep ticks and locks too:");
const trucks = { items: [
  { id: "T1", label: "Truck #1 (per hour)", qty: 6, rate: 90, unit: "hr", discount: 0, source: "truck", qtyLocked: true },
] };
trucks.items[0].verifiedSig = lineSignature(trucks.items[0]);
const tr = syncSourceLines(trucks, "truck", (existing) => ({
  label: "Truck #1 (per hour)", qty: existing && existing.qtyLocked !== false ? existing.qty : 8,
  rate: existing ? existing.rate : 90, unit: "hr", discount: existing?.discount ?? 0, source: "truck",
  ...(existing && existing.qtyLocked !== false ? { qtyLocked: true } : {}),
}), ["Truck #1 (per hour)"], mint);
check("an overridden truck line keeps its hours, lock and tick", tr === trucks);

console.log("\nThe hours editor warns before a second row for the same person:");
const report = readFileSync(`${ROOT}/frontend/src/components/JobReport.tsx`, "utf8");
check("saveEmployee checks for an existing row before appending",
  /if \(editingIndex === null\) \{\s*const already = data\.employee_hours\.filter/.test(report));
check("and asks, naming the hours already logged",
  report.includes("Add another row for them?") && report.includes("Every row is paid."));
const bc = readFileSync(`${ROOT}/frontend/src/components/BillCalculator.tsx`, "utf8");
check("all three auto-fill syncs go through syncSourceLines",
  (bc.match(/return syncSourceLines\(\s*prev,\s*"(hours|personal_vehicle|truck)"/g) || []).length === 3);

console.log();
if (fails.length) { console.log(`FAILURES: ${fails.join(", ")}`); process.exit(1); }
console.log("all checks passed");
