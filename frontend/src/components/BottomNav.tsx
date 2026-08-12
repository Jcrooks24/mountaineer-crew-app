import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { getToken } from "../auth/token";
import { hasUnseenPatchNotes } from "../lib/patchNotesSeen";
import { fetchLatestId, getSeenId } from "../lib/bulletin";

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
  { label: "Tools", path: "/tools", icon: GridIcon },
  // DVIR lives in Tools; this slot is the community Bulletin.
  { label: "Bulletin", path: "/bulletin", icon: MegaphoneIcon },
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

  // Whether this nav renders at all. Computed BEFORE the effects on purpose.
  //
  // The early return that used to be the only check sits after them, and hooks
  // run unconditionally - React skips the render, not the effects. So on /login,
  // /signup and the password-reset screens this component was still calling two
  // AUTHENTICATED endpoints: /api/patch-notes once, and /api/bulletin/latest on
  // every navigation. Logged out, both 401.
  //
  // That is not just log noise. `apiFetch` clears the stored token on ANY 401,
  // so a poller firing across a login can wipe a token that was just issued -
  // and crew login is a core invariant (CLAUDE.md). Cheaper and safer not to ask
  // when there is nothing to ask with.
  const hidden = HIDE_PREFIXES.some((h) => p === h || p.startsWith(h + "/"));
  const signedIn = !!getToken();
  const shouldPoll = !hidden && signedIn;

  // "New patch notes" indicator, relocated here from the old top-bar Profile
  // button (that button was redundant with this tab). Fetch the latest note's
  // timestamp once; hasUnseenPatchNotes is re-read every render against the
  // stored seen-time, so the dot clears itself once the crew opens Profile
  // (the Profile page marks notes seen).
  const [latestNote, setLatestNote] = useState<string | null>(null);
  useEffect(() => {
    if (!shouldPoll) return;
    apiFetch<{ id: number; updated_at: string }[]>("/api/patch-notes")
      .then((rows) => setLatestNote(rows[0]?.updated_at ?? null))
      .catch(() => { /* non-fatal - no indicator */ });
  }, [shouldPoll]);
  const patchNotesUnseen = hasUnseenPatchNotes(latestNote);

  // "New bulletin activity" dot: the newest post id vs the last one the crew
  // saw (Bulletin marks it seen on open). Re-checked on each navigation so a new
  // post by someone else lights the dot without a full reload.
  const [latestBulletinId, setLatestBulletinId] = useState(0);
  useEffect(() => {
    if (!shouldPoll) return;
    fetchLatestId().then((r) => setLatestBulletinId(r.latest_id)).catch(() => { /* non-fatal */ });
  }, [p, shouldPoll]);
  const bulletinUnseen = latestBulletinId > getSeenId() && !(p === "/bulletin" || p.startsWith("/bulletin/"));
  if (hidden) return null;

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
              flex: 1, minHeight: 56, position: "relative",
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
            {t.path === "/profile" && patchNotesUnseen && (
              <span
                title="New patch notes"
                style={{
                  position: "absolute", top: 8, right: "calc(50% - 16px)",
                  width: 8, height: 8, borderRadius: "50%",
                  background: "var(--brand)", boxShadow: "0 0 0 2px var(--card)",
                }}
              />
            )}
            {t.path === "/bulletin" && bulletinUnseen && (
              <span
                title="New bulletin activity"
                style={{
                  position: "absolute", top: 8, right: "calc(50% - 16px)",
                  width: 8, height: 8, borderRadius: "50%",
                  background: "var(--brand)", boxShadow: "0 0 0 2px var(--card)",
                }}
              />
            )}
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
function MegaphoneIcon() {
  return (<svg {...svg}><path d="M3 11v2a1 1 0 0 0 1 1h2l9 5V5L6 10H4a1 1 0 0 0-1 1Z" /><path d="M18 8a4 4 0 0 1 0 8" /></svg>);
}
function GridIcon() {
  return (<svg {...svg}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>);
}
function PersonIcon() {
  return (<svg {...svg}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>);
}
