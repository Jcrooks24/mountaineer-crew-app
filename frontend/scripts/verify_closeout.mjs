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
  closeoutSteps, deriveCauseIdentified, bucketAnswersFrom, isScopeCause,
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
  /bucket === "site" && isScopeCause\(chosen\) && scopeSlot/.test(stepper));
// It used to open under ANY site cause, so "Client not ready" was answered with
// "was anything added or dropped?" - the longest sub-form in the close-out,
// offered right after the crew said the problem was something else.
check("'Scope added on site' opens the scope editor", isScopeCause("scope_added_on_site"));
check("'Scope reduced on site' opens it too", isScopeCause("scope_reduced_on_site"));
check("'Client not ready' does NOT open it", !isScopeCause("client_not_ready"));
check("'More to move than quoted' does NOT open it", !isScopeCause("underestimated_volume"));

console.log("\nThe stepper cannot strand the crew:");
// These run closeoutSteps for real rather than grepping the component. The
// grep-only versions of these checks passed for two weeks while the close-out
// was unusable below question 1: a regex can confirm a line exists, it cannot
// confirm the crew can get to the next question. See the field report of
// 2026-08-18, "did not allow me to click yes it differed".
const unanswered = { variance_direction: null, variance_cause_identified: null };

check("an untouched close-out asks one question",
  JSON.stringify(closeoutSteps(unanswered, false)) === JSON.stringify(["ran"]));

// THE REGRESSION. "Yes, it differed" is not a storable answer on its own, so it
// arrives as the second argument. If it does not open step 2, the crew has said
// the job differed and has nowhere to say how, which is indistinguishable from
// a dead button.
const afterYes = closeoutSteps(unanswered, true);
check("'Yes, it differed' opens the direction question",
  afterYes[1] === "direction", afterYes.join(" > "));
// "Can you identify a cause?" is no longer a step: it is derived from the three
// cause answers. The direction question is followed straight by them.
check("'identified' is no longer a step of its own",
  !afterYes.includes("identified"), afterYes.join(" > "));
check("the direction question is followed by the three cause questions",
  afterYes[1] === "direction" && afterYes[2] === "cause:site", afterYes.join(" > "));

check("answering No at step 1 ends the flow",
  JSON.stringify(closeoutSteps(
    { variance_direction: "as_quoted", variance_cause_identified: null }, false,
  )) === JSON.stringify(["ran"]));

// Re-opening a saved report must land on the same flow the crew left, without
// the local "said differed" flag, which does not survive a reload.
for (const dir of ["more", "less"]) {
  const reopened = closeoutSteps({ variance_direction: dir, variance_cause_identified: null }, false);
  check(`a saved '${dir}' report reopens past step 1`,
    reopened[1] === "direction" && reopened.length === 2 + CAUSE_BUCKETS.length + 1,
    reopened.join(" > "));
}

// A stored `identified` no longer shortens or lengthens the flow: the crew can
// always reach the three questions and change their minds.
for (const identified of [true, false, null]) {
  const st = closeoutSteps({ variance_direction: "more", variance_cause_identified: identified }, false);
  check(`a stored identified=${identified} still opens all three questions`,
    CAUSE_BUCKETS.every((b) => st.includes(`cause:${b.bucket}`)), st.join(" > "));
}
const full = closeoutSteps({ variance_direction: "more", variance_cause_identified: true }, false);
check("the flow is one step per bucket, plus the note",
  full.length === 2 + CAUSE_BUCKETS.length + 1 && full[full.length - 1] === "note",
  full.join(" > "));
for (const { bucket } of CAUSE_BUCKETS) {
  check(`the '${bucket}' question is reachable`, full.includes(`cause:${bucket}`));
}

check("the step index is clamped, never out of range",
  /Math\.min\(at, steps\.length - 1\)/.test(stepper));
check("answering No retracts downstream answers",
  /variance_causes: \[\],/.test(stepper));
check("answering No also clears the local 'it differed' flag",
  /setDiffered\(false\);/.test(stepper),
  "otherwise 'No, as quoted' leaves the later steps on screen");
check("re-confirming Yes retracts a stored 'as quoted'",
  /variance_direction === "as_quoted"\)\s*\{\s*onChange\(\{ variance_direction: null \}\)/.test(stepper));
check("inputs are 16px so iOS does not zoom", /fontSize: 16/.test(stepper));
check("tap targets are at least 44px", /minHeight: 44/.test(stepper));

// ── Every question must be correctable (field report, 2026-09-03) ───────────
// "The buttons are stubborn: you cannot hit Yes then correct yourself to No."
//
// The three cause questions were the one place that could not be taken back.
// Their pressed state was `chosen ? true : null`, which is never false, so the
// No button could not light up and tapping it on a bucket with no cause yet
// changed nothing on screen. This evaluates the REAL expression out of the
// source rather than asserting on a string, so it fails if that ternary comes
// back.
console.log("\nEvery question is correctable, and a Yes is never lost:");

