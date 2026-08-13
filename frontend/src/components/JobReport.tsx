import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { loadJobSetup } from "../lib/jobSetupStore";
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
import { formatMountainTime, mountainHHMM, mountainDateYYYYMMDD } from "../lib/time";
import DVIRReminderModal from "./DVIRReminderModal";
import BillCalculator, { type BillHandle } from "./BillCalculator";
import { BetaTag } from "./BetaTag";
import CloseoutStepper, { type CloseoutValue } from "./CloseoutStepper";
import WrapUpEstimator from "./WrapUpEstimator";
import { fireConfetti } from "../lib/confetti";

// Type + billing-math helpers live in lib/employeeHours so BillCalculator
// can consume them without importing back through this parent. Re-exported
// here for backward compatibility with existing callers (Admin, etc.).
export { roundBillableQuarter, type EmployeeHoursEntry } from "../lib/employeeHours";
import type { EmployeeHoursEntry } from "../lib/employeeHours";
import { roundBillableQuarter } from "../lib/employeeHours";
import { hhgWeightLbs } from "../lib/hhg";
import {
  TRUCK_IDS,
  filledCuFt,
  truckCapacityCuFt,
  type TruckFullnessEntry,
} from "../lib/jobTypes";
import TruckDeckGauge from "./TruckDeckGauge";
import {
  CLIENT_READINESS,
  CLIENT_UNREADY_REASONS,
  SCOPE_CHANGE_KINDS,
  VARIANCE_CAUSES,
  normalizeScopeChanges,
  normalizeVarianceCauses,
  readinessNeedsDetail,
  type Option as CloseoutOption,
  type ScopeChangeEntry,
} from "../lib/closeout";
import NumberField from "./NumberField";
import { useSkills, skillsForJobTypes, type Skill } from "../lib/skillsStore";

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
  // Close-out: why the job differed, how ready the client was, what changed.
  // Multi-select since 2026-07-28 - a long day usually has more than one cause.
  variance_causes: string[];
  variance_note: string;
  /** null = unanswered, "as_quoted" = ran as quoted, "more"/"less" = differed.
   *  Persisted from 2026-08-13; before that it was inferred from the causes and
   *  defaulted to "more", so a report could claim a direction nobody entered. */
  variance_direction: string | null;
  /** null = unanswered. false = the crew looked and cannot name a cause, which
   *  is a real answer and not the same as leaving it blank. */
  variance_cause_identified: boolean | null;
  /** RETIRED from the UI 2026-08-13 (duplicated the client_not_ready cause).
   *  Still loaded and still sent back so an admin editing an old report does not
   *  silently wipe what it carries. */
  client_readiness: string | null;
  client_unready: string[];
  scope_changes: ScopeChangeEntry[];
  // Crew-lead sign-off that the per-employee hours are correct.
  hours_verified: boolean;
  employee_hours: EmployeeHoursEntry[];
};

type ReportView = "edit" | "review" | "closed";

// Resolve a stored option key to its human label (falls back to the raw key so
// a retired option still reads sensibly in the summary).
function labelOf(list: { key: string; label: string }[], key: string): string {
  return list.find((o) => o.key === key)?.label ?? key;
}

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
    // Both close-out fields changed shape on 2026-07-28. A draft written by the
    // previous build is still sitting in localStorage on crew devices, so these
    // upgrade rather than assume - see normalize* in lib/closeout.
    variance_causes: normalizeVarianceCauses(d.variance_causes, (d as any).variance_cause),
    variance_note: d.variance_note ?? "",
    variance_direction: (d as any).variance_direction ?? null,
    variance_cause_identified: (d as any).variance_cause_identified ?? null,
    client_readiness: d.client_readiness ?? null,
    client_unready: Array.isArray(d.client_unready) ? d.client_unready : [],
    scope_changes: normalizeScopeChanges(d.scope_changes),
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
  // Fired after a successful save-and-close-out. The host (App) uses it to mark the
  // job finished and flip the whole screen to the static closed-job panel.
  onCloseOut?: () => void;
  // Reopened from the closed panel ("Edit finalized job") - open straight in the
  // editable form instead of the read-only closed tile.
  openInEdit?: boolean;
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
            color: "var(--on-ok)", fontWeight: 800, fontSize: 14,
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

