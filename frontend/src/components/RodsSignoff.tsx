import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import type { DirectoryEntry } from "../auth/AuthContext";
import { apiFetch } from "../api/client";
import { ensureDirectory } from "../lib/userDirectory";
import SignaturePad, { type SignaturePadHandle } from "./SignaturePad";
import {
  type RodsDay,
  DUTY_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  changesForDriver,
  computeTotals,
  enqueueDay,
  loadDay,
  minutesOfDay,
  minutesToHHMM,
  newDay,
  nowHHMM,
  rodsDriverNames,
  saveDay,
  syncQueue,
  todayLocal,
} from "../lib/rodsStore";
import { loadPodsOverride, savePodsOverride } from "./JobReport";

type MinEvent = { type: string; note?: string | null; timestamp: string };
type BolLink = { ref: string; onOpen: () => void } | null;

function fmt12(hhmm: string): string {
  const mins = minutesOfDay(hhmm);
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? "p" : "a";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")}${ap}`;
}

/** Small clickable PODS checkbox for a given driver in this trip. Merges
 * a server-truth podsFiled with a local "already filed elsewhere" override
 * (multi-day trips share one PODS - the check needs to survive across
 * different daily job_uuids). Tapping "File PODS" preseeds the target
 * driver so a passenger logging on behalf files under the right name. */
function RodsDriverPodsCheckbox({
  driver, tripJob, podsFiled, onNeedPods,
}: {
  driver: string; tripJob: string; podsFiled: boolean; onNeedPods: () => void;
}) {
  const [override, setOverride] = useState<boolean>(() => loadPodsOverride(tripJob, driver));
  useEffect(() => { setOverride(loadPodsOverride(tripJob, driver)); }, [tripJob, driver]);
  const checked = podsFiled || override;
  function toggle() {
    if (podsFiled) return; // server truth wins
    const next = !override;
    setOverride(next);
    savePodsOverride(tripJob, driver, next);
  }
  function filePods() {
    try { if (driver) localStorage.setItem("crew_pods_preset_driver_v1", driver); } catch { /* noop */ }
    onNeedPods();
  }
  return (
    <>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: podsFiled ? "default" : "pointer", fontSize: 14, marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={toggle}
          style={{ marginTop: 2, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0, cursor: podsFiled ? "default" : "pointer" }}
        />
        <span>
          Prior On-Duty Statement filed for <strong>{driver || "this driver"}</strong>.
          {override && !podsFiled && (
            <span className="small" style={{ color: "var(--muted)", marginLeft: 6 }}>(self-attested)</span>
          )}
        </span>
      </label>
      {!podsFiled && !override && (
        <div className="small" style={{ marginLeft: 28, marginBottom: 12 }}>
          <button
            type="button"
            onClick={filePods}
            style={{ background: "none", border: "none", color: "var(--brand)", padding: 0, cursor: "pointer", textDecoration: "underline", fontSize: 13 }}
          >
            File PODS →
          </button>
        </div>
      )}
    </>
  );
}

/** One driver's RODS: summary derived from that driver's DUTY events + trip
 * details + signature. Persists trip details/signature keyed by driver+date. */
