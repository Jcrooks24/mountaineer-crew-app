import { isBeta } from "../lib/betaFeatures";

type Props = {
  feature: string;
  style?: React.CSSProperties;
};

export function BetaTag({ feature, style }: Props) {
  if (!isBeta(feature)) return null;
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "var(--brand)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        marginTop: 2,
        ...style,
      }}
    >
      beta
    </div>
  );
}

export default BetaTag;
