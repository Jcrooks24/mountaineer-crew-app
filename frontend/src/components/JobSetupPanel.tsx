/**
 * Job setup capture panel - ADR 0034, C1.2.
 *
 * Appears on the hub once a job is selected. Captures the job header: crew
 * (pre-filled from the calendar invitees, then confirm/add), vehicle unit(s),
 * local/long-distance, name/date, origin/destination/stops, and job type. Saves
 * to the offline-safe job-setup store. Nothing else reads the header yet (that
 * is C1.3); this is where the office fills it in.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../api/client";
import RosterPicker from "./RosterPicker";
import { useJobTypes } from "../lib/jobTypesStore";
import { getUnitsCached, refreshUnits, type VehicleUnit } from "../lib/vehicleUnits";
import { LdPlanTile, type LdActivity, type LdPlan } from "./LdWorkday";
import {
  loadJobSetup,
  saveJobSetup,
  type CrewMember,
  type JobSetupData,
} from "../lib/jobSetupStore";

type Meta = {
  jobName: string;
  jobDate: string;
  source: "calendar" | "manual" | null;
  calendarEventId: string | null;
};

type EventCrew = {
  ok: boolean;
  matched: { user_id: number; name: string; email: string }[];
  unmatched: string[];
};

export default function JobSetupPanel({
  jobUuid,
  meta,
  onHeader,
  ldPlan,
  onToggleActivity,
}: {
  jobUuid: string;
  meta: Meta;
  // Fired with the SAVED header (or null when a job has none) after load and
  // after a successful save. The hub uses it to make the device mode follow the
  // job's long-distance flag (ADR 0034, C1.3).
  onHeader?: (h: JobSetupData | null) => void;
  // "What are you doing today?" - shown for every job (LD adds Driving).
  ldPlan: LdPlan;
  onToggleActivity: (a: LdActivity) => void;
}) {
  const jobTypes = useJobTypes();
  const [units, setUnits] = useState<VehicleUnit[]>(() => getUnitsCached());

  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [existing, setExisting] = useState<JobSetupData | null>(null);

  // Form state.
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [suggested, setSuggested] = useState<{ user_id: number; name: string }[]>([]);
  const [vehicleUnitNames, setVehicleUnitNames] = useState<string[]>([]);
  const [isLD, setIsLD] = useState(false);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [stops, setStops] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "queued">("idle");
  const [err, setErr] = useState<string | null>(null);

  // Hydrate the form from an existing header, or seed a fresh one from the
  // job meta + calendar invitees.
  const hydrate = useCallback((h: JobSetupData | null, evc: EventCrew | null) => {
    if (h) {
      setCrew(h.crew || []);
      setVehicleUnitNames(h.vehicle_unit_names || []);
      setIsLD(!!h.is_long_distance);
      setOrigin(h.origin || "");
      setDestination(h.destination || "");
      setStops(h.stops || []);
      setTags(h.job_type_tags || []);
      setNotes(h.notes || "");
    } else {
      // Fresh job: pre-fill crew from matched invitees (unconfirmed until the
      // crew tick them), and name/date from the selected job.
      setCrew(
        (evc?.matched || []).map((m) => ({
          user_id: m.user_id,
          name: m.name,
          source: "invitee" as const,
          confirmed: false,
        })),
      );
    }
    if (evc) {
      setUnmatched(evc.unmatched || []);
      setSuggested((evc.matched || []).map((m) => ({ user_id: m.user_id, name: m.name })));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setStatus("idle");
    setErr(null);
    refreshUnits().then((u) => { if (!cancelled) setUnits(u); }).catch(() => {});

    (async () => {
      const h = await loadJobSetup(jobUuid);
      let evc: EventCrew | null = null;
      // Only ask the calendar for invitees when there is no saved crew yet -
      // once the header has crew, that is the source of truth.
      if ((!h || !(h.crew && h.crew.length)) && meta.source === "calendar" && meta.calendarEventId) {
        try {
          evc = await apiFetch<EventCrew>(
            `/api/calendar/event-crew?calendar_event_id=${encodeURIComponent(meta.calendarEventId)}`,
          );
        } catch {
          evc = null;
        }
      }
      if (cancelled) return;
      setExisting(h);
      hydrate(h, evc);
      onHeader?.(h);
      // A set-up job shows a compact static tile; a job with no header opens the
      // form so the crew can fill it (with the suggested crew prefilled).
      setOpen(!h);
      setLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [jobUuid, meta.source, meta.calendarEventId, hydrate]);

  const toggleUnit = (name: string) =>
    setVehicleUnitNames((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  const toggleTag = (t: string) =>
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const setCrewConfirmed = (i: number, v: boolean) =>
    setCrew((prev) => prev.map((c, j) => (j === i ? { ...c, confirmed: v } : c)));
  const removeCrew = (i: number) => setCrew((prev) => prev.filter((_, j) => j !== i));
  const addCrew = (userId: number | null, name: string) => {
    if (userId == null) return;
    setCrew((prev) =>
      prev.some((c) => c.user_id === userId)
        ? prev
        : [...prev, { user_id: userId, name, source: "added", confirmed: true }],
    );
  };
  const addSuggested = () =>
    setCrew((prev) => {
      const have = new Set(prev.map((c) => c.user_id));
      const add = suggested
        .filter((s) => !have.has(s.user_id))
        .map((s) => ({ user_id: s.user_id, name: s.name, source: "invitee" as const, confirmed: true }));
      return [...prev, ...add];
    });

  const body = useMemo<JobSetupData>(() => ({
    // Name/date are identity from the job selection, not editable here.
    job_name: (meta.jobName || "").trim() || null,
    job_date: (meta.jobDate || "").trim() || null,
    source: meta.source,
    calendar_event_id: meta.calendarEventId,
    is_long_distance: isLD,
    job_type_tags: tags,
    vehicle_unit_names: vehicleUnitNames,
    crew,
    origin: origin.trim() || null,
    destination: destination.trim() || null,
    stops: stops.map((s) => s.trim()).filter(Boolean),
    notes: notes.trim() || null,
    // Overwrite protection is confirm-to-edit now, not a persistent lock, so the
    // header is never locked. Saves carry override (below) to bypass any stale
    // lock left over from the old model.
    locked: false,
  }), [meta.jobName, meta.jobDate, meta.source, meta.calendarEventId, isLD, tags, vehicleUnitNames, crew, origin, destination, stops, notes]);

  const doSave = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await saveJobSetup(jobUuid, { ...body, override: true });
      setStatus(r.synced ? "saved" : "queued");
      if (r.setup) setExisting(r.setup);
      // The saved header (or the queued body when offline) is what the hub
      // should follow for the LD mode.
      onHeader?.(r.setup ?? { ...body });
      if (r.synced) setOpen(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return <div className="small" style={{ color: "var(--muted)" }}>Loading job setup…</div>;
  }

  const crewNames = crew.filter((c) => c.confirmed).map((c) => c.name.trim()).filter(Boolean);
  const routeParts = [origin, ...stops, destination].map((s) => (s || "").trim()).filter(Boolean);
  const staticRow = (label: string, value: string) => (
    <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
      <span className="small" style={{ color: "var(--muted)", flex: "0 0 52px" }}>{label}</span>
      <span className="small" style={{ fontWeight: 600, minWidth: 0, wordBreak: "break-word" }}>{value}</span>
    </div>
  );

  // Local / long-distance segmented toggle, used inside the setup form.
  const ldToggle = (
    <div className="col" style={{ gap: 6 }}>
      <span className="small" style={{ color: "var(--muted)", fontWeight: 700 }}>Local or long-distance?</span>
      <div
        className="row"
        role="group"
        aria-label="Local or long-distance"
        style={{ gap: 0, border: "1px solid var(--border)", borderRadius: 999, overflow: "hidden", alignSelf: "flex-start" }}
      >
        {([["local", "Local"], ["long_distance", "Long-distance"]] as const).map(([m, label]) => {
          const on = (m === "long_distance") === isLD;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              onClick={() => setIsLD(m === "long_distance")}
              style={{
                padding: "8px 20px", fontSize: 14, fontWeight: on ? 700 : 500, cursor: "pointer", border: "none",
                background: on ? "var(--brand)" : "transparent",
                color: on ? "var(--on-brand, #fff)" : "var(--muted)",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div>
      {!open && existing ? (
        // Static tile: the captured setup at a glance, with an Edit option.
        <div className="col" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div className="microLabel" style={{ marginBottom: 0 }}>Job setup</div>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              {status === "saved" && <span className="small" style={{ color: "var(--ok)" }}>Saved</span>}
              {status === "queued" && <span className="small" style={{ color: "var(--warn, #e0a800)" }}>Saved offline</span>}
              {/* Confirm-to-edit: this setup feeds other tools, so editing it is
                  a deliberate act (no accidental clobber). */}
              <button
                type="button"
                onClick={() => {
                  if (confirm("Edit this job's setup? It feeds the DVIR, the job report, and the checklist for this job.")) {
                    setOpen(true);
                  }
                }}
                style={{ fontSize: 12 }}
              >
                Edit
              </button>
            </div>
          </div>
          {staticRow("Trip", isLD ? "Long-distance" : "Local")}
          {staticRow("Crew", crewNames.length ? crewNames.join(", ") : "None added")}
          {staticRow("Truck", vehicleUnitNames.length ? vehicleUnitNames.join(", ") : "Not set")}
          {tags.length > 0 && staticRow("Type", tags.join(", "))}
          {routeParts.length > 0 && staticRow("Route", routeParts.join(" -> "))}
          {notes.trim() && staticRow("Notes", notes.trim())}
          {(() => {
            const doing = ldPlan.activities.filter((a) => isLD || a !== "driving");
            return doing.length > 0
              ? staticRow("Doing", doing.map((a) => a.charAt(0).toUpperCase() + a.slice(1)).join(", "))
              : null;
          })()}
        </div>
      ) : !open ? (
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            <div className="microLabel" style={{ marginBottom: 2 }}>Set up job</div>
            <div className="small" style={{ color: "var(--muted)" }}>Not set up yet</div>
          </div>
          <button type="button" onClick={() => setOpen(true)} style={{ fontSize: 12 }}>Set up</button>
        </div>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div className="microLabel" style={{ marginBottom: 0 }}>Set up job</div>
            {existing && (
              <button type="button" onClick={() => setOpen(false)} style={{ fontSize: 12 }}>Cancel</button>
            )}
          </div>

          {/* Local / long-distance */}
          {ldToggle}

          {/* Crew */}
          <div className="col" style={{ gap: 6 }}>
            <span className="small" style={{ color: "var(--muted)", fontWeight: 700 }}>Crew</span>
            {suggested.length > 0 ? (
              <span className="small" style={{ color: "var(--muted)" }}>
                Suggested from the calendar invitees (matched by email). Tick to confirm, or add more below.
              </span>
            ) : crew.length === 0 ? (
              <span className="small" style={{ color: "var(--muted)" }}>No crew yet. Add them below.</span>
            ) : null}
            {crew.length > 0 && (
              <div className="row wrap" style={{ gap: 8 }}>
                {crew.map((c, i) => {
                  const on = c.confirmed;
                  return (
                    <span
                      key={`${c.user_id ?? c.name}-${i}`}
                      role="button"
                      tabIndex={0}
                      aria-pressed={on}
                      onClick={() => setCrewConfirmed(i, !on)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCrewConfirmed(i, !on); } }}
                      title={on ? "On the job - tap to unselect" : "Suggested - tap to add"}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "6px 12px", borderRadius: 999, fontSize: 13, cursor: "pointer",
                        border: on ? "1px solid var(--brand)" : "1px solid var(--border)",
                        background: on ? "var(--brand)" : "transparent",
                        color: on ? "var(--on-brand, #fff)" : "var(--text)", fontWeight: on ? 700 : 400,
                      }}
                    >
                      <span>{c.name || "(unnamed)"}</span>
                      {c.source === "invitee" && !on && (
                        <span style={{ fontSize: 10, opacity: 0.7 }}>invited</span>
                      )}
                      {/* Only manually-added crew get a remove control: an invited
                          suggestion just untoggles (it stays as a suggestion), so
                          it needs no destructive x competing with the toggle. The
                          x carries its own padded hit area so it isn't a mis-tap. */}
                      {c.source !== "invitee" && (
                        <span
                          role="button"
                          aria-label={`Remove ${c.name || "crew member"}`}
                          onClick={(e) => { e.stopPropagation(); removeCrew(i); }}
                          style={{ marginLeft: 4, padding: "2px 6px", fontSize: 16, lineHeight: 1, opacity: 0.8, borderRadius: 999 }}
                        >
                          ×
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
            {suggested.some((s) => !crew.some((c) => c.user_id === s.user_id)) && (
              <button type="button" onClick={addSuggested} style={{ fontSize: 12, alignSelf: "flex-start" }}>
                + Add all invited crew
              </button>
            )}
            <RosterPicker userId={null} onChange={addCrew} />
            {unmatched.length > 0 && (
              <span className="small" style={{ color: "var(--muted)" }}>
                {unmatched.length} invited email{unmatched.length === 1 ? "" : "s"} matched nobody on the roster: {unmatched.join(", ")}
              </span>
            )}
          </div>

          {/* Vehicle units */}
          <div className="col" style={{ gap: 6 }}>
            <span className="small" style={{ color: "var(--muted)", fontWeight: 700 }}>Vehicle unit(s)</span>
            <div className="row wrap" style={{ gap: 8 }}>
              {units.length === 0 && <span className="small" style={{ color: "var(--muted)" }}>No units configured.</span>}
              {units.map((u) => {
                const on = vehicleUnitNames.includes(u.name);
                return (
                  <button
                    key={u.name}
                    type="button"
                    onClick={() => toggleUnit(u.name)}
                    style={{
                      padding: "6px 12px", borderRadius: 999, fontSize: 13, cursor: "pointer",
                      border: on ? "1px solid var(--brand)" : "1px solid var(--border)",
                      background: on ? "var(--brand)" : "transparent",
                      color: on ? "var(--on-brand, #fff)" : "var(--text)", fontWeight: on ? 700 : 400,
                    }}
                  >
                    {u.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Job type */}
          <div className="col" style={{ gap: 6 }}>
            <span className="small" style={{ color: "var(--muted)", fontWeight: 700 }}>Job type</span>
            <div className="row wrap" style={{ gap: 8 }}>
              {jobTypes.length === 0 && <span className="small" style={{ color: "var(--muted)" }}>No job types configured.</span>}
              {jobTypes.map((t) => {
                const on = tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    style={{
                      padding: "6px 12px", borderRadius: 999, fontSize: 13, cursor: "pointer",
                      border: on ? "1px solid var(--brand)" : "1px solid var(--border)",
                      background: on ? "var(--brand)" : "transparent",
                      color: on ? "var(--on-brand, #fff)" : "var(--text)", fontWeight: on ? 700 : 400,
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Addresses */}
          <div className="col" style={{ gap: 6 }}>
            <label className="col" style={{ gap: 2 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Origin</span>
              <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Pickup address (blank OK)" />
            </label>
            {stops.map((s, i) => (
              <div key={i} className="row" style={{ gap: 6, alignItems: "flex-end" }}>
                <label className="col" style={{ gap: 2, flex: 1 }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Stop {i + 1}</span>
                  <input value={s} onChange={(e) => setStops((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} />
                </label>
                <button type="button" onClick={() => setStops((prev) => prev.filter((_, j) => j !== i))} style={{ fontSize: 12, color: "var(--danger)" }}>Remove</button>
              </div>
            ))}
            <button type="button" onClick={() => setStops((prev) => [...prev, ""])} style={{ fontSize: 12, alignSelf: "flex-start" }}>+ Add stop</button>
            <label className="col" style={{ gap: 2 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Destination</span>
              <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Delivery address (blank OK)" />
            </label>
          </div>

          {/* Notes */}
          <label className="col" style={{ gap: 2 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Notes</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
          </label>

          {/* What are you doing today? - the last setup field; it drives the
              timeline tools (labor -> Actions, driving -> RODS). */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <LdPlanTile plan={ldPlan} onToggleActivity={onToggleActivity} showDriving={isLD} />
          </div>

          {err && <span className="small" style={{ color: "var(--danger)" }}>{err}</span>}

          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btnPrimary" onClick={() => doSave()} disabled={busy}>
              {busy ? "Saving…" : "Save job setup"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
