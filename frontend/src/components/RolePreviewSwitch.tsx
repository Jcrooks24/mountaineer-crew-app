import { useEffect, useRef, useState } from "react";
import { useAuth, type PreviewRole } from "../auth/AuthContext";

// Staging-only dev tool (see AuthContext): a fixed pill that lets a real admin
// view the app as a lower role to test role-gated UI. Self-hides unless
// canPreview (VITE_STAGING + real admin), so it never appears on production.
//
// It's DRAGGABLE (by the grip) and remembers where you put it, so it can be
// moved off whatever feature it's covering while navigating staging.
const ROLES: { value: PreviewRole | null; label: string }[] = [
  { value: null, label: "Admin" },
  { value: "crew_lead", label: "Crew Lead" },
  { value: "skill_rater", label: "Skill Rater" },
  { value: "crew", label: "Crew" },
];

const POS_KEY = "mm_staging_switch_pos_v1";

function loadPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.x === "number" && typeof p?.y === "number") return p;
  } catch { /* noop */ }
  return null;
}

export default function RolePreviewSwitch() {
  const { canPreview, previewRole, setPreviewRole } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => loadPos());

  useEffect(() => {
    if (pos) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* noop */ }
    }
  }, [pos]);

  if (!canPreview) return null;

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  function onGripDown(e: React.PointerEvent) {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const start = { px: e.clientX, py: e.clientY, ox: rect.left, oy: rect.top };
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const move = (ev: PointerEvent) => {
      setPos({
        x: clamp(start.ox + ev.clientX - start.px, 4, window.innerWidth - w - 4),
        y: clamp(start.oy + ev.clientY - start.py, 4, window.innerHeight - h - 4),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const placement: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { bottom: 8, left: "50%", transform: "translateX(-50%)" };

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
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
        ...placement,
      }}
    >
      {/* Drag grip - only this moves the pill, so the role buttons stay tappable. */}
      <span
        onPointerDown={onGripDown}
        title="Drag to move"
        aria-label="Drag to move the staging switch"
        style={{ cursor: "grab", touchAction: "none", color: "#f59e0b", fontWeight: 900, padding: "0 2px", userSelect: "none", fontSize: 13, lineHeight: 1 }}
      >
        ⠿
      </span>
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
