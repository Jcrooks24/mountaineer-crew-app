import { useState } from "react";
import { apiFetch } from "../api/client";
import { BetaTag } from "./BetaTag";

// Kept in sync with the backend default (routing.py DISPATCH_ADDRESS). Only used
// as the placeholder + navigate fallback; the backend is authoritative for the
// drive-time calc.
const DEFAULT_DEST = "172 Timberline Dr, Bozeman, MT";

type ReturnTripResp = {
  ok: boolean;
  reason?: string;
  detail?: string;
  duration_sec?: number;
  duration_traffic_sec?: number;
  distance_m?: number;
  destination_address?: string;
  origin_address?: string;
};

function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} hr ${rem} min` : `${h} hr`;
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location isn't available on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 0,
    });
  });
}

// Return-trip tool (item 9): drive time from the crew's current GPS back to
// dispatch (172 Timberline Dr) plus a 20% buffer, with an option to navigate to
// a different destination. Degrades to a plain Maps deep link when the backend
// has no MAPS_API_KEY configured yet.
export default function ReturnTripTool() {
  const [dest, setDest] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnTripResp | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const effectiveDest = dest.trim() || DEFAULT_DEST;

  async function calculate() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const pos = await getPosition();
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setCoords({ lat, lng });
      const qs = new URLSearchParams({ lat: String(lat), lng: String(lng) });
      if (dest.trim()) qs.set("destination", dest.trim());
      const r = await apiFetch<ReturnTripResp>(`/api/routing/return-trip?${qs.toString()}`);
      setResult(r);
      if (!r.ok && r.reason !== "no_api_key") {
        setErr(
          r.reason === "no_route"
            ? "No driving route found to that destination."
            : "Could not get a drive-time estimate right now.",
        );
      }
    } catch (e: any) {
      setErr(e?.message || "Could not get your location.");
    } finally {
      setBusy(false);
    }
  }

  function navigate() {
    // Deep link into Google Maps turn-by-turn from current location (if known).
    const origin = coords ? `${coords.lat},${coords.lng}` : "";
    const url =
      `https://www.google.com/maps/dir/?api=1` +
      (origin ? `&origin=${encodeURIComponent(origin)}` : "") +
      `&destination=${encodeURIComponent(effectiveDest)}&travelmode=driving`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // Prefer the traffic-aware duration when the API returns it.
  const baseSec = result?.duration_traffic_sec ?? result?.duration_sec ?? null;
  const bufferedSec = baseSec != null ? Math.round(baseSec * 1.2) : null;

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: 14,
    boxSizing: "border-box",
  };

  return (
    <div className="card">
      <div className="row" style={{ alignItems: "center", gap: 8 }}>
        <div className="sectionTitle" style={{ marginBottom: 0 }}>Return trip to dispatch</div>
        <BetaTag feature="returnTrip" style={{ marginTop: 0 }} />
      </div>
      <div className="small" style={{ color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
        Drive time from your current location back to{" "}
        <strong>{result?.destination_address || effectiveDest}</strong>, plus a 20% buffer.
      </div>

      <button
        type="button"
        onClick={calculate}
        disabled={busy}
        className="btnPrimary"
        style={{ padding: "10px 14px" }}
      >
        {busy ? "Calculating…" : "Calculate return trip"}
      </button>

      {bufferedSec != null && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--brand)" }}>{fmtDuration(bufferedSec)}</div>
          <div className="small" style={{ color: "var(--muted)" }}>
            with 20% buffer (base {fmtDuration(baseSec!)}
            {result?.duration_traffic_sec != null ? ", live traffic" : ""}
            {result?.distance_m != null ? ` · ${(result.distance_m / 1609.34).toFixed(1)} mi` : ""})
          </div>
        </div>
      )}

      {result && !result.ok && result.reason === "no_api_key" && (
        <div className="small" style={{ color: "var(--muted)", marginTop: 10 }}>
          Drive-time estimate isn't set up yet (maps key not configured). You can still navigate below.
        </div>
      )}

      {err && <div className="small" style={{ color: "var(--danger)", marginTop: 10 }}>{err}</div>}

      <div className="col" style={{ gap: 4, marginTop: 12 }}>
        <span className="small" style={{ color: "var(--muted)" }}>Navigate somewhere else? (optional)</span>
        <input
          value={dest}
          onChange={(e) => setDest(e.target.value)}
          placeholder={DEFAULT_DEST}
          style={fieldStyle}
        />
      </div>

      <button
        type="button"
        onClick={navigate}
        style={{
          marginTop: 10,
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "transparent",
          color: "var(--text)",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Navigate in Google Maps →
      </button>
    </div>
  );
}
