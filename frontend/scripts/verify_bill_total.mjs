/**
 * The crew closed-job panel showed "3 line(s)" and no amount. The amount is the
 * only thing anyone opens that screen for.
 *
 * The formula now lives in lib/billTotal.ts and is shared by the editable bill,
 * the admin Job Summary and the crew panel. The backend keeps its own copy in
 * `_bill_line_total` (it cannot import TS), so the cases below are run through
 * BOTH and compared - that is the only thing stopping the office and the crew
 * from seeing different numbers for the same job.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Repo-relative so this runs on any checkout:
//   node frontend/scripts/verify_bill_total.mjs
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..").split("\\").join("/");
const src = readFileSync(`${ROOT}/frontend/src/lib/billTotal.ts`, "utf8");
const fails = [];
const check = (n, c, d = "") => {
  console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${d ? `   ${d}` : ""}`);
  if (!c) fails.push(n);
};

// Compile the real module with the project's own esbuild - no hand-rolled type
// stripping, so what is tested is what ships.
const esbuild = await import(`file:///${ROOT}/frontend/node_modules/esbuild/lib/main.js`);
const jsOut = esbuild.transformSync(src, { loader: "ts", format: "esm" }).code;
const mod = await import(
  "data:text/javascript;base64," + Buffer.from(jsOut).toString("base64")
);
const { billTotal, fmtMoney } = mod;

const CASES = [
  { name: "empty bill", items: [], gd: 0 },
  { name: "one plain line", items: [{ qty: 8, rate: 150, discount: 0 }], gd: 0 },
  { name: "per-line discount", items: [{ qty: 8, rate: 150, discount: 10 }], gd: 0 },
  { name: "global discount", items: [{ qty: 8, rate: 150, discount: 0 }], gd: 15 },
  { name: "both discounts stack", items: [{ qty: 8, rate: 150, discount: 10 }], gd: 15 },
  { name: "several lines", items: [
      { qty: 8, rate: 150, discount: 0 },
      { qty: 2, rate: 75.5, discount: 5 },
      { qty: 1, rate: 125, discount: 0 },
    ], gd: 10 },
  { name: "fractional hours", items: [{ qty: 7.25, rate: 165, discount: 0 }], gd: 0 },
  { name: "100% line discount", items: [{ qty: 8, rate: 150, discount: 100 }], gd: 0 },
  { name: "missing fields", items: [{ qty: 8 }, { rate: 150 }, {}], gd: 0 },
  { name: "nulls in payload", items: [{ qty: null, rate: null, discount: null }], gd: null },
  { name: "strings from items_json", items: [{ qty: "8", rate: "150", discount: "10" }], gd: "5" },
];

console.log("Frontend and backend agree, case by case:");
const py = `
import json, sys
sys.path.insert(0, r"${ROOT}/backend")
def _bill_line_total(items, global_discount):
    subtotal = 0.0
    for it in items or []:
        try:
            qty = float(it.get("qty") or 0)
            rate = float(it.get("rate") or 0)
            disc = float(it.get("discount") or 0)
        except (TypeError, ValueError):
            continue
        subtotal += qty * rate * (1 - disc / 100.0)
    return subtotal * (1 - (float(global_discount or 0)) / 100.0)
cases = json.loads(sys.stdin.read())
print(json.dumps([_bill_line_total(c["items"], c["gd"]) for c in cases]))
`;
const tmp = `${process.env.TEMP || "."}/billtotal_check.py`;
writeFileSync(tmp, py);
const out = execFileSync("python", [tmp], {
  input: JSON.stringify(CASES),
  encoding: "utf8",
});
const backend = JSON.parse(out);

CASES.forEach((c, i) => {
  const front = billTotal(c.items, c.gd);
  const back = backend[i];
  check(`${c.name}: ${front.toFixed(4)} == ${back.toFixed(4)}`,
        Math.abs(front - back) < 0.0001);
});

console.log("\nIt never renders NaN at a customer's kitchen table:");
check("undefined items", billTotal(undefined, 10) === 0);
check("null items", billTotal(null, 10) === 0);
check("not an array", billTotal({}, 10) === 0);
check("NaN qty is treated as zero", billTotal([{ qty: NaN, rate: 150 }], 0) === 0);
check("garbage strings are zero, not NaN",
      billTotal([{ qty: "abc", rate: "xyz" }], 0) === 0);
check("fmtMoney of NaN is not '$NaN'", fmtMoney(NaN) === "$0.00", fmtMoney(NaN));
check("fmtMoney of Infinity is not '$∞'", fmtMoney(Infinity) === "$0.00");
check("fmtMoney formats normally", fmtMoney(1234.5) === "$1,234.50", fmtMoney(1234.5));

console.log("\nThe panel actually shows it:");
const panel = readFileSync(`${ROOT}/frontend/src/components/JobClosedPanel.tsx`, "utf8");
check("closed panel renders a Bill total row", /label="Bill total"/.test(panel));
check("and uses the shared helper", /billTotal\(s\.bill\.items, s\.bill\.global_discount\)/.test(panel));
check("the old count-only row is gone",
      !/label="Bill" value=\{`\$\{\(s\.bill\.items \|\| \[\]\)\.length\}/.test(panel));
check("line count kept as context, not as the headline", /line\(s\)/.test(panel));

console.log("\nThe duplicates were actually collapsed:");
const admin = readFileSync(`${ROOT}/frontend/src/pages/Admin.tsx`, "utf8");
const calc = readFileSync(`${ROOT}/frontend/src/components/BillCalculator.tsx`, "utf8");
check("admin summary uses the shared helper", /calcBillTotal\(summary\?\.bill\?\.items/.test(admin));
check("admin's inline reduce is gone",
      !/qty \* rate \* \(1 - disc \/ 100\)/.test(admin));
check("BillCalculator delegates its line math", /return billLineSubtotal\(item\)/.test(calc));

console.log("\n" + (fails.length ? `${fails.length} FAILED: ${fails.join(", ")}` : "ALL PASS"));
process.exit(fails.length ? 1 : 0);
