import { Fragment } from "react";
import { payloadCapacity, type VehicleUnit } from "../lib/vehicleUnits";

/**
 * Compact read-only display of a fleet unit's DOT weight / dimension specs.
 * Shown on the DVIR and BOL once a unit is selected, so the crew see the truck's
 * numbers where they need them. Renders nothing when the unit is unknown, and a
 * gentle "no data" nudge when the unit exists but has not been filled in.
 */
export default function VehicleUnitSpecs({ unit }: { unit: VehicleUnit | undefined | null }) {
  if (!unit) return null;

  const fmt = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString());
  const cap = payloadCapacity(unit);
  const hasDims = unit.length_ft != null || unit.width_ft != null || unit.height_ft != null;

  const rows: { label: string; value: string }[] = [];
  if (unit.dry_weight_lbs != null) rows.push({ label: "Dry weight", value: `${fmt(unit.dry_weight_lbs)} lb` });
  if (unit.gvwr_lbs != null) rows.push({ label: "GVWR", value: `${fmt(unit.gvwr_lbs)} lb` });
  if (cap != null) rows.push({ label: "Payload capacity", value: `${fmt(cap)} lb` });
  if (hasDims) rows.push({ label: "Dimensions (L×W×H)", value: `${fmt(unit.length_ft)} × ${fmt(unit.width_ft)} × ${fmt(unit.height_ft)} ft` });
  if (unit.axle_capacities_lbs.length) {
    rows.push({ label: "Axle capacities", value: unit.axle_capacities_lbs.map((a) => `${a.toLocaleString()} lb`).join(" / ") });
  }

  if (rows.length === 0) {
    return (
      <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>
        No weight data on file for {unit.name}. Add it in Admin, Settings, Vehicle Units.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--card2)" }}>
      <div className="microLabel" style={{ marginBottom: 6 }}>{unit.name} - unit specs</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 3, columnGap: 12 }}>
        {rows.map((r) => (
          <Fragment key={r.label}>
            <span className="small" style={{ color: "var(--muted)" }}>{r.label}</span>
            <span className="small mono" style={{ color: "var(--text)", textAlign: "right" }}>{r.value}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
