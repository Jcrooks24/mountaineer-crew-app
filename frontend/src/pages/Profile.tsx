import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useAuth, type User } from "../auth/AuthContext";
import { refreshDirectory } from "../lib/userDirectory";

const LEGACY_PHOTO_KEY = "crew_profile_photo_v1";

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

      {/* Avatar */}
      <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 88, height: 88, borderRadius: "50%",
            background: "linear-gradient(135deg, var(--brand), var(--brand2))",
            overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 32, fontWeight: 900, color: "#0b1220",
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

      {/* Sign out */}
      <div className="card">
        <button
          onClick={handleSignOut}
          style={{
            width: "100%", padding: 12,
            background: "linear-gradient(180deg, #3d1a1a, #2e1212)",
            color: "var(--danger)",
            border: "1px solid rgba(255,107,107,0.3)",
            borderRadius: 12, cursor: "pointer", fontSize: 15, fontWeight: 700,
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
