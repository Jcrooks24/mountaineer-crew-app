import { useEffect, useState } from "react";
import { type LdDay, loadLdDay, setLdDay, syncQueue, todayLocal } from "../lib/ldDayStore";

/** Long-distance "Today" card — the driver marks whether today was out of town
 * ($50/day per-diem) and/or a drive day, for admin payroll. Self-contained;
 * upserts + syncs on toggle. */
export default function LdDayCard() {
  const today = todayLocal();
  const [day, setDay] = useState<LdDay | null>(() => loadLdDay(today));

  useEffect(() => {
    syncQueue();
    const on = () => syncQueue();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, []);

  function toggle(field: "out_of_town" | "drive_day") {
    const next = setLdDay(today, { [field]: !(day?.[field]) });
    setDay(next);
    syncQueue();
  }

  const oot = !!day?.out_of_town;
  const drv = !!day?.drive_day;

  return (
    <div className="card">
      <div className="sectionTitle">Today — {today}</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
        Mark for payroll. Per-diem is $50 for each day out of town; drive days are logged for fixed drive pay.
      </div>
      <div className="row wrap" style={{ gap: 10 }}>
        <button className={oot ? "btnPrimary" : ""} onClick={() => toggle("out_of_town")}>
          {oot ? "✓ Out of town" : "Out of town"}
        </button>
        <button className={drv ? "btnPrimary" : ""} onClick={() => toggle("drive_day")}>
          {drv ? "✓ Drive day" : "Drive day"}
        </button>
      </div>
    </div>
  );
}
