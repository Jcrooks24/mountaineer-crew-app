import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
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
  type HelpTexts,
} from "../theme/ThemeContext";
import SignaturePad, { type SignaturePadHandle } from "../components/SignaturePad";
import EstimatorTab from "../components/EstimatorTab";
import {
  formatMountainDate,
  formatMountainDateTime,
  formatMountainTime,
} from "../lib/time";

type AdminUser = {
  id: number;
  email: string;
  name: string | null;
  role: string;
  is_active: boolean;
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

type Tab = "employees" | "map" | "settings" | "advanced" | "dvir" | "estimator" | "notes" | "summary";

export default function Admin() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("employees");

  useEffect(() => {
    if (user && user.role !== "admin") nav("/", { replace: true });
  }, [user, nav]);

  if (!user || user.role !== "admin") return null;

  return (
    <div className="container" style={{ maxWidth: 860 }}>
      {/* Header */}
      <div className="topbar" style={{ marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Admin Dashboard</span>
        <button
          onClick={() => nav(-1)}
          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}
        >
          ← Back
        </button>
      </div>

      {/* Tabs */}
      <div className="tabbar" style={{ flexWrap: "wrap" }}>
        {(["employees", "map", "settings", "dvir", "estimator", "notes", "summary"] as Tab[]).map((t) => (
          <button
            key={t}
            className={"tab " + (tab === t || (tab === "advanced" && t === "settings") ? "active" : "")}
            onClick={() => setTab(t)}
            style={{ textTransform: "capitalize" }}
          >
            {t === "map" ? "Map (Today)"
              : t === "dvir" ? "DVIR Review"
              : t === "notes" ? "Notes"
              : t === "summary" ? "Job Summary"
              : t}
          </button>
        ))}
      </div>

      {tab === "employees" && <EmployeesTab />}
      {tab === "map" && <MapTab />}
      {tab === "settings" && <SettingsTab onOpenAdvanced={() => setTab("advanced")} />}
      {tab === "advanced" && <AdvancedSettingsPage onBack={() => setTab("settings")} />}
      {tab === "dvir" && <DVIRTab />}
      {tab === "estimator" && <EstimatorTab />}
      {tab === "notes" && <NotesTab />}
      {tab === "summary" && <JobSummaryTab />}
    </div>
  );
}

// ─────────────────────────────────────────
// Employees tab
// ─────────────────────────────────────────
function EmployeesTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<AdminUser[]>("/api/admin/users")
      .then(setUsers)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
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

  async function toggleRole(u: AdminUser) {
    const newRole = u.role === "admin" ? "user" : "admin";
    if (!confirm(`Make ${u.email} a ${newRole}?`)) return;
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

  if (loading) return <div className="card small">Loading...</div>;
  if (err) return <div className="card" style={{ color: "var(--danger)" }}>{err}</div>;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 540 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,0.02)" }}>
            {["Name", "Email", "Role", "Status", "Actions"].map((h) => (
              <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "var(--muted)", fontWeight: 600 }}>{h}</th>
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
              <td style={{ padding: "10px 14px" }}>{u.name || <span style={{ color: "var(--muted)" }}>—</span>}</td>
              <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{u.email}</td>
              <td style={{ padding: "10px 14px", textTransform: "capitalize" }}>{u.role}</td>
              <td style={{ padding: "10px 14px" }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 999,
                  background: u.is_active ? "rgba(45,212,191,0.15)" : "rgba(255,107,107,0.15)",
                  color: u.is_active ? "var(--ok)" : "var(--danger)",
                }}>
                  {u.is_active ? "Active" : "Disabled"}
                </span>
              </td>
              <td style={{ padding: "10px 14px" }}>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    disabled={busy === u.id}
                    onClick={() => toggleAccess(u)}
                    style={{
                      fontSize: 12, padding: "4px 10px",
                      background: u.is_active ? "rgba(255,107,107,0.2)" : "rgba(45,212,191,0.2)",
                      border: `1px solid ${u.is_active ? "var(--danger)" : "var(--ok)"}`,
                      color: u.is_active ? "var(--danger)" : "var(--ok)",
                      borderRadius: 8,
                    }}
                  >
                    {u.is_active ? "Revoke" : "Restore"}
                  </button>
                  <button
                    disabled={busy === u.id}
                    onClick={() => toggleRole(u)}
                    style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8 }}
                  >
                    → {u.role === "admin" ? "User" : "Admin"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
                  background: active ? "rgba(93,214,194,0.15)" : "rgba(255,255,255,0.04)",
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
        <div className="sectionTitle">Google Calendar OAuth</div>

        <div className="row" style={{ marginBottom: 12 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
            background: status?.ok && status?.valid ? "rgba(45,212,191,0.15)" : "rgba(255,107,107,0.15)",
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
        <div className="sectionTitle">Update OAuth Token</div>
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
// Settings tab
// ─────────────────────────────────────────
function SettingsTab({ onOpenAdvanced }: { onOpenAdvanced: () => void }) {
  const { settings, update, reset } = useTheme();
  const preset = THEME_PRESETS[settings.themeId] ?? THEME_PRESETS["dark-ocean"];

  const [brandLocal, setBrandLocal] = useState(settings.brandOverride ?? preset.vars["--brand"]);
  const [brand2Local, setBrand2Local] = useState(settings.brand2Override ?? preset.vars["--brand2"]);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
      setApplyMsg({ ok: false, text: "Failed to save — try again." });
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

  return (
    <div>
      {/* ── Theme templates ── */}
      <div className="card">
        <div className="sectionTitle">Theme Template</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
          {Object.entries(THEME_PRESETS).map(([id, p]) => {
            const active = settings.themeId === id;
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
        </div>
      </div>

      {/* ── Text contrast + logo variant ── */}
      <div className="card">
        <div className="sectionTitle">Text Color</div>
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
          Sample body text at this setting — a quick brown fox jumps over the lazy dog.
        </div>
      </div>

      <div className="card">
        <div className="sectionTitle">Logo Variant</div>
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
        <div className="sectionTitle">Button Colors</div>
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
        <div className="sectionTitle">Button Style</div>
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
        <div className="sectionTitle">Button Background</div>
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
        <div className="sectionTitle">Font Family</div>
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
        <div className="sectionTitle">Appearance</div>
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
        <div className="sectionTitle">Map Pins</div>
        <div className="col" style={{ gap: 16 }}>

          {/* Pin size */}
          <div className="col" style={{ gap: 8 }}>
            <label className="small">Pin size — {settings.pinSize * 2}px</label>
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

      {/* ── Help text ── */}
      <HelpTextCard />

      {/* ── DVIR vehicle units ── */}
      <DVIRUnitsCard />

      {/* ── Sheet sync (admin recovery for missed events) ── */}
      <SheetSyncCard />

      {/* ── App health check ── */}
      <AppHealthCard />

      {/* ── Advanced settings ── */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="sectionTitle">Advanced Settings</div>
        <div className="small" style={{ color: "var(--muted)" }}>
          Google Calendar integration, data management, and other advanced options.
        </div>
        <button
          onClick={onOpenAdvanced}
          style={{ alignSelf: "flex-start", padding: "8px 18px", fontSize: 13, border: "1px solid var(--border)", borderRadius: "var(--btn-r)", color: "var(--text)", background: "rgba(255,255,255,0.04)", cursor: "pointer" }}
        >
          Open Advanced Settings →
        </button>
      </div>

      {/* ── Apply to all users ── */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="small" style={{ color: "var(--muted)" }}>
          Save your current theme settings as the global default — all crew members will see this theme on their next page load.
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
// Sheet sync — admin "Refresh" button. Picks up events that landed in
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
          ? `Sheet is in sync — nothing to recover (${secs}s)`
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
      <div className="sectionTitle">Sheet Sync</div>
      <div className="small" style={{ color: "var(--muted)" }}>
        Re-export any events that are durable in the app database but missing from the Google Sheet.
        Safe to run any time — duplicates are skipped automatically.
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
// App Health — quick read on the moving parts: client outbox state, server
// reachability, Google API access, sheet drift, event freshness, env vars.
// Plain-text summary in a collapsible block so an admin can paste it into a
// support thread.
//
// LocalStorage keys must match App.tsx. Keeping them as string literals
// (rather than imports) so this card stays self-contained — App.tsx is the
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
      <div className="sectionTitle">App Health</div>
      <div className="small" style={{ color: "var(--muted)" }}>
        Snapshot of critical functions — sync state, network, Google API access, data drift. Plain text so you can copy/paste it.
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

  // localStorage availability — Safari private mode and some kiosk profiles
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
      detail: `not writable — offline queue won't persist (${(e as Error).message})`,
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
    return { name, status: "warn", detail: "queue payload is not JSON — manual cleanup may be needed" };
  }
  if (parsed.length === 0) return { name, status: "ok", detail: `0 ${unit}` };

  // Oldest item — events use "timestamp", note patches use "enqueued_at"
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
  return { name, status, detail: `${parsed.length} ${unit} — oldest ${ageDesc}` };
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
function AdvancedSettingsPage({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button
          onClick={onBack}
          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13, padding: 0 }}
        >
          ← Back to Settings
        </button>
        <span style={{ fontWeight: 700, fontSize: 15 }}>Advanced Settings</span>
      </div>

      <div className="card">
        <div className="sectionTitle">Google Calendar</div>
        <CalendarTab />
      </div>

      <DataManagementCard />
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

  const fields: { key: keyof HelpTexts; label: string }[] = [
    { key: "photoCaptionPlaceholder",   label: "Photo caption placeholder" },
    { key: "jobNotesPlaceholder",       label: "Job notes placeholder" },
    { key: "billNotesPlaceholder",      label: "Bill notes placeholder" },
    { key: "hoursMismatchPlaceholder",  label: "Hours mismatch reason placeholder" },
    { key: "jobDescriptionPlaceholder", label: "Manual job description placeholder" },
    { key: "photosHint",                label: "Photos tab instructions" },
  ];

  return (
    <div className="card">
      <div className="sectionTitle">Field Help Text</div>
      <div className="col" style={{ gap: 12 }}>
        {fields.map(({ key, label }) => (
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DVIR Review Tab — mechanic signs off on inspections
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
  created_at: string;
  needs_mechanic_review: boolean;
};

// ─────────────────────────────────────────
// DVIR vehicle units editor
// ─────────────────────────────────────────
function DVIRUnitsCard() {
  const [units, setUnits] = useState<string[]>([]);
  const [newUnit, setNewUnit] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ units: string[] }>("/api/admin/config/dvir-units")
      .then((r) => setUnits(r.units))
      .catch(() => setErr("Failed to load units"));
  }, []);

  function addUnit() {
    const trimmed = newUnit.trim().toUpperCase();
    if (!trimmed) return;
    if (units.includes(trimmed)) { setErr("Unit already exists"); return; }
    setUnits((prev) => [...prev, trimmed]);
    setNewUnit("");
    setSaved(false);
    setErr(null);
  }

  function removeUnit(unit: string) {
    setUnits((prev) => prev.filter((u) => u !== unit));
    setSaved(false);
  }

  async function save() {
    if (units.length === 0) { setErr("At least one unit is required"); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/admin/config/dvir-units", {
        method: "PUT",
        body: JSON.stringify({ units }),
      });
      setSaved(true);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="sectionTitle">DVIR Vehicle Units</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>
        Vehicle unit options shown in the DVIR form dropdown.
      </div>

      {/* Current units */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {units.map((u) => (
          <span key={u} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 10px", borderRadius: 999,
            background: "rgba(93,214,194,0.12)", border: "1px solid var(--brand)",
            color: "var(--brand)", fontSize: 13, fontWeight: 600,
          }}>
            {u}
            <button
              onClick={() => removeUnit(u)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 14, lineHeight: 1, padding: 0 }}
              aria-label={`Remove ${u}`}
            >
              ×
            </button>
          </span>
        ))}
        {units.length === 0 && (
          <span className="small" style={{ color: "var(--muted)" }}>No units configured</span>
        )}
      </div>

      {/* Add new unit */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          value={newUnit}
          onChange={(e) => { setNewUnit(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUnit(); } }}
          placeholder="e.g. 20FORD"
          style={{
            flex: 1, padding: "8px 12px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--bg)",
            color: "var(--text)", fontSize: 14,
          }}
        />
        <button
          onClick={addUnit}
          style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--brand)", color: "var(--brand)", fontSize: 13, cursor: "pointer" }}
        >
          Add
        </button>
      </div>

      {err && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>{err}</div>}
      {saved && !busy && <div style={{ color: "var(--ok)", fontSize: 13, marginBottom: 8 }}>✓ Saved</div>}

      <button className="btnPrimary" onClick={save} disabled={busy} style={{ fontSize: 13 }}>
        {busy ? "Saving…" : "Save Units"}
      </button>
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
          setDvirs((prev) => prev.map((d) => (d.dvir_id === updated.dvir_id ? updated : d)));
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
                    background: d.condition === "satisfactory" ? "rgba(45,212,191,0.15)" : "rgba(255,107,107,0.15)",
                    color: d.condition === "satisfactory" ? "var(--ok)" : "var(--danger)",
                  }}
                >
                  {d.condition === "satisfactory" ? "Satisfactory" : `${d.defects.length} Defect${d.defects.length !== 1 ? "s" : ""}`}
                </span>
                {(() => {
                  const signed = !!d.mechanic_signature;
                  const awaiting = !signed && d.needs_mechanic_review;
                  const label = signed
                    ? "Mech. Signed"
                    : awaiting
                      ? "Awaiting Mechanic"
                      : "No Review Needed";
                  const bg = awaiting ? "rgba(255,200,50,0.12)" : "rgba(45,212,191,0.15)";
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
      <div className="sectionTitle">Data Management</div>
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

  const isSigned = !!dvir.mechanic_signature;

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
              background: dvir.condition === "satisfactory" ? "rgba(45,212,191,0.15)" : "rgba(255,107,107,0.15)",
              color: dvir.condition === "satisfactory" ? "var(--ok)" : "var(--danger)",
            }}
          >
            {dvir.condition === "satisfactory" ? "Satisfactory — No Defects" : "Defects Noted"}
          </span>
        </div>

        {dvir.defects.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Defects:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {dvir.defects.map((d) => (
                <span key={d} className="chip" style={{ background: "rgba(255,107,107,0.12)", color: "var(--danger)" }}>
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
          <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Driver: {dvir.driver_name}</div>
          <img
            src={dvir.driver_signature}
            alt="Driver signature"
            style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}
          />
        </div>
      </div>

      {/* Already signed view */}
      {isSigned ? (
        <div className="card">
          <div className="label" style={{ fontWeight: 700, marginBottom: 8, color: "var(--ok)" }}>
            ✓ Mechanic Approved
          </div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>
            Signed by: {dvir.mechanic_name} · {dvir.mechanic_signed_at ? formatMountainDateTime(dvir.mechanic_signed_at) : ""}
          </div>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
            Repairs made: {dvir.repairs_made ? "Yes" : "No — no repair needed"}
          </div>
          {dvir.mechanic_notes && <div style={{ fontSize: 13, marginBottom: 8 }}>{dvir.mechanic_notes}</div>}
          <img
            src={dvir.mechanic_signature!}
            alt="Mechanic signature"
            style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}
          />
        </div>
      ) : !dvir.needs_mechanic_review ? (
        <div className="card">
          <div className="label" style={{ fontWeight: 700, marginBottom: 8, color: "var(--ok)" }}>
            ✓ No Mechanic Review Required
          </div>
          <div className="small" style={{ color: "var(--muted)" }}>
            Driver reported no defects — vehicle auto-cleared as satisfactory.
          </div>
        </div>
      ) : (
        /* Mechanic sign form */
        <div className="card">
          <div className="label" style={{ fontWeight: 700, marginBottom: 12 }}>Mechanic Approval</div>

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
                      background: repairsMade === value ? "rgba(93,214,194,0.12)" : "var(--card)",
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
              <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>Mechanic Signature * — sign below</div>
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
              <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "rgba(255,107,107,0.1)", borderRadius: 8 }}>
                {err}
              </div>
            )}

            <button type="submit" className="btnPrimary" disabled={busy}>
              {busy ? "Saving…" : "Approve & Sign DVIR"}
            </button>
          </form>
        </div>
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
// Notes tab — Patch Notes authoring
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
        <div className="sectionTitle">{editingId == null ? "New Patch Note" : "Edit Patch Note"}</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
          Shows up on every crew member's Profile tab. Updating a note re-triggers the
          "new patch notes" indicator on the home screen.
        </div>
        <div className="col" style={{ gap: 10 }}>
          <input
            placeholder="Title (e.g. v1.4 — Faster Estimator)"
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
        <div className="sectionTitle">Published Patch Notes</div>
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
// Admin Notes section — global or per-job messages to crew
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
  const [jobDisplay, setJobDisplay] = useState("");  // "Customer — YYYY-MM-DD" once picked
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
    setJobDisplay(`${c.job_name || "(unnamed)"}${dateLabel ? ` — ${dateLabel}` : ""}`);
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
        <div className="sectionTitle">{editingId == null ? "New Admin Note" : "Edit Admin Note"}</div>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
          Leave "Attached job" empty for a global note (shown to every crew member).
          Attach a job to scope the note — it only surfaces when that job is selected.
        </div>
        <div className="col" style={{ gap: 10 }}>
          <input
            placeholder="Title (e.g. New packing-material pricing)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {/* Attached-job row — chip + picker */}
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
                style={{ marginTop: 6, padding: 12, border: "1px solid var(--brand)", background: "rgba(93,214,194,0.05)" }}
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
        <div className="sectionTitle">Published Admin Notes</div>
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
// Job Summary tab — one-page view of every source for a job
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
    dumpster_pct: number;
    recycling_pct: number;
    billing_method: string;
    review_candidate: boolean;
    hours_match: boolean;
    hours_mismatch_reason: string | null;
    updated_at: string | null;
  } | null;
  bill: {
    saved_by_name: string | null;
    items: Array<{ label?: string; qty?: number; unit?: string; rate?: number; discount?: number }>;
    global_discount: number;
    notes: string;
    updated_at: string | null;
  } | null;
  photos: Array<{ id: string; caption: string; drive_url: string; created_by: string | null; created_at: string | null }>;
  admin_notes: Array<{ id: number; title: string; body: string; created_by_name: string | null; updated_at: string | null }>;
};

type JobCandidate = {
  job_uuid: string;
  job_name: string;
  dates: string[];
  event_count: number;
  material_count: number;
};

function JobSummaryTab() {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [candidates, setCandidates] = useState<JobCandidate[] | null>(null);
  const [summary, setSummary] = useState<JobSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [invoiceCopied, setInvoiceCopied] = useState(false);

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
    try {
      const data = await apiFetch<JobSummary>(`/api/admin/job-summary/${encodeURIComponent(jobUuid)}`);
      setSummary(data);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to load summary");
    } finally {
      setLoading(false);
    }
  }

  const materialsTotal = summary?.materials.reduce((s, m) => s + (m.total || 0), 0) ?? 0;

  // Plain-text invoice block — admin office assistant pastes this into invoice
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
    }

    return lines.join("\n");
  }, [summary]);

  async function copyInvoice() {
    try {
      await navigator.clipboard.writeText(invoiceText);
      setInvoiceCopied(true);
      window.setTimeout(() => setInvoiceCopied(false), 1800);
    } catch {
      // Clipboard API blocked (HTTP, permissions) — fall back to selecting the
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
        <div className="sectionTitle">Look up job</div>
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
          <div className="sectionTitle">
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
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {c.job_name || "(unnamed job)"}
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
        <div className="card">
          <button onClick={() => { setSummary(null); }} style={{ fontSize: 12 }}>
            ← Back to matches
          </button>
        </div>
      )}

      {summary && (
        <>
          <div className="card">
            <div className="sectionTitle">{summary.job_name || "Unnamed job"}</div>
            <div className="small" style={{ color: "var(--muted)", fontFamily: "monospace" }}>{summary.job_uuid}</div>
            <div className="small" style={{ color: "var(--muted)", marginTop: 8 }}>
              {summary.events.length} event{summary.events.length === 1 ? "" : "s"} ·
              {" "}{summary.dvirs.length} DVIR{summary.dvirs.length === 1 ? "" : "s"} ·
              {" "}{summary.materials.length} material submission{summary.materials.length === 1 ? "" : "s"} ·
              {" "}{summary.photos.length} photo{summary.photos.length === 1 ? "" : "s"} ·
              {" "}{summary.admin_notes.length} admin note{summary.admin_notes.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div className="sectionTitle">Invoice copy-paste</div>
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

          {summary.admin_notes.length > 0 && (
            <div className="card">
              <div className="sectionTitle">Admin Notes</div>
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
            <div className="sectionTitle">Timeline ({summary.events.length})</div>
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
                            edited — logged at {formatMountainDateTime(e.logged_at)}
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
            <div className="sectionTitle">DVIRs ({summary.dvirs.length})</div>
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
            <div className="sectionTitle">
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
            <div className="sectionTitle">Job Report</div>
            {!summary.job_report ? (
              <div className="small" style={{ color: "var(--muted)" }}>Not yet submitted.</div>
            ) : (
              <div className="col" style={{ gap: 4 }}>
                <div className="small"><strong>Submitted by:</strong> {summary.job_report.submitted_by_name ?? "—"}</div>
                <div className="small"><strong>Personal vehicles:</strong> {summary.job_report.personal_vehicles}</div>
                <div className="small"><strong>M1 dumpster:</strong> {summary.job_report.dumpster_pct}%</div>
                <div className="small"><strong>M1 recycling:</strong> {summary.job_report.recycling_pct}%</div>
                <div className="small"><strong>Billing method:</strong> {summary.job_report.billing_method}</div>
                <div className="small"><strong>Review candidate:</strong> {summary.job_report.review_candidate ? "Yes" : "No"}</div>
                <div className="small">
                  <strong>Hours match:</strong> {summary.job_report.hours_match ? "Yes" : "No"}
                  {!summary.job_report.hours_match && summary.job_report.hours_mismatch_reason
                    ? ` — ${summary.job_report.hours_mismatch_reason}`
                    : ""}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="sectionTitle">
              Bill
              {summary.bill && (
                <span className="small" style={{ color: "var(--muted)", marginLeft: 8 }}>
                  Total ${billTotal.toFixed(2)}
                </span>
              )}
            </div>
            {!summary.bill ? (
              <div className="small" style={{ color: "var(--muted)" }}>No bill saved.</div>
            ) : (
              <div className="col" style={{ gap: 4 }}>
                <div className="small"><strong>Saved by:</strong> {summary.bill.saved_by_name ?? "—"}</div>
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
          </div>

          <div className="card">
            <div className="sectionTitle">Photos ({summary.photos.length})</div>
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
        </>
      )}
    </div>
  );
}
