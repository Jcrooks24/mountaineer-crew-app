import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useAuth, type User } from "../auth/AuthContext";
import { refreshDirectory } from "../lib/userDirectory";
import { markPatchNotesSeenNow } from "../lib/patchNotesSeen";
import {
  APP_BUILD_ID,
  APP_VERSION_NAME,
  checkForAppUpdate,
  type UpdateResult,
} from "../lib/appUpdate";
import { fetchState, isHorizonLow, loadCache } from "../lib/availabilityStore";
import { BetaTag } from "../components/BetaTag";

const LEGACY_PHOTO_KEY = "crew_profile_photo_v1";

type PatchNote = {
  id: number;
  title: string;
  body: string;
  created_by_name: string | null;
  updated_at: string;
};

async function resizeToDataUrl(file: File, maxPx = 256, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
    img.src = url;
  });
}

export default function Profile() {
  const { user, logout, setUser } = useAuth();
  const nav = useNavigate();

  // "main" = landing (app update, tools, patch notes); "profile" = the
  // My Profile sub-page (photo + account config).
  const [view, setView] = useState<"main" | "profile">("main");

  const [photo, setPhoto] = useState<string | null>(user?.profile_photo ?? null);
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Availability horizon — cache on mount, then refresh from server so the
  // "you need to submit" badge is current. We only need to know whether the
  // horizon is below the 14-day threshold; the picker page itself owns the
  // full state.
  const [availabilityHorizonLow, setAvailabilityHorizonLow] = useState<boolean>(() => {
    const cache = loadCache();
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    return isHorizonLow(cache.horizon, `${y}-${m}-${d}`);
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchState();
      if (!s || cancelled) return;
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, "0");
      const d = String(today.getDate()).padStart(2, "0");
      setAvailabilityHorizonLow(isHorizonLow(s.horizon, `${y}-${m}-${d}`));
    })();
    return () => { cancelled = true; };
  }, []);

  function handleSignOut() {
    logout();
    nav("/login", { replace: true });
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setPhotoBusy(true);
    try {
      const dataUrl = await resizeToDataUrl(file);
      const updated = await apiFetch<User>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ profile_photo: dataUrl }),
      });
      setPhoto(updated.profile_photo ?? null);
      setUser(updated);
      refreshDirectory().catch(() => {});
      // Clean up legacy local-only copy now that the photo is saved on the server
      localStorage.removeItem(LEGACY_PHOTO_KEY);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to upload photo");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleRemovePhoto() {
    setErr(null);
    setPhotoBusy(true);
    try {
      const updated = await apiFetch<User>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ profile_photo: "" }),
      });
      setPhoto(null);
      setUser(updated);
      refreshDirectory().catch(() => {});
      if (fileRef.current) fileRef.current.value = "";
      localStorage.removeItem(LEGACY_PHOTO_KEY);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to remove photo");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    setSaved(false);
    try {
      const updated = await apiFetch<User>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setUser(updated);
      setSaved(true);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const initials = user?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? "?";

  const backBtnStyle: React.CSSProperties = {
    background: "none", border: "none", color: "var(--muted)",
    cursor: "pointer", fontSize: 13, padding: "4px 8px",
  };

  // ── My Profile sub-page — photo + account config ──────────────────────────
  if (view === "profile") {
    return (
      <div className="container" style={{ maxWidth: 480 }}>
        <div className="topbar" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 900, fontSize: 15 }}>My Profile</div>
          <button onClick={() => setView("main")} style={backBtnStyle}>
            &larr; Profile
          </button>
        </div>

        {/* Avatar */}
        <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 88, height: 88, borderRadius: "50%",
              background: "linear-gradient(135deg, var(--brand), var(--brand2))",
              overflow: "hidden",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 32, fontWeight: 900, color: "var(--on-brand)",
            }}
          >
            {photo
              ? <img src={photo} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : initials}
          </div>

          <div className="small" style={{ color: "var(--muted)", textAlign: "center", maxWidth: 260 }}>
            Your profile photo is visible to other crew members across the app.
          </div>

          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoChange} />

          <div className="row" style={{ gap: 8 }}>
            <button onClick={() => fileRef.current?.click()} disabled={photoBusy} style={{ fontSize: 13 }}>
              {photoBusy ? "Uploading…" : photo ? "Change photo" : "Upload photo"}
            </button>
            {photo && (
              <button
                onClick={handleRemovePhoto}
                disabled={photoBusy}
                style={{ fontSize: 13, background: "none", color: "var(--danger)", border: "1px solid var(--danger)" }}
              >
                Remove
              </button>
            )}
          </div>
          {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}
        </div>

        {/* Account — read-only identity plus editable display name */}
        <div className="card">
          <div className="sectionTitle">Account</div>
          <div className="col" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 150 }}>
                <div className="label">Email</div>
                <div style={{ marginTop: 4 }}>{user?.email}</div>
              </div>
              <div style={{ flex: 1, minWidth: 100 }}>
                <div className="label">Role</div>
                <div style={{ marginTop: 4, textTransform: "capitalize" }}>{user?.role ?? "user"}</div>
              </div>
            </div>
            <form
              onSubmit={handleSaveName}
              className="col"
              style={{ gap: 8, borderTop: "1px solid var(--border)", paddingTop: 12 }}
            >
              <label className="label">Display name</label>
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); setSaved(false); }}
                placeholder="Your name"
              />
              {saved && <div className="small" style={{ color: "var(--ok)" }}>Saved</div>}
              <button className="btnPrimary" disabled={saving} style={{ alignSelf: "flex-start", fontSize: 13 }}>
                {saving ? "Saving…" : "Save name"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ── Main Profile landing ──────────────────────────────────────────────────
  return (
    <div className="container" style={{ maxWidth: 480 }}>
      {/* Header */}
      <div className="topbar" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>Profile</div>
        <button onClick={() => nav(-1)} style={backBtnStyle}>
          &larr; Back
        </button>
      </div>

      {/* My Profile entry — tap to open photo + account config */}
      <div
        role="button"
        onClick={() => setView("profile")}
        className="card"
        style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
      >
        <div
          style={{
            width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
            background: "linear-gradient(135deg, var(--brand), var(--brand2))",
            overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, fontWeight: 900, color: "var(--on-brand)",
          }}
        >
          {photo
            ? <img src={photo} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : initials}
        </div>
        <div className="col" style={{ gap: 2, flex: 1 }}>
          <span style={{ fontWeight: 800, fontSize: 15 }}>{user?.name || "My Profile"}</span>
          <span className="small" style={{ color: "var(--muted)" }}>{user?.email}</span>
        </div>
        <span style={{ color: "var(--muted)", fontSize: 18, flexShrink: 0 }}>›</span>
      </div>

      {/* App update — subdued so it doesn't dominate, but always in the same spot */}
      <div className="card">
        <AppRefreshButton />
      </div>

      {/* Tools & resources — nav links grouped into one card with consistent
          flat rows, so the page reads as a short list. */}
      <div className="card">
        <div className="sectionTitle">Tools & Resources</div>
        <div className="col" style={{ gap: 8 }}>
          <ProfileNavRow
            label="Scheduling Availability"
            hint={
              availabilityHorizonLow
                ? "Update needed — submit availability for the next 2 weeks"
                : "Tap days to set available / unavailable / conditional"
            }
            betaFeature="schedulingAvailability"
            badgeTone={availabilityHorizonLow ? "warn" : null}
            onClick={() => nav("/availability")}
          />
          <ProfileNavRow
            label="Log Expense / Reimbursement"
            hint="Mileage, personal-card reimbursement, or company-card receipts"
            onClick={() => nav("/reimbursement")}
          />
          <ProfileNavRow
            label="Long Distance Compliance"
            onClick={() => nav("/long-distance")}
          />
          <ProfileNavRow
            label="Document Library"
            onClick={() => nav("/documents")}
          />
        </div>
      </div>

      {/* Patch Notes — latest notes collapsed to a preview */}
      <PatchNotesCard />

      {/* Sign out */}
      <div className="card">
        <button
          onClick={handleSignOut}
          style={{
            width: "100%", padding: 12,
            background: "rgba(255,107,107,0.08)",
            color: "var(--danger)",
            border: "1px solid var(--danger)",
            borderRadius: 12, cursor: "pointer", fontSize: 15, fontWeight: 700,
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

// Flat, list-style navigation row — lighter than a default button so a card
// full of links doesn't read as a wall of buttons.
function ProfileNavRow({
  label,
  hint,
  onClick,
  betaFeature,
  badgeTone,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  /** Feature key to gate a "beta" subtext via the shared BetaTag component. */
  betaFeature?: string;
  /** Renders a small filled dot to the right of the label when set; "warn"
   *  surfaces action-needed states (e.g. submit availability). */
  badgeTone?: "warn" | null;
}) {
  const warn = badgeTone === "warn";
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, width: "100%", textAlign: "left",
        padding: "11px 14px", fontSize: 14, fontWeight: 600,
        background: "rgba(255,255,255,0.04)",
        border: warn ? "1px solid #ffb02e" : "1px solid var(--border)",
      }}
    >
      <span className="col" style={{ gap: 2 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {label}
          {warn && (
            <span
              aria-label="Action needed"
              style={{
                width: 8, height: 8, borderRadius: "50%",
                background: "#ffb02e", flexShrink: 0,
              }}
            />
          )}
        </span>
        {betaFeature && <BetaTag feature={betaFeature} />}
        {hint && (
          <span
            className="small"
            style={{ color: warn ? "#ffb02e" : "var(--muted)" }}
          >
            {hint}
          </span>
        )}
      </span>
      <span style={{ color: "var(--muted)", fontSize: 16, flexShrink: 0 }}>›</span>
    </button>
  );
}

function AppRefreshButton() {
  const [status, setStatus] = useState<"idle" | "checking" | "result">("idle");
  const [result, setResult] = useState<UpdateResult | null>(null);

  async function handleCheck() {
    setStatus("checking");
    setResult(null);
    try {
      const r = await checkForAppUpdate();
      setResult(r);
      setStatus("result");
    } catch (e: any) {
      setResult({ kind: "error", message: e?.message || "Update check failed" });
      setStatus("result");
    }
  }

  const message = result
    ? result.kind === "latest"
      ? "You're on the latest version."
      : result.kind === "updating"
        ? "Update found — reloading…"
        : result.kind === "offline"
          ? "You're offline — can't check for updates."
          : result.kind === "unsupported"
            ? "Updates can't be checked on this browser."
            : result.message
    : null;

  const messageColor = result?.kind === "latest"
    ? "var(--ok)"
    : result?.kind === "updating"
      ? "var(--brand)"
      : result?.kind === "error" || result?.kind === "offline"
        ? "var(--danger)"
        : "var(--muted)";

  const checking = status === "checking";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        onClick={handleCheck}
        disabled={checking}
        style={{
          width: "100%",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          padding: "11px 14px",
          fontSize: 14, fontWeight: 700,
          background: "rgba(255,255,255,0.05)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          cursor: checking ? "default" : "pointer",
          opacity: checking ? 0.7 : 1,
        }}
      >
        <span style={{ fontSize: 15 }}>↻</span>
        {checking ? "Checking for updates…" : "Update app to latest version"}
      </button>
      {message ? (
        <div className="small" style={{ textAlign: "center", color: messageColor }}>
          {message}
        </div>
      ) : (
        <div style={{ textAlign: "center" }}>
          <div className="small" style={{ color: "var(--muted)" }}>
            Version <strong style={{ color: "var(--text)" }}>{APP_VERSION_NAME}</strong>
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", opacity: 0.65, marginTop: 1 }}>
            build {APP_BUILD_ID}
          </div>
        </div>
      )}
    </div>
  );
}

const PATCH_NOTES_INITIAL = 3;

// Split a note body into a short lead (first paragraph) and the remainder, so
// long changelogs collapse to a preview. A blank-line paragraph break is
// preferred; otherwise fall back to a character budget at a word boundary.
function splitNoteBody(body: string): { lead: string; rest: string } {
  const text = body.trimEnd();
  const para = text.match(/\n\s*\n/);
  if (para && para.index !== undefined && para.index > 0) {
    return { lead: text.slice(0, para.index).trimEnd(), rest: text.slice(para.index).trim() };
  }
  const LIMIT = 220;
  if (text.length <= LIMIT) return { lead: text, rest: "" };
  let cut = text.lastIndexOf(" ", LIMIT);
  if (cut < LIMIT * 0.6) cut = LIMIT;
  return { lead: text.slice(0, cut).trimEnd() + "…", rest: text.slice(cut).trim() };
}

function PatchNoteItem({ note }: { note: PatchNote }) {
  const [open, setOpen] = useState(false);
  const { lead, rest } = splitNoteBody(note.body);
  const hasMore = rest.length > 0;

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{note.title}</div>
      <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
        {new Date(note.updated_at).toLocaleDateString()}
        {note.created_by_name ? ` · ${note.created_by_name}` : ""}
      </div>
      <div style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>
        {open || !hasMore ? note.body.trimEnd() : lead}
      </div>
      {hasMore && (
        <button onClick={() => setOpen((v) => !v)} style={{ fontSize: 12, marginTop: 8 }}>
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

function PatchNotesCard() {
  const [notes, setNotes] = useState<PatchNote[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PatchNote[]>("/api/patch-notes")
      .then((rows) => {
        setNotes(rows);
        if (rows.length > 0) markPatchNotesSeenNow(rows[0].updated_at);
      })
      .catch((e: any) => setErr(e instanceof ApiError ? e.message : "Failed to load"));
  }, []);

  const visible = notes == null
    ? []
    : expanded
      ? notes
      : notes.slice(0, PATCH_NOTES_INITIAL);
  const hiddenCount = notes == null ? 0 : Math.max(0, notes.length - PATCH_NOTES_INITIAL);

  return (
    <div className="card">
      <div className="sectionTitle">Patch Notes</div>
      {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}
      {notes == null && !err && (
        <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
      )}
      {notes && notes.length === 0 && (
        <div className="small" style={{ color: "var(--muted)" }}>No updates yet.</div>
      )}
      <div className="col" style={{ gap: 12 }}>
        {visible.map((n) => (
          <PatchNoteItem key={n.id} note={n} />
        ))}
        {hiddenCount > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{ fontSize: 12, alignSelf: "flex-start" }}
          >
            {expanded ? "Show recent only" : `Show ${hiddenCount} older note${hiddenCount === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  );
}
