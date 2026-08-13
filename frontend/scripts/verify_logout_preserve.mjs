/**
 * Logout preservation: the cost, and the silent loss.
 *
 * Crews reported the app being slow app-wide and worst on sign-out, and worst on
 * particular devices. Sign-out runs backupFailedWork() then clearCrewState(), and
 * backupFailedWork used to copy EVERY BOL draft on the device - each holding up
 * to four base64 signature PNGs - unconditionally, even when there was no BOL
 * work at all. Read, JSON.stringify, write, all synchronous, all on the main
 * thread. That is the pause, and it scales with how much a phone has
 * accumulated, which is why it was device-specific.
 *
 * The worse half is not performance. That write briefly DOUBLED stored bytes at
 * the moment before the wipe, on exactly the devices nearest quota - and the
 * QuotaExceededError was swallowed, after which clearCrewState() destroyed the
 * signed BOL the backup existed to save. ADR 0021's loss, reintroduced by the
 * code written to prevent it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..").split("\\").join("/");
const fails = [];
const check = (n, c, d = "") => {
  console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${d ? `   ${d}` : ""}`);
  if (!c) fails.push(n);
};

// ── A localStorage good enough to measure against ────────────────────────────
class FakeStorage {
  constructor() { this.m = new Map(); this.reads = 0; this.writes = 0; this.cap = Infinity; }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { this.reads++; return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    const size = [...this.m.entries()].reduce((s, [a, b]) => s + a.length + b.length, 0);
    if (size + k.length + v.length > this.cap) {
      const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e;
    }
    this.writes++; this.m.set(k, v);
  }
  removeItem(k) { this.m.delete(k); }
  bytes() { return [...this.m.entries()].reduce((s, [a, b]) => s + a.length + b.length, 0); }
}

const esbuild = await import(`file:///${ROOT}/frontend/node_modules/esbuild/lib/main.js`);
async function loadModule(rel) {
  const src = readFileSync(`${ROOT}/${rel}`, "utf8");
  const js = esbuild.transformSync(src, { loader: "ts", format: "esm" }).code;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}

const storage = new FakeStorage();
globalThis.localStorage = storage;
const { backupFailedWork, restoreFailedWork } = await loadModule("frontend/src/auth/preserveFailedWork.ts");

/** A signed BOL draft, roughly life-sized: four base64 signature PNGs. */
function draft(job) {
  return JSON.stringify({
    job_uuid: job, bol_id: `bol-${job}`,
    signatures: Array.from({ length: 4 }, () => "data:image/png;base64," + "A".repeat(40_000)),
  });
}

console.log("A logout with no BOL work copies nothing:");
storage.m.clear();
for (let i = 0; i < 20; i++) storage.m.set(`crew_bol_draft_v1:job-${i}`, draft(`job-${i}`));
storage.m.set("crew_rods_queue_v1", JSON.stringify([{ id: 1, failed_at: "2026-08-01" }]));
const before = storage.bytes();
storage.reads = 0;
let ok = backupFailedWork(7);
check("backup succeeded", ok === true);
const backupRaw = storage.getItem("keepfailed_v1:7");
const parsed = JSON.parse(backupRaw);
check("the failed RODS entry is preserved", !!parsed["crew_rods_queue_v1"]);
// The whole point: 20 drafts of ~160KB each must NOT be copied when no BOL op
// needs them. Before the fix this backup was ~3.2MB.
check("no BOL drafts were copied", !parsed["__bol_drafts__"],
  parsed["__bol_drafts__"] ? `${parsed["__bol_drafts__"].length} copied` : "none");
check("the backup is small", backupRaw.length < 5_000, `${backupRaw.length} chars`);
check("stored bytes barely moved", storage.bytes() - before < 5_000,
  `+${storage.bytes() - before}`);

