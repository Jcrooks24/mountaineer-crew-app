/**
 * The office reimbursement / mileage module (request b59434c2 item 3).
 * `node scripts/verify_reimbursements_admin_ui.mjs`
 *
 * WHY THIS EXISTS. Two properties are decisions rather than details, and both
 * are the kind a later edit undoes without noticing:
 *
 *   1. RECEIPTS ARE LINKS, NOT DOWNLOADS (user direction). The obvious
 *      "improvement" is to fetch the image and offer a download button, which
 *      puts a pile of photos on the memory path that has caused trouble in this
 *      app before, and gains nothing - Drive is already where the file lives.
 *   2. MARKING ENTERED IS REVERSIBLE. A one-way flag turns a mis-click into a
 *      receipt nobody ever enters, which is the failure the column exists to
 *      prevent.
 *
 * It also holds the default filter. The module opens on the WORKING list - not
 * yet entered, personally paid - because a list that opens on every record ever
 * filed is one nobody works from.
 *
 * Cannot verify rendering or clicks: no jsdom or test runner here, and the
 * Chrome tools are off limits.
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

const admin = readFileSync(`${ROOT}/frontend/src/pages/Admin.tsx`, "utf8");
const api = readFileSync(`${ROOT}/backend/app/routers/reimbursement.py`, "utf8");

console.log("The module exists and is reachable:");
check("the tab component is defined", /function ReimbursementsAdminTab\(/.test(admin));
check("it is in the Tab union", /\| "reimbursements"/.test(admin));
check("it has a nav entry", /\{ tab: "reimbursements", label: "Reimbursements" \}/.test(admin));
check("it renders for its tab", /tab === "reimbursements" && <ReimbursementsAdminTab \/>/.test(admin));
check("it has a display label", /reimbursements: "Reimbursements"/.test(admin));

console.log("\nRECEIPTS ARE LINKS, NOT DOWNLOADS:");
const tab = admin.slice(admin.indexOf("function ReimbursementsAdminTab("),
                        admin.indexOf("function JobSummaryTab("));
check("receipts render as anchors opening a new tab",
  /<a href=\{url\} target="_blank" rel="noopener noreferrer"/.test(tab));
check("no download attribute anywhere in the module", !/\bdownload\b/.test(tab),
  "downloading pulls photo bytes through the app for no gain");
check("it does not fetch the image bytes itself",
  !/fetch\((?!.*\/api\/reimbursements)/.test(tab) && !/createObjectURL/.test(tab));
check("all four Drive links are offered",
  /link\(r\.receipt_photo_url/.test(tab)
  && /link\(r\.odometer_start_photo_url/.test(tab)
  && /link\(r\.odometer_end_photo_url/.test(tab)
  && /link\(r\.photos_drive_url/.test(tab));
check("and the copy tells the office how to save one",
  /right-click to save/i.test(tab));

console.log("\nMARKING ENTERED IS REVERSIBLE:");
check("the toggle sends the opposite state, not always 'entered'",
  /r\.qb_status === "entered" \? "pending" : "entered"/.test(tab));
check("the server clears the stamp on the way back",
  /row\.qb_entered_at = None/.test(api),
  "a stamp left behind would describe a state the row is not in");

console.log("\nIt opens on the working list, not everything:");
check("QB status defaults to pending", /useState\("pending"\)/.test(tab));
check("payment method defaults to personal", /useState\("personal"\)/.test(tab));
check("but every filter can be widened to any",
  /<option value="">Any QB status<\/option>/.test(tab)
  && /<option value="">Any card<\/option>/.test(tab));

console.log("\nBehaviour under change and failure:");
check("a status change splices the row rather than reloading the list",
  /setRows\(\(prev\) => prev\.map\(/.test(tab),
  "reloading would yank the row out from under the cursor when it stops matching");
check("a failed load empties the list rather than showing stale rows",
  /setRows\(\[\]\)/.test(tab));
check("an empty result says so", /Nothing matches those filters/.test(tab));
check("declined claims are visibly de-emphasised, not hidden",
  /r\.status === "rejected" \? 0\.6 : 1/.test(tab));

console.log("\nIt shows the two facts payroll and QuickBooks each own:");
check("whether it has been paid, and on which run",
  /paid on the \$\{r\.paid_period_start\} to \$\{r\.paid_period_end\} run/.test(tab));
check("and who keyed it into QuickBooks", /entered by \$\{r\.qb_entered_by_name\}/.test(tab));

console.log("\nIt calls the ADMIN endpoint, not the crew list:");
check("search hits /api/reimbursements/search",
  /\/api\/reimbursements\/search\?/.test(tab));
// Bounded by the end of the signature rather than a character count: the
// parameter list is long and a too-small window fails for the wrong reason,
// which on a permissions check is the worst kind of false alarm.
const searchSig = api.match(/def search_reimbursements\(([\s\S]*?)\n\):/);
check("the search signature was found", !!searchSig);
check("and that endpoint requires admin",
  !!searchSig && /Depends\(require_admin\)/.test(searchSig[1]),
  searchSig?.[1]);

console.log();
if (fails.length) {
  console.log("FAILURES: " + fails.join(", "));
  process.exit(1);
}
console.log("all checks passed");
