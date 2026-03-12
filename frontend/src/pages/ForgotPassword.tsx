import React, { useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);

    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
        <h1>Check your email</h1>
        <p>If that address is registered, you'll receive a reset link shortly.</p>
        <Link to="/login">Back to login</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1>Forgot password</h1>

      <form onSubmit={onSubmit}>
        <label>Email</label>
        <input
          style={{ width: "100%", padding: 10, margin: "8px 0" }}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        {err && <div style={{ color: "crimson", marginTop: 8 }}>{err}</div>}

        <button disabled={busy} style={{ width: "100%", padding: 12, marginTop: 12 }}>
          {busy ? "Sending..." : "Send reset link"}
        </button>
      </form>

      <div style={{ marginTop: 12 }}>
        <Link to="/login">Back to login</Link>
      </div>
    </div>
  );
}
