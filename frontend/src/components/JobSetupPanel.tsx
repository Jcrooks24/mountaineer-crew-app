/**
 * Job setup capture panel - ADR 0034, C1.2.
 *
 * Appears on the hub once a job is selected. Captures the job header: crew
 * (pre-filled from the calendar invitees, then confirm/add), vehicle unit(s),
 * local/long-distance, name/date, origin/destination/stops, and job type. Saves
 * to the offline-safe job-setup store. Nothing else reads the header yet (that
 * is C1.3); this is where the office fills it in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FieldHelp } from "./FieldHelp";
import { BetaTag } from "./BetaTag";
import { useTheme } from "../theme/ThemeContext";
import { apiFetch, ApiError } from "../api/client";
import RosterPicker from "./RosterPicker";
import { useJobTypes } from "../lib/jobTypesStore";
import { getUnitsCached, refreshUnits, type VehicleUnit } from "../lib/vehicleUnits";
import {
  getActiveRentalsCached, markRentalReturned, newRentalUuid, refreshActiveRentals,
  rentalLabel, unlinkRentalFromJob, type RentalTruck,
} from "../lib/rentalTrucks";
import { LdPlanTile, LD_LABELS, type LdActivity, type LdPlan } from "./LdWorkday";
import {
  loadJobSetup,
  saveJobSetup,
  type CrewMember,
  type JobSetupData,
  type BolHeader,
} from "../lib/jobSetupStore";
import { FORM_OF_PAYMENT_OPTIONS, ESTIMATE_TYPE_OPTIONS, VALUATION_OPTIONS } from "../lib/bolContract";

// Job-type options that duplicate the dedicated Local/Long-distance toggle or the
// "What are you doing today?" activity picker - filtered out of the job-type list
// so the crew never log the same thing in two inputs.
const TRIP_TASK_TAGS = new Set([
  "local", "long-distance", "long distance", "longdistance",
  "packing", "unpacking", "loading", "unloading", "driving",
  // The activity picker's own label for an internal rearrange, plus the spellings
  // an admin is likely to type if they add it as a job type too.
  "rearranging", "rearrange", "internal rearrange", "internal-rearrange",
]);

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

/** Only the fields a header save sends for its rental; a record from the
 *  server also carries its job list and timestamps, which a save ignores. */
function pickFields(r: NonNullable<JobSetupData["rental"]> | RentalTruck): NonNullable<JobSetupData["rental"]> {
  return {
    rental_uuid: r.rental_uuid ?? null,
    plate: r.plate ?? null,
    company: r.company ?? null,
    agreement_number: r.agreement_number ?? null,
    gvwr_lbs: r.gvwr_lbs ?? null,
    notes: r.notes ?? null,
  };
}

function chipStyle(on: boolean): React.CSSProperties {
  return {
    padding: "6px 12px", borderRadius: 999, fontSize: 13, cursor: "pointer",
    border: on ? "1px solid var(--brand)" : "1px solid var(--border)",
    background: on ? "var(--brand)" : "transparent",
    color: on ? "var(--on-brand)" : "var(--text)", fontWeight: on ? 700 : 400,
  };
}

