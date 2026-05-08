import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeContext";
import { formatMountainTime } from "../lib/time";
import DVIRReminderModal from "./DVIRReminderModal";
import BillCalculator, { type BillHandle } from "./BillCalculator";

// Mirrors backend EmployeeHoursEntry. `hours` is the actual worked time;
// the company billable total rounds quarter-by-quarter (≥5 min → up, else
// down) at display + sheet-export time. `non_billable` rows still show in
// the table but contribute 0 to total man-hours.
export type EmployeeHoursEntry = {
  name: string;
  start: string;
  end: string;
  break_hours: number;
  hours: number;
  non_billable?: boolean;
};

// Company billing rule: round to the next quarter-hour if the worked time
// is ≥5 minutes into the current quarter; otherwise round down to that
// quarter. Mirrored on the backend (_round_billable_quarter in
// sheets_export.py) so the spreadsheet and the UI agree.
export function roundBillableQuarter(hours: number): number {
  if (hours <= 0) return 0;
  const totalMin = Math.round(hours * 60);
  const quarters = Math.floor(totalMin / 15);
  const remainder = totalMin - quarters * 15;
  const roundedMin = remainder >= 5 ? (quarters + 1) * 15 : quarters * 15;
  return roundedMin / 60;
}

// Compact subset of EventRecord — enough to populate the Employee Hours
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
  { value: "crew_cash",           label: "Crew collected — cash" },
  { value: "crew_check",          label: "Crew collected — check" },
  { value: "office_invoice",      label: "Office sends invoice" },
  { value: "office_arrange_cash", label: "Office arranges pick-up / drop-off — cash" },
  { value: "office_arrange_check",label: "Office arranges pick-up / drop-off — check" },
  { value: "end_of_job",          label: "Bill at end of job (multi-day)" },
];

type ReportData = {
  has_personal_vehicles: boolean | null;
  personal_vehicles: number;
  has_dumpster_use: boolean | null;
  dumpster_pct: number;
  has_recycling_use: boolean | null;
  recycling_pct: number;
  billing_method: string;
  review_candidate: boolean | null;
  hours_match: boolean | null;
  hours_mismatch_reason: string;
  employee_hours: EmployeeHoursEntry[];
};

// In-progress draft persisted to localStorage so partially filled reports
// survive tab switches (the JobReport component unmounts when the user
// navigates away from the Report tab) and full page reloads. Cleared on
// successful submit. Keyed by job_uuid; per-device only — drafts are not
// synced cross-device.
const REPORT_DRAFT_PREFIX = "crew_report_draft_v1:";
type ReportDraft = { data: ReportData; billReviewed: boolean };

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
    localStorage.setItem(reportDraftKey(uuid), JSON.stringify(draft));
  } catch {}
}
function clearReportDraft(uuid: string) {
  try {
    localStorage.removeItem(reportDraftKey(uuid));
  } catch {}
}

type Props = {
  jobUuid: string;
  jobName: string;
  events?: ReportEvent[];
};

