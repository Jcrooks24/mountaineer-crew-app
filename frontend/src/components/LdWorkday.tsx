import { useEffect, useState } from "react";
import RodsRecorder from "./RodsRecorder";
import { hydrateDay, setLdDay, todayLocal } from "../lib/ldDayStore";

/**
 * Long-distance workday. The crew picks what today is (packing / loading /
 * unloading / unpacking / driving); the UI then shows only the matching tools:
 * an hourly clock (start/finish) per selected labor activity - logged like a
 * local move - and/or the RODS duty recorder for a drive day. Keeps the
 * timeline uncluttered: a driving-only day never shows labor buttons, and a
 * pure labor day never shows RODS. Per-diem/drive-day sync to the server
 * (LdDay) from the plan.
 */

type Activity = "packing" | "loading" | "unloading" | "unpacking" | "driving";
const ACTIVITIES: Activity[] = ["packing", "loading", "unloading", "unpacking", "driving"];
const LABEL: Record<Activity, string> = {
  packing: "Packing",
  loading: "Loading",
  unloading: "Unloading",
  unpacking: "Unpacking",
  driving: "Driving",
};
// Billable-labor clock event types per activity (free strings; the bill seed
// sums each start/finish span, so the drive between them isn't billed hourly).
const EVT: Record<Exclude<Activity, "driving">, { start: string; finish: string }> = {
  packing: { start: "PACK_START", finish: "PACK_FINISH" },
  loading: { start: "LOAD_START", finish: "LOAD_FINISH" },
  unloading: { start: "UNLOAD_START", finish: "UNLOAD_FINISH" },
  unpacking: { start: "UNPACK_START", finish: "UNPACK_FINISH" },
};

const PLAN_PREFIX = "crew_ld_plan_v1:";
type Plan = { activities: Activity[]; out_of_town: boolean };

function loadPlan(date: string): Plan {
  try {
    const raw = localStorage.getItem(PLAN_PREFIX + date);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && Array.isArray(p.activities)) return { activities: p.activities, out_of_town: !!p.out_of_town };
    }
  } catch {}
  return { activities: [], out_of_town: false };
}
function savePlan(date: string, plan: Plan) {
  try {
    localStorage.setItem(PLAN_PREFIX + date, JSON.stringify(plan));
  } catch {}
}

type Props = {
  recordEvent: (type: string, note?: string | null) => Promise<void> | void;
  canSend: boolean;
  sendingType: string | null;
};

export default function LdWorkday({ recordEvent, canSend, sendingType }: Props) {
  const date = todayLocal();
  const [plan, setPlan] = useState<Plan>(() => loadPlan(date));

  // Cross-device: adopt today's server per-diem/drive-day so a second device
  // reflects a plan set elsewhere (drive_day -> Driving, out_of_town toggle).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await hydrateDay(date);
      if (cancelled || !remote) return;
      setPlan((prev) => {
        const acts = new Set(prev.activities);
        if (remote.drive_day) acts.add("driving");
        const merged: Plan = { activities: [...acts], out_of_town: prev.out_of_town || !!remote.out_of_town };
        savePlan(date, merged);
        return merged;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persist(next: Plan) {
    savePlan(date, next);
    setPlan(next);
    // Sync the per-diem inputs (out-of-town + drive-day) to the server.
    setLdDay(date, { drive_day: next.activities.includes("driving"), out_of_town: next.out_of_town });
  }
  function toggleActivity(a: Activity) {
    const activities = plan.activities.includes(a)
      ? plan.activities.filter((x) => x !== a)
      : [...plan.activities, a];
    persist({ ...plan, activities });
  }

  const laborSelected = plan.activities.filter((a) => a !== "driving") as Exclude<Activity, "driving">[];
  const driving = plan.activities.includes("driving");

  return (
    <>
      {/* Today's plan */}
      <div className="card">
        <div className="sectionTitle">Today's plan</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
          What are you doing today? The tools below match your selection.
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {ACTIVITIES.map((a) => {
            const on = plan.activities.includes(a);
            return (
              <button key={a} onClick={() => toggleActivity(a)} className={on ? "btnPrimary" : ""} style={{ fontSize: 13 }}>
                {on ? "✓ " : ""}{LABEL[a]}
              </button>
            );
          })}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginTop: 12, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={plan.out_of_town}
            onChange={() => persist({ ...plan, out_of_town: !plan.out_of_town })}
            style={{ accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }}
          />
          <span>Out of town today (per-diem $50)</span>
        </label>
        {plan.activities.length === 0 && (
          <div className="small" style={{ color: "var(--muted)", marginTop: 10 }}>Pick at least one to start logging.</div>
        )}
      </div>

      {/* Hourly labor - clock start/finish per selected activity (like a local move) */}
      {laborSelected.length > 0 && (
        <div className="card">
          <div className="sectionTitle">Hourly labor</div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
            Clock the start and finish of each activity. Drive time is paid separately.
          </div>
          <div className="col" style={{ gap: 10 }}>
            {laborSelected.map((a) => (
              <div key={a} className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                <span className="small" style={{ width: 84, color: "var(--text)" }}>{LABEL[a]}</span>
                <button className="btnPrimary" disabled={!canSend || sendingType !== null} onClick={() => recordEvent(EVT[a].start)}>
                  {sendingType === EVT[a].start ? "..." : "Start"}
                </button>
                <button className="btnPrimary" disabled={!canSend || sendingType !== null} onClick={() => recordEvent(EVT[a].finish)}>
                  {sendingType === EVT[a].finish ? "..." : "Finish"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Driving - RODS duty recorder */}
      {driving && <RodsRecorder />}
    </>
  );
}
