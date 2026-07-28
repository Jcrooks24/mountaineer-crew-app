/**
 * Truck-deck fill gauge.
 *
 * Replaces two anonymous 0-100 sliders. Crew were being asked for "vertical
 * fill" and "horizontal fill" as bare numbers and then, separately, to have a
 * feel for cubic feet. This draws the thing they are looking at - a box deck
 * seen from the side, cab on the left - and fills it from the floor up and the
 * headboard back, so the two percentages read as a shape rather than as
 * arithmetic. The 25% gridlines match the interior marks the fleet trucks are
 * actually striped with.
 *
 * Both numbers are shown at once, and so is the volume: percentage is what crew
 * can see, cubic feet is what the office needs, and putting them side by side is
 * how a crew member learns to estimate the second by eye. Volume is derived from
 * TRUCK_SPECS at display time, never stored - see the note in lib/jobTypes.ts.
 *
 * Tapping the deck sets both axes at once (snapped to 5%), which is how this
 * gets used at the back of a truck. The sliders stay for fine adjustment and
 * for anyone who can't hit a tap target with gloves on.
 */

import { useRef } from "react";

const SNAP = 5;

function snap(pct: number): number {
  return Math.max(0, Math.min(100, Math.round(pct / SNAP) * SNAP));
}

export default function TruckDeckGauge({
  verticalPct,
  horizontalPct,
  capacityCuFt,
  filledCuFt,
  isRental,
  onChange,
}: {
  verticalPct: number;
  horizontalPct: number;
  /** null when the truck's interior volume isn't known (rental, no length). */
  capacityCuFt: number | null;
  filledCuFt: number | null;
  isRental?: boolean;
  onChange: (next: { vertical_pct?: number; horizontal_pct?: number }) => void;
}) {
  const deckRef = useRef<HTMLDivElement | null>(null);

  const combined = Math.round((verticalPct * horizontalPct) / 100);
  const empty = verticalPct === 0 || horizontalPct === 0;

  function setFromPoint(clientX: number, clientY: number) {
    const el = deckRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    // Left edge is the headboard, so depth grows rightward. Floor is the
    // bottom, so height grows upward - hence the inverted Y.
    onChange({
      horizontal_pct: snap(((clientX - r.left) / r.width) * 100),
      vertical_pct: snap(((r.bottom - clientY) / r.height) * 100),
    });
  }

  return (
    <div style={{ marginTop: 10 }}>
      {/* ── The deck ───────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
        {/* Cab, drawn just so the deck reads as a truck and the left edge
            reads as the headboard rather than as an arbitrary origin. */}
        <div
          aria-hidden
          style={{
            width: 26, flexShrink: 0, alignSelf: "flex-end", height: "62%",
            border: "2px solid var(--border)", borderRight: "none",
            borderRadius: "6px 0 0 4px", background: "var(--surface, transparent)",
          }}
        />
        <div
          ref={deckRef}
          role="button"
          tabIndex={0}
          aria-label="Truck deck fill. Tap to set depth and height together."
          onClick={(e) => setFromPoint(e.clientX, e.clientY)}
          onKeyDown={(e) => {
            // Keyboard nudge, so the gauge isn't mouse-only.
            if (e.key === "ArrowRight") onChange({ horizontal_pct: snap(horizontalPct + SNAP) });
            else if (e.key === "ArrowLeft") onChange({ horizontal_pct: snap(horizontalPct - SNAP) });
            else if (e.key === "ArrowUp") onChange({ vertical_pct: snap(verticalPct + SNAP) });
            else if (e.key === "ArrowDown") onChange({ vertical_pct: snap(verticalPct - SNAP) });
            else return;
            e.preventDefault();
          }}
          style={{
            position: "relative", flex: 1, height: 132, cursor: "pointer",
            border: "2px solid var(--border)", borderRadius: "0 6px 6px 0",
            overflow: "hidden", touchAction: "manipulation",
          }}
        >
          {/* Load, anchored to the floor at the headboard end. */}
          <div
            style={{
              position: "absolute", left: 0, bottom: 0,
              width: `${horizontalPct}%`, height: `${verticalPct}%`,
              background: "var(--brand)", opacity: 0.85,
              transition: "width 120ms ease, height 120ms ease",
            }}
          />
          {/* Interior 25% marks, the same ones striped inside the fleet boxes. */}
          {[25, 50, 75].map((p) => (
            <div key={`v${p}`} aria-hidden style={{
              position: "absolute", left: `${p}%`, top: 0, bottom: 0,
              width: 1, background: "var(--border)", opacity: 0.7,
            }} />
          ))}
          {[25, 50, 75].map((p) => (
            <div key={`h${p}`} aria-hidden style={{
              position: "absolute", bottom: `${p}%`, left: 0, right: 0,
              height: 1, background: "var(--border)", opacity: 0.7,
            }} />
          ))}
          {empty && (
            <div style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              fontSize: 12, color: "var(--muted)", pointerEvents: "none",
            }}>
              Tap where the load reaches
            </div>
          )}
        </div>
      </div>

      {/* ── Both numbers, at the same time ─────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        gap: 8, marginTop: 8, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span className="mono" style={{ fontWeight: 700, fontSize: 20, color: "var(--brand)" }}>
            {combined}%
          </span>
          <span className="small" style={{ color: "var(--muted)" }}>
            full ({horizontalPct}% deep × {verticalPct}% high)
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          {filledCuFt !== null ? (
            <>
              <span className="mono" style={{ fontWeight: 700, fontSize: 20 }}>
                {filledCuFt.toLocaleString()}
              </span>
              <span className="small" style={{ color: "var(--muted)" }}> cu ft loaded</span>
              {capacityCuFt !== null && (
                <div className="small" style={{ color: "var(--muted)" }}>
                  of about {capacityCuFt.toLocaleString()} cu ft
                </div>
              )}
            </>
          ) : (
            <span className="small" style={{ color: "var(--muted)" }}>
              {isRental ? "Enter the truck length for cubic feet" : "Cubic feet unavailable"}
            </span>
          )}
        </div>
      </div>

      {/* ── Fine adjustment ────────────────────────────────────────────── */}
      <DeckSlider
        label="How deep (headboard to door)"
        value={horizontalPct}
        onChange={(p) => onChange({ horizontal_pct: p })}
        lowLabel="Empty"
        highLabel="To the door"
      />
      <DeckSlider
        label="How high (floor to ceiling)"
        value={verticalPct}
        onChange={(p) => onChange({ vertical_pct: p })}
        lowLabel="Floor"
        highLabel="To the ceiling"
      />
    </div>
  );
}

function DeckSlider({
  label,
  value,
  onChange,
  lowLabel,
  highLabel,
}: {
  label: string;
  value: number;
  onChange: (pct: number) => void;
  lowLabel: string;
  highLabel: string;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span className="small" style={{ color: "var(--muted)" }}>{label}</span>
        <span className="small mono" style={{ fontWeight: 700 }}>{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={SNAP}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--brand)" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>{lowLabel}</span>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>{highLabel}</span>
      </div>
    </div>
  );
}
