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

  return (
    <div style={{ maxWidth: 480, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Profile</h1>
        <button onClick={() => nav(-1)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, opacity: 0.6 }}>
          &larr; Back
        </button>
      </div>

      {/* Profile photo */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 28 }}>
        <div
          style={{
            width: 100, height: 100, borderRadius: "50%",
            background: "#ddd", overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 10, fontSize: 36, color: "#999",
          }}
        >
          {photo
            ? <img src={photo} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : (user?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? "?")}
        </div>

        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoChange} />

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => fileRef.current?.click()} style={{ fontSize: 13 }}>
            {photo ? "Change photo" : "Upload photo"}
          </button>
          {photo && (
            <button onClick={handleRemovePhoto} style={{ fontSize: 13, background: "none", color: "crimson", border: "1px solid crimson" }}>
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Account info */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>Email</div>
          <div>{user?.email}</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>Role</div>
          <div style={{ textTransform: "capitalize" }}>{user?.role ?? "user"}</div>
        </div>
      </div>

      {/* Edit name */}
      <form onSubmit={handleSaveName} style={{ marginBottom: 32 }}>
        <label style={{ fontSize: 12, opacity: 0.6 }}>Display name</label>
        <input
          style={{ width: "100%", padding: 10, margin: "6px 0 10px", boxSizing: "border-box" }}
          value={name}
          onChange={(e) => { setName(e.target.value); setSaved(false); }}
          placeholder="Your name"
        />
        {err && <div style={{ color: "crimson", marginBottom: 8, fontSize: 13 }}>{err}</div>}
        {saved && <div style={{ color: "green", marginBottom: 8, fontSize: 13 }}>Saved</div>}
        <button disabled={saving} style={{ padding: "10px 20px" }}>
          {saving ? "Saving..." : "Save name"}
        </button>
      </form>

      {/* Sign out */}
      <hr style={{ marginBottom: 24, opacity: 0.2 }} />
      <button
        onClick={handleSignOut}
        style={{ width: "100%", padding: 12, background: "crimson", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 15 }}
      >
        Sign out
      </button>
    </div>
  );
}
