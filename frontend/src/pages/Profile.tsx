import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const PHOTO_KEY = "crew_profile_photo_v1";

function loadPhoto(): string | null {
  return localStorage.getItem(PHOTO_KEY);
}

function savePhoto(dataUrl: string) {
  localStorage.setItem(PHOTO_KEY, dataUrl);
}

function removePhoto() {
  localStorage.removeItem(PHOTO_KEY);
}

export default function Profile() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  const [photo, setPhoto] = useState<string | null>(loadPhoto);
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleSignOut() {
    logout();
    nav("/login", { replace: true });
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      savePhoto(dataUrl);
      setPhoto(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  function handleRemovePhoto() {
    removePhoto();
    setPhoto(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    setSaved(false);
    try {
      await apiFetch("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
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

        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoChange} />

        <div className="row" style={{ gap: 8 }}>
          <button onClick={() => fileRef.current?.click()} style={{ fontSize: 13 }}>
            {photo ? "Change photo" : "Upload photo"}
          </button>
          {photo && (
            <button
              onClick={handleRemovePhoto}
              style={{ fontSize: 13, background: "none", color: "var(--danger)", border: "1px solid var(--danger)" }}
            >
              Remove
            </button>
          )}
        </div>
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
          {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}
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
