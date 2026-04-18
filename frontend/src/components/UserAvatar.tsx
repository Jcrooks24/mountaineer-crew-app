import { useEffect, useState } from "react";
import {
  currentDirectory,
  ensureDirectory,
  photoForDisplay,
  subscribeDirectory,
} from "../lib/userDirectory";

type Props = {
  /** displayName = what we persist in created_by (user.name or user.email) */
  displayName: string | null | undefined;
  size?: number;
};

export default function UserAvatar({ displayName, size = 20 }: Props) {
  const [, force] = useState(0);

  useEffect(() => {
    ensureDirectory().catch(() => { /* offline — skip */ });
    return subscribeDirectory(() => force((n) => n + 1));
    // re-run if the target name changes — listener fires on any directory update
  }, [displayName]);

  // Touch currentDirectory so the memo recomputes after a refresh
  currentDirectory();

  const photo = photoForDisplay(displayName);
  const initial = (displayName || "?").trim().charAt(0).toUpperCase() || "?";

  if (photo) {
    return (
      <img
        src={photo}
        alt={displayName || "user"}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          border: "1px solid var(--border)",
        }}
      />
    );
  }

  return (
    <span
      aria-label={displayName || "user"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg, var(--brand), var(--brand2))",
        color: "var(--on-brand)",
        fontSize: Math.max(10, Math.round(size * 0.5)),
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initial}
    </span>
  );
}
