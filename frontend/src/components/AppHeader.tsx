import { useEffect, useState } from "react";

/**
 * Hybrid app header (design system Phase B): a 44px bar with the wordmark, the
 * current screen's name as a subtitle, a back chevron when you're deep in a
 * flow, and a live online/offline indicator on the right. Self-contained online
 * detection so any screen can use it without wiring state.
 *
 * Usage: `<AppHeader title="Reimbursement" onBack={() => nav("/")} />`.
 * Omit onBack for a top-level tab screen (no back affordance).
 */
export default function AppHeader({
  title, onBack, right,
}: {
  title?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  return (
    <header
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        minHeight: 44, padding: "0 4px 0 2px", marginBottom: 12,
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            style={{
              background: "none", border: "none", color: "var(--muted)", cursor: "pointer",
              padding: "8px 6px", display: "inline-flex", alignItems: "center", fontSize: 20, lineHeight: 1,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        )}
        <div style={{ minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>Mountaineer Moving</span>
          {title && <span style={{ color: "var(--muted)", fontSize: "0.875rem" }}> · {title}</span>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {right}
        <span className="statusDot mono" style={{ ["--dot" as any]: online ? "var(--ok)" : "var(--danger)", fontSize: 12 }}>
          {online ? "Online" : "Offline"}
        </span>
      </div>
    </header>
  );
}
