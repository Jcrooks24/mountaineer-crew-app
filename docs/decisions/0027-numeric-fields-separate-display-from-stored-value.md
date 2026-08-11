# 0027. A numeric field's displayed text is not its stored value

**Status:** Active. Added 2026-07-27 after a crew report that the BOL item
quantity "sticks at 1 and can't be changed", which was the third time this same
shape of bug has been reported.

## Context

The pattern that keeps coming back looks completely reasonable:

```tsx
value={it.qty}
onChange={(e) => updateItem(it.item_no, { qty: Math.max(1, Number(e.target.value || 1)) })}
```

Clear the box and `e.target.value` is `""`. `"" || 1` is `1`, `Math.max(1, 1)`
is `1`, and React re-renders `1` straight back into the field. **The field can
never be empty**, so on a phone the caret sits after the stuck digit and a crew
member trying to enter 2 gets `12`. To them it reads as a value that refuses to
be changed.

It kept coming back because each report was fixed at the one input that was
reported, and the next screen to grow a numeric field re-derived the same
coercion from scratch. It was found in eight places on the sweep for this fix:
both BOL forms (add-item qty and per-item qty), and the Invoice Builder's global
discount, line qty, rate, and line discount, where clearing the box snapped it to
`0` instead of `1`.

The screens that got it right (Estimator, Reimbursement, DVIR, Long Distance) had
each independently discovered the same workaround: hold the field as a **string**
in state and only convert to a number at save or blur.

## Decision

`frontend/src/components/NumberField.tsx` is the single numeric input. It
separates what is DISPLAYED from what is STORED:

- While the field has focus, the raw text the user typed is what renders,
  **including the empty string**. Nothing is coerced back into the box.
- The stored value updates only when the text parses to a real number, clamped
  on the way through, so callers never see NaN or an out-of-range value.
- An empty box writes nothing. The last good value stands until the user types a
  new one - or, with `allowEmpty`, `onEmpty` fires so an optional field can be
  genuinely cleared.
- Text that is not yet a number (`-`, `.`, `1e`) is left alone. The user is mid
  keystroke.
- On blur the text normalizes back to the stored value, so a half-typed or
  out-of-range entry tidies itself up on the way out.

The decision logic is exported as the pure functions `onInput` and `onLeave`,
which the component itself calls. `dev-tools/number-field-check.ts` drives those
functions directly (`npx tsx ../dev-tools/number-field-check.ts` from
`frontend/`). This repo has no test runner and adding one was a bigger decision
than a bug fix should make on its own, so the logic was shaped to be testable
without a DOM instead.

## Consequences

- A crew member can clear a quantity and type a new one. That is the whole point.
- Callers get a guaranteed-valid number and can drop their own defensive
  coercion. `min`/`max`/`integer` move to props.
- Transiently, the box can show text that disagrees with the stored value (typing
  `0` into a `min={1}` field shows `0` while `1` is stored). That is deliberate:
  the alternative is fighting the user's keystrokes, which is the bug.
- One shared component means the next numeric field is a one-liner, which is the
  only durable fix for a pattern that has recurred three times.

## What would break if you undid this

- **Going back to `onChange={(e) => setX(Number(e.target.value) || fallback)}`**
  reintroduces the exact field-won't-clear bug, in a way that looks correct in
  code review and only shows up on a phone with a keyboard open.
- **"Simplifying" `NumberField` by clamping the text as well as the value**
  reintroduces it too. The clamp belongs on the committed value only.
- **Removing the empty-string path** (treating `""` as `0` or as the min) is the
  same bug wearing a different hat.
- **Inlining `onInput`/`onLeave` back into the component body** costs the only
  automated coverage this behaviour has, since there is no DOM test setup to fall
  back on.