export default function JobReport({ jobUuid, jobName, events = [], longDistance = false, driveOnly = false, mixedLd = false, onCloseOut, openInEdit = false }: Props) {
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
    variance_causes: [],
    variance_note: "",
    variance_direction: null,
    variance_cause_identified: null,
    client_readiness: null,
    client_unready: [],
    scope_changes: [],
    hours_verified: false,
    employee_hours: [],
  });

  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Per-field validation error. On a blocked submit we jump to the offending
  // field and show the message right there, instead of a top banner the crew
  // has to scroll away from to hunt for what's actually missing.
  const [fieldError, setFieldError] = useState<{ anchor: string; msg: string } | null>(null);
  const [showDVIRModal, setShowDVIRModal] = useState(false);
  // Three-stage report view:
  //  - "edit"   : the fillable form (drafts auto-save to the device throughout).
  //  - "review" : a read-only, data-rich summary of every answer (no server
  //               write yet - "Confirm and view report" only previews).
  //  - "closed" : the collapsed single tile shown after "Save and close out job"
  //               commits to the server. A submitted report loads straight here.
  const [view, setView] = useState<ReportView>("edit");
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
    // Reset the view on every job switch. The load below re-opens the closed
    // tile only if THIS job already has a submitted report; without this reset
    // the previous job's "closed" view would stick to a fresh/unsubmitted job.
    setView("edit");
    // Same for the close-out tree gates - they re-seed from this job's data.

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
          // Server may still answer with a pre-2026-07-28 report (singular
          // cause, {kind}-shaped changes); normalize both to the new shape.
          variance_causes: normalizeVarianceCauses(
            (r as any).variance_causes,
            (r as any).variance_cause,
          ),
          variance_note: (r as any).variance_note ?? "",
          variance_direction: (r as any).variance_direction || null,
          variance_cause_identified:
            typeof (r as any).variance_cause_identified === "boolean"
              ? (r as any).variance_cause_identified
              : null,
          client_readiness: (r as any).client_readiness ?? null,
          client_unready: (r as any).client_unready ?? [],
          scope_changes: normalizeScopeChanges((r as any).scope_changes),
          hours_verified: !!(r as any).hours_verified,
          employee_hours: r.employee_hours ?? [],
        });
        serverUpdatedAtRef.current = (r as any).updated_at || "";
        setSaved(true);
        // A report already exists on the server, so it has been closed out at least
        // once: open straight to the collapsed tile - UNLESS the crew reopened it
        // via "Edit finalized job", in which case drop them right into the editor.
        setView(openInEdit ? "edit" : "closed");
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
            variance_causes: [],
            variance_note: "",
            variance_direction: null,
            variance_cause_identified: null,
            client_readiness: null,
            client_unready: [],
            scope_changes: [],
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

  // Job type and the assigned trucks are captured in Job setup now (the single
  // source), so neither is entered a second time here. Seed both from the
  // header once per job:
  //  - Job type is mirrored onto the report silently. It still exports to the
  //    sheet and still decides which skills are rated per employee below; the
  //    crew just edit it in Job setup, not here (no job-type UI on the report).
  //  - The trucks assigned in setup prefill the volume estimator (only when the
  //    crew haven't started it yet), so they don't re-add trucks they already
  //    picked. They can still add or remove trucks in the estimator.
  const headerSeedRef = useRef<string>("");
  useEffect(() => {
    if (!loaded || !jobUuid || headerSeedRef.current === jobUuid) return;
    headerSeedRef.current = jobUuid;
    loadJobSetup(jobUuid)
      .then((h) => {
        if (!h) return;
        const tags = (h.job_type_tags ?? []).filter(Boolean);
        const units = (h.vehicle_unit_names ?? []).filter(Boolean);
        setData((prev) => {
          let next = prev;
          if (tags.length) {
            const same = prev.job_type_tags.length === tags.length && prev.job_type_tags.every((t, i) => t === tags[i]);
            if (!same) next = { ...next, job_type_tags: tags };
          }
          if (units.length && next.truck_fullness.length === 0) {
            const fleet = TRUCK_IDS as readonly string[];
            next = {
              ...next,
              truck_fullness: units.map((name) =>
                fleet.includes(name)
                  ? { truck: name, vertical_pct: 0, horizontal_pct: 0 }
                  : { truck: name, vertical_pct: 0, horizontal_pct: 0, is_rental: true },
              ),
            };
          }
          return next;
        });
      })
      .catch(() => {});
  }, [loaded, jobUuid]);

  // C1.3 (ADR 0034): the job header's crew, offered as quick-add chips in the
  // Employee Hours editor. Tapping one just targets the editor at that person
  // (like the roster picker) - the crew still enter times and save a real row,
  // so no empty 0-hour rows are ever written to the payroll source.
  const [jobCrew, setJobCrew] = useState<{ user_id: number; name: string }[]>([]);
  useEffect(() => {
    if (!jobUuid) { setJobCrew([]); return; }
    let cancelled = false;
    loadJobSetup(jobUuid)
      .then((h) => {
        if (cancelled) return;
        setJobCrew(
          (h?.crew || [])
            .filter((m) => typeof m.user_id === "number")
            .map((m) => ({ user_id: m.user_id as number, name: m.name })),
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
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

  /** `set`, but the new value is derived from the CURRENT value rather than
   *  from whatever the render closure captured.
   *
   *  Use this for anything that reads the old value to compute the new one -
   *  every multi-select toggle, and the repeating-row editors. `set("x", [...data.x, k])`
   *  reads a captured `data`, so two updates that land in the same React batch
   *  both start from the same snapshot and the first one is lost. Discrete
   *  click events normally flush one at a time, which is why this has not bitten
   *  anyone, but the correct form costs nothing and does not depend on that. */
  function setWith<K extends keyof ReportData>(
    key: K,
    fn: (prev: ReportData[K]) => ReportData[K],
  ) {
    setData((prev) => ({ ...prev, [key]: fn(prev[key]) }));
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
  // The wrap-up estimator isn't needed on most jobs, so it stays collapsed until
  // the crew ask for it (keeps the hours record uncluttered).
  const [showWrapUp, setShowWrapUp] = useState(false);

  // Close-out surfaces one question at a time (a small tree) instead of all at
  // once. Two yes/no gates drive the reveal; they seed from any saved answers so
  // a reopened report shows what was already filled rather than hiding it.

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
    // Mountain wall-clock, matching the backend payroll tz (not the device's) -
    // a phone in Central must not read an event's time an hour off.
    return mountainHHMM(iso);
  }

  function hhmmToMinutes(hhmm: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
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
      // time with it. The saved row snapshots the value at Save. Read in Mountain.
      if (!wrapUpTime) return null;
      return hhmmToMinutes(fmtHHMM(wrapUpTime.toISOString()));
    }
    if (slot.selection) {
      const ev = eventById.get(slot.selection);
      if (!ev) return null;
      // Minutes-of-day in Mountain (matches fmtHHMM + the backend tz).
      return hhmmToMinutes(fmtHHMM(ev.timestamp));
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

  // Full epoch (ms) of a slot when it carries a real date (an event or the
  // wrap-up estimate). Manual "HH:MM" slots have no date, so they return null and
  // the caller falls back to same-day minutes-of-day math. This is what lets a
  // multi-day shift compute a true span instead of collapsing modulo 24h.
  function slotToEpoch(slot: SlotPick): number | null {
    if (slot.selection === WRAPUP_SENTINEL) return wrapUpTime ? wrapUpTime.getTime() : null;
    if (slot.selection && slot.selection !== MANUAL_SENTINEL) {
      const ev = eventById.get(slot.selection);
      if (!ev) return null;
      const t = Date.parse(ev.timestamp);
      return Number.isFinite(t) ? t : null;
    }
    return null;
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

    // Prefer the TRUE span from full timestamps when both ends carry a date (real
    // events / wrap-up), so a multi-day shift is not silently wrapped into 24h.
    // Manual times (no date) keep the single-midnight-wrap for a same-day shift.
    const sEpoch = slotToEpoch(editStart);
    const eEpoch = slotToEpoch(editEnd);
    let span: number;
    if (sEpoch !== null && eEpoch !== null) {
      span = Math.round((eEpoch - sEpoch) / 60000);
      if (span <= 0) return { kind: "error", message: "End time is at or before start time." };
    } else {
      span = endMin - startMin;
      if (span <= 0) span += 24 * 60; // crossed midnight (same-day manual entry)
      if (span <= 0) return { kind: "error", message: "End time is at or before start time." };
    }

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
    const startEpoch = slotToEpoch(editStart);
    const baseEntry: EmployeeHoursEntry = {
      user_id: editUserId ?? undefined,
      name,
      start: slotToHHMM(editStart),
      end: slotToHHMM(editEnd),
      // Mountain date of the shift start when the start is a real event/wrap-up.
      date: startEpoch !== null ? mountainDateYYYYMMDD(startEpoch) : undefined,
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
          // A manual edit produces no date; keep the row's existing one.
          date: baseEntry.date ?? prev.employee_hours[editingIndex].date,
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

  // Duplicate a saved hours row with a BLANK employee, keeping the times/hours.
  // Big crews often share a shift; this saves re-keying it. The new row renders
  // an inline employee picker (its name is blank) so the crew just pick a
  // person - the hours copy over exactly, with no editor round-trip that would
  // drop the break detail.
  function duplicateEmployee(i: number) {
    const emp = data.employee_hours[i];
    if (!emp) return;
    setData((prev) => ({
      ...prev,
      employee_hours: [
        ...prev.employee_hours,
        { ...emp, user_id: undefined, name: "", skill_rating: undefined, skill_ratings: undefined },
      ],
    }));
    setSaved(false);
  }

  // Assign a roster person to a row that has no employee yet (a duplicated row).
  function assignEmployeeToRow(i: number, userId: number | null, name: string) {
    setData((prev) => ({
      ...prev,
      employee_hours: prev.employee_hours.map((e, idx) =>
        idx === i ? { ...e, user_id: userId ?? undefined, name } : e,
      ),
    }));
    setSaved(false);
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

  async function doSave() {
    // First close-out (no server copy yet) vs re-saving an edit to an already
    // closed report. Only the first one is worth a celebration - re-firing
    // confetti on a typo fix reads as "you just filed a brand-new report".
    const firstCloseOut = !saved;
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
          variance_causes: data.variance_causes,
          variance_note: data.variance_note.trim() || null,
          client_readiness: data.client_readiness || null,
          // Only meaningful when something was NOT ready; sending the list
          // alongside "fully ready" would contradict itself in the sheet.
          client_unready: readinessNeedsDetail(data.client_readiness)
            ? data.client_unready
            : [],
          // Drop rows where the crew picked nothing - an empty row is an
          // accidental tap on "Add", not a scope change. The server rejects a
          // kinds:[] entry outright, so this filter is load-bearing, not tidying.
          scope_changes: data.scope_changes
            .filter((c) => c.kinds.length > 0)
            .map((c) => ({
              kinds: c.kinds,
              direction: c.direction,
              hours: c.hours ?? null,
              note: (c.note || "").trim() || null,
            })),
          hours_verified: !!data.hours_verified,
          // Strip empty rows so the sheet column doesn't get noise from
          // accidentally-added employees the crew didn't fill in.
          employee_hours: data.employee_hours
            .filter((e) => e.name.trim() || e.hours > 0 || e.start || e.end)
            .map((e) => ({
              name: e.name.trim(),
              start: e.start,
              end: e.end,
              date: e.date || null,
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
      setView("closed"); // collapse to the single closed-out tile
      if (firstCloseOut) fireConfetti(); // celebrate only the first close-out
      // Submit succeeded - discard the in-progress drafts (report + bill).
      // The server is now authoritative; further edits start fresh drafts.
      clearReportDraft(jobUuid);
      billRef.current?.clearDraft?.();
      setDraftStatus("idle");
      // The report save IS the job closeout: tell the host to finish the job and
      // flip the whole screen to the static closed-job panel.
      onCloseOut?.();
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

  // Shared validation for both "Confirm and view report" and "Save and close
  // out job". Returns {anchor, msg} for the first missing field (anchor maps to
  // an id on that field so we can jump to it), or null when the report is complete.
  function validateReport(): { anchor: string; msg: string } | null {
    if (!jobUuid) return { anchor: "top", msg: "No job selected." };
    // Mixed LD days (labor + driving): the long-distance documents are required.
    if (mixedLd) {
      if (!priorDone) return { anchor: "ld_docs", msg: "Complete the driver's Prior On-Duty statement before submitting." };
      if (!bolStatus && !bolDeferred) return { anchor: "ld_docs", msg: "Attach the trip's Bill of Lading (or mark not at destination yet) before submitting." };
    }
    // Drive-only LD days skip the billing/eval questions (no labor to bill).
    if (!driveOnly) {
      if (data.has_personal_vehicles === null) return { anchor: "personal_vehicles", msg: "Indicate whether personal vehicles were at the job site." };
      if (data.has_personal_vehicles && data.personal_vehicles < 1) return { anchor: "personal_vehicles", msg: "Enter how many personal vehicles were at the job site." };
      if (data.has_dumpster_use === null) return { anchor: "dumpster", msg: "Indicate whether the M1 dumpster was used on this job." };
      if (data.has_dumpster_use && data.dumpster_pct <= 0) return { anchor: "dumpster", msg: "Select the M1 dumpster fill percentage." };
      if (data.has_recycling_use === null) return { anchor: "recycling", msg: "Indicate whether the M1 recycling bin was used on this job." };
      if (data.has_recycling_use && data.recycling_pct <= 0) return { anchor: "recycling", msg: "Select the M1 recycling bin fill percentage." };
      if (!data.billing_method) return { anchor: "billing_method", msg: "Select a billing method." };
      if (data.review_candidate === null) return { anchor: "review_candidate", msg: "Indicate whether this client is a review candidate." };
      if (data.hours_match === null) return { anchor: "hours_match", msg: "Indicate whether hours worked match hours billed." };
      if (!data.hours_match && !data.hours_mismatch_reason.trim())
        return { anchor: "hours_match", msg: "Please explain why the hours don't match." };
      if (data.has_crew_feedback === null)
        return { anchor: "crew_feedback", msg: "Indicate whether you have any feedback for the office." };
      if (data.has_crew_feedback && !data.crew_feedback.trim())
        return { anchor: "crew_feedback", msg: "Please share your feedback or change your answer to No." };
      // Surface the bill-review checkbox here (not only at the final POST) so it
      // is caught before the crew leave the editable view.
      const billData = billRef.current?.getData();
      if (billData != null && !billReviewed)
        return { anchor: "bill_review", msg: "Please confirm you have reviewed the auto-populated bill items before continuing." };
    }
    return null;
  }

  // Jump to (and mark) the first missing field so the crew see exactly what's
  // blocking submit, instead of a top banner they have to scroll away from.
  function jumpToField(p: { anchor: string; msg: string }) {
    const el = document.getElementById("jrq-" + p.anchor);
    if (el) {
      setFieldError(p);   // inline message right at the field
      setErr(null);
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    } else {
      // No inline slot for this one (e.g. long-distance docs) - fall back to the
      // top banner so the message is never lost.
      setFieldError(null);
      setErr(p.msg);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  // Inline error rendered right under a field's header when it's the blocker.
  const fieldErr = (anchor: string) =>
    fieldError?.anchor === anchor ? (
      <div className="small" style={{ color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>
        {fieldError.msg}
      </div>
    ) : null;

  // "Confirm and view report": validate, then switch to the read-only summary.
  // No server write - the local draft already holds everything.
  function handleConfirmView(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const problem = validateReport();
    if (problem) { jumpToField(problem); return; }
    setFieldError(null);
    setView("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // "Save and close out job": validate again, then the DVIR reminder gates the
  // actual POST (doSave), which collapses the report to the closed-out tile.
  function saveAndClose() {
    setErr(null);
    const problem = validateReport();
    if (problem) return jumpToField(problem);
    setFieldError(null);
    pendingSaveRef.current = doSave;
    setShowDVIRModal(true);
  }

  // Read-only, data-rich recap of every answer, shown in the review and closed
  // views. `billTotals` is the bill total node from the bill calculator.
  function renderSummary(billTotal: number) {
    const row = (label: string, value: React.ReactNode) => (
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "3px 0" }}>
        <span className="small" style={{ color: "var(--muted)", flexShrink: 0 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, textAlign: "right", minWidth: 0 }}>{value}</span>
      </div>
    );
    const section = (title: string, children: React.ReactNode) => (
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
        <div className="microLabel" style={{ marginBottom: 6 }}>{title}</div>
        {children}
      </div>
    );

    const emps = data.employee_hours.filter((e) => e.name.trim() || e.hours > 0);
    const trucks = data.truck_fullness.filter((t) => (t.truck || "").trim() && t.vertical_pct > 0 && t.horizontal_pct > 0);
    const scope = data.scope_changes.filter((c) => c.kinds.length > 0);
    const billingLabel = BILLING_OPTIONS.find((o) => o.value === data.billing_method)?.label;

    return (
      <div className="col" style={{ gap: 0 }}>
        <div>
          <div className="microLabel" style={{ marginBottom: 6 }}>Hours</div>
          {row("Total hours", `${totalBillableHours.toFixed(2)} h`)}
          {data.hours_verified && row("Crew-lead verified", "Yes")}
          {emps.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {emps.map((e, i) => (
                <div key={i} className="row" style={{ justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
                  <span style={{ fontSize: 13, minWidth: 0 }}>
                    {e.name || "(unnamed)"}{e.out_of_town ? " · out of town" : ""}{e.non_billable ? " · non-billable" : ""}
                  </span>
                  <span className="small mono" style={{ flexShrink: 0 }}>{roundBillableQuarter(e.hours).toFixed(2)} h</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {longDistance && section("Long-distance", (
          <>
            {row("Per-diem (out of town)", data.out_of_town ? "Yes" : "No")}
            {mixedLd && row("Prior on-duty (PODS)", priorDone ? "Filed" : "Not filed")}
            {mixedLd && row("Bill of Lading", bolStatus ? "Attached" : bolDeferred ? "Deferred" : "Not attached")}
          </>
        ))}

        {!driveOnly && section("Billing", (
          <>
            {row("Method", billingLabel ?? (data.billing_method || "Not set"))}
            {row("Bill total", billTotal.toLocaleString("en-US", { style: "currency", currency: "USD" }))}
          </>
        ))}

        {trucks.length > 0 && section("Truck fullness", (
          <>
            {trucks.map((t, i) => {
              // One entry is one LOAD, so these figures describe a single trip.
              // A truck that ran twice appears twice, each with its own fill.
              const cuft = filledCuFt(t);
              const pct = Math.round((t.vertical_pct * t.horizontal_pct) / 100);
              const same = trucks.filter((x) => (x.truck || "") === (t.truck || ""));
              const loadNo = same.length > 1
                ? same.indexOf(t) + 1
                : 0;
              return (
                <div key={i}>
                  {row(
                    `${t.truck || "Truck"}${loadNo ? ` (load ${loadNo})` : ""}`,
                    `${pct}% full${cuft !== null ? ` · ${cuft.toLocaleString()} cu ft · ~${hhgWeightLbs(cuft).toLocaleString()} lbs` : ""}`,
                  )}
                </div>
              );
            })}
          </>
        ))}

        {!driveOnly && section("Extras", (
          <>
            {row("Personal vehicles", data.has_personal_vehicles ? `${data.personal_vehicles}${data.bill_personal_vehicles ? " (billed)" : ""}` : "None")}
            {row("M1 dumpster", data.has_dumpster_use ? `${data.dumpster_pct}%` : "Not used")}
            {row("M1 recycling", data.has_recycling_use ? `${data.recycling_pct}%` : "Not used")}
          </>
        ))}

        {!driveOnly && section("Close-out", (
          <>
            {/* Reads from the STORED direction now, not from an inference over
                the causes. The old line guessed "longer" whenever it could not
                tell, so a recap could assert a direction the crew never gave. */}
            {row("Ran differently",
              data.variance_direction === "more" ? "Yes - ran longer"
              : data.variance_direction === "less" ? "Yes - ran shorter"
              : data.variance_direction === "as_quoted" ? "No, as quoted"
              : "Not answered")}
            {data.variance_cause_identified === false
              && row("Cause", "Crew could not identify one")}
            {data.variance_causes.length > 0 && row("Reasons", data.variance_causes.map((k) => labelOf(VARIANCE_CAUSES, k)).join(", "))}
            {data.variance_note.trim() && row("Note", data.variance_note.trim())}
            {/* Retired questions. Shown ONLY when an older report actually
                carries them, so a new report does not display two dead rows and
                an old one does not lose what it recorded. */}
            {data.client_readiness && row("Client readiness (retired)", labelOf(CLIENT_READINESS, data.client_readiness))}
            {data.client_unready.length > 0 && row("Not ready", data.client_unready.map((k) => labelOf(CLIENT_UNREADY_REASONS, k)).join(", "))}
            {row("Scope changes", scope.length === 0 ? "None" : String(scope.length))}
            {scope.map((c, i) => (
              <div key={i} className="small" style={{ color: "var(--muted)", padding: "2px 0" }}>
                • {c.kinds.map((k) => labelOf(SCOPE_CHANGE_KINDS, k)).join(", ")} ({c.direction}{c.hours != null ? `, ~${c.hours}h` : ""}){c.note ? ` - ${c.note}` : ""}
              </div>
            ))}
          </>
        ))}

        {!driveOnly && section("Wrap-up", (
          <>
            {row("Review candidate", data.review_candidate === "yes" ? "Yes - reach out" : data.review_candidate === "no" ? "No" : data.review_candidate === "na" ? "N/A" : "Not answered")}
            {row("Hours match billed", data.hours_match === true ? "Yes" : data.hours_match === false ? "No" : "Not answered")}
            {data.hours_match === false && data.hours_mismatch_reason.trim() && row("Discrepancy", data.hours_mismatch_reason.trim())}
            {row("Crew feedback", data.has_crew_feedback ? "Yes" : data.has_crew_feedback === false ? "No" : "Not answered")}
            {data.has_crew_feedback && data.crew_feedback.trim() && row("Feedback", data.crew_feedback.trim())}
          </>
        ))}
      </div>
    );
  }

  // The review + closed-out views share the summary; they differ only in the
  // action row below it.
  function renderReviewOrClosed(billTotal: number) {
    return (
      <div className="col" style={{ gap: 14 }}>
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div className="microLabel" style={{ marginBottom: 0 }}>
              {view === "closed" ? "Job report - closed out" : "Review job report"}
            </div>
            {view === "closed" && (
              <button type="button" onClick={() => { setView("edit"); setErr(null); }} style={{ fontSize: 12 }}>
                Edit report
              </button>
            )}
          </div>
          {view === "closed" ? (
            <div className="small" style={{ color: "var(--ok)", marginBottom: 10 }}>
              ✓ Saved and closed out{user?.name ? ` by ${user.name}` : ""}. Tap Edit to reopen.
            </div>
          ) : (
            <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
              Check every answer reads right, then save and close out the job.
            </div>
          )}
          {renderSummary(billTotal)}
        </div>

        {err && (
          <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "rgba(255,107,107,0.1)", borderRadius: 8 }}>
            {err}
          </div>
        )}

        {view === "review" && (
          <div className="row" style={{ gap: 8, marginBottom: 32 }}>
            <button type="button" className="btnPrimary" disabled={busy} onClick={saveAndClose}>
              {busy ? "Saving…" : "Save and close out job"}
            </button>
            <button type="button" disabled={busy} onClick={() => { setView("edit"); setErr(null); }}>
              Back to editing
            </button>
          </div>
        )}
      </div>
    );
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
          // DISTINCT trucks, not entries. An entry is one LOAD since 2026-08-12,
          // so a truck that ran the job twice has two entries - counting entries
          // would autofill two "Truck (per hour)" lines and bill the client
          // twice for one truck. Duration belongs in the line's hours, not in a
          // second line.
          ? new Set(
              data.truck_fullness
                .map((t) => (t.truck || "").trim().toLowerCase())
                .filter((name) => name.length > 0),
            ).size
          : undefined
      }
    >
      {(billSlots) =>
        view !== "edit" ? (
          renderReviewOrClosed(billSlots.total)
        ) : (
    <form onSubmit={handleConfirmView} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

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

      {/* Validation error, surfaced at the TOP of the form (with a scroll-to on
          failure) so the crew see it and the required fields together, instead
          of a lone banner by the bottom button pointing at a field far above. */}
      {err && (
        <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "rgba(255,107,107,0.1)", borderRadius: 8 }}>
          {err}
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

      {/* ── Job data (employee hours + M1 equipment + personal vehicles) ──
          Employee hours drive one auto-populated $80/hr labor line per
          billable employee in the Invoice Builder above, and also land
          in the admin/payroll sheet column. Personal vehicles can be
          billed as crew transport ($100/vehicle/day) via the checkbox
          below. */}
      {!driveOnly && (
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Job data</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
          Hours, equipment, and vehicles - the data used to build the invoice line items.
        </div>

        {/* Job type is captured in Job setup (the single source) and no longer
            shown here - it is mirrored onto the report silently above and still
            decides which skills are rated per employee below. */}

        {/* Inventory is logged on long-distance jobs only (ADR 0015). On a local
            job there is no Inventory tab, so this line would be a permanent
            "none logged yet" pointing at a tab the crew can't see. */}
        {longDistance && <InventoryCountsSummary jobUuid={jobUuid} />}

        {/* Wrap-up estimator sits directly above the hours record because it
            feeds it: the projected wrap-up time is offered as an End option in
            the start/end pickers below. Hidden by default (not needed on most
            jobs); expanded on demand. */}
        <button
          type="button"
          onClick={() => setShowWrapUp((v) => !v)}
          aria-expanded={showWrapUp}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start",
            padding: "6px 12px", fontSize: 13, fontWeight: 700, borderRadius: 8,
            border: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer",
          }}
        >
          {showWrapUp ? "Hide wrap-up estimate" : "Estimate wrap-up time"}
        </button>
        {showWrapUp && (
          <div style={{ marginTop: 10 }}>
            <WrapUpEstimator jobUuid={jobUuid} onWrapUpChange={setWrapUpTime} />
          </div>
        )}

        <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 6, marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
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
                    background: "color-mix(in srgb, var(--brand2) 8%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--brand2) 30%, transparent)",
                    borderRadius: 6,
                    padding: "6px 10px",
                  }}
                >
                  Editing entry #{editingIndex + 1}. Save replaces the row; Cancel keeps the original.
                </div>
              )}
              {/* Quick-add crew from the job header (C1.3). Sets the editor's
                  person; the crew then pick times and Save employee as usual. */}
              {(() => {
                const already = new Set(
                  data.employee_hours.map((e) => e.user_id).filter((v): v is number => typeof v === "number"),
                );
                const toAdd = jobCrew.filter((c) => !already.has(c.user_id) && c.user_id !== editUserId);
                if (toAdd.length === 0) return null;
                return (
                  <div className="col" style={{ gap: 4 }}>
                    <span className="small" style={{ color: "var(--muted)" }}>Add crew from job setup:</span>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {toAdd.map((c) => (
                        <button
                          key={c.user_id}
                          type="button"
                          onClick={() => { setEditUserId(c.user_id); setEditName(c.name); setEditError(null); }}
                          style={{
                            padding: "6px 12px", borderRadius: 999, fontSize: 13, cursor: "pointer",
                            border: "1px solid var(--border)", background: "transparent", color: "var(--text)",
                          }}
                        >
                          + {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
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
                  <strong className="mono" style={{ color: "var(--text)" }}>
                    {editorPreview.hours.toFixed(2)} hrs
                  </strong>{" "}
                  <span className="mono" style={{ color: "var(--muted)" }}>
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
                    background: isEditing ? "color-mix(in srgb, var(--brand2) 6%, transparent)" : undefined,
                  }}
                >
                  {/* Name + hours on the left, Edit/Remove on the right. Skill
                      ratings used to sit inside this left column, which the
                      buttons squeeze on a phone, so long skill names wrapped and
                      the stars got crushed. Ratings are now their own full-width
                      block below this row (see further down). */}
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                      {emp.name || emp.user_id != null ? (
                        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{emp.name || "(no name)"}</div>
                        </div>
                      ) : (
                        <div style={{ marginBottom: 6 }}>
                          <div className="small" style={{ color: "var(--brand)", marginBottom: 4, fontWeight: 600 }}>
                            Assign this duplicated shift to a crew member
                          </div>
                          <RosterPicker userId={null} onChange={(id, nm) => assignEmployeeToRow(i, id, nm)} />
                        </div>
                      )}
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
                        onClick={() => duplicateEmployee(i)}
                        title="Duplicate this shift for another crew member"
                      >
                        Duplicate
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
              <span className="microLabel">Total man-hours</span>
              <span>
                <span className="mono">{totalBillableHours.toFixed(2)}h</span>
                <span
                  className="small mono"
                  style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}
                >
                  (actual {totalActualHours.toFixed(2)}h)
                </span>
              </span>
            </div>
          </div>
        )}

        {/* M1 equipment (dumpster + recycling; the sliders drive invoice lines) */}
        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>M1 equipment *</div>
        <div id="jrq-dumpster" style={{ scrollMarginTop: 90, fontWeight: 700, fontSize: 12, marginTop: 8 }}>Dumpster (trash)</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>Was the M1 dumpster used on this job?</div>
        {fieldErr("dumpster")}
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
        <div id="jrq-recycling" style={{ scrollMarginTop: 90, fontWeight: 700, fontSize: 12, marginTop: 14 }}>Recycling bin</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>Was the M1 recycling bin used on this job?</div>
        {fieldErr("recycling")}
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
        <div id="jrq-personal_vehicles" style={{ scrollMarginTop: 90, fontWeight: 700, fontSize: 13, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>Personal vehicles at job site *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>Were any crew personal vehicles at the job site?</div>
        {fieldErr("personal_vehicles")}
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
        <div className="microLabel" style={{ marginBottom: 10 }}>Billing</div>
        <div style={{ marginBottom: 12 }}>
          {billSlots.billHelper}
          {billSlots.totals}
          {billSlots.notes}
        </div>
        {fieldErr("bill_review")}
        <label id="jrq-bill_review" style={{ scrollMarginTop: 90, display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer", marginTop: 4 }}>
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
        <div id="jrq-billing_method" style={{ scrollMarginTop: 90, fontWeight: 700, fontSize: 13, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>Billing method *</div>
        {fieldErr("billing_method")}
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
                  background: active ? "color-mix(in srgb, var(--brand) 18%, transparent)" : "transparent",
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

      {/* ── Job wrap-up (close-out + review candidate + hours + crew feedback) ── */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Job wrap-up</div>

        {/* Close-out (merged into the wrap-up tile): why the day differed, whether
            the client was ready, and what got added on site. All optional - a crew
            member who cannot answer must still be able to submit, nothing here
            gates Save. */}
        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
          Close-out<BetaTag feature="closeout" style={{ marginTop: 0 }} />
        </div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 14 }}>
          A few quick questions that tell the office why the day ran the way it
          did. Each one leads to the next; answer them in order.
        </div>

        <CloseoutStepper
          value={{
            variance_direction: data.variance_direction,
            variance_cause_identified: data.variance_cause_identified,
            variance_causes: data.variance_causes,
            variance_note: data.variance_note,
          }}
          onChange={(patch: Partial<CloseoutValue>) => {
            (Object.keys(patch) as (keyof typeof patch)[]).forEach((k) => {
              set(k as any, (patch as any)[k]);
            });
            setSaved(false);
          }}
          showScope
          scopeSlot={
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
              {/* Scope changes survive the redesign but are no longer their own
                  top-level question - they only make sense once the crew has
                  said site conditions differed, and asking twice is what the
                  office objected to. The hours field is why this was kept
                  rather than folded into the dropdown: it is the one close-out
                  number that maps to billable time. */}
              <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
                Was anything actually added or dropped? One entry per change.
                Hours are a rough guess at time it cost or gave back, not a bill.
              </div>
              <ScopeChangeEditor
                value={data.scope_changes}
                onChange={(fn) => setWith("scope_changes", fn)}
              />
            </div>
          }
        />

        <div id="jrq-review_candidate" style={{ scrollMarginTop: 90, fontWeight: 700, fontSize: 13, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>Review candidate *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>
          Is this client a good candidate for the office to seek a review from?
        </div>
        {fieldErr("review_candidate")}
        <ThreeWay
          value={data.review_candidate}
          onChange={(v) => set("review_candidate", v)}
          options={[
            { value: "yes", label: "Yes - reach out", tone: "ok" },
            { value: "no",  label: "No",              tone: "danger" },
            { value: "na",  label: "N/A",             tone: "muted" },
          ]}
        />

        <div id="jrq-hours_match" style={{ scrollMarginTop: 90, fontWeight: 700, fontSize: 13, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>Hours reconciliation *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>
          Do hours worked match hours billed?
        </div>
        {fieldErr("hours_match")}
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
        <div id="jrq-crew_feedback" style={{ scrollMarginTop: 90, fontWeight: 700, fontSize: 13, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14, display: "flex", alignItems: "center", gap: 6 }}>
          Crew feedback *<BetaTag feature="crewFeedback" />
        </div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>
          Would you like to submit any general feedback or feedback about this job in particular to the office?
        </div>
        {fieldErr("crew_feedback")}
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
          <div className="microLabel" style={{ marginBottom: 10 }}>Long-distance</div>

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

      {saved && !busy && (
        <div style={{ color: "var(--ok)", fontSize: 13, padding: "8px 12px", background: "rgba(45,212,191,0.1)", borderRadius: 8 }}>
          ✓ Report saved{user?.name ? ` by ${user.name}` : ""}
        </div>
      )}

      {/* No "Save" here anymore: the report keeps auto-saving a local draft;
          this only moves to the read-only review. The server write happens on
          "Save and close out job" in the review view. */}
      <div className="row" style={{ gap: 8, marginBottom: 32 }}>
        <button type="submit" className="btnPrimary" disabled={busy}>
          Confirm and view report
        </button>
        {saved && (
          <button type="button" disabled={busy} onClick={() => { setView("closed"); setErr(null); }}>
            Back to summary
          </button>
        )}
      </div>
    </form>
        )
      }
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
    <div className="seg">
      {options.map(({ value: v, label, tone }) => {
        const active = value === v;
        const seg =
          tone === "danger" ? "var(--danger)" :
          tone === "muted" ? "var(--muted)" :
          "var(--ok)";
        return (
          <button
            key={String(v)}
            type="button"
            aria-pressed={active}
            className={"segBtn" + (active ? " on" : "")}
            style={{ ["--seg" as any]: seg }}
            onClick={() => onChange(v)}
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
    <div className="seg">
      {[
        { v: true, label: yesLabel, seg: "var(--ok)" },
        { v: false, label: noLabel, seg: "var(--danger)" },
      ].map(({ v, label, seg }) => {
        const active = value === v;
        return (
          <button
            key={String(v)}
            type="button"
            aria-pressed={active}
            className={"segBtn" + (active ? " on" : "")}
            style={{ ["--seg" as any]: seg }}
            onClick={() => onChange(v)}
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
        Set this job's type in Job setup to rate skills.
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
                  background: on ? "color-mix(in srgb, var(--brand) 18%, transparent)" : "transparent",
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
// Single- or multi-select chips, shared by every fixed-vocabulary close-out
// question so they all behave the same: tap to pick, tap again to clear.
// Clearing matters - a crew member who taps the wrong chip has to be able to
// get back to "no answer", which a radio group cannot do.
function ChipPicker({
  options,
  selected,
  onToggle,
}: {
  options: { key: string; label: string }[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <div className="row wrap" style={{ gap: 8 }}>
      {options.map((o) => {
        const on = selected.includes(o.key);
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.key)}
            style={{
              padding: "7px 13px",
              borderRadius: 999,
              fontSize: 13,
              cursor: "pointer",
              border: on ? "1px solid var(--brand)" : "1px solid var(--border)",
              background: on ? "var(--brand)" : "transparent",
              color: on ? "var(--on-brand)" : "var(--text)",
              fontWeight: on ? 700 : 400,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ChipPicker split into "more work" / "less work" halves with a heading over
// each. Both close-out lists run in two directions now, and a flat 13-chip wrap
// on a phone makes the crew read every label to find the one they want. Options
// with no `group` (i.e. "Other") fall through to an ungrouped row at the bottom,
// since they belong to neither side.
function GroupedChipPicker({
  options,
  selected,
  onToggle,
  moreLabel,
  lessLabel,
}: {
  options: CloseoutOption[];
  selected: string[];
  onToggle: (key: string) => void;
  moreLabel: string;
  lessLabel: string;
}) {
  const more = options.filter((o) => o.group === "more");
  const less = options.filter((o) => o.group === "less");
  const ungrouped = options.filter((o) => !o.group);

  const heading = (text: string) => (
    <div
      className="small"
      style={{ color: "var(--muted)", fontWeight: 700, marginBottom: 6, marginTop: 2 }}
    >
      {text}
    </div>
  );

  return (
    <div className="col" style={{ gap: 10 }}>
      {more.length > 0 && (
        <div>
          {heading(moreLabel)}
          <ChipPicker options={more} selected={selected} onToggle={onToggle} />
        </div>
      )}
      {less.length > 0 && (
        <div>
          {heading(lessLabel)}
          <ChipPicker options={less} selected={selected} onToggle={onToggle} />
        </div>
      )}
      {ungrouped.length > 0 && (
        <ChipPicker options={ungrouped} selected={selected} onToggle={onToggle} />
      )}
    </div>
  );
}

// Two-state segmented control for a scope change's direction. A checkbox would
// be smaller, but "Saved time" has to be as visible as "Added time" or crew
// will never notice a job CAN report a reduction - which is the whole point of
// the field.
function DirectionToggle({
  value,
  onChange,
  ariaLabel,
}: {
  value: ScopeChangeEntry["direction"];
  onChange: (next: ScopeChangeEntry["direction"]) => void;
  ariaLabel: string;
}) {
  const opts: { key: ScopeChangeEntry["direction"]; label: string }[] = [
    { key: "added", label: "Added time" },
    { key: "saved", label: "Saved time" },
  ];
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="row" style={{ gap: 0 }}>
      {opts.map((o, idx) => {
        const on = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.key)}
            style={{
              padding: "7px 14px",
              fontSize: 13,
              cursor: "pointer",
              border: on ? "1px solid var(--brand)" : "1px solid var(--border)",
              // Collapse the shared edge so the pair reads as one control.
              marginLeft: idx === 0 ? 0 : -1,
              borderRadius: idx === 0 ? "999px 0 0 999px" : "0 999px 999px 0",
              background: on ? "var(--brand)" : "transparent",
              color: on ? "var(--on-brand)" : "var(--text)",
              fontWeight: on ? 700 : 400,
              // The selected half must paint over its neighbour's border.
              position: "relative",
              zIndex: on ? 1 : 0,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Repeating list of on-site scope changes. Rows are keyed and edited by index,
// not by kind: two "Added items" entries on one job are legitimate and must not
// collide.
//
// Each row carries MULTIPLE kinds and a direction (2026-07-28). One real change
// is often two reasons at once, and a change can give time back as easily as it
// can take it - `hours` is the magnitude, `direction` is the sign.
function ScopeChangeEditor({
  value,
  onChange,
}: {
  value: ScopeChangeEntry[];
  /** Takes an UPDATER, not a value. Every edit in here derives the next list
   *  from the current one, so passing a pre-computed array would reintroduce
   *  the stale-snapshot problem `setWith` exists to avoid. */
  onChange: (fn: (prev: ScopeChangeEntry[]) => ScopeChangeEntry[]) => void;
}) {
  const patchAt = (i: number, patch: Partial<ScopeChangeEntry>) =>
    onChange((prev) => prev.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeAt = (i: number) => onChange((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {value.map((c, i) => (
        <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span className="small" style={{ color: "var(--muted)", fontWeight: 700 }}>
              Change {i + 1}
            </span>
            <button type="button" onClick={() => removeAt(i)} style={{ color: "var(--danger)" }}>
              Remove
            </button>
          </div>
          <GroupedChipPicker
            options={SCOPE_CHANGE_KINDS}
            selected={c.kinds}
            moreLabel="Added / more work"
            lessLabel="Dropped / less work"
            onToggle={(key) =>
              onChange((prev) =>
                prev.map((row, idx) => {
                  if (idx !== i) return row;
                  const has = row.kinds.includes(key);
                  const kinds = has
                    ? row.kinds.filter((k) => k !== key)
                    : [...row.kinds, key];
                  // Picking the first reason from a side is a strong hint at
                  // which way this change went, so set the direction to match -
                  // but only on the first pick, never overriding a deliberate
                  // later change.
                  const picked = SCOPE_CHANGE_KINDS.find((o) => o.key === key);
                  const direction =
                    !has && row.kinds.length === 0 && picked?.group
                      ? picked.group === "less" ? "saved" : "added"
                      : row.direction;
                  return { ...row, kinds, direction };
                }),
              )
            }
          />
          <div className="row wrap" style={{ gap: 10, alignItems: "flex-end", marginTop: 12 }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Impact</span>
              <DirectionToggle
                value={c.direction}
                onChange={(direction) => patchAt(i, { direction })}
                ariaLabel={"Impact for change " + (i + 1)}
              />
            </label>
            <label className="col" style={{ gap: 2, width: 130 }}>
              <span className="small" style={{ color: "var(--muted)" }}>
                {c.direction === "saved" ? "Hours saved" : "Extra hours"}
              </span>
              <NumberField
                min={0}
                max={48}
                step={0.25}
                allowEmpty
                value={c.hours ?? null}
                onEmpty={() => patchAt(i, { hours: null })}
                onChange={(hours) => patchAt(i, { hours })}
                placeholder="optional"
                aria-label={
                  (c.direction === "saved" ? "Hours saved on change " : "Extra hours for change ") +
                  (i + 1)
                }
              />
            </label>
            <label className="col" style={{ gap: 2, flex: 1, minWidth: 160 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Note</span>
              <input
                value={c.note || ""}
                onChange={(e) => patchAt(i, { note: e.target.value })}
                placeholder={
                  c.direction === "saved"
                    ? "e.g. garage was already empty"
                    : "e.g. client added garage shelving"
                }
              />
            </label>
          </div>
        </div>
      ))}
      <div>
        <button
          type="button"
          onClick={() =>
            onChange((prev) => [
              ...prev,
              { kinds: [], direction: "added", hours: null, note: "" },
            ])
          }
          style={{
            padding: "6px 12px", borderRadius: 999, border: "1px dashed var(--border)",
            background: "transparent", color: "var(--text)", fontSize: 13, cursor: "pointer",
          }}
        >
          + Add scope change
        </button>
      </div>
    </div>
  );
}

function TruckFullnessEditor({
  value,
  onChange,
}: {
  value: TruckFullnessEntry[];
  onChange: (next: TruckFullnessEntry[]) => void;
}) {
  // Only fleet entries reserve a fixed id; rentals are free-text so several can
  // coexist. Updates/removes go by index so two rentals never collide.
  // Every fleet truck stays offerable, including one already on the list: an
  // entry is one LOAD, so adding the same truck again is how a second trip is
  // recorded. It used to be filtered out, which is what made "we used two truck
  // loads" impossible to say - and a single fill estimate multiplied by two
  // would describe neither trip, since a first load packed tight and a second
  // half-empty is the normal case.
  const availableFleet = TRUCK_IDS;

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
        return (
          // Keyed by INDEX, not by truck name: the same truck can now appear
          // more than once (one entry per load), and a name key would collide
          // and make React reuse the wrong card's state.
          <div key={`load-${i}`} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
            <div className="row" style={{ alignItems: "center", gap: 8 }}>
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
            </div>
            {t.is_rental && (
              <label className="col" style={{ gap: 2, marginTop: 8 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Truck length (ft)</span>
                <NumberField
                  min={0}
                  step={1}
                  integer
                  allowEmpty
                  value={t.length_ft ?? null}
                  onEmpty={() => patchAt(i, { length_ft: undefined })}
                  onChange={(length_ft) => patchAt(i, { length_ft })}
                  placeholder="e.g. 26"
                  aria-label="Rental truck length in feet"
                  style={{ width: 120 }}
                />
              </label>
            )}
            <TruckDeckGauge
              verticalPct={t.vertical_pct}
              horizontalPct={t.horizontal_pct}
              capacityCuFt={truckCapacityCuFt(t)}
              filledCuFt={filledCuFt(t)}
              isRental={t.is_rental}
              onChange={(patch) => patchAt(i, patch)}
            />
            {t.is_rental && (
              <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
                Rental trucks have no interior 25% markers - estimate the fill as best you can.
              </div>
            )}
            {/* Remove sits at the bottom, away from the fill grid, so it isn't a
                mis-tap while tapping the deck to set the load. */}
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button
                type="button"
                onClick={() => removeAt(i)}
                style={{ color: "var(--danger)", fontSize: 13 }}
              >
                Remove load
              </button>
            </div>
          </div>
        );
      })}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {availableFleet.length > 0 && (
          <>
            <span className="small" style={{ color: "var(--muted)" }}>Add a load:</span>
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
