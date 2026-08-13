/**
 * The bill total. One definition, because it is money.
 *
 * This formula existed in four places before this file: BillCalculator's
 * `calcTotals`, an inline reduce in the admin Job Summary, `_bill_line_total` in
 * `backend/app/routers/admin.py` (used for the "what changed" correction email),
 * and nowhere at all in the crew closed-job panel - which is why that panel
 * showed "3 line(s)" and no amount. Four copies of an arithmetic rule is three
 * chances for the office and the crew to be looking at different numbers for the
 * same job and both believe they are right.
 *
 * The backend copy stays where it is (it cannot import this), but it computes the
 * same thing and `verify_bill_total.mjs` pins the two together.
 *
 * WHAT "BILL TOTAL" MEANS HERE: line items only, after per-line discounts and
 * then the global discount. Materials are NOT included. That is the convention
 * the admin Job Summary already uses - Bill and Materials are shown as two
 * separate figures, because materials are charged through their own flow and
 * folding them in makes the number impossible to reconcile against either one.
 *
 * Note for anyone comparing screens: the job report's own closed-out view shows
 * a "Bill total" that DOES include materials (it uses BillCalculator's
 * `grandTotal`). Those two numbers differ by the materials charge on purpose,
 * and the labels here say which is which rather than pretending they agree.
 */

/** The fields of a bill line that affect its price. Anything with these works. */
export type BillLineLike = {
  qty?: number | null;
  rate?: number | null;
  discount?: number | null;
};

/** One line, after its own discount. */
export function billLineSubtotal(item: BillLineLike): number {
  const qty = Number(item?.qty) || 0;
  const rate = Number(item?.rate) || 0;
  const discount = Number(item?.discount) || 0;
  return qty * rate * (1 - discount / 100);
}

/**
 * Line items after per-line discounts, then the global discount.
 *
 * Defensive about its input on purpose: this runs against payloads decoded from
 * `items_json`, where a hand-edited row or an older schema can produce a null or
 * a string. `Number(x) || 0` turns those into zero rather than NaN - and a NaN
 * here does not throw, it renders as "$NaN" on a crew phone in front of a
 * customer.
 */
export function billTotal(items: BillLineLike[] | null | undefined, globalDiscountPct?: number | null): number {
  if (!Array.isArray(items) || items.length === 0) return 0;
  const subtotal = items.reduce((sum, item) => sum + billLineSubtotal(item), 0);
  const global = Number(globalDiscountPct) || 0;
  return subtotal * (1 - global / 100);
}

/** US dollars, two places. The one place the app formats a bill amount. */
export function fmtMoney(n: number): string {
  const value = Number.isFinite(n) ? n : 0;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
