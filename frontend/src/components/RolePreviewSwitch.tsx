import { useAuth, type PreviewRole } from "../auth/AuthContext";

// Staging-only dev tool (see AuthContext): a fixed pill that lets a real admin
// view the app as a lower role to test role-gated UI. Self-hides unless
// canPreview (VITE_STAGING + real admin), so it never appears on production.
const ROLES: { value: PreviewRole | null; label: string }[] = [
  { value: null, label: "Admin" },
  { value: "crew_lead", label: "Crew Lead" },
  { value: "skill_rater", label: "Skill Rater" },
  { value: "crew", label: "Crew" },
];

export default function RolePreviewSwitch() {
  const { canPreview, previewRole, setPreviewRole } = useAuth();
  if (!canPreview) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        background: "rgba(20,20,20,0.92)",
        border: "1px solid #f59e0b",
        boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
        fontSize: 11,
        maxWidth: "calc(100vw - 16px)",
        flexWrap: "wrap",
        justifyContent: "center",
      }}
    >
      <span style={{ color: "#f59e0b", fontWeight: 800, letterSpacing: "0.04em" }}>
        STAGING · VIEW AS
      </span>
      {ROLES.map((r) => {
        const active = (previewRole ?? null) === r.value;
        return (
          <button
            key={r.label}
            type="button"
            onClick={() => setPreviewRole(r.value)}
            style={{
              padding: "3px 9px",
              borderRadius: 999,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              border: active ? "1px solid #f59e0b" : "1px solid #555",
              background: active ? "#f59e0b" : "transparent",
              color: active ? "#111" : "#ddd",
            }}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
