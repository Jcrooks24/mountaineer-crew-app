import { useLocation, useNavigate } from "react-router-dom";

/**
 * Persistent crew bottom-nav shell (design system Phase B).
 *
 * ADDITIVE: it does not replace any existing navigation - the per-screen back
 * buttons and the Profile "Tools & Resources" list still work. This is quick
 * access to the four primary field destinations, fixed to the bottom the way a
 * native app puts them, so a crew member never has to find their way home.
 *
 * IA note: the doc's fourth tab was "Active", but in this app the hub (/) IS the
 * active-job view - you select a job and work it inline - so a separate Active
 * tab would just be Jobs again. Docs takes its place (field reference crew reach
 * for on site); the remaining tools live under Profile, as they already do.
 *
 * Self-hides on public/auth screens and on the desktop-first Admin console.
 */

const TABS = [
  { label: "Jobs", path: "/", icon: BriefcaseIcon },
  { label: "DVIR", path: "/dvir", icon: TruckIcon },
  { label: "Docs", path: "/documents", icon: DocIcon },
  { label: "Profile", path: "/profile", icon: PersonIcon },
] as const;

// Routes that get no bottom nav: unauthenticated flows, the mechanic's
// standalone sign page, and the desktop Admin console.
const HIDE_PREFIXES = [
  "/login", "/signup", "/forgot-password", "/reset-password", "/mechanic-sign", "/admin",
];

export default function BottomNav() {
  const loc = useLocation();
  const nav = useNavigate();

  const p = loc.pathname;
  if (HIDE_PREFIXES.some((h) => p === h || p.startsWith(h + "/"))) return null;

  // "/" matches only the hub exactly; the others match their subtree.
  const isActive = (path: string) => (path === "/" ? p === "/" : p === path || p.startsWith(path + "/"));

  return (
    <nav
      aria-label="Primary"
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50,
        display: "flex",
        background: "var(--card)",
        borderTop: "1px solid var(--border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {TABS.map((t) => {
        const on = isActive(t.path);
        const Icon = t.icon;
        const color = on ? "var(--brand)" : "var(--muted)";
        return (
          <button
            key={t.path}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => nav(t.path)}
            style={{
              flex: 1, minHeight: 56,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
              background: "transparent", border: "none", borderRadius: 0,
              cursor: "pointer", color, padding: "6px 0",
            }}
          >
            {/* Active indicator: a short bar above the icon, brand-colored. */}
            <span style={{ width: 24, height: 3, borderRadius: 2, background: on ? "var(--brand)" : "transparent" }} />
            <Icon />
            <span style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: on ? 600 : 400, color, letterSpacing: 0 }}>
              {t.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

// ── Icons: 20px line icons, stroke = currentColor so they take the tab color ──
const svg = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function BriefcaseIcon() {
  return (<svg {...svg}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></svg>);
}
function TruckIcon() {
  return (<svg {...svg}><path d="M2 5h11v10H2z" /><path d="M13 8h4l4 4v3h-8z" /><circle cx="6" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg>);
}
function DocIcon() {
  return (<svg {...svg}><path d="M6 3h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M13 3v5h5" /></svg>);
}
function PersonIcon() {
  return (<svg {...svg}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>);
}
