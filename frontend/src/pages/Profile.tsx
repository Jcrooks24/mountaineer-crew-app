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

  const [photo, setPhoto] = useState<string | null>(user?.profile_photo ?? null);
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="container" style={{ maxWidth: 480 }}>
      {/* Header */}
      <div className="topbar" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>Profile</div>
        <button
          onClick={() => nav(-1)}
          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13, padding: "4px 8px" }}
        >
          &larr; Back
        </button>
      </div>

      {/* App refresh — kept near the top so crew can always find it to
          pull the latest build and confirm they're current. */}
      <div style={{ marginBottom: 12 }}>
        <AppRefreshButton />
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

      {/* Account info */}
      <div className="card">
        <div className="sectionTitle">Account</div>
        <div className="col" style={{ gap: 12 }}>
          <div>
            <div className="label">Email</div>
            <div style={{ marginTop: 4 }}>{user?.email}</div>
          </div>
          <div>
            <div className="label">Role</div>
            <div style={{ marginTop: 4, textTransform: "capitalize" }}>{user?.role ?? "user"}</div>
          </div>
        </div>
      </div>

      {/* Edit name */}
      <div className="card">
        <div className="sectionTitle">Display name</div>
        <form onSubmit={handleSaveName} className="col" style={{ gap: 12 }}>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false); }}
            placeholder="Your name"
          />
          {saved && <div className="small" style={{ color: "var(--ok)" }}>Saved</div>}
          <button className="btnPrimary" disabled={saving}>
            {saving ? "Saving…" : "Save name"}
          </button>
        </form>
      </div>

      {/* Compliance & reference resources */}
      <div className="card">
        <div className="sectionTitle">Compliance & Reference</div>
        <div className="col" style={{ gap: 8 }}>
          <button onClick={() => nav("/long-distance")} style={{ textAlign: "left" }}>
            Long Distance Compliance
          </button>
          <button onClick={() => nav("/documents")} style={{ textAlign: "left" }}>
            Document Library
          </button>
        </div>
      </div>

      {/* Expenses / reimbursement — mileage, personal-card reimbursement,
          or company-card expense logging. */}
      <div className="card">
        <div className="sectionTitle">Log Expense / Request Reimbursement</div>
        <div className="col" style={{ gap: 8 }}>
          <button onClick={() => nav("/reimbursement")} style={{ textAlign: "left" }}>
            Log an expense or request reimbursement
          </button>
          <div className="small" style={{ color: "var(--muted)" }}>
            Mileage with odometer photos, personal-card reimbursements, or
            company-card expense receipts.
          </div>
        </div>
      </div>

      {/* Sign out — placed above Patch Notes so a long changelog
          never buries it off-screen */}
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

      {/* Patch Notes — shows most recent 3 by default with an expander */}
      <PatchNotesCard />
    </div>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        onClick={handleCheck}
        disabled={checking}
        style={{
          width: "100%",
          padding: "14px 16px",
          background: "linear-gradient(135deg, var(--brand), var(--brand2))",
          color: "var(--on-brand)",
          border: "none",
          borderRadius: 14,
          cursor: checking ? "default" : "pointer",
          fontSize: 16,
          fontWeight: 800,
          boxShadow: "var(--shadow)",
          opacity: checking ? 0.7 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 18 }}>{checking ? "⟳" : "↻"}</span>
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
          <div key={n.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{n.title}</div>
            <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
              {new Date(n.updated_at).toLocaleDateString()}
              {n.created_by_name ? ` · ${n.created_by_name}` : ""}
            </div>
            <div style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>{n.body}</div>
          </div>
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
