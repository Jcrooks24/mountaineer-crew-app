import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api/client";
import { MATERIAL_CATALOG } from "../data/catalog";
import { useTheme } from "../theme/ThemeContext";
import {
  enqueueAdd as storeEnqueueAdd,
  enqueueDeleteOrCancel as storeEnqueueDeleteOrCancel,
  renderedForJob,
  syncQueue,
  fetchAndCache,
  type LiveMaterial,
} from "../lib/materialsStore";

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
      { label: "Overtime (labor only — 1.5 × #movers × $80/hr)", unit: "hr", rate: 0 },
      { label: "Holiday rate (2×)", unit: "hr", rate: 0 },
      { label: "2-hour minimum charge", unit: "flat", rate: 0 },
    ],
  },
  {
    category: "Fees & Surcharges",
    items: [
      { label: "Fuel & mileage surcharge", unit: "mi", rate: 2.25 },
      { label: "Big Sky trip fee", unit: "flat", rate: 125 },
    ],
  },
  {
    category: "Disposal",
    items: [
      { label: "Full dumpster", unit: "flat", rate: 700 },
      { label: "Full truck of trash", unit: "flat", rate: 350 },
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

function materialExt(m: LiveMaterial): number {
  return m.unitPrice == null ? 0 : m.unitPrice * m.qty;
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
  const { settings: themeSettings } = useTheme();
  const ht = themeSettings.helpTexts;
  const [bill, setBill] = useState<Bill>({ items: [], globalDiscount: 0, notes: "" });
  const [loaded, setLoaded] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Materials (live-shared per job, offline-capable via materialsStore)
  const [materials, setMaterials] = useState<LiveMaterial[]>(() => renderedForJob(jobUuid));
  const [matSelectedName, setMatSelectedName] = useState<string>("");
  const [matQty, setMatQty] = useState<number>(1);
  const [matCustomName, setMatCustomName] = useState<string>("");
  const [matCustomCost, setMatCustomCost] = useState<string>("");
  const [matErr, setMatErr] = useState<string>("");
  const [showAddMaterial, setShowAddMaterial] = useState(false);

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
        // No saved bill — seed from events + M1 estimates (materials live separately now)
        apiFetch<SeedData>(`/api/bill/seed?job_uuid=${encodeURIComponent(jobUuid)}`)
          .then((seed) => {
            const items: LineItem[] = [];
            for (const h of seed.hours_lines) {
              items.push({ id: uuid(), label: h.label, qty: h.hours, rate: 0, unit: "hr", discount: 0, source: "hours" });
            }
            if (dumpsterPct > 0) {
              items.push({
                id: uuid(),
                label: `Dumpster use charge (${dumpsterPct}% of full dumpster)`,
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
                label: `Recycling bin use charge (${recyclingPct}% of full dumpster)`,
                qty: 1,
                rate: Math.round((recyclingPct / 100) * DUMPSTER_FULL_COST * 100) / 100,
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

  // ── Materials: local cache + queue (offline-safe) ────────────────────────────
  function refreshMaterials() {
    setMaterials(renderedForJob(jobUuid));
  }

  useEffect(() => {
    // Immediately render from local cache (fast, works offline), then try to
    // drain any queued ops and refetch from the server in the background.
    refreshMaterials();
    (async () => {
      await syncQueue();
      const ok = await fetchAndCache(jobUuid);
      if (ok) refreshMaterials();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobUuid]);

  useEffect(() => {
    async function doSync() {
      if (!jobUuid) return;
      await syncQueue();
      const ok = await fetchAndCache(jobUuid);
      if (ok) refreshMaterials();
    }
    function onVis() {
      if (document.visibilityState === "visible") doSync();
    }
    window.addEventListener("online", doSync);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      window.removeEventListener("online", doSync);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobUuid]);

  // Close add menu on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
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
  }

  function addChargeItem(charge: ChargeItem) {
    setBill((prev) => ({
      ...prev,
      items: [...prev.items, { id: uuid(), label: charge.label, qty: 1, rate: charge.rate, unit: charge.unit, discount: 0, source: "charge" }],
    }));
    setShowAddMenu(false);
  }

  // ── Materials add/remove (live-persisted) ────────────────────────────────────

  function resetMatControls() {
    setMatSelectedName("");
    setMatQty(1);
    setMatCustomName("");
    setMatCustomCost("");
  }

  async function addMaterial() {
    setMatErr("");
    if (!jobUuid) { setMatErr("No job selected"); return; }

    const qty = Number.isFinite(matQty) ? Math.max(1, Math.floor(matQty)) : 1;

    let itemName: string;
    let unitPrice: number | null;
    let baseCost: number | null = null;
    let source: "catalog" | "custom";

    if (matSelectedName && matSelectedName !== "__custom__") {
      const found = MATERIAL_CATALOG.find((m) => m.name === matSelectedName);
      if (!found) { setMatErr("Material not found"); return; }
      itemName = found.name;
      unitPrice = found.unitPrice;
      source = "catalog";
    } else if (matSelectedName === "__custom__") {
      const name = matCustomName.trim();
      if (!name) { setMatErr("Custom name required"); return; }
      itemName = name;
      const costRaw = matCustomCost.trim();
      if (costRaw.length > 0) {
        const parsed = Number(costRaw);
        if (!Number.isFinite(parsed) || parsed < 0) { setMatErr("Cost must be a number"); return; }
        baseCost = parsed;
        unitPrice = parsed * 1.1;
      } else {
        unitPrice = null;
      }
      source = "custom";
    } else {
      setMatErr("Select a material"); return;
    }

    // Queue the add locally — persists across refresh/offline.
    storeEnqueueAdd(jobUuid, jobName, { name: itemName, qty, unitPrice, baseCost, source });
    refreshMaterials();
    resetMatControls();
    setShowAddMaterial(false);

    // Fire-and-forget: try to sync and refresh from server. Offline → stays queued.
    (async () => {
      const synced = await syncQueue();
      if (synced > 0) {
        const ok = await fetchAndCache(jobUuid);
        if (ok) refreshMaterials();
      }
    })();
  }

  function removeMaterial(submissionId: string) {
    storeEnqueueDeleteOrCancel(submissionId, jobUuid);
    refreshMaterials();
    (async () => {
      const synced = await syncQueue();
      if (synced > 0) {
        const ok = await fetchAndCache(jobUuid);
        if (ok) refreshMaterials();
      }
    })();
  }

  const materialsTotal = useMemo(
    () => materials.reduce((s, m) => s + materialExt(m), 0),
    [materials],
  );

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
  const grandTotal = total + materialsTotal;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      <div className="sectionTitle" style={{ marginBottom: 0 }}>Bill Helper</div>
      {jobName && (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 2 }}>
          Bill for: <strong style={{ color: "var(--text)" }}>{jobName}</strong>
        </div>
      )}

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

        {/* ── Materials summary + live list ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 72px 90px 72px 80px 28px",
          gap: 6, padding: "10px 12px",
          background: "rgba(93,214,194,0.06)",
          borderBottom: "1px solid var(--border)",
          borderTop: bill.items.length > 0 ? "1px solid var(--border)" : undefined,
          alignItems: "center",
          fontSize: 13, fontWeight: 700,
        }}>
          <span>Materials</span>
          <span />
          <span />
          <span />
          <span style={{ textAlign: "right", color: materialsTotal > 0 ? "var(--brand)" : "var(--muted)" }}>
            {fmt(materialsTotal)}
          </span>
          <span />
        </div>

        {materials.length > 0 && (
          <div>
            {materials.map((m) => {
              const unit = m.unitPrice == null ? "TBD" : fmt(m.unitPrice);
              const ext = m.unitPrice == null ? "—" : fmt(materialExt(m));
              return (
                <div key={m.submissionId} style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 60px 90px 80px 28px",
                  gap: 6, padding: "6px 12px 6px 28px",
                  borderBottom: "1px solid var(--border)",
                  alignItems: "center",
                  fontSize: 12, color: "var(--text)",
                  opacity: m.pending ? 0.75 : 1,
                }}>
                  <span style={{ color: "var(--muted)" }}>
                    • {m.name}
                    {m.pending && <span title="Waiting to sync" style={{ marginLeft: 6, fontSize: 10, color: "var(--brand)" }}>• syncing</span>}
                  </span>
                  <span style={{ textAlign: "right", color: "var(--muted)" }}>×{m.qty}</span>
                  <span style={{ textAlign: "right", color: "var(--muted)" }}>{unit}</span>
                  <span style={{ textAlign: "right", fontWeight: 600 }}>{ext}</span>
                  <button type="button" onClick={() => removeMaterial(m.submissionId)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 16, padding: 0, lineHeight: 1 }}
                    aria-label="Remove material">×</button>
                </div>
              );
            })}
          </div>
        )}

        {/* Add material — collapsed toggle */}
        <div style={{ padding: "10px 12px 10px 28px", borderBottom: "1px solid var(--border)" }}>
          {!showAddMaterial ? (
            <button
              type="button"
              onClick={() => { setShowAddMaterial(true); setMatErr(""); }}
              style={{ fontSize: 13, color: "var(--brand)", borderColor: "var(--brand)", padding: "6px 14px", borderRadius: 8 }}
            >
              + Add material
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select value={matSelectedName} onChange={(e) => setMatSelectedName(e.target.value)}
                  style={{ flex: "1 1 200px", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }}>
                  <option value="">Select material…</option>
                  {MATERIAL_CATALOG.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name} — {m.unitPrice != null ? fmt(m.unitPrice) : "TBD"}
                    </option>
                  ))}
                  <option value="__custom__">Custom item…</option>
                </select>
                <input type="number" min={1} step={1} value={matQty}
                  onChange={(e) => setMatQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  style={{ width: 64, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, textAlign: "right" }} />
                <button type="button" onClick={addMaterial}
                  style={{ padding: "6px 14px", fontSize: 13, borderRadius: 8, borderColor: "var(--brand)", color: "var(--brand)" }}>
                  Add
                </button>
                <button type="button" onClick={() => { setShowAddMaterial(false); setMatErr(""); resetMatControls(); }}
                  style={{ padding: "6px 10px", fontSize: 12, borderRadius: 8, color: "var(--muted)", background: "none", border: "none", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
              {matSelectedName === "__custom__" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input value={matCustomName} onChange={(e) => setMatCustomName(e.target.value)} placeholder="Custom name"
                    style={{ flex: "2 1 200px", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
                  <input value={matCustomCost} onChange={(e) => setMatCustomCost(e.target.value)} placeholder="Cost (opt.)" inputMode="decimal"
                    style={{ flex: "1 1 120px", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
                </div>
              )}
              {matErr && <div style={{ fontSize: 12, color: "var(--danger)" }}>{matErr}</div>}
            </div>
          )}
        </div>

        {/* Add line item (charges / custom) */}
        <div style={{ padding: "10px 12px" }} ref={addMenuRef}>
          <button
            type="button"
            onClick={() => setShowAddMenu((v) => !v)}
            style={{ fontSize: 13, color: "var(--brand)", borderColor: "var(--brand)", padding: "6px 14px", borderRadius: 8 }}
          >
            + Add line item
          </button>
          {showAddMenu && (
            <div style={{ marginTop: 8, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", boxShadow: "var(--shadow)", zIndex: 10, maxHeight: 420, overflowY: "auto" }}>
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
              <button type="button" onClick={addCustomItem}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "none", border: "none", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
                Custom item…
              </button>
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
            <span>Line-items subtotal</span><span>{fmt(subtotal)}</span>
          </div>
          {discountAmt > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--danger)" }}>
              <span>Discount ({bill.globalDiscount}%)</span><span>−{fmt(discountAmt)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
            <span>Materials</span><span>{fmt(materialsTotal)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 18 }}>
            <span>Total</span>
            <span style={{ color: "var(--brand)" }}>{fmt(grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* ── Notes ── */}
      <div className="card">
        <div className="sectionTitle">Bill Notes</div>
        <textarea value={bill.notes}
          onChange={(e) => setBill((prev) => ({ ...prev, notes: e.target.value }))}
          placeholder={ht.billNotesPlaceholder}
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
