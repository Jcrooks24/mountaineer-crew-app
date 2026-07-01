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

export function LdPlanTile({ plan, onToggleActivity }: { plan: LdPlan; onToggleActivity: (a: LdActivity) => void }) {
  return (
    <div className="card" style={{ borderColor: "var(--brand)" }}>
      <div className="sectionTitle">Today's plan</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
        What are you doing today? The tools below match your selection.
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        {LD_ACTIVITIES.map((a) => {
          const on = plan.activities.includes(a);
          return (
            <button
              key={a}
              onClick={() => onToggleActivity(a)}
              className={on ? "btnPrimary" : ""}
              style={{ fontSize: 13, flex: "1 1 auto", minWidth: 92 }}
            >
              {on ? "✓ " : ""}{LABEL[a]}
            </button>
          );
        })}
      </div>
      {plan.activities.length === 0 && (
        <div className="small" style={{ color: "var(--muted)", marginTop: 10 }}>Pick at least one to start logging.</div>
      )}
    </div>
  );
}
