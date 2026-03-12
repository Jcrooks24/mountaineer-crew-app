import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

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

type Tab = "employees" | "map";

export default function Admin() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("employees");

  // Redirect non-admins
  useEffect(() => {
    if (user && user.role !== "admin") nav("/", { replace: true });
  }, [user, nav]);

  if (!user || user.role !== "admin") return null;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Admin</h1>
        <button onClick={() => nav(-1)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, opacity: 0.6 }}>
          &larr; Back
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button
          onClick={() => setTab("employees")}
          style={{ padding: "8px 16px", fontWeight: tab === "employees" ? "bold" : "normal", borderBottom: tab === "employees" ? "2px solid currentColor" : "none", background: "none", cursor: "pointer" }}
        >
          Employees
        </button>
        <button
          onClick={() => setTab("map")}
          style={{ padding: "8px 16px", fontWeight: tab === "map" ? "bold" : "normal", borderBottom: tab === "map" ? "2px solid currentColor" : "none", background: "none", cursor: "pointer" }}
        >
          Map (Today)
        </button>
      </div>

      {tab === "employees" && <EmployeesTab />}
      {tab === "map" && <MapTab />}
    </div>
  );
}

// ---------------------------
// Employees tab
// ---------------------------
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
    if (!confirm(`Make ${u.email} ${newRole}?`)) return;
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

  if (loading) return <div>Loading...</div>;
  if (err) return <div style={{ color: "crimson" }}>{err}</div>;

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: "8px 10px" }}>Name</th>
            <th style={{ padding: "8px 10px" }}>Email</th>
            <th style={{ padding: "8px 10px" }}>Role</th>
            <th style={{ padding: "8px 10px" }}>Status</th>
            <th style={{ padding: "8px 10px" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={{ borderBottom: "1px solid #eee", opacity: u.is_active ? 1 : 0.5 }}>
              <td style={{ padding: "8px 10px" }}>{u.name || <span style={{ opacity: 0.4 }}>—</span>}</td>
              <td style={{ padding: "8px 10px" }}>{u.email}</td>
              <td style={{ padding: "8px 10px", textTransform: "capitalize" }}>{u.role}</td>
              <td style={{ padding: "8px 10px" }}>
                <span style={{ color: u.is_active ? "green" : "crimson", fontWeight: 600 }}>
                  {u.is_active ? "Active" : "Disabled"}
                </span>
              </td>
              <td style={{ padding: "8px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  disabled={busy === u.id}
                  onClick={() => toggleAccess(u)}
                  style={{ fontSize: 12, padding: "4px 10px", background: u.is_active ? "crimson" : "green", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
                >
                  {u.is_active ? "Revoke access" : "Restore access"}
                </button>
                <button
                  disabled={busy === u.id}
                  onClick={() => toggleRole(u)}
                  style={{ fontSize: 12, padding: "4px 10px", background: "none", border: "1px solid #aaa", borderRadius: 4, cursor: "pointer" }}
                >
                  Make {u.role === "admin" ? "user" : "admin"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------
// Map tab (Leaflet via CDN)
// ---------------------------
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
          `<b>${e.type}</b><br/>${time}<br/>${e.note ?? ""}`
        );
      });

      const group = L.featureGroup(markers).addTo(map);
      map.fitBounds(group.getBounds().pad(0.2));
    }

    const L = (window as any).L;
    if (L) {
      initMap(L);
      return;
    }

    // Load Leaflet CSS
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    // Load Leaflet JS
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => initMap((window as any).L);
    document.head.appendChild(script);

    return () => {
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, [events, loading, err]);

  if (loading) return <div>Loading events...</div>;
  if (err) return <div style={{ color: "crimson" }}>{err}</div>;
  if (events.length === 0) return <div style={{ opacity: 0.6 }}>No geotagged events today.</div>;

  return (
    <div>
      <div style={{ marginBottom: 8, fontSize: 13, opacity: 0.6 }}>
        {events.length} geotagged event{events.length !== 1 ? "s" : ""} today
      </div>
      <div ref={mapRef} style={{ width: "100%", height: 480, borderRadius: 8, overflow: "hidden" }} />
    </div>
  );
}