export default function JobSetupPanel({
  jobUuid,
  meta,
  onHeader,
  ldPlan,
  onToggleActivity,
  ldStorageErr = null,
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
  /** Storage-full message from useLdPlan, surfaced on the tile. */
  ldStorageErr?: string | null;
}) {
  // Field help: hidden until the crew taps a field title, then three seconds.
  // Admin-editable in Admin > Help text, so wording changes need no redeploy.
  const ht = useTheme().settings.helpTexts;
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
  // The actual truck behind a rental placeholder unit (ADR 0053). Only asked
  // for when one of the selected units is flagged as a rental in the registry.
  const [rental, setRental] = useState<NonNullable<JobSetupData["rental"]>>({});
  // Rental trucks already entered (ADR 0055), offered next to the owned units
  // as "Rental*<job name>" so a multi-day job picks the truck instead of
  // re-entering it. Cached, so the chips still show offline.
  const [rentals, setRentals] = useState<RentalTruck[]>(() => getActiveRentalsCached());
  // The id a new truck typed here is created under, fixed for this form so a
  // queued offline save cannot create it twice.
  const newRentalId = useRef(newRentalUuid());
  const [rentalBusy, setRentalBusy] = useState(false);
  const [rentalMsg, setRentalMsg] = useState<string | null>(null);
  // A rental entry is a placeholder reused across every truck we hire, so the
  // job has to say which one this was. Unknown unit names are not rentals:
  // the flag is the registry's to set.
  const usesRental = useMemo(
    () => vehicleUnitNames.some((n) => units.some((u) => u.name === n && u.is_rental)),
    [vehicleUnitNames, units],
  );
  const [isLD, setIsLD] = useState(false);
  // "What are you doing today?" expanded on the read-only tile. The day plan
  // is per-DAY and is NOT part of the job header, so it stays editable after
  // the header is saved - no confirm-to-edit, no Save. See the tile below.
  const [doingOpen, setDoingOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [stops, setStops] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [bolHeader, setBolHeader] = useState<BolHeader>({});
  const setBolField = (k: keyof BolHeader, v: string) =>
    setBolHeader((p) => ({ ...p, [k]: v }));
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "queued">("idle");
  const [err, setErr] = useState<string | null>(null);

  // Hydrate the form from an existing header, or seed a fresh one from the
  // job meta + calendar invitees.
  const hydrate = useCallback((h: JobSetupData | null, evc: EventCrew | null) => {
    if (h) {
      setCrew(h.crew || []);
      // A truck linked to this job anywhere, usually at the pre-trip DVIR, is
      // this job's truck here too (ADR 0055): the header adopts it rather than
      // asking for it again.
      const linkedUnit = h.rental?.rental_uuid ? (h.rental as RentalTruck).unit_name : "";
      const names = h.vehicle_unit_names || [];
      setVehicleUnitNames(linkedUnit && !names.includes(linkedUnit) ? [...names, linkedUnit] : names);
      setRental(h.rental ? pickFields(h.rental) : {});
      setIsLD(!!h.is_long_distance);
      setOrigin(h.origin || "");
      setDestination(h.destination || "");
      setStops(h.stops || []);
      setTags(h.job_type_tags || []);
      setBolHeader(h.bol_header || {});
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
    refreshActiveRentals().then((r) => { if (!cancelled) setRentals(r); }).catch(() => {});

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

  // The trucks this job can show as chips: the live list, plus the job's own
  // truck even if it has since gone idle or been returned.
  const rentalChoices = useMemo(() => {
    const own = existing?.rentals || [];
    const extra = own.filter((r) => !rentals.some((x) => x.rental_uuid === r.rental_uuid));
    return [...rentals, ...extra];
  }, [rentals, existing]);
  const pickedRecord = rental.rental_uuid
    ? rentalChoices.find((r) => r.rental_uuid === rental.rental_uuid) ?? null
    : null;
  // Saved on the server as this job's truck, so returning or removing it means
  // something. A truck only typed here (maybe still queued offline) is not.
  const linkedToJob = !!pickedRecord && pickedRecord.jobs.some((j) => j.job_uuid === jobUuid);

  const pickRentalRecord = (r: RentalTruck) => {
    setRentalMsg(null);
    if (rental.rental_uuid === r.rental_uuid) {
      if (r.jobs.some((j) => j.job_uuid === jobUuid)) {
        // Deselecting would not unlink it on the server, so the truck would
        // come straight back. Point at the button that actually removes it.
        setRentalMsg("This truck is linked to this job. To take it off, use \"Wrong truck, remove from job\" below.");
        return;
      }
      // Tapping the picked truck again deselects it.
      setRental({});
      setVehicleUnitNames((prev) => prev.filter((n) => n !== r.unit_name));
      return;
    }
    setRental(pickFields(r));
    setVehicleUnitNames((prev) => (prev.includes(r.unit_name) ? prev : [...prev, r.unit_name]));
  };
  const pickNewRental = (unitName: string) => {
    setRentalMsg(null);
    const picking = !(vehicleUnitNames.includes(unitName) && !pickedRecord);
    newRentalId.current = newRentalUuid();
    setRental({});
    setVehicleUnitNames((prev) =>
      picking ? (prev.includes(unitName) ? prev : [...prev, unitName]) : prev.filter((n) => n !== unitName),
    );
  };

  const returnRental = async () => {
    if (!pickedRecord) return;
    if (!confirm(`Mark ${pickedRecord.plate} as returned to the rental company? It leaves the truck list; its record stays.`)) return;
    setRentalBusy(true);
    setRentalMsg(null);
    try {
      await markRentalReturned(pickedRecord.rental_uuid);
      setRentals(await refreshActiveRentals({ force: true }));
      setRentalMsg("Marked returned.");
    } catch (e) {
      setRentalMsg(e instanceof ApiError ? e.message : "Could not reach the server. Try again when online.");
    } finally {
      setRentalBusy(false);
    }
  };
  const removeRentalFromJob = async () => {
    if (!pickedRecord) return;
    if (!confirm(`Remove ${pickedRecord.plate} from this job? Use this for a wrong pick.`)) return;
    setRentalBusy(true);
    setRentalMsg(null);
    try {
      await unlinkRentalFromJob(pickedRecord.rental_uuid, jobUuid);
      setRental({});
      setVehicleUnitNames((prev) => prev.filter((n) => n !== pickedRecord.unit_name));
      setExisting((h) => (h ? { ...h, rentals: (h.rentals || []).filter((r) => r.rental_uuid !== pickedRecord.rental_uuid) } : h));
      setRentalMsg("Removed from this job. Save to keep the change.");
    } catch (e) {
      setRentalMsg(e instanceof ApiError ? e.message : "Could not reach the server. Try again when online.");
    } finally {
      setRentalBusy(false);
    }
  };
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
    // Sent only when a rental unit is selected. The server turns it into (or
    // joins it to) a rental truck record linked to this job (ADR 0055); a save
    // without it unlinks nothing, so a wrong pick is removed with the button.
    rental: usesRental
      ? { ...pickFields(rental), rental_uuid: rental.rental_uuid || newRentalId.current }
      : null,
    crew,
    origin: origin.trim() || null,
    destination: destination.trim() || null,
    stops: stops.map((s) => s.trim()).filter(Boolean),
    bol_header: bolHeader,
    notes: notes.trim() || null,
    // Overwrite protection is confirm-to-edit now, not a persistent lock, so the
    // header is never locked. Saves carry override (below) to bypass any stale
    // lock left over from the old model.
    locked: false,
  }), [meta.jobName, meta.jobDate, meta.source, meta.calendarEventId, isLD, tags, vehicleUnitNames, usesRental, rental, crew, origin, destination, stops, bolHeader, notes]);

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
      <FieldHelp label="Local or long-distance?" bold />
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
                color: on ? "var(--on-brand)" : "var(--muted)",
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
          {staticRow(
            "Truck",
            vehicleUnitNames.length
              ? vehicleUnitNames
                  .map((n) => (n === (existing?.rental as RentalTruck | null | undefined)?.unit_name && existing?.rental?.plate
                    ? `${n} (${existing.rental.plate})`
                    : n))
                  .join(", ")
              : "Not set",
          )}
          {tags.length > 0 && staticRow("Type", tags.join(", "))}
          {routeParts.length > 0 && staticRow("Route", routeParts.join(" -> "))}
          {notes.trim() && staticRow("Notes", notes.trim())}
          {(() => {
            // The day plan is keyed by CALENDAR DAY, so on day 2+ of a trip it
            // starts empty while the header is already saved and this tile is
            // read-only. This row used to disappear entirely when the plan was
            // empty, which put "Driving" - the gate on the RODS recorder - out
            // of reach on exactly the days that need it: the crew would have had
            // to reopen the whole setup form behind its confirm-to-edit warning.
            // So the row always renders, and it edits in place.
            const doing = ldPlan.activities.filter((a) => isLD || a !== "driving");
            const summary = doing.length > 0
              ? doing.map((a) => LD_LABELS[a]).join(", ")
              : "Not picked yet";
            return (
              <div className="col" style={{ gap: 8 }}>
                <button
                  type="button"
                  aria-expanded={doingOpen}
                  onClick={() => setDoingOpen((v) => !v)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span className="small" style={{ color: "var(--muted)", flex: "0 0 52px" }}>Doing</span>
                  <span
                    className="small"
                    style={{
                      fontWeight: 600, minWidth: 0, wordBreak: "break-word",
                      color: doing.length > 0 ? "var(--text)" : "var(--muted)",
                    }}
                  >
                    {summary}
                  </span>
                  <span className="row" style={{ alignItems: "center", gap: 6, marginLeft: "auto", flex: "0 0 auto" }}>
                    <BetaTag feature="dayPlanInlineEdit" style={{ marginTop: 0 }} />
                    <span className="small" style={{ color: "var(--brand)" }}>
                      {doingOpen ? "Done" : "Change"}
                    </span>
                  </span>
                </button>
                {doingOpen && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    <LdPlanTile
                      plan={ldPlan}
                      onToggleActivity={onToggleActivity}
                      showDriving={isLD}
                      storageErr={ldStorageErr}
                    />
                  </div>
                )}
              </div>
            );
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
            <div>
              <div className="microLabel" style={{ marginBottom: 0 }}>Set up job</div>
              <BetaTag feature="setupFieldHelp" style={{ marginTop: 2 }} />
            </div>
            {existing && (
              <button type="button" onClick={() => setOpen(false)} style={{ fontSize: 12 }}>Cancel</button>
            )}
          </div>
          <div className="small" style={{ color: "var(--muted)" }}>
            Tap any field title with a <span aria-hidden="true">?</span> for a short explanation.
          </div>

          {/* Local / long-distance */}
          {ldToggle}

          {/* Crew */}
          <div className="col" style={{ gap: 6 }}>
            <FieldHelp label="Crew" bold />
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
                        color: on ? "var(--on-brand)" : "var(--text)", fontWeight: on ? 700 : 400,
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
            <FieldHelp label="Vehicle unit(s)" bold />
            <div className="row wrap" style={{ gap: 8 }}>
              {units.length === 0 && <span className="small" style={{ color: "var(--muted)" }}>No units configured.</span>}
              {units.filter((u) => !u.is_rental).map((u) => {
                const on = vehicleUnitNames.includes(u.name);
                return (
                  <button key={u.name} type="button" onClick={() => toggleUnit(u.name)} style={chipStyle(on)}>
                    {u.name}
                  </button>
                );
              })}
              {rentalChoices.map((r) => {
                const on = rental.rental_uuid === r.rental_uuid;
                const { label, sub } = rentalLabel(r, rentalChoices);
                return (
                  <button key={r.rental_uuid} type="button" onClick={() => pickRentalRecord(r)} style={chipStyle(on)}>
                    {label}
                    {sub && <span style={{ fontSize: 11, opacity: 0.8 }}> {sub}</span>}
                  </button>
                );
              })}
              {(() => {
                const placeholders = units.filter((u) => u.is_rental);
                return placeholders.map((u) => {
                  const on = vehicleUnitNames.includes(u.name) && !pickedRecord;
                  return (
                    <button key={`new:${u.name}`} type="button" onClick={() => pickNewRental(u.name)} style={chipStyle(on)}>
                      {placeholders.length > 1 ? `+ New rental truck (${u.name})` : "+ New rental truck"}
                    </button>
                  );
                });
              })()}
            </div>
            {units.some((u) => u.is_rental) && (
              <span className="small" style={{ color: "var(--muted)" }}>
                Rental trucks can also be entered at the pre-trip inspection. <BetaTag feature="rentalTruckList" />
              </span>
            )}
          </div>

          {usesRental && (
            <div className="col" style={{ gap: 8, padding: 12, border: "1px solid var(--brand)", borderRadius: 10 }}>
              <FieldHelp label="Which rental truck?" bold />
              <span className="small" style={{ color: "var(--muted)" }}>
                The plate is what goes on the inspection report, the duty log and the bill
                of lading, so those records say which truck they are about. Leave it blank
                if nobody has the truck yet: the driver enters it at the pre-trip inspection.
              </span>
              {pickedRecord ? (
                <div className="small col" style={{ gap: 4 }}>
                  <span>
                    Plate <span className="mono" style={{ fontWeight: 700 }}>{pickedRecord.plate}</span>
                    {pickedRecord.jobs.length > 0 && (
                      <span style={{ color: "var(--muted)" }}>
                        {" "}· used on {pickedRecord.jobs.map((j) => j.job_name || "(unnamed job)").join(", ")}
                      </span>
                    )}
                  </span>
                  {linkedToJob && (
                    <div className="row wrap" style={{ gap: 8 }}>
                      <button type="button" disabled={rentalBusy} onClick={returnRental} style={{ fontSize: 12 }}>
                        Truck returned
                      </button>
                      <button type="button" disabled={rentalBusy} onClick={removeRentalFromJob} style={{ fontSize: 12 }}>
                        Wrong truck, remove from job
                      </button>
                    </div>
                  )}
                  {rentalMsg && <span style={{ color: "var(--muted)" }}>{rentalMsg}</span>}
                </div>
              ) : (
                <label className="col" style={{ gap: 4 }}>
                  <span className="small">Plate or unit number</span>
                  <input
                    id="rental-plate"
                    value={rental.plate || ""}
                    onChange={(e) => setRental((r) => ({ ...r, plate: e.target.value }))}
                    placeholder="e.g. MT 4B-12345, or the number on the door"
                  />
                </label>
              )}
              <div className="row wrap" style={{ gap: 8 }}>
                <label className="col" style={{ gap: 4, flex: "1 1 160px" }}>
                  <span className="small">Rental company</span>
                  <input
                    id="rental-company"
                    value={rental.company || ""}
                    onChange={(e) => setRental((r) => ({ ...r, company: e.target.value }))}
                    placeholder="Penske, Ryder, U-Haul..."
                  />
                </label>
                <label className="col" style={{ gap: 4, flex: "1 1 160px" }}>
                  <span className="small">Agreement number</span>
                  <input
                    id="rental-agreement"
                    value={rental.agreement_number || ""}
                    onChange={(e) => setRental((r) => ({ ...r, agreement_number: e.target.value }))}
                  />
                </label>
              </div>
              <label className="col" style={{ gap: 4 }}>
                <span className="small">GVWR from the door sticker (lb)</span>
                <input
                  id="rental-gvwr"
                  type="number"
                  inputMode="numeric"
                  value={rental.gvwr_lbs ?? ""}
                  onChange={(e) => setRental((r) => ({ ...r, gvwr_lbs: e.target.value === "" ? null : Number(e.target.value) }))}
                  placeholder="e.g. 25999"
                />
                <span className="small" style={{ color: "var(--muted)" }}>
                  This is the only place the weight rating gets recorded, and it is what
                  decides which rules applied to the trip.
                </span>
              </label>
            </div>
          )}

          {/* Job type. Trip (Local/Long-distance) and the day's tasks
              (Packing/Unpacking/Loading/Unloading/Internal rearrange/Driving) are
              captured by the toggle + "What are you doing today?" above, so
              they're filtered out here to avoid logging the same thing twice -
              this list is the move TYPE (Commercial, Delivery, Storage,
              Labor-only, ...). */}
          <div className="col" style={{ gap: 6 }}>
            <FieldHelp label="Job type" bold />
            <div className="row wrap" style={{ gap: 8 }}>
              {jobTypes.filter((t) => !TRIP_TASK_TAGS.has(t.trim().toLowerCase())).length === 0 && (
                <span className="small" style={{ color: "var(--muted)" }}>No job types configured.</span>
              )}
              {jobTypes.filter((t) => !TRIP_TASK_TAGS.has(t.trim().toLowerCase())).map((t) => {
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
                      color: on ? "var(--on-brand)" : "var(--text)", fontWeight: on ? 700 : 400,
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
              <FieldHelp label="Origin" />
              <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Pickup address (blank OK)" />
            </label>
            {stops.map((s, i) => (
              <div key={i} className="row" style={{ gap: 6, alignItems: "flex-end" }}>
                <label className="col" style={{ gap: 2, flex: 1 }}>
                  <FieldHelp label={`Stop ${i + 1}`} />
                  <input value={s} onChange={(e) => setStops((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} />
                </label>
                <button type="button" onClick={() => setStops((prev) => prev.filter((_, j) => j !== i))} style={{ fontSize: 12, color: "var(--danger)" }}>Remove</button>
              </div>
            ))}
            <button type="button" onClick={() => setStops((prev) => [...prev, ""])} style={{ fontSize: 12, alignSelf: "flex-start" }}>+ Add stop</button>
            <label className="col" style={{ gap: 2 }}>
              <FieldHelp label="Destination" />
              <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Delivery address (blank OK)" />
            </label>
          </div>

          {/* Bill of Lading details - long-distance only. The office fills these
              once here; the crew's BOL starts prefilled with them (blank-only). */}
          {isLD && (
            <div className="col" style={{ gap: 6, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <span className="small" style={{ color: "var(--muted)", fontWeight: 700 }}>Bill of Lading details</span>
              <span className="small" style={{ color: "var(--muted)" }}>
                Fill once; the crew's Bill of Lading for this job starts prefilled with these.
              </span>
              <label className="col" style={{ gap: 2 }}>
                <FieldHelp label="Shipper (customer) name" help={ht.bolShipperNameHelp} />
                <input value={bolHeader.shipper_name || ""} onChange={(e) => setBolField("shipper_name", e.target.value)} />
              </label>
              <div className="row" style={{ gap: 6 }}>
                <label className="col" style={{ gap: 2, flex: 1 }}>
                  <FieldHelp label="Shipper phone" />
                  <input value={bolHeader.shipper_phone || ""} onChange={(e) => setBolField("shipper_phone", e.target.value)} />
                </label>
              </div>
              <label className="col" style={{ gap: 2 }}>
                <FieldHelp label="Shipper address" />
                <input value={bolHeader.shipper_address || ""} onChange={(e) => setBolField("shipper_address", e.target.value)} placeholder="If different from pickup" />
              </label>
              <div className="row" style={{ gap: 6 }}>
                <label className="col" style={{ gap: 2, flex: 1 }}>
                  <FieldHelp label="Agreed pickup" />
                  <input value={bolHeader.agreed_pickup || ""} onChange={(e) => setBolField("agreed_pickup", e.target.value)} placeholder="Date or window" />
                </label>
                <label className="col" style={{ gap: 2, flex: 1 }}>
                  <FieldHelp label="Agreed delivery" />
                  <input value={bolHeader.agreed_delivery || ""} onChange={(e) => setBolField("agreed_delivery", e.target.value)} placeholder="Date or window" />
                </label>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <label className="col" style={{ gap: 2, flex: 1 }}>
                  <FieldHelp label="Form of payment" help={ht.bolFormOfPaymentHelp} />
                  <select value={bolHeader.form_of_payment || ""} onChange={(e) => setBolField("form_of_payment", e.target.value)}>
                    <option value="">Not set</option>
                    {FORM_OF_PAYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="col" style={{ gap: 2, flex: 1 }}>
                  <FieldHelp label="Estimate type" help={ht.bolEstimateTypeHelp} />
                  <select value={bolHeader.estimate_type || ""} onChange={(e) => setBolField("estimate_type", e.target.value)}>
                    <option value="">Not set</option>
                    {ESTIMATE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </div>
              {bolHeader.form_of_payment === "cod" && (
                <div className="row" style={{ gap: 6 }}>
                  <label className="col" style={{ gap: 2, flex: 1 }}>
                    <FieldHelp label="COD - notify" help={ht.bolCodNotifyHelp} />
                    <input value={bolHeader.cod_notify || ""} onChange={(e) => setBolField("cod_notify", e.target.value)} />
                  </label>
                  <label className="col" style={{ gap: 2, flex: 1 }}>
                    <FieldHelp label="COD - max amount" help={ht.bolCodMaxHelp} />
                    <input value={bolHeader.cod_max || ""} onChange={(e) => setBolField("cod_max", e.target.value)} />
                  </label>
                </div>
              )}
              <label className="col" style={{ gap: 2 }}>
                <FieldHelp label="Valuation" help={ht.bolValuationHelp} />
                <select value={bolHeader.valuation || ""} onChange={(e) => setBolField("valuation", e.target.value)}>
                  <option value="">Not set</option>
                  {VALUATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="col" style={{ gap: 2 }}>
                <FieldHelp label="Additional carriers" help={ht.bolAdditionalCarriersHelp} />
                <input value={bolHeader.additional_carriers || ""} onChange={(e) => setBolField("additional_carriers", e.target.value)} placeholder="None" />
              </label>
              <label className="col" style={{ gap: 2 }}>
                <FieldHelp label="Third-party insurance" help={ht.bolThirdPartyInsuranceHelp} />
                <input value={bolHeader.third_party_insurance || ""} onChange={(e) => setBolField("third_party_insurance", e.target.value)} placeholder="N/A" />
              </label>
              <label className="col" style={{ gap: 2 }}>
                <FieldHelp label="Accessorial services" help={ht.bolAccessorialServicesHelp} />
                <input value={bolHeader.accessorial_services || ""} onChange={(e) => setBolField("accessorial_services", e.target.value)} placeholder="None" />
              </label>
            </div>
          )}

          {/* Notes */}
          <label className="col" style={{ gap: 2 }}>
            <FieldHelp label="Notes" />
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
          </label>

          {/* What are you doing today? - the last setup field; it drives the
              timeline tools (labor -> Actions, driving -> RODS). */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <LdPlanTile plan={ldPlan} onToggleActivity={onToggleActivity} showDriving={isLD} storageErr={ldStorageErr} />
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