function RodsDriverSection({
  date, driver, fallback, events, bolLink, units, podsFiled, onNeedPods, tripJob,
}: {
  date: string; driver: string; fallback: string; events: MinEvent[]; bolLink: BolLink; units: string[];
  podsFiled: boolean; onNeedPods: () => void; tripJob: string;
}) {
  const [day, setDay] = useState<RodsDay>(() => loadDay(date, driver) || newDay(date, driver, null));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [calcMsg, setCalcMsg] = useState<string | null>(null);
  const sigRef = useRef<SignaturePadHandle>(null);

  const changes = useMemo(() => changesForDriver(events, driver, fallback, date), [events, driver, fallback, date]);
  const totals = useMemo(() => computeTotals(changes), [changes]);
  const periods = useMemo(() => {
    const nowMin = minutesOfDay(nowHHMM());
    const sorted = [...changes].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time));
    return sorted.map((c, i) => {
      const startMin = minutesOfDay(c.time);
      const isLast = i === sorted.length - 1;
      const endMin = isLast ? Math.max(startMin, nowMin) : minutesOfDay(sorted[i + 1].time);
      return { start: c.time, end: isLast ? null : sorted[i + 1].time, status: c.status, dur: Math.max(0, endMin - startMin), isLast };
    });
  }, [changes]);

  useEffect(() => { saveDay(day); }, [day]);
  useEffect(() => {
    // Keep the driver name on the stored day in sync.
    if (day.driver_name !== driver) setDay((prev) => ({ ...prev, driver_name: driver }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver]);

  function patch(p: Partial<RodsDay>) { setDay((prev) => ({ ...prev, ...p, updated_at: new Date().toISOString() })); }

  async function calcMiles() {
    const o = (day.origin || "").trim(); const d = (day.destination || "").trim();
    if (!o || !d) { setCalcMsg("Enter origin + destination first."); return; }
    setCalcMsg("Calculating…");
    try {
      const r = await apiFetch<{ ok: boolean; miles: number | null }>(`/api/long-distance/distance?origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}`);
      if (r.ok && r.miles != null) { patch({ total_miles: String(r.miles) }); setCalcMsg(null); }
      else setCalcMsg("Couldn't calculate - enter manually.");
    } catch { setCalcMsg("Couldn't calculate - enter manually."); }
  }

  async function sign() {
    setErr(null);
    if (sigRef.current?.isEmpty()) return setErr("Driver signature is required.");
    if (!consent) return setErr("Accept the electronic signature consent to submit.");
    setBusy(true);
    try {
      const signed: RodsDay = { ...day, driver_name: driver, changes, signature: sigRef.current!.toDataURL(), signed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      saveDay(signed); setDay(signed); enqueueDay(signed);
      const n = await syncQueue();
      sigRef.current?.clear(); setConsent(false);
      setNote(n > 0 ? "RODS signed and synced." : "RODS signed - will sync when back online.");
      window.setTimeout(() => setNote(null), 4000);
    } catch { setErr("Could not submit. Your log is saved - try again."); }
    finally { setBusy(false); }
  }

  return (
    <div data-component="RodsSignoff" style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 14 }}>
      <div className="microLabel" style={{ marginBottom: 10 }}>RODS - {driver || "driver"}</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
        Edit the duty log on the Timeline; review the summary, add trip details, and sign.{day.signature ? "  Signed." : ""}
      </div>

      <div className="col" style={{ gap: 6, marginBottom: 10 }}>
        {periods.map((p, i) => (
          <div key={i} className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span className="row" style={{ gap: 8, alignItems: "center", minWidth: 0 }}>
              <span className="statusDot" style={{ ["--dot" as any]: STATUS_COLORS[p.status] }}>{STATUS_LABELS[p.status]}</span>
              <span className="small" style={{ color: "var(--muted)" }}><span className="mono">{fmt12(p.start)}</span> &rarr; {p.end ? <span className="mono">{fmt12(p.end)}</span> : "now"}</span>
            </span>
            <span className="small" style={{ color: "var(--muted)", whiteSpace: "nowrap" }}><span className="mono">{minutesToHHMM(p.dur)}</span>{p.isLast ? " so far" : ""}</span>
          </div>
        ))}
      </div>
      <div className="row wrap" style={{ gap: 10, marginBottom: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
        {DUTY_STATUSES.map((s) => (
          <div key={s} className="col" style={{ gap: 2, flex: "1 1 110px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>{STATUS_LABELS[s]}</span>
            <span className="mono" style={{ fontWeight: 700, color: STATUS_COLORS[s] }}>{minutesToHHMM(totals[s])}</span>
          </div>
        ))}
      </div>

      {/* Per-driver PODS confirmation for this driver. Auto-checks once a
          PODS record with this driver name is on file for the trip; the
          crew can also self-attest via the checkbox on multi-day trips
          (one PODS covers the whole trip). "File PODS →" link takes the
          crew to /long-distance with this driver preseeded. */}
      <RodsDriverPodsCheckbox
        driver={driver}
        tripJob={tripJob}
        podsFiled={podsFiled}
        onNeedPods={onNeedPods}
      />

      <div className="col" style={{ gap: 10, marginBottom: 12 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <label className="col" style={{ gap: 4, flex: "1 1 160px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Vehicle</span>
            <select value={day.vehicle_number || ""} onChange={(e) => patch({ vehicle_number: e.target.value })}>
              <option value="">Select&hellip;</option>
              {units.map((u) => <option key={u} value={u}>{u}</option>)}
              {day.vehicle_number && !units.includes(day.vehicle_number) && <option value={day.vehicle_number}>{day.vehicle_number}</option>}
            </select>
          </label>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <label className="col" style={{ gap: 4, flex: 1 }}><span className="small" style={{ color: "var(--muted)" }}>Origin</span><input value={day.origin || ""} onChange={(e) => patch({ origin: e.target.value })} placeholder="City, ST" /></label>
          <label className="col" style={{ gap: 4, flex: 1 }}><span className="small" style={{ color: "var(--muted)" }}>Destination</span><input value={day.destination || ""} onChange={(e) => patch({ destination: e.target.value })} placeholder="City, ST" /></label>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <label className="col" style={{ gap: 4, flex: "1 1 160px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Miles today</span>
            <div className="row" style={{ gap: 6 }}>
              <input className="mono" value={day.total_miles || ""} onChange={(e) => patch({ total_miles: e.target.value })} inputMode="numeric" style={{ flex: 1, minWidth: 0 }} />
              <button type="button" onClick={calcMiles} style={{ fontSize: 12, padding: "6px 10px", whiteSpace: "nowrap" }}>Auto</button>
            </div>
            {calcMsg && <span className="small" style={{ color: "var(--muted)" }}>{calcMsg}</span>}
          </label>
        </div>
        <div className="col" style={{ gap: 4 }}>
          <span className="small" style={{ color: "var(--muted)" }}>Bill of Lading</span>
          {bolLink ? (
            <button type="button" onClick={bolLink.onOpen} style={{ alignSelf: "flex-start", fontSize: 13, padding: "6px 12px", border: "1px solid var(--brand)", color: "var(--brand)", background: "transparent", borderRadius: 8, cursor: "pointer" }}>
              View <span className="mono">{bolLink.ref}</span> &rsaquo;
            </button>
          ) : (
            <span className="small" style={{ color: "var(--muted)" }}>Attach a BOL in the documents above.</span>
          )}
        </div>
      </div>

      <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>Driver signature *</div>
      <SignaturePad ref={sigRef} height={120} />
      <button type="button" onClick={() => sigRef.current?.clear()} style={{ marginTop: 6, background: "none", border: "none", color: "var(--muted)", fontSize: 12, cursor: "pointer", padding: 0 }}>Clear signature</button>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13, marginTop: 10 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }} />
        <span style={{ lineHeight: 1.5, color: "var(--text)" }}>My electronic signature is legally binding and equivalent to my handwritten signature for this Record of Duty Status.</span>
      </label>
      {err && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{err}</div>}
      {note && <div className="small" style={{ color: "var(--ok)", marginTop: 10 }}>{note}</div>}
      <button className="btnPrimary" onClick={sign} disabled={busy} style={{ marginTop: 12 }}>{busy ? "Submitting…" : `Sign & submit RODS (${driver || "driver"})`}</button>
    </div>
  );
}

/**
 * Driver RODS sign-off on the Report tab. Auto-creates one section per driver
 * who has duty events (multi-driver), plus an "Add RODS" control to add a
 * driver who needs one but hasn't logged yet. Renders bare (inside the LD tile).
 */
export default function RodsSignoff({
  events = [],
  bolLink,
  podsDriverNames,
  onNeedPods,
  tripJob = "",
}: {
  events?: MinEvent[];
  bolLink?: BolLink;
  /** Lowercased names of drivers with a PODS on file for this trip. */
  podsDriverNames?: Set<string>;
  onNeedPods?: () => void;
  /** The trip's anchor job_uuid (tripLink or the current job). Used to
   * key per-driver PODS "already filed" self-attestation so a multi-day
   * trip doesn't fake-fail on day 2. */
  tripJob?: string;
}) {
  const { user } = useAuth();
  const me = user?.name || user?.email || "";
  const date = todayLocal();
  const [units, setUnits] = useState<string[]>([]);
  const [dir, setDir] = useState<DirectoryEntry[]>([]);

  // Added-on-behalf drivers survive a JobReport unmount by persisting to
  // localStorage keyed by trip + date. Without this, tapping "+ Add RODS"
  // and then navigating to another tab and back loses the driver.
  const manualKey = `crew_rods_manual_drivers_v1:${tripJob || "no-trip"}:${date}`;
  const [manual, setManual] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(manualKey);
      const arr = raw ? JSON.parse(raw) : null;
      return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
    } catch { return []; }
  });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(manualKey);
      const arr = raw ? JSON.parse(raw) : null;
      setManual(Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : []);
    } catch { setManual([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualKey]);
  useEffect(() => {
    try {
      if (manual.length > 0) localStorage.setItem(manualKey, JSON.stringify(manual));
      else localStorage.removeItem(manualKey);
    } catch { /* noop */ }
  }, [manual, manualKey]);

  useEffect(() => {
    apiFetch<{ units: string[] }>("/api/dvir/units").then((r) => setUnits(r.units || [])).catch(() => {});
    ensureDirectory().then(setDir).catch(() => {});
  }, []);

  const driversWithEvents = useMemo(() => rodsDriverNames(events, me), [events, me]);
  const drivers = useMemo(() => Array.from(new Set([...driversWithEvents, ...manual])), [driversWithEvents, manual]);
  const addable = dir.map((d) => d.name || d.email).filter((n) => n && !drivers.includes(n));

  // Always render the "Add RODS" control on long-distance days, even before
  // any duty events have been logged - otherwise the vehicle/trip fields
  // appear to have disappeared until someone taps a duty status.
  const emptyLabel = drivers.length === 0
    ? "Add a RODS to record vehicle, miles, origin/destination, and sign (one is required per driver, per day)"
    : "Add a RODS for another driver (one is required per driver, per day)";

  return (
    <>
      {drivers.map((dr) => (
        <RodsDriverSection
          key={dr}
          date={date}
          driver={dr}
          fallback={me}
          events={events}
          bolLink={bolLink ?? null}
          units={units}
          podsFiled={!!podsDriverNames?.has(dr.trim().toLowerCase())}
          onNeedPods={onNeedPods ?? (() => {})}
          tripJob={tripJob}
        />
      ))}

      <div style={{ borderTop: drivers.length > 0 ? "1px solid var(--border)" : undefined, marginTop: drivers.length > 0 ? 14 : 0, paddingTop: drivers.length > 0 ? 14 : 0 }}>
        <label className="col" style={{ gap: 4 }}>
          <span className="small" style={{ color: "var(--muted)" }}>{emptyLabel}</span>
          <select
            value=""
            onChange={(e) => { const v = e.target.value; if (v) setManual((prev) => Array.from(new Set([...prev, v]))); }}
          >
            <option value="">+ Add RODS…</option>
            {me && !drivers.includes(me) && <option value={me}>Myself{me ? ` (${me})` : ""}</option>}
            {addable.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
    </>
  );
}
