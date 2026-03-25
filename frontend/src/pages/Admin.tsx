import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  useTheme,
  THEME_PRESETS,
  FONT_OPTIONS,
  RADIUS_OPTIONS,
} from "../theme/ThemeContext";

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

type Tab = "employees" | "map" | "calendar" | "settings";

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
        {(["employees", "map", "calendar", "settings"] as Tab[]).map((t) => (
          <button
            key={t}
            className={"tab " + (tab === t ? "active" : "")}
            onClick={() => setTab(t)}
            style={{ textTransform: "capitalize" }}
          >
            {t === "map" ? "Map (Today)" : t}
          </button>
        ))}
      </div>

      {tab === "employees" && <EmployeesTab />}
      {tab === "map" && <MapTab />}
      {tab === "calendar" && <CalendarTab />}
      {tab === "settings" && <SettingsTab />}
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
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
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
  );
}

// ─────────────────────────────────────────
// Map tab (Leaflet via CDN)
// ─────────────────────────────────────────
function MapTab() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [events, setEvents] = useState<GeoEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<GeoEvent[]>("/api/admin/events/today")
      .then(setEvents)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || err || events.length === 0 || !mapRef.current) return;

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

      const markers = events.map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return L.marker([e.lat, e.lng]).bindPopup(
          `<b>${e.type}</b><br/>${time}${e.note ? `<br/>${e.note}` : ""}`
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
  }, [events, loading, err]);

  if (loading) return <div className="card small">Loading events...</div>;
  if (err) return <div className="card" style={{ color: "var(--danger)" }}>{err}</div>;
  if (events.length === 0) return (
    <div className="card" style={{ color: "var(--muted)", textAlign: "center", padding: 32 }}>
      No geotagged events today.
    </div>
  );

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }} className="small">
        {events.length} geotagged event{events.length !== 1 ? "s" : ""} today
      </div>
      <div ref={mapRef} style={{ width: "100%", height: 500 }} />
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
            {status.expiry && <div className="small">Access token expiry: {new Date(status.expiry).toLocaleString()}</div>}
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
function SettingsTab() {
  const { settings, update, reset } = useTheme();
  const preset = THEME_PRESETS[settings.themeId] ?? THEME_PRESETS["dark-ocean"];

  // Local color state — synced from settings, debounced to context
  const [brandLocal, setBrandLocal] = useState(
    settings.brandOverride ?? preset.vars["--brand"]
  );
  const [brand2Local, setBrand2Local] = useState(
    settings.brand2Override ?? preset.vars["--brand2"]
  );

  // When preset changes, reset local color state to preset colors
  function selectTheme(id: string) {
    const p = THEME_PRESETS[id];
    update({ themeId: id, brandOverride: null, brand2Override: null });
    setBrandLocal(p.vars["--brand"]);
    setBrand2Local(p.vars["--brand2"]);
  }

  function applyBrand(color: string) {
    setBrandLocal(color);
    update({ brandOverride: color });
  }

  function applyBrand2(color: string) {
    setBrand2Local(color);
    update({ brand2Override: color });
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
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  padding: "14px 10px",
                  background: p.vars["--card"],
                  border: `2px solid ${active ? p.vars["--brand"] : p.vars["--border"]}`,
                  borderRadius: "var(--btn-r)",
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                  color: p.vars["--text"],
                  fontFamily: "var(--font)",
                }}
              >
                {/* Mini color swatches */}
                <div style={{ display: "flex", gap: 4 }}>
                  {[p.vars["--brand"], p.vars["--brand2"], p.vars["--bg"]].map((c, i) => (
                    <div key={i} style={{ width: 14, height: 14, borderRadius: "50%", background: c, border: "1px solid rgba(255,255,255,0.15)" }} />
                  ))}
                </div>
                <span style={{ fontSize: 18 }}>{p.emoji}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: p.vars["--text"] }}>{p.label}</span>
                {active && (
                  <span style={{ fontSize: 10, color: p.vars["--brand"], fontWeight: 700 }}>ACTIVE</span>
                )}
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
                <input
                  type="color"
                  value={brandLocal}
                  onChange={(e) => applyBrand(e.target.value)}
                  style={{ width: 44, height: 36, padding: 2, cursor: "pointer" }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>{brandLocal}</span>
              </div>
            </div>
            <div className="col" style={{ gap: 6, flex: 1, minWidth: 140 }}>
              <label className="small">Accent color</label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="color"
                  value={brand2Local}
                  onChange={(e) => applyBrand2(e.target.value)}
                  style={{ width: 44, height: 36, padding: 2, cursor: "pointer" }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>{brand2Local}</span>
              </div>
            </div>
          </div>

          {/* Live preview */}
          <div className="col" style={{ gap: 8 }}>
            <label className="small">Preview</label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                className="btnPrimary"
                style={{ background: `linear-gradient(90deg, ${brandLocal}, ${brand2Local})`, pointerEvents: "none", fontSize: 13 }}
              >
                Primary Button
              </button>
              <button style={{ borderColor: brandLocal, color: brandLocal, fontSize: 13, pointerEvents: "none" }}>
                Outline Button
              </button>
              <span style={{
                fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
                background: `${brandLocal}22`, color: brandLocal,
              }}>
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
            <button
              key={opt.value}
              onClick={() => update({ btnRadius: opt.value })}
              style={{
                borderRadius: opt.value,
                border: `2px solid ${settings.btnRadius === opt.value ? "var(--brand)" : "var(--border)"}`,
                color: settings.btnRadius === opt.value ? "var(--brand)" : "var(--muted)",
                fontWeight: settings.btnRadius === opt.value ? 700 : 600,
                padding: "8px 18px",
                fontSize: 13,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Font ── */}
      <div className="card">
        <div className="sectionTitle">Font Family</div>
        <div className="col" style={{ gap: 10 }}>
          {FONT_OPTIONS.map((opt) => {
            const active = settings.fontValue === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => update({ fontValue: opt.value })}
                style={{
                  fontFamily: opt.value,
                  textAlign: "left",
                  border: `2px solid ${active ? "var(--brand)" : "var(--border)"}`,
                  color: active ? "var(--brand)" : "var(--text)",
                  fontWeight: active ? 700 : 500,
                  padding: "10px 14px",
                  fontSize: 14,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>{opt.label}</span>
                <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font)" }}>
                  The quick brown fox
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Reset ── */}
      <div className="card" style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={handleReset}
          style={{ color: "var(--danger)", borderColor: "var(--danger)", fontSize: 13 }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
