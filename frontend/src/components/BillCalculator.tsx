import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { apiFetch } from "../api/client";
import { MATERIAL_CATALOG } from "../data/catalog";

// ── Types ─────────────────────────────────────────────────────────────────────

type Unit = "hr" | "flat" | "ea" | "mi" | "day" | "lb" | "cu ft";

type LineItem = {
  id: string;
  label: string;
  qty: number;
  rate: number;
  unit: Unit;
  discount: number;   // per-line % (0–100)
  source: "hours" | "materials" | "m1" | "charge" | "custom";
};

type Bill = {
  items: LineItem[];
  globalDiscount: number;
  notes: string;
};

type SeedData = {
  hours_lines: { created_by: string; label: string; hours: number }[];
  material_lines: { name: string; qty: number; unit_price: number }[];
};

export type BillHandle = {
  /** Returns current bill data + reviewed status, or null if not loaded. */
  getData: () => { items: LineItem[]; globalDiscount: number; notes: string; reviewed: boolean } | null;
};

// ── Company charges ───────────────────────────────────────────────────────────

type ChargeItem = { label: string; unit: Unit; rate: number };
type ChargeCategory = { category: string; items: ChargeItem[] };

const COMPANY_CHARGES: ChargeCategory[] = [
  {
    category: "Labor",
    items: [
      { label: "Mover (per hour)", unit: "hr", rate: 80 },
      { label: "Truck (per hour)", unit: "hr", rate: 90 },
      { label: "Crew transport vehicle", unit: "day", rate: 100 },
      { label: "Specialty services", unit: "hr", rate: 225 },
      { label: "Overtime (1.5×)", unit: "hr", rate: 0 },
      { label: "Holiday rate (2×)", unit: "hr", rate: 0 },
      { label: "2-hour minimum charge", unit: "flat", rate: 0 },
    ],
  },
  {
    category: "Fees & Surcharges",
    items: [
      { label: "Fuel & mileage surcharge", unit: "mi", rate: 2.25 },
      { label: "Big Sky trip fee", unit: "flat", rate: 125 },
      { label: "Change order admin fee", unit: "flat", rate: 150 },
      { label: "Credit card processing (3.5%)", unit: "flat", rate: 0 },
      { label: "Late payment fee (1.5%/mo)", unit: "flat", rate: 0 },
      { label: "Deposit (30%)", unit: "flat", rate: 0 },
    ],
  },
  {
    category: "Coverage",
    items: [
      { label: "Default valuation coverage", unit: "lb", rate: 0.6 },
      { label: "Full value coverage (1.25%)", unit: "flat", rate: 0 },
    ],
  },
  {
    category: "Disposal",
    items: [
      { label: "Full dumpster", unit: "flat", rate: 700 },
      { label: "Full truck of trash", unit: "flat", rate: 350 },
    ],
  },
  {
    category: "Crating",
    items: [
      { label: "Stick crate", unit: "cu ft", rate: 32.5 },
      { label: "Solid crate", unit: "cu ft", rate: 42.5 },
    ],
  },
];

const DUMPSTER_FULL_COST = 700;

// ── Helpers ───────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function lineSubtotal(item: LineItem): number {
  return item.qty * item.rate * (1 - item.discount / 100);
}

function calcTotals(items: LineItem[], globalDiscount: number) {
  const subtotal = items.reduce((s, i) => s + lineSubtotal(i), 0);
  const discountAmt = subtotal * (globalDiscount / 100);
  return { subtotal, discountAmt, total: subtotal - discountAmt };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  jobUuid: string;
  jobName: string;
  dumpsterPct?: number;   // 0–100 from M1 estimate
  recyclingPct?: number;  // 0–100 from M1 estimate
};

