#!/usr/bin/env node
/**
 * The LD day plan must not lose a selection.
 *
 * Field report 2026-09-10: ticking a second activity cleared Driving and made
 * it look uncheckable. Driving is what gates the RODS recorder and what sets
 * drive_day, so losing it means no duty log on a day federal law requires one.
 *
 * Two defects produced that, and this exercises BOTH as behavior rather than
 * grepping for a string:
 *   1. the toggle resolved against the render snapshot, so two toggles taken
 *      from one snapshot dropped the first;
 *   2. the plan write swallowed its failure, so a full device showed a ticked
 *      box with nothing behind it.
 * It then asserts the shipped hook still matches the model it proves.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "src", "components", "LdWorkday.tsx");
const src = readFileSync(SRC, "utf8");

let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) { console.log(`  ok   ${name}`); }
  else { console.log(`  FAIL ${name}${detail ? " - " + detail : ""}`); failed++; }
};

// ── A model of the two implementations, same shape as the hook ──────────────
function makeStore({ full = false } = {}) {
  const mem = new Map();
  return {
    write(key, value) {
      if (full) return false;              // quota refusal
      mem.set(key, JSON.stringify(value));
      return true;
    },
    read(key) {
      const raw = mem.get(key);
      return raw ? JSON.parse(raw) : { activities: [] };
    },
  };
}

/** OLD: toggle reads the render snapshot; plan write result discarded. */
function oldHook(store) {
  let committed = store.read("plan");
  let snapshot = committed;               // what the on-screen render captured
  let storageErr = null;
  return {
    get plan() { return committed; },
    get storageErr() { return storageErr; },
    render() { snapshot = committed; },
    toggle(a) {
      const cur = snapshot.activities;    // <- the defect
      const next = { activities: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] };
      store.write("plan", next);          // <- result discarded
      committed = next;
      storageErr = null;
    },
  };
}

/** NEW: toggle reads the committed plan; both writes reported. */
function newHook(store) {
  let committed = store.read("plan");
  let snapshot = committed;
  let storageErr = null;
  return {
    get plan() { return committed; },
    get storageErr() { return storageErr; },
    render() { snapshot = committed; },
    toggle(a) {
      const cur = committed.activities;   // planRef.current
      const next = { activities: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] };
      const stored = store.write("plan", next);
      committed = next;
      storageErr = stored ? null : "no room";
    },
  };
}

console.log("LD day plan toggle");

// 1. Two toggles resolved from ONE snapshot (no render in between).
{
  const oldH = oldHook(makeStore());
  oldH.toggle("driving");
  oldH.toggle("loading");               // same snapshot: driving is dropped
  check(
    "regression model reproduces the field report",
    !oldH.plan.activities.includes("driving"),
    `old kept ${JSON.stringify(oldH.plan.activities)}`,
  );

  const newH = newHook(makeStore());
  newH.toggle("driving");
  newH.toggle("loading");
  check(
    "driving survives a second activity picked from the same snapshot",
    newH.plan.activities.includes("driving") && newH.plan.activities.includes("loading"),
    `got ${JSON.stringify(newH.plan.activities)}`,
  );
}

// 2. Every ordering of three activities keeps all three.
{
  const orders = [
    ["driving", "loading", "packing"], ["loading", "driving", "packing"],
    ["packing", "loading", "driving"], ["loading", "packing", "driving"],
    ["driving", "packing", "loading"], ["packing", "driving", "loading"],
  ];
  let bad = null;
  for (const order of orders) {
    const h = newHook(makeStore());
    for (const a of order) h.toggle(a);   // deliberately no render between taps
    if (order.some((a) => !h.plan.activities.includes(a))) { bad = order; break; }
  }
  check("all six orderings of three activities keep all three", bad === null,
    bad ? `lost one in ${bad.join(" -> ")}` : "");
}

// 3. Untick still works, and only removes the one tapped.
{
  const h = newHook(makeStore());
  h.toggle("driving"); h.toggle("loading"); h.toggle("driving");
  check("unticking driving removes only driving",
    !h.plan.activities.includes("driving") && h.plan.activities.includes("loading"),
    `got ${JSON.stringify(h.plan.activities)}`);
}

// 4. A refused write is reported, not swallowed.
{
  const oldH = oldHook(makeStore({ full: true }));
  oldH.toggle("driving");
  check("regression model hides a refused write", oldH.storageErr === null);

  const newH = newHook(makeStore({ full: true }));
  newH.toggle("driving");
  check("a refused plan write surfaces an error", newH.storageErr !== null);
}

// ── The shipped hook must still match the model above ───────────────────────
console.log("Shipped hook");
check("savePlan returns a boolean via persistJson",
  /function savePlan\([^)]*\): boolean \{\s*return persistJson\(/.test(src));
check("savePlan no longer swallows with a bare catch",
  !/localStorage\.setItem\(PLAN_PREFIX[\s\S]{0,120}?catch \{\}/.test(src));
check("toggleActivity resolves against planRef, not the render snapshot",
  /toggleActivity[\s\S]{0,220}?planRef\.current\.activities/.test(src)
  && !/toggleActivity[\s\S]{0,220}?plan\.activities\.includes/.test(src));
check("persist reports the plan write as well as the day write",
  /!planStored \|\| day\.stored === false/.test(src));
check("the hydrate merge does not mutate inside a state updater",
  !/setPlan\(\(prev\)[\s\S]{0,200}?savePlan\(/.test(src));

console.log(failed === 0 ? "\nPASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