// Evaluates the REAL pressed-state expression out of the source rather than
// asserting on a string, so a regression cannot hide behind a passing regex.
// The bug this replaced: `chosen ? true : null` is never false, so the No button
// could not light up and a correction looked ignored.
// Locate the bucket row by its `apply` helper, then take the FIRST `value={...}`
// after it. Anchoring on the shape of the expression itself meant that changing
// the expression - exactly the regression under test - made the finder miss and
// skip its own sub-checks, reporting "not found" instead of "a Yes is lost".
const bucketBlock = stepper.slice(stepper.indexOf("const apply = ("));
const bucketValue = bucketBlock.match(/value=\{([^}]*)\}/);
check("found the bucket question's pressed-state expression", !!bucketValue);
if (bucketValue) {
  const f = new Function("chosen", "answered", `return (${bucketValue[1]});`);
  check("a chosen cause reads as Yes", f("client_not_ready", undefined) === true);
  check("Yes with no cause picked yet still reads as Yes", f("", "yes") === true);
  check("an explicit No reads as No, not as unanswered", f("", "no") === false);
  check("untouched reads as unanswered", f("", undefined) === null);
}

console.log("\n'Can you identify a cause' is derived, and cannot contradict itself:");
const B = CAUSE_BUCKETS.map((b) => b.bucket);
const noneAnswered = {};
const allNo = Object.fromEntries(B.map((b) => [b, "no"]));

// THE BUG THIS REPLACED. The crew answered "Yes I can identify it" at the old
// step 3, then No to all three questions. Nothing recomputed the flag, so the
// Sheet got "Cause identified: Yes" beside an empty Reasons column.
check("three Nos and no causes derives 'cannot say', not 'identified'",
  deriveCauseIdentified([], allNo) === false);
check("any named cause derives 'identified'",
  deriveCauseIdentified(["client_not_ready"], allNo) === true);
check("a named cause wins even if the other two were No",
  deriveCauseIdentified(["travel_or_traffic"], { ...allNo, environment: "yes" }) === true);
check("half-answered derives null, not a claim either way",
  deriveCauseIdentified([], { site: "no" }) === null);
check("untouched derives null", deriveCauseIdentified([], noneAnswered) === null);
check("clearing the last cause after three Nos falls back to 'cannot say'",
  deriveCauseIdentified([], allNo) === false);

console.log("\nRe-opening a report shows what the crew actually said:");
const reopenedNo = bucketAnswersFrom([], false);
check("a stored 'cannot say' comes back as three Nos",
  B.every((b) => reopenedNo[b] === "no"), JSON.stringify(reopenedNo));
const reopenedYes = bucketAnswersFrom(["client_not_ready"], true);
check("a stored cause comes back as that bucket's Yes",
  reopenedYes.site === "yes", JSON.stringify(reopenedYes));
check("and does not invent answers for the other two",
  reopenedYes.environment === undefined && reopenedYes.crew === undefined,
  JSON.stringify(reopenedYes));
check("an untouched report reconstructs nothing",
  Object.keys(bucketAnswersFrom([], null)).length === 0);
// Round trip: what comes back must derive the flag it was built from.
check("reconstruction round-trips through the derivation",
  deriveCauseIdentified([], bucketAnswersFrom([], false)) === false
  && deriveCauseIdentified(["client_not_ready"], bucketAnswersFrom(["client_not_ready"], true)) === true);

console.log("\nAnswering a cause question moves the stepper on:");
// Comments and whitespace only between the two statements. The loose version of
// this passed with `if (false) advance();` sitting in between, which is exactly
// the regression it claims to catch.
check("answering No advances",
  /apply\("no", ""\);(?:\s|\/\/[^\n]*\n)*advance\(\);/.test(stepper));
check("picking a cause advances",
  /isScopeCause\(key\)\)\)[\s\S]{0,80}?advance\(\);/.test(stepper));
check("but not when it opens the scope editor underneath",
  /isScopeCause\(key\)/.test(stepper));

console.log("\nStale answers cannot leak across a retraction:");
// Both of these live in local state, so nothing on the server or in the payload
// catches them going wrong. The crew just sees rows pre-answered with something
// they did not say this time round.
check("'No, as quoted' also drops the three cause answers",
  /setBucketAnswers\(\{\}\);/.test(stepper),
  "otherwise re-entering shows the old answers and the first tap derives from them");
check("flipping direction recomputes the derived flag against what survives",
  /variance_cause_identified: deriveCauseIdentified\(kept, bucketAnswers\)/.test(stepper),
  "otherwise a flip can strip every cause and leave 'identified' still saying Yes");

console.log("\nA cause question cannot render without a direction:");
check("it prompts back to the direction question instead of a blank card",
  /bucketStep && !dir &&/.test(stepper));

console.log("\n" + (fails.length ? `${fails.length} FAILED: ${fails.join(", ")}` : "ALL PASS"));
process.exit(fails.length ? 1 : 0);
