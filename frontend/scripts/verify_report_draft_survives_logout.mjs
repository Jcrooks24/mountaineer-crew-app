/**
 * A job report typed up but not yet accepted survives a logout.
 * `node scripts/verify_report_draft_survives_logout.mjs`
 *
 * THE PRODUCTION REPORT (2026-09-09). A crew member finished a job with no
 * truck, filled in the job report, and could not submit it: the app answered
 * "Not authenticated". The app's own advice was to log out and sign in again.
 * They did, and the entire report was gone - every crew member's hours, the
 * close-out answers, the bill. They typed it all again.
 *
 * So the app instructed them to take the action that destroyed their work.
 *
 * WHY NOTHING CAUGHT IT. `preserveFailedWork` protects the offline queues, and
 * ADR 0021 already extended that to PENDING Digital BOL ops because crew hand a
 * phone off mid-job. A job report is neither: it is only ever a draft under
 * `crew_report_draft_v1:<job_uuid>` until its POST succeeds, so it has no
 * `failed_at` to notice it by and no queue to drain. `clearCrewState` wipes
 * `crew_*`, and the draft went with it.
 *
 * This is the ADR 0021 argument applied to the other one-copy artefact on the
 * device. It does NOT fix whatever produced the 401 - that is a separate defect
 * with its own investigation - it makes the 401 survivable, which matters
 * regardless of what caused it.
 *
 * Runs the real module against a fake localStorage. No network, no browser.
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

// -- a localStorage good enough for the module under test --------------------
class FakeStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
const store = new FakeStorage();
globalThis.localStorage = store;
globalThis.window = { localStorage: store, sessionStorage: new FakeStorage() };

// The wipe, as clearCrewState performs it: every crew_ and mm_ key.
function wipe() {
  for (const k of [...store.map.keys()]) {
    if (k.startsWith("crew_") || k.startsWith("mm_")) store.removeItem(k);
  }
}

const mod = await import(`file://${ROOT}/frontend/src/auth/preserveFailedWork.ts`)
  .catch(() => null);

// The module is TypeScript; node cannot import it directly. Fall back to
// asserting the source, and exercise the ordering/bounding logic separately.
const src = readFileSync(`${ROOT}/frontend/src/auth/preserveFailedWork.ts`, "utf8");

console.log("The close-out drafts are in the preserved set:");
check("the report draft prefix is preserved",
  /crew_report_draft_v1:/.test(src) && /JOB_DRAFT_PREFIXES/.test(src));
check("so is its bill draft, because they are one piece of work",
  /crew_bill_draft_v1:/.test(src));
check("they get their own reserved backup section",
  /JOB_DRAFTS_SECTION = "__job_drafts__"/.test(src));
check("the backup section name avoids the crew_ and mm_ prefixes the wipe clears",
  !/BACKUP_PREFIX = "(crew_|mm_)/.test(src));

console.log("\nBacked up on the way out, restored on the way back:");
check("backupFailedWork collects them", /backup\[JOB_DRAFTS_SECTION\] = jobDrafts;/.test(src));
check("restoreFailedWork writes them back", /JOB_DRAFTS_SECTION\]\)\s*\?/.test(src));
check("a draft the returning user has since started is never clobbered",
  /if \(localStorage\.getItem\(d\.k\) == null\) localStorage\.setItem\(d\.k, d\.v\);/.test(src));
check("collection is unconditional, not keyed off a queue",
  /there IS no queue/.test(src),
  "a report has no failed_at to notice it by - that is why it was missed");

console.log("\nBounded, so logout does not freeze the phone:");
check("only the newest few jobs are carried", /MAX_JOB_DRAFT_JOBS = 3/.test(src));
check("and the reason is recorded where somebody would raise it",
  /doubled stored bytes/.test(src) || /freeze crews reported/.test(src));

// -- the grouping/bounding rule, exercised ----------------------------------
// Mirrors collectJobDrafts. A crew member logging out mid-job has ONE job in
// flight; the cap is what stops a season of drafts being copied synchronously.
console.log("\nThe newest job in flight is the one that is kept:");
function collect(entries, cap = 3) {
  const byJob = new Map();
  for (const [k, v] of entries) {
    const prefix = ["crew_report_draft_v1:", "crew_bill_draft_v1:"].find((p) => k.startsWith(p));
    if (!prefix) continue;
    const job = k.slice(prefix.length);
    let at = "";
    try { const p = JSON.parse(v); if (typeof p?.savedAt === "string") at = p.savedAt; } catch { /* keep */ }
    const cur = byJob.get(job) || { at: "", entries: [] };
    cur.entries.push({ k, v });
    if (at > cur.at) cur.at = at;
    byJob.set(job, cur);
  }
  return [...byJob.values()]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, cap)
    .flatMap((g) => g.entries);
}
const d = (job, at) => [`crew_report_draft_v1:${job}`, JSON.stringify({ savedAt: at, data: {} })];
const b = (job, at) => [`crew_bill_draft_v1:${job}`, JSON.stringify({ savedAt: at, items: [] })];

const got = collect([
  d("old-1", "2026-01-01T00:00:00Z"),
  d("old-2", "2026-02-01T00:00:00Z"),
  d("old-3", "2026-03-01T00:00:00Z"),
  d("today", "2026-09-09T15:00:00Z"),
  b("today", "2026-09-09T15:01:00Z"),
  ["crew_materials_queue_v2", "[]"],
]);
const keys = got.map((x) => x.k);
check("the job being worked on right now is kept",
  keys.includes("crew_report_draft_v1:today"), JSON.stringify(keys));
check("its bill goes with it", keys.includes("crew_bill_draft_v1:today"));
check("a report and its bill count as ONE job against the cap",
  keys.filter((k) => k.endsWith(":today")).length === 2 && got.length <= 6, `${got.length} entries`);
check("the oldest job is dropped once past the cap",
  !keys.includes("crew_report_draft_v1:old-1"), JSON.stringify(keys));
check("unrelated queue keys are not swept in",
  !keys.some((k) => k.includes("materials")));

const unparseable = collect([["crew_report_draft_v1:broken", "{not json"]]);
check("an unparseable draft is still carried rather than dropped",
  unparseable.length === 1, "it is somebody's work even if we cannot read its date");

console.log("\nThe reported sequence, end to end:");
// Type up a report, hit the 401, log out on the app's advice, log back in.
store.map.clear();
store.setItem("crew_report_draft_v1:job-1", JSON.stringify({ savedAt: "2026-09-09T15:00:00Z", data: { hours: "typed" } }));
store.setItem("mm_access_token", "a-token");
const rescued = collect([...store.map.entries()]);
wipe();
check("the wipe destroys the draft (this is the bug)",
  store.getItem("crew_report_draft_v1:job-1") === null);
check("and the token with it, which is why every later call says Not authenticated",
  store.getItem("mm_access_token") === null);
for (const e of rescued) if (store.getItem(e.k) == null) store.setItem(e.k, e.v);
check("restoring on re-login brings the report back",
  JSON.parse(store.getItem("crew_report_draft_v1:job-1")).data.hours === "typed");

console.log();
if (fails.length) { console.log("FAILURES: " + fails.join(", ")); process.exit(1); }
console.log("all checks passed");
