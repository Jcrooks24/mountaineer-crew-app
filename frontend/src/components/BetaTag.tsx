import { isBeta } from "../lib/betaFeatures";

type Props = {
  feature: string;
  style?: React.CSSProperties;
};

/** Chip-style tag so "beta" reads even on a brand-bordered card (where a
 * plain brand-colored text label previously blended into the border and
 * vanished). Uses a low-alpha brand fill + brand border. */
export function BetaTag({ feature, style }: Props) {
  if (!isBeta(feature)) return null;
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10,
        fontWeight: 800,
        color: "var(--brand)",
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        padding: "1px 6px",
        borderRadius: 4,
        background: "color-mix(in srgb, var(--brand) 14%, transparent)",
        border: "1px solid var(--brand)",
        lineHeight: "14px",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      beta
    </span>
  );
}

export default BetaTag;
