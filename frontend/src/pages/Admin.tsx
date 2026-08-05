import { Children, Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { getToken } from "../auth/token";
import { getCompanyInfoCached, setCompanyInfoCache, type CompanyInfo } from "../lib/companyInfo";
import { useJobTypes } from "../lib/jobTypesStore";

const ADMIN_API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
import { useAuth } from "../auth/AuthContext";
import {
  useTheme,
  THEME_PRESETS,
  FONT_OPTIONS,
  RADIUS_OPTIONS,
  SHADOW_OPTIONS,
  DENSITY_OPTIONS,
  PIN_EVENT_TYPES,
  DEFAULT_PIN_COLORS,
  DEFAULT_HELP_TEXTS,
  loadCustomPresets,
  persistCustomPresets,
  pickStyle,
  styleVars,
  type HelpTexts,
  type CustomPreset,
} from "../theme/ThemeContext";
import SignaturePad, { type SignaturePadHandle } from "../components/SignaturePad";
import EstimatorTab from "../components/EstimatorTab";
import { FURNITURE_CATALOG } from "../data/furnitureCatalog";
import OfficeHoursPanel from "./OfficeHours";
import PayrollTool from "../components/PayrollTool";
import DqFilesTab from "../components/DqFilesTab";
import DqDocTypesCard from "../components/DqDocTypesCard";
import { roundBillableQuarter } from "../components/JobReport";
import {
  formatMountainDate,
  formatMountainDateTime,
  formatMountainTime,
  mountainDateYYYYMMDD,
} from "../lib/time";

type AdminUser = {
  id: number;
  email: string;
  name: string | null;
  phone: string | null;
  role: string;
  is_active: boolean;
  is_skill_rater: boolean;
  tag_ids: number[];
  alias_count: number;
  scheduling_notes: string;
};

type EmployeeTag = {
  id: number;
  name: string;
  sort_order: number;
};

type EmailAlias = {
  id: number;
  email: string;
  created_at: string;
};

type GeoEvent = {
  event_id: string;
  job_uuid: string;
  job_name: string;
  type: string;
  timestamp: string;
  lat: number;
  lng: number;
  note: string | null;
};

type CalStatus = {
  ok: boolean;
  valid?: boolean;
  expired?: boolean;
  expiry?: string;
  has_refresh_token?: boolean;
  error?: string;
};

type Tab = "employees" | "map" | "settings" | "advanced" | "appearance" | "dvir" | "estimator" | "notes" | "summary" | "office" | "incidents" | "payroll" | "dq";

const TAB_TITLES: Record<Tab, string> = {
  map: "Admin Dashboard",
  employees: "Employees",
  dvir: "DVIR Review",
  estimator: "Estimator",
  notes: "Notes",
  summary: "Job Summary",
  office: "Office Hours",
  payroll: "Payroll",
  dq: "DQ Files",
  settings: "Settings",
  advanced: "Advanced Settings",
  appearance: "Theme & Appearance",
  incidents: "Incidents",
};

const DESKTOP_MODE_KEY = "crew_admin_desktop_mode_v1";

export default function Admin() {
  const { user } = useAuth();
  const nav = useNavigate();
  // The Map is the dashboard home; every other tool opens as a sub-view.
  const [tab, setTab] = useState<Tab>("map");

  // Desktop mode widens the outer container so tables, calendars, and
  // wide tools stop being squeezed by the mobile-first 860px cap. Persists
  // in localStorage so admin doesn't have to flip it every page load.
  // crew_* prefix means clearCrewState() will reset it on logout - that's
  // fine; re-toggling is one click on the next login.
  const [desktopMode, setDesktopMode] = useState<boolean>(() => {
    try { return localStorage.getItem(DESKTOP_MODE_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(DESKTOP_MODE_KEY, desktopMode ? "1" : "0"); } catch {}
  }, [desktopMode]);

  useEffect(() => {
    if (user && user.role !== "admin") nav("/", { replace: true });
  }, [user, nav]);

  if (!user || user.role !== "admin") return null;

  const isHome = tab === "map";
  // Settings sub-pages step back to Settings; every other tool to the home.
  const backTo: Tab = tab === "advanced" || tab === "appearance" ? "settings" : "map";
  const backLabel = isHome
    ? "← Back"
    : backTo === "settings"
      ? "← Settings"
      : "← Dashboard";

  return (
    <>
    {/* Admin-only background image (fixed, behind content; overlay keeps cards
        + text readable). */}
    <div
      aria-hidden
      style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        backgroundImage: "linear-gradient(rgba(28,40,52,0.55), rgba(28,40,52,0.55)), url('/admin-bg.jpg')",
        backgroundSize: "cover", backgroundPosition: "center",
      }}
    />
    <div
      className="container"
      style={{ maxWidth: desktopMode ? 1500 : 860, position: "relative", zIndex: 1 }}
    >
      {/* Header - overridden background because the default .topbar 0.03
          alpha vanishes over the admin background image. Text color is
          hard-coded (not --text) because the backdrop is always dark
          regardless of the active theme; on a light theme --text would
          be near-black and disappear. */}
      <div
        className="topbar"
        style={{
          marginBottom: 12,
          background: "rgba(10,16,22,0.78)",
          border: "1px solid rgba(255,255,255,0.20)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 17, color: "#f6f9ff", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
          {TAB_TITLES[tab]}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <DesktopModeToggle on={desktopMode} onChange={setDesktopMode} />
          <button
            onClick={() => (isHome ? nav(-1) : setTab(backTo))}
            style={{
              background: "rgba(255,255,255,0.14)",
              border: "1px solid rgba(255,255,255,0.28)",
              borderRadius: 999,
              color: "#f6f9ff",
              cursor: "pointer",
              fontSize: 13,
              padding: "4px 12px",
              fontWeight: 700,
              textShadow: "0 1px 2px rgba(0,0,0,0.5)",
            }}
          >
            {backLabel}
          </button>
        </div>
      </div>

      {/* Mobile: a persistent horizontal tab nav so admin can jump between
          sections from anywhere (desktop uses the left sidebar below). */}
      {!desktopMode && <AdminMobileNav current={tab} onPick={setTab} />}

      {/* Desktop: persistent left sidebar + content. Mobile: the drill-in
          tool menu (rendered inside the map tab) with a back button. */}
      <div style={desktopMode ? { display: "flex", gap: 16, alignItems: "flex-start" } : undefined}>
        {desktopMode && <AdminSidebar current={tab} onPick={setTab} />}
        <div style={desktopMode ? { flex: 1, minWidth: 0 } : undefined}>
          {tab === "map" && <MapTab />}
          {tab === "employees" && <EmployeesTab />}
          {tab === "dvir" && <DVIRTab />}
          {tab === "estimator" && <EstimatorTab />}
          {tab === "notes" && <NotesTab />}
          {tab === "summary" && <JobSummaryTab />}
          {tab === "office" && <OfficeHoursPanel />}
          {tab === "payroll" && <PayrollTool />}
          {tab === "dq" && <DqFilesTab />}
          {tab === "incidents" && <IncidentsAdminTab />}
          {tab === "settings" && (
            <SettingsTab
              onOpenAdvanced={() => setTab("advanced")}
              onOpenAppearance={() => setTab("appearance")}
            />
          )}
          {tab === "advanced" && <AdvancedSettingsPage />}
          {tab === "appearance" && <ThemeAppearancePage />}
        </div>
      </div>
    </div>
    </>
  );
}

// Compact iOS-style slider that toggles the desktop-vs-mobile container
// width. Sits in the admin topbar. Clicking anywhere on the pill flips
// the state; the brand fill animates between the on/off positions.
function DesktopModeToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={on ? "Switch to mobile sizing" : "Switch to desktop sizing"}
      title={on ? "Desktop sizing - click for mobile" : "Mobile sizing - click for desktop"}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        // Solid card background + brand border so the pill reads over
        // the admin background image (previously transparent + muted
        // border made it disappear into the overlay).
        background: "var(--card)", padding: "4px 10px",
        border: "1px solid var(--brand)", borderRadius: 999,
        cursor: "pointer", fontSize: 11, lineHeight: 1,
        color: "var(--text)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
      }}
    >
      <span style={{ fontWeight: 700 }}>{on ? "Desktop" : "Mobile"}</span>
      <span
        aria-hidden="true"
        style={{
          position: "relative", display: "inline-block",
          width: 26, height: 14,
          background: on ? "var(--brand)" : "var(--border)",
          borderRadius: 999,
          transition: "background 150ms ease",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 1, left: on ? 13 : 1,
            width: 12, height: 12, borderRadius: "50%",
            background: "var(--text)",
            transition: "left 150ms ease",
            boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
          }}
        />
      </span>
    </button>
  );
}

// Admin tabs, shared by the desktop sidebar and the persistent mobile pill nav
// (AdminMobileNav). The Map tab is the home dashboard.
// Desktop admin sidebar: 200px, left-border active nav (design system). Shown
// only in desktopMode; mobile uses the persistent AdminMobileNav pill bar.
const ADMIN_TAB_ITEMS: { tab: Tab; label: string }[] = [
  { tab: "map", label: "Map" },
  { tab: "employees", label: "Employees" },
  { tab: "dvir", label: "DVIR Review" },
  { tab: "estimator", label: "Estimator" },
  { tab: "notes", label: "Patch Notes" },
  { tab: "summary", label: "Job Summary" },
  { tab: "office", label: "Office Hours" },
  { tab: "payroll", label: "Payroll" },
  { tab: "dq", label: "DQ Files" },
  { tab: "incidents", label: "Incidents" },
  { tab: "settings", label: "Settings" },
];

function adminTabActive(current: Tab, t: Tab): boolean {
  return current === t || (t === "settings" && (current === "advanced" || current === "appearance"));
}

