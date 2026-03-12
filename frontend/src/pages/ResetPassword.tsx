import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (password !== confirm) {
      setErr("Passwords do not match");
      return;
    }

    setBusy(true);

    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, new_password: password }),
      });
      nav("/login?reset=1", { replace: true });
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
        <p style={{ color: "crimson" }}>Invalid reset link.</p>
        <Link to="/login">Back to login</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1>Reset password</h1>

      <form onSubmit={onSubmit}>
        <label>New password</label>
        <input
          style={{ width: "100%", padding: 10, margin: "8px 0" }}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />

        <label>Confirm password</label>
        <input
          style={{ width: "100%", padding: 10, margin: "8px 0" }}
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />

        {err && <div style={{ color: "crimson", marginTop: 8 }}>{err}</div>}

        <button disabled={busy} style={{ width: "100%", padding: 12, marginTop: 12 }}>
          {busy ? "Saving..." : "Set new password"}
        </button>
      </form>
    </div>
  );
}
