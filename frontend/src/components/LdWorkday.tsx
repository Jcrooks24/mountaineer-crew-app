import { useEffect, useState } from "react";
import { hydrateDay, setLdDay } from "../lib/ldDayStore";

/**
 * Long-distance day plan. The crew picks what today is (packing / loading /
 * unloading / unpacking / driving, any combination). The plan drives which
 * tools the timeline shows:
 *   - labor selected  -> the normal Actions buttons (Start/Finish/Arrive/Depart/Note)
 *   - driving selected -> the RODS duty recorder (replaces the Actions buttons)
 * "Driving" also sets the day's drive_day flag on the server (LdDay). The
 * out-of-town / per-diem toggle lives on the Report tab (per person).
 *
 * `useLdPlan` owns the state (so App can gate Actions vs RODS); `LdPlanTile`
 * is the presentational prompt.
 */

export type LdActivity = "packing" | "loading" | "unloading" | "unpacking" | "driving";
export const LD_ACTIVITIES: LdActivity[] = ["packing", "loading", "unloading", "unpacking", "driving"];
const LABEL: Record<LdActivity, string> = {
  packing: "Packing",
  loading: "Loading",
  unloading: "Unloading",
  unpacking: "Unpacking",
  driving: "Driving",
};

const PLAN_PREFIX = "crew_ld_plan_v1:";
export type LdPlan = { activities: LdActivity[] };

function loadPlan(date: string): LdPlan {
  try {
    const raw = localStorage.getItem(PLAN_PREFIX + date);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && Array.isArray(p.activities)) return { activities: p.activities };
    }
  } catch {}
  return { activities: [] };
}
function savePlan(date: string, plan: LdPlan) {
  try {
    localStorage.setItem(PLAN_PREFIX + date, JSON.stringify(plan));
  } catch {}
}

export function useLdPlan(date: string) {
  const [plan, setPlan] = useState<LdPlan>(() => loadPlan(date));

  // Cross-device: adopt today's server drive_day (-> Driving selected).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await hydrateDay(date);
      if (cancelled || !remote || !remote.drive_day) return;
      setPlan((prev) => {
        if (prev.activities.includes("driving")) return prev;
        const merged: LdPlan = { activities: [...prev.activities, "driving"] };
        savePlan(date, merged);
        return merged;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  function persist(next: LdPlan) {
    savePlan(date, next);
    setPlan(next);
    // Only the drive_day flag comes from the plan; out_of_town is set on the Report tab.
    setLdDay(date, { drive_day: next.activities.includes("driving") });
  }

  return {
    plan,
    driving: plan.activities.includes("driving"),
    laborSelected: plan.activities.filter((a) => a !== "driving"),
    toggleActivity: (a: LdActivity) =>
      persist({
        activities: plan.activities.includes(a) ? plan.activities.filter((x) => x !== a) : [...plan.activities, a],
      }),
  };
}

// Renders bare (no card wrapper) so it can live inside the Job tile. `showDriving`
// is false on local jobs (Driving = the interstate RODS recorder, LD-only).
export function LdPlanTile({
  plan,
  onToggleActivity,
  showDriving = true,
}: {
  plan: LdPlan;
  onToggleActivity: (a: LdActivity) => void;
  showDriving?: boolean;
}) {
  const shown = LD_ACTIVITIES.filter((a) => showDriving || a !== "driving");
  return (
    <>
      <div data-component="LdPlanTile" style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>What are you doing today?</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
        Pick everything that applies. The timeline tools match your selection.
      </div>
      <div className="col" style={{ gap: 8 }}>
        {shown.map((a) => {
          const on = plan.activities.includes(a);
          return (
            <label key={a} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 }}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggleActivity(a)}
                style={{ accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }}
              />
              <span style={{ fontWeight: on ? 700 : 400, color: on ? "var(--text)" : "var(--muted)" }}>{LABEL[a]}</span>
            </label>
          );
        })}
      </div>
      {showDriving && plan.activities.length === 0 && (
        <div className="small" style={{ color: "var(--muted)", marginTop: 10 }}>Pick at least one to start logging.</div>
      )}
    </>
  );
}
