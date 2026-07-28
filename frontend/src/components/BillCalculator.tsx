import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, ApiError } from "../api/client";
import { MATERIAL_CATALOG } from "../data/catalog";
import { useTheme } from "../theme/ThemeContext";
import {
  enqueueAdd as storeEnqueueAdd,
  enqueueDeleteOrCancel as storeEnqueueDeleteOrCancel,
  renderedForJob,
  retryFailedMaterial,
  discardFailedMaterial,
  syncQueue,
  fetchAndCache,
  type LiveMaterial,
} from "../lib/materialsStore";
import { roundBillableQuarter, DEFAULT_LABOR_RATE, type EmployeeHoursEntry } from "../lib/employeeHours";
import BetaTag from "./BetaTag";
import NumberField from "./NumberField";

// ── Types ─────────────────────────────────────────────────────────────────────

type Unit = "hr" | "flat" | "ea" | "mi" | "day" | "lb" | "cu ft";

type LineItem = {
  id: string;
  label: string;
  qty: number;
  rate: number;
  unit: Unit;
  discount: number;   // per-line % (0–100)
  source: "hours" | "materials" | "m1" | "charge" | "custom" | "tips" | "personal_vehicle" | "truck";
};

type Bill = {
  items: LineItem[];
  globalDiscount: number;
  notes: string;
};

export type BillHandle = {
  /** Returns current bill data, or null if not loaded. The "reviewed"
   * confirmation lives on the Report (after the M1 sliders) - not here. */
  getData: () => { items: LineItem[]; globalDiscount: number; notes: string } | null;
  /** Discard the in-progress localStorage draft for the active job. Called
   * by JobReport after a successful submit so the next load reads the
   * server's authoritative copy instead of the stale draft. */
  clearDraft: () => void;
  /** Cancel the autosave debounce and write the current bill values to
   * localStorage *now*. JobReport calls this right before POSTing so a
   * fast click after typing can't submit with a stale draft on disk
   * (the load-effect fallback would otherwise restore the wrong state
   * if the POST fails and the user navigates away). */
  flushDraft: () => void;
};

// In-progress bill draft persisted to localStorage so notes / discounts /
// manual line-item edits survive tab switches, reloads, and offline use.
// Per-job_uuid keying mirrors the report-tab draft (REPORT_DRAFT_PREFIX in
// JobReport.tsx). Cleared on successful submit via clearDraft().
const BILL_DRAFT_PREFIX = "crew_bill_draft_v1:";

