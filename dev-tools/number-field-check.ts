/**
 * Behaviour check for NumberField's keystroke logic.
 *
 * Run: cd frontend && npx tsx ../dev-tools/number-field-check.ts
 *
 * There is no test runner in this repo, and adding one is a bigger decision than
 * a bug fix should make on its own. So the decision logic lives in pure exported
 * functions that the component actually calls, and this drives them directly.
 * It is the real code path, not a restatement of it.
 *
 * The regression being pinned: a qty field defaulting to 1 that could not be
 * cleared, so typing on a phone produced "12" instead of "2".
 */

import { onInput, onLeave, type Bounds } from "../frontend/src/components/NumberField";

const QTY: Bounds = { min: 1, integer: true };
const PCT: Bounds = { min: 0, max: 100 };
const OPTIONAL: Bounds = { min: 0, max: 48, allowEmpty: true };

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond || detail === undefined ? "" : `   ${JSON.stringify(detail)}`));
  if (!cond) failures++;
}

// ── The reported bug ─────────────────────────────────────────────────────────
{
  const cleared = onInput("", QTY);
  check("clearing a qty field leaves the box EMPTY", cleared.text === "", cleared);
  check("clearing does not write a value", cleared.commit === undefined, cleared);

  // The crew member then types 2 into the now-empty box.
  const typed = onInput("2", QTY);
  check("typing after clearing gives 2, not 12", typed.text === "2" && typed.commit === 2, typed);
}

// ── Typing a multi-digit number from empty ───────────────────────────────────
{
  const a = onInput("1", QTY);
  const b = onInput("12", QTY);
  check("intermediate digits are kept verbatim", a.text === "1" && b.text === "12", [a, b]);
  check("each keystroke commits its parsed value", a.commit === 1 && b.commit === 12, [a, b]);
}

// ── Below the minimum ────────────────────────────────────────────────────────
{
  const zero = onInput("0", QTY);
  check("the stored value never goes below min", zero.commit === 1, zero);
  check("but the box still shows what was typed", zero.text === "0", zero);
  const settled = onLeave("0", 1, QTY);
  check("leaving the field tidies the text to the stored value", settled.text === "1", settled);
}

// ── Half-typed input is not clobbered mid-keystroke ──────────────────────────
{
  for (const partial of ["-", ".", "1e", "-."]) {
    const r = onInput(partial, PCT);
    check(`"${partial}" is left alone while typing`, r.text === partial && r.commit === undefined, r);
  }
  check("a half-typed value tidies up on blur", onLeave("1e", 5, PCT).text === "5");
}

// ── Bounds ───────────────────────────────────────────────────────────────────
{
  check("max is enforced on commit", onInput("150", PCT).commit === 100);
  check("blur corrects an out-of-range value", onLeave("150", 20, PCT).commit === 100);
  check("blur does not re-commit an unchanged value", onLeave("20", 20, PCT).commit === undefined);
  check("integer rounds on commit", onInput("2.6", QTY).commit === 3);
  check("non-integer fields keep decimals", onInput("2.5", PCT).commit === 2.5);
}

// ── Optional fields ──────────────────────────────────────────────────────────
{
  const cleared = onInput("", OPTIONAL);
  check("an optional field reports the clear", cleared.clear === true && cleared.commit === undefined, cleared);
  check("an optional field stays empty on blur", onLeave("", null, OPTIONAL).text === "");
  check("a required field restores its value on blur", onLeave("", 7, QTY).text === "7");
  check("an empty optional field renders as empty, not 0", onLeave("", undefined, OPTIONAL).text === "");
}

console.log();
console.log(failures === 0 ? "FAILURES: none" : `FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