console.log("\nA logout WITH a pending pdf op copies exactly the draft it needs:");
storage.m.clear();
for (let i = 0; i < 20; i++) storage.m.set(`crew_bol_draft_v1:job-${i}`, draft(`job-${i}`));
storage.m.set("crew_bol_queue_v1", JSON.stringify([
  { op: "pdf", bol_id: "bol-job-3", job_uuid: "job-3" },
  { op: "sign", bol_id: "bol-job-9", payload: {} },
]));
ok = backupFailedWork(7);
check("backup succeeded", ok === true);
const p2 = JSON.parse(storage.getItem("keepfailed_v1:7"));
check("the pending BOL ops are preserved", p2["crew_bol_queue_v1"].length === 2);
check("exactly one draft copied", (p2["__bol_drafts__"] || []).length === 1,
  String((p2["__bol_drafts__"] || []).length));
check("and it is the pdf op's job", p2["__bol_drafts__"][0].k === "crew_bol_draft_v1:job-3",
  p2["__bol_drafts__"][0].k);
// A sign op carries its own payload and rebuilds nothing from a draft.
check("a sign op does not drag in a draft",
  !p2["__bol_drafts__"].some((d) => d.k.includes("job-9")));

console.log("\nRestore still works end to end:");
storage.m.delete("crew_bol_queue_v1");
const n = restoreFailedWork(7);
check("entries were restored", n > 0, String(n));
const restoredQueue = JSON.parse(storage.getItem("crew_bol_queue_v1") || "[]");
check("the pdf op came back", restoredQueue.some((o) => o.op === "pdf"));
check("its draft came back", storage.getItem("crew_bol_draft_v1:job-3") != null);
check("the backup is consumed, not left to grow", storage.getItem("keepfailed_v1:7") == null);

console.log("\nA full device reports failure instead of losing the BOL:");
storage.m.clear();
storage.m.set("crew_bol_queue_v1", JSON.stringify([
  { op: "pdf", bol_id: "bol-1", job_uuid: "job-1" },
]));
storage.m.set("crew_bol_draft_v1:job-1", draft("job-1"));
storage.cap = storage.bytes() + 100;   // no room for the backup
const errs = [];
const realError = console.error;
console.error = (...a) => errs.push(a.join(" "));
ok = backupFailedWork(7);
console.error = realError;
storage.cap = Infinity;
check("returns false rather than pretending", ok === false);
check("and says so out loud", errs.some((e) => /backup FAILED/.test(e)));
// The signed BOL must still be on the device: the caller keys the wipe off this.
check("the BOL queue is untouched", storage.getItem("crew_bol_queue_v1") != null);
check("the signature draft is untouched", storage.getItem("crew_bol_draft_v1:job-1") != null);

console.log("\nThe caller does not wipe when the backup failed:");
const auth = readFileSync(`${ROOT}/frontend/src/auth/AuthContext.tsx`, "utf8");
check("logout gates the wipe on the backup", /if \(!backupFailedWork\(user\?\.id\)\)/.test(auth));
check("the user-switch path gates it too", /if \(backupFailedWork\(previous\.id\)\) \{\s*\n\s*clearCrewState\(\);/.test(auth));
check("no unconditional clearCrewState remains next to a backup",
  !/backupFailedWork\([^)]*\);\s*\n\s*clearCrewState\(\);/.test(auth));

console.log("\nThe storage report is on demand, never on boot:");
const profile = readFileSync(`${ROOT}/frontend/src/pages/Profile.tsx`, "utf8");
check("it is behind a button", /onClick=\{run\}/.test(profile));
check("it is not run from an effect",
  !/useEffect\([^)]*buildStorageReport/.test(profile));
const app = readFileSync(`${ROOT}/frontend/src/App.tsx`, "utf8");
check("App does not call it at all", !/buildStorageReport/.test(app));

console.log("\n" + (fails.length ? `${fails.length} FAILED: ${fails.join(", ")}` : "ALL PASS"));
process.exit(fails.length ? 1 : 0);
