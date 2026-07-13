import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api/client";
import AddressAutocomplete from "./AddressAutocomplete";
import { BetaTag } from "./BetaTag";
import {
  loadWrapUp,
  saveWrapUp,
  taskMinutes,
  totalMinutes,
  wrapUpAt,
  type WrapUpState,
} from "../lib/wrapUpStore";

// Kept in sync with the backend default (routing.py DISPATCH_ADDRESS). Only used
// as the placeholder + navigate fallback; the backend is authoritative for the
// drive-time calc.
const DEFAULT_DEST = "172 Timberline Dr, Bozeman, MT";

// Traffic and loose ends make the raw driving estimate optimistic in practice.
const BUFFER = 1.2;

type ReturnTripResp = {
  ok: boolean;
  reason?: string;
  duration_sec?: number;
  duration_traffic_sec?: number;
  distance_m?: number;
  destination_address?: string;
};

function fmtDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} hr ${rem} min` : `${h} hr`;
}

function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

type Props = {
  jobUuid: string;
  /** Lifts the projected wrap-up time so the hours editor can offer it as an
   *  End time. Null whenever no estimate exists yet. */
  onWrapUpChange?: (at: Date | null) => void;
};

/**
 * Estimated job wrap-up: drive time from the crew's current GPS back to
 * dispatch (plus a 20% buffer), plus billable work still to do once they're
 * there. Projects the clock time the job actually finishes, which an employee
 * can then pick as their End time in the hours editor below.
 *
 * One button. It fetches the drive time AND stamps the anchor the estimate
 * counts from - so the wrap-up time always gets created, even when the drive
 * lookup can't answer (offline, GPS denied, no maps key). In that case the
 * drive-minutes field is just filled in by hand.
 */
export default function WrapUpEstimator({ jobUuid, onWrapUpChange }: Props) {
  const [state, setState] = useState<WrapUpState>(() => loadWrapUp(jobUuid));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Re-hydrate when the job changes (the report is remounted per job, but this
  // keeps the component honest if it's ever reused in place).
  useEffect(() => {
    setState(loadWrapUp(jobUuid));
    setErr(null);
  }, [jobUuid]);

  const update = useCallback(
    (patch: Partial<WrapUpState>) => {
      setState((prev) => {
        const next = { ...prev, ...patch };
        saveWrapUp(jobUuid, next);
        return next;
      });
    },
    [jobUuid],
  );

  const at = useMemo(() => wrapUpAt(state), [state]);

  // Keep the parent's End-time option in sync. Compare by epoch: a fresh Date
  // object every render would otherwise re-fire this on every keystroke.
  const lastSentRef = useRef<number | null>(null);
  useEffect(() => {
    const t = at ? at.getTime() : null;
    if (t !== lastSentRef.current) {
      lastSentRef.current = t;
      onWrapUpChange?.(at);
    }
  }, [at, onWrapUpChange]);

  const effectiveDest = state.dest.trim() || DEFAULT_DEST;

  async function calculate() {
    setBusy(true);
    setErr(null);
    // Anchor first, unconditionally: the estimate must exist even if the drive
    // lookup below fails. Crew can hand-enter drive minutes from there.
    const anchorIso = new Date().toISOString();
    try {
      const pos = await getPosition();
      const { latitude: lat, longitude: lng } = pos.coords;
      setCoords({ lat, lng });

      const qs = new URLSearchParams({ lat: String(lat), lng: String(lng) });
      if (state.dest.trim()) qs.set("destination", state.dest.trim());
      const r = await apiFetch<ReturnTripResp>(`/api/routing/return-trip?${qs.toString()}`);

      const baseSec = r.duration_traffic_sec ?? r.duration_sec ?? null;
      if (!r.ok || baseSec == null) {
        update({ anchorIso });
        setErr(
          r.reason === "no_api_key"
            ? "Drive-time lookup isn't set up yet - enter the drive time by hand."
            : r.reason === "no_route"
              ? "No driving route found to that destination - enter the drive time by hand."
              : "Couldn't get a drive time right now - enter it by hand.",
        );
        return;
      }

      update({
        anchorIso,
        driveMin: String(Math.round((baseSec * BUFFER) / 60)),
        baseSec,
        trafficUsed: r.duration_traffic_sec != null,
        distanceM: r.distance_m ?? null,
        destResolved: r.destination_address ?? null,
      });
    } catch (e: any) {
      // Geolocation denied / unavailable / offline. Still stamp the anchor.
      update({ anchorIso });
      setErr(
        `${e?.message || "Couldn't get your location."} Enter the drive time by hand.`,
      );
    } finally {
      setBusy(false);
    }
  }

  function navigate() {
    const origin = coords ? `${coords.lat},${coords.lng}` : "";
    const url =
      `https://www.google.com/maps/dir/?api=1` +
      (origin ? `&origin=${encodeURIComponent(origin)}` : "") +
      `&destination=${encodeURIComponent(effectiveDest)}&travelmode=driving`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

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

  const minuteField = (
    label: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <label className="col" style={{ gap: 4, flex: "1 1 90px" }}>
      <span className="small" style={{ color: "var(--muted)" }}>{label}</span>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        style={fieldStyle}
      />
    </label>
  );

  return (
    <div
      style={{
        marginBottom: 14,
        paddingBottom: 14,
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div className="row" style={{ alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Estimated job wrap-up</span>
        <BetaTag feature="returnTrip" style={{ marginTop: 0 }} />
      </div>
      <div className="small" style={{ color: "var(--muted)", marginTop: 2, marginBottom: 10 }}>
        Drive time from where you are now back to{" "}
        <strong>{state.destResolved || effectiveDest}</strong> (plus a 20% buffer), plus any
        billable work left to do once you're there. The projected time can be picked as an
        employee's <strong>End</strong> time below.
      </div>

      <div className="col" style={{ gap: 4, marginBottom: 10 }}>
        <span className="small" style={{ color: "var(--muted)" }}>
          Driving back to (leave blank for dispatch)
        </span>
        <AddressAutocomplete
          value={state.dest}
          onChange={(v) => update({ dest: v })}
          placeholder={DEFAULT_DEST}
          style={fieldStyle}
        />
      </div>

      <button
        type="button"
        onClick={calculate}
        disabled={busy}
        className="btnPrimary"
        style={{ padding: "10px 14px" }}
      >
        {busy
          ? "Calculating…"
          : state.anchorIso
            ? "Recalculate wrap-up time"
            : "Calculate wrap-up time"}
      </button>

      {err && <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}

      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {minuteField("Drive back (min)", state.driveMin, (v) => update({ driveMin: v }))}
        {minuteField("Trash mgmt (min)", state.trashMin, (v) => update({ trashMin: v }))}
        {minuteField("Unstock truck (min)", state.unstockMin, (v) => update({ unstockMin: v }))}
        {minuteField("Other (min)", state.miscMin, (v) => update({ miscMin: v }))}
      </div>
      {state.baseSec != null && (
        <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>
          Drive time is the buffered estimate (base {fmtDuration(state.baseSec / 60)}
          {state.trafficUsed ? ", live traffic" : ""}
          {state.distanceM != null ? ` · ${(state.distanceM / 1609.34).toFixed(1)} mi` : ""}).
          Edit any field to adjust the projection.
        </div>
      )}

      {at && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "rgba(93,214,194,0.10)",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--brand)" }}>
            Est. wrap-up: {fmtClock(at)}
          </div>
          <div className="small" style={{ color: "var(--muted)" }}>
            {fmtClock(new Date(state.anchorIso!))} + {Math.round(totalMinutes(state))} min
            {" "}(drive {Math.round(parseFloat(state.driveMin) || 0)} + tasks{" "}
            {Math.round(taskMinutes(state))})
          </div>
        </div>
      )}

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
