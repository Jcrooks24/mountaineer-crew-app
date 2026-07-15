import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { fetchRemoteBol, listOpenBols, type OpenBol } from "../lib/bolStore";
import RodsSignoff from "./RodsSignoff";
import RosterPicker from "./RosterPicker";

// Multi-day LD trips: each day is its own calendar event / job_uuid, so the
// driver can link a day to the trip's in-progress BOL. The link is the trip's
// anchor job; PODS + BOL + BOL# resolve against it.
const TRIP_LINK_PREFIX = "crew_ld_trip_link_v1:";
type TripLink = { trip_job_uuid: string; bol_id: string; label: string };
function loadTripLink(jobUuid: string): TripLink | null {
  try {
    const raw = localStorage.getItem(TRIP_LINK_PREFIX + jobUuid);
    return raw ? (JSON.parse(raw) as TripLink) : null;
  } catch {
    return null;
  }
}
function saveTripLink(jobUuid: string, link: TripLink | null) {
  try {
    if (link) localStorage.setItem(TRIP_LINK_PREFIX + jobUuid, JSON.stringify(link));
    else localStorage.removeItem(TRIP_LINK_PREFIX + jobUuid);
  } catch {}
}
function bolRefOf(bol: { bol_id?: string; id?: string } | null): string {
  const id = bol?.bol_id || bol?.id || "";
  return id ? `BOL-${id.slice(0, 8)}` : "";
}
// The crew can defer the BOL so it isn't a submit blocker. We track WHICH
// stage they're deferring for ("load" = origin loading still in progress,
// "unload" = at destination, unload still in progress) so the deferred
// state is meaningful on a follow-up read. Legacy "1" values from the
// pre-split boolean flag are read back as "load" for back-compat.
type BolDeferredReason = "" | "load" | "unload";

// Per-driver PODS "already filed" self-attestation. One PODS covers the
// whole multi-day trip (§395.8(j)(2)), but the app only searches for a
// PODS matching this specific day's job_uuid - which would falsely make
// day-2 look non-compliant. This override lets the crew confirm the
// PODS is on file without duplicating the submission.
const PODS_OVERRIDE_PREFIX = "crew_pods_override_v1:";
function podsOverrideKey(tripJob: string, driver: string): string {
  return `${PODS_OVERRIDE_PREFIX}${tripJob}:${driver.trim().toLowerCase()}`;
}
export function loadPodsOverride(tripJob: string, driver: string): boolean {
  if (!tripJob || !driver) return false;
  try { return localStorage.getItem(podsOverrideKey(tripJob, driver)) === "1"; } catch { return false; }
}
export function savePodsOverride(tripJob: string, driver: string, on: boolean): void {
  if (!tripJob || !driver) return;
  try {
    if (on) localStorage.setItem(podsOverrideKey(tripJob, driver), "1");
    else localStorage.removeItem(podsOverrideKey(tripJob, driver));
  } catch { /* noop */ }
}
// Per-job "ignore this job's own BOL" flag. When the crew hits Detach BOL
// on an auto-attached (no tripLink) BOL, we stop treating the server's
// bol-for-this-job as attached so the picker + Start New buttons come
// back. Cleared as soon as they pick another BOL via linkTrip.
const BOL_DETACHED_PREFIX = "crew_ld_bol_detached_v1:";
function loadBolDetached(jobUuid: string): boolean {
  try { return localStorage.getItem(BOL_DETACHED_PREFIX + jobUuid) === "1"; } catch { return false; }
}
function saveBolDetached(jobUuid: string, on: boolean) {
  try {
    if (on) localStorage.setItem(BOL_DETACHED_PREFIX + jobUuid, "1");
    else localStorage.removeItem(BOL_DETACHED_PREFIX + jobUuid);
  } catch { /* noop */ }
}
const BOL_DEFER_PREFIX = "crew_ld_bol_deferred_v1:";
function loadBolDeferred(jobUuid: string): BolDeferredReason {
  try {
    const raw = localStorage.getItem(BOL_DEFER_PREFIX + jobUuid) || "";
    if (raw === "load" || raw === "unload") return raw;
    if (raw === "1") return "load"; // pre-split value
    return "";
  } catch { return ""; }
}
function saveBolDeferred(jobUuid: string, reason: BolDeferredReason) {
  try {
    if (reason) localStorage.setItem(BOL_DEFER_PREFIX + jobUuid, reason);
    else localStorage.removeItem(BOL_DEFER_PREFIX + jobUuid);
  } catch {}
}
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeContext";
import { formatMountainTime } from "../lib/time";
import DVIRReminderModal from "./DVIRReminderModal";
import BillCalculator, { type BillHandle } from "./BillCalculator";
import { BetaTag } from "./BetaTag";
import WrapUpEstimator from "./WrapUpEstimator";
import { fireConfetti } from "../lib/confetti";

// Type + billing-math helpers live in lib/employeeHours so BillCalculator
// can consume them without importing back through this parent. Re-exported
// here for backward compatibility with existing callers (Admin, etc.).
export { roundBillableQuarter, type EmployeeHoursEntry } from "../lib/employeeHours";
import type { EmployeeHoursEntry } from "../lib/employeeHours";
import { roundBillableQuarter } from "../lib/employeeHours";
import {
  TRUCK_IDS,
  type TruckFullnessEntry,
} from "../lib/jobTypes";
import { useJobTypes } from "../lib/jobTypesStore";
import { useSkills, skillsForJobTypes, type Skill } from "../lib/skillsStore";
import { isBoxItem } from "../lib/inventory";

// Compact subset of EventRecord - enough to populate the Employee Hours
// dropdowns without leaking the rest of App.tsx's offline state into
// JobReport. `note` surfaces in the dropdown labels (truncated to one line)
// so crew can disambiguate which "ARRIVED" they're picking when a job has
// several of the same event type.
type ReportEvent = {
  event_id: string;
  type: string;
  timestamp: string;
  note?: string | null;
};

type BillingMethod =
  | "crew_cash"
  | "crew_check"
  | "office_invoice"
  | "office_arrange_cash"
  | "office_arrange_check"
  | "end_of_job";

const BILLING_OPTIONS: { value: BillingMethod; label: string }[] = [
  { value: "crew_cash",           label: "Crew collected - cash" },
  { value: "crew_check",          label: "Crew collected - check" },
  { value: "office_invoice",      label: "Office sends invoice" },
  { value: "office_arrange_cash", label: "Office arranges pick-up / drop-off - cash" },
  { value: "office_arrange_check",label: "Office arranges pick-up / drop-off - check" },
  { value: "end_of_job",          label: "Bill at end of job (multi-day)" },
];

// "yes" | "no" | "na" mirrors the backend ReviewCandidate Literal. `null`
// means the crew hasn't picked a button yet (form-validation gate, never
// submitted).
type ReviewCandidate = "yes" | "no" | "na";

type ReportData = {
  has_personal_vehicles: boolean | null;
  personal_vehicles: number;
  // Bill the personal vehicles as crew transport vehicles ($100/vehicle/day).
  // Local-only for now (draft-persisted) - backend column can follow.
  bill_personal_vehicles: boolean;
  has_dumpster_use: boolean | null;
  dumpster_pct: number;
  has_recycling_use: boolean | null;
  recycling_pct: number;
  billing_method: string;
  review_candidate: ReviewCandidate | null;
  hours_match: boolean | null;
  hours_mismatch_reason: string;
  has_crew_feedback: boolean | null;
  crew_feedback: string;
  // Long-distance: submitter started AND ended the day out of town ($50 per-diem).
  out_of_town: boolean;
  // Fixed multi-select job-type tags (see lib/jobTypes).
  job_type_tags: string[];
  // Per-truck fullness readings against the interior 25% marks.
  truck_fullness: TruckFullnessEntry[];
  // Crew's note when actual inventory ran over the linked estimate.
  overage_note: string;
  // Crew-lead sign-off that the per-employee hours are correct.
  hours_verified: boolean;
  employee_hours: EmployeeHoursEntry[];
};

// Pre-3-state-migration drafts/responses stored review_candidate as a
// boolean. Coerce on load so a saved draft from before this deploy still
// hydrates cleanly instead of breaking the picker.
function coerceReviewCandidate(v: unknown): ReviewCandidate | null {
  if (v === "yes" || v === "no" || v === "na") return v;
  if (v === true) return "yes";
  if (v === false) return "no";
  return null;
}

// In-progress draft persisted to localStorage so partially filled reports
// survive tab switches (the JobReport component unmounts when the user
// navigates away from the Report tab) and full page reloads. Cleared on
// successful submit. Keyed by job_uuid; per-device only - drafts are not
// synced cross-device.
const REPORT_DRAFT_PREFIX = "crew_report_draft_v1:";
// savedAt lets us resolve draft-vs-server on load: a draft only wins over the
// server report when it was saved AFTER the server's last update (i.e. it holds
// newer in-progress edits). A server report updated on another device since
// this device's draft was saved wins (cross-device continuity).
type ReportDraft = { data: ReportData; billReviewed: boolean; savedAt?: string };

function reportDraftKey(uuid: string) {
  return `${REPORT_DRAFT_PREFIX}${uuid || "none"}`;
}
function loadReportDraft(uuid: string): ReportDraft | null {
  try {
    const raw = localStorage.getItem(reportDraftKey(uuid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.data) return null;
    return parsed as ReportDraft;
  } catch {
    return null;
  }
}
function saveReportDraft(uuid: string, draft: ReportDraft) {
  try {
    localStorage.setItem(reportDraftKey(uuid), JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch {}
}
function clearReportDraft(uuid: string) {
  try {
    localStorage.removeItem(reportDraftKey(uuid));
  } catch {}
}

// A draft saved by an older app version omits fields added since (e.g.
// job_type_tags, truck_fullness, overage_note). Spreading such a draft leaves
// those keys undefined, which crashes the render the first time we call
// `.includes`/`.filter`/`.map` on them ("Cannot read properties of undefined").
// Backfill every non-primitive/newer field to its blank default on load so a
// stale draft always hydrates into a complete, render-safe ReportData.
function normalizeDraftData(d: ReportData): ReportData {
  return {
    ...d,
    review_candidate: coerceReviewCandidate(d.review_candidate),
    out_of_town: !!d.out_of_town,
    hours_mismatch_reason: d.hours_mismatch_reason ?? "",
    crew_feedback: d.crew_feedback ?? "",
    overage_note: d.overage_note ?? "",
    hours_verified: !!d.hours_verified,
    job_type_tags: Array.isArray(d.job_type_tags) ? d.job_type_tags : [],
    truck_fullness: Array.isArray(d.truck_fullness) ? d.truck_fullness : [],
    employee_hours: Array.isArray(d.employee_hours) ? d.employee_hours : [],
  };
}

type Props = {
  jobUuid: string;
  jobName: string;
  events?: ReportEvent[];
  longDistance?: boolean;
  // Long-distance drive-only day: skip the billing/eval questions that don't
  // apply when the crew only drove (no labor to bill).
  driveOnly?: boolean;
  // Long-distance day with BOTH labor and driving: LD docs are required to submit.
  mixedLd?: boolean;
};

function ChecklistItem({ done, label, hint, onGo }: { done: boolean; label: string; hint?: string; onGo: () => void }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span
          style={{
            width: 22, height: 22, flexShrink: 0, borderRadius: 6, display: "grid", placeItems: "center",
            background: done ? "var(--ok)" : "transparent",
            border: done ? "none" : "1.5px solid var(--border)",
            color: "#0b1f14", fontWeight: 800, fontSize: 14,
          }}
        >
          {done ? "✓" : ""}
        </span>
        <span style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: done ? "var(--muted)" : "var(--text)" }}>{label}</div>
          {hint && <div className="small" style={{ color: "var(--muted)" }}>{hint}</div>}
        </span>
      </span>
      {/* Always openable so the driver can VIEW a completed PODS/BOL at any
          time (FMCSR), or complete an outstanding one. */}
      <button
        type="button"
        onClick={onGo}
        className={done ? "" : "btnPrimary"}
        style={{ fontSize: 12, padding: "6px 12px", flexShrink: 0 }}
      >
        {done ? "View" : "Complete"}
      </button>
    </div>
  );
}

