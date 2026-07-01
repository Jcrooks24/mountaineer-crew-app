import { useEffect, useState } from "react";
import { hydrateDay, setLdDay } from "../lib/ldDayStore";

/**
 * Long-distance day plan. The crew picks what today is (packing / loading /
 * unloading / unpacking / driving, any combination) + an out-of-town toggle.
 * The plan drives which tools the timeline shows:
 *   - labor selected  -> the normal Actions buttons (Start/Finish/Arrive/Depart/Note)
 *   - driving selected -> the RODS duty recorder (replaces the Actions buttons)
 * Per-diem/drive-day derive from the plan and sync to the server (LdDay),
 * hydrating today's plan cross-device.
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
export type LdPlan = { activities: LdActivity[]; out_of_town: boolean };

function loadPlan(date: string): LdPlan {
  try {
    const raw = localStorage.getItem(PLAN_PREFIX + date);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && Array.isArray(p.activities)) return { activities: p.activities, out_of_town: !!p.out_of_town };
    }
  } catch {}
  return { activities: [], out_of_town: false };
}
function savePlan(date: string, plan: LdPlan) {
  try {
    localStorage.setItem(PLAN_PREFIX + date, JSON.stringify(plan));
  } catch {}
}

export function useLdPlan(date: string) {
  const [plan, setPlan] = useState<LdPlan>(() => loadPlan(date));

  // Cross-device: adopt today's server per-diem/drive-day (drive_day -> Driving).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await hydrateDay(date);
      if (cancelled || !remote) return;
      setPlan((prev) => {
        const acts = new Set(prev.activities);
        if (remote.drive_day) acts.add("driving");
        const merged: LdPlan = { activities: [...acts], out_of_town: prev.out_of_town || !!remote.out_of_town };
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
    setLdDay(date, { drive_day: next.activities.includes("driving"), out_of_town: next.out_of_town });
  }

  return {
    plan,
    driving: plan.activities.includes("driving"),
    laborSelected: plan.activities.filter((a) => a !== "driving"),
    toggleActivity: (a: LdActivity) =>
      persist({
        ...plan,
        activities: plan.activities.includes(a) ? plan.activities.filter((x) => x !== a) : [...plan.activities, a],
      }),
    toggleOutOfTown: () => persist({ ...plan, out_of_town: !plan.out_of_town }),
  };
}

type TileProps = {
  plan: LdPlan;
  onToggleActivity: (a: LdActivity) => void;
  onToggleOutOfTown: () => void;
};

export function LdPlanTile({ plan, onToggleActivity, onToggleOutOfTown }: TileProps) {
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
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginTop: 12, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={plan.out_of_town}
          onChange={onToggleOutOfTown}
          style={{ accentColor: "var(--brand)", width: 18, height: 18, flexShrink: 0 }}
        />
        <span>Out of town today (per-diem $50)</span>
      </label>
      {plan.activities.length === 0 && (
        <div className="small" style={{ color: "var(--muted)", marginTop: 10 }}>Pick at least one to start logging.</div>
      )}
    </div>
  );
}
