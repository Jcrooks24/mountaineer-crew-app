import type { ReactNode } from "react";

/**
 * Large tappable action/tool tile (design system). Flat surface, hairline
 * border, brand-tinted icon, background-shift on hover - no gradient/shadow.
 * Reused by the Tools grid and the action-grid hub. >=92px tall for gloved taps.
 */
export function Tile({
  icon, label, sublabel, onClick, badge, disabled,
}: {
  icon: ReactNode;
  label: string;
  sublabel?: string;
  onClick: () => void;
  badge?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        position: "relative",
        display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "space-between",
        gap: 12, minHeight: 92, width: "100%", padding: 14,
        borderRadius: 4, border: "1px solid var(--border)", background: "var(--card)",
        color: "var(--text)", cursor: disabled ? "not-allowed" : "pointer", textAlign: "left",
      }}
    >
      <span style={{ color: "var(--brand)", display: "inline-flex" }}>{icon}</span>
      <span style={{ display: "block" }}>
        <span style={{ display: "block", fontWeight: 600, fontSize: "0.875rem" }}>{label}</span>
        {sublabel && (
          <span className="small" style={{ display: "block", color: "var(--muted)", marginTop: 2 }}>{sublabel}</span>
        )}
      </span>
      {badge}
    </button>
  );
}

/** Responsive grid wrapper for Tiles. */
export function TileGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
      {children}
    </div>
  );
}

// ── Shared 24px line icons (stroke = currentColor) ────────────────────────────
const S = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const TileIcons = {
  truck: () => (<svg {...S}><path d="M2 5h11v10H2z" /><path d="M13 8h4l4 4v3h-8z" /><circle cx="6" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg>),
  doc: () => (<svg {...S}><path d="M6 3h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M13 3v5h5" /></svg>),
  dollar: () => (<svg {...S}><path d="M12 2v20" /><path d="M17 6.5A3.5 3.5 0 0 0 13.5 3h-2A3.5 3.5 0 0 0 8 6.5C8 9 10 9.5 12 10s4 1 4 3.5A3.5 3.5 0 0 1 12.5 17h-2A3.5 3.5 0 0 1 7 13.5" /></svg>),
  calendar: () => (<svg {...S}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>),
  clock: () => (<svg {...S}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>),
  road: () => (<svg {...S}><path d="M6 21 8 3M18 21 16 3" /><path d="M12 5v3M12 11v3M12 17v3" /></svg>),
  gear: () => (<svg {...S}><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>),
  bug: () => (<svg {...S}><rect x="8" y="7" width="8" height="12" rx="4" /><path d="M9 5a3 3 0 0 1 6 0M12 7v12M3 12h5M16 12h5M4 8l4 2M20 8l-4 2M4 17l4-2M20 17l-4-2" /></svg>),
  lightbulb: () => (<svg {...S}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.2V16h6v-.3c0-.8.4-1.6 1-2.2A6 6 0 0 0 12 3z" /></svg>),
};