const BillCalculator = forwardRef<BillHandle, Props>(function BillCalculator(
  { jobUuid, jobName, dumpsterPct = 0, recyclingPct = 0 },
  ref,
) {
  const [bill, setBill] = useState<Bill>({ items: [], globalDiscount: 0, notes: "" });
  const [loaded, setLoaded] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addView, setAddView] = useState<"main" | "packing">("main");
  const addMenuRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    getData: () => loaded ? { ...bill, reviewed } : null,
  }));

  // ── Load: saved bill first, then seed ────────────────────────────────────────
  useEffect(() => {
    if (!jobUuid) { setLoaded(false); return; }
    setLoaded(false);
    setReviewed(false);

    apiFetch<{ items: LineItem[]; global_discount: number; notes: string }>(
      `/api/bill?job_uuid=${encodeURIComponent(jobUuid)}`
    )
      .then((r) => {
        setBill({ items: r.items, globalDiscount: r.global_discount, notes: r.notes ?? "" });
        setLoaded(true);
      })
      .catch(() => {
        // No saved bill — seed from events + materials + M1 estimates
        apiFetch<SeedData>(`/api/bill/seed?job_uuid=${encodeURIComponent(jobUuid)}`)
          .then((seed) => {
            const items: LineItem[] = [];
            for (const h of seed.hours_lines) {
              items.push({ id: uuid(), label: h.label, qty: h.hours, rate: 0, unit: "hr", discount: 0, source: "hours" });
            }
            for (const m of seed.material_lines) {
              items.push({ id: uuid(), label: m.name, qty: m.qty, rate: m.unit_price, unit: "ea", discount: 0, source: "materials" });
            }
            if (dumpsterPct > 0) {
              items.push({
                id: uuid(),
                label: "Dumpster use charge",
                qty: 1,
                rate: Math.round((dumpsterPct / 100) * DUMPSTER_FULL_COST * 100) / 100,
                unit: "flat",
                discount: 0,
                source: "m1",
              });
            }
            if (recyclingPct > 0) {
              items.push({
                id: uuid(),
                label: "Recycling bin use charge",
                qty: 1,
                rate: 0,   // user fills in rate
                unit: "flat",
                discount: 0,
                source: "m1",
              });
            }
            setBill({ items, globalDiscount: 0, notes: "" });
          })
          .catch(() => {})
          .finally(() => setLoaded(true));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobUuid]);

  // Close add menu on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
        setAddView("main");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Mutations ────────────────────────────────────────────────────────────────

  function updateItem(id: string, patch: Partial<LineItem>) {
    setBill((prev) => ({ ...prev, items: prev.items.map((it) => it.id === id ? { ...it, ...patch } : it) }));
  }

  function removeItem(id: string) {
    setBill((prev) => ({ ...prev, items: prev.items.filter((it) => it.id !== id) }));
  }

  function addCustomItem() {
    setBill((prev) => ({
      ...prev,
      items: [...prev.items, { id: uuid(), label: "", qty: 1, rate: 0, unit: "flat", discount: 0, source: "custom" }],
    }));
    setShowAddMenu(false);
    setAddView("main");
  }

  function addChargeItem(charge: ChargeItem) {
    setBill((prev) => ({
      ...prev,
      items: [...prev.items, { id: uuid(), label: charge.label, qty: 1, rate: charge.rate, unit: charge.unit, discount: 0, source: "charge" }],
    }));
    setShowAddMenu(false);
    setAddView("main");
  }

  function addPackingItem(name: string, unitPrice: number | null) {
    setBill((prev) => ({
      ...prev,
      items: [...prev.items, { id: uuid(), label: name, qty: 1, rate: unitPrice ?? 0, unit: "ea", discount: 0, source: "charge" }],
    }));
    setShowAddMenu(false);
    setAddView("main");
  }

  // ── Empty / loading states ────────────────────────────────────────────────────

  if (!jobUuid) {
    return (
      <div className="card" style={{ color: "var(--muted)", textAlign: "center", padding: "28px 16px" }}>
        Select a job to build a bill.
      </div>
    );
  }

  if (!loaded) {
    return <div className="card" style={{ color: "var(--muted)", fontSize: 13, padding: 14 }}>Loading bill…</div>;
  }

  const { subtotal, discountAmt, total } = calcTotals(bill.items, bill.globalDiscount);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      <div className="sectionTitle" style={{ marginBottom: 0 }}>
        Bill Helper {jobName && <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>— {jobName}</span>}
      </div>

      {/* ── Line items ── */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 72px 90px 72px 80px 28px",
          gap: 6, padding: "10px 12px",
          background: "rgba(255,255,255,0.04)",
          borderBottom: "1px solid var(--border)",
          fontSize: 11, fontWeight: 700, color: "var(--muted)",
          textTransform: "uppercase", letterSpacing: "0.04em",
        }}>
          <span>Description</span>
          <span style={{ textAlign: "right" }}>Qty</span>
          <span style={{ textAlign: "right" }}>Rate ($)</span>
          <span style={{ textAlign: "right" }}>Disc %</span>
          <span style={{ textAlign: "right" }}>Amount</span>
          <span />
        </div>

        {bill.items.length === 0 && (
          <div style={{ padding: "20px 14px", color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
            No line items — add some below.
          </div>
        )}

        {bill.items.map((item) => (
          <LineItemRow key={item.id} item={item} onChange={(p) => updateItem(item.id, p)} onRemove={() => removeItem(item.id)} />
        ))}

        {/* Add button */}
        <div style={{ padding: "10px 12px", borderTop: bill.items.length > 0 ? "1px solid var(--border)" : undefined }} ref={addMenuRef}>
          <button
            type="button"
            onClick={() => { setShowAddMenu((v) => !v); setAddView("main"); }}
            style={{ fontSize: 13, color: "var(--brand)", borderColor: "var(--brand)", padding: "6px 14px", borderRadius: 8 }}
          >
            + Add line item
          </button>
          {showAddMenu && (
            <div style={{ marginTop: 8, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", boxShadow: "var(--shadow)", zIndex: 10, maxHeight: 420, overflowY: "auto" }}>
              {addView === "main" ? (
                <>
                  {COMPANY_CHARGES.map((cat) => (
                    <div key={cat.category}>
                      <div style={{ padding: "7px 14px 4px", fontSize: 10, fontWeight: 700, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,0.03)" }}>
                        {cat.category}
                      </div>
                      {cat.items.map((charge) => (
                        <button key={charge.label} type="button" onClick={() => addChargeItem(charge)}
                          style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", textAlign: "left", padding: "9px 14px", background: "none", border: "none", borderBottom: "1px solid var(--border)", color: "var(--text)", fontSize: 13, cursor: "pointer", gap: 8 }}>
                          <span>{charge.label}</span>
                          <span style={{ color: "var(--muted)", fontSize: 11, flexShrink: 0 }}>
                            {charge.rate > 0 ? `${fmt(charge.rate)}/${charge.unit}` : charge.unit}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                  {/* Packing materials section */}
                  <div>
                    <div style={{ padding: "7px 14px 4px", fontSize: 10, fontWeight: 700, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,0.03)" }}>
                      Packing Materials
                    </div>
                    <button type="button" onClick={() => setAddView("packing")}
                      style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", background: "none", border: "none", borderBottom: "1px solid var(--border)", color: "var(--brand)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      <span>Browse packing materials…</span>
                      <span style={{ fontSize: 16 }}>›</span>
                    </button>
                  </div>
                  {/* Custom */}
                  <button type="button" onClick={addCustomItem}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "none", border: "none", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
                    Custom item…
                  </button>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,0.03)" }}>
                    <button type="button" onClick={() => setAddView("main")}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--brand)", fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0 }}>
                      ‹
                    </button>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Packing Materials
                    </span>
                  </div>
                  {MATERIAL_CATALOG.map((m) => (
                    <button key={m.name} type="button" onClick={() => addPackingItem(m.name, m.unitPrice)}
                      style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", textAlign: "left", padding: "9px 14px", background: "none", border: "none", borderBottom: "1px solid var(--border)", color: "var(--text)", fontSize: 13, cursor: "pointer", gap: 8 }}>
                      <span>{m.name}</span>
                      <span style={{ color: "var(--muted)", fontSize: 11, flexShrink: 0 }}>
                        {m.unitPrice != null ? fmt(m.unitPrice) : "TBD"}/ea
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Totals ── */}
      <div className="card">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Global discount (%)</label>
            <input type="number" min={0} max={100} step={1} value={bill.globalDiscount}
              onChange={(e) => setBill((prev) => ({ ...prev, globalDiscount: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))}
              style={{ ...numInputStyle, width: 80 }} />
          </div>
          <div style={{ height: 1, background: "var(--border)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
            <span>Subtotal</span><span>{fmt(subtotal)}</span>
          </div>
          {discountAmt > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--danger)" }}>
              <span>Discount ({bill.globalDiscount}%)</span><span>−{fmt(discountAmt)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 18 }}>
            <span>Total</span>
            <span style={{ color: "var(--brand)" }}>{fmt(total)}</span>
          </div>
        </div>
      </div>

      {/* ── Notes ── */}
      <div className="card">
        <div className="sectionTitle">Bill Notes</div>
        <textarea value={bill.notes}
          onChange={(e) => setBill((prev) => ({ ...prev, notes: e.target.value }))}
          placeholder="Any notes to include with this bill…"
          rows={3}
          style={{ width: "100%", marginTop: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, resize: "vertical", boxSizing: "border-box" }} />
      </div>

      {/* ── Review confirmation ── */}
      <div className="card">
        <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)}
            style={{ marginTop: 3, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }} />
          <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>
            I have reviewed and confirmed the correctness of the auto-populated line items above.
          </span>
        </label>
      </div>
    </div>
  );
});

export default BillCalculator;

// ── LineItemRow ────────────────────────────────────────────────────────────────

function LineItemRow({ item, onChange, onRemove }: {
  item: LineItem;
  onChange: (p: Partial<LineItem>) => void;
  onRemove: () => void;
}) {
  const subtotal = lineSubtotal(item);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 72px 90px 72px 80px 28px", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
      <input value={item.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="Description" style={{ ...cellInputStyle, fontSize: 13 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <input type="number" min={0} step={0.25} value={item.qty}
          onChange={(e) => onChange({ qty: Math.max(0, Number(e.target.value) || 0) })} style={numInputStyle} />
        <select value={item.unit} onChange={(e) => onChange({ unit: e.target.value as Unit })} style={{ ...selectStyle, fontSize: 10 }}>
          <option value="hr">hr</option>
          <option value="ea">ea</option>
          <option value="flat">flat</option>
          <option value="mi">mi</option>
          <option value="day">day</option>
          <option value="lb">lb</option>
          <option value="cu ft">cu ft</option>
        </select>
      </div>
      <input type="number" min={0} step={0.01} value={item.rate}
        onChange={(e) => onChange({ rate: Math.max(0, Number(e.target.value) || 0) })} placeholder="0.00" style={numInputStyle} />
      <input type="number" min={0} max={100} step={1} value={item.discount}
        onChange={(e) => onChange({ discount: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} style={numInputStyle} />
      <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: subtotal > 0 ? "var(--text)" : "var(--muted)" }}>
        {fmt(subtotal)}
      </div>
      <button type="button" onClick={onRemove}
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 16, padding: 0, lineHeight: 1 }}
        aria-label="Remove">×</button>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const cellInputStyle: React.CSSProperties = {
  width: "100%", padding: "5px 8px", borderRadius: 6,
  border: "1px solid var(--border)", background: "var(--bg)",
  color: "var(--text)", fontSize: 13, boxSizing: "border-box",
};
const numInputStyle: React.CSSProperties = { ...cellInputStyle, textAlign: "right" };
const selectStyle: React.CSSProperties = {
  width: "100%", padding: "3px 4px", borderRadius: 4,
  border: "1px solid var(--border)", background: "var(--bg)",
  color: "var(--muted)", fontSize: 11, boxSizing: "border-box",
};
