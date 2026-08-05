/**
 * DQ missing-docs reminder (C4.1c). Shows on the hub when the signed-in driver
 * has required DQ documents they have not submitted, with a jump to Profile
 * where they upload them. Silent (renders nothing) when the file is complete or
 * the check can't run (offline / not a driver with a file).
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadMyDqFile } from "../lib/dqStore";

export default function DqReminderBanner() {
  const nav = useNavigate();
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadMyDqFile()
      .then((f) => { if (!cancelled) setMissing(f.missing_required || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (missing.length === 0) return null;

  return (
    <div
      className="card"
      style={{
        borderColor: "var(--warn, #e0a800)",
        background: "color-mix(in srgb, var(--warn, #e0a800) 8%, transparent)",
      }}
    >
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {missing.length} driver document{missing.length === 1 ? "" : "s"} to submit
          </div>
          <div className="small" style={{ color: "var(--muted)" }}>{missing.join(", ")}</div>
        </div>
        <button type="button" className="btnPrimary" onClick={() => nav("/profile#dq")} style={{ flexShrink: 0 }}>
          Submit now
        </button>
      </div>
    </div>
  );
}