// Persistent horizontal nav for the admin console on mobile (desktop uses the
// left sidebar). Without this, mobile admin could only switch tabs by backing
// out to the tool menu each time.
function AdminMobileNav({ current, onPick }: { current: Tab; onPick: (t: Tab) => void }) {
  return (
    <nav
      aria-label="Admin sections"
      style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingBottom: 8, marginBottom: 12 }}
    >
      {ADMIN_TAB_ITEMS.map((t) => {
        const active = adminTabActive(current, t.tab);
        return (
          <button
            key={t.tab}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onPick(t.tab)}
            style={{
              flex: "0 0 auto", padding: "6px 12px", borderRadius: 999, fontSize: 13, whiteSpace: "nowrap", cursor: "pointer",
              border: active ? "1px solid var(--brand)" : "1px solid var(--border)",
              background: active ? "var(--brand)" : "var(--card)",
              color: active ? "var(--on-brand, #fff)" : "var(--text)", fontWeight: active ? 700 : 500,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

function AdminSidebar({ current, onPick }: { current: Tab; onPick: (t: Tab) => void }) {
  const items = ADMIN_TAB_ITEMS;
  return (
    <nav
      style={{
        width: 200, flexShrink: 0, alignSelf: "flex-start",
        background: "var(--card)", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden",
      }}
    >
      {items.map((t) => {
        const active =
          current === t.tab || (t.tab === "settings" && (current === "advanced" || current === "appearance"));
        return (
          <button
            key={t.tab}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onPick(t.tab)}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "10px 14px", fontSize: 14, fontWeight: active ? 600 : 500,
              background: active ? "var(--card2)" : "transparent",
              color: active ? "var(--brand)" : "var(--text)",
              border: "none", borderLeft: active ? "3px solid var(--brand)" : "3px solid transparent",
              borderRadius: 0, cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

type ConvoNote = { at: string; by: string; text: string };
type AdminIncident = {
  id: number; incident_uuid: string; job_uuid: string | null; job_name: string | null;
  incident_date: string | null; reported_by_name: string | null; attributed_crew: string | null;
  severity: string; attributable: string; description: string; est_cost: number | null;
  resolved: boolean; status: string; settled_amount: number | null; conversation_log: ConvoNote[];
  notes: string | null; photo_urls: string[]; created_at: string;
};

const INCIDENT_STATUS_OPTS = [
  { value: "", label: "No status" },
  { value: "pending", label: "Needs action" },
  { value: "resolved", label: "Resolved" },
];

// Admin log of crew-reported incidents. Read + resolve/reopen + edit notes/cost.
function IncidentsAdminTab() {
  const [incidents, setIncidents] = useState<AdminIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "" | "pending" | "resolved">("all");
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({});

  // File-an-incident form (admin can log a billing dispute / claim that no crew
  // member reported through the app).
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const blankNew = { claim_number: "", job_name: "", incident_date: "", severity: "minor", description: "", est_cost: "", attributed_crew: "" };
  const [nc, setNc] = useState({ ...blankNew });

  const reload = useCallback(() => {
    setLoading(true);
    apiFetch<AdminIncident[]>("/api/admin/incidents")
      .then((r) => setIncidents(r))
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function fileIncident() {
    if (!nc.description.trim() && !nc.claim_number.trim()) {
      alert("Add a description or a claim number.");
      return;
    }
    setCreating(true);
    try {
      await apiFetch("/api/incidents", {
        method: "POST",
        body: JSON.stringify({
          incident_uuid: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          claim_number: nc.claim_number.trim() || null,
          job_name: nc.job_name.trim() || null,
          incident_date: nc.incident_date || null,
          severity: nc.severity,
          description: nc.description.trim(),
          est_cost: nc.est_cost ? Number(nc.est_cost) : null,
          attributed_crew: nc.attributed_crew.trim() || null,
        }),
      });
      setNc({ ...blankNew });
      setShowNew(false);
      reload();
    } catch (e: any) {
      alert(e instanceof ApiError ? e.message : "Could not file the incident.");
    } finally {
      setCreating(false);
    }
  }

  async function patch(inc: AdminIncident, body: Record<string, any>) {
    setBusy(inc.id);
    try {
      const updated = await apiFetch<AdminIncident>(`/api/admin/incidents/${inc.id}`, {
        method: "PATCH", body: JSON.stringify(body),
      });
      setIncidents((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e: any) {
      alert(e instanceof ApiError ? e.message : "Failed to update");
    } finally { setBusy(null); }
  }

  async function addNote(inc: AdminIncident) {
    const text = (noteDraft[inc.id] || "").trim();
    if (!text) return;
    await patch(inc, { add_note: text });
    setNoteDraft((prev) => ({ ...prev, [inc.id]: "" }));
  }

  const shown = incidents.filter((i) => filter === "all" || (i.status || "") === filter);
  const pendingCount = incidents.filter((i) => (i.status || "") === "pending").length;
  const noStatusCount = incidents.filter((i) => !(i.status || "")).length;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div className="microLabel" style={{ marginBottom: 0 }}>Incidents</div>
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)} style={{ width: "auto", fontSize: 13, padding: "4px 8px" }}>
          <option value="all">All</option>
          <option value="pending">Needs action</option>
          <option value="">No status</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>
      <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 12 }}>
        {pendingCount} need action · {noStatusCount} unset · {incidents.length} total. Also exported to the Incidents sheet tab.
      </div>

      {/* File a new incident (a billing dispute / claim the office is tracking,
          not something a crew member reported through the app). */}
      {!showNew ? (
        <button type="button" onClick={() => setShowNew(true)} style={{ fontSize: 13, marginBottom: 12 }}>
          + File an incident
        </button>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div className="microLabel" style={{ marginBottom: 10 }}>File an incident</div>
          <div className="row wrap" style={{ gap: 10 }}>
            <label className="col" style={{ gap: 2, flex: "1 1 140px" }}>
              <span className="small" style={{ color: "var(--muted)" }}>Claim number</span>
              <input value={nc.claim_number} onChange={(e) => setNc((v) => ({ ...v, claim_number: e.target.value }))} placeholder="e.g. CLM-1042" />
            </label>
            <label className="col" style={{ gap: 2, flex: "1 1 160px" }}>
              <span className="small" style={{ color: "var(--muted)" }}>Job / customer</span>
              <input value={nc.job_name} onChange={(e) => setNc((v) => ({ ...v, job_name: e.target.value }))} placeholder="Customer or job name" />
            </label>
            <label className="col" style={{ gap: 2, width: 150 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Date</span>
              <input type="date" value={nc.incident_date} onChange={(e) => setNc((v) => ({ ...v, incident_date: e.target.value }))} />
            </label>
            <label className="col" style={{ gap: 2, width: 130 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Severity</span>
              <select value={nc.severity} onChange={(e) => setNc((v) => ({ ...v, severity: e.target.value }))} style={{ fontSize: 13 }}>
                <option value="minor">Minor</option>
                <option value="moderate">Moderate</option>
                <option value="major">Major</option>
              </select>
            </label>
            <label className="col" style={{ gap: 2, width: 120 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Est. cost ($)</span>
              <input inputMode="decimal" value={nc.est_cost} onChange={(e) => setNc((v) => ({ ...v, est_cost: e.target.value }))} placeholder="0" />
            </label>
            <label className="col" style={{ gap: 2, flex: "1 1 160px" }}>
              <span className="small" style={{ color: "var(--muted)" }}>Attributed crew (optional)</span>
              <input value={nc.attributed_crew} onChange={(e) => setNc((v) => ({ ...v, attributed_crew: e.target.value }))} placeholder="Name(s)" />
            </label>
          </div>
          <label className="col" style={{ gap: 2, marginTop: 10 }}>
            <span className="small" style={{ color: "var(--muted)" }}>What happened</span>
            <textarea rows={3} value={nc.description} onChange={(e) => setNc((v) => ({ ...v, description: e.target.value }))} placeholder="Details of the dispute / claim / damage" style={{ width: "100%", resize: "vertical" }} />
          </label>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button type="button" className="btnPrimary" onClick={fileIncident} disabled={creating} style={{ fontSize: 13 }}>
              {creating ? "Filing…" : "File incident"}
            </button>
            <button type="button" onClick={() => { setShowNew(false); setNc({ ...blankNew }); }} disabled={creating} style={{ fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
      ) : err ? (
        <div className="small" style={{ color: "var(--danger)" }}>{err}</div>
      ) : shown.length === 0 ? (
        <div className="small" style={{ color: "var(--muted)" }}>No incidents.</div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {shown.map((inc) => {
            const color = inc.severity === "major" ? "var(--danger)" : inc.severity === "moderate" ? "var(--warn)" : "var(--ok)";
            const st = inc.status || "";
            const statusColor = st === "resolved" ? "var(--ok)" : st === "pending" ? "var(--warn)" : "var(--muted)";
            return (
              <div key={inc.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, opacity: st === "resolved" ? 0.7 : 1 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color }}>{inc.severity}</span>
                    <span className="statusDot" style={{ ["--dot" as any]: statusColor, fontSize: 11 }}>
                      {INCIDENT_STATUS_OPTS.find((o) => o.value === st)?.label || "No status"}
                    </span>
                  </div>
                  <span className="small" style={{ color: "var(--muted)" }}>{inc.incident_date || inc.created_at.slice(0, 10)}</span>
                </div>
                <div style={{ fontSize: 14, marginTop: 4 }}>{inc.description}</div>
                <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
                  {[
                    inc.job_name ? `Job: ${inc.job_name}` : null,
                    inc.attributed_crew ? `Attributed: ${inc.attributed_crew}` : null,
                    `Attributable: ${inc.attributable}`,
                    inc.est_cost != null ? `Est. $${inc.est_cost.toLocaleString()}` : null,
                    inc.settled_amount != null ? `Settled $${inc.settled_amount.toLocaleString()}` : null,
                    inc.reported_by_name ? `by ${inc.reported_by_name}` : null,
                  ].filter(Boolean).join(" · ")}
                </div>
                {inc.notes && <div className="small" style={{ marginTop: 4 }}>Notes: {inc.notes}</div>}

                <div className="row wrap" style={{ gap: 10, marginTop: 10, alignItems: "center" }}>
                  <label className="row small" style={{ gap: 4, alignItems: "center" }}>
                    <span style={{ color: "var(--muted)" }}>Status</span>
                    <select value={st} disabled={busy === inc.id} onChange={(e) => patch(inc, { status: e.target.value })}
                      style={{ width: "auto", fontSize: 13, padding: "4px 8px" }}>
                      {INCIDENT_STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                  <label className="row small" style={{ gap: 4, alignItems: "center" }}>
                    <span style={{ color: "var(--muted)" }}>Settled $</span>
                    <input
                      type="number" defaultValue={inc.settled_amount ?? ""} placeholder="0" disabled={busy === inc.id}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        const n = v === "" ? null : Number(v);
                        if (n !== (inc.settled_amount ?? null)) patch(inc, { settled_amount: n });
                      }}
                      style={{ width: 96, fontSize: 13, padding: "4px 8px" }}
                    />
                  </label>
                </div>

                {inc.conversation_log.length > 0 && (
                  <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                    <div className="microLabel" style={{ marginBottom: 6 }}>Conversation notes</div>
                    <div className="col" style={{ gap: 6 }}>
                      {inc.conversation_log.map((c, ci) => (
                        <div key={ci} className="small">
                          <span style={{ color: "var(--muted)" }}>
                            {c.at ? new Date(c.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                            {c.by ? ` · ${c.by}` : ""}:
                          </span>{" "}
                          {c.text}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="row" style={{ gap: 6, marginTop: 8, alignItems: "center" }}>
                  <input
                    value={noteDraft[inc.id] ?? ""}
                    onChange={(e) => setNoteDraft((prev) => ({ ...prev, [inc.id]: e.target.value }))}
                    placeholder="Add a conversation / resolution note…"
                    disabled={busy === inc.id}
                    onKeyDown={(e) => { if (e.key === "Enter") addNote(inc); }}
                    style={{ flex: "1 1 auto", fontSize: 13, padding: "6px 8px" }}
                  />
                  <button disabled={busy === inc.id || !(noteDraft[inc.id] || "").trim()} onClick={() => addNote(inc)} style={{ fontSize: 12, padding: "4px 12px" }}>
                    Add note
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Employees tab
// ─────────────────────────────────────────
function EmployeesTab() {
  const nav = useNavigate();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tags, setTags] = useState<EmployeeTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [editingTagsFor, setEditingTagsFor] = useState<AdminUser | null>(null);
  const [editingUnlocksFor, setEditingUnlocksFor] = useState<AdminUser | null>(null);
  const [editingAliasesFor, setEditingAliasesFor] = useState<AdminUser | null>(null);
  const [editingSkillsFor, setEditingSkillsFor] = useState<AdminUser | null>(null);
  const [subview, setSubview] = useState<"roster" | "month">("roster");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<AdminUser[]>("/api/admin/users"),
      apiFetch<EmployeeTag[]>("/api/admin/employee-tags"),
    ])
      .then(([u, t]) => {
        if (cancelled) return;
        setUsers(u);
        setTags(t);
      })
      .catch((e) => { if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function toggleAccess(u: AdminUser) {
    setBusy(u.id);
    try {
      const updated = await apiFetch<AdminUser>(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !u.is_active }),
      });
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e: any) {
      alert(e instanceof ApiError ? e.message : "Failed to update");
    } finally {
      setBusy(null);
    }
  }

  async function setRole(u: AdminUser, newRole: string) {
    if (newRole === (u.role || "user")) return;
    const label = newRole === "crew_lead" ? "crew lead" : newRole;
    if (!confirm(`Make ${u.email} a ${label}?`)) return;
    setBusy(u.id);
    try {
      const updated = await apiFetch<AdminUser>(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e: any) {
      alert(e instanceof ApiError ? e.message : "Failed to update");
    } finally {
      setBusy(null);
    }
  }

  async function toggleSkillRater(u: AdminUser) {
    setBusy(u.id);
    try {
      const updated = await apiFetch<AdminUser>(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_skill_rater: !u.is_skill_rater }),
      });
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e: any) {
      alert(e instanceof ApiError ? e.message : "Failed to update");
    } finally {
      setBusy(null);
    }
  }

  async function editPhone(u: AdminUser) {
    const next = window.prompt(`Contact phone for ${u.name || u.email}:`, u.phone || "");
    if (next === null) return;
    setBusy(u.id);
    try {
      const updated = await apiFetch<AdminUser>(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ phone: next.trim() }),
      });
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e: any) {
      alert(e instanceof ApiError ? e.message : "Failed to update");
    } finally {
      setBusy(null);
    }
  }

  async function saveUserTags(userId: number, tagIds: number[]) {
    const updated = await apiFetch<number[]>(`/api/admin/users/${userId}/employee-tags`, {
      method: "PUT",
      body: JSON.stringify({ tag_ids: tagIds }),
    });
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, tag_ids: updated } : u)));
  }

  const tagsById = useMemo(() => {
    const m = new Map<number, EmployeeTag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  if (loading) return <div className="card small">Loading...</div>;
  if (err) return <div className="card" style={{ color: "var(--danger)" }}>{err}</div>;

  return (
    <>
      {/* Roster vs. month-wide schedule view. The roster is the default
          since most admin tasks (tags, unlocks, aliases, role/access)
          live there; the month view is a wholistic grid where tapping a
          cell cycles that day's availability inline. */}
      <div className="card" style={{ padding: 6 }}>
        <div className="row" style={{ gap: 6 }}>
          {(["roster", "month"] as const).map((v) => {
            const active = subview === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setSubview(v)}
                style={{
                  flex: 1, padding: "8px 10px", borderRadius: 8,
                  background: active ? "var(--brand)" : "transparent",
                  color: active ? "var(--on-brand)" : "var(--text)",
                  border: active ? "1px solid var(--brand)" : "1px solid var(--border)",
                  fontWeight: 700, fontSize: 13,
                }}
              >
                {v === "roster" ? "Roster" : "Month view"}
              </button>
            );
          })}
        </div>
      </div>

      {subview === "month" && <MonthScheduleView users={users} tags={tags} />}
      {subview === "roster" && (
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {/* Clean, consistent ghost-pill action buttons. */}
        <style>{`
          .roster-btn { font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--text); cursor: pointer; transition: background .12s, border-color .12s; }
          .roster-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--brand) 10%, transparent); border-color: var(--brand); }
          .roster-btn:disabled { opacity: .45; cursor: default; }
          .roster-btn.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, transparent); }
          .roster-btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 12%, transparent); border-color: var(--danger); }
          .roster-btn.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 35%, transparent); }
          .roster-btn.ok:hover:not(:disabled) { background: color-mix(in srgb, var(--ok) 12%, transparent); border-color: var(--ok); }
          /* Phase C data-table: row hover is a background shift only (no border/scale/shadow). */
          .roster-table tbody tr:hover { background: var(--card2); }
        `}</style>
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table className="roster-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--card2)" }}>
              {["Name", "Contacts", "Role", "Status", "Tags", "Actions"].map((h) => (
                <th key={h} className="mono" style={{ padding: "8px 14px", textAlign: "left", color: "var(--muted)", fontWeight: 600, fontSize: 11, letterSpacing: "0.03em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => (
              <tr
                key={u.id}
                style={{
                  borderBottom: i < users.length - 1 ? "1px solid var(--border)" : "none",
                  opacity: u.is_active ? 1 : 0.45,
                }}
              >
                <td style={{ padding: "10px 14px" }}>{u.name || <span style={{ color: "var(--muted)" }}>-</span>}</td>
                <td style={{ padding: "10px 14px" }}>
                  {/* Contacts: email + phone as compact clickable pills so the
                      roster reads as one "Contacts" column instead of two rows. */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                    <a
                      href={`mailto:${u.email}`}
                      title={u.email}
                      style={{
                        fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                        border: "1px solid var(--border)", color: "var(--text)", textDecoration: "none",
                        maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      ✉ {u.email}
                    </a>
                    {u.phone && (
                      <a
                        href={`tel:${u.phone}`}
                        title={u.phone}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                          border: "1px solid var(--border)", color: "var(--text)", textDecoration: "none",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ☎ {u.phone}
                      </a>
                    )}
                  </div>
                </td>
                <td style={{ padding: "10px 14px", textTransform: "capitalize" }}>{u.role === "crew_lead" ? "Crew lead" : u.role}</td>
                <td style={{ padding: "10px 14px" }}>
                  <span className="statusDot" style={{ ["--dot" as any]: u.is_active ? "var(--ok)" : "var(--danger)", fontSize: 12 }}>
                    {u.is_active ? "Active" : "Disabled"}
                  </span>
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                    {u.tag_ids.length === 0 ? (
                      <span className="small" style={{ color: "var(--muted)" }}>-</span>
                    ) : (
                      u.tag_ids
                        .map((tid) => tagsById.get(tid))
                        .filter((t): t is EmployeeTag => !!t)
                        .sort((a, b) => a.sort_order - b.sort_order)
                        .map((t) => (
                          <span
                            key={t.id}
                            style={{
                              fontSize: 11, fontWeight: 700,
                              padding: "2px 8px", borderRadius: 999,
                              // Theme-text label keeps tags legible on light themes.
                              background: "var(--tag-bg, color-mix(in srgb, var(--brand) 16%, transparent))",
                              color: "var(--text)",
                              border: "1px solid var(--brand)",
                            }}
                          >
                            {t.name}
                          </span>
                        ))
                    )}
                    <button
                      onClick={() => {
                        setEditingTagsFor(u);
                        // Refetch the tag list - admin may have added or
                        // renamed tags in Settings since this page mounted.
                        // Failure is silent; we fall back to the cached list.
                        apiFetch<EmployeeTag[]>("/api/admin/employee-tags")
                          .then(setTags)
                          .catch(() => {});
                      }}
                      style={{
                        fontSize: 11, padding: "2px 8px", borderRadius: 999,
                        background: "none", color: "var(--muted)",
                        border: "1px dashed var(--border)", cursor: "pointer",
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      className={`roster-btn ${u.is_active ? "danger" : "ok"}`}
                      disabled={busy === u.id}
                      onClick={() => toggleAccess(u)}
                    >
                      {u.is_active ? "Revoke" : "Restore"}
                    </button>
                    <select
                      className="roster-btn"
                      disabled={busy === u.id}
                      value={u.role || "user"}
                      onChange={(e) => setRole(u, e.target.value)}
                      title="Set this person's role"
                    >
                      <option value="user">Crew</option>
                      <option value="crew_lead">Crew lead</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      className={`roster-btn ${u.is_skill_rater ? "ok" : ""}`}
                      disabled={busy === u.id}
                      onClick={() => toggleSkillRater(u)}
                      title="Allow this person to set the job type and fill out per-employee skill ratings on the Job Report. This is the only way to grant it apart from being an admin: the Crew lead role does NOT include skill rating, so designate each rater here."
                    >
                      {u.is_skill_rater ? "Skill rater ✓" : "Skill rater"}
                    </button>
                    <button
                      className="roster-btn"
                      onClick={() => setEditingUnlocksFor(u)}
                      title="Unlock an availability window for this user"
                    >
                      Unlocks
                    </button>
                    <button
                      className="roster-btn"
                      onClick={() => setEditingAliasesFor(u)}
                      title="Manage alternate email addresses for Crew Resources matching"
                    >
                      Emails{u.alias_count > 0 ? ` (${u.alias_count})` : ""}
                    </button>
                    <button
                      className="roster-btn"
                      disabled={busy === u.id}
                      onClick={() => editPhone(u)}
                      title="Set the contact phone shown on the scheduling header"
                    >
                      Phone
                    </button>
                    <button
                      className="roster-btn"
                      onClick={() => setEditingSkillsFor(u)}
                      title="Set this employee's skill levels (0-5 matrix)"
                    >
                      Skills
                    </button>
                    <button
                      className="roster-btn"
                      onClick={() => nav(`/availability?admin_user=${u.id}`)}
                      title="Open this employee's availability (admin view)"
                    >
                      Availability
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      )}

      {editingTagsFor && (
        <EmployeeTagsPicker
          user={editingTagsFor}
          allTags={tags}
          onCancel={() => setEditingTagsFor(null)}
          onSave={async (tagIds) => {
            await saveUserTags(editingTagsFor.id, tagIds);
            setEditingTagsFor(null);
          }}
        />
      )}
      {editingSkillsFor && (
        <SkillMatrixPicker
          user={editingSkillsFor}
          onClose={() => setEditingSkillsFor(null)}
        />
      )}
      {editingUnlocksFor && (
        <AvailabilityUnlocksPicker
          user={editingUnlocksFor}
          onClose={() => setEditingUnlocksFor(null)}
        />
      )}
      {editingAliasesFor && (
        <EmailAliasesPicker
          user={editingAliasesFor}
          onClose={() => {
            setEditingAliasesFor(null);
            // Re-fetch the user list - primary email may have changed via
            // promote-to-primary, and alias_count almost certainly did.
            apiFetch<AdminUser[]>("/api/admin/users")
              .then(setUsers)
              .catch(() => {});
          }}
        />
      )}
    </>
  );
}

// Admin modal for setting an employee's 0-5 skill levels (the roster matrix).
function SkillMatrixPicker({
  user,
  onClose,
}: {
  user: AdminUser;
  onClose: () => void;
}) {
  const [skills, setSkills] = useState<AdminSkill[]>([]);
  const [levels, setLevels] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<AdminSkill[]>("/api/admin/skills"),
      apiFetch<{ skill_id: number; level: number }[]>(`/api/admin/users/${user.id}/skills`),
    ])
      .then(([s, ls]) => {
        if (cancelled) return;
        setSkills(s.filter((x) => x.active));
        const m: Record<number, number> = {};
        for (const l of ls) m[l.skill_id] = l.level;
        setLevels(m);
      })
      .catch((e) => { if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user.id]);

  function setLevel(skillId: number, level: number) {
    setLevels((prev) => ({ ...prev, [skillId]: level }));
  }

  async function save() {
    setBusy(true); setErr(null);
    try {
      await apiFetch(`/api/admin/users/${user.id}/skills`, {
        method: "PUT",
        body: JSON.stringify({ skills: Object.entries(levels).map(([id, lvl]) => ({ skill_id: Number(id), level: lvl })) }),
      });
      onClose();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to save");
    } finally { setBusy(false); }
  }

  const byCategory = skills.reduce<Record<string, AdminSkill[]>>((acc, s) => {
    (acc[s.category || "Other"] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ maxWidth: 520, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div className="microLabel" style={{ marginBottom: 10 }}>Skills - {user.name || user.email}</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
          0 = none/very poor · 5 = mastery · blank (0) = not yet assessed.
        </div>

        {loading ? (
          <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
        ) : (
          <div className="col" style={{ gap: 12 }}>
            {Object.entries(byCategory).map(([cat, list]) => (
              <div key={cat}>
                <div className="small" style={{ color: "var(--brand)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{cat}</div>
                <div className="col" style={{ gap: 8 }}>
                  {list.map((s) => {
                    const lvl = levels[s.id] ?? 0;
                    return (
                      <div key={s.id} className="row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 13, flex: 1 }}>{s.name}</span>
                        {s.binary ? (
                          <div className="row" style={{ gap: 4 }}>
                            {[0, 5].map((v) => (
                              <button key={v} type="button" onClick={() => setLevel(s.id, v)}
                                style={{ padding: "4px 10px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                                  border: lvl === v ? "2px solid var(--brand)" : "1px solid var(--border)",
                                  background: lvl === v ? "color-mix(in srgb, var(--brand) 18%, transparent)" : "transparent",
                                  color: lvl === v ? "var(--brand)" : "var(--muted)" }}>
                                {v === 0 ? "No" : "Yes"}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="row" style={{ gap: 3 }}>
                            {[0, 1, 2, 3, 4, 5].map((v) => (
                              <button key={v} type="button" onClick={() => setLevel(s.id, v)}
                                style={{ width: 28, height: 28, borderRadius: 6, fontSize: 12, cursor: "pointer",
                                  border: lvl === v ? "2px solid var(--brand)" : "1px solid var(--border)",
                                  background: lvl === v ? "color-mix(in srgb, var(--brand) 18%, transparent)" : "transparent",
                                  color: lvl === v ? "var(--brand)" : "var(--muted)", fontWeight: lvl === v ? 700 : 400 }}>
                                {v}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {skills.length === 0 && (
              <div className="small" style={{ color: "var(--muted)" }}>No active skills. Add some in Settings → Crew Skills.</div>
            )}
          </div>
        )}

        {err && <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <button className="btnPrimary" onClick={save} disabled={busy || loading}>{busy ? "Saving…" : "Save"}</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// Admin modal for managing a crew member's email addresses. Primary lives
// on users.email; aliases live in user_email_aliases. Promote-to-primary
// swaps an alias with the current primary in a single backend transaction.
function EmailAliasesPicker({
  user,
  onClose,
}: {
  user: AdminUser;
  onClose: () => void;
}) {
  const [aliases, setAliases] = useState<EmailAlias[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Local mutable copy of the primary email so we can update the badge
  // immediately after a promote without waiting for the parent re-fetch.
  const [primaryEmail, setPrimaryEmail] = useState(user.email);

  function load() {
    setLoading(true);
    apiFetch<EmailAlias[]>(`/api/admin/users/${user.id}/email-aliases`)
      .then(setAliases)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Failed to load aliases"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function addAlias() {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setBusy(true);
    setErr(null);
    try {
      const created = await apiFetch<EmailAlias>(
        `/api/admin/users/${user.id}/email-aliases`,
        { method: "POST", body: JSON.stringify({ email }) },
      );
      setAliases((prev) => [...prev, created]);
      setNewEmail("");
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to add alias");
    } finally {
      setBusy(false);
    }
  }

  async function removeAlias(id: number) {
    if (!confirm("Remove this alias? Crew Resources will no longer match invites sent to it.")) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/api/admin/users/${user.id}/email-aliases/${id}`, { method: "DELETE" });
      setAliases((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to remove");
    } finally {
      setBusy(false);
    }
  }

  async function promote(alias: EmailAlias) {
    if (!confirm(
      `Make "${alias.email}" the primary email for ${user.name || user.email}? `
      + "Their current primary will become an alias. This affects login and password-reset emails."
    )) return;
    setBusy(true);
    setErr(null);
    try {
      const newAliasForOldPrimary = await apiFetch<EmailAlias>(
        `/api/admin/users/${user.id}/email-aliases/${alias.id}/promote`,
        { method: "POST" },
      );
      // Reflect locally: the promoted alias is gone from the list (it's
      // now the primary), and the old primary appears as a new alias.
      const promotedEmail = alias.email;
      setAliases((prev) => [
        ...prev.filter((a) => a.id !== alias.id),
        newAliasForOldPrimary,
      ]);
      setPrimaryEmail(promotedEmail);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to promote");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, padding: 16, zIndex: 1000,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card)", borderRadius: 12,
          border: "1px solid var(--border)",
          maxWidth: 480, width: "100%",
          padding: 18, display: "flex", flexDirection: "column", gap: 14,
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 800 }}>
          Email addresses for {user.name || primaryEmail}
        </div>
        <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
          Crew Resources matches Google Calendar invitees by email. Add an
          alias here so a job event invited to a personal address still
          maps back to this crew member.
        </div>

        <div className="col" style={{ gap: 6 }}>
          <div
            className="row"
            style={{
              alignItems: "center", gap: 8,
              padding: "8px 10px", borderRadius: 8,
              border: "1px solid var(--brand)",
              background: "color-mix(in srgb, var(--brand) 8%, transparent)",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{primaryEmail}</span>
            <span
              className="small"
              style={{
                padding: "2px 8px", borderRadius: 999,
                background: "var(--brand)", color: "var(--on-brand)",
                fontWeight: 700,
              }}
            >
              Primary
            </span>
          </div>

          {loading ? (
            <div className="small" style={{ color: "var(--muted)" }}>Loading aliases…</div>
          ) : aliases.length === 0 ? (
            <div className="small" style={{ color: "var(--muted)", padding: "4px 2px" }}>
              No aliases yet.
            </div>
          ) : (
            aliases.map((a) => (
              <div
                key={a.id}
                className="row"
                style={{
                  alignItems: "center", gap: 8,
                  padding: "8px 10px", borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{a.email}</span>
                <button
                  type="button"
                  onClick={() => promote(a)}
                  disabled={busy}
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  title="Make this the user's primary email; the current primary becomes an alias."
                >
                  Make primary
                </button>
                <button
                  type="button"
                  onClick={() => removeAlias(a.id)}
                  disabled={busy}
                  style={{
                    fontSize: 12, padding: "4px 10px",
                    background: "none", color: "var(--danger)",
                    border: "1px solid var(--danger)",
                  }}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        <div className="col" style={{ gap: 8 }}>
          <label className="label">Add alias</label>
          <div className="row" style={{ gap: 8 }}>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addAlias(); }}
              placeholder="e.g. personal@gmail.com"
              style={{ flex: 1, padding: "6px 10px", fontSize: 13 }}
            />
            <button
              type="button"
              onClick={addAlias}
              disabled={busy || !newEmail.trim()}
              className="btnPrimary"
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              Add
            </button>
          </div>
        </div>

        {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}

        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              color: "var(--muted)",
              border: "1px solid var(--border)",
              padding: "8px 14px", fontSize: 13,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Admin modal for granting / revoking availability-window unlocks. Each
// (user, window_start) pair can hold at most one unlock - the POST is
// idempotent so re-granting just refreshes the note + granted_by stamp.
type AdminAvailabilityUnlock = {
  id: number;
  window_start: string;
  granted_by_name: string;
  granted_at: string;
  note: string | null;
};

function AvailabilityUnlocksPicker({
  user,
  onClose,
}: {
  user: AdminUser;
  onClose: () => void;
}) {
  const [unlocks, setUnlocks] = useState<AdminAvailabilityUnlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [windowStart, setWindowStart] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    setLoading(true);
    apiFetch<AdminAvailabilityUnlock[]>(`/api/admin/availability-unlocks?user_id=${user.id}`)
      .then((rows) => setUnlocks(rows))
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function grant() {
    if (!windowStart) return;
    setBusy(true);
    setErr(null);
    try {
      const created = await apiFetch<AdminAvailabilityUnlock>("/api/admin/availability-unlocks", {
        method: "POST",
        body: JSON.stringify({ user_id: user.id, window_start: windowStart, note: note.trim() || null }),
      });
      // Replace any existing row for the same window_start so the
      // displayed list stays unique on (user, window).
      setUnlocks((prev) => [
        created,
        ...prev.filter((u) => u.window_start !== created.window_start),
      ]);
      setWindowStart("");
      setNote("");
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to grant unlock");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: number) {
    if (!confirm("Revoke this unlock? The crew member will no longer be able to edit that window.")) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/api/admin/availability-unlocks/${id}`, { method: "DELETE" });
      setUnlocks((prev) => prev.filter((u) => u.id !== id));
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to revoke");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, padding: 16, zIndex: 1000,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card)", borderRadius: 12,
          border: "1px solid var(--border)",
          maxWidth: 480, width: "100%",
          padding: 18, display: "flex", flexDirection: "column", gap: 14,
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 800 }}>
          Availability unlocks for {user.name || user.email}
        </div>
        <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
          Granting an unlock lets the crew member edit one locked 14-day
          window starting on the date below. The unlock persists until you
          revoke it - recommend revoking once the crew member submits.
        </div>

        <div className="col" style={{ gap: 8 }}>
          <label className="label">Window start (first day of the 2-week block)</label>
          <input
            type="date"
            value={windowStart}
            onChange={(e) => setWindowStart(e.target.value)}
          />
          <label className="label">Reason (optional)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder='e.g. "approved time-off rescheduling per phone call"'
          />
          <button
            type="button"
            className="btnPrimary"
            disabled={busy || !windowStart}
            onClick={grant}
            style={{ alignSelf: "flex-start", padding: "8px 14px" }}
          >
            {busy ? "Granting…" : "Grant unlock"}
          </button>
        </div>

        <div style={{ height: 1, background: "var(--border)" }} />

        <div className="microLabel" style={{ marginBottom: 0 }}>Existing unlocks</div>
        {loading ? (
          <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
        ) : unlocks.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>None.</div>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            {unlocks.map((u) => (
              <div
                key={u.id}
                className="row"
                style={{
                  gap: 8, alignItems: "flex-start", justifyContent: "space-between",
                  padding: "8px 10px", borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              >
                <div className="col" style={{ gap: 2, flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{u.window_start}</span>
                  <span className="small" style={{ color: "var(--muted)" }}>
                    Granted by {u.granted_by_name} on {new Date(u.granted_at).toLocaleString()}
                  </span>
                  {u.note && (
                    <span className="small" style={{ color: "var(--muted)" }}>"{u.note}"</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => revoke(u.id)}
                  disabled={busy}
                  style={{
                    fontSize: 12, padding: "4px 10px",
                    background: "none", color: "var(--danger)",
                    border: "1px solid var(--danger)",
                  }}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}

        {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}

        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              color: "var(--muted)",
              border: "1px solid var(--border)",
              padding: "8px 14px", fontSize: 13,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Month-wide availability matrix nested under the Employees tab. Cells are
// editable: tapping one cycles that day's status (admin upsert, lock-bypassing).
// Days down, active employees across, status-colored cells. Month navigation
// arrows mirror Google Calendar's month picker. Employees with no submitted
// record for a given day render as a blank cell so admin can spot gaps.

type AvailabilityRangeRow = {
  user_id: number;
  day: string;
  status: "available" | "unavailable" | "conditional";
  note: string | null;
  window_start: string;
};

type ScheduledJobRow = {
  user_id: number;
  day: string;
  title: string;
};

type AvailabilityRangeResponse = {
  days: AvailabilityRangeRow[];
  scheduled: ScheduledJobRow[];
};

type StatusColor = { bg: string; fg: string; label: string };
type MonthStatusPalette = Record<AvailabilityRangeRow["status"], StatusColor>;
type MonthScheduledPalette = { bg: string; fg: string; label: string };

const MONTH_STATUS_COLORS: MonthStatusPalette = {
  available:   { bg: "color-mix(in srgb, var(--ok) 18%, transparent)",  fg: "var(--ok)",     label: "Available" },
  unavailable: { bg: "color-mix(in srgb, var(--danger) 18%, transparent)", fg: "var(--danger)", label: "Unavailable" },
  conditional: { bg: "var(--warn-bg)",         fg: "var(--warn)",   label: "Conditional" },
};

const SCHEDULED_COLORS: MonthScheduledPalette = { bg: "var(--scheduled-bg)", fg: "var(--scheduled)", label: "Scheduled" };

// High-contrast palette: saturated Google-workspace fills (matches the
// spreadsheet colors the business partner uses). Cell text stays legible
// on every bg so job titles print cleanly on the Scheduled cells.
const HC_MONTH_STATUS_COLORS: MonthStatusPalette = {
  available:   { bg: "#34a853", fg: "#ffffff", label: "Available" },
  unavailable: { bg: "#ea4335", fg: "#ffffff", label: "Unavailable" },
  conditional: { bg: "#fbbc04", fg: "#111111", label: "Conditional" },
};

const HC_SCHEDULED_COLORS: MonthScheduledPalette = { bg: "#4285f4", fg: "#ffffff", label: "Scheduled" };

const HC_MONTH_KEY = "crew_admin_hc_month_v1";

// Local-date helpers for the rolling window. All parsing is done as LOCAL noon,
// never `new Date("2026-07-14")`, which JS parses as UTC midnight and renders as
// the previous day for anyone west of Greenwich - i.e. everyone here.
function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function dateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayIso(): string {
  return dateToIso(new Date());
}

function addDaysIso(iso: string, days: number): string {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + days);
  return dateToIso(d);
}

function MonthScheduleView({
  users,
  tags,
}: {
  users: AdminUser[];
  tags: EmployeeTag[];
}) {
  const today = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  // ROLLING 30-DAY WINDOW, not a calendar month.
  //
  // A calendar month is the wrong shape for scheduling: on the 28th, "this month"
  // is almost entirely the past, and the days you actually need to staff are in a
  // different view. The window is anchored on a start date that defaults to today,
  // so the useful days are always on screen.
  //
  // The window crosses month boundaries, so every date here is built with real
  // Date arithmetic. The old code assembled ISO strings by concatenating the
  // month state, which silently produces "2026-07-33" the moment a window spills
  // into August.
  const WINDOW_DAYS = 30;

  const [anchor, setAnchor] = useState<string>(() => todayIso());

  const dayList = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < WINDOW_DAYS; i++) out.push(addDaysIso(anchor, i));
    return out;
  }, [anchor]);

  const rangeStart = dayList[0];
  const rangeEnd = dayList[dayList.length - 1];

  const rangeLabel = useMemo(() => {
    const fmt = (iso: string) =>
      isoToDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endYear = isoToDate(rangeEnd).getFullYear();
    return `${fmt(rangeStart)} - ${fmt(rangeEnd)}, ${endYear}`;
  }, [rangeStart, rangeEnd]);

  const [rows, setRows] = useState<AvailabilityRangeRow[]>([]);
  const [scheduledRows, setScheduledRows] = useState<ScheduledJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // The pinned row. The table is far wider than the screen, so when you scroll
  // sideways to reach an employee you lose track of which day you are on. Click
  // the day cell to pin it; click again to unpin.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Pull the window's availability + scheduled blocks from the server. Runs on
  // mount and whenever the range changes; also wired to the Refresh button so an
  // admin can re-pull crew submissions without reloading the page. The optional
  // `signal` lets the effect drop a stale response when the range moves mid-flight.
  const loadRange = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiFetch<AvailabilityRangeResponse>(`/api/admin/availability/range?start=${rangeStart}&end=${rangeEnd}`);
      if (signal?.cancelled) return;
      setRows(r.days);
      setScheduledRows(r.scheduled);
    } catch (e) {
      if (!signal?.cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load");
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    const signal = { cancelled: false };
    loadRange(signal);
    return () => { signal.cancelled = true; };
  }, [loadRange]);

  const tagsById = useMemo(() => {
    const m = new Map<number, EmployeeTag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  // Column ordering: by crew tier (I far left … IV far right) by default, or
  // pull a chosen tag's holders to the left ("compatibility highest on left").
  const [orderTagId, setOrderTagId] = useState<number | null>(null);

  // High-contrast palette toggle for the color-forward variant of this view.
  // Persists per-device (localStorage) so an admin who prefers the vibrant
  // Google-Sheets-style fills sees them by default on their machine.
  const [highContrast, setHighContrast] = useState<boolean>(() => {
    try { return localStorage.getItem(HC_MONTH_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(HC_MONTH_KEY, highContrast ? "1" : "0"); } catch { /* noop */ }
  }, [highContrast]);
  const statusPalette = highContrast ? HC_MONTH_STATUS_COLORS : MONTH_STATUS_COLORS;
  const scheduledPalette = highContrast ? HC_SCHEDULED_COLORS : SCHEDULED_COLORS;

  // Edit mode is OFF by default: this is a wide, scroll-heavy grid, and tapping a
  // cell CHANGES a crew member's availability. Read-only by default means a stray
  // tap while scanning can't silently overwrite someone's schedule; the admin
  // turns editing on deliberately when they mean to change something. Not
  // persisted - it resets to read-only every time the view opens, so editing is
  // always an explicit choice.
  const [editMode, setEditMode] = useState(false);
  const [reminderCopied, setReminderCopied] = useState(false);
  const AVAILABILITY_REMINDER =
    "Hi! Please update your crew availability in the app for the next two weeks. Open the Mountaineer app, go to Availability, and mark each day (available, unavailable, or conditional). This helps us schedule jobs around you. Thanks!";
  const activeUsers = useMemo(() => {
    type U = (typeof users)[number];
    const tierRank = (u: U): number => {
      const map: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, "1": 1, "2": 2, "3": 3, "4": 4 };
      for (const tid of u.tag_ids) {
        const t = tagsById.get(tid);
        if (!t) continue;
        const m = t.name.match(/tier\s*(iv|iii|ii|i|4|3|2|1)\b/i);
        if (m) return map[m[1].toLowerCase()] ?? 99;
      }
      return 99; // untiered sinks to the right
    };
    const name = (u: U) => (u.name || u.email).toLowerCase();
    const list = users.filter((u) => u.is_active);
    return list.sort((a, b) => {
      if (orderTagId != null) {
        const ah = a.tag_ids.includes(orderTagId) ? 0 : 1;
        const bh = b.tag_ids.includes(orderTagId) ? 0 : 1;
        if (ah !== bh) return ah - bh;
      }
      const t = tierRank(a) - tierRank(b);
      if (t) return t;
      return name(a).localeCompare(name(b));
    });
  }, [users, orderTagId, tagsById]);

  // (user_id, day) → record map for O(1) cell lookup.
  const matrix = useMemo(() => {
    const m = new Map<number, Map<string, AvailabilityRangeRow>>();
    for (const r of rows) {
      let inner = m.get(r.user_id);
      if (!inner) { inner = new Map(); m.set(r.user_id, inner); }
      inner.set(r.day, r);
    }
    return m;
  }, [rows]);

  // Inline editing: tap a cell to cycle available → unavailable → conditional.
  // Reuses the admin per-user upsert (POST /api/admin/availability/{id}) which
  // bypasses the 14-day lock, so admin can edit any day right here instead of
  // opening each employee's page. Optimistic; reverts on error.
  const [cellBusy, setCellBusy] = useState<string | null>(null);
  async function cycleCell(userId: number, dIso: string, record: AvailabilityRangeRow | null | undefined) {
    // Read-only unless the admin has explicitly turned editing on. Guards against
    // an accidental tap changing someone's availability while scrolling the grid.
    if (!editMode) return;
    const order = ["available", "unavailable", "conditional"] as const;
    const cur = record?.status as (typeof order)[number] | undefined;
    const next = cur == null ? "available" : order[(order.indexOf(cur) + 1) % order.length];
    const windowStart = record?.window_start || dIso;
    const key = `${userId}:${dIso}`;
    const prevRows = rows;
    setCellBusy(key);
    setErr(null);
    setRows((rs) => [
      ...rs.filter((r) => !(r.user_id === userId && r.day === dIso)),
      { user_id: userId, day: dIso, status: next, note: record?.note ?? null, window_start: windowStart },
    ]);
    try {
      await apiFetch(`/api/admin/availability/${userId}`, {
        method: "POST",
        body: JSON.stringify({ window_start: windowStart, days: [{ day: dIso, status: next, note: record?.note ?? null }] }),
      });
    } catch (e: any) {
      setRows(prevRows);
      setErr(e instanceof ApiError ? e.message : "Failed to save availability");
    } finally {
      setCellBusy(null);
    }
  }

  // (user_id, day) → list of job titles for the day. Built from scheduledRows.
  // Multiple events for the same (user, day) accumulate into the list; the
  // cell renders them as a numbered list. Yellow overrides the availability
  // color since "scheduled to work" is the more actionable signal.
  const scheduledMatrix = useMemo(() => {
    const m = new Map<number, Map<string, string[]>>();
    for (const s of scheduledRows) {
      let inner = m.get(s.user_id);
      if (!inner) { inner = new Map(); m.set(s.user_id, inner); }
      const list = inner.get(s.day);
      if (list) {
        if (!list.includes(s.title)) list.push(s.title);
      } else {
        inner.set(s.day, [s.title]);
      }
    }
    return m;
  }, [scheduledRows]);

  // Step by a whole window. A half-window step would be friendlier for spotting
  // things that straddle the edge, but a full step means paging never shows the
  // same day twice, which is what admin actually asked for.
  function shiftWindow(deltaDays: number) {
    setAnchor((a) => addDaysIso(a, deltaDays));
    setSelectedDay(null);
  }

  function jumpToToday() {
    setAnchor(todayIso());
    setSelectedDay(null);
  }

  return (
    <>
      {/* Row hover + selection. HC mode uses a bright inset ring + darker tint
          because the plain dark overlay is invisible against the saturated blue
          Scheduled cells (#4285f4). Non-HC keeps the cheap dark tint since the
          muted fills read fine with it.

          Selection is a CLASS rule, not an inline style, on purpose: an inline
          boxShadow on the td would be beaten by nothing and would in turn clobber
          the hover rule. As a class it composes, and `.selected` is declared after
          `:hover` so a pinned row stays visibly pinned while the pointer is
          elsewhere. Selection outranks hover deliberately: the whole point is to
          keep your eye on ONE row while you scroll a wide table sideways. */}
      <style>{highContrast
        ? `.month-row:hover td { box-shadow: inset 0 0 0 3px rgba(255,255,255,0.75), inset 0 0 0 9999px rgba(0,0,0,0.30); }
           .month-row.selected td { box-shadow: inset 0 0 0 2px var(--brand), inset 0 0 0 9999px rgba(0,0,0,0.20); }`
        : `.month-row:hover td { box-shadow: inset 0 0 0 9999px rgba(0,0,0,0.22); }
           .month-row.selected td { box-shadow: inset 0 0 0 2px var(--brand), inset 0 0 0 9999px rgba(0,0,0,0.14); }`
      }</style>
      <div
        className="card"
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={() => shiftWindow(-WINDOW_DAYS)}
          style={{ padding: "6px 14px", fontSize: 16, fontWeight: 700 }}
          aria-label="Previous 30 days"
        >
          ‹
        </button>
        <div className="col" style={{ alignItems: "center", gap: 2 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{rangeLabel}</div>
          <button
            type="button"
            onClick={jumpToToday}
            style={{
              fontSize: 11, padding: "2px 8px",
              background: "none", color: "var(--muted)",
              border: "1px solid var(--border)",
            }}
          >
            Today
          </button>
        </div>
        <button
          type="button"
          onClick={() => shiftWindow(WINDOW_DAYS)}
          style={{ padding: "6px 14px", fontSize: 16, fontWeight: 700 }}
          aria-label="Next 30 days"
        >
          ›
        </button>
      </div>

      {/* Column ordering + display options. */}
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="small" style={{ color: "var(--muted)" }}>Order columns by</span>
          <select
            value={orderTagId ?? ""}
            onChange={(e) => setOrderTagId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Tier (I → IV)</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name} first</option>)}
          </select>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={highContrast}
            onChange={(e) => setHighContrast(e.target.checked)}
            style={{ accentColor: "var(--brand)", width: 16, height: 16 }}
          />
          <span>High contrast (saturated fills)</span>
        </label>
        {/* Pull the latest crew availability from the server (crew submit on
            their own devices, so the grid can be stale without a manual re-pull). */}
        <button
          type="button"
          onClick={() => loadRange()}
          disabled={loading}
          title="Pull the latest crew availability from the server"
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 14px", fontSize: 13, fontWeight: 700, borderRadius: 8,
            cursor: loading ? "default" : "pointer",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text)",
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Refreshing…" : "↻ Refresh availability"}
        </button>
        {/* Edit toggle. Off by default so tapping a cell does nothing until the
            admin opts in; on, it is clearly flagged so it is obvious the grid is
            now live. */}
        <button
          type="button"
          onClick={() => setEditMode((v) => !v)}
          aria-pressed={editMode}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 14px", fontSize: 13, fontWeight: 700, borderRadius: 8,
            cursor: "pointer",
            border: editMode ? "2px solid var(--warn)" : "1px solid var(--border)",
            background: editMode ? "var(--warn-bg)" : "transparent",
            color: editMode ? "var(--warn)" : "var(--text)",
          }}
        >
          {editMode ? "Editing on - tap a day to change it" : "Edit availability"}
        </button>
      </div>

      {err && (
        <div className="card" style={{ color: "var(--danger)" }}>
          {err}
        </div>
      )}

      {activeUsers.length === 0 ? (
        <div className="card" style={{ color: "var(--muted)", textAlign: "center", padding: 28 }}>
          No active employees.
        </div>
      ) : (
        // Burst out of the parent container's max-width on wide displays.
        // `width: 100vw` + `marginLeft: calc(50% - 50vw)` is the standard
        // "full-bleed" trick - the card spans the full viewport while
        // staying centered on the container's axis. The 24px side padding
        // keeps the table off the viewport edges so scrollbars and window
        // chrome don't crowd it. Inner overflow:auto keeps the horizontal
        // scroll local to the card if employees still overflow the viewport.
        <div
          className="card"
          style={{
            padding: 0,
            overflow: "auto",
            maxHeight: "75vh",
            width: "100vw",
            maxWidth: "100vw",
            marginLeft: "calc(50% - 50vw)",
            marginRight: "calc(50% - 50vw)",
            // Cap the breakout on truly enormous screens so the table doesn't
            // sprawl past what's useful. 2400px fits ~28 employees at the
            // tightened 80px column width without scroll.
            boxSizing: "border-box",
          }}
        >
          <table style={{
            borderCollapse: "separate", borderSpacing: 0,
            fontSize: 12,
            // table-layout: fixed + explicit per-<th> widths below is the
            // only way to make each column exactly the width of its email
            // string. Auto-layout kept losing to unbreakable content in
            // the browser's min-content pass no matter what CSS tricks
            // we threw at the tag chips.
            tableLayout: "fixed",
            width: "max-content",
            minWidth: "100%",
          }}>
            <thead>
              <tr>
                <th
                  style={{
                    position: "sticky", top: 0, left: 0, zIndex: 3,
                    background: "var(--card)",
                    borderBottom: "1px solid var(--border)",
                    borderRight: "1px solid var(--border)",
                    padding: "6px 8px", textAlign: "left",
                    width: 56,
                  }}
                >
                  <span className="small" style={{ color: "var(--muted)" }}>Day</span>
                </th>
                {activeUsers.map((u) => {
                  const userTags = u.tag_ids
                    .map((tid) => tagsById.get(tid))
                    .filter((t): t is EmployeeTag => !!t)
                    .sort((a, b) => a.sort_order - b.sort_order);
                  const notes = (u.scheduling_notes ?? "").trim();
                  // Explicit width sized to fit the email on one line at
                  // the 10px muted-address font. Uses `ch` units so it
                  // scales with whatever font the admin has picked. 4ch
                  // slack for padding + safety; MIN keeps super-short
                  // emails from producing unusably narrow cells.
                  const emailLen = (u.email || "").length;
                  const colWidth = `${Math.max(emailLen + 4, 14)}ch`;
                  return (
                    <th
                      key={u.id}
                      // Surface the crew member's persistent scheduling notes
                      // as a native tooltip on hover. The native `title=` is
                      // intentional (vs a custom popover) - it works on the
                      // wide-desktop admin views where this view shines and
                      // doesn't fight the sticky-header z-index layering.
                      title={notes || undefined}
                      style={{
                        position: "sticky", top: 0, zIndex: 2,
                        background: "var(--card)",
                        borderBottom: "1px solid var(--border)",
                        borderRight: "1px solid var(--border)",
                        padding: "6px 8px", textAlign: "left",
                        verticalAlign: "top",
                        // Fixed table-layout + explicit width = each column
                        // is exactly the width of its email. Name and tags
                        // wrap into whatever's left over.
                        width: colWidth,
                        cursor: notes ? "help" : "default",
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700, fontSize: 12,
                          display: "flex", alignItems: "center", gap: 4,
                        }}
                      >
                        <span>{u.name || u.email}</span>
                        {notes && (
                          // Tiny visual cue so the admin knows a note exists.
                          // The actual content shows in the hover tooltip.
                          <span
                            aria-label="Has scheduling notes"
                            style={{
                              fontSize: 9,
                              color: "var(--brand)",
                              border: "1px solid color-mix(in srgb, var(--brand) 35%, transparent)",
                              background: "color-mix(in srgb, var(--brand) 12%, transparent)",
                              borderRadius: 3,
                              padding: "0 4px",
                              lineHeight: "13px",
                              fontWeight: 700,
                            }}
                          >
                            note
                          </span>
                        )}
                      </div>
                      {/* Contact info so admin can reach the crew member
                          without leaving the schedule. Email is nowrap so
                          it drives the column width - name and tags below
                          wrap to whatever the email dictates. */}
                      <div className="small" style={{ color: "var(--muted)", fontSize: 10, marginTop: 2, lineHeight: 1.35 }}>
                        {u.phone && <div style={{ color: "var(--text)", whiteSpace: "nowrap" }}>{u.phone}</div>}
                        <div style={{ whiteSpace: "nowrap" }}>{u.email}</div>
                      </div>
                      {userTags.length > 0 && (
                        // Tags flow within the email-driven column width.
                        // overflowWrap:anywhere + wordBreak:break-word let
                        // each tag break at ANY character if necessary, so
                        // the tag's min-content width no longer forces the
                        // <th> wider - the browser's table auto-layout
                        // otherwise sizes every column to fit the widest
                        // unbreakable child on one line, and a nowrap tag
                        // was winning that fight over the email.
                        <div
                          style={{
                            display: "flex", flexWrap: "wrap",
                            gap: 3, marginTop: 4,
                          }}
                        >
                          {userTags.map((t) => (
                            <span
                              key={t.id}
                              title={t.name}
                              style={{
                                fontSize: 9, fontWeight: 700,
                                padding: "1px 5px", borderRadius: 3,
                                background: "var(--tag-bg, color-mix(in srgb, var(--brand) 16%, transparent))",
                                color: "var(--text)",
                                border: "1px solid var(--brand)",
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                                lineHeight: 1.25,
                                minWidth: 0,
                              }}
                            >
                              {t.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {dayList.map((dIso) => {
                // Parse the day from the ISO string itself. It used to be built
                // from the month/year state, which is wrong the moment a rolling
                // window crosses into the next month: every spilled day rendered
                // with the previous month's weekday.
                const dt = isoToDate(dIso);
                const dNum = dt.getDate();
                const mon = dt.toLocaleDateString("en-US", { month: "short" });
                const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
                const isToday = dIso === today;
                const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
                const isSelected = dIso === selectedDay;
                return (
                  <tr
                    key={dIso}
                    className={`month-row${isSelected ? " selected" : ""}`}
                  >
                    <td
                      // Click-to-select lives on the DAY cell, not the row: every
                      // other cell already has a click that cycles availability, and
                      // a row-level handler would fight it.
                      onClick={() => setSelectedDay((cur) => (cur === dIso ? null : dIso))}
                      title={isSelected ? "Click to unpin this row" : "Click to pin this row while scrolling"}
                      style={{
                        position: "sticky", left: 0, zIndex: 1,
                        // Must stay OPAQUE: employee columns scroll underneath it.
                        background: isSelected
                          ? "var(--card2)"
                          : isToday
                            ? "color-mix(in srgb, var(--brand) 10%, transparent)"
                            : "var(--card)",
                        borderBottom: "1px solid var(--border)",
                        borderRight: "1px solid var(--border)",
                        borderLeft: isSelected ? "3px solid var(--brand)" : "3px solid transparent",
                        padding: "4px 8px", fontSize: 12,
                        fontWeight: isToday || isSelected ? 800 : 600,
                        color: isToday ? "var(--brand)" : (isWeekend ? "var(--muted)" : "var(--text)"),
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      {mon} {dNum}{" "}
                      <span style={{ color: "var(--muted)", fontWeight: 400 }}>{dow}</span>
                    </td>
                    {activeUsers.map((u) => {
                      const record = matrix.get(u.id)?.get(dIso) ?? null;
                      const jobs = scheduledMatrix.get(u.id)?.get(dIso);
                      const isScheduled = !!(jobs && jobs.length > 0);
                      const availColors = record ? statusPalette[record.status] : null;

                      // Scheduled takes precedence - it's the most actionable
                      // signal. Availability still surfaces via the cell border
                      // so admin can spot conflicts (e.g. scheduled but marked
                      // unavailable would show a red border around a yellow
                      // cell).
                      const cellBg = isScheduled
                        ? scheduledPalette.bg
                        : (availColors?.bg ?? "transparent");

                      const noteSuffix = record?.note ? ` - ${record.note}` : "";
                      const availSummary = record
                        ? `${record.status}${noteSuffix}`
                        : "not submitted";
                      const title = isScheduled
                        ? `${u.name || u.email} on ${dIso}: scheduled - ${jobs!.join(", ")} | availability: ${availSummary}`
                        : `${u.name || u.email} on ${dIso}: ${availSummary}`;

                      return (
                        <td
                          key={u.id}
                          title={editMode ? `${title} - tap to change` : title}
                          onClick={() => cycleCell(u.id, dIso, record)}
                          style={{
                            borderBottom: "1px solid var(--border)",
                            borderRight: "1px solid var(--border)",
                            // Taller tap target while editing (the cells are tiny
                            // and the grid scrolls sideways, so a small target is
                            // an easy mis-tap on a phone).
                            padding: isScheduled ? "4px 6px" : (editMode ? "12px 6px" : 0),
                            minHeight: 26,
                            background: cellBg,
                            cursor: cellBusy === `${u.id}:${dIso}`
                              ? "wait"
                              : editMode ? "pointer" : "default",
                            verticalAlign: "top",
                          }}
                        >
                          {/* A scheduled cell paints over the availability color,
                              so the availability has to come back some other way or
                              you cannot see that somebody is booked on a day they
                              said they were unavailable.

                              It used to come back as an OUTLINE around the cell. In
                              high-contrast that outline was hardcoded white-dashed,
                              because no single stroke color reads against all four
                              saturated fills - which meant the one thing the outline
                              existed to tell you (WHICH availability) was exactly
                              the thing it threw away. A white ring says "there is a
                              conflict" and nothing about what kind.

                              A chip carries the actual color instead. It is the
                              availability color itself, on every theme and in both
                              contrast modes, so red-on-blue reads as "booked but
                              unavailable" at a glance. */}
                          {isScheduled && availColors && (
                            <span
                              title={`Availability: ${availColors.label}`}
                              style={{
                                display: "inline-block",
                                width: 10,
                                height: 10,
                                borderRadius: 3,
                                background: availColors.bg,
                                border: `2px solid ${availColors.fg}`,
                                boxSizing: "border-box",
                                marginBottom: 3,
                                // Keep it legible on the saturated Scheduled fill:
                                // a hairline of the cell's own text color separates
                                // the chip from the blue behind it.
                                outline: `1px solid ${scheduledPalette.fg}`,
                              }}
                            />
                          )}
                          {isScheduled && (
                            <div
                              style={{
                                color: scheduledPalette.fg,
                                fontSize: 11,
                                fontWeight: 600,
                                lineHeight: 1.25,
                                wordBreak: "break-word",
                              }}
                            >
                              {jobs!.length === 1 ? (
                                jobs![0]
                              ) : (
                                <ol
                                  style={{
                                    margin: 0,
                                    paddingLeft: 16,
                                    listStylePosition: "outside",
                                  }}
                                >
                                  {jobs!.map((t, i) => (
                                    <li key={i}>{t}</li>
                                  ))}
                                </ol>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading && (
            <div className="small" style={{ color: "var(--muted)", padding: 10 }}>
              Loading…
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div
        className="card"
        style={{
          display: "flex", flexWrap: "wrap",
          alignItems: "center", gap: 12, fontSize: 12,
        }}
      >
        <span className="small" style={{ color: "var(--muted)" }}>Legend:</span>
        {(["available", "unavailable", "conditional"] as const).map((st) => {
          const c = statusPalette[st];
          return (
            <span key={st} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 14, height: 14, borderRadius: 3,
                  background: c.bg, border: `1px solid ${c.fg}`,
                }}
              />
              <span>{c.label}</span>
            </span>
          );
        })}
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 14, height: 14, borderRadius: 3,
              background: scheduledPalette.bg,
              border: `1px solid ${scheduledPalette.fg}`,
            }}
          />
          <span>{scheduledPalette.label}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 14, height: 14, borderRadius: 3,
              border: "1px dashed var(--border)",
            }}
          />
          <span>Not submitted</span>
        </span>
        {/* Explain the chip, or it reads as decoration. */}
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 14, height: 14, borderRadius: 3,
              background: scheduledPalette.bg,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <span
              style={{
                width: 8, height: 8, borderRadius: 2,
                background: statusPalette.unavailable.bg,
                border: `2px solid ${statusPalette.unavailable.fg}`,
                boxSizing: "border-box",
                outline: `1px solid ${scheduledPalette.fg}`,
              }}
            />
          </span>
          <span>Chip = their availability on a scheduled day</span>
        </span>
      </div>

      {/* Copy-pasteable reminder for Google Voice SMS. Lists who hasn't
          submitted availability for the visible window so admin knows who to
          nudge. No em dashes (per house style). */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Availability reminder</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
          Copy this into Google Voice to remind crew to set their availability.
        </div>
        {(() => {
          const notSubmitted = activeUsers.filter((u) => !matrix.has(u.id));
          return (
            <>
              <textarea
                readOnly
                value={AVAILABILITY_REMINDER}
                rows={4}
                style={{ width: "100%", resize: "vertical", fontSize: 13, padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "rgba(255,255,255,0.03)", color: "var(--text)" }}
              />
              <div className="row" style={{ gap: 10, alignItems: "center", marginTop: 8 }}>
                <button
                  type="button"
                  className="btnPrimary"
                  onClick={() => {
                    navigator.clipboard?.writeText(AVAILABILITY_REMINDER).then(
                      () => { setReminderCopied(true); window.setTimeout(() => setReminderCopied(false), 2500); },
                      () => {},
                    );
                  }}
                >
                  Copy reminder
                </button>
                {reminderCopied && <span className="small" style={{ color: "var(--ok)" }}>Copied</span>}
              </div>
              {notSubmitted.length > 0 && (
                <div className="small" style={{ color: "var(--muted)", marginTop: 10 }}>
                  Not submitted for this window ({notSubmitted.length}):{" "}
                  <span style={{ color: "var(--text)" }}>{notSubmitted.map((u) => u.name || u.email).join(", ")}</span>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </>
  );
}

// Tag picker modal - checkbox grid keyed off the admin-managed tag list.
function EmployeeTagsPicker({
  user,
  allTags,
  onCancel,
  onSave,
}: {
  user: AdminUser;
  allTags: EmployeeTag[];
  onCancel: () => void;
  onSave: (tagIds: number[]) => Promise<void> | void;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(user.tag_ids));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setErr(null);
    try {
      await onSave(Array.from(selected));
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, padding: 16, zIndex: 1000,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card)", borderRadius: 12,
          border: "1px solid var(--border)",
          maxWidth: 420, width: "100%",
          padding: 18, display: "flex", flexDirection: "column", gap: 12,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 800 }}>
          Tags for {user.name || user.email}
        </div>
        {allTags.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>
            No tags defined yet. Create some in Settings → Employee Tags.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[...allTags].sort((a, b) => a.sort_order - b.sort_order).map((t) => {
              const on = selected.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggle(t.id)}
                  style={{
                    fontSize: 13, padding: "6px 12px", borderRadius: 999,
                    background: on ? "color-mix(in srgb, var(--brand) 18%, transparent)" : "transparent",
                    color: on ? "var(--brand)" : "var(--text)",
                    border: `1px solid ${on ? "var(--brand)" : "var(--border)"}`,
                    fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        )}
        {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={{
              background: "none",
              color: "var(--muted)",
              border: "1px solid var(--border)",
              padding: "8px 14px", fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btnPrimary"
            onClick={handleSave}
            disabled={saving}
            style={{ padding: "8px 14px" }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Map tab (Leaflet via CDN)
// ─────────────────────────────────────────
function MapTab() {
  const { settings } = useTheme();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [events, setEvents] = useState<GeoEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());

  useEffect(() => {
    apiFetch<GeoEvent[]>("/api/admin/events/today")
      .then((data) => {
        setEvents(data);
        setSelectedJobs(new Set(data.map((e: GeoEvent) => e.job_uuid)));
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  // Unique jobs with event counts and name
  const jobs = useMemo(() => {
    const counts = new Map<string, number>();
    const names = new Map<string, string>();
    for (const e of events) {
      counts.set(e.job_uuid, (counts.get(e.job_uuid) ?? 0) + 1);
      if (e.job_name && !names.has(e.job_uuid)) names.set(e.job_uuid, e.job_name);
    }
    return [...counts.entries()].map(([uuid, count]) => ({
      uuid,
      count,
      label: names.get(uuid) || uuid.slice(0, 8),
    }));
  }, [events]);

  // Events filtered by selected jobs
  const visible = useMemo(
    () => events.filter((e) => selectedJobs.has(e.job_uuid)),
    [events, selectedJobs]
  );

  // Unique event types in visible set (for legend)
  const visibleTypes = useMemo(
    () => [...new Set(visible.map((e) => e.type.toLowerCase()))],
    [visible]
  );

  function toggleJob(uuid: string) {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      next.has(uuid) ? next.delete(uuid) : next.add(uuid);
      return next;
    });
  }

  function pinColor(type: string): string {
    const key = type.toLowerCase();
    return settings.pinColors[key] ?? settings.pinColors["other"] ?? DEFAULT_PIN_COLORS["other"];
  }

  useEffect(() => {
    if (loading || err || visible.length === 0 || !mapRef.current) return;

    function initMap(L: any) {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      const map = L.map(mapRef.current!);
      mapInstanceRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      const r = settings.pinSize;
      const markers = visible.map((e) => {
        const color = pinColor(e.type);
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.85);box-shadow:0 2px 6px rgba(0,0,0,0.45)"></div>`,
          iconSize: [r * 2, r * 2],
          iconAnchor: [r, r],
          popupAnchor: [0, -r - 4],
        });
        const time = formatMountainTime(e.timestamp);
        const jobLabel = e.job_name || e.job_uuid.slice(0, 8);
        return L.marker([e.lat, e.lng], { icon }).bindPopup(
          `<b style="text-transform:capitalize">${e.type}</b><br/>${time}${e.note ? `<br/>${e.note}` : ""}<br/><span style="font-size:11px;color:#888">${jobLabel}</span>`
        );
      });

      const group = L.featureGroup(markers).addTo(map);
      map.fitBounds(group.getBounds().pad(0.2));
    }

    const L = (window as any).L;
    if (L) { initMap(L); return; }

    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => initMap((window as any).L);
    document.head.appendChild(script);

    return () => { mapInstanceRef.current?.remove(); mapInstanceRef.current = null; };
  }, [visible, loading, err, settings.pinSize, settings.pinColors]);

  if (loading) return <div className="card small">Loading events...</div>;
  if (err) return <div className="card" style={{ color: "var(--danger)" }}>{err}</div>;
  if (events.length === 0) return (
    <div className="card" style={{ color: "var(--muted)", textAlign: "center", padding: 32 }}>
      No geotagged events today.
    </div>
  );

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* Header row */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <span className="small">{visible.length} / {events.length} event{events.length !== 1 ? "s" : ""}</span>

        {/* All / None toggles */}
        <button
          onClick={() => setSelectedJobs(new Set(jobs.map((j) => j.uuid)))}
          style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer" }}
        >
          All
        </button>
        <button
          onClick={() => setSelectedJobs(new Set())}
          style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer" }}
        >
          None
        </button>

        {/* Job filter chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {jobs.map((j) => {
            const active = selectedJobs.has(j.uuid);
            return (
              <button
                key={j.uuid}
                onClick={() => toggleJob(j.uuid)}
                style={{
                  fontSize: 11, padding: "3px 9px", borderRadius: 999,
                  background: active ? "color-mix(in srgb, var(--brand) 15%, transparent)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${active ? "var(--brand)" : "var(--border)"}`,
                  color: active ? "var(--brand)" : "var(--muted)",
                  fontWeight: 600, cursor: "pointer",
                }}
              >
                {j.label} · {j.count}
              </button>
            );
          })}
        </div>
      </div>

      {/* Map */}
      {visible.length > 0
        ? <div ref={mapRef} style={{ width: "100%", height: 500 }} />
        : <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No jobs selected.</div>
      }

      {/* Legend */}
      {visibleTypes.length > 0 && (
        <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: 10 }}>
          {visibleTypes.map((t) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: pinColor(t), border: "1.5px solid rgba(255,255,255,0.5)", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "capitalize" }}>{t}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Calendar / OAuth tab
// ─────────────────────────────────────────
function CalendarTab() {
  const [status, setStatus] = useState<CalStatus | null>(null);
  const [tokenJson, setTokenJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function loadStatus() {
    setStatus(null);
    apiFetch<CalStatus>("/api/admin/cal-status").then(setStatus).catch(() => {
      setStatus({ ok: false, error: "Could not reach server" });
    });
  }

  useEffect(() => { loadStatus(); }, []);

  async function handleSaveToken(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaved(false);
    setSaving(true);
    try {
      await apiFetch("/api/admin/cal-token", {
        method: "POST",
        body: JSON.stringify({ token_json: tokenJson.trim() }),
      });
      setSaved(true);
      setTokenJson("");
      loadStatus();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to save token");
    } finally {
      setSaving(false);
    }
  }

  const statusColor = status?.ok && status?.valid ? "var(--ok)" : "var(--danger)";
  const statusLabel = !status
    ? "Checking..."
    : status.ok && status.valid
    ? "Connected"
    : status.ok && status.expired
    ? "Token expired (will auto-refresh)"
    : "Error";

  return (
    <div>
      {/* Status card */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Google Calendar OAuth</div>

        <div className="row" style={{ marginBottom: 12 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
            background: status?.ok && status?.valid ? "color-mix(in srgb, var(--ok) 15%, transparent)" : "color-mix(in srgb, var(--danger) 15%, transparent)",
            color: statusColor,
          }}>
            {statusLabel}
          </span>
          <button onClick={loadStatus} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8 }}>
            Refresh
          </button>
        </div>

        {status && (
          <div className="col" style={{ gap: 4 }}>
            {status.error && <div className="small" style={{ color: "var(--danger)" }}>{status.error}</div>}
            {status.expiry && <div className="small">Access token expiry: {formatMountainDateTime(status.expiry)}</div>}
            {status.has_refresh_token !== undefined && (
              <div className="small">Refresh token: {status.has_refresh_token ? "✓ present" : "✗ missing"}</div>
            )}
          </div>
        )}
      </div>

      {/* Update token card */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Update OAuth Token</div>
        <p className="small" style={{ marginBottom: 12 }}>
          If the calendar stops working, regenerate <code>token.json</code> locally then paste its contents below.
          This saves the token to the database so it persists across restarts.
        </p>
        <div className="small" style={{ marginBottom: 12, padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid var(--border)" }}>
          <b>To regenerate locally:</b><br />
          1. Delete <code>backend/token.json</code><br />
          2. Run: <code>.venv\Scripts\python.exe scripts/refresh_google_token.py</code><br />
          3. Sign in when the browser opens<br />
          4. Copy the printed JSON and paste it below
        </div>

        <form onSubmit={handleSaveToken}>
          <textarea
            value={tokenJson}
            onChange={(e) => { setTokenJson(e.target.value); setSaved(false); }}
            placeholder={'{"token": "...", "refresh_token": "...", ...}'}
            style={{ fontFamily: "monospace", fontSize: 12, minHeight: 120 }}
          />
          {err && <div className="small" style={{ color: "var(--danger)", marginTop: 6 }}>{err}</div>}
          {saved && <div className="small" style={{ color: "var(--ok)", marginTop: 6 }}>Token saved and activated.</div>}
          <button
            type="submit"
            disabled={saving || !tokenJson.trim()}
            className="btnPrimary"
            style={{ marginTop: 10, width: "100%" }}
          >
            {saving ? "Saving..." : "Save Token"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Settings tab - lean landing page. Theme/style controls live on the
// Theme & Appearance sub-page so this screen stays uncluttered.
// ─────────────────────────────────────────
function SettingsTab({
  onOpenAdvanced,
  onOpenAppearance,
}: {
  onOpenAdvanced: () => void;
  onOpenAppearance: () => void;
}) {
  return (
    <div>
      <CollapsibleSection title="Company info"><CompanyInfoCard /></CollapsibleSection>
      <CollapsibleSection title="Payroll rates"><PayrollRatesCard /></CollapsibleSection>
      <CollapsibleSection title="Vehicle units"><VehicleUnitsCard /></CollapsibleSection>
      <CollapsibleSection title="Employee tags"><EmployeeTagsManagerCard /></CollapsibleSection>
      <CollapsibleSection title="Job types"><JobTypesManagerCard /></CollapsibleSection>
      <CollapsibleSection title="Job checklist"><JobChecklistCard /></CollapsibleSection>
      <CollapsibleSection title="DQ document types"><DqDocTypesCard /></CollapsibleSection>
      <CollapsibleSection title="Crew skills"><SkillsManagerCard /></CollapsibleSection>
      <CollapsibleSection title="Furniture catalogue"><FurnitureCatalogCard /></CollapsibleSection>
      <CollapsibleSection title="Help text"><HelpTextCard /></CollapsibleSection>
      {/* Theme + Advanced live at the very bottom - they're rarely-touched,
          full-screen sub-pages, not day-to-day field config. */}
      <SettingsNavCard
        title="Theme & Appearance"
        desc="Theme templates, colors, fonts, button style, and map pins."
        action="Open Theme & Appearance →"
        onClick={onOpenAppearance}
      />
      <SettingsNavCard
        title="Advanced Settings"
        desc="Google Calendar integration, data management, and other advanced options."
        action="Open Advanced Settings →"
        onClick={onOpenAdvanced}
      />
    </div>
  );
}

// Collapses a long list to its first `initialCount` children with a
// "Show N more / Show less" toggle. Used across the Settings-tab manager cards
// (Employee Tags, Job Types, Crew Skills, Field Help Text) so admin isn't
// scrolling past every row at once. The wrapped children keep their own state
// (edit-in-place, etc.) since they're the same elements, just sliced.
function CollapsibleList({
  children,
  initialCount = 3,
  className,
  style,
  moreLabel = "more",
}: {
  children: ReactNode;
  initialCount?: number;
  className?: string;
  style?: React.CSSProperties;
  // Noun shown in the toggle, e.g. "more tags" -> pass "tags".
  moreLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = Children.toArray(children);
  const shown = expanded ? items : items.slice(0, initialCount);
  const hiddenCount = items.length - initialCount;

  return (
    <>
      <div className={className} style={style}>{shown}</div>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginTop: 8, fontSize: 12, padding: "4px 10px", alignSelf: "flex-start",
            background: "none", border: "1px solid var(--border)", color: "var(--muted)",
            borderRadius: 8, cursor: "pointer",
          }}
        >
          {expanded ? "Show less" : `Show ${hiddenCount} ${moreLabel}`}
        </button>
      )}
    </>
  );
}

// Admin CRUD for the employee tag list. Inline add / rename / delete -
// admin can also drag-style reorder via the sort-order input, but most
// reordering is rare enough not to warrant a fancier UI.
function EmployeeTagsManagerCard() {
  const [tags, setTags] = useState<EmployeeTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<EmployeeTag[]>("/api/admin/employee-tags")
      .then((t) => { if (!cancelled) setTags(t); })
      .catch((e) => { if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function createTag() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setErr(null);
    try {
      const created = await apiFetch<EmployeeTag>("/api/admin/employee-tags", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setTags((prev) => [...prev, created].sort((a, b) => a.sort_order - b.sort_order));
      setNewName("");
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to create tag");
    } finally {
      setBusy(false);
    }
  }

  async function renameTag(id: number) {
    const name = editName.trim();
    if (!name) return;
    setBusy(true);
    setErr(null);
    try {
      const updated = await apiFetch<EmployeeTag>(`/api/admin/employee-tags/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setTags((prev) => prev.map((t) => (t.id === id ? updated : t)));
      setEditing(null);
      setEditName("");
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to rename");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTag(t: EmployeeTag) {
    if (!confirm(`Delete tag "${t.name}"? This removes it from any employee who has it.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/api/admin/employee-tags/${t.id}`, { method: "DELETE" });
      setTags((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 10 }}>Employee Tags</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
        Tag list shown when assigning tags on the Employees tab (e.g. Driver,
        Has CC, Tier I). Renaming a tag updates it everywhere it's already
        assigned. Deleting a tag removes it from all employees.
      </div>

      {loading ? (
        <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
      ) : (
        <CollapsibleList className="col" style={{ gap: 6 }} moreLabel="tags">
          {tags.map((t) => {
            const isEditing = editing === t.id;
            return (
              <div
                key={t.id}
                className="row"
                style={{
                  gap: 8, alignItems: "center", justifyContent: "space-between",
                  padding: "6px 0", borderBottom: "1px solid var(--border)",
                }}
              >
                {isEditing ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") renameTag(t.id); if (e.key === "Escape") setEditing(null); }}
                    style={{ flex: 1, padding: "4px 8px", fontSize: 13 }}
                  />
                ) : (
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</span>
                )}
                <div className="row" style={{ gap: 6 }}>
                  {isEditing ? (
                    <>
                      <button onClick={() => renameTag(t.id)} disabled={busy} style={{ fontSize: 12, padding: "4px 10px" }}>
                        Save
                      </button>
                      <button onClick={() => { setEditing(null); setEditName(""); }} style={{ fontSize: 12, padding: "4px 10px", background: "none", border: "1px solid var(--border)", color: "var(--muted)" }}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => { setEditing(t.id); setEditName(t.name); }}
                        style={{ fontSize: 12, padding: "4px 10px" }}
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => deleteTag(t)}
                        disabled={busy}
                        style={{
                          fontSize: 12, padding: "4px 10px",
                          background: "none", color: "var(--danger)",
                          border: "1px solid var(--danger)",
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </CollapsibleList>
      )}

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") createTag(); }}
          placeholder="New tag name"
          style={{ flex: 1, padding: "6px 10px", fontSize: 13 }}
        />
        <button
          onClick={createTag}
          disabled={busy || !newName.trim()}
          className="btnPrimary"
          style={{ padding: "6px 14px", fontSize: 13 }}
        >
          Add
        </button>
      </div>

      {err && <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}
    </div>
  );
}

type JobType = { id: number; name: string; sort_order: number; active: boolean };

// Admin CRUD for the configurable job-type tag list shown on the Job Report.
function JobTypesManagerCard() {
  const [types, setTypes] = useState<JobType[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<JobType[]>("/api/admin/job-types")
      .then((t) => { if (!cancelled) setTypes(t); })
      .catch((e) => { if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function createType() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true); setErr(null);
    try {
      const created = await apiFetch<JobType>("/api/admin/job-types", {
        method: "POST", body: JSON.stringify({ name }),
      });
      setTypes((prev) => [...prev, created].sort((a, b) => a.sort_order - b.sort_order));
      setNewName("");
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to create job type");
    } finally { setBusy(false); }
  }

  async function patchType(id: number, patch: Partial<Pick<JobType, "name" | "active">>) {
    setBusy(true); setErr(null);
    try {
      const updated = await apiFetch<JobType>(`/api/admin/job-types/${id}`, {
        method: "PATCH", body: JSON.stringify(patch),
      });
      setTypes((prev) => prev.map((t) => (t.id === id ? updated : t)));
      setEditing(null); setEditName("");
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to update");
    } finally { setBusy(false); }
  }

  async function deleteType(t: JobType) {
    if (!confirm(`Delete job type "${t.name}"? It stays on any report already tagged with it, but won't be offered on new reports.`)) return;
    setBusy(true); setErr(null);
    try {
      await apiFetch(`/api/admin/job-types/${t.id}`, { method: "DELETE" });
      setTypes((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to delete");
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 10 }}>Job Types</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
        The "Job type" tags crew pick on the Job Report. These also drive which
        skills are shown to rate on a job (Crew Skills). Deactivate to hide a
        type from new reports without losing it on old ones.
      </div>

      {loading ? (
        <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
      ) : (
        <CollapsibleList className="col" style={{ gap: 6 }} moreLabel="job types">
          {types.map((t) => {
            const isEditing = editing === t.id;
            return (
              <div key={t.id} className="row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                {isEditing ? (
                  <input autoFocus value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") patchType(t.id, { name: editName.trim() }); if (e.key === "Escape") setEditing(null); }}
                    style={{ flex: 1, padding: "4px 8px", fontSize: 13 }} />
                ) : (
                  <span style={{ fontSize: 14, fontWeight: 600, opacity: t.active ? 1 : 0.5 }}>
                    {t.name}{t.active ? "" : " (inactive)"}
                  </span>
                )}
                <div className="row" style={{ gap: 6 }}>
                  {isEditing ? (
                    <>
                      <button onClick={() => patchType(t.id, { name: editName.trim() })} disabled={busy} style={{ fontSize: 12, padding: "4px 10px" }}>Save</button>
                      <button onClick={() => { setEditing(null); setEditName(""); }} style={{ fontSize: 12, padding: "4px 10px", background: "none", border: "1px solid var(--border)", color: "var(--muted)" }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => patchType(t.id, { active: !t.active })} disabled={busy} style={{ fontSize: 12, padding: "4px 10px" }}>
                        {t.active ? "Deactivate" : "Activate"}
                      </button>
                      <button onClick={() => { setEditing(t.id); setEditName(t.name); }} style={{ fontSize: 12, padding: "4px 10px" }}>Rename</button>
                      <button onClick={() => deleteType(t)} disabled={busy} style={{ fontSize: 12, padding: "4px 10px", background: "none", color: "var(--danger)", border: "1px solid var(--danger)" }}>Delete</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </CollapsibleList>
      )}

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") createType(); }}
          placeholder="New job type" style={{ flex: 1, padding: "6px 10px", fontSize: 13 }} />
        <button onClick={createType} disabled={busy || !newName.trim()} className="btnPrimary" style={{ padding: "6px 14px", fontSize: 13 }}>Add</button>
      </div>

      {err && <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}
    </div>
  );
}

// Bulk furniture-catalog CSV import. Feeds the single server catalog that both
// the Estimator and Actual Inventory read (uploaded items appear in both).
// Quote a CSV cell only when it contains a comma, quote, or newline (RFC-4180
// escaping: double any inner quotes). Keeps plain names unquoted so the file
// stays readable in a spreadsheet.
function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// Read just the first field of a CSV line, honoring a leading quoted field so a
// name containing a comma is read whole. Used only to dedupe built-ins against
// server rows by name.
function csvFirstField(line: string): string {
  if (line[0] === '"') {
    let out = "";
    for (let i = 1; i < line.length; i++) {
      if (line[i] === '"') {
        if (line[i + 1] === '"') { out += '"'; i++; continue; }
        break;
      }
      out += line[i];
    }
    return out;
  }
  const comma = line.indexOf(",");
  return comma === -1 ? line : line.slice(0, comma);
}

function FurnitureCatalogCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; updated: number; skipped: number; errors: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<{ name: string }[]>("/api/furniture-catalog")
      .then((rows) => setCount(rows.length))
      .catch(() => {});
  }, [result]);

  async function upload(file: File) {
    setBusy(true); setErr(null); setResult(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const token = getToken() || "";
      const res = await fetch(`${ADMIN_API}/api/furniture-catalog/import-csv`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
      setResult(body);
    } catch (e: any) {
      setErr(e?.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  }

  // Export the catalog as a CSV. The server's export-csv endpoint only holds
  // admin-managed / CSV-imported rows; the ~40 built-in items the Estimator and
  // Actual-Inventory show are a frontend-only list (data/furnitureCatalog.ts)
  // the server never sees. Exporting the server rows alone yields a nearly-empty
  // file, so we fetch the server CSV (full columns), then append any built-in
  // item whose name isn't already a server row - giving the admin the complete
  // catalog to edit and re-import. Endpoint is admin-gated, hence the authed
  // fetch (a plain <a href> without the token would 401).
  async function exportCsv() {
    setBusy(true); setErr(null);
    try {
      const token = getToken() || "";
      const res = await fetch(`${ADMIN_API}/api/furniture-catalog/export-csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const serverCsv = (await res.text()).replace(/\r\n?/g, "\n").replace(/\n+$/, "");
      const lines = serverCsv.split("\n");
      // Header order is the server's own (name,category,length_in,...); map each
      // built-in field into the right column so re-import lines up.
      const cols = (lines[0] || "").split(",").map((c) => c.trim().toLowerCase());
      const existing = new Set(
        lines.slice(1).filter(Boolean).map((ln) => csvFirstField(ln).trim().toLowerCase()),
      );
      const extraRows = FURNITURE_CATALOG
        .filter((f) => !existing.has(f.name.trim().toLowerCase()))
        .map((f) => {
          const cell: Record<string, string> = {
            name: f.name,
            category: f.category,
            cubic_ft: String(f.cubic_ft),
            weight_lbs: String(f.weight_lbs),
          };
          // Dimension / packing columns are blank for built-ins - the admin
          // fills them in the spreadsheet; blank cells don't wipe on re-import.
          return cols.map((c) => csvEscape(cell[c] ?? "")).join(",");
        });

      const out = [serverCsv, ...extraRows].join("\n") + "\n";
      const blob = new Blob([out], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "furniture_catalog.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.message ?? "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 10 }}>Furniture Catalog</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
        Maintain the catalog in a spreadsheet: <strong>Export CSV</strong>, fill in
        dimensions and other data, then <strong>Upload CSV</strong> to push it back.
        Imported items appear in both the Estimator and the job Actual-Inventory search.
        {count !== null && <> Currently <strong>{count}</strong> catalog items.</>}
      </div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
        Columns: <code>name</code> (match key), <code>category</code>,{" "}
        <code>length_in</code>, <code>width_in</code>, <code>height_in</code>,{" "}
        <code>cubic_ft</code>, <code>weight_lbs</code>, <code>packing_type</code>,{" "}
        <code>fragile</code>, <code>sku</code>, <code>notes</code>. Fill L×W×H and
        volume is computed for you. Blank cells are left unchanged (they don't
        wipe existing values). Set category to <code>Boxes</code> for box types.
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        <button
          type="button"
          onClick={exportCsv}
          disabled={busy}
          style={{ display: "inline-flex", alignItems: "center", padding: "8px 16px", borderRadius: "var(--btn-r)", border: "1px solid var(--border)", background: "rgba(255,255,255,0.04)", cursor: busy ? "not-allowed" : "pointer" }}
        >
          {busy ? "Working…" : "Export CSV"}
        </button>
        <label className="btnPrimary" style={{ display: "inline-flex", alignItems: "center", padding: "8px 16px", borderRadius: "var(--btn-r)", cursor: busy ? "not-allowed" : "pointer" }}>
          {busy ? "Importing…" : "Upload CSV"}
          <input
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.currentTarget.value = "";
              if (f) upload(f);
            }}
          />
        </label>
      </div>

      {result && (
        <div className="small" style={{ marginTop: 10, color: "var(--ok)" }}>
          Imported: {result.added} added, {result.updated} updated, {result.skipped} skipped.
          {result.errors.length > 0 && (
            <div style={{ color: "var(--danger)", marginTop: 4 }}>
              {result.errors.length} row error(s): {result.errors.slice(0, 5).join("; ")}
            </div>
          )}
        </div>
      )}
      {err && <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}
    </div>
  );
}

type AdminSkill = {
  id: number; name: string; category: string; binary: boolean; core: boolean;
  relevant_job_types: string[]; definition: string | null; sort_order: number; active: boolean;
};

// Admin registry for the crew skill types (name, category, 0-5 vs binary,
// whether it's a "core" skill always rated, and which job types make it
// relevant on the Job Report).
function SkillsManagerCard() {
  const [skills, setSkills] = useState<AdminSkill[]>([]);
  const [jobTypeNames, setJobTypeNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AdminSkill | null>(null);
  const [newName, setNewName] = useState("");
  // Core + scale are chosen up front for custom-added skills (still editable
  // later). binary=true means a pass/fail (No/Yes = 0/5) rating; false = 1-5 stars.
  const [newCore, setNewCore] = useState(false);
  const [newBinary, setNewBinary] = useState(false);
  const [newRel, setNewRel] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<AdminSkill[]>("/api/admin/skills"),
      apiFetch<{ name: string; active: boolean }[]>("/api/admin/job-types").catch(() => []),
    ])
      .then(([s, jt]) => {
        if (cancelled) return;
        setSkills(s);
        setJobTypeNames(jt.filter((x) => x.active).map((x) => x.name));
      })
      .catch((e) => { if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function createSkill() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true); setErr(null);
    try {
      const created = await apiFetch<AdminSkill>("/api/admin/skills", {
        method: "POST",
        body: JSON.stringify({
          name,
          core: newCore,
          binary: newBinary,
          // A core skill is rated on every job, so its job-type list is ignored
          // by skillsForJobTypes. Send it empty rather than storing tags that
          // read as meaningful and are not.
          relevant_job_types: newCore ? [] : newRel,
        }),
      });
      setSkills((prev) => [...prev, created]);
      setNewName("");
      setNewCore(false);
      setNewBinary(false);
      setNewRel([]);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to create skill");
    } finally { setBusy(false); }
  }

  async function saveSkill(patch: Partial<AdminSkill>) {
    if (!editing) return;
    setBusy(true); setErr(null);
    try {
      const updated = await apiFetch<AdminSkill>(`/api/admin/skills/${editing.id}`, {
        method: "PATCH", body: JSON.stringify(patch),
      });
      setSkills((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setEditing(null);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to save skill");
    } finally { setBusy(false); }
  }

  async function deleteSkill(s: AdminSkill) {
    if (!confirm(`Delete skill "${s.name}"? This removes it from every employee's matrix.`)) return;
    setBusy(true); setErr(null);
    try {
      await apiFetch(`/api/admin/skills/${s.id}`, { method: "DELETE" });
      setSkills((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to delete");
    } finally { setBusy(false); }
  }

  const byCategory = skills.reduce<Record<string, AdminSkill[]>>((acc, s) => {
    (acc[s.category || "Other"] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 10 }}>Crew Skills</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
        The skill types crew get rated on. "Core" skills are rated on every job;
        others only appear on the Job Report when the job's type matches. Set
        each employee's 0–5 levels from the Employees tab.
      </div>

      {loading ? (
        <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
      ) : (
        <CollapsibleList className="col" style={{ gap: 12 }} moreLabel="categories">
          {Object.entries(byCategory).map(([cat, list]) => (
            <div key={cat}>
              <div className="small" style={{ color: "var(--brand)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{cat}</div>
              <div className="col" style={{ gap: 4 }}>
                {list.map((s) => (
                  <div key={s.id} className="row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 14, opacity: s.active ? 1 : 0.5 }}>
                      {s.name}
                      {s.core && <span style={{ fontSize: 10, color: "var(--brand)", marginLeft: 6 }}>CORE</span>}
                      {s.binary && <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6 }}>0/5</span>}
                      {!s.active && <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6 }}>inactive</span>}
                    </span>
                    <div className="row" style={{ gap: 6 }}>
                      <button onClick={() => setEditing(s)} style={{ fontSize: 12, padding: "3px 10px" }}>Edit</button>
                      <button onClick={() => deleteSkill(s)} disabled={busy} style={{ fontSize: 12, padding: "3px 10px", background: "none", color: "var(--danger)", border: "1px solid var(--danger)" }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CollapsibleList>
      )}

      <div className="col" style={{ gap: 8, marginTop: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createSkill(); }}
            placeholder="New skill name" style={{ flex: 1, padding: "6px 10px", fontSize: 13 }} />
          <button onClick={createSkill} disabled={busy || !newName.trim()} className="btnPrimary" style={{ padding: "6px 14px", fontSize: 13 }}>Add</button>
        </div>
        <div className="row wrap" style={{ gap: 14, alignItems: "center" }}>
          <label className="row" style={{ gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={newCore} onChange={(e) => setNewCore(e.target.checked)} style={{ accentColor: "var(--brand)" }} />
            <span className="small">Core (rated on every job)</span>
          </label>
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Scale:</span>
            {([["1–5 stars", false], ["Pass / fail", true]] as const).map(([label, bin]) => {
              const on = newBinary === bin;
              return (
                <button key={label} type="button" onClick={() => setNewBinary(bin)}
                  style={{ padding: "3px 10px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                    border: on ? "2px solid var(--brand)" : "1px solid var(--border)",
                    background: on ? "color-mix(in srgb, var(--brand) 18%, transparent)" : "transparent",
                    color: on ? "var(--brand)" : "var(--muted)" }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Applies-to, on CREATE. It was previously edit-only, so a new skill was
            born applying to no job type and therefore rated on no job at all
            until somebody remembered to reopen it. A core skill is rated on every
            job, so the picker is pointless there and hides itself. */}
        {!newCore && (
          <div className="col" style={{ gap: 6 }}>
            <span className="small" style={{ color: "var(--muted)" }}>
              Applies to (leave empty and this skill is never rated)
            </span>
            {jobTypeNames.length === 0 ? (
              <span className="small" style={{ color: "var(--muted)" }}>
                No job types defined yet. Add them under Job Types first.
              </span>
            ) : (
              <div className="row wrap" style={{ gap: 6 }}>
                {jobTypeNames.map((t) => {
                  const on = newRel.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        setNewRel((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))
                      }
                      style={{
                        padding: "3px 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        cursor: "pointer",
                        border: on ? "2px solid var(--brand)" : "1px solid var(--border)",
                        background: on ? "color-mix(in srgb, var(--brand) 18%, transparent)" : "transparent",
                        color: on ? "var(--brand)" : "var(--muted)",
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {err && <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}

      {editing && (
        <SkillEditModal
          skill={editing}
          jobTypeNames={jobTypeNames}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={saveSkill}
        />
      )}
    </div>
  );
}

function SkillEditModal({
  skill, jobTypeNames, busy, onCancel, onSave,
}: {
  skill: AdminSkill;
  jobTypeNames: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: Partial<AdminSkill>) => void;
}) {
  const [name, setName] = useState(skill.name);
  const [category, setCategory] = useState(skill.category);
  const [binary, setBinary] = useState(skill.binary);
  const [core, setCore] = useState(skill.core);
  const [active, setActive] = useState(skill.active);
  const [rel, setRel] = useState<string[]>(skill.relevant_job_types);

  function toggleRel(t: string) {
    setRel((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="card" style={{ maxWidth: 460, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div className="microLabel" style={{ marginBottom: 10 }}>Edit skill</div>
        <div className="col" style={{ gap: 10 }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Category</span>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Physical / Technical" />
          </label>
          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={core} onChange={(e) => setCore(e.target.checked)} style={{ accentColor: "var(--brand)" }} />
            <span className="small">Core - rated on every job</span>
          </label>
          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={binary} onChange={(e) => setBinary(e.target.checked)} style={{ accentColor: "var(--brand)" }} />
            <span className="small">Binary - trained / not (0 or 5)</span>
          </label>
          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ accentColor: "var(--brand)" }} />
            <span className="small">Active</span>
          </label>
          <div className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Relevant job types (non-core only)</span>
            <div className="row wrap" style={{ gap: 6 }}>
              {jobTypeNames.length === 0 && <span className="small" style={{ color: "var(--muted)" }}>No job types configured.</span>}
              {jobTypeNames.map((t) => {
                const on = rel.includes(t);
                return (
                  <button key={t} type="button" onClick={() => toggleRel(t)}
                    style={{ padding: "4px 10px", borderRadius: 99, fontSize: 12, cursor: "pointer",
                      border: on ? "2px solid var(--brand)" : "1px solid var(--border)",
                      background: on ? "color-mix(in srgb, var(--brand) 18%, transparent)" : "transparent",
                      color: on ? "var(--brand)" : "var(--text)" }}>
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <button className="btnPrimary" disabled={busy || !name.trim()}
              onClick={() => onSave({ name: name.trim(), category: category.trim(), binary, core, active, relevant_job_types: rel })}>
              Save
            </button>
            <button onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Tappable card that navigates to a settings sub-page.
function SettingsNavCard({
  title,
  desc,
  action,
  onClick,
}: {
  title: string;
  desc: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="microLabel" style={{ marginBottom: 0 }}>{title}</div>
      <div className="small" style={{ color: "var(--muted)" }}>{desc}</div>
      <button
        onClick={onClick}
        style={{
          alignSelf: "flex-start", padding: "8px 18px", fontSize: 13,
          border: "1px solid var(--border)", borderRadius: "var(--btn-r)",
          color: "var(--text)", background: "rgba(255,255,255,0.04)", cursor: "pointer",
        }}
      >
        {action}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────
// Theme & Appearance sub-page - every look-and-feel control.
// ─────────────────────────────────────────
function ThemeAppearancePage() {
  const { settings, update, reset } = useTheme();
  const preset = THEME_PRESETS[settings.themeId] ?? THEME_PRESETS["dark-ocean"];

  const [brandLocal, setBrandLocal] = useState(settings.brandOverride ?? preset.vars["--brand"]);
  const [brand2Local, setBrand2Local] = useState(settings.brand2Override ?? preset.vars["--brand2"]);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Device-local custom theme presets (saved snapshots of the current look).
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>(loadCustomPresets);
  const [saveOpen, setSaveOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("🎨");

  async function applyToAllUsers() {
    setApplyBusy(true);
    setApplyMsg(null);
    try {
      await apiFetch("/api/admin/config/theme", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setApplyMsg({ ok: true, text: "Theme applied to all users." });
    } catch {
      setApplyMsg({ ok: false, text: "Failed to save - try again." });
    } finally {
      setApplyBusy(false);
    }
  }

  function selectTheme(id: string) {
    const p = THEME_PRESETS[id];
    update({ themeId: id, brandOverride: null, brand2Override: null });
    setBrandLocal(p.vars["--brand"]);
    setBrand2Local(p.vars["--brand2"]);
  }

  function applyBrand(color: string) { setBrandLocal(color); update({ brandOverride: color }); }
  function applyBrand2(color: string) { setBrand2Local(color); update({ brand2Override: color }); }

  function setPinColor(type: string, color: string) {
    update({ pinColors: { ...settings.pinColors, [type]: color } });
  }

  function handleReset() {
    reset();
    const def = THEME_PRESETS["dark-ocean"];
    setBrandLocal(def.vars["--brand"]);
    setBrand2Local(def.vars["--brand2"]);
  }

  // ── Custom presets ──
  // A custom preset is "active" when the live style exactly matches its
  // snapshot. Comparing JSON is safe here: both sides come from pickStyle(),
  // which writes keys in a fixed order.
  const currentStyle = JSON.stringify(pickStyle(settings));
  const activeCustomId =
    customPresets.find((c) => JSON.stringify(c.style) === currentStyle)?.id ?? null;

  function selectCustom(c: CustomPreset) {
    update(c.style);
    const v = styleVars(c.style);
    setBrandLocal(v["--brand"]);
    setBrand2Local(v["--brand2"]);
  }

  function saveCurrentAsPreset() {
    const label = newName.trim();
    if (!label) return;
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `cp_${Date.now()}`;
    const next: CustomPreset = {
      id,
      label,
      emoji: newEmoji.trim() || "🎨",
      style: pickStyle(settings),
    };
    const list = [...customPresets, next];
    setCustomPresets(list);
    persistCustomPresets(list);
    setNewName("");
    setNewEmoji("🎨");
    setSaveOpen(false);
  }

  function deleteCustom(id: string) {
    const list = customPresets.filter((c) => c.id !== id);
    setCustomPresets(list);
    persistCustomPresets(list);
  }

  return (
    <div>
      {/* ── Theme templates ── */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Theme Template</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
          {Object.entries(THEME_PRESETS).map(([id, p]) => {
            const active = !activeCustomId && settings.themeId === id;
            return (
              <button
                key={id}
                onClick={() => selectTheme(id)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                  padding: "14px 10px",
                  background: p.vars["--card"],
                  border: `2px solid ${active ? p.vars["--brand"] : p.vars["--border"]}`,
                  borderRadius: "var(--btn-r)", cursor: "pointer",
                  color: p.vars["--text"], fontFamily: "var(--font)",
                }}
              >
                <div style={{ display: "flex", gap: 4 }}>
                  {[p.vars["--brand"], p.vars["--brand2"], p.vars["--bg"]].map((c, i) => (
                    <div key={i} style={{ width: 14, height: 14, borderRadius: "50%", background: c, border: "1px solid rgba(255,255,255,0.15)" }} />
                  ))}
                </div>
                <span style={{ fontSize: 18 }}>{p.emoji}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: p.vars["--text"] }}>{p.label}</span>
                {active && <span style={{ fontSize: 10, color: p.vars["--brand"], fontWeight: 700 }}>ACTIVE</span>}
              </button>
            );
          })}

          {/* Custom (device-local) presets - same tile, plus a delete control.
              A div, not a button, so the delete control can nest inside it. */}
          {customPresets.map((c) => {
            const v = styleVars(c.style);
            const active = activeCustomId === c.id;
            return (
              <div
                key={c.id}
                onClick={() => selectCustom(c)}
                role="button"
                style={{
                  position: "relative",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                  padding: "14px 10px",
                  background: v["--card"],
                  border: `2px solid ${active ? v["--brand"] : v["--border"]}`,
                  borderRadius: "var(--btn-r)", cursor: "pointer",
                  color: v["--text"], fontFamily: "var(--font)",
                }}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); deleteCustom(c.id); }}
                  title="Delete preset"
                  aria-label={`Delete ${c.label} preset`}
                  style={{
                    position: "absolute", top: 4, right: 4,
                    width: 22, height: 22, padding: 0, lineHeight: 1,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, borderRadius: "50%",
                    background: "rgba(0,0,0,0.35)", color: v["--muted"],
                    border: `1px solid ${v["--border"]}`, cursor: "pointer",
                  }}
                >
                  ✕
                </button>
                <div style={{ display: "flex", gap: 4 }}>
                  {[v["--brand"], v["--brand2"], v["--bg"]].map((col, i) => (
                    <div key={i} style={{ width: 14, height: 14, borderRadius: "50%", background: col, border: "1px solid rgba(255,255,255,0.15)" }} />
                  ))}
                </div>
                <span style={{ fontSize: 18 }}>{c.emoji}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: v["--text"], textAlign: "center" }}>{c.label}</span>
                {active && <span style={{ fontSize: 10, color: v["--brand"], fontWeight: 700 }}>ACTIVE</span>}
              </div>
            );
          })}
        </div>

        {/* Save the current look as a reusable preset */}
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          {!saveOpen ? (
            <button onClick={() => setSaveOpen(true)} style={{ fontSize: 13 }}>
              ＋ Save current theme as preset
            </button>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              <label className="small">Name this theme preset</label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  value={newEmoji}
                  onChange={(e) => setNewEmoji(e.target.value)}
                  maxLength={2}
                  aria-label="Preset icon"
                  style={{ width: 56, textAlign: "center", fontSize: 18, flexShrink: 0 }}
                />
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Company Blue"
                  style={{ flex: 1, fontSize: 14 }}
                />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btnPrimary"
                  onClick={saveCurrentAsPreset}
                  disabled={!newName.trim()}
                  style={{ fontSize: 13 }}
                >
                  Save preset
                </button>
                <button
                  onClick={() => { setSaveOpen(false); setNewName(""); setNewEmoji("🎨"); }}
                  style={{ fontSize: 13 }}
                >
                  Cancel
                </button>
              </div>
              <div className="small" style={{ color: "var(--muted)" }}>
                Saved on this device. To push a look to every crew member, select it
                and use “Apply to all users” at the bottom of this page.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Text contrast + logo variant ── */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Text Color</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
          Override body text for readability on customized themes.
        </div>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          {([
            { id: "preset", label: "Use preset" },
            { id: "light", label: "Light text" },
            { id: "dark", label: "Dark text" },
          ] as const).map((opt) => {
            const active = settings.textMode === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => update({ textMode: opt.id })}
                style={{
                  border: `2px solid ${active ? "var(--brand)" : "var(--border)"}`,
                  color: active ? "var(--brand)" : "var(--muted)",
                  fontWeight: active ? 700 : 600,
                  padding: "8px 16px",
                  fontSize: 13,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="small" style={{ color: "var(--text)", marginTop: 12 }}>
          Sample body text at this setting - a quick brown fox jumps over the lazy dog.
        </div>
      </div>

      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Logo Variant</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
          "Auto" picks the light logo for dark themes and the dark logo for the
          Light preset. Drop replacements at <code>frontend/src/assets/logo_light.png</code>
          and <code>logo_dark.png</code>.
        </div>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          {([
            { id: "auto", label: "Auto (match theme)" },
            { id: "light", label: "Light logo" },
            { id: "dark", label: "Dark logo" },
          ] as const).map((opt) => {
            const active = settings.logoMode === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => update({ logoMode: opt.id })}
                style={{
                  border: `2px solid ${active ? "var(--brand)" : "var(--border)"}`,
                  color: active ? "var(--brand)" : "var(--muted)",
                  fontWeight: active ? 700 : 600,
                  padding: "8px 16px",
                  fontSize: 13,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Button colors ── */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Button Colors</div>
        <div className="col" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
            <div className="col" style={{ gap: 6, flex: 1, minWidth: 140 }}>
              <label className="small">Primary color</label>
              <div className="row" style={{ gap: 8 }}>
                <input type="color" value={brandLocal} onChange={(e) => applyBrand(e.target.value)}
                  style={{ width: 44, height: 36, padding: 2, cursor: "pointer" }} />
                <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>{brandLocal}</span>
              </div>
            </div>
            <div className="col" style={{ gap: 6, flex: 1, minWidth: 140 }}>
              <label className="small">Accent color</label>
              <div className="row" style={{ gap: 8 }}>
                <input type="color" value={brand2Local} onChange={(e) => applyBrand2(e.target.value)}
                  style={{ width: 44, height: 36, padding: 2, cursor: "pointer" }} />
                <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>{brand2Local}</span>
              </div>
            </div>
          </div>
          <div className="col" style={{ gap: 8 }}>
            <label className="small">Preview</label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btnPrimary"
                style={{ background: `linear-gradient(90deg, ${brandLocal}, ${brand2Local})`, pointerEvents: "none", fontSize: 13 }}>
                Primary Button
              </button>
              <button style={{ borderColor: brandLocal, color: brandLocal, fontSize: 13, pointerEvents: "none" }}>
                Outline Button
              </button>
              <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: `${brandLocal}22`, color: brandLocal }}>
                Badge
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Button style ── */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Button Style</div>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          {RADIUS_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => update({ btnRadius: opt.value })}
              style={{
                borderRadius: opt.value,
                border: `2px solid ${settings.btnRadius === opt.value ? "var(--brand)" : "var(--border)"}`,
                color: settings.btnRadius === opt.value ? "var(--brand)" : "var(--muted)",
                fontWeight: settings.btnRadius === opt.value ? 700 : 600,
                padding: "8px 18px", fontSize: 13,
              }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Button background & size ── */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Button Background</div>
        <div className="col" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
            <div className="col" style={{ gap: 6, flex: 1, minWidth: 140 }}>
              <label className="small">Gradient start</label>
              <div className="row" style={{ gap: 8 }}>
                <input type="color" value={settings.btnBgFrom}
                  onChange={(e) => update({ btnBgFrom: e.target.value })}
                  style={{ width: 44, height: 36, padding: 2, cursor: "pointer" }} />
                <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>{settings.btnBgFrom}</span>
              </div>
            </div>
            <div className="col" style={{ gap: 6, flex: 1, minWidth: 140 }}>
              <label className="small">Gradient end</label>
              <div className="row" style={{ gap: 8 }}>
                <input type="color" value={settings.btnBgTo}
                  onChange={(e) => update({ btnBgTo: e.target.value })}
                  style={{ width: 44, height: 36, padding: 2, cursor: "pointer" }} />
                <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>{settings.btnBgTo}</span>
              </div>
            </div>
          </div>
          <div className="col" style={{ gap: 8 }}>
            <label className="small">Button size</label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {(["sm", "md", "lg"] as const).map((sz) => {
                const active = settings.btnSize === sz;
                return (
                  <button key={sz} onClick={() => update({ btnSize: sz })}
                    style={{
                      fontSize: 13, padding: sz === "sm" ? "6px 14px" : sz === "lg" ? "14px 24px" : "10px 18px",
                      border: `2px solid ${active ? "var(--brand)" : "var(--border)"}`,
                      color: active ? "var(--brand)" : "var(--muted)",
                      fontWeight: active ? 700 : 600,
                    }}>
                    {sz === "sm" ? "Small" : sz === "md" ? "Medium" : "Large"}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <label className="small">Preview</label>
            <button style={{
              background: `linear-gradient(180deg, ${settings.btnBgFrom}, ${settings.btnBgTo})`,
              pointerEvents: "none",
              fontSize: 13,
              alignSelf: "flex-start",
            }}>
              Sample Button
            </button>
          </div>
        </div>
      </div>

      {/* ── Font ── */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Font Family</div>
        <div className="col" style={{ gap: 10 }}>
          {FONT_OPTIONS.map((opt) => {
            const active = settings.fontValue === opt.value;
            return (
              <button key={opt.value} onClick={() => update({ fontValue: opt.value })}
                style={{
                  fontFamily: opt.value, textAlign: "left",
                  border: `2px solid ${active ? "var(--brand)" : "var(--border)"}`,
                  color: active ? "var(--brand)" : "var(--text)",
                  fontWeight: active ? 700 : 500, padding: "10px 14px", fontSize: 14,
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                <span>{opt.label}</span>
                <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: opt.value }}>The quick brown fox</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Appearance ── */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Appearance</div>
        <div className="col" style={{ gap: 18 }}>

          {/* Shadow */}
          <div className="col" style={{ gap: 8 }}>
            <label className="small">Card shadow</label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {SHADOW_OPTIONS.map((opt) => {
                const active = settings.cardShadow === opt.value;
                return (
                  <button key={opt.label} onClick={() => update({ cardShadow: opt.value })}
                    style={{
                      fontSize: 13, padding: "7px 16px",
                      border: `2px solid ${active ? "var(--brand)" : "var(--border)"}`,
                      color: active ? "var(--brand)" : "var(--muted)",
                      fontWeight: active ? 700 : 600,
                    }}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Density */}
          <div className="col" style={{ gap: 8 }}>
            <label className="small">Content density</label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {DENSITY_OPTIONS.map((opt) => {
                const active = settings.density === opt.label;
                return (
                  <button key={opt.label} onClick={() => update({ density: opt.label })}
                    style={{
                      fontSize: 13, padding: "7px 16px",
                      border: `2px solid ${active ? "var(--brand)" : "var(--border)"}`,
                      color: active ? "var(--brand)" : "var(--muted)",
                      fontWeight: active ? 700 : 600,
                    }}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Card glow */}
          <div className="row" style={{ gap: 12 }}>
            <button
              onClick={() => update({ cardGlow: !settings.cardGlow })}
              style={{
                fontSize: 13, padding: "7px 16px",
                border: `2px solid ${settings.cardGlow ? "var(--brand)" : "var(--border)"}`,
                color: settings.cardGlow ? "var(--brand)" : "var(--muted)",
                fontWeight: settings.cardGlow ? 700 : 600,
              }}>
              {settings.cardGlow ? "Card Glow ON" : "Card Glow OFF"}
            </button>
            <span className="small">Tints card borders with the primary color</span>
          </div>

        </div>
      </div>

      {/* ── Map Pins ── */}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Map Pins</div>
        <div className="col" style={{ gap: 16 }}>

          {/* Pin size */}
          <div className="col" style={{ gap: 8 }}>
            <label className="small">Pin size - {settings.pinSize * 2}px</label>
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <input
                type="range" min={5} max={16} step={1}
                value={settings.pinSize}
                onChange={(e) => update({ pinSize: Number(e.target.value) })}
                style={{ flex: 1, accentColor: "var(--brand)" }}
              />
              {/* Live preview dot */}
              <div style={{
                width: settings.pinSize * 2, height: settings.pinSize * 2,
                borderRadius: "50%", background: "var(--brand)",
                border: "2px solid rgba(255,255,255,0.8)", flexShrink: 0,
                boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
              }} />
            </div>
          </div>

          {/* Pin colors per event type */}
          <div className="col" style={{ gap: 6 }}>
            <label className="small">Color by event type</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
              {PIN_EVENT_TYPES.map((type) => (
                <div key={type} className="row" style={{ gap: 8, padding: "8px 10px", borderRadius: "var(--btn-r)", border: "1px solid var(--border)", background: "rgba(255,255,255,0.02)" }}>
                  <input
                    type="color"
                    value={settings.pinColors[type] ?? DEFAULT_PIN_COLORS[type]}
                    onChange={(e) => setPinColor(type, e.target.value)}
                    style={{ width: 32, height: 32, padding: 2, cursor: "pointer", borderRadius: "50%", border: "none", background: "none" }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      width: settings.pinSize * 2, height: settings.pinSize * 2,
                      borderRadius: "50%", flexShrink: 0,
                      background: settings.pinColors[type] ?? DEFAULT_PIN_COLORS[type],
                      border: "2px solid rgba(255,255,255,0.7)",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                    }} />
                    <span style={{ fontSize: 12, fontWeight: 600, textTransform: "capitalize" }}>{type}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* ── Apply to all users ── */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="small" style={{ color: "var(--muted)" }}>
          Save your current theme settings as the global default - all crew members will see this theme on their next page load.
        </div>
        {applyMsg && (
          <div style={{ fontSize: 13, color: applyMsg.ok ? "var(--ok)" : "var(--danger)" }}>
            {applyMsg.ok ? "✓ " : ""}{applyMsg.text}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button className="btnPrimary" onClick={applyToAllUsers} disabled={applyBusy} style={{ fontSize: 13 }}>
            {applyBusy ? "Saving…" : "Apply to all users"}
          </button>
          <button onClick={handleReset} style={{ color: "var(--danger)", borderColor: "var(--danger)", fontSize: 13 }}>
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Sheet sync - admin "Refresh" button. Picks up events that landed in
// Postgres but never reached the sheet (Sheets API blip on the live sync
// path swallows the error silently). The endpoint is idempotent.
// ─────────────────────────────────────────
function SheetSyncCard() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<{
        ok: boolean;
        found: number;
        exported: number;
        errors: number;
        duration_ms: number;
      }>("/api/admin/sheets/reconcile-events", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const secs = (r.duration_ms / 1000).toFixed(1);
      const text =
        r.found === 0
          ? `Sheet is in sync - nothing to recover (${secs}s)`
          : `Recovered ${r.exported}/${r.found} event(s)` +
            (r.errors > 0 ? `, ${r.errors} error(s)` : "") +
            ` (${secs}s)`;
      setMsg({ ok: r.errors === 0, text });
    } catch (e) {
      const detail = e instanceof ApiError ? e.message : "Request failed";
      setMsg({ ok: false, text: detail });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="microLabel" style={{ marginBottom: 10 }}>Sheet Sync</div>
      <div className="small" style={{ color: "var(--muted)" }}>
        Re-export any events that are durable in the app database but missing from the Google Sheet.
        Safe to run any time - duplicates are skipped automatically.
      </div>
      {msg && (
        <div style={{ fontSize: 13, color: msg.ok ? "var(--ok)" : "var(--danger)" }}>
          {msg.ok ? "✓ " : ""}{msg.text}
        </div>
      )}
      <button
        onClick={refresh}
        disabled={busy}
        className="btnPrimary"
        style={{ alignSelf: "flex-start", fontSize: 13 }}
      >
        {busy ? "Refreshing…" : "Refresh sheet from app data"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────
// App Health - quick read on the moving parts: client outbox state, server
// reachability, Google API access, sheet drift, event freshness, env vars.
// Plain-text summary in a collapsible block so an admin can paste it into a
// support thread.
//
// LocalStorage keys must match App.tsx. Keeping them as string literals
// (rather than imports) so this card stays self-contained - App.tsx is the
// source of truth, and a future rename there is a one-line search away.
// ─────────────────────────────────────────
const HC_QUEUE_KEY = "crew_event_queue_v1";
const HC_NOTE_PATCH_KEY = "crew_event_note_patch_queue_v1";

type HealthCheck = { name: string; status: "ok" | "warn" | "fail"; detail: string };
type ServerHealth = {
  ok: boolean;
  overall: "ok" | "warn" | "fail";
  generated_at: string;
  checks: HealthCheck[];
};

function AppHealthCard() {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  async function runCheck() {
    setBusy(true);
    try {
      const clientChecks = collectClientChecks();
      let serverChecks: HealthCheck[] | null = null;
      let serverOverall: "ok" | "warn" | "fail" | "unknown" = "unknown";
      let serverErr: string | null = null;
      try {
        const r = await apiFetch<ServerHealth>("/api/admin/health");
        serverChecks = r.checks;
        serverOverall = r.overall;
      } catch (e) {
        serverErr = e instanceof ApiError ? e.message : "Backend unreachable";
      }
      setReport(formatReport(clientChecks, serverChecks, serverOverall, serverErr));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="microLabel" style={{ marginBottom: 10 }}>App Health</div>
      <div className="small" style={{ color: "var(--muted)" }}>
        Snapshot of critical functions - sync state, network, Google API access, data drift. Plain text so you can copy/paste it.
      </div>
      <button
        onClick={runCheck}
        disabled={busy}
        className="btnPrimary"
        style={{ alignSelf: "flex-start", fontSize: 13 }}
      >
        {busy ? "Running…" : "Run health check"}
      </button>
      {report !== null && (
        <details open style={{ marginTop: 4 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>
            Result
          </summary>
          <pre
            style={{
              marginTop: 8,
              padding: 12,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: 12,
              lineHeight: 1.5,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border)",
              borderRadius: "var(--btn-r)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 480,
              overflow: "auto",
            }}
          >
            {report}
          </pre>
        </details>
      )}
    </div>
  );
}

function collectClientChecks(): HealthCheck[] {
  const out: HealthCheck[] = [];

  out.push({
    name: "Online",
    status: navigator.onLine ? "ok" : "warn",
    detail: navigator.onLine ? "yes" : "device is offline",
  });

  // localStorage availability - Safari private mode and some kiosk profiles
  // throw on write. Catch and report so admins see why a queue might be lost.
  try {
    const probe = "__hc_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    out.push({ name: "localStorage", status: "ok", detail: "writable" });
  } catch (e) {
    out.push({
      name: "localStorage",
      status: "fail",
      detail: `not writable - offline queue won't persist (${(e as Error).message})`,
    });
  }

  out.push(describeQueue("Outbox", HC_QUEUE_KEY, "events queued"));
  out.push(describeQueue("Note patches", HC_NOTE_PATCH_KEY, "patches pending"));

  return out;
}

type QueuedItem = { timestamp?: string; enqueued_at?: string };

function describeQueue(name: string, key: string, unit: string): HealthCheck {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return { name, status: "warn", detail: "could not read localStorage" };
  }
  if (!raw) return { name, status: "ok", detail: `0 ${unit}` };
  let parsed: QueuedItem[] = [];
  try {
    const data: unknown = JSON.parse(raw);
    if (Array.isArray(data)) parsed = data as QueuedItem[];
  } catch {
    return { name, status: "warn", detail: "queue payload is not JSON - manual cleanup may be needed" };
  }
  if (parsed.length === 0) return { name, status: "ok", detail: `0 ${unit}` };

  // Oldest item - events use "timestamp", note patches use "enqueued_at"
  const ages = parsed
    .map((it) => Date.parse(it?.timestamp || it?.enqueued_at || ""))
    .filter((t: number) => Number.isFinite(t));
  const oldest = ages.length ? Math.min(...ages) : Date.now();
  const ageMin = (Date.now() - oldest) / 60000;
  const ageDesc =
    ageMin < 1 ? "<1 min" :
    ageMin < 60 ? `${Math.round(ageMin)} min` :
    ageMin < 60 * 24 ? `${(ageMin / 60).toFixed(1)} h` :
    `${(ageMin / 60 / 24).toFixed(1)} d`;
  // Stale-queue threshold mirrors QUEUE_MAX_AGE_DAYS in App.tsx (14 days).
  const status: "ok" | "warn" | "fail" =
    ageMin > 60 * 24 * 7 ? "fail" :
    ageMin > 60 * 24 ? "warn" :
    "ok";
  return { name, status, detail: `${parsed.length} ${unit} - oldest ${ageDesc}` };
}

function formatReport(
  clientChecks: HealthCheck[],
  serverChecks: HealthCheck[] | null,
  serverOverall: "ok" | "warn" | "fail" | "unknown",
  serverErr: string | null,
): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZoneName: "short",
  });
  const header = `App Health  ·  generated ${fmt.format(new Date())}`;
  const overall = computeOverall(clientChecks, serverChecks, serverErr);

  const lines: string[] = [];
  lines.push(header);
  lines.push(`Overall: ${overall.toUpperCase()}`);
  lines.push("");
  lines.push("CLIENT");
  for (const c of clientChecks) lines.push(`  [${tag(c.status)}] ${c.name}: ${c.detail}`);
  lines.push("");
  if (serverErr) {
    lines.push(`SERVER  ·  unreachable: ${serverErr}`);
  } else if (serverChecks) {
    lines.push(`SERVER  ·  overall: ${serverOverall}`);
    for (const c of serverChecks) lines.push(`  [${tag(c.status)}] ${c.name}: ${c.detail}`);
  }
  return lines.join("\n");
}

function tag(status: "ok" | "warn" | "fail"): string {
  if (status === "ok") return "OK  ";
  if (status === "warn") return "WARN";
  return "FAIL";
}

function computeOverall(
  clientChecks: HealthCheck[],
  serverChecks: HealthCheck[] | null,
  serverErr: string | null,
): "ok" | "warn" | "fail" {
  const all = [...clientChecks, ...(serverChecks ?? [])];
  if (serverErr) return "fail";
  if (all.some((c) => c.status === "fail")) return "fail";
  if (all.some((c) => c.status === "warn")) return "warn";
  return "ok";
}

// ─────────────────────────────────────────
// Advanced Settings page
// ─────────────────────────────────────────
function AdvancedSettingsPage() {
  return (
    <div>
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Google Calendar</div>
        <CalendarTab />
      </div>

      <CrewResourcesCard />

      <DataManagementCard />

      {/* Sync & Accuracy: one group of tools that answer "is the app healthy
          and is the Sheet an accurate mirror of the server, and fix it if not".
          App Health now folds in a live record-drift audit, so it WARNs when the
          Sheet is out of sync; the cards below drill into and fix that drift.
          Order: connection + structural check, record drift + re-send, then the
          overall health snapshot. */}
      <div className="microLabel" style={{ margin: "18px 0 4px" }}>Sync &amp; Accuracy</div>
      <div className="small" style={{ color: "var(--muted)", margin: "0 0 6px" }}>
        Audit and fix app and record accuracy. App Health flags when the Sheet is
        out of sync with the server; the tools below show what is missing and why,
        and re-send it.
      </div>
      <SheetSyncCard />
      <SheetSyncHealthCard />
      <SheetBackfillCard />
      <AppHealthCard />

      {/* Diagnostics last and collapsed by default - admin only goes here
          when something looks off. Keeps the operational cards above it
          uncluttered. */}
      <DiagnosticsCard />
    </div>
  );
}

// Reports whether the staging dev tools made it into the running build.
//
// VITE_STAGING is inlined by Vite at build time, and when it is missing the
// "Preview as role" pill renders nothing: no error, no console warning, it is
// simply absent. That failure mode cost us the ability to check what a non-rater
// sees on the Job Report, and it is invisible from inside the app. So say it out
// loud, here, where an admin already goes to ask "why is this not working".
//
// Setting the var in Vercel is NOT enough on its own: the build bakes it in, so
// the staging project has to be redeployed before this flips to enabled.
function StagingToolsCheck() {
  const enabled = import.meta.env.VITE_STAGING === "true";
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>
        Staging dev tools
      </div>
      <div className="small" style={{ color: enabled ? "var(--ok)" : "var(--muted)" }}>
        {enabled ? (
          <>
            ✓ Enabled. The <strong>VIEW AS</strong> pill at the bottom of the screen
            previews the app as Crew, Crew Lead, or Skill Rater.
          </>
        ) : (
          <>
            Off. <code>VITE_STAGING</code> was not <code>true</code> when this build was
            made, so the "Preview as role" pill is not rendering. On the staging project:
            set <code>VITE_STAGING=true</code> in Vercel and <strong>redeploy</strong>
            {" "}(the value is baked in at build time, so setting it alone changes nothing).
            This is expected to be off on production.
          </>
        )}
      </div>
      <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>
        Note: previewing a role changes only what this browser renders. Your token is
        still an admin token, so it does not test whether the server refuses the write.
        For that, log in as a real crew account.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Sheet-sync health check (System Check)
// Verifies every app->sheet sync in one place. New feature syncs are picked up
// automatically from the backend registry (SHEET_SYNC_REGISTRY).
// ─────────────────────────────────────────
type SyncCheck = {
  key: string;
  label: string;
  tab: string;
  env_var: string;
  env_set: boolean;
  tab_exists: boolean;
  never_synced?: boolean;
  failing?: boolean;
  needs_attention?: boolean;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
};
type SheetSyncHealth = {
  spreadsheet_id: string;
  connected: boolean;
  error: string | null;
  ok?: boolean;
  syncs: SyncCheck[];
};

function SheetSyncHealthCard() {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<SheetSyncHealth | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null); setData(null);
    try {
      setData(await apiFetch<SheetSyncHealth>("/api/admin/system-check/sheets"));
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Health check failed");
    } finally { setBusy(false); }
  }

  // Current state only. A sync that failed once and has succeeded since is not a
  // problem, and a tab that doesn't exist yet because the feature has never been
  // used isn't either (_ensure_tab creates it on the first write). Flagging both
  // made the panel cry wolf on ~half the registry.
  const problems = data?.syncs.filter(
    (s) => s.needs_attention ?? (!s.tab_exists || !!s.last_error_at),
  ) ?? [];
  const pending = data?.syncs.filter((s) => !s.tab_exists && s.never_synced) ?? [];

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 10 }}>System Check - Sheet Syncs</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
        Verifies the Google Sheets connection and that every app→sheet sync has its
        worksheet tab and a valid config. Run this after adding a feature that
        writes to the sheet, or if data looks like it stopped syncing.
      </div>
      <button onClick={run} disabled={busy} className="btnPrimary" style={{ padding: "6px 14px", fontSize: 13 }}>
        {busy ? "Checking…" : "Run check"}
      </button>

      {err && <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}

      <StagingToolsCheck />

      {data && (
        <div style={{ marginTop: 12 }}>
          <div className="small" style={{ marginBottom: 8, fontWeight: 700, color: data.connected ? "var(--ok)" : "var(--danger)" }}>
            {data.connected
              ? (problems.length === 0 ? "✓ Connected - all syncs healthy" : `⚠ Connected - ${problems.length} sync(s) need attention`)
              : `✗ Not connected: ${data.error || "unknown error"}`}
          </div>
          {data.connected && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                    <th style={{ padding: "4px 6px" }}>Sync</th>
                    <th style={{ padding: "4px 6px" }}>Tab</th>
                    <th style={{ padding: "4px 6px" }}>Exists</th>
                    <th style={{ padding: "4px 6px" }}>Env set</th>
                    <th style={{ padding: "4px 6px" }}>Last sync</th>
                  </tr>
                </thead>
                <tbody>
                  {data.syncs.map((s) => (
                    <tr key={s.key} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "4px 6px" }}>{s.label}</td>
                      <td style={{ padding: "4px 6px", fontFamily: "monospace" }}>{s.tab}</td>
                      <td
                        style={{
                          padding: "4px 6px",
                          fontWeight: 700,
                          color: s.tab_exists
                            ? "var(--ok)"
                            : s.never_synced ? "var(--muted)" : "var(--danger)",
                        }}
                        title={
                          s.tab_exists
                            ? ""
                            : s.never_synced
                              ? "Nothing has synced here yet - the tab is created automatically on the first write."
                              : "This sync has written before but its tab is gone - check the tab name in the sheet."
                        }
                      >
                        {s.tab_exists ? "✓" : s.never_synced ? "not yet" : "missing"}
                      </td>
                      <td style={{ padding: "4px 6px", color: s.env_set ? "var(--text)" : "var(--warn)" }} title={s.env_set ? "" : `${s.env_var} not set - using default tab`}>
                        {s.env_set ? "yes" : "default"}
                      </td>
                      <td style={{ padding: "4px 6px", color: s.failing ? "var(--danger)" : "var(--muted)" }}>
                        {s.failing && s.last_error_at
                          ? `error ${new Date(s.last_error_at).toLocaleString()}`
                          : s.last_ok_at ? new Date(s.last_ok_at).toLocaleString() : "-"}
                        {!s.failing && s.last_error_at && (
                          <div style={{ fontSize: 11, opacity: 0.7 }}>
                            recovered from an error {new Date(s.last_error_at).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {problems.some((s) => s.last_error) && (
            // Every failing sync, not the first three - the truncated list used to
            // hide the error of whichever sync you were actually chasing.
            <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>
              {problems.filter((s) => s.last_error).map((s) => (
                <div key={s.key} style={{ marginBottom: 4 }}>{s.label}: {s.last_error}</div>
              ))}
            </div>
          )}
          {pending.length > 0 && (
            <div className="small" style={{ color: "var(--muted)", marginTop: 8 }}>
              Not created yet (normal - the tab is added on the first sync):{" "}
              {pending.map((s) => s.label).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Sheet backfill - what never reached the Sheet, and a button to re-send it.
// The health check above answers "is this sync working now"; this answers
// "what did the outages leave behind", which the status rows cannot - they
// track one state per export function, not per record.
// ─────────────────────────────────────────
type BackfillRow = {
  key: string;
  label: string;
  tab: string;
  tab_exists: boolean;
  auto: string | null;
  in_db: number | null;
  in_sheet?: number | null;
  missing: { id: string; label: string; created_at: string }[];
  missing_count: number;
  truncated?: boolean;
  error: string | null;
  // Drain diagnostics: if the last export for this sync failed, that same error
  // is why its missing records will not re-send - surfaced so a stuck record
  // reads as "export is throwing: <reason>" instead of "re-send did nothing".
  failing?: boolean;
  last_error?: string | null;
  last_error_at?: string | null;
};
type BackfillAudit = {
  spreadsheet_id: string;
  connected: boolean;
  error: string | null;
  total_missing?: number;
  results: BackfillRow[];
};

function SheetBackfillCard() {
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [data, setData] = useState<BackfillAudit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null); setNote(null);
    try {
      setData(await apiFetch<BackfillAudit>("/api/admin/system-check/sheet-backfill"));
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Audit failed");
    } finally { setBusy(false); }
  }

  async function resend(row: BackfillRow) {
    setSending(row.key); setErr(null); setNote(null);
    try {
      const res = await apiFetch<{ queued: number; skipped: number; not_queued: number; cap: number }>(
        "/api/admin/system-check/sheet-backfill",
        { method: "POST", body: JSON.stringify({ key: row.key }) },
      );
      setNote(
        `${row.label}: queued ${res.queued} record(s)` +
        (res.skipped ? `, ${res.skipped} skipped` : "") +
        (res.not_queued ? `, ${res.not_queued} left over (cap ${res.cap} per run - run it again)` : "") +
        ". Exports run in the background; re-run the audit in a minute to confirm.",
      );
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Re-export failed");
    } finally { setSending(null); }
  }

  const withMissing = data?.results.filter((r) => r.missing_count > 0) ?? [];
  const errored = data?.results.filter((r) => r.error) ?? [];

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 10 }}>Sheet Backfill - what never made it</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
        Compares the database against the Sheet and lists records that were saved
        but whose sheet row is missing - usually the leftovers of a sync outage.
        Nothing is lost when this happens: the app is the system of record and the
        Sheet is a mirror. Read-only until you press Re-send.
      </div>
      <button onClick={run} disabled={busy} className="btnPrimary" style={{ padding: "6px 14px", fontSize: 13 }}>
        {busy ? "Comparing…" : "Run audit"}
      </button>

      {err && <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}
      {note && <div className="small" style={{ color: "var(--ok)", marginTop: 8 }}>{note}</div>}

      {data && (
        <div style={{ marginTop: 12 }}>
          <div className="small" style={{ marginBottom: 8, fontWeight: 700,
            color: !data.connected ? "var(--danger)" : (data.total_missing ? "var(--warn)" : "var(--ok)") }}>
            {!data.connected
              ? `✗ Not connected: ${data.error || "unknown error"}`
              : data.total_missing
                ? `${data.total_missing} record(s) missing from the Sheet`
                : "✓ Every record is in the Sheet"}
          </div>

          {data.connected && withMissing.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                    <th style={{ padding: "4px 6px" }}>Sync</th>
                    <th style={{ padding: "4px 6px" }}>In app</th>
                    <th style={{ padding: "4px 6px" }}>Missing</th>
                    <th style={{ padding: "4px 6px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {withMissing.map((r) => (
                    <Fragment key={r.key}>
                      <tr style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "4px 6px" }}>
                          {r.label}
                          <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>{r.tab}</div>
                          {r.failing && r.last_error && (
                            <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 2 }}
                              title="The export is failing, so re-sending will not land these until this is fixed.">
                              ⚠ export failing: {r.last_error}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "4px 6px" }}>{r.in_db ?? "-"}</td>
                        <td style={{ padding: "4px 6px", color: "var(--danger)", fontWeight: 700 }}>
                          {r.missing_count}
                        </td>
                        <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>
                          <button
                            className="btnGhost"
                            style={{ padding: "3px 8px", fontSize: 12, marginRight: 6 }}
                            onClick={() => setOpen(open === r.key ? null : r.key)}
                          >
                            {open === r.key ? "Hide" : "Show"}
                          </button>
                          <button
                            className="btnPrimary"
                            style={{ padding: "3px 8px", fontSize: 12 }}
                            disabled={sending !== null}
                            onClick={() => resend(r)}
                          >
                            {sending === r.key ? "Sending…" : "Re-send"}
                          </button>
                        </td>
                      </tr>
                      {open === r.key && (
                        <tr>
                          <td colSpan={4} style={{ padding: "0 6px 8px" }}>
                            <div style={{ maxHeight: 200, overflowY: "auto", fontSize: 11 }}>
                              {r.missing.map((m) => (
                                <div key={m.id} style={{ color: "var(--muted)", padding: "2px 0" }}>
                                  {m.created_at ? `${new Date(m.created_at).toLocaleDateString()} - ` : ""}
                                  {m.label || m.id}
                                </div>
                              ))}
                              {r.truncated && (
                                <div style={{ color: "var(--warn)", paddingTop: 4 }}>
                                  …list truncated. The count above is exact; Re-send handles them in batches.
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {errored.length > 0 && (
            <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>
              {errored.map((r) => (
                <div key={r.key} style={{ marginBottom: 4 }}>{r.label}: {r.error}</div>
              ))}
            </div>
          )}

          {data.connected && (
            <div className="small" style={{ color: "var(--muted)", marginTop: 8 }}>
              Timeline events and BOLs are not listed: the auto-reconciler already
              backfills those every 5 minutes.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Crew Resources event refresh
// ─────────────────────────────────────────
function CrewResourcesCard() {
  const [busy, setBusy] = useState(false);
  const [daysAhead, setDaysAhead] = useState<number>(14);
  type ResultRow = {
    ok: boolean;
    date: string;
    created?: boolean;
    available_count?: number;
    scheduled_count?: number;
    reason?: string;
    error?: string;
  };
  type Summary = {
    ok: boolean;
    days: number;
    succeeded: number;
    results: ResultRow[];
  };
  const [result, setResult] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await apiFetch<Summary>(
        `/api/admin/crew-resources/refresh?days_ahead=${encodeURIComponent(daysAhead)}`,
        { method: "POST" },
      );
      setResult(r);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to refresh");
    } finally {
      setBusy(false);
    }
  }

  const failedSample = result?.results.filter((r) => !r.ok).slice(0, 3) ?? [];

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 10 }}>Crew Resources events</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
        Force a refresh of the daily 5–6 AM "Crew Resources" events on the
        Resources calendar. Events for today through today + N are created
        if missing and otherwise patched with the latest description (crew
        availability + scheduled blocks from the Jobs calendar). The hourly
        background loop does the same thing automatically; this button is
        for verifying the wiring or seeding the next batch immediately.
      </div>

      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label className="small" style={{ color: "var(--muted)" }}>
          Days ahead
        </label>
        <input
          type="number"
          min={0}
          max={60}
          value={daysAhead}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setDaysAhead(Math.max(0, Math.min(60, Math.floor(n))));
          }}
          style={{
            width: 80, padding: "6px 10px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--bg)",
            color: "var(--text)", fontSize: 13, textAlign: "right",
          }}
        />
        <button
          onClick={generate}
          disabled={busy}
          className="btnPrimary"
          style={{ padding: "8px 14px", fontSize: 13 }}
        >
          {busy ? "Refreshing…" : "Generate / refresh"}
        </button>
      </div>

      {err && (
        <div className="small" style={{ color: "var(--danger)", marginTop: 10 }}>
          {err}
        </div>
      )}
      {result && (
        <div style={{ marginTop: 10 }}>
          <div
            className="small"
            style={{
              color: result.succeeded === result.days ? "var(--ok)" : "var(--muted)",
              fontWeight: 700,
            }}
          >
            {result.succeeded} of {result.days} day(s) refreshed.
          </div>
          {failedSample.length > 0 && (
            <div className="small" style={{ color: "var(--danger)", marginTop: 6 }}>
              First few failures:
              <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                {failedSample.map((r) => (
                  <li key={r.date} style={{ marginBottom: 2 }}>
                    {r.date}: {r.error || r.reason || "unknown error"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.succeeded === result.days && result.days > 0 && (
            <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
              Open the Resources calendar in Google Calendar - events should
              be present for the next {result.days} day(s) at 5–6 AM.
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ─────────────────────────────────────────
// Diagnostics - collapsible nested card under Advanced Settings. One home
// for every read-only "is this feature wired correctly?" check. Sits below
// the operational cards so admin doesn't see it unless they go looking
// for it.
// ─────────────────────────────────────────
function DiagnosticsCard() {
  const [open, setOpen] = useState(false);

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: 0,
          textAlign: "left",
          cursor: "pointer",
          color: "var(--text)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ flex: 1 }}>
          <div className="microLabel" style={{ marginBottom: 0 }}>Diagnostics</div>
          <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
            Read-only checks of integrations wired through env vars or OAuth.
            Useful when a feature looks "set up" but isn't behaving.
          </div>
        </div>
        <div style={{ color: "var(--muted)", fontSize: 14, flexShrink: 0 }}>
          {open ? "▾" : "▸"}
        </div>
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <CrewResourcesDiagnostic />
        </div>
      )}
    </div>
  );
}

// One row of the Diagnostics card. Each sub-feature gets its own component
// so adding a new probe later is a one-line addition to DiagnosticsCard.
function CrewResourcesDiagnostic() {
  type Diagnostic = {
    enabled: boolean;
    resources_calendar_id_set: boolean;
    jobs_calendar_id_set: boolean;
    oauth: {
      ok: boolean;
      valid?: boolean;
      expired?: boolean;
      has_refresh_token?: boolean;
      scopes?: string[];
      has_calendar_read?: boolean;
      has_calendar_write?: boolean;
      error?: string;
    };
  };
  const [diag, setDiag] = useState<Diagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const d = await apiFetch<Diagnostic>("/api/admin/crew-resources/status");
      setDiag(d);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to load diagnostics");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        padding: 12,
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div className="row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Crew Resources calendar</div>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          style={{ fontSize: 12, padding: "4px 10px" }}
        >
          {busy ? "Checking…" : "Check status"}
        </button>
      </div>
      {err && (
        <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>
      )}
      {diag && (
        <div className="small" style={{ marginTop: 10, lineHeight: 1.6 }}>
          <DiagLine ok={diag.enabled}
            label={`CREW_RESOURCES_ENABLED ${diag.enabled ? "true" : "not set / false"}`}
          />
          <DiagLine ok={diag.resources_calendar_id_set}
            label={`RESOURCES_CALENDAR_ID ${diag.resources_calendar_id_set ? "set" : "missing"}`}
          />
          <DiagLine ok={diag.jobs_calendar_id_set}
            label={`JOBS_CALENDAR_ID / WORKSPACE_CALENDAR_ID ${diag.jobs_calendar_id_set ? "set" : "missing"}`}
          />
          <DiagLine ok={!!diag.oauth.ok && !!diag.oauth.valid}
            label={`OAuth token ${
              diag.oauth.ok
                ? (diag.oauth.valid ? "valid" : (diag.oauth.expired ? "expired" : "invalid"))
                : `error: ${diag.oauth.error || "unknown"}`
            }`}
          />
          <DiagLine ok={!!diag.oauth.has_calendar_write}
            label={`calendar.events write scope ${diag.oauth.has_calendar_write ? "present" : "MISSING - re-authorize OAuth"}`}
          />
          {diag.oauth.scopes && diag.oauth.scopes.length > 0 && (
            <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 11, wordBreak: "break-all" }}>
              Scopes: {diag.oauth.scopes.join(", ")}
            </div>
          )}
          {!diag.oauth.has_calendar_write && diag.oauth.ok && (
            <div style={{ marginTop: 8, color: "var(--warn)", fontSize: 12 }}>
              The stored token doesn't include <code>calendar.events</code>.
              Run <code>scripts/refresh_google_token_with_writes.py</code> locally,
              complete the OAuth flow, and paste the new token.json via Google Calendar above.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Tiny presentational helper for the diagnostic rows.
function DiagLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        aria-hidden
        style={{
          width: 10, height: 10, borderRadius: "50%",
          background: ok ? "var(--ok)" : "var(--danger)",
          flexShrink: 0,
        }}
      />
      <span style={{ color: ok ? "var(--text)" : "var(--danger)" }}>{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────
// Help text editor
// ─────────────────────────────────────────
function HelpTextCard() {
  const { settings, update } = useTheme();
  const ht = settings.helpTexts;

  function set(key: keyof HelpTexts, val: string) {
    update({ helpTexts: { ...ht, [key]: val } });
  }

  // Grouped by the page/tab the field appears on so admin can find the wording
  // they want to change by where they see it in the crew app.
  const groups: { page: string; fields: { key: keyof HelpTexts; label: string }[] }[] = [
    {
      page: "Photos tab",
      fields: [
        { key: "photosHint",                  label: "Photos tab instructions" },
        { key: "photoCaptionPlaceholder",     label: "Photo caption placeholder" },
        { key: "incidentHint",                label: "Incident reporting hint" },
        { key: "incidentDescriptionPlaceholder", label: "Incident “what happened” placeholder" },
      ],
    },
    {
      page: "Job Report tab",
      fields: [
        { key: "jobTypeHint",                 label: "Job type hint" },
        { key: "skillsHint",                  label: "Skill rating hint" },
        { key: "skillScaleHint",              label: "Star scale (what 1 and 5 mean)" },
        { key: "truckFullnessHint",           label: "Truck fullness hint" },
        { key: "overageHint",                 label: "Estimate overage hint" },
        { key: "hoursMismatchPlaceholder",    label: "Hours mismatch reason placeholder" },
        { key: "billNotesPlaceholder",        label: "Bill notes placeholder" },
      ],
    },
    {
      page: "Timeline tab",
      fields: [
        { key: "jobNotesPlaceholder",         label: "Job notes placeholder" },
        { key: "jobDescriptionPlaceholder",   label: "Manual job description placeholder" },
      ],
    },
    {
      page: "Availability page",
      fields: [
        { key: "schedulingNotesPlaceholder",     label: "Scheduling notes placeholder" },
        { key: "availabilityDayNotePlaceholder", label: "Availability day note placeholder" },
        { key: "futureAbsenceNotePlaceholder",   label: "Future absence note placeholder" },
      ],
    },
  ];

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 10 }}>Field Help Text</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>
        Placeholder and hint text shown to crew, grouped by the page it appears on.
      </div>
      <CollapsibleList className="col" style={{ gap: 18 }} moreLabel="page groups">
        {groups.map((group) => (
          <div key={group.page} className="col" style={{ gap: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13, borderBottom: "1px solid var(--border)", paddingBottom: 4 }}>
              {group.page}
            </div>
            {group.fields.map(({ key, label }) => (
              <div key={key} className="col" style={{ gap: 4 }}>
                <label className="small">{label}</label>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    value={ht[key]}
                    onChange={(e) => set(key, e.target.value)}
                    style={{ flex: 1, fontSize: 13 }}
                  />
                  <button
                    onClick={() => set(key, DEFAULT_HELP_TEXTS[key])}
                    style={{ fontSize: 11, padding: "4px 10px", color: "var(--muted)", whiteSpace: "nowrap" }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </CollapsibleList>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DVIR Review Tab - mechanic signs off on inspections
// ─────────────────────────────────────────────────────────────────────────────

type DVIRRecord = {
  id: number;
  dvir_id: string;
  vehicle_number: string;
  trailer_number: string | null;
  odometer: number | null;
  inspection_type: string;
  inspection_date: string;
  defects: string[];
  defect_notes: string | null;
  condition: string;
  driver_name: string;
  driver_signature: string;
  driver_signed_at: string;
  mechanic_name: string | null;
  mechanic_signature: string | null;
  mechanic_signed_at: string | null;
  repairs_made: boolean | null;
  mechanic_notes: string | null;
  mechanic_signature_requested_at: string | null;
  mechanic_signature_requested_email: string | null;
  created_at: string;
  needs_mechanic_review: boolean;
  // Signed-ness flags always present. The list response ships these instead of
  // the heavy base64 signatures (which it blanks); the detail view refetches the
  // single DVIR to get the real signature images.
  driver_signed: boolean;
  mechanic_signed: boolean;
};

// ─────────────────────────────────────────
// DVIR vehicle units editor
// ─────────────────────────────────────────
// Wraps a Settings config card in a collapsed-by-default disclosure so the
// admin does not see every config at once. The child card keeps its own title
// (shown when expanded); the header is the toggle.
function CollapsibleSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="col" style={{ gap: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
          background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12,
          padding: "12px 14px", cursor: "pointer", color: "var(--text)",
        }}
      >
        {/* When expanded, the card inside shows its own title, so hide the
            header's copy (kept in layout) to avoid a duplicate; collapsed, this
            label is the only cue to what the section is. */}
        <span className="microLabel" style={{ marginBottom: 0, visibility: open ? "hidden" : "visible" }}>{title}</span>
        <span
          aria-hidden
          style={{ color: "var(--muted)", fontSize: 20, lineHeight: 1, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}
        >
          ›
        </span>
      </button>
      {open && children}
    </div>
  );
}

function CompanyInfoCard() {
  const FIELDS: { key: keyof CompanyInfo; label: string; placeholder: string }[] = [
    { key: "name", label: "Company name", placeholder: "Mountaineer Moving LLC" },
    { key: "address", label: "Address", placeholder: "Street, City, ST ZIP" },
    { key: "phone", label: "Phone", placeholder: "(406) 201-9580" },
    { key: "email", label: "Email", placeholder: "management@mountaineermoving.com" },
    { key: "dot", label: "U.S. DOT number", placeholder: "4557708" },
    { key: "mc", label: "MC number", placeholder: "1811084" },
  ];
  const [info, setInfo] = useState<CompanyInfo>(() => getCompanyInfoCached());
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<CompanyInfo>("/api/admin/config/company")
      .then((r) => setInfo((prev) => ({ ...prev, ...r })))
      .catch(() => setErr("Failed to load company info"));
  }, []);

  function set(key: keyof CompanyInfo, value: string) {
    setInfo((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setErr(null);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/admin/config/company", { method: "PUT", body: JSON.stringify(info) });
      setCompanyInfoCache(info); // this device reflects the change immediately
      setSaved(true);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 10 }}>Company information</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>
        Your company details, shown as the carrier on the Bill of Lading and used
        anywhere the company address appears. Blank fields fall back to defaults.
      </div>
      <div className="col" style={{ gap: 10 }}>
        {FIELDS.map((f) => (
          <label key={f.key} className="col" style={{ gap: 4 }}>
            <span className="small" style={{ color: "var(--muted)" }}>{f.label}</span>
            <input
              value={info[f.key] || ""}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={f.placeholder}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14 }}
            />
          </label>
        ))}
      </div>
      {err && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{err}</div>}
      <div className="row" style={{ justifyContent: "flex-end", gap: 8, alignItems: "center", marginTop: 12 }}>
        {saved && <span className="small" style={{ color: "var(--ok)" }}>Saved.</span>}
        <button className="btnPrimary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save company info"}</button>
      </div>
    </div>
  );
}

// Payroll reimbursement rates (2f): mileage $/mi and per-diem $/night. The
// payroll page multiplies crew-logged miles/nights by these to show pay. 0 = not
// set (payroll shows counts only). These are reimbursement rates, not wages
// (ADR 0033); hourly pay stays in QuickBooks.
function PayrollRatesCard() {
  const [mileage, setMileage] = useState("");
  const [perDiem, setPerDiem] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ mileage_rate: number; per_diem_rate: number }>("/api/admin/config/payroll-rates")
      .then((r) => {
        setMileage(String(r.mileage_rate ?? 0));
        setPerDiem(String(r.per_diem_rate ?? 0));
      })
      .catch(() => setErr("Failed to load payroll rates"));
  }, []);

  async function save() {
    const m = Number(mileage);
    const p = Number(perDiem);
    if (!Number.isFinite(m) || m < 0 || !Number.isFinite(p) || p < 0) {
      setErr("Rates must be zero or a positive number.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/admin/config/payroll-rates", {
        method: "PUT",
        body: JSON.stringify({ mileage_rate: m, per_diem_rate: p }),
      });
      setSaved(true);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const field = (
    label: string,
    hint: string,
    value: string,
    setter: (v: string) => void,
  ) => (
    <label className="col" style={{ gap: 4 }}>
      <span className="small" style={{ color: "var(--muted)" }}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={0.01}
        value={value}
        onChange={(e) => { setter(e.target.value); setSaved(false); setErr(null); }}
        style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, maxWidth: 200 }}
      />
      <span className="small" style={{ color: "var(--muted)" }}>{hint}</span>
    </label>
  );

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 10 }}>Payroll rates</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>
        Standardized reimbursement rates the Payroll page uses to turn crew-logged
        miles and out-of-town nights into pay. Leave a rate at 0 to show the count
        only. These are reimbursement rates, not hourly wages (those stay in
        QuickBooks).
      </div>
      <div className="col" style={{ gap: 12 }}>
        {field("Mileage rate", "Dollars per mile, e.g. 0.65", mileage, setMileage)}
        {field("Per-diem rate", "Dollars per out-of-town night, e.g. 40", perDiem, setPerDiem)}
      </div>
      {err && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{err}</div>}
      <div className="row" style={{ justifyContent: "flex-end", gap: 8, alignItems: "center", marginTop: 12 }}>
        {saved && <span className="small" style={{ color: "var(--ok)" }}>Saved.</span>}
        <button className="btnPrimary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save payroll rates"}</button>
      </div>
    </div>
  );
}

// Job checklist config (C3.1): admin-editable checklist items, each manual or
// bound to an AUTO signal, optionally limited to long-distance and/or job types.
type ChecklistItem = { key?: string; label: string; auto_key: string; ld_only: boolean; job_types: string[] };

function JobChecklistCard() {
  const jobTypes = useJobTypes();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [autoSignals, setAutoSignals] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ items: ChecklistItem[]; auto_signals: Record<string, string> }>("/api/admin/config/job-checklist")
      .then((r) => { setItems(r.items); setAutoSignals(r.auto_signals); setLoaded(true); })
      .catch(() => { setErr("Failed to load checklist"); setLoaded(true); });
  }, []);

  const update = (i: number, patch: Partial<ChecklistItem>) => {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
    setSaved(false);
  };
  const remove = (i: number) => { setItems((prev) => prev.filter((_, j) => j !== i)); setSaved(false); };
  const add = () => { setItems((prev) => [...prev, { label: "", auto_key: "", ld_only: false, job_types: [] }]); setSaved(false); };
  const move = (i: number, dir: -1 | 1) => {
    setItems((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setSaved(false);
  };
  const toggleType = (i: number, t: string) =>
    update(i, {
      job_types: items[i].job_types.includes(t)
        ? items[i].job_types.filter((x) => x !== t)
        : [...items[i].job_types, t],
    });

  async function save() {
    if (items.some((it) => !it.label.trim())) { setErr("Every item needs a label."); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/admin/config/job-checklist", { method: "PUT", body: JSON.stringify({ items }) });
      setSaved(true);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 10 }}>Job checklist</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>
        The checklist shown on a job. An item is either manual (the crew tick it)
        or auto (it ticks itself when the app sees the thing happen). Limit an
        item to long-distance jobs and/or specific job types. Leave job types
        empty for every job.
      </div>
      {!loaded ? (
        <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          {items.map((it, i) => (
            <div key={i} className="col" style={{ gap: 8, border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
              <div className="row" style={{ gap: 6, alignItems: "flex-start" }}>
                <textarea
                  rows={2}
                  value={it.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  placeholder="Checklist item"
                  style={{ flex: 1, resize: "vertical", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }}
                />
                <div className="col" style={{ gap: 2 }}>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move up" style={{ fontSize: 12, padding: "2px 8px" }}>↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} title="Move down" style={{ fontSize: 12, padding: "2px 8px" }}>↓</button>
                </div>
              </div>
              <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
                <label className="col" style={{ gap: 2 }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Auto-check</span>
                  <select value={it.auto_key} onChange={(e) => update(i, { auto_key: e.target.value })}>
                    {Object.entries(autoSignals).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="row" style={{ gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={it.ld_only} onChange={(e) => update(i, { ld_only: e.target.checked })} />
                  <span className="small">Long-distance only</span>
                </label>
                <button type="button" onClick={() => remove(i)} style={{ fontSize: 12, color: "var(--danger)", marginLeft: "auto" }}>Remove</button>
              </div>
              {jobTypes.length > 0 && (
                <div className="col" style={{ gap: 4 }}>
                  <span className="small" style={{ color: "var(--muted)" }}>
                    Job types {it.job_types.length === 0 ? "(all)" : ""}
                  </span>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {jobTypes.map((t) => {
                      const on = it.job_types.includes(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => toggleType(i, t)}
                          style={{
                            padding: "4px 10px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                            border: on ? "1px solid var(--brand)" : "1px solid var(--border)",
                            background: on ? "var(--brand)" : "transparent",
                            color: on ? "var(--on-brand, #fff)" : "var(--text)", fontWeight: on ? 700 : 400,
                          }}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
          <button type="button" onClick={add} style={{ alignSelf: "flex-start", fontSize: 13 }}>+ Add item</button>
        </div>
      )}
      {err && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{err}</div>}
      <div className="row" style={{ justifyContent: "flex-end", gap: 8, alignItems: "center", marginTop: 12 }}>
        {saved && <span className="small" style={{ color: "var(--ok)" }}>Saved.</span>}
        <button className="btnPrimary" onClick={save} disabled={busy || !loaded}>{busy ? "Saving…" : "Save checklist"}</button>
      </div>
    </div>
  );
}

type VehicleUnit = {
  name: string;
  dry_weight_lbs: number | null;
  gvwr_lbs: number | null;
  length_ft: number | null;
  width_ft: number | null;
  height_ft: number | null;
  axle_capacities_lbs: number[];
  notes?: string;
};

function VehicleUnitsCard() {
  const [units, setUnits] = useState<VehicleUnit[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ units: VehicleUnit[] }>("/api/config/vehicle-units")
      .then((r) => setUnits(r.units || []))
      .catch(() => setErr("Failed to load vehicle units"));
  }, []);

  const numVal = (v: string): number | null => {
    const n = Number(v);
    return v.trim() === "" || !Number.isFinite(n) ? null : n;
  };
  function update(i: number, patch: Partial<VehicleUnit>) {
    setUnits((prev) => prev.map((u, idx) => (idx === i ? { ...u, ...patch } : u)));
    setSaved(false);
  }
  function addUnit() {
    setUnits((prev) => [...prev, {
      name: "", dry_weight_lbs: null, gvwr_lbs: null,
      length_ft: null, width_ft: null, height_ft: null, axle_capacities_lbs: [],
    }]);
    setSaved(false);
  }
  function removeUnit(i: number) {
    setUnits((prev) => prev.filter((_, idx) => idx !== i));
    setSaved(false);
  }
  async function save() {
    const cleaned = units.filter((u) => u.name.trim());
    if (cleaned.length === 0) { setErr("Add at least one named unit"); return; }
    setBusy(true); setErr(null);
    try {
      await apiFetch("/api/admin/config/vehicle-units", { method: "PUT", body: JSON.stringify({ units: cleaned }) });
      setSaved(true);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally { setBusy(false); }
  }

  const numInput = { width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box" as const };

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 10 }}>Vehicle Units</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>
        The single truck list. Each unit's name here fills the DVIR unit dropdown,
        and its empty (dry) weight, GVWR, dimensions, and per-axle capacities feed
        the DVIR/BOL vehicle info and the inventory weight-capacity flags. Payload
        capacity = GVWR minus dry weight.
      </div>

      <div className="col" style={{ gap: 14 }}>
        {units.map((u, i) => (
          <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <input value={u.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Unit name / number (e.g. 26INT)" style={{ ...numInput, fontWeight: 700, flex: "1 1 auto" }} />
              <button onClick={() => removeUnit(i)} style={{ color: "var(--danger)", background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Remove</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
              <label className="col" style={{ gap: 2 }}><span className="microLabel">Dry wt (lb)</span><input type="number" value={u.dry_weight_lbs ?? ""} onChange={(e) => update(i, { dry_weight_lbs: numVal(e.target.value) })} style={numInput} /></label>
              <label className="col" style={{ gap: 2 }}><span className="microLabel">GVWR (lb)</span><input type="number" value={u.gvwr_lbs ?? ""} onChange={(e) => update(i, { gvwr_lbs: numVal(e.target.value) })} style={numInput} /></label>
              <label className="col" style={{ gap: 2 }}><span className="microLabel">Length (ft)</span><input type="number" value={u.length_ft ?? ""} onChange={(e) => update(i, { length_ft: numVal(e.target.value) })} style={numInput} /></label>
              <label className="col" style={{ gap: 2 }}><span className="microLabel">Width (ft)</span><input type="number" value={u.width_ft ?? ""} onChange={(e) => update(i, { width_ft: numVal(e.target.value) })} style={numInput} /></label>
              <label className="col" style={{ gap: 2 }}><span className="microLabel">Height (ft)</span><input type="number" value={u.height_ft ?? ""} onChange={(e) => update(i, { height_ft: numVal(e.target.value) })} style={numInput} /></label>
            </div>
            <label className="col" style={{ gap: 2, marginTop: 8 }}>
              <span className="microLabel">Axle capacities (lb, comma-separated)</span>
              <input
                value={u.axle_capacities_lbs.join(", ")}
                onChange={(e) => update(i, { axle_capacities_lbs: e.target.value.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0) })}
                placeholder="e.g. 12000, 20000"
                style={numInput}
              />
            </label>
            {u.gvwr_lbs != null && u.dry_weight_lbs != null && (
              <div className="small" style={{ color: "var(--muted)", marginTop: 8 }}>
                Payload capacity: <span className="mono" style={{ color: "var(--text)", fontWeight: 600 }}>{(u.gvwr_lbs - u.dry_weight_lbs).toLocaleString()} lb</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={addUnit}>+ Add unit</button>
        <button className="btnPrimary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save units"}</button>
        {saved && <span className="small" style={{ color: "var(--ok)" }}>Saved</span>}
        {err && <span className="small" style={{ color: "var(--danger)" }}>{err}</span>}
      </div>
    </div>
  );
}

function DVIRTab() {
  const [dvirs, setDvirs] = useState<DVIRRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [selected, setSelected] = useState<DVIRRecord | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    apiFetch<DVIRRecord[]>(`/api/dvir?pending_only=${pendingOnly}`)
      .then(setDvirs)
      .catch((e) => setErr(e?.message ?? "Failed to load DVIRs"))
      .finally(() => setLoading(false));
  }, [pendingOnly]);

  if (selected) {
    return (
      <MechanicSignView
        dvir={selected}
        onBack={() => setSelected(null)}
        onSigned={(updated) => {
          // Once signed, the DVIR no longer belongs in the pending-review list,
          // so drop it there; in the full list keep it and refresh its row so the
          // "Mech. Signed" chip updates.
          setDvirs((prev) =>
            pendingOnly
              ? prev.filter((d) => d.dvir_id !== updated.dvir_id)
              : prev.map((d) => (d.dvir_id === updated.dvir_id ? updated : d)),
          );
          setSelected(null);
        }}
      />
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      {/* Filter toggle */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => setPendingOnly(e.target.checked)}
            style={{ accentColor: "var(--brand)" }}
          />
          Show pending mechanic review only
        </label>
      </div>

      {loading && <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading DVIRs…</div>}
      {err && <div style={{ color: "var(--danger)", fontSize: 13 }}>{err}</div>}
      {!loading && !err && dvirs.length === 0 && (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          {pendingOnly ? "No DVIRs pending mechanic review." : "No DVIRs found."}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {dvirs.map((d) => (
          <div
            key={d.dvir_id}
            className="card"
            style={{ cursor: "pointer" }}
            onClick={() => setSelected(d)}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {d.vehicle_number}
                  {d.trailer_number ? ` / Trailer ${d.trailer_number}` : ""}
                </div>
                <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                  {d.inspection_type === "pre-trip" ? "Pre-Trip" : "Post-Trip"} · {d.inspection_date} · {d.driver_name}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                <span
                  className="chip"
                  style={{
                    background: d.condition === "satisfactory" ? "color-mix(in srgb, var(--ok) 15%, transparent)" : "color-mix(in srgb, var(--danger) 15%, transparent)",
                    color: d.condition === "satisfactory" ? "var(--ok)" : "var(--danger)",
                  }}
                >
                  {d.condition === "satisfactory" ? "Satisfactory" : `${d.defects.length} Defect${d.defects.length !== 1 ? "s" : ""}`}
                </span>
                {(() => {
                  const signed = d.mechanic_signed;
                  const awaiting = !signed && d.needs_mechanic_review;
                  const label = signed
                    ? "Mech. Signed"
                    : awaiting
                      ? "Awaiting Mechanic"
                      : "No Review Needed";
                  const bg = awaiting ? "rgba(255,200,50,0.12)" : "color-mix(in srgb, var(--ok) 15%, transparent)";
                  const color = awaiting ? "#f0c040" : "var(--ok)";
                  return (
                    <span className="chip" style={{ background: bg, color }}>
                      {label}
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Data management / debug
// ─────────────────────────────────────────
function DataManagementCard() {
  const [counts, setCounts] = useState({ queue: 0, log: 0, materials: 0, photos: "?" });
  const [cleared, setCleared] = useState("");

  function refresh() {
    try {
      const q = JSON.parse(localStorage.getItem("crew_event_queue_v1") || "[]");
      const l = JSON.parse(localStorage.getItem("crew_event_log_v1") || "[]");
      const m = JSON.parse(localStorage.getItem("crew_materials_submissions_v1") || "[]");
      setCounts({ queue: q.length, log: l.length, materials: m.length, photos: "IndexedDB" });
    } catch {
      setCounts({ queue: 0, log: 0, materials: 0, photos: "?" });
    }
  }

  useEffect(() => { refresh(); }, []);

  function clearKey(key: string, label: string) {
    if (!confirm(`Clear ${label}? This cannot be undone.`)) return;
    localStorage.removeItem(key);
    setCleared(`Cleared ${label}`);
    refresh();
  }

  const rows: { key: string; label: string; count: number | string }[] = [
    { key: "crew_event_queue_v1",            label: "Event queue (unsynced)",    count: counts.queue },
    { key: "crew_event_log_v1",              label: "Activity log (all events)", count: counts.log },
    { key: "crew_materials_submissions_v1",  label: "Materials submissions",      count: counts.materials },
  ];

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 10 }}>Data Management</div>
      <div className="col" style={{ gap: 8 }}>
        {rows.map((r) => (
          <div key={r.key} className="row" style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
            <span className="small">{r.label} <span style={{ color: "var(--muted)" }}>({r.count})</span></span>
            <button
              onClick={() => clearKey(r.key, r.label)}
              style={{ fontSize: 11, padding: "3px 10px", color: "var(--danger)", borderColor: "var(--danger)" }}
            >
              Clear
            </button>
          </div>
        ))}
        {cleared && <div className="small" style={{ color: "var(--ok)", marginTop: 4 }}>{cleared}</div>}
        <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
          Photos are stored in IndexedDB. Clear via browser dev tools → Application → IndexedDB → crew_app_db.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type MechanicSignViewProps = {
  dvir: DVIRRecord;
  onBack(): void;
  onSigned(updated: DVIRRecord): void;
};

function MechanicSignView({ dvir, onBack, onSigned }: MechanicSignViewProps) {
  const [mechanicName, setMechanicName] = useState("");
  const [repairsMade, setRepairsMade] = useState<boolean | null>(null);
  const [mechanicNotes, setMechanicNotes] = useState("");
  const sigRef = useRef<SignaturePadHandle>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Remote signature request - email a sign-off link to a mechanic.
  const [reqEmail, setReqEmail] = useState("");
  const [reqName, setReqName] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const [reqErr, setReqErr] = useState<string | null>(null);
  const [requestedAt, setRequestedAt] = useState<string | null>(
    dvir.mechanic_signature_requested_at,
  );
  const [requestedEmail, setRequestedEmail] = useState<string | null>(
    dvir.mechanic_signature_requested_email,
  );
  // Remote sign-off is the secondary path - collapsed by default so the
  // review screen isn't two big stacked forms. Auto-expanded when a request
  // is already out, so its "awaiting signature" status stays in view.
  const [remoteOpen, setRemoteOpen] = useState<boolean>(
    !!dvir.mechanic_signature_requested_at,
  );

  // The list `dvir` arrives with its signature images blanked (the list ships
  // only signed-ness booleans to stay light). Refetch the single DVIR so the
  // detail view renders the real driver + mechanic signature images and the
  // correct signed state. Falls back to the list object on failure.
  const [full, setFull] = useState<DVIRRecord>(dvir);
  useEffect(() => {
    let alive = true;
    apiFetch<DVIRRecord>(`/api/dvir/${dvir.dvir_id}`)
      .then((d) => { if (alive) setFull(d); })
      .catch(() => { /* keep the list object; status booleans are still right */ });
    return () => { alive = false; };
  }, [dvir.dvir_id]);

  async function handleSendRequest(e: React.FormEvent) {
    e.preventDefault();
    setReqErr(null);
    if (!reqEmail.trim() || !reqEmail.includes("@")) {
      return setReqErr("Enter a valid mechanic email.");
    }
    setReqBusy(true);
    try {
      const updated = await apiFetch<DVIRRecord>(
        `/api/dvir/${dvir.dvir_id}/request-mechanic-signature`,
        {
          method: "POST",
          body: JSON.stringify({
            mechanic_email: reqEmail.trim(),
            mechanic_name: reqName.trim() || null,
          }),
        },
      );
      setRequestedAt(updated.mechanic_signature_requested_at);
      setRequestedEmail(updated.mechanic_signature_requested_email);
      setReqEmail("");
      setReqName("");
    } catch (e: any) {
      setReqErr(e?.message ?? "Failed to send signature request.");
    } finally {
      setReqBusy(false);
    }
  }

  async function handleSign(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!mechanicName.trim()) return setErr("Mechanic name is required.");
    if (repairsMade === null) return setErr("Please indicate whether repairs were made.");
    if (sigRef.current?.isEmpty()) return setErr("Mechanic signature is required.");

    setBusy(true);
    try {
      const updated = await apiFetch<DVIRRecord>(`/api/dvir/${dvir.dvir_id}/mechanic-sign`, {
        method: "PATCH",
        body: JSON.stringify({
          mechanic_name: mechanicName.trim(),
          mechanic_signature: sigRef.current!.toDataURL(),
          repairs_made: repairsMade,
          mechanic_notes: mechanicNotes.trim() || null,
        }),
      });
      onSigned(updated);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to submit mechanic signature.");
    } finally {
      setBusy(false);
    }
  }

  const isSigned = full.mechanic_signed || !!full.mechanic_signature;

  return (
    <div style={{ marginTop: 16 }}>
      <button
        onClick={onBack}
        style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13, marginBottom: 14, padding: 0 }}
      >
        ← Back to list
      </button>

      {/* DVIR summary */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          {dvir.vehicle_number}
          {dvir.trailer_number ? ` / Trailer ${dvir.trailer_number}` : ""}
        </div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
          {dvir.inspection_type === "pre-trip" ? "Pre-Trip" : "Post-Trip"} · {dvir.inspection_date}
          {dvir.odometer ? ` · Odometer: ${dvir.odometer.toLocaleString()} mi` : ""}
        </div>

        <div style={{ marginBottom: 8 }}>
          <span
            className="chip"
            style={{
              background: dvir.condition === "satisfactory" ? "color-mix(in srgb, var(--ok) 15%, transparent)" : "color-mix(in srgb, var(--danger) 15%, transparent)",
              color: dvir.condition === "satisfactory" ? "var(--ok)" : "var(--danger)",
            }}
          >
            {dvir.condition === "satisfactory" ? "Satisfactory - No Defects" : "Defects Noted"}
          </span>
        </div>

        {dvir.defects.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Defects:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {dvir.defects.map((d) => (
                <span key={d} className="chip" style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)" }}>
                  {d}
                </span>
              ))}
            </div>
          </div>
        )}

        {dvir.defect_notes && (
          <div style={{ marginBottom: 8 }}>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 2 }}>Defect Notes:</div>
            <div style={{ fontSize: 13 }}>{dvir.defect_notes}</div>
          </div>
        )}

        <div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Driver: {full.driver_name}</div>
          {full.driver_signature ? (
            <img
              src={full.driver_signature}
              alt="Driver signature"
              style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}
            />
          ) : (
            <div className="small" style={{ color: "var(--muted)", fontStyle: "italic" }}>
              Loading signature…
            </div>
          )}
        </div>
      </div>

      {/* Already signed view */}
      {isSigned ? (
        <div className="card">
          <div className="label" style={{ fontWeight: 700, marginBottom: 8, color: "var(--ok)" }}>
            ✓ Mechanic Approved
          </div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>
            Signed by: {full.mechanic_name} · {full.mechanic_signed_at ? formatMountainDateTime(full.mechanic_signed_at) : ""}
          </div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
            Repairs made: {full.repairs_made ? "Yes" : "No - no repair needed"}
          </div>
          {full.mechanic_notes && <div style={{ fontSize: 13, marginBottom: 8 }}>{full.mechanic_notes}</div>}
          {full.mechanic_signature ? (
            <img
              src={full.mechanic_signature}
              alt="Mechanic signature"
              style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}
            />
          ) : (
            <div className="small" style={{ color: "var(--muted)", fontStyle: "italic" }}>
              Loading signature…
            </div>
          )}
        </div>
      ) : !dvir.needs_mechanic_review ? (
        <div className="card">
          <div className="label" style={{ fontWeight: 700, marginBottom: 8, color: "var(--ok)" }}>
            ✓ No Mechanic Review Required
          </div>
          <div className="small" style={{ color: "var(--muted)" }}>
            Driver reported no defects - vehicle auto-cleared as satisfactory.
          </div>
        </div>
      ) : (
        <>
        {/* Remote signature request - secondary path, collapsed by default */}
        <div className="card" style={{ marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setRemoteOpen((v) => !v)}
            style={{
              background: "none", border: "none", padding: 0, cursor: "pointer", width: "100%",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              color: "var(--text)",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13 }}>Request Remote Mechanic Sign-Off</span>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>{remoteOpen ? "▾" : "▸"}</span>
          </button>

          {requestedAt && !remoteOpen && (
            <div className="small" style={{ color: "#f0c040", marginTop: 6 }}>
              Request sent to {requestedEmail} - awaiting signature. Tap to resend.
            </div>
          )}

          {remoteOpen && (
            <div style={{ marginTop: 10 }}>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>
                Email a secure link to a mechanic so they can review the defect and sign off
                remotely. The vehicle is cleared automatically once they sign.
              </div>

              {requestedAt && (
                <div
                  style={{
                    padding: "8px 12px", borderRadius: 8, marginBottom: 12,
                    background: "rgba(255,200,50,0.1)", border: "1px solid rgba(255,200,50,0.3)",
                    fontSize: 13, color: "var(--text)",
                  }}
                >
                  Request sent to <strong>{requestedEmail}</strong> on{" "}
                  {formatMountainDateTime(requestedAt)} - awaiting signature. You can resend below.
                </div>
              )}

              <form onSubmit={handleSendRequest} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Mechanic Email *</div>
                  <input
                    type="email"
                    value={reqEmail}
                    onChange={(e) => setReqEmail(e.target.value)}
                    placeholder="mechanic@example.com"
                    style={mechInputStyle}
                  />
                </div>
                <div>
                  <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Mechanic Name (optional)</div>
                  <input
                    value={reqName}
                    onChange={(e) => setReqName(e.target.value)}
                    placeholder="For the email greeting"
                    style={mechInputStyle}
                  />
                </div>
                {reqErr && (
                  <div style={{ color: "var(--danger)", fontSize: 13 }}>{reqErr}</div>
                )}
                <button type="submit" disabled={reqBusy} style={{ fontSize: 13, alignSelf: "flex-start" }}>
                  {reqBusy ? "Sending…" : requestedAt ? "Resend signature request" : "Email signature request"}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Mechanic sign form - in-person sign-off on this device */}
        <div className="card">
          <div className="label" style={{ fontWeight: 700, marginBottom: 4 }}>Sign Off In Person</div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>
            Or hand this device to the mechanic to sign now.
          </div>

          <form onSubmit={handleSign} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Mechanic Name *</div>
              <input
                value={mechanicName}
                onChange={(e) => setMechanicName(e.target.value)}
                placeholder="Full name"
                style={mechInputStyle}
              />
            </div>

            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>Repairs *</div>
              <div style={{ display: "flex", gap: 10 }}>
                {[
                  { label: "Repairs Made", value: true },
                  { label: "No Repair Needed", value: false },
                ].map(({ label, value }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setRepairsMade(value)}
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      borderRadius: 10,
                      border: repairsMade === value ? "2px solid var(--brand)" : "1px solid var(--border)",
                      background: repairsMade === value ? "color-mix(in srgb, var(--brand) 12%, transparent)" : "var(--card)",
                      color: repairsMade === value ? "var(--brand)" : "var(--muted)",
                      cursor: "pointer",
                      fontWeight: repairsMade === value ? 700 : 400,
                      fontSize: 13,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Mechanic Notes</div>
              <textarea
                value={mechanicNotes}
                onChange={(e) => setMechanicNotes(e.target.value)}
                placeholder="Optional notes on repairs or inspection…"
                rows={2}
                style={{ ...mechInputStyle, resize: "vertical" }}
              />
            </div>

            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>Mechanic Signature * - sign below</div>
              <SignaturePad ref={sigRef} height={140} />
              <button
                type="button"
                onClick={() => sigRef.current?.clear()}
                style={{ marginTop: 4, background: "none", border: "none", color: "var(--muted)", fontSize: 12, cursor: "pointer", padding: 0 }}
              >
                Clear signature
              </button>
            </div>

            {err && (
              <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "color-mix(in srgb, var(--danger) 10%, transparent)", borderRadius: 8 }}>
                {err}
              </div>
            )}

            <button type="submit" className="btnPrimary" disabled={busy}>
              {busy ? "Saving…" : "Approve & Sign DVIR"}
            </button>
          </form>
        </div>
        </>
      )}
    </div>
  );
}

const mechInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 14,
  boxSizing: "border-box",
};

// ─────────────────────────────────────────
// Notes tab - Patch Notes authoring
// ─────────────────────────────────────────

type PatchNoteRecord = {
  id: number;
  title: string;
  body: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

const NOTES_TAB_INITIAL = 3;

function NotesTab() {
  const [notes, setNotes] = useState<PatchNoteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    apiFetch<PatchNoteRecord[]>("/api/patch-notes")
      .then(setNotes)
      .catch((e: any) => setErr(e instanceof ApiError ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function startEdit(n: PatchNoteRecord) {
    setEditingId(n.id);
    setTitle(n.title);
    setBody(n.body);
  }

  function clearForm() {
    setEditingId(null);
    setTitle("");
    setBody("");
  }

  async function save() {
    if (!title.trim() || !body.trim()) {
      setErr("Title and body are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (editingId == null) {
        await apiFetch<PatchNoteRecord>("/api/patch-notes", {
          method: "POST",
          body: JSON.stringify({ title: title.trim(), body: body.trim() }),
        });
      } else {
        await apiFetch<PatchNoteRecord>(`/api/patch-notes/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify({ title: title.trim(), body: body.trim() }),
        });
      }
      clearForm();
      load();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this patch note?")) return;
    try {
      await apiFetch(`/api/patch-notes/${id}`, { method: "DELETE" });
      if (editingId === id) clearForm();
      load();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>{editingId == null ? "New Patch Note" : "Edit Patch Note"}</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
          Shows up on every crew member's Profile tab. Updating a note re-triggers the
          "new patch notes" indicator on the home screen.
        </div>
        <div className="col" style={{ gap: 10 }}>
          <input
            placeholder="Title (e.g. v1.4 - Faster Estimator)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            rows={5}
            placeholder="What changed…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btnPrimary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : editingId == null ? "Publish" : "Save changes"}
            </button>
            {editingId != null && (
              <button onClick={clearForm} type="button">Cancel</button>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Published Patch Notes</div>
        {loading && <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>}
        {!loading && notes.length === 0 && (
          <div className="small" style={{ color: "var(--muted)" }}>No patch notes yet.</div>
        )}
        <div className="col" style={{ gap: 10 }}>
          {(expanded ? notes : notes.slice(0, NOTES_TAB_INITIAL)).map((n) => (
            <div key={n.id} className="card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{n.title}</div>
                  <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                    Updated {formatMountainDateTime(n.updated_at)}
                    {n.created_by_name ? ` · by ${n.created_by_name}` : ""}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>{n.body}</div>
                </div>
                <div className="col" style={{ gap: 4 }}>
                  <button onClick={() => startEdit(n)} style={{ fontSize: 12 }}>Edit</button>
                  <button
                    onClick={() => remove(n.id)}
                    style={{ fontSize: 12, color: "var(--danger)", borderColor: "var(--danger)" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
          {notes.length > NOTES_TAB_INITIAL && (
            <button
              onClick={() => setExpanded((v) => !v)}
              style={{ fontSize: 12, alignSelf: "flex-start" }}
            >
              {expanded
                ? "Show recent only"
                : `Show ${notes.length - NOTES_TAB_INITIAL} older note${notes.length - NOTES_TAB_INITIAL === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>

      <AdminNotesSection />
    </div>
  );
}

// ─────────────────────────────────────────
// Admin Notes section - global or per-job messages to crew
// ─────────────────────────────────────────

type AdminNoteRecord = {
  id: number;
  title: string;
  body: string;
  job_uuid: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

function AdminNotesSection() {
  const [notes, setNotes] = useState<AdminNoteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [jobUuid, setJobUuid] = useState("");
  const [jobDisplay, setJobDisplay] = useState("");  // "Customer - YYYY-MM-DD" once picked
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Job-picker state (date + name → job-search → pick candidate)
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState("");
  const [pickerName, setPickerName] = useState("");
  const [pickerResults, setPickerResults] = useState<JobCandidate[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerErr, setPickerErr] = useState<string | null>(null);

  async function runJobSearch() {
    if (!pickerDate && !pickerName.trim()) {
      setPickerErr("Enter a date, a customer name, or both.");
      return;
    }
    setPickerLoading(true);
    setPickerErr(null);
    setPickerResults(null);
    try {
      const params = new URLSearchParams();
      if (pickerDate) params.set("date", pickerDate);
      if (pickerName.trim()) params.set("name", pickerName.trim());
      const rows = await apiFetch<JobCandidate[]>(`/api/admin/job-search?${params.toString()}`);
      setPickerResults(rows);
    } catch (e: any) {
      setPickerErr(e instanceof ApiError ? e.message : "Search failed");
    } finally {
      setPickerLoading(false);
    }
  }

  function attachJob(c: JobCandidate) {
    setJobUuid(c.job_uuid);
    const dateLabel = c.dates.length ? c.dates[c.dates.length - 1] : "";
    setJobDisplay(`${c.job_name || "(unnamed)"}${dateLabel ? ` - ${dateLabel}` : ""}`);
    setPickerOpen(false);
    setPickerResults(null);
    setPickerDate("");
    setPickerName("");
    setPickerErr(null);
  }

  function detachJob() {
    setJobUuid("");
    setJobDisplay("");
  }

  function load() {
    setLoading(true);
    apiFetch<AdminNoteRecord[]>("/api/admin-notes")
      .then(setNotes)
      .catch((e: any) => setErr(e instanceof ApiError ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function startEdit(n: AdminNoteRecord) {
    setEditingId(n.id);
    setTitle(n.title);
    setBody(n.body);
    setJobUuid(n.job_uuid ?? "");
    // Editing an existing note just shows the raw uuid; picker stays closed
    // until the admin explicitly re-picks.
    setJobDisplay(n.job_uuid ? `Job ${n.job_uuid.slice(0, 8)}…` : "");
  }

  function clearForm() {
    setEditingId(null);
    setTitle("");
    setBody("");
    setJobUuid("");
    setJobDisplay("");
    setPickerOpen(false);
  }

  async function save() {
    if (!title.trim() || !body.trim()) {
      setErr("Title and body are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    const payload = { title: title.trim(), body: body.trim(), job_uuid: jobUuid.trim() || null };
    try {
      if (editingId == null) {
        await apiFetch<AdminNoteRecord>("/api/admin-notes", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch<AdminNoteRecord>(`/api/admin-notes/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      clearForm();
      load();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this admin note?")) return;
    try {
      await apiFetch(`/api/admin-notes/${id}`, { method: "DELETE" });
      if (editingId === id) clearForm();
      load();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  return (
    <>
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>{editingId == null ? "New Admin Note" : "Edit Admin Note"}</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
          Leave "Attached job" empty for a global note (shown to every crew member).
          Attach a job to scope the note - it only surfaces when that job is selected.
        </div>
        <div className="col" style={{ gap: 10 }}>
          <input
            placeholder="Title (e.g. New packing-material pricing)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {/* Attached-job row - chip + picker */}
          <div className="col" style={{ gap: 6 }}>
            <div className="small" style={{ color: "var(--muted)" }}>Attached job</div>
            {jobUuid ? (
              <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <span
                  className="chip"
                  style={{ color: "var(--brand2)", fontSize: 12, maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={jobUuid}
                >
                  {jobDisplay || `Job ${jobUuid.slice(0, 8)}…`}
                </span>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" onClick={() => setPickerOpen(true)} style={{ fontSize: 12 }}>Change</button>
                  <button type="button" onClick={detachJob} style={{ fontSize: 12 }}>Make global</button>
                </div>
              </div>
            ) : (
              <div className="row" style={{ gap: 8 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Global (no job)</span>
                <button type="button" onClick={() => setPickerOpen(true)} style={{ fontSize: 12 }}>
                  Attach to job…
                </button>
              </div>
            )}

            {pickerOpen && (
              <div
                className="card"
                style={{ marginTop: 6, padding: 12, border: "1px solid var(--brand)", background: "color-mix(in srgb, var(--brand) 5%, transparent)" }}
              >
                <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
                  Search by date and/or customer name. Pick one to attach.
                </div>
                <div className="row wrap" style={{ gap: 8 }}>
                  <label className="col" style={{ gap: 4, flex: "1 1 140px" }}>
                    <span className="small" style={{ color: "var(--muted)" }}>Job date</span>
                    <input type="date" value={pickerDate} onChange={(e) => setPickerDate(e.target.value)} />
                  </label>
                  <label className="col" style={{ gap: 4, flex: "2 1 160px" }}>
                    <span className="small" style={{ color: "var(--muted)" }}>Customer name</span>
                    <input
                      value={pickerName}
                      onChange={(e) => setPickerName(e.target.value)}
                      placeholder="e.g. Smith"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runJobSearch(); } }}
                    />
                  </label>
                  <button
                    type="button"
                    className="btnPrimary"
                    onClick={runJobSearch}
                    disabled={pickerLoading}
                    style={{ alignSelf: "flex-end" }}
                  >
                    {pickerLoading ? "Searching…" : "Search"}
                  </button>
                  <button type="button" onClick={() => setPickerOpen(false)} style={{ alignSelf: "flex-end" }}>
                    Close
                  </button>
                </div>
                {pickerErr && <div className="small" style={{ color: "var(--danger)", marginTop: 6 }}>{pickerErr}</div>}
                {pickerResults != null && (
                  pickerResults.length === 0 ? (
                    <div className="small" style={{ color: "var(--muted)", marginTop: 8 }}>
                      No jobs match those filters.
                    </div>
                  ) : (
                    <div className="col" style={{ gap: 6, marginTop: 8 }}>
                      {pickerResults.map((c) => (
                        <button
                          key={c.job_uuid}
                          type="button"
                          onClick={() => attachJob(c)}
                          style={{ textAlign: "left" }}
                        >
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{c.job_name || "(unnamed)"}</div>
                          <div className="small" style={{ color: "var(--muted)" }}>
                            {c.dates.length > 0
                              ? c.dates.length === 1
                                ? c.dates[0]
                                : `${c.dates[0]} → ${c.dates[c.dates.length - 1]}`
                              : "no dates"}
                            {" · "}{c.event_count} event{c.event_count === 1 ? "" : "s"}
                          </div>
                        </button>
                      ))}
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          <textarea
            rows={5}
            placeholder="What the crew needs to know…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btnPrimary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : editingId == null ? "Publish" : "Save changes"}
            </button>
            {editingId != null && (
              <button onClick={clearForm} type="button">Cancel</button>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Published Admin Notes</div>
        {loading && <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>}
        {!loading && notes.length === 0 && (
          <div className="small" style={{ color: "var(--muted)" }}>No admin notes yet.</div>
        )}
        <div className="col" style={{ gap: 10 }}>
          {notes.map((n) => (
            <div key={n.id} className="card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{n.title}</div>
                    <span className="chip" style={{ fontSize: 10, color: n.job_uuid ? "var(--brand2)" : "var(--ok)" }}>
                      {n.job_uuid ? "Job" : "Global"}
                    </span>
                  </div>
                  <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                    {n.job_uuid ? `Job ${n.job_uuid.slice(0, 8)}… · ` : ""}
                    Updated {formatMountainDateTime(n.updated_at)}
                    {n.created_by_name ? ` · by ${n.created_by_name}` : ""}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>{n.body}</div>
                </div>
                <div className="col" style={{ gap: 4 }}>
                  <button onClick={() => startEdit(n)} style={{ fontSize: 12 }}>Edit</button>
                  <button
                    onClick={() => remove(n.id)}
                    style={{ fontSize: 12, color: "var(--danger)", borderColor: "var(--danger)" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────
// Job Summary tab - one-page view of every source for a job
// ─────────────────────────────────────────

type JobSummary = {
  job_uuid: string;
  job_name: string;
  events: Array<{
    event_id: string;
    type: string;
    timestamp: string | null;
    logged_at: string | null;
    note: string | null;
    lat: number | null;
    lng: number | null;
    created_by: string | null;
  }>;
  dvirs: Array<{
    dvir_id: string;
    inspection_type: string;
    inspection_date: string;
    vehicle_number: string;
    trailer_number: string | null;
    condition: string;
    defects: string[];
    defect_notes: string | null;
    driver_name: string;
    mechanic_name: string | null;
    mechanic_signed_at: string | null;
    created_at: string | null;
  }>;
  materials: Array<{
    id: string;
    created_at: string | null;
    notes: string;
    items: Array<{ name: string; qty: number; unitPrice?: number | null; source?: string }>;
    total: number;
  }>;
  job_report: {
    submitted_by_name: string | null;
    personal_vehicles: number;
    bill_personal_vehicles: boolean;
    dumpster_pct: number;
    recycling_pct: number;
    billing_method: string;
    review_candidate: "yes" | "no" | "na";
    hours_match: boolean;
    hours_verified: boolean;
    hours_mismatch_reason: string | null;
    job_type_tags: string[];
    truck_fullness: Array<{ truck?: string; vertical_pct?: number; horizontal_pct?: number }>;
    out_of_town: boolean;
    has_crew_feedback: boolean | null;
    crew_feedback: string;
    overage_note: string;
    employee_hours: Array<{
      user_id?: number;
      name: string;
      start: string;
      end: string;
      break_hours: number;
      hours: number;
      non_billable?: boolean;
      // Per-skill ratings, keyed by skill name. -1 = the rater marked it N/A.
      skill_ratings?: Record<string, number> | null;
      skill_rating?: number | null;
    }>;
    updated_at: string | null;
  } | null;
  inventory: {
    furniture_count: number;
    box_count: number;
    items: Array<{
      name: string;
      qty: number;
      is_box: boolean;
      pack_type: string | null;
      room: string | null;
      notes: string | null;
      created_by_name: string | null;
    }>;
  };
  incidents: Array<{
    incident_uuid: string;
    claim_number: string | null;
    incident_date: string | null;
    severity: string;
    attributable: string;
    attributed_crew: string | null;
    description: string;
    est_cost: number | null;
    resolved: boolean;
    notes: string | null;
    reported_by_name: string | null;
    photo_urls: string[];
    created_at: string | null;
  }>;
  bol: {
    bol_id: string;
    status: string;
    item_count: number;
    inventory_verified: number | null;
    inventory_note: string | null;
    signed_pdf_url: string | null;
    updated_at: string | null;
  } | null;
  ld_days: Array<{ driver_name: string; date: string; out_of_town: boolean; drive_day: boolean }>;
  reimbursements: Array<{
    reimbursement_uuid: string;
    type: string;
    user_name: string;
    amount: number | null;
    category: string | null;
    vendor: string | null;
    status: string;
    notes: string | null;
    created_at: string | null;
  }>;
  bill: {
    saved_by_name: string | null;
    items: Array<{ label?: string; qty?: number; unit?: string; rate?: number; discount?: number }>;
    global_discount: number;
    notes: string;
    updated_at: string | null;
  } | null;
  photos: Array<{ id: string; caption: string; drive_url: string; created_by: string | null; created_at: string | null }>;
  admin_notes: Array<{ id: number; title: string; body: string; created_by_name: string | null; updated_at: string | null }>;
  entry_status: {
    entered_by: string;
    entered_on: string;
    validated?: boolean;
    corrected?: boolean;
    confirmed_in_sheet?: boolean;
    updated_by_name: string | null;
    updated_at: string | null;
  } | null;
};

// ── Job-level hour corrections (ADR 0032) ──────────────────────────────────
// Corrections are an override layer made from the Job Summary: the crew's
// submitted hours are never edited, both numbers stay visible, and each change
// is emailed to the crew member when the job is initialed.

type JobCorrection = {
  id: number;
  user_id: number;
  user_name: string;
  bucket: string;
  original_hours: number;
  corrected_hours: number;
  reason: string;
  created_by_name: string | null;
  notified_at: string | null;
  updated_at: string | null;
};

type JobReported = { user_id: number; user_name: string; bucket: string; hours: number };

type JobCorrectionsResp = {
  job_uuid: string;
  job_name: string;
  work_date: string;
  reported: JobReported[];
  corrections: JobCorrection[];
  pending_notify_count: number;
};

type NotifyResult = {
  sent: { user_id: number; name: string; count: number }[];
  failed: { user_id: number; name: string; count: number; error: string }[];
  email_unconfigured: boolean;
};

const CORRECTION_BUCKET_LABELS: Record<string, string> = {
  billable: "Billable",
  non_billable: "Non-billable",
  per_diem_nights: "Per-diem nights",
};

type JobCandidate = {
  job_uuid: string;
  job_name: string;
  dates: string[];
  event_count: number;
  material_count: number;
  entered: boolean;
};

function fmtHrs(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

/** Correct a job's employee hours from the Job Summary (ADR 0032). Self-
 *  contained: fetches the job's corrections + what the crew reported, edits an
 *  override, and never touches the crew's submission. `employees` are the people
 *  on the job report, so an admin can add a correction to a bucket someone
 *  reported nothing in (moving hours to "other", say). Refetches when
 *  `refreshSignal` changes - the attestation save bumps it after mailing. */
function JobHourCorrections({
  jobUuid,
  employees,
  refreshSignal,
}: {
  jobUuid: string;
  employees: Array<{ user_id: number; name: string }>;
  refreshSignal: number;
}) {
  const [resp, setResp] = useState<JobCorrectionsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Form state.
  const [userId, setUserId] = useState<number | "">("");
  const [bucket, setBucket] = useState("billable");
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiFetch<JobCorrectionsResp>(
        `/api/admin/payroll/job/${encodeURIComponent(jobUuid)}/corrections`,
      );
      setResp(data);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load corrections.");
    } finally {
      setLoading(false);
    }
  }, [jobUuid]);

  useEffect(() => { load(); }, [load, refreshSignal]);

  const reportedFor = (uid: number, b: string): number =>
    resp?.reported.find((r) => r.user_id === uid && r.bucket === b)?.hours ?? 0;

  const closeForm = () => {
    setAdding(false);
    setEditingId(null);
    setUserId("");
    setBucket("billable");
    setHours("");
    setReason("");
    setFormErr(null);
  };

  const openAdd = () => {
    closeForm();
    setAdding(true);
  };

  const openEdit = (c: JobCorrection) => {
    setAdding(false);
    setEditingId(c.id);
    setUserId(c.user_id);
    setBucket(c.bucket);
    setHours(String(c.corrected_hours));
    setReason(c.reason);
    setFormErr(null);
  };

  const save = async () => {
    if (userId === "") { setFormErr("Pick an employee."); return; }
    const n = Number(hours);
    if (!Number.isFinite(n) || n < 0) { setFormErr("Enter the corrected hours as a number."); return; }
    if (!reason.trim()) { setFormErr("A reason is required - the crew member is emailed this text."); return; }
    setBusy(true);
    setFormErr(null);
    try {
      await apiFetch(`/api/admin/payroll/job/${encodeURIComponent(jobUuid)}/corrections`, {
        method: "PUT",
        body: JSON.stringify({
          user_id: userId,
          bucket,
          corrected_hours: n,
          reason: reason.trim(),
        }),
      });
      closeForm();
      await load();
    } catch (e) {
      setFormErr(e instanceof ApiError ? e.message : "Could not save the correction.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: JobCorrection) => {
    if (!confirm(`Remove the correction to ${c.user_name}'s ${CORRECTION_BUCKET_LABELS[c.bucket] || c.bucket} hours?`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/payroll/job/${encodeURIComponent(jobUuid)}/corrections/${c.id}`, {
        method: "DELETE",
      });
      if (editingId === c.id) closeForm();
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not remove the correction.");
    } finally {
      setBusy(false);
    }
  };

  const corrections = resp?.corrections ?? [];
  const pending = resp?.pending_notify_count ?? 0;
  const unit = bucket === "per_diem_nights" ? "nights" : "hrs";

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div className="microLabel" style={{ marginBottom: 0 }}>Hour corrections</div>
        {!adding && editingId === null && (
          <button type="button" onClick={openAdd} style={{ fontSize: 12 }}>
            + Correct hours
          </button>
        )}
      </div>
      <div className="small" style={{ color: "var(--muted)", margin: "8px 0 10px" }}>
        This never changes what the crew submitted - it records an override for
        payroll. Each correction is emailed to the crew member when you initial
        the job below.
      </div>

      {err && <div className="small" style={{ color: "var(--danger)", marginBottom: 8 }}>{err}</div>}
      {loading && !resp && <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>}

      {corrections.length > 0 && (
        <div className="col" style={{ gap: 6, marginBottom: 10 }}>
          {corrections.map((c) => (
            <div
              key={c.id}
              className="row"
              style={{
                justifyContent: "space-between", alignItems: "center", gap: 10,
                padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 8,
                fontSize: 13,
              }}
            >
              <div className="col" style={{ gap: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>
                  {c.user_name}
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                    {" "}({CORRECTION_BUCKET_LABELS[c.bucket] || c.bucket})
                  </span>
                </span>
                <span className="small" style={{ color: "var(--brand)" }}>
                  {fmtHrs(c.original_hours)} → {fmtHrs(c.corrected_hours)}
                  {c.bucket === "per_diem_nights" ? " nights" : " hrs"} · {c.reason}
                </span>
                <span className="small" style={{ color: "var(--muted)" }}>
                  {c.notified_at ? "Crew emailed" : "Not yet sent - initial the job to notify"}
                </span>
              </div>
              <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                <button type="button" onClick={() => openEdit(c)} disabled={busy} style={{ fontSize: 12 }}>Edit</button>
                <button type="button" onClick={() => remove(c)} disabled={busy} style={{ fontSize: 12, color: "var(--danger)" }}>Remove</button>
              </div>
            </div>
          ))}
          {pending > 0 && (
            <div className="small" style={{ color: "var(--warn, #e0a800)" }}>
              {pending} correction{pending === 1 ? "" : "s"} not yet emailed. Initial the job below to send.
            </div>
          )}
        </div>
      )}

      {(adding || editingId !== null) && (
        <div className="col" style={{ gap: 10, padding: 12, borderRadius: 10, border: "1px solid var(--brand)" }}>
          <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
            <label className="col" style={{ gap: 3, minWidth: 160 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Employee</span>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : "")}
                disabled={editingId !== null}
              >
                <option value="">Pick…</option>
                {employees.map((emp) => (
                  <option key={emp.user_id} value={emp.user_id}>{emp.name}</option>
                ))}
              </select>
            </label>
            <label className="col" style={{ gap: 3 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Bucket</span>
              <select value={bucket} onChange={(e) => setBucket(e.target.value)} disabled={editingId !== null}>
                {Object.entries(CORRECTION_BUCKET_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="col" style={{ gap: 3, width: 130 }}>
              <span className="small" style={{ color: "var(--muted)" }}>
                {bucket === "per_diem_nights" ? "Nights" : "Should be"}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.25}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </label>
            {userId !== "" && (
              <div className="small" style={{ color: "var(--muted)", paddingBottom: 6 }}>
                Crew reported {fmtHrs(reportedFor(userId, bucket))} {unit}
              </div>
            )}
          </div>
          <label className="col" style={{ gap: 3 }}>
            <span className="small" style={{ color: "var(--muted)" }}>Reason (the crew member is emailed this)</span>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Clocked out at 3, not 5 - confirmed with the crew lead."
              style={{ width: "100%", resize: "vertical" }}
            />
          </label>
          {formErr && <span className="small" style={{ color: "var(--danger)" }}>{formErr}</span>}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save correction"}</button>
            <button type="button" onClick={closeForm} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {corrections.length === 0 && !adding && editingId === null && !loading && (
        <div className="small" style={{ color: "var(--muted)" }}>No corrections on this job.</div>
      )}
    </div>
  );
}

type BillItem = { label?: string; qty?: number; unit?: string; rate?: number; discount?: number };

type ReportBilling = {
  personal_vehicles: number;
  dumpster_pct: number;
  recycling_pct: number;
  billing_method: string;
  bill_personal_vehicles: boolean;
};

function billLineTotal(items: BillItem[], globalDiscount: number): number {
  const subtotal = items.reduce((s, it) => {
    const qty = Number(it.qty) || 0;
    const rate = Number(it.rate) || 0;
    const disc = Number(it.discount) || 0;
    return s + qty * rate * (1 - disc / 100);
  }, 0);
  return subtotal * (1 - (globalDiscount || 0) / 100);
}

/** Admin correction of a job's billing (2e): the bill invoice AND the job-report
 *  billing fields, edited in place. On save it re-exports both to the Sheet and
 *  emails the job's crew the total change + reason. The bill is the office's
 *  invoice (not crew-sacred like hours), so there is no override layer. */
function BillCorrectionEditor({
  jobUuid,
  bill,
  reportBilling,
  onClose,
  onSaved,
}: {
  jobUuid: string;
  bill: { items: BillItem[]; global_discount: number; notes: string | null };
  reportBilling: ReportBilling | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState<BillItem[]>(() => bill.items.map((x) => ({ ...x })));
  const [globalDiscount, setGlobalDiscount] = useState(String(bill.global_discount ?? 0));
  const [notes, setNotes] = useState(bill.notes ?? "");
  const [pv, setPv] = useState(reportBilling ? String(reportBilling.personal_vehicles) : "");
  const [dumpster, setDumpster] = useState(reportBilling ? String(reportBilling.dumpster_pct) : "");
  const [recycling, setRecycling] = useState(reportBilling ? String(reportBilling.recycling_pct) : "");
  const [method, setMethod] = useState(reportBilling?.billing_method ?? "");
  const [billPv, setBillPv] = useState(!!reportBilling?.bill_personal_vehicles);
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{
    before_total: number;
    after_total: number;
    notify: NotifyResult;
  } | null>(null);

  const beforeTotal = billLineTotal(bill.items, bill.global_discount || 0);
  const newTotal = billLineTotal(items, Number(globalDiscount) || 0);

  const setItem = (i: number, patch: Partial<BillItem>) =>
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((prev) => [...prev, { label: "", qty: 1, rate: 0, discount: 0 }]);
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, j) => j !== i));

  const save = async () => {
    if (!reason.trim()) { setErr("A reason is required - the crew is emailed it."); return; }
    setBusy(true);
    setErr(null);
    try {
      const cleanItems = items.map((it) => ({
        label: (it.label ?? "").trim(),
        qty: Number(it.qty) || 0,
        unit: it.unit,
        rate: Number(it.rate) || 0,
        discount: Number(it.discount) || 0,
      }));
      const payload: Record<string, unknown> = {
        items: cleanItems,
        global_discount: Number(globalDiscount) || 0,
        notes: notes.trim() || null,
        reason: reason.trim(),
        notify,
      };
      if (reportBilling) {
        payload.personal_vehicles = Number(pv) || 0;
        payload.dumpster_pct = Number(dumpster) || 0;
        payload.recycling_pct = Number(recycling) || 0;
        payload.billing_method = method.trim();
        payload.bill_personal_vehicles = billPv;
      }
      const r = await apiFetch<{ before_total: number; after_total: number; notify: NotifyResult }>(
        `/api/admin/bill-correction/${encodeURIComponent(jobUuid)}`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      setResult({ before_total: r.before_total, after_total: r.after_total, notify: r.notify });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save the correction.");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="col" style={{ gap: 8, padding: 12, borderRadius: 10, border: "1px solid var(--ok)", marginTop: 10 }}>
        <div className="small" style={{ color: "var(--ok)", fontWeight: 700 }}>
          ✓ Bill corrected: ${result.before_total.toFixed(2)} → ${result.after_total.toFixed(2)}
        </div>
        {result.notify.email_unconfigured && (
          <div className="small" style={{ color: "var(--warn, #e0a800)" }}>
            Crew were not emailed: email is not configured on this server.
          </div>
        )}
        {result.notify.sent.map((s) => (
          <div key={s.user_id} className="small" style={{ color: "var(--ok)" }}>Emailed {s.name}</div>
        ))}
        {result.notify.failed.map((f) => (
          <div key={f.user_id} className="small" style={{ color: "var(--danger)" }}>
            Could not email {f.name}: {f.error}
          </div>
        ))}
        {!notify && !result.notify.email_unconfigured && result.notify.sent.length === 0 && (
          <div className="small" style={{ color: "var(--muted)" }}>No email sent (notify was off).</div>
        )}
        <div>
          <button type="button" onClick={() => { onSaved(); onClose(); }}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 12, padding: 12, borderRadius: 10, border: "1px solid var(--brand)", marginTop: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>Correct bill</div>

      {/* Line items */}
      <div className="col" style={{ gap: 6 }}>
        {items.map((it, i) => (
          <div key={i} className="row wrap" style={{ gap: 6, alignItems: "flex-end" }}>
            <label className="col" style={{ gap: 2, flex: "2 1 160px", minWidth: 120 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Line</span>
              <input value={it.label ?? ""} onChange={(e) => setItem(i, { label: e.target.value })} placeholder="Label" />
            </label>
            <label className="col" style={{ gap: 2, width: 64 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Qty</span>
              <input type="number" inputMode="decimal" step={0.25} value={it.qty ?? 0} onChange={(e) => setItem(i, { qty: Number(e.target.value) })} />
            </label>
            <label className="col" style={{ gap: 2, width: 84 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Rate $</span>
              <input type="number" inputMode="decimal" step={0.01} value={it.rate ?? 0} onChange={(e) => setItem(i, { rate: Number(e.target.value) })} />
            </label>
            <label className="col" style={{ gap: 2, width: 64 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Disc %</span>
              <input type="number" inputMode="decimal" step={1} value={it.discount ?? 0} onChange={(e) => setItem(i, { discount: Number(e.target.value) })} />
            </label>
            <button type="button" onClick={() => removeItem(i)} style={{ color: "var(--danger)", flex: "0 0 auto" }}>Remove</button>
          </div>
        ))}
        <div>
          <button type="button" onClick={addItem} style={{ fontSize: 12 }}>+ Add line</button>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
        <label className="col" style={{ gap: 2, width: 120 }}>
          <span className="small" style={{ color: "var(--muted)" }}>Global discount %</span>
          <input type="number" inputMode="decimal" step={1} value={globalDiscount} onChange={(e) => setGlobalDiscount(e.target.value)} />
        </label>
        <div className="small" style={{ paddingBottom: 6 }}>
          New total <strong>${newTotal.toFixed(2)}</strong>
          <span style={{ color: "var(--muted)" }}> (was ${beforeTotal.toFixed(2)})</span>
        </div>
      </div>

      <label className="col" style={{ gap: 2 }}>
        <span className="small" style={{ color: "var(--muted)" }}>Bill notes</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
      </label>

      {reportBilling && (
        <div className="col" style={{ gap: 8, paddingTop: 4, borderTop: "1px solid var(--border)" }}>
          <div className="small" style={{ color: "var(--muted)", fontWeight: 700 }}>Report billing fields</div>
          <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
            <label className="col" style={{ gap: 2, width: 110 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Billing method</span>
              <input value={method} onChange={(e) => setMethod(e.target.value)} />
            </label>
            <label className="col" style={{ gap: 2, width: 90 }}>
              <span className="small" style={{ color: "var(--muted)" }}>Personal veh.</span>
              <input type="number" inputMode="numeric" step={1} value={pv} onChange={(e) => setPv(e.target.value)} />
            </label>
            <label className="col" style={{ gap: 2, width: 100 }}>
              <span className="small" style={{ color: "var(--muted)" }}>M1 dumpster %</span>
              <input type="number" inputMode="numeric" step={5} value={dumpster} onChange={(e) => setDumpster(e.target.value)} />
            </label>
            <label className="col" style={{ gap: 2, width: 100 }}>
              <span className="small" style={{ color: "var(--muted)" }}>M1 recycling %</span>
              <input type="number" inputMode="numeric" step={5} value={recycling} onChange={(e) => setRecycling(e.target.value)} />
            </label>
            <label className="row" style={{ gap: 6, alignItems: "center", paddingBottom: 6 }}>
              <input type="checkbox" checked={billPv} onChange={(e) => setBillPv(e.target.checked)} />
              <span className="small">Bill personal vehicles</span>
            </label>
          </div>
        </div>
      )}

      <label className="col" style={{ gap: 2 }}>
        <span className="small" style={{ color: "var(--muted)" }}>Reason (the crew is emailed this)</span>
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Removed the duplicate dolly line."
          style={{ width: "100%", resize: "vertical" }}
        />
      </label>

      <label className="row" style={{ gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        <span className="small">Email the job's crew what changed</span>
      </label>

      {err && <span className="small" style={{ color: "var(--danger)" }}>{err}</span>}

      <div className="row" style={{ gap: 8 }}>
        <button type="button" onClick={save} disabled={busy} className="btnPrimary">
          {busy ? "Saving…" : (notify ? "Save & notify crew" : "Save correction")}
        </button>
        <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function JobSummaryTab() {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [candidates, setCandidates] = useState<JobCandidate[] | null>(null);
  const [summary, setSummary] = useState<JobSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [invoiceCopied, setInvoiceCopied] = useState(false);

  // Admin data-entry checkpoint local state for the inputs on the
  // entry-status card; falls back to today's date so the typical
  // "I just entered this" path is one tap.
  const [entryInitials, setEntryInitials] = useState("");
  const [entryDate, setEntryDate] = useState(() => mountainDateYYYYMMDD());
  const [entrySaving, setEntrySaving] = useState(false);
  const [entrySaved, setEntrySaved] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  // The three-part attestation (ADR 0032) and the notify result from the last
  // save. correctionsRefresh forces the corrections card to refetch after a
  // save mails its corrections.
  const [entryValidated, setEntryValidated] = useState(false);
  const [entryCorrected, setEntryCorrected] = useState(false);
  const [entryConfirmedSheet, setEntryConfirmedSheet] = useState(false);
  const [entryNotify, setEntryNotify] = useState<NotifyResult | null>(null);
  const [correctionsRefresh, setCorrectionsRefresh] = useState(0);
  const [editingBill, setEditingBill] = useState(false);

  async function search() {
    if (!date && !name.trim()) {
      setErr("Enter a date, a job name, or both.");
      return;
    }
    setLoading(true);
    setErr(null);
    setSummary(null);
    setCandidates(null);
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);
      if (name.trim()) params.set("name", name.trim());
      const rows = await apiFetch<JobCandidate[]>(`/api/admin/job-search?${params.toString()}`);
      setCandidates(rows);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadSummary(jobUuid: string) {
    setLoading(true);
    setErr(null);
    setSummary(null);
    setEntrySaved(false);
    setEntryError(null);
    try {
      const data = await apiFetch<JobSummary>(`/api/admin/job-summary/${encodeURIComponent(jobUuid)}`);
      setSummary(data);
      // Pre-fill the entry-status form. Existing entries hydrate verbatim;
      // new jobs default to today's Mountain date and an empty initials box.
      setEntryInitials(data.entry_status?.entered_by ?? "");
      setEntryDate(data.entry_status?.entered_on || mountainDateYYYYMMDD());
      setEntryValidated(!!data.entry_status?.validated);
      setEntryCorrected(!!data.entry_status?.corrected);
      setEntryConfirmedSheet(!!data.entry_status?.confirmed_in_sheet);
      setEntryNotify(null);
      setCorrectionsRefresh((n) => n + 1);
      setEditingBill(false);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to load summary");
    } finally {
      setLoading(false);
    }
  }

  async function saveEntryStatus() {
    if (!summary) return;
    const initials = entryInitials.trim();
    if (!initials) {
      setEntryError("Initials are required.");
      return;
    }
    if (!entryDate) {
      setEntryError("Date is required.");
      return;
    }
    if (!(entryValidated && entryCorrected && entryConfirmedSheet)) {
      setEntryError("Confirm all three checks before initialing.");
      return;
    }
    setEntrySaving(true);
    setEntryError(null);
    setEntrySaved(false);
    setEntryNotify(null);
    try {
      const updated = await apiFetch<{
        entry_status: NonNullable<JobSummary["entry_status"]>;
        notify?: NotifyResult;
      }>(
        `/api/admin/job-entry-status/${encodeURIComponent(summary.job_uuid)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            entered_by: initials,
            entered_on: entryDate,
            validated: entryValidated,
            corrected: entryCorrected,
            confirmed_in_sheet: entryConfirmedSheet,
          }),
        },
      );
      setSummary((prev) => (prev ? { ...prev, entry_status: updated.entry_status } : prev));
      setEntrySaved(true);
      setEntryNotify(updated.notify ?? null);
      // Corrections were just mailed - refetch so their "sent" state updates.
      setCorrectionsRefresh((n) => n + 1);
    } catch (e: any) {
      setEntryError(e instanceof ApiError ? e.message : "Save failed.");
    } finally {
      setEntrySaving(false);
    }
  }

  const materialsTotal = summary?.materials.reduce((s, m) => s + (m.total || 0), 0) ?? 0;

  // Plain-text invoice block - admin office assistant pastes this into invoice
  // software, so the layout favors easy copy-paste over visual polish.
  // Excludes the JOB_NOTES sentinel rows used for the global-notes textarea
  // (they aren't crew activity, just a transport for the Notes field).
  const invoiceText = useMemo(() => {
    if (!summary) return "";
    const lines: string[] = [];
    const header = summary.job_name || "Unnamed job";
    lines.push(header);

    const dates = Array.from(
      new Set(
        summary.events
          .map((e) => e.timestamp)
          .filter((t): t is string => !!t)
          .map((t) => formatMountainDate(t)),
      ),
    );
    if (dates.length === 1) lines.push(dates[0]);
    else if (dates.length > 1) lines.push(`${dates[0]} → ${dates[dates.length - 1]}`);
    lines.push("");

    const events = summary.events
      .filter((e) => e.type !== "JOB_NOTES" && !!e.timestamp)
      .sort((a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime());
    if (events.length > 0) {
      lines.push("TIMESTAMPS:");
      for (const e of events) {
        lines.push(`  ${e.type.padEnd(10, " ")} ${formatMountainTime(e.timestamp!)}`);
      }
      lines.push("");
    }

    // Aggregate material qtys across submissions so the office assistant
    // doesn't have to add by hand.
    const materialTotals = new Map<string, number>();
    for (const m of summary.materials) {
      for (const it of m.items) {
        materialTotals.set(it.name, (materialTotals.get(it.name) ?? 0) + (it.qty || 0));
      }
    }
    if (materialTotals.size > 0) {
      lines.push("MATERIALS:");
      const sorted = [...materialTotals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      for (const [n, qty] of sorted) {
        lines.push(`  ${qty} × ${n}`);
      }
      lines.push("");
    }

    const hours = summary.job_report?.employee_hours ?? [];
    if (hours.length > 0) {
      lines.push("EMPLOYEE HOURS:");
      let totalActual = 0;
      for (const emp of hours) {
        const span = emp.start && emp.end ? `${emp.start}–${emp.end}` : (emp.start || emp.end || "");
        const breakStr = emp.break_hours > 0 ? `, break ${emp.break_hours.toFixed(2)}h` : "";
        const actual = emp.hours || 0;
        const rounded = roundBillableQuarter(actual);
        // Always show both rounded and actual on every row, billable or
        // not, so the office assistant has the full picture even when no
        // rounding occurred. Total still rounds the *summed actuals*
        // once at the end - invoice off the totals line, not by adding
        // rows. Non-billable rows display the same way but are excluded
        // from the total sum.
        const tail = `${rounded.toFixed(2)}h (actual ${actual.toFixed(2)}h)`;
        if (emp.non_billable) {
          lines.push(`  ${emp.name || "-"}: ${span}${breakStr} → non-billable ${tail}`);
        } else {
          lines.push(`  ${emp.name || "-"}: ${span}${breakStr} → ${tail}`);
          totalActual += actual;
        }
      }
      const totalBillable = roundBillableQuarter(totalActual);
      lines.push(
        `  Total man-hours: ${totalBillable.toFixed(2)}h (actual ${totalActual.toFixed(2)}h)`
      );
    }

    return lines.join("\n").replace(/\n+$/, "");
  }, [summary]);

  async function copyInvoice() {
    try {
      await navigator.clipboard.writeText(invoiceText);
      setInvoiceCopied(true);
      window.setTimeout(() => setInvoiceCopied(false), 1800);
    } catch {
      // Clipboard API blocked (HTTP, permissions) - fall back to selecting the
      // textarea so the user can Cmd/Ctrl-C manually.
      const ta = document.getElementById("invoice-copy-text") as HTMLTextAreaElement | null;
      ta?.select();
    }
  }
  const billTotal = summary?.bill
    ? summary.bill.items.reduce((s, it) => {
        const qty = it.qty || 0;
        const rate = it.rate || 0;
        const disc = it.discount || 0;
        return s + qty * rate * (1 - disc / 100);
      }, 0) * (1 - (summary.bill.global_discount || 0) / 100)
    : 0;

  return (
    <div style={{ marginTop: 16 }}>
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Look up job</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
          Search by date and/or customer name. Results below link through to
          the full summary.
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <label className="col" style={{ gap: 4, flex: "1 1 160px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Job date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="col" style={{ gap: 4, flex: "2 1 200px" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Customer name (partial)</span>
            <input
              type="text"
              placeholder="e.g. Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") search(); }}
            />
          </label>
          <button
            className="btnPrimary"
            onClick={search}
            disabled={loading}
            style={{ alignSelf: "flex-end" }}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
        {err && <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}
      </div>

      {candidates != null && !summary && (
        <div className="card">
          <div className="microLabel" style={{ marginBottom: 10 }}>
            Matches ({candidates.length})
          </div>
          {candidates.length === 0 ? (
            <div className="small" style={{ color: "var(--muted)" }}>
              No jobs match those filters.
            </div>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              {candidates.map((c) => (
                <button
                  key={c.job_uuid}
                  onClick={() => loadSummary(c.job_uuid)}
                  style={{ textAlign: "left" }}
                >
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {c.job_name || "(unnamed job)"}
                    </div>
                    <span
                      className="chip"
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        color: c.entered ? "var(--ok)" : "var(--brand2)",
                        borderColor: c.entered ? "color-mix(in srgb, var(--ok) 30%, transparent)" : "color-mix(in srgb, var(--brand2) 30%, transparent)",
                      }}
                    >
                      {c.entered ? "✓ Entered" : "Pending entry"}
                    </span>
                  </div>
                  <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                    {c.dates.length > 0
                      ? c.dates.length === 1
                        ? c.dates[0]
                        : `${c.dates[0]} → ${c.dates[c.dates.length - 1]}`
                      : "no dates"}
                    {" · "}{c.event_count} event{c.event_count === 1 ? "" : "s"}
                    {" · "}{c.material_count} material{c.material_count === 1 ? "" : "s"}
                  </div>
                  <div className="small" style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: 11, marginTop: 2 }}>
                    {c.job_uuid}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {summary && (
        <>
          {/* Phase C metrics strip: one bordered row split into columns
              (microLabel + large mono value), not separate KPI boxes. Uses the
              figures already computed for this job's summary below. */}
          <div className="card" style={{ display: "flex", flexWrap: "wrap", padding: 0, overflow: "hidden" }}>
            {[
              { label: "Bill", value: `$${Number(billTotal || 0).toFixed(0)}` },
              { label: "Materials", value: `$${materialsTotal.toFixed(0)}` },
              { label: "Furniture", value: summary.inventory.furniture_count },
              { label: "Boxes", value: summary.inventory.box_count },
              { label: "BOL items", value: summary.bol?.item_count ?? 0 },
              { label: "DVIRs", value: summary.dvirs.length },
            ].map((m, i) => (
              <div key={m.label} style={{ flex: "1 1 88px", minWidth: 88, padding: "12px 14px", borderLeft: i === 0 ? "none" : "1px solid var(--border)" }}>
                <div className="microLabel">{m.label}</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{m.value}</div>
              </div>
            ))}
          </div>
          <div className="card">
            <button
              onClick={() => setSummary(null)}
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12, padding: 0, marginBottom: 8 }}
            >
              ← Back to matches
            </button>
            <div className="microLabel" style={{ marginBottom: 10 }}>{summary.job_name || "Unnamed job"}</div>
            <div className="small" style={{ color: "var(--muted)", fontFamily: "monospace" }}>{summary.job_uuid}</div>
            <div className="small" style={{ color: "var(--muted)", marginTop: 8 }}>
              {summary.events.length} event{summary.events.length === 1 ? "" : "s"} ·
              {" "}{summary.dvirs.length} DVIR{summary.dvirs.length === 1 ? "" : "s"} ·
              {" "}{summary.materials.length} material submission{summary.materials.length === 1 ? "" : "s"} ·
              {" "}{summary.photos.length} photo{summary.photos.length === 1 ? "" : "s"} ·
              {" "}{summary.admin_notes.length} admin note{summary.admin_notes.length === 1 ? "" : "s"}
            </div>
          </div>

          {summary.admin_notes.length > 0 && (
            <div className="card">
              <div className="microLabel" style={{ marginBottom: 10 }}>Admin Notes</div>
              <div className="col" style={{ gap: 10 }}>
                {summary.admin_notes.map((n) => (
                  <div key={n.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{n.title}</div>
                    <div className="small" style={{ color: "var(--muted)" }}>
                      {n.updated_at ? formatMountainDateTime(n.updated_at) : ""}
                      {n.created_by_name ? ` · ${n.created_by_name}` : ""}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>{n.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="microLabel" style={{ marginBottom: 10 }}>Timeline ({summary.events.length})</div>
            {summary.events.length === 0 ? (
              <div className="small" style={{ color: "var(--muted)" }}>No events logged.</div>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                {summary.events.map((e) => {
                  const wasEdited =
                    !!e.logged_at && !!e.timestamp &&
                    new Date(e.logged_at).getTime() !== new Date(e.timestamp).getTime();
                  return (
                    <div key={e.event_id} className="row" style={{ gap: 8, borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                      <span className="chip" style={{ fontSize: 11, textTransform: "uppercase" }}>{e.type}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="small" style={{ color: "var(--muted)" }}>
                          {e.timestamp ? formatMountainDateTime(e.timestamp) : ""}
                          {e.created_by ? ` · ${e.created_by}` : ""}
                        </div>
                        {wasEdited && e.logged_at && (
                          <div className="small" style={{ color: "var(--muted)", fontSize: 11, fontStyle: "italic" }}>
                            edited - logged at {formatMountainDateTime(e.logged_at)}
                          </div>
                        )}
                        {e.note && <div style={{ fontSize: 13 }}>{e.note}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card">
            <div className="microLabel" style={{ marginBottom: 10 }}>
              Materials ({summary.materials.length})
              <span className="small" style={{ color: "var(--muted)", marginLeft: 8 }}>
                Total ${materialsTotal.toFixed(2)}
              </span>
            </div>
            {summary.materials.length === 0 ? (
              <div className="small" style={{ color: "var(--muted)" }}>None submitted.</div>
            ) : (
              <div className="col" style={{ gap: 10 }}>
                {summary.materials.map((m) => (
                  <div key={m.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <div className="small" style={{ color: "var(--muted)" }}>
                        {m.created_at ? formatMountainDateTime(m.created_at) : ""}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>${m.total.toFixed(2)}</div>
                    </div>
                    <div className="col" style={{ gap: 2, marginTop: 4 }}>
                      {m.items.map((it, i) => (
                        <div key={i} className="small">
                          {it.qty} × {it.name}
                          {it.unitPrice != null ? ` @ $${Number(it.unitPrice).toFixed(2)}` : ""}
                        </div>
                      ))}
                    </div>
                    {m.notes && <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>{m.notes}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            {(() => {
              // Round-at-end: sum actual billable hours first, round once.
              // Per-row displays show actuals so the office assistant can see
              // the raw math before the company rule kicks in.
              const rows = summary.job_report?.employee_hours ?? [];
              const totalActual = rows.reduce(
                (s, e) => s + (e.non_billable ? 0 : (e.hours || 0)),
                0,
              );
              const totalBillable = roundBillableQuarter(totalActual);
              return (
                <>
                  <div className="microLabel" style={{ marginBottom: 10 }}>
                    Employee Hours
                    {summary.job_report && rows.length > 0 && (
                      <span className="small" style={{ color: "var(--muted)", marginLeft: 8 }}>
                        Total {totalBillable.toFixed(2)}h
                      </span>
                    )}
                  </div>
                  {!summary.job_report || rows.length === 0 ? (
                    <div className="small" style={{ color: "var(--muted)" }}>
                      {!summary.job_report
                        ? "Job report not yet submitted."
                        : "No employee hours recorded for this job."}
                    </div>
                  ) : (
                    <>
                      <div className="col" style={{ gap: 0 }}>
                        {rows.map((emp, i) => {
                          const span = emp.start && emp.end ? `${emp.start}–${emp.end}` : (emp.start || emp.end || "");
                          return (
                            <div
                              key={i}
                              style={{
                                padding: "8px 0",
                                borderBottom: "1px solid var(--border)",
                                opacity: emp.non_billable ? 0.7 : 1,
                              }}
                            >
                            <div
                              className="row"
                              style={{
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <div style={{ fontWeight: 700, fontSize: 14 }}>{emp.name || "-"}</div>
                                  {emp.non_billable && (
                                    <span
                                      className="chip"
                                      style={{
                                        fontSize: 10,
                                        padding: "2px 8px",
                                        color: "var(--muted)",
                                      }}
                                    >
                                      Non-billable
                                    </span>
                                  )}
                                </div>
                                <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                                  {span}
                                  {emp.break_hours > 0 ? ` · break ${emp.break_hours.toFixed(2)}h` : ""}
                                </div>
                              </div>
                              <div style={{ flex: "0 0 auto", textAlign: "right" }}>
                                {emp.non_billable ? (
                                  <div className="small" style={{ color: "var(--muted)" }}>
                                    {roundBillableQuarter(emp.hours || 0).toFixed(2)}h
                                    {" "}(actual {(emp.hours || 0).toFixed(2)}h)
                                  </div>
                                ) : (
                                  <div>
                                    <span style={{ fontWeight: 700, fontSize: 14 }}>
                                      {roundBillableQuarter(emp.hours || 0).toFixed(2)}h
                                    </span>
                                    <span
                                      className="small"
                                      style={{ color: "var(--muted)", marginLeft: 6 }}
                                    >
                                      (actual {(emp.hours || 0).toFixed(2)}h)
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                            {/* Skill ratings. They were already in this API response
                                and simply never rendered, so the entire skills
                                feature was invisible to the person it was built for.
                                -1 is the rater's explicit "not applicable", which is
                                different from unrated (absent) and from a 0. */}
                            {emp.skill_ratings && Object.keys(emp.skill_ratings).length > 0 && (
                              <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                                {Object.entries(emp.skill_ratings).map(([skill, score]) => (
                                  <span
                                    key={skill}
                                    className="small"
                                    style={{
                                      border: "1px solid var(--border)",
                                      borderRadius: 999,
                                      padding: "1px 8px",
                                      color: score === -1 ? "var(--muted)" : "var(--text)",
                                    }}
                                  >
                                    {skill}:{" "}
                                    <strong style={{ color: score === -1 ? "var(--muted)" : "var(--brand)" }}>
                                      {score === -1 ? "N/A" : `${score}/5`}
                                    </strong>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                      <div
                        className="row"
                        style={{
                          justifyContent: "space-between",
                          alignItems: "center",
                          paddingTop: 10,
                          fontWeight: 700,
                        }}
                      >
                        <span>Total man-hours</span>
                        <span>
                          {totalBillable.toFixed(2)}h
                          <span
                            className="small"
                            style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}
                          >
                            (actual {totalActual.toFixed(2)}h)
                          </span>
                        </span>
                      </div>
                    </>
                  )}
                </>
              );
            })()}
          </div>

          {/* Job-level hour corrections (ADR 0032). Employees are those on the
              report who resolved to a user_id, deduped. */}
          <JobHourCorrections
            jobUuid={summary.job_uuid}
            refreshSignal={correctionsRefresh}
            employees={Array.from(
              new Map(
                (summary.job_report?.employee_hours ?? [])
                  .filter((e) => typeof e.user_id === "number")
                  .map((e) => [e.user_id as number, { user_id: e.user_id as number, name: e.name || "-" }]),
              ).values(),
            )}
          />

          <div className="card">
            <div className="microLabel" style={{ marginBottom: 10 }}>DVIRs ({summary.dvirs.length})</div>
            {summary.dvirs.length === 0 ? (
              <div className="small" style={{ color: "var(--muted)" }}>None for this job.</div>
            ) : (
              <div className="col" style={{ gap: 10 }}>
                {summary.dvirs.map((d) => (
                  <div key={d.dvir_id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                    <div className="row" style={{ justifyContent: "space-between", gap: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>
                        {d.vehicle_number}{d.trailer_number ? ` / ${d.trailer_number}` : ""} · {d.inspection_type}
                      </div>
                      <span className="chip" style={{ fontSize: 11, color: d.condition === "satisfactory" ? "var(--ok)" : "var(--danger)" }}>
                        {d.condition === "satisfactory" ? "Satisfactory" : `${d.defects.length} defect${d.defects.length === 1 ? "" : "s"}`}
                      </span>
                    </div>
                    <div className="small" style={{ color: "var(--muted)" }}>
                      {d.inspection_date} · driver {d.driver_name}
                      {d.mechanic_name ? ` · mechanic ${d.mechanic_name}` : ""}
                    </div>
                    {d.defects.length > 0 && (
                      <div className="small" style={{ marginTop: 4 }}>
                        Defects: {d.defects.join(", ")}
                      </div>
                    )}
                    {d.defect_notes && <div style={{ fontSize: 13, marginTop: 4 }}>{d.defect_notes}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div className="microLabel" style={{ marginBottom: 10 }}>Invoice copy-paste</div>
              <button onClick={copyInvoice} disabled={!invoiceText} style={{ fontSize: 12 }}>
                {invoiceCopied ? "✓ Copied" : "Copy"}
              </button>
            </div>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
              Plain-text timestamps + materials counts, ready to paste into invoice software.
            </div>
            <textarea
              id="invoice-copy-text"
              readOnly
              value={invoiceText}
              rows={Math.min(20, Math.max(6, invoiceText.split("\n").length))}
              style={{
                width: "100%",
                fontFamily: "monospace",
                fontSize: 12,
                whiteSpace: "pre",
                resize: "vertical",
              }}
            />
          </div>

          <div className="card">
            <div className="microLabel" style={{ marginBottom: 10 }}>Job Report</div>
            {!summary.job_report ? (
              <div className="small" style={{ color: "var(--muted)" }}>Not yet submitted.</div>
            ) : (
              <div className="col" style={{ gap: 4 }}>
                <div className="small"><strong>Submitted by:</strong> {summary.job_report.submitted_by_name ?? "-"}</div>
                <div className="small"><strong>Personal vehicles:</strong> {summary.job_report.personal_vehicles}</div>
                <div className="small"><strong>M1 dumpster:</strong> {summary.job_report.dumpster_pct}%</div>
                <div className="small"><strong>M1 recycling:</strong> {summary.job_report.recycling_pct}%</div>
                <div className="small"><strong>Billing method:</strong> {summary.job_report.billing_method}</div>
                <div className="small"><strong>Review candidate:</strong> {
                  summary.job_report.review_candidate === "yes" ? "Yes" :
                  summary.job_report.review_candidate === "no"  ? "No"  :
                  summary.job_report.review_candidate === "na"  ? "N/A" :
                  "-"
                }</div>
                <div className="small">
                  <strong>Hours match:</strong> {summary.job_report.hours_match ? "Yes" : "No"}
                  {!summary.job_report.hours_match && summary.job_report.hours_mismatch_reason
                    ? ` - ${summary.job_report.hours_mismatch_reason}`
                    : ""}
                </div>
                {/* Everything below existed on the report and in the sheet, and none
                    of it reached this page. Job type in particular decides which
                    skills the crew were rated on, so a rating with no job type
                    beside it is not interpretable. */}
                <div className="small">
                  <strong>Job type:</strong>{" "}
                  {summary.job_report.job_type_tags.length
                    ? summary.job_report.job_type_tags.join(", ")
                    : "not set"}
                </div>
                <div className="small">
                  <strong>Hours verified by lead:</strong> {summary.job_report.hours_verified ? "Yes" : "No"}
                </div>
                {summary.job_report.bill_personal_vehicles && (
                  <div className="small"><strong>Bill personal vehicles:</strong> Yes</div>
                )}
                {summary.job_report.out_of_town && (
                  <div className="small"><strong>Out of town:</strong> Yes</div>
                )}
                {summary.job_report.truck_fullness.length > 0 && (
                  <div className="small">
                    <strong>Truck fullness:</strong>{" "}
                    {summary.job_report.truck_fullness
                      .map((t) => `${t.truck ?? "truck"} ${t.vertical_pct ?? 0}%v / ${t.horizontal_pct ?? 0}%h`)
                      .join(" · ")}
                  </div>
                )}
                {summary.job_report.crew_feedback && (
                  <div
                    className="small"
                    style={{
                      marginTop: 6,
                      padding: "6px 8px",
                      borderLeft: "3px solid var(--brand)",
                      background: "var(--card2)",
                    }}
                  >
                    <strong>Crew feedback:</strong> {summary.job_report.crew_feedback}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Incidents ──
              A liability record. It was reaching the sheet and not this page, so the
              one screen called "every source for a job" omitted the damage claims. */}
          <div className="card" style={{ borderColor: summary.incidents.length ? "var(--danger)" : undefined }}>
            <div className="microLabel" style={{ marginBottom: 10 }}>Incidents ({summary.incidents.length})</div>
            {summary.incidents.length === 0 ? (
              <div className="small" style={{ color: "var(--muted)" }}>None reported.</div>
            ) : (
              <div className="col" style={{ gap: 10 }}>
                {summary.incidents.map((i) => (
                  <div
                    key={i.incident_uuid}
                    style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}
                  >
                    <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                      <span style={{ fontWeight: 800, fontSize: 12, textTransform: "uppercase", color: i.severity === "major" ? "var(--danger)" : i.severity === "moderate" ? "var(--warn)" : "var(--ok)" }}>
                        {i.severity}
                      </span>
                      {i.claim_number && (
                        <span className="small" style={{ fontWeight: 700, color: "var(--brand)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px" }}>
                          {i.claim_number}
                        </span>
                      )}
                      {i.resolved && <span className="small" style={{ color: "var(--ok)" }}>Resolved</span>}
                      <span className="small" style={{ color: "var(--muted)", marginLeft: "auto" }}>{i.incident_date || ""}</span>
                    </div>
                    <div style={{ fontSize: 14, marginTop: 4 }}>{i.description || "(no description)"}</div>
                    <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                      {[
                        i.reported_by_name ? `Reported by ${i.reported_by_name}` : null,
                        i.attributed_crew ? `Attributed to ${i.attributed_crew}` : null,
                        i.attributable && i.attributable !== "unknown" ? `Attributable: ${i.attributable}` : null,
                        i.est_cost != null ? `Est. cost $${i.est_cost.toFixed(2)}` : null,
                      ].filter(Boolean).join(" · ")}
                    </div>
                    {i.photo_urls.length > 0 && (
                      <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
                        {i.photo_urls.map((u, n) => (
                          <a key={u} href={u} target="_blank" rel="noreferrer" className="small" style={{ color: "var(--brand)" }}>
                            Photo {n + 1}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Inventory ── */}
          <div className="card">
            <div className="microLabel" style={{ marginBottom: 10 }}>
              Inventory ({summary.inventory.furniture_count} furniture · {summary.inventory.box_count} boxes)
            </div>
            {summary.inventory.items.length === 0 ? (
              <div className="small" style={{ color: "var(--muted)" }}>
                Nothing logged. Inventory is collected on long-distance jobs only (ADR 0015).
              </div>
            ) : (
              <div className="col" style={{ gap: 2 }}>
                {summary.inventory.items.map((it, i) => (
                  <div key={i} className="small">
                    {it.qty} × {it.name}
                    <span style={{ color: "var(--muted)" }}>
                      {[it.pack_type, it.room, it.notes].filter(Boolean).length
                        ? ` - ${[it.pack_type, it.room, it.notes].filter(Boolean).join(" · ")}`
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Bill of lading ── */}
          {summary.bol && (
            <div className="card">
              <div className="microLabel" style={{ marginBottom: 10 }}>Bill of Lading</div>
              <div className="col" style={{ gap: 4 }}>
                <div className="small"><strong>Status:</strong> {summary.bol.status}</div>
                <div className="small"><strong>Items:</strong> {summary.bol.item_count}</div>
                {summary.bol.inventory_verified != null && (
                  <div className="small">
                    <strong>Inventory verified:</strong> {summary.bol.inventory_verified ? "Yes" : "No"}
                    {summary.bol.inventory_note ? ` - ${summary.bol.inventory_note}` : ""}
                  </div>
                )}
                {summary.bol.signed_pdf_url && (
                  <a className="small" href={summary.bol.signed_pdf_url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>
                    Open signed PDF
                  </a>
                )}
              </div>
            </div>
          )}

          {/* ── Long-distance per-diem / drive days ──
              $50 per person per out-of-town day, so admin needs the count, not the flag. */}
          {summary.ld_days.length > 0 && (
            <div className="card">
              <div className="microLabel" style={{ marginBottom: 10 }}>Long-distance days</div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>
                Per-diem is owed per out-of-town day, per person.
              </div>
              <div className="col" style={{ gap: 2 }}>
                {summary.ld_days.map((d, i) => (
                  <div key={i} className="small">
                    {d.date} - <strong>{d.driver_name}</strong>
                    <span style={{ color: "var(--muted)" }}>
                      {[d.out_of_town ? "out of town" : null, d.drive_day ? "drive day" : null]
                        .filter(Boolean).join(" · ") || " no flags"}
                    </span>
                  </div>
                ))}
                <div className="small" style={{ marginTop: 6, fontWeight: 700 }}>
                  Per-diem days: {summary.ld_days.filter((d) => d.out_of_town).length} · Drive days:{" "}
                  {summary.ld_days.filter((d) => d.drive_day).length}
                </div>
              </div>
            </div>
          )}

          {/* ── Reimbursements tied to this job ── */}
          {summary.reimbursements.length > 0 && (
            <div className="card">
              <div className="microLabel" style={{ marginBottom: 10 }}>Reimbursements ({summary.reimbursements.length})</div>
              <div className="col" style={{ gap: 4 }}>
                {summary.reimbursements.map((r) => (
                  <div key={r.reimbursement_uuid} className="small">
                    <strong>{r.user_name}</strong> - {r.type}
                    {r.amount != null ? ` $${r.amount.toFixed(2)}` : ""}
                    {r.category ? ` (${r.category})` : ""}
                    <span style={{ color: "var(--muted)" }}> · {r.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div className="microLabel" style={{ marginBottom: 0 }}>
                Bill
                {summary.bill && (
                  <span className="small" style={{ color: "var(--muted)", marginLeft: 8 }}>
                    Total ${billTotal.toFixed(2)}
                  </span>
                )}
              </div>
              {!editingBill && (
                <button type="button" onClick={() => setEditingBill(true)} style={{ fontSize: 12 }}>
                  Correct bill
                </button>
              )}
            </div>
            {!summary.bill ? (
              <div className="small" style={{ color: "var(--muted)", marginTop: 10 }}>No bill saved.</div>
            ) : (
              <div className="col" style={{ gap: 4, marginTop: 10 }}>
                <div className="small"><strong>Saved by:</strong> {summary.bill.saved_by_name ?? "-"}</div>
                <div className="small"><strong>Global discount:</strong> {summary.bill.global_discount}%</div>
                {summary.bill.items.map((it, i) => (
                  <div key={i} className="small">
                    {it.qty ?? 1} × {it.label ?? ""} @ ${Number(it.rate ?? 0).toFixed(2)}
                    {it.discount ? ` (−${it.discount}%)` : ""}
                  </div>
                ))}
                {summary.bill.notes && (
                  <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>{summary.bill.notes}</div>
                )}
              </div>
            )}
            {editingBill && (
              <BillCorrectionEditor
                jobUuid={summary.job_uuid}
                bill={{
                  items: (summary.bill?.items ?? []) as BillItem[],
                  global_discount: summary.bill?.global_discount ?? 0,
                  notes: summary.bill?.notes ?? null,
                }}
                reportBilling={
                  summary.job_report
                    ? {
                        personal_vehicles: summary.job_report.personal_vehicles,
                        dumpster_pct: summary.job_report.dumpster_pct,
                        recycling_pct: summary.job_report.recycling_pct,
                        billing_method: summary.job_report.billing_method,
                        bill_personal_vehicles: summary.job_report.bill_personal_vehicles,
                      }
                    : null
                }
                onClose={() => setEditingBill(false)}
                onSaved={() => loadSummary(summary.job_uuid)}
              />
            )}
          </div>

          <div className="card">
            <div className="microLabel" style={{ marginBottom: 10 }}>Photos ({summary.photos.length})</div>
            {summary.photos.length === 0 ? (
              <div className="small" style={{ color: "var(--muted)" }}>No photos uploaded.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                {summary.photos.map((p) => (
                  <a
                    key={p.id}
                    href={p.drive_url}
                    target="_blank"
                    rel="noreferrer"
                    className="card"
                    style={{ padding: 8, textDecoration: "none", color: "var(--text)" }}
                  >
                    <div className="small" style={{ fontWeight: 700, wordBreak: "break-word" }}>
                      {p.caption || "(no caption)"}
                    </div>
                    <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
                      {p.created_by ?? ""}
                      {p.created_at ? ` · ${formatMountainDate(p.created_at)}` : ""}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div className="microLabel" style={{ marginBottom: 10 }}>Initial this job</div>
              <span
                className="chip"
                style={{
                  fontSize: 10,
                  padding: "2px 8px",
                  color: summary.entry_status ? "var(--ok)" : "var(--brand2)",
                  borderColor: summary.entry_status ? "color-mix(in srgb, var(--ok) 30%, transparent)" : "color-mix(in srgb, var(--brand2) 30%, transparent)",
                }}
              >
                {summary.entry_status ? "✓ Initialed" : "Pending"}
              </span>
            </div>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
              Initialing is your sign-off that all three below are true. Saving
              writes your initials into every job-related sheet for this job and
              emails each crew member any correction made to their hours above.
            </div>
            {(() => {
              const checkRow = (
                checked: boolean,
                set: (v: boolean) => void,
                label: string,
              ) => (
                <label className="row" style={{ gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => { set(e.target.checked); setEntrySaved(false); }}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  <span className="small">{label}</span>
                </label>
              );
              return (
                <div className="col" style={{ gap: 8, marginBottom: 12 }}>
                  {checkRow(entryValidated, setEntryValidated, "I reviewed this job's record.")}
                  {checkRow(entryCorrected, setEntryCorrected, "I made any needed hour corrections (or there were none).")}
                  {checkRow(entryConfirmedSheet, setEntryConfirmedSheet, "I confirmed this job's data landed in the Google Sheet.")}
                </div>
              );
            })()}
            <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
              <label className="col" style={{ gap: 2, flex: "1 1 120px", minWidth: 100 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Initials</span>
                <input
                  type="text"
                  value={entryInitials}
                  onChange={(e) => { setEntryInitials(e.target.value); setEntrySaved(false); }}
                  placeholder="e.g. JC"
                  maxLength={16}
                />
              </label>
              <label className="col" style={{ gap: 2, flex: "1 1 160px", minWidth: 140 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Date</span>
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => { setEntryDate(e.target.value); setEntrySaved(false); }}
                />
              </label>
              <button
                onClick={saveEntryStatus}
                disabled={entrySaving || !(entryValidated && entryCorrected && entryConfirmedSheet)}
                className="btnPrimary"
                style={{ flex: "0 0 auto" }}
              >
                {entrySaving ? "Saving…" : (summary.entry_status ? "Update" : "Initial job")}
              </button>
            </div>
            {entryError && (
              <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{entryError}</div>
            )}
            {entrySaved && !entryError && (
              <div className="col" style={{ gap: 4, marginTop: 8 }}>
                <div className="small" style={{ color: "var(--ok)" }}>
                  ✓ Initialed and propagated to sheets
                </div>
                {entryNotify?.email_unconfigured && (
                  <div className="small" style={{ color: "var(--warn, #e0a800)" }}>
                    Corrections were not emailed: email is not configured on this
                    server. They will send on the next initialing once it is.
                  </div>
                )}
                {entryNotify?.sent.map((s) => (
                  <div key={s.user_id} className="small" style={{ color: "var(--ok)" }}>
                    Emailed {s.name} ({s.count} correction{s.count === 1 ? "" : "s"})
                  </div>
                ))}
                {entryNotify?.failed.map((f) => (
                  <div key={f.user_id} className="small" style={{ color: "var(--danger)" }}>
                    Could not email {f.name}: {f.error}. Their corrections will retry on the next initialing.
                  </div>
                ))}
              </div>
            )}
            {summary.entry_status && (
              <div className="small" style={{ color: "var(--muted)", marginTop: 8 }}>
                Last initialed by {summary.entry_status.updated_by_name || "-"}
                {summary.entry_status.updated_at ? ` on ${formatMountainDateTime(summary.entry_status.updated_at)}` : ""}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