export default function JobReport({ jobUuid, jobName, events = [] }: Props) {
  const { user } = useAuth();
  const { settings: themeSettings } = useTheme();
  const ht = themeSettings.helpTexts;

  const [data, setData] = useState<ReportData>({
    has_personal_vehicles: null,
    personal_vehicles: 0,
    has_dumpster_use: null,
    dumpster_pct: 0,
    has_recycling_use: null,
    recycling_pct: 0,
    billing_method: "",
    review_candidate: null,
    hours_match: null,
    hours_mismatch_reason: "",
    employee_hours: [],
  });

  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showDVIRModal, setShowDVIRModal] = useState(false);
  // Crew must confirm the auto-populated bill rows before the report submits.
  // The checkbox lives below the M1 sliders so crew see the M1-driven
  // charges populate before acknowledging them.
  const [billReviewed, setBillReviewed] = useState(false);
  const pendingSaveRef = useRef<(() => Promise<void>) | null>(null);
  const billRef = useRef<BillHandle>(null);

  // Draft autosave state — see REPORT_DRAFT_PREFIX above for the persistence
  // contract. Pill mirrors the global notes pattern: "Saving…" → "✓ Draft saved".
  type DraftStatus = "idle" | "saving" | "saved";
  const [draftStatus, setDraftStatus] = useState<DraftStatus>("idle");
  const draftSaveTimeoutRef = useRef<number | null>(null);
  // Set to true right after we hydrate state from server / localStorage so
  // the autosave effect skips writing back the just-loaded values (which
  // would flip the pill to "Saving" on mount for no reason).
  const skipNextDraftSaveRef = useRef<boolean>(false);

  // Load existing report when job_uuid changes
  useEffect(() => {
    if (!jobUuid) { setLoaded(false); return; }
    setLoaded(false);
    setSaved(false);
    setBillReviewed(false);
    apiFetch<ReportData & { id: number; employee_hours: EmployeeHoursEntry[] | null }>(`/api/job-report?job_uuid=${encodeURIComponent(jobUuid)}`)
      .then((r) => {
        setData({
          // Existing reports — infer answers from saved values
          has_personal_vehicles: r.personal_vehicles > 0,
          personal_vehicles: r.personal_vehicles,
          has_dumpster_use: r.dumpster_pct > 0,
          dumpster_pct: r.dumpster_pct,
          has_recycling_use: r.recycling_pct > 0,
          recycling_pct: r.recycling_pct,
          billing_method: r.billing_method,
          review_candidate: r.review_candidate,
          hours_match: r.hours_match,
          hours_mismatch_reason: r.hours_mismatch_reason ?? "",
          employee_hours: r.employee_hours ?? [],
        });
        setSaved(true);
      })
      .catch(() => {
        // 404 = no report yet, start fresh
        setData({
          has_personal_vehicles: null,
          personal_vehicles: 0,
          has_dumpster_use: null,
          dumpster_pct: 0,
          has_recycling_use: null,
          recycling_pct: 0,
          billing_method: "",
          review_candidate: null,
          hours_match: null,
          hours_mismatch_reason: "",
          employee_hours: [],
        });
      })
      .finally(() => {
        // After the server load (or 404 fallback), check for an in-progress
        // draft. Drafts represent the user's most-recent typing on this
        // device, so they win over a stale server snapshot from a previous
        // submit. Cleared on successful Save below.
        const draft = loadReportDraft(jobUuid);
        if (draft) {
          setData(draft.data);
          setBillReviewed(draft.billReviewed);
          setDraftStatus("saved");
        } else {
          setDraftStatus("idle");
        }
        skipNextDraftSaveRef.current = true;
        setLoaded(true);
      });
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
        .slice()
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [events],
  );

  const eventById = useMemo(() => {
    const m = new Map<string, ReportEvent>();
    for (const e of sortedEvents) m.set(e.event_id, e);
    return m;
  }, [sortedEvents]);

  // A "slot" in the editor is either a picked timeline event or a manually
  // typed HH:MM. Crew picks the manual option when an employee's time
  // doesn't line up with any logged event (e.g., one person arrived 10
  // minutes late and there's no per-employee event for that).
  const MANUAL_SENTINEL = "__manual__";
  type SlotPick = { selection: string; manualTime: string };
  const emptySlot: SlotPick = { selection: "", manualTime: "" };

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
  const [editStart, setEditStart] = useState<SlotPick>(emptySlot);
  const [editEnd, setEditEnd] = useState<SlotPick>(emptySlot);
  type BreakDraft = { start: SlotPick; end: SlotPick };
  const [editBreaks, setEditBreaks] = useState<BreakDraft[]>([]);
  // null when adding; index of the saved row when editing it. Flips Save to
  // "replace at index" semantics and surfaces a banner so the crew sees they
  // aren't appending a duplicate.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const editorInitializedRef = useRef<boolean>(false);

  // One-shot: as soon as defaults are knowable (events arrived from App.tsx),
  // populate start + end. Subsequent edits to either slot — including the
  // user clearing it — won't be clobbered because the flag stops the effect.
  useEffect(() => {
    if (editorInitializedRef.current) return;
    if (defaultStart.selection || defaultEnd.selection) {
      if (defaultStart.selection) setEditStart(defaultStart);
      if (defaultEnd.selection) setEditEnd(defaultEnd);
      editorInitializedRef.current = true;
    }
  }, [defaultStart, defaultEnd]);

  // Drop-down label for an event. Truncates the note onto one line — long
  // notes are clipped with "…" so the option width stays bounded; shorter
  // notes show in full. Newlines are collapsed so multi-line notes don't
  // wrap inside the <option>.
  function eventOptionLabel(ev: ReportEvent): string {
    const time = formatMountainTime(ev.timestamp);
    const rawNote = (ev.note || "").replace(/\s+/g, " ").trim();
    const NOTE_MAX = 40;
    const note = rawNote.length > NOTE_MAX ? rawNote.slice(0, NOTE_MAX - 1) + "…" : rawNote;
    return note ? `${ev.type} — ${time} — ${note}` : `${ev.type} — ${time}`;
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
    if (slot.selection) {
      const ev = eventById.get(slot.selection);
      return ev ? fmtHHMM(ev.timestamp) : "";
    }
    return "";
  }

  // Re-used four times in the editor (start, end, each break's start/end).
  // Renders a <select> over events plus a "Manual time…" option that
  // reveals an inline <input type="time">. Picking a real event after
  // having typed a manual time discards the manual value (selection is
  // mutually exclusive).
  function renderSlotPicker(
    slot: SlotPick,
    setSlot: (next: SlotPick) => void,
    placeholder: string,
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
    setEditBreaks((prev) => [...prev, { start: emptySlot, end: emptySlot }]);
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
    setEditStart(defaultStart);
    setEditEnd(defaultEnd);
    setEditBreaks([]);
    setEditingIndex(null);
    setEditError(null);
  }

  function saveEmployee() {
    const name = editName.trim();
    if (!name) {
      setEditError("Enter an employee name.");
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
      name,
      start: slotToHHMM(editStart),
      end: slotToHHMM(editEnd),
      break_hours: Number(editorPreview.breakHours.toFixed(2)),
      hours: Number(editorPreview.hours.toFixed(2)),
    };
    setData((prev) => {
      if (editingIndex !== null && editingIndex < prev.employee_hours.length) {
        // Preserve the existing non_billable flag — that toggle lives on the
        // saved tile, not in the editor, and shouldn't reset on edit.
        const next = prev.employee_hours.slice();
        next[editingIndex] = {
          ...baseEntry,
          non_billable: prev.employee_hours[editingIndex].non_billable,
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
  // with the stored HH:MM — we don't store the source event ids, so manual
  // mode is the only way to surface the original time exactly. Breaks load
  // as a single manual-time pair when there was any break time recorded.
  function editEmployee(i: number) {
    const emp = data.employee_hours[i];
    if (!emp) return;
    setEditName(emp.name);
    setEditStart({ selection: MANUAL_SENTINEL, manualTime: emp.start || "" });
    setEditEnd({ selection: MANUAL_SENTINEL, manualTime: emp.end || "" });
    setEditBreaks([]); // Drop break detail; crew re-adds breaks if they want different math.
    setEditingIndex(i);
    setEditError(null);
    // Editor is already visible; nudge focus toward it so the crew notices
    // the swap (especially with longer saved tables).
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleEmployeeNonBillable(i: number) {
    setData((prev) => ({
      ...prev,
      employee_hours: prev.employee_hours.map((e, idx) =>
        idx === i ? { ...e, non_billable: !e.non_billable } : e,
      ),
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

  // Sum actuals first, round once at the end — per the company rule. Each
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
    // Validate bill review checkbox
    const billData = billRef.current?.getData();
    if (billData !== null && billData !== undefined && !billReviewed) {
      return setErr("Please confirm you have reviewed the auto-populated bill items before saving.");
    }

    setBusy(true);
    try {
      await apiFetch("/api/job-report", {
        method: "POST",
        body: JSON.stringify({
          job_uuid: jobUuid,
          personal_vehicles: data.personal_vehicles,
          dumpster_pct: data.dumpster_pct,
          recycling_pct: data.recycling_pct,
          billing_method: data.billing_method,
          review_candidate: data.review_candidate,
          hours_match: data.hours_match,
          hours_mismatch_reason: data.hours_mismatch_reason.trim() || null,
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
      // Submit succeeded — discard the in-progress draft. The server is now
      // authoritative; further edits start a fresh draft.
      clearReportDraft(jobUuid);
      setDraftStatus("idle");
    } catch (e: any) {
      setErr(e?.message ?? "Save failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!jobUuid) return setErr("No job selected.");
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
    return <div className="card small" style={{ color: "var(--muted)" }}>Loading…</div>;
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
    />
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

      {/* ── Dumpster & Recycling (sit under the Bill Helper because the
             sliders drive bill line items) ── */}
      <div className="card">
        <div className="sectionTitle">M1 Dumpster Use *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
          Was the M1 dumpster (trash) used on this job?
        </div>
        <YesNo
          value={data.has_dumpster_use}
          onChange={(v) => {
            setData((prev) => ({
              ...prev,
              has_dumpster_use: v,
              dumpster_pct: v ? Math.max(5, prev.dumpster_pct) : 0,
            }));
            setSaved(false);
          }}
          yesLabel="Yes"
          noLabel="No"
        />
        {data.has_dumpster_use && (
          <div style={{ marginTop: 14 }}>
            <PctSlider
              label="Dumpster fill estimate"
              value={data.dumpster_pct}
              onChange={(v) => set("dumpster_pct", v)}
              color="var(--danger)"
            />
          </div>
        )}
      </div>

      <div className="card">
        <div className="sectionTitle">M1 Recycling Use *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
          Was the M1 recycling bin used on this job?
        </div>
        <YesNo
          value={data.has_recycling_use}
          onChange={(v) => {
            setData((prev) => ({
              ...prev,
              has_recycling_use: v,
              recycling_pct: v ? Math.max(5, prev.recycling_pct) : 0,
            }));
            setSaved(false);
          }}
          yesLabel="Yes"
          noLabel="No"
        />
        {data.has_recycling_use && (
          <div style={{ marginTop: 14 }}>
            <PctSlider
              label="Recycling bin fill estimate"
              value={data.recycling_pct}
              onChange={(v) => set("recycling_pct", v)}
              color="var(--ok)"
            />
          </div>
        )}
      </div>

      {/* ── Bill auto-populate review ──
          Placed here so the crew sees the M1 sliders drive new bill
          line items before confirming them. */}
      <div className="card">
        <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={billReviewed}
            onChange={(e) => { setBillReviewed(e.target.checked); setSaved(false); }}
            style={{ marginTop: 3, accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }}
          />
          <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>
            I have reviewed and confirmed the correctness of the auto-populated line items
            in the Bill Helper above (including any dumpster / recycling charges from the
            sliders).
          </span>
        </label>
      </div>

      {jobName && (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 2 }}>
          Report for: <strong style={{ color: "var(--text)" }}>{jobName}</strong>
        </div>
      )}

      {/* ── Personal vehicles ── */}
      <div className="card">
        <div className="sectionTitle">Personal Vehicles at Job Site *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
          Were any crew personal vehicles at the job site?
        </div>
        <YesNo
          value={data.has_personal_vehicles}
          onChange={(v) => {
            setData((prev) => ({
              ...prev,
              has_personal_vehicles: v,
              personal_vehicles: v ? Math.max(1, prev.personal_vehicles) : 0,
            }));
            setSaved(false);
          }}
          yesLabel="Yes"
          noLabel="No"
        />
        {data.has_personal_vehicles && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
            <button
              type="button"
              onClick={() => set("personal_vehicles", Math.max(1, data.personal_vehicles - 1))}
              style={stepBtnStyle}
              aria-label="Decrease"
            >
              −
            </button>
            <span style={{ fontSize: 28, fontWeight: 700, minWidth: 36, textAlign: "center" }}>
              {data.personal_vehicles}
            </span>
            <button
              type="button"
              onClick={() => set("personal_vehicles", data.personal_vehicles + 1)}
              style={stepBtnStyle}
              aria-label="Increase"
            >
              +
            </button>
            <span className="small" style={{ color: "var(--muted)" }}>vehicle{data.personal_vehicles !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>

      {/* ── Billing ── */}
      <div className="card">
        <div className="sectionTitle">Billing Method *</div>
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
                  background: active ? "rgba(93,214,194,0.1)" : "transparent",
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

      {/* ── Review candidate ── */}
      <div className="card">
        <div className="sectionTitle">Review Candidate *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
          Is this client a good candidate for the office to seek a review from?
        </div>
        <YesNo
          value={data.review_candidate}
          onChange={(v) => set("review_candidate", v)}
          yesLabel="Yes — reach out"
          noLabel="No"
        />
      </div>

      {/* ── Employee Hours ──
          Crew picks events from the timeline for each crew member's start
          and end, plus any clocked-out periods. Save adds a row to the
          table below; the whole block ships to the backend on report
          submission and lands in the JobReports sheet's employee_hours
          column.

          Storage carries resolved HH:MM strings, not event_ids — keeps
          the Sheet column human-readable and decouples it from later
          edits to the source events. */}
      <div className="card">
        <div className="sectionTitle">Employee Hours</div>

        {sortedEvents.length < 2 ? (
          <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>
            Need at least two timeline events for this job before you can
            log employee hours.
          </div>
        ) : (
          <>
            <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
              Type a name, pick the start and end events, add any clocked-out
              periods, then Save. Repeat for each crew member.
            </div>

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
              <input
                type="text"
                placeholder="Employee name"
                value={editName}
                onChange={(e) => { setEditName(e.target.value); setEditError(null); }}
                style={{ width: "100%" }}
              />

              <div className="row wrap" style={{ gap: 6, alignItems: "center" }}>
                {renderSlotPicker(editStart, (s) => { setEditStart(s); setEditError(null); }, "Start event…")}
                <span className="small">→</span>
                {renderSlotPicker(editEnd, (s) => { setEditEnd(s); setEditError(null); }, "End event…")}
              </div>

              <div className="col" style={{ gap: 6 }}>
                <div className="small" style={{ color: "var(--muted)" }}>
                  Clocked-out periods (lunch, errands, anything that should be
                  subtracted from hours worked):
                </div>
                {editBreaks.map((b, i) => (
                  <div key={i} className="row wrap" style={{ gap: 6, alignItems: "center" }}>
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
        )}

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
                  className="row"
                  style={{
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                    opacity: emp.non_billable ? 0.7 : 1,
                    background: isEditing ? "rgba(106,167,255,0.06)" : undefined,
                  }}
                >
                  <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{emp.name}</div>
                      <label
                        className="row"
                        style={{ gap: 4, alignItems: "center", cursor: "pointer" }}
                        title="Toggle whether this entry counts toward total man-hours"
                      >
                        <input
                          type="checkbox"
                          checked={!!emp.non_billable}
                          onChange={() => toggleEmployeeNonBillable(i)}
                          style={{ accentColor: "var(--brand)", width: 14, height: 14 }}
                        />
                        <span className="small" style={{ color: "var(--muted)" }}>
                          Non-billable
                        </span>
                      </label>
                    </div>
                    <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                      {emp.start && emp.end ? `${emp.start}–${emp.end}` : ""}
                      {emp.break_hours > 0 ? ` · break ${emp.break_hours.toFixed(2)}h` : ""}
                    </div>
                    <div className="small" style={{ marginTop: 2 }}>
                      {emp.non_billable ? (
                        <>
                          <strong style={{ color: "var(--muted)" }}>non-billable</strong>
                          <span style={{ color: "var(--muted)" }}> (actual {emp.hours.toFixed(2)}h)</span>
                        </>
                      ) : (
                        <strong style={{ color: "var(--text)" }}>{emp.hours.toFixed(2)}h</strong>
                      )}
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
                {Math.abs(totalBillableHours - totalActualHours) > 0.001 && (
                  <span
                    className="small"
                    style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}
                  >
                    (actual {totalActualHours.toFixed(2)}h)
                  </span>
                )}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Hours reconciliation ── */}
      <div className="card">
        <div className="sectionTitle">Hours Reconciliation *</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
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
      </div>

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
                ? v ? "rgba(93,214,194,0.1)" : "rgba(255,107,107,0.08)"
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