function billDraftKey(uuid: string) {
  return `${BILL_DRAFT_PREFIX}${uuid || "none"}`;
}
function loadBillDraft(uuid: string): Bill | null {
  try {
    const raw = localStorage.getItem(billDraftKey(uuid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) return null;
    return {
      items: parsed.items,
      globalDiscount: Number(parsed.globalDiscount) || 0,
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
    };
  } catch {
    return null;
  }
}
function saveBillDraft(uuid: string, bill: Bill) {
  try {
    localStorage.setItem(billDraftKey(uuid), JSON.stringify({ ...bill, savedAt: new Date().toISOString() }));
  } catch {}
}
// When the draft was last saved - used to resolve draft-vs-server on load so a
// stale local draft can't hide a bill updated on another device.
function loadBillDraftSavedAt(uuid: string): string {
  try {
    const raw = localStorage.getItem(billDraftKey(uuid));
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return typeof parsed?.savedAt === "string" ? parsed.savedAt : "";
  } catch {
    return "";
  }
}
function clearBillDraftStorage(uuid: string) {
  try {
    localStorage.removeItem(billDraftKey(uuid));
  } catch {}
}

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
      { label: "Overtime (labor only - 1.5 × #movers × $80/hr)", unit: "hr", rate: 0 },
      { label: "Holiday rate (2×)", unit: "hr", rate: 0 },
      { label: "2-hour minimum charge", unit: "flat", rate: 0 },
    ],
  },
  {
    category: "Fees & Surcharges",
    items: [
      { label: "Fuel & mileage surcharge", unit: "mi", rate: 2.25 },
      { label: "Big Sky trip fee", unit: "flat", rate: 125 },
      { label: "Dump fee (weight-based - enter rate charged by the dump)", unit: "flat", rate: 0 },
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

// When `children` is supplied, the parent positions the three slots itself -
// lets JobReport interleave M1 cards between Bill Helper and Discounts/Total
// without exporting BillCalculator's internal state. Default render keeps the
// original stacked layout for any caller that still uses BillCalculator as a
// drop-in.
export type BillSlots = {
  billHelper: ReactNode;
  totals: ReactNode;
  notes: ReactNode;
};

type Props = {
  jobUuid: string;
  jobName: string;
  dumpsterPct?: number;   // 0–100 from M1 estimate
  recyclingPct?: number;  // 0–100 from M1 estimate
  // Employee hours entries from the Report tab. Billable rows auto-populate
  // one labor line per employee at DEFAULT_LABOR_RATE; the crew can then
  // edit the rate/qty per line. Non-billable rows are skipped.
  employeeHours?: EmployeeHoursEntry[];
  // Personal vehicles the crew flagged to bill as crew transport ($100/day).
  // Number of vehicles; 0 means "don't bill". One line item per vehicle.
  personalVehicleCount?: number;
  // Number of trucks recorded in the Report's Truck fullness section. Each one
  // auto-populates a "Truck (per hour)" line at $90/hr, mirroring how employee
  // hours auto-populate labor lines. 0 = no trucks recorded.
  truckCount?: number;
  children?: (slots: BillSlots) => ReactNode;
};

const BillCalculator = forwardRef<BillHandle, Props>(function BillCalculator(
  { jobUuid, jobName, dumpsterPct = 0, recyclingPct = 0, employeeHours, personalVehicleCount, truckCount, children },
  ref,
) {
  const { settings: themeSettings } = useTheme();
  const ht = themeSettings.helpTexts;
  const [bill, setBill] = useState<Bill>({ items: [], globalDiscount: 0, notes: "" });
  const [loaded, setLoaded] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Materials (live-shared per job, offline-capable via materialsStore)
  const [materials, setMaterials] = useState<LiveMaterial[]>(() => renderedForJob(jobUuid));
  const [matSelectedName, setMatSelectedName] = useState<string>("");
  // Kept as string so the user can clear the field and retype; clamped on
  // blur and on addMaterial. A numeric-clamped state snaps back to 1 mid-edit
  // and makes the field uneditable.
  const [matQty, setMatQty] = useState<string>("1");
  const [matCustomName, setMatCustomName] = useState<string>("");
  const [matCustomCost, setMatCustomCost] = useState<string>("");
  const [matErr, setMatErr] = useState<string>("");
  const [showAddMaterial, setShowAddMaterial] = useState(false);

  // Debounce timer for the bill draft autosave. Pending writes are
  // cancelled by clearDraft() so a save can't sneak through after submit.
  const billSaveTimeoutRef = useRef<number | null>(null);
  function cancelPendingBillSave() {
    if (billSaveTimeoutRef.current !== null) {
      window.clearTimeout(billSaveTimeoutRef.current);
      billSaveTimeoutRef.current = null;
    }
  }

  useImperativeHandle(ref, () => ({
    getData: () => loaded ? { ...bill } : null,
    clearDraft: () => {
      cancelPendingBillSave();
      if (jobUuid) clearBillDraftStorage(jobUuid);
    },
    flushDraft: () => {
      cancelPendingBillSave();
      if (jobUuid && loaded) saveBillDraft(jobUuid, bill);
    },
  }));

  // ── Load: saved bill first, then seed ────────────────────────────────────────
  useEffect(() => {
    if (!jobUuid) { setLoaded(false); return; }
    setLoaded(false);

    // Load order: server bill (or seed on 404), then the localStorage draft
    // wins if one exists. Drafts represent the user's most-recent typing on
    // this device - clobbering them with stale server data on every refresh
    // was what made bill notes feel like they didn't autosave.
    apiFetch<{ items: LineItem[]; global_discount: number; notes: string; updated_at?: string }>(
      `/api/bill?job_uuid=${encodeURIComponent(jobUuid)}`
    )
      .then((r) => {
        // A local draft wins only when saved after the server's last update;
        // otherwise the server bill (possibly edited on another device) wins.
        const draft = loadBillDraft(jobUuid);
        const serverUpdated = r.updated_at || "";
        const draftWins = !!draft && (!serverUpdated || loadBillDraftSavedAt(jobUuid) >= serverUpdated);
        if (draftWins && draft) {
          setBill(draft);
        } else {
          if (draft) clearBillDraftStorage(jobUuid);
          setBill({ items: r.items, globalDiscount: r.global_discount, notes: r.notes ?? "" });
        }
        setLoaded(true);
      })
      .catch((e) => {
        // Real 404 = no saved bill yet, seed from events + M1 estimates.
        // Network errors / 5xx must NOT fall through to the seed path -
        // the seed call would also fail, leaving us with no bill data
        // even though the user may have a perfectly good draft. Restore
        // the draft directly and bail.
        if (!(e instanceof ApiError) || e.status !== 404) {
          const draft = loadBillDraft(jobUuid);
          if (draft) setBill(draft);
          setLoaded(true);
          return;
        }

        // 404 path - no saved bill yet. Restore local draft if any, else
        // start empty. Labor autopopulate was removed (the seeded hours
        // lines had a sticky $0 rate placeholder that wouldn't clear on
        // edit). Dumpster/recycling m1 lines are still driven live from
        // the sliders - see the sync effect below.
        const draft = loadBillDraft(jobUuid);
        if (draft) setBill(draft);
        setLoaded(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobUuid]);

  // ── Debounced bill draft autosave ────────────────────────────────────────
  // Captures every change to items / globalDiscount / notes once the bill is
  // loaded so a tab switch or refresh doesn't lose the work. Cleared on
  // successful submit by JobReport calling our clearDraft handle.
  useEffect(() => {
    if (!loaded || !jobUuid) return;
    cancelPendingBillSave();
    billSaveTimeoutRef.current = window.setTimeout(() => {
      billSaveTimeoutRef.current = null;
      saveBillDraft(jobUuid, bill);
    }, 750);
    return cancelPendingBillSave;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill, jobUuid, loaded]);

  // ── Keep M1 line items (dumpster/recycling) in sync with the Report sliders.
  // Runs after initial load, whenever either slider changes.
  useEffect(() => {
    if (!loaded) return;
    setBill((prev) => {
      function computeLine(
        items: LineItem[],
        matchLabel: RegExp,
        pct: number,
        labelTemplate: (pct: number, rate: number) => string,
      ): LineItem[] {
        const idx = items.findIndex((it) => it.source === "m1" && matchLabel.test(it.label));
        const rate = Math.round((pct / 100) * DUMPSTER_FULL_COST * 100) / 100;
        if (pct <= 0) {
          // Remove if present
          return idx >= 0 ? items.filter((_, i) => i !== idx) : items;
        }
        const label = labelTemplate(pct, rate);
        if (idx < 0) {
          return [
            ...items,
            { id: uuid(), label, qty: 1, rate, unit: "flat", discount: 0, source: "m1" },
          ];
        }
        const existing = items[idx];
        if (existing.rate === rate && existing.label === label) return items;
        const next = items.slice();
        next[idx] = { ...existing, rate, label };
        return next;
      }

      let items = prev.items;
      items = computeLine(
        items,
        /Dumpster/i,
        dumpsterPct,
        (p, _r) => `Dumpster use charge (${p}% of full dumpster)`,
      );
      items = computeLine(
        items,
        /Recycling/i,
        recyclingPct,
        (p, _r) => `Recycling bin use charge (${p}% of full dumpster)`,
      );

      if (items === prev.items) return prev;
      return { ...prev, items };
    });
  }, [loaded, dumpsterPct, recyclingPct]);

  // ── Keep labor line items in sync with the Report's Employee Hours ──
  // One line per billable employee, defaulted to DEFAULT_LABOR_RATE/hr.
  // Preserves any user-edited rate/discount on an existing matching line
  // (matched by "Labor - {employee name}") so bumping someone's rate to
  // $90 sticks even after they log another break. Skipped entirely when
  // the parent hasn't provided employeeHours yet - otherwise the saved
  // labor lines from the server would be wiped on load before the parent
  // hydrates the array.
  useEffect(() => {
    if (!loaded || employeeHours === undefined) return;
    const list = employeeHours;
    setBill((prev) => {
      const hoursLabel = (name: string) => `Labor - ${name}`;
      const desired = list
        .filter((e) => !e.non_billable && (e.name || "").trim().length > 0)
        .map((e) => {
          const label = hoursLabel(e.name.trim());
          const existing = prev.items.find(
            (it) => it.source === "hours" && it.label === label,
          );
          return {
            id: existing?.id ?? uuid(),
            label,
            qty: roundBillableQuarter(e.hours || 0),
            rate: existing ? existing.rate : DEFAULT_LABOR_RATE,
            unit: "hr" as Unit,
            discount: existing?.discount ?? 0,
            source: "hours" as const,
          };
        });

      const otherItems = prev.items.filter((it) => it.source !== "hours");
      const nextItems = [...otherItems, ...desired];

      // Bail out if nothing actually changed - keeps the debounced draft
      // save quiet on renders that touched employeeHours reference only.
      if (nextItems.length === prev.items.length) {
        const same = nextItems.every((n, i) => {
          const p = prev.items[i];
          return p && p.id === n.id && p.label === n.label &&
            p.qty === n.qty && p.rate === n.rate && p.unit === n.unit &&
            p.discount === n.discount && p.source === n.source;
        });
        if (same) return prev;
      }
      return { ...prev, items: nextItems };
    });
  }, [loaded, employeeHours]);

  // ── Personal vehicles billed as crew transport ($100/vehicle/day) ──
  // Report tab checkbox drives the count; N vehicles ⇒ N line items so
  // admin can see one row per vehicle in the sheet. Rate stays at 100
  // unless the crew hand-edits it (mirrors the labor-line preservation).
  useEffect(() => {
    if (!loaded || personalVehicleCount === undefined) return;
    setBill((prev) => {
      const desired = [] as LineItem[];
      for (let i = 1; i <= personalVehicleCount; i++) {
        const label = `Crew transport vehicle #${i}`;
        const existing = prev.items.find((it) => it.source === "personal_vehicle" && it.label === label);
        desired.push({
          id: existing?.id ?? uuid(),
          label,
          qty: 1,
          rate: existing ? existing.rate : 100,
          unit: "day",
          discount: existing?.discount ?? 0,
          source: "personal_vehicle",
        });
      }
      const otherItems = prev.items.filter((it) => it.source !== "personal_vehicle");
      const nextItems = [...otherItems, ...desired];
      if (nextItems.length === prev.items.length) {
        const same = nextItems.every((n, i) => {
          const p = prev.items[i];
          return p && p.id === n.id && p.label === n.label &&
            p.qty === n.qty && p.rate === n.rate && p.unit === n.unit &&
            p.discount === n.discount && p.source === n.source;
        });
        if (same) return prev;
      }
      return { ...prev, items: nextItems };
    });
  }, [loaded, personalVehicleCount]);

  // ── Trucks billed per hour ($90/hr) ──
  // Each truck recorded in the Report's Truck fullness section gets one "Truck
  // (per hour)" line, so admin doesn't hand-add them. The hours default to the
  // job's longest single shift (a truck runs at least the length of the longest
  // crew member's day) as a starting point admin can adjust; a truck line the
  // admin has already edited keeps its qty and rate on later renders, like the
  // labor and vehicle lines.
  useEffect(() => {
    if (!loaded || truckCount === undefined) return;
    // Longest billable shift, as the default truck-hours proxy.
    const defaultTruckHours = (employeeHours ?? []).reduce(
      (max, e) => (e.non_billable ? max : Math.max(max, roundBillableQuarter(e.hours || 0))),
      0,
    ) || 1;
    setBill((prev) => {
      const desired = [] as LineItem[];
      for (let i = 1; i <= truckCount; i++) {
        const label = `Truck #${i} (per hour)`;
        const existing = prev.items.find((it) => it.source === "truck" && it.label === label);
        desired.push({
          id: existing?.id ?? uuid(),
          label,
          // Preserve an admin-edited value; only default on first creation.
          qty: existing ? existing.qty : defaultTruckHours,
          rate: existing ? existing.rate : 90,
          unit: "hr",
          discount: existing?.discount ?? 0,
          source: "truck",
        });
      }
      const otherItems = prev.items.filter((it) => it.source !== "truck");
      const nextItems = [...otherItems, ...desired];
      if (nextItems.length === prev.items.length) {
        const same = nextItems.every((n, i) => {
          const p = prev.items[i];
          return p && p.id === n.id && p.label === n.label &&
            p.qty === n.qty && p.rate === n.rate && p.unit === n.unit &&
            p.discount === n.discount && p.source === n.source;
        });
        if (same) return prev;
      }
      return { ...prev, items: nextItems };
    });
    // employeeHours only feeds the DEFAULT for a new line; existing lines are
    // preserved, so re-running when hours change won't stomp an admin edit.
  }, [loaded, truckCount, employeeHours]);

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
    // `focus` overlaps with `visibilitychange` on mobile (both fire on tab
    // return), which doubled the refresh rate. visibilitychange alone is
    // enough; the in-flight dedupe in fetchAndCache handles overlap from
    // online + visibilitychange.
    window.addEventListener("online", doSync);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("online", doSync);
      document.removeEventListener("visibilitychange", onVis);
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

  function addTipsItem() {
    setBill((prev) => ({
      ...prev,
      items: [...prev.items, { id: uuid(), label: "Tips", qty: 1, rate: 0, unit: "flat", discount: 0, source: "tips" }],
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
    setMatQty("1");
    setMatCustomName("");
    setMatCustomCost("");
  }

  async function addMaterial() {
    setMatErr("");
    if (!jobUuid) { setMatErr("No job selected"); return; }

    const parsedQty = Number(matQty);
    const qty = Number.isFinite(parsedQty) ? Math.max(1, Math.floor(parsedQty)) : 1;

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

    // Queue the add locally - persists across refresh/offline.
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
    const placeholder = (
      <div className="card" style={{ color: "var(--muted)", textAlign: "center", padding: "28px 16px" }}>
        Select a job to build a bill.
      </div>
    );
    if (children) return <>{children({ billHelper: placeholder, totals: null, notes: null })}</>;
    return placeholder;
  }

  if (!loaded) {
    const placeholder = (
      <div className="card" style={{ color: "var(--muted)", fontSize: 13, padding: 14 }}>Loading bill…</div>
    );
    if (children) return <>{children({ billHelper: placeholder, totals: null, notes: null })}</>;
    return placeholder;
  }

  const { subtotal, discountAmt, total } = calcTotals(bill.items, bill.globalDiscount);
  const grandTotal = total + materialsTotal;

  // ── Render ────────────────────────────────────────────────────────────────────
  // Build the three sections as slot nodes so a render-prop caller can
  // interleave them with its own cards. When no `children` is provided we
  // fall back to the original stacked layout.
  const billHelperSlot = (
    <>
      <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 0 }}>
        <div className="sectionTitle" style={{ marginBottom: 0 }}>Invoice Builder</div>
        <BetaTag feature="autoLaborLines" style={{ marginTop: 0 }} />
      </div>
      {jobName && (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 2 }}>
          Bill for: <strong style={{ color: "var(--text)" }}>{jobName}</strong>
        </div>
      )}

      {/* ── Line items ──
          Card owns the horizontal scroll so the six-column grid can stay
          intact on a narrow phone rather than wrapping chaotically. Every
          inner row uses minWidth: 430 so the scroll position lines up. */}
      <div className="card" style={{ padding: 0, overflowX: "auto", overflowY: "hidden" }}>
        {/* Header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "minmax(140px, 1fr) 72px 90px 72px 80px 28px",
          minWidth: 430,
          gap: 6, padding: "10px 12px",
          background: "rgba(255,255,255,0.08)",
          borderBottom: "1px solid var(--border)",
          fontSize: 11, fontWeight: 800, color: "var(--text)",
          opacity: 0.85,
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
            No line items - add some below.
          </div>
        )}

        {bill.items.map((item) => (
          <LineItemRow key={item.id} item={item} onChange={(p) => updateItem(item.id, p)} onRemove={() => removeItem(item.id)} />
        ))}

        {/* ── Materials summary + live list ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "minmax(140px, 1fr) 72px 90px 72px 80px 28px",
          minWidth: 430,
          gap: 6, padding: "10px 12px",
          background: "color-mix(in srgb, var(--brand) 6%, transparent)",
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
              const ext = m.unitPrice == null ? "-" : fmt(materialExt(m));
              return (
                <div key={m.submissionId}>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 60px 90px 80px 28px",
                    gap: 6, padding: "6px 12px 6px 28px",
                    borderBottom: m.failed ? "none" : "1px solid var(--border)",
                    alignItems: "center",
                    fontSize: 12, color: "var(--text)",
                    opacity: m.pending && !m.failed ? 0.75 : 1,
                  }}>
                    <span style={{ color: "var(--muted)" }}>
                      • {m.name}
                      {m.failed
                        ? <span style={{ marginLeft: 6, fontSize: 10, color: "var(--danger)", fontWeight: 700 }}>NOT SENT</span>
                        : m.pending && <span title="Waiting to sync" style={{ marginLeft: 6, fontSize: 10, color: "var(--brand)" }}>• syncing</span>}
                    </span>
                    <span style={{ textAlign: "right", color: "var(--muted)" }}>×{m.qty}</span>
                    <span style={{ textAlign: "right", color: "var(--muted)" }}>{unit}</span>
                    <span style={{ textAlign: "right", fontWeight: 600 }}>{ext}</span>
                    <button type="button" onClick={() => removeMaterial(m.submissionId)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 16, padding: 0, lineHeight: 1 }}
                      aria-label="Remove material">×</button>
                  </div>
                  {/* The server refused this item. It is kept, not deleted (ADR
                      0013); the crew see why and can retry or discard. */}
                  {m.failed && (
                    <div style={{ padding: "0 12px 8px 28px", borderBottom: "1px solid var(--border)" }}>
                      <div className="small" style={{ color: "var(--muted)" }}>{m.failedReason || "The server rejected this."}</div>
                      <div className="row" style={{ gap: 8, marginTop: 4 }}>
                        <button type="button" onClick={() => { void retryFailedMaterial(m.submissionId).then(refreshMaterials); }}
                          style={{ padding: "4px 10px", fontSize: 12, minHeight: 36, borderRadius: 8, border: "1px solid var(--brand)", background: "transparent", color: "var(--brand)", fontWeight: 700 }}>Retry</button>
                        <button type="button" onClick={() => { discardFailedMaterial(m.submissionId); refreshMaterials(); }}
                          style={{ padding: "4px 10px", fontSize: 12, minHeight: 36, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)" }}>Discard</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add material - collapsed toggle */}
        <div style={{ padding: "10px 12px 10px 28px", borderBottom: "1px solid var(--border)" }}>
          {!showAddMaterial ? (
            <button
              type="button"
              onClick={() => { setShowAddMaterial(true); setMatErr(""); }}
              style={{ fontSize: 13, color: "var(--text)", borderColor: "var(--brand)", padding: "6px 14px", borderRadius: 8 }}
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
                      {m.name} - {m.unitPrice != null ? fmt(m.unitPrice) : "TBD"}
                    </option>
                  ))}
                  <option value="__custom__">Custom item…</option>
                </select>
                <input type="number" min={1} step={1} inputMode="numeric" value={matQty}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setMatQty(e.target.value)}
                  onBlur={() => {
                    const n = Number(matQty);
                    setMatQty(String(Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1));
                  }}
                  style={{ width: 64, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, textAlign: "right" }} />
                <button type="button" onClick={addMaterial}
                  style={{ padding: "6px 14px", fontSize: 13, borderRadius: 8, borderColor: "var(--brand)", color: "var(--text)" }}>
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
            style={{ fontSize: 13, color: "var(--text)", borderColor: "var(--brand)", padding: "6px 14px", borderRadius: 8 }}
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
              <button type="button" onClick={addTipsItem}
                style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", textAlign: "left", padding: "10px 14px", background: "none", border: "none", borderBottom: "1px solid var(--border)", color: "var(--text)", fontSize: 13, cursor: "pointer", gap: 8 }}>
                <span>Tips</span>
                <span style={{ color: "var(--muted)", fontSize: 11, flexShrink: 0 }}>flat</span>
              </button>
              <button type="button" onClick={addCustomItem}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "none", border: "none", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
                Custom item…
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  const totalsSlot = (
    <div className="card">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <label style={{ fontSize: 13, color: "var(--muted)" }}>Global discount (%)</label>
          <NumberField min={0} max={100} step={1} value={bill.globalDiscount}
            aria-label="Global discount percent"
            onChange={(globalDiscount) => setBill((prev) => ({ ...prev, globalDiscount }))}
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
  );

  const notesSlot = (
    <div className="card">
      <div className="sectionTitle">Bill Notes</div>
      <textarea value={bill.notes}
        onChange={(e) => setBill((prev) => ({ ...prev, notes: e.target.value }))}
        placeholder={ht.billNotesPlaceholder}
        rows={3}
        style={{ width: "100%", marginTop: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, resize: "vertical", boxSizing: "border-box" }} />
    </div>
  );

  if (children) {
    return <>{children({ billHelper: billHelperSlot, totals: totalsSlot, notes: notesSlot })}</>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {billHelperSlot}
      {totalsSlot}
      {notesSlot}
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
    <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1fr) 72px 90px 72px 80px 28px", minWidth: 430, gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
      <input value={item.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="Description" style={{ ...cellInputStyle, fontSize: 13 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <NumberField min={0} step={0.25} value={item.qty} aria-label="Quantity"
          onChange={(qty) => onChange({ qty })} style={numInputStyle} />
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
      <NumberField min={0} step={0.01} value={item.rate} aria-label="Rate"
        onChange={(rate) => onChange({ rate })} placeholder="0.00" style={numInputStyle} />
      <NumberField min={0} max={100} step={1} value={item.discount} aria-label="Line discount percent"
        onChange={(discount) => onChange({ discount })} style={numInputStyle} />
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
