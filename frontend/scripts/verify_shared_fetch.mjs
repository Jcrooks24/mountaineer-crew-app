/**
 * Request coalescing for the shared config reads.
 *
 * A production log showed one job screen fetching the same five resources twice
 * each, because two components mounted and each asked independently. On a crew
 * phone every duplicate is a round trip on the critical path to first render.
 *
 * The danger in fixing this is the opposite of slowness: serving a stale answer,
 * or letting one failure poison the next attempt. Most of these checks are about
 * those, not about the saving.
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

const esbuild = await import(`file:///${ROOT}/frontend/node_modules/esbuild/lib/main.js`);
const src = readFileSync(`${ROOT}/frontend/src/lib/sharedFetch.ts`, "utf8");
const { coalesce, invalidate, clearSharedFetchCache } = await import(
  "data:text/javascript;base64," +
  Buffer.from(esbuild.transformSync(src, { loader: "ts", format: "esm" }).code).toString("base64")
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("Concurrent callers share one request:");
clearSharedFetchCache();
let calls = 0;
const slow = async () => { calls++; await sleep(20); return calls; };
const results = await Promise.all([
  coalesce("k", slow), coalesce("k", slow), coalesce("k", slow),
  coalesce("k", slow), coalesce("k", slow),
]);
check("five callers, one request", calls === 1, `${calls} call(s)`);
check("all five get the same answer", new Set(results).size === 1);

console.log("\nDifferent keys do not collide:");
clearSharedFetchCache();
calls = 0;
await Promise.all([coalesce("a", slow), coalesce("b", slow)]);
check("two keys, two requests", calls === 2, `${calls}`);

console.log("\nWithout a ttl, nothing is ever served stale:");
clearSharedFetchCache();
calls = 0;
await coalesce("k", slow);
await coalesce("k", slow);
check("a later call goes to the network again", calls === 2, `${calls}`);

console.log("\nWith a ttl, a repeat is reused - and only inside the window:");
clearSharedFetchCache();
calls = 0;
await coalesce("k", slow, { ttlMs: 50 });
await coalesce("k", slow, { ttlMs: 50 });
check("inside the window, reused", calls === 1, `${calls}`);
await sleep(60);
await coalesce("k", slow, { ttlMs: 50 });
check("past the window, refetched", calls === 2, `${calls}`);

console.log("\nforce and invalidate both defeat the ttl:");
clearSharedFetchCache();
calls = 0;
await coalesce("k", slow, { ttlMs: 10_000 });
await coalesce("k", slow, { ttlMs: 10_000, force: true });
check("force refetches", calls === 2, `${calls}`);
await coalesce("k", slow, { ttlMs: 10_000 });
check("and the forced result is then reused", calls === 2, `${calls}`);
invalidate("k");
await coalesce("k", slow, { ttlMs: 10_000 });
check("invalidate refetches", calls === 3, `${calls}`);

console.log("\nA failure is never cached, and never poisons the next attempt:");
clearSharedFetchCache();
let attempts = 0;
const flaky = async () => {
  attempts++;
  if (attempts === 1) throw new Error("server restarting");
  return "ok";
};
let threw = false;
try { await coalesce("k", flaky, { ttlMs: 10_000 }); } catch { threw = true; }
check("the failure reaches the caller", threw);
const second = await coalesce("k", flaky, { ttlMs: 10_000 });
check("the next call retries rather than replaying the error", second === "ok",
  String(second));
check("and the good result is what gets remembered",
  (await coalesce("k", flaky, { ttlMs: 10_000 })) === "ok" && attempts === 2,
  `${attempts} attempt(s)`);

console.log("\nConcurrent callers all see a rejection (nobody hangs):");
clearSharedFetchCache();
const boom = async () => { await sleep(10); throw new Error("nope"); };
const settled = await Promise.allSettled([
  coalesce("k", boom), coalesce("k", boom), coalesce("k", boom),
]);
check("all three reject", settled.every((s) => s.status === "rejected"));

console.log("\nApplied where the duplicates actually were:");
const files = {
  "vehicleUnits.ts": /coalesce\(\s*\n?\s*"config:vehicle-units"/,
  "jobTypesStore.ts": /coalesce\(\s*\n?\s*"config:job-types"/,
  "jobChecklistStore.ts": /coalesce\(\s*\n?\s*"config:job-checklist"/,
  "jobSetupStore.ts": /coalesce\(`job-setup:\$\{jobUuid\}`/,
};
for (const [f, re] of Object.entries(files)) {
  check(`${f} coalesces`, re.test(readFileSync(`${ROOT}/frontend/src/lib/${f}`, "utf8")));
}
// The job header is actively edited, so a reuse window could show a crew member
// their own save undone. Coalescing alone carries no such risk.
const setup = readFileSync(`${ROOT}/frontend/src/lib/jobSetupStore.ts`, "utf8");
check("the actively-edited job header has NO ttl", !/ttlMs/.test(setup));

console.log("\nAdmin edits are visible immediately, not a minute later:");
const admin = readFileSync(`${ROOT}/frontend/src/pages/Admin.tsx`, "utf8");
check("job-type edits invalidate", /invalidateJobTypes\(\)/.test(admin));
check("checklist edits invalidate", /invalidateChecklistItems\(\)/.test(admin));
check("fleet edits invalidate", /invalidateUnits\(\)/.test(admin));

console.log("\nA user switch does not leave answers in memory:");
const clear = readFileSync(`${ROOT}/frontend/src/auth/clearCrewState.ts`, "utf8");
check("clearCrewState clears the coalesce cache", /clearSharedFetchCache\(\)/.test(clear));

console.log("\n" + (fails.length ? `${fails.length} FAILED: ${fails.join(", ")}` : "ALL PASS"));
process.exit(fails.length ? 1 : 0);
