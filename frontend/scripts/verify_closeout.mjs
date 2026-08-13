/**
 * The close-out redesign (office feedback 2026-08-13).
 *
 * Two questions were retired as duplicates, the flat cause list became three
 * bucketed questions, and direction + "can you name a cause" became stored
 * answers instead of inferences. The risks worth testing are not the happy path:
 *
 *   1. A year of saved reports must still render. Retired keys keep labels.
 *   2. Direction filtering must be total - a crew that finished EARLY must never
 *      be offered "truck broke down", because a mis-tapped cause reads as a real
 *      signal in the Sheet.
 *   3. Every bucket must have options in BOTH directions, or a question becomes
 *      unanswerable and the crew is stuck on a step with an empty dropdown.
 *   4. The frontend vocabulary and the backend allow-list must agree, or a save
 *      422s on a cause the UI just offered.
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
const src = readFileSync(`${ROOT}/frontend/src/lib/closeout.ts`, "utf8");
const mod = await import(
  "data:text/javascript;base64," +
  Buffer.from(esbuild.transformSync(src, { loader: "ts", format: "esm" }).code).toString("base64")
);
const {
  VARIANCE_CAUSES, CAUSE_BUCKETS, causesFor, causeForBucket,
  setCauseForBucket, causesInDirection, inferDirection, closeoutLabel,
} = mod;

console.log("Every bucket is answerable in both directions:");
// A bucket with no options in one direction strands the crew on a step with an
// empty dropdown and no way to answer it truthfully.
for (const { bucket } of CAUSE_BUCKETS) {
  for (const dir of ["more", "less"]) {
    const opts = causesFor(bucket, dir);
    check(`${bucket} / ${dir} has options`, opts.length > 0, `${opts.length}`);
  }
}

console.log("\nDirection filtering is total (no cross-direction leakage):");
for (const { bucket } of CAUSE_BUCKETS) {
  for (const dir of ["more", "less"]) {
    const wrong = causesFor(bucket, dir).filter((o) => o.group !== dir);
    check(`${bucket} / ${dir} offers only ${dir} causes`, wrong.length === 0,
      wrong.map((o) => o.key).join(","));
    const otherBucket = causesFor(bucket, dir).filter((o) => o.bucket !== bucket);
    check(`${bucket} / ${dir} offers only ${bucket} causes`, otherBucket.length === 0);
  }
}
// The specific mis-tap that matters: an early finish must not offer breakdowns.
const lessCrew = causesFor("crew", "less").map((o) => o.key);
check("an early finish is never offered 'equipment failure'",
  !lessCrew.includes("equipment_failure"), lessCrew.join(","));
check("an early finish is never offered 'late start'",
  !lessCrew.includes("crew_late_start"));

console.log("\nOne cause per bucket, and buckets do not disturb each other:");
let causes = [];
causes = setCauseForBucket(causes, "site", "client_not_ready");
causes = setCauseForBucket(causes, "environment", "travel_or_traffic");
causes = setCauseForBucket(causes, "crew", "equipment_failure");
check("three buckets hold three causes", causes.length === 3, causes.join(","));
check("each reads back", causeForBucket(causes, "site") === "client_not_ready"
  && causeForBucket(causes, "environment") === "travel_or_traffic"
  && causeForBucket(causes, "crew") === "equipment_failure");
causes = setCauseForBucket(causes, "site", "access_stairs_carry");
check("replacing one bucket does not add a second", causes.length === 3, causes.join(","));
check("and the other two are untouched",
  causeForBucket(causes, "environment") === "travel_or_traffic"
  && causeForBucket(causes, "crew") === "equipment_failure");
causes = setCauseForBucket(causes, "crew", "");
check("answering No clears just that bucket", causes.length === 2
  && causeForBucket(causes, "crew") === "");

console.log("\nFlipping direction drops contradicting answers:");
const longCauses = ["client_not_ready", "travel_or_traffic", "equipment_failure"];
const flipped = causesInDirection(longCauses, "less");
check("no 'ran longer' cause survives a flip to shorter", flipped.length === 0,
  flipped.join(","));
const mixed = causesInDirection(["client_not_ready", "easier_access"], "less");
check("only the matching-direction cause survives",
  mixed.length === 1 && mixed[0] === "easier_access", mixed.join(","));
// A retired key has no direction and must not be silently discarded from an old
// report just because someone opened it.
check("a retired key with no direction is kept",
  causesInDirection(["reduced_scope"], "less").length === 1);

console.log("\nA year of saved reports still renders:");
for (const key of ["other", "reduced_scope", "fully_ready", "not_ready",
                   "packing_incomplete", "client_not_ready"]) {
  const label = closeoutLabel(key);
  check(`'${key}' has a label`, !!label && label !== key, label);
}
check("an unknown key falls back to itself, not blank",
  closeoutLabel("invented_key") === "invented_key");

console.log("\nDirection inference is honest for legacy reports:");
check("infers 'more' from a longer cause", inferDirection(["client_not_ready"]) === "more");
check("infers 'less' from a shorter cause", inferDirection(["easier_access"]) === "less");
// The old code defaulted to "more" here and told the office the job ran long.
check("returns null when it genuinely cannot tell", inferDirection(["other"]) === null,
  String(inferDirection(["other"])));
check("returns null for an empty report", inferDirection([]) === null);

console.log("\nFrontend and backend vocabularies agree:");
const py = readFileSync(`${ROOT}/backend/app/schemas/job_report.py`, "utf8");
const setBlock = py.slice(py.indexOf("VARIANCE_CAUSES = {"), py.indexOf("VARIANCE_DIRECTIONS"));
const backendKeys = new Set([...setBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
const frontKeys = VARIANCE_CAUSES.map((o) => o.key);
const missing = frontKeys.filter((k) => !backendKeys.has(k));
check("every offered cause is accepted by the server", missing.length === 0,
  missing.join(","));
check("retired keys are still accepted (an old report must re-save)",
  backendKeys.has("other") && backendKeys.has("client_not_ready"));

console.log("\nThe retired questions are gone from the form:");
const report = readFileSync(`${ROOT}/frontend/src/components/JobReport.tsx`, "utf8");
check("'Was the client ready' is no longer asked",
  !/Was the client ready when you arrived/.test(report));
check("'Anything added or changed on site' is no longer a top-level question",
  !/Anything added or changed on site\?/.test(report));
check("readiness still RENDERS on an old report",
  /Client readiness \(retired\)/.test(report));
check("the recap reads the stored direction, not an inference",
  /data\.variance_direction === "more"/.test(report));
check("the guess-that-defaulted-to-longer is gone",
  !/varianceDir === "less" \? "shorter" : "longer"/.test(report));

console.log("\nScope changes survive, but only under the site question:");
check("the editor is still rendered", /<ScopeChangeEditor/.test(report));
check("it is passed as the stepper's scope slot", /scopeSlot=\{/.test(report));
const stepper = readFileSync(`${ROOT}/frontend/src/components/CloseoutStepper.tsx`, "utf8");
check("and only shows for the site bucket",
  /bucketStep\.bucket === "site" && chosen && scopeSlot/.test(stepper));

console.log("\nThe stepper cannot strand the crew:");
check("answering No at step 1 ends the flow",
  /if \(!v\.variance_direction \|\| v\.variance_direction === "as_quoted"\) return steps;/.test(stepper));
check("answering 'cannot say' ends the flow",
  /if \(v\.variance_cause_identified !== true\) return steps;/.test(stepper));
check("the step index is clamped, never out of range",
  /Math\.min\(at, steps\.length - 1\)/.test(stepper));
check("answering No retracts downstream answers",
  /variance_causes: \[\],/.test(stepper));
check("inputs are 16px so iOS does not zoom", /fontSize: 16/.test(stepper));
check("tap targets are at least 44px", /minHeight: 44/.test(stepper));

console.log("\n" + (fails.length ? `${fails.length} FAILED: ${fails.join(", ")}` : "ALL PASS"));
process.exit(fails.length ? 1 : 0);