export default function JobReport({ jobUuid, jobName, events = [], longDistance = false, driveOnly = false, mixedLd = false }: Props) {
  const nav = useNavigate();
  const { user } = useAuth();

  // Skill-rater gating: the job type and the per-employee skill ratings are
  // editable only by admins and people an admin has explicitly designated a
  // skill rater. The crew_lead role does NOT grant this (ADR 0014) - rating the
  // crew is a smaller, more deliberate job than leading it, so leads are raters
  // only when an admin says so. Everyone else fills the rest of the report as
  // normal (it syncs cross-device, so a rater can finish it from their own
  // device). There is deliberately no self-assess escape hatch. Mirrored
  // server-side in job_report.py::_is_skill_rater.
  const canRate = user?.role === "admin" || !!user?.is_skill_rater;

  // Long-distance documents: PODS + BOL (with multi-day trip linking).
  const [bolStatus, setBolStatus] = useState<string>("");
  const [bolRef, setBolRef] = useState<string>("");
  // Full bol_id of the currently-attached BOL. Kept alongside the display
  // `bolRef` because the ChecklistItems now deep-link the crew straight
  // into that specific BOL's editor - the truncated ref isn't usable.
  const [attachedBolId, setAttachedBolId] = useState<string>("");
  const [priorDone, setPriorDone] = useState<boolean>(false);
  // Whether the currently signed-in user has a PODS for this trip's job.
  // Drives the "As the driver, I've submitted my PODS" checkbox by the
  // per-diem row so a driver can see their own compliance at a glance
  // without conflating it with any other driver on a multi-driver trip.
  const [podsForDriver, setPodsForDriver] = useState<boolean>(false);
  // Manual "already filed" override for this driver on this trip -
  // multi-day trips share one PODS so day-2 shouldn't fake-fail.
  const [podsOverride, setPodsOverrideState] = useState<boolean>(false);
  // Set of driver names (lowercased) with a PODS on file for this trip.
  // Each RodsDriverSection reads its own driver to render its own PODS
  // checkbox - the sign-in user's checkbox is above; this covers the
  // added-on-behalf drivers.
  const [podsDriverNames, setPodsDriverNames] = useState<Set<string>>(() => new Set());
  // Bumped when the tab regains focus so the LD effect below refetches
  // the BOL + PODS state. Without this a BOL auto-created on the
  // Inventory tab wouldn't appear here until the whole component
  // remounts.
  const [ldRefresh, setLdRefresh] = useState<number>(0);
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible") setLdRefresh((n) => n + 1);
    }
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, []);
  const [tripLink, setTripLink] = useState<TripLink | null>(() => (jobUuid ? loadTripLink(jobUuid) : null));
  const [openBols, setOpenBols] = useState<OpenBol[]>([]);
  const [bolDeferred, setBolDeferred] = useState<BolDeferredReason>(() => (jobUuid ? loadBolDeferred(jobUuid) : ""));
  const [bolDetached, setBolDetachedState] = useState<boolean>(() => (jobUuid ? loadBolDetached(jobUuid) : false));

  useEffect(() => {
    setTripLink(jobUuid ? loadTripLink(jobUuid) : null);
    setBolDeferred(jobUuid ? loadBolDeferred(jobUuid) : "");
    setBolDetachedState(jobUuid ? loadBolDetached(jobUuid) : false);
  }, [jobUuid]);

  // Hydrate manual PODS override once we know the trip anchor + driver.
  const meName = user?.name || user?.email || "";
  useEffect(() => {
    const tj = tripLink?.trip_job_uuid || jobUuid;
    setPodsOverrideState(loadPodsOverride(tj, meName));
  }, [tripLink, jobUuid, meName]);

  // The trip's anchor job: the linked in-progress BOL's job, or this job.
  const tripJob = tripLink?.trip_job_uuid || jobUuid;

  useEffect(() => {
    if (!longDistance || !jobUuid) return;
    let cancelled = false;
    (async () => {
      const bol = await fetchRemoteBol(tripJob);
      if (!cancelled) {
        // When the crew has explicitly detached this job's own BOL, don't
        // auto-attach it back on refetch. bolDetached only applies to the
        // job-itself case (no tripLink) - a real tripLink to another
        // trip's anchor overrides it.
        const respectDetach = bolDetached && !tripLink;
        // Preserve any optimistic bolStatus set by linkTrip when the linked
        // BOL is local-only and hasn't synced yet - fetchRemoteBol would
        // return null in that case and would otherwise wipe the attached
        // state right after the user picked a BOL.
        if (bol && !respectDetach) {
          setBolStatus(bol.status || "");
          setBolRef(bolRefOf(bol));
          setAttachedBolId(bol.bol_id || bol.id || "");
        }
        if (respectDetach) { setBolStatus(""); setBolRef(""); setAttachedBolId(""); }
      }
      try {
        const prior = await apiFetch<any[]>(`/api/long-distance/prior-hours?job_uuid=${encodeURIComponent(tripJob)}`);
        // Robust: only count statements that EXACTLY match the trip job, so a
        // statement from another trip (or an unfiltered response) can't
        // false-positive the "done" state.
        const forJob = (Array.isArray(prior) ? prior : []).filter((p) => (p?.job_uuid || "") === tripJob);
        if (!cancelled) setPriorDone(forJob.length > 0);
        // Per-driver check: does the *current user's* PODS exist for this
        // trip? A multi-driver trip needs each driver to file their own.
        const mine = user?.id
          ? forJob.filter((p) => Number(p?.driver_id) === Number(user.id))
          : [];
        if (!cancelled) setPodsForDriver(mine.length > 0);
        // Names (lowercased) so RodsDriverSection can flag each driver's
        // PODS status. Includes driver_name from every PODS record.
        const names = new Set<string>();
        for (const p of forJob) {
          const n = String(p?.driver_name || "").trim().toLowerCase();
          if (n) names.add(n);
        }
        if (!cancelled) setPodsDriverNames(names);
      } catch {
        if (!cancelled) { setPriorDone(false); setPodsForDriver(false); setPodsDriverNames(new Set()); }
      }
      const open = await listOpenBols();
      if (!cancelled) setOpenBols(open);
    })();
    return () => { cancelled = true; };
  }, [longDistance, jobUuid, tripJob, ldRefresh, bolDetached, tripLink]);

  function setBolDeferredFlag(reason: BolDeferredReason) {
    setBolDeferred(reason);
    saveBolDeferred(jobUuid, reason);
  }
  function linkTrip(o: OpenBol | null) {
    if (o) {
      const link: TripLink = { trip_job_uuid: o.job_uuid, bol_id: o.bol_id, label: `${o.job_name || "Untitled"}${o.job_date ? " · " + o.job_date : ""}` };
      saveTripLink(jobUuid, link);
      setTripLink(link);
      setBolDeferredFlag("");
      // Actively picking a new BOL revokes the earlier detach flag - the
      // crew clearly wants this trip attached to something now.
      saveBolDetached(jobUuid, false);
      setBolDetachedState(false);
      // Optimistically flip the render into the "attached" branch. Without
      // this, a local-only BOL (not yet synced to the server) would leave
      // bolStatus empty after fetchRemoteBol returns null - the render
      // stays on the dropdown and the click appears to do nothing.
      setBolStatus(o.status || "draft");
      setBolRef(o.bol_id || "");
      setAttachedBolId(o.bol_id || "");
    } else {
      saveTripLink(jobUuid, null);
      setTripLink(null);
      setBolStatus("");
      setBolRef("");
      setAttachedBolId("");
    }
  }
  function detachOwnBol() {
    // Persist so a later mount / visibility refresh doesn't re-attach the
    // same server row. Cleared automatically the next time linkTrip runs
    // with a real BOL.
    saveBolDetached(jobUuid, true);
    setBolDetachedState(true);
    setBolStatus("");
    setBolRef("");
    setAttachedBolId("");
  }

  const { settings: themeSettings } = useTheme();
  const ht = themeSettings.helpTexts;

  const [data, setData] = useState<ReportData>({
    has_personal_vehicles: null,
    personal_vehicles: 0,
    bill_personal_vehicles: false,
    has_dumpster_use: null,
    dumpster_pct: 0,
    has_recycling_use: null,
    recycling_pct: 0,
    billing_method: "",
    review_candidate: null,
    hours_match: null,
    hours_mismatch_reason: "",
    has_crew_feedback: null,
    crew_feedback: "",
    out_of_town: false,
    job_type_tags: [],
    truck_fullness: [],
    overage_note: "",
    hours_verified: false,
    employee_hours: [],
  });

  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showDVIRModal, setShowDVIRModal] = useState(false);
  // Admin-configurable job-type tags (server, cached). Union with any tags
  // already saved on this report so a since-deactivated tag still shows.
  const jobTypes = useJobTypes();
  // Skill registry + the subset relevant to this job's type(s) - the only
  // skills crew are asked to rate per employee.
  const skills = useSkills();
  const relevantSkills = useMemo(
    () => skillsForJobTypes(skills, data.job_type_tags),
    [skills, data.job_type_tags],
  );
  // Crew must confirm the auto-populated bill rows before the report submits.
  // The checkbox lives below the M1 sliders so crew see the M1-driven
  // charges populate before acknowledging them.
  const [billReviewed, setBillReviewed] = useState(false);
  const pendingSaveRef = useRef<(() => Promise<void>) | null>(null);
  const billRef = useRef<BillHandle>(null);

  // Draft autosave state - see REPORT_DRAFT_PREFIX above for the persistence
  // contract. Pill mirrors the global notes pattern: "Saving…" → "✓ Draft saved".
  type DraftStatus = "idle" | "saving" | "saved";
  const [draftStatus, setDraftStatus] = useState<DraftStatus>("idle");
  const draftSaveTimeoutRef = useRef<number | null>(null);
  // Set to true right after we hydrate state from server / localStorage so
  // the autosave effect skips writing back the just-loaded values (which
  // would flip the pill to "Saving" on mount for no reason).
  const skipNextDraftSaveRef = useRef<boolean>(false);
  // Server report's updated_at from the last GET, to resolve draft-vs-server.
  const serverUpdatedAtRef = useRef<string>("");

  // Load existing report when job_uuid changes
  useEffect(() => {
    if (!jobUuid) { setLoaded(false); return; }
    setLoaded(false);
    setSaved(false);
    setBillReviewed(false);

    // Safety net: force `loaded` true after 15 seconds even if the fetch is
    // stuck. Previously a hung /api/job-report request could leave the tab
    // on the "Loading…" placeholder indefinitely. The .finally() below is
    // still the primary path; this timer just bails out of any edge case
    // that would otherwise strand the crew on a spinner.
    const bail = window.setTimeout(() => {
      setLoaded((prev) => {
        if (prev) return prev;
        // Try the local draft as a last resort so the crew doesn't lose
        // in-progress typing on a stall.
        const draft = loadReportDraft(jobUuid);
        if (draft) {
          setData(normalizeDraftData(draft.data));
          setBillReviewed(draft.billReviewed);
        }
        skipNextDraftSaveRef.current = true;
        return true;
      });
    }, 15000);

    apiFetch<ReportData & { id: number; employee_hours: EmployeeHoursEntry[] | null }>(`/api/job-report?job_uuid=${encodeURIComponent(jobUuid)}`)
      .then((r) => {
        setData({
          // Existing reports - infer answers from saved values
          has_personal_vehicles: r.personal_vehicles > 0,
          personal_vehicles: r.personal_vehicles,
          bill_personal_vehicles: !!(r as any).bill_personal_vehicles,
          has_dumpster_use: r.dumpster_pct > 0,
          dumpster_pct: r.dumpster_pct,
          has_recycling_use: r.recycling_pct > 0,
          recycling_pct: r.recycling_pct,
          billing_method: r.billing_method,
          review_candidate: coerceReviewCandidate(r.review_candidate),
          hours_match: r.hours_match,
          hours_mismatch_reason: r.hours_mismatch_reason ?? "",
          has_crew_feedback: r.has_crew_feedback ?? null,
          crew_feedback: r.crew_feedback ?? "",
          out_of_town: !!(r as any).out_of_town,
          job_type_tags: (r as any).job_type_tags ?? [],
          truck_fullness: (r as any).truck_fullness ?? [],
          overage_note: (r as any).overage_note ?? "",
          hours_verified: !!(r as any).hours_verified,
          employee_hours: r.employee_hours ?? [],
        });
        serverUpdatedAtRef.current = (r as any).updated_at || "";
        setSaved(true);
      })
      .catch((e) => {
        // ONLY reset to empty defaults on a real 404 (no report exists yet).
        // Network errors / 5xx must preserve whatever's in memory - wiping
        // on a transient "Failed to fetch" was the cause of crew losing
        // a partly-edited report after a backend hiccup. The .finally()
        // below still tries to recover from the localStorage draft.
        if (e instanceof ApiError && e.status === 404) {
          setData({
            has_personal_vehicles: null,
            personal_vehicles: 0,
            bill_personal_vehicles: false,
            has_dumpster_use: null,
            dumpster_pct: 0,
            has_recycling_use: null,
            recycling_pct: 0,
            billing_method: "",
            review_candidate: null,
            hours_match: null,
            hours_mismatch_reason: "",
            has_crew_feedback: null,
            crew_feedback: "",
            out_of_town: false,
            job_type_tags: [],
            truck_fullness: [],
            overage_note: "",
            hours_verified: false,
            employee_hours: [],
          });
          serverUpdatedAtRef.current = "";
        }
      })
      .finally(() => {
        window.clearTimeout(bail);
        // Resolve draft vs. server. A local draft holds this device's most-recent
        // typing, so it wins ONLY when it was saved after the server's last
        // update. If the server report was updated on another device since this
        // draft was saved (or the draft predates the savedAt stamp), the server
        // wins so a stale local draft can't hide a newer report (cross-device).
        const draft = loadReportDraft(jobUuid);
        const serverUpdated = serverUpdatedAtRef.current;
        const draftWins = !!draft && (!serverUpdated || String(draft.savedAt || "") >= serverUpdated);
        if (draftWins && draft) {
          setData(normalizeDraftData(draft.data));
          setBillReviewed(draft.billReviewed);
          setDraftStatus("saved");
        } else {
          // Server is authoritative; drop the stale draft so autosave doesn't
          // resurrect it.
          if (draft) clearReportDraft(jobUuid);
          setDraftStatus("idle");
        }
        skipNextDraftSaveRef.current = true;
        setLoaded(true);
      });

    return () => { window.clearTimeout(bail); };
  }, [jobUuid]);

  // Debounced draft autosave. Triggers on every change to `data` or
  // `billReviewed` once the form is loaded; skipped during the first render
  // after hydration so we don't write back the just-loaded values.
  useEffect(() => {
    if (!loaded || !jobUuid) return;
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
      return;
    }

    if (draftSaveTimeoutRef.current !== null) {
      window.clearTimeout(draftSaveTimeoutRef.current);
    }
    setDraftStatus("saving");
    draftSaveTimeoutRef.current = window.setTimeout(() => {
      draftSaveTimeoutRef.current = null;
      saveReportDraft(jobUuid, { data, billReviewed });
      setDraftStatus("saved");
    }, 750);

    return () => {
      if (draftSaveTimeoutRef.current !== null) {
        window.clearTimeout(draftSaveTimeoutRef.current);
        draftSaveTimeoutRef.current = null;
      }
    };
  }, [data, billReviewed, jobUuid, loaded]);

  function set<K extends keyof ReportData>(key: K, val: ReportData[K]) {
    setData((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  // ── Employee Hours helpers ─────────────────────────────────────────────────
  // Sort timeline events ascending so the dropdowns read like a day. App.tsx
  // supplies events newest-first. JOB_NOTES sentinels are already filtered
  // out upstream.
  const sortedEvents = useMemo(
    () =>
      events
        // Drive-time (RODS duty changes) is not paid hourly, so DUTY events must
        // not appear as options when recording employee hours.
        .filter((e) => e.type !== "DUTY")
        .slice()
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [events],
  );

  const eventById = useMemo(() => {
    const m = new Map<string, ReportEvent>();
    for (const e of sortedEvents) m.set(e.event_id, e);
    return m;
  }, [sortedEvents]);

  // A "slot" in the editor is either a picked timeline event, the projected
  // wrap-up time from the estimator above, or a manually typed HH:MM. Crew
  // picks the manual option when an employee's time doesn't line up with any
  // logged event (e.g., one person arrived 10 minutes late and there's no
  // per-employee event for that).
  const MANUAL_SENTINEL = "__manual__";
  const WRAPUP_SENTINEL = "__wrapup__";
  type SlotPick = { selection: string; manualTime: string };
  const emptySlot: SlotPick = { selection: "", manualTime: "" };

  // Projected wrap-up time, lifted from <WrapUpEstimator>. Null until the crew
  // calculates one. Offered as an End option only - it's a projection of when
  // the job finishes, so it's never a valid start or break bound.
  const [wrapUpTime, setWrapUpTime] = useState<Date | null>(null);

  // First START on the timeline + last FINISH = the natural bookends for a
  // typical crew day. Prefilling these means the common case (everyone
  // worked the same span) is one tap: type name → Save.
  const defaultStart = useMemo<SlotPick>(() => {
    const ev = sortedEvents.find((e) => e.type === "START");
    return ev ? { selection: ev.event_id, manualTime: "" } : emptySlot;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedEvents]);
  const defaultEnd = useMemo<SlotPick>(() => {
    const finishes = sortedEvents.filter((e) => e.type === "FINISH");
    const ev = finishes.length > 0 ? finishes[finishes.length - 1] : null;
    return ev ? { selection: ev.event_id, manualTime: "" } : emptySlot;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedEvents]);

  const [editName, setEditName] = useState<string>("");
  // Roster id of the person being edited. This, not the name, is the match
  // key the hours summary joins on. null while nothing is picked, and on a
  // legacy row whose name is not on the roster.
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [editStart, setEditStart] = useState<SlotPick>(emptySlot);
  const [editEnd, setEditEnd] = useState<SlotPick>(emptySlot);
  // uid is a stable React key so removing a middle break doesn't reuse
  // the wrong slot picker's DOM (index-as-key was subtly wrong here).
  type BreakDraft = { uid: string; start: SlotPick; end: SlotPick };
  const [editBreaks, setEditBreaks] = useState<BreakDraft[]>([]);
  // null when adding; index of the saved row when editing it. Flips Save to
  // "replace at index" semantics and surfaces a banner so the crew sees they
  // aren't appending a duplicate.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const editorInitializedRef = useRef<boolean>(false);

  // One-shot: as soon as defaults are knowable (events arrived from App.tsx),
  // populate start + end. Subsequent edits to either slot - including the
  // user clearing it - won't be clobbered because the flag stops the effect.
  useEffect(() => {
    if (editorInitializedRef.current) return;
    if (defaultStart.selection || defaultEnd.selection) {
      if (defaultStart.selection) setEditStart(defaultStart);
      if (defaultEnd.selection) setEditEnd(defaultEnd);
      editorInitializedRef.current = true;
    }
  }, [defaultStart, defaultEnd]);

  // Drop-down label for an event. Truncates the note onto one line - long
  // notes are clipped with "…" so the option width stays bounded; shorter
  // notes show in full. Newlines are collapsed so multi-line notes don't
  // wrap inside the <option>.
  function eventOptionLabel(ev: ReportEvent): string {
    const time = formatMountainTime(ev.timestamp);
    const rawNote = (ev.note || "").replace(/\s+/g, " ").trim();
    const NOTE_MAX = 40;
    const note = rawNote.length > NOTE_MAX ? rawNote.slice(0, NOTE_MAX - 1) + "…" : rawNote;
    return note ? `${ev.type} - ${time} - ${note}` : `${ev.type} - ${time}`;
  }

  function fmtHHMM(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  // Resolve a slot to minutes-of-day (0–1439). Returns null if the slot is
  // empty or the manual time hasn't been typed yet. We work in minutes so
  // crossed-midnight spans (rare on a moving job, but possible) are easy to
  // shift by adding 24h to the end.
  function slotToMinutes(slot: SlotPick): number | null {
    if (slot.selection === MANUAL_SENTINEL) {
      const t = slot.manualTime;
      if (!t) return null;
      const m = /^(\d{1,2}):(\d{2})$/.exec(t);
      if (!m) return null;
      const h = Number(m[1]);
      const mm = Number(m[2]);
      if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
      return h * 60 + mm;
    }
    if (slot.selection === WRAPUP_SENTINEL) {
      // Resolves live: editing the estimator's minutes above moves this end
      // time with it. The saved row snapshots the value at Save.
      return wrapUpTime ? wrapUpTime.getHours() * 60 + wrapUpTime.getMinutes() : null;
    }
    if (slot.selection) {
      const ev = eventById.get(slot.selection);
      if (!ev) return null;
      const d = new Date(ev.timestamp);
      if (Number.isNaN(d.getTime())) return null;
      return d.getHours() * 60 + d.getMinutes();
    }
    return null;
  }

  function slotToHHMM(slot: SlotPick): string {
    if (slot.selection === MANUAL_SENTINEL) return slot.manualTime || "";
    if (slot.selection === WRAPUP_SENTINEL) {
      return wrapUpTime ? fmtHHMM(wrapUpTime.toISOString()) : "";
    }
    if (slot.selection) {
      const ev = eventById.get(slot.selection);
      return ev ? fmtHHMM(ev.timestamp) : "";
    }
    return "";
  }

  // Clock label for the wrap-up option, e.g. "4:35 PM".
  const wrapUpLabel = useMemo(
    () =>
      wrapUpTime
        ? wrapUpTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : "",
    [wrapUpTime],
  );

  // Re-used four times in the editor (start, end, each break's start/end).
  // Renders a <select> over events plus a "Manual time…" option that
  // reveals an inline <input type="time">. Picking a real event after
  // having typed a manual time discards the manual value (selection is
  // mutually exclusive).
  function renderSlotPicker(
    slot: SlotPick,
    setSlot: (next: SlotPick) => void,
    placeholder: string,
    // End slots may also resolve to the projected wrap-up time from the
    // estimator above (only offered once one has been calculated).
    allowWrapUp = false,
  ) {
    return (
      <div
        className="row"
        style={{ gap: 4, alignItems: "center", flex: "1 1 200px", minWidth: 0 }}
      >
        <select
          value={slot.selection}
          onChange={(e) => {
            const v = e.target.value;
            setSlot(
              v === MANUAL_SENTINEL
                ? { selection: MANUAL_SENTINEL, manualTime: slot.manualTime }
                : { selection: v, manualTime: "" },
            );
          }}
          style={{ flex: 1, minWidth: 0 }}
        >
          <option value="">{placeholder}</option>
          <option value={MANUAL_SENTINEL}>Manual time…</option>
          {allowWrapUp && wrapUpTime && (
            <option value={WRAPUP_SENTINEL}>Est. wrap-up - {wrapUpLabel}</option>
          )}
          {sortedEvents.map((ev) => (
            <option key={ev.event_id} value={ev.event_id}>
              {eventOptionLabel(ev)}
            </option>
          ))}
        </select>
        {slot.selection === MANUAL_SENTINEL && (
          <input
            type="time"
            value={slot.manualTime}
            onChange={(e) =>
              setSlot({ selection: MANUAL_SENTINEL, manualTime: e.target.value })
            }
            style={{ width: 110, flex: "0 0 auto" }}
          />
        )}
      </div>
    );
  }

  // Live preview of the currently-being-edited employee. Returns either a
  // computed { spanHours, breakHours, hours } or an error message. Drives
  // the inline summary line and Save-button enablement.
  type EditorPreview =
    | { kind: "ok"; spanHours: number; breakHours: number; hours: number }
    | { kind: "incomplete" }
    | { kind: "error"; message: string };

  const editorPreview = useMemo<EditorPreview>(() => {
    const startMin = slotToMinutes(editStart);
    const endMin = slotToMinutes(editEnd);
    if (startMin === null || endMin === null) return { kind: "incomplete" };
    let span = endMin - startMin;
    if (span <= 0) span += 24 * 60; // crossed midnight
    if (span <= 0) return { kind: "error", message: "End time is at or before start time." };

    let breakMin = 0;
    for (const b of editBreaks) {
      const bs = slotToMinutes(b.start);
      const be = slotToMinutes(b.end);
      if (bs === null || be === null) continue;
      let bSpan = be - bs;
      if (bSpan <= 0) bSpan += 24 * 60;
      if (bSpan > 0) breakMin += bSpan;
    }
    if (breakMin >= span) {
      return { kind: "error", message: "Clocked-out periods exceed the worked span." };
    }
    return {
      kind: "ok",
      spanHours: span / 60,
      breakHours: breakMin / 60,
      hours: Math.max(0, (span - breakMin) / 60),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editStart, editEnd, editBreaks, eventById]);

  function addBreakDraft() {
    const uid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setEditBreaks((prev) => [...prev, { uid, start: emptySlot, end: emptySlot }]);
  }
  function updateBreakStart(i: number, slot: SlotPick) {
    setEditBreaks((prev) => prev.map((b, idx) => (idx === i ? { ...b, start: slot } : b)));
  }
  function updateBreakEnd(i: number, slot: SlotPick) {
    setEditBreaks((prev) => prev.map((b, idx) => (idx === i ? { ...b, end: slot } : b)));
  }
  function removeBreakDraft(i: number) {
    setEditBreaks((prev) => prev.filter((_, idx) => idx !== i));
  }

  function resetEditor() {
    setEditName("");
    setEditUserId(null);
    setEditStart(defaultStart);
    setEditEnd(defaultEnd);
    setEditBreaks([]);
    setEditingIndex(null);
    setEditError(null);
  }

  function saveEmployee() {
    const name = editName.trim();
    if (!name) {
      setEditError("Pick the crew member from the roster.");
      return;
    }
    // A row with no roster id can only be a legacy one loaded for edit (its name
    // predates the roster requirement). A NEW row must always be keyed to a real
    // person, or it lands in payroll matched to nobody.
    if (editUserId == null && editingIndex === null) {
      setEditError("Pick the crew member from the roster.");
      return;
    }
    if (editorPreview.kind === "error") {
      setEditError(editorPreview.message);
      return;
    }
    if (editorPreview.kind !== "ok") {
      setEditError("Pick start and end times for this employee.");
      return;
    }
    const baseEntry: EmployeeHoursEntry = {
      user_id: editUserId ?? undefined,
      name,
      start: slotToHHMM(editStart),
      end: slotToHHMM(editEnd),
      break_hours: Number(editorPreview.breakHours.toFixed(2)),
      hours: Number(editorPreview.hours.toFixed(2)),
    };
    setData((prev) => {
      if (editingIndex !== null && editingIndex < prev.employee_hours.length) {
        // Preserve the existing non_billable flag + skill_rating - those live
        // on the saved tile, not in the editor, and shouldn't reset on edit.
        const next = prev.employee_hours.slice();
        next[editingIndex] = {
          ...baseEntry,
          non_billable: prev.employee_hours[editingIndex].non_billable,
          skill_rating: prev.employee_hours[editingIndex].skill_rating,
          skill_ratings: prev.employee_hours[editingIndex].skill_ratings,
        };
        return { ...prev, employee_hours: next };
      }
      return { ...prev, employee_hours: [...prev.employee_hours, baseEntry] };
    });
    setSaved(false);
    resetEditor();
  }

  // Pre-fill the editor with a saved row's contents so the crew can correct a
  // mistake without removing + re-adding. Start/end load as MANUAL_SENTINEL
  // with the stored HH:MM - we don't store the source event ids, so manual
  // mode is the only way to surface the original time exactly. Breaks load
  // as a single manual-time pair when there was any break time recorded.
  function editEmployee(i: number) {
    const emp = data.employee_hours[i];
    if (!emp) return;
    setEditName(emp.name);
    setEditUserId(emp.user_id ?? null);
    setEditStart({ selection: MANUAL_SENTINEL, manualTime: emp.start || "" });
    setEditEnd({ selection: MANUAL_SENTINEL, manualTime: emp.end || "" });
    setEditBreaks([]); // Drop break detail; crew re-adds breaks if they want different math.
    setEditingIndex(i);
    setEditError(null);
    // Editor is already visible; nudge focus toward it so the crew notices
    // the swap (especially with longer saved tables).
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }


  // Crew-lead 1-5 skill rating for this mover on this job. Tapping the active
  // star again clears it back to N/A (null). Display-only - never touches the
  // man-hours math.
  // Set one per-skill rating (0-5) for employee i, keyed by skill name. A
  // rating of null clears that skill from the map.
  function setEmployeeSkillTypeRating(i: number, skillName: string, rating: number | null) {
    setData((prev) => ({
      ...prev,
      employee_hours: prev.employee_hours.map((e, idx) => {
        if (idx !== i) return e;
        const next = { ...(e.skill_ratings || {}) };
        if (rating === null) delete next[skillName];
        else next[skillName] = rating;
        return { ...e, skill_ratings: next };
      }),
    }));
    setSaved(false);
  }

  function removeEmployee(i: number) {
    setData((prev) => ({
      ...prev,
      employee_hours: prev.employee_hours.filter((_, idx) => idx !== i),
    }));
    setSaved(false);
    // If we were editing the row being removed, drop the editor state too.
    if (editingIndex === i) resetEditor();
  }

  // Sum actuals first, round once at the end - per the company rule. Each
  // row's display stays unrounded so users can see the raw math.
  const totalActualHours = useMemo(
    () =>
      data.employee_hours.reduce(
        (sum, e) => sum + (e.non_billable ? 0 : (e.hours || 0)),
        0,
      ),
    [data.employee_hours],
  );
  const totalBillableHours = useMemo(
    () => roundBillableQuarter(totalActualHours),
    [totalActualHours],
  );

  // Estimated-hours baseline (linked estimate hours, else calendar scheduled
  // duration) for the est-vs-actual comparison. Fetched read-only; the actual
  // side is the live billable man-hours above. Quiet on error.
  const [estHours, setEstHours] = useState<{ hours: number | null; source: string } | null>(null);
  useEffect(() => {
    if (!jobUuid) { setEstHours(null); return; }
    let cancelled = false;
    apiFetch<{ estimated_hours: number | null; source: string }>(
      `/api/job-report/estimated-hours?job_uuid=${encodeURIComponent(jobUuid)}`,
    )
      .then((r) => { if (!cancelled) setEstHours({ hours: r.estimated_hours, source: r.source }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [jobUuid]);

  async function doSave() {
    // Validate bill review checkbox
    const billData = billRef.current?.getData();
    if (!driveOnly && billData !== null && billData !== undefined && !billReviewed) {
      return setErr("Please confirm you have reviewed the auto-populated bill items before saving.");
    }

    // Force-flush both drafts BEFORE the POST attempt. The autosave
    // debounce (750ms) means a fast click after typing could submit with
    // a stale draft on disk; if the POST then fails and the user navigates
    // away, the load effect's draft fallback would restore the wrong state.
    // Cancel any pending debounce and write the current values now so the
    // localStorage copy always matches what we're trying to send.
    if (draftSaveTimeoutRef.current !== null) {
      window.clearTimeout(draftSaveTimeoutRef.current);
      draftSaveTimeoutRef.current = null;
    }
    if (jobUuid) saveReportDraft(jobUuid, { data, billReviewed });
    setDraftStatus("saved");
    billRef.current?.flushDraft?.();

    // Clear the stale "✓ Report saved" banner from the previous load/save
    // before we start. Otherwise a failed update shows the success banner
    // and the error banner together, which reads as nonsense - the user
    // can't tell if anything actually saved.
    setSaved(false);
    setErr(null);

    setBusy(true);
    try {
      await apiFetch("/api/job-report", {
        method: "POST",
        body: JSON.stringify({
          job_uuid: jobUuid,
          personal_vehicles: data.personal_vehicles,
          dumpster_pct: data.dumpster_pct,
          recycling_pct: data.recycling_pct,
          // Drive-only days skip the billing/eval questions; send backend-valid
          // placeholders so the required columns still satisfy the schema.
          billing_method: driveOnly ? (data.billing_method || "end_of_job") : data.billing_method,
          review_candidate: driveOnly ? (data.review_candidate || "na") : data.review_candidate,
          hours_match: driveOnly ? (data.hours_match ?? true) : data.hours_match,
          hours_mismatch_reason: data.hours_mismatch_reason.trim() || null,
          has_crew_feedback: data.has_crew_feedback,
          // "No" answer keeps a null body; "Yes" sends the trimmed text.
          crew_feedback: data.has_crew_feedback ? (data.crew_feedback.trim() || null) : null,
          out_of_town: !!data.out_of_town,
          bill_personal_vehicles: !!data.bill_personal_vehicles,
          job_type_tags: data.job_type_tags,
          // Drop any partially-filled truck rows (no fullness picked yet).
          truck_fullness: data.truck_fullness.filter(
            (t) => t.truck && t.vertical_pct > 0 && t.horizontal_pct > 0,
          ),
          overage_note: data.overage_note.trim() || null,
          hours_verified: !!data.hours_verified,
          // Strip empty rows so the sheet column doesn't get noise from
          // accidentally-added employees the crew didn't fill in.
          employee_hours: data.employee_hours
            .filter((e) => e.name.trim() || e.hours > 0 || e.start || e.end)
            .map((e) => ({
              name: e.name.trim(),
              start: e.start,
              end: e.end,
              break_hours: Number(e.break_hours) || 0,
              hours: Number(e.hours) || 0,
              non_billable: !!e.non_billable,
              out_of_town: !!e.out_of_town,
              skill_rating: e.skill_rating ?? null,
              skill_ratings: e.skill_ratings ?? null,
            })),
        }),
      });

      // Save bill alongside the report
      if (billData) {
        await apiFetch("/api/bill", {
          method: "POST",
          body: JSON.stringify({
            job_uuid: jobUuid,
            items: billData.items,
            global_discount: billData.globalDiscount,
            notes: billData.notes || null,
          }),
        });
      }

      setSaved(true);
      fireConfetti(); // celebrate a submitted report
      // Submit succeeded - discard the in-progress drafts (report + bill).
      // The server is now authoritative; further edits start fresh drafts.
      clearReportDraft(jobUuid);
      billRef.current?.clearDraft?.();
      setDraftStatus("idle");
    } catch (e: any) {
      // "Failed to fetch" is the browser's generic for any network failure
      // including a Render cold start that exceeded the fetch timeout. The
      // POST may have actually committed server-side - turn the message
      // into something actionable so the crew knows to verify on refresh
      // instead of re-typing everything.
      const raw = e?.message ?? "Save failed. Please try again.";
      const friendlier = /failed to fetch|network/i.test(raw)
        ? `${raw} - your data is preserved locally; refresh the page to see if the save went through, then retry if not.`
        : raw;
      setErr(friendlier);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!jobUuid) return setErr("No job selected.");
    // Mixed LD days (labor + driving): the long-distance documents are required.
    if (mixedLd) {
      if (!priorDone) return setErr("Complete the driver's Prior On-Duty statement before submitting.");
      if (!bolStatus && !bolDeferred) return setErr("Attach the trip's Bill of Lading (or mark not at destination yet) before submitting.");
    }
    // Drive-only LD days skip the billing/eval questions (no labor to bill).
    if (!driveOnly) {
      if (data.has_personal_vehicles === null) return setErr("Indicate whether personal vehicles were at the job site.");
      if (data.has_personal_vehicles && data.personal_vehicles < 1) return setErr("Enter how many personal vehicles were at the job site.");
      if (data.has_dumpster_use === null) return setErr("Indicate whether the M1 dumpster was used on this job.");
      if (data.has_dumpster_use && data.dumpster_pct <= 0) return setErr("Select the M1 dumpster fill percentage.");
      if (data.has_recycling_use === null) return setErr("Indicate whether the M1 recycling bin was used on this job.");
      if (data.has_recycling_use && data.recycling_pct <= 0) return setErr("Select the M1 recycling bin fill percentage.");
      if (!data.billing_method) return setErr("Select a billing method.");
      if (data.review_candidate === null) return setErr("Indicate whether this client is a review candidate.");
      if (data.hours_match === null) return setErr("Indicate whether hours worked match hours billed.");
      if (!data.hours_match && !data.hours_mismatch_reason.trim())
        return setErr("Please explain why the hours don't match.");
      if (data.has_crew_feedback === null)
        return setErr("Indicate whether you have any feedback for the office.");
      if (data.has_crew_feedback && !data.crew_feedback.trim())
        return setErr("Please share your feedback or change your answer to No.");
    }

    // Show DVIR reminder before saving
    pendingSaveRef.current = doSave;
    setShowDVIRModal(true);
  }

  if (!jobUuid) {
    return (
      <div className="card" style={{ color: "var(--muted)", textAlign: "center", padding: "28px 16px" }}>
        Select a job to fill out the job report.
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="card" style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
        <div>Loading report…</div>
        <div style={{ marginTop: 6 }}>
          If this stays visible for more than a few seconds, refresh the app -
          the fetch may have stalled.
        </div>
      </div>
    );
  }

  return (
    <>
    {showDVIRModal && (
      <DVIRReminderModal
        trigger="report"
        onProceed={() => {
          setShowDVIRModal(false);
          pendingSaveRef.current?.();
          pendingSaveRef.current = null;
        }}
        onCancel={() => {
          setShowDVIRModal(false);
          pendingSaveRef.current = null;
        }}
      />
    )}
    <BillCalculator
      ref={billRef}
      jobUuid={jobUuid}
      jobName={jobName}
      dumpsterPct={data.dumpster_pct}
      recyclingPct={data.recycling_pct}
      employeeHours={loaded ? data.employee_hours : undefined}
      personalVehicleCount={loaded && data.bill_personal_vehicles ? data.personal_vehicles : 0}
      truckCount={
        loaded
          ? data.truck_fullness.filter((t) => (t.truck || "").trim().length > 0).length
          : undefined
      }
    >
      {(billSlots) => (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Draft autosave indicator. Hidden once the report is submitted
          (the existing "✓ Report saved" banner below covers that state). */}
      {!saved && (
        <div
          className="small"
          aria-live="polite"
          style={{
            color:
              draftStatus === "saved"
                ? "var(--ok)"
                : draftStatus === "saving"
                  ? "var(--muted)"
                  : "var(--muted)",
            textAlign: "right",
            minHeight: 16,
          }}
        >
          {draftStatus === "saving" && "Saving draft…"}
          {draftStatus === "saved" && "✓ Draft saved"}
        </div>
      )}

      {/* Report header - surfaced at the top so crew confirm at a glance
          which job they're reporting on before filling anything out. */}
      {jobName && (
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "var(--text)",
            paddingBottom: 4,
            borderBottom: "1px solid var(--border)",
          }}
        >
          {jobName}
        </div>
      )}

      {/* LD driving days: remind whoever enters pay that drive time is a fixed
          rate, not hourly. Driving (RODS/DUTY) events are already excluded from
          the billable Employee Hours below - this note guards the manual entry. */}
      {longDistance && (driveOnly || mixedLd) && (
        <div
          style={{
            border: "1px solid var(--warn)",
            background: "var(--warn-bg)",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: "var(--warn)" }}>Pay reminder (long-distance driving):</strong>{" "}
          Movers are <strong>not</strong> paid hourly for drive time - long-distance
          driving is paid at a fixed rate. Do not enter drive time as billable/hourly pay.
        </div>
      )}

      {/* Estimate reference - self-hides unless this job has a linked estimate. */}
      <OverageCheck
        jobUuid={jobUuid}
        value={data.overage_note}
        onChange={(v) => { set("overage_note", v); setSaved(false); }}
      />

      {/* ── Job data (employee hours + M1 equipment + personal vehicles) ──
          Employee hours drive one auto-populated $80/hr labor line per
          billable employee in the Invoice Builder above, and also land
          in the admin/payroll sheet column. Personal vehicles can be
          billed as crew transport ($100/vehicle/day) via the checkbox
          below. */}
      {!driveOnly && (
      <div className="card">
        <div className="sectionTitle">Job data</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
          Hours, equipment, and vehicles - the data used to build the invoice line items.
        </div>

        {/* Job type comes first: it decides which skills are rated per employee
            below, so the crew must pick it before the skill rows are meaningful.
            Deliberately NOT gated on canRate: a job with no designated rater on
            site still needs its job type recorded. Any crew member sets it. */}
        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
          Job type<BetaTag feature="jobTypeTags" />
        </div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>
          {ht.jobTypeHint}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
          {Array.from(new Set([...jobTypes, ...data.job_type_tags])).map((tag) => {
            const active = data.job_type_tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  setData((prev) => ({
                    ...prev,
                    job_type_tags: active
                      ? prev.job_type_tags.filter((t) => t !== tag)
                      : [...prev.job_type_tags, tag],
                  }));
                  setSaved(false);
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: active ? "2px solid var(--brand)" : "1px solid var(--border)",
                  background: active ? "rgba(93,214,194,0.18)" : "transparent",
                  color: active ? "var(--brand)" : "var(--text)",
                  fontWeight: active ? 700 : 400,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {tag}
              </button>
            );
          })}
        </div>

        {/* Inventory is logged on long-distance jobs only (ADR 0015). On a local
            job there is no Inventory tab, so this line would be a permanent
            "none logged yet" pointing at a tab the crew can't see. */}
        {longDistance && <InventoryCountsSummary jobUuid={jobUuid} />}

        {/* Wrap-up estimator sits directly above the hours record because it
            feeds it: the projected wrap-up time is offered as an End option in
            the start/end pickers below. */}
        <WrapUpEstimator jobUuid={jobUuid} onWrapUpChange={setWrapUpTime} />

        <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Employee man-hours</span>
          <BetaTag feature="rosterTypeahead" style={{ marginTop: 0 }} />
          {canRate && <BetaTag feature="employeeSkillRating" style={{ marginTop: 0 }} />}
        </div>
        {/* Non-billable time is no longer a per-entry toggle here - it goes in
            the off-job hours report so payroll and billing stay clean. */}
        <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
          Log the hours each crew member worked <strong>on this job</strong>. For
          non-billable or off-job time (shop work, errands, anything not billed to
          this job), use <strong>Profile → Log Off-Job Hours</strong> instead.
        </div>
        {/* Skill ratings are visible only to admins and designated skill raters.
            Everyone else (including crew leads) doesn't see the hint or the
            per-employee stars at all - not just a disabled version. */}
        {relevantSkills.length > 0 && canRate && ht.skillsHint && (
          <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
            {ht.skillsHint}
          </div>
        )}
        {/* What the ends of the scale actually mean. Without it, a 3 from one
            rater and a 3 from another are not the same number, and the whole
            point of rating is comparability across crews. */}
        {relevantSkills.length > 0 && canRate && ht.skillScaleHint && (
          <div
            className="small"
            style={{
              color: "var(--muted)",
              marginBottom: 8,
              padding: "6px 8px",
              border: "1px dashed var(--border)",
              borderRadius: 8,
              lineHeight: 1.5,
            }}
          >
            {ht.skillScaleHint}
          </div>
        )}
        {/* Non-raters get a one-line explanation rather than silently missing
            stars, so "where did the skill ratings go" has an answer on screen. */}
        {relevantSkills.length > 0 && <RaterGate canRate={canRate} />}

        {/* The editor is always available - even with 0-1 timeline events the
            crew can log hours via the "Manual time…" option in the pickers.
            The earlier hard gate hid the whole editor (and its manual path),
            which read as "no option to log". */}
        <>
            {sortedEvents.length < 2 ? (
              <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
                No start/finish events logged yet - choose “Manual time…” in the
                start and end pickers to type each person's hours by hand.
              </div>
            ) : (
              <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
                Type a name, pick the start and end events, add any clocked-out
                periods, then Save. Repeat for each crew member.
              </div>
            )}

            <div
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 12,
                marginBottom: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {editingIndex !== null && (
                <div
                  className="small"
                  style={{
                    color: "var(--brand2)",
                    background: "rgba(106,167,255,0.08)",
                    border: "1px solid rgba(106,167,255,0.3)",
                    borderRadius: 6,
                    padding: "6px 10px",
                  }}
                >
                  Editing entry #{editingIndex + 1}. Save replaces the row; Cancel keeps the original.
                </div>
              )}
              <RosterPicker
                userId={editUserId}
                legacyName={editUserId == null && editName ? editName : undefined}
                onChange={(id, nm) => {
                  setEditUserId(id);
                  setEditName(nm);
                  setEditError(null);
                }}
              />

              <div className="row wrap" style={{ gap: 6, alignItems: "center" }}>
                {renderSlotPicker(editStart, (s) => { setEditStart(s); setEditError(null); }, "Start event…")}
                <span className="small">→</span>
                {renderSlotPicker(editEnd, (s) => { setEditEnd(s); setEditError(null); }, "End event…", true)}
              </div>

              <div className="col" style={{ gap: 6 }}>
                <div className="small" style={{ color: "var(--muted)" }}>
                  Clocked-out periods (lunch, errands, anything that should be
                  subtracted from hours worked):
                </div>
                {editBreaks.map((b, i) => (
                  <div key={b.uid} className="row wrap" style={{ gap: 6, alignItems: "center" }}>
                    {renderSlotPicker(b.start, (s) => updateBreakStart(i, s), "Out at…")}
                    <span className="small">→</span>
                    {renderSlotPicker(b.end, (s) => updateBreakEnd(i, s), "Back at…")}
                    <button
                      type="button"
                      onClick={() => removeBreakDraft(i)}
                      style={{ color: "var(--danger)", flex: "0 0 auto" }}
                      title="Remove this clocked-out period"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addBreakDraft}
                  style={{ alignSelf: "flex-start", fontSize: 12 }}
                >
                  + Add clocked-out period
                </button>
              </div>

              {editorPreview.kind === "ok" && (
                <div className="small" style={{ color: "var(--muted)" }}>
                  Worked:{" "}
                  <strong style={{ color: "var(--text)" }}>
                    {editorPreview.hours.toFixed(2)} hrs
                  </strong>{" "}
                  <span style={{ color: "var(--muted)" }}>
                    (span {editorPreview.spanHours.toFixed(2)}
                    {editorPreview.breakHours > 0 ? ` − break ${editorPreview.breakHours.toFixed(2)}` : ""})
                  </span>
                </div>
              )}

              {editError && (
                <div className="small" style={{ color: "var(--danger)" }}>{editError}</div>
              )}

              <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                {/* Cancel always available when editing (need to back out);
                    otherwise only when the form has user-supplied content. */}
                {(editingIndex !== null ||
                  editName ||
                  editStart.selection !== defaultStart.selection ||
                  editEnd.selection !== defaultEnd.selection ||
                  editStart.manualTime ||
                  editEnd.manualTime ||
                  editBreaks.length > 0) && (
                  <button type="button" onClick={resetEditor}>Cancel</button>
                )}
                <button type="button" onClick={saveEmployee} className="btnPrimary">
                  {editingIndex !== null ? "Save changes" : "Save employee"}
                </button>
              </div>
            </div>
        </>

        {data.employee_hours.length > 0 && (
          <div className="col" style={{ gap: 0 }}>
            <div
              className="small"
              style={{
                color: "var(--muted)",
                fontWeight: 700,
                paddingBottom: 6,
                borderBottom: "1px solid var(--border)",
              }}
            >
              Saved ({data.employee_hours.length})
            </div>
            {data.employee_hours.map((emp, i) => {
              const isEditing = editingIndex === i;
              return (
                <div
                  key={i}
                  style={{
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                    opacity: emp.non_billable ? 0.7 : 1,
                    background: isEditing ? "rgba(106,167,255,0.06)" : undefined,
                  }}
                >
                  {/* Name + hours on the left, Edit/Remove on the right. Skill
                      ratings used to sit inside this left column, which the
                      buttons squeeze on a phone, so long skill names wrapped and
                      the stars got crushed. Ratings are now their own full-width
                      block below this row (see further down). */}
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{emp.name}</div>
                      </div>
                      <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                        {emp.start && emp.end ? `${emp.start}–${emp.end}` : ""}
                        {emp.break_hours > 0 ? ` · break ${emp.break_hours.toFixed(2)}h` : ""}
                      </div>
                      <div className="small" style={{ marginTop: 2 }}>
                        <strong style={{ color: "var(--text)" }}>
                          {roundBillableQuarter(emp.hours).toFixed(2)}h
                        </strong>
                        <span style={{ color: "var(--muted)" }}>
                          {" "}(actual {emp.hours.toFixed(2)}h)
                        </span>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, flex: "0 0 auto" }}>
                      <button
                        type="button"
                        onClick={() => editEmployee(i)}
                        disabled={isEditing}
                      >
                        {isEditing ? "Editing…" : "Edit"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeEmployee(i)}
                        style={{ color: "var(--danger)" }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {canRate && (
                    <div style={{ marginTop: 8 }}>
                      <EmployeeSkillRatings
                        skills={relevantSkills}
                        ratings={emp.skill_ratings || {}}
                        disabled={false}
                        onRate={(skillName, r) => setEmployeeSkillTypeRating(i, skillName, r)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {/* Total man-hours: round only at the very end, after summing
                actuals across billable entries. The rounded value is what
                the office assistant invoices off; the actual sum is shown
                in parens whenever it differs from the rounded value. */}
            <div
              className="row"
              style={{
                justifyContent: "space-between",
                alignItems: "center",
                paddingTop: 10,
                marginTop: 4,
                fontWeight: 700,
              }}
            >
              <span>Total man-hours</span>
              <span>
                {totalBillableHours.toFixed(2)}h
                <span
                  className="small"
                  style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}
                >
                  (actual {totalActualHours.toFixed(2)}h)
                </span>
              </span>
            </div>
            {estHours && estHours.hours != null && (
              <>
                <div
                  className="small"
                  style={{ color: "var(--muted)", marginTop: 6, display: "flex", justifyContent: "space-between" }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <BetaTag feature="estVsActualHours" style={{ marginTop: 0 }} />
                    Approx. estimate {estHours.hours.toFixed(2)}h{" "}
                    <span style={{ opacity: 0.8 }}>
                      ({estHours.source === "estimate" ? "from estimate" : "from schedule × crew"})
                    </span>
                  </span>
                  {(() => {
                    const delta = totalBillableHours - estHours.hours;
                    const over = delta > 0.01;
                    const under = delta < -0.01;
                    return (
                      <span style={{ color: over ? "var(--danger)" : under ? "var(--ok)" : "var(--muted)", fontWeight: 600 }}>
                        {over ? "+" : ""}{delta.toFixed(2)}h {over ? "over" : under ? "under" : "on target"}
                      </span>
                    );
                  })()}
                </div>
                {/* Say plainly it is a rough number, not a quoted estimate. The
                    crew and office should not treat this delta as authoritative
                    yet - the baseline is a rough approximation for now. */}
                <div className="small" style={{ color: "var(--muted)", opacity: 0.75, marginTop: 2, fontStyle: "italic" }}>
                  Rough approximation, not a firm estimate - for reference only.
                </div>
              </>
            )}
          </div>
        )}

        {/* M1 equipment (dumpster + recycling; the sliders drive invoice lines) */}
        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>M1 equipment *</div>
        <div style={{ fontWeight: 700, fontSize: 12, marginTop: 8 }}>Dumpster (trash)</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>Was the M1 dumpster used on this job?</div>
        <YesNo
          value={data.has_dumpster_use}
          onChange={(v) => { setData((prev) => ({ ...prev, has_dumpster_use: v, dumpster_pct: v ? Math.max(5, prev.dumpster_pct) : 0 })); setSaved(false); }}
          yesLabel="Yes"
          noLabel="No"
        />
        {data.has_dumpster_use && (
          <div style={{ marginTop: 14 }}>
            <PctSlider label="Dumpster fill estimate" value={data.dumpster_pct} onChange={(v) => set("dumpster_pct", v)} color="var(--danger)" />
          </div>
        )}
        <div style={{ fontWeight: 700, fontSize: 12, marginTop: 14 }}>Recycling bin</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>Was the M1 recycling bin used on this job?</div>
        <YesNo
          value={data.has_recycling_use}
          onChange={(v) => { setData((prev) => ({ ...prev, has_recycling_use: v, recycling_pct: v ? Math.max(5, prev.recycling_pct) : 0 })); setSaved(false); }}
          yesLabel="Yes"
          noLabel="No"
        />
        {data.has_recycling_use && (
          <div style={{ marginTop: 14 }}>
            <PctSlider label="Recycling bin fill estimate" value={data.recycling_pct} onChange={(v) => set("recycling_pct", v)} color="var(--ok)" />
          </div>
        )}

        {/* Personal vehicles at the job site */}
        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>Personal vehicles at job site *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>Were any crew personal vehicles at the job site?</div>
        <YesNo
          value={data.has_personal_vehicles}
          onChange={(v) => { setData((prev) => ({ ...prev, has_personal_vehicles: v, personal_vehicles: v ? Math.max(1, prev.personal_vehicles) : 0 })); setSaved(false); }}
          yesLabel="Yes"
          noLabel="No"
        />
        {data.has_personal_vehicles && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
              <button type="button" onClick={() => set("personal_vehicles", Math.max(1, data.personal_vehicles - 1))} style={stepBtnStyle} aria-label="Decrease">−</button>
              <span style={{ fontSize: 28, fontWeight: 700, minWidth: 36, textAlign: "center" }}>{data.personal_vehicles}</span>
              <button type="button" onClick={() => set("personal_vehicles", data.personal_vehicles + 1)} style={stepBtnStyle} aria-label="Increase">+</button>
              <span className="small" style={{ color: "var(--muted)" }}>vehicle{data.personal_vehicles !== 1 ? "s" : ""}</span>
            </div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 14, marginTop: 12 }}>
              <input
                type="checkbox"
                checked={data.bill_personal_vehicles}
                onChange={(e) => set("bill_personal_vehicles", e.target.checked)}
                style={{ marginTop: 2, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }}
              />
              <span>
                Bill these as <strong>crew transport vehicles</strong> ($100 / vehicle / day) - adds one line per vehicle to the Invoice Builder.
              </span>
            </label>
          </>
        )}

        {/* Truck fullness - composite vertical × horizontal fill against the
            interior 25% marks, one reading per truck used. */}
        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14, display: "flex", alignItems: "center", gap: 6 }}>
          Truck fullness<BetaTag feature="truckFullness" />
        </div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>
          {ht.truckFullnessHint}
        </div>
        <TruckFullnessEditor
          value={data.truck_fullness}
          onChange={(next) => { set("truck_fullness", next); setSaved(false); }}
        />
      </div>
      )}

      {/* Drive-only LD days skip auto-populate review, billing method,
          personal vehicles, review candidate, and hours reconciliation. */}
      {!driveOnly && (
      <>
      {/* ── Billing (bill helper + totals + notes + review + method in one tile) ── */}
      <div className="card">
        <div className="sectionTitle">Billing</div>
        <div style={{ marginBottom: 12 }}>
          {billSlots.billHelper}
          {billSlots.totals}
          {billSlots.notes}
        </div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer", marginTop: 4 }}>
          <input
            type="checkbox"
            checked={billReviewed}
            onChange={(e) => { setBillReviewed(e.target.checked); setSaved(false); }}
            style={{ marginTop: 3, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }}
          />
          <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>
            I have reviewed and confirmed the correctness of the auto-populated line items
            in the Invoice Builder above (labor lines from Employee Hours plus any
            dumpster / recycling charges from the sliders).
          </span>
        </label>
        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>Billing method *</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {BILLING_OPTIONS.map(({ value, label }) => {
            const active = data.billing_method === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => set("billing_method", value)}
                style={{
                  padding: "11px 14px",
                  borderRadius: 10,
                  border: active ? "2px solid var(--brand)" : "1px solid var(--border)",
                  background: active ? "rgba(93,214,194,0.18)" : "transparent",
                  color: active ? "var(--brand)" : "var(--text)",
                  fontWeight: active ? 700 : 400,
                  fontSize: 13,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── The rest of the tiles (any order at the bottom of the tab). */}

      {/* ── Personal vehicles ── */}
      <div className="card">
        <div className="sectionTitle">Job wrap-up</div>
        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>Review candidate *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>
          Is this client a good candidate for the office to seek a review from?
        </div>
        <ThreeWay
          value={data.review_candidate}
          onChange={(v) => set("review_candidate", v)}
          options={[
            { value: "yes", label: "Yes - reach out", tone: "ok" },
            { value: "no",  label: "No",              tone: "danger" },
            { value: "na",  label: "N/A",             tone: "muted" },
          ]}
        />

        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>Hours reconciliation *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>
          Do hours worked match hours billed?
        </div>
        <YesNo
          value={data.hours_match}
          onChange={(v) => set("hours_match", v)}
          yesLabel="Yes, they match"
          noLabel="No, there's a difference"
        />
        {data.hours_match === false && (
          <div style={{ marginTop: 12 }}>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>
              Please explain the discrepancy *
            </div>
            <textarea
              value={data.hours_mismatch_reason}
              onChange={(e) => set("hours_mismatch_reason", e.target.value)}
              placeholder={ht.hoursMismatchPlaceholder}
              rows={3}
              style={textareaStyle}
            />
          </div>
        )}

        {/* Crew feedback folded into the wrap-up tile, kept at the bottom. */}
        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14, display: "flex", alignItems: "center", gap: 6 }}>
          Crew feedback *<BetaTag feature="crewFeedback" />
        </div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>
          Would you like to submit any general feedback or feedback about this job in particular to the office?
        </div>
        <YesNo
          value={data.has_crew_feedback}
          onChange={(v) => {
            setData((prev) => ({
              ...prev,
              has_crew_feedback: v,
              crew_feedback: v ? prev.crew_feedback : "",
            }));
            setSaved(false);
          }}
          yesLabel="Yes"
          noLabel="No"
        />
        {data.has_crew_feedback && (
          <div style={{ marginTop: 12 }}>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>
              Share your feedback * - the more detail, the better we can address it
            </div>
            <textarea
              value={data.crew_feedback}
              onChange={(e) => set("crew_feedback", e.target.value)}
              placeholder="What happened, what the client said, what we should know - be as specific as you can."
              rows={4}
              style={textareaStyle}
            />
          </div>
        )}
      </div>
      </>
      )}

      {/* ── Long-distance (interstate): documents + per-diem + RODS in one
          tile. Positioned last; on mixed labor+driving days the documents are
          required to submit. */}
      {longDistance && (
        <div className="card" style={{ borderColor: "var(--brand)" }}>
          <div className="sectionTitle">Long-distance</div>

          <div data-component="ReportDocuments" style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Documents</div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
            Required for this interstate trip. Each driver's PODS is tracked in the Driver PODS section below. Complete or attach the Bill of Lading; multi-day trips link this day to the trip's BOL.
          </div>
          <div className="col" style={{ gap: 12 }}>
            {bolStatus ? (
              <div className="col" style={{ gap: 10, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div className="small" style={{ color: "var(--muted)" }}>
                  {tripLink ? <>Attached trip BOL: <strong>{tripLink.label}</strong></> : <>This job's BOL</>}{bolRef ? ` (${bolRef})` : ""}
                </div>
                <ChecklistItem
                  done={bolStatus === "origin_signed" || bolStatus === "delivered"}
                  label="BOL signed at origin"
                  hint="Shipper + carrier, before loading"
                  onGo={() => nav(`/long-distance?section=bol${attachedBolId ? `&bol_id=${encodeURIComponent(attachedBolId)}` : ""}`)}
                />
                <ChecklistItem
                  done={bolStatus === "delivered"}
                  label="BOL signed at destination"
                  hint="Shipper + carrier, on delivery"
                  onGo={() => nav(`/long-distance?section=bol${attachedBolId ? `&bol_id=${encodeURIComponent(attachedBolId)}` : ""}`)}
                />
                {tripLink ? (
                  <button type="button" onClick={() => linkTrip(null)} style={{ fontSize: 12, alignSelf: "flex-start" }}>Unlink this day from the trip BOL</button>
                ) : (
                  <button type="button" onClick={detachOwnBol} style={{ fontSize: 12, alignSelf: "flex-start" }}>Detach this BOL - pick or start another</button>
                )}
              </div>
            ) : bolDeferred ? (
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>Bill of Lading</div>
                  <div className="small" style={{ color: "var(--muted)" }}>
                    {bolDeferred === "load"
                      ? "Load not completed yet - no signed BOL to attach."
                      : bolDeferred === "unload"
                        ? "Unload not completed yet - no signed BOL to attach."
                        : "Marked as not yet complete - no signed BOL to attach."}
                  </div>
                </div>
                <button type="button" onClick={() => setBolDeferredFlag("")} style={{ fontSize: 12 }}>Attach BOL</button>
              </div>
            ) : (
              <div className="col" style={{ gap: 8, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div style={{ fontWeight: 700 }}>Bill of Lading</div>
                <div className="small" style={{ color: "var(--muted)" }}>
                  Save inventory on the <strong>Inventory</strong> tab to auto-create and attach a
                  BOL for this job. Or pick / start one here:
                </div>
                <label className="col" style={{ gap: 4 }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Select in-progress BOL</span>
                  <select value="" onChange={(e) => { const o = openBols.find((b) => b.bol_id === e.target.value); if (o) linkTrip(o); }}>
                    <option value="">Select an in-progress BOL...</option>
                    {openBols.map((b) => (<option key={b.bol_id} value={b.bol_id}>{b.job_name || "Untitled"}{b.job_date ? " (" + b.job_date + ")" : ""}</option>))}
                  </select>
                </label>
                <div className="row wrap" style={{ gap: 8 }}>
                  <button type="button" className="btnPrimary" onClick={() => nav("/long-distance?section=bol")} style={{ fontSize: 13 }}>Start a new BOL</button>
                  <button type="button" onClick={() => setBolDeferredFlag("load")} style={{ fontSize: 13 }}>Load not completed yet</button>
                </div>
              </div>
            )}

            {/* Per-diem sits next to the BOL selector so the crew rep
                confirming which BOL is attached also flags whether the
                crew was out of town for that day's charge. */}
            <label data-component="ReportPerDiem" style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 14, marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <input type="checkbox" checked={data.out_of_town} onChange={(e) => set("out_of_town", e.target.checked)} style={{ marginTop: 2, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }} />
              <span>The <strong>crew</strong> started and ended the day out of town ($50 per-diem, per crew member)</span>
            </label>
          </div>

          {/* Per-driver PODS check */}
          <div className="row" style={{ alignItems: "center", gap: 8, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Driver PODS</div>
            <BetaTag feature="podsPerDriver" style={{ marginTop: 0 }} />
          </div>

          {/* Per-driver PODS self-verification. Auto-checks when the current
              user has a PODS filed for this trip. On a multi-day trip the
              same PODS covers subsequent days - the crew can manually check
              the box to attest without re-filing. The "Complete PODS →"
              link stays available for the actual filing flow. */}
          {(() => {
            const checked = podsForDriver || podsOverride;
            const anchorJob = tripLink?.trip_job_uuid || jobUuid;
            const toggle = () => {
              if (podsForDriver) return; // server truth wins; nothing to toggle
              const next = !podsOverride;
              setPodsOverrideState(next);
              savePodsOverride(anchorJob, meName, next);
            };
            return (
              <>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: podsForDriver ? "default" : "pointer", fontSize: 14, marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={toggle}
                    style={{ marginTop: 2, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0, cursor: podsForDriver ? "default" : "pointer" }}
                  />
                  <span>
                    As the <strong>driver</strong>, I have submitted my Prior On-Duty Statement for this trip.
                    {podsOverride && !podsForDriver && (
                      <span className="small" style={{ color: "var(--muted)", marginLeft: 6 }}>(self-attested)</span>
                    )}
                  </span>
                </label>
                {!podsForDriver && !podsOverride && (
                  <div className="small" style={{ marginLeft: 28, marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => nav("/long-distance?section=prior")}
                      style={{ background: "none", border: "none", color: "var(--brand)", padding: 0, cursor: "pointer", textDecoration: "underline", fontSize: 13 }}
                    >
                      Complete PODS →
                    </button>
                  </div>
                )}
              </>
            );
          })()}

          {/* Driver RODS sign-off (renders bare; self-hides when no driving). */}
          <RodsSignoff
            events={events}
            bolLink={bolRef ? { ref: bolRef, onOpen: () => nav(`/long-distance?section=bol${attachedBolId ? `&bol_id=${encodeURIComponent(attachedBolId)}` : ""}`) } : null}
            podsDriverNames={podsDriverNames}
            onNeedPods={() => nav("/long-distance?section=prior")}
            tripJob={tripLink?.trip_job_uuid || jobUuid}
          />
        </div>
      )}

      {err && (
        <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "rgba(255,107,107,0.1)", borderRadius: 8 }}>
          {err}
        </div>
      )}

      {saved && !busy && (
        <div style={{ color: "var(--ok)", fontSize: 13, padding: "8px 12px", background: "rgba(45,212,191,0.1)", borderRadius: 8 }}>
          ✓ Report saved{user?.name ? ` by ${user.name}` : ""}
        </div>
      )}

      <button
        type="submit"
        className="btnPrimary"
        disabled={busy}
        style={{ marginBottom: 32 }}
      >
        {busy ? "Saving…" : saved ? "Update Report" : "Save Report"}
      </button>
    </form>
      )}
    </BillCalculator>
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PctSlider({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="small" style={{ color: "var(--muted)" }}>{label}</span>
        <span style={{ fontWeight: 700, fontSize: 15, color }}>{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: color }}
      />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>Empty</span>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>Half</span>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>Full</span>
      </div>
    </div>
  );
}

function ThreeWay<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; label: string; tone: "ok" | "danger" | "muted" }[];
}) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      {options.map(({ value: v, label, tone }) => {
        const active = value === v;
        const accent =
          tone === "ok" ? "var(--brand)" :
          tone === "danger" ? "var(--danger)" :
          "var(--muted)";
        const accentBg =
          tone === "ok" ? "rgba(93,214,194,0.18)" :
          tone === "danger" ? "rgba(255,107,107,0.16)" :
          "rgba(148,163,184,0.12)";
        return (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: active ? `2px solid ${accent}` : "1px solid var(--border)",
              background: active ? accentBg : "transparent",
              color: active ? accent : "var(--muted)",
              fontWeight: active ? 700 : 400,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function YesNo({
  value,
  onChange,
  yesLabel,
  noLabel,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  yesLabel: string;
  noLabel: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      {[
        { v: true, label: yesLabel },
        { v: false, label: noLabel },
      ].map(({ v, label }) => {
        const active = value === v;
        return (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: active
                ? `2px solid ${v ? "var(--brand)" : "var(--danger)"}`
                : "1px solid var(--border)",
              background: active
                ? v ? "rgba(93,214,194,0.18)" : "rgba(255,107,107,0.16)"
                : "transparent",
              color: active
                ? v ? "var(--brand)" : "var(--danger)"
                : "var(--muted)",
              fontWeight: active ? 700 : 400,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Per-employee skill ratings: one compact row per skill relevant to this job's
// type(s) - core skills always, plus any whose relevant_job_types match.
// Display-only - never affects the man-hours math.
function EmployeeSkillRatings({
  skills,
  ratings,
  onRate,
  disabled = false,
}: {
  skills: Skill[];
  ratings: Record<string, number>;
  onRate: (skillName: string, rating: number | null) => void;
  disabled?: boolean;
}) {
  if (skills.length === 0) {
    return (
      <div className="small" style={{ color: "var(--muted)" }}>
        Pick a job type above to rate skills.
      </div>
    );
  }
  return (
    <div className="col" style={{ gap: 4, opacity: disabled ? 0.55 : 1 }}>
      <span className="small" style={{ color: "var(--muted)" }}>Skills</span>
      {skills.map((s) => (
        <SkillRatingRow key={s.id} skill={s} value={ratings[s.name]} disabled={disabled} onChange={(r) => onRate(s.name, r)} />
      ))}
    </div>
  );
}

// Skill-rater gate for the skill ratings ONLY. Job type is deliberately open to
// everyone: it is the job's descriptive data and must be collected whether or not
// a rater is on site. Anyone who is not a designated rater sees this note instead
// of the stars, and there is no self-assessment escape hatch.
function RaterGate({ canRate }: { canRate: boolean }) {
  if (canRate) return null;
  return (
    <div style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
      <div className="small" style={{ color: "var(--muted)" }}>
        Skill ratings are filled in by a designated skill rater. Ask an admin for
        skill-rater access if you need to rate the crew on this job.
      </div>
    </div>
  );
}

// Sentinel stored in skill_ratings for a skill the crew explicitly marked "not
// applicable" on this job - distinct from unrated (absent from the map) and from
// a real 0-5 score. Backend + sheet export understand this value.
const SKILL_NA = -1;

function NaButton({ on, onClick, disabled = false }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ padding: "2px 10px", borderRadius: 8, fontSize: 12, cursor: disabled ? "not-allowed" : "pointer",
        border: on ? "2px solid var(--muted)" : "1px solid var(--border)",
        background: on ? "rgba(255,255,255,0.08)" : "transparent",
        color: on ? "var(--text)" : "var(--muted)", fontWeight: on ? 700 : 400 }}>
      N/A
    </button>
  );
}

function SkillRatingRow({
  skill,
  value,
  onChange,
  disabled = false,
}: {
  skill: Skill;
  value: number | undefined;
  onChange: (rating: number | null) => void;
  disabled?: boolean;
}) {
  const v = value ?? null;
  const isNa = v === SKILL_NA;
  if (skill.binary) {
    return (
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span className="small" style={{ color: "var(--text)" }}>{skill.name}</span>
        <div className="row" style={{ gap: 4 }}>
          {([["No", 0], ["Yes", 5]] as const).map(([label, num]) => {
            const on = v === num;
            return (
              <button key={label} type="button" disabled={disabled} onClick={() => onChange(on ? null : num)}
                style={{ padding: "2px 10px", borderRadius: 8, fontSize: 12, cursor: disabled ? "not-allowed" : "pointer",
                  border: on ? "2px solid var(--brand)" : "1px solid var(--border)",
                  background: on ? "rgba(93,214,194,0.18)" : "transparent",
                  color: on ? "var(--brand)" : "var(--muted)" }}>
                {label}
              </button>
            );
          })}
          <NaButton on={isNa} disabled={disabled} onClick={() => onChange(isNa ? null : SKILL_NA)} />
        </div>
      </div>
    );
  }
  return (
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {/* Name can wrap; the stars must not shrink. minWidth:0 lets the label take
          the remaining width and wrap instead of crushing the star buttons. */}
      <span className="small" style={{ color: "var(--text)", flex: "1 1 120px", minWidth: 0 }}>{skill.name}</span>
      <div className="row" style={{ gap: 6, alignItems: "center", flex: "0 0 auto" }}>
        <div className="row" style={{ gap: 4, alignItems: "center", opacity: isNa ? 0.4 : 1 }}>
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = !isNa && v != null && n <= v;
            return (
              <button key={n} type="button" aria-label={`${skill.name} ${n} of 5`} disabled={disabled}
                onClick={() => onChange(v === n ? null : n)}
                style={{ background: "transparent", border: "none", padding: "2px 1px", cursor: disabled ? "not-allowed" : "pointer", fontSize: 20, lineHeight: 1, color: filled ? "var(--brand)" : "var(--border)" }}>
                {filled ? "★" : "☆"}
              </button>
            );
          })}
        </div>
        <NaButton on={isNa} disabled={disabled} onClick={() => onChange(isNa ? null : SKILL_NA)} />
      </div>
    </div>
  );
}

// Truck fullness: add one reading per truck used, each a composite of a
// vertical and a horizontal 25%-step fill estimate. Estimated fill is
// vertical×horizontal/100, matching the interior marks.
function TruckFullnessEditor({
  value,
  onChange,
}: {
  value: TruckFullnessEntry[];
  onChange: (next: TruckFullnessEntry[]) => void;
}) {
  // Only fleet entries reserve a fixed id; rentals are free-text so several can
  // coexist. Updates/removes go by index so two rentals never collide.
  const usedFleet = new Set(value.filter((t) => !t.is_rental).map((t) => t.truck));
  const availableFleet = TRUCK_IDS.filter((t) => !usedFleet.has(t));

  const patchAt = (i: number, patch: Partial<TruckFullnessEntry>) =>
    onChange(value.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeAt = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  const dashedChip: React.CSSProperties = {
    padding: "6px 12px", borderRadius: 999, border: "1px dashed var(--border)",
    background: "transparent", color: "var(--text)", fontSize: 13, cursor: "pointer",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {value.map((t, i) => {
        const combined = Math.round((t.vertical_pct * t.horizontal_pct) / 100);
        return (
          <div key={t.is_rental ? `rental-${i}` : t.truck} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              {t.is_rental ? (
                <input
                  value={t.truck}
                  onChange={(e) => patchAt(i, { truck: e.target.value })}
                  placeholder="Rental truck (company / name)"
                  style={{ fontWeight: 700, fontSize: 14, flex: 1, minWidth: 0 }}
                />
              ) : (
                <div style={{ fontWeight: 700, fontSize: 14 }}>{t.truck}</div>
              )}
              <button
                type="button"
                onClick={() => removeAt(i)}
                style={{ color: "var(--danger)", flexShrink: 0 }}
              >
                Remove
              </button>
            </div>
            {t.is_rental && (
              <label className="col" style={{ gap: 2, marginTop: 8 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Truck length (ft)</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={t.length_ft ?? ""}
                  onChange={(e) => patchAt(i, { length_ft: e.target.value === "" ? undefined : Number(e.target.value) })}
                  placeholder="e.g. 26"
                  style={{ width: 120 }}
                />
              </label>
            )}
            <FullnessSlider
              label="Vertical fill"
              value={t.vertical_pct}
              onChange={(p) => patchAt(i, { vertical_pct: p })}
            />
            <FullnessSlider
              label="Horizontal fill"
              value={t.horizontal_pct}
              onChange={(p) => patchAt(i, { horizontal_pct: p })}
            />
            <div className="small" style={{ color: "var(--muted)", marginTop: 8 }}>
              {t.vertical_pct > 0 && t.horizontal_pct > 0
                ? `Estimated fill: ${combined}% (V${t.vertical_pct} × H${t.horizontal_pct})${t.is_rental ? " · best guess" : ""}`
                : "Pick vertical and horizontal fill"}
            </div>
            {t.is_rental && (
              <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
                Rental trucks have no interior 25% markers - estimate the fill as best you can.
              </div>
            )}
          </div>
        );
      })}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {availableFleet.length > 0 && (
          <>
            <span className="small" style={{ color: "var(--muted)" }}>Add truck:</span>
            {availableFleet.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onChange([...value, { truck: t, vertical_pct: 0, horizontal_pct: 0 }])}
                style={dashedChip}
              >
                + {t}
              </button>
            ))}
          </>
        )}
        <button
          type="button"
          onClick={() => onChange([...value, { truck: "", vertical_pct: 0, horizontal_pct: 0, is_rental: true }])}
          style={dashedChip}
        >
          + Rental truck
        </button>
      </div>
    </div>
  );
}

// Continuous slider for truck fill, matching the M1 dumpster/recycling sliders
// (PctSlider). Replaces the old 25/50/75/100 button row.
function FullnessSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (pct: number) => void;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="small" style={{ color: "var(--muted)" }}>{label}</span>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--brand)" }}>{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--brand)" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>Empty</span>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>Half</span>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>Full</span>
      </div>
    </div>
  );
}

// Read-only actual-inventory counts on the Report tab. The crew logs items on
// the Inventory tab; this just surfaces the derived furniture/box totals at
// close-out (and points them to the Inventory tab when empty). Fetches once;
// stays quiet on error so a network blip never blocks the report.
function InventoryCountsSummary({ jobUuid }: { jobUuid: string }) {
  const [counts, setCounts] = useState<{ furniture: number; boxes: number } | null>(null);
  useEffect(() => {
    if (!jobUuid) return;
    let cancelled = false;
    apiFetch<{ furniture_count: number; box_count: number }>(
      `/api/job-inventory/${encodeURIComponent(jobUuid)}`,
    )
      .then((r) => { if (!cancelled) setCounts({ furniture: r.furniture_count, boxes: r.box_count }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [jobUuid]);
  const total = counts ? counts.furniture + counts.boxes : 0;
  return (
    <div className="small" style={{ color: "var(--muted)", marginTop: 6, marginBottom: 4 }}>
      Actual inventory:{" "}
      {counts && total > 0 ? (
        <span style={{ color: "var(--text)" }}>
          <strong>{counts.furniture}</strong> furniture · <strong>{counts.boxes}</strong> boxes
        </span>
      ) : (
        <>none logged yet - add it on the <strong>Inventory</strong> tab</>
      )}
    </div>
  );
}

// What the office estimated for this job, shown to the crew for reference.
//
// This used to compare the estimate's item counts against the actual inventory
// the crew logged and flag an overage. That comparison is gone: the item lists
// on the estimate side come from SmartMoving, where inventory is not reliably
// entered, so "actual vs estimated items" was measuring the estimator's data
// entry rather than the job. The comparison that does hold up is estimated vs
// actual man-hours, and that already lives under Total man-hours below - it is
// deliberately not duplicated here.
//
// So this card is now informational: the estimate's numbers, its access and
// special-item notes (the part crew actually act on), and a free-text note for
// anything that came in different. The note still lands in the `overage_note`
// column of the JobReports sheet.
//
// Self-hides when there is no linked estimate (by-job 404) or on any fetch
// error, so it never blocks the report.
type ByJobEstimate = {
  estimate_uuid: string;
  estimated_hours: number | null;
  origin_access_notes: string | null;
  destination_access_notes: string | null;
  special_items_notes: string | null;
  general_notes: string | null;
  estimated_weight_lbs: number;
  estimated_cubic_ft: number;
  items: { name: string; qty: number; room?: string | null; subcategory?: string | null }[];
};

function OverageCheck({
  jobUuid,
  value,
  onChange,
}: {
  jobUuid: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { settings } = useTheme();
  const ht = settings.helpTexts;
  const [est, setEst] = useState<ByJobEstimate | "none" | null>(null);

  useEffect(() => {
    if (!jobUuid) { setEst("none"); return; }
    let cancelled = false;
    setEst(null);
    apiFetch<ByJobEstimate>(`/api/estimates/by-job/${encodeURIComponent(jobUuid)}`)
      .then((e) => { if (!cancelled) setEst(e); })
      .catch(() => { if (!cancelled) setEst("none"); }); // 404 / error = no linked estimate → hide
    return () => { cancelled = true; };
  }, [jobUuid]);

  if (est === null || est === "none") return null; // loading or no linked estimate

  const estFurniture = est.items.filter((i) => !isBoxItem(i.name)).reduce((s, i) => s + (i.qty || 0), 0);
  const estBoxes = est.items.filter((i) => isBoxItem(i.name)).reduce((s, i) => s + (i.qty || 0), 0);
  const hasItems = estFurniture + estBoxes > 0;
  const hasAccess = est.origin_access_notes || est.destination_access_notes || est.special_items_notes;

  return (
    <div className="card">
      <div className="row" style={{ alignItems: "center", gap: 8 }}>
        <div className="sectionTitle" style={{ marginBottom: 0 }}>Estimate</div>
        <BetaTag feature="overagePrompt" style={{ marginTop: 0 }} />
      </div>
      <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
        What the office estimated for this job. Read the access notes before you get there,
        and flag anything that came in different at the bottom.
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        {est.estimated_hours != null && (
          <EstTile label="Hours" value={`${est.estimated_hours.toFixed(1)}h`} />
        )}
        {hasItems && <EstTile label="Furniture" value={String(estFurniture)} />}
        {hasItems && <EstTile label="Boxes" value={String(estBoxes)} />}
        {est.estimated_weight_lbs > 0 && (
          <EstTile label="Weight" value={`${est.estimated_weight_lbs.toLocaleString()} lb`} />
        )}
        {est.estimated_cubic_ft > 0 && (
          <EstTile label="Volume" value={`${est.estimated_cubic_ft.toLocaleString()} cu ft`} />
        )}
      </div>

      {hasItems && (
        <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
          Item counts are what the estimator entered, not a target to hit. The comparison that
          matters is estimated vs actual man-hours, shown with the hours below.
        </div>
      )}

      {hasAccess && (
        <div className="small" style={{ marginBottom: 8, lineHeight: 1.5 }}>
          {est.origin_access_notes && <div><strong>Origin access:</strong> {est.origin_access_notes}</div>}
          {est.destination_access_notes && <div><strong>Destination access:</strong> {est.destination_access_notes}</div>}
          {est.special_items_notes && <div><strong>Special items:</strong> {est.special_items_notes}</div>}
        </div>
      )}

      <div style={{ marginTop: 6 }}>
        <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>
          Anything different from the estimate?
        </div>
        {ht.overageHint && (
          <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>{ht.overageHint}</div>
        )}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder="Extra items, packing not expected, different access, added stairs/parking…"
          style={textareaStyle}
        />
      </div>
    </div>
  );
}

function EstTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: "1 1 30%", minWidth: 90, border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px" }}>
      <div className="small" style={{ color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const stepBtnStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--card)",
  color: "var(--text)",
  fontSize: 22,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 14,
  resize: "vertical",
  boxSizing: "border-box",
};
